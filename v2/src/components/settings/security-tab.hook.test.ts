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
import SecurityTab, { addedLabel, passkeyLabel } from './security-tab.tsx'

const { addPasskeyMock, deletePasskeyMock, rememberRegisteredMock, toastSuccess, toastError } =
  vi.hoisted(() => ({
    addPasskeyMock: vi.fn(),
    deletePasskeyMock: vi.fn(),
    rememberRegisteredMock: vi.fn(),
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
    // THE NORMAL CASE, not an edge: the plugin only stores a name when the
    // CLIENT sends one at registration, and this tab sends none.
    expect(passkeyLabel(null)).toBe('Passkey')
    expect(passkeyLabel(undefined)).toBe('Passkey')
    expect(passkeyLabel('   ')).toBe('Passkey')
  })

  test('a named passkey keeps its own name', () => {
    // Paired with the test above: on its own, that one passes for a function
    // that returns 'Passkey' unconditionally.
    expect(passkeyLabel('Ada’s phone')).toBe('Ada’s phone')
  })

  test('a date becomes an "Added …" line', () => {
    // Built from local components rather than an instant, so the assertion does
    // not quietly depend on the host time zone — CI runs UTC and this machine
    // does not.
    expect(addedLabel(new Date(2026, 8, 13), 'en-US')).toBe('Added Sep 13, 2026')
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

  test('every passkey gets a row, with its name and when it was added', () => {
    listState = {
      data: [
        { id: 'pk_1', name: 'Ada’s phone', createdAt: new Date(2026, 8, 13) },
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
    expect(screen.queryByText('Ada’s phone')).not.toBeNull()
    expect(screen.queryByText('Passkey')).not.toBeNull()
    // COUNTED, NOT MATCHED ONCE, and the prefix is this component's own literal
    // rather than a formatted date: the format follows the READER's locale, so
    // asserting 'Sep 13, 2026' here would pin the machine the suite runs on.
    // The exact rendering is pinned once, with an explicit locale, up in the
    // `addedLabel` test.
    expect(screen.getAllByText(/^Added /)).toHaveLength(2)
  })

  test('each remove button names the row it removes', () => {
    /**
     * THE MUTATION THIS KILLS: an icon-only button whose accessible name is
     * just "Remove". Three near-identical rows then announce the same thing
     * three times over, and a screen-reader user has no way to tell which
     * credential they are about to destroy.
     */
    listState = {
      data: [
        { id: 'pk_1', name: 'Ada’s phone', createdAt: new Date(2026, 8, 13) },
        { id: 'pk_2', name: 'Work laptop', createdAt: new Date(2026, 0, 2) },
      ],
      error: null,
      isPending: false,
    }
    mount()
    expect(screen.queryByRole('button', { name: 'Remove Ada’s phone' })).not.toBeNull()
    expect(screen.queryByRole('button', { name: 'Remove Work laptop' })).not.toBeNull()
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

  test('says nothing at all when the player cancels the system sheet', async () => {
    /**
     * THE MUTATION THIS KILLS: dropping the ERROR_CEREMONY_ABORTED branch and
     * toasting every error alike. Dismissing the sheet is how a player says
     * "not now" — an error toast there scolds someone for pressing the cancel
     * button the browser itself drew.
     */
    addPasskeyMock.mockResolvedValue({
      data: null,
      error: { code: 'ERROR_CEREMONY_ABORTED', message: 'Registration cancelled' },
    })
    mount()
    fireEvent.click(screen.getByRole('button', { name: /Add a passkey/i }))
    await waitFor(() => expect(addPasskeyMock).toHaveBeenCalled())
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
  beforeEach(() => {
    listState = {
      data: [{ id: 'pk_1', name: 'Ada’s phone', createdAt: new Date(2026, 8, 13) }],
      error: null,
      isPending: false,
    }
  })

  test('removes THE ROW THAT WAS CLICKED, by id', async () => {
    listState.data = [
      { id: 'pk_1', name: 'Ada’s phone', createdAt: new Date(2026, 8, 13) },
      { id: 'pk_2', name: 'Work laptop', createdAt: new Date(2026, 0, 2) },
    ]
    mount()
    fireEvent.click(screen.getByRole('button', { name: 'Remove Work laptop' }))
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
     * BOTH HALVES MATTER: the dialog check alone would pass if the button did
     * nothing at all, and the call check alone would pass if a confirmation had
     * been added and auto-confirmed.
     */
    expect(screen.queryByRole('alertdialog')).toBeNull()
    mount()
    fireEvent.click(screen.getByRole('button', { name: 'Remove Ada’s phone' }))
    await waitFor(() => expect(deletePasskeyMock).toHaveBeenCalledWith({ id: 'pk_1' }))
    expect(screen.queryByRole('alertdialog')).toBeNull()
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
      { id: 'pk_1', name: 'Ada’s phone', createdAt: new Date(2026, 8, 13) },
      { id: 'pk_2', name: 'Work laptop', createdAt: new Date(2026, 0, 2) },
    ]
    let release: (value: unknown) => void = () => {}
    deletePasskeyMock.mockReturnValue(new Promise((resolve) => (release = resolve)))
    mount()
    const target = screen.getByRole('button', { name: 'Remove Ada’s phone' }) as HTMLButtonElement
    const other = screen.getByRole('button', { name: 'Remove Work laptop' }) as HTMLButtonElement
    expect(target.disabled).toBe(false)
    fireEvent.click(target)
    await waitFor(() => expect(target.disabled).toBe(true))
    expect(other.disabled).toBe(true)
    expect(target.querySelector('.animate-spin')).not.toBeNull()
    expect(other.querySelector('.animate-spin')).toBeNull()
    release({ data: { status: true }, error: null })
    await waitFor(() => expect(other.disabled).toBe(false))
    expect(target.querySelector('.animate-spin')).toBeNull()
  })

  test('a refusal is reported rather than silently succeeding', async () => {
    deletePasskeyMock.mockResolvedValue({ data: null, error: { message: 'Passkey not found' } })
    mount()
    fireEvent.click(screen.getByRole('button', { name: 'Remove Ada’s phone' }))
    await waitFor(() => expect(toastError).toHaveBeenCalled())
    expect(toastSuccess).not.toHaveBeenCalled()
  })

  test('a rejection is reported rather than crashing the tab', async () => {
    // The inferred-endpoint proxy's return type is `any`, so nothing pins
    // whether it throws or answers `{ error }`. Both are handled.
    deletePasskeyMock.mockRejectedValue(new Error('offline'))
    mount()
    fireEvent.click(screen.getByRole('button', { name: 'Remove Ada’s phone' }))
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
