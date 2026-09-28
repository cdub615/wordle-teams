import { describe, expect, test } from 'vitest'
import { pluralize } from './pluralize.ts'

describe('pluralize', () => {
  // n=1 is the only value that exposes the bug this helper exists for: an
  // append-'s' or a naive plural-always helper both read "1 guesses".
  test('n=1 returns the singular form', () => {
    expect(pluralize(1, 'guess', 'guesses')).toBe('guess')
  })

  test('n>1 returns the plural form', () => {
    expect(pluralize(2, 'guess', 'guesses')).toBe('guesses')
  })

  // n=0 is deliberately plural: English says "0 guesses", not "0 guess".
  test('n=0 returns the plural form', () => {
    expect(pluralize(0, 'guess', 'guesses')).toBe('guesses')
  })

  // The -s/-es asymmetry is the whole reason this takes both forms rather
  // than appending a suffix — 'time'/'times' is regular, 'guess'/'guesses'
  // is not, and a single call site exercises both.
  test('an irregular plural (guess/guesses) and a regular one (time/times) both come through unchanged', () => {
    expect(pluralize(3, 'guess', 'guesses')).toBe('guesses')
    expect(pluralize(3, 'time', 'times')).toBe('times')
  })
})
