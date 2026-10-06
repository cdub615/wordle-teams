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
//   1. Either inventory grows an entry and this page goes on showing the old
//      count — PRO_BENEFITS a seventh, or FREE_INCLUDES a seventh. The free half of
//      that matters more than it looks: /pricing is the only surface that shows
//      the whole free list, so an entry missing from this column is a capability
//      no reader meets anywhere.
//   2. The free column drifts into a list of refusals, which is the shape a tier
//      table falls into by default and the one a cold visitor reads as "nothing".
//   3. The trial gets described as something a visitor will get, on a day when
//      nobody's trial can start — while LAUNCH_AT is still the 2099 placeholder,
//      and again in the window after it is set and before it arrives.
//
// All three are copy, and copy is exactly what the four gates cannot see.
import { readFileSync } from 'node:fs'
import { cleanup, render, screen, within } from '@testing-library/react'
import { createElement } from 'react'
import { afterEach, describe, expect, test, vi } from 'vitest'
import { FREE_INCLUDES } from '#/lib/free-includes.ts'
import { MONTHLY_FINE_PRINT, PLANS, PRO_PRICE_LINE } from '#/lib/plans.ts'
import { PRO_BENEFITS } from '#/lib/pro-benefits.ts'
import { codeOf, runtimeImportsOf } from '#/test-support/source-ast.ts'
import { FREE_TEAM_LIMIT } from '../../../convex/lib/teamLimits.ts'
import { FREE_MONTHS } from '../../../convex/lib/monthWindow.ts'
import { INSIGHTS_TRIAL_DAYS } from '../../../convex/lib/insightsAccess.ts'
import { TierTable } from './tier-table.tsx'

afterEach(cleanup)

/**
 * ALWAYS PASSES THE PROP, because `trialOffered` is REQUIRED and has no default
 * — see the trial section below for why that is deliberate. `table()` is the
 * silence a caller asks for explicitly; `table({ trialOffered: true })` is the
 * launched world.
 */
const table = ({ trialOffered = false }: { trialOffered?: boolean } = {}) =>
  render(createElement(TierTable, { trialOffered }))

// A cwd-relative path, NOT `new URL(..., import.meta.url)`: this file declares
// jsdom, where `import.meta.url` is not a `file:` URL and readFileSync answers
// "The URL must be of scheme file" — dashboard-skeletons.hook.test.ts's comment
// on the same line has it in full, and today-panel.hook.test.ts does the same.
const SOURCE_PATH = 'src/components/pricing/tier-table.tsx'
const source = readFileSync(SOURCE_PATH, 'utf8')
// Comment-free text where the assertion forbids a word this component's own
// prose uses; `runtimeImportsOf` wants the real source and parses it.
const code = codeOf(source)

const free = () => within(screen.getByTestId('pricing-free'))
const pro = () => within(screen.getByTestId('pricing-pro'))

/** Everything the component drew, as one string. */
const pageText = () => screen.getByTestId('pricing-tiers').textContent ?? ''

describe('the Pro column', () => {
  /**
   * THE DRIFT GATE THIS PAGE EXISTS TO CARRY, and it is deliberately the same
   * assertion upgrade-dialog.hook.test.ts makes — pro-benefits.ts's header names
   * both of those surfaces among its consumers and says they "must not describe it
   * twice". A seventh benefit now fails in two places until both name it.
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

  test('writes no free copy of its own, and shows every entry there is', () => {
    // THE FREE-SIDE HALF OF "MUST NOT DESCRIBE IT TWICE", which this column went
    // without while the Pro one had it. The asymmetry became conspicuous when
    // `Entry` was made "the same shape on both sides, deliberately": one column's
    // headings were pinned to an inventory and the other's could grow a stray
    // heading freely.
    //
    // EXACT IN BOTH DIRECTIONS, WHICH IS WHAT THE LOOP ABOVE IS NOT. That one
    // asserts every entry APPEARS, and it already holds the direction that matters
    // most on its own: /pricing is the surface that shows all six, so an entry
    // missing from this column is a free capability the product never advertises
    // anywhere — which is how `reminders` went missing before the inventory existed,
    // a headline card on the landing page and absent from here. What THIS assertion
    // adds is the two things a per-entry lookup cannot see: a heading the column has
    // that the inventory does not, and the ORDER.
    //
    // WHAT IT STILL CANNOT SEE, stated rather than left to be discovered: an
    // unheaded and REWORDED paragraph. A `<p>` repeating an entry's body VERBATIM is
    // already caught, and not by this test — measured, it fails the loop above,
    // because `getByText` refuses to match two elements ("Found multiple elements
    // with the text"). A PARAPHRASE passes both, and passes the two tests below that
    // read the column's whole text: the refusals regex is a negative, and the Layer-1
    // phrase check is a `toContain`, which no addition can fail. A heading is what a
    // skimming reader takes away and what a second description of a tier arrives as.
    table()
    const headings = free()
      .getAllByRole('heading')
      .map((node) => node.textContent)
    expect(headings).toEqual(['Free', ...FREE_INCLUDES.map((inclusion) => inclusion.title)])
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
    // `insights` body, which describes the free half before the paid one.
    // free-includes.test.ts measures every line of the inventory against every
    // PRO_BENEFITS text and fails at four, which is what makes the wording forced;
    // free-includes.ts's `benchmark` entry records the whole account. What THIS
    // line pins is only that the rendered column still names Layer 1 at all — so
    // keep the two in step: a reworded entry lands here as a failure.
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
 * happens.
 *
 * AND THE CONDITION IS THE CLOCK, NOT THE CONSTANT. The banner here used to say
 * "Setting LAUNCH_AT to the real cutover instant is one line, and it turns this
 * section on at the same moment it turns the trial on", which is false: kc8c
 * sets LAUNCH_AT BEFORE the DNS cutover, and until that instant arrives
 * `trialCanStart` is still false and `shouldStartTrial` still stamps nobody.
 * routes/pricing.tsx's loader computes the predicate and passes it in, and the
 * prop is REQUIRED with no default, so there is no constant left for this
 * component to derive anything from (wordle-teams-wty4.1.14.10).
 *
 * BOTH BRANCHES ARE ASSERTED. The launched branch is unreachable in production
 * today, so without a test of its own it would ship unread and unrendered, and
 * the one line that enables it would be the first thing to execute it.
 */
describe('the thirty-day trial', () => {
  /**
   * WHAT THESE TWO REPLACED, AND WHAT EACH ONE ACTUALLY KILLS.
   *
   * The test here used to be `expect(LAUNCH_AT_IS_PLACEHOLDER).toBe(true)`,
   * stating the premise of a DERIVED DEFAULT: while that flag held,
   * `trialOffered = !LAUNCH_AT_IS_PLACEHOLDER` evaluated to `false` and silence
   * was correct. That premise is gone twice over — the default was replaced by
   * the literal `false`, and then the prop was made REQUIRED and the default
   * deleted outright — so asserting the placeholder still stands would say
   * nothing about this component. (It is still asserted where it is about
   * something: convex/lib/insightsAccess.test.ts's "is still the obvious
   * placeholder, and says so".)
   *
   * WHAT IS WORTH KEEPING IS THE OTHER HALF: this component's answer comes from
   * its caller and from nowhere else. A required prop is most of that, and it is
   * the compiler's to enforce — `<TierTable />` no longer builds. What the
   * compiler cannot say is that the file does not ALSO consult a clock or a
   * launch constant and OR it in, which would render identically today and turn
   * itself on the day the owner edits LAUNCH_AT. That is what these two are for.
   *
   * THE SOURCE IS NOT THE ONLY WAY TO SEE IT — an earlier version of this comment
   * said it was, and a render-level probe disproved it. So the clock half is now
   * spied rather than grepped: `not.toMatch(/Date\.now|new Date/)` could only see
   * a clock written in THIS file, and a spy sees one wherever the call ends up,
   * including inside a helper this file imports. MEASURED, both arms: the spies
   * kill `Date.now()` and `new Date()` in the render path, and they do NOT see
   * `performance.now()` or `Intl.DateTimeFormat().format()`, which reach the
   * clock without touching `Date` — so those two are still checked as text, with
   * the residue named at that assertion. The source read otherwise keeps only
   * what no render can see: the SHAPE of the prop, and the absence of the module
   * the old default came from.
   *
   * A THIRD PROBE WAS WRITTEN AND IS DELIBERATELY NOT HERE. It mocked
   * insightsAccess.ts with `LAUNCH_AT_IS_PLACEHOLDER: false` and asserted the
   * page stays silent, which killed the derived default behaviourally. With the
   * prop required there is no default to re-derive, and the only mutation it
   * could still catch — ORing that flag into the prop — has to import the module
   * the assertion below forbids, so that assertion already fails on it. The probe
   * would be a trap that cannot bite, and a test that cannot fail reads as
   * coverage it is not.
   */
  test('takes the answer as a required prop, with nothing behind it to derive', () => {
    // REQUIRED, and no default: both halves, because either alone re-opens the
    // hole. `trialOffered?: boolean` lets a caller omit it (silently falsy), and
    // any `trialOffered = …` is a default that can be re-derived from a constant
    // — which is exactly what wordle-teams-wty4.1.14.10 was filed about.
    expect(code).toMatch(/trialOffered: boolean/)
    expect(code).not.toMatch(/trialOffered\?/)
    expect(code).not.toMatch(/trialOffered\s*=/)

    // THE MODULE, NOT JUST THE CONSTANT'S NAME. `not.toMatch(/LAUNCH_AT/)` sees
    // `LAUNCH_AT_IS_PLACEHOLDER` coming back, but not a NEW export of that file
    // computed from LAUNCH_AT at module load — which no render can see either,
    // because it is evaluated before any spy is installed. This file has no
    // legitimate need for that module: the copy spells "thirty days" in prose
    // rather than interpolating INSIGHTS_TRIAL_DAYS, which is why the constant is
    // pinned by a test below instead of imported here.
    expect(code).not.toMatch(/LAUNCH_AT/)
    expect(runtimeImportsOf(SOURCE_PATH, source)).not.toContain(
      '../../../convex/lib/insightsAccess.ts',
    )
  })

  test('reads no clock while rendering', () => {
    // THE HYDRATION RULE, BEHAVIOURALLY. routes/pricing.tsx computes the answer
    // in its loader so it is serialized into the document; a clock read HERE
    // would be read again during hydration and could disagree with an
    // edge-cached document rendered before the cutover — a minified React #418
    // in production, the hazard today-panel.tsx and scores-table.tsx record.
    //
    // BOTH BRANCHES ARE RENDERED under the spies, because the trial branch is
    // the one with copy in it and is where a "days remaining" flourish would go.
    const now = vi.spyOn(Date, 'now')
    const ctor = vi.spyOn(globalThis, 'Date')
    try {
      table()
      cleanup()
      table({ trialOffered: true })
      expect(now).not.toHaveBeenCalled()
      expect(ctor).not.toHaveBeenCalled()
    } finally {
      now.mockRestore()
      ctor.mockRestore()
    }

    // THE TWO CLOCKS THE SPIES ABOVE CANNOT SEE, measured rather than reasoned:
    // a mutant gating the section on `performance.now()` and another on
    // `Intl.DateTimeFormat().format()` both passed the spy assertions, because
    // neither reaches the time through `Date`. Text, therefore — which only sees
    // them written in THIS file rather than behind an import. That residue is
    // accepted rather than closed: neither can answer "has LAUNCH_AT passed"
    // (one is monotonic from page load, the other formats rather than compares),
    // so a clock that actually decides this question goes through `Date` and is
    // caught above wherever it is written.
    expect(code).not.toMatch(/performance\s*\.\s*now|Intl\s*\.\s*DateTimeFormat/)
  })

  test('told there is no trial, says nothing at all about one', () => {
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
     * NOTHING of four other things Pro sells: the team cap, custom scoring,
     * screenshot import and starting a challenge are all untouched by a trial.
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
    // `challenges` belongs here too: proposeToTeamFor, proposeByLinkFor and the
    // scoreboard's member rows all ask isProFor, which a trial does not satisfy.
    for (const id of ['teams', 'scoring', 'import', 'challenges'] as const) {
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
