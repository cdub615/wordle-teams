import { describe, expect, test } from 'vitest'
import { TRIAL_ENDED_BODY, TRIAL_ENDED_CTA, TRIAL_ENDED_TITLE } from './trial-copy'

describe('the trial-ended prompt', () => {
  // THE POSITIONING LINE IS THE PRODUCT DECISION, chosen in
  // docs/superpowers/specs/2026-09-05-pro-tier-and-insights-design.md and
  // repeated in the pricing spec. If this drifts, the pricing page, the launch
  // email and this card stop agreeing with each other.
  test('says what Pro is, in the words the spec chose', () => {
    expect(TRIAL_ENDED_BODY).toContain('everything you have done')
  })

  test('does not disparage the monthly plan', () => {
    // The pricing spec led with gross revenue — $59.88 against $49.99 across a
    // fully retained year — which is true and is not the reason. On Polar
    // Starter (5.0% + $0.50, recorded on wordle-teams-iht) monthly pays TWELVE
    // fixed fees a year: $8.99 in fees against annual's $3.00, a 15.0% fee
    // share against 6.0%. The net gap that still favours monthly survives only
    // at full retention — annual nets more below 11.08 months of tenure. So
    // monthly is a real choice and must not be disparaged, but it is never the
    // better value and no copy may imply it is. See src/lib/plans.ts.
    // Prices decided 2026-09-11. Annual is led because it is certain, not
    // because monthly is bad — this test pins that the copy never says so.
    const all = `${TRIAL_ENDED_TITLE} ${TRIAL_ENDED_BODY} ${TRIAL_ENDED_CTA}`.toLowerCase()
    for (const bad of ['only', 'just $', 'instead of monthly', 'better than monthly']) {
      expect(all, `copy disparages or diminishes a plan: ${bad}`).not.toContain(bad)
    }
  })

  test('carries no price, because the price lives in Polar', () => {
    // Verified 2026-09-10: no price literal exists anywhere in src/ or convex/.
    // Putting one here creates a second source of truth that drifts silently
    // when the Polar dashboard changes.
    //
    // EXCEPT src/lib/plans.ts, added since as the one module whose job is to
    // hold $49.99 and $4.99 for a public /pricing page — a page with no prices
    // is not one. That departure is confined to plans.ts and is backstopped by
    // a drift script; the rule this test pins stands everywhere else,
    // including here.
    const all = `${TRIAL_ENDED_TITLE} ${TRIAL_ENDED_BODY} ${TRIAL_ENDED_CTA}`
    expect(all).not.toMatch(/\$\d/)
  })

  test('the call to action is a verb, not a noun', () => {
    expect(TRIAL_ENDED_CTA).toMatch(/^(See|Get|Upgrade|Keep)/)
  })
})
