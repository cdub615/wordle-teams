import { describe, expect, test } from 'vitest'
import { initialsFor } from './initials.ts'

describe('initialsFor', () => {
  test('takes the first letter of each name, uppercased', () => {
    expect(initialsFor('christian', 'white')).toBe('CW')
  })

  test('trims surrounding whitespace before reading the first letter', () => {
    expect(initialsFor(' Christian ', ' White ')).toBe('CW')
  })

  // The exact bug this function exists to not reproduce: v1's
  // scores-table.tsx indexes lastName[0], which is `undefined` for ''.
  // charAt(0) on an empty string is '', not undefined — no crash, no stray
  // "undefined" in the output, just one missing letter.
  test('an empty last name contributes nothing, not "undefined"', () => {
    expect(initialsFor('Christian', '')).toBe('C')
  })

  test('an empty first name contributes nothing either', () => {
    expect(initialsFor('', 'White')).toBe('W')
  })

  test('both names empty falls back to the first letter of the email', () => {
    expect(initialsFor('', '', 'ada@example.com')).toBe('A')
  })

  test('both names and no email at all returns null, not a crash', () => {
    expect(initialsFor('', '', undefined)).toBeNull()
    expect(initialsFor('', '', null)).toBeNull()
  })

  test('an empty-string email is treated the same as no email', () => {
    expect(initialsFor('', '', '')).toBeNull()
  })

  // Pins the email fallback's OWN .trim(), separately from the names' —
  // a mutant that dropped just this one survived: without it, a
  // leading-space email returns ' ' (a blank-looking avatar) instead of 'A'.
  test('trims surrounding whitespace on the email fallback too', () => {
    expect(initialsFor('', '', '  ada@example.com')).toBe('A')
  })
})
