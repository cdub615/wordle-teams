/**
 * Login funnel instrumentation (wt-ksh.12.7, amendment A7).
 *
 * WHY THIS EXISTS. wordle-teams-390 measured ~203 people reaching /login in 30
 * days with roughly 16 completing an auth round-trip, and ZERO server-side auth
 * failures in the window. Server logs therefore cannot explain the loss — they
 * only prove nothing errored. Attributing where people leave needs client-side
 * events, which is what this module provides.
 *
 * DESTINATION IS NOT YET DECIDED — see wt-ksh.12.11. v2 currently has no
 * analytics dependency at all. Everything below is deliberately
 * destination-agnostic: wiring one up is a change to `send` and nothing else,
 * and every call site stays as it is.
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
 * THE INTEGRATION POINT. Replace the body to ship events somewhere.
 *
 * Keep it synchronous-looking and non-throwing: callers must never await it.
 * If the destination is network-backed, fire the request and discard the
 * promise (`void fetch(...).catch(() => {})`) rather than returning it.
 */
function send(event: FunnelEvent): void {
  if (import.meta.env.DEV) {
    // eslint-disable-next-line no-console
    console.debug('[funnel]', event.name, event)
  }
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
