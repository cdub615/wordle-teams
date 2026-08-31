import { convexTest } from 'convex-test'
import { describe, expect, test } from 'vitest'
import schema from './schema'
import { internal } from './_generated/api'

const modules = import.meta.glob('./**/*.ts')

describe('upsertPlayers', () => {
  // THE BEHAVIOUR is what is pinned here: the copy cannot put a nameless player
  // into Convex. Not WHICH LAYER refuses it.
  //
  // That distinction is deliberate and was measured. playerInput narrows
  // firstName/lastName to v.string() as a second gate behind
  // copy-from-supabase.mjs's selectCopyable — but widening either one back to
  // v.optional leaves these tests green, because the schema then rejects the same
  // row from inside the handler with the identical error name, the identical
  // message, and the same empty table (a throwing mutation writes nothing either
  // way). They are equivalent mutants, and an assertion dressed up to look like it
  // caught the difference would be a lie about what the suite knows: a real
  // property that this harness cannot observe.
  //
  // legacyId is the exception, and is pinned separately below — the schema made it
  // OPTIONAL in Phase 4, so there the validator is the only thing refusing.
  const aRow = (over: Record<string, unknown> = {}) => ({
    legacyId: '22222222-2222-4222-8222-222222222222',
    email: 'copied@a.test',
    firstName: 'Ada',
    lastName: 'Lovelace',
    hasPwa: false,
    reminderDeliveryMethods: ['email'],
    reminderDeliveryTime: '18:00:00',
    ...over,
  })

  test('accepts a fully named row, and an insert clobbers nothing', async () => {
    const t = convexTest(schema, modules)
    expect(await t.mutation(internal.migrate.upsertPlayers, { rows: [aRow()] as never })).toEqual({
      inserted: 1,
      updated: 0,
      // There is no stored row to overwrite. The empty record is the report,
      // not the absence of one — see the clobber block at the bottom of this file.
      clobbered: {},
    })
  })

  for (const field of ['firstName', 'lastName'] as const) {
    test(`refuses a row with no ${field}, and writes nothing`, async () => {
      const t = convexTest(schema, modules)
      await expect(
        t.mutation(internal.migrate.upsertPlayers, {
          rows: [aRow({ [field]: undefined })] as never,
        }),
      ).rejects.toThrow()

      // The batch is refused as a whole. Worth asserting even though a throwing
      // Convex mutation rolls back by definition — this is the property the copy
      // depends on when it sends 200 rows at a time, and it should fail here if
      // the batching is ever rewritten into something that commits per row.
      await t.run(async (ctx) => {
        expect(await ctx.db.query('players').collect()).toEqual([])
      })
    })
  }

  // --- what a re-copy overwrites ---------------------------------------------
  //
  // Latent today and armed by Phase 6: nothing in v2 edits a copied player yet,
  // so these pin the report against the fields wt-ksh.7 will make editable.

  test('an identical re-copy overwrites nothing', async () => {
    const t = convexTest(schema, modules)
    await t.mutation(internal.migrate.upsertPlayers, { rows: [aRow()] as never })
    const second = await t.mutation(internal.migrate.upsertPlayers, { rows: [aRow()] as never })
    expect(second).toEqual({ inserted: 0, updated: 1, clobbered: {} })
  })

  test('counts a field the re-copy changes, and only that field', async () => {
    const t = convexTest(schema, modules)
    await t.mutation(internal.migrate.upsertPlayers, { rows: [aRow()] as never })
    // The shape Phase 6 will produce: the player edited their own row in v2, and
    // the copy is about to put the Supabase value back.
    await t.run(async (ctx) => {
      const player = await ctx.db.query('players').first()
      await ctx.db.patch(player!._id, { reminderDeliveryTime: '07:30:00' })
    })
    const second = await t.mutation(internal.migrate.upsertPlayers, { rows: [aRow()] as never })
    expect(second.clobbered).toEqual({ reminderDeliveryTime: 1 })
  })

  test('reminderDeliveryMethods compares order-insensitively', async () => {
    const t = convexTest(schema, modules)
    await t.mutation(internal.migrate.upsertPlayers, {
      rows: [aRow({ reminderDeliveryMethods: ['email', 'push'] })] as never,
    })
    await t.run(async (ctx) => {
      const player = await ctx.db.query('players').first()
      await ctx.db.patch(player!._id, { reminderDeliveryMethods: ['push', 'email'] })
    })
    const second = await t.mutation(internal.migrate.upsertPlayers, {
      rows: [aRow({ reminderDeliveryMethods: ['email', 'push'] })] as never,
    })
    // Same two methods, different order. The copy is about to write the same
    // set, so nothing is lost and nothing should be reported.
    expect(second.clobbered).toEqual({})
  })

  test('still requires legacyId, which the table itself no longer does', async () => {
    // Everything arriving here came out of Supabase, so it has a primary key —
    // and byLegacyId is the whole upsert key, so a row without one could only
    // insert a duplicate. The schema is deliberately wider than this validator.
    const t = convexTest(schema, modules)
    await expect(
      t.mutation(internal.migrate.upsertPlayers, {
        rows: [aRow({ legacyId: undefined })] as never,
      }),
    ).rejects.toThrow()
  })
})

/**
 * wt-ksh.13: a re-copy REPORTS what it overwrites.
 *
 * Teams are where this bites today. Phase 3 gave v2 createTeam, updateTeam,
 * removeMember and deleteTeam; Phase 4 gave it invites, joins, cancels and
 * leaves. upsertTeams rebuilds the whole doc from Supabase and patches it over
 * the top, which reverts every one of those. The overwrite is INTENDED — beta
 * state is discarded at cutover — so what these pin is that it is no longer
 * silent, and that it stays quiet when there is nothing to say.
 */
describe('upsertTeams reports what a re-copy overwrites', () => {
  const ADA = '11111111-1111-4111-8111-111111111111'
  const GRACE = '33333333-3333-4333-8333-333333333333'

  const aPlayer = (legacyId: string, firstName: string) => ({
    legacyId,
    email: `${firstName.toLowerCase()}@example.test`,
    firstName,
    lastName: 'Tester',
    hasPwa: false,
    reminderDeliveryMethods: ['email'],
    reminderDeliveryTime: '18:00:00',
  })

  const aTeam = (over: Record<string, unknown> = {}) => ({
    legacyId: 1,
    name: 'Alpha',
    creatorLegacyId: ADA,
    playerLegacyIds: [ADA, GRACE],
    invited: [],
    oneGuess: 5,
    twoGuesses: 3,
    threeGuesses: 2,
    fourGuesses: 1,
    fiveGuesses: 0,
    sixGuesses: -1,
    failed: -3,
    nA: 0,
    playWeekends: true,
    showLetters: true,
    ...over,
  })

  /** A deployment that has already been copied into once. */
  const afterFirstCopy = async (rows: Array<Record<string, unknown>> = [aTeam()]) => {
    const t = convexTest(schema, modules)
    await t.mutation(internal.migrate.upsertPlayers, {
      rows: [aPlayer(ADA, 'Ada'), aPlayer(GRACE, 'Grace')] as never,
    })
    await t.mutation(internal.migrate.upsertTeams, { rows: rows as never })
    return t
  }

  const recopy = async (t: Awaited<ReturnType<typeof afterFirstCopy>>, rows = [aTeam()]) =>
    await t.mutation(internal.migrate.upsertTeams, { rows: rows as never })

  test('an insert overwrites nothing', async () => {
    const t = convexTest(schema, modules)
    await t.mutation(internal.migrate.upsertPlayers, {
      rows: [aPlayer(ADA, 'Ada'), aPlayer(GRACE, 'Grace')] as never,
    })
    expect(await t.mutation(internal.migrate.upsertTeams, { rows: [aTeam()] as never })).toEqual({
      inserted: 1,
      updated: 0,
      droppedMembers: 0,
      clobbered: {},
    })
  })

  test('an identical re-copy overwrites nothing', async () => {
    const t = await afterFirstCopy()
    // Including playerIds, which upsertTeams REBUILDS by resolving uuids rather
    // than reading back what is stored, and invited, which it rebuilds by
    // lowercasing. If either compared by identity or by order this would fire on
    // every run and the report would be worthless.
    expect(await recopy(t)).toEqual({ inserted: 0, updated: 1, droppedMembers: 0, clobbered: {} })
  })

  test('counts a team renamed in v2', async () => {
    const t = await afterFirstCopy()
    await t.run(async (ctx) => {
      const team = await ctx.db.query('teams').first()
      await ctx.db.patch(team!._id, { name: 'Renamed in v2' })
    })
    expect((await recopy(t)).clobbered).toEqual({ name: 1 })
  })

  test('counts each differing field separately, not the row once', async () => {
    const t = await afterFirstCopy()
    await t.run(async (ctx) => {
      const team = await ctx.db.query('teams').first()
      await ctx.db.patch(team!._id, { name: 'Renamed in v2', playWeekends: false })
    })
    // Two settings were lost, so two are reported. A count of rows rather than
    // fields would say `1` and hide that the roster/settings damage is wider
    // than a rename.
    expect((await recopy(t)).clobbered).toEqual({ name: 1, playWeekends: 1 })
  })

  test('counts rows per field across a batch', async () => {
    const t = await afterFirstCopy([aTeam(), aTeam({ legacyId: 2, name: 'Beta' })])
    await t.run(async (ctx) => {
      for (const team of await ctx.db.query('teams').collect()) {
        await ctx.db.patch(team._id, { name: `${team.name} (renamed in v2)` })
      }
    })
    expect(
      (await recopy(t, [aTeam(), aTeam({ legacyId: 2, name: 'Beta' })])).clobbered,
    ).toEqual({ name: 2 })
  })

  test('playerIds compare order-insensitively', async () => {
    const t = await afterFirstCopy()
    await t.run(async (ctx) => {
      const team = await ctx.db.query('teams').first()
      await ctx.db.patch(team!._id, { playerIds: [...team!.playerIds].reverse() })
    })
    // Same roster, different order — which is exactly what a join or a leave
    // leaves behind. Nobody's membership is being taken away.
    expect((await recopy(t)).clobbered).toEqual({})
  })

  test('counts a member v2 removed and the copy is about to put back', async () => {
    const t = await afterFirstCopy()
    await t.run(async (ctx) => {
      const team = await ctx.db.query('teams').first()
      await ctx.db.patch(team!._id, { playerIds: [team!.playerIds[0]!] })
    })
    // The parent issue's worst case: the removed member returns, with no winner
    // recompute, so the stale-winner rows come back with them.
    expect((await recopy(t)).clobbered).toEqual({ playerIds: 1 })
  })

  test('invited ignores case, because the copy lowercases before it writes', async () => {
    const t = await afterFirstCopy([aTeam({ invited: ['Someone@example.test'] })])
    expect((await recopy(t, [aTeam({ invited: ['Someone@example.test'] })])).clobbered).toEqual({})
  })

  test('invited counts a duplicate address the copy is about to drop', async () => {
    const t = await afterFirstCopy([aTeam({ invited: ['someone@example.test'] })])
    await t.run(async (ctx) => {
      const team = await ctx.db.query('teams').first()
      // Phase 4 established that the same address CAN appear twice — a second
      // invite before the first is accepted. Set comparison would call this
      // unchanged; it is a real edit being written away.
      await ctx.db.patch(team!._id, { invited: ['someone@example.test', 'someone@example.test'] })
    })
    expect((await recopy(t, [aTeam({ invited: ['someone@example.test'] })])).clobbered).toEqual({
      invited: 1,
    })
  })

  test('the eight scoring fields report once, as `scoring`', async () => {
    const t = await afterFirstCopy()
    await t.run(async (ctx) => {
      const team = await ctx.db.query('teams').first()
      await ctx.db.patch(team!._id, { oneGuess: 10, twoGuesses: 9, nA: -1 })
    })
    // Three fields moved; one thing happened. wordle-teams-1j3 cares that the
    // team's BASE system was rewritten — every month before v2's first version
    // row re-scores — not which of the numbers moved.
    expect((await recopy(t)).clobbered).toEqual({ scoring: 1 })
  })

  test('counts an owner the copy replaces', async () => {
    const t = await afterFirstCopy()
    expect((await recopy(t, [aTeam({ creatorLegacyId: GRACE })])).clobbered).toEqual({ owner: 1 })
  })

  test('does not count an owner the copy leaves alone', async () => {
    const t = await afterFirstCopy()
    // Out of a scoped copy, so upsertTeams omits `owner` from the doc entirely
    // and the patch does not touch it. Nothing is written, so nothing is
    // clobbered — and the stored owner has to still be there afterwards, which
    // is the half of the claim a count alone would not prove.
    const before = await t.run(async (ctx) => (await ctx.db.query('teams').first())!.owner)
    expect((await recopy(t, [aTeam({ creatorLegacyId: undefined })])).clobbered).toEqual({})
    const after = await t.run(async (ctx) => (await ctx.db.query('teams').first())!.owner)
    expect(after).toBe(before)
    expect(after).not.toBeUndefined()
  })
})

/**
 * The same report on monthlyWinners — and the one table where a row v2 created
 * ITSELF is reachable.
 *
 * upsertTeams and upsertPlayers match on legacyId, which a v2-born row never
 * has, so they can only ever overwrite a COPIED row. This one matches on
 * (teamId, year, month), the same key winners.ts's recomputeTeamMonth writes on,
 * so the row it finds may be one v2 computed from v2's own boards. It adopts it.
 */
describe('upsertMonthlyWinners reports what a re-copy overwrites', () => {
  const ADA = '11111111-1111-4111-8111-111111111111'
  const GRACE = '33333333-3333-4333-8333-333333333333'

  const aPlayer = (legacyId: string, firstName: string) => ({
    legacyId,
    email: `${firstName.toLowerCase()}@example.test`,
    firstName,
    lastName: 'Tester',
    hasPwa: false,
    reminderDeliveryMethods: ['email'],
    reminderDeliveryTime: '18:00:00',
  })

  const aWinner = (over: Record<string, unknown> = {}) => ({
    legacyId: 77,
    playerLegacyId: ADA,
    teamLegacyId: 1,
    year: 2026,
    month: 3,
    hasSeenCelebrationLegacyIds: [] as string[],
    ...over,
  })

  /** Two players and their team, in place, with no winner row yet. */
  const seeded = async () => {
    const t = convexTest(schema, modules)
    await t.mutation(internal.migrate.upsertPlayers, {
      rows: [aPlayer(ADA, 'Ada'), aPlayer(GRACE, 'Grace')] as never,
    })
    await t.mutation(internal.migrate.upsertTeams, {
      rows: [
        {
          legacyId: 1,
          name: 'Alpha',
          creatorLegacyId: ADA,
          playerLegacyIds: [ADA, GRACE],
          invited: [],
          oneGuess: 5,
          twoGuesses: 3,
          threeGuesses: 2,
          fourGuesses: 1,
          fiveGuesses: 0,
          sixGuesses: -1,
          failed: -3,
          nA: 0,
          playWeekends: true,
          showLetters: true,
        },
      ] as never,
    })
    return t
  }

  const copyWinner = async (
    t: Awaited<ReturnType<typeof seeded>>,
    rows: Array<Record<string, unknown>> = [aWinner()],
  ) => await t.mutation(internal.migrate.upsertMonthlyWinners, { rows: rows as never })

  test('an insert overwrites nothing', async () => {
    const t = await seeded()
    expect(await copyWinner(t)).toEqual({ inserted: 1, updated: 0, skipped: 0, clobbered: {} })
  })

  test('an identical re-copy overwrites nothing', async () => {
    const t = await seeded()
    await copyWinner(t)
    expect(await copyWinner(t)).toEqual({ inserted: 0, updated: 1, skipped: 0, clobbered: {} })
  })

  test('counts a winner v2 recomputed to someone else', async () => {
    const t = await seeded()
    await copyWinner(t)
    await t.run(async (ctx) => {
      const grace = await ctx.db
        .query('players')
        .withIndex('by_legacyId', (q) => q.eq('legacyId', GRACE))
        .unique()
      const winner = await ctx.db.query('monthlyWinners').first()
      // What recomputeTeamMonth does when the month's totals change:
      // convex/winners.ts:165, which also clears the seen-list.
      await ctx.db.patch(winner!._id, { playerId: grace!._id, hasSeenCelebration: [] })
    })
    expect((await copyWinner(t)).clobbered).toEqual({ playerId: 1 })
  })

  test('counts a seen-list the copy is about to put back', async () => {
    const t = await seeded()
    await copyWinner(t, [aWinner({ hasSeenCelebrationLegacyIds: [ADA] })])
    await t.run(async (ctx) => {
      const winner = await ctx.db.query('monthlyWinners').first()
      await ctx.db.patch(winner!._id, { hasSeenCelebration: [] })
    })
    expect(
      (await copyWinner(t, [aWinner({ hasSeenCelebrationLegacyIds: [ADA] })])).clobbered,
    ).toEqual({ hasSeenCelebration: 1 })
  })

  test('hasSeenCelebration compares order-insensitively', async () => {
    const t = await seeded()
    await copyWinner(t, [aWinner({ hasSeenCelebrationLegacyIds: [ADA, GRACE] })])
    await t.run(async (ctx) => {
      const winner = await ctx.db.query('monthlyWinners').first()
      await ctx.db.patch(winner!._id, {
        hasSeenCelebration: [...winner!.hasSeenCelebration].reverse(),
      })
    })
    expect(
      (await copyWinner(t, [aWinner({ hasSeenCelebrationLegacyIds: [ADA, GRACE] })])).clobbered,
    ).toEqual({})
  })

  test('reports adopting a winner row v2 computed itself', async () => {
    const t = await seeded()
    // Exactly what winners.ts:154 inserts — no legacyId, because v2 worked it out
    // from v2's own boards. The copy matches it on (teamId, year, month) all the
    // same, and `legacyId` moving from undefined to a Supabase id is the signal
    // that a v2-born row was just adopted. Teams and players cannot report this,
    // because they cannot reach a v2-born row at all.
    await t.run(async (ctx) => {
      const ada = await ctx.db
        .query('players')
        .withIndex('by_legacyId', (q) => q.eq('legacyId', ADA))
        .unique()
      const team = await ctx.db.query('teams').first()
      await ctx.db.insert('monthlyWinners', {
        playerId: ada!._id,
        teamId: team!._id,
        year: 2026,
        month: 3,
        hasSeenCelebration: [],
      })
    })
    const result = await copyWinner(t)
    expect(result).toEqual({ inserted: 0, updated: 1, skipped: 0, clobbered: { legacyId: 1 } })
    await t.run(async (ctx) => {
      expect(await ctx.db.query('monthlyWinners').collect()).toHaveLength(1)
    })
  })
})

describe('countTable', () => {
  // THE HALF THE FAKE CLIENT CANNOT REACH. scripts/lib/count-tables.test.mjs
  // drives readCounts against a fake whose paging behaviour it invents, so it
  // pins the LOOP and nothing about the mapping from Convex's PaginationResult
  // onto {count, cursor, isDone}. Get that mapping wrong and the loop is still
  // perfect while the number is wrong.
  //
  // The failure worth spending a fixture on is `isDone` arriving TRUE TOO EARLY:
  // readCounts stops, reports the first page only, and verify-parity prints
  // `dailyScores  supabase=6951  convex=2000` — which at the cutover audit reads
  // as LOST DATA rather than as a broken counter, and sends the operator to the
  // wrong runbook step. An off-by-one on `count` has the same shape. A wrong
  // cursor, by contrast, is self-announcing: readCounts hits MAX_PAGES and
  // throws.
  //
  // CATCHING THAT NEEDS A PAGE THAT IS GENUINELY NOT THE LAST ONE, which is why
  // the 2,001-row fixture below is worth its keep: every assertion that isDone
  // is TRUE is satisfied by an isDone hard-wired to true, so only a legitimate
  // FALSE can catch it. It costs ~120ms, measured, because convex-test inserts
  // in memory.
  const seedWebhooks = async (t: ReturnType<typeof convexTest>, n: number) =>
    await t.run(async (ctx) => {
      if (n === 0) return
      const playerId = await ctx.db.insert('players', {
        email: 'counted@a.test',
        firstName: 'Ada',
        lastName: 'Lovelace',
        hasPwa: false,
        reminderDeliveryMethods: ['email'],
        reminderDeliveryTime: '18:00:00',
      })
      for (let i = 0; i < n; i++) {
        await ctx.db.insert('webhookEvents', {
          playerId,
          eventName: 'order.created',
          body: {},
          processed: true,
        })
      }
    })

  test('counts every row in one page and says it is done', async () => {
    const t = convexTest(schema, modules)
    await seedWebhooks(t, 3)
    const page = await t.query(internal.migrate.countTable, {
      table: 'webhookEvents',
      cursor: null,
    })
    // `count` is the page LENGTH, not the table length and not a running total —
    // adding up is the caller's job, and this is the number it adds.
    expect(page.count).toBe(3)
    expect(page.isDone).toBe(true)
    expect(typeof page.cursor).toBe('string')
  })

  test('a table larger than one page reports isDone false, and the cursor reads the rest', async () => {
    // 2,001 rows against countTable's numItems of 2,000. This is the only test
    // in either suite that sees isDone FALSE, and therefore the only thing
    // standing between a premature isDone and a parity audit that reports 2,000
    // of 6,951 daily scores as missing data.
    //
    // It also pins the page size itself: `2000` here is countTable's numItems
    // observed from outside, so changing that constant without meaning to fails
    // here rather than quietly changing how many transactions a count costs.
    const t = convexTest(schema, modules)
    await seedWebhooks(t, 2001)

    const first = await t.query(internal.migrate.countTable, {
      table: 'webhookEvents',
      cursor: null,
    })
    expect(first.count).toBe(2000)
    expect(first.isDone).toBe(false)

    const second = await t.query(internal.migrate.countTable, {
      table: 'webhookEvents',
      cursor: first.cursor,
    })
    expect(second.count).toBe(1)
    expect(second.isDone).toBe(true)

    // The whole point, stated as the caller states it: the pages add up to the
    // table. Two transactions, one number.
    expect(first.count + second.count).toBe(2001)
  })

  test('an empty table is 0 and done, from a null cursor', async () => {
    const t = convexTest(schema, modules)
    const page = await t.query(internal.migrate.countTable, { table: 'players', cursor: null })
    expect(page).toMatchObject({ count: 0, isDone: true })
  })

  test('a table name outside the union is refused, loudly', async () => {
    // The property the literal union actually buys. NOT a compile error — every
    // call site is .mjs and nothing type-checks those strings — so this runtime
    // refusal is the whole guarantee, and it is worth pinning that it throws
    // rather than quietly counting zero. A silent 0 at the parity audit reads as
    // a table the copy never wrote.
    const t = convexTest(schema, modules)
    await expect(
      t.query(internal.migrate.countTable, { table: 'notATable' as never, cursor: null }),
    ).rejects.toThrow()
  })
})
