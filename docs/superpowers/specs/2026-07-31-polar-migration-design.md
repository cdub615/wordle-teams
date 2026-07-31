# Migrate billing from Lemon Squeezy to Polar.sh

**Date:** 2026-07-31
**Branch:** `feat/polar-migration`
**Status:** Approved, not yet implemented

## Why now

The app has exactly one paying customer. Polar cannot import active subscriptions from
Lemon Squeezy — its migration tooling moves products, customers, license keys, and discount
codes, but the docs are explicit that it "is not able to move **active** subscriptions."
Every paying customer must therefore re-subscribe by hand. That cost scales linearly with the
subscriber count, so it is at its minimum right now.

## Scope

**In scope:** replacing the Lemon Squeezy integration with Polar end to end — checkout, customer
portal, webhooks, the `player_customer` schema, the auth hook, and every type and UI callsite
that touches billing.

**Out of scope:**

- `polar-migrate`. It moves products and customers, but with one Pro product and one paying
  customer, creating them by hand in the dashboard is faster than operating a migration tool.
- The three Postgres RPCs (`handle_upgrade_team_invites`, `handle_downgrade_team_removal`,
  `handle_free_team_limit`). They branch on `membership_status = 'pro'`, which is
  provider-agnostic. Keeping them untouched is a design goal, not an accident.
- The two untracked `scripts/*-dev.mjs` files that happened to be in the working tree when this
  branch was cut.

## Decisions

| Decision | Choice | Alternatives ruled out |
|---|---|---|
| Cutover style | Hard cutover — Lemon Squeezy removed entirely in one release | Dual-run (two providers writing `player_customer` means `customer_id` must hold both an int and a UUID); hard cutover with manual grandfathering |
| Free tier | No Polar product. `free` is a DB default, never webhook-driven | Recreating a $0 "Free" product to mirror today's structure |
| Identity | `external_customer_id` = Supabase `player_id`; Polar's customer UUID is never stored | Retyping both columns to `text`; dropping only `membership_variant` |
| Cancel semantics | Downgrade on `subscription.revoked` only | A `canceling` enum value; downgrading on `canceled` as today does |
| Checkout UX | Hosted redirect, no third-party script | Embedded overlay via `@polar-sh/checkout`; the `@polar-sh/nextjs` route adapter |
| Existing subscriber | Email them once dev is verified, then deploy on their response | Emailing before the work starts; shipping first and emailing after |

### Why `external_customer_id` lets two columns disappear

`player_customer.customer_id` is `int` and `membership_variant` is `int`. Polar's customer and
product identifiers are UUIDs, so a literal port would require retyping both columns, rewriting
`custom_access_token_hook` (which declares `user_customer_id int`), and changing the JWT claim
types.

Neither column earns that cost:

- `membership_variant` is plumbed through `utils.ts`, the `User` type, and the JWT claims, but
  **nothing branches on it**. Every gate in the codebase is `memberStatus === 'pro'`.
- `customer_id` exists solely to feed `getCustomerPortalUrl`. Polar's Create Customer Session
  endpoint accepts `external_customer_id` as an alternative to `customer_id`, so a portal session
  can be created from `player_id` alone.

Dropping both columns therefore removes the type migration, two JWT claims, and a dead field in a
single move.

### Why cancel and revoke must not be conflated

Lemon Squeezy's `subscription_cancelled` currently sets `membership_status = 'cancelled'` **and**
runs `handle_downgrade_team_removal` immediately. Polar splits that moment in two:
`subscription.canceled` fires when a customer *schedules* a cancellation, while they retain paid
access until the period ends; `subscription.revoked` fires when access actually terminates.

Porting the mapping literally would strip a paying customer's teams weeks before the period they
paid for expires.

## Event mapping

`subscription.active` and `subscription.uncanceled` are the only events that grant `pro`;
`subscription.revoked` is the only event that removes it.

```
subscription.active      → 'pro'      + handle_upgrade_team_invites
subscription.uncanceled  → 'pro'      + handle_upgrade_team_invites (no-op if already pro)
subscription.canceled    → no change  (access is paid through period end)
subscription.past_due    → no change  (recoverable by updating payment method)
subscription.revoked     → 'expired'  + handle_downgrade_team_removal
```

`subscription.revoked` maps to `'expired'` unconditionally. Distinguishing it from `'cancelled'`
would cost a branch on the payload, and nothing reads the difference — only `'pro'` gates
anything. `'cancelled'` survives in the enum for pre-existing rows.

## Architecture

**Dependency:** `@polar-sh/sdk` only. Not `@polar-sh/nextjs` — its `Webhooks` helper
auto-acknowledges, which would lose the store-then-process-then-500-so-Polar-retries behavior the
current route depends on.

### Modules

Replacing `src/lib/lemonsqueezy/`:

| File | Purpose |
|---|---|
| `src/lib/polar/client.ts` | Configured SDK client. Server derived from `ENVIRONMENT`: `prod` → `production`, else `sandbox` |
| `src/lib/polar/checkout.ts` | `createProCheckout(playerId, email, name)` → checkout URL |
| `src/lib/polar/portal.ts` | `getCustomerPortalUrl(playerId)` via customer session on `external_customer_id` |
| `src/lib/polar/events.ts` | Pure, no I/O: `mapEventToTransition(eventType)` → `{ status, rpc } \| null` |

The event mapping is isolated as a pure function because it holds the only real logic in the
integration and has no reason to touch Supabase or the network. It can be exercised over every
Polar event name without either.

### Environment variables

Add `POLAR_ACCESS_TOKEN`, `POLAR_WEBHOOK_SECRET`, `POLAR_PRO_PRODUCT_ID`.
Remove `LEMONSQUEEZY_API_KEY`, `LEMONSQUEEZY_STORE_ID`, `LEMONSQUEEZY_WEBHOOK_SECRET`.

The Pro product moves from a name lookup (`listProducts` then `.find(p => p.attributes.name === 'Pro')`)
to an env-var UUID, deleting an API round-trip per checkout and a fragile string match.

### Database migration

One migration file. **The internal ordering is load-bearing:**

```sql
-- 1. auth hook FIRST, so it stops selecting the columns
create or replace function public.custom_access_token_hook(event jsonb) ...
   -- drops the user_customer_id and user_member_variant claims

-- 2. only then drop the columns
alter table public.player_customer drop column customer_id;
alter table public.player_customer drop column membership_variant;

-- 3. webhook_id must be text before it can hold a Standard Webhooks id (see correction below)
alter table public.webhook_events alter column webhook_id type text using webhook_id::text;

-- 4. idempotency guard for Standard Webhooks retries. Partial, so legacy null rows stay exempt.
--    Deduplicate first, preferring the processed row of any retry set.
create unique index webhook_events_webhook_id_key
  on public.webhook_events (webhook_id) where webhook_id is not null;
```

If the columns are dropped while the old hook still selects them, `custom_access_token_hook`
throws and **every login breaks**. This project already has a login-lockout incident in its
history; that ordering is the riskiest line in the migration.

### Webhook flow

At `/api/webhook` — the path is unchanged, since one provider means it is still accurate.

1. `validateEvent(rawBody, headers, secret)` from `@polar-sh/sdk/webhooks`. On
   `WebhookVerificationError`, return 403.
2. `playerId = event.data.customer.external_id`.
3. If that is missing or not a UUID, log and return **202** — not 500. `webhook_events.player_id`
   is `NOT NULL` with an FK to `players`, so a foreign event would fail the insert and make Polar
   retry forever on something that can never succeed.
4. `webhookId` from the **`webhook-id` header**. Polar follows Standard Webhooks, so it is not in
   the body as Lemon Squeezy's `meta.webhook_id` was.

   **Correction (verified against a local database, 2026-07-31):** this spec originally claimed
   the column was already `text` and needed no change. It was `uuid` — Lemon Squeezy's
   `meta.webhook_id` happened to be a UUID, and `database.types.ts` renders `uuid` as `string`,
   which hid it. Standard Webhooks explicitly does not require a UUID; the spec's own example id
   is `msg_2KWPBgLlAfxdpx2AI54pPJ85f4W`, which a uuid cast rejects. Left alone, a non-UUID id
   would throw on insert, return 500, and put Polar into an infinite retry loop against an event
   that could never be stored. The migration converts the column to `text`.
5. Store the event. On unique-index conflict it is a retry already handled — return 200.
6. Apply the transition, run the RPC, mark processed.

`src/lib/typeguards.ts` is deleted outright. `validateEvent` returns discriminated typed events,
leaving the hand-rolled `webhookHasMeta` / `webhookHasData` guards nothing to guard.

## UI changes

**Deleted:** `setupLemonSqueezy`, the `<Script src="https://app.lemonsqueezy.com/js/lemon.js">`
tag, and the `Checkout.Success` handler in `app-bar-base.tsx`; `shims.d.ts` and
`src/types/global.d.ts` in full. No third-party payment script remains — which also removes the
DNS-filter failure mode that `app-bar-base.tsx` currently carries defensive code and a comment
about.

**Checkout:** the three callsites (`user-dropdown.tsx`, `month-dropdown.tsx`,
`teams-dropdown.tsx`) change from `window.LemonSqueezy.Url.Open(url)` to
`window.location.href = url`.

`getCheckoutUrl` currently exists twice — `src/app/me/actions.ts:399` and
`src/components/app-bar/actions.ts:23` — as near-identical duplicates imported from two different
modules by those three callsites. Consolidated to one server action.

**Return trip:** Polar's `success_url` points at `/me?checkout=success`, handled by a new
single-purpose client component `src/components/checkout-return.tsx`:

1. `supabase.auth.refreshSession()` — `user_member_status` is stamped at token issuance, so
   without this the JWT stays stale.
2. `router.refresh()`, then strip the query param.
3. If status is still not `pro`, retry once after ~2s.

Step 3 is new. Webhook delivery races the browser redirect, and today that race is silent. It
partly self-heals already, because `/me/page.tsx:39` and `app-bar-server.tsx:27` both reconcile
`player_customer` against the JWT on render — but only once the webhook has landed.

**Billing portal:** `sendToBillingPortal` drops its `user.customerId` guard and calls a server
action that derives the player from the session. New failure mode: a user who never checked out
has no Polar customer, so the session call 404s. Show the menu item only when `memberStatus` is
`pro` / `cancelled` / `expired`, and toast gracefully on 404.

**Type ripple** from the dropped columns: `src/lib/types.ts` (both `User` and the claims type),
`src/lib/utils.ts:100-126`, `src/app/me/page.tsx:41`,
`src/components/app-bar/app-bar-server.tsx:31-33`, then regenerate `database.types.ts`.

## Rollout

Phases 1 and 2 run in parallel. The customer email is deliberately held until dev is verified, so
that the moment they respond, the cutover is a deploy rather than a project.

| # | Phase | Owner | Blocks |
|---|---|---|---|
| 1 | Polar dashboard setup — sandbox + production orgs, Pro product in each, tokens, webhook endpoints | Owner | 3 |
| 2 | Code + migration on `feat/polar-migration` | Agent | 3 |
| 3 | Deploy to dev, verify against Polar sandbox | Agent | 4 |
| 4 | Email the subscriber; cancel their Lemon Squeezy sub at period end | Owner | 5 |
| 5 | Merge to `main` → prod. GHA runs the migration | Agent | 6 |
| 6 | Prod verification — login first, then checkout | Agent | 7 |
| 7 | Decommission: pull `LEMONSQUEEZY_*` from Vercel, delete the LS webhook, uninstall the package | Agent | — |

Phase 1 is detailed in `docs/plans/2026-07-31-polar-phase1-setup.md`.

### Deployment protection caveat

`dev.wordleteams.com` sits behind Vercel Deployment Protection, which 302s unauthenticated
requests to `vercel.com/sso-api`. Polar's sandbox webhooks would be blocked. Vercel's Protection
Bypass for Automation supports a query parameter for exactly this case, so the sandbox webhook URL
must be:

```
https://dev.wordleteams.com/api/webhook?x-vercel-protection-bypass=<VERCEL_AUTOMATION_BYPASS_SECRET>
```

That secret must never be committed — this repository is public.

## Verification

The project has no test framework, so verification follows the established `scripts/*.mjs`
pattern.

- **`scripts/verify-polar-sandbox.mjs`** — creates a checkout and a portal session by
  `external_customer_id`, asserts both return usable URLs.
- **Event mapping** — `mapEventToTransition` is pure, so every Polar event name can be exercised
  directly without network or DB.
- **Webhook end to end** — complete a sandbox checkout with test card `4242 4242 4242 4242`
  against dev; assert the `webhook_events` row, the `player_customer` transition, and the RPC's
  effect on teams.
- **Login regression** — the highest-stakes check, because of the auth hook rewrite. Per the
  standing note, `dev.wordleteams.com` is behind Vercel SSO so curl cannot reach it; this must go
  through supabase-js against dev Supabase, as `scripts/validate-invite-dev.mjs` already does.
- **Post-deploy** — `scripts/axiom-query.mjs` and `scripts/sentry-query.mjs` sweeps.

## Acceptance criteria

1. A new user can complete a Polar checkout and land on `/me` as `pro` without a manual refresh.
2. `subscription.revoked` downgrades the player and removes them from teams beyond the free limit.
3. `subscription.canceled` alone does **not** change `membership_status` or remove teams.
4. An existing `pro` user can open the Polar customer portal from the user dropdown.
5. Login works after the auth hook migration, verified on dev before prod.
6. No reference to Lemon Squeezy remains in the codebase or in Vercel env vars.
7. Duplicate webhook deliveries are idempotent — a repeated `webhook-id` returns 200 without
   reprocessing.
