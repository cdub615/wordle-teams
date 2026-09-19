import { describe, expect, test } from 'vitest'
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
    // FOUR WORDS IS THE THRESHOLD, and both sides of the choice were measured
    // rather than guessed. Independent copy in this corpus tops out at TWO
    // consecutive shared words: across all ten distinct PRO_BENEFITS titles
    // and bodies, the longest run between any two of them is 2 ("your own",
    // scoring's title against insights' body). So 3 is where coincidence ends
    // in general — but a HEADLINE is not independent copy. It is about the
    // same feature as the entry beneath it and legitimately shares that
    // feature's own noun phrase: "three months", "two teams", "a screenshot".
    // At a threshold of 3, the noun phrase plus one function word ("past three
    // months", "join two teams") fails, which is an obstacle to writing the
    // headline at all rather than a defect caught. Four leaves room for the
    // feature's vocabulary and still fails a lifted clause.
    //
    // WHAT THAT BUYS AND WHAT IT DOES NOT. It kills both defects that reached
    // a screen as a visible stutter: `insights` at 4 ("your team’s whole
    // month") and `import` at 6 ("fill the board in for you") — the mutants
    // are worth re-running if this number is ever changed. It would NOT have
    // caught `teams`, whose old "Pro lifts the two-team limit" shared 3 with
    // its body ("Pro lifts the cap"), nor `months` at 2; both were reworded by
    // eye and are below any threshold that lets the copy above be written.
    // This guard is a floor on phrase reuse, not a substitute for reading the
    // dialog. The six headlines as they stand share at most 2 with any entry.
    //
    // TITLE AND BODY ARE MEASURED SEPARATELY, never concatenated: a run that
    // straddles the join between one entry's title and its body is not a
    // phrase any reader sees.
    const words = (text: string) =>
      text
        .toLowerCase()
        .replace(/’/g, "'")
        // Punctuation — and hyphens, so "two-team" cannot hide an overlap with
        // "two team" — becomes whitespace rather than vanishing, so that
        // "month, not" does not fuse into one token.
        .replace(/[^a-z0-9']+/g, ' ')
        .split(' ')
        .filter(Boolean)

    const longestSharedRun = (a: string[], b: string[]) => {
      let longest = 0
      // Classic longest-common-substring DP over words rather than characters.
      const runs = Array.from({ length: b.length + 1 }, () => 0)
      for (const wordA of a) {
        let diagonal = 0
        for (let j = 0; j < b.length; j += 1) {
          const above = runs[j + 1]
          runs[j + 1] = wordA === b[j] ? diagonal + 1 : 0
          longest = Math.max(longest, runs[j + 1])
          diagonal = above
        }
      }
      return longest
    }

    // The DP itself is load-bearing, so it is checked against a known answer
    // before it is trusted to pass anything: an all-green implementation that
    // returned 0 for everything would satisfy every assertion below.
    expect(longestSharedRun(words('let a screenshot fill the board in for you'), words(
      'Paste or upload a screenshot of your Wordle and we’ll fill the board in for you — check it and submit.',
    ))).toBe(6)

    const benefitTexts = PRO_BENEFITS.flatMap((benefit) => [benefit.title, benefit.body]).map(words)
    for (const [origin, line] of Object.entries(UPGRADE_HEADLINES)) {
      const headline = words(line)
      for (const benefitText of benefitTexts) {
        const run = longestSharedRun(headline, benefitText)
        // The origin travels in the failure message, because "expected 4 to be
        // less than 4" on its own names neither the headline nor the entry it
        // collided with.
        expect(run, `${origin}: "${line}" vs "${benefitText.join(' ')}"`).toBeLessThan(4)
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
