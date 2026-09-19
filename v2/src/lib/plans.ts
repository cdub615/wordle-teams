/**
 * WHAT PRO COSTS — the one module in this repo whose job is to hold the price
 * a customer-facing surface renders. (It is not the only file that mentions
 * one — insights/no-team-card.tsx and insights/trend-panel.tsx quote $49.99/yr
 * in their own banner comments, and trial-copy.test.ts quotes both prices in a
 * comment of its own — but this is the only one whose job is to.)
 *
 * Sibling of pro-benefits.ts, and the division between them is deliberate:
 * that file is WHAT Pro includes and is forbidden to quote a price (its own
 * test pins "quotes no price, in any of the shapes a price takes"); this file
 * is what it costs and quotes nothing about what it does.
 *
 * IT KNOWINGLY DEPARTS FROM "NO PRICE HERE", which trial-copy.ts and
 * pro-benefits.ts both state. That rule was written when the price reached the
 * customer only on Polar's hosted checkout, so a number in the codebase was a
 * second source of truth with no reader. A public /pricing page changes that:
 * a pricing page with no prices is not one. The departure is confined to this
 * module and will be backstopped by scripts/check-polar-prices.mjs, which
 * wordle-teams-wty4.1.14's plan owns and which is not written yet. The rule
 * stands everywhere else.
 *
 * ANNUAL LEADS, AND THE REASON IS THE FEE SCHEDULE RATHER THAN THE HEADLINE
 * NUMBER. wordle-teams-iht records Polar Starter at 5.0% + $0.50 per
 * transaction. Per subscriber per year: monthly is $59.88 gross less $8.99 in
 * twelve fees, annual is $49.99 gross less $3.00 in one. Monthly's fee share is
 * 15.0% against annual's 6.0%, and the net gap that still favours monthly
 * exists only at FULL retention — annual nets more the moment a monthly
 * subscriber lasts under 11.08 months, which for a $5 consumer subscription is
 * the common case. Annual also removes eleven further chances a year at
 * involuntary churn on an expired card.
 *
 * MONTHLY IS NEVER DISPARAGED AND NEVER PROMOTED. It is a real choice for
 * someone who will not commit a year. What no surface may do is present it as
 * the better value; plans.test.ts pins that as a property of the copy. What
 * that test covers is narrower than the paragraph above claims for it,
 * though: it pins the WORDING of the fine print only. Whether monthly ever
 * reads, in practice, as the better value is a question of prominence and
 * layout on the surface that renders it — that belongs to the upgrade
 * dialog's own test, in a later task.
 */

export type PlanId = 'annual' | 'monthly'

export type Plan = {
  id: PlanId
  /** The billing interval, as the customer reads it. */
  interval: 'year' | 'month'
  /** Dollars and cents, with the sign. Compared against Polar by the drift script. */
  price: string
  /** Price and interval together — what a surface renders. */
  label: string
}

/**
 * ORDER IS THE PRODUCT DECISION, not a list of two things. convex/polar.ts's
 * proProductIds() returns annual first so Polar's hosted checkout presents it
 * first; this is the same decision on the display side, and plans.test.ts pins
 * it here exactly as polar.test.ts pins it there.
 */
export const PLANS: ReadonlyArray<Plan> = [
  { id: 'annual', interval: 'year', price: '$49.99', label: '$49.99/year' },
  { id: 'monthly', interval: 'month', price: '$4.99', label: '$4.99/month' },
]

const annual = PLANS[0]
const monthly = PLANS[1]

/** The price line every surface leads with. Derived, so there is one source. */
export const PRO_PRICE_LINE = `Pro is ${annual.label}`

/** Monthly, stated plainly and quietly. Never a comparison. */
export const MONTHLY_FINE_PRINT = `or ${monthly.label}`

/**
 * Where an upgrade was asked for. Six affordances, six lines.
 *
 * THE HEADLINE VARIES AND THE BODY DOES NOT. Someone who clicked "Import from a
 * screenshot" has demonstrated interest in import specifically, and a generic
 * Pro pitch wastes the one moment they created. The benefits list beneath is
 * PRO_BENEFITS in full for every origin — one inventory, six openings.
 *
 * A HEADLINE NAMES THE THING THE PLAYER JUST REACHED FOR. It does not summarize
 * the benefit, because the benefit is three lines below it: the dialog draws
 * the headline above PRO_BENEFITS in full, so a headline that restates one of
 * those entries prints the same sentence twice on one screen. That is the whole
 * reason these lines are written in the voice of the click — "you are at the
 * two-team limit" is what the player did; "as many teams as you like" is what
 * Pro sells, and the list beneath already says it.
 *
 * REVIEW FOUND FOUR OF THEM RESTATING THE LIST, and title equality was too
 * narrow a guard to see any but the first. `months` and `teams` opened with the
 * benefit title verbatim and were reworded; then `insights` shipped "See your
 * team’s whole month, not just today" three lines above the title "Your
 * history, and your team’s whole month" (wordle-teams-iht.1.9), and `import`
 * shipped six words verbatim from its own benefit's body. plans.test.ts now
 * measures the longest run of consecutive words a headline shares with any
 * benefit title OR body and fails at four, which is the class all four belonged
 * to — not just the equality the earlier guard could see.
 */
export type UpgradeOrigin = 'header' | 'teams' | 'months' | 'import' | 'insights' | 'trial-ended'

export const UPGRADE_HEADLINES: Record<UpgradeOrigin, string> = {
  header: 'What you get with Pro',
  teams: 'You are at the two-team limit',
  months: 'You reached past the last three months',
  import: 'Your screenshot can do the typing',
  insights: 'See who’s actually beating whom',
  'trial-ended': 'Pick up where your trial left off',
}
