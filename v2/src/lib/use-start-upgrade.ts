import { useConvexAction } from '@convex-dev/react-query'
import { useState } from 'react'
import { toast } from 'sonner'
import { api } from '../../convex/_generated/api'
import { CHECKOUT_FAILED, checkoutOutcome } from '#/lib/billing-copy.ts'
import { mutationErrorMessage } from '#/lib/convex-error.ts'

/**
 * STARTING A CHECKOUT, ONCE, FOR EVERY PLACE THAT OFFERS ONE.
 *
 * Lifted out of routes/app.tsx by wordle-teams-6tp, which added the SECOND
 * caller: Header.tsx's always-reachable Upgrade button. Nothing about the logic
 * changed in the lift — this is the same body, and the reasons it has the shape
 * it has are below, moved with it.
 *
 * A HOOK RATHER THAN A PLAIN FUNCTION because `useConvexAction` is one, and the
 * pending flag it pairs with is React state. Sibling of use-local-capture.ts
 * and use-dashboard-search-sync.ts, in the same directory for the same reason.
 *
 * ONE COPY, NOT TWO, AND THAT IS THE WHOLE POINT OF THE LIFT. wordle-teams-9fm
 * was this logic getting a failure branch wrong in one place; a second
 * hand-written copy is that bug's next opportunity. The branching itself is not
 * even here — it is billing-copy.ts's `checkoutOutcome`, where a test can see
 * it without a DOM.
 *
 * A FULL-PAGE NAVIGATION, NOT the router: the URL is on polar.sh, and
 * TanStack's `navigate` only knows this app's routes.
 *
 * A URL-LESS CheckoutResult IS THE ONLY FAILURE SHAPE createProCheckout HAS —
 * it catches its own Polar errors, and an unset SITE_URL with them, since that
 * read is inside its `try` — so the catch below is for the transport or for the
 * identity query throwing before the action could answer at all. Both must say
 * something; a dead button is indistinguishable from a broken one.
 *
 * AND THE TWO FAILURES IT REPORTS ARE NOT THE SAME FAILURE, which is why this
 * asks billing-copy.ts rather than testing for a URL. `not-configured` cannot be
 * retried into working, so it must not be shown the sentence that says to try —
 * see `checkoutOutcome`, and wordle-teams-9fm, where this treated every cause
 * alike.
 *
 * `pending` EXISTS FOR THE HEADER'S BUTTON, which needs the same spinner and
 * the same disabled window Header.tsx's portal button already has. app.tsx's
 * dropdown item ignores it: a DropdownMenu closes on select, so there is no
 * control left on screen to put a spinner in.
 */
export function useStartUpgrade(): { startUpgrade: () => Promise<void>; pending: boolean } {
  const createCheckout = useConvexAction(api.polar.createProCheckout)
  const [pending, setPending] = useState(false)

  const startUpgrade = async () => {
    setPending(true)
    try {
      const outcome = checkoutOutcome(await createCheckout({}))
      if (outcome.action === 'navigate') {
        window.location.href = outcome.url
        return
      }
      // level is 'info' or 'error', and sonner has a method for each. Indexing
      // rather than branching keeps the two-way choice in billing-copy.ts,
      // where the test can see it.
      toast[outcome.level](outcome.message)
    } catch (error) {
      toast.error(mutationErrorMessage(error, CHECKOUT_FAILED))
    } finally {
      // Runs on the navigate branch too, exactly as Header.tsx's portal button
      // already does. Assigning `location.href` does not unload the document
      // synchronously, so leaving the flag raised would strand a spinner on a
      // page that may yet come back (the player hits Escape on Polar's page and
      // the browser restores this one from the bfcache with its state intact).
      setPending(false)
    }
  }

  return { startUpgrade, pending }
}
