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
// TWO TEAMS, so a free player with one team could not pay. Header.tsx now
// offers Upgrade to anybody amIPro says is not pro, with no team count in the
// condition at all, and this reads it.
//
// IT IS NOT OFFERED "UNCONDITIONALLY", WHICH IS WHAT THIS COMMENT CLAIMED
// UNTIL THE TASK 12 REVIEW. The owner's account is comped pro, so `isPro` is
// true for him, the button does not render, and he still cannot reach checkout
// as himself. That is correct — a subscriber is not offered a second
// subscription — and it is why Task 18's Polar sandbox pass (wordle-teams-02c)
// mints a FRESH non-pro account rather than using his. What Task 12 actually
// fixed is that any such account reaches checkout with zero teams created.
//
// BILLING IS NO LONGER IN THIS FILE'S SCOPE, AND ITS TESTS WERE NOT DELETED.
// wordle-teams-lyab moved the Billing button into the account menu, so
// everything this file used to pin about it — that it has no `isPro` gate,
// that it reaches the portal and not the checkout, that it reports each of the
// four PortalResult branches as itself — now lives in app-menu.hook.test.ts,
// assertion for assertion. The behaviours did not change; the component that
// owns them did. Do not re-add them here: Header no longer imports
// getCustomerPortalUrl at all.
//
// WHAT THAT LEAVES THIS FILE IS THE HALF THAT STAYED IN THE BAR — Upgrade, and
// the pending-invite badge beside it. Upgrade stayed OUT of the menu on
// purpose: wordle-teams-456 measures 87% of production signups never entering a
// board, and the only always-reachable route to checkout is not something to
// put behind a hamburger. That decision is the reason this file still exists.
//
// AND IT IS PINNED HERE RATHER THAN IN e2e BECAUSE e2e IS NOT A GATE —
// wt-ksh.8.49. .github/workflows/deploy-v2.yml runs lint, typecheck,
// `test:once` and build, then smoke-tests /login; it never runs Playwright. An
// entry point protected only by e2e/billing.spec.ts can be deleted by a green
// pipeline.
//
// THE THREE isPro STATES ARE THE WHOLE POINT, and the third is the one that
// regresses. `isPro` is `undefined` while amIPro is in flight, so `!isPro` is
// TRUE — the loose spelling flashes "Upgrade" at a paying subscriber on every
// cold load, which is precisely the defect the pending-invite badge beside it
// already carries a comment about. Nothing but a test that renders the
// in-flight state can see it: it type-checks, it lints, it builds, and by the
// time a human looks at the bar the query has answered.
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

const { createCheckout, toastInfo, toastError } = vi.hoisted(() => ({
  createCheckout: vi.fn(),
  // Kept even with no assertion left in this file: sonner's mock must expose
  // every method the component tree can reach, and `toast.info` is one
  // billing-copy.ts can still select through a future bar control. A missing
  // key here fails as an unhelpful "not a function" deep inside a handler.
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
  // THE THROW IS THE ASSERTION. Header reaches exactly one action now — the
  // checkout, through use-start-upgrade.ts. Wiring Upgrade to
  // getCustomerPortalUrl type-checks (both actions take no arguments and answer
  // the same url-or-reason shape) and, on a deployment with no POLAR_* set,
  // produces an almost identical-looking failure toast. Refusing to hand back
  // any other action is what makes that swap a red test rather than a silent
  // one, and it is now stricter than the old two-way mapping was.
  useConvexAction: (ref: FunctionReference<'action'>) => {
    const name = getFunctionName(ref)
    if (name === getFunctionName(api.polar.createProCheckout)) return createCheckout
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

// STUBBED SO THE BUTTON LIST BELOW IS EXACTLY THE UPGRADE SLOT. AppMenu owns
// three Convex queries of its own and reads window.matchMedia, which jsdom does
// not implement; it also renders the menu trigger, which would otherwise sit in
// every `queryAllByRole('button')` here and make the set assertions vague.
// app-menu.hook.test.ts renders it for real.
vi.mock('./app-menu.tsx', () => ({ AppMenu: () => null }))

/** jsdom refuses a real navigation, so the assignment needs somewhere to land. */
let location: { href: string }

beforeEach(() => {
  isAuthenticated = true
  isPro = false
  pendingInvites = 0
  location = { href: 'http://localhost:3000/app' }
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

/**
 * Every button in the bar, by the accessible name a screen reader and
 * e2e/billing.spec.ts's locator both use.
 *
 * A LIST, ASSERTED WITH toEqual, NEVER A `getByRole` PER BRANCH. "Upgrade is
 * present" is satisfied by a bar that shows Upgrade to a paying subscriber, and
 * "Billing is present" by a bar that shows nothing else to a free player who
 * has come to pay. Which buttons are there is one fact, not two, and both
 * conditions feed it — so the set is the assertion, and an added button is a
 * change here as loudly as a removed one.
 */
const buttons = () =>
  screen.queryAllByRole('button').map((element) => element.getAttribute('aria-label'))

/**
 * The lucide icon inside one button, by its class. `createLucideIcon` writes
 * `lucide-<kebab-name>` onto the svg (lucide-react 0.545), so this is the
 * icon's identity and not a style choice.
 */
const iconIn = (label: string) =>
  screen.getByRole('button', { name: label }).querySelector('svg')?.getAttribute('class') ?? ''

/** The badge's text, or null. */
const inviteBadge = () => screen.queryByText(/Invites? Pending/)?.textContent ?? null

describe('Upgrade appears exactly when amIPro says the player is not pro', () => {
  test('a FREE player is offered the checkout', () => {
    // The gap wordle-teams-6tp names. There is no team count in the Upgrade
    // condition at all: it does not care how many teams they have, which is
    // the entire fix.
    isPro = false
    render(createElement(Header))

    expect(buttons()).toEqual(['Upgrade'])
  })

  test('a PRO player is NOT offered a second subscription', () => {
    // And the bar is now EMPTY for them, which is the visible half of
    // wordle-teams-lyab: a paying player with no pending invites has a
    // wordmark and a menu, nothing else. The old bar always had Billing here.
    isPro = true
    render(createElement(Header))

    expect(buttons()).toEqual([])
  })

  test('WHILE amIPro IS IN FLIGHT, NO UPGRADE — no wrong label, no flash', () => {
    // THE MUTATION THIS EXISTS TO KILL. Rewrite `isPro === false` as `!isPro`
    // and `undefined` becomes true: a paying subscriber is shown "Upgrade" on
    // every cold load until the query answers, then watches it disappear. The
    // other tests in this describe stay green through that change, and so do
    // lint, tsc, the build and all the rest.
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

  test('and a signed-out visitor gets nothing, whatever amIPro says', () => {
    // /login and /about render this bar with no session. The queries are
    // 'skip'ped there, so `isPro` is undefined in practice — but the branch is
    // gated on `isAuthenticated`, not on that, and this pins the gate rather
    // than the coincidence.
    //
    // THE GATE IS NEW. Upgrade used to sit inside Header's one
    // `isAuthenticated &&` block along with Billing and the user menu; that
    // block is gone, because AppMenu now renders signed-out too. Upgrade
    // therefore had to grow an `isAuthenticated &&` of its own, and without it
    // an anonymous visitor on /about would be offered a checkout they cannot
    // complete. Deleting that conjunct is invisible to every other test here.
    isAuthenticated = false
    isPro = false
    render(createElement(Header))

    expect(buttons()).toEqual([])
  })

  test('BELOW `sm` THE ICON IS THE ONLY LABEL, so it is pinned', () => {
    // The label is `hidden sm:inline`, so on a phone — the product's primary
    // device, wordle-teams-ksh — this button is an icon and an aria-label.
    isPro = false
    render(createElement(Header))

    expect(iconIn('Upgrade')).toContain('lucide-sparkles')
  })

  test('the pending-invite badge still rides in the bar, not the menu', () => {
    // It moved nowhere in wordle-teams-lyab and this pins that it did not get
    // swept into the menu with everything else. It is not a control — v1's
    // equivalent carries `focus:bg-transparent` precisely so it does not read
    // as one — so it stays visible rather than costing a tap: there is nothing
    // to click, only something to know.
    isPro = false
    pendingInvites = 2
    render(createElement(Header))

    expect(inviteBadge()).toBe('2 Invites Pending')
  })
})

describe('Upgrade reaches the action its label promises', () => {
  test('Upgrade starts a CHECKOUT and navigates to Polar', async () => {
    isPro = false
    createCheckout.mockResolvedValue({ url: 'https://polar.example/checkout/abc' })
    render(createElement(Header))

    fireEvent.click(screen.getByRole('button', { name: 'Upgrade' }))

    await waitFor(() => expect(location.href).toBe('https://polar.example/checkout/abc'))
    expect(createCheckout).toHaveBeenCalledWith({})
  })

  test('and reports its own misconfiguration', async () => {
    // The checkout and the portal have separate sentences so a player can tell
    // which affordance failed; the portal half of that pair is asserted in
    // app-menu.hook.test.ts, against the same two constants.
    isPro = false
    render(createElement(Header))

    fireEvent.click(screen.getByRole('button', { name: 'Upgrade' }))

    await waitFor(() => expect(toastError).toHaveBeenCalledWith(CHECKOUT_NOT_CONFIGURED))
    expect(toastError).not.toHaveBeenCalledWith(PORTAL_NOT_CONFIGURED)
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

/**
 * THE WORDMARK'S TARGET, AND THE GATE-LEVEL TWIN `wt-ksh.8.49` ASKS FOR.
 *
 * This invariant was protected ONLY by e2e/routes.spec.ts:221,258,265, and e2e
 * is not a CI gate — so the wordmark could be repointed at `/home` and all four
 * gates would pass. §7a row 19 claimed "plus the source guard in
 * v2/src/routes.test.ts", which was wrong: that file guards `/` and `/home`
 * ROUTE behaviour (their beforeLoad), and never reads Header.tsx's links.
 *
 * WHY `/` AND NOT `/home`: the two render the identical Landing, sitemap.ts
 * ranks `/` at priority 1 against `/home` at 0.9, and linking internally to the
 * duplicate advertises the non-canonical copy of a page we serve twice. A
 * repoint is therefore an SEO regression that nothing else here would catch.
 *
 * IT IS NOW THE BAR'S ONLY LINK, which raises the stakes rather than lowering
 * them. wordle-teams-lyab moved the "Home" and "About" links into the menu, so
 * the wordmark is the whole of the bar's navigation: if it points at the wrong
 * page there is no second link in the chrome to compensate. The old
 * `activeProps`/`is-active` assertion that stood here went with those links —
 * a menu item has no underline to mark — and the menu's own destinations are
 * pinned in app-menu.hook.test.ts.
 */
describe('the app bar links at the landing', () => {
  // Rendered, not read: the Link mock at the top of this file emits a real
  // <a href={to}>, so this asserts the value the component actually passes
  // rather than a string that happens to appear in the source.
  const linkTargets = () => screen.queryAllByRole('link').map((a) => a.getAttribute('href'))

  test('the wordmark points at the canonical landing, and is the only link left', () => {
    isPro = false
    render(createElement(Header))

    // EXHAUSTIVE over the anchors, not `toContain`. A link that quietly starts
    // pointing at /home is the regression, and toContain('/') cannot see it —
    // the Phase 7 footer test made exactly this mistake over `<Link to=` while
    // five `<a href>` links went unchecked. Listing the whole set also means
    // ADDING a link back into the bar is a change here, which is the thing
    // wordle-teams-lyab was undoing.
    expect(linkTargets()).toEqual(['/'])
    expect(linkTargets()).not.toContain('/home')
  })
})
