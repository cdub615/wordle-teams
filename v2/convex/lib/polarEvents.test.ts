import { describe, expect, test } from 'vitest'
import { ACKNOWLEDGED_EVENTS, mapEventToTransition } from './polarEvents.ts'

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

  // A null RESULT is ambiguous on its own — it is what both a recognised-but-
  // inert event and an event we have never heard of return. ACKNOWLEDGED_EVENTS
  // is the only thing that tells them apart, and the difference decides whether
  // the webhook logs an unhandled event or stays quiet.
  test('canceled and past_due are recognised, not merely unhandled', () => {
    expect(ACKNOWLEDGED_EVENTS.has('subscription.canceled')).toBe(true)
    expect(ACKNOWLEDGED_EVENTS.has('subscription.past_due')).toBe(true)
  })

  test('every event that maps to a transition is also acknowledged', () => {
    for (const event of [
      'subscription.active',
      'subscription.uncanceled',
      'subscription.revoked',
    ]) {
      expect(ACKNOWLEDGED_EVENTS.has(event)).toBe(true)
    }
    expect(ACKNOWLEDGED_EVENTS.size).toBe(5)
  })

  test('an unrecognised event yields null and is not acknowledged', () => {
    expect(mapEventToTransition('subscription.updated')).toBeNull()
    expect(ACKNOWLEDGED_EVENTS.has('subscription.updated')).toBe(false)
    expect(mapEventToTransition('')).toBeNull()
    expect(ACKNOWLEDGED_EVENTS.has('')).toBe(false)
  })

  // `subscription.created` fires when a subscription record is established,
  // which is not the same as it being paid for and active. `subscription.active`
  // is the grant signal, so `created` must not grant and must not even be
  // acknowledged.
  test('subscription.created is deliberately absent', () => {
    expect(mapEventToTransition('subscription.created')).toBeNull()
    expect(ACKNOWLEDGED_EVENTS.has('subscription.created')).toBe(false)
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
      expect(ACKNOWLEDGED_EVENTS.has(key)).toBe(false)
    }
  })

  // Both grant events share one object, so an unfrozen result means a caller
  // mutating what `subscription.active` returned silently corrupts what
  // `subscription.uncanceled` returns.
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
