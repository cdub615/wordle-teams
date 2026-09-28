import { afterEach, describe, expect, test, vi } from 'vitest'
import { registerServiceWorker } from './register-sw.ts'

/**
 * THE TEST THIS FILE EXISTS FOR is "a throwing serviceWorker getter does not
 * propagate". Review of f71d183 found the ported guard was
 * `'serviceWorker' in navigator`, which performs [[HasProperty]] and never
 * invokes the accessor — while `Navigator.serviceWorker` is a [SecureContext]
 * getter that THROWS SecurityError in Chromium when site data is blocked for
 * the origin, and in a sandboxed frame without allow-same-origin. The guard
 * passed and the next property read threw synchronously, out of an effect in
 * RootComponent: a blank page rather than a missing PWA.
 *
 * That is the second "guard that does not guard" in this phase, hence a test
 * rather than a comment. Reverting the try/catch around the property read must
 * fail here.
 *
 * The function takes `navigator` as an argument for exactly this reason: a
 * throwing getter is not expressible through the DOM lib's `Navigator` type,
 * and no amount of jsdom setup reproduces an enterprise site-data policy.
 */

const warnSpy = () => vi.spyOn(console, 'warn').mockImplementation(() => {})

afterEach(() => {
  vi.restoreAllMocks()
})

/** A navigator whose `serviceWorker` getter throws, as Chromium's does. */
function hostileNavigator(error: unknown) {
  return Object.defineProperty({}, 'serviceWorker', {
    get() {
      throw error
    },
  }) as { readonly serviceWorker?: { register(u: string): Promise<unknown> } }
}

describe('registerServiceWorker', () => {
  test('registers /sw.js exactly once, at the root scope', () => {
    const warn = warnSpy()
    const register = vi.fn().mockResolvedValue({})

    registerServiceWorker({ serviceWorker: { register } })

    expect(register).toHaveBeenCalledTimes(1)
    // Not '/assets/sw.js', not './sw.js'. A worker only controls the paths at
    // or below where it is served, so the root path is the whole point.
    expect(register).toHaveBeenCalledWith('/sw.js')
    expect(warn).not.toHaveBeenCalled()
  })

  test('a THROWING serviceWorker getter is absorbed, not propagated', () => {
    const warn = warnSpy()
    const securityError = new Error('Access to service workers is denied in this document origin')
    securityError.name = 'SecurityError'

    // The assertion is `not.toThrow`. Before the fix this threw straight
    // through the effect and blanked the app.
    expect(() => registerServiceWorker(hostileNavigator(securityError))).not.toThrow()

    expect(warn).toHaveBeenCalledTimes(1)
    expect(warn.mock.calls[0][0]).toBe('Service Worker is unavailable in this document origin')
    expect(warn.mock.calls[0][1]).toMatchObject({ name: 'SecurityError' })
  })

  test('a getter that throws a non-Error is still absorbed', () => {
    const warn = warnSpy()
    expect(() => registerServiceWorker(hostileNavigator('denied'))).not.toThrow()
    expect(warn).toHaveBeenCalledWith(
      'Service Worker is unavailable in this document origin',
      expect.objectContaining({ message: 'denied', name: undefined }),
    )
  })

  test('does nothing, and says nothing, where the API is simply absent', () => {
    const warn = warnSpy()

    // An older browser, or a non-secure context that reports absence rather
    // than throwing. Not a failure — no warning.
    registerServiceWorker({})
    registerServiceWorker(undefined)

    expect(warn).not.toHaveBeenCalled()
  })

  test('a rejected registration warns instead of rejecting unhandled', async () => {
    const warn = warnSpy()
    const failure = new TypeError('Failed to register a ServiceWorker: bad MIME type')

    registerServiceWorker({ serviceWorker: { register: () => Promise.reject(failure) } })
    await vi.waitFor(() => expect(warn).toHaveBeenCalled())

    expect(warn).toHaveBeenCalledWith(
      'Service Worker registration failed',
      expect.objectContaining({ name: 'TypeError' }),
    )
  })

  test('a register() that throws SYNCHRONOUSLY is absorbed too', () => {
    const warn = warnSpy()
    const register = () => {
      throw new Error('blocked by policy')
    }

    expect(() => registerServiceWorker({ serviceWorker: { register } })).not.toThrow()
    expect(warn).toHaveBeenCalledWith(
      'Service Worker registration failed',
      expect.objectContaining({ message: 'blocked by policy' }),
    )
  })

  test('cancelling suppresses a warning that arrives after unmount', async () => {
    const warn = warnSpy()
    let reject: (error: unknown) => void = () => {}
    const pending = new Promise((_, r) => {
      reject = r
    })

    const cancel = registerServiceWorker({ serviceWorker: { register: () => pending } })
    cancel()
    reject(new Error('too late'))
    await pending.catch(() => {})
    // One extra turn, so the .catch handler has certainly run.
    await Promise.resolve()

    expect(warn).not.toHaveBeenCalled()
  })
})
