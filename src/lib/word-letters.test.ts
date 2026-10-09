import { describe, expect, test } from 'vitest'
import { lettersOf } from './word-letters.ts'

describe('lettersOf', () => {
  test('folds accents and fullwidth, drops non-letters, keeps five, lower-cases', () => {
    expect(lettersOf('cráne')).toBe('crane')
    expect(lettersOf('ＣＲＡＮＥ')).toBe('crane')
    expect(lettersOf(' S-l4a​te ')).toBe('slate')
    expect(lettersOf('ADIEUX')).toBe('adieu')
  })
})
