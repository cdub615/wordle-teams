import type { member_status } from '@/lib/types'

// Maps Polar subscription webhook events onto membership transitions.
// See docs/superpowers/specs/2026-07-31-polar-migration-design.md.
//
// This module is deliberately pure — no Supabase, no network, no env. It holds the only real
// logic in the billing integration, so keeping it free of I/O is what makes it possible to
// exercise every event name directly.
//
// THE IMPORTANT PART: Lemon Squeezy's `subscription_cancelled` set membership to 'cancelled'
// and stripped the player's teams immediately. Polar splits that single moment in two:
//
//   subscription.canceled  the customer SCHEDULED a cancellation. They keep paid access
//                          until the end of the period they already paid for.
//   subscription.revoked   access has actually ended.
//
// Downgrading on `canceled` would therefore delete a paying customer's teams weeks before
// their period expires. Only `revoked` removes access.

export type MembershipRpc = 'handle_upgrade_team_invites' | 'handle_downgrade_team_removal'

export type MembershipTransition = {
  status: member_status
  rpc: MembershipRpc | null
}

// Frozen because both grant events share one object. Without this, a caller mutating the
// result of `subscription.active` would silently corrupt `subscription.uncanceled` too.
const GRANT: MembershipTransition = Object.freeze({ status: 'pro', rpc: 'handle_upgrade_team_invites' })
const REVOKE: MembershipTransition = Object.freeze({ status: 'expired', rpc: 'handle_downgrade_team_removal' })

// A Map rather than an object literal, specifically because the key is an arbitrary string
// arriving from outside. A `Record` lookup walks the prototype chain, so 'toString' would
// return a Function and '__proto__' would return an object — both truthy, both violating this
// module's contract that anything unrecognized yields null, and both reaching the database as
// an `undefined` membership status. A Map has no prototype chain.
//
// A null value means "recognized, but deliberately no membership change" — distinct from an
// event we do not recognize at all, which also yields null but is worth logging. Use
// ACKNOWLEDGED_EVENTS below to tell the two apart.
const TRANSITIONS = new Map<string, MembershipTransition | null>([
  ['subscription.active', GRANT],
  ['subscription.uncanceled', GRANT],

  // Paid through period end — see the note above. Access ends on revoked, not here.
  ['subscription.canceled', null],

  // Payment failed but is recoverable by updating the payment method. Downgrading here would
  // punish a customer for an expired card before Polar has finished retrying.
  ['subscription.past_due', null],

  ['subscription.revoked', REVOKE],
])

// The five events the Polar webhook endpoints subscribe to. `subscription.created` is
// deliberately absent: it fires when a subscription record is established, which is not the
// same as it being paid for and active. `subscription.active` is the grant signal.
export const ACKNOWLEDGED_EVENTS: ReadonlySet<string> = new Set(TRANSITIONS.keys())

export function mapEventToTransition(eventType: string): MembershipTransition | null {
  return TRANSITIONS.get(eventType) ?? null
}
