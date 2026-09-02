import { httpRouter } from 'convex/server'
import { Webhook, WebhookVerificationError } from 'standardwebhooks'
import { httpAction } from './_generated/server'
import { internal } from './_generated/api'
import { authComponent, createAuth } from './auth.ts'
import { extractIdentityCandidates } from './lib/polarIdentity.ts'
import type { ActionCtx } from './_generated/server'
import type { Id } from './_generated/dataModel'
import type { IdentityCandidates, SubscriptionIdentity } from './lib/polarIdentity.ts'

/**
 * Every HTTP endpoint this deployment exposes.
 *
 * Two of them now: Better Auth's routes, and the Polar webhook receiver
 * (wt-ksh.6 / wordle-teams-p8m), which ports v1's `src/app/api/webhook/route.ts`
 * plus the transport half of `src/lib/polar/webhook.ts`.
 */
const http = httpRouter()
authComponent.registerRoutes(http, createAuth)

/**
 * A verified Polar delivery, as much of it as this endpoint reads.
 *
 * `Webhook.verify` is typed `unknown` because it returns `JSON.parse` of a body
 * only the signature vouches for — the signature proves the bytes came from
 * Polar, not that they have any particular shape. So `type` is `unknown` and is
 * checked at runtime rather than declared to be a string, and `data` is the
 * same all-optional shape lib/polarIdentity.ts reads.
 *
 * NOT the SDK's `WebhookSubscriptionActivePayload` union: nothing here can
 * produce one — see the module note on why `validateEvent` is unusable on this
 * runtime — and claiming the type without running the parse that earns it would
 * be a lie the compiler would then enforce downstream.
 */
type PolarDelivery = { type?: unknown; data?: SubscriptionIdentity | null }

/**
 * The Polar webhook receiver.
 *
 * A RAW httpAction, NOT `@polar-sh/better-auth`. Decision I, measured on
 * wordle-teams-07n: the plugin awaits the handler, so it does not
 * auto-acknowledge — the original premise of this phase was wrong about that —
 * but every handler error becomes `APIError('BAD_REQUEST')`, and `BAD_REQUEST`
 * maps to 400 (`better-call@1.3.7`, `dist/error.mjs:56`). An endpoint that can
 * only answer 200 or 400 can never ask Polar to redeliver, and that redelivery
 * is the whole of this phase's idempotency design.
 *
 * THE STATUS CODE IS THE PROTOCOL, which is why it is worth stating as a table
 * rather than leaving to be read out of the control flow:
 *
 *   secret not configured   500  cannot verify anything; the retry succeeds
 *                                once the variable is set
 *   missing webhook-id      400  malformed; a redelivery carries the same
 *                                headers, so retrying cannot fix it
 *   bad signature           403  not ours
 *   unparseable payload     400  not JSON, or no `type` to act on; a
 *                                redelivery carries the same bytes
 *   checkout lookup failed  500  transient. The last-resort call could not be
 *                                ASKED, which is not an answer of "nobody"
 *   no resolvable player    202  every candidate was tried and named nobody,
 *                                so retrying can NEVER succeed — see below
 *   already processed       200  a genuine replay
 *   processed               200
 *   processing threw        500  transient; Polar retries, and unlike v1 the
 *                                retry actually reprocesses
 *
 * 202 RATHER THAN 500 FOR AN UNRESOLVABLE EVENT is the one that is easy to get
 * wrong. A 500 there puts Polar into an endless redelivery loop over an event
 * this app can do nothing with — for instance one belonging to a different
 * integration on the same Polar organization. It is not a silent success
 * either: v1's 2026-08-03 incident was a 202 that SHOULD have resolved, and
 * what fixed it was the fallback chain below, not a louder status code.
 *
 * WHICH IS WHY THE 202 IS SAID OF AN ANSWER AND NEVER OF A FAILURE. "Retrying
 * can never succeed" is true once every candidate has been TRIED and named
 * nobody. It is false when the fallback's one Polar call FAILS — a 5xx, a 429,
 * a network blip, an unset POLAR_ACCESS_TOKEN — and answering 202 there would
 * discard the delivery permanently and without even an audit row, in exactly
 * the case the fallback exists for. That call is wrapped below and answers 500.
 *
 * VERIFIED THROUGH `standardwebhooks` DIRECTLY, NOT THROUGH THE POLAR SDK's
 * `validateEvent`, AND THAT IS A MEASUREMENT RATHER THAN A PREFERENCE. v1 uses
 * `validateEvent` (`src/app/api/webhook/route.ts`) and the plan for this task
 * said to port it. Run on the local Convex backend, it answers
 * `ReferenceError: Buffer is not defined` — its first line is
 * `Buffer.from(secret, 'utf-8').toString('base64')` and Convex's default
 * runtime has no Buffer. The failure is invisible to the test suite, because
 * vitest's edge-runtime environment DOES define Buffer (measured both ways),
 * and it is invisible to `npx convex codegen`, whose push analyses modules
 * without running a request. Left in, every delivery would have answered 400.
 *
 * `standardwebhooks@1.0.0` is what `@polar-sh/sdk@0.49.0` verifies through
 * anyway — the SDK's helper is that library plus a Buffer call plus a zod parse
 * — so this is the same code doing the same work on the same bytes. It is a
 * direct dependency now rather than a transitive one, at the version already in
 * the lockfile.
 *
 * TWO THINGS FOLLOW, both real:
 *   - The verified value is `JSON.parse` of the body: the WIRE shape,
 *     snake_case, not the SDK's renamed one. lib/polarIdentity.ts reads that
 *     shape and says so.
 *   - Nothing validates the payload against a per-event schema any more. That
 *     is a feature here: this endpoint acts on `type` and four identity fields,
 *     and a strict parse would turn any field Polar adds into a rejected
 *     delivery for a body this app would otherwise handle correctly.
 *
 * NO `'use node'`, WHICH IS NOT THE ALTERNATIVE ANYWAY — Convex requires the
 * HTTP router on the default runtime, and a `'use node'` module may hold
 * actions only, so the Better Auth routes above could not live beside it. Task
 * 9 measured the rest: the directive breaks the local push on this machine.
 * `standardwebhooks` reaches only `@stablelib/base64` and `fast-sha256`, both
 * pure JS, and needs no Node built-in — the run above is the proof.
 */
http.route({
  path: '/polar/webhook',
  method: 'POST',
  handler: httpAction(async (ctx, request) => {
    // LOUD, NOT LENIENT, AND THE SILENT ALTERNATIVE IS MEASURED. This check was
    // written when POLAR_WEBHOOK_SECRET was set on no deployment; it IS set on
    // beta now — measured 2026-09-01 on fabulous-goldfish-949, where the live
    // endpoint answers a missing webhook-id with 400 rather than the 500 an
    // unset secret produces (wordle-teams-3bl, wordle-teams-721e). The reasoning
    // below is unchanged and is why the check stays. Without it
    // the missing value would reach `TextEncoder.encode`, which treats
    // `undefined` as its default argument and returns an EMPTY Uint8Array;
    // `new Webhook` accepts that (its `if (!secret)` guard sees a truthy
    // object), and every delivery would then be signature-checked against an
    // empty key and rejected 403 — an unconfigured deployment permanently
    // disguised as an attacker. An empty-string secret does the same, which is
    // why `!secret` rather than `secret === undefined`.
    //
    // 500 rather than 403 or 400 because it is this deployment that is broken,
    // and the redelivery genuinely will succeed once the variable is set.
    const secret = process.env.POLAR_WEBHOOK_SECRET
    if (!secret) {
      console.error('[polar] POLAR_WEBHOOK_SECRET is not set on this deployment')
      return new Response('Webhook secret not configured', { status: 500 })
    }

    const rawBody = await request.text()
    const headers = Object.fromEntries(request.headers.entries())

    // READ FROM THE HEADER, NOT THE BODY, and read it BEFORE verifying.
    //
    // Standard Webhooks puts the delivery id in `webhook-id`, redeliveries
    // reuse it, and that reuse is the only thing that makes replay detection
    // possible. It is NOT a uuid — they look like
    // msg_2KWPBgLlAfxdpx2AI54pPJ85f4W — and v1 lost a day to a uuid column that
    // rejected them, returned 500, and put Polar into an infinite retry loop
    // against an event that could never be stored.
    //
    // Before verifying, because `standardwebhooks` folds a missing header into
    // the same WebhookVerificationError it uses for a bad signature (measured:
    // `dist/index.js`, "Missing required headers"), and this endpoint's
    // contract distinguishes the two — 400 for something no redelivery can fix,
    // 403 for something that is not ours. Nothing is trusted this early: an
    // absent header is the only thing being read.
    const webhookId = headers['webhook-id']
    if (!webhookId) return new Response('Missing webhook-id', { status: 400 })

    let event: PolarDelivery
    try {
      // THE KEY IS THE SECRET'S UTF-8 BYTES, which is what makes this
      // byte-identical to the SDK. `validateEvent` base64-encodes the secret and
      // hands that over, and `standardwebhooks` base64-DECODES it straight back
      // to these same bytes — the round trip is the only thing the Buffer call
      // was for. Passing the bytes with `format: 'raw'` skips it.
      //
      // NOT `new Webhook(secret, { format: 'raw' })` with the string: that path
      // does `Uint8Array.from(s, c => c.charCodeAt(0))`, which is latin-1, so a
      // non-ASCII secret would key differently from every other Polar client.
      const webhook = new Webhook(new TextEncoder().encode(secret), { format: 'raw' })
      event = webhook.verify(rawBody, headers) as PolarDelivery
    } catch (error) {
      if (error instanceof WebhookVerificationError) {
        // Covers a wrong signature, a signature over different bytes, and a
        // timestamp outside the five-minute tolerance — all of them "not ours".
        console.warn('[polar] rejected a webhook with an invalid signature', { webhookId })
        return new Response('Invalid signature', { status: 403 })
      }

      // Anything else `verify` can raise, which in practice means a body that
      // is not JSON: the parse runs only after the signature has matched.
      // Retrying redelivers the same bytes, so 400 rather than 500. Distinct
      // from an event this APP does not handle: those parse fine, get stored,
      // and are acknowledged 200 (processPolarEvent logs them).
      console.error('[polar] could not parse a verified webhook', { webhookId }, error)
      return new Response('Invalid payload', { status: 400 })
    }

    // An event with no `type` cannot be mapped, stored under a meaningful name,
    // or acted on. It is signed, so it is ours, and no redelivery will grow the
    // field.
    if (typeof event?.type !== 'string') {
      console.error('[polar] verified webhook carried no event type', { webhookId })
      return new Response('Invalid payload', { status: 400 })
    }

    // THE VERIFIED WIRE JSON. Polar sends snake_case and nothing here renames
    // it — see the module note above and lib/polarIdentity.ts.
    const identity = extractIdentityCandidates(event.data)

    let playerId = await ctx.runQuery(internal.billing.resolvePlayerId, {
      candidates: identity.candidates,
    })

    // THE LAST RESORT, AND ONLY AFTER THE FREE ONES. The checkout that created
    // this subscription still carries the external id even when the customer
    // does not — one Polar API call, so it is kept off the happy path.
    if (!playerId && identity.checkoutId) {
      let fromCheckout: string | null
      try {
        fromCheckout = await ctx.runAction(internal.polar.fetchCheckoutExternalId, {
          checkoutId: identity.checkoutId,
        })
      } catch (error) {
        // A FAILED LOOKUP IS NOT AN ANSWER OF "NOBODY". Falling through to the
        // 202 below would tell Polar never to redeliver, over a Polar 5xx, a
        // 429, a network blip or an unset POLAR_ACCESS_TOKEN — and the 202 path
        // stores no audit row, so the upgrade would be gone with no trace. It
        // would land on exactly the customers this fallback exists for.
        // `fetchCheckoutExternalId` returns null for the cases a redelivery
        // genuinely cannot fix and throws for the rest; this is the rest.
        console.error(
          '[polar] checkout lookup failed; asking Polar to redeliver',
          { webhookId, checkoutId: identity.checkoutId },
          error,
        )
        return new Response('Checkout lookup failed', { status: 500 })
      }

      if (fromCheckout) {
        playerId = await ctx.runQuery(internal.billing.resolvePlayerId, {
          candidates: [fromCheckout],
        })
      }
    }

    if (!playerId) {
      // Not an error: see the 202 note above. Logged at warn because the one
      // case that is NOT routine — a subscriber of ours who fails to resolve —
      // is invisible otherwise, which is exactly how v1's silent 202 survived.
      console.warn('[polar] no player resolved for a Polar event', {
        webhookId,
        eventName: event.type,
        candidates: identity.candidates.length,
      })
      return new Response('Accepted, no matching player', { status: 202 })
    }

    const payload = {
      webhookId,
      eventName: event.type,
      // THE WHOLE VERIFIED DELIVERY, not just `data`, and not a re-parse of
      // rawBody: `verify` already returned `JSON.parse(rawBody)`, so this IS
      // what Polar sent, which is what an audit trail is for. It is plain JSON
      // — every value came out of JSON.parse — so it survives `v.any()`. (The
      // SDK's parsed event would NOT: it turns every timestamp into a `Date`,
      // and Convex has no date value.)
      body: event,
      playerId,
    }

    try {
      const outcome = await ctx.runMutation(internal.billing.processPolarEvent, payload)

      // SELF-HEAL AFTER SUCCESS, exactly as the portal does. Deliberately not
      // before: nothing about tidying up should run for an event this
      // deployment then failed to apply.
      await repairExternalId(ctx, identity, playerId)

      return new Response(outcome, { status: 200 })
    } catch (error) {
      const processingError = error instanceof Error ? error.message : String(error)
      console.error('[polar] failed to process webhook event', { webhookId }, error)

      // The mutation rolled back, taking the audit row with it — so the row is
      // written here, outside the failed transaction, with processed:false.
      // Wrapped because the 500 below is the part Polar acts on: losing the
      // audit row is bad, and turning that loss into a different failure would
      // not get it back.
      try {
        await ctx.runMutation(internal.billing.recordWebhookFailure, {
          ...payload,
          processingError,
        })
      } catch (recordError) {
        console.error('[polar] could not record the webhook failure', { webhookId }, recordError)
      }

      // 500 asks Polar to redeliver, and unlike v1 the redelivery genuinely
      // reprocesses: the guard in processPolarEvent keys on `processed`, and
      // the row this just wrote is not.
      return new Response('Failed to process webhook event', { status: 500 })
    }
  }),
})

/**
 * Stamp the resolved player id onto the Polar customer, when it is not already
 * there.
 *
 * THE SAME DECISION THE PORTAL MAKES, from the other direction. `polar.ts`'s
 * getCustomerPortalUrl repairs when the identity that WON was not the Convex
 * id; here the equivalent question is whether the customer already carries it.
 *
 * NOT "did candidate 1 win". That test looks equivalent and is wrong in the
 * case the repair exists for: a customer Polar matched by email carries a NULL
 * external id while the checkout metadata carries the right one, so candidate 1
 * IS the resolved player and the customer that most needs stamping would never
 * be stamped. That is v1's 2026-08-03 incident, and at cutover every migrated
 * subscriber is in exactly that shape.
 *
 * SCHEDULED AND SWALLOWED, like the portal's: the event has already been
 * applied, and failing to arrange a tidy-up must not turn a processed webhook
 * into a 500 and a redelivery of something that already happened.
 * repairCustomerExternalId swallows its own failures too; this catch is for the
 * scheduling itself.
 */
async function repairExternalId(
  ctx: ActionCtx,
  identity: Pick<IdentityCandidates, 'customerId' | 'customerExternalId'>,
  playerId: Id<'players'>,
): Promise<void> {
  if (!identity.customerId) return
  if (identity.customerExternalId === playerId) return

  try {
    await ctx.scheduler.runAfter(0, internal.polar.repairCustomerExternalId, {
      customerId: identity.customerId,
      playerId,
    })
  } catch (error) {
    console.warn('[polar] could not schedule external id repair', error)
  }
}

export default http
