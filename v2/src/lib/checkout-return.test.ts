import { describe, expect, test } from 'vitest'
import { checkoutReturnUrl } from './checkout-return.ts'

/**
 * THE RETURN LEG'S ONLY TESTABLE SURFACE. Everything else it does is a
 * `useState` and a `history.replaceState`; what can actually be wrong is which
 * URLs are treated as a successful return and what the URL is left as
 * afterwards. e2e/billing.spec.ts covers the wiring — that the notice appears
 * on `/?checkout=success` and is gone after a reload — and cannot cover the
 * cases below, because reaching them needs a real cancelled checkout or a
 * dashboard already carrying `?team=` and `?month=` at the moment of return.
 */

const RETURN = 'https://wordleteams.com/?checkout=success'

describe('checkoutReturnUrl', () => {
  test('a success marker is a return, and the marker is what goes', () => {
    expect(checkoutReturnUrl(RETURN)).toBe('/')
  })

  test('no query string at all is not a return', () => {
    expect(checkoutReturnUrl('https://wordleteams.com/')).toBeNull()
  })

  test.each(['cancelled', 'failed', 'true', '', 'Success', 'success '])(
    'checkout=%o is not a success and must not claim one',
    (value) => {
      // The pending state this drives says an upgrade is on its way. Saying
      // that after a cancellation is the failure worth catching, so anything
      // that is not exactly the marker createProCheckout sends is a non-return.
      const url = `https://wordleteams.com/?checkout=${encodeURIComponent(value)}`
      expect(checkoutReturnUrl(url)).toBeNull()
    },
  )

  test('another param on its own is not a return', () => {
    expect(checkoutReturnUrl('https://wordleteams.com/?team=abc&month=2026-08')).toBeNull()
  })

  test('the dashboard keeps its own params', () => {
    // ?team= and ?month= are what routes/index.tsx renders from. Losing them
    // here would send the player back to their remembered team mid-upgrade.
    expect(checkoutReturnUrl('https://wordleteams.com/?team=abc&checkout=success&month=2026-08')).toBe(
      '/?team=abc&month=2026-08',
    )
  })

  test('the hash survives', () => {
    expect(checkoutReturnUrl('https://wordleteams.com/?checkout=success#scores')).toBe('/#scores')
  })

  test('the path survives', () => {
    expect(checkoutReturnUrl('https://wordleteams.com/me?checkout=success')).toBe('/me')
  })

  test('nothing of the origin comes back', () => {
    // Handed to history.replaceState. A returned origin is the one shape that
    // could move the document off this site, so it must never be in there.
    const stripped = checkoutReturnUrl('https://wordleteams.com/?checkout=success&team=abc')
    expect(stripped).not.toBeNull()
    expect(stripped).toMatch(/^\//)
    expect(stripped).not.toContain('wordleteams.com')
  })

  test('the last param leaves no dangling question mark', () => {
    // `/?` and `/` are different strings in the address bar and the second is
    // the one the router would have produced.
    expect(checkoutReturnUrl(RETURN)).not.toContain('?')
  })

  test('the result is not itself a return — one pass is all there ever is', () => {
    // The idempotence the effect leans on: Strict Mode invokes it twice, and a
    // reload runs it again against the stripped URL. Both must be no-ops.
    const stripped = checkoutReturnUrl(RETURN)
    expect(stripped).not.toBeNull()
    expect(checkoutReturnUrl(new URL(stripped!, 'https://wordleteams.com').href)).toBeNull()
  })

  test('a repeated marker is stripped completely rather than leaving one behind', () => {
    // URLSearchParams.delete removes every occurrence; if it only dropped the
    // first, the reload case above would re-enter the pending state forever.
    expect(checkoutReturnUrl('https://wordleteams.com/?checkout=success&checkout=success')).toBe('/')
  })
})
