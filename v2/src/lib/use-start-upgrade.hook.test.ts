// @vitest-environment jsdom
//
// jsdom, not the suite's default edge-runtime (vitest.config.ts): driving a
// real hook through @testing-library/react needs a DOM to mount into, and the
// navigate branch assigns `window.location.href`. `.hook.test.ts` matches the
// five existing precedents — use-local-capture.hook.test.ts and the four
// component files beside it — and `.test.ts` rather than `.test.tsx` because
// vitest.config.ts's glob is `src/**/*.test.ts`.
//
// WHAT THIS FILE COVERS THAT billing-copy.test.ts CANNOT. That suite pins the
// three CheckoutResult shapes as a pure mapping, and every one of its tests
// would still pass if nothing ever CALLED `checkoutOutcome` — if this hook
// tested for a URL itself and folded the two failures back together (which is
// exactly wordle-teams-9fm), or if it navigated with TanStack's router, or if
// it swallowed a transport throw and left the button dead. All four are wiring,
// and wiring is what this reads.
//
// NOTE ON GATES: `pnpm test:once` runs this file and CI runs test:once
// (.github/workflows/deploy-v2.yml). Playwright is NOT a gate — wt-ksh.8.49 —
// so nothing here may be left to e2e. That matters more than usual for this
// module: e2e/billing.spec.ts drives a deployment with no POLAR_* variable set
// (wordle-teams-3bl), so the only answer it can ever observe is
// `not-configured`. The navigate branch and the `error` branch have no e2e at
// all, and this is the only thing that reads them.
import { act, cleanup, renderHook, waitFor } from '@testing-library/react'
import { ConvexError } from 'convex/values'
import { getFunctionName, type FunctionReference } from 'convex/server'
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'
import { api } from '../../convex/_generated/api'
import { CHECKOUT_FAILED, CHECKOUT_NOT_CONFIGURED } from './billing-copy.ts'
import { typedCodeMessage } from './convex-error.ts'
import { useStartUpgrade } from './use-start-upgrade.ts'
import type { CheckoutResult } from '../../convex/polar.ts'

// Hoisted, because vi.mock's factory is lifted above every other statement in
// this file. `requestedActions` is every action reference the hook asked for,
// by name — the bounded record the "asks for the CHECKOUT" test reads.
const { createCheckout, toastInfo, toastError, requestedActions } = vi.hoisted(() => ({
  createCheckout: vi.fn(),
  toastInfo: vi.fn(),
  toastError: vi.fn(),
  requestedActions: [] as Array<string>,
}))

vi.mock('@convex-dev/react-query', () => ({
  useConvexAction: (ref: FunctionReference<'action'>) => {
    requestedActions.push(getFunctionName(ref))
    return createCheckout
  },
}))

vi.mock('sonner', () => ({ toast: { info: toastInfo, error: toastError } }))

/**
 * jsdom refuses a real navigation ("Not implemented: navigation to another
 * Document") and leaves `location.href` untouched, so the assignment has to
 * land somewhere observable. A plain object is enough: the hook only writes the
 * property.
 */
let location: { href: string }

beforeEach(() => {
  location = { href: 'http://localhost:3000/app' }
  vi.stubGlobal('location', location)
  createCheckout.mockReset()
  toastInfo.mockClear()
  toastError.mockClear()
  requestedActions.length = 0
})

afterEach(() => {
  cleanup()
  vi.unstubAllGlobals()
})

/** Renders the hook and runs one full `startUpgrade`, act-wrapped. */
const upgrade = async () => {
  const { result } = renderHook(() => useStartUpgrade())
  await act(async () => {
    await result.current.startUpgrade()
  })
  return result
}

/**
 * The single toast this call produced, as `[level, message]`. Throws otherwise.
 *
 * THE `info` ARM CANNOT FIRE TODAY, AND IT STAYS ANYWAY. `checkoutOutcome`
 * (billing-copy.ts) has two url-less branches and both are `level: 'error'`,
 * so `toast[outcome.level]` in the hook can only ever index `error` — which
 * makes swapping it for a literal `toast.error` an EQUIVALENT mutant, recorded
 * as such in use-start-upgrade.ts's own note rather than chased. This helper
 * reports the level it actually saw instead of assuming one, so the day a
 * checkout branch does answer `info` the assertions above go red naming the
 * level rather than silently passing.
 */
const toasted = (): [string, string] => {
  const calls = [
    ...toastInfo.mock.calls.map((call) => ['info', call[0] as string] as [string, string]),
    ...toastError.mock.calls.map((call) => ['error', call[0] as string] as [string, string]),
  ]
  if (calls.length !== 1) throw new Error(`expected exactly one toast, got ${calls.length}`)
  return calls[0]
}

describe('it starts a CHECKOUT, and that is the whole reason it exists', () => {
  test('it asks for createProCheckout and for nothing else', () => {
    // THE MUTATION THIS KILLS: pointing an "Upgrade" affordance at
    // getCustomerPortalUrl. Both are zero-argument polar actions returning a
    // url-or-reason, so the swap type-checks, renders, and answers the SAME
    // `not-configured` sentence on the deployment e2e drives — which is to say
    // nothing else in this repo could notice it. Asserted as the whole list
    // rather than a `toContain`, so a second action added beside the right one
    // is also a change here.
    renderHook(() => useStartUpgrade())
    expect(requestedActions).toEqual([getFunctionName(api.polar.createProCheckout)])
    expect(requestedActions).not.toContain(getFunctionName(api.polar.getCustomerPortalUrl))
  })

  test('a url is a FULL-PAGE navigation, and says nothing', async () => {
    createCheckout.mockResolvedValue({ url: 'https://polar.example/checkout/abc' })

    await upgrade()

    // The URL is on polar.sh; TanStack's `navigate` only knows this app's
    // routes, so this must be the document's own location and not the router.
    expect(location.href).toBe('https://polar.example/checkout/abc')
    expect(toastInfo).not.toHaveBeenCalled()
    expect(toastError).not.toHaveBeenCalled()
    expect(createCheckout).toHaveBeenCalledWith({})
  })
})

describe('the two failures are NOT the same failure — wordle-teams-9fm', () => {
  test('not-configured is an error that never asks for a retry', async () => {
    createCheckout.mockResolvedValue({ url: null, reason: 'not-configured' } satisfies CheckoutResult)

    await upgrade()

    // THE WHOLE TOAST, LEVEL INCLUDED. The properties of the sentence itself —
    // no retry wording, no variable name — are billing-copy.test.ts's, and
    // asserting them again about a string this line has already pinned with
    // `toEqual` cannot fail.
    expect(toasted()).toEqual(['error', CHECKOUT_NOT_CONFIGURED])
    // Nothing navigated: a url-less result must leave the page where it is.
    expect(location.href).toBe('http://localhost:3000/app')
  })

  test('error is the operational one, and gets the sentence that invites a retry', async () => {
    createCheckout.mockResolvedValue({ url: null, reason: 'error' } satisfies CheckoutResult)

    await upgrade()

    expect(toasted()).toEqual(['error', CHECKOUT_FAILED])
    expect(location.href).toBe('http://localhost:3000/app')
  })

  // THE PAIR ITSELF — `expect(CHECKOUT_NOT_CONFIGURED).not.toBe(
  // CHECKOUT_FAILED)` — IS NOT ASSERTED HERE. It is a bare comparison of two
  // constants with no hook in it, so no mutation of use-start-upgrade.ts can
  // kill it, and billing-copy.test.ts already owns it. What this file adds is
  // that the two REACH the player from the two branches, which is above.
})

describe('a THROW is a fourth outcome, and it must still say something', () => {
  test('a transport failure gets the operational sentence', async () => {
    // createProCheckout catches its own Polar errors and an unset SITE_URL with
    // them, so reaching the catch means the action never answered at all — a
    // dropped websocket, or checkoutIdentity throwing. A dead button is
    // indistinguishable from a broken one, so silence is not an option.
    createCheckout.mockRejectedValue(new Error('socket hang up'))

    await upgrade()

    expect(toasted()).toEqual(['error', CHECKOUT_FAILED])
  })

  test('a typed ConvexError gets ITS OWN copy, not the fallback', async () => {
    // What `mutationErrorMessage` is for, and the half a bare `toast.error(
    // CHECKOUT_FAILED)` in the catch would silently drop: an unauthenticated
    // player told to "try again" would retry forever without signing in.
    createCheckout.mockRejectedValue(new ConvexError({ code: 'UNAUTHENTICATED' }))

    await upgrade()

    expect(toasted()).toEqual(['error', typedCodeMessage('UNAUTHENTICATED')])
    expect(toasted()[1]).not.toBe(CHECKOUT_FAILED)
  })

  // "THE RAW THROW NEVER REACHES THE PLAYER" USED TO BE A THIRD TEST HERE and
  // is gone: every mutant it could kill is killed first by the transport test
  // above, which pins the whole toast with `toEqual` — a message containing
  // `backend.internal` is already not CHECKOUT_FAILED.
})

describe('the pending flag', () => {
  test('it is raised for the round trip and lowered after every outcome', async () => {
    let release: (result: CheckoutResult) => void = () => {}
    createCheckout.mockReturnValue(
      new Promise<CheckoutResult>((resolve) => {
        release = resolve
      }),
    )

    const { result } = renderHook(() => useStartUpgrade())
    expect(result.current.pending).toBe(false)

    let settled: Promise<void>
    act(() => {
      settled = result.current.startUpgrade()
    })
    await waitFor(() => expect(result.current.pending).toBe(true))

    await act(async () => {
      release({ url: null, reason: 'error' })
      await settled
    })
    expect(result.current.pending).toBe(false)
  })

  test('a throw lowers it too — otherwise the button is disabled forever', async () => {
    createCheckout.mockRejectedValue(new Error('socket hang up'))

    const result = await upgrade()

    expect(result.current.pending).toBe(false)
  })

  test('and so does the navigate branch, which returns early', async () => {
    // The `return` inside the `try` skips the toast, not the `finally`.
    // Assigning `location.href` does not unload the document synchronously, and
    // a bfcache restore brings this component back with its state intact — a
    // spinner left spinning there is a button nobody can press again.
    createCheckout.mockResolvedValue({ url: 'https://polar.example/checkout/abc' })

    const result = await upgrade()

    expect(result.current.pending).toBe(false)
  })
})
