# v2 Phase 5 — Payments (Polar): Design

- **Epic:** `wt-ksh.6` (child of `wt-ksh`)
- **Branch:** `feat/v2-replatform`
- **Date:** 2026-08-26
- **Supersedes:** the provisional DESIGN field on `wt-ksh.6` and its ten provisional children,
  which were drafted from a three-question exchange without the spec-then-plan flow. The three
  owner decisions recorded there stand; the task breakdown does not.

## Summary

Polar billing in v2: checkout, customer portal, an idempotent webhook handler, the membership
transitions that move a player between free and pro, the non-pro 2-team cap Phase 4 deferred
here, and the checkout return leg plus the pro-gate enforcement question (`wordle-teams-6tn`,
adopted into this phase).

This is **not** a greenfield integration. v1 migrated Lemon Squeezy → Polar in place and has been
live in production since 2026-08-03. v2 inherits the Polar organizations, the two Pro products
and the webhook endpoints. `src/lib/polar/` on this branch is a working reference implementation
— 563 lines across 8 files, measured — and it encodes three bugs that cost v1 real time plus one
structural flaw this design corrects.

Phase 5 is also the **first phase in which v2 writes `playerMembership` or `webhookEvents`**. That
fact is asserted in four places (`convex/migrate.ts`, `scripts/lib/copy-tallies.mjs`, the `wt-ksh`
epic description, `wt-ksh.9`'s notes) and Phase 5 falsifies all four. See `wordle-teams-r9d`.

## Context — measurements taken before any decision

Every number and claim below came from a command, not from reasoning.

### 1. v1's retry design is decorative — a failed event is never reprocessed

`handlePolarEvent` inserts the `webhook_events` row **before** processing
(`src/lib/polar/webhook.ts:45`). If the membership update or the RPC then fails, it calls
`markProcessed(...)`, which sets `processed: true` *along with* the error message
(`src/lib/polar/webhook.ts:122`), and returns `failed`. The route turns that into HTTP 500
(`src/app/api/webhook/route.ts:77`) so Polar will retry — but the retry's INSERT hits the
`webhook_events_webhook_id_key` unique index
(`supabase/migrations/20260731120000_polar_migration_drop_lemonsqueezy_columns.sql:104`), which
`handlePolarEvent` maps to `{ kind: 'duplicate' }`, which the route answers **200**.

The event is therefore permanently lost, recorded as `processed: true` carrying an error string.
The epic treats "store-then-process-then-500-so-Polar-retries" as the behaviour the whole
idempotency design rests on. In v1 that retry can never succeed.

### 2. After cutover, Polar's `external_customer_id` holds v1 uuids, not Convex ids

v1's `checkout.ts:22` sets `externalCustomerId: playerId`, where v1's `players.id` is a Postgres
uuid (`players_id_fkey → auth.users.id`,
`supabase/migrations/20230816192551_players_auth_user_fkey.sql:23`). v2 stores that same uuid as
`players.legacyId` (`convex/migrate.ts:205`, `v.string()`).

So every existing subscriber's renewal, cancellation and revocation webhook will arrive after
cutover carrying a string that `normalizeId('players', …)` rejects — and it will silently 202.
This is **not** the null-external-id case the epic describes. It is the opposite case, where the
external id *is* populated and simply belongs to the wrong namespace. It affects every paying
customer, and it affects them on revocation.

### 3. Two required `legacyId` fields block every native write

`playerMembership.legacyId` is `v.string()` and `webhookEvents.legacyId` is `v.number()` —
both **required** (`convex/schema.ts:228,236`). They are the only two required `legacyId` fields
left in the schema; `players`, `teams`, `dailyScores` and `monthlyWinners` were each made
optional exactly when their phase began writing natively.

Phase 5 is the first phase to write both tables. Neither can be written without a schema change.
None of the ten provisional children mentions this.

### 4. The brief pointed at a superseded migration

`20240501191728` is not the last definition of `handle_downgrade_team_removal`;
`20240501193430_fix_downgrade_again_need_to_unnest_intarr_in_update.sql` is. The earlier one
carries a real defect — `id != any(teams_to_keep)`, which with two kept ids is true for *every*
id (any id differs from at least one of two), so it deletes the teams it just decided to keep.
The later one replaces both occurrences with `NOT IN (SELECT UNNEST(...))`. **Port the later
one.**

### 5. The keep-2 ordering, measured rather than reasoned

v1's keep query is `select unnest(array_agg(id)) … group by creator, created_at order by (case
when creator = player then 0 else 1 end), created_at limit 2`. Whether `LIMIT 2` bounds *groups*
or *expanded rows* decides whether it can keep three teams.

Measured against the live Postgres on `:54322` (PostgreSQL 15.1):

```sql
select unnest(array_agg(x)) as id
from (values (1,'a'),(2,'a'),(3,'b'),(4,'c')) t(x,g)
group by g order by g limit 2;
--  id
-- ----
--   1
--   2
-- (2 rows)
```

`LIMIT` bounds **expanded rows**. Keep-2 keeps exactly two teams, creator-owned first then
oldest, even when two teams share a `(creator, created_at)` group.

### 6. `@polar-sh/better-auth` does not auto-acknowledge — it returns 400

The provisional Task 0 assumed the plugin might auto-acknowledge the way `@polar-sh/nextjs`'s
`Webhooks` helper does. Read at `@polar-sh/better-auth@1.8.4`, `dist/index.js:801-806`: it
**awaits** `handleWebhookPayload` before `return ctx.json({ received: true })`. It does not
auto-acknowledge.

The disqualifying property is different. On any handler error it throws
`APIError("BAD_REQUEST")` (`dist/index.js:812-816`), and `BAD_REQUEST` maps to **400**
(`better-call@1.3.7`, `dist/error.mjs:56`). The endpoint can therefore only ever produce 200 or
400 — there is no path to the 5xx that makes Polar retry. Same outcome as v1's rejection of
`@polar-sh/nextjs`, reached by a different mechanism. Recording the *precise* reason matters so
this is not re-litigated against the wrong one.

### 7. The pending-upgrade counter is read, but should not be stored

v1's `invites_pending_upgrade` is not vestigial: it drives a badge in
`src/components/app-bar/user-dropdown.tsx:182` ("N Invites Pending", non-pro only), via
`src/lib/utils.ts:121` and `src/lib/types.ts:31`.

But v1 writes it from five call sites using two different formulas (`team_count_above_two` in
`handle_invited_signup` and friends; `invite_count + 1` in `handle_add_player_to_team`), so it can
drift from `teams.invited` even in v1. And decision D's "starts at 0 for everyone" is safe for the
*release* mechanism — which keys off `teams.invited` — but **not** for the badge: a migrated user
with three parked invites would read "0 Invites Pending".

Deriving it from `teams.invited` fixes the badge, removes the drift, and needs no schema field.

### 8. Existing v2 scaffolding Phase 5 must consume, not duplicate

- `convex/lib/teamLimits.ts` already exports `FREE_TEAM_LIMIT = 2`, and its comment explicitly
  names Phase 5 as the phase that must add the server-side check and read this constant rather
  than hardcoding a `2`.
- `cascadeDeleteTeam` (`convex/teams.ts:250`) deletes a team's `monthlyWinners` and
  `scoringSystems` rows before the team doc. It is currently module-private.
- `leaveTeamFor` (`convex/teams.ts:365-383`) already refuses to remove a creator from their own
  team (`CREATOR_NOT_REMOVABLE`) and already has an empty-roster delete branch.
- `convex/http.ts` registers only Better Auth routes today.

## Decisions Made (and alternatives ruled out)

Decisions A–D were settled by the owner before this spec and are carried forward unchanged.
Decisions E–J were made during this brainstorming session, each against a measurement above.

| # | Decision | Ruled out |
|---|---|---|
| A | **The downgrade is softened.** Keep 2 teams, remove the player from the rest, and never delete a team that still has members. A billing event on one account must not destroy a third party's data. | Porting v1's delete-the-teams-they-created behaviour |
| B | **The non-pro 2-team cap is in scope** (folds in the closed `wordle-teams-44o`). It is coupled: the cap parks over-cap invitees in `teams.invited`, and the upgrade transition is what releases them, so Phase 5 builds the release half regardless. | Deferring it again, which means retrofitting onto more joined members later |
| C | **Build everything, then one verification pass** on the Polar sandbox against beta. | Backend-first (recommended, owner overruled) |
| D | **The pending-upgrade counter is not migrated.** v1 keeps it in `auth.users.raw_app_meta_data`, which the copy never reads and must not start reading. | Teaching the copy scripts to read auth metadata |
| E | **The replay guard keys on `processed`, not on row existence.** A row that exists but failed is reprocessed, so the 500-and-retry path actually works. Fixes measurement 1. | Porting v1 faithfully and losing every failed event |
| F | **Identity resolves across both namespaces**, Convex `Id` then `by_legacyId`, repairing the Polar customer forward on a legacy hit. v1's UUID regex is deleted; the check becomes "does this name a real player". Fixes measurement 2. | A pre-cutover backfill script over the Polar API as the *only* mechanism — one-shot, partially failable, and anything it misses fails silently |
| G | **The pending count is derived from `teams.invited`**, not stored. Fixes measurement 7 and removes the `players` schema change entirely. | A denormalised counter on the players doc, per the provisional plan |
| H | **On downgrade, a created-but-left team's owner is reassigned to `playerIds[0]` of the remainder**; the team is deleted only when the remainder is empty. "Earliest-joined" is pinned to the append-ordered array because v2 has no `joinedAt`. | Leaving the team owner-less (V2-ADDENDUM already records that an owner-less team cannot be edited by anyone); leaving the downgraded player as owner of a team they left |
| I | **Raw `@polar-sh/sdk` only.** A plain Convex `httpAction` returns whatever status it needs. Fixes measurement 6. | `@polar-sh/better-auth` (cannot return 5xx); a hybrid split |
| J | **`teams.creator` is renamed to `teams.owner`** across v2, before any Polar code. | Keeping `creator` and accepting a field name that asserts a falsehood; adding `owner` beside an immutable `creator` (nothing reads "who originally created this") |
| K | **The pro gates stay exactly as enforced as v1's**: the invite cap is enforced server-side because v1 enforces it in the RPC; `createTeam` and the scoring editor stay UI-only because v1 does not enforce them either. Closes the second half of `wordle-teams-6tn`. | Enforcing `createTeam` and the scoring editor server-side — a behaviour change dressed as a port, and one that would start refusing writes production accepts today |
| L | **The checkout return leg is ported in drastically reduced form.** v2's reactive query removes the reason v1's version exists. Closes the first half of `wordle-teams-6tn`. | Porting `CheckoutReturn` faithfully, which would carry a session refresh and a timed retry that do nothing in v2 |

### On decision J

The field is read as a **role** everywhere, never as history: `requireTeamCreatorFor` gates
settings, invites, member removal and deletion; `isCreator` gates the UI buttons;
`CREATOR_NOT_REMOVABLE` and `NOT_TEAM_CREATOR` are error codes. None of them consults who made
the team. The name is already mildly false today — the schema comment allows a creator outside a
scoped copy — and decision H makes it plainly false for real production rows.

Given this project's standing rule that comment accuracy is a defect rather than a nit, a *field
name* asserting something untrue is the stronger form of the same defect. Phase 5 is the change
that makes it false, so the fix belongs with its reason, and the migration only gets more
expensive from here.

## Prerequisite 1: `creator` → `owner`, and a three-step deploy

**Measured blast radius: 311 references across 20 files — 14 non-test, 6 test.**

| Area | Refs | Note |
|---|---|---|
| `convex/teams.test.ts` | 164 | mechanical |
| `convex/teams.ts` | 40 | the access helpers and both membership paths |
| `src/components/teams/current-team-card.tsx` | 26 | `isCreator` → `isOwner` |
| `convex/players.test.ts`, `convex/access.test.ts` | 14 each | mechanical |
| `convex/migrate.test.ts`, `convex/scoringSystems.test.ts`, `convex/schema.test.ts` | 10, 9, 1 | mechanical |
| `convex/migrate.ts` | 7 | **only one is a write:** line 323, `{ creator: creatorDoc._id }` |
| `convex/access.ts` | 6 | `requireTeamCreatorFor`, `NOT_TEAM_CREATOR`, `CREATOR_NOT_REMOVABLE` |
| `src/routes/index.tsx`, `my-teams-card.tsx`, `scoring-system-card.tsx` | 4, 3, 3 | UI |
| `convex/scoringSystems.ts`, `convex/e2eSeed.ts`, `convex/schema.ts`, `convex/inviteEmails.ts` | 3, 2, 1, 1 | mechanical |
| `scripts/*.mjs` | 3 | **must NOT change** — see below |

The three `.mjs` references (`scripts/lib/supabase-scope.mjs:61`,
`scripts/lib/copy-filters.mjs:60`, `scripts/copy-from-supabase.mjs:162`) name **v1's Postgres
column** and stay exactly as they are. The copy already translates it into the neutral wire name
`creatorLegacyId`, so the only place the copy writes v2's field is `convex/migrate.ts:323`.

This is why the rename does not really engage the epic's "no changes to `convex/migrate.ts` or
the copy scripts" boundary: that boundary exists to stop *semantic* changes to the copy, and this
is a one-token rename on the write side with the read side untouched.

### The rename cannot be done by clearing and re-copying

Beta holds **natively-created** teams — Phase 4 was owner-confirmed there through the real invite
path — and native rows have no `legacyId`, so a re-copy would not restore them. Convex validates
the schema against existing documents on push, so this is a three-step deploy, mirroring the
pattern Phase 4's spec already established:

1. Add `owner: v.optional(v.id('players'))` **alongside** `creator`. Add the backfill internal
   mutation under this schema. Push.
2. Dry-run the backfill against beta, then run it: `owner = creator` for every team where
   `owner` is unset. Idempotent, counts only, never addresses.
3. Switch every reader and writer to `owner`, drop `creator` from the schema. Push.

Step 2 runs through `v2/scripts/backfill-team-owner.mjs`, mirroring
`cleanup-nameless-players.mjs`: `ConvexHttpClient` + `setAdminAuth`, `--dry-run` by default. It is
not the CLI path — `npx convex run` demands `deployment:data:view`, which no key in this repo
carries, whereas the migration key already carries `runInternalMutations` and
`runInternalQueries`.

**No task may run `convex deploy` or `convex dev`.** Pushing the branch triggers the GitHub Action
that deploys to beta; steps 1 and 3 are ordinary pushes.

**The scaffolding is then deleted.** Once `creator` is gone from the schema, the backfill can
never find an unset `owner` again and can never be tested again. It and
`backfill-team-owner.mjs` come out in the same task that completes step 3.

## Prerequisite 2: the two blocking `legacyId` fields

| Field | Now | After | Why |
|---|---|---|---|
| `playerMembership.legacyId` | `v.string()` | `v.optional(v.string())` | Phase 5 is the first phase to write this table. A membership row for a player born in v2 has no Supabase identity to carry, and a synthesised value would lie to `by_legacyId` and to Phase 7's reconciliation |
| `webhookEvents.legacyId` | `v.number()` | `v.optional(v.number())` | Same reasoning. Every webhook v2 receives is native; the legacy rows are the copied Lemon Squeezy ones |

Both are **widening** changes, so unlike the rename they need no backfill and can land in one
push. `webhookEvents.webhookId` is already `v.optional(v.string())` with the correct comment.

## Architecture

### Layer 1 — pure logic (no Convex, no I/O, no env)

**`convex/lib/polarEvents.ts`** — the event map, ported from `src/lib/polar/events.ts`.

```
subscription.active      → pro      + release parked invites
subscription.uncanceled  → pro      + release parked invites
subscription.revoked     → expired  + apply the team limit
subscription.canceled    → recognised, NO CHANGE
subscription.past_due    → recognised, NO CHANGE
anything else            → null
```

`canceled` means the customer *scheduled* a cancellation and keeps paid access to the end of the
period they paid for; `revoked` means access actually ended. Conflating them strips a paying
customer's teams weeks early.

**Use a `Map`, not an object literal.** The key is an arbitrary string from a webhook; a `Record`
lookup walks the prototype chain, so `'toString'` returns a Function and `'__proto__'` returns an
object — both truthy, both violating the contract that anything unrecognised yields `null`, and
both capable of reaching the database as an `undefined` membership status. Keep v1's
`ACKNOWLEDGED_EVENTS` set so "recognised but inert" stays distinguishable from "unrecognised".
`subscription.created` is deliberately absent: it fires when a subscription record is established,
which is not the same as it being paid for.

**`convex/lib/polarIdentity.ts`** — pure extraction of identity *candidates* from a webhook body,
in preference order: `customer.externalId`, then `metadata.player_id`, then `checkoutId`. Pure and
therefore directly testable; it returns candidates, it does not resolve them.

### Layer 2 — Convex functions

**`convex/polar.ts`** — actions, because they need `fetch` and the Polar SDK.
`createProCheckout`, `getCustomerPortalUrl`, `fetchCheckoutExternalId`,
`repairCustomerExternalId`.

**`convex/billing.ts`** — internal mutations and the `...For` helpers:
`processPolarEvent`, `recordWebhookFailure`, `upgradeTeamInvitesFor`,
`downgradeTeamRemovalFor`, `resolvePlayerIdFor`.

**`convex/http.ts`** — gains `POST /polar/webhook` as a raw `httpAction`.

**Every rule lives in a `...For` helper, never in a query or mutation wrapper** —
`convex-test` cannot stand up a Better Auth session (`wordle-teams-obw`). Throw `ConvexError`
via `accessError`, never a plain `Error`.

### Layer 3 — UI

The upgrade button and the portal link, plus the derived "N Invites Pending" badge. `enabled:` does
not gate a Convex query and is not a security boundary — use `'skip'`.

## The webhook pipeline

Convex mutations are transactional, which removes a failure mode v1 has structurally: v1's insert,
update and RPC are three separate statements, so it can reach a row marked `processed: true`
carrying an error. In v2, store + process + mark is **one** mutation, so a throw rolls all of it
back and that state is unreachable.

```
httpAction POST /polar/webhook:
  validateEvent(rawBody, headers, secret)      → 403 on a bad signature
  webhookId = headers['webhook-id']            → 400 if absent
  candidates = extractIdentity(event.data)     (pure, Layer 1)
  resolved  = runQuery(resolvePlayerId, candidates)
  if (!resolved && candidates.checkoutId)      ← the only Polar API call on this path
      resolved = runQuery(resolvePlayerId, await fetchCheckoutExternalId(...))
  if (!resolved) → 202                         (foreign or unknown; retrying can never help)
  try   { runMutation(processPolarEvent) } → 200
  catch { runMutation(recordWebhookFailure); → 500 }   ← Polar retries
```

`processPolarEvent`, one transaction:

```
existing = by_webhookId(webhookId)
if (existing?.processed) return 'duplicate'          → 200, nothing reprocessed
row = existing ?? insert({ ..., processed: false })
transition = mapEventToTransition(eventName)
if (transition) {
    patch playerMembership.membershipStatus
    run upgradeTeamInvitesFor | downgradeTeamRemovalFor
}
patch(row, { processed: true })
```

A failure throws, the transaction rolls back, and `recordWebhookFailure` writes the audit row
**separately** with `processed: false` and `processingError`. The retry finds `processed: false`
and reprocesses. This split is the one piece with no v1 precedent, and it exists precisely because
the rollback that makes v2 correct would otherwise also erase the evidence.

The 202 cases are deliberate and must not become 500s: a foreign or unresolvable external id is
not a transient fault, and returning 500 would put Polar into an endless redelivery loop over an
event this app can do nothing with — for instance one belonging to a different integration on the
same organization.

## Identity resolution

Candidates in preference order — `customer.externalId`, `metadata.player_id`,
`checkouts.get(checkoutId)` — each resolved against **both** namespaces:

```ts
const direct = ctx.db.normalizeId('players', raw)
if (direct && (await ctx.db.get(direct))) return direct

const legacy = await ctx.db
  .query('players')
  .withIndex('by_legacyId', (q) => q.eq('legacyId', raw))
  .unique()
if (legacy) {
  // fire-and-forget: stamp the Convex id onto the Polar customer so later
  // events take the fast path. Never fatal — the current event is resolved.
  void repairCustomerExternalId(customerId, legacy._id)
  return legacy._id
}
return null // → 202
```

v1's UUID regex is deleted outright. It cannot be ported: v2's player id is a Convex `Id`, not a
uuid, and the v1 uuids that *do* arrive are `legacyId` values rather than player ids. The check
that replaces it is "does this name a real player", which is the question that actually matters.

## Membership transitions

**`upgradeTeamInvitesFor`** — for every team whose `invited` holds the player's lowercased email:
drop the email, append their id. No counter to zero, because the badge is derived (decision G);
moving the player out of `invited` makes it fall to 0 by construction. Addresses in `invited` are
always lowercase by schema rule (`convex/schema.ts:101-107`), so compare normalised.

**`downgradeTeamRemovalFor`** — softened per decision A, ported from `20240501193430`:

1. Keep 2 teams, ordered owner-held first then oldest by `createdAt` (v1's verified semantics,
   measurement 5).
2. For every other team the player is on: remove them from `playerIds`.
3. If they owned it, reassign `owner` to `playerIds[0]` of the remainder.
4. Only if the remainder is empty, **`cascadeDeleteTeam`** — not a bare `db.delete`, or the
   team's `monthlyWinners` and `scoringSystems` rows are orphaned. That function is private at
   `convex/teams.ts:250` and must be exported.

Step 4 is a **new `db.delete` site**, which `wt-ksh.9`'s runbook step 2 and the delete-site
inventory in `scripts/lib/copy-tallies.mjs` both enumerate. Both must be checked and updated.

Note that steps 2–4 only bite a player who owns **3+** teams: the keep-2 ordering already puts
owner-held teams first, so anyone owning two or fewer keeps all of them.

## The non-pro 2-team cap

Enforced in Phase 4's `invitePlayerFor`, reading `FREE_TEAM_LIMIT` from
`convex/lib/teamLimits.ts` rather than hardcoding a `2` — that constant's own comment requires it.
Over cap and not pro → park the lowercased address in `teams.invited` instead of adding the
player.

v1 implements this in two places and **both work**: `handle_invited_signup` (invitee signs up
after being invited) and `handle_add_player_to_team` (invitee already has an account). The earlier
claim that the latter is broken in production is **false** and was corrected on 2026-08-22: the
`invited_id` bug was real but was fixed on 2024-04-29 (`20240429204119`), and the current
definition (`20240501180309`) caps correctly. Port the real behaviour.

Phase 4's invite result already has four distinct outcomes; the cap adds a fifth rather than
collapsing into a generic failure. Phase 4 established that telling the creator exactly what
happened is the point.

## The checkout return leg, and the pro gates (`wordle-teams-6tn`)

`wordle-teams-6tn` is folded into this phase. Its acceptance criterion is that Phase 5's scope
names `CheckoutReturn` and states whether the pro gates are enforced server-side. Both are
answered here.

### The return leg is mostly unnecessary in v2

v1's `src/components/checkout-return.tsx` exists to defeat a **JWT staleness** problem, which its
own header states: `user_member_status` is stamped into the Supabase token when it is issued, so
without `supabase.auth.refreshSession()` the token still says "free" no matter what the database
holds. On top of that it schedules a 2-second retry, because Polar's webhook races the browser
redirect.

**v2 has neither problem.** Membership is read through `api.teams.amIPro` with `convexQuery` +
`useSuspenseQuery` (`src/routes/index.tsx:66`) — a reactive websocket subscription, not a claim
baked into a token. When `processPolarEvent` patches `playerMembership`, every subscribed client
updates on its own. The session refresh has nothing to refresh, and the retry has nothing to
retry: a slow webhook simply means the subscription updates a moment later.

So the port keeps only what is still real:

1. **Strip `?checkout=success`** from the URL so a reload does not re-trigger anything.
2. **Show a pending state** — "finishing your upgrade…" — when the player returns from checkout
   and `amIPro` is still false, resolving by itself the instant the webhook lands. This is the
   honest version of v1's retry: v1 re-fetched because it had to, v2 waits because it does not.
3. **No `refreshSession`, no timer, no `handled` ref.** The `useRef` guard exists only because
   React Strict Mode double-mounts effects that perform a refresh; with no refresh to perform,
   the guard has nothing to guard.

The success URL keeps v1's shape and returns the player to the page that renders their
membership.

### The pro gates are enforced exactly as far as v1 enforces them

`isProFor`'s doc comment (`convex/access.ts:202-209`) currently reads "READ ONLY, AND NOT
ENFORCED … Phase 5 owns whether that changes." This is that decision, and the answer is **no
change** — with one exception that was already decided.

| Gate | v1 | v2 after Phase 5 | Why |
|---|---|---|---|
| Invite past the 2-team cap | **Enforced server-side**, in `handle_add_player_to_team` and `handle_invited_signup` | **Enforced** | Decision B. Porting real v1 behaviour, not adding a rule |
| `createTeam` past 2 teams | UI-only; nothing stops a free account creating five teams through the API | **UI-only** | Enforcing would refuse writes production accepts today — a behaviour change dressed as a port |
| Scoring-system editor | UI-only; the `save` action does not check pro | **UI-only** | Same |

The asymmetry is v1's, not an inconsistency introduced here: v1 enforces the cap on the path
where *somebody else* adds you to a team, and leaves the paths you drive yourself to the UI. Phase
5 reproduces that shape.

`isProFor`'s doc comment must be rewritten to record the resolution rather than continue deferring
to a phase that has now happened.

**Still not owned by any phase, and deliberately not adopted here:** the month-navigation history
gap Phase 2 deferred (v2 shows a pro user less history than production) and `wordle-teams-k7w`
(the monthly-winner celebration dialog). Neither is a billing behaviour; folding them in because
they are adjacent is how a phase stops closing.

## Error handling

| Condition | Response | Why |
|---|---|---|
| Bad signature | 403 | Not ours |
| Missing `webhook-id` header | 400 | Malformed; retrying cannot fix it |
| Unresolvable player id | 202 | Foreign or unknown; retrying can never succeed |
| Already processed | 200 | Genuine replay |
| Processed successfully | 200 | — |
| Processing threw | 500 | Transient; Polar retries and v2 now reprocesses |

All app-level refusals throw `ConvexError` via `accessError`. Plain `Error` messages are redacted
in production but never redacted by `convex-test`, so tests cannot see the difference
(`wordle-teams-obw`, and the redaction blind spot).

## Divergences from v1 — the list goes from eleven to thirteen

To be written into `V2-ADDENDUM` §7a:

- **8 (updated)** — the non-pro 2-team cap now exists in v2. It previously recorded v2 as *more
  permissive* than production.
- **12 (new)** — the softened downgrade. v2 never deletes a team that still has members, and
  reassigns `owner` to the earliest-joined remaining member instead.
- **13 (new)** — the replay guard keys on `processed`, not on row existence, so a failed event is
  retried rather than swallowed as a duplicate.

Also for the record, though not divergences: `20240501193430` supersedes `20240501191728`, and
`@polar-sh/better-auth` is rejected for returning 400 rather than for auto-acknowledging.

## Testing

**The silent-202 unit test is a release gate**, per decision C — it must pass before any sandbox
run, so the sandbox confirms a bug already proved closed rather than discovering it. It now needs
**two** cases, because measurement 2 found the more common one:

1. `customer.externalId` null, `metadata.player_id` present → resolves.
2. `customer.externalId` set to a **v1 uuid** → resolves via `by_legacyId`. This is the case that
   hits every migrated customer.

Also pinned by tests:

- Every one of the five acknowledged events, plus `'toString'`, `'__proto__'` and `'constructor'`
  returning null.
- A duplicate `webhook-id` returns success without reprocessing.
- A *failed* event, redelivered, **is** reprocessed — the inverse of the above, and the thing v1
  gets wrong.
- `canceled` and `past_due` change no membership and remove no teams.
- A downgrade with 5 teams keeps exactly 2; an owned-and-left team survives with a reassigned
  owner; a team with no members left is deleted *with its cascade*; a team containing another
  member is never deleted.
- A free invitee at the cap is parked; a pro invitee is added regardless of count; upgrading
  releases every parked invite.

**Mutation testing** on `polarEvents.ts` and `downgradeTeamRemovalFor`, both load-bearing: a
CONTROL and a SANITY mutant, verdicts from **exit codes**, in an isolated extraction
(`git archive <sha>:v2` with `node_modules` symlinked) — never the live tree.

Gates from `v2/`: `pnpm lint && pnpm typecheck && pnpm test:once && pnpm build`. `pnpm e2e` is
**not** in the gates; the rename touches `current-team-card.tsx` and `index.tsx`, so e2e must be
run by hand for the rename task.

## Out of Scope

- Any *semantic* change to `convex/migrate.ts` or the copy scripts. The `creator` → `owner`
  rename touches `migrate.ts:323` by one token; nothing else about the copy changes.
- `wordle-teams-b31` (`internal.migrate.counts` does six unbounded `.collect()`s). Real, P1, and
  flagged on Phase 7 — but a verifier problem, not a billing one. **Phase 5 must not add another
  caller.**
- `wordle-teams-g3k`, the paying customer's unbounded grace period — resolved by hand on
  2026-09-05 against production.
- The comped pro accounts. They arrive with `membershipStatus: 'pro'` via the copy and nothing in
  v2 revokes them, because no Polar event references them. Correct by construction.
- Reviving the dropped `player_customer` columns. Nothing branched on the variant; every gate is
  just "are they pro".
- `wordle-teams-k7w` (the monthly-winner celebration dialog) still has no owning phase. Not
  adopted here — it is not a billing behaviour.
- The month-navigation history gap Phase 2 deferred, noted in `wordle-teams-6tn` and left open by
  it. v2 shows a pro user less history than production; that is a Phase 2 deferral to settle in
  the Phase 7 parity audit, not a Polar task.

`wordle-teams-6tn` **is** adopted (decisions K and L) and closes with this phase.

## Acceptance Criteria

1. Sandbox subscribe / upgrade / downgrade / cancel all mutate team limits correctly, confirmed
   by the owner on beta.
2. A checkout resolving to a pre-existing Polar customer with a null external id upgrades the
   right user, **and** a webhook carrying a v1 uuid resolves via `by_legacyId` — both pinned by
   unit tests before the sandbox ever runs.
3. A duplicate `webhook-id` returns success without reprocessing, **and** a previously failed
   event is reprocessed on redelivery.
4. `subscription.canceled` and `subscription.past_due` change no membership and remove no teams;
   only `subscription.revoked` downgrades.
5. A downgrade never deletes a team that still has members; the cascade runs when it does delete;
   divergences 12 and 13 are recorded in `V2-ADDENDUM` §7a.
6. A non-pro invitee at the cap is parked in `teams.invited` rather than added, and upgrading
   releases every parked invite.
7. `teams.creator` no longer exists; `owner` carries the role everywhere; the backfill scaffolding
   is deleted.
8. Returning from checkout shows a pending state that resolves **without a reload or a refresh**
   when the webhook lands, and `?checkout=success` is stripped from the URL.
9. `isProFor`'s doc comment records the enforcement decision instead of deferring to Phase 5, and
   `wordle-teams-6tn` closes.
10. Four gates green, e2e run by hand for the rename and the return leg, beta deploy green.

## Task Breakdown

Ordered. The rename lands first so no Polar code is written against the old name.

| # | Task | Gate |
|---|---|---|
| 0 | Add `owner` beside `creator`; add the backfill internal mutation + `backfill-team-owner.mjs`. Push (deploy step 1) | Gates green |
| 1 | Dry-run then run the backfill against beta (deploy step 2) | Counts reported, non-zero verified against a deployment known to hold data |
| 2 | Switch all 311 references to `owner`, drop `creator` from the schema, delete the backfill scaffolding. Push (deploy step 3) | Gates green + **e2e by hand** |
| 3 | Widen `playerMembership.legacyId` and `webhookEvents.legacyId` to optional | Gates green |
| 4 | `convex/lib/polarEvents.ts` — the pure map | Five events + three prototype keys pinned |
| 5 | `convex/lib/polarIdentity.ts` + `resolvePlayerIdFor` — dual-namespace resolution | **Both silent-202 cases pinned** |
| 6 | `upgradeTeamInvitesFor` + the derived pending badge | Three parked invites released; badge correct for a migrated user |
| 7 | `downgradeTeamRemovalFor` — softened; export `cascadeDeleteTeam` | Four downgrade cases pinned; delete-site inventories updated |
| 8 | The 2-team cap in `invitePlayerFor`, reading `FREE_TEAM_LIMIT` | Cap cases pinned; fifth invite outcome |
| 9 | `convex/polar.ts` actions + `@polar-sh/sdk` dependency | Env validation fails loudly and identically |
| 10 | The webhook `httpAction` + `processPolarEvent` + `recordWebhookFailure` | Duplicate **and** failed-then-retried both pinned |
| 11 | Upgrade / portal UI | e2e by hand |
| 12 | The checkout return leg + `isProFor`'s doc comment (closes `wordle-teams-6tn`) | Pending state resolves with no reload; e2e by hand |
| 13 | Divergences 8, 12, 13; sandbox verification; phase close | Owner-confirmed on beta |

## Gotchas Carried Into This Phase

- Run everything from inside `v2/` except git. Import alias is `#/`; Convex modules use explicit
  `.ts` extensions.
- **Do not use `--no-verify`.** `core.hooksPath` is `.beads/hooks`; the pre-commit hook exports
  and stages `.beads/issues.jsonl` and chains to `scripts/check-no-pii.mjs`, the PII guard for
  this **public** repo.
- `bd export -o .beads/issues.jsonl` is the reliable flush; `grep -c` each new id before *and*
  after committing.
- Do not commit while a subagent runs — a subagent's `--amend` swallows any commit landing
  mid-flight. Queue controller commits.
- Run reviewers **serially**, never in parallel.
- Polar's sandbox is a wholly separate instance from production: separate accounts,
  organizations, products and tokens. Server and credentials always move together.
- Never put a third party's email address in a beads issue.

## Operational note

Standing authorization covers pushing `feat/v2-replatform` and letting it deploy to beta, watched
with `gh run watch`. **Not** prod, **not** main. Subagents never push.

Polar env vars needed, mirroring v1's `client.ts`: `POLAR_ACCESS_TOKEN`, `POLAR_WEBHOOK_SECRET`,
`POLAR_PRO_MONTHLY_PRODUCT_ID`, `POLAR_PRO_ANNUAL_PRODUCT_ID`. Validate all four together so a
partially configured environment fails loudly and identically everywhere. Note that
`.env.production.local` in this repo is stale and pre-dates the Polar migration.
