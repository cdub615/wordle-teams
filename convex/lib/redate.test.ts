import { describe, expect, test } from 'vitest'
import type { CollapseRow } from './duplicateScores.ts'
import {
  MIN_CONSENSUS_BOARDS,
  consensusOf,
  monthsTouched,
  normalizeAnswer,
  planRedate,
  redateKey,
  type Consensus,
  type RedatePair,
  type RedatePlan,
} from './redate.ts'

// wordle-teams-c442. A (player, puzzleDay) pair holding two boards with
// DIFFERENT answers is two puzzles, one of them misdated at the v1 copy. The
// board matching the day's consensus answer stays; the other moves to the
// NEAREST day within ±2 whose consensus is its answer — or the pair is HELD with
// a reason and nothing is written. Every move the repair makes is decided here.
// Ids are synthetic: the repo is public.

const ME = 'player-me'

let seq = 0
const aRow = (over: Partial<CollapseRow<string>> = {}): CollapseRow<string> => {
  seq += 1
  return {
    _id: `row-${seq}`,
    _creationTime: 1_000_000 + seq,
    puzzleDay: '2026-06-15',
    date: 1_781_500_000_000,
    guesses: ['CRANE'],
    answer: 'CRANE',
    legacyId: 1000 + seq,
    ...over,
  }
}

const board = (playerId: string, answer?: string) => ({ playerId, answer })
const strangers = (answer: string, n: number, prefix = 'p') =>
  Array.from({ length: n }, (_, i) => board(`${prefix}-${answer}-${i}`, answer))

const agreed = (answer: string, count = 5): Consensus => ({ answer, count, total: count })

const pairOf = (a: CollapseRow<string>, b: CollapseRow<string>, puzzleDay = '2026-06-15'): RedatePair<CollapseRow<string>> => ({
  playerId: ME,
  puzzleDay,
  boards: [a, b],
})

const days = (entries: Record<string, Consensus | null>) => new Map(Object.entries(entries))
const none = new Set<string>()

describe('normalizeAnswer', () => {
  test('trims and uppercases', () => {
    expect(normalizeAnswer('  crane ')).toBe('CRANE')
    expect(normalizeAnswer('Crane')).toBe('CRANE')
  })
  test('empty, blank and missing are no answer', () => {
    expect(normalizeAnswer('')).toBeUndefined()
    expect(normalizeAnswer('   ')).toBeUndefined()
    expect(normalizeAnswer(undefined)).toBeUndefined()
  })
})

describe('consensusOf', () => {
  test('the most common answer, with its count and the number of boards counted', () => {
    const boards = [...strangers('CRANE', 4), ...strangers('SLATE', 1)]
    expect(consensusOf(boards, { excludePlayerId: ME })).toEqual({ answer: 'CRANE', count: 4, total: 5 })
  })

  test("answers are normalised before they are counted", () => {
    const boards = [board('a', 'crane'), board('b', ' CRANE'), board('c', 'Crane ')]
    expect(consensusOf(boards, { excludePlayerId: ME })).toEqual({ answer: 'CRANE', count: 3, total: 3 })
  })

  test("the affected player's own boards do not vote", () => {
    // Without the exclusion, ME's two boards tip a 2-2 tie into a SLATE majority.
    const boards = [...strangers('CRANE', 2), ...strangers('SLATE', 2), board(ME, 'SLATE'), board(ME, 'SLATE')]
    expect(consensusOf(boards, { excludePlayerId: ME })).toBeNull()
    const mine = [...strangers('CRANE', 3), board(ME, 'SLATE'), board(ME, 'SLATE'), board(ME, 'SLATE')]
    expect(consensusOf(mine, { excludePlayerId: ME })).toEqual({ answer: 'CRANE', count: 3, total: 3 })
  })

  test('boards with no answer are not counted at all', () => {
    const boards = [...strangers('CRANE', 3), board('x'), board('y', ''), board('z', '  ')]
    expect(consensusOf(boards, { excludePlayerId: ME })).toEqual({ answer: 'CRANE', count: 3, total: 3 })
  })

  test(`fewer than MIN_CONSENSUS_BOARDS (${MIN_CONSENSUS_BOARDS}) counted boards is untrusted`, () => {
    expect(MIN_CONSENSUS_BOARDS).toBe(3)
    expect(consensusOf(strangers('CRANE', 2), { excludePlayerId: ME })).toBeNull()
    expect(consensusOf(strangers('CRANE', 3), { excludePlayerId: ME })).toEqual({ answer: 'CRANE', count: 3, total: 3 })
    // Answerless boards do not make up the count.
    expect(consensusOf([...strangers('CRANE', 2), board('x'), board('y')], { excludePlayerId: ME })).toBeNull()
    expect(consensusOf([], { excludePlayerId: ME })).toBeNull()
  })

  test('the top answer must be a STRICT majority of counted boards', () => {
    // Exactly half is not a majority.
    expect(consensusOf([...strangers('CRANE', 2), ...strangers('SLATE', 2)], { excludePlayerId: ME })).toBeNull()
    expect(
      consensusOf([...strangers('CRANE', 3), ...strangers('SLATE', 2), ...strangers('PIANO', 1)], { excludePlayerId: ME }),
    ).toBeNull()
    // A plurality that is a majority passes.
    expect(consensusOf([...strangers('CRANE', 3), ...strangers('SLATE', 2)], { excludePlayerId: ME })).toEqual({
      answer: 'CRANE',
      count: 3,
      total: 5,
    })
  })
})

describe('planRedate: which board stays', () => {
  test('when the SECOND board is the misplaced one, the first stays and the second moves', () => {
    const stays = aRow({ answer: 'CRANE' })
    const moves = aRow({ answer: 'SLATE' })
    const plan = planRedate(pairOf(stays, moves), days({ '2026-06-15': agreed('CRANE'), '2026-06-14': agreed('SLATE') }), none)
    expect(plan).toEqual({ kind: 'move', playerId: ME, stay: stays, move: moves, from: '2026-06-15', to: '2026-06-14' })
  })

  test('when the FIRST board is the misplaced one, the second stays and the first moves', () => {
    const moves = aRow({ answer: 'SLATE' })
    const stays = aRow({ answer: 'CRANE' })
    const plan = planRedate(pairOf(moves, stays), days({ '2026-06-15': agreed('CRANE'), '2026-06-16': agreed('SLATE') }), none)
    expect(plan).toEqual({ kind: 'move', playerId: ME, stay: stays, move: moves, from: '2026-06-15', to: '2026-06-16' })
  })

  test("board answers are normalised before they are compared to a consensus", () => {
    const stays = aRow({ answer: ' crane' })
    const moves = aRow({ answer: 'slate ' })
    const plan = planRedate(pairOf(stays, moves), days({ '2026-06-15': agreed('CRANE'), '2026-06-14': agreed('SLATE') }), none)
    expect(plan).toMatchObject({ kind: 'move', stay: stays, move: moves, to: '2026-06-14' })
  })
})

describe('planRedate: the target is the NEAREST matching day', () => {
  test('a match one day back beats a match two days forward', () => {
    const plan = planRedate(
      pairOf(aRow({ answer: 'CRANE' }), aRow({ answer: 'SLATE' })),
      days({ '2026-06-15': agreed('CRANE'), '2026-06-14': agreed('SLATE'), '2026-06-17': agreed('SLATE') }),
      none,
    )
    expect(plan).toMatchObject({ kind: 'move', to: '2026-06-14' })
  })

  test('a match one day forward beats a match two days back', () => {
    const plan = planRedate(
      pairOf(aRow({ answer: 'CRANE' }), aRow({ answer: 'SLATE' })),
      days({ '2026-06-15': agreed('CRANE'), '2026-06-13': agreed('SLATE'), '2026-06-16': agreed('SLATE') }),
      none,
    )
    expect(plan).toMatchObject({ kind: 'move', to: '2026-06-16' })
  })

  test('two days away is reached when nothing nearer matches, in either direction', () => {
    const pair = () => pairOf(aRow({ answer: 'CRANE' }), aRow({ answer: 'SLATE' }))
    expect(
      planRedate(pair(), days({ '2026-06-15': agreed('CRANE'), '2026-06-14': agreed('PIANO'), '2026-06-13': agreed('SLATE') }), none),
    ).toMatchObject({ kind: 'move', to: '2026-06-13' })
    expect(planRedate(pair(), days({ '2026-06-15': agreed('CRANE'), '2026-06-17': agreed('SLATE') }), none)).toMatchObject({
      kind: 'move',
      to: '2026-06-17',
    })
  })
})

describe('planRedate: month and year boundaries', () => {
  test('forward across a month end', () => {
    const plan = planRedate(
      pairOf(aRow({ answer: 'CRANE' }), aRow({ answer: 'SLATE' }), '2026-06-30'),
      days({ '2026-06-30': agreed('CRANE'), '2026-07-01': agreed('SLATE') }),
      none,
    )
    expect(plan).toMatchObject({ kind: 'move', from: '2026-06-30', to: '2026-07-01' })
    expect(monthsTouched(plan)).toEqual(['2026-06', '2026-07'])
  })

  test('backward across a month start, two days', () => {
    const plan = planRedate(
      pairOf(aRow({ answer: 'CRANE' }), aRow({ answer: 'SLATE' }), '2026-03-01'),
      days({ '2026-03-01': agreed('CRANE'), '2026-02-27': agreed('SLATE') }),
      none,
    )
    expect(plan).toMatchObject({ kind: 'move', from: '2026-03-01', to: '2026-02-27' })
    expect(monthsTouched(plan)).toEqual(['2026-02', '2026-03'])
  })

  test('forward across a year end', () => {
    const plan = planRedate(
      pairOf(aRow({ answer: 'CRANE' }), aRow({ answer: 'SLATE' }), '2025-12-31'),
      days({ '2025-12-31': agreed('CRANE'), '2026-01-01': agreed('SLATE') }),
      none,
    )
    expect(plan).toMatchObject({ kind: 'move', from: '2025-12-31', to: '2026-01-01' })
    expect(monthsTouched(plan)).toEqual(['2025-12', '2026-01'])
  })

  test('backward across a year start', () => {
    const plan = planRedate(
      pairOf(aRow({ answer: 'CRANE' }), aRow({ answer: 'SLATE' }), '2026-01-01'),
      days({ '2026-01-01': agreed('CRANE'), '2025-12-31': agreed('SLATE') }),
      none,
    )
    expect(plan).toMatchObject({ kind: 'move', from: '2026-01-01', to: '2025-12-31' })
    expect(monthsTouched(plan)).toEqual(['2025-12', '2026-01'])
  })
})

describe('monthsTouched', () => {
  test('a move within one month touches that month once', () => {
    const plan = planRedate(
      pairOf(aRow({ answer: 'CRANE' }), aRow({ answer: 'SLATE' })),
      days({ '2026-06-15': agreed('CRANE'), '2026-06-16': agreed('SLATE') }),
      none,
    )
    expect(monthsTouched(plan)).toEqual(['2026-06'])
  })
  test('a hold touches nothing', () => {
    const plan = planRedate(pairOf(aRow({ answer: 'CRANE' }), aRow({ answer: 'SLATE' })), days({}), none)
    expect(plan.kind).toBe('hold')
    expect(monthsTouched(plan)).toEqual([])
  })
})

describe('planRedate: held pairs', () => {
  const holdOf = (plan: RedatePlan<CollapseRow<string>>) => (plan.kind === 'hold' ? plan.reason : `moved to ${plan.to}`)

  test('v2-row: either board without a legacyId', () => {
    const consensus = days({ '2026-06-15': agreed('CRANE'), '2026-06-14': agreed('SLATE') })
    expect(holdOf(planRedate(pairOf(aRow({ answer: 'CRANE' }), aRow({ answer: 'SLATE', legacyId: undefined })), consensus, none))).toBe('v2-row')
    expect(holdOf(planRedate(pairOf(aRow({ answer: 'CRANE', legacyId: undefined }), aRow({ answer: 'SLATE' })), consensus, none))).toBe('v2-row')
  })

  test('no-answer: either board lacks an answer', () => {
    const consensus = days({ '2026-06-15': agreed('CRANE'), '2026-06-14': agreed('SLATE') })
    expect(holdOf(planRedate(pairOf(aRow({ answer: 'CRANE' }), aRow({ answer: undefined })), consensus, none))).toBe('no-answer')
    expect(holdOf(planRedate(pairOf(aRow({ answer: '  ' }), aRow({ answer: 'SLATE' })), consensus, none))).toBe('no-answer')
  })

  test("no-consensus: the pair's own day has no trusted consensus", () => {
    const pair = () => pairOf(aRow({ answer: 'CRANE' }), aRow({ answer: 'SLATE' }))
    expect(holdOf(planRedate(pair(), days({ '2026-06-15': null, '2026-06-14': agreed('SLATE') }), none))).toBe('no-consensus')
    expect(holdOf(planRedate(pair(), days({ '2026-06-14': agreed('SLATE') }), none))).toBe('no-consensus')
  })

  test('neither-matches: the day agrees on a third answer', () => {
    const plan = planRedate(
      pairOf(aRow({ answer: 'CRANE' }), aRow({ answer: 'SLATE' })),
      days({ '2026-06-15': agreed('PIANO'), '2026-06-14': agreed('SLATE'), '2026-06-16': agreed('CRANE') }),
      none,
    )
    expect(holdOf(plan)).toBe('neither-matches')
  })

  test('both-match: two answers that differ only in case or spacing are one puzzle', () => {
    const plan = planRedate(
      pairOf(aRow({ answer: 'crane' }), aRow({ answer: 'CRANE ' })),
      days({ '2026-06-15': agreed('CRANE'), '2026-06-14': agreed('CRANE') }),
      none,
    )
    expect(holdOf(plan)).toBe('both-match')
  })

  test('no-target: no day within ±2 agrees on the moving answer', () => {
    const pair = () => pairOf(aRow({ answer: 'CRANE' }), aRow({ answer: 'SLATE' }))
    expect(holdOf(planRedate(pair(), days({ '2026-06-15': agreed('CRANE'), '2026-06-18': agreed('SLATE') }), none))).toBe('no-target')
    expect(holdOf(planRedate(pair(), days({ '2026-06-15': agreed('CRANE'), '2026-06-12': agreed('SLATE') }), none))).toBe('no-target')
    // An untrusted neighbour is not a target.
    expect(holdOf(planRedate(pair(), days({ '2026-06-15': agreed('CRANE'), '2026-06-14': null }), none))).toBe('no-target')
  })

  test('ambiguous-target: two matching days equally near are not guessed between', () => {
    const pair = () => pairOf(aRow({ answer: 'CRANE' }), aRow({ answer: 'SLATE' }))
    const one = planRedate(
      pair(),
      days({ '2026-06-15': agreed('CRANE'), '2026-06-14': agreed('SLATE'), '2026-06-16': agreed('SLATE') }),
      none,
    )
    expect(one).toMatchObject({ kind: 'hold', reason: 'ambiguous-target', targets: ['2026-06-14', '2026-06-16'] })
    const two = planRedate(
      pair(),
      days({ '2026-06-15': agreed('CRANE'), '2026-06-13': agreed('SLATE'), '2026-06-17': agreed('SLATE') }),
      none,
    )
    expect(holdOf(two)).toBe('ambiguous-target')
  })

  test('target-occupied: the nearest matching day already has a board for this player', () => {
    const plan = planRedate(
      pairOf(aRow({ answer: 'CRANE' }), aRow({ answer: 'SLATE' })),
      days({ '2026-06-15': agreed('CRANE'), '2026-06-14': agreed('SLATE'), '2026-06-17': agreed('SLATE') }),
      new Set(['2026-06-14']),
    )
    // Reported and skipped: it does NOT fall through to the farther match.
    expect(plan).toMatchObject({ kind: 'hold', reason: 'target-occupied', targets: ['2026-06-14'] })
  })

  test('an occupied day that is not the target does not hold', () => {
    const plan = planRedate(
      pairOf(aRow({ answer: 'CRANE' }), aRow({ answer: 'SLATE' })),
      days({ '2026-06-15': agreed('CRANE'), '2026-06-14': agreed('SLATE') }),
      new Set(['2026-06-16', '2026-06-13']),
    )
    expect(plan).toMatchObject({ kind: 'move', to: '2026-06-14' })
  })

  test('a hold carries the pair it held, for the report', () => {
    const a = aRow({ answer: 'CRANE' })
    const b = aRow({ answer: 'SLATE' })
    expect(planRedate(pairOf(a, b), days({}), none)).toEqual({
      kind: 'hold',
      playerId: ME,
      puzzleDay: '2026-06-15',
      reason: 'no-consensus',
      boards: [a, b],
      targets: [],
    })
  })
})

describe('redateKey', () => {
  const consensus = days({
    '2026-06-15': agreed('CRANE'),
    '2026-06-14': agreed('SLATE'),
    '2026-06-30': agreed('CRANE'),
    '2026-07-01': agreed('SLATE'),
  })
  const move15 = () => planRedate(pairOf(aRow({ answer: 'CRANE', legacyId: 50 }), aRow({ answer: 'SLATE', legacyId: 9 })), consensus, none)
  const move30 = () =>
    planRedate(pairOf(aRow({ answer: 'SLATE', legacyId: 100 }), aRow({ answer: 'CRANE', legacyId: 3 }), '2026-06-30'), consensus, none)
  const held = () =>
    planRedate(pairOf(aRow({ answer: 'CRANE', legacyId: 7 }), aRow({ answer: 'SLATE', legacyId: 8 }), '2026-05-01'), consensus, none)

  test('names each moved board by legacyId with its from and to, in ascending numeric order; holds contribute nothing', () => {
    expect(redateKey([move30(), held(), move15()])).toBe('9:2026-06-15>2026-06-14,100:2026-06-30>2026-07-01')
  })

  test('is the same for every order of the same plans', () => {
    const a = move15()
    const b = move30()
    const c = held()
    const expected = redateKey([a, b, c])
    for (const order of [[a, c, b], [b, a, c], [b, c, a], [c, a, b], [c, b, a]]) expect(redateKey(order)).toBe(expected)
  })

  test('an empty or all-held plan is the empty key', () => {
    expect(redateKey([])).toBe('')
    expect(redateKey([held()])).toBe('')
  })
})
