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
