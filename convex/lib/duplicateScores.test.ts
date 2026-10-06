import { describe, expect, test } from 'vitest'
import { DATE_GAP_LIMIT_MS, deletionKey, planCollapse, type CollapseRow } from './duplicateScores.ts'

// wordle-teams-rac, revision 2 (2026-10-06). The survivor is the row v2 edits —
// the FIRST in by_player_and_puzzleDay order — and a group that may be two
// different puzzles, or is not a double submit, or holds a v2-written row, is
// HELD: never deleted, reported with its reasons. Everything the repair deletes
// is decided here.

let seq = 0
const aRow = (over: Partial<CollapseRow<string>> = {}): CollapseRow<string> => {
  seq += 1
  return {
    _id: `row-${seq}`,
    _creationTime: 1_000_000 + seq,
    puzzleDay: '2025-01-09',
    date: 1_736_400_000_000,
    guesses: ['CRANE', 'SPEED'],
    answer: 'SPEED',
    createdAt: 1_736_400_000_000,
    legacyId: 1000 + seq,
    ...over,
  }
}

const ids = (rows: ReadonlyArray<{ _id: string }>) => rows.map((r) => r._id)

describe('planCollapse: the survivor', () => {
  test('is the row with the smallest _creationTime — the one .first() returns and v2 edits', () => {
    const first = aRow({ _creationTime: 10, createdAt: 9_999, legacyId: 99 })
    const second = aRow({ _creationTime: 20, createdAt: 1, legacyId: 1 })
    const [group] = planCollapse([second, first])
    expect(group.keep._id).toBe(first._id)
    expect(ids(group.drop)).toEqual([second._id])
  })

  test('createdAt and legacyId do not decide it, even when they point the other way', () => {
    const edited = aRow({ _creationTime: 1, createdAt: 100, legacyId: 5, guesses: ['SLATE', 'SPEED'] })
    const later = aRow({ _creationTime: 2, createdAt: 200, legacyId: 6 })
    const [group] = planCollapse([later, edited])
    expect(group.keep._id).toBe(edited._id)
    expect(group.differing).toBe(true)
  })

  test('a triple keeps the first and drops the other two in index order', () => {
    const r1 = aRow({ _creationTime: 1 })
    const r2 = aRow({ _creationTime: 2 })
    const r3 = aRow({ _creationTime: 3 })
    const [group] = planCollapse([r3, r1, r2])
    expect(group.keep._id).toBe(r1._id)
    expect(ids(group.drop)).toEqual([r2._id, r3._id])
    expect(group.differing).toBe(false)
    expect(group.held).toEqual([])
  })
})

describe('planCollapse: differing', () => {
  test('identical rows are not differing', () => {
    expect(planCollapse([aRow(), aRow()])[0].differing).toBe(false)
  })
  test('different guesses are', () => {
    expect(planCollapse([aRow(), aRow({ guesses: ['SLATE', 'SPEED'] })])[0].differing).toBe(true)
  })
  test('a prefix board is, in either direction', () => {
    expect(planCollapse([aRow({ guesses: ['CRANE'] }), aRow()])[0].differing).toBe(true)
    expect(planCollapse([aRow(), aRow({ guesses: ['CRANE'] })])[0].differing).toBe(true)
  })
  test('a triple is differing when ANY dropped row differs', () => {
    expect(planCollapse([aRow(), aRow(), aRow({ guesses: ['X'] })])[0].differing).toBe(true)
  })
  test('an absent answer against a present one is differing', () => {
    expect(planCollapse([aRow(), aRow({ answer: undefined })])[0].differing).toBe(true)
  })
})

describe('planCollapse: held groups', () => {
  test('different non-empty answers are two puzzles: held as answers-differ', () => {
    const [group] = planCollapse([aRow({ answer: 'SPEED' }), aRow({ answer: 'CRANE' })])
    expect(group.held).toEqual(['answers-differ'])
  })

  test('an empty or absent answer beside a real one is not two puzzles', () => {
    expect(planCollapse([aRow({ answer: 'SPEED' }), aRow({ answer: '' })])[0].held).toEqual([])
    expect(planCollapse([aRow({ answer: 'SPEED' }), aRow({ answer: undefined })])[0].held).toEqual([])
  })

  test('date instants more than ten minutes apart are not a double submit: held as dates-apart', () => {
    const at = 1_736_400_000_000
    const [apart] = planCollapse([aRow({ date: at }), aRow({ date: at + DATE_GAP_LIMIT_MS + 1 })])
    expect(apart.held).toEqual(['dates-apart'])
    const [edge] = planCollapse([aRow({ date: at + DATE_GAP_LIMIT_MS }), aRow({ date: at })])
    expect(edge.held).toEqual([])
    expect(edge.dateGapMs).toBe(DATE_GAP_LIMIT_MS)
    expect(DATE_GAP_LIMIT_MS).toBe(10 * 60 * 1000)
  })

  test('the gap is measured across the whole group, not between neighbours', () => {
    const at = 1_736_400_000_000
    const five = 5 * 60 * 1000
    const [group] = planCollapse([aRow({ date: at }), aRow({ date: at + five }), aRow({ date: at + 2 * five + 1 })])
    expect(group.held).toEqual(['dates-apart'])
  })

  test('any row without a legacyId is a v2-written row: held as v2-row', () => {
    expect(planCollapse([aRow(), aRow({ legacyId: undefined })])[0].held).toEqual(['v2-row'])
    expect(planCollapse([aRow({ legacyId: undefined }), aRow()])[0].held).toEqual(['v2-row'])
  })

  test('every reason that applies is listed', () => {
    const [group] = planCollapse([
      aRow({ answer: 'SPEED', date: 0 }),
      aRow({ answer: 'CRANE', date: DATE_GAP_LIMIT_MS + 1, legacyId: undefined }),
    ])
    expect(group.held).toEqual(['answers-differ', 'dates-apart', 'v2-row'])
  })
})

describe('planCollapse: grouping', () => {
  test('a day with one row produces nothing, and other days do not join its group', () => {
    const lone = aRow({ puzzleDay: '2025-01-08' })
    const a = aRow({ puzzleDay: '2025-01-09' })
    const b = aRow({ puzzleDay: '2025-01-09' })
    const other = aRow({ puzzleDay: '2025-01-10' })
    const groups = planCollapse([lone, a, b, other])
    expect(groups).toHaveLength(1)
    expect(ids([groups[0].keep, ...groups[0].drop])).toEqual([a._id, b._id])
  })

  test('no duplicates is an empty plan', () => {
    expect(planCollapse([aRow({ puzzleDay: '2025-01-01' }), aRow({ puzzleDay: '2025-01-02' })])).toEqual([])
    expect(planCollapse([])).toEqual([])
  })

  test('input order is irrelevant: every permutation yields the same plan, ordered by day', () => {
    const rows = [
      aRow({ puzzleDay: '2025-02-01' }),
      aRow({ puzzleDay: '2025-02-01' }),
      aRow({ puzzleDay: '2025-02-01', answer: 'OTHER' }),
      aRow({ puzzleDay: '2025-01-05' }),
      aRow({ puzzleDay: '2025-01-05', guesses: ['OTHER'] }),
      aRow({ puzzleDay: '2025-01-06' }),
    ]
    const permutations = (list: typeof rows): Array<typeof rows> =>
      list.length <= 1
        ? [list]
        : list.flatMap((head, i) =>
            permutations([...list.slice(0, i), ...list.slice(i + 1)]).map((tail) => [head, ...tail]),
          )
    const expected = planCollapse(rows)
    expect(expected.map((g) => g.puzzleDay)).toEqual(['2025-01-05', '2025-02-01'])
    for (const order of permutations(rows)) expect(planCollapse(order)).toEqual(expected)
  })
})

describe('deletionKey', () => {
  test('names exactly the rows a repair would delete: held groups contribute nothing', () => {
    const a1 = aRow({ legacyId: 30 })
    const a2 = aRow({ legacyId: 12 })
    const a3 = aRow({ legacyId: 7 })
    const held1 = aRow({ puzzleDay: '2025-01-10', answer: 'SPEED', legacyId: 40 })
    const held2 = aRow({ puzzleDay: '2025-01-10', answer: 'CRANE', legacyId: 41 })
    expect(deletionKey('2025-01', planCollapse([a1, a2, a3, held1, held2]))).toBe('2025-01:7,12')
  })

  test('sorts numerically, and an empty plan is just the month', () => {
    const rows = [aRow({ legacyId: 1 }), aRow({ legacyId: 100 }), aRow({ legacyId: 9 })]
    expect(deletionKey('2025-01', planCollapse(rows))).toBe('2025-01:9,100')
    expect(deletionKey('2025-01', [])).toBe('2025-01:')
  })
})
