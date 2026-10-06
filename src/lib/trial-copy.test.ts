import { describe, expect, test } from 'vitest'
import { COMPLETE_HISTORY_WORDS, PRO_ONLY_WORDS } from './pro-benefits.ts'
import {
  TRIAL_ACTIVE_BODY,
  TRIAL_ACTIVE_CTA,
  TRIAL_ACTIVE_TITLE,
  TRIAL_MARKER_LABEL,
  TRIAL_ENDED_BODY,
  TRIAL_ENDED_CTA,
  TRIAL_ENDED_TITLE,
} from './trial-copy'

describe('the trial-ended prompt', () => {
  // THE POSITIONING LINE IS THE PRODUCT DECISION, chosen in
  // docs/superpowers/specs/2026-09-05-pro-tier-and-insights-design.md and
  // repeated in the pricing spec. If this drifts, the pricing page, the launch
  // email and this card stop agreeing with each other.
  test('says what Pro is, in the words the spec chose', () => {
    // WAS 'everything you have done' UNTIL 2026-09-30. The spec's contrast —
    // free shows you today, Pro shows you the rest — is intact; what changed is
    // that "the rest" no longer claims to be everything, because
    // convex/insights.ts caps the board history at 400 (wordle-teams-njmy).
    expect(TRIAL_ENDED_BODY).toContain('Pro shows you the rest')
  })

  test('promises no COMPLETE history, because PRO_BOARD_LIMIT truncates one', () => {
    // The same guard pro-benefits.test.ts and insights-panel.test.ts apply, over
    // the third surface that makes this claim — and the highest-stakes one, since
    // this card is what someone reads while deciding whether to pay. One shared
    // list, so a phrase added to it reaches every surface at once.
    const all = `${TRIAL_ENDED_TITLE} ${TRIAL_ENDED_BODY} ${TRIAL_ENDED_CTA}`.toLowerCase()
    for (const claim of COMPLETE_HISTORY_WORDS) {
      expect(all, `"${claim}" promises a history PRO_BOARD_LIMIT truncates`).not.toContain(claim)
    }
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
    // is not one. That departure is confined to plans.ts and will be
    // backstopped by a drift check owned by wordle-teams-wty4.1.14, not yet
    // written; the rule this test pins stands everywhere else, including here.
    const all = `${TRIAL_ENDED_TITLE} ${TRIAL_ENDED_BODY} ${TRIAL_ENDED_CTA}`
    expect(all).not.toMatch(/\$\d/)
  })

  test('the call to action is a verb, not a noun', () => {
    expect(TRIAL_ENDED_CTA).toMatch(/^(See|Get|Upgrade|Keep)/)
  })
})

describe('the active-trial prompt', () => {
  /**
   * ONE CORPUS, so a phrase added to any constant is measured by every guard
   * below rather than only the one whose test mentions it.
   */
  const all = () =>
    `${TRIAL_ACTIVE_TITLE} ${TRIAL_ACTIVE_BODY} ${TRIAL_ACTIVE_CTA} ${TRIAL_MARKER_LABEL}`.toLowerCase()

  test('names the trial as an INSIGHTS trial, not a month of Pro', () => {
    // The spec's section 3.2 decision, and the reason it is load-bearing: the
    // trial grants Layers 2 and 3 only, so "a free month of Pro" sends players
    // hunting for import, custom scoring, a third team, the widened month window
    // and starting a challenge — five of the six PRO_BENEFITS entries it does NOT
    // include.
    expect(TRIAL_ACTIVE_TITLE.toLowerCase()).toContain('insights trial')
  })

  test('promises no COMPLETE history, because PRO_BOARD_LIMIT truncates one', () => {
    // The same shared list already guarding TRIAL_ENDED_*, pro-benefits and
    // insights-panel. PRO_BOARD_LIMIT is 400 (convex/insights.ts:24).
    for (const claim of COMPLETE_HISTORY_WORDS) {
      expect(all(), `"${claim}" promises a history PRO_BOARD_LIMIT truncates`).not.toContain(claim)
    }
  })

  test('claims none of the four benefits the trial does NOT grant', () => {
    // insightsAccess applies `paid = isPro || trialActive` to layer2 and layer3
    // ONLY. access.ts states the rest in its own words: "The trial does not
    // widen this window". So trial copy may not reach for the vocabulary of
    // import, scoring or the month window — which is exactly what PRO_ONLY_WORDS
    // already enumerates, one entry per benefit it belongs to.
    for (const word of PRO_ONLY_WORDS) {
      expect(all(), `"${word}" names a benefit the trial does not grant`).not.toContain(word)
    }
  })

  test('carries no price, because the price lives in Polar', () => {
    const raw = `${TRIAL_ACTIVE_TITLE} ${TRIAL_ACTIVE_BODY} ${TRIAL_ACTIVE_CTA} ${TRIAL_MARKER_LABEL}`
    expect(raw).not.toMatch(/\$\d/)
  })

  test('uses typographic apostrophes and no typewriter ones', () => {
    // Asserts BOTH directions, the way plans.test.ts does, so deleting every
    // apostrophe fails this rather than passing it.
    const raw = `${TRIAL_ACTIVE_TITLE} ${TRIAL_ACTIVE_BODY} ${TRIAL_ACTIVE_CTA} ${TRIAL_MARKER_LABEL}`
    expect(raw).not.toContain("'")
    expect(raw).toContain('’') // right single quotation mark
  })

  test('the call to action is a verb, not a noun', () => {
    // Same rule as TRIAL_ENDED_CTA.
    expect(TRIAL_ACTIVE_CTA).toMatch(/^(See|Get|Upgrade|Keep)/)
  })

  test('the marker is short enough for a badge', () => {
    // It renders inside components/ui/badge.tsx at text-xs. A sentence here
    // wraps the badge onto two lines and looks like a bug.
    expect(TRIAL_MARKER_LABEL.length).toBeLessThanOrEqual(24)
  })

  test('the active and ended prompts do not share a title', () => {
    // They are mutually exclusive populations (trialActive and trialExpired
    // cannot both be true) but a player sees both, a month apart, and two
    // identical titles would read as the same card failing to update.
    expect(TRIAL_ACTIVE_TITLE).not.toEqual(TRIAL_ENDED_TITLE)
  })
})
