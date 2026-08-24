import { describe, expect, test } from 'vitest'
import { selectCopyable } from './copy-filters.mjs'
import { narrowToCopied } from './verify-filters.mjs'

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

  test('hands out the copied player ids, which is how a team roster is narrowed', () => {
    // verify-parity.mjs compares a team's member count against the roster
    // filtered through this set, because upsertTeams drops the members it cannot
    // resolve. Production has 3 live teams holding a nameless member, so the raw
    // roster length would report those as mismatches on a full copy.
    const players = [player('named'), player('nameless', { first_name: null })]
    const got = narrowToCopied(scoped({ players, teams: [team(1, ['named', 'nameless'])] }))

    expect([...got.copiedPlayerIds]).toEqual(['named'])
    const roster = got.teams[0].player_ids.filter((id) => got.copiedPlayerIds.has(id))
    expect(roster).toEqual(['named'])
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
