import { convexTest } from 'convex-test'
import { describe, expect, test } from 'vitest'
import schema from './schema'
import { api } from './_generated/api'
import { aPlayer, aTeam, authenticatedAs, makeRegisterBetterAuth } from './fixtures.ts'
import { monthOf, toPuzzleDay, addDays, addMonths } from './lib/puzzleDay.ts'
import type { Id } from './_generated/dataModel'

const registerBetterAuth = makeRegisterBetterAuth(import.meta.glob('./betterAuth/**/*.ts'))
const modules = import.meta.glob('./**/*.ts')

const today = toPuzzleDay(new Date())
const month = monthOf(today)

const ME = 'me@example.com'
const MATE = 'mate@example.com'

/**
 * WHAT teamMonth PUTS ON THE WIRE, PER TIER (wordle-teams-iht.3.2).
 *
 * THIS FILE ASSERTS ON THE RESPONSE, NOT ON WHAT RENDERS, and that distinction
 * is the entire reason it exists rather than another component test. The defect
 * it guards against was invisible to every rendering test in the project: the
 * query returned the whole team month to EVERY member regardless of tier, and
 * the client simply chose a smaller component to draw with it. Nothing looked
 * wrong on screen, and every paid Layer 3 view — head-to-heads, member
 * averages, best and worst days, consistency, trend, most-improved — is a pure
 * function over that payload (src/lib/insights-team.ts), so a free viewer's
 * browser already held everything needed to compute the paid surface. Only a
 * test that reads the payload can see that, and only this one does.
 *
 * IT IS THE REGRESSION TEST FOR A PAYWALL, so it is written to fail LOUDLY on
 * the thing that matters — a total or a second day crossing the boundary —
 * rather than on the exact shape of the object, which is free to change.
 */

/** A month of two players' boards, so there is something real to withhold. */
async function seed(t: ReturnType<typeof convexTest>) {
  return await t.run(async (ctx) => {
    const me = await ctx.db.insert('players', aPlayer({ email: ME }))
    const mate = await ctx.db.insert(
      'players',
      aPlayer({
        legacyId: '33333333-3333-4333-8333-333333333333',
        email: MATE,
        firstName: 'Grace',
      }),
    )
    const teamId = await ctx.db.insert(
      'teams',
      aTeam({ playerIds: [me, mate], owner: me }),
    )

    // THREE DAYS, ONE OF THEM TODAY. Two days that are not today is what makes
    // "only today survives" a real assertion rather than one a single-day
    // fixture would satisfy by accident.
    await ctx.db.insert('teamMonthStats', {
      teamId,
      year: Number(month.slice(0, 4)),
      month: Number(month.slice(5, 7)),
      members: [
        { playerId: me, boards: 3, attempts: 11, solved: 3, failed: 0 },
        { playerId: mate, boards: 3, attempts: 14, solved: 2, failed: 1 },
      ],
      days: [
        {
          puzzleDay: addDays(today, -2),
          entries: [
            { playerId: me, attempts: 4 },
            { playerId: mate, attempts: 5 },
          ],
        },
        {
          puzzleDay: addDays(today, -1),
          entries: [
            { playerId: me, attempts: 3 },
            { playerId: mate, attempts: 6 },
          ],
        },
        {
          puzzleDay: today,
          entries: [
            { playerId: me, attempts: 4 },
            { playerId: mate, attempts: 3 },
          ],
        },
      ],
      computedAt: Date.now(),
    })
    return { me, mate, teamId }
  })
}

/** Makes a player pro — the one thing isProFor reads. */
async function makePro(t: ReturnType<typeof convexTest>, playerId: Id<'players'>) {
  await t.run(async (ctx) => {
    await ctx.db.insert('playerMembership', { playerId, membershipStatus: 'pro' })
  })
}

describe('teamMonth — the free tier', () => {
  test('gets today and nothing else of the month', async () => {
    const t = convexTest(schema, modules)
    registerBetterAuth(t)
    const { teamId } = await seed(t)

    const asMe = await authenticatedAs(t, ME)
    const res = await asMe.query(api.insights.teamMonth, { teamId, month, today })

    expect(res?.access.layer3).toBe('free')
    // THE PAID PAYLOAD IS ABSENT ENTIRELY, not merely smaller. `stats: null` is
    // what makes this fail closed: a future branch that renders the paid panel
    // to the wrong tier gets the empty state rather than the month.
    expect(res?.stats).toBeNull()

    expect(res?.teaser?.days.map((day) => day.puzzleDay)).toEqual([today])
  })

  test('gets NO member totals — the numbers every paid view is built from', async () => {
    const t = convexTest(schema, modules)
    registerBetterAuth(t)
    const { teamId } = await seed(t)

    const asMe = await authenticatedAs(t, ME)
    const res = await asMe.query(api.insights.teamMonth, { teamId, month, today })

    // ASSERTED AS "NO KEY BUT playerId" RATHER THAN "boards IS UNDEFINED",
    // because the second passes just as well against a payload that grew a
    // `totals` or an `attempts` under some other name. This says what may be
    // there, which is the only form of this assertion that keeps meaning the
    // same thing as the schema changes.
    for (const member of res?.teaser?.members ?? []) {
      expect(Object.keys(member)).toEqual(['playerId'])
    }
    expect(res?.teaser?.members).toHaveLength(2)
  })

  test('still gets everything its one free view actually needs', async () => {
    // THE OTHER HALF OF THE PAYWALL, and the hard constraint in the spec:
    // "NOTHING PREVIOUSLY FREE MOVES BEHIND THE PAYWALL" (lib/insightsAccess.ts).
    // dailyTeamFact reads exactly two things — today's entry and how many
    // members there are — so this asserts the free surface can still be
    // computed, not merely that data was removed.
    const t = convexTest(schema, modules)
    registerBetterAuth(t)
    const { me, teamId } = await seed(t)

    const asMe = await authenticatedAs(t, ME)
    const res = await asMe.query(api.insights.teamMonth, { teamId, month, today })

    const day = res?.teaser?.days[0]
    expect(day?.entries).toHaveLength(2)
    expect(day?.entries.find((entry) => entry.playerId === me)?.attempts).toBe(4)
    expect(res?.teaser?.members).toHaveLength(2)
    // And the names the teaser renders rows with, which were never in `stats`.
    expect(res?.roster).toHaveLength(2)
  })

  test('gets the rank headline, which is the one real figure it gains', async () => {
    // THE OTHER SIDE OF THE PAYWALL LEDGER (wordle-teams-iht.3.3). The free tier
    // loses the month and gains a position it could not otherwise compute --
    // the seed puts the viewer on 11 attempts over 3 boards (3.7) against their
    // teammate's 14 (4.7), so they are 1st of 2.
    //
    // IT HAS TO COME FROM THE SERVER: ranking needs every member's totals, and
    // those are exactly what this query now withholds. A client-side rank would
    // undo the gate it sits beside.
    const t = convexTest(schema, modules)
    registerBetterAuth(t)
    const { teamId } = await seed(t)

    const asMe = await authenticatedAs(t, ME)
    const res = await asMe.query(api.insights.teamMonth, { teamId, month, today })

    expect(res?.rank).toEqual({ kind: 'ranked', rank: 1, of: 2 })
    // And it is a CONCLUSION, not an aggregate: nothing in it can be run
    // backwards into the averages it came from.
    expect(Object.keys(res?.rank ?? {}).sort()).toEqual(['kind', 'of', 'rank'])
  })

  // wordle-teams-g03s. `stats` is null for a free member for EVERY month, so a
  // rank computed from a past month's aggregate was a conclusion about numbers
  // the caller is not allowed to see. The current month keeps its rank — that is
  // the free tier's own figure (wordle-teams-iht.3.3) and taking it away would
  // breach "NOTHING PREVIOUSLY FREE MOVES BEHIND THE PAYWALL".
  test('gets NO rank for a past month, whose stats it cannot see either', async () => {
    const t = convexTest(schema, modules)
    registerBetterAuth(t)
    const { me, mate, teamId } = await seed(t)

    // A SECOND AGGREGATE, FOR LAST MONTH, with the viewer genuinely ranked in it
    // — 9 attempts over 3 boards against the mate's 15. Without it this test
    // would pass against the ungated version by accident, since a month with no
    // teamMonthStats row answers `not-played` rather than a rank.
    const lastMonth = addMonths(month, -1)
    await t.run(async (ctx) => {
      await ctx.db.insert('teamMonthStats', {
        teamId,
        year: Number(lastMonth.slice(0, 4)),
        month: Number(lastMonth.slice(5, 7)),
        members: [
          { playerId: me, boards: 3, attempts: 9, solved: 3, failed: 0 },
          { playerId: mate, boards: 3, attempts: 15, solved: 3, failed: 0 },
        ],
        days: [],
        computedAt: Date.now(),
      })
    })

    const asMe = await authenticatedAs(t, ME)
    const res = await asMe.query(api.insights.teamMonth, { teamId, month: lastMonth, today })

    expect(res?.access.layer3).toBe('free')
    expect(res?.stats).toBeNull()
    expect(res?.rank).toBeNull()
  })

  // THE GATE IS AGAINST THE BOUNDED DAY, NOT THE RAW `today`, or it would be
  // self-certifying: a caller wanting last month's rank would simply send last
  // month's `today` alongside it. isPlausibleToday collapses an implausible
  // `today` to the server's own, so the month stops matching and the rank goes.
  test('and cannot buy one back by claiming to be living in that month', async () => {
    const t = convexTest(schema, modules)
    registerBetterAuth(t)
    const { me, mate, teamId } = await seed(t)

    const lastMonth = addMonths(month, -1)
    await t.run(async (ctx) => {
      await ctx.db.insert('teamMonthStats', {
        teamId,
        year: Number(lastMonth.slice(0, 4)),
        month: Number(lastMonth.slice(5, 7)),
        members: [
          { playerId: me, boards: 3, attempts: 9, solved: 3, failed: 0 },
          { playerId: mate, boards: 3, attempts: 15, solved: 3, failed: 0 },
        ],
        days: [],
        computedAt: Date.now(),
      })
    })

    const asMe = await authenticatedAs(t, ME)
    const res = await asMe.query(api.insights.teamMonth, {
      teamId,
      month: lastMonth,
      today: `${lastMonth}-14`,
    })

    expect(res?.rank).toBeNull()
  })

  test('cannot walk the month a day at a time by lying about today', async () => {
    // THE HARVESTING HOLE THIS GATE WOULD OTHERWISE HAVE. `today` is a client
    // fact and has to be taken from the client — a backend that imposed its own
    // would blank the fact for anyone far enough east or west — so it is bounded
    // instead, with the same +/-1 day tolerance requirePlausibleToday uses.
    // Asking for a day outside that falls back to the server's own.
    const t = convexTest(schema, modules)
    registerBetterAuth(t)
    const { teamId } = await seed(t)

    const asMe = await authenticatedAs(t, ME)
    const res = await asMe.query(api.insights.teamMonth, {
      teamId,
      month,
      today: addDays(today, -2),
    })

    expect(res?.teaser?.days.map((day) => day.puzzleDay)).toEqual([today])
  })

  test('but a neighbouring day IS honoured, because timezones are real', async () => {
    const t = convexTest(schema, modules)
    registerBetterAuth(t)
    const { teamId } = await seed(t)

    const asMe = await authenticatedAs(t, ME)
    const res = await asMe.query(api.insights.teamMonth, {
      teamId,
      month,
      today: addDays(today, -1),
    })

    // The day they asked for, not the server's — a player whose clock is a day
    // behind the backend still gets their own puzzle day's fact.
    expect(res?.teaser?.days.map((day) => day.puzzleDay)).toEqual([addDays(today, -1)])
  })
})

describe('teamMonth — pro', () => {
  test('gets the whole month, totals and all, exactly as before', async () => {
    const t = convexTest(schema, modules)
    registerBetterAuth(t)
    const { me, teamId } = await seed(t)
    await makePro(t, me)

    const asMe = await authenticatedAs(t, ME)
    const res = await asMe.query(api.insights.teamMonth, { teamId, month, today })

    expect(res?.access.layer3).toBe('full')
    expect(res?.teaser).toBeNull()
    expect(res?.stats?.days).toHaveLength(3)
    expect(res?.stats?.members).toHaveLength(2)
    // The totals the free tier does not get, present here in full.
    expect(res?.stats?.members.map((member) => member.attempts).sort()).toEqual([11, 14])
    // NO RANK FOR PRO, because it is a teaser for a panel they already have
    // whole -- memberAverages tells them the same thing and more.
    expect(res?.rank).toBeNull()
  })
})

describe('teamMonth — a trial', () => {
  test('is treated as pro, which is the trap an isPro gate would fall into', async () => {
    // insightsAccess grants a trialist layer3 'full' while leaving them 'free'
    // on layer1. A payload gate written as "is a paying customer" would take the
    // team surface away from every trialist — during the one window the product
    // is trying to convert them.
    const t = convexTest(schema, modules)
    registerBetterAuth(t)
    const { me, teamId } = await seed(t)
    await t.run(async (ctx) => {
      await ctx.db.patch(me, { insightsTrialEndsAt: Date.now() + 86_400_000 })
    })

    const asMe = await authenticatedAs(t, ME)
    const res = await asMe.query(api.insights.teamMonth, { teamId, month, today })

    expect(res?.access.trialActive).toBe(true)
    expect(res?.stats?.days).toHaveLength(3)
    expect(res?.teaser).toBeNull()
  })

  // THE RANK GATE ABOVE BINDS THE FREE TIER ONLY, AND THIS IS WHERE THAT IS
  // PINNED (wordle-teams-g03s). `hasFullTeamMonth` includes `trialActive`, so a
  // trialist never reaches that branch: they get `stats` whole for any month and
  // lib/insights-team.ts computes their standing on the client. Nothing here
  // could withhold that without withholding `stats`, and the spec's §4 ("The
  // trial does not widen this window") accepts the resulting trial/pro seam in
  // those words. If someone ever "fixes" that seam, this test says what breaks.
  test('keeps a past month whole, so its standing survives a gate the free tier meets', async () => {
    const t = convexTest(schema, modules)
    registerBetterAuth(t)
    const { me, mate, teamId } = await seed(t)
    const lastMonth = addMonths(month, -1)
    await t.run(async (ctx) => {
      await ctx.db.patch(me, { insightsTrialEndsAt: Date.now() + 86_400_000 })
      await ctx.db.insert('teamMonthStats', {
        teamId,
        year: Number(lastMonth.slice(0, 4)),
        month: Number(lastMonth.slice(5, 7)),
        members: [
          { playerId: me, boards: 3, attempts: 9, solved: 3, failed: 0 },
          { playerId: mate, boards: 3, attempts: 15, solved: 3, failed: 0 },
        ],
        days: [],
        computedAt: Date.now(),
      })
    })

    const asMe = await authenticatedAs(t, ME)
    const res = await asMe.query(api.insights.teamMonth, { teamId, month: lastMonth, today })

    expect(res?.access.trialActive).toBe(true)
    // The totals a rank is computed from, for a month the free tier gets neither
    // the totals nor the rank for.
    expect(res?.stats?.members.map((member) => member.attempts)).toEqual([9, 15])
  })

  test('and an EXPIRED trial falls back to the reduced payload', async () => {
    const t = convexTest(schema, modules)
    registerBetterAuth(t)
    const { me, teamId } = await seed(t)
    await t.run(async (ctx) => {
      await ctx.db.patch(me, { insightsTrialEndsAt: Date.now() - 1 })
    })

    const asMe = await authenticatedAs(t, ME)
    const res = await asMe.query(api.insights.teamMonth, { teamId, month, today })

    expect(res?.access.trialExpired).toBe(true)
    expect(res?.stats).toBeNull()
    expect(res?.teaser?.days).toHaveLength(1)
  })
})

describe('teamMonth — why there is no rank', () => {
  test('a solo team is solo, even with no teamMonthStats row at all', async () => {
    // This fixture has no aggregate, so it cannot tell a ROSTER-derived `solo`
    // apart from an aggregate-derived one — both would agree here. The test
    // that actually forces the choice, because the aggregate disagrees with
    // the roster, is the one right below.
    const t = convexTest(schema, modules)
    registerBetterAuth(t)
    const teamId = await t.run(async (ctx) => {
      const me = await ctx.db.insert('players', aPlayer({ email: ME }))
      return await ctx.db.insert('teams', aTeam({ playerIds: [me], owner: me }))
    })

    const asMe = await authenticatedAs(t, ME)
    const res = await asMe.query(api.insights.teamMonth, { teamId, month, today })

    expect(res?.rank).toEqual({ kind: 'solo' })
  })

  test('a solo team who HAS played is still solo, not nobody-else', async () => {
    // THE CASE THE PRECEDENCE EXISTS FOR (rationale on `rank` in
    // convex/insights.ts). Fed this exact aggregate directly, teamRank would
    // answer `nobody-else` — one player, nobody to compare against. teamMonth
    // checks `roster.length < 2` FIRST and never reaches teamRank, because
    // "is this a team of one" is a question about the team, not about who
    // played — and it is the most common shape in the product
    // (lib/insights-team.ts's header), not an edge case to get wrong.
    const t = convexTest(schema, modules)
    registerBetterAuth(t)
    const teamId = await t.run(async (ctx) => {
      const me = await ctx.db.insert('players', aPlayer({ email: ME }))
      const teamId = await ctx.db.insert('teams', aTeam({ playerIds: [me], owner: me }))
      await ctx.db.insert('teamMonthStats', {
        teamId,
        year: Number(month.slice(0, 4)),
        month: Number(month.slice(5, 7)),
        members: [{ playerId: me, boards: 3, attempts: 11, solved: 3, failed: 0 }],
        days: [],
        computedAt: Date.now(),
      })
      return teamId
    })

    const asMe = await authenticatedAs(t, ME)
    const res = await asMe.query(api.insights.teamMonth, { teamId, month, today })

    expect(res?.rank).toEqual({ kind: 'solo' })
  })

  test('a month nobody has played at all is not-played, not nobody-else', async () => {
    // No teamMonthStats document exists for the month. The viewer has no boards
    // in it either, so the ask is genuinely on them.
    const t = convexTest(schema, modules)
    registerBetterAuth(t)
    const teamId = await t.run(async (ctx) => {
      const me = await ctx.db.insert('players', aPlayer({ email: ME }))
      const mate = await ctx.db.insert(
        'players',
        aPlayer({
          legacyId: '44444444-4444-4444-8444-444444444444',
          email: MATE,
          firstName: 'Grace',
        }),
      )
      return await ctx.db.insert('teams', aTeam({ playerIds: [me, mate], owner: me }))
    })

    const asMe = await authenticatedAs(t, ME)
    const res = await asMe.query(api.insights.teamMonth, { teamId, month, today })

    expect(res?.teaser).toBeNull()
    expect(res?.rank).toEqual({ kind: 'not-played' })
  })

  test('nobody-else, when the aggregate exists but only the viewer has boards', async () => {
    // Cheap from `seed`'s shape: the same two-player team, but the mate's
    // totals zeroed, so teamRank sees exactly one player who has played.
    const t = convexTest(schema, modules)
    registerBetterAuth(t)
    const teamId = await t.run(async (ctx) => {
      const me = await ctx.db.insert('players', aPlayer({ email: ME }))
      const mate = await ctx.db.insert(
        'players',
        aPlayer({
          legacyId: '55555555-5555-4555-8555-555555555555',
          email: MATE,
          firstName: 'Grace',
        }),
      )
      const teamId = await ctx.db.insert('teams', aTeam({ playerIds: [me, mate], owner: me }))
      await ctx.db.insert('teamMonthStats', {
        teamId,
        year: Number(month.slice(0, 4)),
        month: Number(month.slice(5, 7)),
        members: [
          { playerId: me, boards: 3, attempts: 11, solved: 3, failed: 0 },
          { playerId: mate, boards: 0, attempts: 0, solved: 0, failed: 0 },
        ],
        days: [],
        computedAt: Date.now(),
      })
      return teamId
    })

    const asMe = await authenticatedAs(t, ME)
    const res = await asMe.query(api.insights.teamMonth, { teamId, month, today })

    expect(res?.rank).toEqual({ kind: 'nobody-else' })
  })
})
