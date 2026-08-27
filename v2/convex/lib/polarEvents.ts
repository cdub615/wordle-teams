/**
 * Maps a Polar subscription webhook event name onto a membership transition.
 *
 * Ported from v1's `src/lib/polar/events.ts`. Deliberately pure — no Convex, no
 * network, no env, no I/O. It holds the only real logic in the billing
 * integration, so keeping it free of I/O is what makes every event name
 * directly exercisable.
 *
 * It NAMES an effect rather than performing one. The functions that carry the
 * effects out live in `convex/billing.ts` and need a database; importing them
 * here would drag a Convex context into a module whose whole value is not
 * having one.
 *
 * THE IMPORTANT PART: Lemon Squeezy's single `subscription_cancelled` both set
 * membership to 'cancelled' and stripped the player's teams. Polar splits that
 * one moment in two:
 *
 *   subscription.canceled  the customer SCHEDULED a cancellation. They keep
 *                          paid access until the end of the period they have
 *                          already paid for.
 *   subscription.revoked   access has actually ended.
 *
 * Downgrading on `canceled` would therefore delete a paying customer's teams
 * weeks before their period expires. Only `revoked` removes access.
 */

/**
 * What the membership change implies for the player's teams. `billing.ts` owns
 * the implementations; this module only says which one applies.
 */
export type MembershipEffect = 'release-invites' | 'apply-team-limit'

export type MembershipTransition = {
  // A subset of the schema's membershipStatus union. Narrowed on purpose: no
  // Polar event writes 'new', 'free' or 'cancelled'. Those three arrive only on
  // rows copied out of Supabase — as of this commit `migrate.ts:695` is the
  // only non-test writer of membershipStatus in the tree.
  status: 'pro' | 'expired'
  effect: MembershipEffect
}

// Frozen because both grant events share one object. Without this, a caller
// mutating the result of `subscription.active` would silently corrupt
// `subscription.uncanceled` too.
const GRANT: MembershipTransition = Object.freeze({
  status: 'pro',
  effect: 'release-invites',
})
const REVOKE: MembershipTransition = Object.freeze({
  status: 'expired',
  effect: 'apply-team-limit',
})

// A Map rather than an object literal, specifically because the key is an
// arbitrary string arriving from outside. A `Record` lookup walks the prototype
// chain, so 'toString' would return a Function and '__proto__' would return an
// object — both truthy, both violating this module's contract that anything
// unrecognised yields null, and both reaching the database as an `undefined`
// membership status. A Map has no prototype chain.
//
// A null VALUE means "recognised, but deliberately no membership change" —
// distinct from an event we do not recognise at all, which also yields null but
// is worth logging. Use ACKNOWLEDGED_EVENTS below to tell the two apart.
const TRANSITIONS = new Map<string, MembershipTransition | null>([
  ['subscription.active', GRANT],
  ['subscription.uncanceled', GRANT],

  // Paid through period end — see the note above. Access ends on revoked, not
  // here.
  ['subscription.canceled', null],

  // Payment failed but is recoverable by updating the payment method.
  // Downgrading here would punish a customer for an expired card before Polar
  // has finished retrying.
  ['subscription.past_due', null],

  ['subscription.revoked', REVOKE],
])

// The five events the Polar webhook endpoint subscribes to.
// `subscription.created` is deliberately absent: it fires when a subscription
// record is established, which is not the same as it being paid for and active.
// `subscription.active` is the grant signal.
export const ACKNOWLEDGED_EVENTS: ReadonlySet<string> = new Set(TRANSITIONS.keys())

export function mapEventToTransition(eventType: string): MembershipTransition | null {
  return TRANSITIONS.get(eventType) ?? null
}
