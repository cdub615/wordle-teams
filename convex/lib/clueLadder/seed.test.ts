import { describe, expect, test } from 'vitest'
import { addDays } from '../puzzleDay.ts'
import { clueText } from './clues.ts'
import { ladderProblem } from './ladder.ts'
import {
  GENERATOR_VERSION,
  hmacSeed,
  MIN_SECRET_LENGTH,
  puzzleForDate,
  puzzleMessage,
  seedSecretUsable,
} from './seed.ts'

const SECRET = 'golden-test-secret-not-for-production'

describe('hmacSeed', () => {
  // RFC 4231's vectors, so the HMAC and the byte order are checked against an
  // outside source, not against this module's own output.
  test('RFC 4231 case 2: the first four MAC bytes, big-endian', async () => {
    // HMAC-SHA256 = 5bdcc146 bf60754e 6a042426 ...
    expect(await hmacSeed('Jefe', 'what do ya want for nothing?')).toBe(0x5bdcc146)
  })

  test('RFC 4231 case 1: a first byte above 0x7f stays unsigned', async () => {
    // HMAC-SHA256 = b0344c61 d8db3853 5ca8afce ...
    expect(await hmacSeed('\x0b'.repeat(20), 'Hi There')).toBe(0xb0344c61)
  })
})

describe('seedSecretUsable', () => {
  test.each([
    [undefined, false],
    ['', false],
    ['x'.repeat(MIN_SECRET_LENGTH - 1), false],
    ['x'.repeat(MIN_SECRET_LENGTH), true],
  ])('%j -> %s', (secret, usable) => {
    expect(seedSecretUsable(secret)).toBe(usable)
  })
})

describe('puzzleForDate', () => {
  test('the message names the generator version, so a new generator means new puzzles', () => {
    expect(puzzleMessage('2026-10-15')).toBe(`clue-ladder:${GENERATOR_VERSION}:2026-10-15`)
  })

  test('the same date always yields the same puzzle; the next day a different one', async () => {
    const a = await puzzleForDate(SECRET, '2026-10-15')
    expect(await puzzleForDate(SECRET, '2026-10-15')).toEqual(a)
    expect(await puzzleForDate(SECRET, '2026-10-16')).not.toEqual(a)
    expect(await puzzleForDate(`${SECRET}-other`, '2026-10-15')).not.toEqual(a)
  })

  test('a year of dates all obey the ladder rules', async () => {
    for (let i = 0; i < 366; i++) {
      const date = addDays('2026-10-15', i)
      const puzzle = await puzzleForDate(SECRET, date)
      expect(ladderProblem(puzzle.answer, puzzle.clues), date).toBeNull()
    }
  })

  // GOLDEN. These dates' puzzles under SECRET are pinned in the snapshot file.
  // A change to the generator, the clue vocabulary, the RNG or the seed changes
  // them. That is a GENERATOR_VERSION bump, never a snapshot update: stored
  // puzzles were made by the old code.
  test.each(['2026-10-15', '2026-12-31', '2027-03-01'])('%s is pinned', async (date) => {
    const puzzle = await puzzleForDate(SECRET, date)
    expect({
      answer: puzzle.answer,
      clues: puzzle.clues.map(clueText),
      remaining: puzzle.remaining,
      fallback: puzzle.fallback,
    }).toMatchSnapshot()
  })
})
