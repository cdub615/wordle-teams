import { Polar } from '@polar-sh/sdk'
import { v } from 'convex/values'
import { action, internalAction, internalQuery } from './_generated/server'
import { internal } from './_generated/api'
import { currentPlayer } from './access.ts'
import { isCredentialProblem, isMissingCheckout, isMissingCustomer } from './lib/polarErrors.ts'
import type { Id } from './_generated/dataModel'

/**
 * Everything in this app that talks to Polar.
 *
 * wt-ksh.6 / wordle-teams-l1v. Ports v1's `src/lib/polar/client.ts`,
 * `checkout.ts`, `portal.ts` and the two SDK-dependent halves of `identity.ts`.
 * See docs/superpowers/specs/2026-08-26-v2-phase5-polar-design.md, decision I.
 *
 * THE COUNTERPART TO billing.ts, WHOSE DOC COMMENT DRAWS THE LINE. That module
 * owns what a membership change does to application state — rules that have to
 * be true regardless of who the payment processor is. This module is the
 * transport: the part that knows the word "Polar". Nothing here decides
 * anything about memberships or teams.
 *
 * ACTIONS, BECAUSE EVERY POLAR CALL IS NETWORK and Convex queries and mutations
 * cannot make one. Two kinds of thing here are not actions, both deliberately:
 * `checkoutIdentity` is a query precisely because actions cannot touch
 * `ctx.db`; and the decisions the actions make — `externalIdsFor`,
 * `lookupPortal`, plus the environment helpers, and `isMissingCustomer` over in
 * lib/polarErrors.ts — are plain functions, pulled out of the SDK calls so they
 * can be exercised without a network. What is left inside each action is one
 * SDK call and nothing worth asserting about. See polar.test.ts.
 *
 * NO `'use node'`, AND THAT IS MEASURED RATHER THAN ASSUMED — three ways.
 * Grepping `@polar-sh/sdk@0.49.0`'s published ESM build for `node:`-prefixed or
 * bare Node built-in imports finds exactly one file, `dist/esm/webhooks.test.js`,
 * which is the package's own test and is reachable from no entry point; the
 * client is `fetch` and `zod` and nothing else. `npx convex codegen` then pushed
 * this module to the local deployment on the DEFAULT runtime and succeeded. And
 * adding `'use node'` made that same push fail outright
 * (`DeploymentNotConfiguredForNodeActions` — the Node runtime wants v20/22/24,
 * which this machine does not have), so the directive would cost local
 * development for nothing.
 *
 * (The one runtime dependency that could plausibly have needed Node,
 * `standardwebhooks`, reaches only `@stablelib/base64` and `fast-sha256` — both
 * pure JS — and is not on this module's import path anyway, since the root entry
 * does not re-export `webhooks.js`.)
 *
 * TASK 10 WENT FURTHER, AND THE REASON MATTERS HERE: `@polar-sh/sdk`'s
 * `validateEvent` cannot run on the default runtime at all — measured against
 * the local backend, `ReferenceError: Buffer is not defined`, from its opening
 * `Buffer.from(secret, 'utf-8')`. So convex/http.ts imports `standardwebhooks`
 * DIRECTLY, which is the library that helper verifies through, and it needs no
 * directive either. Nothing in this tree imports `@polar-sh/sdk/webhooks.js`.
 * (This paragraph claimed http.ts imported it, in the commit that removed it.)
 *
 * Staying on the default runtime is not merely tidier. Convex's rule is that a
 * `'use node'` module may hold actions only, so the directive would also have
 * forced `checkoutIdentity` out of this file and into one whose stated scope
 * excludes it — see that function's note.
 *
 * RAW SDK, NOT `@polar-sh/better-auth`. Settled in decision I and measured on
 * `wordle-teams-07n`: the plugin awaits the handler, so it does not
 * auto-acknowledge, but any handler error becomes `APIError("BAD_REQUEST")`,
 * and `BAD_REQUEST` maps to 400 (`better-call@1.3.7`, `dist/error.mjs:56`). The
 * endpoint could then only ever answer 200 or 400, and a 4xx tells Polar the
 * delivery is permanently rejected — so there is no path to the 5xx that makes
 * Polar retry, and that retry is the whole of the phase's idempotency design.
 */

/**
 * The variables a Polar deployment needs, all of which are secrets or
 * deployment-specific ids and none of which are in this repo.
 *
 * FIVE, WHERE v1 HAD FOUR. v1's `client.ts` derived the server from a general
 * `ENVIRONMENT` variable; v2 has no such thing on Convex — the only
 * `ENVIRONMENT` in this tree is `wrangler.jsonc`'s, which is set on the
 * Cloudflare worker that serves the front end and is not visible to a Convex
 * function. So the server is named directly, which is also the stronger form of
 * the rule it enforces (see `polarServer`).
 *
 * SET ON THE PRODUCTION DEPLOYMENT (the one beta runs on) SINCE 2026-08-27 and
 * on no other — the dev deployment this repo's e2e drives has none of the five,
 * measured with `convex env list`. Tracked as wordle-teams-3bl, which blocks
 * Task 13's sandbox pass. They move as a SET: token, secret, server and both
 * product ids all belong to one Polar instance.
 */
const REQUIRED_ENV_VARS = [
  'POLAR_ACCESS_TOKEN',
  'POLAR_WEBHOOK_SECRET',
  'POLAR_SERVER',
  'POLAR_PRO_MONTHLY_PRODUCT_ID',
  'POLAR_PRO_ANNUAL_PRODUCT_ID',
] as const

/**
 * Validates the whole set together rather than one variable per call site, so a
 * partially configured deployment fails loudly and IDENTICALLY everywhere
 * instead of only on the first code path that happens to need the one that is
 * missing. The message names every absent variable, not just the first.
 *
 * `POLAR_WEBHOOK_SECRET` is checked here although nothing in this module reads
 * it. That is the point of validating the set: a deployment that can create a
 * checkout but cannot verify the webhook it produces is misconfigured, and the
 * cheapest moment to find out is the first Polar call rather than the first
 * delivery. The reader is convex/http.ts, which checks the one variable again
 * on its own — this validates the SET, while the webhook cannot afford to reach
 * `new Webhook(...)` with an undefined secret, because `TextEncoder` turns that
 * into an empty key and every delivery is then rejected 403 as a bad signature.
 * Neither check makes the other redundant.
 *
 * AND THE TWO ARE NOT INTERCHANGEABLE, which the webhook's checkout fallback
 * proves: a deployment holding POLAR_WEBHOOK_SECRET but no POLAR_ACCESS_TOKEN
 * verifies deliveries happily and then throws out of THIS function on the one
 * Polar call identity's last resort makes. That throw is now a 500 and a
 * redelivery (see `fetchCheckoutExternalId`) rather than a silently dropped
 * upgrade.
 *
 * THE THROW IS FOR THE PATHS THAT WANT ONE — `polar()` and `proProductIds()`,
 * both of which are called from inside a `try` that already has to be there for
 * the network. The two user-facing actions call `polarEnvProblem()` instead and
 * never let this reach a catch; see that function.
 *
 * Exported so `polar.test.ts` can pin it, as are the other decisions this
 * module makes outside an SDK call — `polarServer`, `proProductIds`,
 * `externalIdsFor` and `lookupPortal`.
 */
export function assertPolarEnv(): void {
  const missing = REQUIRED_ENV_VARS.filter((name) => !process.env[name])
  if (missing.length > 0) {
    throw new Error(`Missing required POLAR env variables: ${missing.join(', ')}`)
  }
}

/**
 * The same contract as `assertPolarEnv` plus `polarServer`, answered as a VALUE:
 * the operator-facing reason this deployment cannot talk to Polar, or null if it
 * can.
 *
 * THE BUG THIS EXISTS FOR (wordle-teams-9fm). `polar()` asserts the environment,
 * and both actions used to call it from inside the `try` that wraps the Polar
 * request. So the assertion's throw landed in a catch written for HTTP errors,
 * failed `isMissingCustomer`, and came out as the same `reason: 'error'` a Polar
 * outage produces — the toast then told the player to try again at the one
 * failure retrying can never fix. The owner hit exactly that on beta on
 * 2026-08-27: five causes, one sentence, and nothing in the UI or the reasoning
 * around it able to say which.
 *
 * HOISTED RATHER THAN CLASSIFIED AFTER THE FACT, which is the actual fix.
 * Whether the deployment is configured is knowable with no network and no
 * player, so the actions ask BEFORE they risk anything; the alternative — catch
 * the exception and try to recognise it downstream — reconstructs a fact that
 * was available for free, and reconstructs it from an `Error` whose only
 * distinguishing feature is its message text.
 *
 * IT STILL CATCHES, AND THE DIFFERENCE IS WHAT THE CATCH CAN SEE. `assertPolarEnv`
 * and `polarServer` are the throwing primitives, and this composes them: two
 * calls on the two lines above their own catch, with no network, no SDK and no
 * other author's error able to arrive in between. Keeping them as the
 * primitives is what stops the two messages — the one naming every missing
 * variable, the one quoting the bad server — from being written twice and
 * drifting apart. What the old code did wrong was not using try/catch; it was
 * letting a catch written for Polar's HTTP responses, and reached through an
 * SDK call, be the thing that decided.
 *
 * THE STRING IS FOR THE SERVER LOG AND MUST NEVER BE RETURNED TO THE BROWSER.
 * It names variables and quotes values — `POLAR_SERVER must be 'production' or
 * 'sandbox', not 'prod'` — and this repo is public. The actions log it and
 * return a bare reason; src/lib/billing-copy.ts turns that reason into copy that
 * mentions no variable at all, and billing-copy.test.ts pins that it cannot.
 */
export function polarEnvProblem(): string | null {
  try {
    assertPolarEnv()
    polarServer()
  } catch (error) {
    return error instanceof Error ? error.message : String(error)
  }

  return null
}

/**
 * Which Polar instance to talk to.
 *
 * POLAR'S SANDBOX IS A COMPLETELY SEPARATE INSTANCE FROM PRODUCTION — its own
 * accounts, organizations, products and tokens. A production token does not
 * authenticate against sandbox, and a production product id names nothing
 * there. The server and the credentials always move together, which is exactly
 * why this is a required variable sitting in the same list as the token and the
 * product ids: forgetting it is then the same loud failure as forgetting the
 * token, rather than a silently wrong target.
 *
 * NOT v1's `ENVIRONMENT === 'prod' ? 'production' : 'sandbox'`. That shape
 * defaults to sandbox for anything it does not recognise, so a typo means real
 * subscribers quietly transact against an instance holding none of their data.
 * The value is checked rather than coerced for the same reason — 'prod' is a
 * plausible thing to type and must not resolve to sandbox.
 *
 * Phase 5 verifies against sandbox on beta (decision C) and the same deployment
 * flips to production at cutover, so this genuinely changes without a code
 * change.
 */
export function polarServer(): 'production' | 'sandbox' {
  const server = process.env.POLAR_SERVER
  if (server === 'production' || server === 'sandbox') return server
  throw new Error(`POLAR_SERVER must be 'production' or 'sandbox', not '${server}'`)
}

/**
 * The SDK client: built on first use and then reused.
 *
 * LAZY RATHER THAN AT MODULE SCOPE. v1 is lazy too, but for a reason that does
 * not carry over — it was avoiding a failed `next build`. v2's reason is the
 * demonstrated cost of the alternative, which is visible in this repo:
 * `convex/auth.ts` validates SITE_URL at module scope, and `vitest.config.ts`
 * has to supply a SITE_URL in return, its comment explaining that "tests import
 * it transitively through access.ts". Module-scope validation makes every
 * importer, direct or transitive, answerable for configuration it may not use.
 * Task 11's upgrade button (wordle-teams-ksh) will import this module, Task
 * 10's webhook reaches it by function reference, none of the five variables is
 * set on any deployment yet, and none of them is needed to read a scoreboard.
 * Deferring the check to the first Polar call keeps the failure where the
 * misconfiguration is.
 *
 * Memoised because the client is stateless configuration — it holds a token and
 * a base URL — so a warm function instance reusing it is free and correct.
 */
let client: Polar | undefined

export function polar(): Polar {
  assertPolarEnv()

  client ??= new Polar({
    accessToken: process.env.POLAR_ACCESS_TOKEN,
    server: polarServer(),
  })

  return client
}

/**
 * Both Pro products, annual first.
 *
 * Polar has no variants — a product carries a single pricing model and its
 * billing cycle is locked at creation — so Pro monthly and Pro annual are two
 * separate products. ONE checkout takes both and renders them side by side on
 * Polar's hosted page, in the order passed. That is why nothing in this app
 * asks the customer to pick an interval, why no caller passes a plan, and why
 * every upgrade button can be identical.
 *
 * ANNUAL IS FIRST SO IT PRESENTS FIRST, matching v1. Pinned in polar.test.ts,
 * because the order is a product decision that reads like an implementation
 * detail and is exactly the sort of thing a later edit would reverse.
 *
 * Exported for that test.
 */
export function proProductIds(): string[] {
  assertPolarEnv()
  return [process.env.POLAR_PRO_ANNUAL_PRODUCT_ID!, process.env.POLAR_PRO_MONTHLY_PRODUCT_ID!]
}

/**
 * The origin Polar redirects back to.
 *
 * Read per call and checked, the same reflex `convex/teams.ts`'s invite mail
 * uses and with the same message `convex/auth.ts` throws: a missing SITE_URL
 * must fail loudly rather than send somebody to `undefined/?checkout=success`.
 */
function siteUrl(): string {
  const url = process.env.SITE_URL
  if (!url) throw new Error('SITE_URL is not set on this deployment')
  return url
}

/**
 * What Polar needs to know about the caller.
 *
 * `name` is nullable so a blank one becomes an ABSENT `customerName` rather
 * than an empty string. `players.firstName` and `lastName` are both required by
 * the schema, so this only fires for a row holding whitespace — but sending
 * Polar a blank name is at best meaningless and at worst a 422 this repo has
 * not measured, and either way `undefined` is what "we do not have one" means.
 *
 * `legacyId` IS THE PLAYER'S OTHER NAME, and it is carried for the portal
 * alone — see `externalIdsFor`. Null for anyone born in v2; the schema note on
 * `players.legacyId` makes that absence meaningful rather than incidental. The
 * CHECKOUT never uses it: a new checkout must be stamped with the identity
 * every future event should carry, which is the Convex id.
 */
export type CheckoutIdentity = {
  playerId: Id<'players'>
  email: string
  name: string | null
  legacyId: string | null
}

/**
 * The caller's own identity, for the two actions below.
 *
 * A QUERY BECAUSE ACTIONS CANNOT TOUCH `ctx.db`. Both actions reach it with
 * `ctx.runQuery`, and it is internal because they are its only callers.
 *
 * NOT `me.myData`. That returns a union built for the dashboard — `null`, an
 * unmatched-email marker, or the player plus every team they are on — so
 * reusing it would make an action narrow a shape built for a different job, and
 * would collect all 171 teams to read a display name.
 *
 * NOT IN billing.ts EITHER, which is where the Phase 5 plan put it. That
 * module's doc comment states it is "deliberately not the Polar module" and
 * that `myPendingInviteCount` is "the only one so far" of its session-reading
 * wrappers; a query named after and existing solely for the Polar checkout
 * would have falsified both sentences in the commit that added it. billing.ts's
 * own rule — session-reading wrappers "live next to the code that needs them" —
 * points here, and living here is only possible because this module is not
 * `'use node'`.
 *
 * THIN, WHICH IS WHAT KEEPS billing.ts's RULE SATISFIED rather than dodged.
 * That rule — every rule lives in a `...For` helper taking explicit arguments,
 * never in a function that reads the session — exists because logic behind a
 * session-reading wrapper is logic no unit test can reach. This wrapper holds
 * no rule to hide: it resolves identity, reads, and enforces nothing.
 * `currentPlayer` rather than `requirePlayer` because both callers turn absence
 * into a returned value rather than a throw.
 *
 * NOT DIRECTLY TESTABLE: convex-test cannot stand up a Better Auth session
 * (wordle-teams-obw), so anything behind `currentPlayer` is out of reach of the
 * harness. That is the whole reason billing.ts's rules live in `...For` helpers
 * instead, and it is why this wrapper stays a projection with no decision in
 * it — every decision made from its output (`externalIdsFor`, `lookupPortal`)
 * is a separate exported function that IS tested.
 */
export const checkoutIdentity = internalQuery({
  args: {},
  handler: async (ctx): Promise<CheckoutIdentity | null> => {
    const player = await currentPlayer(ctx)
    if (!player) return null

    const name = `${player.firstName} ${player.lastName}`.trim()
    return {
      playerId: player._id,
      email: player.email,
      name: name.length > 0 ? name : null,
      legacyId: player.legacyId ?? null,
    }
  },
})

/**
 * The three answers the checkout can give — the same split `PortalResult` makes,
 * minus the branch that has no meaning here.
 *
 * THERE IS NO `no-customer`: a checkout is how somebody BECOMES a Polar
 * customer, so not having one is the normal input rather than an outcome.
 *
 * `not-configured` MEANS THIS DEPLOYMENT CANNOT TALK TO POLAR AT ALL — a
 * variable missing from the set, a POLAR_SERVER that is neither instance, or a
 * credential Polar rejected. `error` means Polar was asked and did not answer
 * usefully. The line between them is "would trying again ever work", and it is
 * the whole of wordle-teams-9fm: this used to be a bare `string | null`, so an
 * unset token and a Polar outage produced the identical "please try again".
 * `isCredentialProblem` in lib/polarErrors.ts argues where a 401 belongs.
 */
export type CheckoutResult =
  | { url: string }
  | { url: null; reason: 'not-configured' }
  | { url: null; reason: 'error' }

/**
 * Creates the Polar checkout a player is sent to when they upgrade to Pro.
 *
 * BOTH THE EXTERNAL ID AND THE METADATA, and the metadata is not redundant.
 * Polar does NOT stamp `external_customer_id` onto a customer that already
 * EXISTS under this email — it matches the checkout to that customer and leaves
 * its own (often null) external id alone — so the webhook's
 * `customer.external_id` comes back null and the upgrade silently does nothing.
 * v1 watched that happen on 2026-08-03: real subscription, correct checkout,
 * HTTP 202, nobody upgraded. It matters more in v2 than it did in v1, because
 * at cutover every migrated user already exists as a Polar customer under their
 * email, which is precisely the failing case. The metadata travels with the
 * checkout, costs no extra API call, and is candidate 2 in
 * `lib/polarIdentity.ts`.
 *
 * `externalCustomerId` IS THE ONLY LINK between a Polar customer and a row in
 * this database. No Polar customer id is stored anywhere — see
 * `getCustomerPortalUrl` — and the v2 schema says not to reintroduce the column
 * v1 dropped.
 *
 * LANDS BACK ON `/`, WHICH RECONCILES IMMEDIATELY. v1 used `/me?checkout=success`
 * because that page re-read membership rather than waiting for a session
 * refresh; v2's index route reads `api.teams.amIPro` as a reactive Convex
 * subscription, so the webhook patching `playerMembership` updates the page on
 * its own. The `?checkout=success` param is what Task 12's return leg
 * (wordle-teams-wxg) reads to say something honest while that is in flight.
 *
 * A RESULT ON FAILURE RATHER THAN A THROW, so the UI can say something honest
 * instead of showing an error boundary. Every failure is logged with its own
 * line, because the log is how the owner diagnoses this: a caller with no
 * resolvable player is a routing bug, since the index route redirects a
 * playerless account to /complete-profile before it can render an upgrade
 * button; an unconfigured deployment names what is wrong with it; a Polar
 * failure is an outage.
 *
 * THE ENVIRONMENT IS CHECKED FIRST, BEFORE THE IDENTITY LOOKUP AND BEFORE THE
 * `try`. It is the cheapest question here and the only one whose answer no
 * amount of retrying changes, so it is worth asking before anything else can
 * mask it — see `polarEnvProblem`. A playerless caller on an unconfigured
 * deployment therefore reports the configuration, which is the more actionable
 * of the two truths.
 */
export const createProCheckout = action({
  args: {},
  handler: async (ctx): Promise<CheckoutResult> => {
    const misconfigured = polarEnvProblem()
    if (misconfigured !== null) {
      console.error(`[polar] cannot create a checkout: ${misconfigured}`)
      return { url: null, reason: 'not-configured' }
    }

    const me = await ctx.runQuery(internal.polar.checkoutIdentity, {})
    if (!me) {
      console.error('[polar] checkout requested with no resolvable player')
      return { url: null, reason: 'error' }
    }

    try {
      const checkout = await polar().checkouts.create({
        products: proProductIds(),
        externalCustomerId: me.playerId,
        metadata: { player_id: me.playerId },
        customerEmail: me.email,
        customerName: me.name ?? undefined,
        successUrl: `${siteUrl()}/?checkout=success`,
      })

      return { url: checkout.url }
    } catch (error) {
      // The credential can only be found wrong by asking, so this is the one
      // configuration failure the check above cannot pre-empt.
      if (isCredentialProblem(error)) {
        console.error('[polar] Polar rejected the configured credentials on checkout', error)
        return { url: null, reason: 'not-configured' }
      }

      console.error('[polar] failed to create checkout', error)
      return { url: null, reason: 'error' }
    }
  },
})

/**
 * The four answers the portal can give.
 *
 * EVERY BRANCH HERE EXISTS TO STOP ONE LIE, and the lie is always the same one:
 * "please try again" said to somebody for whom trying again cannot work.
 *
 * `no-customer` IS AN EXPECTED STATE, not a failure: it is what anyone who has
 * never checked out gets. Three of these shapes are ported from v1, where the
 * same distinction exists.
 *
 * `not-configured` IS THE OPERATOR'S STATE, and it is the fourth, added for
 * wordle-teams-9fm. A variable missing from the set, a
 * POLAR_SERVER that names neither instance, or a credential Polar rejected: all
 * three need a human to change a deployment setting, and none of them clears by
 * waiting. Collapsing them into `error` is what shipped the bug — the owner
 * clicked Billing on beta, got the retryable sentence, and neither he nor the
 * page could tell a misconfiguration from an outage. The reason is deliberately
 * BARE: `polarEnvProblem`'s message names variables and quotes values, it is
 * logged, and it stops at the server.
 *
 * `error` IS NOW ONLY THE OPERATIONAL CASE — Polar was reached and did not give
 * a usable answer, or was not reachable. That one IS worth retrying, which is
 * the only reason the sentence that says so is allowed to survive anywhere.
 */
export type PortalResult =
  | { url: string }
  | { url: null; reason: 'no-customer' }
  | { url: null; reason: 'not-configured' }
  | { url: null; reason: 'error' }

/**
 * Every external id this player might be known to Polar by, cheapest first.
 *
 * DECISION F IN THE OUTBOUND DIRECTION. The webhook resolves an incoming
 * external id across BOTH namespaces — Convex id, then `by_legacyId` — because
 * after cutover a migrated subscriber's Polar customer carries their v1 uuid.
 * Asking Polar for that same person by Convex id alone hits the mirror image of
 * the same fact and gets "Customer does not exist.", so the portal would tell a
 * PAYING SUBSCRIBER they have no billing account. That was wordle-teams-1m6.
 * The principle was already settled; only one direction had been written down.
 *
 * WHY v1's uuid IS THE SECOND NAME AND NOT THE FIRST: v1's
 * `src/lib/polar/checkout.ts:22` set `externalCustomerId` to the v1 player id, a
 * Postgres uuid, and v2 stores that uuid as `players.legacyId`. Everything this
 * v2 creates is stamped with the Convex id, so the Convex id is both the
 * commoner answer and the one that stays correct; the uuid is a fact about the
 * past that `repairCustomerExternalId` is steadily erasing.
 *
 * ONE ENTRY FOR A v2-NATIVE PLAYER, WHICH IS THE POINT. A player with no
 * `legacyId` was born in v2 (the schema note on `players.legacyId` makes that
 * absence meaningful) and can never have a v1 uuid, so there is no second call
 * to make and no cost to pay. As migrated customers heal, that becomes
 * everyone.
 *
 * Empty and duplicate ids are dropped for the reason `asCandidate` gives in
 * lib/polarIdentity.ts: `legacyId` is `v.optional(v.string())`, so `''` is
 * storable, and a candidate that can name nobody buys only a wasted round trip
 * and an ambiguous log line.
 */
export function externalIdsFor(identity: {
  playerId: string
  legacyId?: string | null
}): string[] {
  const ids = [identity.playerId, identity.legacyId]
  return ids.filter(
    (id, index): id is string =>
      typeof id === 'string' && id.length > 0 && ids.indexOf(id) === index,
  )
}

/**
 * One portal attempt, reduced to the same outcomes `PortalResult` carries plus
 * the Polar customer id a success reveals. That id is not otherwise knowable —
 * nothing here stores one — and it is the repair's input.
 */
export type PortalAttemptResult =
  | { url: string; customerId: string }
  | { url: null; reason: 'no-customer' }
  | { url: null; reason: 'not-configured' }
  | { url: null; reason: 'error' }

export type PortalAttempt = (externalId: string) => Promise<PortalAttemptResult>

/**
 * Which of the three failures one rejected portal request is.
 *
 * A SEPARATE FUNCTION BECAUSE IT IS THE DECISION, and the only other thing in
 * the attempt is an SDK call. Inline, it would live inside a closure inside an
 * action, which is to say somewhere no unit test can reach — and this
 * classification is precisely what wordle-teams-9fm was: not a broken portal,
 * a portal whose failures were indistinguishable. polar.test.ts drives it
 * against object literals; no client, no network.
 *
 * ORDER MATTERS AND IS NOT ARBITRARY. `isMissingCustomer` goes first because it
 * is the narrowest — a 422 carrying one specific detail string — and because
 * its answer is not a failure at all. `isCredentialProblem` then takes the two
 * statuses that mean the deployment is wrong. Everything left is operational,
 * which is the only bucket that keeps the retry sentence.
 *
 * The two classifiers live in lib/polarErrors.ts, which is dependency-free for
 * exactly this reason; each argues its own boundaries there.
 */
export function classifyPortalError(
  error: unknown,
): 'no-customer' | 'not-configured' | 'error' {
  if (isMissingCustomer(error)) return 'no-customer'
  if (isCredentialProblem(error)) return 'not-configured'
  return 'error'
}

/**
 * A success carries the identity that WON as well as the customer it found, so
 * the caller can tell a fallback hit from a fast-path one. A failure carries
 * the `PortalResult` to hand straight back, which keeps the two failure reasons
 * from having to be reconstructed — and mistranslated — at the call site.
 */
export type PortalLookup =
  | { found: true; url: string; customerId: string; externalId: string }
  | { found: false; result: PortalResult }

/**
 * Tries each identity in turn and reports the first real answer.
 *
 * THE ATTEMPT IS INJECTED, which is what makes this sequencing testable without
 * a network — and it is genuine logic, not a wrapper worth stubbing. Three
 * rules live here and each is a way to get this wrong:
 *
 *   - ONLY `no-customer` ADVANCES. A 500 or a rejected credential on the first
 *     identity must stop, not silently retry as the second and end up reported
 *     as `no-customer`. That would turn an outage into "you have no
 *     subscription", which is the exact lie the multi-way result exists to
 *     prevent — and it would do it to everyone, not just migrated users. The
 *     rule is written as "not no-customer stops", so `not-configured` was
 *     already covered on the day it was added.
 *   - EVERY IDENTITY EXHAUSTED MEANS `no-customer`, and that answer stays
 *     truthful for the genuinely new user, who is most of the callers.
 *   - THE WINNING IDENTITY IS REPORTED, because "which name worked" is the
 *     whole input to the repair.
 *
 * No candidates at all also answers `no-customer`: unreachable today, since
 * `externalIdsFor` always keeps the Convex id, but "we asked about nobody" is
 * nearer to no-customer than to a failure.
 */
export async function lookupPortal(
  candidates: readonly string[],
  attempt: PortalAttempt,
): Promise<PortalLookup> {
  for (const externalId of candidates) {
    const result = await attempt(externalId)
    if (result.url !== null) {
      return { found: true, url: result.url, customerId: result.customerId, externalId }
    }
    if (result.reason !== 'no-customer') return { found: false, result }
  }

  return { found: false, result: { url: null, reason: 'no-customer' } }
}

/**
 * A short-lived Polar customer portal session for the signed-in player.
 *
 * RESOLVED BY `externalCustomerId`, NEVER BY A STORED POLAR CUSTOMER ID. That
 * is exactly what let v1 DROP `player_customer.customer_id` rather than retype
 * it, and the v2 schema comment at line 237 says not to bring the dropped
 * columns back. Which external id, though, is `externalIdsFor`'s answer and not
 * simply the Convex id — see its note, and wordle-teams-1m6.
 *
 * CREATED AT THE MOMENT OF THE CLICK AND NEVER STORED: portal URLs expire.
 *
 * A FALLBACK HIT SELF-HEALS — one of the two places that do, the other being
 * the webhook (convex/http.ts), which asks the same question from the other
 * side: not "which identity won" but "does the customer already carry the
 * resolved id". Winning on the legacy id proves the Polar
 * customer still carries the v1 uuid, so the repair is scheduled and the NEXT
 * visit needs one call instead of two. Scheduled rather than awaited, and
 * wrapped, because nothing about tidying up may turn a portal session the
 * player is entitled to into an error.
 *
 * `error` RATHER THAN `no-customer` WHEN THERE IS NO PLAYER. Both are "no
 * billing account" in a loose sense, but a caller reaching the portal without a
 * resolvable player is a routing bug — the index route redirects a playerless
 * account to /complete-profile — and answering `no-customer` would dress that
 * up as a normal state and hide it.
 */
export const getCustomerPortalUrl = action({
  args: {},
  handler: async (ctx): Promise<PortalResult> => {
    // FIRST, AND OUTSIDE EVERY try IN THIS HANDLER. This is the fix for
    // wordle-teams-9fm: `polar()` asserts the same contract, but it does it from
    // inside the attempt's catch below, where the throw was reduced to the
    // generic `error` and the player was told to try again at the one thing
    // retrying cannot fix. See polarEnvProblem.
    const misconfigured = polarEnvProblem()
    if (misconfigured !== null) {
      console.error(`[polar] cannot open a portal session: ${misconfigured}`)
      return { url: null, reason: 'not-configured' }
    }

    const me = await ctx.runQuery(internal.polar.checkoutIdentity, {})
    if (!me) {
      console.error('[polar] portal requested with no resolvable player')
      return { url: null, reason: 'error' }
    }

    const returnUrl = `${siteUrl()}/`

    const lookup = await lookupPortal(externalIdsFor(me), async (externalId) => {
      try {
        const session = await polar().customerSessions.create({
          externalCustomerId: externalId,
          returnUrl,
        })
        return { url: session.customerPortalUrl, customerId: session.customerId }
      } catch (error) {
        const reason = classifyPortalError(error)

        // Not worth alarming on: see isMissingCustomer, and the note on
        // PortalResult for why this is an answer rather than a failure.
        if (reason === 'no-customer') return { url: null, reason }

        if (reason === 'not-configured') {
          // The credential can only be found wrong by asking, so this is the
          // one configuration failure the check at the top cannot pre-empt.
          console.error('[polar] Polar rejected the configured credentials', error)
          return { url: null, reason }
        }

        console.error('[polar] failed to create portal session', error)
        return { url: null, reason }
      }
    })

    if (!lookup.found) return lookup.result

    // The Convex id is always first (externalIdsFor), so winning on anything
    // else means the customer still carries the v1 uuid.
    if (lookup.externalId !== me.playerId) {
      try {
        await ctx.scheduler.runAfter(0, internal.polar.repairCustomerExternalId, {
          customerId: lookup.customerId,
          playerId: me.playerId,
        })
      } catch (error) {
        // Swallowed for the same reason repairCustomerExternalId swallows its
        // own: the player has a valid session in hand, and failing to arrange
        // the tidy-up must not take it away from them.
        console.warn('[polar] could not schedule external id repair', error)
      }
    }

    return { url: lookup.url }
  },
})

/**
 * The external id recorded on a checkout — identity's third and last resort.
 *
 * When neither `customer.external_id` nor the checkout metadata names a live
 * player, the checkout that created the subscription still holds the value.
 * `lib/polarIdentity.ts` extracts `checkoutId` for exactly this, and convex/
 * http.ts joins the two — it calls this only after the two free candidates have
 * resolved nobody.
 *
 * ONE POLAR API CALL, which is why it is here and not in `resolvePlayerIdFor`,
 * and why it is last: the two candidates ahead of it are already in the webhook
 * body and cost nothing.
 *
 * RETURNS THE RAW STRING, UNVALIDATED. It is a candidate, not an answer — v2
 * resolves candidates by looking them up across both namespaces
 * (`resolvePlayerIdFor` in billing.ts), and v1's uuid regex is deliberately not
 * ported. See the note in `lib/polarIdentity.ts`.
 *
 * NULL MEANS "THE CHECKOUT NAMES NOBODY". IT THROWS WHEN THE CALL FAILED, and
 * the two must not be conflated, because the caller turns null into HTTP 202 —
 * an answer that tells Polar never to redeliver, and one that stores no audit
 * row. (This said "NULL ON FAILURE, never a throw", and caught everything to
 * honour it. That was written when nothing called this; Task 10
 * (wordle-teams-p8m) made the swallow reachable, and with it a Polar 5xx, a
 * 429, a network blip or an unset POLAR_ACCESS_TOKEN silently discarded the
 * delivery — and did it to precisely the customers this fallback exists for,
 * the email-matched ones whose customer carries no external id.)
 *
 * `isMissingCheckout` DRAWS THE LINE and explains where: 404 and 422 are
 * permanent, everything else is worth another delivery. A throw here surfaces
 * in convex/http.ts as a 500, which is Polar's cue to redeliver.
 */
export const fetchCheckoutExternalId = internalAction({
  args: { checkoutId: v.string() },
  handler: async (_ctx, { checkoutId }): Promise<string | null> => {
    try {
      const checkout = await polar().checkouts.get({ id: checkoutId })
      return checkout.externalCustomerId ?? null
    } catch (error) {
      if (isMissingCheckout(error)) {
        // An answer, not a failure: this checkout can never name anybody. Warn
        // rather than error, and let the caller answer 202.
        console.warn('[polar] checkout could not be read and never will be', { checkoutId }, error)
        return null
      }

      // Rethrown, NOT swallowed. The webhook cannot tell a transient failure
      // from "nobody" once this returns, so it must not be asked to.
      console.error('[polar] failed to read checkout', { checkoutId }, error)
      throw error
    }
  },
})

/**
 * Stamps the resolved player id onto the Polar customer, so later events for
 * the same person take the fast path.
 *
 * THE SELF-HEAL BEHIND BOTH DIRECTIONS OF DECISION F. Once `customer.external_id`
 * holds the Convex id, the next event for this person — a renewal, a
 * cancellation, a revocation — arrives with candidate 1 populated and needs no
 * fallback, and their next portal visit costs one Polar call instead of two.
 *
 * TWO CALLERS, EACH REACHING IT AFTER A FALLBACK WON, which is exactly the
 * proof that the customer's own external id is absent or stale:
 *
 *   - `getCustomerPortalUrl`, when the session was found by the player's
 *     `legacyId` rather than their Convex id. This one is live.
 *   - the webhook (convex/http.ts), whenever the customer's own
 *     `externalId` is not already the resolved player — which covers a stale v1
 *     uuid AND the null the email-matched customer carries. Both live now.
 *
 * BEST EFFORT AND NEVER FATAL, which is why it swallows everything: the event
 * that triggered it has ALREADY been resolved, and failing to tidy up must not
 * turn a successful webhook into a 500 and a Polar retry. That is also why it
 * is a separate action rather than part of a resolution helper — a caller can
 * schedule it and move on.
 *
 * `v.id('players')` RATHER THAN `v.string()`: what gets written into Polar is
 * the value every future webhook will be resolved by, so a caller passing
 * something that is not a player id would poison identity for that customer
 * permanently and silently. Typing the argument as `Id<'players'>` puts that
 * mistake in front of the compiler at every call site, which `v.string()` would
 * not. It says nothing about whether the document still exists; the caller has
 * just resolved it.
 *
 * NOT DIRECTLY TESTED. Its whole body is one SDK write inside a catch-all, so
 * the only assertion available without a network would be that the stub was
 * called. What IS pinned is the decision to reach it — see lookupPortal's
 * externalId and the portal tests in polar.test.ts.
 */
export const repairCustomerExternalId = internalAction({
  args: { customerId: v.string(), playerId: v.id('players') },
  handler: async (_ctx, { customerId, playerId }): Promise<void> => {
    try {
      await polar().customers.update({
        id: customerId,
        customerUpdate: { externalId: playerId },
      })
    } catch (error) {
      console.warn('[polar] could not stamp external id onto customer', { customerId }, error)
    }
  },
})
