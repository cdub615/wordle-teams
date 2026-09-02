import { createFileRoute, redirect, useNavigate } from '@tanstack/react-router'
import { convexQuery, useConvexMutation } from '@convex-dev/react-query'
import { useMutation } from '@tanstack/react-query'
import { useState, type FormEvent } from 'react'
import { api } from '../../convex/_generated/api'
import { pageTitle } from '#/lib/seo'
import { useHydrated } from '#/lib/use-hydrated'
import { Button } from '#/components/ui/button.tsx'
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '#/components/ui/card.tsx'
import { Input } from '#/components/ui/input.tsx'
import { Label } from '#/components/ui/label.tsx'
import { dashboardErrorMessage, mutationErrorMessage, typedCodeMessage } from '#/lib/convex-error.ts'
import { isCompleteName } from '../../convex/lib/invite.ts'
import { toPuzzleDay } from '../../convex/lib/puzzleDay.ts'
import type { ErrorComponentProps } from '@tanstack/react-router'

/**
 * The one screen every v2 account passes through, because completeProfile is
 * what CREATES the player row (see convex/players.ts).
 *
 * Ports v1's /complete-profile, which A7 makes a sanctioned parity exception —
 * this is the onboarding surface, and it is the largest measured leak in the
 * product (wordle-teams-456: 87% of prod signups never enter a board;
 * wordle-teams-390: ~93% abandon at login). The COPY is v1's, verbatim. The
 * SHELL and the FORM MECHANICS are /login's — page-wrap, one Card, uncontrolled
 * inputs, a hydration-gated submit and one role="alert" — rather than v1's bare
 * `mt-24` block, because these two screens are consecutive steps of the same
 * funnel and A7 is the reason /login was restyled in the first place.
 */
export const Route = createFileRoute('/complete-profile')({
  head: () => ({ meta: [{ title: pageTitle('Complete Profile') }] }),
  beforeLoad: async ({ context }) => {
    if (!context.isAuthenticated) throw redirect({ to: '/login' })
    const needsProfile = await context.queryClient.ensureQueryData(
      convexQuery(api.players.needsProfile, {}),
    )
    // Already have a player? Nothing to complete.
    if (!needsProfile) throw redirect({ to: '/app' })
  },
  // THE FIRST ROUTE TO AWAIT A CONVEX QUERY IN beforeLoad, so it is also the
  // first that needs its own boundary: without one, a throw from needsProfile
  // renders TanStack's raw default — "Something went wrong!", a Hide Error
  // toggle and the error string, with no Header, no Footer and no way out — on
  // the screen where the account is created. See CompleteProfileError below.
  errorComponent: CompleteProfileError,
  component: CompleteProfilePage,
})

/**
 * This route's error boundary. NOT DashboardError, which is not a drop-in: it
 * clears `STORAGE_KEY` and navigates to `/app` with empty search, both of which
 * are dashboard-specific repairs for a stale `?team=`. Nothing here has a bad
 * parameter to escape — the only thing that can throw is the needsProfile read
 * — so plain `reset()` is the right retry: it re-runs beforeLoad, which is
 * exactly the operation that failed.
 *
 * DESIGN_SYSTEM.md §7 "Error state": `text-lg` headline, muted body, single
 * primary retry button, same as DashboardError.
 */
function CompleteProfileError({ error, reset }: ErrorComponentProps) {
  return (
    <main className="page-max flex w-full justify-center p-2 md:p-12">
      <div className="flex max-w-lg flex-col items-center gap-4 pt-10 text-center">
        <p className="text-lg">Ruh roh, something went wrong!</p>
        <p className="text-muted-foreground">{dashboardErrorMessage(error)}</p>
        <Button onClick={reset}>Try again</Button>
      </div>
    </main>
  )
}

function CompleteProfilePage() {
  const navigate = useNavigate()
  const hydrated = useHydrated()
  const complete = useMutation({ mutationFn: useConvexMutation(api.players.completeProfile) })
  const [error, setError] = useState<string | null>(null)
  const [submitting, setSubmitting] = useState(false)

  /**
   * THE INPUTS ARE UNCONTROLLED AND SUBMIT IS GATED ON HYDRATION ALONE, exactly
   * as login.tsx does it, and for the same reason (wt-ksh.2.2): this form is
   * server-rendered, so it looks interactive before any JavaScript has run. A
   * controlled input bound to empty state wipes whatever was typed the moment
   * React attaches, and a click before then fires a native GET that carries
   * nothing and reads as "the button does nothing" — on the screen where the
   * account is created. `!hydrated` is now the ONLY thing disabling this button,
   * which makes it load-bearing; e2e/complete-profile.spec.ts asserts it with
   * JavaScript switched off.
   *
   * IT IS DELIBERATELY *NOT* GATED ON THE NAME BEING COMPLETE, though it was in
   * this task's first draft. A content-gated `disabled` strands the user: it
   * removes the button from the focus order, so tabbing out of Last Name lands
   * in the footer; Enter does nothing; `disabled:pointer-events-none` kills
   * hover and title; `required` never fires, because native validation only runs
   * on a submit attempt the gate makes unreachable — and none of that explains
   * itself. An error message tells the user strictly more than a dead button
   * does. Owner's ruling after Task 6's review.
   *
   * isCompleteName IS STILL THE SHARED PREDICATE — the same function
   * completeProfileFor validates with — so the message below and the server's
   * INVALID_NAME cannot disagree about what a complete name is, and they read
   * identically because both resolve through typedCodeMessage. What the client
   * check buys is a local, instant answer; the server validates regardless
   * (convex/players.ts), so deleting it would be a UX regression, not a hole.
   * It is stricter than `required`, deliberately: `required` is satisfied by a
   * single space, and isCompleteName trims before judging.
   *
   * THE ROUTE GUARD IS A THIRD THING and does NOT go through isCompleteName —
   * needsProfile is a row-existence check that never reads a name back. It is
   * closed against a bounce anyway, and more strongly: completeProfileFor
   * validates BEFORE it writes and always leaves a row behind, so a name that
   * saves clears the guard whatever the guard's opinion of names would be. v1's
   * bug was having a second opinion at all — it saved any non-empty name and
   * guarded its redirect on `length > 1`, so a one-character name saved and then
   * redirected forever.
   */
  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    // Read from the DOM, synchronously, before any await: the inputs are
    // uncontrolled precisely so the DOM is the source of truth for what was
    // entered, and `currentTarget` is null once the handler yields.
    const data = new FormData(event.currentTarget)
    const firstName = String(data.get('firstName') ?? '')
    const lastName = String(data.get('lastName') ?? '')

    setError(null)
    if (!isCompleteName(firstName, lastName)) {
      // The server's own copy for this code, not a second wording of it.
      setError(typedCodeMessage('INVALID_NAME'))
      return
    }

    setSubmitting(true)
    try {
      await complete.mutateAsync({ firstName, lastName, today: toPuzzleDay(new Date()) })
      // NOTHING PRIMES THE CACHE BEFORE THIS HOP, AND NOTHING HAS TO — but the
      // reason is subtle enough to be worth stating, because getting it wrong
      // is the redirect loop wordle-teams-obw warns about. `/app`'s beforeLoad
      // asks ensureQueryData for this same needsProfile key, and ensureQueryData
      // returns cached data WITHOUT revalidating; a stale `true` left by this
      // route's own guard would bounce the user straight back here. It cannot
      // be stale by the time this line runs: @convex-dev/react-query subscribes
      // to every convex query the moment its cache entry is created (the query
      // cache's 'added' event — an observer is not required), and Convex holds
      // a mutation's promise until the client's query set has advanced past
      // that mutation's timestamp. So `false` is already in the cache here.
      // Verified in the browser as well as reasoned about, and the round trip
      // is pinned by e2e/complete-profile.spec.ts so a regression cannot land
      // silently.
      await navigate({ to: '/app' })
    } catch (err) {
      // Inline rather than a toast, unlike the team dialogs: this page has one
      // action and one error surface, the alert is announced by a screen reader
      // and stays put while the user fixes the field, and it does not depend on
      // the root Toaster being mounted.
      setError(mutationErrorMessage(err, 'Could not save your profile, please try again'))
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <main className="page-wrap flex justify-center px-4 py-10 sm:py-16">
      <Card className="w-full max-w-sm">
        <CardHeader>
          <CardTitle className="text-2xl" asChild>
            <h1>Complete Your Profile</h1>
          </CardTitle>
          <CardDescription>Please provide your name to complete your profile</CardDescription>
        </CardHeader>
        <CardContent>
          {/* EACH LABEL IS GROUPED WITH ITS OWN FIELD (gap-2) and the groups are
              separated (gap-6). A uniform gap measured identically between
              label→input, input→next label and input→Submit, which reads as
              "Last Name" belonging to the First Name input as much as to its
              own, and glues Submit to the last field — a mis-tap hazard at
              390x844 with the keyboard up. v1 grouped each pair in a wrapper
              div too; /login has a single pair, so the ambiguity cannot arise
              there and its flat gap-3 does not transfer. */}
          <form onSubmit={handleSubmit} className="flex flex-col gap-6">
            <div className="grid gap-2">
              <Label htmlFor="firstName">First Name</Label>
              <Input
                id="firstName"
                name="firstName"
                type="text"
                autoComplete="given-name"
                required
              />
            </div>
            <div className="grid gap-2">
              <Label htmlFor="lastName">Last Name</Label>
              <Input
                id="lastName"
                name="lastName"
                type="text"
                autoComplete="family-name"
                required
              />
            </div>
            <Button type="submit" disabled={!hydrated || submitting}>
              {submitting ? 'Saving…' : 'Submit'}
            </Button>
            {error && (
              <p role="alert" className="text-sm text-danger">
                {error}
              </p>
            )}
          </form>
        </CardContent>
      </Card>
    </main>
  )
}
