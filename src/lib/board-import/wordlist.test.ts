import { describe, expect, it } from 'vitest'
import { acceptedGuesses, isAccepted } from './wordlist.ts'

describe('the accepted-guess list', () => {
  it('holds the full pre-NYT accepted set', () => {
    expect(acceptedGuesses().length).toBeGreaterThan(12000)
  })

  it('is uppercase, five letters, and sorted', () => {
    const words = acceptedGuesses()
    expect(words.every((w) => /^[A-Z]{5}$/.test(w))).toBe(true)
    expect([...words].sort()).toEqual([...words])
  })

  it('accepts a known answer and a known non-answer guess', () => {
    expect(isAccepted('CRANE')).toBe(true)
    expect(isAccepted('AAHED')).toBe(true)
  })

  it('rejects a non-word and is case insensitive', () => {
    expect(isAccepted('ZZZZZ')).toBe(false)
    expect(isAccepted('crane')).toBe(true)
  })
})
