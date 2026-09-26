// @vitest-environment node
//
// node rather than the suite's default edge-runtime, because the gatedAt test
// below reads the filesystem. That is the whole point of it: a path that does not
// resolve is a claim nobody checked.
import { resolve } from 'node:path'
import { describe, expect, test } from 'vitest'
import { notAFile } from '#/test-support/copy-claims.ts'
import { FREE_TEAM_LIMIT } from '../../convex/lib/teamLimits.ts'
import { FREE_MONTHS } from '../../convex/lib/monthWindow.ts'
import { PRO_BENEFITS } from './pro-benefits.ts'

describe('PRO_BENEFITS', () => {
  test('lists exactly the five things Pro sells today', () => {
    // A COUNT AND ORDER ASSERTION, deliberately. This file is copy, and copy is
    // the one thing typecheck, lint and build cannot check: an entry deleted or a
    // sixth invented would otherwise ship silently to the interstitial and the
    // landing page at once.
    //
    // NAMED "SELLS", NOT "GATES" — insights.ts's globalComparison (Layer 4) is
    // isPro-gated and server-enforced exactly like the five below, but has no UI
    // consumer anywhere in src/ yet, so it is deliberately absent from customer
    // copy. "Gates" would make this test false; "sells" is the claim it actually
    // checks.
    expect(PRO_BENEFITS.map((benefit) => benefit.id)).toEqual([
      'teams',
      'scoring',
      'import',
      'insights',
      'months',
    ])
  })

  test('every gatedAt path exists on disk, as a file', () => {
    // THE PROPERTY THAT KEEPS THIS HONEST, and it has to touch the filesystem to
    // have it. A suffix check (`/\.tsx?$/`) would pass for 'nonsense.ts' while
    // the comment claimed the entry named real code — which is the same shape as
    // the "unlimited months" claim this whole file exists to stop.
    //
    // `notAFile` IS THE HOUSE VERSION OF THE CHECK (wordle-teams-vxkr), and its
    // doc comment carries the half worth spelling out: a directory resolves too,
    // so `gatedAt: 'convex'` would satisfy an existence test and say nothing at
    // all about which file carries the rule. It answers WHY a path fails rather
    // than a boolean, so this one assertion diagnoses what two used to.
    for (const benefit of PRO_BENEFITS) {
      expect(notAFile(resolve(__dirname, '../..', benefit.gatedAt)), benefit.gatedAt).toBeNull()
    }
  })

  test('records which gates are server-enforced and which are UI-only', () => {
    // TWO OF THE FIVE ARE NOT ENFORCED AT ALL: access.ts's isProFor doc comment
    // says plainly "THE SCORING-SYSTEM EDITOR IS NOT ENFORCED", and form.tsx's
    // isPro gate — labelled "UI-ONLY BY DESIGN" in its own comment — says the
    // same of the import gate. Both are deliberate v1-parity decisions and
    // neither is a reason not to sell the feature — but a list implying all five
    // were enforced would be false on the day it was written.
    //
    // `teams` IS true DESPITE THE SAME DOC COMMENT ALSO SAYING "`createTeam`
    // PAST THE CAP IS NOT ENFORCED" — that sentence names a DIFFERENT path than
    // the one this benefit sells. The benefit is joining a team, which is
    // enforced twice over (teams.ts, players.ts, inviteLinks.ts, billing.ts);
    // see pro-benefits.ts's header for the full account. This assertion is
    // exact in both directions, so flipping `teams` to false would fail here
    // exactly as flipping it to true incorrectly would.
    expect(
      PRO_BENEFITS.filter((benefit) => benefit.serverEnforced).map((benefit) => benefit.id),
    ).toEqual(['teams', 'insights', 'months'])
  })

  test('pins the free-tier numbers this copy is written against', () => {
    // TWO LINES, ONE PURPOSE: convex-error.ts already states the rule this test
    // exists to enforce, about this exact constant — "Says 'free plan' rather
    // than a number so the copy cannot drift out of step with FREE_TEAM_LIMIT —
    // a literal in a switch, so every gate stays green while it lies." This
    // file's bodies say "two" and "three months" as words rather than reading
    // the constants, because prose cannot embed a template literal — so instead
    // this test pins the constants themselves. Change FREE_TEAM_LIMIT or
    // FREE_MONTHS without updating the prose above and this fails instead of
    // shipping stale copy behind four green gates.
    expect(FREE_TEAM_LIMIT).toBe(2)
    expect(FREE_MONTHS).toBe(3)
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
    //
    // THE FORMS CHECKED: a currency symbol or code, a decimal amount ("9.99"),
    // the word "dollars", and every cadence word a price hides behind — "per
    // month/year", "a month/year", "monthly", "yearly", "annually", "/mo".
    const prose = PRO_BENEFITS.map((b) => `${b.title} ${b.body}`).join(' ')

    expect(prose).not.toMatch(
      /[$£€]|\bUSD\b|\bper (month|year)\b|\ba (month|year)\b|\bmonthly\b|\byearly\b|\bannually\b|\/mo\b|\bdollars?\b|\d+\.\d{2}\b/i,
    )
  })

  test('uses typographic apostrophes and no typewriter ones', () => {
    const prose = PRO_BENEFITS.map((b) => `${b.title} ${b.body}`).join(' ')

    expect(prose).not.toContain("'")
    // AND AT LEAST ONE IS PRESENT, so that deleting every apostrophe — which
    // would also satisfy the line above — fails instead of passing.
    expect(prose).toContain('’')
  })
})
