import { describe, expect, test } from 'vitest'
import { selectCopyable } from './copy-filters.mjs'
import { expectedMemberCount, narrowToCopied } from './verify-filters.mjs'

// The verifier's narrowing, pinned. verify-parity.mjs cannot be tested — like
// the copy script it runs at module scope against production and a live
// deployment — so the rule that decides whether a legitimate exclusion reads as
// a parity FAILURE lives here, where it is an assertion rather than a claim in a
// comment. Get this wrong and the Phase 7 audit either cries wolf or, worse,
// stops noticing a real lost row.
//
// Rows are shaped like Supabase rows, snake_case and all, because readScoped
// hands them straight over.

const player = (id, over = {}) => ({
  id,
  email: `${id}@a.test`,
  first_name: 'Ada',
  last_name: 'Lovelace',
  ...over,
})

const team = (id, playerIds) => ({ id, name: `team ${id}`, player_ids: playerIds, invited: [] })

const membership = (id, playerId) => ({ id, player_id: playerId, membership_status: 'free' })

/** A readScoped()-shaped result, so the narrowing is exercised on its real input. */
const scoped = (over = {}) => ({
  totals: { players: 99 },
  players: [],
  teams: [],
  scores: [],
  winners: [],
  memberships: [],
  webhooks: [],
  ...over,
})

describe('narrowToCopied', () => {
  test('narrows players and teams to exactly what selectCopyable selects', () => {
    // Delegation, not a second implementation of the same rules. If this ever
    // has to be reimplemented, the verifier can drift from the copier it checks
    // — and a verifier that disagrees with the copier is worse than none.
    const players = [player('named'), player('nameless', { first_name: null })]
    const teams = [team(1, ['named']), team(2, ['nameless'])]

    const got = narrowToCopied(scoped({ players, teams }))
    const copyable = selectCopyable(players, teams)

    expect(got.players).toEqual(copyable.players)
    expect(got.teams).toEqual(copyable.teams)
    expect(got.skipped.players).toBe(copyable.skippedPlayers)
    expect(got.skipped.teams).toBe(copyable.skippedTeams)
  })

  test('drops the memberships belonging to skipped players, and counts them', () => {
    // The widening this module exists for. Narrowing the player count check
    // while leaving memberships whole just moves the shortfall one line down.
    const players = [player('named'), player('nameless', { last_name: null })]
    const memberships = [membership('m-named', 'named'), membership('m-nameless', 'nameless')]

    const got = narrowToCopied(scoped({ players, memberships }))

    expect(got.memberships.map((m) => m.id)).toEqual(['m-named'])
    expect(got.skipped.memberships).toBe(1)
  })

  test('moves players and memberships by the SAME number when the two are 1:1', () => {
    // Production's shape, measured 2026-08-24: player_customer is 1:1 with
    // players — 535 to 535, 0 orphaned — and all 151 nameless players carry one.
    // So the membership shortfall IS the player shortfall, by construction. This
    // is the sanity check a full-copy run should reproduce; if the two numbers
    // part company, the predicate has drifted from isNamed.
    const players = Array.from({ length: 10 }, (_, i) =>
      i < 3 ? player(`p${i}`, { first_name: '' }) : player(`p${i}`),
    )
    const memberships = players.map((p) => membership(`m-${p.id}`, p.id))

    const got = narrowToCopied(scoped({ players, memberships }))

    expect(got.skipped.players).toBe(3)
    expect(got.skipped.memberships).toBe(got.skipped.players)
    expect(got.players).toHaveLength(7)
    expect(got.memberships).toHaveLength(7)
  })

  test('counts a membership per player, not per player id, when the two are not 1:1', () => {
    // The header says a divergence between the two shortfalls is a DATA finding
    // — player_customer no longer 1:1 with players — rather than a drifted
    // predicate. This is that case, pinned: one skipped player carrying two
    // membership rows moves memberships by 2 while players moves by 1. The
    // narrowing is still right; the numbers simply stop matching, which is
    // exactly the signal to go and look at the table.
    const players = [player('named'), player('nameless', { first_name: null })]
    const memberships = [
      membership('m-named', 'named'),
      membership('m-nameless-1', 'nameless'),
      membership('m-nameless-2', 'nameless'),
    ]

    const got = narrowToCopied(scoped({ players, memberships }))

    expect(got.skipped.players).toBe(1)
    expect(got.skipped.memberships).toBe(2)
    expect(got.memberships.map((m) => m.id)).toEqual(['m-named'])
  })

  test('hands out the copied player ids, which is how a team roster is narrowed', () => {
    const players = [player('named'), player('nameless', { first_name: null })]
    const got = narrowToCopied(scoped({ players, teams: [team(1, ['named', 'nameless'])] }))

    expect([...got.copiedPlayerIds]).toEqual(['named'])
  })

  test('passes scores, winners, webhooks and totals through untouched', () => {
    // These three are left to each upsert mutation's own orphan tally on
    // purpose: nameless players own 0 boards and 0 winner rows, so a shortfall
    // on one of them is a finding to chase, not something to filter away.
    const src = scoped({
      players: [player('named'), player('nameless', { first_name: null })],
      scores: [{ id: 's1', player_id: 'nameless' }],
      winners: [{ id: 'w1', player_id: 'nameless' }],
      webhooks: [{ id: 'h1', player_id: 'nameless' }],
    })

    const got = narrowToCopied(src)

    expect(got.scores).toBe(src.scores)
    expect(got.winners).toBe(src.winners)
    expect(got.webhooks).toBe(src.webhooks)
    expect(got.totals).toBe(src.totals)
  })

  test('reports three zeroes when nothing is excluded', () => {
    // The control, and the reason the verifier prints these counts even at zero:
    // a zero says the narrowing ran and found nothing, where silence could
    // equally mean it never ran.
    const players = [player('a'), player('b')]
    const got = narrowToCopied(
      scoped({
        players,
        teams: [team(1, ['a', 'b'])],
        memberships: players.map((p) => membership(`m-${p.id}`, p.id)),
      }),
    )

    expect(got.skipped).toEqual({ players: 0, teams: 0, memberships: 0 })
    expect(got.players).toHaveLength(2)
    expect(got.teams).toHaveLength(1)
    expect(got.memberships).toHaveLength(2)
  })

  test('drops a membership pointing at no player at all', () => {
    // readScoped already filters memberships by the scoped player ids, so this
    // cannot come out of a real read — production measured 0 orphans on
    // 2026-08-24. Pinned anyway because the copy would not write such a row
    // either (upsertMemberships counts it into its own `skipped`), so the
    // verifier must not expect to find it.
    const got = narrowToCopied(
      scoped({ players: [player('named')], memberships: [membership('m-ghost', 'ghost')] }),
    )

    expect(got.memberships).toEqual([])
    expect(got.skipped.memberships).toBe(1)
  })

  test('leaves the caller’s arrays alone', () => {
    // The verifier prints "N of M in scope", so it still needs the unnarrowed
    // lengths after this returns.
    const src = scoped({
      players: [player('named'), player('nameless', { last_name: '' })],
      teams: [team(1, ['nameless'])],
      memberships: [membership('m1', 'nameless')],
    })

    narrowToCopied(src)

    expect(src.players).toHaveLength(2)
    expect(src.teams).toHaveLength(1)
    expect(src.memberships).toHaveLength(1)
  })
})

describe('expectedMemberCount', () => {
  // What verify-parity.mjs compares a team's Convex playerCount against. It runs
  // on the set narrowToCopied produced, so these fixtures build it the same way
  // the script does rather than hand-rolling a Set.
  const idsFor = (...players) => narrowToCopied(scoped({ players })).copiedPlayerIds

  test('does not count a member the copy skipped', () => {
    // The 3 live teams production holds with a nameless member on them. Their
    // Convex playerCount is one lower than player_ids, because upsertTeams drops
    // the uuid it cannot resolve.
    const ids = idsFor(player('named'), player('nameless', { first_name: null }))
    expect(expectedMemberCount(team(1, ['named', 'nameless']), ids)).toBe(1)
  })

  test('still expects every member the copy DID write', () => {
    // The case that makes this a narrowing and not a relaxation: a named member
    // lost somewhere between Supabase and Convex leaves the expected count at 2
    // against a playerCount of 1, and the check fails. Filtering the expectation
    // must not become a way to stop noticing that.
    const ids = idsFor(player('a'), player('b'), player('nameless', { last_name: null }))
    expect(expectedMemberCount(team(1, ['a', 'b', 'nameless']), ids)).toBe(2)
  })

  test('never counts a skipped member, so one wrongly present in Convex fails', () => {
    // The other direction, and the one a raw-roster comparison got wrong: if a
    // nameless player somehow reached Convex and joined this team, playerCount
    // is 2 while this expects 1, and the mismatch is reported. Comparing
    // player_ids.length would have passed it.
    const ids = idsFor(player('named'), player('nameless', { first_name: '' }))
    expect(expectedMemberCount(team(1, ['named', 'nameless']), ids)).not.toBe(2)
    expect(expectedMemberCount(team(1, ['named', 'nameless']), ids)).toBe(1)
  })

  test('drops a roster uuid matching no player at all', () => {
    // upsertTeams counts these into droppedMembers too, so the verifier must not
    // expect them either. Distinct from the nameless case: this uuid is in no
    // players row, copyable or otherwise.
    expect(expectedMemberCount(team(1, ['named', 'ghost']), idsFor(player('named')))).toBe(1)
  })

  test('is unchanged by the narrowing when every member was copied', () => {
    const ids = idsFor(player('a'), player('b'))
    expect(expectedMemberCount(team(1, ['a', 'b']), ids)).toBe(2)
  })

  test('tolerates a null player_ids, which Supabase allows', () => {
    expect(expectedMemberCount({ id: 1, name: 't', player_ids: null }, idsFor(player('a')))).toBe(0)
  })
})
