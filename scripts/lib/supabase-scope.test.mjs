import { describe, expect, test } from 'vitest'
import { readScoped } from './supabase-scope.mjs'

// What each --scope actually selects, pinned.
//
// readScoped had no test until wordle-teams-696k, and it was the only module in
// the copy path without one — which mattered, because it is the module TWO
// scripts depend on agreeing about. Its own header says so: "These two MUST
// agree about what 'in scope' means. If the verifier resolved scope even
// slightly differently from the copier it would report mismatches that are
// really just two scripts disagreeing."
//
// The distinction these tests exist to defend is 'mine' vs 'solo', because it is
// invisible in the call and enormous in the result:
//
//   mine  the owner's teams AND EVERY OTHER MEMBER OF THEM. Right for a parity
//         check against production, which must compare what production holds.
//   solo  the owner's teams and ONLY THE OWNER'S OWN ROWS. Right for seeding
//         dev, where epic wordle-teams-qjh3's decision 8 is that no other
//         user's row or address goes onto dev.
//
// Measured against production 2026-09-29, the two differ by 17 people and 6384
// dailyScores. A mutant that swapped one for the other would therefore put 17
// real people's email addresses onto dev while every count still looked
// plausible, so both directions are asserted below.
//
// readScoped takes its client as a parameter, which is what makes this testable
// with no network and no deployment. Rows are shaped like Supabase rows —
// snake_case, `player_ids` arrays, nullable emails — because that is what the
// real client hands back.

/**
 * The narrowest thing that satisfies readAll's chain:
 * `supabase.from(table).select(select).range(from, to)` -> `{ data, error }`.
 *
 * `range` is inclusive of both ends in Supabase, and readAll pages until a
 * short read, so slice(from, to + 1) is what makes a single page terminate.
 */
const stubClient = (tables) => ({
  from: (table) => ({
    select: () => ({
      range: async (from, to) => ({ data: (tables[table] ?? []).slice(from, to + 1), error: null }),
    }),
  }),
})

const ME = 'me@a.test'

// One owner, one teammate, and one stranger who shares no team with either.
// Every table below carries a row for all three, so a scope that leaks shows up
// as a leak in more than one place.
const players = [
  { id: 'p-me', email: 'Me@a.test', first_name: 'Ada', last_name: 'Lovelace' },
  { id: 'p-mate', email: 'mate@a.test', first_name: 'Grace', last_name: 'Hopper' },
  { id: 'p-other', email: 'other@a.test', first_name: 'Alan', last_name: 'Turing' },
]

const teams = [
  { id: 't-mine', name: 'mine', creator: 'p-me', player_ids: ['p-me', 'p-mate'], invited: [] },
  { id: 't-joined', name: 'joined', creator: 'p-mate', player_ids: ['p-mate', 'p-me'], invited: [] },
  { id: 't-theirs', name: 'theirs', creator: 'p-other', player_ids: ['p-other'], invited: [] },
]

const daily_scores = [
  { id: 1, player_id: 'p-me', date: '2026-01-01T12:00:00Z', guesses: [] },
  { id: 2, player_id: 'p-mate', date: '2026-01-01T12:00:00Z', guesses: [] },
  { id: 3, player_id: 'p-other', date: '2026-01-01T12:00:00Z', guesses: [] },
]

// Winners are filtered by TEAM, not by player — so a month the teammate won on
// the owner's own team is in scope under every scope. That is deliberate and is
// asserted below rather than left to be discovered.
const monthly_winners = [
  { id: 10, team_id: 't-mine', player_id: 'p-me', year: 2026, month: 1 },
  { id: 11, team_id: 't-mine', player_id: 'p-mate', year: 2026, month: 2 },
  { id: 12, team_id: 't-theirs', player_id: 'p-other', year: 2026, month: 1 },
]

const player_customer = [
  { id: 20, player_id: 'p-me', membership_status: 'free' },
  { id: 21, player_id: 'p-mate', membership_status: 'free' },
  { id: 22, player_id: 'p-other', membership_status: 'free' },
]

const webhook_events = [
  { id: 30, player_id: 'p-me', event_name: 'subscription.active', body: {} },
  { id: 31, player_id: 'p-mate', event_name: 'subscription.active', body: {} },
  { id: 32, player_id: 'p-other', event_name: 'subscription.active', body: {} },
]

const read = (scope) =>
  readScoped(
    stubClient({ players, teams, daily_scores, monthly_winners, player_customer, webhook_events }),
    scope,
    ME,
  )

const ids = (rows) => rows.map((r) => r.id)

describe('readScoped --scope=solo', () => {
  test('selects the owner alone, and none of their teammates', async () => {
    const got = await read('solo')
    expect(ids(got.players)).toEqual(['p-me'])
  })

  test("selects the owner's teams, including ones another player created", async () => {
    // Teams resolve exactly as under 'mine' — membership OR authorship. Only the
    // PLAYER set narrows. A team the owner merely joined must still cross, or
    // dev would not hold the team whose scoreboard they actually use.
    const got = await read('solo')
    expect(ids(got.teams).sort()).toEqual(['t-joined', 't-mine'])
  })

  test("carries only the owner's scores, memberships and webhook events", async () => {
    const got = await read('solo')
    expect(ids(got.scores)).toEqual([1])
    expect(ids(got.memberships)).toEqual([20])
    expect(ids(got.webhooks)).toEqual([30])
  })

  test("keeps a teammate's winner row when it belongs to the owner's team", async () => {
    // Winners narrow by team, so this row IS in scope while the player it names
    // is not. upsertMonthlyWinners resolves its player by legacyId and counts
    // the row into its own `skipped` tally — measured on production as 43 of 67
    // rows. Filtering them out here instead would hide them from that tally,
    // which is the one mechanism that reports every orphan a scoped copy makes.
    const got = await read('solo')
    expect(ids(got.winners).sort()).toEqual([10, 11])
  })

  test('matches the owner case-insensitively', async () => {
    // The fixture stores 'Me@a.test'; ME_EMAIL is lowercase. v1 matched
    // addresses case-sensitively and that bug is the reason §4.3 exists.
    const got = await read('solo')
    expect(ids(got.players)).toEqual(['p-me'])
  })
})

describe('readScoped --scope=mine', () => {
  test('selects the owner AND every member of their teams', async () => {
    // The difference from 'solo', asserted from the other side so that a mutant
    // collapsing the two fails whichever way round it is written.
    const got = await read('mine')
    expect(ids(got.players).sort()).toEqual(['p-mate', 'p-me'])
  })

  test("carries the teammates' scores, memberships and webhook events too", async () => {
    const got = await read('mine')
    expect(ids(got.scores).sort()).toEqual([1, 2])
    expect(ids(got.memberships).sort()).toEqual([20, 21])
    expect(ids(got.webhooks).sort()).toEqual([30, 31])
  })

  test('still excludes a player who shares no team with the owner', async () => {
    const got = await read('mine')
    expect(ids(got.players)).not.toContain('p-other')
  })
})

describe('readScoped --scope=all', () => {
  test('selects every player and every team', async () => {
    const got = await read('all')
    expect(ids(got.players).sort()).toEqual(['p-mate', 'p-me', 'p-other'])
    expect(ids(got.teams).sort()).toEqual(['t-joined', 't-mine', 't-theirs'])
    expect(ids(got.scores).sort()).toEqual([1, 2, 3])
  })
})

describe('readScoped totals', () => {
  test('report the whole table regardless of scope, so counts have a denominator', async () => {
    // The scripts print "N of TOTAL in scope"; a totals block that narrowed with
    // the scope would make every scope look like it copied everything.
    for (const scope of ['solo', 'mine', 'all']) {
      const got = await read(scope)
      expect(got.totals).toEqual({
        players: 3,
        teams: 3,
        dailyScores: 3,
        monthlyWinners: 3,
        playerMembership: 3,
        webhookEvents: 3,
      })
    }
  })
})
