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
    // The pricing spec is explicit: at $4.99/mo against $49.99/yr, monthly is
    // worth MORE across a fully retained year ($59.88 vs $49.99), so calling it
    // the worse deal would be inaccurate. Prices decided 2026-09-11.
    // Annual is led because it is certain, not because monthly is bad.
    const all = `${TRIAL_ENDED_TITLE} ${TRIAL_ENDED_BODY} ${TRIAL_ENDED_CTA}`.toLowerCase()
    for (const bad of ['only', 'just $', 'instead of monthly', 'better than monthly']) {
      expect(all, `copy disparages or diminishes a plan: ${bad}`).not.toContain(bad)
    }
  })

  test('carries no price, because the price lives in Polar', () => {
    // Verified 2026-09-10: no price literal exists anywhere in src/ or convex/.
    // Putting one here creates a second source of truth that drifts silently
    // when the Polar dashboard changes.
    const all = `${TRIAL_ENDED_TITLE} ${TRIAL_ENDED_BODY} ${TRIAL_ENDED_CTA}`
    expect(all).not.toMatch(/\$\d/)
  })

  test('the call to action is a verb, not a noun', () => {
    expect(TRIAL_ENDED_CTA).toMatch(/^(See|Get|Upgrade|Keep)/)
  })
})
