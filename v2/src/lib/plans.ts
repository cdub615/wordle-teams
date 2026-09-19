/**
 * WHAT PRO COSTS — the one module in this repo that holds a price.
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
 * module and backstopped by scripts/check-polar-prices.mjs, which compares
 * these literals against Polar's products. The rule stands everywhere else.
 *
 * ANNUAL LEADS, AND THE REASON IS THE FEE SCHEDULE RATHER THAN THE HEADLINE
 * NUMBER. wordle-teams-iht records Polar Starter at 5.0% + $0.50 per
 * transaction. Per subscriber per year: monthly is $59.88 gross less $8.99 in
 * twelve fees, annual is $49.99 gross less $3.00 in one. Monthly's fee share is
 * 15.0% against annual's 6.0%, and the net gap that still favours monthly
 * exists only at FULL retention — annual nets more the moment a monthly
 * subscriber lasts under 11.1 months, which for a $5 consumer subscription is
 * the common case. Annual also removes eleven further chances a year at
 * involuntary churn on an expired card.
 *
 * MONTHLY IS NEVER DISPARAGED AND NEVER PROMOTED. It is a real choice for
 * someone who will not commit a year. What no surface may do is present it as
 * the better value; plans.test.ts pins that as a property of the copy.
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
 */
export type UpgradeOrigin = 'header' | 'teams' | 'months' | 'import' | 'insights' | 'trial-ended'

export const UPGRADE_HEADLINES: Record<UpgradeOrigin, string> = {
  header: 'Everything you have played, not just today',
  teams: 'Join as many teams as you like',
  months: 'Every month your team has ever played',
  import: 'Let a screenshot fill the board in for you',
  insights: 'See your team’s whole month, not just today',
  'trial-ended': 'Pick up where your trial left off',
}
