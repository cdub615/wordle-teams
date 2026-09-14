// @vitest-environment jsdom
//
// jsdom rather than the suite's default edge-runtime (vitest.config.ts),
// because this renders the real component through @testing-library/react.
// `.hook.test.ts` matches the siblings (notifications-tab, profile-tab) — and
// `.test.ts` rather than `.test.tsx` because vitest.config.ts's glob is
// `src/**/*.test.ts`, so every element goes through `createElement` by hand.
//
// WHAT THIS FILE IS REALLY FOR: this tab is the first place in the app where a
// passkey can be created, and the WebAuthn ceremony at the middle of it cannot
// run in any test runner. Everything AROUND the ceremony can, and that is where
// the mistakes live — marking the device before checking whether registration
// actually succeeded, scolding a player for cancelling, putting a confirmation
// in front of a removal that is not dangerous, or announcing four identical
// "Remove" buttons.
//
// `#/lib/passkey.ts` IS ONLY PARTIALLY MOCKED, and that is deliberate.
// `rememberPasskeyRegistered` is replaced so the per-device write can be
// observed; `passkeySupported` is left REAL, so the support gate is driven by
// installing and removing `window.PublicKeyCredential` exactly as a browser
// would present it, rather than by a boolean this file makes up.
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { createElement } from 'react'
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'
import SecurityTab, { addedLabel, passkeyLabel, removeLabel } from './security-tab.tsx'

const {
  addPasskeyMock,
  deletePasskeyMock,
  rememberRegisteredMock,
  forgetRegisteredMock,
  toastSuccess,
  toastError,
} = vi.hoisted(() => ({
  addPasskeyMock: vi.fn(),
  deletePasskeyMock: vi.fn(),
  rememberRegisteredMock: vi.fn(),
  forgetRegisteredMock: vi.fn(),
  toastSuccess: vi.fn(),
  toastError: vi.fn(),
}))

/** What `authClient.useListPasskeys()` answers. Set per test. */
let listState: {
  data: Array<{ id: string; name?: string | null; createdAt?: Date | string | null }> | null
  error: unknown
  isPending: boolean
}

vi.mock('#/lib/auth-client.ts', () => ({
  authClient: {
    useListPasskeys: () => listState,
    passkey: { addPasskey: addPasskeyMock, deletePasskey: deletePasskeyMock },
  },
}))

vi.mock('#/lib/passkey.ts', async (importOriginal) => ({
  ...(await importOriginal<typeof import('#/lib/passkey.ts')>()),
  rememberPasskeyRegistered: rememberRegisteredMock,
  forgetPasskeyRegistered: forgetRegisteredMock,
}))

vi.mock('sonner', () => ({ toast: { success: toastSuccess, error: toastError } }))

// MOCKED SO THE PRE-HYDRATION FRAME IS REACHABLE AT ALL. The real hook flips in
// a passive effect, which @testing-library flushes inside `render` — so under
// the real one every test here would see `true` and the branch that exists to
// stop a flash of "This browser can't use passkeys" could never be executed.
// Its own semantics are not this file's business.
let hydrated = true
vi.mock('#/lib/use-hydrated.ts', () => ({ useHydrated: () => hydrated }))

const supportWebAuthn = () =>
  Object.defineProperty(window, 'PublicKeyCredential', {
    configurable: true,
    value: function PublicKeyCredential() {},
  })

const unsupportWebAuthn = () => Reflect.deleteProperty(window, 'PublicKeyCredential')

const mount = () => render(createElement(SecurityTab))

beforeEach(() => {
  vi.clearAllMocks()
  hydrated = true
  // The ordinary case, so every test that is not ABOUT the support gate gets a
  // browser that can do WebAuthn. jsdom implements none of it, so this is the
  // state that has to be built.
  supportWebAuthn()
  addPasskeyMock.mockResolvedValue({ data: { id: 'pk_new' }, error: null })
  deletePasskeyMock.mockResolvedValue({ data: { status: true }, error: null })
  listState = { data: [], error: null, isPending: false }
})

afterEach(() => {
  cleanup()
  unsupportWebAuthn()
})

describe('the two label helpers', () => {
  test('a passkey with no name falls back to a generic one', () => {
    // NO LONGER THE ONLY CASE, AND STILL NOT AN EDGE (wordle-teams-wty4.1.7.9).
    // This used to be the only thing that happened: the plugin stores only a
    // name the CLIENT sends and nothing in the app sent one. `lib/register-
    // passkey.ts` now sends `deviceName()`, so new rows carry real names — but
    // two populations still land here and neither is going away. Credentials
    // registered BEFORE that change are never backfilled, and `deviceName()`
    // deliberately returns `undefined` for a browser it cannot read rather than
    // inventing a label.
    expect(passkeyLabel(null)).toBe('Passkey')
    expect(passkeyLabel(undefined)).toBe('Passkey')
    expect(passkeyLabel('   ')).toBe('Passkey')
  })

  test('a named passkey keeps its own name', () => {
    // Paired with the test above: on its own, that one passes for a function
    // that returns 'Passkey' unconditionally. The second string is the shape
    // this app now actually writes — lib/device-name.ts's output — rather than
    // one invented for the test.
    expect(passkeyLabel('Ada’s phone')).toBe('Ada’s phone')
    expect(passkeyLabel('Chrome on macOS')).toBe('Chrome on macOS')
  })

  test('a date becomes an "Added …" line', () => {
    // Built from local components rather than an instant, so the assertion does
    // not quietly depend on the host time zone — CI runs UTC and this machine
    // does not.
    expect(addedLabel(new Date(2026, 8, 13), 'en-US')).toBe('Added Sep 13, 2026')
  })

  test('the remove action names the row by DATE as well, for the rows with no name', () => {
    /**
     * THE ASSERTION THIS FILE USED TO GET WRONG, AND THE REASON IT IS STILL
     * WRITTEN THIS WAY. An even earlier version proved the accessible name
     * distinguished rows by feeding it 'Ada's phone' and 'Work laptop' — names
     * this app could not then produce at all, so it was green on data that did
     * not occur.
     *
     * wordle-teams-wty4.1.7.9 MADE THOSE NAMES PRODUCIBLE — see the test below,
     * which now feeds the real thing — BUT DID NOT MAKE THIS CASE STALE. A
     * nameless row is still what a pre-change credential and an unreadable
     * browser produce, and the date is the only thing left to tell two of them
     * apart.
     */
    expect(removeLabel(null, new Date(2026, 8, 13), 'en-US')).toBe('Remove Passkey, added Sep 13, 2026')
    expect(removeLabel(undefined, new Date(2026, 0, 2), 'en-US')).toBe('Remove Passkey, added Jan 2, 2026')
  })

  test('the date stays in the name even when the rows ARE named, and here is why', () => {
    /**
     * THE MUTATION THIS KILLS: dropping the date from `removeLabel` now that
     * `deviceName()` supplies a real one. It looks like a tidy-up and it
     * reintroduces exactly the defect this helper was written for — because the
     * one case no naming scheme can ever fix is two credentials created from
     * the SAME browser on the SAME device, which is what a player holding both
     * a platform authenticator and a security key has. Their labels are
     * identical by construction; the date is all there is.
     */
    const platform = removeLabel('Chrome on macOS', new Date(2026, 8, 13), 'en-US')
    const securityKey = removeLabel('Chrome on macOS', new Date(2026, 0, 2), 'en-US')
    expect(platform).toBe('Remove Chrome on macOS, added Sep 13, 2026')
    expect(platform).not.toBe(securityKey)
  })

  test('two unnamed passkeys still get DIFFERENT remove labels', () => {
    // The whole point, stated as the property rather than as two strings: with
    // no name and no date there is nothing left to tell them apart.
    const a = removeLabel(null, new Date(2026, 8, 13), 'en-US')
    const b = removeLabel(null, new Date(2026, 0, 2), 'en-US')
    expect(a).not.toBe(b)
  })

  test('a named passkey uses its name, and a dateless one still gets a label', () => {
    expect(removeLabel('Ada’s phone', new Date(2026, 8, 13), 'en-US')).toBe(
      'Remove Ada’s phone, added Sep 13, 2026',
    )
    // Never "Remove undefined". Close to unreachable — the plugin writes
    // createdAt on every insert — but ambiguous beats wrong.
    expect(removeLabel(null, undefined)).toBe('Remove Passkey')
  })

  test('an unusable date becomes nothing at all, not "Invalid Date"', () => {
    // `new Date(undefined)` stringifies to "Invalid Date", and a settings row
    // reading "Added Invalid Date" is worse than a row with one line.
    expect(addedLabel(undefined)).toBeNull()
    expect(addedLabel(null)).toBeNull()
    expect(addedLabel('not a date')).toBeNull()
  })
})

describe('the list of passkeys', () => {
  test('a loading list is a spinner, NOT "you have none"', () => {
    /**
     * THE MUTATION THIS KILLS: deciding list-vs-empty on `data` alone. The atom
     * starts at `{ data: null, isPending: true }`, so every player on a cold
     * open would be told, as a statement of fact, that they have no passkeys —
     * and then watch it change its mind.
     */
    listState = { data: null, error: null, isPending: true }
    mount()
    expect(screen.queryByText(/no passkeys/i)).toBeNull()
    expect(screen.queryByText(/Loading your passkeys/i)).not.toBeNull()
  })

  test('a settled empty list says so', () => {
    mount()
    expect(screen.queryByText(/no passkeys/i)).not.toBeNull()
  })

  test('a failed load says so rather than claiming there are none', () => {
    // "You have no passkeys" in front of someone who has three is a lie that
    // invites them to register a fourth.
    listState = { data: null, error: new Error('nope'), isPending: false }
    mount()
    expect(screen.queryByText(/Could not load your passkeys/i)).not.toBeNull()
    expect(screen.queryByText(/no passkeys/i)).toBeNull()
  })

  test('every passkey gets a row, with its label and when it was added', () => {
    // BOTH ROWS UNNAMED, which is what this app produced before
    // wordle-teams-wty4.1.7.9 and what a pre-change credential still looks
    // like. Kept as the unnamed case ON PURPOSE: a fixture with distinct names
    // makes every row trivially distinguishable and hides the thing worth
    // testing. The named case gets its own test below, now that it exists.
    listState = {
      data: [
        { id: 'pk_1', name: null, createdAt: new Date(2026, 8, 13) },
        { id: 'pk_2', name: null, createdAt: new Date(2026, 0, 2) },
      ],
      error: null,
      isPending: false,
    }
    mount()
    // STRUCTURAL FIRST: without this, every `queryByText` below could be
    // matching in a tree that rendered no rows at all and the count assertion
    // would be the only thing that noticed.
    expect(screen.getAllByRole('listitem')).toHaveLength(2)
    expect(screen.getAllByText('Passkey')).toHaveLength(2)
    // COUNTED, NOT MATCHED ONCE, and the prefix is this component's own literal
    // rather than a formatted date: the format follows the READER's locale, so
    // asserting 'Sep 13, 2026' here would pin the machine the suite runs on.
    // The exact rendering is pinned once, with an explicit locale, up in the
    // `addedLabel` test.
    expect(screen.getAllByText(/^Added /)).toHaveLength(2)
  })

  test('each remove button names the row it removes, on data this app can produce', () => {
    /**
     * THE MUTATION THIS KILLS: an accessible name built from the label alone.
     * Every real row's label is the bare word 'Passkey', so that button is
     * announced as "Remove Passkey" once per credential and a screen-reader
     * user cannot tell which one they are about to destroy.
     *
     * THE EXPECTED STRINGS COME FROM `removeLabel` RATHER THAN BEING TYPED OUT,
     * because the date follows the READER's locale and typing it here would pin
     * the machine the suite runs on. The FORMAT is pinned once, with an explicit
     * locale, up in the helper tests. What this pins is that the button uses
     * that label, for THIS row's data — and the two guards below stop it passing
     * over a helper that returned the same string, or nothing, for both.
     */
    listState = {
      data: [
        { id: 'pk_1', name: null, createdAt: new Date(2026, 8, 13) },
        { id: 'pk_2', name: null, createdAt: new Date(2026, 0, 2) },
      ],
      error: null,
      isPending: false,
    }
    const first = removeLabel(null, new Date(2026, 8, 13))
    const second = removeLabel(null, new Date(2026, 0, 2))
    expect(first).toMatch(/^Remove /)
    expect(first).not.toBe(second)
    mount()
    expect(screen.queryByRole('button', { name: first })).not.toBeNull()
    expect(screen.queryByRole('button', { name: second })).not.toBeNull()
  })

  test('a phone and a laptop are told apart BY NAME, which is the whole point', () => {
    /**
     * THE ISSUE'S OWN "DONE WHEN" (wordle-teams-wty4.1.7.9): two passkeys
     * registered from different devices are distinguishable in the Security tab
     * WITHOUT READING DATES. Every other test in this file deliberately feeds
     * `name: null`, because that was all the app could produce and a named
     * fixture would have been green on data that did not occur — see the
     * `removeLabel` tests above. `lib/register-passkey.ts` now sends
     * `deviceName()`, so these two strings are the real thing, and this is the
     * test that fails if that call site ever loses its argument again.
     *
     * BOTH DATES ARE THE SAME, WHICH IS THE LOAD-BEARING PART. It is what makes
     * the name the only thing distinguishing the two rows — so this cannot pass
     * over a component that ignores `name` and leans on "Added …", which is
     * exactly what it did before.
     */
    const sameDay = new Date(2026, 8, 13)
    listState = {
      data: [
        { id: 'pk_1', name: 'Chrome on macOS', createdAt: sameDay },
        { id: 'pk_2', name: 'Safari on iOS', createdAt: sameDay },
      ],
      error: null,
      isPending: false,
    }
    mount()

    // STRUCTURAL FIRST, as everywhere else here: without it the queries below
    // could be matching in a tree that rendered no rows at all.
    expect(screen.getAllByRole('listitem')).toHaveLength(2)
    // VISIBLY. The generic fallback must be nowhere on the tab.
    expect(screen.queryByText('Chrome on macOS')).not.toBeNull()
    expect(screen.queryByText('Safari on iOS')).not.toBeNull()
    expect(screen.queryByText('Passkey')).toBeNull()
    // AND TO A SCREEN READER, which is the half with no visual fallback at all.
    // ANCHORED ON THE NAME AND NOT ON THE DATE THAT FOLLOWS IT, so this test
    // speaks only to `name`; `removeLabel`'s own tests above are what pin the
    // "added …" half.
    expect(screen.queryByRole('button', { name: /^Remove Chrome on macOS/ })).not.toBeNull()
    expect(screen.queryByRole('button', { name: /^Remove Safari on iOS/ })).not.toBeNull()
  })

  test('a failed REFETCH keeps the rows it already has', () => {
    /**
     * THE BUG THIS KILLS, and it is reachable on the ordinary happy path.
     * better-auth's `onError` preserves `data` for anything that is not a 401
     * (`query.mjs`: `data: isUnauthorized ? null : value.get().data`), and a
     * successful DELETE triggers a refetch — an unattended request, straight
     * after a write, which is the one most likely to fail here. A bare `error`
     * check swaps a still-valid list of the player's passkeys for the line
     * "Could not load your passkeys."
     */
    listState = {
      data: [{ id: 'pk_1', name: null, createdAt: new Date(2026, 8, 13) }],
      error: new Error('refetch failed'),
      isPending: false,
    }
    mount()
    expect(screen.getAllByRole('listitem')).toHaveLength(1)
    expect(screen.queryByText(/Could not load your passkeys/i)).toBeNull()
  })
})

describe('adding a passkey', () => {
  test('registers, marks THIS DEVICE, and says so', async () => {
    mount()
    fireEvent.click(screen.getByRole('button', { name: /Add a passkey/i }))
    await waitFor(() => expect(addPasskeyMock).toHaveBeenCalled())
    await waitFor(() => expect(rememberRegisteredMock).toHaveBeenCalled())
    expect(toastSuccess).toHaveBeenCalled()
  })

  test('does NOT mark the device when registration failed', async () => {
    /**
     * THE MUTATION THIS KILLS, and the worst bug available in this file:
     * writing the marker before (or instead of) checking `result.error`.
     * `addPasskey` NEVER REJECTS — it resolves to `{ data: null, error }` for
     * every failure including an aborted ceremony — so a bare `await` inside a
     * `try` reads every one of them as a success. The device is then recorded
     * as holding a passkey it does not hold, which permanently suppresses the
     * post-login offer on exactly that device, with no symptom.
     */
    addPasskeyMock.mockResolvedValue({
      data: null,
      error: { code: 'FAILED_TO_VERIFY_REGISTRATION', message: 'Failed to verify registration' },
    })
    mount()
    fireEvent.click(screen.getByRole('button', { name: /Add a passkey/i }))
    await waitFor(() => expect(toastError).toHaveBeenCalled())
    expect(rememberRegisteredMock).not.toHaveBeenCalled()
    expect(toastSuccess).not.toHaveBeenCalled()
  })

  /**
   * THE MUTATION THESE KILL: narrowing `registerPasskey`'s aborted branch back
   * to `ERROR_CEREMONY_ABORTED` alone, and toasting everything else alike.
   * Dismissing the sheet is how a player says "not now" — an error toast there
   * scolds someone for pressing the cancel button the browser itself drew.
   *
   * THIS TEST WAS GREEN FOR THE WRONG REASON UNTIL wordle-teams-wty4.1.7.11. It
   * fed `ERROR_CEREMONY_ABORTED` — the ABORT SIGNAL, raised when a second
   * ceremony cancels the first — and called it "the player cancels". A real
   * Cancel raises `NotAllowedError`, which `identifyRegistrationError` passes
   * through as `ERROR_PASSTHROUGH_SEE_CAUSE_PROPERTY` (see
   * lib/register-passkey.ts), so the path an actual player takes was untested
   * here and shipped broken: an error toast carrying the platform's own
   * sentence. The first row is that path. The second is kept because the abort
   * signal is real too, just not what the Cancel button produces.
   *
   * DRIVEN THROUGH THE REAL CLASSIFIER, which is this file's value over
   * lib/register-passkey.test.ts: `addPasskey` is the mock, so the plugin error
   * shape travels through `registerPasskey` and into the tab's toasting exactly
   * as it does in a browser.
   */
  test.each([
    [
      'ERROR_PASSTHROUGH_SEE_CAUSE_PROPERTY',
      'The operation either timed out or was not allowed. See: https://www.w3.org/TR/webauthn-2/#sctn-privacy-considerations-client.',
    ],
    ['ERROR_CEREMONY_ABORTED', 'Registration cancelled'],
  ])('says nothing at all when the system sheet closes empty (%s)', async (code, message) => {
    /**
     * A DEFERRED PROMISE, AND IT IS THE VACUITY GUARD RATHER THAN a flourish.
     * Every assertion at the end of this test is a NEGATIVE one, and a negative
     * assertion is satisfied by a handler that simply has not got there yet: a
     * click still in flight has toasted nothing either. Releasing the mock by
     * hand pins both edges — the button going dead proves the handler entered,
     * the button coming back proves its `finally` ran — so "nothing was said"
     * is measured against a handler that has demonstrably FINISHED.
     */
    let release: (value: unknown) => void = () => {}
    addPasskeyMock.mockReturnValue(new Promise((resolve) => (release = resolve)))
    mount()
    const button = screen.getByRole('button', { name: /Add a passkey/i }) as HTMLButtonElement
    fireEvent.click(button)
    await waitFor(() => expect(button.disabled).toBe(true))
    release({ data: null, error: { code, message } })
    await waitFor(() => expect(button.disabled).toBe(false))
    expect(toastError).not.toHaveBeenCalled()
    expect(toastSuccess).not.toHaveBeenCalled()
    expect(rememberRegisteredMock).not.toHaveBeenCalled()
  })

  test('the button is dead while the system sheet is open', async () => {
    /**
     * THE MUTATION THIS KILLS: leaving the Add button live during the ceremony.
     * A WebAuthn prompt is a MODAL system sheet that can stay open for as long
     * as the player takes to find a finger, and nothing in any query cache
     * knows it is up — so without the local flag a second press starts a second
     * ceremony behind the first.
     *
     * A DEFERRED PROMISE, not a resolved one: the in-flight window is the only
     * thing under test here, and a mock that has already settled by the time
     * the click returns has no in-flight window at all.
     */
    let release: (value: unknown) => void = () => {}
    addPasskeyMock.mockReturnValue(new Promise((resolve) => (release = resolve)))
    mount()
    const button = screen.getByRole('button', { name: /Add a passkey/i }) as HTMLButtonElement
    expect(button.disabled).toBe(false)
    fireEvent.click(button)
    await waitFor(() => expect(button.disabled).toBe(true))
    release({ data: { id: 'pk_new' }, error: null })
    // AND IT COMES BACK. A `finally` that never runs is a tab that can add
    // exactly one passkey per open.
    await waitFor(() => expect(button.disabled).toBe(false))
  })

  test('a PREVIOUSLY REGISTERED rejection MARKS the device, because it is proof', async () => {
    /**
     * THE MUTATION THIS KILLS, and it is the mirror image of the one above.
     * `ERROR_AUTHENTICATOR_PREVIOUSLY_REGISTERED` is the authenticator refusing
     * BECAUSE IT ALREADY HOLDS a credential for this relying party — the exact
     * fact the marker records, arriving as a rejection. Treating it as a plain
     * failure leaves a device whose storage was cleared (new browser profile,
     * cleared site data) nagging to register at every single sign-in, forever,
     * with no way for the player to stop it: the loop passkey.ts's header
     * claims to rule out.
     */
    addPasskeyMock.mockResolvedValue({
      data: null,
      error: { code: 'ERROR_AUTHENTICATOR_PREVIOUSLY_REGISTERED', message: 'Previously registered' },
    })
    mount()
    fireEvent.click(screen.getByRole('button', { name: /Add a passkey/i }))
    await waitFor(() => expect(rememberRegisteredMock).toHaveBeenCalled())
    // AND IT SAYS SOMETHING USEFUL. The plugin's own message is "Previously
    // registered", which tells the player nothing they can act on.
    expect(toastError).toHaveBeenCalledWith('This device already has a passkey on your account.')
    expect(toastSuccess).not.toHaveBeenCalled()
  })

  test('a rejection from the layer underneath is reported, not thrown', async () => {
    // `addPasskey` itself does not reject; the fetch under it can.
    addPasskeyMock.mockRejectedValue(new Error('offline'))
    mount()
    fireEvent.click(screen.getByRole('button', { name: /Add a passkey/i }))
    await waitFor(() => expect(toastError).toHaveBeenCalled())
    expect(rememberRegisteredMock).not.toHaveBeenCalled()
  })
})

describe('removing a passkey', () => {
  // Unnamed, dated rows — what this app actually stores. `ONE` and `TWO` are
  // the accessible names those rows really get.
  const FIRST_AT = new Date(2026, 8, 13)
  const SECOND_AT = new Date(2026, 0, 2)
  const ONE = removeLabel(null, FIRST_AT)
  const TWO = removeLabel(null, SECOND_AT)

  beforeEach(() => {
    listState = {
      data: [{ id: 'pk_1', name: null, createdAt: FIRST_AT }],
      error: null,
      isPending: false,
    }
  })

  test('removes THE ROW THAT WAS CLICKED, by id', async () => {
    expect(ONE).not.toBe(TWO)
    listState.data = [
      { id: 'pk_1', name: null, createdAt: FIRST_AT },
      { id: 'pk_2', name: null, createdAt: SECOND_AT },
    ]
    mount()
    fireEvent.click(screen.getByRole('button', { name: TWO }))
    await waitFor(() => expect(deletePasskeyMock).toHaveBeenCalledWith({ id: 'pk_2' }))
    expect(toastSuccess).toHaveBeenCalled()
  })

  test('the LAST passkey goes on a single click, with no confirmation gate', async () => {
    /**
     * A DELIBERATE ABSENCE, pinned so nobody adds one back "to be safe". Email
     * OTP and all four social providers are untouched by this feature, so no
     * sequence of removals here can lock anyone out of anything — a
     * confirmation would imply a danger that does not exist.
     *
     * BOTH HALVES MATTER: the role check alone would pass if the button did
     * nothing at all, and the call check alone would pass if a confirmation had
     * been added and auto-confirmed.
     *
     * `dialog` AS WELL AS `alertdialog`, AND AFTER `mount()` RATHER THAN BEFORE.
     * The baseline used to be taken against an EMPTY DOCUMENT, where it is true
     * of everything and proves nothing. And this repo's own confirmation
     * primitive is `src/components/confirm-popover.tsx`, a Radix Popover — role
     * `dialog`, not `alertdialog` — so the most likely way this gate comes back
     * is with the component already to hand, which an `alertdialog`-only query
     * would sail straight past.
     */
    mount()
    const roles = () => [...screen.queryAllByRole('alertdialog'), ...screen.queryAllByRole('dialog')]
    expect(roles()).toHaveLength(0)
    fireEvent.click(screen.getByRole('button', { name: ONE }))
    await waitFor(() => expect(deletePasskeyMock).toHaveBeenCalledWith({ id: 'pk_1' }))
    expect(roles()).toHaveLength(0)
  })

  test('a removal in flight freezes EVERY row, and only the clicked one spins', async () => {
    /**
     * TWO MUTATIONS AT ONCE. Dropping `disabled={removingId !== null}` lets two
     * removals race against one list that refetches under both of them; making
     * the spinner unconditional (or never shown) leaves the player with no sign
     * that the press registered at all, on the slowest action in the tab.
     *
     * `removingId !== null` RATHER THAN `=== passkey.id` FOR THE DISABLING, and
     * that asymmetry is the point: every button freezes, one button spins.
     */
    listState.data = [
      { id: 'pk_1', name: null, createdAt: FIRST_AT },
      { id: 'pk_2', name: null, createdAt: SECOND_AT },
    ]
    let release: (value: unknown) => void = () => {}
    deletePasskeyMock.mockReturnValue(new Promise((resolve) => (release = resolve)))
    mount()
    const target = screen.getByRole('button', { name: ONE }) as HTMLButtonElement
    const other = screen.getByRole('button', { name: TWO }) as HTMLButtonElement
    expect(target.disabled).toBe(false)
    fireEvent.click(target)
    await waitFor(() => expect(target.disabled).toBe(true))
    expect(other.disabled).toBe(true)
    // `aria-busy`, NOT `.animate-spin`. Pinning the Tailwind class couples this
    // to a styling choice — a behaviourally identical spinner swap would break
    // it — and, worse, it asserts on the half a screen reader cannot perceive.
    // This is the announcement; the spinner is the decoration.
    expect(target.getAttribute('aria-busy')).toBe('true')
    expect(other.getAttribute('aria-busy')).toBe('false')
    release({ data: { status: true }, error: null })
    await waitFor(() => expect(other.disabled).toBe(false))
    expect(target.getAttribute('aria-busy')).toBe('false')
  })

  test('removing the LAST passkey forgets the per-device marker', async () => {
    /**
     * THE MUTATION THIS KILLS: leaving the marker set after the account is
     * empty. Zero passkeys on the account means zero on this device, so the
     * marker is now a lie — and /login (Task 4) renders its passkey button off
     * exactly this, producing a tap that opens a system sheet saying no
     * passkeys were found.
     */
    mount()
    fireEvent.click(screen.getByRole('button', { name: ONE }))
    await waitFor(() => expect(forgetRegisteredMock).toHaveBeenCalled())
    expect(rememberRegisteredMock).not.toHaveBeenCalled()
  })

  test('removing ONE OF TWO leaves the marker alone', async () => {
    /**
     * THE OPPOSITE MUTATION, and it matters just as much: clearing on every
     * removal. Nothing on a passkey row says which authenticator it belongs to,
     * so a shorter list is no evidence about the device in front of us — and it
     * probably does still hold one. Clearing here would put the offer back in
     * front of a player who is already set up.
     */
    listState.data = [
      { id: 'pk_1', name: null, createdAt: FIRST_AT },
      { id: 'pk_2', name: null, createdAt: SECOND_AT },
    ]
    mount()
    fireEvent.click(screen.getByRole('button', { name: TWO }))
    await waitFor(() => expect(toastSuccess).toHaveBeenCalled())
    expect(forgetRegisteredMock).not.toHaveBeenCalled()
  })

  test('a FAILED removal of the last passkey does not forget anything', async () => {
    // The credential is still there. Forgetting on the way past would re-offer
    // a passkey to a device that already holds one.
    deletePasskeyMock.mockResolvedValue({ data: null, error: { message: 'Passkey not found' } })
    mount()
    fireEvent.click(screen.getByRole('button', { name: ONE }))
    await waitFor(() => expect(toastError).toHaveBeenCalled())
    expect(forgetRegisteredMock).not.toHaveBeenCalled()
  })

  test('a refusal is reported rather than silently succeeding', async () => {
    deletePasskeyMock.mockResolvedValue({ data: null, error: { message: 'Passkey not found' } })
    mount()
    fireEvent.click(screen.getByRole('button', { name: ONE }))
    await waitFor(() => expect(toastError).toHaveBeenCalled())
    expect(toastSuccess).not.toHaveBeenCalled()
  })

  test('a rejection is reported rather than crashing the tab', async () => {
    // The inferred-endpoint proxy's return type is `any`, so nothing pins
    // whether it throws or answers `{ error }`. Both are handled.
    deletePasskeyMock.mockRejectedValue(new Error('offline'))
    mount()
    fireEvent.click(screen.getByRole('button', { name: ONE }))
    await waitFor(() => expect(toastError).toHaveBeenCalled())
    expect(toastSuccess).not.toHaveBeenCalled()
  })
})

describe('a browser that cannot do WebAuthn', () => {
  test('is told so, and is not shown a button that cannot work', () => {
    /**
     * THE MUTATION THIS KILLS: rendering the Add button unconditionally. It
     * opens nothing on a browser with no WebAuthn, so the player presses it,
     * nothing happens, and they conclude the app is broken.
     */
    unsupportWebAuthn()
    mount()
    expect(screen.queryByRole('button', { name: /Add a passkey/i })).toBeNull()
    expect(screen.queryByText(/can’t use passkeys/i)).not.toBeNull()
    // AND IT SAYS WHAT STILL WORKS. The hard constraint of this whole feature
    // is that nothing was taken away; a dead end that does not say so reads
    // like something was.
    expect(screen.queryByText(/email code/i)).not.toBeNull()
  })

  test('says NEITHER thing until the page has hydrated', () => {
    /**
     * THE MUTATION THIS KILLS: folding the hydration check into `supported`, so
     * that "not yet hydrated" renders the unsupported branch. That is the tidier
     * line, and it shows every player on a perfectly capable browser the single
     * most alarming sentence on the tab for one frame before taking it back.
     * Rendering nothing for that frame is invisible.
     */
    hydrated = false
    mount()
    expect(screen.queryByRole('button', { name: /Add a passkey/i })).toBeNull()
    expect(screen.queryByText(/can’t use passkeys/i)).toBeNull()
    // STRUCTURAL: without this the two assertions above would both pass over a
    // component that crashed or rendered nothing at all.
    expect(screen.queryByText(/no passkeys on this account/i)).not.toBeNull()
  })

  test('a browser that CAN gets the button and none of that copy', () => {
    // Paired with the test above, which on its own passes for a tab that never
    // renders an Add button at all.
    mount()
    expect(screen.queryByRole('button', { name: /Add a passkey/i })).not.toBeNull()
    expect(screen.queryByText(/can’t use passkeys/i)).toBeNull()
  })
})
