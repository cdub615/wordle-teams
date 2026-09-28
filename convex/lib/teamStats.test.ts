import { describe, expect, test } from 'vitest'
import { aggregateTeamMonth, meanAttemptsOf, sameStats, teamRank } from './teamStats.ts'
import type { StatsInput } from './teamStats.ts'

const solved = (playerId: string, puzzleDay: string, n: number): StatsInput => ({
  playerId,
  puzzleDay,
  answer: 'SPEED',
  guesses: ['CRANE', ...Array.from({ length: n - 2 }, () => 'MOIST'), 'SPEED'].slice(0, n),
})

const failed = (playerId: string, puzzleDay: string): StatsInput => ({
  playerId,
  puzzleDay,
  answer: 'SPEED',
  guesses: ['CRANE', 'MOIST', 'MOIST', 'MOIST', 'MOIST', 'MOIST'],
})

describe('aggregateTeamMonth', () => {
  test('totals each member and keeps the per-day detail', () => {
    const stats = aggregateTeamMonth({
      memberIds: ['a', 'b'],
      scores: [solved('a', '2026-09-01', 3), solved('b', '2026-09-01', 5), solved('a', '2026-09-02', 4)],
    })
    expect(stats.members).toEqual([
      { playerId: 'a', boards: 2, attempts: 7, solved: 2, failed: 0 },
      { playerId: 'b', boards: 1, attempts: 5, solved: 1, failed: 0 },
    ])
    expect(stats.days).toEqual([
      {
        puzzleDay: '2026-09-01',
        entries: [
          { playerId: 'a', attempts: 3 },
          { playerId: 'b', attempts: 5 },
        ],
      },
      { puzzleDay: '2026-09-02', entries: [{ playerId: 'a', attempts: 4 }] },
    ])
  })

  test('a failure is 7 attempts and counts as failed', () => {
    const stats = aggregateTeamMonth({ memberIds: ['a'], scores: [failed('a', '2026-09-01')] })
    expect(stats.members[0]).toEqual({
      playerId: 'a',
      boards: 1,
      attempts: 7,
      solved: 0,
      failed: 1,
    })
  })

  /**
   * Dropping them would make "how many teammates did I beat today" silently
   * exclude everyone who did not play — the opposite of what that sentence means.
   */
  test('a member with no boards is still a member, with zeroes', () => {
    const stats = aggregateTeamMonth({ memberIds: ['a', 'b'], scores: [solved('a', '2026-09-01', 3)] })
    expect(stats.members).toHaveLength(2)
    expect(stats.members[1]).toEqual({ playerId: 'b', boards: 0, attempts: 0, solved: 0, failed: 0 })
  })

  test('a board from someone off the roster is discarded', () => {
    const stats = aggregateTeamMonth({
      memberIds: ['a'],
      scores: [solved('a', '2026-09-01', 3), solved('departed', '2026-09-01', 2)],
    })
    expect(stats.members).toHaveLength(1)
    expect(stats.days[0].entries).toEqual([{ playerId: 'a', attempts: 3 }])
  })

  test('a row with no answer does not break the totals', () => {
    const stats = aggregateTeamMonth({
      memberIds: ['a'],
      scores: [{ playerId: 'a', puzzleDay: '2026-09-01', guesses: ['CRANE', 'SPEED'] }],
    })
    expect(Number.isFinite(stats.members[0].attempts)).toBe(true)
    expect(stats.members[0].boards).toBe(1)
  })

  test('no scores at all is every member at zero, not an empty document', () => {
    const stats = aggregateTeamMonth({ memberIds: ['a', 'b'], scores: [] })
    expect(stats.days).toEqual([])
    expect(stats.members.map((m) => m.boards)).toEqual([0, 0])
  })

  /**
   * DETERMINISM IS WHAT MAKES THE ROLLUP IDEMPOTENT. Convex returns rows in index
   * order, which is neither roster order nor the order they were written; if the
   * output reshuffled, sameStats would report a difference every hour and the
   * cron would burn a write on every team on every run.
   */
  test('is identical however the rows are ordered', () => {
    const rows = [
      solved('b', '2026-09-02', 4),
      solved('a', '2026-09-01', 3),
      solved('a', '2026-09-02', 5),
      solved('b', '2026-09-01', 2),
    ]
    const forward = aggregateTeamMonth({ memberIds: ['a', 'b'], scores: rows })
    const backward = aggregateTeamMonth({ memberIds: ['a', 'b'], scores: [...rows].reverse() })
    expect(JSON.stringify(forward)).toBe(JSON.stringify(backward))
    expect(sameStats(forward, backward)).toBe(true)
  })

  test('days sort chronologically across a month boundary', () => {
    const stats = aggregateTeamMonth({
      memberIds: ['a'],
      scores: [solved('a', '2026-09-10', 3), solved('a', '2026-09-02', 3)],
    })
    expect(stats.days.map((d) => d.puzzleDay)).toEqual(['2026-09-02', '2026-09-10'])
  })

  test('entries within a day follow roster order, not arrival order', () => {
    const stats = aggregateTeamMonth({
      memberIds: ['a', 'b', 'c'],
      scores: [solved('c', '2026-09-01', 3), solved('a', '2026-09-01', 4)],
    })
    expect(stats.days[0].entries.map((e) => e.playerId)).toEqual(['a', 'c'])
  })
})

describe('sameStats', () => {
  /**
   * The regression that cost the whole saving. Convex returns a stored document
   * with its keys in the SCHEMA's order, not the order these literals are
   * written in, so a JSON.stringify comparison reported a difference every single
   * time and the hourly cron rewrote every team's document on every run.
   */
  test('ignores object key order, because a stored document comes back reordered', () => {
    const computed = aggregateTeamMonth({ memberIds: ['a'], scores: [solved('a', '2026-09-01', 3)] })
    const asStored = {
      members: computed.members.map((m) => ({
        failed: m.failed,
        playerId: m.playerId,
        boards: m.boards,
        attempts: m.attempts,
        solved: m.solved,
      })),
      days: computed.days.map((d) => ({
        entries: d.entries.map((e) => ({ attempts: e.attempts, playerId: e.playerId })),
        puzzleDay: d.puzzleDay,
      })),
    }
    expect(JSON.stringify(asStored)).not.toBe(JSON.stringify(computed))
    expect(sameStats(computed, asStored)).toBe(true)
  })

  test('is true for equal aggregates, so an unchanged month costs no write', () => {
    const of = () => aggregateTeamMonth({ memberIds: ['a'], scores: [solved('a', '2026-09-01', 3)] })
    expect(sameStats(of(), of())).toBe(true)
  })

  test('and false as soon as a single attempt moves', () => {
    const before = aggregateTeamMonth({ memberIds: ['a'], scores: [solved('a', '2026-09-01', 3)] })
    const after = aggregateTeamMonth({ memberIds: ['a'], scores: [solved('a', '2026-09-01', 4)] })
    expect(sameStats(before, after)).toBe(false)
  })

  test('and false when a member joins with no boards', () => {
    const before = aggregateTeamMonth({ memberIds: ['a'], scores: [] })
    const after = aggregateTeamMonth({ memberIds: ['a', 'b'], scores: [] })
    expect(sameStats(before, after)).toBe(false)
  })
})

/**
 * teamRank — THE FREE TIER'S ONE REAL FIGURE (wordle-teams-iht.3.3).
 *
 * "You're 3rd of 5 this month", computed on the server because ranking needs
 * every member's totals and those are exactly what teamMonth stops sending to a
 * free viewer (wordle-teams-iht.3.2). A client-side rank would undo that gate.
 *
 * WHAT THESE PIN IS MOSTLY THE EDGES, and deliberately so: the happy path is one
 * comparison, while every way this sentence can quietly LIE to a reader is a
 * case somebody has to choose an answer for.
 */
const member = (playerId: string, boards: number, attempts: number) => ({
  playerId,
  boards,
  attempts,
  solved: boards,
  failed: 0,
})

describe('teamRank', () => {
  test('fewer attempts is better, and the reader is counted from the front', () => {
    const rank = teamRank(
      [member('me', 10, 35), member('a', 10, 30), member('b', 10, 40)],
      'me',
    )
    // 3.5 against 3.0 and 4.0: one ahead, three ranked.
    expect(rank).toEqual({ kind: 'ranked', rank: 2, of: 3 })
  })

  test('the denominator counts who PLAYED, not the roster', () => {
    // "3rd of 5" on a team where only two people have played is a lie about the
    // reader, and roster size is the number a careless version reaches for.
    const rank = teamRank(
      [member('me', 10, 35), member('a', 10, 30), member('idle', 0, 0), member('idle2', 0, 0)],
      'me',
    )
    expect(rank).toEqual({ kind: 'ranked', rank: 2, of: 2 })
  })

  test('a viewer who has not played is absent, never last', () => {
    // "Last of 5" for someone who simply has not started is the opposite of a
    // reason to come back, and this is the free tier's re-engagement hook.
    expect(teamRank([member('me', 0, 0), member('a', 10, 30)], 'me')).toEqual({
      kind: 'not-played',
    })
  })

  test('a lone player is nobody-else, never "1st of 1"', () => {
    // True and worthless. lib/insights-team.ts's header calls a solo team the
    // most common shape in this product, so this is the ordinary case.
    expect(teamRank([member('me', 10, 35)], 'me')).toEqual({ kind: 'nobody-else' })
    // And the same when the others exist but have not played: nobody to rank against.
    expect(teamRank([member('me', 10, 35), member('idle', 0, 0)], 'me')).toEqual({
      kind: 'nobody-else',
    })
  })

  test('a viewer who is not on the roster at all gets nothing', () => {
    expect(teamRank([member('a', 10, 30)], 'me')).toEqual({ kind: 'not-played' })
  })

  describe('ties', () => {
    test('share a rank, COMPETITION style (1, 2, 2, 4) rather than dense', () => {
      // "4th of 4" has to mean three people are ahead, because that is how a
      // reader counts it. Under dense ranking they would read "3rd" with three
      // ahead of them, which makes the sentence quietly false.
      const tiedA = member('a', 10, 30)
      const tiedB = member('b', 10, 30)
      const best = member('best', 10, 20)
      const me = member('me', 10, 40)

      expect(teamRank([best, tiedA, tiedB, me], 'a')).toEqual({ kind: 'ranked', rank: 2, of: 4 })
      expect(teamRank([best, tiedA, tiedB, me], 'b')).toEqual({ kind: 'ranked', rank: 2, of: 4 })
      // The tie CONSUMES rank 3: the next player is 4th, not 3rd.
      expect(teamRank([best, tiedA, tiedB, me], 'me')).toEqual({ kind: 'ranked', rank: 4, of: 4 })
    })

    test('everyone level is 1st, not last', () => {
      expect(teamRank([member('me', 10, 30), member('a', 10, 30)], 'me')).toEqual({
        kind: 'ranked',
        rank: 1,
        of: 2,
      })
    })
  })

  test('RANKS THE ROUNDED AVERAGE, the one the paid panel prints', () => {
    // THE SUBTLE ONE. 34/10 = 3.4 and 341/100 = 3.41 both DISPLAY as 3.4
    // (memberAverages rounds to one decimal), so ranking the raw quotient would
    // put one of them ahead while the panel showed the pair as equal — the
    // teaser and the panel telling different stories about the same two people.
    const rank = teamRank([member('me', 100, 341), member('a', 10, 34)], 'me')
    expect(meanAttemptsOf(member('me', 100, 341))).toBe(3.4)
    expect(meanAttemptsOf(member('a', 10, 34))).toBe(3.4)
    expect(rank).toEqual({ kind: 'ranked', rank: 1, of: 2 })
  })

  test('says WHY there is no rank, because the browser cannot work it out', () => {
    // THE WHOLE REASON THIS RETURNS A TAG. Both of these were `null` before, and
    // they need opposite sentences: one asks the reader for a board, the other
    // tells a diligent player their teammates have not shown up. Collapsing them
    // would blame the wrong person.
    expect(teamRank([member('me', 0, 0), member('a', 10, 30)], 'me')).toEqual({
      kind: 'not-played',
    })
    expect(teamRank([member('me', 10, 30), member('a', 0, 0)], 'me')).toEqual({
      kind: 'nobody-else',
    })
  })
})

describe('meanAttemptsOf', () => {
  test('is null for a member with no boards, never zero', () => {
    // A zero mean would rank as the best possible score in the product.
    expect(meanAttemptsOf({ boards: 0, attempts: 0 })).toBeNull()
  })

  test('rounds to one decimal, and never to -0', () => {
    expect(meanAttemptsOf({ boards: 3, attempts: 10 })).toBe(3.3)
    expect(meanAttemptsOf({ boards: 0.5, attempts: -0.01 })).toBe(0)
    expect(Object.is(meanAttemptsOf({ boards: 0.5, attempts: -0.01 }), -0)).toBe(false)
  })
})
