import { describe, expect, test } from 'vitest'
import {
  bestAndWorstDays,
  headToHead,
  memberAverages,
  memberConsistency,
  mostImproved,
  teamTrend,
  type TeamMonth,
} from './insights-team'

/** Builds an aggregate the way convex/lib/teamStats.ts would have. */
const month = (
  memberIds: string[],
  days: Record<string, Record<string, number>>,
): TeamMonth => {
  const totals = new Map(
    memberIds.map((playerId) => ({ playerId, boards: 0, attempts: 0, solved: 0, failed: 0 })).map((m) => [m.playerId, m]),
  )
  const rows = Object.entries(days)
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([puzzleDay, entries]) => ({
      puzzleDay,
      entries: memberIds
        .filter((id) => entries[id] !== undefined)
        .map((playerId) => {
          const attempts = entries[playerId]
          const total = totals.get(playerId)!
          total.boards += 1
          total.attempts += attempts
          if (attempts === 7) total.failed += 1
          else total.solved += 1
          return { playerId, attempts }
        }),
    }))
  return { members: memberIds.map((id) => totals.get(id)!), days: rows }
}

describe('headToHead', () => {
  test('counts wins, losses and ties on days both played', () => {
    const stats = month(['me', 'you'], {
      '2026-09-01': { me: 3, you: 4 }, // win
      '2026-09-02': { me: 5, you: 4 }, // loss
      '2026-09-03': { me: 4, you: 4 }, // tie
    })
    expect(headToHead(stats, 'me')).toEqual([
      { opponentId: 'you', shared: 3, wins: 1, losses: 1, ties: 1 },
    ])
  })

  /**
   * Scoring a skipped day as a win would hand the best record to whoever has the
   * least active teammates, which is the opposite of a head-to-head.
   */
  test('a day the opponent skipped is not a win — it is not counted at all', () => {
    const stats = month(['me', 'you'], {
      '2026-09-01': { me: 3, you: 4 },
      '2026-09-02': { me: 3 },
    })
    expect(headToHead(stats, 'me')[0]).toMatchObject({ shared: 1, wins: 1, losses: 0 })
  })

  test('a day the viewer skipped is not a loss either', () => {
    const stats = month(['me', 'you'], {
      '2026-09-01': { me: 3, you: 4 },
      '2026-09-02': { you: 2 },
    })
    expect(headToHead(stats, 'me')[0].shared).toBe(1)
  })

  test('the viewer is never their own opponent', () => {
    const stats = month(['me', 'you'], { '2026-09-01': { me: 3, you: 4 } })
    expect(headToHead(stats, 'me').map((r) => r.opponentId)).toEqual(['you'])
  })

  /** A solo team is the most common shape in this product, not an edge case. */
  test('a one-member team has no opponents rather than a divide by zero', () => {
    expect(headToHead(month(['me'], { '2026-09-01': { me: 3 } }), 'me')).toEqual([])
  })

  test('a month with no boards gives every teammate an empty record', () => {
    expect(headToHead(month(['me', 'you'], {}), 'me')).toEqual([
      { opponentId: 'you', shared: 0, wins: 0, losses: 0, ties: 0 },
    ])
  })
})

describe('memberAverages', () => {
  test('averages each member and the team', () => {
    const stats = month(['a', 'b'], {
      '2026-09-01': { a: 3, b: 5 },
      '2026-09-02': { a: 4 },
    })
    const result = memberAverages(stats)
    expect(result.members).toEqual([
      { playerId: 'a', boards: 2, meanAttempts: 3.5 },
      { playerId: 'b', boards: 1, meanAttempts: 5 },
    ])
    // 12 attempts over 3 boards.
    expect(result.teamMean).toBe(4)
  })

  test('a member with no boards is null, never zero', () => {
    // Zero would read as a perfect month rather than an absent one.
    const result = memberAverages(month(['a', 'b'], { '2026-09-01': { a: 3 } }))
    expect(result.members[1]).toEqual({ playerId: 'b', boards: 0, meanAttempts: null })
  })

  test('an empty month has a null team mean rather than NaN', () => {
    expect(memberAverages(month(['a'], {})).teamMean).toBeNull()
  })
})

describe('bestAndWorstDays', () => {
  test('finds the lowest and highest mean day', () => {
    const stats = month(['a', 'b'], {
      '2026-09-01': { a: 2, b: 2 },
      '2026-09-02': { a: 6, b: 6 },
      '2026-09-03': { a: 4, b: 4 },
    })
    const { best, worst } = bestAndWorstDays(stats)
    expect(best).toEqual({ puzzleDay: '2026-09-01', entries: 2, meanAttempts: 2 })
    expect(worst).toEqual({ puzzleDay: '2026-09-02', entries: 2, meanAttempts: 6 })
  })

  test('ties break on the earlier day, so the answer is stable', () => {
    const stats = month(['a'], { '2026-09-01': { a: 3 }, '2026-09-02': { a: 3 } })
    expect(bestAndWorstDays(stats).best?.puzzleDay).toBe('2026-09-01')
    expect(bestAndWorstDays(stats).worst?.puzzleDay).toBe('2026-09-01')
  })

  test('an empty month is null on both, not a day of NaN', () => {
    expect(bestAndWorstDays(month(['a'], {}))).toEqual({ best: null, worst: null })
  })
})

describe('memberConsistency', () => {
  test('reports each member’s mean and spread', () => {
    const stats = month(['a'], { '2026-09-01': { a: 3 }, '2026-09-02': { a: 5 } })
    expect(memberConsistency(stats)).toEqual([
      { playerId: 'a', boards: 2, meanAttempts: 4, spread: 1 },
    ])
  })

  test('a single board is zero spread rather than a divide by zero', () => {
    expect(memberConsistency(month(['a'], { '2026-09-01': { a: 4 } }))[0].spread).toBe(0)
  })

  test('a member with no boards is null on both', () => {
    const result = memberConsistency(month(['a', 'b'], { '2026-09-01': { a: 4 } }))
    expect(result[1]).toEqual({ playerId: 'b', boards: 0, meanAttempts: null, spread: null })
  })
})

describe('teamTrend', () => {
  test('is one point per month, oldest first', () => {
    const points = teamTrend([
      { month: '2026-09', stats: month(['a'], { '2026-09-01': { a: 4 } }) },
      { month: '2026-08', stats: month(['a'], { '2026-08-01': { a: 2 } }) },
    ])
    expect(points).toEqual([
      { month: '2026-08', boards: 1, meanAttempts: 2 },
      { month: '2026-09', boards: 1, meanAttempts: 4 },
    ])
  })

  test('a month nobody played is null rather than zero', () => {
    // Zero would draw the trend line down to a perfect month.
    expect(teamTrend([{ month: '2026-09', stats: month(['a'], {}) }])[0].meanAttempts).toBeNull()
  })
})

describe('mostImproved', () => {
  test('ranks by the FALL in attempts, best first', () => {
    const previous = month(['a', 'b'], { '2026-08-01': { a: 5, b: 4 } })
    const current = month(['a', 'b'], { '2026-09-01': { a: 3, b: 4 } })
    expect(mostImproved(previous, current)).toEqual([
      { playerId: 'a', from: 5, to: 3, delta: 2 },
      { playerId: 'b', from: 4, to: 4, delta: 0 },
    ])
  })

  test('someone who got worse has a negative delta and sorts last', () => {
    const previous = month(['a', 'b'], { '2026-08-01': { a: 3, b: 5 } })
    const current = month(['a', 'b'], { '2026-09-01': { a: 5, b: 3 } })
    expect(mostImproved(previous, current).map((i) => i.playerId)).toEqual(['b', 'a'])
  })

  /**
   * Otherwise a "most improved" list is led by whoever took a month off, whose
   * absence gets read as a score.
   */
  test('a member who did not play in one of the months is not ranked', () => {
    const previous = month(['a', 'b'], { '2026-08-01': { a: 5 } })
    const current = month(['a', 'b'], { '2026-09-01': { a: 3, b: 2 } })
    expect(mostImproved(previous, current).map((i) => i.playerId)).toEqual(['a'])
  })

  test('a new member with no previous month is not ranked', () => {
    const previous = month(['a'], { '2026-08-01': { a: 5 } })
    const current = month(['a', 'b'], { '2026-09-01': { a: 4, b: 2 } })
    expect(mostImproved(previous, current).map((i) => i.playerId)).toEqual(['a'])
  })

  test('two empty months rank nobody rather than throwing', () => {
    expect(mostImproved(month(['a'], {}), month(['a'], {}))).toEqual([])
  })
})
