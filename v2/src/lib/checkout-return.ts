/**
 * The return trip from Polar's hosted checkout, reduced to the one decision it
 * still contains (wordle-teams-wxg, decision L).
 *
 * WHAT V1'S VERSION WAS FOR, AND WHY ALMOST NONE OF IT SURVIVES. v1's
 * `src/components/checkout-return.tsx` calls `supabase.auth.refreshSession()`
 * and then schedules a 2s retry, because `user_member_status` is stamped into
 * the Supabase token when it is issued: without a refresh the token still says
 * "free" no matter what the database holds, and the webhook races the browser
 * redirect. v2 reads membership through `api.teams.amIPro` as a reactive Convex
 * subscription (`routes/app.tsx`), so when the webhook patches
 * `playerMembership` the page updates on its own. There is no token to refresh
 * and nothing to re-fetch, which also retires v1's `handled` ref — that guard
 * exists only to stop the refresh running twice under React Strict Mode, and
 * there is no refresh left to run.
 *
 * PURE, AND SEPARATE FROM THE COMPONENT, for the reason billing-copy.ts gives:
 * `routes/app.tsx` can only be exercised end to end, so anything decided
 * inside it is a decision no unit test can reach. What is decided here is which
 * URLs count as a return from checkout and exactly what the URL becomes after.
 */

/**
 * The marker `createProCheckout` sends the player back with.
 *
 * `convex/polar.ts` sets `successUrl` to `${siteUrl()}/app?checkout=success`, so
 * this pair is the whole of the return leg's input: one query parameter on the
 * dashboard route. Both halves are constants rather than a literal here because
 * they are the contract between that action and this module.
 */
export const CHECKOUT_PARAM = 'checkout'
export const CHECKOUT_SUCCESS = 'success'

/**
 * `null` when this URL is not a return from checkout; otherwise the URL to put
 * in its place, with the marker removed.
 *
 * ONLY `checkout=success` COUNTS. Any other value — a cancelled checkout, a
 * hand-typed param, a future marker — answers null rather than being treated as
 * a success, because the pending state this drives claims an upgrade is on its
 * way and saying that after a cancellation would be a lie.
 *
 * DELETES ONLY THIS PARAM. `?team=` and `?month=` are the dashboard's own
 * state; dropping them would move the selected team back to whatever
 * localStorage remembers, in the middle of an upgrade.
 *
 * RELATIVE, NOT ABSOLUTE. The result goes to `history.replaceState`, which
 * accepts either, and keeping the origin out of it means this can never
 * navigate the document somewhere else.
 *
 * IDEMPOTENT BY CONSTRUCTION: a second call on the stripped URL answers null.
 * That is what makes the effect calling it safe to run twice — React Strict
 * Mode double-invokes it — and safe across a reload. With the marker gone there
 * is nothing left to act on.
 */
export function checkoutReturnUrl(href: string): string | null {
  const url = new URL(href)
  if (url.searchParams.get(CHECKOUT_PARAM) !== CHECKOUT_SUCCESS) return null
  url.searchParams.delete(CHECKOUT_PARAM)
  return `${url.pathname}${url.search}${url.hash}`
}
