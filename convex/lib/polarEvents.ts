/**
 * Maps a Polar subscription webhook event name onto a membership transition.
 *
 * wt-ksh.6 / wordle-teams-vx2. Ported from v1's `src/lib/polar/events.ts`. See
 * docs/superpowers/specs/2026-08-26-v2-phase5-polar-design.md.
 *
 * DEPENDENCY-FREE, like everything else in convex/lib/ — no Convex, no network,
 * no env, no I/O. It holds the only real logic in the billing integration, so
 * keeping it free of I/O is what makes every event name directly exercisable.
 *
 * It NAMES an effect rather than performing one. The functions that carry the
 * effects out need a database, and importing them would drag a Convex context
 * into a module whose whole value is not having one.
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
 * What the membership change implies for the player's teams.
 *
 * BOTH IMPLEMENTATIONS NOW EXIST in convex/billing.ts — 'apply-team-limit' is
 * `downgradeTeamRemovalFor`, 'release-invites' is `upgradeTeamInvitesFor`
 * (Task 6, wordle-teams-o4a) — and `processPolarEvent` in the same module is
 * the one place that turns a name here into a call. (This said only one of them
 * existed, which Task 6 falsified and Task 10 noticed.)
 *
 * IT STILL NAMES RATHER THAN PERFORMS, which is what keeps this module free of
 * a Convex context: the switch that maps these two strings onto those two
 * functions lives with the mutation, not here, and TypeScript makes a third
 * effect fail to compile there rather than silently pick a branch.
 */
export type MembershipEffect = 'release-invites' | 'apply-team-limit'

export type MembershipTransition = {
  // A subset of the schema's membershipStatus union. Narrowed on purpose: no
  // Polar event writes 'new', 'free' or 'cancelled'. Those three arrive only on
  // rows copied out of Supabase — `upsertMemberships` in convex/migrate.ts is
  // the only non-test writer of membershipStatus in the tree.
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
// is worth logging. isAcknowledgedEvent tells the two apart.
//
// These five are the events the Polar webhook is configured to send. That
// subscription list lives in the Polar dashboard, NOT in this repo — there is
// nothing in-tree to check it against, so treat this Map as the record of what
// we handle rather than proof of what arrives. `subscription.created` is
// deliberately absent: it fires when a subscription record is established,
// which is not the same as it being paid for and active. `subscription.active`
// is the grant signal.
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

/**
 * The membership transition an event implies, or null for no change.
 *
 * NULL MEANS TWO DIFFERENT THINGS and callers that log must tell them apart:
 * an event we recognise and deliberately act on (`subscription.canceled`,
 * `subscription.past_due`), and an event we have never heard of. Pair this with
 * isAcknowledgedEvent — a null here plus a false there is the only combination
 * worth logging as unhandled.
 *
 * A non-null result is FROZEN and SHARED — both grant events return the same
 * object. Callers must treat it as read-only and spread it rather than
 * assigning into it.
 */
export function mapEventToTransition(eventType: string): MembershipTransition | null {
  return TRANSITIONS.get(eventType) ?? null
}

/**
 * Whether this is an event we recognise at all, regardless of whether it
 * changes anything.
 *
 * A FUNCTION RATHER THAN AN EXPORTED SET, deliberately. The obvious shape is
 * `export const ACKNOWLEDGED_EVENTS: ReadonlySet<string>`, which is what v1 did
 * — but `ReadonlySet` is a compile-time fiction. At runtime a caller can
 * `.add()` to it, and `Object.freeze` does NOT prevent that: a frozen Set still
 * accepts `.add` (measured — size goes from 1 to 2, no throw), because the
 * entries live in internal slots rather than in frozen properties. Handing out
 * a corruptible classifier would undercut the whole reason this module keeps
 * its keys in a Map. Reading TRANSITIONS live also means this can never
 * disagree with mapEventToTransition.
 */
export function isAcknowledgedEvent(eventType: string): boolean {
  return TRANSITIONS.has(eventType)
}
