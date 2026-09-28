import { describe, expect, test } from 'vitest'
import { isMissingCheckout, isMissingCustomer } from './polarErrors.ts'

/**
 * The shape a real error presents to this check. Measured against
 * `@polar-sh/sdk@1.0.0-alpha.21`, whose `sendRequest` builds every 4xx one of
 * two ways (`dist/base-*.mjs`):
 *   - the endpoint DECLARES the status → `new ErrorClass(statusCode,
 *     await response.json())`, so `error` is a PARSED OBJECT;
 *   - it does not → `new PolarClientError(statusCode, await response.text())`,
 *     so `error` is a RAW STRING.
 * `statusCode` is set on both. Nothing else on the class is consulted.
 *
 * BOTH ARE EXERCISED BELOW, because which one a given 422 takes is a property
 * of Polar's spec rather than of this app, and can change under us without any
 * edit here. The 0.49.0 shape this replaced had a single `body` holding raw
 * text in every case.
 */
const polarTextError = (statusCode: number, error: string) => ({ statusCode, error })
const polarJsonError = (statusCode: number, error: unknown) => ({ statusCode, error })

// The body Polar actually sends for an unknown external_customer_id. v1
// verified the same detail for a non-UUID id, a well-formed but unknown UUID,
// and an empty string.
const NO_CUSTOMER_DETAIL = {
  detail: [{ loc: ['body', 'external_customer_id'], msg: 'Customer does not exist.' }],
}
const NO_CUSTOMER_BODY = JSON.stringify(NO_CUSTOMER_DETAIL)

describe('isMissingCustomer', () => {
  test('a 422 carrying the detail is the no-billing-account case', () => {
    expect(isMissingCustomer(polarTextError(422, NO_CUSTOMER_BODY))).toBe(true)
  })

  // THE SHAPE THE ALPHA ACTUALLY PRODUCES for a declared 422, and the one the
  // 0.49.0-era test explicitly asserted was NOT a match — correctly then, since
  // `body` was always raw text so an object meant something had gone wrong.
  // Under the new SDK it is the primary case, and a classifier still matching
  // only strings would tell every non-subscriber to try again later, forever.
  test('a 422 whose detail arrives PARSED is the same case', () => {
    expect(isMissingCustomer(polarJsonError(422, NO_CUSTOMER_DETAIL))).toBe(true)
  })

  // THE SECOND OF v1'S THREE ATTEMPTS. Matching on the status alone would
  // report every ordinary validation failure as "you have no billing account",
  // which is a sentence the user cannot act on hiding a bug we need to see.
  test('a 422 WITHOUT the detail is an error, not a missing customer', () => {
    expect(
      isMissingCustomer(
        polarTextError(
          422,
          JSON.stringify({
            detail: [{ loc: ['body', 'success_url'], msg: 'URL scheme not permitted' }],
          }),
        ),
      ),
    ).toBe(false)
  })

  // Polar does not currently send this; see the note on the 404 branch.
  test('a 404 counts, so nothing breaks if Polar ever starts sending one', () => {
    expect(isMissingCustomer(polarTextError(404, JSON.stringify({ detail: 'Not Found' })))).toBe(true)
  })

  // THE FAILURE THAT MATTERS MOST TO GET WRONG. A 5xx is transient; calling it
  // "no billing account" would tell a paying subscriber their subscription had
  // vanished and give them nothing to retry.
  test('a 500 is an error even if its body mentions the customer', () => {
    expect(isMissingCustomer(polarTextError(500, 'Customer does not exist.'))).toBe(false)
  })

  test('the detail is matched case-insensitively', () => {
    expect(isMissingCustomer(polarTextError(422, '{"detail":"CUSTOMER DOES NOT EXIST."}'))).toBe(true)
  })

  // THE FIRST OF v1'S THREE ATTEMPTS, from the other end: a typed
  // ResourceNotFound never arrives, so an error carrying no HTTP status at all
  // must not be guessed at.
  test('anything without an HTTP status is an error', () => {
    expect(isMissingCustomer(new TypeError('fetch failed'))).toBe(false)
    expect(isMissingCustomer(undefined)).toBe(false)
    expect(isMissingCustomer(null)).toBe(false)
    expect(isMissingCustomer('Customer does not exist.')).toBe(false)
  })

  // An absent body cannot carry the detail. `String(undefined)` is "undefined"
  // and `JSON.stringify(undefined)` is undefined, which is why `serialise`
  // handles the latter rather than letting it reach the regex.
  test('a 422 with no body at all is an error', () => {
    expect(isMissingCustomer({ statusCode: 422 })).toBe(false)
  })

  // THE GUARD AGAINST `String(value)`, which is the obvious simplification of
  // `serialise` and is wrong: it renders every object as '[object Object]', so
  // the parsed case above would stop matching and the 0.49.0 bug would return.
  // A nested detail has to survive serialisation.
  test('a detail nested deep in the parsed body still matches', () => {
    expect(
      isMissingCustomer(polarJsonError(422, { detail: [{ ctx: { msg: 'Customer does not exist.' } }] })),
    ).toBe(true)
  })

  // A circular body makes JSON.stringify THROW, and this runs inside a catch on
  // the portal's happy path — a throw would replace 'no billing account' with
  // an unhandled error for a user who simply has not paid.
  test('a circular body is an error rather than a crash', () => {
    const circular: Record<string, unknown> = { detail: 'Customer does not exist.' }
    circular.self = circular

    expect(() => isMissingCustomer(polarJsonError(422, circular))).not.toThrow()
    expect(isMissingCustomer(polarJsonError(422, circular))).toBe(false)
  })

  // The status is compared strictly, so the string form a hand-rolled fetch
  // wrapper might carry does not silently classify.
  test('a stringified status does not match', () => {
    expect(isMissingCustomer({ statusCode: '422', error: NO_CUSTOMER_BODY })).toBe(false)
    expect(isMissingCustomer({ statusCode: '404', error: '' })).toBe(false)
  })
})

describe('isMissingCheckout', () => {
  // Polar answers a path parameter naming nothing with 404, and the SDK
  // declares it. Nothing about a redelivery changes the id we would send.
  test('a 404 is a checkout that cannot be read', () => {
    expect(isMissingCheckout({ statusCode: 404, error: { detail: 'Not Found' } })).toBe(true)
  })

  // A rejected id is rejected the same way every time, so this is the same
  // "retrying can never help" as a 404 rather than a failure to retry.
  test('a 422 is a permanently unusable checkout id', () => {
    expect(isMissingCheckout({ statusCode: 422, error: { detail: [] } })).toBe(true)
  })

  // THE WHOLE POINT OF THE CLASSIFIER, and the bug it was written to close: a
  // transient failure answered 'no checkout' becomes a 202, which tells Polar
  // never to redeliver, and the upgrade is lost with no audit row.
  test('a transient failure is NOT a missing checkout', () => {
    expect(isMissingCheckout({ statusCode: 500, error: 'upstream error' })).toBe(false)
    expect(isMissingCheckout({ statusCode: 502, error: '' })).toBe(false)
    expect(isMissingCheckout({ statusCode: 429, error: 'slow down' })).toBe(false)
  })

  // A missing POLAR_ACCESS_TOKEN throws out of assertPolarEnv before any
  // request is made, so it carries no status at all. A deployment configured to
  // verify webhooks but not to call Polar must fail loudly — polar.ts's env
  // contract says identically everywhere — rather than silently drop the
  // upgrades that need the fallback.
  test('an error with no HTTP status is a failure, not an answer', () => {
    expect(isMissingCheckout(new Error('Missing required POLAR env variables'))).toBe(false)
    expect(isMissingCheckout(new TypeError('fetch failed'))).toBe(false)
    expect(isMissingCheckout(undefined)).toBe(false)
    expect(isMissingCheckout(null)).toBe(false)
    expect(isMissingCheckout('404')).toBe(false)
  })

  test('a stringified status does not match', () => {
    expect(isMissingCheckout({ statusCode: '404' })).toBe(false)
    expect(isMissingCheckout({ statusCode: '422' })).toBe(false)
  })
})
