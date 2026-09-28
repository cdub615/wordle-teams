// @vitest-environment jsdom
//
// THE JOIN BETWEEN THE CARD AND THE DIALOG IT OPENS (wordle-teams-iht.1.11).
//
// Six affordances each hand `openUpgrade` a different origin, and the origin is
// the only thing that chooses the dialog's headline. Four of the six were
// pinned before this file: src/routes.test.ts reads routes/app.tsx and
// routes/insights.tsx as SOURCE and pins `teams`, `months` and `insights` that
// way; Header.hook.test.ts pins `header` by rendering the bar. Neither approach
// reaches a plain component, so `trial-ended` here and `import` in
// board-entry/form-import.hook.test.ts were covered by nothing at all.
//
// MEASURED, NOT ASSUMED. Before this file, rewriting line 39 of
// trial-ended-card.tsx as `openUpgrade('header')` passed the whole suite, tsc,
// eslint and the build — the player who clicked "See your history" after their
// trial ended was shown the generic "What you get with Pro" instead of the one
// sentence written for them. So did `onClick={() => {}}`: a completely dead
// paywall button, green on every gate. (tsc objects to THAT one incidentally,
// via TS6133 for the newly-unused `openUpgrade` binding, which any mutant that
// keeps the binding referenced evades. An incidental catch is not cover.)
//
// WHY THE EXISTING SUITES DO NOT ALREADY DO THIS, since between them they look
// as though they must. plans.test.ts proves six headlines exist and differ.
// upgrade-dialog.hook.test.ts proves the dialog renders each one GIVEN an
// origin — but it supplies the origin itself, from a hand-written
// `openUpgrade('trial-ended')` in a test-local `Opener`. That makes the string
// look exercised while nothing connects it to this card. Both halves are
// pinned; the seam between them was not.
//
// WHY THE e2e SPEC DOES NOT SAVE IT EITHER. e2e/billing.spec.ts's
// "…and offered the upgrade" asserts the CTA is VISIBLE and never clicks it —
// and e2e is not a gate here in any case: deploy-v2.yml runs lint, typecheck,
// test:once and build, and never Playwright.
//
// MOCKED ONE LAYER DOWN, THE WAY upgrade-dialog-dismissal.hook.test.ts IS:
// `useConvexAction` rather than `#/lib/use-start-upgrade.ts`, so the REAL hook
// runs inside the REAL provider. That is what makes "the click starts no
// checkout by itself" an observation rather than a tautology — with the hook
// stubbed, a card wired straight to `startUpgrade` would still record nothing
// this file could see.
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { getFunctionName, type FunctionReference } from 'convex/server'
import { createElement } from 'react'
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'
import { api } from '../../convex/_generated/api'
import { insightsAccess } from '../../convex/lib/insightsAccess.ts'
import type { InsightsAccess } from '../../convex/lib/insightsAccess.ts'
import { UPGRADE_HEADLINES } from '#/lib/plans.ts'
import { TRIAL_ENDED_BODY, TRIAL_ENDED_CTA, TRIAL_ENDED_TITLE } from '#/lib/trial-copy.ts'

const { createCheckout, toastInfo, toastError } = vi.hoisted(() => ({
  createCheckout: vi.fn(),
  toastInfo: vi.fn(),
  toastError: vi.fn(),
}))

/**
 * What `api.insights.myAccess` answers this render. `undefined` is the in-flight
 * state and `null` is the signed-out one; both are real and both are asserted
 * below.
 */
let access: InsightsAccess | null | undefined

// Keyed by the function's own name rather than answered blindly, for the reason
// Header.hook.test.ts spells out over its own: every polar action is
// zero-argument and every insights query takes `{}`, so a mock that answers
// anything would keep passing if the component were repointed at a different
// one.
vi.mock('@convex-dev/react-query', () => ({
  convexQuery: (ref: FunctionReference<'query'>, args: unknown) => ({
    queryKey: [getFunctionName(ref), args],
  }),
  useConvexAction: (ref: FunctionReference<'action'>) => {
    const name = getFunctionName(ref)
    if (name === getFunctionName(api.polar.createProCheckout)) return createCheckout
    throw new Error(`the upgrade dialog asked for an unexpected action: ${name}`)
  },
}))

vi.mock('@tanstack/react-query', () => ({
  useQuery: ({ queryKey }: { queryKey: [string, unknown] }) => {
    if (queryKey[0] !== getFunctionName(api.insights.myAccess)) {
      throw new Error(`the trial-ended card asked for an unexpected query: ${queryKey[0]}`)
    }
    return { data: access }
  },
}))

vi.mock('sonner', () => ({ toast: { info: toastInfo, error: toastError } }))

const { UpgradeDialogProvider } = await import('./upgrade-dialog.tsx')
const { TrialEndedCard } = await import('./trial-ended-card.tsx')

/**
 * jsdom refuses a real navigation and leaves `location.href` untouched, so the
 * hook's assignment has to land somewhere observable — the plain-object stub
 * upgrade-dialog-dismissal.hook.test.ts and use-start-upgrade.hook.test.ts both
 * use.
 */
const HERE = 'http://localhost:3000/insights'
let location: { href: string }

const NOW = Date.UTC(2026, 0, 15)
const DAY = 24 * 60 * 60 * 1000

/**
 * THE POPULATIONS, BUILT BY THE REAL RESOLVER rather than written out by hand.
 * `trialExpired` is the whole of the card's condition, and a hand-written
 * fixture would let this file agree with itself about who is in that set while
 * disagreeing with convex/lib/insightsAccess.ts — which is the one disagreement
 * that matters, since the card renders off whatever THAT function returns.
 */
const expiredTrial = insightsAccess({ isPro: false, trialEndsAt: NOW - DAY, now: NOW })
const neverTrialed = insightsAccess({ isPro: false, trialEndsAt: undefined, now: NOW })
const trialRunning = insightsAccess({ isPro: false, trialEndsAt: NOW + DAY, now: NOW })
const convertedToPro = insightsAccess({ isPro: true, trialEndsAt: NOW - DAY, now: NOW })

const card = () =>
  render(createElement(UpgradeDialogProvider, null, createElement(TrialEndedCard, null)))

/** The card's own CTA, which is the affordance under test. */
const clickCta = () => fireEvent.click(screen.getByRole('button', { name: TRIAL_ENDED_CTA }))

/**
 * SCOPED WITH `within`, NOT OPTIONAL. Nothing named "Upgrade" is on screen
 * before the dialog opens, but the dialog itself carries both "Upgrade" and
 * "Not now", and a future card CTA could collide — the scope is also what makes
 * a failure read as "the dialog is not open" rather than as an ambiguity.
 */
const dialog = () => screen.getByRole('dialog')
const headline = () => within(dialog()).getByRole('heading').textContent
const dialogCta = () => within(dialog()).getByRole('button', { name: 'Upgrade' })

/** Every call `createProCheckout` has taken this test, which is normally none. */
const checkoutStarted = () => createCheckout.mock.calls.length > 0

beforeEach(() => {
  access = expiredTrial
  location = { href: HERE }
  vi.stubGlobal('location', location)
  createCheckout.mockReset()
  createCheckout.mockResolvedValue({ url: null, reason: 'not-configured' })
  toastInfo.mockClear()
  toastError.mockClear()
})

afterEach(() => {
  cleanup()
  vi.unstubAllGlobals()
})

describe('the card the population it is for actually sees', () => {
  test('renders its title, body and CTA for an expired trial', () => {
    card()

    expect(screen.getByTestId('trial-ended')).toBeTruthy()
    expect(screen.getByText(TRIAL_ENDED_TITLE)).toBeTruthy()
    expect(screen.getByText(TRIAL_ENDED_BODY)).toBeTruthy()
    expect(screen.getByRole('button', { name: TRIAL_ENDED_CTA })).toBeTruthy()
  })

  /**
   * AND NOBODY ELSE. `trialExpired` carries the whole condition, so this is
   * really a test of the card trusting it rather than re-deriving it — a
   * `!trialActive` spelling would nag the commonest free account there is
   * (someone who never trialed) and, separately, would nag a Pro player about
   * the trial they converted from. The in-flight and signed-out rows are the
   * other two ways `access?.trialExpired` can be falsy, and both reach this
   * component on an ordinary cold load of /insights.
   */
  const silent: ReadonlyArray<readonly [string, InsightsAccess | null | undefined]> = [
    ['never started a trial', neverTrialed],
    ['is still inside one', trialRunning],
    ['converted to Pro', convertedToPro],
    ['is signed out, so myAccess answered null', null],
    ['has myAccess still in flight', undefined],
  ]

  for (const [who, answer] of silent) {
    test(`renders nothing for a player who ${who}`, () => {
      access = answer
      card()

      expect(screen.queryByTestId('trial-ended')).toBeNull()
      expect(screen.queryByRole('button', { name: TRIAL_ENDED_CTA })).toBeNull()
    })
  }
})

describe('the CTA opens the upgrade dialog, on this card’s own headline', () => {
  /**
   * THE ORIGIN LITERAL, WHICH NOTHING ELSE IN THE REPO CAN SEE. Swapping
   * `openUpgrade('trial-ended')` for any of the other five origins type-checks,
   * lints, builds and — before this assertion — passed all 3708 tests, while
   * headlining a generic Pro pitch at the one player the card exists for.
   *
   * THE HEADLINE IS READ OFF UPGRADE_HEADLINES RATHER THAN TYPED OUT, so the
   * copy stays owned by plans.ts: this pins WHICH headline, never what it says.
   */
  test('opens on the trial-ended headline, not another affordance’s', () => {
    card()

    clickCta()

    expect(headline()).toBe(UPGRADE_HEADLINES['trial-ended'])
  })

  /**
   * AND THE CLICK IS THE DIALOG, NOT THE CHECKOUT (wordle-teams-iht.1). The
   * card used to call `startUpgrade()` directly and put the player on Polar's
   * payment page having told them nothing about what Pro is. This is the half
   * that catches a regression back to that: a test that only checked the end
   * state would pass with the dialog skipped entirely.
   *
   * IT IS ALSO WHAT KILLS THE DEAD HANDLER. `onClick={() => {}}` leaves this
   * assertion true — no checkout did start — and the dialog assertion above
   * false, which is the pair working as one.
   */
  test('starts no checkout by itself, and reaches one only through the dialog', async () => {
    card()

    clickCta()
    expect(checkoutStarted()).toBe(false)
    // The dialog is what is on screen, and it is what has the CTA that pays.
    expect(headline()).toBe(UPGRADE_HEADLINES['trial-ended'])

    fireEvent.click(dialogCta())

    await waitFor(() => expect(checkoutStarted()).toBe(true))
    expect(createCheckout).toHaveBeenCalledWith({})
  })
})
