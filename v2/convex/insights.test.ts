import { convexTest } from 'convex-test'
import { describe, expect, test } from 'vitest'
import schema from './schema'
import { api } from './_generated/api'
import { aPlayer, aTeam, authenticatedAs, makeRegisterBetterAuth } from './fixtures.ts'
import { monthOf, toPuzzleDay, addDays } from './lib/puzzleDay.ts'
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
