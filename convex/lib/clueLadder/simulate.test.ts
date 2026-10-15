import { describe, expect, test } from 'vitest'
import { createRng } from './rng.ts'
import {
  BAR_TEAM,
  checkBar,
  FAIL,
  formatReport,
  monthCredit,
  playDay,
  SEVEN_PLAYER_TEAM,
  simulate,
  STRATEGIES,
  type SimReport,
} from './simulate.ts'

describe('playDay', () => {
  const remaining = [24, 6, 2, 1]

  test('careful locks in at the proving clue and never fails', () => {
    const rng = createRng(1)
    for (let i = 0; i < 100; i++) expect(playDay(remaining, 1, rng)).toBe(4)
  })

  test('bold locks in when two remain: clue 3 or X, about half each', () => {
    const rng = createRng(2)
    const results = Array.from({ length: 2000 }, () => playDay(remaining, 2, rng))
    expect(new Set(results)).toEqual(new Set([3, FAIL]))
    const wins = results.filter((r) => r === 3).length / results.length
    expect(wins).toBeGreaterThan(0.45)
    expect(wins).toBeLessThan(0.55)
  })
})

describe('simulate', () => {
  const report = simulate({ months: 20, daysPerMonth: 28, team: SEVEN_PLAYER_TEAM, seed: 1 })

  test('counts every player-day exactly once', () => {
    const total = Object.values(report.scoreCounts).reduce(
      (sum, counts) => sum + counts.reduce((a, b) => a + b, 0),
      0,
    )
    expect(total).toBe(20 * 28 * SEVEN_PLAYER_TEAM.length)
    expect(report.days).toBe(20 * 28)
  })

  test('careful players never fail', () => {
    expect(report.failRate.careful).toBe(0)
  })

  test('month win shares sum to 1', () => {
    const sum = Object.values(report.monthWinShare).reduce((a, b) => a + b, 0)
    expect(sum).toBeCloseTo(1, 9)
  })

  test('rates are within [0, 1]', () => {
    for (const r of [...Object.values(report.failRate), report.tieForFirstRate, report.fallbackRate]) {
      expect(r).toBeGreaterThanOrEqual(0)
      expect(r).toBeLessThanOrEqual(1)
    }
  })

  test('the same seed gives the same report', () => {
    expect(simulate({ months: 5, daysPerMonth: 28, team: SEVEN_PLAYER_TEAM, seed: 9 })).toEqual(
      simulate({ months: 5, daysPerMonth: 28, team: SEVEN_PLAYER_TEAM, seed: 9 }),
    )
  })
})

describe('checkBar', () => {
  const base: SimReport = {
    days: 100,
    players: { careful: 2, bold: 2, reckless: 1, mixed: 2 },
    scoreCounts: { careful: [], bold: [], reckless: [], mixed: [] },
    failRate: { careful: 0, bold: 0.25, reckless: 0.4, mixed: 0.2 },
    meanScore: { careful: 4.5, bold: 4, reckless: 4.2, mixed: 4.3 },
    monthWinShare: { careful: 0.3, bold: 0.4, reckless: 0.1, mixed: 0.2 },
    tieForFirstRate: 0.75,
    ladderLengthCounts: [0, 0, 0, 0, 40, 40, 20],
    fallbackRate: 0,
  }

  test('passes at the bar', () => {
    expect(checkBar(base).pass).toBe(true)
  })

  const wins = (share: Partial<SimReport['monthWinShare']>): SimReport => ({
    ...base,
    monthWinShare: { ...base.monthWinShare, ...share },
  })
  const bold = (rate: number): SimReport => ({ ...base, failRate: { ...base.failRate, bold: rate } })

  test('each check fails on its own side of the threshold', () => {
    // careful month-win share: 0.10 to 0.50
    expect(checkBar(wins({ careful: 0.09 })).pass).toBe(false)
    expect(checkBar(wins({ careful: 0.1 })).pass).toBe(true)
    expect(checkBar(wins({ careful: 0.5, bold: 0.2 })).pass).toBe(true)
    expect(checkBar(wins({ careful: 0.51, bold: 0.2 })).pass).toBe(false)
    // no type over half
    expect(checkBar(wins({ bold: 0.5 })).pass).toBe(true)
    expect(checkBar(wins({ bold: 0.51 })).pass).toBe(false)
    expect(checkBar(wins({ reckless: 0.51 })).pass).toBe(false)
    // bold fail rate: 0.15 to 0.35
    expect(checkBar(bold(0.14)).pass).toBe(false)
    expect(checkBar(bold(0.15)).pass).toBe(true)
    expect(checkBar(bold(0.35)).pass).toBe(true)
    expect(checkBar(bold(0.36)).pass).toBe(false)
  })

  test('daily ties do not affect the verdict', () => {
    expect(checkBar({ ...base, tieForFirstRate: 0.99 }).pass).toBe(true)
  })

  test('formatReport names every check and the verdict', () => {
    const text = formatReport(base, checkBar(base))
    expect(text).toContain('careful month-win share')
    expect(text).toContain('largest month-win share')
    expect(text).toContain('bold fail rate')
    expect(text).toContain('VERDICT: PASS')
  })

  test('formatReport leaves out the verdict for an unjudged team', () => {
    expect(formatReport(base)).not.toContain('VERDICT')
  })
})

test('the judged team has exactly one player of each type', () => {
  expect([...BAR_TEAM].sort()).toEqual([...STRATEGIES].sort())
})

describe('monthCredit', () => {
  test('a sole top total takes the whole month', () => {
    expect(monthCredit([10, 14, 9], ['careful', 'bold', 'mixed'])).toEqual([['bold', 1]])
  })

  test('tied top totals split the month, whatever the team order', () => {
    expect(monthCredit([14, 9, 14], ['careful', 'mixed', 'bold'])).toEqual([
      ['careful', 0.5],
      ['bold', 0.5],
    ])
    expect(monthCredit([14, 14, 9], ['bold', 'careful', 'mixed'])).toEqual([
      ['bold', 0.5],
      ['careful', 0.5],
    ])
  })
})
