import { convexTest } from 'convex-test'
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'
import schema from './schema'
import { aPlayer, aTeam } from './fixtures.ts'
import { getMyTeamsFor } from './teams'
import { unreadBadgeFor } from './chat'
import { internal } from './_generated/api'
import type { DataModel, Id } from './_generated/dataModel'
import type { GenericDatabaseReader, GenericDatabaseWriter, StorageReader } from 'convex/server'

// Mocked for the same reason reminders.test.ts mocks it, and that comment is
// authoritative: nothing here registers the Resend component, and `deliver`
// discards the return value anyway. What this file measures is document counts,
// and the real component's would not be `reminders.ts`'s.
vi.mock('./email.ts', () => ({ sendEmail: vi.fn() }))

/**
 * WHAT AN AUTHENTICATED /app SESSION COSTS TO READ, PER EXECUTION — the GA
 * bandwidth gate of wordle-teams-qix.24, and the measurement wordle-teams-dcu has
 * wanted since Phase 3.
 *
 * WHY DOCUMENT COUNTS AND NOT THE DASHBOARD'S BYTES. qix.24 asks for the Convex
 * dashboard's database-I/O figure. It is not reachable from the CLI — `convex`
 * offers `dashboard` and `logs` and nothing else — so that number needs a human
 * with the dashboard open and belongs on the epic. What a test CAN hold still is
 * the per-execution READ COUNT, and that is the term worth holding: bytes are
 * (documents x row size x executions), and of those three only this one can
 * regress silently in a pull request.
 *
 * WHY A BOUND RATHER THAN A METER, WHICH IS THE REAL ANSWER TO qix.24's WORRY.
 * That note says unreadTeams executions are UNMETERED, so the degraded flag can
 * never trip from badge traffic and the meter reads healthy while the quota
 * drains. That is correct, and it CANNOT BE FIXED BY METERING: a Convex query's
 * `ctx.db` is a GenericDatabaseReader with no write methods, so a query
 * structurally cannot charge chargeBudget's row. chat.ts's header already argues
 * this for its other three query reads. Metering the read path is not a thing
 * that was forgotten; it is a thing the platform forbids.
 *
 * So the guard has to be a BOUNDED PER-EXECUTION COST instead, which turns an
 * unmeasurable meter into a calculable ceiling: sessions x executions x these
 * numbers. Holding these still is what makes that arithmetic trustworthy.
 *
 * EVERY NUMBER BELOW WAS MEASURED, by bisecting `transactionLimits.documentsRead`
 * until the call stopped throwing — the same method scores.test.ts's write-path
 * guard used. Each is asserted from BOTH SIDES: a ceiling alone would pass at any
 * number above the truth and would stop being a measurement.
 */

const modules = import.meta.glob('./**/*.ts')

/** The ceiling teams.ts's own comment cites: six teams, about eight members each. */
const CEILING_TEAMS = 6
const CEILING_MEMBERS = 8

/**
 * MEASURED. Six teams of eight: a six-row teams scan plus one player document per
 * member per team, 6 + 48 = 54.
 */
const ENUMERATION_READS = 54

/** MEASURED. Exactly one document per team, whatever the rosters hold. */
const BADGE_READS_PER_TEAM = 1

async function seedTeams(
  ctx: { db: GenericDatabaseWriter<DataModel> },
  teams: number,
  members: number,
): Promise<{ me: Id<'players'>; teamIds: Id<'teams'>[] }> {
  const me = await ctx.db.insert('players', aPlayer())
  const teamIds: Id<'teams'>[] = []
  for (let t = 0; t < teams; t++) {
    const roster: Id<'players'>[] = [me]
    for (let m = 1; m < members; m++) {
      roster.push(await ctx.db.insert('players', aPlayer({ email: `t${t}m${m}@example.com` })))
    }
    teamIds.push(await ctx.db.insert('teams', aTeam({ playerIds: roster })))
  }
  return { me, teamIds }
}

/**
 * `transactionLimits` IS WHAT MAKES A LIMIT BITE, and it is opt-in.
 * `convexTest(schema, modules)` builds its root metrics layer with
 * `enforce: false`, and `convex-test`'s `index.d.ts` says so plainly — "`false`
 * (default): limits are not enforced". So convex-test's model of the platform
 * caps is not what keeps any test in this repo from throwing; only a passed
 * `transactionLimits` is. Three other suites pass one (grep: scores.test.ts,
 * chat.test.ts, reminders.test.ts) and nothing else in the repo is metered.
 *
 * THE CONFIG IS PER-`t`, SO IT APPLIES TO EVERY TRANSACTION ON IT — each
 * top-level `t.run` / `t.mutation` gets a fresh counter against the same
 * ceiling, seeds included.
 */
/**
 * THE THREE METERS THIS FILE CAN USE — AND THE TWO IT CANNOT, WHICH IS THE MORE
 * INTERESTING HALF. `convex-test` also enforces `documentsWritten` and
 * `bytesWritten` (its `trackWrite` increments both), so "the seeds cost nothing
 * measured", asserted in each block below, is precise only about these three: an
 * insert charges the write meters, by definition.
 *
 * SO WHY DOES A FILE ASSERTING "THIS PASS WRITES NOTHING" NEVER PASS
 * `documentsWritten`? NOT LAZINESS — IT IS UNREACHABLE. Limits are per-`t`, and
 * every `t.run` starts its own root layer against that same config, so an
 * instance strict enough to prove the mutation wrote nothing cannot seed the
 * rows it needs in the first place. The writing half is pinned two other ways
 * instead: by the counters (`weekendFlagsChanged` and `scheduled` are
 * `maintain`'s only two write paths, both asserted at 0 under an exhaustive
 * `toEqual`), and by the read ceilings, since a patch is charged a document
 * read. Adding `documentsWritten` here would not tighten anything; it would
 * break the seeds.
 */
type Limits = {
  documentsRead?: number
  databaseQueries?: number
  functionsScheduled?: number
}
const withLimits = (transactionLimits: Limits) =>
  convexTest({ schema, modules, transactionLimits })

/** Read-only shorthand for the read-path guards below, which meter one thing. */
const withReadLimit = (documentsRead: number) => withLimits({ documentsRead })

/**
 * COUNTS `getUrl` CALLS, because `documentsRead` cannot see them. MEASURED
 * 2026-09-12, against convex-test's own storageGetUrl path and convex's
 * storage_impl.js: `ctx.storage.getUrl` does not touch `trackRead`, so a 6x8
 * roster with an avatar on EVERY member still passes under
 * `withReadLimit(54)` — 48 resolved URLs, zero of them charged. A read
 * ceiling is blind to this call; counting it directly is what is left, and it
 * is the number worth holding anyway: on a real deployment each call is a
 * `_storage` system read on the hottest query in the app (wordle-teams-dcu).
 *
 * THE `{ ...ctx.storage }` SPREAD IS SAFE, not incidental. Production builds
 * `ctx.storage` as a plain object literal of arrow-function properties (see
 * convex's `registration_impl.ts`), not a class with prototype methods, so a
 * shallow spread carries every property forward untouched. That is also what
 * makes this proxy a faithful stand-in for the `ctx.storage` `getMyTeamsFor`
 * actually receives in production, not a test-only shape.
 *
 * COUNTS `getUrl` ONLY, NOT "ANY STORAGE READ". `StorageReader` has exactly
 * one other method, `getMetadata` — itself deprecated in favour of
 * `ctx.db.system.get`, so the gap is small today, not zero. If a later change
 * to `getMyTeamsFor` resolves an avatar through `getMetadata`, or through
 * whatever eventually replaces `getUrl`, that call passes straight through
 * this proxy uncounted and both tests below keep passing while the query
 * quietly costs more. Whoever changes how `getMyTeamsFor` touches storage
 * must extend this helper to match — it is not exhaustive over the interface,
 * only over the one method this feature currently uses.
 */
function countingStorage(ctx: { db: GenericDatabaseReader<DataModel>; storage: StorageReader }) {
  let calls = 0
  return {
    ctx: {
      db: ctx.db,
      storage: {
        ...ctx.storage,
        getUrl: async (id: Id<'_storage'>) => {
          calls++
          return await ctx.storage.getUrl(id)
        },
      },
    },
    get calls() {
      return calls
    },
  }
}

describe('getMyTeamsFor — the enumeration every authenticated session holds', () => {
  /**
   * THE SCAN IS UNAVOIDABLE AND IS NOT WHAT THIS GUARDS. Convex cannot index array
   * membership, so finding a player's teams means reading every team — teams.ts,
   * players.ts and winners.ts all pay it and all say so. What this holds is the
   * SHAPE of the cost: a teams scan plus the rosters, and nothing else. A change
   * that added a per-team message or score read would move it to "scan + rosters +
   * history" with no other gate noticing.
   */
  test(`costs ${ENUMERATION_READS} documents at the six-by-eight ceiling`, async () => {
    await withReadLimit(ENUMERATION_READS).run(async (ctx) => {
      const { me } = await seedTeams(ctx, CEILING_TEAMS, CEILING_MEMBERS)
      expect(await getMyTeamsFor(ctx, me)).toHaveLength(CEILING_TEAMS)
    })
  })

  test('and one fewer read is not enough, so the number is measured not guessed', async () => {
    await expect(
      withReadLimit(ENUMERATION_READS - 1).run(async (ctx) => {
        const { me } = await seedTeams(ctx, CEILING_TEAMS, CEILING_MEMBERS)
        await getMyTeamsFor(ctx, me)
      }),
    ).rejects.toThrow()
  })

  /**
   * IT SCALES WITH MEMBERS, NOT WITH TEAMS ALONE, which is the fact that decides
   * whether the ceiling above is the right one to reason about. Tripling the
   * rosters triples the reads: 6 + 144.
   */
  test('scales with total roster size', async () => {
    await withReadLimit(150).run(async (ctx) => {
      const { me } = await seedTeams(ctx, CEILING_TEAMS, 24)
      await getMyTeamsFor(ctx, me)
    })
    await expect(
      withReadLimit(149).run(async (ctx) => {
        const { me } = await seedTeams(ctx, CEILING_TEAMS, 24)
        await getMyTeamsFor(ctx, me)
      }),
    ).rejects.toThrow()
  })

  /**
   * THE CONDITIONAL, PINNED BY THE ONLY MEANS THAT ACTUALLY SEES IT.
   *
   * A read ceiling cannot notice an unconditional resolve here — see
   * `countingStorage`'s comment for the measurement and the reasoning. Counting
   * `getUrl` calls directly is what is left.
   */
  test('resolves NO storage URL for a roster with no uploaded avatars', async () => {
    const t = convexTest(schema, modules)
    await t.run(async (ctx) => {
      const { me } = await seedTeams(ctx, CEILING_TEAMS, CEILING_MEMBERS)
      const counted = countingStorage(ctx)
      const teams = await getMyTeamsFor(counted.ctx, me)
      expect(teams[0].members[0]).toHaveProperty('image', null)
      expect(counted.calls).toBe(0)
    })
  })

  test('and resolves exactly one per member who HAS uploaded one', async () => {
    const t = convexTest(schema, modules)
    await t.run(async (ctx) => {
      const imageId = await ctx.storage.store(new Blob(['x'], { type: 'image/webp' }))
      const me = await ctx.db.insert('players', aPlayer({ imageId }))
      const mate = await ctx.db.insert('players', aPlayer({ email: 'mate@example.com' }))
      await ctx.db.insert('teams', aTeam({ playerIds: [me, mate] }))
      const counted = countingStorage(ctx)
      await getMyTeamsFor(counted.ctx, me)
      // One member has an avatar, one does not. Two resolves would mean the
      // conditional is gone; zero would mean nothing resolves at all.
      expect(counted.calls).toBe(1)
    })
  })
})

describe('unreadBadgeFor — the live subscription /app holds open', () => {
  /**
   * THE ONE wordle-teams-w7g2 FIXED, AND THIS IS WHAT KEEPS IT FIXED. The badge
   * used to be built on getMyTeamsFor, so it inherited the whole scan plus a
   * document per member — roughly 48 player reads and a table scan to answer a
   * question whose entire output is an array of ids. It now takes the ids the
   * client already holds.
   *
   * qix.24 GUESSED THIS WAS THE DOMINANT COST — "plausibly more than everything
   * chat itself does". MEASURED, IT IS THE OPPOSITE: one document per team against
   * the enumeration's nine per team beside it. The badge is not the problem; the
   * enumeration it sits next to is, and that one predates chat entirely.
   */
  test('costs exactly one document per team', async () => {
    for (const teams of [1, 6, 12]) {
      await withReadLimit(teams * BADGE_READS_PER_TEAM).run(async (ctx) => {
        const { me, teamIds } = await seedTeams(ctx, teams, CEILING_MEMBERS)
        const badge = await unreadBadgeFor(ctx, me, teamIds)
        expect(badge.unread).toEqual([])
        expect(badge.degraded).toBe(false)
      })
    }
  })

  test('and one fewer is not enough at each of those sizes', async () => {
    for (const teams of [6, 12]) {
      await expect(
        withReadLimit(teams * BADGE_READS_PER_TEAM - 1).run(async (ctx) => {
          const { me, teamIds } = await seedTeams(ctx, teams, CEILING_MEMBERS)
          await unreadBadgeFor(ctx, me, teamIds)
        }),
      ).rejects.toThrow()
    }
  })

  /**
   * THE w7g2 REGRESSION, STATED AS A PROPERTY. If the badge ever enumerates
   * members again this is the test that fails: same team count, rosters three
   * times larger, identical budget.
   */
  test('does not grow with team SIZE, only with team COUNT', async () => {
    await withReadLimit(CEILING_TEAMS * BADGE_READS_PER_TEAM).run(async (ctx) => {
      const { me, teamIds } = await seedTeams(ctx, CEILING_TEAMS, 24)
      expect(await unreadBadgeFor(ctx, me, teamIds)).toMatchObject({ unread: [] })
    })
  })
})

/**
 * WHAT A REMINDER COSTS PER EXECUTION (wordle-teams-spcu).
 *
 * The claim the whole per-player scheduling change rests on is a cost claim, so
 * it gets a test. Same method as the read-path guards above — bisect
 * `transactionLimits` until the call stops throwing, and assert FROM BOTH
 * SIDES, because a ceiling alone would pass at any number above the truth.
 *
 * WHY DOCUMENT COUNTS AND NOT THE DASHBOARD'S BYTES: this file's header has the
 * argument and it applies unchanged. The document count is also the term this
 * change exists to cut — the deleted hourly `sweep` opened with
 * `ctx.db.query('players').collect()` on every one of 720 monthly runs. If
 * `deliver` ever collects a table again, the ceilings below fail.
 *
 * THREE PROPERTIES OF `convex-test`'s METER THAT EVERY NUMBER BELOW DEPENDS ON,
 * each measured in this session rather than read off a doc:
 *
 *  1. `trackRead` fires per document YIELDED, not per query. An index range
 *     that matches nothing costs zero documents (it still costs one
 *     `databaseQueries`).
 *  2. A `ctx.db.get` is metered as BOTH one document and one index range; a
 *     `ctx.db.patch` is metered as one document READ plus one write, because
 *     convex-test's `1.0/shallowMerge` reads the row before merging. So a patch
 *     costs a read here, which is what makes the maintenance read ceilings
 *     below double as write guards. Whether a deployed Convex backend charges
 *     the same read for a patch is not something this repo has verified; what
 *     these tests hold still is convex-test's meter.
 *  3. THE SEEDS COST NOTHING MEASURED, which is the only reason a ceiling here
 *     is attributable to the mutation at all — `1.0/insert` calls `trackWrite`
 *     and nothing else. Each block opens with the test that holds that, rather
 *     than leaving it to this paragraph.
 */
describe('reminder delivery bandwidth', () => {
  const DUE = new Date('2026-09-11T14:00:00Z').getTime() // 09:00 Friday in Chicago

  // THE CLOCK IS PINNED, and this block cannot be made deterministic without
  // it — see the same note on reminders.test.ts's `deliver` block, which is
  // authoritative. The short version: `deliver` reads `Date.now()`, and the
  // local day it derives from it decides which `dailyScores` rows the two index
  // lookups match. Under a real clock the fixture's boards fall out of the
  // activity window the day after this is written, the run takes the 'inactive'
  // path instead, and the read count is a different number.
  beforeEach(() => {
    vi.stubEnv('REMINDERS_ENABLED', 'true')
    vi.stubEnv('REMINDERS_ALLOWLIST', '')
    vi.stubEnv('SITE_URL', 'https://example.com')
    vi.useFakeTimers()
    vi.setSystemTime(new Date(DUE))
  })
  afterEach(() => {
    vi.useRealTimers()
    vi.unstubAllEnvs()
  })

  /**
   * MORE THAN ONE ROW, AND THAT IS A REQUIREMENT RATHER THAN A DETAIL. The
   * recent-activity lookup is a `.first()`, so it yields one document whatever
   * this holds — which means with a SINGLE board `.collect()` would also yield
   * one, and a widened lookup would stop being caught while every ceiling in
   * this block stayed green. Measured, not reasoned: reduced to one day, the
   * `.first()` -> `.collect()` mutant survives all 42 tests, and the reduction
   * itself is silent.
   *
   * The days are inside `activityFloor(DUE's local day)`..`DUE's local day` and
   * none of them IS that day, which is what keeps this fixture on the delivered
   * path rather than the already-entered one.
   */
  const ACTIVITY_BOARDS = ['2026-09-08', '2026-09-09', '2026-09-10']

  async function aScheduledPlayer(t: ReturnType<typeof convexTest>, over = {}) {
    return await t.run(async (ctx) => {
      const playerId = await ctx.db.insert(
        'players',
        aPlayer({
          timeZone: 'America/Chicago',
          reminderDeliveryTime: '09:00:00',
          reminderDeliveryMethods: ['email'],
          playsWeekends: true,
          nextReminderAt: DUE,
          ...over,
        }),
      )
      for (const puzzleDay of ACTIVITY_BOARDS) {
        await ctx.db.insert('dailyScores', { playerId, puzzleDay, date: 0, guesses: ['xxxxx'] })
      }
      return playerId
    })
  }

  /**
   * The same player, with today's board already in. `ENTERED_TODAY` has to be
   * `DUE`'s local day in Chicago or the row lands outside the lookup this
   * fixture exists to make match.
   *
   * TWO ROWS FOR THAT ONE DAY, AND THE SECOND IS DEGENERATE ON PURPOSE — the
   * same requirement `ACTIVITY_BOARDS` carries, for the other lookup. With a
   * single matching row `.collect()` would yield one too, leaving the
   * per-document charge of THAT lookup unmeasurable. Real data would not hold a
   * pair, so this is a measuring instrument and nothing asserts what the rows
   * mean — only, in the fixture-freeness test below, that there is more than
   * one of them.
   */
  const ENTERED_TODAY = '2026-09-11' // DUE's local day in Chicago
  const ENTERED_TODAY_BOARDS = [['xxxxx'], ['yyyyy']]

  async function anEnteredPlayer(t: ReturnType<typeof convexTest>) {
    const playerId = await aScheduledPlayer(t)
    await t.run(async (ctx) => {
      for (const guesses of ENTERED_TODAY_BOARDS) {
        await ctx.db.insert('dailyScores', {
          playerId,
          puzzleDay: ENTERED_TODAY,
          date: 0,
          guesses,
        })
      }
    })
    return playerId
  }

  /**
   * THE GUARD ON EVERY GUARD BELOW. A `transactionLimits` config applies to
   * every transaction on its `t`, so a ceiling is only attributable to the
   * mutation while the fixture that precedes it is free. It is, and this is
   * what says so rather than the header's word for it: insert is the only
   * syscall the seed makes, and convex-test charges an insert a write and
   * nothing else. Add a `patch` or a query here and the numbers below move
   * without any of them failing.
   */
  test('the fixtures themselves cost nothing metered', async () => {
    const free = { documentsRead: 0, databaseQueries: 0, functionsScheduled: 0 }
    await expect(aScheduledPlayer(withLimits(free))).resolves.toBeDefined()
    await expect(anEnteredPlayer(withLimits(free))).resolves.toBeDefined()
  })

  /**
   * FREE, AND THE ONLY THING STOPPING EITHER LIST BEING QUIETLY REDUCED. Both
   * ceilings that depend on a `.first()` yielding fewer documents than the
   * matching rows are only measurements while more than one row matches — see
   * each list's own comment. This costs no meter and no fixture.
   */
  test('both row-count requirements the ceilings rest on still hold', () => {
    expect(ACTIVITY_BOARDS.length).toBeGreaterThan(1)
    expect(ENTERED_TODAY_BOARDS.length).toBeGreaterThan(1)
    expect(ACTIVITY_BOARDS).not.toContain(ENTERED_TODAY)
  })

  /**
   * MEASURED BY BISECTION, and written as an enumeration because a figure that
   * does not match a named list of documents is not a measurement. The
   * delivered path, one line per charge:
   *
   *   1. `deliver`'s own `ctx.db.get(playerId)`                      1 doc, 1 range
   *   2. entered-today: an index range that yields NO document — the
   *      player has not entered today, which is why they are due     0 docs, 1 range
   *   3. recent-activity: an index range yielding ONE document —
   *      `.first()` stops there, and the fixture holds THREE boards in
   *      the window on purpose, so a `.collect()` regression reads
   *      more than one and breaches this                             1 doc,  1 range
   *   4. `ctx.db.patch(playerId, { lastBoardEntryReminder })`        1 doc,  0 ranges
   *   5. `scheduleNextFor`'s own `ctx.db.get(playerId)` — the second
   *      read of the same row, which Task 3 kept deliberately so
   *      that helper contains no cancel call                         1 doc, 1 range
   *   6. `scheduleNextFor`'s `ctx.db.patch` of the new job and instant 1 doc, 0 ranges
   *
   * RETIRED: 3 and then 2, neither measured. Both were short the two patches
   * (property 2 in this block's header); the 2 also forgot line 5.
   */
  const DELIVER_READS = 5
  const DELIVER_QUERIES = 4

  test(`delivering reads exactly ${DELIVER_READS} documents`, async () => {
    const t = withLimits({ documentsRead: DELIVER_READS })
    const playerId = await aScheduledPlayer(t)

    await expect(
      t.mutation(internal.reminders.deliver, { playerId, dueAt: DUE }),
    ).resolves.toMatchObject({ delivered: true, reason: 'sent' })
  })

  test(`and ${DELIVER_READS - 1} is not enough, so the number is measured not bounded`, async () => {
    const t = withLimits({ documentsRead: DELIVER_READS - 1 })
    const playerId = await aScheduledPlayer(t)

    await expect(t.mutation(internal.reminders.deliver, { playerId, dueAt: DUE })).rejects.toThrow(
      /Scanned too many documents/,
    )
  })

  /**
   * A SEPARATE METER, AND THE ONE THAT CATCHES A RE-INTRODUCED COLLECT. A
   * `collect()` over a small table costs few documents but always one range, so
   * a regression that swapped an index lookup for a scan of a two-row table
   * could slip under `DELIVER_READS` and not under this.
   */
  test(`delivering runs exactly ${DELIVER_QUERIES} index ranges`, async () => {
    const t = withLimits({ databaseQueries: DELIVER_QUERIES })
    const playerId = await aScheduledPlayer(t)

    await expect(
      t.mutation(internal.reminders.deliver, { playerId, dueAt: DUE }),
    ).resolves.toMatchObject({ delivered: true, reason: 'sent' })
  })

  test(`and ${DELIVER_QUERIES - 1} index ranges is not enough`, async () => {
    const t = withLimits({ databaseQueries: DELIVER_QUERIES - 1 })
    const playerId = await aScheduledPlayer(t)

    await expect(t.mutation(internal.reminders.deliver, { playerId, dueAt: DUE })).rejects.toThrow(
      /Too many index ranges read/,
    )
  })

  /**
   * ONE JOB: tomorrow's reminder. This is the number that makes the chain O(1)
   * per player per day rather than fanning out.
   */
  test('delivering to an email player schedules exactly one follow-on job', async () => {
    const t = withLimits({ functionsScheduled: 1 })
    const playerId = await aScheduledPlayer(t)

    await expect(
      t.mutation(internal.reminders.deliver, { playerId, dueAt: DUE }),
    ).resolves.toMatchObject({ delivered: true, reason: 'sent' })
  })

  test('and it does schedule one — zero is not enough', async () => {
    const t = withLimits({ functionsScheduled: 0 })
    const playerId = await aScheduledPlayer(t)

    await expect(t.mutation(internal.reminders.deliver, { playerId, dueAt: DUE })).rejects.toThrow(
      /Scheduled too many functions/,
    )
  })

  /**
   * PUSH ADDS EXACTLY ONE, AND THE DELIVERY METHODS ARE THE ONLY FIXTURE FIELD
   * THAT MOVES IT. Every other fixture in this block is `['email']`, so without
   * this pair the fan-out per method is a constant nothing varies — and push is
   * the method that enqueues rather than sends. Two: `pushSend.deliverTo` plus
   * the chain's own next link.
   */
  test('adding push schedules exactly one more', async () => {
    const t = withLimits({ functionsScheduled: 2 })
    const playerId = await aScheduledPlayer(t, { reminderDeliveryMethods: ['email', 'push'] })

    await expect(
      t.mutation(internal.reminders.deliver, { playerId, dueAt: DUE }),
    ).resolves.toMatchObject({ delivered: true, reason: 'sent' })
  })

  test('and one is not enough once push is on', async () => {
    const t = withLimits({ functionsScheduled: 1 })
    const playerId = await aScheduledPlayer(t, { reminderDeliveryMethods: ['email', 'push'] })

    await expect(t.mutation(internal.reminders.deliver, { playerId, dueAt: DUE })).rejects.toThrow(
      /Scheduled too many functions/,
    )
  })

  /**
   * THE SKIP PATH IS CHEAPER THAN THE DELIVERED ONE, AND THIS IS THE ONLY
   * FIXTURE WHERE THE ENTERED-TODAY LOOKUP MATCHES ANYTHING. Every other
   * fixture in this block is a due player, who by definition has not entered
   * today — so without this the lookup's yield is a constant zero and its
   * per-document charge is unmeasured.
   *
   *   1. `deliver`'s own `ctx.db.get(playerId)`                      1 doc, 1 range
   *   2. entered-today, now yielding ONE document                    1 doc, 1 range
   *   3. `scheduleNextFor`'s `ctx.db.get(playerId)`                  1 doc, 1 range
   *   4. `scheduleNextFor`'s `ctx.db.patch`                          1 doc, 0 ranges
   *   -> 4 documents, 3 index ranges, 1 job.
   *
   * The recent-activity range and the `lastBoardEntryReminder` patch are the
   * two the delivered path adds on top; the chain still costs its one
   * reschedule, which is the property that makes every skip path safe — and
   * all three of those numbers are asserted from both sides, because a
   * one-sided ceiling is not a measurement.
   */
  const ALREADY_ENTERED_READS = 4
  const ALREADY_ENTERED_QUERIES = 3

  test(`a player who has already entered costs ${ALREADY_ENTERED_READS} documents`, async () => {
    const t = withLimits({ documentsRead: ALREADY_ENTERED_READS })
    const playerId = await anEnteredPlayer(t)

    await expect(
      t.mutation(internal.reminders.deliver, { playerId, dueAt: DUE }),
    ).resolves.toMatchObject({ delivered: false, reason: 'already-entered' })
  })

  test(`and ${ALREADY_ENTERED_READS - 1} is not enough`, async () => {
    const t = withLimits({ documentsRead: ALREADY_ENTERED_READS - 1 })
    const playerId = await anEnteredPlayer(t)

    await expect(t.mutation(internal.reminders.deliver, { playerId, dueAt: DUE })).rejects.toThrow(
      /Scanned too many documents/,
    )
  })

  test(`that skip runs ${ALREADY_ENTERED_QUERIES} index ranges — one fewer than delivering`, async () => {
    const t = withLimits({ databaseQueries: ALREADY_ENTERED_QUERIES })
    const playerId = await anEnteredPlayer(t)

    await expect(
      t.mutation(internal.reminders.deliver, { playerId, dueAt: DUE }),
    ).resolves.toMatchObject({ reason: 'already-entered' })
  })

  test(`and ${ALREADY_ENTERED_QUERIES - 1} index ranges is not enough`, async () => {
    const t = withLimits({ databaseQueries: ALREADY_ENTERED_QUERIES - 1 })
    const playerId = await anEnteredPlayer(t)

    await expect(t.mutation(internal.reminders.deliver, { playerId, dueAt: DUE })).rejects.toThrow(
      /Too many index ranges read/,
    )
  })

  test('and the skip still schedules its one job, which is what keeps the chain alive', async () => {
    const t = withLimits({ functionsScheduled: 1 })
    const playerId = await anEnteredPlayer(t)

    await expect(
      t.mutation(internal.reminders.deliver, { playerId, dueAt: DUE }),
    ).resolves.toMatchObject({ reason: 'already-entered' })

    const t2 = withLimits({ functionsScheduled: 0 })
    const playerId2 = await anEnteredPlayer(t2)

    await expect(
      t2.mutation(internal.reminders.deliver, { playerId: playerId2, dueAt: DUE }),
    ).rejects.toThrow(/Scheduled too many functions/)
  })

  /**
   * A SUPERSEDED JOB IS NEARLY FREE, which is what makes a leftover job a
   * non-event rather than a cost. The staleness guard runs before anything
   * else, so the job costs its one `ctx.db.get` and stops: no `dailyScores`
   * lookup, no patch, no reschedule.
   *
   * `databaseQueries: 1` IS WHAT SAYS "NO `dailyScores` LOOKUP", and the
   * document ceiling cannot: an index range that matches nothing yields no
   * document, so a lookup reinstated above the guard would cost zero reads and
   * be invisible to `documentsRead: 1` alone.
   *
   * SEEDED AS A MISMATCHED INSERT RATHER THAN A PATCH, deliberately. A patch
   * would charge the seed a document read (property 2 above) and the
   * `documentsRead: 0` half below would then be measuring the fixture.
   */
  test('a superseded job reads one document, asks one index range, schedules nothing', async () => {
    const t = withLimits({ documentsRead: 1, databaseQueries: 1, functionsScheduled: 0 })
    const playerId = await aScheduledPlayer(t, { nextReminderAt: DUE + 3600_000 })

    await expect(
      t.mutation(internal.reminders.deliver, { playerId, dueAt: DUE }),
    ).resolves.toMatchObject({ delivered: false, reason: 'superseded' })
  })

  test('and that one document is read, so the guard is reached not skipped', async () => {
    const t = withLimits({ documentsRead: 0 })
    const playerId = await aScheduledPlayer(t, { nextReminderAt: DUE + 3600_000 })

    await expect(t.mutation(internal.reminders.deliver, { playerId, dueAt: DUE })).rejects.toThrow(
      /Scanned too many documents/,
    )
  })

  test('and that one index range is asked, so the range ceiling is measured too', async () => {
    const t = withLimits({ databaseQueries: 0 })
    const playerId = await aScheduledPlayer(t, { nextReminderAt: DUE + 3600_000 })

    await expect(t.mutation(internal.reminders.deliver, { playerId, dueAt: DUE })).rejects.toThrow(
      /Too many index ranges read/,
    )
  })
})

describe('reminder maintenance bandwidth', () => {
  const NOW = new Date('2026-09-11T14:00:00Z').getTime()

  beforeEach(() => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date(NOW))
  })
  afterEach(() => {
    vi.useRealTimers()
    // The `console.error` spies the swallowed-breach tests install restore
    // themselves only on the happy path, and vitest.config.ts does not set
    // `restoreMocks`. Without this, one failing assertion leaks a stubbed
    // console into every test after it in this block.
    vi.restoreAllMocks()
  })

  /**
   * THREE FIXTURES, TWO INDEPENDENT FIELDS, AND INSERTS ONLY. `zoned` decides
   * whether a row can ever be scheduled; `chained` whether it currently is. A
   * patch would be charged a document read against the ceiling under test (see
   * this block's header), so the absent `nextReminderAt` is withheld at insert
   * rather than cleared afterwards.
   *
   * `zoned: false, chained: true` IS NOT A REACHABLE ROW and nothing here asks
   * for it: `scheduleNextFor` returns before scheduling when `timeZone` is
   * absent, so nothing can give a zoneless row an instant.
   *
   * EVERY FIXTURE IS ALREADY ON THE RIGHT SIDE OF THE WEEKEND DERIVATION
   * (`playsWeekends: true` against weekend-playing teams), so no flag flips and
   * no fixture patches. That is steady state for the zoneless table too — the
   * flag derivation sits ABOVE the zone check, so such a table settles its
   * flags in one run and looks like this from the second run on.
   *
   * `reminderDeliveryMethods` IS LEFT AT THE FIXTURE DEFAULT even though the
   * real non-cutover copy also blanks it (scripts/lib/copy-reminder-policy.mjs
   * sends `[]`). `maintain` never reads that field — every READ of it in
   * reminders.ts is inside `deliver`; the grep also returns a line of
   * `scheduleNextFor`'s prose, which is why the claim is about reads and not
   * about matches — so varying it would add a difference between the fixtures
   * that changes nothing.
   */
  async function seedTable(
    t: ReturnType<typeof convexTest>,
    {
      players,
      teams,
      zoned,
      chained,
      flagDerived = true,
      jobbed = false,
    }: {
      players: number
      teams: number
      zoned: boolean
      chained: boolean
      flagDerived?: boolean
      jobbed?: boolean
    },
  ) {
    await t.run(async (ctx) => {
      // A `reminderJobId` CANNOT BE FABRICATED — it is `v.id` of a system table
      // — so the only way to seed one is to schedule a real job. This is the one
      // fixture option that is NOT free, which is why the tests passing
      // `functionsScheduled: 0` leave it off.
      //
      // ONE JOB FOR THE WHOLE TABLE, NOT ONE PER ROW, and every part of that is
      // deliberate. Nothing enforces uniqueness on the field; the per-player
      // lookup this fixture exists to expose still fires for every row, since
      // every row has an id to look up; the seed's cost becomes a CONSTANT 1
      // rather than growing with the table, so a future test combining `jobbed`
      // with a `functionsScheduled` ceiling cannot silently fold `players` seed
      // jobs into its number; and the target can be an argument-free function,
      // which retires a `'' as Id<'players'>` cast that named a player row that
      // did not exist. `maintain` is that function — nothing here ever runs it,
      // and the instant is far enough out that the pinned clock cannot reach it.
      const reminderJobId = jobbed
        ? await ctx.scheduler.runAt(NOW + 10 * 3600_000, internal.reminders.maintain, {})
        : undefined

      const playerIds: Id<'players'>[] = []
      for (let i = 0; i < players; i++) {
        playerIds.push(
          await ctx.db.insert(
            'players',
            aPlayer({
              email: `p${i}@example.com`,
              ...(flagDerived ? { playsWeekends: true } : {}),
              ...(zoned ? { timeZone: 'America/Chicago' } : {}),
              ...(chained ? { nextReminderAt: NOW + 6 * 3600_000 } : {}),
              ...(reminderJobId ? { reminderJobId } : {}),
            }),
          ),
        )
      }
      for (let j = 0; j < teams; j++) {
        await ctx.db.insert('teams', aTeam({ legacyId: 200 + j, playerIds, playWeekends: true }))
      }
    })
  }

  const FIXTURES = [
    { zoned: true, chained: true },
    { zoned: true, chained: false },
    { zoned: false, chained: false },
    { zoned: true, chained: true, flagDerived: false },
    { zoned: true, chained: true, jobbed: true },
  ]

  /**
   * As in the delivery block: the ceilings are the mutation's only while this
   * holds. Every fixture reads nothing and asks nothing.
   */
  test('no fixture in this block reads a document or asks an index range', async () => {
    for (const shape of FIXTURES) {
      const t = withLimits({ documentsRead: 0, databaseQueries: 0 })
      await expect(
        seedTable(t, { players: 3, teams: 2, ...shape }),
        JSON.stringify(shape),
      ).resolves.toBeUndefined()
    }
  })

  /**
   * THE ONE EXCEPTION, MEASURED RATHER THAN DISCLOSED — AND SIZE-INDEPENDENT,
   * which is what makes it safe to combine with a `functionsScheduled` ceiling.
   * `jobbed` schedules ONE job for the whole table however many rows it holds,
   * so a test that uses it pays a constant 1 rather than a number that moves
   * with the fixture. Asserted at two sizes and from both sides.
   */
  test('only the jobbed fixture schedules, and exactly once whatever the size', async () => {
    for (const shape of FIXTURES.filter((f) => !f.jobbed)) {
      const t = withLimits({ functionsScheduled: 0 })
      await expect(
        seedTable(t, { players: 3, teams: 2, ...shape }),
        `${JSON.stringify(shape)} must schedule nothing`,
      ).resolves.toBeUndefined()
    }

    for (const players of [3, 6]) {
      await expect(
        seedTable(withLimits({ functionsScheduled: 1 }), {
          players,
          teams: 2,
          zoned: true,
          chained: true,
          jobbed: true,
        }),
        `${players} players, one shared job`,
      ).resolves.toBeUndefined()

      await expect(
        seedTable(withLimits({ functionsScheduled: 0 }), {
          players,
          teams: 2,
          zoned: true,
          chained: true,
          jobbed: true,
        }),
        `${players} players, and that one job is really scheduled`,
      ).rejects.toThrow(/Scheduled too many functions/)
    }
  })

  /**
   * THE COST MODEL THIS WHOLE BLOCK ARGUES, NAMED ONCE: every maintenance
   * ceiling below is SCAN + WORK. The scan is the two collects — one document
   * per row and one index range each — and it is the only part that is paid
   * unconditionally. Everything after it is per-player work, and in steady
   * state there is none, which is the claim the pass exists to support.
   *
   * The `REPAIR_*` and `FLIP_*` constants further down are the work terms.
   * Before these existed the scan appeared in four spellings across the block
   * and one of them, `players + 1`, sat next to repair tests that went through
   * a helper — the same number, written three ways, in tests whose entire
   * subject is that the number is exact.
   */
  const SCAN_READS = (players: number, teams: number) => players + teams
  const SCAN_QUERIES = 2

  /**
   * THE EXHAUSTIVE RETURN OF A HEALTHY PASS, and `toEqual` rather than
   * `toMatchObject` on purpose. Two of these zeroes are the reason:
   *
   *  - `failed: 0`. A pass in which EVERY player's work threw returns
   *    `scheduled: 0, weekendFlagsChanged: 0, deferred: 0` as well, because the
   *    per-player `try` swallows it. The test two below reaches that state and
   *    asserts it. A subset match on the first three fields would call it
   *    healthy.
   *  - `zoneless: 0`. See the all-zoneless test that follows.
   */
  const HEALTHY_PASS = {
    players: 3,
    teams: 2,
    weekendFlagsChanged: 0,
    scheduled: 0,
    deferred: 0,
    zoneless: 0,
    failed: 0,
  }

  /**
   * IN STEADY STATE THIS PASS WRITES AND SCHEDULES NOTHING, which is the
   * statement that the 82 MB/month floor is gone rather than moved. It still
   * READS both tables every run — a daily full scan is the deliberate price of
   * the self-healing property, and at 30 runs a month rather than 720 it is
   * under 4 MB — but if it starts rescheduling healthy players it is churning
   * ~393 rows a day and this fails.
   *
   * `functionsScheduled: 0` METERS THE SCHEDULING HALF; the counters meter the
   * writing half, and the read ceiling below covers a write the counters would
   * miss, since a patch is charged a document read. Note what the meter cannot
   * do here: `maintain`'s per-player `try` catches a limit breach, so this
   * ceiling reports `failed`, it does not throw. `toEqual` is what reads it.
   */
  test('does no work when every chain is healthy', async () => {
    const t = withLimits({ functionsScheduled: 0 })
    await seedTable(t, { players: 3, teams: 2, zoned: true, chained: true })

    await expect(t.mutation(internal.reminders.maintain, {})).resolves.toEqual(HEALTHY_PASS)
  })

  /**
   * THE STATE THE TEST ABOVE WOULD OTHERWISE CALL HEALTHY. A table where every
   * row has lost its `timeZone` is unschedulable in full, and before `zoneless`
   * existed its return was byte-identical to the healthy one — so the assertion
   * that carries this change's headline claim passed just as happily on the
   * worst outcome the cutover has.
   *
   * IT IS THE CUTOVER'S ACTUAL FAILURE MODE, not a contrived one:
   * scripts/lib/copy-reminder-policy.mjs withholds `timeZone` on every copy
   * except the one passing `--with-reminders`, so getting that flag wrong on
   * the final copy produces this table exactly.
   *
   * WRITTEN AS `{ ...HEALTHY_PASS, zoneless: 3 }` so the claim is structural:
   * one field, and one field only, tells the two apart.
   */
  test('an all-zoneless table returns the healthy shape in every field but zoneless', async () => {
    const t = withLimits({ functionsScheduled: 0 })
    await seedTable(t, { players: 3, teams: 2, zoned: false, chained: false })

    await expect(t.mutation(internal.reminders.maintain, {})).resolves.toEqual({
      ...HEALTHY_PASS,
      zoneless: 3,
    })
  })

  /**
   * THE SECOND STATE THE HEADLINE ASSERTION WOULD OTHERWISE CALL HEALTHY, and
   * the reason `HEALTHY_PASS` is a `toEqual` and not a `toMatchObject` on three
   * fields. A pass in which every single player's work threw reports
   * `weekendFlagsChanged: 0, scheduled: 0, deferred: 0` — all three of the
   * counters a subset match would look at — and says so only in `failed`.
   *
   * REACHED HERE BY A CEILING EXACTLY AT THE SCAN COST: the two collects fit,
   * so the pass starts; every row then needs repairing and every repair
   * breaches inside the per-player `try`, which logs and carries on. Nothing
   * about the shape depends on the breach being the cause — a permanent throw
   * from any per-player work produces it, which is the case `maintain`'s own
   * doc comment exists for.
   *
   * SAME SPECIES AS THE ALL-ZONELESS STATE, DIFFERENT FIELD. That one is
   * separated by `zoneless`, this one by `failed`, and neither is separable
   * without reading the field.
   */
  test('a pass in which every row threw is not a quiet pass', async () => {
    const t = withLimits({ documentsRead: SCAN_READS(3, 2) })
    await seedTable(t, { players: 3, teams: 2, zoned: true, chained: false })
    vi.spyOn(console, 'error').mockImplementation(() => {})

    await expect(t.mutation(internal.reminders.maintain, {})).resolves.toEqual({
      ...HEALTHY_PASS,
      failed: 3,
    })
  })

  /**
   * ONE DOCUMENT PER ROW AND NOTHING ELSE — the two collects, and no per-player
   * read on top. This is the ceiling that guards the absence `maintain`'s THE
   * ROW ONLY, NEVER `_scheduled_functions` paragraph argues for. Two shapes are
   * mutation-tested against it: a `ctx.db.get` per player, and the specific
   * `ctx.db.system.get(player.reminderJobId)` that paragraph rejects. And
   * because a patch is charged a read, the same ceiling catches an
   * unconditional write the counters would not report.
   *
   * `jobbed: true` IS WHAT MAKES THE SECOND OF THOSE REACHABLE, and without it
   * the guard was decorative: a lookup guarded by `if (player.reminderJobId)`
   * never fires on a fixture that has none, so it survived the whole file.
   * System reads ARE metered — measured, one document and one range, the same
   * as any `ctx.db.get`. It was the fixture, not the meter.
   *
   * PLAYERS AND TEAMS ARE VARIED INDEPENDENTLY, which is the whole point of the
   * table. Every fixture here used to hold one team per player, and `players +
   * teams` is indistinguishable from `2 x players` until they differ.
   */
  const SHAPES = [
    { players: 3, teams: 1 },
    { players: 1, teams: 3 },
    { players: 4, teams: 2 },
  ]

  test('a healthy pass reads exactly one document per row', async () => {
    for (const { players, teams } of SHAPES) {
      const t = withLimits({ documentsRead: SCAN_READS(players, teams) })
      await seedTable(t, { players, teams, zoned: true, chained: true, jobbed: true })

      await expect(t.mutation(internal.reminders.maintain, {})).resolves.toMatchObject({
        players,
        teams,
        scheduled: 0,
        failed: 0,
      })
    }
  })

  test('and one document fewer is not enough at any shape', async () => {
    for (const { players, teams } of SHAPES) {
      const t = withLimits({ documentsRead: SCAN_READS(players, teams) - 1 })
      await seedTable(t, { players, teams, zoned: true, chained: true, jobbed: true })

      // THROWS RATHER THAN REPORTING `failed`, and that is structural: both
      // collects sit OUTSIDE the per-player `try`, so a breach reading them
      // aborts the whole pass. See `maintain`'s BOTH COLLECTS SIT OUTSIDE
      // paragraph.
      await expect(
        t.mutation(internal.reminders.maintain, {}),
        `${players} players, ${teams} teams`,
      ).rejects.toThrow(/Scanned too many documents/)
    }
  })

  /**
   * TWO INDEX RANGES, WHATEVER THE ROW COUNT — one per collect, and the claim
   * this meter can make that the read meter cannot: it is SIZE-INDEPENDENT. The
   * read ceiling grows with the table, so "one document per row" has to be
   * restated at every shape; two ranges is the same number at one player and at
   * six, which states "the per-player path asks the database nothing" once and
   * for all sizes.
   */
  test('a healthy pass runs exactly two index ranges at any size', async () => {
    for (const players of [1, 6]) {
      const t = withLimits({ databaseQueries: SCAN_QUERIES })
      await seedTable(t, { players, teams: 2, zoned: true, chained: true, jobbed: true })

      await expect(t.mutation(internal.reminders.maintain, {})).resolves.toMatchObject({
        players,
        failed: 0,
      })
    }
  })

  test('and one index range is not enough', async () => {
    const t = withLimits({ databaseQueries: SCAN_QUERIES - 1 })
    await seedTable(t, { players: 3, teams: 2, zoned: true, chained: true, jobbed: true })

    await expect(t.mutation(internal.reminders.maintain, {})).rejects.toThrow(
      /Too many index ranges read/,
    )
  })

  /**
   * WHAT REPAIRING ONE CHAIN COSTS: three documents, on top of the scan. The
   * row through `reschedulePlayerReminderFor`'s own `ctx.db.get`, the same row
   * again through `scheduleNextFor`'s, and the patch that records the new job
   * and instant. So a pass that has to bootstrap the whole table reads
   * `players + teams + 3 x players`, and repair is O(1) per player rather than
   * per anything else.
   *
   * THE DUPLICATE GET IS DELIBERATE (Task 3, so `scheduleNextFor` contains no
   * cancel call). Removing it is a legitimate change that would make this
   * number 2 per player — this test is then the record of what it bought, not
   * an objection to it.
   *
   * THE OTHER TWO METERS ARE CLAIMED AND ASSERTED HERE TOO, both sides: TWO
   * index ranges per repaired player (the two `ctx.db.get`s; the patch asks
   * none) and ONE job. That last is the number that says a repair creates the
   * same single link `deliver` does, rather than fanning out.
   */
  const REPAIR_READS_PER_PLAYER = 3
  const REPAIR_QUERIES_PER_PLAYER = 2
  const REPAIR_JOBS_PER_PLAYER = 1
  const bootstrapReads = (players: number, teams: number) =>
    SCAN_READS(players, teams) + REPAIR_READS_PER_PLAYER * players
  const bootstrapQueries = (players: number) =>
    SCAN_QUERIES + REPAIR_QUERIES_PER_PLAYER * players

  test(`repairing a chain costs ${REPAIR_READS_PER_PLAYER} documents per player`, async () => {
    for (const players of [2, 3]) {
      const t = withLimits({ documentsRead: bootstrapReads(players, 1) })
      // ZONED BUT NOT CHAINED: schedulable rows with no pending instant, which
      // is what `maintain` bootstraps. `zoned: false` would make them
      // unschedulable instead and cost nothing at all.
      await seedTable(t, { players, teams: 1, zoned: true, chained: false })

      await expect(t.mutation(internal.reminders.maintain, {})).resolves.toEqual({
        players,
        teams: 1,
        weekendFlagsChanged: 0,
        scheduled: players,
        deferred: 0,
        zoneless: 0,
        failed: 0,
      })
    }
  })

  test('and one document fewer strands the last player instead of throwing', async () => {
    const players = 3
    const t = withLimits({ documentsRead: bootstrapReads(players, 1) - 1 })
    await seedTable(t, { players, teams: 1, zoned: true, chained: false })
    vi.spyOn(console, 'error').mockImplementation(() => {})

    // THE OTHER SIDE OF THE CEILING, AND IT IS NOT A THROW. The breach happens
    // inside the per-player `try`, which logs and carries on — so the pass
    // reports two repaired and one failed. That is the measurement, and it is
    // also the demonstration of why the healthy assertion above has to read
    // `failed`: a swallowed limit is indistinguishable from a quiet pass in
    // every other field.
    await expect(t.mutation(internal.reminders.maintain, {})).resolves.toMatchObject({
      scheduled: players - 1,
      failed: 1,
    })
  })

  test(`repairing a chain asks ${REPAIR_QUERIES_PER_PLAYER} index ranges per player`, async () => {
    for (const players of [2, 3]) {
      const t = withLimits({ databaseQueries: bootstrapQueries(players) })
      await seedTable(t, { players, teams: 1, zoned: true, chained: false })

      await expect(t.mutation(internal.reminders.maintain, {})).resolves.toMatchObject({
        scheduled: players,
        failed: 0,
      })
    }
  })

  test('and one index range fewer is not enough', async () => {
    for (const players of [2, 3]) {
      const t = withLimits({ databaseQueries: bootstrapQueries(players) - 1 })
      await seedTable(t, { players, teams: 1, zoned: true, chained: false })
      vi.spyOn(console, 'error').mockImplementation(() => {})

      // Swallowed, like the read ceiling: the breach happens inside the
      // per-player `try`, so the last player is stranded rather than the pass
      // aborting.
      await expect(t.mutation(internal.reminders.maintain, {})).resolves.toMatchObject({
        scheduled: players - 1,
        failed: 1,
      })
    }
  })

  test(`repairing a chain schedules ${REPAIR_JOBS_PER_PLAYER} job per player`, async () => {
    for (const players of [2, 3]) {
      const t = withLimits({ functionsScheduled: REPAIR_JOBS_PER_PLAYER * players })
      await seedTable(t, { players, teams: 1, zoned: true, chained: false })

      await expect(t.mutation(internal.reminders.maintain, {})).resolves.toMatchObject({
        scheduled: players,
        failed: 0,
      })
    }
  })

  test('and one job fewer strands the last player', async () => {
    const players = 3
    const t = withLimits({ functionsScheduled: REPAIR_JOBS_PER_PLAYER * players - 1 })
    await seedTable(t, { players, teams: 1, zoned: true, chained: false })
    vi.spyOn(console, 'error').mockImplementation(() => {})

    await expect(t.mutation(internal.reminders.maintain, {})).resolves.toMatchObject({
      scheduled: players - 1,
      failed: 1,
    })
  })

  /**
   * A FLIPPED WEEKEND FLAG COSTS ONE DOCUMENT MORE THAN A BARE REPAIR, and it
   * is the only path in this pass that patches a `players` row outside
   * `scheduleNextFor`. Every other fixture in this block arrives with the flag
   * already derived, so `flipped` is false throughout, `weekendFlagsChanged` is
   * 0 in every other assertion, and the patch branch sits on no metered path at
   * all — a deleted `weekendFlagsChanged += 1` survived the whole file before
   * this.
   *
   * FOUR DOCUMENTS PER PLAYER: the flag patch, then the three a repair costs,
   * because the flip is itself a reason to reschedule (see `maintain`'s THE
   * FLAG IS AN INPUT TO THE SCHEDULE paragraph). The ranges do not move —
   * `players + 2` per player as before — since a patch asks none.
   */
  const FLIP_READS_PER_PLAYER = REPAIR_READS_PER_PLAYER + 1

  test(`a flipped weekend flag costs ${FLIP_READS_PER_PLAYER} documents per player`, async () => {
    const players = 3
    const t = withLimits({ documentsRead: SCAN_READS(players, 1) + FLIP_READS_PER_PLAYER * players })
    await seedTable(t, { players, teams: 1, zoned: true, chained: true, flagDerived: false })

    await expect(t.mutation(internal.reminders.maintain, {})).resolves.toEqual({
      players,
      teams: 1,
      weekendFlagsChanged: players,
      scheduled: players,
      deferred: 0,
      zoneless: 0,
      failed: 0,
    })
  })

  test('and one document fewer strands the last flipped player', async () => {
    const players = 3
    const t = withLimits({
      documentsRead: SCAN_READS(players, 1) + FLIP_READS_PER_PLAYER * players - 1,
    })
    await seedTable(t, { players, teams: 1, zoned: true, chained: true, flagDerived: false })
    vi.spyOn(console, 'error').mockImplementation(() => {})

    // The flag patch lands BEFORE the reschedule, so the stranded player's flag
    // is already changed when its repair breaches — which is `maintain`'s
    // "leaving the flag stale is CHEAP, NOT FREE" case seen from the other side.
    await expect(t.mutation(internal.reminders.maintain, {})).resolves.toMatchObject({
      weekendFlagsChanged: players,
      scheduled: players - 1,
      failed: 1,
    })
  })

  /**
   * THE BUDGET BOUNDS WHAT ONE TRANSACTION SCHEDULES, which is the protection
   * MAINTAIN_SCHEDULE_BUDGET exists for — and the only fixture here that
   * crosses it, since every other one is far below. Passed explicitly because
   * 800 rows is not a table worth seeding to learn that a `>=` holds.
   *
   * NOTE THAT THE BUDGET DEFERS, IT DOES NOT THROW: two rows are left for
   * tomorrow's run, and it is `deferred` that makes a multi-day bootstrap
   * visible.
   */
  test('a budget of one schedules exactly one function and defers the rest', async () => {
    const t = withLimits({ functionsScheduled: 1 })
    await seedTable(t, { players: 3, teams: 1, zoned: true, chained: false })

    await expect(t.mutation(internal.reminders.maintain, { budget: 1 })).resolves.toEqual({
      players: 3,
      teams: 1,
      weekendFlagsChanged: 0,
      scheduled: 1,
      deferred: 2,
      zoneless: 0,
      failed: 0,
    })
  })

  test('and it really does schedule that one — a ceiling of zero refuses every row', async () => {
    const t = withLimits({ functionsScheduled: 0 })
    await seedTable(t, { players: 3, teams: 1, zoned: true, chained: false })
    vi.spyOn(console, 'error').mockImplementation(() => {})

    // Swallowed per player again, so `scheduled` never reaches the budget and
    // nothing is deferred either: three refusals, reported as failures.
    await expect(t.mutation(internal.reminders.maintain, { budget: 1 })).resolves.toMatchObject({
      scheduled: 0,
      deferred: 0,
      failed: 3,
    })
  })
})
