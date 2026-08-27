import { describe, expect, test } from 'vitest'
import { extractIdentityCandidates } from './polarIdentity.ts'

describe('extractIdentityCandidates', () => {
  test('prefers the customer external id, then the checkout metadata', () => {
    expect(
      extractIdentityCandidates({
        customer: { id: 'cus_1', externalId: 'k57abc' },
        metadata: { player_id: 'second' },
      }),
    ).toEqual({ candidates: ['k57abc', 'second'], customerId: 'cus_1', checkoutId: null })
  })

  // THE v1 SILENT-202 BUG. Polar matches a checkout to an EXISTING customer by
  // email and does not stamp external_customer_id onto it, so the value stays
  // on the checkout and the customer keeps its own null external id. This is
  // the shape of the body that produced HTTP 202 and no upgrade on v1's dev on
  // 2026-08-03.
  test('falls back to checkout metadata when the customer external id is null', () => {
    expect(
      extractIdentityCandidates({
        customer: { id: 'cus_1', externalId: null },
        metadata: { player_id: 'k57abc' },
        checkoutId: 'ch_1',
      }),
    ).toEqual({ candidates: ['k57abc'], customerId: 'cus_1', checkoutId: 'ch_1' })
  })

  test('reports the checkout id when nothing else is present', () => {
    expect(
      extractIdentityCandidates({ customer: { id: 'cus_1', externalId: null }, checkoutId: 'ch_1' }),
    ).toEqual({ candidates: [], customerId: 'cus_1', checkoutId: 'ch_1' })
  })

  // Why '' and 42 are dropped rather than passed along: see asCandidate in
  // ./polarIdentity.ts.
  test('ignores non-string and empty candidates', () => {
    expect(
      extractIdentityCandidates({
        customer: { id: null, externalId: '' },
        metadata: { player_id: 42 },
      }),
    ).toEqual({ candidates: [], customerId: null, checkoutId: null })
  })

  test('falls back to customerId when customer is absent', () => {
    expect(extractIdentityCandidates({ customerId: 'cus_2' })).toEqual({
      candidates: [],
      customerId: 'cus_2',
      checkoutId: null,
    })
  })

  // A v1 uuid is a perfectly good candidate: NOT filtered by shape, because
  // both namespaces are real. See the uuid-regex note in ./polarIdentity.ts.
  test('passes a v1 uuid through untouched', () => {
    const uuid = '11111111-1111-4111-8111-111111111111'
    expect(
      extractIdentityCandidates({ customer: { id: 'cus_1', externalId: uuid } }).candidates,
    ).toEqual([uuid])
  })

  test('an empty body yields nothing to try and nothing to repair', () => {
    expect(extractIdentityCandidates({})).toEqual({
      candidates: [],
      customerId: null,
      checkoutId: null,
    })
  })

  // Task 10 hands this `await request.json()`. A request body of literal `null`
  // parses to null rather than throwing, and a body with no `data` key yields
  // undefined — so both reach this function for real, and neither may TypeError
  // inside a webhook handler. Empty is the right answer: nothing to identify.
  test('an absent body yields an empty result rather than throwing', () => {
    const empty = { candidates: [], customerId: null, checkoutId: null }
    expect(extractIdentityCandidates(null)).toEqual(empty)
    expect(extractIdentityCandidates(undefined)).toEqual(empty)
  })
})
