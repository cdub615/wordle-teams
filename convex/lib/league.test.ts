// convex/lib/league.test.ts
/**
 * BOTH SIDES OF EVERY THRESHOLD. A floor tested from one side is vacuous, so
 * MIN_LEAGUE_BOARDS is asserted at 9 and 10. LOWER IS BETTER is asserted in both
 * directions because it is the easiest thing here to implement backwards.
 */
import { describe, expect, test } from 'vitest'
import {
  contributionOf,
  contributionUnlocked,
  groupAverageOf,
  groupDelta,
  HOME_CARD_MAX_LEAGUES,
  isLargeLeague,
  LARGE_LEAGUE_TOP,
  largeLeagueSlice,
  LEAGUES_ON,
  lastDayOfMonth,
  leaguesEnabled,
  membershipOf,
  memberTotalsFor,
  MIN_LEAGUE_BOARDS,
  monthToClose,
  PICKER_INLINE_MAX,
  planJoin,
  planLeave,
  planSwitch,
  standingsOf,
  winnerOf,
  yearMonthOf,
} from './league.ts'
import type { Standing } from './league.ts'

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

describe('contributionUnlocked', () => {
  test.each([
    [false, false, false],
    [true, false, true],
    [false, true, true],
    [true, true, true],
  ])('isPro=%s trialActive=%s -> %s', (isPro, trialActive, expected) => {
    expect(contributionUnlocked({ isPro, trialActive })).toBe(expected)
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

describe('planJoin', () => {
  const today = '2026-10-07'
  test('a first join opens from tomorrow and counts +1', () => {
    expect(planJoin([], today, 'crane')).toEqual({
      ops: [{ op: 'insert', groupId: 'crane', fromDay: '2026-10-08' }],
      countFrom: null,
      countTo: 'crane',
    })
  })
  test('refused while a live interval exists', () => {
    expect(planJoin([{ groupId: 'crane', fromDay: '2026-10-01' }], today, 'slate')).toEqual({
      refused: 'ALREADY_IN_LEAGUE',
    })
    expect(planJoin([{ groupId: 'crane', fromDay: '2026-10-08' }], today, 'crane')).toEqual({
      refused: 'ALREADY_IN_LEAGUE',
    })
  })
  test('rejoining the SAME group after leaving this month opens tomorrow', () => {
    const left = [{ groupId: 'crane', fromDay: '2026-10-02', toDay: '2026-10-05' }]
    expect(planJoin(left, today, 'crane')).toMatchObject({
      ops: [{ op: 'insert', groupId: 'crane', fromDay: '2026-10-08' }],
    })
  })
  test('joining a DIFFERENT group after leaving this month opens on the 1st', () => {
    const left = [{ groupId: 'crane', fromDay: '2026-10-02', toDay: '2026-10-05' }]
    expect(planJoin(left, today, 'slate')).toMatchObject({
      ops: [{ op: 'insert', groupId: 'slate', fromDay: '2026-11-01' }],
    })
  })
  test('an interval that ended ON the 1st still holds this month', () => {
    const left = [{ groupId: 'crane', fromDay: '2026-09-02', toDay: '2026-10-01' }]
    expect(planJoin(left, today, 'slate')).toMatchObject({
      ops: [{ op: 'insert', groupId: 'slate', fromDay: '2026-11-01' }],
    })
  })
  test('an interval that ended last month does not hold this month', () => {
    const old = [{ groupId: 'crane', fromDay: '2026-09-02', toDay: '2026-09-30' }]
    expect(planJoin(old, today, 'slate')).toMatchObject({
      ops: [{ op: 'insert', groupId: 'slate', fromDay: '2026-10-08' }],
    })
  })
})

describe('planSwitch', () => {
  const today = '2026-10-07'
  test('refused when not a member', () => {
    expect(planSwitch([], today, 'slate')).toEqual({ refused: 'NOT_IN_LEAGUE' })
  })
  test('started only: close at month end, open on the 1st', () => {
    expect(planSwitch([{ groupId: 'crane', fromDay: '2026-09-01' }], today, 'slate')).toEqual({
      ops: [
        { op: 'patch', index: 0, toDay: '2026-10-31' },
        { op: 'insert', groupId: 'slate', fromDay: '2026-11-01' },
      ],
      countFrom: 'crane',
      countTo: 'slate',
    })
  })
  test('started only, same group: nothing', () => {
    expect(planSwitch([{ groupId: 'crane', fromDay: '2026-09-01' }], today, 'crane')).toEqual({
      ops: [],
      countFrom: null,
      countTo: null,
    })
  })
  test('pending only (just joined): retarget it in place', () => {
    expect(planSwitch([{ groupId: 'crane', fromDay: '2026-10-08' }], today, 'slate')).toEqual({
      ops: [{ op: 'retarget', index: 0, groupId: 'slate' }],
      countFrom: 'crane',
      countTo: 'slate',
    })
  })
  test('started + pending: switching again replaces the pending group', () => {
    const state = [
      { groupId: 'crane', fromDay: '2026-09-01', toDay: '2026-10-31' },
      { groupId: 'slate', fromDay: '2026-11-01' },
    ]
    expect(planSwitch(state, today, 'adieu')).toEqual({
      ops: [{ op: 'retarget', index: 1, groupId: 'adieu' }],
      countFrom: 'slate',
      countTo: 'adieu',
    })
  })
  test('started + pending: switching to the pending group again is a no-op', () => {
    const state = [
      { groupId: 'crane', fromDay: '2026-09-01', toDay: '2026-10-31' },
      { groupId: 'slate', fromDay: '2026-11-01' },
    ]
    expect(planSwitch(state, today, 'slate')).toEqual({ ops: [], countFrom: null, countTo: null })
  })
  test('started + pending: switching back cancels the pending switch', () => {
    const state = [
      { groupId: 'crane', fromDay: '2026-09-01', toDay: '2026-10-31' },
      { groupId: 'slate', fromDay: '2026-11-01' },
    ]
    expect(planSwitch(state, today, 'crane')).toEqual({
      ops: [
        { op: 'delete', index: 1 },
        { op: 'reopen', index: 0 },
      ],
      countFrom: 'slate',
      countTo: 'crane',
    })
  })
  test('closed history before the live interval is ignored', () => {
    const state = [
      { groupId: 'adieu', fromDay: '2026-08-01', toDay: '2026-08-31' },
      { groupId: 'crane', fromDay: '2026-09-01' },
    ]
    expect(planSwitch(state, today, 'slate')).toMatchObject({
      ops: [
        { op: 'patch', index: 1, toDay: '2026-10-31' },
        { op: 'insert', groupId: 'slate', fromDay: '2026-11-01' },
      ],
    })
  })
})

describe('membershipOf', () => {
  const today = '2026-10-07'
  test('null when not a member', () => {
    expect(membershipOf([], today)).toBeNull()
    expect(membershipOf([{ groupId: 'crane', fromDay: '2026-09-01', toDay: '2026-09-30' }], today)).toBeNull()
  })
  test('started only', () => {
    expect(membershipOf([{ groupId: 'crane', fromDay: '2026-09-01' }], today)).toEqual({
      groupId: 'crane',
      since: '2026-09-01',
      pendingGroupId: null,
      pendingFrom: null,
    })
  })
  test('pending only reports the group it will start in', () => {
    expect(membershipOf([{ groupId: 'crane', fromDay: '2026-10-08' }], today)).toEqual({
      groupId: 'crane',
      since: '2026-10-08',
      pendingGroupId: null,
      pendingFrom: null,
    })
  })
  test('a pending switch', () => {
    const state = [
      { groupId: 'crane', fromDay: '2026-09-01', toDay: '2026-10-31' },
      { groupId: 'slate', fromDay: '2026-11-01' },
    ]
    expect(membershipOf(state, today)).toEqual({
      groupId: 'crane',
      since: '2026-09-01',
      pendingGroupId: 'slate',
      pendingFrom: '2026-11-01',
    })
  })
})

describe('planLeave', () => {
  const today = '2026-10-07'
  test('refused when not a member', () => {
    expect(planLeave([], today)).toEqual({ refused: 'NOT_IN_LEAGUE' })
  })
  test('started only: ends today', () => {
    expect(planLeave([{ groupId: 'crane', fromDay: '2026-09-01' }], today)).toEqual({
      ops: [{ op: 'patch', index: 0, toDay: '2026-10-07' }],
      countFrom: 'crane',
      countTo: null,
    })
  })
  test('pending only: deleted, never started', () => {
    expect(planLeave([{ groupId: 'crane', fromDay: '2026-10-08' }], today)).toEqual({
      ops: [{ op: 'delete', index: 0 }],
      countFrom: 'crane',
      countTo: null,
    })
  })
  test('started + pending: ends today and drops the pending switch', () => {
    const state = [
      { groupId: 'crane', fromDay: '2026-09-01', toDay: '2026-10-31' },
      { groupId: 'slate', fromDay: '2026-11-01' },
    ]
    expect(planLeave(state, today)).toEqual({
      ops: [
        { op: 'patch', index: 0, toDay: '2026-10-07' },
        { op: 'delete', index: 1 },
      ],
      countFrom: 'slate',
      countTo: null,
    })
  })
})

describe('leaving ends membership the same day', () => {
  const today = '2026-10-07'
  const left = [{ groupId: 'crane', fromDay: '2026-09-01', toDay: today }]
  test('membershipOf is null right after planLeave', () => {
    expect(membershipOf(left, today)).toBeNull()
  })
  test('rejoining the SAME group the same day opens tomorrow', () => {
    expect(planJoin(left, today, 'crane')).toEqual({
      ops: [{ op: 'insert', groupId: 'crane', fromDay: '2026-10-08' }],
      countFrom: null,
      countTo: 'crane',
    })
  })
  test('joining a DIFFERENT group the same day opens on the 1st of next month', () => {
    expect(planJoin(left, today, 'slate')).toMatchObject({
      ops: [{ op: 'insert', groupId: 'slate', fromDay: '2026-11-01' }],
    })
  })
  test('leaving twice is refused', () => {
    expect(planLeave(left, today)).toEqual({ refused: 'NOT_IN_LEAGUE' })
  })
  test('a switch stays live on the last day of the month', () => {
    const state = [
      { groupId: 'crane', fromDay: '2026-09-01', toDay: '2026-10-31' },
      { groupId: 'slate', fromDay: '2026-11-01' },
    ]
    expect(membershipOf(state, '2026-10-31')).toEqual({
      groupId: 'crane',
      since: '2026-09-01',
      pendingGroupId: 'slate',
      pendingFrom: '2026-11-01',
    })
  })
  test('a board played on the leave day still counts', () => {
    const interval = [{ groupId: 'crane', fromDay: '2026-10-01', toDay: '2026-10-07' }]
    expect(memberTotalsFor([{ puzzleDay: '2026-10-07', attempts: 3 }], interval, '2026-10')).toEqual({
      groupId: 'crane',
      boards: 1,
      attempts: 3,
    })
  })
})

describe('a closed interval is live only for a genuine month-boundary switch', () => {
  const today = '2026-10-07'
  const leftThenSame = [
    { groupId: 'crane', fromDay: '2026-09-01', toDay: '2026-10-07' },
    { groupId: 'crane', fromDay: '2026-10-08' },
  ]
  const leftThenOther = [
    { groupId: 'crane', fromDay: '2026-09-01', toDay: '2026-10-07' },
    { groupId: 'slate', fromDay: '2026-11-01' },
  ]
  test('leave then same-day rejoin of the same group reads as pending only', () => {
    expect(membershipOf(leftThenSame, today)).toEqual({
      groupId: 'crane',
      since: '2026-10-08',
      pendingGroupId: null,
      pendingFrom: null,
    })
  })
  test('leave then rejoin, then switch: moves the pending interval to the 1st', () => {
    expect(planSwitch(leftThenSame, today, 'slate')).toEqual({
      ops: [
        { op: 'delete', index: 1 },
        { op: 'insert', groupId: 'slate', fromDay: '2026-11-01' },
      ],
      countFrom: 'crane',
      countTo: 'slate',
    })
  })
  test('leave then join a different group, membership is that pending group', () => {
    expect(membershipOf(leftThenOther, today)).toEqual({
      groupId: 'slate',
      since: '2026-11-01',
      pendingGroupId: null,
      pendingFrom: null,
    })
  })
  test('leave then join a different group, then switch back: reopens from tomorrow, not the 1st', () => {
    expect(planSwitch(leftThenOther, today, 'crane')).toEqual({
      ops: [
        { op: 'delete', index: 1 },
        { op: 'insert', groupId: 'crane', fromDay: '2026-10-08' },
      ],
      countFrom: 'slate',
      countTo: 'crane',
    })
  })
  test('a genuine switch is live on the last day of the month', () => {
    const state = [
      { groupId: 'crane', fromDay: '2026-09-01', toDay: '2026-10-31' },
      { groupId: 'slate', fromDay: '2026-11-01' },
    ]
    expect(membershipOf(state, '2026-10-31')).toMatchObject({ groupId: 'crane', pendingGroupId: 'slate' })
  })
  const pinned = [
    { groupId: 'crane', fromDay: '2026-09-01', toDay: '2026-10-31' },
    { groupId: 'crane', fromDay: '2026-11-01' },
  ]
  test('PINNED: a last-day leave then same-day rejoin reads as a switch, but never reports one to the same group', () => {
    expect(membershipOf(pinned, '2026-10-31')).toEqual({
      groupId: 'crane',
      since: '2026-09-01',
      pendingGroupId: null,
      pendingFrom: null,
    })
  })
  test('PINNED: switching to the same group nets to no count move, with the same ops', () => {
    expect(planSwitch(pinned, '2026-10-31', 'crane')).toEqual({
      ops: [
        { op: 'delete', index: 1 },
        { op: 'reopen', index: 0 },
      ],
      countFrom: null,
      countTo: null,
    })
  })
  test('PINNED: leaving patches, deletes the pending one, and counts crane out', () => {
    expect(planLeave(pinned, '2026-10-31')).toEqual({
      ops: [
        { op: 'patch', index: 0, toDay: '2026-10-31' },
        { op: 'delete', index: 1 },
      ],
      countFrom: 'crane',
      countTo: null,
    })
  })
  const genuine = [
    { groupId: 'crane', fromDay: '2026-09-01', toDay: '2026-10-31' },
    { groupId: 'slate', fromDay: '2026-11-01' },
  ]
  test('joining is refused while a genuine switch is pending', () => {
    expect(planJoin(genuine, '2026-10-07', 'adieu')).toEqual({ refused: 'ALREADY_IN_LEAGUE' })
  })
  test('input order does not matter', () => {
    const reversed = [genuine[1], genuine[0]]
    expect(membershipOf(reversed, '2026-10-07')).toEqual(membershipOf(genuine, '2026-10-07'))
    expect(planSwitch(reversed, '2026-10-07', 'crane')).toEqual({
      ops: [
        { op: 'delete', index: 0 },
        { op: 'reopen', index: 1 },
      ],
      countFrom: 'slate',
      countTo: 'crane',
    })
  })
})

describe('yearMonthOf', () => {
  test('splits YYYY-MM into numbers', () => {
    expect(yearMonthOf('2026-09')).toEqual({ year: 2026, month: 9 })
  })
})

describe('isLargeLeague', () => {
  test('a word league is large whatever its size', () => {
    expect(isLargeLeague('answer-words', 0)).toBe(true)
    expect(isLargeLeague('answer-words', 5)).toBe(true)
  })
  test('a fixed league is large only above PICKER_INLINE_MAX, from both sides', () => {
    expect(isLargeLeague('fixed', PICKER_INLINE_MAX)).toBe(false)
    expect(isLargeLeague(undefined, PICKER_INLINE_MAX)).toBe(false)
    expect(isLargeLeague('fixed', PICKER_INLINE_MAX + 1)).toBe(true)
    expect(isLargeLeague(undefined, PICKER_INLINE_MAX + 1)).toBe(true)
  })
})

describe('largeLeagueSlice', () => {
  /** n ranked groups g1..gn (best first), then m unranked u1..um. */
  function table(n: number, m = 0): Standing[] {
    const ranked = Array.from({ length: n }, (_, i) => ({ groupId: `g${i + 1}`, order: i, boards: 20, attempts: 60 + i, contributors: 1, average: 3 + i / 10, rank: i + 1 }))
    const unranked = Array.from({ length: m }, (_, i) => ({ groupId: `u${i + 1}`, order: 100 + i, boards: 5, attempts: 20, contributors: 1, average: null, rank: null }))
    return [...ranked, ...unranked]
  }
  const ids = (rows: Standing[]) => rows.map((s) => s.groupId)

  test('LARGE_LEAGUE_TOP is 10', () => {
    expect(LARGE_LEAGUE_TOP).toBe(10)
  })
  test('cuts to the top 10 ranked groups', () => {
    const out = largeLeagueSlice(table(12), null)
    expect(ids(out.shown)).toEqual(['g1', 'g2', 'g3', 'g4', 'g5', 'g6', 'g7', 'g8', 'g9', 'g10'])
  })
  test('adds the viewer outside the top 10', () => {
    const out = largeLeagueSlice(table(12), 'g12')
    expect(out.shown).toHaveLength(10)
    expect(out.viewer?.groupId).toBe('g12')
    expect(out.viewer?.rank).toBe(12)
  })
  test('does not duplicate a viewer inside the top 10', () => {
    for (const g of ['g1', 'g10']) {
      const out = largeLeagueSlice(table(12), g)
      expect(out.viewer).toBeNull()
      expect(ids(out.shown).filter((id) => id === g)).toEqual([g])
    }
  })
  test('adds an unranked viewer, and never lists unranked groups in shown', () => {
    const out = largeLeagueSlice(table(3, 2), 'u2')
    expect(ids(out.shown)).toEqual(['g1', 'g2', 'g3'])
    expect(out.viewer).toMatchObject({ groupId: 'u2', rank: null })
  })
  test('counts the unranked active groups', () => {
    expect(largeLeagueSlice(table(12, 3), null).unrankedCount).toBe(3)
    expect(largeLeagueSlice(table(2), null).unrankedCount).toBe(0)
  })
  test("does not count the viewer's own unranked group", () => {
    expect(largeLeagueSlice(table(12, 3), 'u2').unrankedCount).toBe(2)
    expect(largeLeagueSlice(table(12, 1), 'u1').unrankedCount).toBe(0)
    expect(largeLeagueSlice(table(12, 3), 'g12').unrankedCount).toBe(3)
  })
  test('no viewer, or a viewer with no row this month, adds nothing', () => {
    expect(largeLeagueSlice(table(12), null).viewer).toBeNull()
    expect(largeLeagueSlice(table(12), 'absent').viewer).toBeNull()
  })
})
