// convex/lib/league.test.ts
/**
 * BOTH SIDES OF EVERY THRESHOLD. A floor tested from one side is vacuous, so
 * MIN_LEAGUE_BOARDS is asserted at 9 and 10. LOWER IS BETTER is asserted in both
 * directions because it is the easiest thing here to implement backwards.
 */
import { describe, expect, test } from 'vitest'
import {
  contributionOf,
  groupAverageOf,
  groupDelta,
  HOME_CARD_MAX_LEAGUES,
  LEAGUES_ON,
  lastDayOfMonth,
  leaguesEnabled,
  memberTotalsFor,
  MIN_LEAGUE_BOARDS,
  monthToClose,
  PICKER_INLINE_MAX,
  standingsOf,
  winnerOf,
} from './league.ts'

describe('the constants', () => {
  test('are the values the design approved', () => {
    expect(MIN_LEAGUE_BOARDS).toBe(10)
    expect(PICKER_INLINE_MAX).toBe(6)
    expect(HOME_CARD_MAX_LEAGUES).toBe(3)
  })
})

describe('leaguesEnabled', () => {
  test('only the exact string turns leagues on', () => {
    expect(leaguesEnabled(LEAGUES_ON)).toBe(true)
    for (const value of [undefined, '', 'TRUE', ' true', '1', 'yes']) {
      expect(leaguesEnabled(value)).toBe(false)
    }
  })
})

describe('lastDayOfMonth', () => {
  // monthRange(month).end is always '-31' — a query bound, not a calendar day.
  test('is the real last day, not -31', () => {
    expect(lastDayOfMonth('2026-02-11')).toBe('2026-02-28')
    expect(lastDayOfMonth('2026-09-30')).toBe('2026-09-30')
    expect(lastDayOfMonth('2026-10-07')).toBe('2026-10-31')
    expect(lastDayOfMonth('2028-02-10')).toBe('2028-02-29') // leap year
  })
})

describe('memberTotalsFor', () => {
  const crane = { groupId: 'crane', fromDay: '2026-10-08' }
  test('counts only boards inside an interval and inside the month', () => {
    const boards = [
      { puzzleDay: '2026-10-07', attempts: 3 }, // before joining
      { puzzleDay: '2026-10-08', attempts: 4 },
      { puzzleDay: '2026-10-20', attempts: 7 },
      { puzzleDay: '2026-11-01', attempts: 2 }, // next month
    ]
    expect(memberTotalsFor(boards, [crane], '2026-10')).toEqual({
      groupId: 'crane',
      boards: 2,
      attempts: 11,
    })
  })
  test('toDay is inclusive', () => {
    const left = { groupId: 'crane', fromDay: '2026-10-08', toDay: '2026-10-10' }
    const boards = [
      { puzzleDay: '2026-10-10', attempts: 3 },
      { puzzleDay: '2026-10-11', attempts: 3 },
    ]
    expect(memberTotalsFor(boards, [left], '2026-10')).toEqual({ groupId: 'crane', boards: 1, attempts: 3 })
  })
  test('two intervals in the same group in one month accumulate', () => {
    const a = { groupId: 'crane', fromDay: '2026-10-02', toDay: '2026-10-03' }
    const b = { groupId: 'crane', fromDay: '2026-10-10' }
    const boards = [
      { puzzleDay: '2026-10-03', attempts: 4 },
      { puzzleDay: '2026-10-05', attempts: 4 },
      { puzzleDay: '2026-10-12', attempts: 2 },
    ]
    expect(memberTotalsFor(boards, [a, b], '2026-10')).toEqual({ groupId: 'crane', boards: 2, attempts: 6 })
  })
  test('the group is the one covering the first in-month board, whatever the interval order', () => {
    // DELIBERATELY BREAKS the one-group-per-month invariant (spec 4.1) so that
    // "first covered board", "last covered board" and "intervals[0]" all differ.
    const slate = { groupId: 'slate', fromDay: '2026-10-15' }
    const craneEarly = { groupId: 'crane', fromDay: '2026-10-01', toDay: '2026-10-14' }
    const boards = [
      { puzzleDay: '2026-10-05', attempts: 3 },
      { puzzleDay: '2026-10-20', attempts: 4 },
    ]
    expect(memberTotalsFor(boards, [slate, craneEarly], '2026-10')?.groupId).toBe('crane')
  })
  test('null when nothing counts', () => {
    expect(memberTotalsFor([{ puzzleDay: '2026-10-01', attempts: 3 }], [crane], '2026-10')).toBeNull()
    expect(memberTotalsFor([], [crane], '2026-10')).toBeNull()
  })
})

describe('groupDelta', () => {
  test('null to row adds a contributor', () => {
    expect(groupDelta(null, { boards: 2, attempts: 8 })).toEqual({ boards: 2, attempts: 8, contributors: 1 })
  })
  test('row to row moves only the totals', () => {
    expect(groupDelta({ boards: 2, attempts: 8 }, { boards: 3, attempts: 10 })).toEqual({
      boards: 1,
      attempts: 2,
      contributors: 0,
    })
  })
  test('row to null removes the contributor', () => {
    expect(groupDelta({ boards: 2, attempts: 8 }, null)).toEqual({ boards: -2, attempts: -8, contributors: -1 })
  })
  test('null to null is zero', () => {
    expect(groupDelta(null, null)).toEqual({ boards: 0, attempts: 0, contributors: 0 })
  })
})

describe('groupAverageOf', () => {
  test('null below the floor, a 1dp average at it', () => {
    expect(groupAverageOf({ boards: MIN_LEAGUE_BOARDS - 1, attempts: 36 })).toBeNull()
    expect(groupAverageOf({ boards: MIN_LEAGUE_BOARDS, attempts: 41 })).toBe(4.1)
  })
})

describe('standingsOf', () => {
  const row = (groupId: string, order: number, boards: number, attempts: number, contributors = 1) => ({
    groupId,
    order,
    boards,
    attempts,
    contributors,
  })
  test('lower average ranks first', () => {
    const out = standingsOf([row('slate', 1, 10, 41), row('crane', 0, 10, 38)])
    expect(out.map((s) => [s.groupId, s.rank, s.average])).toEqual([
      ['crane', 1, 3.8],
      ['slate', 2, 4.1],
    ])
  })
  test('an equal 1dp average is broken on boards played, more first', () => {
    // 38/10 = 3.80 and 46/12 = 3.83 both display 3.8.
    const out = standingsOf([row('crane', 0, 10, 38), row('slate', 1, 12, 46)])
    expect(out.map((s) => s.groupId)).toEqual(['slate', 'crane'])
  })
  test('a full tie on average and boards falls back to display order', () => {
    const out = standingsOf([row('slate', 1, 10, 38), row('crane', 0, 10, 38)])
    expect(out.map((s) => [s.groupId, s.rank])).toEqual([
      ['crane', 1],
      ['slate', 2],
    ])
  })
  test('unranked groups follow, by boards then order, with progress', () => {
    const out = standingsOf([row('adieu', 2, 6, 24), row('orate', 4, 0, 0, 0), row('crane', 0, 10, 38), row('stare', 3, 6, 30)])
    expect(out.map((s) => [s.groupId, s.rank])).toEqual([
      ['crane', 1],
      ['adieu', null],
      ['stare', null],
      ['orate', null],
    ])
    expect(out[1].average).toBeNull()
  })
})

describe('winnerOf', () => {
  const s = (groupId: string, rank: number | null, average: number | null, boards: number) => ({
    groupId,
    rank,
    average,
    boards,
    attempts: 0,
    contributors: 1,
    order: 0,
  })
  test('the first ranked group', () => {
    expect(winnerOf([s('crane', 1, 3.8, 10), s('slate', 2, 3.9, 10)])).toBe('crane')
  })
  test('null when nobody qualified', () => {
    expect(winnerOf([s('crane', null, null, 4)])).toBeNull()
  })
  test('a tie on average but not boards still names the one with more boards', () => {
    expect(winnerOf([s('crane', 1, 3.8, 12), s('slate', 2, 3.8, 10)])).toBe('crane')
  })
  test('null on an exact tie of average AND boards', () => {
    expect(winnerOf([s('crane', 1, 3.8, 10), s('slate', 2, 3.8, 10)])).toBeNull()
  })
})

describe('contributionOf', () => {
  test('shift is the group average with the member minus without them', () => {
    // group 56/14 = 4.0; without the member 46/10 = 4.6 (exactly at the floor)
    // -> the member pulls the group's average down by 0.6
    expect(contributionOf({ boards: 4, attempts: 10 }, { boards: 14, attempts: 56 })).toEqual({
      mine: 2.5,
      group: 4,
      shift: -0.6,
    })
  })
  test('shift is positive when the member drags the group average up', () => {
    // group 60/14 = 4.3; without the member 40/10 = 4.0
    expect(contributionOf({ boards: 4, attempts: 20 }, { boards: 14, attempts: 60 }).shift).toBe(0.3)
  })
  test('shift is null when the group without the member is below the floor', () => {
    // 13 - 4 = 9 boards left: one under the floor. 14 - 4 = 10 is the case above.
    expect(contributionOf({ boards: 4, attempts: 10 }, { boards: 13, attempts: 52 }).shift).toBeNull()
    expect(contributionOf({ boards: 4, attempts: 10 }, { boards: 12, attempts: 40 }).shift).toBeNull()
  })
})

describe('monthToClose', () => {
  test('nothing on day 1, last month from day 2', () => {
    expect(monthToClose('2026-11-01', '2026-09-15')).toBeNull()
    expect(monthToClose('2026-11-02', '2026-09-15')).toBe('2026-10')
    expect(monthToClose('2027-01-05', '2026-09-15')).toBe('2026-12')
  })
  test('never a month before the league existed', () => {
    expect(monthToClose('2026-11-02', '2026-11-01')).toBeNull()
    expect(monthToClose('2026-11-02', '2026-10-31')).toBe('2026-10')
  })
})
