// @vitest-environment node
//
// node rather than the suite's default edge-runtime, because the gatedAt test
// below reads the filesystem. That is the whole point of it: a path that does not
// resolve is a claim nobody checked.
import { existsSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, test } from 'vitest'
import { PRO_BENEFITS } from './pro-benefits.ts'

describe('PRO_BENEFITS', () => {
  test('lists exactly the five things Pro gates today', () => {
    // A COUNT AND ORDER ASSERTION, deliberately. This file is copy, and copy is
    // the one thing typecheck, lint and build cannot check: an entry deleted or a
    // sixth invented would otherwise ship silently to the interstitial and the
    // landing page at once.
    expect(PRO_BENEFITS.map((benefit) => benefit.id)).toEqual([
      'teams',
      'scoring',
      'import',
      'insights',
      'months',
    ])
  })

  test('every gatedAt path exists on disk', () => {
    // THE PROPERTY THAT KEEPS THIS HONEST, and it has to touch the filesystem to
    // have it. A suffix check (`/\.tsx?$/`) would pass for 'nonsense.ts' while
    // the comment claimed the entry named real code — which is the same shape as
    // the "unlimited months" claim this whole file exists to stop.
    for (const benefit of PRO_BENEFITS) {
      expect(existsSync(resolve(__dirname, '../..', benefit.gatedAt)), benefit.gatedAt).toBe(true)
    }
  })

  test('records which gates are server-enforced and which are UI-only', () => {
    // TWO OF THE FIVE ARE NOT ENFORCED, and access.ts's isProFor doc comment says
    // so plainly: "createTeam PAST THE CAP IS NOT ENFORCED… THE SCORING-SYSTEM
    // EDITOR IS NOT ENFORCED." form.tsx's isPro gate (labelled "UI-ONLY BY
    // DESIGN") says the same of the import gate. Both are deliberate v1-parity
    // decisions and neither is a reason not to sell the feature — but a list that
    // implied all five were enforced would be false on the day it was written.
    expect(
      PRO_BENEFITS.filter((benefit) => benefit.serverEnforced).map((benefit) => benefit.id),
    ).toEqual(['teams', 'insights', 'months'])
  })

  test('says nothing about chat or notifications', () => {
    // NEITHER IS PRO-GATED — there is no isProFor anywhere in convex/chat.ts or
    // convex/chatNotify.ts. They belong to the free product's story. Selling
    // something already free is the same defect as selling something that does
    // not exist.
    const prose = PRO_BENEFITS.map((b) => `${b.title} ${b.body}`).join(' ').toLowerCase()

    expect(prose).not.toContain('chat')
    expect(prose).not.toContain('notification')
  })

  test('quotes no price, in any of the shapes a price takes', () => {
    // The price lives in Polar and reaches the customer on Polar's hosted
    // checkout. A number here is a second source of truth that goes stale
    // silently with every gate green — trial-copy.ts's own rule, same reason.
    const prose = PRO_BENEFITS.map((b) => `${b.title} ${b.body}`).join(' ')

    expect(prose).not.toMatch(/[$£€]|\bUSD\b|\bper (month|year)\b|\ba (month|year)\b|\bmonthly\b|\bannually\b|\/mo\b/i)
  })

  test('uses typographic apostrophes and no typewriter ones', () => {
    const prose = PRO_BENEFITS.map((b) => `${b.title} ${b.body}`).join(' ')

    expect(prose).not.toContain("'")
    // AND AT LEAST ONE IS PRESENT, so that deleting every apostrophe — which
    // would also satisfy the line above — fails instead of passing.
    expect(prose).toContain('’')
  })
})
