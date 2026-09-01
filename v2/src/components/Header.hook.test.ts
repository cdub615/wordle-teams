// @vitest-environment jsdom
//
// jsdom, not the suite's default edge-runtime (vitest.config.ts), because this
// file renders the real component. `.hook.test.ts` matches the five existing
// precedents — settings/notifications-tab, monthly-winner-celebration,
// date-picker, teams/team-boards and lib/use-local-capture — and `.test.ts`
// rather than `.test.tsx` because vitest.config.ts's glob is
// `src/**/*.test.ts`, so the elements below go through `createElement` by hand.
//
// WHY THIS FILE EXISTS: THE UPGRADE ENTRY POINT IS A GATE-LEVEL PROMISE.
// wordle-teams-6tp — v2's only route to createProCheckout was team-picker.tsx's
// "Upgrade for more", which renders only for a free player who ALREADY HOLDS
// TWO TEAMS. A free player with one team could not pay, and the owner (comped
// pro) could not reach checkout as himself at all, which is what blocked Phase
// 5's Polar sandbox pass from 2026-08-27. Header.tsx now offers the action
// unconditionally, and this reads it.
//
// AND IT IS PINNED HERE RATHER THAN IN e2e BECAUSE e2e IS NOT A GATE —
// wt-ksh.8.49. .github/workflows/deploy-v2.yml runs lint, typecheck,
// `test:once` and build, then smoke-tests /login; it never runs Playwright. An
// entry point protected only by e2e/billing.spec.ts can be deleted by a green
// pipeline.
//
// THE THREE STATES ARE THE WHOLE POINT, and the third is the one that regresses.
// `isPro` is `undefined` while amIPro is in flight, so `!isPro` is TRUE — the
// loose spelling flashes "Upgrade" at a paying subscriber on every cold load,
// which is precisely the defect the pending-invite badge beside it already
// carries a comment about. Nothing but a test that renders the in-flight state
// can see it: it type-checks, it lints, it builds, and by the time a human
// looks at the bar the query has answered.
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { getFunctionName, type FunctionReference } from 'convex/server'
import { createElement, type ReactNode } from 'react'
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'
import { api } from '../../convex/_generated/api'
import Header from './Header.tsx'
import { CHECKOUT_NOT_CONFIGURED, PORTAL_NOT_CONFIGURED } from '#/lib/billing-copy.ts'

/** Set per test, read by the mocked hooks below. */
let isAuthenticated: boolean
let isPro: boolean | undefined
let pendingInvites: number | undefined

const { createCheckout, openPortal, toastInfo, toastError } = vi.hoisted(() => ({
  createCheckout: vi.fn(),
  openPortal: vi.fn(),
  toastInfo: vi.fn(),
  toastError: vi.fn(),
}))

// A plain anchor. The real Link needs a RouterProvider, and nothing here is
// about routing — routes.test.ts and e2e/routes.spec.ts own the destinations.
vi.mock('@tanstack/react-router', () => ({
  Link: ({ to, children }: { to: string; children?: ReactNode }) =>
    createElement('a', { href: to }, children),
}))

// KEYED BY THE ACTION'S OWN NAME, WHICH IS THE SEAM THIS FILE IS FOR. Both
// polar actions take no arguments and answer the same url-or-reason shape, so
// wiring "Upgrade" to the portal type-checks and — on a deployment with no
// POLAR_* set, which is every deployment e2e drives — produces an almost
// identical-looking failure toast. Resolving them apart here is what makes the
// swap a red test rather than a silent one.
vi.mock('@convex-dev/react-query', () => ({
  convexQuery: (ref: FunctionReference<'query'>, args: unknown) => ({
    queryKey: [getFunctionName(ref), args],
  }),
  useConvexAuth: () => ({ isAuthenticated }),
  useConvexAction: (ref: FunctionReference<'action'>) => {
    const name = getFunctionName(ref)
    if (name === getFunctionName(api.polar.createProCheckout)) return createCheckout
    if (name === getFunctionName(api.polar.getCustomerPortalUrl)) return openPortal
    throw new Error(`Header asked for an unexpected action: ${name}`)
  },
}))

vi.mock('@tanstack/react-query', () => ({
  useQuery: ({ queryKey }: { queryKey: [string, unknown] }) =>
    queryKey[0] === getFunctionName(api.teams.amIPro)
      ? { data: isPro }
      : { data: pendingInvites },
}))

vi.mock('sonner', () => ({ toast: { info: toastInfo, error: toastError } }))

// Silent by design and tested on its own (lib/use-local-capture.hook.test.ts);
// left in the tree it would open two more subscriptions through the mock above.
vi.mock('#/lib/use-local-capture.ts', () => ({ useLocalCapture: () => {} }))

// STUBBED SO THE BUTTON LIST BELOW IS EXACTLY THE BILLING SLOT. UserMenu owns
// three Convex queries of its own and ThemeToggle reads window.matchMedia,
// which jsdom does not implement; both render controls that would otherwise sit
// in every `queryAllByRole('button')` here and make the set assertions vague.
vi.mock('./settings/user-menu.tsx', () => ({ UserMenu: () => null }))
vi.mock('./ThemeToggle', () => ({ default: () => null }))

/** jsdom refuses a real navigation, so the assignment needs somewhere to land. */
let location: { href: string }

beforeEach(() => {
  isAuthenticated = true
  isPro = false
  pendingInvites = 0
  location = { href: 'http://localhost:3000/app' }
  vi.stubGlobal('location', location)
  createCheckout.mockReset()
  openPortal.mockReset()
  createCheckout.mockResolvedValue({ url: null, reason: 'not-configured' })
  openPortal.mockResolvedValue({ url: null, reason: 'not-configured' })
  toastInfo.mockClear()
  toastError.mockClear()
})

afterEach(() => {
  cleanup()
  vi.unstubAllGlobals()
})

/**
 * Every button in the bar, by the accessible name a screen reader and
 * e2e/billing.spec.ts's locator both use.
 *
 * A LIST, ASSERTED WITH toEqual, NEVER A `getByRole` PER BRANCH. "Upgrade is
 * present" is satisfied by a bar that shows Upgrade AND Billing at once, which
 * is the state the two conditions being independent booleans makes reachable —
 * and it is wrong in both directions: a subscriber offered a second
 * subscription, or a free player sent to a portal that has no customer for
 * them. The set is the assertion.
 */
const buttons = () =>
  screen.queryAllByRole('button').map((element) => element.getAttribute('aria-label'))

/** The badge's text, or null. */
const inviteBadge = () => screen.queryByText(/Invites? Pending/)?.textContent ?? null

describe('the billing slot renders ONE thing, and which one depends on all three isPro states', () => {
  test('a FREE player is offered Upgrade, and no Billing link', () => {
    // The gap wordle-teams-6tp names. There is no team count here at all: this
    // button does not care how many teams they have, which is the entire fix.
    isPro = false
    render(createElement(Header))

    expect(buttons()).toEqual(['Upgrade'])
  })

  test('a PRO player is offered Billing, and no Upgrade', () => {
    // v1's shape too: user-dropdown.tsx renders Billing behind
    // `hasBillingAccount` and Upgrade behind `!proMember`, so nobody sees both.
    isPro = true
    render(createElement(Header))

    expect(buttons()).toEqual(['Billing'])
  })

  test('WHILE amIPro IS IN FLIGHT, NEITHER — no wrong label, and no flash', () => {
    // THE MUTATION THIS EXISTS TO KILL. Rewrite `isPro === false` as `!isPro`
    // and `undefined` becomes true: a paying subscriber is shown "Upgrade" on
    // every cold load until the query answers, then watches it turn into
    // "Billing". Both other tests in this describe stay green through that
    // change, and so do lint, tsc, the build and all 1173 of the rest.
    //
    // The badge is asserted in the same breath because it is the same
    // comparison one line above, has the same undefined-is-truthy failure, and
    // a mutation to either condition alone would otherwise be killed only half
    // the time. Three pending invites, so its `> 0` gate is not what hides it.
    isPro = undefined
    pendingInvites = 3
    render(createElement(Header))

    expect(buttons()).toEqual([])
    expect(inviteBadge()).toBeNull()
  })

  test('and a signed-out visitor gets neither, whatever amIPro says', () => {
    // /login and /about render this bar with no session. The queries are
    // 'skip'ped there, so `isPro` is undefined in practice — but the branch is
    // gated on `isAuthenticated`, not on that, and this pins the gate rather
    // than the coincidence.
    isAuthenticated = false
    isPro = false
    render(createElement(Header))

    expect(buttons()).toEqual([])
  })
})

describe('the buttons reach the action their label promises', () => {
  test('Upgrade starts a CHECKOUT and navigates to Polar', async () => {
    // THE SECOND MUTATION: point Upgrade at getCustomerPortalUrl. It
    // type-checks (both actions take no arguments), it renders identically, and
    // against the deployment e2e drives — no POLAR_* variable set,
    // wordle-teams-3bl — both answer `not-configured`, differing only in one
    // word of a toast. Only the action reference itself distinguishes them.
    isPro = false
    createCheckout.mockResolvedValue({ url: 'https://polar.example/checkout/abc' })
    render(createElement(Header))

    fireEvent.click(screen.getByRole('button', { name: 'Upgrade' }))

    await waitFor(() => expect(location.href).toBe('https://polar.example/checkout/abc'))
    expect(createCheckout).toHaveBeenCalledWith({})
    expect(openPortal).not.toHaveBeenCalled()
  })

  test('Billing opens the PORTAL and navigates there', async () => {
    isPro = true
    openPortal.mockResolvedValue({ url: 'https://polar.example/portal/abc' })
    render(createElement(Header))

    fireEvent.click(screen.getByRole('button', { name: 'Billing' }))

    await waitFor(() => expect(location.href).toBe('https://polar.example/portal/abc'))
    expect(openPortal).toHaveBeenCalledWith({})
    expect(createCheckout).not.toHaveBeenCalled()
  })

  test('and each reports ITS OWN misconfiguration, not the other one', async () => {
    // The two sentences exist so a player can tell which affordance failed;
    // sharing one constant, or crossing them, is invisible to every other test
    // in this repo. Both branches are exercised in one test because the
    // component is re-rendered, not re-mounted, between them.
    isPro = false
    const view = render(createElement(Header))
    fireEvent.click(screen.getByRole('button', { name: 'Upgrade' }))
    await waitFor(() => expect(toastError).toHaveBeenCalledWith(CHECKOUT_NOT_CONFIGURED))

    cleanup()
    isPro = true
    view.unmount()
    render(createElement(Header))
    fireEvent.click(screen.getByRole('button', { name: 'Billing' }))
    await waitFor(() => expect(toastError).toHaveBeenCalledWith(PORTAL_NOT_CONFIGURED))

    expect(CHECKOUT_NOT_CONFIGURED).not.toBe(PORTAL_NOT_CONFIGURED)
    expect(location.href).toBe('http://localhost:3000/app')
  })

  test('Upgrade is disabled for the round trip and comes back afterwards', async () => {
    // A button that stays stuck pending is the same dead end as one that says
    // nothing — e2e/billing.spec.ts makes the identical assertion about the
    // portal, and this is the half of it CI can actually run.
    isPro = false
    let release: (result: { url: null; reason: 'error' }) => void = () => {}
    createCheckout.mockReturnValue(new Promise((resolve) => (release = resolve)))
    render(createElement(Header))

    // `.disabled`, not a jest-dom matcher: @testing-library/jest-dom is not
    // installed in this repo and no suite here sets one up.
    const upgrade = screen.getByRole('button', { name: 'Upgrade' }) as HTMLButtonElement
    expect(upgrade.disabled).toBe(false)

    fireEvent.click(upgrade)
    await waitFor(() => expect(upgrade.disabled).toBe(true))

    release({ url: null, reason: 'error' })
    await waitFor(() => expect(upgrade.disabled).toBe(false))
  })
})
