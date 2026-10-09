import { describe, expect, test } from 'vitest'
import { leaguePageNudge, ordinal } from './league-nudges.ts'

const base = {
  unlocked: false,
  groupName: 'SLATE',
  rank: 3,
  average: 4.1,
  leaderAverage: 3.8,
  lastMonth: null,
}

describe('ordinal', () => {
  test.each([
    [1, '1st'],
    [2, '2nd'],
    [3, '3rd'],
    [4, '4th'],
    [11, '11th'],
    [12, '12th'],
    [13, '13th'],
    [21, '21st'],
    [22, '22nd'],
    [23, '23rd'],
    [101, '101st'],
    [111, '111th'],
  ])('%i -> %s', (n, expected) => {
    expect(ordinal(n)).toBe(expected)
  })
})

describe('leaguePageNudge', () => {
  test('unlocked (Pro or trial) never sees a nudge', () => {
    expect(
      leaguePageNudge({
        ...base,
        unlocked: true,
        lastMonth: { monthName: 'September', viewerRank: 2 },
      }),
    ).toBeNull()
  })

  test('a viewer with no group gets nothing', () => {
    expect(leaguePageNudge({ ...base, groupName: null })).toBeNull()
  })

  test('the leader is not behind', () => {
    expect(leaguePageNudge({ ...base, rank: 1, average: 3.8 })).toBeNull()
  })

  test('behind: the gap is formatted to one decimal despite float error', () => {
    // 4.1 - 3.8 === 0.2999999999999998 in IEEE doubles.
    expect(leaguePageNudge(base)).toEqual({
      origin: 'leagues-behind',
      text: 'SLATE is 0.3 guesses off the lead — see where you lose guesses.',
    })
  })

  test('behind: a whole-number gap still shows one decimal', () => {
    expect(leaguePageNudge({ ...base, average: 4.8, leaderAverage: 3.8 })?.text).toContain(
      '1.0 guesses',
    )
  })

  test('rank 2 tied with the leader on average reads as level, not 0.0 off', () => {
    expect(leaguePageNudge({ ...base, rank: 2, average: 3.8, leaderAverage: 3.8 })).toEqual({
      origin: 'leagues-behind',
      text: 'SLATE is level with the lead on average — see where you lose guesses.',
    })
  })

  test('behind needs both averages', () => {
    expect(leaguePageNudge({ ...base, average: null })).toBeNull()
    expect(leaguePageNudge({ ...base, leaderAverage: null })).toBeNull()
  })

  test('result only: last month finish when not behind', () => {
    expect(
      leaguePageNudge({
        ...base,
        rank: 1,
        average: 3.8,
        lastMonth: { monthName: 'September', viewerRank: 2 },
      }),
    ).toEqual({
      origin: 'league-result',
      text: 'SLATE finished 2nd in September — see where your own guesses go.',
    })
  })

  test('no result nudge after a 1st-place finish', () => {
    expect(
      leaguePageNudge({
        ...base,
        rank: 1,
        average: 3.8,
        lastMonth: { monthName: 'September', viewerRank: 1 },
      }),
    ).toBeNull()
  })

  test('no result nudge without a viewer rank last month', () => {
    expect(
      leaguePageNudge({ ...base, rank: 1, lastMonth: { monthName: 'September', viewerRank: null } }),
    ).toBeNull()
  })

  test('behind beats result: one nudge at most', () => {
    const n = leaguePageNudge({ ...base, lastMonth: { monthName: 'September', viewerRank: 2 } })
    expect(n?.origin).toBe('leagues-behind')
  })
})
