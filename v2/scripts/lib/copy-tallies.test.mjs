import { describe, expect, test } from 'vitest'
import {
  formatClobberReport,
  formatInsertReport,
  formatTally,
  mergeTally,
} from './copy-tallies.mjs'

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
    // condition on the tally itself, not on what survived the skip above —
    // a tally with counters in it never prints as "nothing to do".
    expect(formatTally({})).toBe('(nothing to do)')
    expect(formatTally({ inserted: 0, updated: 0, clobbered: {} })).toBe('inserted=0 updated=0')
  })

  test('refuses a nested record that nothing downstream knows how to print', () => {
    // `clobbered` is skipped BY NAME because formatClobberReport prints it. Any
    // other nested record would be dropped here and never picked up there —
    // mergeTally accepts it happily, so nothing else would notice. Same
    // refuse-rather-than-guess stance as mergeTally, for the same reason: this
    // module's whole subject is a report going silently missing.
    expect(() => formatTally({ inserted: 1, dropped: { byTeam: 2 } })).toThrow(
      /'dropped' is an object.*reports nowhere/s,
    )
  })

  test('the refusal describes what it actually got', () => {
    // The throw fires on any non-number, not only on a nested record, so it
    // borrows mergeTally's `describe` rather than asserting a shape it has not
    // checked. Calling a string "a nested record" sends the reader looking for
    // the wrong bug.
    expect(() => formatTally({ inserted: 1, note: 'hi' })).toThrow(/'note' is a string/)
    expect(() => formatTally({ inserted: 1, seen: [1, 2] })).toThrow(/'seen' is an array/)
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
      '  Overwrote nothing: players, teams, monthlyWinners. ' +
        'Not diffed: dailyScores, playerMembership, webhookEvents.',
    )
  })

  test('the quiet line does not claim anything about the tables that do not diff', () => {
    // A bare "overwrote nothing" would silently assert something about
    // dailyScores, which does not diff at all (wordle-teams-r9d). The claim has
    // to be scoped to the mutations that actually report — hence the trailing
    // clause, and hence the list after the colon rather than a bare full stop.
    expect(
      formatClobberReport({
        players: { inserted: 1, updated: 0, clobbered: {} },
        dailyScores: { inserted: 9, updated: 0 },
      }),
    ).toBe('  Overwrote nothing: players. Not diffed: dailyScores.')
  })

  test('the quiet line and the banner footer use one grammar for the same fact', () => {
    // They state the same two things and used to disagree about how — "nothing
    // in x" against "nothing: x", "not diffed" against "Not diffed" — out of
    // three literals that had to move together. A report about legibility should
    // not contradict itself.
    const tallies = {
      players: { inserted: 0, updated: 2, clobbered: {} },
      dailyScores: { inserted: 9, updated: 0 },
    }
    const quiet = formatClobberReport(tallies)
    const loud = formatClobberReport({
      ...tallies,
      teams: { inserted: 0, updated: 1, clobbered: { name: 1 } },
    })
    for (const clause of ['Overwrote nothing: players', 'Not diffed: dailyScores']) {
      expect(quiet).toContain(clause)
      expect(loud).toContain(`##  ${clause}`)
    }
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
    ).toBe('  Overwrote nothing: players.')
  })

  test('nothing written at all still refuses to overclaim', () => {
    expect(formatClobberReport({ players: {}, teams: {} })).toBe(
      '  Overwrote nothing — no table that diffs had rows to write.',
    )
  })

  test('no diffing table had rows, but something was written', () => {
    // The awkward corner: an em dash on the first clause, because "nothing: no
    // table..." reads as a list of one strangely-named table. The two clauses
    // are not the same claim — the first says no table that diffs had rows, the
    // second names the tables that were written but never diff.
    expect(
      formatClobberReport({
        players: {},
        dailyScores: { inserted: 9, updated: 0 },
      }),
    ).toBe('  Overwrote nothing — no table that diffs had rows to write. Not diffed: dailyScores.')
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
        '##  OVERWROTE STORED VALUES: teams, monthlyWinners',
        '##  Rows whose stored value this copy replaced: a v2 edit lost, or a v1-side',
        '##  edit arriving during dual-running. Deliberate before cutover, when beta',
        '##  state is discarded; after cutover it is live user data.',
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

  test('the headline does not blame v2 for a difference v1 could equally have caused', () => {
    // A `clobbered` entry means only that the incoming v1 value differs from the
    // stored Convex value. That is a lost v2 edit OR v1 drifting since the last
    // copy — the ordinary dual-running case this script exists to handle.
    //
    // `scoring` is the case where blaming v2 is not merely unprovable but WRONG:
    // convex/migrate.ts documents it as the one field group v2 never writes
    // after createTeam (setScoringSystem writes a scoringSystems row, not the
    // team doc), so a scoring difference is always a v1-side edit. A banner
    // announcing destroyed v2 edits here is the false alarm that trains
    // everyone to ignore the report.
    const block = formatClobberReport({
      teams: { inserted: 0, updated: 29, droppedMembers: 0, clobbered: { scoring: 4 } },
    })
    expect(block).toContain('##  OVERWROTE STORED VALUES: teams')
    expect(block).not.toContain('v2 EDITS')
    // The cause stays in the body, stated as the either/or it actually is.
    expect(block).toContain('a v2 edit lost, or a v1-side')
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
    // Asserted structurally rather than verbatim: the banner's prose is pinned
    // in full by the test above, and re-pinning it here would mean three edits
    // for one wording change. What is actually under test is that a report with
    // nothing to say in its footer ends at the detail line.
    const lines = formatClobberReport({
      players: { inserted: 0, updated: 2, clobbered: { email: 1 } },
    }).split('\n')

    expect(lines.at(-2)).toBe('##  players   email on 1 row')
    expect(lines.at(-1)).toBe('#'.repeat(80))
    expect(lines.filter((line) => line === '##')).toHaveLength(1)
    expect(lines.some((line) => line.includes('Overwrote nothing'))).toBe(false)
    expect(lines.some((line) => line.includes('Not diffed'))).toBe(false)
  })

  // The frame is what makes the block visually distinct from the routine output
  // around it, so nothing may escape it. An unwrapped detail line for a player
  // row with every diffable field runs past 220 columns, and the terminal's own
  // wrap drops the `##` gutter — the overflow then reads as unrelated output.
  describe('stays inside its 80-column frame', () => {
    // Every field upsertPlayers can report. legacyId is excluded because it is
    // the key the row was matched on and can never differ.
    const ALL_PLAYER_FIELDS = {
      email: 1,
      firstName: 2,
      lastName: 2,
      hasPwa: 3,
      timeZone: 4,
      reminderDeliveryMethods: 11,
      reminderDeliveryTime: 11,
      lastBoardEntryReminder: 7,
      createdAt: 1,
    }

    test('the worst case wraps instead of overflowing', () => {
      const lines = formatClobberReport({
        players: { inserted: 0, updated: 535, clobbered: ALL_PLAYER_FIELDS },
        monthlyWinners: { inserted: 0, updated: 61, skipped: 0, clobbered: { legacyId: 3 } },
      }).split('\n')

      for (const line of lines) {
        expect(line.length).toBeLessThanOrEqual(80)
        expect(line.startsWith('#')).toBe(true)
      }
    })

    test('wrapping loses no field and no count', () => {
      const block = formatClobberReport({
        players: { inserted: 0, updated: 535, clobbered: ALL_PLAYER_FIELDS },
      })
      for (const [field, rows] of Object.entries(ALL_PLAYER_FIELDS)) {
        expect(block).toContain(`${field} on ${rows} row`)
      }
    })

    test('continuation lines keep the gutter and line up under the label', () => {
      // Pins where the wrap actually falls, so a change to the frame or to the
      // separator shows up as a diff rather than as a silently uglier block.
      expect(
        formatClobberReport({
          players: { inserted: 0, updated: 535, clobbered: ALL_PLAYER_FIELDS },
        })
          .split('\n')
          .filter((line) => line.includes(' on ')),
      ).toEqual([
        '##  players   email on 1 row, firstName on 2 rows, lastName on 2 rows,',
        '##            hasPwa on 3 rows, timeZone on 4 rows,',
        '##            reminderDeliveryMethods on 11 rows,',
        '##            reminderDeliveryTime on 11 rows, lastBoardEntryReminder on 7 rows,',
        '##            createdAt on 1 row',
      ])
    })

    test('a line of exactly 80 columns stands, and 81 wraps', () => {
      // The `<= FRAME` boundary itself. Nothing in the real schema lands on it,
      // so these names are built to straddle it — without this, an off-by-one
      // that let 81 columns through would pass every other test here.
      const detail = (fieldWidth) =>
        formatClobberReport({
          teams: { inserted: 0, updated: 1, clobbered: { aa: 2, ['b'.repeat(fieldWidth)]: 2 } },
        })
          .split('\n')
          .filter((line) => line.includes(' on '))

      const fits = detail(44)
      expect(fits).toHaveLength(1)
      expect(fits[0]).toHaveLength(80)

      const wraps = detail(45)
      expect(wraps).toHaveLength(2)
      expect(wraps[1].startsWith(`##  ${' '.repeat(8)}`)).toBe(true)
    })

    test('a field too wide for the frame overflows rather than being truncated', () => {
      // The documented exception. A truncated field name is a name the reader
      // cannot act on, so this one deliberately runs over — pinned so that a
      // future "fix" that starts truncating fails here instead of shipping.
      const huge = 'z'.repeat(100)
      const lines = formatClobberReport({
        teams: { inserted: 0, updated: 1, clobbered: { aa: 1, [huge]: 2, after: 3 } },
      }).split('\n')
      const indent = `##  ${' '.repeat(8)}`

      const overflow = lines.find((line) => line.includes(huge))
      expect(overflow).toBe(`${indent}${huge} on 2 rows,`)
      expect(overflow.length).toBeGreaterThan(80)
      // The overflow is contained: the next field starts a fresh, aligned line
      // rather than being dragged along behind it.
      expect(lines).toContain(`${indent}after on 3 rows`)
    })
  })
})

describe('formatInsertReport', () => {
  // wt-ksh.13.10. The clobber report above cannot see a row v2 DELETED — there
  // is nothing left to diff against, so the copy re-inserts it and reports
  // `inserted`, indistinguishable from a new v1 row. This detector reads that
  // insert count instead, against the deployment's own row count taken before
  // the writes. Same reason as the block above for pinning the rendering
  // verbatim: what is under test is what a human sees at cutover.

  const EMPTY = {
    players: 0,
    teams: 0,
    dailyScores: 0,
    monthlyWinners: 0,
    playerMembership: 0,
    webhookEvents: 0,
  }

  // Shaped like a deployment that has already been copied into once.
  const HELD = {
    players: 535,
    teams: 29,
    dailyScores: 21_450,
    monthlyWinners: 61,
    playerMembership: 535,
    webhookEvents: 12,
  }

  test('says nothing at all on a first copy into an empty deployment', () => {
    // THE CASE THAT DECIDES WHETHER THE DETECTOR IS USABLE. Every row is an
    // insert here, legitimately — 22622 of them — and a report that cries wolf
    // on the first copy is one nobody trusts on the third.
    expect(
      formatInsertReport(
        {
          players: { inserted: 535, updated: 0, clobbered: {} },
          teams: { inserted: 29, updated: 0, droppedMembers: 0, clobbered: {} },
          dailyScores: { inserted: 21_450, updated: 0, skipped: 0 },
          monthlyWinners: { inserted: 61, updated: 0, skipped: 0, clobbered: {} },
          playerMembership: { inserted: 535, updated: 0, skipped: 0 },
          webhookEvents: { inserted: 12, updated: 0, skipped: 0 },
        },
        EMPTY,
      ),
    ).toBeNull()
  })

  test('null, not an empty string, so a caller cannot print an empty frame', () => {
    // The caller prints `\n${report}` when there is a report. An empty string
    // would put a stray blank line where the whole point is silence.
    expect(formatInsertReport({ players: { inserted: 3, updated: 0 } }, EMPTY)).toBeNull()
  })

  test('a re-run that inserted nothing says so in one quiet line', () => {
    // A zero states the check ran, where silence could equally mean it never
    // did — the same precedent formatClobberReport and the skip report set.
    // Unscoped on purpose: unlike the clobber line there is no list of tables
    // this one is not speaking for, because `inserted` comes back from all six.
    expect(
      formatInsertReport(
        {
          players: { inserted: 0, updated: 535, clobbered: {} },
          teams: { inserted: 0, updated: 29, droppedMembers: 0, clobbered: {} },
          dailyScores: { inserted: 0, updated: 21_450, skipped: 0 },
          monthlyWinners: { inserted: 0, updated: 61, skipped: 0, clobbered: {} },
          playerMembership: { inserted: 0, updated: 535, skipped: 0 },
          webhookEvents: { inserted: 0, updated: 12, skipped: 0 },
        },
        HELD,
      ),
    ).toBe(
      '  Inserted nothing on a re-run — the deployment already held 22622 rows, ' +
        'so nothing v2 deleted came back.',
    )
  })

  test('a re-run that inserted prints a block that cannot be scrolled past', () => {
    expect(
      formatInsertReport(
        {
          players: { inserted: 0, updated: 535, clobbered: {} },
          teams: { inserted: 1, updated: 28, droppedMembers: 0, clobbered: {} },
          dailyScores: { inserted: 3, updated: 21_447, skipped: 0 },
          monthlyWinners: { inserted: 2, updated: 59, skipped: 0, clobbered: {} },
          playerMembership: { inserted: 0, updated: 535, skipped: 0 },
          webhookEvents: { inserted: 0, updated: 12, skipped: 0 },
        },
        HELD,
      ),
    ).toBe(
      [
        '################################################################################',
        '##  INSERTED INTO A NON-EMPTY DEPLOYMENT: 6 rows across 3 tables',
        '##  Trigger: the deployment already held 22622 rows before this run.',
        '##  A re-run against unchanged v1 data inserts nothing, so every row below',
        '##  needs a reason. One possible reason is a row v2 DELETED that this copy',
        '##  put back; there are several innocent ones. These counts cannot tell them',
        '##  apart — wt-ksh.9 step 2 is the list to work through, in order.',
        '##  Every table the copy writes is counted, including those it cannot diff.',
        '##',
        '##  teams            1 row',
        '##  dailyScores      3 rows',
        '##  monthlyWinners   2 rows',
        '################################################################################',
      ].join('\n'),
    )
  })

  test('says the check DID NOT RUN when the pre-write counts could not be read', () => {
    // The failure this replaced: a bare top-level await on the pre-write row
    // counts. Those now come from lib/count-tables.mjs, which is about ten
    // round trips rather than one query, so there is MORE to fail, not less.
    // (The 4,096 figure this comment used to cite as a "read cap" was a
    // misreading — it is Convex's limit on index ranges, i.e. calls to db.get
    // and db.query; the document scan limit is 32,000. See wordle-teams-b31 and
    // countTable in convex/migrate.ts.) Unhandled, in front of the writes, a
    // failure there turned a failed REPORT into a failed COPY. So the script
    // degrades to null here — and null may not print as silence, because
    // silence is the first-copy answer and would read as an all-clear.
    expect(formatInsertReport({ teams: { inserted: 1, updated: 0 } }, null)).toBe(
      '  Insert check DID NOT RUN — the pre-write row counts could not be read, ' +
        'so a resurrected row would be unseen. wt-ksh.9 step 2.',
    )
  })

  test('the did-not-run line does not depend on what was inserted', () => {
    // Without the trigger there is no way to tell a first copy from a re-run,
    // so the insert counts cannot be interpreted at all and the line must not
    // pretend otherwise by changing shape around them.
    const line = formatInsertReport({ teams: { inserted: 1, updated: 0 } }, null)
    expect(formatInsertReport({}, null)).toBe(line)
    expect(formatInsertReport({ dailyScores: { inserted: 9_000, updated: 0 } }, null)).toBe(line)
  })

  test('only null degrades; a malformed counts payload still throws', () => {
    // null is the caller's catch block saying "the deployment was unreachable".
    // undefined, an array or a record of strings are programming errors, and
    // treating them as an outage would hide a broken call site behind a line
    // that reads like an infrastructure hiccup.
    expect(() => formatInsertReport({}, undefined)).toThrow(/pre-write counts are missing/)
    expect(() => formatInsertReport({}, [1, 2])).toThrow(/pre-write counts are an array/)
  })

  test('the block names resurrection as ONE reason, not one of two', () => {
    // The one exhaustive claim this block used to make, and the only place the
    // "detector, not a fix" discipline had leaked. A widened --scope, a copy
    // that died partway, a first copy into a deployment holding v2-born rows
    // and a row that used to fail selectCopyable all insert innocently, so an
    // either/or printed in the block a cutover operator actually reads would
    // send him deleting legitimately-copied rows.
    const block = formatInsertReport({ teams: { inserted: 1, updated: 0 } }, HELD)
    expect(block).toContain('One possible reason is a row v2 DELETED that this copy')
    expect(block).toContain('there are several innocent ones')
    expect(block).not.toContain('either new in v1')
    // The enumeration lives in the runbook, where there is room to order it.
    expect(block).toContain('wt-ksh.9 step 2 is the list to work through')
  })

  test('the block does not claim to know which inserts are resurrections', () => {
    // It cannot, and overclaiming is the failure this is most exposed to: the
    // block would then be announcing lost user data on a re-run that merely
    // picked up yesterday's boards. The headline states the trigger; the body
    // states the either/or and hands the reader to the runbook.
    const block = formatInsertReport({ teams: { inserted: 1, updated: 0 } }, HELD)
    expect(block).toContain('##  INSERTED INTO A NON-EMPTY DEPLOYMENT: 1 row across 1 table')
    expect(block).not.toContain('RESURRECT')
    expect(block).toContain('One possible reason is a row v2 DELETED')
    expect(block).toContain('cannot tell them')
  })

  test('lists only the tables that inserted, and how many', () => {
    // The zeros are already on screen — every table's own formatTally line
    // above reads `inserted=0 ...` — so repeating all six here would cost the
    // block five lines and push the clobber block off a short terminal.
    const lines = formatInsertReport(
      {
        players: { inserted: 0, updated: 535, clobbered: {} },
        dailyScores: { inserted: 4, updated: 21_447, skipped: 0 },
      },
      HELD,
    ).split('\n')
    expect(lines.filter((line) => / \d+ rows?$/.test(line))).toEqual(['##  dailyScores   4 rows'])
  })

  test('counts a table the clobber report is structurally unable to diff', () => {
    // Half of the value of this detector. partition() routes dailyScores,
    // playerMembership and webhookEvents to 'Not diffed' because their
    // mutations return no `clobbered`; all three return `inserted`, so all
    // three appear here. dailyScores especially — a cleared board is one of the
    // two confirmed resurrection paths (wt-ksh.13.10), and wordle-teams-r9d
    // leaves it undiffed on purpose.
    const tallies = {
      dailyScores: { inserted: 3, updated: 0, skipped: 0 },
      playerMembership: { inserted: 1, updated: 0, skipped: 0 },
      webhookEvents: { inserted: 2, updated: 0, skipped: 0 },
    }
    expect(formatClobberReport(tallies)).toContain(
      'Not diffed: dailyScores, playerMembership, webhookEvents',
    )
    const block = formatInsertReport(tallies, HELD)
    expect(block).toContain('##  dailyScores        3 rows')
    expect(block).toContain('##  playerMembership   1 row')
    expect(block).toContain('##  webhookEvents      2 rows')
  })

  test('a table the copy never wrote to is not a spurious zero', () => {
    // Same rule partition() applies: an empty tally means the mutation was
    // never called, which the script only does when the table had no rows in
    // scope. It inserted nothing, and it did not "gain zero rows" either.
    expect(formatInsertReport({ players: {}, teams: {} }, HELD)).toBe(
      '  Inserted nothing on a re-run — the deployment already held 22622 rows, ' +
        'so nothing v2 deleted came back.',
    )
  })

  test('counts rows, not tables, in the headline, and gets both plurals right', () => {
    const headline = (tallies) =>
      formatInsertReport(tallies, HELD)
        .split('\n')
        .find((line) => line.includes('NON-EMPTY'))

    expect(headline({ teams: { inserted: 1, updated: 0 } })).toBe(
      '##  INSERTED INTO A NON-EMPTY DEPLOYMENT: 1 row across 1 table',
    )
    expect(
      headline({ teams: { inserted: 1, updated: 0 }, dailyScores: { inserted: 1, updated: 0 } }),
    ).toBe('##  INSERTED INTO A NON-EMPTY DEPLOYMENT: 2 rows across 2 tables')
  })

  test('one row in one table is enough to fire it', () => {
    // The team resurrection the bead confirmed by probe reads exactly like
    // this: inserted=1 on teams and nothing else moving.
    expect(formatInsertReport({ teams: { inserted: 1, updated: 28 } }, HELD)).toContain(
      '##  teams   1 row',
    )
  })

  test('a deployment holding a single row is already a re-run', () => {
    // The boundary. `held === 0` is the silence, and nothing above it is.
    expect(formatInsertReport({ players: { inserted: 1, updated: 0 } }, { players: 1 })).toContain(
      'INSERTED INTO A NON-EMPTY DEPLOYMENT',
    )
    expect(formatInsertReport({ players: { inserted: 1, updated: 0 } }, { players: 0 })).toBeNull()
  })

  test('one non-empty table makes the whole deployment non-empty', () => {
    // Deployment-wide, not per table. A deployment holding players but no teams
    // is one an earlier run already wrote to, so a team arriving now is worth
    // adjudicating — per-table gating would call that a first copy and go quiet.
    expect(formatInsertReport({ teams: { inserted: 1, updated: 0 } }, { ...EMPTY, players: 3 })).toContain(
      'INSERTED INTO A NON-EMPTY DEPLOYMENT',
    )
  })

  test('refuses a written table whose mutation stopped reporting inserts', () => {
    // Treating the absence as zero would turn the only thing watching for a
    // resurrected row into a permanent, silent all-clear. Same refuse-rather-
    // than-guess stance as mergeTally and formatTally, for the same reason.
    expect(() => formatInsertReport({ teams: { updated: 4 } }, HELD)).toThrow(
      /'teams' was written but its 'inserted' is missing/,
    )
    expect(() => formatInsertReport({ teams: { inserted: '4' } }, HELD)).toThrow(
      /'inserted' is a string/,
    )
  })

  test('checks the tallies even when the deployment was empty', () => {
    // The silent branch still validates its inputs, so a mutation that quietly
    // stopped returning `inserted` fails on a first copy rather than waiting
    // for the run where the answer matters.
    expect(() => formatInsertReport({ teams: { updated: 4 } }, EMPTY)).toThrow(/'inserted'/)
  })

  test('refuses pre-write counts that would make the trigger meaningless', () => {
    // A non-numeric value makes the sum NaN, `NaN === 0` is false, and the
    // detector silently flips from "silent on a first copy" to "loud on every
    // copy" — the false alarm that trains the reader to skip the block.
    expect(() => formatInsertReport({}, { players: null })).toThrow(
      /pre-write count for 'players' is null/,
    )
    expect(() => formatInsertReport({}, undefined)).toThrow(/pre-write counts are missing/)
    expect(() => formatInsertReport({}, [1, 2])).toThrow(/pre-write counts are an array/)
  })

  test('carries table names and row counts, and nothing else', () => {
    // COUNTS ONLY, NEVER VALUES. This repository is public. The input is counts
    // by construction; this pins that the renderer reaches for nothing else,
    // and that the only numbers on a detail line are the row count.
    const block = formatInsertReport(
      { teams: { inserted: 2, updated: 27, clobbered: { name: 9 } } },
      HELD,
    )
    const detail = block.split('\n').find((line) => line.startsWith('##  teams'))
    expect(detail).toBe('##  teams   2 rows')
    expect(detail.match(/\d+/g)).toEqual(['2'])
    // The clobber field names belong to the block above, not this one.
    expect(block).not.toContain('name')
  })

  describe('stays inside the same 80-column frame as the clobber block', () => {
    // The two blocks print on the same screen, one blank line apart. A frame
    // that is 80 columns in one and something else in the other reads as two
    // unrelated things, which is the opposite of what the shared border is for.

    test('the worst realistic case fits: all six tables, seven-figure counts', () => {
      const lines = formatInsertReport(
        Object.fromEntries(
          Object.keys(HELD).map((table) => [table, { inserted: 1_234_567, updated: 0 }]),
        ),
        HELD,
      ).split('\n')

      expect(lines).toHaveLength(16)
      for (const line of lines) {
        expect(line.length).toBeLessThanOrEqual(80)
        expect(line.startsWith('#')).toBe(true)
      }
    })

    test('the deployment size cannot push the trigger line out of the frame', () => {
      // Why the row count sits on a line of its own instead of inside the
      // prose: it is the one number in the block with no upper bound, and a
      // wrapped sentence carrying it would overflow as the deployment grows.
      const trigger = (held) =>
        formatInsertReport({ teams: { inserted: 1, updated: 0 } }, { players: held })
          .split('\n')
          .find((line) => line.includes('Trigger:'))

      expect(trigger(1)).toHaveLength(64)
      expect(trigger(999_999_999_999).length).toBeLessThanOrEqual(80)
    })

    test('both blocks use one border, so a run that fires both reads as two', () => {
      // The composition, pinned. copy-from-supabase.mjs prints the clobber block
      // and then this one, separated by a blank line. Same rule and gutter in
      // both, and a distinct ALL-CAPS headline in each, so neither can be
      // mistaken for the other's footer.
      const tallies = {
        teams: { inserted: 1, updated: 28, clobbered: { name: 2 } },
        dailyScores: { inserted: 3, updated: 21_447 },
      }
      const clobber = formatClobberReport(tallies).split('\n')
      const inserts = formatInsertReport(tallies, HELD).split('\n')

      const rule = '#'.repeat(80)
      expect([clobber.at(0), clobber.at(-1), inserts.at(0), inserts.at(-1)]).toEqual([
        rule,
        rule,
        rule,
        rule,
      ])
      expect(clobber[1]).toBe('##  OVERWROTE STORED VALUES: teams')
      expect(inserts[1]).toBe('##  INSERTED INTO A NON-EMPTY DEPLOYMENT: 4 rows across 2 tables')
    })
  })
})
