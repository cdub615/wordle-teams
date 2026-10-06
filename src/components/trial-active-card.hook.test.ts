// @vitest-environment jsdom
//
// THE CARD FOR THE POPULATION NOTHING IN src/ COULD SEE. Before this component
// no file in src/ read `trialActive` at all, so the whole thirty-day trial ran
// with no surface and the first notice a player got was TrialEndedCard.
//
// MIRRORS trial-ended-card.hook.test.ts, including WHY it mocks one layer down
// (`useConvexAction`, not use-start-upgrade): with the hook stubbed, a card
// wired straight to startUpgrade would record nothing this file could see. That
// sibling's banner records a dead `onClick={() => {}}` passing the whole suite,
// tsc, eslint and the build — this card has the same shape and the same exposure.
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react'
import { getFunctionName, type FunctionReference } from 'convex/server'
import { createElement } from 'react'
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'
import { api } from '../../convex/_generated/api'
import { insightsAccess, type InsightsAccess } from '../../convex/lib/insightsAccess.ts'
import { UPGRADE_HEADLINES } from '#/lib/plans.ts'
import { formatInstantLabel } from '#/lib/format-day.ts'
import {
  TRIAL_ACTIVE_BODY,
  TRIAL_ACTIVE_CTA,
  TRIAL_ACTIVE_TITLE,
  trialEndsOnLine,
} from '#/lib/trial-copy.ts'

const { createCheckout, toastInfo, toastError } = vi.hoisted(() => ({
  createCheckout: vi.fn(),
  toastInfo: vi.fn(),
  toastError: vi.fn(),
}))

let access: InsightsAccess | null | undefined

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
      throw new Error(`the trial-active card asked for an unexpected query: ${queryKey[0]}`)
    }
    return { data: access }
  },
}))

vi.mock('sonner', () => ({ toast: { info: toastInfo, error: toastError } }))

const { UpgradeDialogProvider } = await import('./upgrade-dialog.tsx')
const { TrialActiveCard } = await import('./trial-active-card.tsx')

const HERE = 'http://localhost:3000/insights'
let location: { href: string }

const NOW = Date.UTC(2026, 0, 15)
const DAY = 24 * 60 * 60 * 1000
const ENDS_AT = NOW + 10 * DAY

/**
 * BUILT BY THE REAL RESOLVER rather than written out by hand, for the reason
 * trial-ended-card.hook.test.ts gives: a hand-written fixture lets this file
 * agree with itself about who is in the set while disagreeing with
 * convex/lib/insightsAccess.ts, which is the one disagreement that matters.
 */
const trialRunning = insightsAccess({ isPro: false, trialEndsAt: ENDS_AT, now: NOW })
const expiredTrial = insightsAccess({ isPro: false, trialEndsAt: NOW - DAY, now: NOW })
const neverTrialed = insightsAccess({ isPro: false, trialEndsAt: undefined, now: NOW })
const proNeverTrialed = insightsAccess({ isPro: true, trialEndsAt: undefined, now: NOW })
const proMidTrial = insightsAccess({ isPro: true, trialEndsAt: ENDS_AT, now: NOW })

const card = () =>
  render(createElement(UpgradeDialogProvider, null, createElement(TrialActiveCard, null)))

const clickCta = () => fireEvent.click(screen.getByRole('button', { name: TRIAL_ACTIVE_CTA }))
const dialog = () => screen.getByRole('dialog')
const headline = () => within(dialog()).getByRole('heading').textContent

beforeEach(() => {
  access = trialRunning
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

describe('the card a player mid-trial actually sees', () => {
  test('renders its title, body and CTA', () => {
    card()

    expect(screen.getByTestId('trial-active')).toBeTruthy()
    expect(screen.getByText(TRIAL_ACTIVE_TITLE)).toBeTruthy()
    expect(screen.getByText(TRIAL_ACTIVE_BODY)).toBeTruthy()
    expect(screen.getByRole('button', { name: TRIAL_ACTIVE_CTA })).toBeTruthy()
  })

  test('names the day the trial ends, formatted rather than as a timestamp', () => {
    // THE POINT OF THE WHOLE CARD. A trial a player cannot date is one they
    // cannot plan around, and the raw epoch number reaching the screen is the
    // failure mode worth pinning — it renders as '1768...' and looks like a bug.
    card()

    expect(screen.getByText(trialEndsOnLine(formatInstantLabel(ENDS_AT)))).toBeTruthy()
    expect(screen.queryByText(String(ENDS_AT))).toBeNull()
  })
})

describe('and nobody else', () => {
  /**
   * `trialActive` CARRIES THE WHOLE CONDITION. The two Pro rows are the ones
   * worth stating: a subscriber who never trialed, and a subscriber who
   * converted DURING a trial whose clock is still running. insightsAccess
   * reports trialActive true for the second — the field is about the clock, not
   * about who is paying — so a card keyed on it alone would tell a paying
   * customer their Pro features are "yours while your trial runs".
   */
  const silent: ReadonlyArray<readonly [string, InsightsAccess | null | undefined]> = [
    ['trial has ended', expiredTrial],
    ['never started a trial', neverTrialed],
    ['is Pro and never trialed', proNeverTrialed],
    ['is Pro with a trial clock still running', proMidTrial],
    ['is signed out, so myAccess answered null', null],
    ['has myAccess still in flight', undefined],
  ]

  for (const [who, answer] of silent) {
    test(`renders nothing for a player whose ${who}`, () => {
      access = answer
      card()

      expect(screen.queryByTestId('trial-active')).toBeNull()
      expect(screen.queryByRole('button', { name: TRIAL_ACTIVE_CTA })).toBeNull()
    })
  }
})

describe('the CTA opens the upgrade dialog on this card’s own headline', () => {
  /**
   * THE ORIGIN LITERAL, WHICH NOTHING ELSE IN THE REPO CAN SEE. Swapping it for
   * any of the other seven type-checks, lints and builds while headlining the
   * wrong sentence. Read off UPGRADE_HEADLINES rather than typed out, so the
   * copy stays owned by plans.ts: this pins WHICH headline, never what it says.
   */
  test('opens on the trial-active headline, not another affordance’s', () => {
    card()
    clickCta()

    expect(headline()).toBe(UPGRADE_HEADLINES['trial-active'])
  })

  test('starts no checkout by itself, because the dialog owns that step', () => {
    card()
    clickCta()

    expect(createCheckout.mock.calls.length).toBe(0)
  })
})
