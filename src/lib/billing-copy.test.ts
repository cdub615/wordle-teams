import { describe, expect, test } from 'vitest'
import {
  CHECKOUT_FAILED,
  checkoutOutcome,
  pendingInviteLabel,
  portalOutcome,
} from './billing-copy.ts'
import type { BillingOutcome } from './billing-copy.ts'

/**
 * A PortalResult WITH FOUR BRANCHES IS ONLY WORTH ANYTHING IF THE UI HONOURS IT.
 *
 * convex/polar.ts goes to real trouble to distinguish "you have no billing
 * account" and "this deployment is not set up" from "something broke" —
 * lookupPortal refuses to let a 500 on the first identity degrade into
 * `no-customer`, polarEnvProblem runs before any network call, and PortalResult
 * carries the reason all the way out — and every bit of that is wasted if the
 * client folds the url-less answers back together into one "please try again".
 * v1 shipped that fold three times over `no-customer`, and wordle-teams-9fm was
 * v2 shipping it once more over `not-configured`.
 *
 * NOTHING ELSE IN THIS REPO CAN CATCH THE no-customer FOLD. e2e cannot reach a
 * real Polar ANSWER — the deployment it drives has no POLAR_* variable set, so
 * both actions stop at the environment check (wordle-teams-3bl; the five are set
 * on production only) — and a component test with a stubbed action asserts the
 * stub. The `not-configured` fold is the exception, and only because that same
 * unset deployment IS the case: e2e/billing.spec.ts pins it end to end.
 *
 * ASSERTS THE PROPERTY, NOT THE SENTENCE, following convex-error.test.ts: what
 * must hold is that the failures are DIFFERENT from each other and that only the
 * retryable one asks for a retry. Reword freely; keep that true.
 *
 * THE THIRD PROPERTY IS A SECRETS ONE (wordle-teams-9fm). convex/polar.ts knows
 * which variable is missing and what nonsense POLAR_SERVER holds, and it logs
 * exactly that — but this repo is public and the browser is not where an
 * environment value goes. No message here may carry one, and the only way to be
 * sure of that from a unit test is to forbid the prefix outright.
 */

/** try again, tried again, trying again — every form of the advice that is a lie for no-customer. */
const RETRY_WORDING = /try(ing)? again/i

/**
 * Any environment variable name or value that could have leaked out of
 * polarEnvProblem's message. Deliberately the whole prefix rather than the five
 * names: a sixth variable would be missed by a list, and nothing a player reads
 * has any business containing 'POLAR_' at all.
 */
const ENV_LEAK = /POLAR_/

/** The message of an outcome that has to be a toast. */
const toastText = (outcome: BillingOutcome): string => {
  if (outcome.action !== 'toast') throw new Error(`expected a toast, got ${outcome.action}`)
  return outcome.message
}

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

  // THE BUG (wordle-teams-9fm). A misconfigured deployment used to arrive here
  // as `error`, so the owner clicking Billing on beta was told to try again at
  // a state no number of clicks can clear.
  test('not-configured never tells the player to try again', () => {
    expect(toastText(portalOutcome({ url: null, reason: 'not-configured' }))).not.toMatch(
      RETRY_WORDING,
    )
  })

  test('not-configured is an error, not information', () => {
    expect(portalOutcome({ url: null, reason: 'not-configured' })).toMatchObject({
      action: 'toast',
      level: 'error',
    })
  })

  // THE SECRETS PROPERTY. polarEnvProblem's message names the missing variables
  // and quotes POLAR_SERVER's value; it is logged and must go no further.
  test.each([
    { url: null, reason: 'no-customer' as const },
    { url: null, reason: 'not-configured' as const },
    { url: null, reason: 'error' as const },
  ])('$reason leaks no environment variable', (result) => {
    expect(toastText(portalOutcome(result))).not.toMatch(ENV_LEAK)
  })

  test('the three failures do not say the same thing', () => {
    const messages = (['no-customer', 'not-configured', 'error'] as const).map((reason) =>
      toastText(portalOutcome({ url: null, reason })),
    )
    expect(new Set(messages).size).toBe(messages.length)
  })

  // Sanity on the assertions above: they only mean something if every branch
  // returns real end-user text. An empty string passes "does not mention retry"
  // and "leaks no variable" alike.
  test.each([
    { url: null, reason: 'no-customer' as const },
    { url: null, reason: 'not-configured' as const },
    { url: null, reason: 'error' as const },
  ])('$reason returns a real sentence', (result) => {
    const message = toastText(portalOutcome(result))
    expect(message.length).toBeGreaterThan(10)
    expect(message).toMatch(/[a-z]/)
  })
})

describe('checkoutOutcome', () => {
  test('a url navigates rather than toasting', () => {
    expect(checkoutOutcome({ url: 'https://polar.example/checkout/abc' })).toEqual({
      action: 'navigate',
      url: 'https://polar.example/checkout/abc',
    })
  })

  // The opposite property to no-customer's: an OPERATIONAL checkout failure IS
  // worth retrying, because a Polar outage and a routing bug are both transient
  // rather than a state the player chose.
  test('error invites a retry', () => {
    expect(toastText(checkoutOutcome({ url: null, reason: 'error' }))).toMatch(RETRY_WORDING)
    expect(CHECKOUT_FAILED).toMatch(RETRY_WORDING)
  })

  // THE SAME BUG ON THE OTHER PATH. createProCheckout returned a bare null for
  // every cause alike, so the upgrade button said "please try again" to a
  // deployment holding no access token.
  test('not-configured never tells the player to try again', () => {
    expect(toastText(checkoutOutcome({ url: null, reason: 'not-configured' }))).not.toMatch(
      RETRY_WORDING,
    )
  })

  test.each([{ url: null, reason: 'not-configured' as const }, { url: null, reason: 'error' as const }])(
    '$reason leaks no environment variable and is a real sentence',
    (result) => {
      const message = toastText(checkoutOutcome(result))
      expect(message).not.toMatch(ENV_LEAK)
      expect(message.length).toBeGreaterThan(10)
    },
  )

  test('the two failures do not say the same thing', () => {
    expect(toastText(checkoutOutcome({ url: null, reason: 'not-configured' }))).not.toBe(
      toastText(checkoutOutcome({ url: null, reason: 'error' })),
    )
  })

  // The player clicked a specific button, and the two surfaces are different
  // buttons. A shared constant would be the tidier code and the worse answer.
  test('says upgrades rather than the portal sentence', () => {
    expect(toastText(checkoutOutcome({ url: null, reason: 'not-configured' }))).not.toBe(
      toastText(portalOutcome({ url: null, reason: 'not-configured' })),
    )
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
