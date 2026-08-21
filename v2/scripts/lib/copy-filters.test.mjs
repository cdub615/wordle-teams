import { describe, expect, test } from 'vitest'
import { isNamed, selectCopyable } from './copy-filters.mjs'

// The copy script's two exclusion rules, pinned. copy-from-supabase.mjs itself
// cannot be tested — it runs against a live deployment at module scope — so
// these rules were lifted into a pure module precisely so that "the copy skips
// nameless players and memberless teams" is an assertion rather than a claim in
// a comment. Deleting either filter must fail here.
//
// Rows are shaped like Supabase rows, snake_case and all, because that is what
// the script hands over.

const player = (id, over = {}) => ({
  id,
  email: `${id}@a.test`,
  first_name: 'Ada',
  last_name: 'Lovelace',
  ...over,
})

const team = (id, playerIds) => ({ id, name: `team ${id}`, player_ids: playerIds, invited: [] })

describe('isNamed', () => {
  test('requires both names', () => {
    expect(isNamed(player('a'))).toBe(true)
    expect(isNamed(player('a', { first_name: null }))).toBe(false)
    expect(isNamed(player('a', { last_name: null }))).toBe(false)
    expect(isNamed(player('a', { first_name: undefined, last_name: undefined }))).toBe(false)
  })

  test('treats an empty string as nameless', () => {
    // `v.string()` accepts '' forever, so the schema narrowing cannot catch this
    // one for us: if this filter used `!= null` instead, the copy would write a
    // player who satisfies players.firstName/lastName and still has no name.
    expect(isNamed(player('a', { first_name: '' }))).toBe(false)
    expect(isNamed(player('a', { last_name: '' }))).toBe(false)
  })
})

describe('selectCopyable', () => {
  test('skips nameless players and counts them', () => {
    const players = [player('named'), player('nameless', { first_name: null })]
    const got = selectCopyable(players, [])
    expect(got.players.map((p) => p.id)).toEqual(['named'])
    expect(got.skippedPlayers).toBe(1)
  })

  test('skips a team whose every member was skipped, and counts it', () => {
    // The dead-team case measured in production: 29 teams created by nameless
    // players, with nobody left who could see or administer them.
    const players = [player('named'), player('nameless', { last_name: null })]
    const teams = [team(1, ['named', 'nameless']), team(2, ['nameless'])]
    const got = selectCopyable(players, teams)
    expect(got.teams.map((t) => t.id)).toEqual([1])
    expect(got.skippedTeams).toBe(1)
  })

  test('keeps a team that still has one surviving member', () => {
    // Pins the "some", not "every": a mixed team must survive with its named
    // member. upsertTeams drops the unresolvable member uuid on the way in.
    const players = [player('named'), player('nameless', { first_name: '' })]
    const got = selectCopyable(players, [team(1, ['nameless', 'named'])])
    expect(got.teams).toHaveLength(1)
    expect(got.skippedTeams).toBe(0)
    // The roster is handed over UNCHANGED — cleaning it is upsertTeams' job, and
    // it counts what it drops. Asserted so nobody "helpfully" filters it here and
    // makes droppedMembers stop reporting.
    expect(got.teams[0].player_ids).toEqual(['nameless', 'named'])
  })

  test('skips a team that was already empty in Supabase', () => {
    // No member can survive a filter it never entered, and the intended reading
    // agrees: a team with nobody on it is not a team.
    const got = selectCopyable([player('named')], [team(1, [])])
    expect(got.teams).toEqual([])
    expect(got.skippedTeams).toBe(1)
  })

  test('tolerates a null player_ids, which Supabase allows', () => {
    const got = selectCopyable([player('named')], [{ id: 1, name: 't', player_ids: null }])
    expect(got.teams).toEqual([])
    expect(got.skippedTeams).toBe(1)
  })

  test('copies everything when every player is named', () => {
    // The control: with clean data the filters are invisible, which is what the
    // run summary's two zeroes mean.
    const players = [player('a'), player('b')]
    const teams = [team(1, ['a']), team(2, ['b'])]
    const got = selectCopyable(players, teams)
    expect(got.players).toHaveLength(2)
    expect(got.teams).toHaveLength(2)
    expect(got.skippedPlayers).toBe(0)
    expect(got.skippedTeams).toBe(0)
  })
})
