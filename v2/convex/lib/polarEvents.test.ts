import { describe, expect, test } from 'vitest'
import { isAcknowledgedEvent, mapEventToTransition } from './polarEvents.ts'

describe('mapEventToTransition', () => {
  test('grants pro on active and uncanceled', () => {
    for (const event of ['subscription.active', 'subscription.uncanceled']) {
      expect(mapEventToTransition(event)).toEqual({ status: 'pro', effect: 'release-invites' })
    }
  })

  test('revokes on revoked', () => {
    expect(mapEventToTransition('subscription.revoked')).toEqual({
      status: 'expired',
      effect: 'apply-team-limit',
    })
  })

  // The whole reason this module exists. Lemon Squeezy's single
  // `subscription_cancelled` both cancelled and stripped access. Polar splits
  // that moment in two: `canceled` means the customer SCHEDULED a cancellation
  // and keeps paid access to the end of the period they already paid for;
  // `revoked` means access actually ended. Conflating them strips a paying
  // customer's teams weeks before the period they paid for expires.
  //
  // `past_due` is the same shape of mistake: the payment failed but is
  // recoverable by updating the card, so downgrading punishes a customer for an
  // expired card before Polar has finished retrying.
  test('canceled and past_due change nothing', () => {
    expect(mapEventToTransition('subscription.canceled')).toBeNull()
    expect(mapEventToTransition('subscription.past_due')).toBeNull()
  })

  test('an unrecognised event yields null', () => {
    expect(mapEventToTransition('subscription.updated')).toBeNull()
    expect(mapEventToTransition('')).toBeNull()
  })

  // `subscription.created` fires when a subscription record is established,
  // which is not the same as it being paid for and active. `subscription.active`
  // is the grant signal, so `created` must not grant and must not even be
  // acknowledged.
  test('subscription.created is deliberately absent', () => {
    expect(mapEventToTransition('subscription.created')).toBeNull()
    expect(isAcknowledgedEvent('subscription.created')).toBe(false)
  })

  // The key is an arbitrary string arriving from a webhook. A `Record` lookup
  // walks the prototype chain, so 'toString' would return a Function and
  // '__proto__' an object — both truthy, both violating this module's contract
  // that anything unrecognised yields null, and both capable of reaching the
  // database as an `undefined` membership status. A Map has no prototype chain;
  // this test is what pins that choice.
  test('prototype keys yield null and are not acknowledged', () => {
    for (const key of ['toString', '__proto__', 'constructor', 'valueOf']) {
      expect(mapEventToTransition(key)).toBeNull()
      expect(isAcknowledgedEvent(key)).toBe(false)
    }
  })

  // Both grant events share ONE object, and that sharing is deliberate contract
  // rather than incidental: it is why the object has to be frozen at all. The
  // identity assertion is what catches an "unshare" edit that gives each event
  // its own object — such an edit is harmless today but quietly removes the
  // reason the freeze exists, so the next person deletes the freeze too.
  test('the shared grant object is frozen', () => {
    const active = mapEventToTransition('subscription.active')
    const uncanceled = mapEventToTransition('subscription.uncanceled')
    expect(active).toBe(uncanceled)
    expect(Object.isFrozen(active)).toBe(true)
  })

  test('the revoke transition is frozen', () => {
    expect(Object.isFrozen(mapEventToTransition('subscription.revoked'))).toBe(true)
  })
})

describe('isAcknowledgedEvent', () => {
  // A null RESULT from mapEventToTransition is ambiguous on its own — it is
  // what both a recognised-but-inert event and an event we have never heard of
  // return. This is the only thing that tells them apart, and the difference
  // decides whether the webhook logs an unhandled event or stays quiet.
  test('canceled and past_due are recognised, not merely unhandled', () => {
    expect(mapEventToTransition('subscription.canceled')).toBeNull()
    expect(isAcknowledgedEvent('subscription.canceled')).toBe(true)
    expect(mapEventToTransition('subscription.past_due')).toBeNull()
    expect(isAcknowledgedEvent('subscription.past_due')).toBe(true)
  })

  test('every event that maps to a transition is also acknowledged', () => {
    for (const event of [
      'subscription.active',
      'subscription.uncanceled',
      'subscription.revoked',
    ]) {
      expect(mapEventToTransition(event)).not.toBeNull()
      expect(isAcknowledgedEvent(event)).toBe(true)
    }
  })

  // Pins the boundary of what we handle. There is no exported set to count any
  // more, so exactness is pinned by probe instead: every OTHER subscription
  // event Polar emits, plus the adjacent namespaces, must be unacknowledged. A
  // sixth entry sneaking into TRANSITIONS is most likely to be one of these.
  test('other Polar events and adjacent namespaces are not acknowledged', () => {
    for (const event of [
      'subscription.created',
      'subscription.updated',
      'order.paid',
      'order.created',
      'checkout.created',
      'checkout.updated',
      'customer.created',
      'customer.updated',
      'benefit_grant.created',
      'benefit_grant.revoked',
    ]) {
      expect(isAcknowledgedEvent(event)).toBe(false)
      expect(mapEventToTransition(event)).toBeNull()
    }
  })

  test('the empty string is not acknowledged', () => {
    expect(isAcknowledgedEvent('')).toBe(false)
  })

  // The counterpart to the prototype-key test above: `Map.prototype.has` does
  // not walk a prototype chain either, so a Map method name is not accidentally
  // "recognised".
  test('Map method names are not acknowledged', () => {
    for (const key of ['has', 'get', 'set', 'delete', 'size', 'keys', 'hasOwnProperty']) {
      expect(isAcknowledgedEvent(key)).toBe(false)
      expect(mapEventToTransition(key)).toBeNull()
    }
  })
})
