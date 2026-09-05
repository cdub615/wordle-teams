import { describe, expect, it } from 'vitest'
import { resolveRow } from './repair.ts'
import type { LetterScores, Mark, RowObservation } from './types.ts'

/** A tile the reader is certain about. */
const sure = (letter: string): LetterScores => ({ [letter]: 1 })

/** A tile the reader is torn between two letters, `first` slightly favoured. */
const torn = (first: string, second: string): LetterScores => ({ [first]: 0.55, [second]: 0.45 })

const row = (letters: Array<LetterScores>, marks: Array<Mark>): RowObservation => ({ letters, marks })

const ALL_CORRECT: Array<Mark> = ['correct', 'correct', 'correct', 'correct', 'correct']
const ALL_ABSENT: Array<Mark> = ['absent', 'absent', 'absent', 'absent', 'absent']

const WORDS = ['CRANE', 'CRANK', 'ERASE', 'SPEED', 'TRACE']

describe('resolveRow', () => {
  it('returns the word the reader was already sure of', () => {
    const observed = row(['C', 'R', 'A', 'N', 'E'].map(sure), ALL_CORRECT)
    expect(resolveRow(observed, WORDS, 'CRANE')).toMatchObject({ ok: true, word: 'CRANE' })
  })

  // THE POINT OF THE WHOLE STAGE: the reader PREFERRED K, and the colours say
  // it cannot be K, so the constraint overrules the pixels.
  it('overrules a confident misread when the colours forbid it', () => {
    const observed = row([sure('C'), sure('R'), sure('A'), sure('N'), torn('K', 'E')], ALL_CORRECT)
    expect(resolveRow(observed, WORDS, 'CRANE')).toMatchObject({ ok: true, word: 'CRANE' })
  })

  it('reports failure rather than guessing when nothing fits', () => {
    const observed = row(['Z', 'Z', 'Z', 'Z', 'Z'].map(sure), ALL_ABSENT)
    expect(resolveRow(observed, WORDS, 'CRANE')).toEqual({ ok: false, reason: 'no-candidate' })
  })

  // Without an answer the colours cannot be checked, so only the word list and
  // the reader's own confidence are left. It must still pick, and pick sanely.
  it('falls back to the reader when no answer is known', () => {
    const observed = row(['T', 'R', 'A', 'C', 'E'].map(sure), ALL_ABSENT)
    expect(resolveRow(observed, WORDS, null)).toMatchObject({ ok: true, word: 'TRACE' })
  })
})
