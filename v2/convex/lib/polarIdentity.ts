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
 * WHY THIS IS NOT JUST `customer.external_id`:
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
 *
 * THE OUTBOUND MIRROR LIVES IN convex/polar.ts. Decision F is a rule about both
 * directions, and the same two namespaces apply when this app ASKS Polar about
 * a player rather than being told about one: `externalIdsFor` builds the
 * ordered names to try, and the customer portal walks them. Only the inbound
 * half was written down at first, and the missing half was a real bug —
 * wordle-teams-1m6, where a migrated subscriber asked for by Convex id alone
 * was told they had no billing account. Keep the two ends in step.
 */

/**
 * The subset of a Polar subscription webhook body this module reads.
 *
 * Every field optional and every one nullable, because this is unvalidated
 * JSON off the wire — the signature check upstream proves it came from Polar,
 * not that it has the shape the SDK's types describe.
 *
 * snake_case, WHICH IS THE SHAPE THAT ACTUALLY ARRIVES, and it is worth saying
 * why the camelCase one is not on offer. Polar sends `external_id`,
 * `customer_id` and `checkout_id` on the wire; `@polar-sh/sdk`'s `validateEvent`
 * renames them while it verifies, and v1 reads the renamed shape
 * (`src/lib/polar/identity.ts`) because v1 runs on Node.
 *
 * v2 CANNOT RUN `validateEvent`. Measured on the local Convex backend (Task 10,
 * 2026-08-27): it answers `ReferenceError: Buffer is not defined`, because its
 * first line is `Buffer.from(secret, 'utf-8')` and Convex's default runtime has
 * no Buffer. So convex/http.ts verifies through `standardwebhooks` directly —
 * the same library, the same bytes, minus that one line — and what a verified
 * delivery hands back is `JSON.parse` of the body, untouched. Renaming it back
 * would mean either shipping a Buffer shim into an isolate that also serves the
 * Better Auth routes, or re-running the SDK's per-event zod schemas, whose
 * strictness would turn any future field Polar adds into a rejected delivery.
 *
 * `metadata.player_id` IS THE ONE FIELD THAT DOES NOT MOVE: metadata keys are
 * ours (convex/polar.ts's checkout sets `player_id`, as v1's did) and no
 * renaming touches them.
 */
export type SubscriptionIdentity = {
  customer?: { id?: string | null; external_id?: string | null } | null
  customer_id?: string | null
  metadata?: Record<string, unknown> | null
  checkout_id?: string | null
}

export type IdentityCandidates = {
  /** Ordered cheapest-first. May be empty. */
  candidates: string[]
  /**
   * The Polar customer this event names, or null.
   *
   * Carried so a later step can REPAIR it — stamping the resolved id onto the
   * customer means the next event for the same person arrives with
   * customer.external_id populated and needs no fallback. That repair needs the
   * Polar SDK, and as of Task 9 (wordle-teams-l1v) it EXISTS:
   * `internal.polar.repairCustomerExternalId` takes exactly this kind of value,
   * and the customer portal already drives it after a legacy-id hit. Task 10
   * (wordle-teams-p8m) joined the two: the webhook in convex/http.ts passes this
   * field, paired with `customerExternalId` below, which is what decides whether
   * there is anything to repair.
   */
  customerId: string | null
  /**
   * The external id the Polar customer ALREADY CARRIES, or null.
   *
   * DELIBERATELY REDUNDANT with `candidates[0]` whenever that one came from the
   * customer, and the redundancy is the whole point. `candidates` answers "who
   * might this be"; this answers "what does Polar have on file". They come
   * apart in exactly the case that cost v1 an upgrade on 2026-08-03: the
   * customer matched by email carries NULL while the checkout metadata carries
   * the right id, so `candidates[0]` IS the resolved player and comparing
   * against it would call that customer healed and never repair it. Comparing
   * against this field repairs it.
   *
   * Not a fourth candidate: it is already candidate 1 when it is a string, and
   * pushing it twice would buy a second identical lookup.
   */
  customerExternalId: string | null
  /**
   * The checkout that created this subscription, or null.
   *
   * v1's third and last resort: `checkouts.get(checkoutId).externalCustomerId`
   * still holds the value even when the customer does not. That lookup is one
   * Polar API call, so it belongs in an action, and Task 9 (wordle-teams-l1v)
   * added it as `internal.polar.fetchCheckoutExternalId`. Task 10
   * (wordle-teams-p8m) is the webhook that passes it: convex/http.ts calls that
   * action only when `candidates` resolved nothing AND this is non-null, which
   * is what keeps the one API call off the happy path.
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
 *
 * TAKES NULL, because the docblock above is only honest if it does. Task 10
 * hands this the `data` of a verified delivery, and a request body of literal
 * `null` parses to `null` rather than throwing; a body with no `data` key
 * yields `undefined`. Both mean "nothing to identify", which is an empty
 * result, not a TypeError inside a webhook handler.
 *
 * THE VERIFIED WIRE JSON, NOT AN SDK-PARSED EVENT, is what convex/http.ts
 * passes — `verified.data`, straight off `standardwebhooks`. See the note on
 * SubscriptionIdentity for the measurement that settled it. Handing this a
 * camelCase event would find none of these fields and resolve nobody, which is
 * why the type names them rather than accepting both shapes: a body that
 * matches neither is a silent 202, and silent 202s are what this whole module
 * exists to stop.
 */
export function extractIdentityCandidates(
  data: SubscriptionIdentity | null | undefined,
): IdentityCandidates {
  const candidates: string[] = []

  // 1. The happy path: Polar applied our external id to the customer.
  const fromCustomer = asCandidate(data?.customer?.external_id)
  if (fromCustomer) candidates.push(fromCustomer)

  // 2. Metadata we set on the checkout ourselves (v1's checkout.ts:27 sets
  //    `metadata: { player_id: playerId }`, and v2's checkout will do the
  //    same). Costs no API call, and survives the customer-match case above.
  const fromMetadata = asCandidate(data?.metadata?.player_id)
  if (fromMetadata) candidates.push(fromMetadata)

  return {
    candidates,
    // `customer.id` when the body embeds the customer, `customerId` when it
    // only references one. v1 read the same pair, in the same order.
    customerId: asCandidate(data?.customer?.id) ?? asCandidate(data?.customer_id),
    // The same read as candidate 1, reported separately rather than inferred
    // back out of `candidates` — see the field's note.
    customerExternalId: fromCustomer,
    checkoutId: asCandidate(data?.checkout_id),
  }
}
