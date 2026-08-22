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
    ['an empty string', ''],
  ])('rejects %s', (_label, email) => {
    expect(isE2eEmail(email)).toBe(false)
  })
})

describe('isE2eTraffic', () => {
  test('an e2e address on a deployment in test mode is e2e traffic', () => {
    expect(isE2eTraffic(E2E, 'true')).toBe(true)
  })

  // THE PRODUCTION HALF. E2E_TEST_MODE is never set on the deployment that
  // becomes production (wordle-teams-7az), so even an address that happens to
  // match the throwaway shape is treated as an ordinary user there and gets its
  // real mail. Suppressing it would mean silently never inviting somebody.
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
