// @vitest-environment jsdom
//
// jsdom, not the suite's default edge-runtime (vitest.config.ts), because this
// file renders the real component. `.hook.test.ts` matches the existing
// precedents — Header, settings/notifications-tab, monthly-winner-celebration,
// date-picker, teams/team-boards and lib/use-local-capture — and `.test.ts`
// rather than `.test.tsx` because vitest.config.ts's glob is
// `src/**/*.test.ts`, so the elements below go through `createElement` by hand.
//
// WHY THIS FILE EXISTS: wordle-teams-lyab COLLAPSED FOUR CONTROLS INTO ONE
// MENU, AND THE MENU IS NOW THE ONLY WAY TO REACH THREE OF THEM. Before it,
// Billing was a button in the bar and Home/About were links in the bar, so
// Header.hook.test.ts could see them. They are menu items now. Everything that
// file used to pin about the portal moved here assertion for assertion — the
// absent `isPro` gate, the four PortalResult branches, the pending state — and
// this file adds the two things that did not exist to pin before:
//
//   1. THE SIGNED-OUT MENU. The old settings/user-menu.tsx only ever mounted
//      inside Header's `isAuthenticated &&`. This one mounts always, because
//      the nav and the theme control live inside it and a visitor on /login
//      would otherwise have neither. That makes "which items does a signed-out
//      visitor get" a real question with a wrong answer available: leak Billing
//      or Log out into it and a stranger is offered a customer portal.
//
//   2. LOG OUT AT ALL. v2 had no sign-out anywhere in src/ before this — a
//      straight parity gap against v1's user-dropdown.tsx, not new polish. A
//      test that only checked the item RENDERS would miss the two things that
//      actually go wrong: leaving the previous account's `selectedTeam` in
//      localStorage for whoever signs in next, and leaving the previous
//      account's data in the react-query cache.
//
// THE ITEM SETS ARE ASSERTED AS LISTS, WITH toEqual, NEVER ONE getByText PER
// BRANCH — the same discipline Header.hook.test.ts's `buttons()` uses and for
// the same reason. "Billing is present" is satisfied by a menu that also offers
// it to a signed-out visitor. Which items are there is one fact, not nine, so
// the set is the assertion and an ADDED item is a change here as loudly as a
// removed one.
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { ConvexError } from 'convex/values'
import { getFunctionName, type FunctionReference } from 'convex/server'
import { createElement, type ReactNode } from 'react'
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'
import { api } from '../../convex/_generated/api'
import { AppMenu } from './app-menu.tsx'
import { PORTAL_NOT_CONFIGURED } from '#/lib/billing-copy.ts'
import { typedCodeMessage } from '#/lib/convex-error.ts'
import { STORAGE_KEY as SELECTED_TEAM_KEY } from '#/lib/dashboard-search.ts'
import { THEME_STORAGE_KEY } from '#/lib/theme.ts'
import { REDUCED_MOTION_QUERY } from '#/lib/use-reduced-motion.ts'

/**
 * The two portal sentences this file needs by value, neither of which is an
 * exported constant: billing-copy.ts writes the first inline in the
 * `no-customer` branch, app-menu.tsx writes the second inline in its catch.
 * billing-copy.test.ts owns the MAPPING; what is asserted here is that the
 * component honours it, level included.
 */
const NO_BILLING_ACCOUNT = 'You do not have a billing account yet.'
const PORTAL_FAILED = 'Could not open the billing portal.'

/** Set per test, read by the mocked hooks below. */
let isAuthenticated: boolean
let isPro: boolean | undefined
/** What the stubbed matchMedia answers for the reduced-motion query. */
let reducedMotion: boolean

const { openPortal, signOut, navigate, queryClientClear, toastInfo, toastError } = vi.hoisted(
  () => ({
    openPortal: vi.fn(),
    signOut: vi.fn(),
    navigate: vi.fn(),
    queryClientClear: vi.fn(),
    toastInfo: vi.fn(),
    toastError: vi.fn(),
  }),
)

// A plain anchor. The real Link needs a RouterProvider, and nothing here is
// about routing — routes.test.ts and e2e/routes.spec.ts own the destinations.
// `useRouter` is faked down to the one method sign-out calls.
//
// `...rest` IS LOAD-BEARING AND WAS THE FIRST THING THIS FILE GOT WRONG. Every
// navigation item is a `<DropdownMenuItem asChild><Link/></DropdownMenuItem>`,
// and asChild means Radix does not render an element of its own — it MERGES its
// props, `role="menuitem"` among them, onto the child. A mock that destructures
// only `to` and `children` silently drops that role, so Home, About, Dashboard
// and Log in all vanish from `queryAllByRole('menuitem')` while Feedback (a raw
// <a>, no mock in the way) survives. The item-set assertions then fail against a
// component that is perfectly correct.
vi.mock('@tanstack/react-router', () => ({
  Link: ({ to, children, ...rest }: { to: string; children?: ReactNode }) =>
    createElement('a', { href: to, ...rest }, children),
  useRouter: () => ({ navigate }),
}))

// KEYED BY THE ACTION'S OWN NAME, AND THE THROW IS THE ASSERTION. The menu
// reaches exactly one action — the portal. Wiring Billing to
// createProCheckout type-checks (both take no arguments and answer the same
// url-or-reason shape) and, on a deployment with no POLAR_* set, produces an
// almost identical-looking failure toast. Refusing any other action is what
// makes that swap a red test rather than a silent one.
vi.mock('@convex-dev/react-query', () => ({
  convexQuery: (ref: FunctionReference<'query'>, args: unknown) => ({
    queryKey: [getFunctionName(ref), args],
    args,
  }),
  useConvexAuth: () => ({ isAuthenticated }),
  useConvexAction: (ref: FunctionReference<'action'>) => {
    const name = getFunctionName(ref)
    if (name === getFunctionName(api.polar.getCustomerPortalUrl)) return openPortal
    throw new Error(`AppMenu asked for an unexpected action: ${name}`)
  },
}))

/**
 * THE MOCK READS `args` BACK, WHICH IS THE POINT OF CARRYING IT ABOVE.
 *
 * A signed-out visitor mounts this component, so all three of its queries must
 * be 'skip'ped or they run against a session that does not exist. Header.tsx's
 * doc comment records why `enabled: false` is not a substitute — measured on
 * this project, the browser still opens the websocket watch and the server
 * still refuses, and the refusal is swallowed into query state where nobody
 * sees it. So the mock answers `undefined` for a skipped query rather than
 * quietly handing back data, and the signed-out item-set test below would fail
 * loudly if the gate were dropped.
 */
vi.mock('@tanstack/react-query', () => ({
  useQuery: ({ queryKey, args }: { queryKey: [string, unknown]; args: unknown }) => {
    if (args === 'skip') return { data: undefined }
    if (queryKey[0] === getFunctionName(api.teams.amIPro)) return { data: isPro }
    if (queryKey[0] === getFunctionName(api.auth.getCurrentUser)) {
      return { data: { name: 'Ada Lovelace', email: 'ada@example.com', image: null } }
    }
    return { data: { firstName: 'Ada', lastName: 'Lovelace' } }
  },
  useQueryClient: () => ({ clear: queryClientClear }),
}))

vi.mock('sonner', () => ({ toast: { info: toastInfo, error: toastError } }))

/**
 * A REAL Storage, BECAUSE THIS ENVIRONMENT DOES NOT SUPPLY ONE. Measured
 * rather than assumed: under `@vitest-environment jsdom` here,
 * `window.localStorage` is a bare `Object` — `typeof localStorage.setItem` is
 * 'undefined', and calling `.clear()` throws "not a function". Every read and
 * write in this file goes through this instead.
 *
 * IT IS ALSO WHAT MAKES THE SIGN-OUT TEST HONEST. Asserting that `theme`
 * survives and `selectedTeam` does not requires storage that actually
 * remembers; a spy that records calls would pass just as happily against a
 * blanket `localStorage.clear()`, which is the exact mutation that test exists
 * to kill.
 */
function memoryStorage(): Storage {
  const entries = new Map<string, string>()
  return {
    get length() {
      return entries.size
    },
    key: (index: number) => [...entries.keys()][index] ?? null,
    getItem: (key: string) => entries.get(key) ?? null,
    setItem: (key: string, value: string) => void entries.set(key, String(value)),
    removeItem: (key: string) => void entries.delete(key),
    clear: () => entries.clear(),
  } as Storage
}

vi.mock('#/lib/auth-client.ts', () => ({ authClient: { signOut } }))

// Two tabs' worth of Convex queries behind a Radix portal; the dialog's own
// contents are settings/notifications-tab's business, not this file's.
vi.mock('#/components/settings/settings-dialog.tsx', () => ({
  SettingsDialog: () => null,
}))

/** jsdom refuses a real navigation, so the assignment needs somewhere to land. */
let location: { href: string }

beforeEach(() => {
  isAuthenticated = true
  isPro = false
  location = { href: 'http://localhost:3000/app' }
  vi.stubGlobal('location', location)
  openPortal.mockReset()
  openPortal.mockResolvedValue({ url: null, reason: 'not-configured' })
  signOut.mockReset()
  signOut.mockResolvedValue(undefined)
  navigate.mockReset()
  navigate.mockResolvedValue(undefined)
  queryClientClear.mockClear()
  toastInfo.mockClear()
  toastError.mockClear()

  vi.stubGlobal('localStorage', memoryStorage())

  // jsdom implements neither, and useThemeMode and useReducedMotion both call
  // matchMedia on mount. `reducedMotion` is read per test; the colour-scheme
  // query is always answered false, so 'auto' resolves to light.
  reducedMotion = false
  vi.stubGlobal('matchMedia', (query: string) => ({
    matches: query === REDUCED_MOTION_QUERY ? reducedMotion : false,
    media: query,
    addEventListener: () => {},
    removeEventListener: () => {},
  }))

  // The theme is applied to the real <html>, which persists across tests in a
  // file; without this the 'System' test could pass on a leftover attribute.
  document.documentElement.className = ''
  document.documentElement.removeAttribute('data-theme')
})

afterEach(() => {
  cleanup()
  vi.unstubAllGlobals()
})

/**
 * Opens the menu and returns every item's text, in order.
 *
 * Radix renders the content only once the trigger is activated, and it opens on
 * pointerdown rather than click — fireEvent.click alone leaves the menu shut
 * and every assertion below trivially passing against an empty list.
 */
const openMenu = () => {
  fireEvent.pointerDown(
    screen.getByRole('button', { name: 'Main menu' }),
    { button: 0, ctrlKey: false, pointerType: 'mouse' },
  )
  return screen.queryAllByRole('menuitem').map((item) => item.textContent)
}

describe('the menu offers a signed-out visitor navigation and nothing else', () => {
  test('signed out: nav, theme and a way in — no billing, no log out', () => {
    // THE LEAK THIS KILLS. Billing and Log out are inside `isAuthenticated &&`
    // blocks; drop either conjunct and a stranger on /login is offered a
    // customer portal and a sign-out for a session they do not have. The
    // portal call would then reach getCustomerPortalUrl unauthenticated, which
    // answers `reason: 'error'` and logs "portal requested with no resolvable
    // player" — a routing bug reported as an outage.
    isAuthenticated = false
    render(createElement(AppMenu))

    expect(openMenu()).toEqual(['Theme', 'Home', 'About', 'Feedback', 'Log in'])
  })

  test('signed in: the full set, and NO "Log in" in it', () => {
    // Log in is the mirror of the leak above — `!isAuthenticated &&` rather
    // than the bare item — and offering it to a live session is how a
    // signed-in player ends up bounced through /login's beforeLoad.
    render(createElement(AppMenu))

    expect(openMenu()).toEqual([
      'Dashboard',
      'Notifications',
      'Theme',
      'Billing',
      'Home',
      'About',
      'Feedback',
      'Install Guide',
      'Log out',
    ])
  })

  test('THE MENU EXISTS AT ALL FOR A SIGNED-OUT VISITOR, which is the whole change', () => {
    // Its predecessor (settings/user-menu.tsx) was mounted inside Header's
    // `isAuthenticated &&`, so there was nothing to open. Restore that gate
    // anywhere up the tree and a visitor on /login or /about loses every link
    // in the chrome and the theme control with them, because wordle-teams-lyab
    // moved all of them in here. Nothing else in the suite would notice.
    isAuthenticated = false
    render(createElement(AppMenu))

    expect(screen.queryByRole('button', { name: 'Main menu' })).not.toBeNull()
  })

  test('the identity label and Pro badge are for members only', () => {
    // The label is a DropdownMenuLabel, not a menuitem, so the set assertions
    // above cannot see it either way.
    isAuthenticated = false
    render(createElement(AppMenu))
    openMenu()

    expect(screen.queryByText('Ada Lovelace')).toBeNull()
    expect(screen.queryByText('Free')).toBeNull()
  })
})

describe('the Pro/Free badge waits for an answer before it names one', () => {
  test('a free player is labelled Free', () => {
    isPro = false
    render(createElement(AppMenu))
    openMenu()

    expect(screen.queryByText('Free')).not.toBeNull()
  })

  test('WHILE amIPro IS IN FLIGHT, NEITHER LABEL — a wrong label is worse than a late one', () => {
    // THE MUTATION THIS KILLS: `isPro !== undefined &&` -> an unconditional
    // `isPro ? 'Pro' : 'Free'`. `undefined` is falsy, so a paying subscriber is
    // told they are Free on every cold load until the query answers. It
    // type-checks, it lints, it builds, and by the time a human opens the menu
    // the query has resolved. Header.tsx names the identical rule for Upgrade.
    isPro = undefined
    render(createElement(AppMenu))
    openMenu()

    expect(screen.queryByText('Free')).toBeNull()
    expect(screen.queryByText('Pro')).toBeNull()
  })
})

describe('Billing reaches the portal, and reports each outcome as itself', () => {
  const clickBilling = () => fireEvent.click(screen.getByRole('menuitem', { name: 'Billing' }))

  test('Billing has NO isPro gate — the lapsed subscriber is who it is for', () => {
    // THE C1 REGRESSION TEST, moved here from Header.hook.test.ts intact.
    // amIPro is false for 'cancelled' and 'expired' (convex/access.ts's
    // isProFor answers `=== 'pro'`), both live in convex/schema.ts and both
    // copied out of Supabase by convex/migrate.ts. Those players hold a real
    // Polar customer with real invoices. Gating this item on `isPro === true`
    // took the portal away from every one of them, and this component holds
    // the ONLY getCustomerPortalUrl call site in v2, so there was nowhere else
    // to go. Asserted at BOTH ends of the boolean, because a gate in either
    // direction is a way to get this wrong.
    isPro = false
    render(createElement(AppMenu))
    expect(openMenu()).toContain('Billing')

    cleanup()
    isPro = true
    render(createElement(AppMenu))
    expect(openMenu()).toContain('Billing')
  })

  test('Billing opens the PORTAL and navigates there', async () => {
    openPortal.mockResolvedValue({ url: 'https://polar.example/portal/abc' })
    render(createElement(AppMenu))
    openMenu()

    clickBilling()

    await waitFor(() => expect(location.href).toBe('https://polar.example/portal/abc'))
    expect(openPortal).toHaveBeenCalledWith({})
  })

  test('an unconfigured deployment is OUR fault and says so', async () => {
    // wordle-teams-9fm. A deployment with no POLAR_* set is unfixable by the
    // player; "you have no billing account" is a fact about THEM and an info.
    // Collapsing the two reasons is the whole of that bug.
    render(createElement(AppMenu))
    openMenu()

    clickBilling()

    await waitFor(() => expect(toastError).toHaveBeenCalledWith(PORTAL_NOT_CONFIGURED))
    expect(toastInfo).not.toHaveBeenCalled()
    expect(toastError).not.toHaveBeenCalledWith(NO_BILLING_ACCOUNT)
  })

  test('no-customer is INFO, which is a different thing entirely', async () => {
    // THE MUTATION THIS KILLS: `toast[outcome.level]` -> `toast.error`.
    // billing-copy.test.ts pins that the mapping answers `info` here; nothing
    // pins that the component honours it, and the level IS the message — this
    // is the expected state for everyone who has never bought anything.
    //
    // wordle-teams-kzfi will make this branch rarer by creating the Polar
    // customer on demand, but not unreachable, and the copy stays correct
    // until it lands.
    openPortal.mockResolvedValue({ url: null, reason: 'no-customer' })
    render(createElement(AppMenu))
    openMenu()

    clickBilling()

    await waitFor(() => expect(toastInfo).toHaveBeenCalledWith(NO_BILLING_ACCOUNT))
    expect(toastError).not.toHaveBeenCalled()
  })

  test('the handler says something when the action THROWS', async () => {
    // getCustomerPortalUrl turns a Polar failure into `reason: 'error'` itself,
    // so reaching the catch means the action never answered at all — a dropped
    // websocket, or an unset SITE_URL. A dead item is indistinguishable from a
    // broken one. Emptying this catch passes lint, tsc, the build and the rest
    // of the suite.
    openPortal.mockRejectedValue(new Error('ws://backend.internal:3210 refused'))
    render(createElement(AppMenu))
    openMenu()

    clickBilling()

    await waitFor(() => expect(toastError).toHaveBeenCalledWith(PORTAL_FAILED))
    // And the raw message never reaches the player: it can name a deployment
    // URL or an internal function path.
    expect(toastError).not.toHaveBeenCalledWith(expect.stringContaining('backend.internal'))
  })

  test('a typed ConvexError gets ITS OWN copy, not the fallback', async () => {
    // What `mutationErrorMessage` is for, and the half a bare
    // `toast.error(PORTAL_FAILED)` would silently drop: an unauthenticated
    // player told to try again would retry forever without signing in.
    openPortal.mockRejectedValue(new ConvexError({ code: 'UNAUTHENTICATED' }))
    render(createElement(AppMenu))
    openMenu()

    clickBilling()

    await waitFor(() =>
      expect(toastError).toHaveBeenCalledWith(typedCodeMessage('UNAUTHENTICATED')),
    )
    expect(toastError).not.toHaveBeenCalledWith(PORTAL_FAILED)
  })

  test('the menu STAYS OPEN for the round trip, and the item is disabled', async () => {
    // A Radix menu item closes the menu on select by default, which would
    // unmount the spinner the instant it appeared and leave the player no
    // feedback at all during a call they cannot see the end of. The
    // `event.preventDefault()` in the onSelect handler is what stops that, and
    // deleting it is invisible to every other test here — the portal still
    // opens, just silently. Keeping it open is also what makes `disabled`
    // meaningful: it is what stops a second click minting a second session.
    let release: (result: { url: null; reason: 'error' }) => void = () => {}
    openPortal.mockReturnValue(new Promise((resolve) => (release = resolve)))
    render(createElement(AppMenu))
    openMenu()

    clickBilling()

    // `.getAttribute`, not a jest-dom matcher: @testing-library/jest-dom is not
    // installed in this repo. Radix disables a menu item with aria-disabled and
    // data-disabled rather than the `disabled` property, which is a <button>
    // attribute and these are divs with role=menuitem.
    await waitFor(() => {
      const item = screen.getByRole('menuitem', { name: 'Billing' })
      expect(item.getAttribute('aria-disabled')).toBe('true')
    })

    release({ url: null, reason: 'error' })
    await waitFor(() => {
      const item = screen.getByRole('menuitem', { name: 'Billing' })
      expect(item.getAttribute('aria-disabled')).not.toBe('true')
    })
  })
})

describe('Log out ends the session and takes the account state with it', () => {
  const clickLogOut = () => fireEvent.click(screen.getByRole('menuitem', { name: 'Log out' }))

  test('it signs out, clears the cache and lands on the landing', async () => {
    render(createElement(AppMenu))
    openMenu()

    clickLogOut()

    await waitFor(() => expect(signOut).toHaveBeenCalled())
    // THE CACHE CLEAR IS NOT DECORATION. react-query holds the previous
    // account's resolved data keyed by query; without this, signing in as a
    // different account in the same tab paints the old account's name, teams
    // and Pro badge until every watch re-resolves.
    expect(queryClientClear).toHaveBeenCalled()
    // `/` and not `/login`: signing out is not the start of signing in, and it
    // is what v1 does (`router.push('/')`).
    expect(navigate).toHaveBeenCalledWith({ to: '/' })
  })

  test('it drops the selected team and KEEPS the theme', async () => {
    // THE DISTINCTION THIS PINS, AND THE MUTATION IS v1'S OWN CODE. v1 ran a
    // blanket `localStorage.clear()` here. In v2 that key set is not
    // homogeneous: `selectedTeam` is ACCOUNT state and leaving it hands the
    // next account to sign in on this device a `?team=` default belonging to
    // someone else — which app.tsx then fails to resolve and clears via its own
    // error path. `theme` is DEVICE state; wiping it means every sign-out
    // silently resets the user's colour preference, and NOTHING else in this
    // repo would catch that.
    window.localStorage.setItem(SELECTED_TEAM_KEY, 'team_abc')
    window.localStorage.setItem(THEME_STORAGE_KEY, 'dark')
    render(createElement(AppMenu))
    openMenu()

    clickLogOut()

    await waitFor(() => expect(window.localStorage.getItem(SELECTED_TEAM_KEY)).toBeNull())
    expect(window.localStorage.getItem(THEME_STORAGE_KEY)).toBe('dark')
  })

  test('a failed sign-out says so instead of stranding the player', async () => {
    // The session survives a failed signOut, so the honest outcome is a toast
    // and a menu that still works — not a silent no-op, and not a navigation
    // to `/` that would look exactly like success while leaving them signed in.
    signOut.mockRejectedValue(new Error('network'))
    render(createElement(AppMenu))
    openMenu()

    clickLogOut()

    await waitFor(() => expect(toastError).toHaveBeenCalled())
    expect(navigate).not.toHaveBeenCalled()
    expect(queryClientClear).not.toHaveBeenCalled()
  })
})

describe('the theme submenu offers all three modes and persists the choice', () => {
  /**
   * Opens the bar menu, then the Theme submenu inside it, and waits for the
   * submenu to actually mount.
   *
   * IT OPENS ONCE AND POLLS ONLY THE RESULT, WHICH IS NOT A STYLE CHOICE. The
   * first draft put the whole open sequence inside `waitFor`, and it could
   * never pass: the moment the dropdown opens, Radix's focus scope stamps
   * `aria-hidden="true"` on everything outside the menu — the trigger button
   * included — so the retry's `getByRole('button', { name: 'Main menu' })`
   * throws "Unable to find role=button" against a menu that opened correctly
   * the first time. Open exactly once; wait on the thing being waited for.
   *
   * A SUBMENU TRIGGER OPENS ON POINTER MOVE, AND ONLY FOR A MOUSE. Radix wraps
   * that handler in its `whenMouse` guard, so an event without
   * `pointerType: 'mouse'` is ignored and the submenu never mounts.
   */
  const openThemeSubmenu = async () => {
    fireEvent.pointerDown(
      screen.getByRole('button', { name: 'Main menu' }),
      { button: 0, ctrlKey: false, pointerType: 'mouse' },
    )
    fireEvent.pointerMove(screen.getByRole('menuitem', { name: /Theme/ }), {
      pointerType: 'mouse',
    })
    await screen.findByRole('menuitem', { name: 'Light' })
  }

  test('all three modes are offered, not a two-state cycle', async () => {
    // WHY THIS REPLACED THE OLD "Auto" PILL. That control showed the CURRENT
    // mode and its label said nothing about what the next click would produce,
    // so reaching 'dark' from 'auto' meant clicking twice and reading the
    // button in between. A three-way choice is not a toggle.
    render(createElement(AppMenu))
    await openThemeSubmenu()

    expect(screen.queryAllByRole('menuitem').map((item) => item.textContent)).toEqual(
      expect.arrayContaining(['Light', 'Dark', 'System']),
    )
  })

  test('picking a mode writes it under the key the boot script reads', async () => {
    // THE COUPLING THIS PROTECTS. routes/__root.tsx's THEME_INIT_SCRIPT is a
    // stringified inline script that runs before first paint to stop the page
    // flashing the wrong theme, and it CANNOT import from lib/theme.ts — no
    // bundle has executed at that point. So the storage key and the accepted
    // values exist twice, on purpose. Change the key on one side only and the
    // preference silently stops surviving a reload, with nothing else red.
    render(createElement(AppMenu))
    await openThemeSubmenu()

    fireEvent.click(screen.getByRole('menuitem', { name: 'Dark' }))

    await waitFor(() => expect(localStorage.getItem(THEME_STORAGE_KEY)).toBe('dark'))
    expect(document.documentElement.classList.contains('dark')).toBe(true)
    expect(document.documentElement.getAttribute('data-theme')).toBe('dark')
  })

  test("'System' clears data-theme rather than recording a resolved value", async () => {
    // The absence of `data-theme` is what distinguishes "follow the system"
    // from "the system happened to be dark when you chose". Record 'auto' as an
    // attribute value and the next load treats it as an explicit choice.
    //
    // The class is still written — matchMedia is stubbed to `matches: false`
    // above, so 'auto' resolves to light — which is the pair that matters:
    // the MODE is 'auto', the RESOLVED theme is light, and only the former is
    // stored.
    render(createElement(AppMenu))
    await openThemeSubmenu()

    fireEvent.click(screen.getByRole('menuitem', { name: 'System' }))

    await waitFor(() => expect(localStorage.getItem(THEME_STORAGE_KEY)).toBe('auto'))
    expect(document.documentElement.getAttribute('data-theme')).toBeNull()
    expect(document.documentElement.classList.contains('light')).toBe(true)
  })
})

describe('the avatar sits after the menu trigger, ringed, and only for a session', () => {
  /** The ring element, by the data-slot the component stamps on it. */
  const ring = () => document.querySelector('[data-slot="avatar-ring"]')

  test('it renders AFTER the menu trigger in the DOM, not before it', () => {
    // ASSERTED AS DOCUMENT ORDER, NOT AS A CLASS. "To the right of the menu" is
    // what was asked for, and in a plain `flex` row with no `order-*` utility
    // anywhere, DOM order IS visual order — so this is the honest reading of it
    // and it needs no layout engine, which jsdom does not have.
    //
    // The pair was the other way round until now: the old settings/user-menu.tsx
    // rendered the avatar first and the trigger second.
    render(createElement(AppMenu))

    const trigger = screen.getByRole('button', { name: 'Main menu' })
    const avatarRing = ring()
    expect(avatarRing).not.toBeNull()
    // Node.DOCUMENT_POSITION_FOLLOWING === 4: the ring comes after the trigger.
    expect(trigger.compareDocumentPosition(avatarRing!) & 4).toBe(4)
  })

  test('the ring spins for a viewer who has expressed no preference', () => {
    reducedMotion = false
    render(createElement(AppMenu))

    expect(ring()?.className).toContain('avatar-ring-spin')
  })

  test('and STAYS BUT DOES NOT SPIN under prefers-reduced-motion', async () => {
    // BOTH HALVES, AND THE FIRST IS THE ONE THAT DISTINGUISHES THIS FROM THE
    // CONFETTI. ConfettiBurst renders NOTHING for a reduced-motion viewer,
    // because the whole point of the element is the motion. A gradient ring is
    // a visual that happens to turn — taking it away entirely would remove a
    // colour, not a movement — so the element must still be here.
    reducedMotion = true
    render(createElement(AppMenu))

    // The hook starts at `true` and corrects in an effect, so the relaxed case
    // needs a tick; this one is already at its final value, but it is awaited
    // the same way so the two tests cannot pass for different reasons.
    await waitFor(() => expect(ring()).not.toBeNull())
    expect(ring()?.className).not.toContain('avatar-ring-spin')
  })

  test('THE GRADIENT IS BRAND TOKENS, NOT RAW TAILWIND GREENS', () => {
    // v1 hardcodes `from-green-600 via-green-500 to-yellow-400` plus a `dark:`
    // variant of the same three stops, because its colours cannot fork by
    // theme. styles.css rule 1 — "no Tailwind colour utility in a component; a
    // raw green-600 outside this file is a missing token" — is what this pins,
    // and porting v1's classes verbatim is the obvious way to break it.
    render(createElement(AppMenu))

    const className = ring()?.className ?? ''
    expect(className).toContain('from-brand-from')
    expect(className).toContain('via-brand-via')
    expect(className).toContain('to-brand-to')
    expect(className).not.toMatch(/green-\d|yellow-\d/)
  })

  test('a signed-out visitor gets NO avatar at all, ring included', () => {
    // A REGRESSION FIXED HERE RATHER THAN A BEHAVIOUR PORTED. wordle-teams-lyab
    // made this component render for signed-out visitors — the nav and theme
    // control live in it — and the avatar came along with it. `initialsFor`
    // answers null with no name and no email, so /login and /about were showing
    // a stranger an empty grey circle with a generic person icon, and this
    // issue would have wrapped a spinning brand halo around it.
    isAuthenticated = false
    render(createElement(AppMenu))

    expect(ring()).toBeNull()
    // And the menu itself is still there, which is the half that must NOT
    // regress in the course of fixing this.
    expect(screen.queryByRole('button', { name: 'Main menu' })).not.toBeNull()
  })

  test('the avatar is not interactive — the hamburger is the only control', () => {
    // v1 makes the ringed avatar itself the trigger and users were not finding
    // it: an animated halo reads as a badge, not a control. Giving the ring
    // back must not quietly give the click target back with it, so the bar's
    // button count is pinned — one trigger, not two.
    render(createElement(AppMenu))

    expect(screen.queryAllByRole('button').map((b) => b.getAttribute('aria-label'))).toEqual([
      'Main menu',
    ])
    expect(ring()?.closest('button')).toBeNull()
  })
})
