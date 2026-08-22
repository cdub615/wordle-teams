import { describe, expect, test } from 'vitest'
import { isE2eEmail, isE2eTraffic } from './e2e.ts'

// The addresses here are throwaway e2e shapes and example.test, never anybody's
// real address — this repository is public.
const E2E = 'e2e+abc123@wordleteams.com'
const REAL = 'ada@example.test'

describe('isE2eEmail', () => {
  test('accepts the throwaway shape', () => {
    expect(isE2eEmail(E2E)).toBe(true)
  })

  test('is case-insensitive, because auth lowercases and callers may not', () => {
    expect(isE2eEmail('E2E+ABC@WordleTeams.COM')).toBe(true)
  })

  test.each([
    ['a real address', REAL],
    ['the right domain without the e2e+ prefix', 'ada@wordleteams.com'],
    ['an e2e+ prefix on somebody else’s domain', 'e2e+abc@example.test'],
    ['a bare plus with no tag', 'e2e+@wordleteams.com'],
    ['the domain as a subdomain of somewhere else', 'e2e+abc@wordleteams.com.evil.test'],
    // PINS THE LEADING ANCHOR, and it is the dangerous direction. Without `^` —
    // or with `.test()` swapped for a `.search() >= 0` — this real person is
    // reclassified as e2e traffic, and on a deployment with the flag set their
    // genuine invitation is dropped silently with the suite fully green. Every
    // other fixture here gives the same verdict with or without `^`.
    ['a real local part that merely ENDS in the throwaway shape', 'ada.e2e+news@wordleteams.com'],
    // Pins the escaped dot in the domain.
    ['a domain differing only where the dot is', 'e2e+abc@wordleteamsXcom'],
    ['an empty string', ''],
  ])('rejects %s', (_label, email) => {
    expect(isE2eEmail(email)).toBe(false)
  })
})

describe('isE2eTraffic', () => {
  test('an e2e address on a deployment in test mode is e2e traffic', () => {
    expect(isE2eTraffic(E2E, 'true')).toBe(true)
  })

  // THE PRODUCTION HALF — a requirement, not yet a fact. E2E_TEST_MODE MUST NOT
  // be set on the deployment that becomes production, so that an address
  // matching the throwaway shape is treated as an ordinary user there and gets
  // its real mail. But beta carries its environment into production at cutover;
  // wordle-teams-7az is the step that clears it and is still OPEN. These cases
  // pin what the predicate does with the flag off — they cannot pin that the
  // flag is off.
  test.each([
    ['unset', undefined],
    ['empty', ''],
    ['the string "false"', 'false'],
    // Guards the exact-comparison: anything truthy-but-not-'true' must not pass.
    ['some other truthy string', '1'],
    ['the wrong case', 'TRUE'],
  ])('an e2e address is NOT e2e traffic when the mode flag is %s', (_label, mode) => {
    expect(isE2eTraffic(E2E, mode)).toBe(false)
  })

  // THE OTHER HALF. A machine running tests still sends real mail to real
  // people — a genuine invitation is never swallowed by the flag alone.
  test('a real address is NOT e2e traffic even in test mode', () => {
    expect(isE2eTraffic(REAL, 'true')).toBe(false)
  })
})
