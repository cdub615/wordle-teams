import { readFileSync } from 'node:fs'
import { describe, expect, test } from 'vitest'
import { CHECKOUT_PARAM, CHECKOUT_SUCCESS, checkoutReturnUrl } from './checkout-return.ts'

/**
 * THE RETURN LEG'S ONLY TESTABLE SURFACE. Everything else it does is a
 * `useState` and a `history.replaceState`; what can actually be wrong is which
 * URLs are treated as a successful return and what the URL is left as
 * afterwards. e2e/billing.spec.ts covers the wiring — that the notice appears
 * on `/app?checkout=success` and is gone after a reload — and cannot cover the
 * cases below, because reaching them needs a real cancelled checkout or a
 * dashboard already carrying `?team=` and `?month=` at the moment of return.
 */

const RETURN = `https://wordleteams.com/app?${CHECKOUT_PARAM}=${CHECKOUT_SUCCESS}`

describe('checkoutReturnUrl', () => {
  test('a success marker is a return, and the marker is what goes', () => {
    expect(checkoutReturnUrl(RETURN)).toBe('/app')
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
    // ?team= and ?month= are what routes/app.tsx renders from. Losing them
    // here would send the player back to their remembered team mid-upgrade.
    //
    // The path is incidental to checkoutReturnUrl, which preserves whatever it
    // is given — but this test says "the dashboard", so it spells the dashboard
    // the way the app does. It read '/' until Phase 7 moved the dashboard to
    // /app, which made the name and the literal disagree.
    expect(
      checkoutReturnUrl('https://wordleteams.com/app?team=abc&checkout=success&month=2026-08'),
    ).toBe('/app?team=abc&month=2026-08')
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
    // `/app?` and `/app` are different strings in the address bar and the second
    // is the one the router would have produced.
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

describe('the URL convex/polar.ts actually sends the browser back to', () => {
  test("createProCheckout's successUrl is the input this module claims it is", () => {
    // THE OTHER END OF THE CONTRACT, which had no coverage of any kind. The
    // header of checkout-return.ts states as fact that polar.ts sets
    // `successUrl` to `${siteUrl()}/app?checkout=success`, and everything here
    // is built on that; but changing that literal to `/` was green on lint,
    // typecheck, `vitest run` and build. e2e cannot reach it either —
    // e2e/billing.spec.ts types `/app?checkout=success` in by hand precisely
    // because no real checkout can be driven with POLAR_* unset — so nothing
    // at all connected the two halves.
    //
    // Read as a string, the same pattern src/lib/sw-push.test.ts uses to pin
    // the push payload against its server copy: importing convex/polar.ts
    // would run its module scope, and the value is interpolated at call time
    // from an env var anyway. The path and the marker come from the constants
    // above rather than a second hardcoded copy, so this fails if EITHER side
    // moves.
    const polar = readFileSync(new URL('../../convex/polar.ts', import.meta.url), 'utf8')
    const at = polar.indexOf('successUrl:')
    expect(at, 'successUrl not found in convex/polar.ts').toBeGreaterThan(-1)

    // Bounded to its own line. An unbounded slice would be satisfied by any
    // later occurrence of the string — the false negative sw-push.test.ts had.
    const line = polar.slice(at, polar.indexOf('\n', at))
    expect(line).toContain(`/app?${CHECKOUT_PARAM}=${CHECKOUT_SUCCESS}`)

    // And that URL, run through this module, is the dashboard with the marker
    // gone — the whole return leg, end to end, from the sender's own literal.
    expect(checkoutReturnUrl(`https://wordleteams.com/app?${CHECKOUT_PARAM}=${CHECKOUT_SUCCESS}`)).toBe(
      '/app',
    )
  })
})
