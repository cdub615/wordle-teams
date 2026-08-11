# Implementation Plan: v2 Phase 1 — Auth complete + data copy

**Date:** 2026-08-11
**Branch:** `feat/v2-replatform`
**Beads:** `wt-ksh.2` (phase) → child tasks below
**Depends on:** Phase 0 (`wt-ksh.1`), closed 2026-08-03 — beta live at `beta.wordleteams.com`

---

## 1. What this phase is

The full Convex data model, a re-runnable copy of real data out of Supabase, and
the complete auth surface: email OTP (already working) plus the social providers
real users actually have, with account linking by verified email.

**Done when:** a real copied account logs in on beta via OTP *and* via Google,
and lands on a page that shows its own copied data.

That done-when is the design's, minus passkey enrollment — see §3.

---

## 2. Decisions taken before planning

Three questions were settled with the owner on 2026-08-11. Two of them changed
the design.

### 2.1 Social providers: keep five, drop one — not the design's four

The design proposed trimming six providers to Google, Azure, GitHub and
Twitter/X. Measured against production (`scripts/prod-auth-providers.mjs`,
2026-08-11, 530 auth users):

| Provider | Linked identities | Ever signed in |
|---|---:|---:|
| email (OTP) | 265 | 143 |
| google | 236 | 236 |
| azure | 15 | 15 |
| discord | 6 | 6 |
| github | 6 | 6 |
| twitter | 2 | 2 |
| slack | 0 | 0 |

The design's list is **inverted against usage**: it drops Discord (6 users, all
active) while keeping Twitter/X (2 users) — the one it separately flags as
unreliable because X does not always return an email.

**Decision: carry google, azure, discord, github, twitter. Drop slack only.**
Slack has zero users, so dropping it costs nothing and saves a registration.
Nobody loses the button they already use. The extra cost over the design's list
is one OAuth app registration, in two environments.

### 2.2 Beta gets the owner's teams only, not all 530 users

`beta.wordleteams.com` is publicly reachable with no auth wall, and Phases 2–6
are months of work.

**Decision: copy only the owner's teams and their players for now.** That is
enough realistic data to build and verify Phases 2–6 against. The full copy runs
at the Phase 7 parity audit (`wt-ksh.8`), once beta is hardened — and again in
the cutover window, as the design already requires.

The copy script is written for the full set from day one and takes the scope as a
parameter, so Phase 7 changes an argument rather than the code.

### 2.3 Passkeys deferred to post-cutover

Passkeys are one of only two sanctioned *new* features in the whole replatform,
not a port. `@convex-dev/better-auth` is pre-1.0 with a breaking-change cadence
and its passkey-table support needs verifying before it can be relied on
(`wt-ksh.2.1`).

**Decision: drop passkeys from Phase 1** and revisit after cutover. Phase 1 gates
every later phase; a new feature on the critical path is the wrong trade. The
phase acceptance criterion loses "and enrols a passkey" accordingly.

---

## 3. Scope

**In scope**

- Convex schema for the six tables, with the indexes the later phases need
- Copy script `v2/scripts/copy-from-supabase.ts`, re-runnable, scope-parameterised
- Parity spot-check script (row counts and known aggregates, Supabase vs Convex)
- Five social providers wired in Better Auth + OAuth console registrations with beta callbacks
- Account linking by verified email
- The two deferred Phase 0 follow-ups: auth hardening (`wt-ksh.2.1`) and the
  pre-hydration login form (`wt-ksh.2.2`)

**Out of scope**

- Passkeys (§2.3)
- Access-check helpers and any scoreboard/board-entry UI — those are Phase 2
- Prod OAuth callback URLs — added in the pre-cutover week (Phase 8)
- The full 530-user copy — Phase 7
- Any UI beyond what the done-when needs to be observable

---

## 4. Data model

Six tables port near 1:1. Every document keeps `legacyId` — the Supabase primary
key — so the copy is idempotent and re-runnable, and so Phase 7 can reconcile.

| Supabase | Convex | Notes |
|---|---|---|
| `players` (uuid pk) | `players` | `legacyId` = uuid. Links to the Better Auth user by verified email. |
| `teams` (int pk) | `teams` | `legacyId` = int. `player_ids` → `Id<'players'>[]`. |
| `daily_scores` (int pk) | `dailyScores` | index on player + date |
| `monthly_winners` (int pk) | `monthlyWinners` | index on team + year + month |
| `player_customer` | `playerMembership` | **only** `membership_status` — see §4.1 |
| `webhook_events` | `webhookEvents` | `webhookId` string, unique — see §4.2 |

### 4.1 `player_customer` is smaller than the design assumed

The design was written on 2026-07-16, before the Lemon Squeezy → Polar migration
that shipped on `dev` and merged into this branch. That migration **dropped
`customer_id` and `membership_variant`** — Polar identifies customers by
`external_customer_id`, and nothing ever branched on the variant.

So the Convex table carries `membership_status` and the player link, and nothing
else. Do not port the two dropped columns back into existence.

### 4.2 `webhookId` must be a string with a uniqueness guard

Polar follows Standard Webhooks, whose ids look like
`msg_2KWPBgLlAfxdpx2AI54pPJ85f4W` — **not UUIDs**. v1 lost a day to a `uuid`
column that rejected them and put Polar into an infinite retry loop. Convex has
no unique constraints, so idempotency is enforced in the mutation: index on
`webhookId`, look it up, return early if present.

### 4.3 Invited emails are normalised to lowercase on write

v1's `invited[]` matched case-sensitively while auth stored addresses
lowercased, so anyone invited at a mixed-case address never joined their team.
It is a data-model bug, not a platform bug, and **a faithful port reproduces
it**.

The invite *flow* is Phase 4, but the storage rule belongs to the schema, so it
lands here: the copy script lowercases every `invited[]` entry as it writes, and
Phase 4 inherits a table that cannot hold a mixed-case invite.

---

## 5. Tasks

Each is atomic with a "done when". Ordering constraints are noted; everything
else can move.

### T1 — Convex schema for the six tables
Define all six with indexes, `legacyId` on each, and the §4 corrections applied.
Convex-test coverage for the shape-sensitive parts only.
**Done when:** `convex deploy` pushes the schema clean, and `pnpm test:once` covers
insert/read for each table.

### T2 — Auth hardening follow-ups (`wt-ksh.2.1`)
`storeOTP: 'hashed'`; a shared `OTP_EXPIRY_SEC` driving both `expiresIn` and the
email copy; import `emailOTP` from the `better-auth/plugins/email-otp` subpath; a
real email template with a plain-text part and an "if you didn't request this"
line. Also check the `@convex-dev/better-auth` migration guide at the current
0.12.x+ before touching anything else in the auth config.
**Done when:** the OTP e2e still passes and a real code email renders correctly in
a mail client.

### T3 — Pre-hydration login form (`wt-ksh.2.2`)
The SSR form looks interactive before React hydrates: a click fires a native GET
and the controlled input wipes typed text. Fix with a hydration-gated submit or
an uncontrolled input with `defaultValue`.
**Done when:** the e2e retry-until-hydrated workaround can be deleted and the test
still passes.

### T4 — OAuth console registrations *(manual, owner)*
Five providers — Google, Azure, GitHub, Discord, Twitter/X — each with the beta
callback URL. Client ids and secrets into the Convex deployment env, never the
repo.
**Blocks T5's verification.** Prod callbacks are Phase 8, not now.
**Done when:** all five app registrations exist with beta callbacks and their
credentials are set on the Convex deployment.

### T5 — Social providers + account linking
Wire the five providers in `createAuth`, with account linking by *verified* email
so a copied account reached via Google resolves to the same user as via OTP.
**Done when:** signing in with Google on beta lands on the same user as signing in
with OTP on that address.

### T6 — Copy script
`v2/scripts/copy-from-supabase.ts`: reads Supabase with the service-role key,
writes through Convex internal mutations, idempotent on `legacyId`, and takes a
scope argument (owner's teams now, everything at Phase 7). Lowercases `invited[]`.
Creates Better Auth users by email with the verified flag, per §2.2 of the design.
**Depends on T1.**
**Done when:** running it twice produces the same row counts, and the owner's
account exists in Convex with its real teams and scores.

### T7 — Parity spot-check script
Asserts row counts per table and a couple of known aggregates (a specific
month's winner) match between Supabase and Convex for the copied scope.
**Depends on T6.**
**Done when:** it passes against a fresh copy run and fails loudly if a count drifts.

### T8 — Phase 1 verification & close-out
Full local gate, the done-when on beta, prod regression sanity, close `wt-ksh.2`.
**Done when:** the §1 done-when is met and the phase is closed.

---

## 6. Risks

- **`expectAuth: true` blocks all Convex queries for signed-out users.** Any
  public page with live Convex data will hang. Nothing in Phase 1 adds one, but
  T5's provider buttons live on `/login`, which is signed-out. Watch for it.
- **`@convex-dev/better-auth` is pre-1.0.** The `AuthClient` cast in `__root.tsx`
  assumes structural compatibility between better-auth 1.6.23 and component types
  built for 1.6.15. The e2e suite is the only guard. Never bump better-auth
  without running it; consider an exact pin as part of T2.
- **Five OAuth registrations is five chances to misconfigure a callback.** Each
  needs testing individually on beta; a working Google says nothing about Discord.
- **The copy script reads production.** It must be read-only against Supabase and
  must never print addresses — this repo is public. Follow the existing
  `scripts/*.mjs` conventions, which already enforce a prod-ref guard.

---

## 7. Still open, deliberately not blocking

`wordle-teams-dts` — whether the funnel data (87% of signups never enter a board;
~7% login conversion, measured before the lemonsqueezy lockout fix) should change
the sequencing of this replatform. Phase 1 is the point where the investment gets
large. Proceeding on the DX and vendor-reduction drivers; the cost driver is
documented as no longer surviving contact with the data.
