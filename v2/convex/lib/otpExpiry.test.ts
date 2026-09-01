import { describe, expect, test } from 'vitest'
import { OTP_EXPIRY_LABEL, OTP_EXPIRY_SEC, humanDuration } from './otpExpiry.ts'

/**
 * The expiry phrase, and the rounding bug it exists to make impossible.
 *
 * Both readers of the constant used to compute `Math.round(seconds / 60)`
 * independently, which is correct at 300 and wrong below 120 — in the direction
 * that tells a user a dead code is still alive. The cases below are the ones
 * that separate this helper from that expression; a test that only checked 300
 * would pass on the bug.
 */
describe('humanDuration', () => {
  test('a whole number of minutes is said in minutes', () => {
    expect(humanDuration(300)).toBe('5 minutes')
    expect(humanDuration(600)).toBe('10 minutes')
  })

  test('one minute is singular, because "1 minutes" reads as a bug', () => {
    expect(humanDuration(60)).toBe('1 minute')
  })

  test('a duration that is not whole minutes is said in seconds, never rounded', () => {
    // THE CASE THE OLD EXPRESSION GOT WRONG. `Math.round(90 / 60)` is 2, which
    // overstates a security-relevant window by 33%; `Math.floor` is 1, which
    // understates it. Both are false sentences about 90 seconds and this is
    // not.
    expect(humanDuration(90)).toBe('90 seconds')
    expect(humanDuration(45)).toBe('45 seconds')
    expect(humanDuration(1)).toBe('1 second')
  })

  test('under a minute stays in seconds rather than collapsing to zero', () => {
    // `Math.round(30 / 60)` is 0 — "0 minutes", which is not a window at all.
    expect(humanDuration(30)).toBe('30 seconds')
  })
})

describe('the sign-in code expiry', () => {
  test('is five minutes, and says so', () => {
    // Both halves, because the label is what ships in the email and on
    // /login-error and the number is what the emailOTP plugin enforces. If
    // these two ever disagree the product is promising a window it does not
    // honour, which is the entire reason this module exists.
    expect(OTP_EXPIRY_SEC).toBe(300)
    expect(OTP_EXPIRY_LABEL).toBe('5 minutes')
  })
})
