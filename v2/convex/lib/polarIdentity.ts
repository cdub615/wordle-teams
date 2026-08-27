/**
 * Pulls the identity CANDIDATES out of a Polar subscription webhook body.
 *
 * wt-ksh.6 / wordle-teams-7co. Ported from v1's `src/lib/polar/identity.ts`.
 * See docs/superpowers/specs/2026-08-26-v2-phase5-polar-design.md, decision F.
 *
 * DEPENDENCY-FREE, like everything else in convex/lib/ — no Convex, no network,
 * no env, no I/O. It returns strings to TRY; it does not resolve them, because
 * resolution needs `ctx.db`. That lives in `resolvePlayerIdFor` in
 * ../billing.ts, and this split is what lets every webhook body shape below be
 * exercised with plain vitest and no convex-test harness.
 *
 * WHY THIS IS NOT JUST `customer.externalId`:
 *
 * Polar matches a checkout to an EXISTING customer by email when one exists,
 * and does not stamp external_customer_id onto that customer — the value stays
 * on the checkout while the customer keeps its own (often null) external id.
 * Observed on v1's dev on 2026-08-03: a real subscription went active, the
 * checkout carried the id correctly, the customer had external_id null, the
 * webhook was accepted with HTTP 202, and NOBODY WAS UPGRADED. Silent, because
 * 202 is not an error.
 *
 * That matters more in v2 than it did in v1: at cutover every migrated user
 * already exists as a Polar customer under their email, which is exactly the
 * failing case.
 *
 * NO UUID VALIDATION. v1 tested every candidate against a uuid regex
 * (`src/lib/polar/identity.ts`'s `asPlayerId`). That cannot be ported — v2's
 * player id is a Convex `Id`, not a uuid — and porting it inverted would be
 * actively wrong too, because the uuids that DO arrive are real: v1's
 * `src/lib/polar/checkout.ts:22` set `externalCustomerId` to the v1 player id,
 * a Postgres uuid, and v2 stores that uuid as `players.legacyId`. Neither shape
 * can be rejected. "Is this real" is answered by looking the id up, which is
 * `resolvePlayerIdFor`'s job, not by a regex here.
 */

/**
 * The subset of a Polar subscription webhook body this module reads.
 *
 * Every field optional and every one nullable, because this is unvalidated
 * JSON off the wire — the signature check upstream proves it came from Polar,
 * not that it has the shape the SDK's types describe.
 */
export type SubscriptionIdentity = {
  customer?: { id?: string | null; externalId?: string | null } | null
  customerId?: string | null
  metadata?: Record<string, unknown> | null
  checkoutId?: string | null
}

export type IdentityCandidates = {
  /** Ordered cheapest-first. May be empty. */
  candidates: string[]
  /**
   * The Polar customer this event names, or null.
   *
   * Carried so a later step can REPAIR it — stamping the resolved id onto the
   * customer means the next event for the same person arrives with
   * customer.externalId populated and needs no fallback. That repair needs the
   * Polar SDK and is Task 9 (wordle-teams-p8m's sibling); NOTHING READS THIS
   * FIELD YET. It is returned now so the extraction never has to be revisited
   * to add it, and so the webhook body is read exactly once.
   */
  customerId: string | null
  /**
   * The checkout that created this subscription, or null.
   *
   * v1's third and last resort: `checkouts.get(checkoutId).externalCustomerId`
   * still holds the value even when the customer does not. That lookup is one
   * Polar API call, so it belongs in an action, and it too is Task 9 — NO
   * CALLER READS THIS YET either. Same reasoning as `customerId`: extracted
   * here so the last-resort path has its input ready.
   */
  checkoutId: string | null
}

// Anything that is not a non-empty string can never name a player, so it is
// dropped rather than passed along. '' would reach normalizeId and a number
// would reach it as a non-string; carrying either costs a wasted lookup and
// makes "no candidate resolved" ambiguous when it is logged.
const asCandidate = (value: unknown): string | null =>
  typeof value === 'string' && value.length > 0 ? value : null

/**
 * The identity candidates in the order they should be tried.
 *
 * Cheapest first, and both of these are free — they are already in the body.
 * Neither is trusted: each is a string to hand to `resolvePlayerIdFor`, which
 * decides whether it names a live player.
 */
export function extractIdentityCandidates(data: SubscriptionIdentity): IdentityCandidates {
  const candidates: string[] = []

  // 1. The happy path: Polar applied our external id to the customer.
  const fromCustomer = asCandidate(data.customer?.externalId)
  if (fromCustomer) candidates.push(fromCustomer)

  // 2. Metadata we set on the checkout ourselves (v1's checkout.ts:27 sets
  //    `metadata: { player_id: playerId }`, and v2's checkout will do the
  //    same). Costs no API call, and survives the customer-match case above.
  const fromMetadata = asCandidate(data.metadata?.player_id)
  if (fromMetadata) candidates.push(fromMetadata)

  return {
    candidates,
    // `customer.id` when the body embeds the customer, `customerId` when it
    // only references one. v1 read the same pair, in the same order.
    customerId: asCandidate(data.customer?.id) ?? asCandidate(data.customerId),
    checkoutId: asCandidate(data.checkoutId),
  }
}
