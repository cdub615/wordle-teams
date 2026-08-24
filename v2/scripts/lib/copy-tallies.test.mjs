import { describe, expect, test } from 'vitest'
import { formatTally, mergeTally } from './copy-tallies.mjs'

// The copy's adding-up, pinned. copy-from-supabase.mjs itself cannot be tested —
// it connects to Supabase and to a deployment at module scope — which is exactly
// why this moved out of it: the merge is what decides whether wt-ksh.13's clobber
// report reaches a human intact, and wt-ksh.13.5 builds its loud version on top
// of this shape.
//
// Results are shaped like migrate.ts return values, because that is what the
// script hands over: flat counters, plus a nested `clobbered` record on
// upsertPlayers, upsertTeams and upsertMonthlyWinners.

describe('mergeTally', () => {
  test('sums the flat counters', () => {
    const tallies = {}
    mergeTally(tallies, { inserted: 2, updated: 1, droppedMembers: 0 })
    mergeTally(tallies, { inserted: 0, updated: 3, droppedMembers: 2 })
    expect(tallies).toEqual({ inserted: 2, updated: 4, droppedMembers: 2 })
  })

  test('merges a nested record field by field, across chunk boundaries', () => {
    // The property the one-line accumulator could not express. Rows go up in
    // chunks of 200 and each chunk reports only what IT overwrote, so three
    // renames in one chunk and three in the next have to read as six.
    const tallies = {}
    mergeTally(tallies, { inserted: 0, updated: 200, clobbered: { name: 3 } })
    mergeTally(tallies, { inserted: 0, updated: 12, clobbered: { name: 3, scoring: 1 } })
    expect(tallies).toEqual({
      inserted: 0,
      updated: 212,
      clobbered: { name: 6, scoring: 1 },
    })
  })

  test('a chunk that overwrote nothing contributes nothing', () => {
    const tallies = {}
    mergeTally(tallies, { inserted: 0, updated: 5, clobbered: { name: 2 } })
    mergeTally(tallies, { inserted: 0, updated: 5, clobbered: {} })
    expect(tallies).toEqual({ inserted: 0, updated: 10, clobbered: { name: 2 } })
  })

  test('the nested record survives a first chunk that had nothing to say', () => {
    const tallies = {}
    mergeTally(tallies, { updated: 5, clobbered: {} })
    mergeTally(tallies, { updated: 5, clobbered: { invited: 1 } })
    expect(tallies).toEqual({ updated: 10, clobbered: { invited: 1 } })
  })

  test('does not mistake an array for a nested record', () => {
    // `typeof v === 'object'` is true for arrays, so a mutation returning
    // `skipped: ['a', 'b']` would merge BY INDEX and print `{0=0aa 1=0bb}`.
    // Nothing returns that today; the point is that it fails loudly if anything
    // ever does, because the failure it replaced was silent.
    expect(() => mergeTally({}, { skipped: ['a', 'b'] })).toThrow(/'skipped'.*an array/)
  })

  test('does not mistake an array OF NUMBERS for a nested record', () => {
    // The case that actually needs the Array.isArray guard, and the plausible
    // one — an array of strings is already refused for having non-numeric
    // values, but `[1, 2]` passes that test and would merge by index into
    // `skipped={0=1 1=2}`. Measured: dropping the guard leaves the string case
    // above still green, so it alone does not pin this.
    expect(() => mergeTally({}, { skipped: [1, 2] })).toThrow(/'skipped'.*an array/)
  })

  test('refuses a second level of nesting rather than printing [object Object]', () => {
    // The exact bug this module exists to remove, one level further down.
    expect(() => mergeTally({}, { clobbered: { scoring: { oneGuess: 1 } } })).toThrow(
      /'clobbered'.*'scoring' is an object/,
    )
  })

  test('refuses null and non-numeric values', () => {
    expect(() => mergeTally({}, { updated: null })).toThrow(/'updated'.*null/)
    expect(() => mergeTally({}, { action: 'created' })).toThrow(/'action'.*a string/)
  })
})

describe('formatTally', () => {
  test('prints flat counters and inlines a nested record', () => {
    expect(formatTally({ inserted: 0, updated: 4, clobbered: { name: 6, scoring: 1 } })).toBe(
      'inserted=0 updated=4 clobbered={name=6 scoring=1}',
    )
  })

  test('says `none` for a clean run rather than `{}`', () => {
    // "The copy overwrote nothing" is a thing this report has to be able to say
    // out loud — an empty pair of braces reads like a bug in the script.
    expect(formatTally({ inserted: 533, updated: 0, clobbered: {} })).toBe(
      'inserted=533 updated=0 clobbered=none',
    )
  })

  test('says `(nothing to do)` when the mutation was never called', () => {
    // An empty tally means there were no rows for that table at all.
    expect(formatTally({})).toBe('(nothing to do)')
  })
})
