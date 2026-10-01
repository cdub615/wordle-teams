/**
 * What the trial-ended prompt SAYS, separated from where it says it.
 *
 * Sibling of billing-copy.ts, and here for the same reason: the copy is the
 * deliverable and the component is not. A sentence chosen in a spec and then
 * typed straight into JSX is a product decision no test can reach.
 *
 * NO PRICE HERE. The price lives in Polar and reaches the customer on Polar's
 * hosted checkout. A number in this file would be a second source of truth that
 * goes stale the moment the dashboard changes, silently, with every gate green.
 */

/** Names what happened, without alarm. */
export const TRIAL_ENDED_TITLE = 'Your Insights trial has ended'

/**
 * The positioning line, chosen in the Pro-tier spec and repeated in the pricing
 * spec: "free shows you today, Pro shows you everything you have done." The
 * pricing page, the launch email and this card must all say the same thing.
 *
 * Says MONTH, not season, and the distinction is load-bearing: Layer 3 is
 * denominated in months (a per-team-per-month aggregate, and the free tier's own
 * locked teaser card is month-scoped too), while a season retrospective is a
 * DEFERRED, unbuilt candidate. Copy shown at the moment someone decides whether
 * to pay must not name a feature that does not exist.
 */
/**
 * NO COMPLETENESS CLAIM, AND PRO_BOARD_LIMIT IS WHY (wordle-teams-njmy, widened
 * 2026-09-30). This read "Pro shows you everything you have done — your full
 * history, your team's full month, and every board you have ever entered", which
 * carried THREE unkeepable phrases at once: convex/insights.ts caps
 * myBenchmarkBoards at 400 boards, so a Pro caller gets their most recent 400 and
 * nothing older.
 *
 * njmy named only src/lib/insights-panel.ts. This surface has the same defect and
 * is the worse place for it: an upsell panel is read while browsing, whereas this
 * card is shown at the moment somebody decides whether to pay. Found by sweeping
 * for the phrases rather than by the issue, which is the argument for the shared
 * COMPLETE_HISTORY_WORDS list now guarding all three surfaces.
 *
 * THE POSITIONING SURVIVES THE EDIT. "free shows you today, Pro shows you the
 * rest" is the same contrast the spec chose; what is gone is the promise that
 * "the rest" is everything. MONTH is still named for Layer 3, for the reason
 * below.
 */
export const TRIAL_ENDED_BODY =
  'You can still see today. Pro shows you the rest — your playing history month ' +
  'by month, your team’s full month, and your past boards rather than just the latest.'

/** A verb, so the button reads as an action rather than a label. */
export const TRIAL_ENDED_CTA = 'See your history'

/**
 * WHAT THE RUNNING TRIAL SAYS — the counterpart to the TRIAL_ENDED_* trio above,
 * and here for the same reason: the copy is the deliverable and the component is
 * not.
 *
 * IT EXISTS BECAUSE NOTHING IN src/ READ `trialActive`. The trial ran silently
 * for its whole thirty days and the first notice a player ever got was the card
 * saying it had ended — which convex/insights.ts's own header on `myAccess`
 * names as "the difference between a player who upgrades and a player who
 * assumes the feature broke".
 *
 * IT SAYS *INSIGHTS* TRIAL, AND THAT IS THE WHOLE DESIGN. insightsAccess applies
 * `paid = isPro || trialActive` to layer2 and layer3 ONLY: a trialist still sees
 * Layer 1 as free, gets no Layer 4, and does not get the widened month window
 * (access.ts: "The trial does not widen this window"). So four of the five
 * PRO_BENEFITS entries — teams, scoring, import, months — are NOT in the trial.
 * "A free month of Pro" would be a claim this product does not honour, and
 * trial-copy.test.ts refuses the vocabulary of all four.
 *
 * THE END DATE IS NOT IN THESE STRINGS. It is per-player, arrives as epoch ms on
 * `access.trialEndsAt`, and is rendered by `trialEndsOnLine` below from a date
 * the CALLER formats — so this module stays free of both a clock and a locale.
 */
export const TRIAL_ACTIVE_TITLE = 'Your Insights trial is running'

/**
 * NAMES THE TWO LAYERS THE TRIAL ACTUALLY GRANTS, in the same order and the same
 * voice as TRIAL_ENDED_BODY, so a player meeting both a month apart reads one
 * product rather than two.
 *
 * "month by month" and "full month" are deliberate and are NOT the `months`
 * benefit: Layer 2's trend is denominated in months and Layer 3 is a per-month
 * team aggregate, whereas `months` is how far BACK a player may browse — which a
 * trial does not widen. TRIAL_ENDED_BODY already draws the same distinction in
 * the same words.
 */
export const TRIAL_ACTIVE_BODY =
  `The numbers on this page are part of Pro, and they’re yours while your trial ` +
  `runs — your playing history month by month, and your team’s full month rather ` +
  `than just today.`

/**
 * The end date, as its own line rather than spliced into the body, so the body
 * stays a constant a test can read whole.
 *
 * TAKES AN ALREADY-FORMATTED DATE, not a timestamp: formatting needs a locale and
 * a zone, and this module's job is wording. lib/format-day.ts owns the rendering.
 */
export function trialEndsOnLine(endsOn: string): string {
  return `Free until ${endsOn}.`
}

/** A verb, so the button reads as an action rather than a label. */
export const TRIAL_ACTIVE_CTA = 'See what Pro includes'

/**
 * THE BADGE ON THE BLOCKS THE TRIAL UNLOCKS. Short because it renders inside
 * components/ui/badge.tsx at text-xs; a sentence wraps it onto two lines.
 *
 * IT SAYS "IN YOUR TRIAL" RATHER THAN "PRO" ALONE because the marker is gated on
 * `trialActive`, never on `layer2 === 'full'` — that predicate is equally true
 * for a paying subscriber, and telling a subscriber their panels are "in your
 * trial" is false to the one population that has already paid.
 */
export const TRIAL_MARKER_LABEL = 'Pro · in your trial'
