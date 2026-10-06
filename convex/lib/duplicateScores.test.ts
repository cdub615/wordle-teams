import { describe, expect, test } from 'vitest'
import { planCollapse, type CollapseRow } from './duplicateScores.ts'

// wordle-teams-rac. The rule the owner decided on 2026-10-05: a duplicated
// (player, puzzle day) keeps the LATER-written row. Everything the repair deletes
// is decided here, so these are the tests that stand between a wrong rule and a
// production delete.

let seq = 0
const aRow = (over: Partial<CollapseRow<string>> = {}): CollapseRow<string> => {
  seq += 1
  return {
    _id: `row-${seq}`,
    _creationTime: 1_000_000 + seq,
    puzzleDay: '2025-01-09',
    guesses: ['CRANE', 'SPEED'],
    answer: 'SPEED',
    createdAt: 1_736_400_000_000,
    legacyId: 1000 + seq,
    ...over,
  }
}

const ids = (rows: ReadonlyArray<{ _id: string }>) => rows.map((r) => r._id)

describe('planCollapse', () => {
  test('an identical pair keeps the later-written row and is not differing', () => {
    const early = aRow({ createdAt: 100, legacyId: 1 })
    const late = aRow({ createdAt: 101, legacyId: 2 })
    expect(planCollapse([early, late])).toEqual([
      { puzzleDay: '2025-01-09', keep: late, drop: [early], differing: false },
    ])
  })

  test('a differing pair keeps the LATER row, even when the earlier one has the lower legacyId', () => {
    // createdAt decides before legacyId: the later-written content survives.
    const later = aRow({ createdAt: 2_000, legacyId: 5, guesses: ['SLATE', 'SPEED'] })
    const earlier = aRow({ createdAt: 1_000, legacyId: 9, guesses: ['CRANE', 'SPEED'] })
    const [group] = planCollapse([later, earlier])
    expect(group.keep._id).toBe(later._id)
    expect(ids(group.drop)).toEqual([earlier._id])
    expect(group.differing).toBe(true)
  })

  test('a different answer alone makes the pair differing', () => {
    const a = aRow({ createdAt: 1, answer: 'SPEED' })
    const b = aRow({ createdAt: 2, answer: 'SPELL' })
    expect(planCollapse([a, b])[0].differing).toBe(true)
  })

  test('a board that is a prefix of the other is differing, in either direction', () => {
    const short = aRow({ createdAt: 1, guesses: ['CRANE'] })
    const long = aRow({ createdAt: 2, guesses: ['CRANE', 'SPEED'] })
    expect(planCollapse([short, long])[0].differing).toBe(true)
    const shortLater = aRow({ createdAt: 3, guesses: ['CRANE'] })
    expect(planCollapse([long, shortLater])[0].differing).toBe(true)
  })

  test('three rows keep the latest and drop the other two', () => {
    const r1 = aRow({ createdAt: 10 })
    const r3 = aRow({ createdAt: 30 })
    const r2 = aRow({ createdAt: 20 })
    const [group] = planCollapse([r1, r3, r2])
    expect(group.keep._id).toBe(r3._id)
    expect(ids(group.drop).sort()).toEqual([r1._id, r2._id].sort())
    expect(group.differing).toBe(false)
  })

  test('a triple is differing when ANY dropped row differs, even if another is identical', () => {
    const same = aRow({ createdAt: 10 })
    const other = aRow({ createdAt: 20, guesses: ['SLATE', 'SPEED'] })
    const keep = aRow({ createdAt: 30 })
    expect(planCollapse([same, other, keep])[0].differing).toBe(true)
  })

  test('a row with no createdAt sorts before a row with one, whatever its legacyId', () => {
    const undated = aRow({ createdAt: undefined, legacyId: 999_999 })
    const dated = aRow({ createdAt: 1, legacyId: 1 })
    const [group] = planCollapse([dated, undated])
    expect(group.keep._id).toBe(dated._id)
    expect(ids(group.drop)).toEqual([undated._id])
  })

  test('a createdAt tie is broken by the greater legacyId', () => {
    const low = aRow({ createdAt: 500, legacyId: 7 })
    const high = aRow({ createdAt: 500, legacyId: 8 })
    // `low` gets the LATER _creationTime, so only legacyId can pick `high`.
    const [group] = planCollapse([high, low].map((r, i) => ({ ...r, _creationTime: 10 + i })))
    expect(group.keep._id).toBe(high._id)
  })

  test('a createdAt and legacyId tie is broken by the greater _creationTime', () => {
    const first = aRow({ createdAt: 500, legacyId: 7, _creationTime: 1 })
    const second = aRow({ createdAt: 500, legacyId: 7, _creationTime: 2 })
    expect(planCollapse([second, first])[0].keep._id).toBe(second._id)
  })

  test('a row with no legacyId loses a createdAt tie to a row with one', () => {
    const nativeRow = aRow({ createdAt: undefined, legacyId: undefined, _creationTime: 99 })
    const copied = aRow({ createdAt: undefined, legacyId: 3, _creationTime: 1 })
    expect(planCollapse([nativeRow, copied])[0].keep._id).toBe(copied._id)
  })

  test('a day with one row produces nothing, and other days do not join its group', () => {
    const lone = aRow({ puzzleDay: '2025-01-08' })
    const a = aRow({ puzzleDay: '2025-01-09', createdAt: 1 })
    const b = aRow({ puzzleDay: '2025-01-09', createdAt: 2 })
    const other = aRow({ puzzleDay: '2025-01-10' })
    const groups = planCollapse([lone, a, b, other])
    expect(groups).toHaveLength(1)
    expect(groups[0].puzzleDay).toBe('2025-01-09')
    expect(ids([groups[0].keep, ...groups[0].drop]).sort()).toEqual([a._id, b._id].sort())
  })

  test('no duplicates at all is an empty plan', () => {
    expect(planCollapse([aRow({ puzzleDay: '2025-01-01' }), aRow({ puzzleDay: '2025-01-02' })])).toEqual(
      [],
    )
    expect(planCollapse([])).toEqual([])
  })

  test('input order is irrelevant: every permutation yields the same plan', () => {
    const rows = [
      aRow({ puzzleDay: '2025-02-01', createdAt: 3 }),
      aRow({ puzzleDay: '2025-02-01', createdAt: 1 }),
      aRow({ puzzleDay: '2025-02-01', createdAt: 2 }),
      aRow({ puzzleDay: '2025-01-05', createdAt: 9 }),
      aRow({ puzzleDay: '2025-01-05', createdAt: 8, guesses: ['OTHER'] }),
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
