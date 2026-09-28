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
  // 'passkey' JOINED THE UNION WITH THE PASSKEY BUTTON (wordle-teams-wty4.1.7.4)
  // AND DOES NOT BREAK THIS EVENT'S HISTORICAL COMPARABILITY, which is worth
  // saying because a nearby change was rejected for exactly that. Widening
  // `?signin=oauth` to carry a PROVIDER id would have split an existing series
  // in two — the same sign-ins, counted under new names — so `wt.login.pending`
  // carries that granularity instead (see routes/login.tsx). This adds a method
  // that did not exist before and could not have been counted; the oauth and
  // otp series are untouched, and leaving it out would instead understate
  // completions by however many players adopt it.
  //
  // src/lib/funnel-payload.ts's METHODS allowlist HAS TO AGREE. A value this
  // type permits but that set drops arrives at LogSnag with no `method` tag at
  // all, which is a silent hole rather than an error.
  | { name: 'login_callback_arrived'; method: 'oauth' | 'otp' | 'passkey' }
  // ACTIVATION HALF (wordle-teams-qt4). The login events above answer "did they
  // get in"; these answer "did they then do anything", which is the larger leak
  // — 82% of players have never entered a board.
  //
  // `tasks` is the comma-joined incomplete set from taskSetKey, and it doubles
  // as the funnel STAGE: the player's own state is the stage, so there is no
  // separate step counter that can drift out of sync with what is on screen.
  | { name: 'onboarding_view'; tasks: string }
  | { name: 'onboarding_task_click'; task: string }
  | { name: 'onboarding_complete' }
  | { name: 'onboarding_dismiss' }
  // ITS OWN EVENT, AND DELIBERATELY NOT AN onboarding_task_click WITH AN
  // 'insights' TASK (wordle-teams-wty4.1.14.6). The graduation state of the
  // next-step card is a BROWSE NUDGE shown to a player who has already
  // activated; the task events are the activation funnel, and their
  // denominator is onboarding_view over incomplete task sets. Folding this in
  // would add clicks that have no matching view and quietly inflate the one
  // ratio wordle-teams-456 is measured by — and widening OnboardingTaskId to
  // carry 'insights' would do the same to funnel-payload.ts's TASK_IDS tag.
  // It carries no tag at all: there is exactly one CTA and one destination.
  | { name: 'onboarding_insights_click' }
  // A SEPARATE EVENT FROM onboarding_insights_click ON PURPOSE
  // (wordle-teams-wty4.1.15). shouldShowGraduation (onboarding-tasks.ts:130)
  // has no "just finished" latch — it shows the card whenever every task is
  // complete and nothing is dismissed, so every activated player mounts it
  // on every /app load (onboarding-tasks.ts:189-190, next-step-card.tsx:65-67).
  // What IS one-shot is the CLICK: the CTA's onClick spends the shared
  // onboardingDismissedAt flag alongside the navigation
  // (next-step-card.tsx:260-263), so onboarding_insights_click fires at most
  // once per arming of that card — and never for a player who dismissed it or
  // has not finished the checklist. Only app-menu's "Show getting started"
  // (convex/onboarding.ts, replay) clears the flag and re-arms the CTA. The
  // dashboard affordance carries no such latch — sharing a name would
  // conflate a latched, re-armable event with an unconditional, repeatable
  // one. It carries no tag for the same reason its sibling does: one CTA, one
  // destination.
  //
  // EMITTED FROM ONE PLACE: today-panel.tsx's header slot, which holds this
  // link in place of the board-entry button once the player has entered
  // today's board.
  | { name: 'dashboard_insights_click' }

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
    // eslint-disable-next-line no-console -- DEV-only funnel tracing; see wordle-teams-61x
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
