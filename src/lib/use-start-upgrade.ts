import { useConvexAction } from '@convex-dev/react-query'
import { useRef, useState } from 'react'
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
 * and use-search-sync.ts, in the same directory for the same reason.
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
 *
 * `abandonUpgrade` IS A FOURTH OUTCOME OF THE ROUND TRIP, AND IT LIVES HERE
 * RATHER THAN IN THE DIALOG (wordle-teams-iht.1.10). The player can walk away
 * mid-flight — dismiss the upgrade dialog while Polar is still being asked for
 * a URL — and until this existed that did nothing at all: the promise below
 * survived the dismissal and `location.href` was assigned when it resolved, so
 * the surface built so nobody lands on checkout uninformed landed them there
 * after they had explicitly declined.
 *
 * WHY HERE AND NOT IN upgrade-dialog.tsx, which is where dismissal is known.
 * The two things cancellation has to reach are the navigation and the pending
 * flag, and this module owns both — a caller cannot skip an assignment made
 * inside this closure, so a dialog-side token would still need this file to
 * consult it, which is one decision with two owners. The banner above says this
 * is the single place that knows what a checkout attempt can end as; "the
 * player left" is one of those endings, sitting beside the url, the two
 * url-less reasons and the throw, and the reason wordle-teams-9fm happened was
 * a caller hand-rolling one of those endings for itself. The cost is real and
 * accepted: the hook now has a concept of a caller who can go away, which it
 * did not before. It is additive — every existing property above is unchanged,
 * and the alternative on offer was disabling all four exits for the round trip,
 * which makes the dialog briefly inescapable and is worse.
 *
 * IT IS PER-ATTEMPT, CLEARED BY THE NEXT `startUpgrade`. A flag that latched
 * would be a worse bug than the one it fixes: an Upgrade button that is mounted,
 * enabled and spinner-free while silently declining to take anybody's money —
 * the dead-button-indistinguishable-from-a-working-one failure this file and
 * useUpgrade's throw are both already written against.
 *
 * AND IT LOWERS `pending` ITSELF rather than waiting for the `finally`, because
 * the caller that abandons is not necessarily gone: upgrade-dialog.tsx stays
 * mounted across a close (its origin has to outlive the exit animation), so a
 * flag left raised is a re-opened dialog whose CTA is disabled and `aria-busy`
 * for a request the player believes they abandoned, with nothing to do but wait
 * on a promise nobody is waiting for.
 *
 * A REF, NOT STATE, because it is read by a closure that is already running —
 * re-rendering with a new value would not reach the `await` that is in flight.
 */
export function useStartUpgrade(): {
  startUpgrade: () => Promise<void>
  abandonUpgrade: () => void
  pending: boolean
} {
  const createCheckout = useConvexAction(api.polar.createProCheckout)
  const [pending, setPending] = useState(false)
  const abandoned = useRef(false)

  const abandonUpgrade = () => {
    abandoned.current = true
    setPending(false)
  }

  const startUpgrade = async () => {
    abandoned.current = false
    setPending(true)
    try {
      const result = await createCheckout({})
      // THE ONE GUARD THAT COVERS BOTH ANSWERS. Whatever Polar said, a player
      // who has walked away gets neither a navigation nor a toast: a failure
      // sentence raised over whatever they went on to do instead is noise about
      // a thing they abandoned.
      if (abandoned.current) return
      const outcome = checkoutOutcome(result)
      if (outcome.action === 'navigate') {
        window.location.href = outcome.url
        return
      }
      // level is 'info' or 'error', and sonner has a method for each. Indexing
      // rather than branching keeps the two-way choice in billing-copy.ts,
      // where the test can see it.
      //
      // TODAY THE INDEX CAN ONLY EVER BE 'error', WHICH MAKES THIS AN
      // EQUIVALENT MUTANT AND IS RECORDED RATHER THAN CHASED. `checkoutOutcome`
      // has two url-less branches and both are `level: 'error'`; the portal's
      // mapping is the one with an `info` branch, and BillingOutcome is shared
      // between them. So rewriting this as `toast.error(outcome.message)` is
      // behaviour-identical and no test can kill it. It stays indexed because
      // the day `checkoutOutcome` grows an `info` branch — the shape of it is
      // already legal in the return type — the literal would quietly report it
      // as a failure, which is exactly the class of bug wordle-teams-9fm was.
      toast[outcome.level](outcome.message)
    } catch (error) {
      if (abandoned.current) return
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

  return { startUpgrade, abandonUpgrade, pending }
}
