import { describe, expect, test } from 'vitest'
import { formatClobberReport, formatTally, mergeTally } from './copy-tallies.mjs'

// The copy's adding-up and its two renderings, pinned. copy-from-supabase.mjs
// itself cannot be tested — it connects to Supabase and to a deployment at
// module scope — which is exactly why this lives here: the merge is what decides
// whether wt-ksh.13's clobber report reaches a human intact, and
// formatClobberReport is the loud version built on top of that shape.
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
  test('prints the flat counters', () => {
    expect(formatTally({ inserted: 0, updated: 4, droppedMembers: 2 })).toBe(
      'inserted=0 updated=4 droppedMembers=2',
    )
  })

  test('leaves the clobber counts to formatClobberReport', () => {
    // They belong in the loud block, not in both places. A per-table
    // `clobbered={name=6}` here would be the same news, quieter and first.
    expect(formatTally({ inserted: 0, updated: 4, clobbered: { name: 6, scoring: 1 } })).toBe(
      'inserted=0 updated=4',
    )
  })

  test('says `(nothing to do)` when the mutation was never called', () => {
    // An empty tally means there were no rows for that table at all. This is the
    // condition on the tally itself, not on what survived the filter above —
    // a tally with counters in it never prints as "nothing to do".
    expect(formatTally({})).toBe('(nothing to do)')
    expect(formatTally({ inserted: 0, updated: 0, clobbered: {} })).toBe('inserted=0 updated=0')
  })
})

describe('formatClobberReport', () => {
  // The whole point of wt-ksh.13.5: a copy run at the WRONG moment — after
  // cutover, with real users on v2 — has to announce itself. So these tests are
  // about the shape of the output as a human sees it, which is why they pin the
  // rendering verbatim rather than probing it with regexes.
  //
  // The input is what the six writeAll calls accumulated, in write order:
  // table label -> the merged tally for that table.

  test('a copy that overwrote nothing says so in one quiet line', () => {
    expect(
      formatClobberReport({
        players: { inserted: 533, updated: 0, clobbered: {} },
        teams: { inserted: 29, updated: 0, droppedMembers: 0, clobbered: {} },
        dailyScores: { inserted: 21_450, updated: 0 },
        monthlyWinners: { inserted: 61, updated: 0, skipped: 0, clobbered: {} },
        playerMembership: { inserted: 533, updated: 0, skipped: 0 },
        webhookEvents: { inserted: 12, updated: 0, skipped: 0 },
      }),
    ).toBe(
      '  Overwrote nothing in players, teams, monthlyWinners; ' +
        'not diffed: dailyScores, playerMembership, webhookEvents.',
    )
  })

  test('the quiet line does not claim anything about the tables that do not diff', () => {
    // A bare "overwrote nothing" would silently assert something about
    // dailyScores, which does not diff at all (wordle-teams-r9d). The claim has
    // to be scoped to the three mutations that actually report.
    const line = formatClobberReport({
      players: { inserted: 1, updated: 0, clobbered: {} },
      dailyScores: { inserted: 9, updated: 0 },
    })
    expect(line).toBe('  Overwrote nothing in players; not diffed: dailyScores.')
    expect(line).not.toMatch(/^ {2}Overwrote nothing\./)
  })

  test('a table the copy never wrote to is not a spurious zero', () => {
    // An empty tally means the mutation was never called, which the script only
    // does when that table had no rows in scope. It neither overwrote anything
    // nor failed to diff, so it belongs in neither list.
    expect(
      formatClobberReport({
        players: { inserted: 3, updated: 0, clobbered: {} },
        teams: {},
        webhookEvents: {},
      }),
    ).toBe('  Overwrote nothing in players.')
  })

  test('nothing written at all still refuses to overclaim', () => {
    expect(formatClobberReport({ players: {}, teams: {} })).toBe(
      '  Overwrote nothing: no table that diffs had rows to write.',
    )
  })

  test('a copy that reverted v2 state prints a block that cannot be scrolled past', () => {
    expect(
      formatClobberReport({
        players: { inserted: 0, updated: 533, clobbered: {} },
        teams: { inserted: 0, updated: 29, droppedMembers: 0, clobbered: { name: 2, scoring: 1 } },
        dailyScores: { inserted: 0, updated: 21_450 },
        monthlyWinners: { inserted: 0, updated: 61, skipped: 0, clobbered: { legacyId: 3 } },
        playerMembership: { inserted: 0, updated: 533, skipped: 0 },
        webhookEvents: { inserted: 0, updated: 12, skipped: 0 },
      }),
    ).toBe(
      [
        '################################################################################',
        '##  OVERWROTE v2 EDITS: teams, monthlyWinners',
        '##  Counts are rows whose stored value this copy replaced. Deliberate before',
        '##  cutover, when beta state is discarded. After cutover it is live user data.',
        '##',
        '##  teams            name on 2 rows, scoring on 1 row',
        '##  monthlyWinners   legacyId on 3 rows',
        '##',
        '##  Overwrote nothing: players',
        '##  Not diffed: dailyScores, playerMembership, webhookEvents',
        '################################################################################',
      ].join('\n'),
    )
  })

  test('the block carries field NAMES and row counts, and nothing else', () => {
    // COUNTS ONLY, NEVER VALUES. This repository is public and the fields that
    // get overwritten include team names and invited email addresses. The input
    // is already counts by construction — this pins that the renderer does not
    // reach for anything beyond the key and the number.
    const block = formatClobberReport({
      teams: { inserted: 0, updated: 4, clobbered: { name: 1, invited: 2 } },
    })
    const detail = block.split('\n').find((line) => line.startsWith('##  teams'))
    expect(detail).toBe('##  teams   name on 1 row, invited on 2 rows')
    // The only numbers on the line are the two row counts — `updated: 4` and
    // anything else the tally carries stay out of it.
    expect(detail.match(/\d+/g)).toEqual(['1', '2'])
  })

  test('every table overwriting something leaves no empty trailing list', () => {
    expect(
      formatClobberReport({
        players: { inserted: 0, updated: 2, clobbered: { email: 1 } },
      }),
    ).toBe(
      [
        '################################################################################',
        '##  OVERWROTE v2 EDITS: players',
        '##  Counts are rows whose stored value this copy replaced. Deliberate before',
        '##  cutover, when beta state is discarded. After cutover it is live user data.',
        '##',
        '##  players   email on 1 row',
        '################################################################################',
      ].join('\n'),
    )
  })
})
