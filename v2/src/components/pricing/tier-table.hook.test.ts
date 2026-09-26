// @vitest-environment jsdom
//
// jsdom and `.hook.test.ts` with createElement, matching every other component
// test here — vitest.config.ts's glob is `src/**/*.test.ts`, so .tsx would not run.
//
// WHAT THIS FILE IS FOR. /pricing is the first public statement this product has
// ever made about what money buys, and every sentence on it is a claim about code
// somewhere else. Three separate drifts are possible and only one of them is
// visible to lint, typecheck or build:
//
//   1. PRO_BENEFITS grows a sixth entry and this page goes on selling five.
//   2. The free column drifts into a list of refusals, which is the shape a tier
//      table falls into by default and the one a cold visitor reads as "nothing".
//   3. The trial gets described as something a visitor will get, on a day when
//      LAUNCH_AT is still the 2099 placeholder and nobody's trial can start.
//
// All three are copy, and copy is exactly what the four gates cannot see.
import { cleanup, render, screen, within } from '@testing-library/react'
import { createElement } from 'react'
import { afterEach, describe, expect, test } from 'vitest'
import { TierTable } from './tier-table.tsx'
import { FREE_INCLUDES } from '#/lib/free-includes.ts'
import { MONTHLY_FINE_PRINT, PLANS, PRO_PRICE_LINE } from '#/lib/plans.ts'
import { PRO_BENEFITS } from '#/lib/pro-benefits.ts'
import { FREE_TEAM_LIMIT } from '../../../convex/lib/teamLimits.ts'
import { FREE_MONTHS } from '../../../convex/lib/monthWindow.ts'
import {
  INSIGHTS_TRIAL_DAYS,
  LAUNCH_AT_IS_PLACEHOLDER,
} from '../../../convex/lib/insightsAccess.ts'

afterEach(cleanup)

/** The default is the one a visitor gets today; the prop is the launched world. */
const table = (props?: { trialOffered?: boolean }) =>
  render(createElement(TierTable, props ?? {}))

const free = () => within(screen.getByTestId('pricing-free'))
const pro = () => within(screen.getByTestId('pricing-pro'))

/** Everything the component drew, as one string. */
const pageText = () => screen.getByTestId('pricing-tiers').textContent ?? ''

describe('the Pro column', () => {
  /**
   * THE DRIFT GATE THIS PAGE EXISTS TO CARRY, and it is deliberately the same
   * assertion upgrade-dialog.hook.test.ts makes — pro-benefits.ts's header names
   * those two surfaces as its only consumers and says they "must not describe it
   * twice". A sixth benefit now fails in two places until both name it.
   *
   * TITLE AND BODY, BOTH, for the reason the dialog's own copy of this records:
   * asserting titles alone leaves the gate guarding half the copy, and five bare
   * headings with nothing explaining any of them passes it.
   */
  test('names every benefit in the inventory, title and body', () => {
    table()
    for (const benefit of PRO_BENEFITS) {
      expect(pro().getByText(benefit.title)).toBeTruthy()
      expect(pro().getByText(benefit.body)).toBeTruthy()
    }
  })

  test('writes no benefit copy of its own', () => {
    // The other half of "must not describe it twice": every sentence in the Pro
    // column is either a price line or an entry of the inventory. A paraphrase
    // added here would be a second description of one tier, drifting from the
    // first the moment either is edited — which is the defect pro-benefits.ts
    // was created to end.
    table()
    const headings = pro()
      .getAllByRole('heading')
      .map((node) => node.textContent)
    expect(headings).toEqual(['Pro', ...PRO_BENEFITS.map((benefit) => benefit.title)])
  })

  test('leads with the annual price and carries monthly as a quieter second line', () => {
    table()
    expect(screen.getByTestId('pricing-annual').textContent).toBe(PRO_PRICE_LINE)
    expect(screen.getByTestId('pricing-monthly').textContent).toBe(MONTHLY_FINE_PRINT)

    // The labels themselves, so a PRO_PRICE_LINE rewritten without its price
    // still fails here rather than rendering a priceless pricing page.
    expect(screen.getByTestId('pricing-annual').textContent).toContain(PLANS[0].label)
    expect(screen.getByTestId('pricing-monthly').textContent).toContain(PLANS[1].label)
  })

  /**
   * PROMINENCE, NOT WORDING, IS WHERE "ANNUAL LEADS" LIVES — the same argument
   * upgrade-dialog.hook.test.ts makes over the dialog's description line.
   * plans.test.ts can pin the two strings and nothing more; which one reads as
   * the pitch is a question of where each sits.
   *
   * TWO INDEPENDENT FACTS, because either alone is satisfiable by a page that
   * still sells monthly: annual comes FIRST in the document, and monthly is not
   * a heading. Swap the order, or promote monthly to a heading beside a demoted
   * annual, and one of these fails.
   */
  test('annual is the plan presented first', () => {
    table()
    const annual = screen.getByTestId('pricing-annual')
    const monthly = screen.getByTestId('pricing-monthly')

    expect(
      Boolean(annual.compareDocumentPosition(monthly) & Node.DOCUMENT_POSITION_FOLLOWING),
    ).toBe(true)
    expect(monthly.tagName).not.toMatch(/^H[1-6]$/)
    expect(pro().queryAllByRole('heading', { name: PLANS[1].label })).toEqual([])
  })

  test('nothing on the page presents monthly as the better value', () => {
    // plans.test.ts pins this for MONTHLY_FINE_PRINT in isolation; the surface
    // is where it can actually be broken, by a badge or a sentence this
    // component adds around a string that is itself blameless. The economics
    // are in plans.ts's header: twelve charges a year cost $8.99 in Polar
    // Starter fees against annual's $3.00, and annual nets more for anyone who
    // lasts under 11.08 months. Monthly stays available and undisparaged; what
    // it must never be is the pitch.
    table({ trialOffered: true })
    expect(pageText()).not.toMatch(/best value|better value|cheaper|most popular|recommended/i)
  })
})

describe('the free column says what free GIVES', () => {
  /**
   * THE REQUIREMENT THAT IS EASIEST TO GET WRONG, because the default shape of a
   * tier table is a list of ticks against a list of crosses — and a free column
   * written as crosses tells a visitor who has never heard of this product that
   * it does nothing. Free is a real product here: two teams, three months, a
   * benchmark on the last board they entered, a team fact every day, chat with a
   * push behind it, and a reminder at a time they pick. None of that is a lesser
   * Pro; it is the thing they would be signing up for.
   */
  test('renders every free inclusion, title and body', () => {
    table()
    for (const inclusion of FREE_INCLUDES) {
      expect(free().getByText(inclusion.title)).toBeTruthy()
      expect(free().getByText(inclusion.body)).toBeTruthy()
    }
  })

  test('the two the code grants and a cross-shaped table would omit', () => {
    // Named individually rather than counted, because they are the two a reader
    // of insightsAccess.ts would be surprised to find on the free tier — layer1
    // is 'free' and layer3 is 'free' for everyone, trial or no trial — and they
    // are the first two a "free is Pro minus things" rewrite would drop.
    //
    // THE LAYER 1 PHRASE IS "the last board you entered", NOT "your most recent
    // board", AND THE DIFFERENCE IS A GUARD RATHER THAN A PREFERENCE. The second
    // wording shares exactly four consecutive words with pro-benefits.ts's
    // `insights` body, which describes the free half before the paid one, and
    // marketing-copy.test.ts fails a free-voice line at four. free-includes.ts's
    // `benchmark` entry records the whole account; what this line pins is that the
    // column still names Layer 1 at all.
    table()
    const text = screen.getByTestId('pricing-free').textContent ?? ''
    expect(text).toContain('last board you entered')
    expect(text).toContain('teammates')
  })

  test('is not written as a list of refusals', () => {
    // A negative over the whole column: free is described by what arrives, never
    // by what is withheld. "No custom scoring", "Limited to two teams" and
    // friends all land here.
    table()
    const text = screen.getByTestId('pricing-free').textContent ?? ''
    expect(text).not.toMatch(/\bno\b|\bnot\b|\bonly\b|\blimited\b|\bexcept\b|\bwithout\b/i)
  })

  test('pins the free-tier numbers this copy spells out in words', () => {
    // The idiom pro-benefits.test.ts and plans.test.ts both use: prose cannot
    // embed a template literal, so the constants are pinned here instead. Change
    // either without rewriting the column above and this fails, rather than
    // shipping stale copy behind four green gates.
    expect(FREE_TEAM_LIMIT).toBe(2)
    expect(FREE_MONTHS).toBe(3)
  })
})

/**
 * THE TRIAL IS INERT TODAY, AND THE PAGE MUST NOT PROMISE IT.
 *
 * convex/lib/insightsAccess.ts sets LAUNCH_AT to 2099 as an obvious placeholder
 * and says so: "No board can be entered after it, so `shouldStartTrial` is false
 * for everyone and NO trial is ever stamped while this value stands." A public
 * page that describes a thirty-day trial is therefore describing something every
 * visitor who reads it today will not get — which is a false statement about
 * price, on the page whose whole job is being true about price.
 *
 * SO THE SECTION IS CONDITIONAL RATHER THAN REWORDED. A hedge ("at launch, a
 * trial will…") is worse than silence on a marketing page: it advertises a
 * feature to someone who cannot have it and dates the page the moment launch
 * happens. Setting LAUNCH_AT to the real cutover instant is one line, and it
 * turns this section on at the same moment it turns the trial on — which is what
 * makes the claim true exactly when it is made.
 *
 * BOTH BRANCHES ARE ASSERTED. The launched branch is unreachable in production
 * today, so without a test of its own it would ship unread and unrendered, and
 * the one line that enables it would be the first thing to execute it.
 */
describe('the thirty-day trial', () => {
  test('LAUNCH_AT is still the placeholder, which is what makes the default right', () => {
    // The premise of the next test, asserted rather than assumed: if this ever
    // goes false the default flips and "says nothing about a trial" stops being
    // the correct behaviour — so this is the line that tells the next reader
    // why the page changed.
    expect(LAUNCH_AT_IS_PLACEHOLDER).toBe(true)
  })

  test('says nothing at all about a trial while no trial can start', () => {
    table()
    expect(screen.queryByTestId('pricing-trial')).toBeNull()
    expect(pageText()).not.toMatch(/trial|thirty days|30 days|free for a month/i)
  })

  test('once launch is real, explains the length, what it opens, and what starts it', () => {
    table({ trialOffered: true })
    const trial = screen.getByTestId('pricing-trial').textContent ?? ''

    expect(trial).toContain('thirty days')
    // What starts it: the first board entered after launch — `shouldStartTrial`
    // is `enteredAt >= launchAt` against a `trialEndsAt` written once. A page
    // that names a length and not a start tells a visitor nothing they can act
    // on.
    expect(trial).toMatch(/first board/i)
  })

  test('grants Layers 2 and 3 and does not read as thirty days of Pro', () => {
    /**
     * THE SUBTLE HALF, AND THE ONE A REASONABLE WRITER GETS WRONG.
     * insightsAccess() returns `layer2: paid ? 'full' : 'none'` and
     * `layer3: paid ? 'full' : 'free'`, where `paid` admits a trial — but
     * `layer1` and `layer4` stay keyed to `isPro` directly. So a player mid
     * trial gets their personal history and their team's whole month, and gets
     * NOTHING of the other three things Pro sells: the team cap, custom scoring
     * and screenshot import are all untouched by a trial.
     *
     * "Thirty days of Pro" is therefore a false sentence, and it is the obvious
     * one to write. This is what fails if somebody writes it.
     */
    table({ trialOffered: true })
    const trial = screen.getByTestId('pricing-trial').textContent ?? ''

    expect(trial).toMatch(/history/i)
    expect(trial).toMatch(/month/i)
    expect(trial).not.toMatch(/thirty days of pro|free pro|all of pro|everything pro/i)

    // And it must not quietly extend itself to the benefits a trial never
    // touches. Titles rather than bodies: a title is what a skimming reader
    // takes away, and naming one here is how the sentence starts to overreach.
    for (const id of ['teams', 'scoring', 'import'] as const) {
      const benefit = PRO_BENEFITS.find((entry) => entry.id === id)!
      expect(trial).not.toContain(benefit.title)
    }
  })

  test('pins the trial length this copy spells out in words', () => {
    expect(INSIGHTS_TRIAL_DAYS).toBe(30)
  })
})

describe('the shape of the comparison', () => {
  test('both tiers are headed regions, so the page can be navigated by heading', () => {
    table()
    expect(free().getByRole('heading', { name: 'Free' })).toBeTruthy()
    expect(pro().getByRole('heading', { name: 'Pro' })).toBeTruthy()
  })

  test('free is read first, because it is what signing up actually gets you', () => {
    // A cold visitor's question is "what is this", not "what does it cost" —
    // the free column answers the first and the Pro column answers the second.
    // Reversing them is a defensible-looking edit that changes what the page
    // argues, so the order is pinned rather than left to CSS.
    table()
    const freeColumn = screen.getByTestId('pricing-free')
    const proColumn = screen.getByTestId('pricing-pro')
    expect(
      Boolean(freeColumn.compareDocumentPosition(proColumn) & Node.DOCUMENT_POSITION_FOLLOWING),
    ).toBe(true)
  })
})
