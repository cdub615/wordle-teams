import { convexTest } from 'convex-test'
import { describe, expect, test } from 'vitest'
import schema from './schema'
import { aPlayer, aTeam } from './fixtures.ts'
import { toPuzzleDay } from './lib/puzzleDay.ts'
import { completeProfileFor } from './players.ts'

const modules = import.meta.glob('./**/*.ts')
const today = toPuzzleDay(new Date())

/**
 * The address the joiner signs in with. Always lowercase — that is what Better
 * Auth hands the mutation, and what completeProfileFor normalises to.
 */
const ADA = 'ada.lovelace@example.test'
/** The same address as a v1 team could have stored it. See amendment A2. */
const ADA_AS_TYPED = 'Ada.Lovelace@Example.TEST'

const NAMES = { firstName: 'Ada', lastName: 'Lovelace' }

/** A board scoring `guesses.length` attempts, mirroring winners.test.ts. */
const aScore = (playerId: string, puzzleDay: string, guesses: Array<string>) => ({
  playerId: playerId as never,
  puzzleDay,
  date: 1_755_500_000_000,
  answer: 'SPEED',
  guesses,
})

describe('completeProfileFor', () => {
  test('creates a player with no legacyId and v1s column defaults', async () => {
    const t = convexTest(schema, modules)
    await t.run(async (ctx) => {
      const playerId = await completeProfileFor(ctx, ADA, NAMES, today)

      const player = (await ctx.db.get(playerId))!
      expect(player.email).toBe(ADA)
      expect(player.firstName).toBe('Ada')
      expect(player.lastName).toBe('Lovelace')
      // Absence is the marker Phase 7's reconciliation reads as "born in v2".
      expect(player.legacyId).toBeUndefined()
      // Convex has no column defaults, so these are v1's, restated. Pinned
      // rather than left implicit: a reminder time of '' or a missing methods
      // array would only show up in the reminder cron, months later.
      expect(player.hasPwa).toBe(false)
      expect(player.reminderDeliveryMethods).toEqual(['email'])
      expect(player.reminderDeliveryTime).toBe('10:00:00')
      expect(player.createdAt).toEqual(expect.any(Number))
    })
  })

  test('normalises the address it stores, and matches invites against it', async () => {
    // players.email is always lowercase (schema), and the invite scan compares
    // against this value — so a mixed-case address arriving from a provider
    // must not create a row that by_email can never find again.
    //
    // Padded as well as mixed-case, because the reduction here has to be the
    // same one normaliseInviteEmail applies on the write side — trim() included.
    // Asserting the STORED email alone would not pin the trim, since a padded
    // address still lowercases to something by_email can find; it is the invite
    // match that actually depends on both halves.
    const t = convexTest(schema, modules)
    await t.run(async (ctx) => {
      const bob = await ctx.db.insert('players', aPlayer({ email: 'bob@example.test' }))
      const teamId = await ctx.db.insert(
        'teams',
        aTeam({ playerIds: [bob], creator: bob, invited: [ADA] }),
      )

      const playerId = await completeProfileFor(ctx, `  ${ADA_AS_TYPED}  `, NAMES, today)

      expect((await ctx.db.get(playerId))!.email).toBe(ADA)
      expect((await ctx.db.get(teamId))!.playerIds).toContain(playerId)
      expect((await ctx.db.get(teamId))!.invited).toEqual([])
    })
  })

  test('patches an existing player rather than creating a second row', async () => {
    // The ordinary case for everyone who used v1: a copied row already exists
    // at this address. Also what makes a double-tapped submit harmless.
    const t = convexTest(schema, modules)
    await t.run(async (ctx) => {
      const first = await completeProfileFor(ctx, ADA, NAMES, today)
      const second = await completeProfileFor(
        ctx,
        ADA,
        { firstName: 'Augusta', lastName: 'King' },
        today,
      )

      expect(second).toBe(first)
      const players = await ctx.db.query('players').collect()
      expect(players).toHaveLength(1)
      expect(players[0].firstName).toBe('Augusta')
      expect(players[0].lastName).toBe('King')
    })
  })

  test('leaves a copied rows other fields alone when it patches', async () => {
    const t = convexTest(schema, modules)
    await t.run(async (ctx) => {
      const copied = await ctx.db.insert(
        'players',
        aPlayer({ email: ADA, legacyId: 'legacy-uuid', reminderDeliveryTime: '18:00:00' }),
      )

      await completeProfileFor(ctx, ADA, { firstName: 'Augusta', lastName: 'King' }, today)

      const player = (await ctx.db.get(copied))!
      expect(player.firstName).toBe('Augusta')
      expect(player.legacyId).toBe('legacy-uuid')
      expect(player.reminderDeliveryTime).toBe('18:00:00')
    })
  })

  test('claims an invite stored at a mixed-case address', async () => {
    // AMENDMENT A2's ACCEPTANCE CRITERION, and the single most important case
    // here. v1 stored `invited` exactly as typed and matched it
    // case-sensitively while auth lowercased addresses, so anyone invited at a
    // mixed-case address silently never joined.
    //
    // NO COPIED TEAM CAN ACTUALLY HOLD THIS ROW TODAY — both copy gates
    // lowercase `invited`, and production's 44 pending invites were measured
    // clean. The fixture is deliberately unrepresentable data: it pins the
    // read-side normalisation so that a future writer which forgets to
    // normalise cannot silently resurrect the v1 bug, whose whole character is
    // that it produces no error, just an invite nobody can ever claim.
    const t = convexTest(schema, modules)
    await t.run(async (ctx) => {
      const bob = await ctx.db.insert('players', aPlayer({ email: 'bob@example.test' }))
      const teamId = await ctx.db.insert(
        'teams',
        aTeam({ playerIds: [bob], creator: bob, invited: [ADA_AS_TYPED] }),
      )

      const playerId = await completeProfileFor(ctx, ADA, NAMES, today)

      const team = (await ctx.db.get(teamId))!
      expect(team.playerIds).toEqual([bob, playerId])
      expect(team.invited).toEqual([])
    })
  })

  test('claims an invite stored with surrounding whitespace', async () => {
    // The other half of mirroring normaliseInviteEmail on read. It trims AND
    // lowercases on write; neither copy gate trims, so a padded address is the
    // one abnormal shape that could genuinely reach the table. Matching on case
    // alone would leave it silently unclaimable — the same failure mode as the
    // mixed-case case above, reached by a different route.
    const t = convexTest(schema, modules)
    await t.run(async (ctx) => {
      const bob = await ctx.db.insert('players', aPlayer({ email: 'bob@example.test' }))
      const teamId = await ctx.db.insert(
        'teams',
        aTeam({ playerIds: [bob], creator: bob, invited: [`  ${ADA_AS_TYPED}  `] }),
      )

      const playerId = await completeProfileFor(ctx, ADA, NAMES, today)

      const team = (await ctx.db.get(teamId))!
      expect(team.playerIds).toEqual([bob, playerId])
      expect(team.invited).toEqual([])
    })
  })

  test('claims invites across several teams at once, and touches no others', async () => {
    const t = convexTest(schema, modules)
    await t.run(async (ctx) => {
      const bob = await ctx.db.insert('players', aPlayer({ email: 'bob@example.test' }))
      const one = await ctx.db.insert(
        'teams',
        aTeam({ name: 'One', playerIds: [bob], creator: bob, invited: [ADA] }),
      )
      const two = await ctx.db.insert(
        'teams',
        aTeam({ legacyId: 207, name: 'Two', playerIds: [bob], creator: bob, invited: [ADA] }),
      )
      // Invited someone else entirely. The scan reads EVERY team — Convex
      // cannot index array membership — so "does not join a team it was not
      // invited to" is a real property, not a tautology.
      const other = await ctx.db.insert(
        'teams',
        aTeam({
          legacyId: 208,
          name: 'Other',
          playerIds: [bob],
          creator: bob,
          invited: ['someone.else@example.test'],
        }),
      )

      const playerId = await completeProfileFor(ctx, ADA, NAMES, today)

      expect((await ctx.db.get(one))!.playerIds).toContain(playerId)
      expect((await ctx.db.get(two))!.playerIds).toContain(playerId)
      expect((await ctx.db.get(other))!.playerIds).toEqual([bob])
      expect((await ctx.db.get(other))!.invited).toEqual(['someone.else@example.test'])
    })
  })

  test('drops only the claimed address from a multi-invite list', async () => {
    const t = convexTest(schema, modules)
    await t.run(async (ctx) => {
      const bob = await ctx.db.insert('players', aPlayer({ email: 'bob@example.test' }))
      const teamId = await ctx.db.insert(
        'teams',
        aTeam({
          playerIds: [bob],
          creator: bob,
          invited: ['charles@example.test', ADA_AS_TYPED, 'grace@example.test'],
        }),
      )

      await completeProfileFor(ctx, ADA, NAMES, today)

      expect((await ctx.db.get(teamId))!.invited).toEqual([
        'charles@example.test',
        'grace@example.test',
      ])
    })
  })

  test('does not add the player twice when they are already a member and also invited', async () => {
    // A copied team can hold both, because v1 never removed an invite it could
    // not match. A duplicate id shows the person twice on the team card and
    // enters them twice in the month's candidate list.
    const t = convexTest(schema, modules)
    await t.run(async (ctx) => {
      const ada = await ctx.db.insert('players', aPlayer({ email: ADA }))
      const teamId = await ctx.db.insert(
        'teams',
        aTeam({ playerIds: [ada], creator: ada, invited: [ADA_AS_TYPED] }),
      )

      const playerId = await completeProfileFor(ctx, ADA, NAMES, today)

      expect(playerId).toBe(ada)
      const team = (await ctx.db.get(teamId))!
      expect(team.playerIds).toEqual([ada])
      expect(team.invited).toEqual([])
    })
  })

  test('recomputes a claimed teams existing winner rows (wt-ksh.5.2)', async () => {
    // The bug this closes: v1's update_monthly_winners is a trigger on
    // daily_scores, so a membership change never fires it, and in v2 a board
    // entry only recomputes the month it is dated in. Without the recompute
    // here, every month the joiner could have won stays wrong forever.
    //
    // EVERYTHING IS DATED IN A FIXED PAST MONTH — 2025-06, never today's. That
    // is the whole point of the fixture, not a detail. Dated in the current
    // month, an implementation that ignored monthsWithWinners and only ever
    // recomputed today's month would pass, which is precisely the behaviour
    // wt-ksh.5.2 exists to forbid. A hard-coded past month also keeps the test's
    // strength constant instead of letting it change with the wall clock.
    //
    // Ada is a COPIED player — she has a row and a history, and completing her
    // profile patches rather than inserts. That is what makes the case
    // constructible at all: a brand-new player's boards cannot pre-date the id
    // they are keyed on, so a joiner with a history is necessarily one whose row
    // already exists.
    const t = convexTest(schema, modules)
    await t.run(async (ctx) => {
      const bob = await ctx.db.insert('players', aPlayer({ email: 'bob@example.test' }))
      const ada = await ctx.db.insert('players', aPlayer({ email: ADA }))
      // TWO claimed teams, each with its own stale row. One would leave
      // "recompute only the first team I claimed" indistinguishable from
      // "recompute every team I claimed", and someone claiming three invites at
      // once is the ordinary case for a copied player.
      const first = await ctx.db.insert(
        'teams',
        aTeam({ name: 'First', playerIds: [bob], creator: bob, invited: [ADA] }),
      )
      const second = await ctx.db.insert(
        'teams',
        aTeam({ legacyId: 207, name: 'Second', playerIds: [bob], creator: bob, invited: [ADA] }),
      )
      // Bob solved in four (1 point); Ada solved in one (5). Every other day of
      // the month scores the team's nA, which is 0 for both of them, so the
      // month is decided by these two boards alone whatever date this runs on.
      await ctx.db.insert('dailyScores', aScore(bob, '2025-06-03', ['CRANE', 'SLATE', 'SPELL', 'SPEED']))
      await ctx.db.insert('dailyScores', aScore(ada, '2025-06-03', ['SPEED']))
      // The stale rows: Bob won June 2025 on both teams because Ada was not on
      // either roster when they were computed, and he has already dismissed the
      // confetti.
      const staleRows = []
      for (const teamId of [first, second]) {
        staleRows.push(
          await ctx.db.insert('monthlyWinners', {
            playerId: bob,
            teamId,
            year: 2025,
            month: 6,
            hasSeenCelebration: [bob],
          }),
        )
      }

      await completeProfileFor(ctx, ADA, NAMES, today)

      for (const rowId of staleRows) {
        const row = (await ctx.db.get(rowId))!
        expect(row.playerId).toBe(ada)
        // The winner really changed, so the seen-list resets and the new winner
        // gets their confetti.
        expect(row.hasSeenCelebration).toEqual([])
      }
    })
  })

  test('does not recompute a team the joiner was not invited to', async () => {
    // monthsWithWinners bounds the work, but the recompute must be bounded to
    // the CLAIMED teams too — a team the joiner never joined has no reason to
    // have its stored winner rewritten by someone else's onboarding.
    const t = convexTest(schema, modules)
    await t.run(async (ctx) => {
      const bob = await ctx.db.insert('players', aPlayer({ email: 'bob@example.test' }))
      const charles = await ctx.db.insert('players', aPlayer({ email: 'charles@example.test' }))
      const teamId = await ctx.db.insert(
        'teams',
        aTeam({ playerIds: [bob, charles], creator: bob, invited: [] }),
      )
      // Same fixed past month as the test above, for the same reason: nothing
      // here should depend on when it runs.
      await ctx.db.insert('dailyScores', aScore(charles, '2025-06-03', ['SPEED']))
      // Deliberately wrong: Charles would win a recompute. Nothing here should
      // run one.
      const winnerRow = await ctx.db.insert('monthlyWinners', {
        playerId: bob,
        teamId,
        year: 2025,
        month: 6,
        hasSeenCelebration: [bob],
      })

      await completeProfileFor(ctx, ADA, NAMES, today)

      expect((await ctx.db.get(winnerRow))!.playerId).toBe(bob)
    })
  })
})

describe('completeProfileFor validation', () => {
  test('refuses an empty first or last name', async () => {
    // v.string() accepts '' and Convex has no minLength, so the schema requires
    // these fields to be PRESENT but cannot require them to be NON-EMPTY. A
    // blank-named player reaches the scoreboard, the team card and the winner
    // computation, where it can win a month. This check is what holds that line.
    const t = convexTest(schema, modules)
    await t.run(async (ctx) => {
      await expect(
        completeProfileFor(ctx, ADA, { firstName: '', lastName: 'Lovelace' }, today),
      ).rejects.toMatchObject({ data: { code: 'INVALID_NAME' } })
      await expect(
        completeProfileFor(ctx, ADA, { firstName: 'Ada', lastName: '' }, today),
      ).rejects.toMatchObject({ data: { code: 'INVALID_NAME' } })

      expect(await ctx.db.query('players').collect()).toHaveLength(0)
    })
  })

  test('refuses a whitespace-only name', async () => {
    const t = convexTest(schema, modules)
    await t.run(async (ctx) => {
      await expect(
        completeProfileFor(ctx, ADA, { firstName: '   ', lastName: '\t\n' }, today),
      ).rejects.toMatchObject({ data: { code: 'INVALID_NAME' } })

      expect(await ctx.db.query('players').collect()).toHaveLength(0)
    })
  })

  test('accepts a padded name and STORES IT TRIMMED', async () => {
    // The outer trim is not redundant with isCompleteName's internal one.
    // isCompleteName trims to JUDGE raw client state — lib/invite.ts's doc
    // explains why its other intended consumer, a form's canSubmit predicate,
    // must count ' Ada ' as complete — and it returns a verdict, never a
    // value. Only this call site decides what is written, so without it the row
    // holds ' Ada ' and every initial, sort and greeting inherits the padding.
    const t = convexTest(schema, modules)
    await t.run(async (ctx) => {
      const playerId = await completeProfileFor(
        ctx,
        ADA,
        { firstName: '  Ada  ', lastName: '\tLovelace\n' },
        today,
      )

      const player = (await ctx.db.get(playerId))!
      expect(player.firstName).toBe('Ada')
      expect(player.lastName).toBe('Lovelace')
    })
  })

  test('refuses a today the server clock cannot believe', async () => {
    const t = convexTest(schema, modules)
    await t.run(async (ctx) => {
      await expect(
        completeProfileFor(ctx, ADA, NAMES, '1999-01-01'),
      ).rejects.toMatchObject({ data: { code: 'INVALID_DATE' } })

      expect(await ctx.db.query('players').collect()).toHaveLength(0)
    })
  })

  test('validates before it writes, so a rejected submit claims no invites', async () => {
    const t = convexTest(schema, modules)
    await t.run(async (ctx) => {
      const bob = await ctx.db.insert('players', aPlayer({ email: 'bob@example.test' }))
      const teamId = await ctx.db.insert(
        'teams',
        aTeam({ playerIds: [bob], creator: bob, invited: [ADA] }),
      )

      await expect(
        completeProfileFor(ctx, ADA, { firstName: 'Ada', lastName: ' ' }, today),
      ).rejects.toMatchObject({ data: { code: 'INVALID_NAME' } })

      expect((await ctx.db.get(teamId))!.invited).toEqual([ADA])
      expect((await ctx.db.get(teamId))!.playerIds).toEqual([bob])
    })
  })
})
