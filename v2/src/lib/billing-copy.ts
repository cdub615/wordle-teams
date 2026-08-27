import type { PortalResult } from '../../convex/polar.ts'

/**
 * What the billing surface SAYS, separated from where it says it.
 *
 * Sibling of convex-error.ts, and here for the same reason: the copy is the
 * deliverable, the component is not. Header.tsx and routes/index.tsx can only
 * be exercised end to end — a component test with a stubbed hook passes against
 * a broken integration — so anything decided in a component is a decision no
 * unit test can reach. These two functions hold every decision the billing UI
 * makes; what is left in the component is a call, a navigation and a toast.
 *
 * `import type` ONLY, and that matters: convex/polar.ts imports `@polar-sh/sdk`
 * at module scope, and a value import here would drag the whole Polar client
 * into the browser bundle. Measured, not assumed: after `pnpm build`, the only
 * occurrences of "polar" anywhere under dist/client are the two strings
 * "polar.createProCheckout" and "polar.getCustomerPortalUrl" — the function
 * references — and `assertPolarEnv`'s message appears nowhere in dist at all.
 */

/**
 * The three answers getCustomerPortalUrl can give, turned into the two things a
 * UI can do about them.
 *
 * A `switch` OVER `reason` WITH A `never` DEFAULT, so a fourth PortalResult
 * branch stops compiling here rather than silently falling into "try again
 * later". That is the failure this whole three-way shape exists to prevent:
 * telling somebody who has never checked out to keep retrying is a condition
 * retrying can never fix, and v1 shipped it three times.
 *
 * `no-customer` IS `info`, NOT `error`. It is the expected state for everyone
 * who has never bought anything — most callers — and dressing it as a failure
 * is the lie. See the note on PortalResult in convex/polar.ts.
 */
export type PortalOutcome =
  | { action: 'navigate'; url: string }
  | { action: 'toast'; level: 'info' | 'error'; message: string }

export function portalOutcome(result: PortalResult): PortalOutcome {
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
 * What to say when createProCheckout answers null.
 *
 * NULL IS ALWAYS A FAILURE HERE, unlike the portal's null: the action returns
 * it for an unresolvable player (a routing bug) or a Polar outage, and neither
 * is a state the player is in on purpose. So there is one sentence rather than
 * two, and it is the one that invites the retry that might actually work.
 */
export const CHECKOUT_FAILED = 'Could not start checkout. Please try again.'

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
