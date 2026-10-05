/**
 * WHY THESE CASES. A threshold tested in one direction is vacuous, so both sides
 * of SHORT_WINDOW_DAYS are asserted. Both lastDayOf call sites (the same-month
 * branch and the following-month branch) are covered with real month lengths,
 * so substituting monthRange(month).end on either branch fails.
 *
 * For teamTotalsOver the fixture deliberately straddles both window bounds and a
 * month boundary. Player b appearing on two separate days is what pins per-player
 * accumulation rather than assignment.
 */
import { describe, expect, test } from 'vitest'
import {
  CHALLENGES_ON,
  challengesEnabled,
  MAX_ACTIVE_CHALLENGES,
  MIN_CHALLENGE_BOARDS,
  outcomeOf,
  PROPOSAL_TTL_DAYS,
  SHORT_WINDOW_DAYS,
  teamTotalsOver,
  windowFor,
} from './challenge.ts'

describe('the constants', () => {
  test('are the values the design approved', () => {
    expect(MIN_CHALLENGE_BOARDS).toBe(10)
    expect(MAX_ACTIVE_CHALLENGES).toBe(5)
    expect(PROPOSAL_TTL_DAYS).toBe(7)
    expect(SHORT_WINDOW_DAYS).toBe(7)
  })
})

describe('windowFor', () => {
  test('starts the day AFTER acceptance, so nothing retroactive counts', () => {
    expect(windowFor('2026-10-04').startDay).toBe('2026-10-05')
  })

  test('ends with the calendar month when the month has room', () => {
    expect(windowFor('2026-10-04')).toEqual({ startDay: '2026-10-05', endDay: '2026-10-31' })
  })

  // Counted INCLUSIVELY from startDay to month end.
  test('at the short-window boundary the window still ends with this month', () => {
    // start 2026-10-25, end 2026-10-31 => 7 days remaining, which is NOT fewer than 7.
    expect(windowFor('2026-10-24')).toEqual({ startDay: '2026-10-25', endDay: '2026-10-31' })
  })

  test('below the boundary it runs to the end of the FOLLOWING month', () => {
    // start 2026-10-26, end 2026-10-31 => 6 days remaining, fewer than 7.
    expect(windowFor('2026-10-25')).toEqual({ startDay: '2026-10-26', endDay: '2026-11-30' })
  })

  test('accepting on the last day of a month gets the whole next month', () => {
    expect(windowFor('2026-10-31')).toEqual({ startDay: '2026-11-01', endDay: '2026-11-30' })
  })

  test('crosses a year boundary', () => {
    expect(windowFor('2026-12-28')).toEqual({ startDay: '2026-12-29', endDay: '2027-01-31' })
  })

  test('handles February in a leap year', () => {
    expect(windowFor('2028-02-01')).toEqual({ startDay: '2028-02-02', endDay: '2028-02-29' })
  })

  test('handles a NON-leap February', () => {
    expect(windowFor('2026-02-01')).toEqual({ startDay: '2026-02-02', endDay: '2026-02-28' })
  })
})

const days = [
  { puzzleDay: '2026-10-04', entries: [{ playerId: 'a', attempts: 3 }] },
  { puzzleDay: '2026-10-05', entries: [{ playerId: 'a', attempts: 4 }, { playerId: 'b', attempts: 2 }] },
  { puzzleDay: '2026-10-31', entries: [{ playerId: 'b', attempts: 7 }] },
  { puzzleDay: '2026-11-01', entries: [{ playerId: 'a', attempts: 5 }] },
]

describe('teamTotalsOver', () => {
  test('counts only days inside the window, both bounds inclusive', () => {
    const totals = teamTotalsOver(days, '2026-10-05', '2026-10-31')
    expect(totals.boards).toBe(3)
    expect(totals.attempts).toBe(4 + 2 + 7)
  })

  test('excludes the day before the window, which is the retroactivity guard', () => {
    const totals = teamTotalsOver(days, '2026-10-05', '2026-10-31')
    expect(totals.members.find((m) => m.playerId === 'a')?.attempts).toBe(4)
  })

  test('excludes the day after the window', () => {
    const totals = teamTotalsOver(days, '2026-10-05', '2026-10-31')
    expect(totals.members.find((m) => m.playerId === 'a')).toEqual({
      playerId: 'a',
      boards: 1,
      attempts: 4,
    })
  })

  test('splits totals per player', () => {
    const totals = teamTotalsOver(days, '2026-10-05', '2026-10-31')
    expect(totals.members).toEqual(
      expect.arrayContaining([
        { playerId: 'a', boards: 1, attempts: 4 },
        { playerId: 'b', boards: 2, attempts: 9 },
      ]),
    )
    expect(totals.members).toHaveLength(2)
  })

  test('a failed board contributes 7, the attemptsFor sentinel', () => {
    const totals = teamTotalsOver(days, '2026-10-31', '2026-10-31')
    expect(totals.attempts).toBe(7)
    expect(totals.boards).toBe(1)
  })

  test('an empty window is zero boards rather than a throw', () => {
    expect(teamTotalsOver(days, '2026-09-01', '2026-09-30')).toEqual({
      boards: 0,
      attempts: 0,
      members: [],
    })
  })

  // THE SHORT-WINDOW CASE: two months of days, concatenated by the caller.
  test('accepts days concatenated from two monthly documents', () => {
    const totals = teamTotalsOver(days, '2026-10-31', '2026-11-30')
    expect(totals.boards).toBe(2)
    expect(totals.attempts).toBe(7 + 5)
  })

  // wordle-teams-rac: duplicate (playerId, puzzleDay) rows copied from v1 exist in
  // production, so two same-day entries are reachable. Counting both keeps that
  // defect visible rather than silent.
  test('the same player twice on one day accumulates rather than overwrites', () => {
    const dup = [
      {
        puzzleDay: '2026-10-05',
        entries: [
          { playerId: 'a', attempts: 3 },
          { playerId: 'a', attempts: 4 },
        ],
      },
    ]
    expect(teamTotalsOver(dup, '2026-10-05', '2026-10-05').members).toEqual([
      { playerId: 'a', boards: 2, attempts: 7 },
    ])
  })
})

/** A side with `boards` boards averaging exactly `avg`. */
const side = (boards: number, avg: number) => {
  const attempts = boards * avg
  // THE HELPER'S WHOLE VALUE IS THAT `avg` IS THE AVERAGE. A Math.round() here
  // would make that a lie for any pair that does not divide cleanly —
  // side(3, 4.5) would claim 4.5 and produce 14/3 = 4.7 — and the resulting test
  // would assert a winner the values do not produce, passing through the boards
  // tiebreak for a reason its author never intended. Loud at authoring time
  // beats silent at review time.
  if (!Number.isInteger(attempts)) {
    throw new Error(`side(${boards}, ${avg}): ${attempts} attempts is not a whole number`)
  }
  return { boards, attempts }
}

describe('outcomeOf', () => {
  test('LOWER average guesses wins — the challenger', () => {
    expect(outcomeOf(side(20, 3.5), side(20, 4.5))).toBe('challenger')
  })

  test('LOWER average guesses wins — the opponent', () => {
    expect(outcomeOf(side(20, 4.5), side(20, 3.5))).toBe('opponent')
  })

  test('void when the challenger is below the board floor', () => {
    expect(outcomeOf(side(MIN_CHALLENGE_BOARDS - 1, 2.0), side(20, 4.5))).toBe('void')
  })

  test('void when the opponent is below the board floor', () => {
    expect(outcomeOf(side(20, 4.5), side(MIN_CHALLENGE_BOARDS - 1, 2.0))).toBe('void')
  })

  test('AT the board floor is a real result, not void', () => {
    expect(outcomeOf(side(MIN_CHALLENGE_BOARDS, 3.0), side(MIN_CHALLENGE_BOARDS, 4.0))).toBe(
      'challenger',
    )
  })

  test('a 1dp tie is broken on boards played', () => {
    // Both average 4.0; the challenger played more.
    expect(outcomeOf({ boards: 30, attempts: 120 }, { boards: 20, attempts: 80 })).toBe('challenger')
    expect(outcomeOf({ boards: 20, attempts: 80 }, { boards: 30, attempts: 120 })).toBe('opponent')
  })

  test('equal averages and equal boards is a tie', () => {
    expect(outcomeOf({ boards: 20, attempts: 80 }, { boards: 20, attempts: 80 })).toBe('tie')
  })

  // Equal RAW averages, so this pins the boards tiebreak rather than the
  // rounding. Kept for that, under a name that says so.
  //
  // BOARDS WELL CLEAR OF MIN_CHALLENGE_BOARDS, deliberately. At 10 the
  // challenger sat exactly ON the floor, so a mutation of the floor comparison
  // failed this test as well as the floor test — measured. This test's subject
  // is the boards tiebreak and it has no business being sensitive to the floor
  // constant; raise MIN_CHALLENGE_BOARDS and it would fail with 'void', sending
  // the reader to the wrong place.
  test('equal raw averages fall through to the boards tiebreak', () => {
    const a = { boards: 20, attempts: 80 } // 4.00 exactly
    const b = { boards: 22, attempts: 88 } // 4.00 exactly
    expect(outcomeOf(a, b)).toBe('opponent') // b played more boards
  })

  // THE ROUNDING RULE ITSELF, and it needs raw quotients that genuinely DIFFER.
  // 99/25 = 3.96 and 202/50 = 4.04 both round to 4.0, so after rounding this is
  // a tie and the boards tiebreak gives 'opponent'. A raw-quotient comparison
  // would return 'challenger', since 3.96 < 4.04 — so this is the only test that
  // separates the two behaviours, and the test above does NOT, because its two
  // sides are exactly equal before rounding.
  //
  // WHY IT MATTERS: meanAttemptsOf rounds before comparison on purpose
  // (wordle-teams-iht.3.3) so a free teaser and a paid panel cannot disagree
  // about who is ahead. If that ever regressed, this assertion is what catches it.
  test('averages that DISPLAY the same are compared as the same', () => {
    const a = { boards: 25, attempts: 99 } // 3.96 raw, 4.0 displayed
    const b = { boards: 50, attempts: 202 } // 4.04 raw, 4.0 displayed
    expect(outcomeOf(a, b)).toBe('opponent')
  })
})

describe('challengesEnabled', () => {
  test('only the exact string enables it', () => {
    expect(challengesEnabled(CHALLENGES_ON)).toBe(true)
  })

  // FAILS TOWARD OFF: every near-miss is off, so a typo keeps the feature dark
  // rather than publishing it.
  test.each([undefined, '', 'TRUE', 'True', ' true', '1', 'yes', 'false'])('%j is off', (value) => {
    expect(challengesEnabled(value)).toBe(false)
  })
})
