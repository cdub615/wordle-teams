// @vitest-environment jsdom
//
// jsdom, not the suite's default edge-runtime (vitest.config.ts), because this
// file mounts a real hook through a real component. `.hook.test.ts` matches the
// existing precedents — Header, settings/notifications-tab, settings/profile-tab
// and lib/use-local-capture — and `.test.ts` rather than `.test.tsx` because
// vitest.config.ts's glob is `src/**/*.test.ts`, so the element below goes
// through `createElement` by hand.
//
// WHY THIS FILE EXISTS: the hook it covers is the fix for a regression, and the
// regression was invisible precisely because the code had no test and swallowed
// its own errors. A GitHub user's avatar vanished from their own header on beta
// because the mirror this hook performs had never run for them — it lived in one
// route's component while the header read its result on every route.
import { cleanup, render } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'
import { createElement } from 'react'

const syncMutation = vi.fn()
const captureError = vi.fn()
let authed = true

vi.mock('@convex-dev/react-query', () => ({
  useConvexAuth: () => ({ isAuthenticated: authed }),
  useConvexMutation: () => syncMutation,
}))
vi.mock('#/lib/sentry-capture.ts', () => ({ captureError: (...args: unknown[]) => captureError(...args) }))

const { useSocialImageSync } = await import('./use-social-image-sync.ts')

function Probe() {
  useSocialImageSync()
  return null
}

beforeEach(() => {
  syncMutation.mockReset()
  syncMutation.mockResolvedValue(undefined)
  captureError.mockReset()
  authed = true
})
afterEach(cleanup)

describe('useSocialImageSync', () => {
  test('mirrors once for an authenticated player', () => {
    render(createElement(Probe))
    expect(syncMutation).toHaveBeenCalledTimes(1)
    expect(syncMutation).toHaveBeenCalledWith({})
  })

  /**
   * THE REGRESSION THIS HOOK EXISTS TO FIX, stated as an assertion. It does not
   * prove global coverage on its own — that comes from Header mounting it — but
   * it does prove the hook fires from a bare mount with no route, no dashboard
   * and no data loaded, which is what makes mounting it in Header sufficient.
   */
  test('needs nothing but a mount — no route, no dashboard, no loaded data', () => {
    render(createElement(Probe))
    expect(syncMutation).toHaveBeenCalledTimes(1)
  })

  test('does NOT fire for a signed-out visitor, who has no player row to mirror onto', () => {
    authed = false
    render(createElement(Probe))
    expect(syncMutation).not.toHaveBeenCalled()
  })

  /**
   * A re-render must not re-fire. `useConvexMutation`'s callable is memoised, so
   * the deps array alone should hold — this pins the ref guard that backs it up,
   * matching use-local-capture.ts's attemptedZone/attemptedPwa pattern.
   */
  test('does not re-fire on re-render', () => {
    const view = render(createElement(Probe))
    view.rerender(createElement(Probe))
    view.rerender(createElement(Probe))
    expect(syncMutation).toHaveBeenCalledTimes(1)
  })

  /**
   * CAPTURED, NOT SWALLOWED, and this is the assertion that would have turned
   * the original regression into a report instead of a mystery. The first
   * version wrote `.catch(() => {})`, so when the mirror stopped populating
   * there was no way to tell a failure from a hook that never ran.
   */
  test('reports a failure to Sentry rather than swallowing it', async () => {
    const boom = new Error('mutation refused')
    syncMutation.mockRejectedValue(boom)
    render(createElement(Probe))
    await vi.waitFor(() => expect(captureError).toHaveBeenCalledTimes(1))
    expect(captureError).toHaveBeenCalledWith(boom, { where: 'useSocialImageSync' })
  })

  test('a failure never throws out of the hook', async () => {
    syncMutation.mockRejectedValue(new Error('nope'))
    expect(() => render(createElement(Probe))).not.toThrow()
    await vi.waitFor(() => expect(captureError).toHaveBeenCalled())
  })
})
