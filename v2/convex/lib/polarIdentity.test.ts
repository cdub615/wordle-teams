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

  // '' and 42 are both dropped rather than passed along. An empty string would
  // reach normalizeId and a number would reach it as a non-string, and neither
  // can ever name a player — carrying them would only cost a wasted lookup and
  // make an "unresolvable" log line ambiguous.
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

  // A v1 uuid is a perfectly good candidate here. It is NOT filtered by shape —
  // this is the half of the deleted uuid regex that mattered, inverted: v1
  // accepted only uuids, and v2 must accept both namespaces and let the
  // database say which one this is. See resolvePlayerIdFor in ../billing.ts.
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
})
