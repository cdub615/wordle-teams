import { describe, expect, test } from 'vitest'
import { extractIdentityCandidates } from './polarIdentity.ts'

describe('extractIdentityCandidates', () => {
  test('prefers the customer external id, then the checkout metadata', () => {
    expect(
      extractIdentityCandidates({
        customer: { id: 'cus_1', external_id: 'k57abc' },
        metadata: { player_id: 'second' },
      }),
    ).toEqual({
      candidates: ['k57abc', 'second'],
      customerId: 'cus_1',
      customerExternalId: 'k57abc',
      checkoutId: null,
    })
  })

  // THE v1 SILENT-202 BUG. Polar matches a checkout to an EXISTING customer by
  // email and does not stamp external_customer_id onto it, so the value stays
  // on the checkout and the customer keeps its own null external id. This is
  // the shape of the body that produced HTTP 202 and no upgrade on v1's dev on
  // 2026-08-03.
  test('falls back to checkout metadata when the customer external id is null', () => {
    expect(
      extractIdentityCandidates({
        customer: { id: 'cus_1', external_id: null },
        metadata: { player_id: 'k57abc' },
        checkout_id: 'ch_1',
      }),
    ).toEqual({
      candidates: ['k57abc'],
      customerId: 'cus_1',
      // NULL WHILE candidates[0] RESOLVES — the shape the repair exists for.
      customerExternalId: null,
      checkoutId: 'ch_1',
    })
  })

  test('reports the checkout id when nothing else is present', () => {
    expect(
      extractIdentityCandidates({
        customer: { id: 'cus_1', external_id: null },
        checkout_id: 'ch_1',
      }),
    ).toEqual({
      candidates: [],
      customerId: 'cus_1',
      customerExternalId: null,
      checkoutId: 'ch_1',
    })
  })

  // Why '' and 42 are dropped rather than passed along: see asCandidate in
  // ./polarIdentity.ts.
  test('ignores non-string and empty candidates', () => {
    expect(
      extractIdentityCandidates({
        customer: { id: null, external_id: '' },
        metadata: { player_id: 42 },
      }),
    ).toEqual({
      candidates: [],
      customerId: null,
      // '' is not an external id Polar could have stamped, so there is nothing
      // on file and nothing to compare a resolved player against.
      customerExternalId: null,
      checkoutId: null,
    })
  })

  test('falls back to the bare customer_id when customer is absent', () => {
    expect(extractIdentityCandidates({ customer_id: 'cus_2' })).toEqual({
      candidates: [],
      customerId: 'cus_2',
      customerExternalId: null,
      checkoutId: null,
    })
  })

  // A v1 uuid is a perfectly good candidate: NOT filtered by shape, because
  // both namespaces are real. See the uuid-regex note in ./polarIdentity.ts.
  test('passes a v1 uuid through untouched', () => {
    const uuid = '11111111-1111-4111-8111-111111111111'
    expect(
      extractIdentityCandidates({ customer: { id: 'cus_1', external_id: uuid } }).candidates,
    ).toEqual([uuid])
  })

  test('an empty body yields nothing to try and nothing to repair', () => {
    expect(extractIdentityCandidates({})).toEqual({
      candidates: [],
      customerId: null,
      customerExternalId: null,
      checkoutId: null,
    })
  })

  // WHAT THE WEBHOOK'S REPAIR DECISION KEYS ON. The customer carries a stale v1
  // uuid here while the metadata carries the Convex id, so the two reads
  // disagree — and it is the disagreement, not the candidate order, that says
  // the customer still needs stamping. convex/http.ts compares the RESOLVED
  // player against customerExternalId for exactly this reason.
  test('reports the id the customer carries separately from the candidates', () => {
    const uuid = '11111111-1111-4111-8111-111111111111'
    const identity = extractIdentityCandidates({
      customer: { id: 'cus_1', external_id: uuid },
      metadata: { player_id: 'k57abc' },
    })
    expect(identity.candidates).toEqual([uuid, 'k57abc'])
    expect(identity.customerExternalId).toBe(uuid)
  })

  // THE WIRE SHAPE IS THE CONTRACT, pinned rather than assumed. Polar sends
  // snake_case and convex/http.ts hands over the verified JSON untouched,
  // because `@polar-sh/sdk`'s validateEvent — the thing that would have renamed
  // these — cannot run on Convex's default runtime (`ReferenceError: Buffer is
  // not defined`, measured 2026-08-27). A camelCase body is therefore not a
  // shape this endpoint can ever receive, and reading it would resolve nobody
  // and answer a silent 202. This test is what makes that a failure rather than
  // a surprise in production.
  test('reads the wire shape, not the SDK-renamed one', () => {
    const camel = extractIdentityCandidates({
      // @ts-expect-error — the renamed shape is exactly what does NOT arrive.
      customer: { id: 'cus_1', externalId: 'k57abc' },
      checkoutId: 'ch_1',
    })
    expect(camel.candidates).toEqual([])
    expect(camel.customerExternalId).toBeNull()
    expect(camel.checkoutId).toBeNull()
  })

  // Task 10 hands this a verified delivery's `data`. A body of literal `null`
  // parses to null rather than throwing, and a body with no `data` key yields
  // undefined — so both reach this function for real, and neither may TypeError
  // inside a webhook handler. Empty is the right answer: nothing to identify.
  test('an absent body yields an empty result rather than throwing', () => {
    const empty = {
      candidates: [],
      customerId: null,
      customerExternalId: null,
      checkoutId: null,
    }
    expect(extractIdentityCandidates(null)).toEqual(empty)
    expect(extractIdentityCandidates(undefined)).toEqual(empty)
  })
})
