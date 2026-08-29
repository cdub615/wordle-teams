// @vitest-environment jsdom
//
// jsdom, not the suite's default edge-runtime (vitest.config.ts): rendering a
// real hook through @testing-library/react needs a DOM to mount into. jsdom's
// own `window.matchMedia` is ALSO undefined (verified directly — calling it
// throws, same as edge-runtime), so it is stubbed per test below regardless.
//
// This file exists because decideLocalCapture.test.ts pins the four-line pure
// function's rules, and nothing pinned the ~20 lines of useLocalCapture that
// decide whether that function is ever CALLED with what settings actually
// holds — the code-review on 14c8d73 found three mutants there that survived
// every gate: `hasPwa` passed inverted, the duplicate-write guard removed, and
// the rejection `.catch` removed. Each is tested below. None of it proves the
// hook stays mounted in Header.tsx, though — e2e/settings.spec.ts's "signing
// in with no stored zone" test is what actually notices that.
import { cleanup, renderHook, waitFor } from '@testing-library/react'
import { getFunctionName, type FunctionReference } from 'convex/server'
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'
import { api } from '../../convex/_generated/api'
import { useLocalCapture } from './use-local-capture.ts'

// Both mutations resolve by default, matching a ReactMutation's real return
// (convex/react's useMutation): a Promise. Without this, calling `.catch` on
// what a bare `vi.fn()` returns (`undefined`) would throw before the hook's
// own logic is ever reached.
const { updateTimeZoneMock, markPwaInstalledMock, captureErrorMock } = vi.hoisted(() => ({
  updateTimeZoneMock: vi.fn().mockResolvedValue(undefined),
  markPwaInstalledMock: vi.fn().mockResolvedValue(undefined),
  captureErrorMock: vi.fn(),
}))

// Set by each test before rendering. Read fresh (a NEW object every call,
// deliberately) rather than returned by reference, so the reference-changes-
// while-the-value-doesn't scenario the effect's own guard comment describes —
// an unrelated patch to the same players row pushing a new `mySettings`
// object — is what the rerender tests below actually exercise, not something
// they'd pass by accident because the mock handed back the same object twice.
let currentSettings: { timeZone: string | null; hasPwa: boolean } | undefined

vi.mock('@convex-dev/react-query', () => ({
  useConvexAuth: () => ({ isAuthenticated: true }),
  convexQuery: (ref: unknown, args: unknown) => ({ ref, args }),
  useConvexMutation: (ref: FunctionReference<'mutation'>) => {
    const name = getFunctionName(ref)
    if (name === getFunctionName(api.settings.updateTimeZone)) return updateTimeZoneMock
    if (name === getFunctionName(api.settings.markPwaInstalled)) return markPwaInstalledMock
    throw new Error(`use-local-capture.hook.test.ts: unexpected mutation reference ${name}`)
  },
}))

vi.mock('@tanstack/react-query', () => ({
  useQuery: () => ({ data: currentSettings ? { ...currentSettings } : undefined }),
}))

vi.mock('#/lib/sentry-capture.ts', () => ({ captureError: captureErrorMock }))

function stubStandalone({
  displayMode = false,
  navigatorStandalone = false,
}: {
  displayMode?: boolean
  navigatorStandalone?: boolean
} = {}) {
  window.matchMedia = vi.fn().mockReturnValue({ matches: displayMode }) as typeof window.matchMedia
  Object.defineProperty(window.navigator, 'standalone', {
    value: navigatorStandalone,
    configurable: true,
  })
}

describe('useLocalCapture', () => {
  beforeEach(() => {
    currentSettings = undefined
    stubStandalone()
  })

  afterEach(() => {
    cleanup()
    vi.clearAllMocks()
  })

  test('captures the resolved zone once when the player has none yet', async () => {
    currentSettings = { timeZone: null, hasPwa: false }
    const resolvedZone = Intl.DateTimeFormat().resolvedOptions().timeZone

    renderHook(() => useLocalCapture())

    await waitFor(() => expect(updateTimeZoneMock).toHaveBeenCalledTimes(1))
    expect(updateTimeZoneMock).toHaveBeenCalledWith({ timeZone: resolvedZone })
    expect(markPwaInstalledMock).not.toHaveBeenCalled()
  })

  test('does not touch the zone when the player already has one', async () => {
    currentSettings = { timeZone: 'America/Chicago', hasPwa: false }

    renderHook(() => useLocalCapture())

    // Nothing async to wait on for a negative assertion, so give one tick for
    // the effect to have run and settle before checking.
    await Promise.resolve()
    expect(updateTimeZoneMock).not.toHaveBeenCalled()
  })

  // Kills the `hasPwa: settings.hasPwa` -> `hasPwa: !settings.hasPwa` mutant:
  // under that mutant, a player with NO recorded install (storedHasPwa passed
  // as `true`) never gets markPwaInstalled called here, silently.
  test('captures the PWA install when standalone and not already recorded', async () => {
    currentSettings = { timeZone: 'America/Chicago', hasPwa: false }
    stubStandalone({ displayMode: true })

    renderHook(() => useLocalCapture())

    await waitFor(() => expect(markPwaInstalledMock).toHaveBeenCalledTimes(1))
    expect(updateTimeZoneMock).not.toHaveBeenCalled()
  })

  // The other half of the same mutant: under `!settings.hasPwa`, a player who
  // ALREADY has hasPwa: true gets markPwaInstalled called again.
  test('does not repeat the PWA install once it is already recorded', async () => {
    currentSettings = { timeZone: 'America/Chicago', hasPwa: true }
    stubStandalone({ displayMode: true })

    renderHook(() => useLocalCapture())

    await Promise.resolve()
    expect(markPwaInstalledMock).not.toHaveBeenCalled()
  })

  // Kills dropping `&& !attemptedZone.current`: settings is handed back as a
  // NEW object on every render (see currentSettings' comment above) even
  // though the timeZone it carries never changes, which is exactly the "an
  // unrelated patch to the same row" scenario the guard exists for. Without
  // the ref check, each rerender below would fire another write.
  test('writes the zone only once, even when a new settings object arrives before it lands', async () => {
    currentSettings = { timeZone: null, hasPwa: false }

    const { rerender } = renderHook(() => useLocalCapture())
    await waitFor(() => expect(updateTimeZoneMock).toHaveBeenCalledTimes(1))

    rerender()
    rerender()
    await Promise.resolve()

    expect(updateTimeZoneMock).toHaveBeenCalledTimes(1)
  })

  // Kills dropping the `.catch(...)` on the zone write: without it, a
  // rejected mutation becomes an unhandled promise rejection instead of
  // reaching captureError — Vitest surfaces that as a failure of its own, on
  // top of (or instead of) the assertion below never seeing a call.
  test('reports a rejected zone write instead of leaving it unhandled', async () => {
    currentSettings = { timeZone: null, hasPwa: false }
    const resolvedZone = Intl.DateTimeFormat().resolvedOptions().timeZone
    const rejection = new Error('INVALID_TIME_ZONE')
    updateTimeZoneMock.mockRejectedValueOnce(rejection)

    renderHook(() => useLocalCapture())

    await waitFor(() => expect(captureErrorMock).toHaveBeenCalledTimes(1))
    expect(captureErrorMock).toHaveBeenCalledWith(rejection, {
      where: 'useLocalCapture.timeZone',
      resolved: resolvedZone,
    })
  })
})
