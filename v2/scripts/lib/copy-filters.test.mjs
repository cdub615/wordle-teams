import { describe, expect, test } from 'vitest'
import { explainTeamMemberDrops, isNamed, selectCopyable } from './copy-filters.mjs'

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

describe('explainTeamMemberDrops', () => {
  const named = (id) => ({ id, first_name: 'A', last_name: 'B' })
  const nameless = (id) => ({ id, first_name: null, last_name: null })

  test('a roster of copied members predicts no drops', () => {
    const scoped = [named('a'), named('b')]
    const copyable = selectCopyable(scoped, [{ id: 't', player_ids: ['a', 'b'] }])
    expect(explainTeamMemberDrops(scoped, copyable)).toEqual({
      nameless: 0,
      outOfScope: 0,
      total: 0,
    })
  })

  test('a nameless member is attributed to the name filter, not to the scope', () => {
    // The --scope=all case, and the whole reason this exists: the player WAS
    // read, so calling it "outside the copied scope" is the wrong explanation.
    const scoped = [named('a'), nameless('b')]
    const copyable = selectCopyable(scoped, [{ id: 't', player_ids: ['a', 'b'] }])
    expect(explainTeamMemberDrops(scoped, copyable)).toEqual({
      nameless: 1,
      outOfScope: 0,
      total: 1,
    })
  })

  test('a member never read at all is attributed to the scope', () => {
    // The --scope=mine case. 'z' is on the roster and is not among the scoped
    // players, so it was never a candidate.
    const scoped = [named('a')]
    const copyable = selectCopyable(scoped, [{ id: 't', player_ids: ['a', 'z'] }])
    expect(explainTeamMemberDrops(scoped, copyable)).toEqual({
      nameless: 0,
      outOfScope: 1,
      total: 1,
    })
  })

  test('both causes are counted separately in one run', () => {
    const scoped = [named('a'), nameless('b')]
    const copyable = selectCopyable(scoped, [{ id: 't', player_ids: ['a', 'b', 'z'] }])
    expect(explainTeamMemberDrops(scoped, copyable)).toEqual({
      nameless: 1,
      outOfScope: 1,
      total: 2,
    })
  })

  test('a team the copy is SKIPPING contributes nothing', () => {
    // It is never handed to upsertTeams, so it cannot produce a drop. Counting
    // it would inflate the prediction and hide a real anomaly underneath.
    //
    // THIS IS PINNED BY THE SIGNATURE MORE THAN BY THIS TEST, and saying so is
    // the honest version: explainTeamMemberDrops only ever receives `copyable`,
    // which has no skipped teams in it, so today there is no mutation of the
    // body that makes this fail — confirmed by trying. It stays because it
    // documents the property and would catch a future change that widened the
    // parameter to every scoped team, which is the plausible way to break it.
    const scoped = [named('a'), nameless('b')]
    const teams = [
      { id: 'kept', player_ids: ['a'] },
      // Every member nameless, so selectCopyable drops the whole team.
      { id: 'skipped', player_ids: ['b', 'z'] },
    ]
    const copyable = selectCopyable(scoped, teams)
    expect(copyable.teams.map((t) => t.id)).toEqual(['kept'])
    expect(explainTeamMemberDrops(scoped, copyable).total).toBe(0)
  })

  test('a uuid listed twice on one team counts twice', () => {
    // upsertTeams walks the array and increments per ENTRY, so the prediction
    // has to count the same way or subtracting it reports a false remainder.
    const scoped = [named('a'), nameless('b')]
    const copyable = selectCopyable(scoped, [{ id: 't', player_ids: ['a', 'b', 'b'] }])
    expect(explainTeamMemberDrops(scoped, copyable).nameless).toBe(2)
  })

  test('a team with no player_ids array at all does not throw', () => {
    const scoped = [named('a')]
    const copyable = { players: scoped, teams: [{ id: 't' }] }
    expect(() => explainTeamMemberDrops(scoped, copyable)).not.toThrow()
  })
})
