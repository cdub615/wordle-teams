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
// THE BILLING BUTTON BESIDE IT IS THE OTHER HALF OF WHAT THIS FILE PINS, AND
// IT HAS NO CONDITION. Task 12 first shipped it behind `isPro === true`, on
// the false claim that v1 gates the two so nobody sees both: v1's
// src/components/app-bar/user-dropdown.tsx:55-59 renders Billing behind
// `hasBillingAccount = ['pro', 'cancelled', 'expired'].includes(...)` and
// Upgrade behind `!proMember`, so a LAPSED player deliberately sees both.
// 'cancelled' and 'expired' are live here — convex/schema.ts carries them,
// convex/lib/polarEvents.ts maps `subscription.revoked` to 'expired',
// convex/migrate.ts copies both out of Supabase — and amIPro is false for all
// of them, so that gate took the customer portal away from every subscriber
// whose subscription had lapsed. Header.tsx holds the ONLY
// getCustomerPortalUrl call site in v2, so there was nowhere else to go.
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
import { readFileSync } from 'node:fs'
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { ConvexError } from 'convex/values'
import { getFunctionName, type FunctionReference } from 'convex/server'
import { createElement, type ReactNode } from 'react'
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'
import { api } from '../../convex/_generated/api'
import Header from './Header.tsx'
import { CHECKOUT_NOT_CONFIGURED, PORTAL_NOT_CONFIGURED } from '#/lib/billing-copy.ts'
import { typedCodeMessage } from '#/lib/convex-error.ts'

/**
 * The two portal sentences this file needs by value, neither of which is an
 * exported constant: billing-copy.ts writes the first inline in the
 * `no-customer` branch, Header.tsx writes the second inline in its catch.
 * billing-copy.test.ts owns the MAPPING; what is asserted here is that the
 * component honours it, level included.
 */
const NO_BILLING_ACCOUNT = 'You do not have a billing account yet.'
const PORTAL_FAILED = 'Could not open the billing portal.'

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

describe('Billing is there for any signed-in player, and Upgrade joins it when amIPro says false', () => {
  test('a FREE player is offered BOTH — the checkout, and the portal beside it', () => {
    // The gap wordle-teams-6tp names. There is no team count in the Upgrade
    // condition at all: it does not care how many teams they have, which is
    // the entire fix.
    //
    // AND BILLING IS STILL THERE, WHICH IS THE OTHER HALF. `isPro === false`
    // is the state a LAPSED subscriber is in — 'cancelled' or 'expired', both
    // live in convex/schema.ts — and they hold a real Polar customer with real
    // invoices. Gating this button on `isPro === true` left them no route to
    // the portal anywhere in v2. v1 shows them both entries deliberately;
    // see the note at the top of this file.
    isPro = false
    render(createElement(Header))

    expect(buttons()).toEqual(['Billing', 'Upgrade'])
  })

  test('a PRO player is offered Billing, and NOT a second subscription', () => {
    isPro = true
    render(createElement(Header))

    expect(buttons()).toEqual(['Billing'])
  })

  test('WHILE amIPro IS IN FLIGHT, BILLING BUT NO UPGRADE — no wrong label, no flash', () => {
    // THE MUTATION THIS EXISTS TO KILL. Rewrite `isPro === false` as `!isPro`
    // and `undefined` becomes true: a paying subscriber is shown "Upgrade" on
    // every cold load until the query answers, then watches it disappear. Both
    // other tests in this describe stay green through that change, and so do
    // lint, tsc, the build and all the rest.
    //
    // Billing IS here in this state, and that is not an oversight: it has no
    // condition, so there is no answer to wait for and nothing it could be
    // wrong about. Upgrade is late rather than wrong, which is the trade the
    // badge one line above already makes.
    //
    // The badge is asserted in the same breath because it is the same
    // comparison one line above, has the same undefined-is-truthy failure, and
    // a mutation to either condition alone would otherwise be killed only half
    // the time. Three pending invites, so its `> 0` gate is not what hides it.
    isPro = undefined
    pendingInvites = 3
    render(createElement(Header))

    expect(buttons()).toEqual(['Billing'])
    expect(inviteBadge()).toBeNull()
  })

  test('and a signed-out visitor gets NEITHER, whatever amIPro says', () => {
    // /login and /about render this bar with no session. The queries are
    // 'skip'ped there, so `isPro` is undefined in practice — but the branch is
    // gated on `isAuthenticated`, not on that, and this pins the gate rather
    // than the coincidence. It is also what stops "Billing is unconditional"
    // meaning "Billing is offered to a visitor with no account".
    isAuthenticated = false
    isPro = false
    render(createElement(Header))

    expect(buttons()).toEqual([])
  })

  test('and BELOW `sm` THE ICON IS THE ONLY DIFFERENCE, so both are pinned', () => {
    // Each label is `hidden sm:inline`, so on a phone — the product's primary
    // device, wordle-teams-ksh — the two buttons in this row are an icon and
    // an aria-label. Swapping Sparkles for CreditCard leaves e2e's 390px check
    // green with two identical-looking controls side by side, which is the
    // mutation this kills.
    isPro = false
    render(createElement(Header))

    expect(iconIn('Billing')).toContain('lucide-credit-card')
    expect(iconIn('Upgrade')).toContain('lucide-sparkles')
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

  test('Billing opens the PORTAL and navigates there — for a NON-pro player', async () => {
    // `isPro === false` ON PURPOSE, AND IT IS THE C1 REGRESSION TEST. This is
    // the lapsed subscriber's state: amIPro is false for 'cancelled' and
    // 'expired' (convex/access.ts's isProFor answers `=== 'pro'`), and they
    // are the people the portal exists for. Put the `isPro === true` gate back
    // on this button and this test cannot even find it.
    isPro = false
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
    // in this repo. One render reaches both buttons now that they share the
    // bar, which is itself the C1 fix showing through.
    isPro = false
    render(createElement(Header))

    fireEvent.click(screen.getByRole('button', { name: 'Upgrade' }))
    await waitFor(() => expect(toastError).toHaveBeenCalledWith(CHECKOUT_NOT_CONFIGURED))

    fireEvent.click(screen.getByRole('button', { name: 'Billing' }))
    await waitFor(() => expect(toastError).toHaveBeenCalledWith(PORTAL_NOT_CONFIGURED))

    // wordle-teams-9fm ON THE PORTAL SIDE, BACK AT GATE LEVEL. Task 12 deleted
    // e2e's `expect(toastWith(page, 'You do not have a billing account
    // yet.')).toHaveCount(0)` on this exact click and replaced it with nothing.
    // A deployment that is not configured is OUR fault and unfixable by the
    // player; "you have no billing account" is a fact about them and an `info`.
    // Collapsing the two reasons is the whole of that bug.
    expect(toastInfo).not.toHaveBeenCalled()
    expect(toastError).not.toHaveBeenCalledWith(NO_BILLING_ACCOUNT)
    expect(location.href).toBe('http://localhost:3000/app')
  })

  test('the portal reports no-customer as INFO, which is a different thing entirely', async () => {
    // THE MUTATION THIS KILLS: `toast[outcome.level]` -> `toast.error`.
    // billing-copy.test.ts pins that the mapping answers `info` here; nothing
    // pinned that Header honoured it, and the level IS the message — this is
    // the expected state for everyone who has never bought anything, and
    // dressing it as a failure is the lie billing-copy.ts's own note names.
    //
    // It is also the branch the `isPro === true` gate stranded: it exists to
    // answer somebody who reaches the portal with no Polar customer behind
    // them, and only a non-pro player can be that person.
    isPro = false
    openPortal.mockResolvedValue({ url: null, reason: 'no-customer' })
    render(createElement(Header))

    fireEvent.click(screen.getByRole('button', { name: 'Billing' }))

    await waitFor(() => expect(toastInfo).toHaveBeenCalledWith(NO_BILLING_ACCOUNT))
    expect(toastError).not.toHaveBeenCalled()
    expect(location.href).toBe('http://localhost:3000/app')
  })

  test('the portal handler says something when the action THROWS', async () => {
    // THE SIBLING OF use-start-upgrade.hook.test.ts's throw tests, and it had
    // none until the Task 12 review: emptying this catch passed lint, tsc, the
    // build and the whole suite. getCustomerPortalUrl turns a Polar failure
    // into `reason: 'error'` itself, so reaching the catch means the action
    // never answered at all — a dropped websocket, or an unset SITE_URL. A
    // dead button is indistinguishable from a broken one.
    isPro = false
    openPortal.mockRejectedValue(new Error('ws://backend.internal:3210 refused'))
    render(createElement(Header))

    fireEvent.click(screen.getByRole('button', { name: 'Billing' }))

    await waitFor(() => expect(toastError).toHaveBeenCalledWith(PORTAL_FAILED))
    // And the raw message never reaches the player: it can name a deployment
    // URL or an internal function path.
    expect(toastError).not.toHaveBeenCalledWith(expect.stringContaining('backend.internal'))
  })

  test('and a typed ConvexError gets ITS OWN copy, not the fallback', async () => {
    // What `mutationErrorMessage` is for, and the half a bare
    // `toast.error(PORTAL_FAILED)` in the catch would silently drop: an
    // unauthenticated player told to try again would retry forever without
    // signing in.
    isPro = false
    openPortal.mockRejectedValue(new ConvexError({ code: 'UNAUTHENTICATED' }))
    render(createElement(Header))

    fireEvent.click(screen.getByRole('button', { name: 'Billing' }))

    await waitFor(() =>
      expect(toastError).toHaveBeenCalledWith(typedCodeMessage('UNAUTHENTICATED')),
    )
    expect(toastError).not.toHaveBeenCalledWith(PORTAL_FAILED)
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
 * THE CHROME'S LINK TARGETS, AND THE GATE-LEVEL TWIN `wt-ksh.8.49` ASKS FOR.
 *
 * These two invariants were protected ONLY by e2e/routes.spec.ts:221,258,265,
 * and e2e is not a CI gate — so the wordmark could be repointed at `/home` and
 * all four gates would pass. §7a row 19 claimed "plus the source guard in
 * v2/src/routes.test.ts", which was wrong: that file guards `/` and `/home`
 * ROUTE behaviour (their beforeLoad), and never reads Header.tsx's links.
 *
 * WHY BOTH POINT AT `/` AND NOT `/home`: the two render the identical Landing,
 * sitemap.ts ranks `/` at priority 1 against `/home` at 0.9, and linking
 * internally to the duplicate advertises the non-canonical copy of a page we
 * serve twice. A repoint is therefore an SEO regression that nothing else here
 * would catch.
 */
describe('the app bar links at the landing, and says so on the landing', () => {
  // Rendered, not read: the Link mock at the top of this file emits a real
  // <a href={to}>, so this asserts the value the component actually passes
  // rather than a string that happens to appear in the source.
  const linkTargets = () => screen.queryAllByRole('link').map((a) => a.getAttribute('href'))

  test('the wordmark and the Home link both point at the canonical landing', () => {
    isPro = false
    render(createElement(Header))

    // EXHAUSTIVE over the anchors, not `toContain`. A link that quietly starts
    // pointing at /home is the regression, and toContain('/') cannot see it —
    // the Phase 7 footer test made exactly this mistake over `<Link to=` while
    // five `<a href>` links went unchecked. The third entry is the About link,
    // and it is listed rather than filtered out so that ADDING a link is a
    // change here too.
    //
    // The first draft of this test asserted ['/', '/'] and failed on the real
    // component, which is the exhaustive form earning its keep immediately.
    expect(linkTargets()).toEqual(['/', '/', '/about'])
    expect(linkTargets()).not.toContain('/home')
  })

  // The mock deliberately drops `activeProps`, so this half cannot be asserted
  // by rendering without testing the mock instead of the app. Read from source,
  // with comments stripped first — Header.tsx's own prose discusses both the
  // active class and /home, and a source assertion must not be satisfiable by a
  // file's commentary about itself.
  test('the Home link declares its active styling, so the landing marks itself', () => {
    const source = readFileSync('src/components/Header.tsx', 'utf8')
      .replace(/\/\*[\s\S]*?\*\//g, '')
      .replace(/(^|\s)\/\/[^\n]*/g, '')

    // BOUNDED AT BOTH ENDS, and the start is asserted before it is used:
    // `slice(indexOf(x))` on a miss is slice(-1), which silently returns the
    // last character and would make every assertion below pass or fail for the
    // wrong reason.
    const at = source.indexOf('<Link to="/" className="nav-link"')
    expect(at).toBeGreaterThan(-1)
    const openingTag = source.slice(at, source.indexOf('>', at) + 1)

    expect(openingTag).toContain('activeProps')
    expect(openingTag).toContain('is-active')
  })
})
