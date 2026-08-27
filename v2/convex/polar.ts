import { Polar } from '@polar-sh/sdk'
import { v } from 'convex/values'
import { action, internalAction, internalQuery } from './_generated/server'
import { internal } from './_generated/api'
import { currentPlayer } from './access.ts'
import { isMissingCustomer } from './lib/polarErrors.ts'
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
 * ACTIONS, BECAUSE EVERY CALL BELOW IS NETWORK. Convex queries and mutations
 * cannot make one. The single exception is `checkoutIdentity`, which is a query
 * precisely because actions cannot touch `ctx.db` — see its own note.
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
 * does not re-export `webhooks.js`. So Task 10 (wordle-teams-p8m) can verify
 * signatures without `'use node'` either.)
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
 * NONE OF THE FIVE IS SET ON ANY DEPLOYMENT YET, and no task in the Phase 5
 * plan sets them — tracked as wordle-teams-3bl, which blocks Task 13's sandbox
 * pass. They move as a SET: token, secret, server and both product ids all
 * belong to one Polar instance.
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
 * delivery. Task 10 (wordle-teams-p8m) is what reads it.
 *
 * Exported so `polar.test.ts` can pin it. Along with `polarServer` and
 * `proProductIds` it is the whole of what this module can be unit tested on —
 * everything else here is one SDK call away from the network.
 */
export function assertPolarEnv(): void {
  const missing = REQUIRED_ENV_VARS.filter((name) => !process.env[name])
  if (missing.length > 0) {
    throw new Error(`Missing required POLAR env variables: ${missing.join(', ')}`)
  }
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
 * Task 10's webhook and Task 11's upgrade button (wordle-teams-ksh) will both
 * import this module, none of the five variables is set on any deployment yet,
 * and none of them is needed to read a scoreboard. Deferring the check to the
 * first Polar call keeps the failure where the misconfiguration is.
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
 */
export type CheckoutIdentity = {
  playerId: Id<'players'>
  email: string
  name: string | null
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
 * instead, and it is why this wrapper is kept to four lines with no logic worth
 * proving.
 */
export const checkoutIdentity = internalQuery({
  args: {},
  handler: async (ctx): Promise<CheckoutIdentity | null> => {
    const player = await currentPlayer(ctx)
    if (!player) return null

    const name = `${player.firstName} ${player.lastName}`.trim()
    return { playerId: player._id, email: player.email, name: name.length > 0 ? name : null }
  },
})

/**
 * Creates the Polar checkout a player is sent to when they upgrade to Pro.
 *
 * BOTH THE EXTERNAL ID AND THE METADATA, and the metadata is not redundant.
 * Polar does NOT stamp `external_customer_id` onto a customer that already
 * EXISTS under this email — it matches the checkout to that customer and leaves
 * its own (often null) external id alone — so the webhook's
 * `customer.externalId` comes back null and the upgrade silently does nothing.
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
 * NULL ON FAILURE RATHER THAN A THROW, so the UI can offer to try again instead
 * of showing an error boundary. The two null cases are logged distinctly: a
 * caller with no resolvable player is a routing bug, since the index route
 * redirects a playerless account to /complete-profile before it can render an
 * upgrade button, while a Polar failure is an outage.
 */
export const createProCheckout = action({
  args: {},
  handler: async (ctx): Promise<string | null> => {
    const me = await ctx.runQuery(internal.polar.checkoutIdentity, {})
    if (!me) {
      console.error('[polar] checkout requested with no resolvable player')
      return null
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

      return checkout.url
    } catch (error) {
      console.error('[polar] failed to create checkout', error)
      return null
    }
  },
})

/**
 * The three answers the portal can give.
 *
 * `no-customer` IS AN EXPECTED STATE, not a failure: it is what anyone who has
 * never checked out gets. It is kept distinct from `error` so the UI can say
 * something true rather than "try again later" about a condition retrying will
 * never fix. Ported from v1, where the same three shapes exist.
 */
export type PortalResult =
  | { url: string }
  | { url: null; reason: 'no-customer' }
  | { url: null; reason: 'error' }

/**
 * A short-lived Polar customer portal session for the signed-in player.
 *
 * RESOLVED BY `externalCustomerId` — the player's own Convex id — never by a
 * stored Polar customer id. That is exactly what let v1 DROP
 * `player_customer.customer_id` rather than retype it, and the v2 schema
 * comment at line 237 says not to bring the dropped columns back.
 *
 * CREATED AT THE MOMENT OF THE CLICK AND NEVER STORED: portal URLs expire.
 *
 * KNOWN GAP AT CUTOVER, TRACKED AS wordle-teams-1m6. This looks the customer up
 * in ONE namespace, where the inbound direction resolves in two (decision F,
 * `resolvePlayerIdFor`). A subscriber migrated from v1 has their v1 uuid — v2's
 * `players.legacyId` — as their Polar `external_id`, because that is what v1's
 * checkout set, so asking for them by Convex id answers "Customer does not
 * exist." and this returns `no-customer` TO A PAYING SUBSCRIBER.
 * `repairCustomerExternalId` closes it, but only when their next subscription
 * event arrives, which for an annual plan can be months away. Deliberately not
 * fixed here: it is a second Polar call and a change to what identity the
 * portal accepts, which is a design question rather than a port.
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
    const me = await ctx.runQuery(internal.polar.checkoutIdentity, {})
    if (!me) {
      console.error('[polar] portal requested with no resolvable player')
      return { url: null, reason: 'error' }
    }

    try {
      const session = await polar().customerSessions.create({
        externalCustomerId: me.playerId,
        returnUrl: `${siteUrl()}/`,
      })

      return { url: session.customerPortalUrl }
    } catch (error) {
      // Not an error worth alarming on: see isMissingCustomer, and the note on
      // PortalResult for why this is a distinct answer rather than a failure.
      if (isMissingCustomer(error)) return { url: null, reason: 'no-customer' }

      console.error('[polar] failed to create portal session', error)
      return { url: null, reason: 'error' }
    }
  },
})

/**
 * The external id recorded on a checkout — identity's third and last resort.
 *
 * When neither `customer.externalId` nor the checkout metadata names a live
 * player, the checkout that created the subscription still holds the value.
 * `lib/polarIdentity.ts` extracts `checkoutId` for exactly this; the webhook
 * that joins the two is Task 10 (wordle-teams-p8m), so nothing calls this yet.
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
 * NULL ON FAILURE, never a throw: the caller is a webhook handler, and a
 * checkout this token cannot read is not something a redelivery will fix.
 */
export const fetchCheckoutExternalId = internalAction({
  args: { checkoutId: v.string() },
  handler: async (_ctx, { checkoutId }): Promise<string | null> => {
    try {
      const checkout = await polar().checkouts.get({ id: checkoutId })
      return checkout.externalCustomerId ?? null
    } catch (error) {
      console.error('[polar] failed to read checkout', { checkoutId }, error)
      return null
    }
  },
})

/**
 * Stamps the resolved player id onto the Polar customer, so later events for
 * the same person take the fast path.
 *
 * THE SELF-HEAL FOR THE SILENT-202 BUG. Once `customer.externalId` is set, the
 * next event for this person — a renewal, a cancellation, a revocation —
 * arrives with candidate 1 populated and needs no fallback at all. Called after
 * a resolution that came from the metadata or from the checkout, both of which
 * imply the customer's own external id was absent or wrong.
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
 * NOTHING CALLS THIS YET: the webhook is Task 10 (wordle-teams-p8m).
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
