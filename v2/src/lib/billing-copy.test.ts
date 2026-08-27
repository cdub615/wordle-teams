import { describe, expect, test } from 'vitest'
import { CHECKOUT_FAILED, pendingInviteLabel, portalOutcome } from './billing-copy.ts'

/**
 * THE THREE-WAY PortalResult IS ONLY WORTH ANYTHING IF THE UI HONOURS IT.
 *
 * convex/polar.ts goes to real trouble to distinguish "you have no billing
 * account" from "something broke" — lookupPortal refuses to let a 500 on the
 * first identity degrade into `no-customer`, and PortalResult carries the
 * reason all the way out — and every bit of that is wasted if the client folds
 * the two nulls back together into one "please try again". v1 shipped that fold
 * three times. Nothing else in this repo can catch it: e2e cannot reach a real
 * Polar answer (no POLAR_* variable is set on any deployment, wordle-teams-3bl),
 * and a component test with a stubbed action asserts the stub.
 *
 * ASSERTS THE PROPERTY, NOT THE SENTENCE, following convex-error.test.ts: what
 * must hold is that the two failures are DIFFERENT and that only one of them
 * asks for a retry. Reword freely; keep that true.
 */

/** try again, tried again, trying again — every form of the advice that is a lie for no-customer. */
const RETRY_WORDING = /try(ing)? again/i

describe('portalOutcome', () => {
  test('a url navigates rather than toasting', () => {
    expect(portalOutcome({ url: 'https://polar.example/portal/abc' })).toEqual({
      action: 'navigate',
      url: 'https://polar.example/portal/abc',
    })
  })

  test('no-customer is information, not an error', () => {
    const outcome = portalOutcome({ url: null, reason: 'no-customer' })
    expect(outcome.action).toBe('toast')
    expect(outcome).toMatchObject({ level: 'info' })
  })

  test('no-customer never tells the player to try again', () => {
    // The whole point of the branch. Retrying cannot create a customer, so this
    // is the sentence that must never appear here.
    const outcome = portalOutcome({ url: null, reason: 'no-customer' })
    expect(outcome).toMatchObject({ action: 'toast' })
    if (outcome.action !== 'toast') throw new Error('unreachable')
    expect(outcome.message).not.toMatch(RETRY_WORDING)
  })

  test('error is an error, and it does invite a retry', () => {
    const outcome = portalOutcome({ url: null, reason: 'error' })
    expect(outcome).toMatchObject({ action: 'toast', level: 'error' })
    if (outcome.action !== 'toast') throw new Error('unreachable')
    expect(outcome.message).toMatch(RETRY_WORDING)
  })

  test('the two failures do not say the same thing', () => {
    const noCustomer = portalOutcome({ url: null, reason: 'no-customer' })
    const failure = portalOutcome({ url: null, reason: 'error' })
    if (noCustomer.action !== 'toast' || failure.action !== 'toast') {
      throw new Error('unreachable')
    }
    expect(noCustomer.message).not.toBe(failure.message)
    expect(noCustomer.level).not.toBe(failure.level)
  })

  // Sanity on the assertions above: they only mean something if both branches
  // return real end-user text. An empty string passes "does not mention retry".
  test.each([{ url: null, reason: 'no-customer' as const }, { url: null, reason: 'error' as const }])(
    '$reason returns a real sentence',
    (result) => {
      const outcome = portalOutcome(result)
      if (outcome.action !== 'toast') throw new Error('unreachable')
      expect(outcome.message.length).toBeGreaterThan(10)
      expect(outcome.message).toMatch(/[a-z]/)
    },
  )
})

describe('CHECKOUT_FAILED', () => {
  // The opposite property to no-customer's: a failed checkout IS worth
  // retrying, because both null causes are transient or a bug rather than a
  // state the player chose.
  test('invites a retry', () => {
    expect(CHECKOUT_FAILED).toMatch(RETRY_WORDING)
  })
})

describe('pendingInviteLabel', () => {
  test('one invite is singular', () => {
    expect(pendingInviteLabel(1)).toBe('1 Invite Pending')
  })

  test.each([0, 2, 3, 17])('%i invites is plural', (count) => {
    expect(pendingInviteLabel(count)).toBe(`${count} Invites Pending`)
  })

  test('the count is always in the text', () => {
    // The number is the entire content of the badge; a label that renders the
    // wording without it is the failure worth catching.
    for (let count = 0; count <= 25; count++) {
      expect(pendingInviteLabel(count)).toContain(String(count))
    }
  })
})
