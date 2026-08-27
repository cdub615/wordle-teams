import { describe, expect, test } from 'vitest'
import { isMissingCustomer } from './polarErrors.ts'

/**
 * The shape a real `PolarError` presents to this check. Measured against
 * `@polar-sh/sdk@0.49.0`: `PolarError`'s constructor sets `statusCode` from
 * `httpMeta.response.status` and `body` from the raw response text, and the
 * 422 that `customerSessions.create` declares arrives as `HTTPValidationError`,
 * which extends it. Nothing else on the class is consulted.
 */
const polarError = (statusCode: number, body: string) => ({ statusCode, body })

// The body Polar actually sends for an unknown external_customer_id. v1
// verified the same detail for a non-UUID id, a well-formed but unknown UUID,
// and an empty string.
const NO_CUSTOMER_BODY = JSON.stringify({
  detail: [{ loc: ['body', 'external_customer_id'], msg: 'Customer does not exist.' }],
})

describe('isMissingCustomer', () => {
  test('a 422 carrying the detail is the no-billing-account case', () => {
    expect(isMissingCustomer(polarError(422, NO_CUSTOMER_BODY))).toBe(true)
  })

  // THE SECOND OF v1'S THREE ATTEMPTS. Matching on the status alone would
  // report every ordinary validation failure as "you have no billing account",
  // which is a sentence the user cannot act on hiding a bug we need to see.
  test('a 422 WITHOUT the detail is an error, not a missing customer', () => {
    expect(
      isMissingCustomer(
        polarError(
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
    expect(isMissingCustomer(polarError(404, JSON.stringify({ detail: 'Not Found' })))).toBe(true)
  })

  // THE FAILURE THAT MATTERS MOST TO GET WRONG. A 5xx is transient; calling it
  // "no billing account" would tell a paying subscriber their subscription had
  // vanished and give them nothing to retry.
  test('a 500 is an error even if its body mentions the customer', () => {
    expect(isMissingCustomer(polarError(500, 'Customer does not exist.'))).toBe(false)
  })

  test('the detail is matched case-insensitively', () => {
    expect(isMissingCustomer(polarError(422, '{"detail":"CUSTOMER DOES NOT EXIST."}'))).toBe(true)
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

  // `.test(String(body))` would match '[object Object]' against nothing here,
  // but would start matching the moment a body stringified to something
  // containing the phrase. Pinned so the guard is not simplified away.
  test('a 422 with a non-string body is an error', () => {
    expect(isMissingCustomer({ statusCode: 422 })).toBe(false)
    expect(
      isMissingCustomer({ statusCode: 422, body: { detail: 'Customer does not exist.' } }),
    ).toBe(false)
  })

  // The status is compared strictly, so the string form a hand-rolled fetch
  // wrapper might carry does not silently classify.
  test('a stringified status does not match', () => {
    expect(isMissingCustomer({ statusCode: '422', body: NO_CUSTOMER_BODY })).toBe(false)
    expect(isMissingCustomer({ statusCode: '404', body: '' })).toBe(false)
  })
})
