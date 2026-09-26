import { describe, expect, test } from 'vitest'
import { longestSharedRun, SHARED_RUN_LIMIT, words } from '#/test-support/copy-claims.ts'
import {
  MONTHLY_FINE_PRINT,
  PLANS,
  PRO_PRICE_LINE,
  UPGRADE_HEADLINES,
  type UpgradeOrigin,
} from './plans.ts'
import { PRO_BENEFITS } from './pro-benefits.ts'
import { FREE_TEAM_LIMIT } from '../../convex/lib/teamLimits.ts'
import { FREE_MONTHS } from '../../convex/lib/monthWindow.ts'

describe('PLANS', () => {
  test('leads with annual, which is how Polar presents it too', () => {
    // convex/polar.ts's proProductIds() returns annual first "so it presents
    // first", pinned in polar.test.ts. This is the display side of the same
    // decision, and the two must not drift apart.
    expect(PLANS.map((plan) => plan.id)).toEqual(['annual', 'monthly'])
  })

  test('every price is a whole dollars-and-cents literal', () => {
    for (const plan of PLANS) {
      expect(plan.price).toMatch(/^\$\d+\.\d{2}$/)
    }
  })

  test('the label is the price and its interval, not a bare number', () => {
    expect(PLANS[0].label).toBe('$49.99/year')
    expect(PLANS[1].label).toBe('$4.99/month')
  })

  test('the label cannot drift from the price and interval it is built from', () => {
    for (const plan of PLANS) {
      expect(plan.label).toBe(`${plan.price}/${plan.interval}`)
    }
  })
})

describe('the price copy', () => {
  test('the line we lead with names the annual price', () => {
    expect(PRO_PRICE_LINE).toContain('$49.99/year')
    expect(PRO_PRICE_LINE).not.toContain('$4.99')
  })

  test('monthly appears, as fine print, and is never sold as the better value', () => {
    // wordle-teams-iht's fee schedule is Polar Starter, 5.0% + $0.50 per
    // transaction: twelve charges a year cost $8.99 against annual's $3.00, and
    // annual nets more for any subscriber who lasts under 11.08 months. Monthly
    // stays available and undisparaged; what it must never be is the pitch.
    expect(MONTHLY_FINE_PRINT).toContain('$4.99/month')
    expect(MONTHLY_FINE_PRINT).not.toMatch(/best value|better value|save|cheaper|only/i)
  })
})

describe('UPGRADE_HEADLINES', () => {
  const ORIGINS: UpgradeOrigin[] = [
    'header',
    'teams',
    'months',
    'import',
    'insights',
    'trial-ended',
  ]

  test('has a line for every origin and no others', () => {
    expect(Object.keys(UPGRADE_HEADLINES).sort()).toEqual([...ORIGINS].sort())
  })

  test('every line is a short sentence, so it fits a dialog title at 390px', () => {
    for (const origin of ORIGINS) {
      const line = UPGRADE_HEADLINES[origin]
      expect(line.length).toBeGreaterThan(0)
      expect(line.length).toBeLessThanOrEqual(60)
    }
  })

  test('uses typographic apostrophes and no typewriter ones', () => {
    // Same rule pro-benefits.test.ts pins for its own copy: assert the
    // typewriter apostrophe is absent AND that a typographic one is present,
    // so that deleting every apostrophe fails this test instead of passing it.
    for (const line of Object.values(UPGRADE_HEADLINES)) {
      expect(line).not.toContain("'")
    }
    expect(Object.values(UPGRADE_HEADLINES).join(' ')).toContain('’')
  })

  test('no headline repeats a benefit title, which would render twice in the dialog', () => {
    // The dialog draws the headline ABOVE PRO_BENEFITS in full, so a headline
    // equal to — or a trivial rewording of — one of those titles prints the
    // same sentence twice, three lines apart. Caught in review of the first
    // version, where `months` did exactly that. Normalized (lowercased,
    // trailing punctuation stripped) on both sides, because an exact-match
    // guard is the weaker property: 'As many teams as you like.' with a
    // trailing period would still slip through and still render twice — a
    // near-duplicate is what this is really guarding against, not just an
    // identical string.
    const normalize = (text: string) => text.toLowerCase().replace(/[.!?]+$/, '')
    const titles = PRO_BENEFITS.map((benefit) => normalize(benefit.title))
    for (const line of Object.values(UPGRADE_HEADLINES)) {
      expect(titles).not.toContain(normalize(line))
    }
  })

  test('no headline restates a benefit the dialog renders three lines below it', () => {
    // THE TEST ABOVE WAS TOO NARROW, AND FOUR HEADLINES PROVED IT. Equality
    // against a TITLE cannot see "See your team’s whole month, not just today"
    // sitting above the title "Your history, and your team’s whole month"
    // (wordle-teams-iht.1.9), and it cannot see a headline lifting six words
    // out of a BODY, which "Let a screenshot fill the board in for you" did
    // against import's "…we’ll fill the board in for you — check it and
    // submit." The reader meets headline and list on one screen; what makes it
    // read as a stutter is a shared PHRASE, not a shared string.
    //
    // FOUR WORDS IS THE THRESHOLD, AND THIS IS WHERE THE NUMBER WAS PICKED —
    // `SHARED_RUN_LIMIT` in test-support/copy-claims.ts now holds it and the whole
    // argument for it, including the two mutants worth re-running if it ever
    // moves: `insights` at 4 ("your team’s whole month") and `import` at 6 ("fill
    // the board in for you"), both of which reached a screen as a visible
    // stutter. What is corpus-specific and stays here: the six headlines as they
    // stand share at most 2 consecutive words with any entry, and this guard would
    // NOT have caught `teams`, whose old "Pro lifts the two-team limit" shared 3
    // with its body ("Pro lifts the cap"), nor `months` at 2. Both were reworded
    // by eye. A floor on phrase reuse, not a substitute for reading the dialog.
    //
    // THE DP AND `words` ARE THE HOUSE VERSIONS (wordle-teams-vxkr), and the
    // known-answer check this test used to open with — a measure that returned 0
    // for everything would satisfy every assertion below it — is
    // copy-claims.test.ts's now, on the same sentence pair.
    //
    // TITLE AND BODY ARE MEASURED SEPARATELY, never concatenated: a run that
    // straddles the join between one entry's title and its body is not a
    // phrase any reader sees.
    const benefitTexts = PRO_BENEFITS.flatMap((benefit) => [benefit.title, benefit.body]).map(words)
    for (const [origin, line] of Object.entries(UPGRADE_HEADLINES)) {
      const headline = words(line)
      for (const benefitText of benefitTexts) {
        const run = longestSharedRun(headline, benefitText)
        // The origin travels in the failure message, because "expected 4 to be
        // less than 4" on its own names neither the headline nor the entry it
        // collided with.
        expect(run, `${origin}: "${line}" vs "${benefitText.join(' ')}"`).toBeLessThan(
          SHARED_RUN_LIMIT,
        )
      }
    }
  })

  test('pins the free-tier numbers these headlines spell out in words', () => {
    // `teams` says "two-team" and `months` says "three months" as WORDS, which
    // no template literal can keep honest — the same problem pro-benefits.test.ts
    // has and solves the same way. Change either constant without updating the
    // copy here and this fails instead of shipping stale copy behind four green
    // gates.
    expect(FREE_TEAM_LIMIT).toBe(2)
    expect(FREE_MONTHS).toBe(3)
  })
})
