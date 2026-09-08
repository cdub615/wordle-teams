import { describe, expect, test } from 'vitest'
import { aggregateTeamMonth, sameStats } from './teamStats.ts'
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
