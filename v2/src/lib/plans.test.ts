import { describe, expect, test } from 'vitest'
import {
  MONTHLY_FINE_PRINT,
  PLANS,
  PRO_PRICE_LINE,
  UPGRADE_HEADLINES,
  type UpgradeOrigin,
} from './plans.ts'

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
})

describe('the price copy', () => {
  test('the line we lead with names the annual price', () => {
    expect(PRO_PRICE_LINE).toContain('$49.99/year')
    expect(PRO_PRICE_LINE).not.toContain('$4.99')
  })

  test('monthly appears, as fine print, and is never sold as the better value', () => {
    // wordle-teams-iht's fee schedule is Polar Starter, 5.0% + $0.50 per
    // transaction: twelve charges a year cost $8.99 against annual's $3.00, and
    // annual nets more for any subscriber who lasts under 11.1 months. Monthly
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
    // Same rule pro-benefits.test.ts pins for its own copy.
    for (const line of Object.values(UPGRADE_HEADLINES)) {
      expect(line).not.toContain("'")
    }
  })
})
