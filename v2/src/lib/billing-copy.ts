import type { CheckoutResult, PortalResult } from '../../convex/polar.ts'

/**
 * What the billing surface SAYS, separated from where it says it.
 *
 * Sibling of convex-error.ts, and here for the same reason: the copy is the
 * deliverable, the component is not. Header.tsx and routes/app.tsx can only
 * be exercised end to end — a component test with a stubbed hook passes against
 * a broken integration — so anything decided in a component is a decision no
 * unit test can reach. The functions here hold every decision the billing UI
 * makes; what is left in the component is a call, a navigation and a toast.
 *
 * `import type` ONLY, and that matters: convex/polar.ts imports `@polar-sh/sdk`
 * at module scope, and a value import here would drag the whole Polar client
 * into the browser bundle. Measured, not assumed, and RE-measured for
 * wordle-teams-9fm because that bug added a second thing worth keeping out:
 * after `pnpm build`, the only occurrences of "polar" anywhere under
 * dist/client are the two strings "polar.createProCheckout" and
 * "polar.getCustomerPortalUrl" — the function references — the substring
 * "POLAR_" appears nowhere under dist/client at all, and `assertPolarEnv`'s and
 * `polarEnvProblem`'s messages appear nowhere in dist at all. That last one is
 * the property this module's copy exists to hold: the server knows which
 * variable is wrong and says so in its log; the browser is told only that
 * billing is unavailable.
 */

/**
 * What either billing action can make the UI do: go somewhere, or say
 * something.
 *
 * Named for billing rather than for the portal because the checkout answers in
 * the same two shapes and deserves the same treatment — see `checkoutOutcome`.
 */
export type BillingOutcome =
  | { action: 'navigate'; url: string }
  | { action: 'toast'; level: 'info' | 'error'; message: string }

/**
 * THE ONE SENTENCE THE PLAYER IS OWED WHEN THE DEPLOYMENT IS BROKEN, and the
 * three properties it has to keep. billing-copy.test.ts asserts all three,
 * because each of them is a way this has already gone wrong somewhere:
 *
 *   - IT DOES NOT ASK FOR A RETRY. `not-configured` is the state a retry can
 *     never clear: a variable is unset, or names the wrong Polar instance, or
 *     the token was rejected. Only a person changing a deployment setting fixes
 *     it. Saying "please try again" here is the whole of wordle-teams-9fm.
 *   - IT NAMES NO VARIABLE AND NO VALUE. convex/polar.ts knows exactly what is
 *     wrong and logs it; that string quotes environment values and this repo is
 *     public, so it stops at the server. Nothing here interpolates anything.
 *   - IT SAYS WHOSE PROBLEM IT IS. The reader is a Wordle player looking at a
 *     dead button, and their first guess is their own card, their own account,
 *     or something they did. None of those is true and the sentence says so.
 *
 * Two wordings rather than one shared constant: the player clicked a specific
 * thing, and "billing" and "upgrades" are what they clicked.
 */
export const PORTAL_NOT_CONFIGURED =
  'Billing is unavailable. This is a problem on our end, not with your account.'

export const CHECKOUT_NOT_CONFIGURED =
  'Upgrades are unavailable. This is a problem on our end, not with your account.'

/**
 * The checkout's OPERATIONAL failure — and the fallback for a checkout that
 * threw before it could answer at all, which is what routes/app.tsx hands to
 * mutationErrorMessage. Declared above its two readers so nothing depends on
 * hoisting.
 */
export const CHECKOUT_FAILED = 'Could not start checkout. Please try again.'

/**
 * The four answers getCustomerPortalUrl can give, turned into the two things a
 * UI can do about them.
 *
 * A `switch` OVER `reason` WITH A `never` DEFAULT, so a fifth PortalResult
 * branch stops compiling here rather than silently falling into "try again
 * later". That is the failure this whole shape exists to prevent: telling
 * somebody who has never checked out to keep retrying is a condition retrying
 * can never fix, and v1 shipped it three times. It earned itself when
 * `not-configured` was added — the compiler named this function before any test
 * ran.
 *
 * `no-customer` IS `info`, NOT `error`. It is the expected state for everyone
 * who has never bought anything — most callers — and dressing it as a failure
 * is the lie. See the note on PortalResult in convex/polar.ts.
 *
 * `not-configured` IS `error` BUT NOT RETRYABLE, which is the pair no other
 * branch is: nothing has gone right, and nothing the player does next changes
 * that.
 */
export function portalOutcome(result: PortalResult): BillingOutcome {
  if (result.url !== null) return { action: 'navigate', url: result.url }

  switch (result.reason) {
    case 'no-customer':
      // Deliberately not "you are not subscribed": a player can hold no Polar
      // customer and still be reading this because they wondered what the
      // button did. It states the fact and nothing about what to do next,
      // because there is nothing this branch can honestly tell them to do.
      return {
        action: 'toast',
        level: 'info',
        message: 'You do not have a billing account yet.',
      }
    case 'not-configured':
      return { action: 'toast', level: 'error', message: PORTAL_NOT_CONFIGURED }
    case 'error':
      return {
        action: 'toast',
        level: 'error',
        message: 'Could not open the billing portal. Please try again.',
      }
    default: {
      const exhaustive: never = result
      return exhaustive
    }
  }
}

/**
 * What to say when createProCheckout does not hand back a URL.
 *
 * THE RETRY IS EARNED HERE AND NOT ASSUMED. `error` covers a Polar outage and
 * an unresolvable player (a routing bug), and both are worth another click.
 * `not-configured` is not, and it used to be folded in with them: the action
 * returned a bare `string | null`, so an unset access token and a Polar
 * 500 produced the same sentence. That is wordle-teams-9fm on the checkout
 * path, and this switch is the same `never`-defaulted shape the portal uses so
 * the next branch cannot be forgotten either.
 */
export function checkoutOutcome(result: CheckoutResult): BillingOutcome {
  if (result.url !== null) return { action: 'navigate', url: result.url }

  switch (result.reason) {
    case 'not-configured':
      return { action: 'toast', level: 'error', message: CHECKOUT_NOT_CONFIGURED }
    case 'error':
      return { action: 'toast', level: 'error', message: CHECKOUT_FAILED }
    default: {
      const exhaustive: never = result
      return exhaustive
    }
  }
}

/**
 * The pending-invite badge's text.
 *
 * PLURALISED THE WAY v1 PLURALISES IT — `src/components/app-bar/user-dropdown.tsx:182`,
 * `{n} Invite{n === 1 ? '' : 's'} Pending` — because this badge is a port and
 * the wording is the recognisable part of it. 0 reads "0 Invites Pending",
 * which is correct English and never rendered: the caller shows the badge only
 * above zero, exactly as v1 does.
 *
 * A FUNCTION RATHER THAN JSX so the rule is reachable without a DOM. The count
 * itself is derived server-side (pendingInviteCountFor, convex/billing.ts) and
 * tested there; this owns only how it reads.
 */
export function pendingInviteLabel(count: number): string {
  return `${count} Invite${count === 1 ? '' : 's'} Pending`
}
