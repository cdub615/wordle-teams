/**
 * Login funnel instrumentation (wt-ksh.12.7, amendment A7).
 *
 * WHY THIS EXISTS. wordle-teams-390 measured ~203 people reaching /login in 30
 * days with roughly 16 completing an auth round-trip, and ZERO server-side auth
 * failures in the window. Server logs therefore cannot explain the loss — they
 * only prove nothing errored. Attributing where people leave needs client-side
 * events, which is what this module provides.
 *
 * DESTINATION: LogSnag, project `wordle-teams`, channel `login-funnel`
 * (wt-ksh.12.11). v1 already reports signups to the same project, which is what
 * makes the v1 and v2 funnels directly comparable — the reason that number is
 * worth collecting at all.
 *
 * The token is a SECRET and never reaches the browser. This module posts to our
 * own /api/funnel route; the Worker holds the token and forwards to LogSnag.
 *
 * TWO RULES THIS MODULE MUST NEVER BREAK:
 *   1. Never block or fail auth. wordle-teams-4ov is exactly this bug in v1 —
 *      handleLogsnagEvent awaits logsnag.track() with no try/catch, so a vendor
 *      outage blocks sign-in. Everything here is fire-and-forget and swallows
 *      its own errors.
 *   2. Never carry PII. Provider ids and step names only — no email addresses.
 *      The repo is public and these events may reach a third party.
 */

export type FunnelEvent =
  | { name: 'login_view' }
  | { name: 'login_provider_click'; provider: string }
  | { name: 'login_code_requested' }
  | { name: 'login_callback_arrived'; method: 'oauth' | 'otp' }

/**
 * Ship one event to /api/funnel, which forwards it to LogSnag.
 *
 * FIRE AND FORGET. The promise is deliberately discarded — nothing on the
 * sign-in path may wait for analytics (wordle-teams-4ov).
 *
 * keepalive MATTERS HERE. login_provider_click fires immediately before
 * authClient.signIn.social() navigates the document away to the provider.
 * A normal fetch is cancelled when the page tears down, so precisely the event
 * that tells us someone chose a provider would be the one most likely to be
 * lost. keepalive lets the browser finish the request after navigation.
 */
function send(event: FunnelEvent): void {
  if (import.meta.env.DEV) {
    // eslint-disable-next-line no-console
    console.debug('[funnel]', event.name, event)
  }
  void fetch('/api/funnel', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(event),
    keepalive: true,
  }).catch(() => {
    // Swallowed. An unreachable endpoint must not surface to someone signing in.
  })
}

/**
 * Record a funnel event. Safe to call from anywhere, including inside an auth
 * handler — it cannot throw and cannot delay the caller.
 */
export function trackFunnel(event: FunnelEvent): void {
  try {
    if (typeof window === 'undefined') return // client-side only
    send(event)
  } catch {
    // Deliberately swallowed. An analytics failure must never surface to a
    // user who is trying to sign in.
  }
}

/** Query param used to notice a completed sign-in on the landing page. */
export const SIGNIN_PARAM = 'signin'
