# Re-platform to v2: Cloudflare + TanStack + Convex — Design

**Date:** 2026-07-16
**Status:** Approved design, Phase 0 partially built. **Amended 2026-08-03 — see
[Amendments](#amendments-2026-08-03) at the end; several decisions below are superseded.**

## Summary

Rewrite wordle-teams as a new app (`v2/`) on a new platform stack, built in parallel
with the existing production app, tested at `beta.<domain>`, and cut over via DNS flip
when feature parity is verified. Strict 1:1 functional parity — no new features, no
redesigns — with two sanctioned exceptions: Convex reactivity making scoreboards
live-update (free win), and passkey enrollment (near-zero marginal cost inside the
Better Auth slice).

## Context & Drivers

- **Cost:** Vercel pricing grows steeply with scale; Cloudflare's curve is much flatter.
  Get ahead of growth.
- **DX/architecture:** the app is a client-heavy dashboard — TanStack's client-first
  model fits better than Next.js RSC/server actions.
- **Vendor reduction:** ~10 vendors today, ~6 after.

**Constraints:** ~40 DAU in production daily, small data, solo developer with a few
hours/week. Existing app must remain fully live and supported throughout. One paying
customer (~$2/mo Lemon Squeezy subscription) who must be personally migrated.

## Decisions Made (and alternatives ruled out)

| Decision | Chosen | Ruled out / why |
|---|---|---|
| Database | **Convex** | Neon — data layer must be rewritten either way (RLS + DB functions are Supabase Auth–coupled), so Convex's rewrite penalty evaporates; its reactive model fits a client-heavy dashboard best; generous free tier |
| Auth | **Better Auth** via `@convex-dev/better-auth` | Clerk/Convex Auth — user preference; open source; Polar has a first-party Better Auth plugin |
| Payments | **Polar.sh** via `@polar-sh/better-auth` | Built into new app from day one; no in-place Lemon Squeezy→Polar phase (only 1 subscriber) |
| Notifications | **No vendor** — Convex cron + `web-push` + Resend | Knock — one workflow doesn't justify a platform; Convex scheduling replaces both Novu and QStash |
| Strategy | **Vertical slices on a walking skeleton** (Approach A) | Layer-first (nothing testable end-to-end for weeks); strangler proxy on prod domain (sessions can't span two auth/db systems; machinery costs more than the rewrite at 40 DAU) |
| Repo | **`v2/` folder in this repo**, fully self-contained | Separate repo — same-workspace old code is superior reference material during porting |
| Beta data | **One-shot re-runnable copies** from Supabase | Live/two-way sync — sync machinery is where solo projects die; buys nothing at this scale |
| Parity | **Strict 1:1** | Redesigns/new features go to a post-cutover backlog |

## Target Architecture

| Concern | Choice | Notes |
|---|---|---|
| Framework | TanStack Start (Router + Query + server functions), Vite, React 19 | Server functions only where needed (webhooks, auth) |
| Hosting | Cloudflare Workers (TanStack Start Cloudflare target) | Wrangler; `beta.` subdomain during parallel run |
| Data | Convex — schema, queries/mutations, crons, scheduled functions | `@convex-dev/react-query` for live-updating TanStack Query data |
| Auth | Better Auth on Convex | Email OTP + Google, Azure, GitHub, Twitter/X + passkey plugin |
| Payments | Polar.sh via Better Auth plugin | Checkout, customer portal, webhooks |
| Email | Resend + react-email | Ports nearly as-is; also sends Better Auth OTP emails |
| Reminders | Convex cron → `web-push` + Resend | Replaces Novu + QStash + both reminder API routes |
| PWA | vite-plugin-pwa (Workbox) | Replaces Serwist; manifest ports as-is |
| Errors | Sentry (Cloudflare/TanStack SDK) | Wired from Phase 0 |
| Analytics/logs | Cloudflare Web Analytics; Workers Logs; keep LogSnag | Drop Vercel Analytics/Speed Insights, next-axiom, Axiom |

**Killed with no replacement:** Novu, QStash, Vercel KV, Edge Config, Lemon Squeezy SDK,
Serwist, next-axiom, Axiom.

**Open checklist item (verify in Phase 0):** whether Supabase Storage buckets hold real
user files (e.g. avatars). If yes → Convex file storage; if unused → nothing to do.

## Repo Layout & Environments

```
wordle-teams/            ← repo root unchanged; Vercel keeps building it
├── src/ ...             ← current Next.js app, untouched until cutover
├── supabase/
└── v2/                  ← new app, fully self-contained island
    ├── package.json     ← own deps, own pnpm-lock.yaml (NOT a workspace member)
    ├── wrangler.jsonc
    ├── convex/          ← schema, functions, crons, auth config
    ├── src/             ← TanStack Start app
    └── scripts/         ← copy-from-supabase.ts + parity verification
```

**Island rule:** no imports across the `v2/` boundary, no shared lockfile, no root
tooling changes. Old code is reference material only.

| Env | Hosting | Convex | Domain |
|---|---|---|---|
| Local dev | `vite dev` + `convex dev` | personal dev deployment | localhost |
| Beta | Cloudflare Workers | prod deployment of the project | `beta.<domain>` |
| Prod (post-cutover) | same Worker, promoted | same Convex project — beta *becomes* prod | main domain |

The beta Convex project becomes the prod project at cutover: final data copy overwrites
beta test data, domain flips. No second migration.

**Deploys:** GitHub Action on `v2/`-touching pushes → `convex deploy` + `wrangler deploy`.
Vercel's existing auto-deploy of `dev` continues untouched (never trigger Vercel manually).

**DNS:** nameservers move to Cloudflare early (free plan) — prerequisite for beta
subdomain and cutover; Vercel keeps serving apex/www through the same records.

## Data Model & Migration

**Tables (6, port near-1:1):** `players`, `teams`, `daily_scores`, `monthly_winners`,
`player_customer` (becomes Polar customer mapping), `webhook_events`. Docs keep a
`legacyId` for idempotent re-copying (or wipe-and-reload — fine at this size).
Relations become Convex ID references + indexes.

**Postgres logic relocation:**

| Today (in the DB) | In Convex |
|---|---|
| RLS policies | Access checks at top of each query/mutation, centralized in small helper functions |
| `handle_invited_signup`, `handle_add_player_to_team` | Mutations in invite/onboarding flow (Phase 4) |
| `handle_upgrade_team_invites`, `handle_downgrade_team_removal` | Mutations called by Polar webhook handler (Phase 5) |
| `update_monthly_winners` (trigger) | Logic inside score-submission mutation (transactional, so trigger semantics port cleanly) |
| `get_players_for_reminder`, `update_last_board_entry_reminder` | Internal functions called by reminder cron (Phase 6) |
| `custom_access_token_hook` (JWT claims) | Not needed — claims fed RLS; checks now read membership directly |

**Auth migration:** login is passwordless (email OTP) → no password hashes to migrate.
Copy script creates Better Auth users by email (+ name, verified flag). Sessions do not
carry over — the only user-visible cost of the entire migration is one extra login.

**Social OAuth:** trim to Google, Azure, GitHub, Twitter/X. Safe because OTP on the same
email is the universal fallback for users of dropped providers. Better Auth links social
logins to existing accounts by verified email; Twitter/X doesn't always return an email —
OTP is the fallback there too. Each provider needs OAuth app registrations with beta
callback URLs (during build) and prod callbacks (at cutover) — explicit checklist work
in Phase 1.

**Passkeys:** Better Auth passkey plugin + one "Add passkey" button in account settings.

**Copy script** (`v2/scripts/copy-from-supabase.ts`): reads Supabase with service-role
key, writes via Convex internal mutations. Re-runnable on demand; run once more during
the cutover window.

## Phase Plan

Each phase is independently shippable to beta, sized for 1–2 weeks of a few-hours/week
solo pace. **No phase starts until the previous phase's done-when is met.**
Phases 2→4 are strictly ordered; Phases 5 and 6 are independent of each other and may
interleave; nothing else may.

- **Phase 0 — Walking skeleton.** TanStack Start scaffold in `v2/`, Convex project,
  Better Auth email OTP only, deploy pipeline, `beta.` DNS, Sentry.
  ✅ *Done when: OTP login works at `beta.<domain>` and a page renders one value
  round-tripped through Convex.*
- **Phase 1 — Auth complete + data copy.** Full Convex schema, copy script (users +
  6 tables), social providers incl. OAuth console registrations, passkey plugin,
  account linking.
  ✅ *Done when: your real copied account logs in via OTP and via Google on beta, and
  enrolls a passkey.*
- **Phase 2 — Core loop.** Board entry (porting the recent mobile keyboard/viewport
  work faithfully), scoreboard, month navigation, monthly-winner logic in the score
  mutation, access-check helpers.
  ✅ *Done when: a full fake day works on beta — enter board, live score updates,
  correct monthly winner.*
- **Phase 3 — Teams.** Create/switch/manage, member lists, settings, team-scoped
  access checks.
  ✅ *Done when: a multi-team account behaves identically to prod side-by-side.*
- **Phase 4 — Invites & onboarding.** Invite flow, invited-signup + add-player
  mutations, complete-profile flow, invite emails via Resend.
  ✅ *Done when: a fresh email invited on beta lands on the right team with the right
  profile.*
- **Phase 5 — Payments (Polar).** Sandbox → Better Auth plugin, checkout, customer
  portal, idempotent webhook handler writing `webhook_events`, upgrade/downgrade
  team-size mutations.
  ✅ *Done when: sandbox subscribe/upgrade/downgrade/cancel all mutate team limits
  correctly.*
- **Phase 6 — Reminders & PWA.** Convex cron → reminder-eligibility port → web-push +
  Resend; vite-plugin-pwa, manifest, install/offline; old-Serwist-SW kill switch.
  ✅ *Done when: beta sends a real push + email reminder at the configured time and the
  PWA installs on a phone.*
- **Phase 7 — Parity audit + hardening.** Route-by-route walk of prod vs beta (static
  pages, `/me`, error states, sitemap/robots/OG images, maintenance page), fresh copy
  run + re-verify, cutover runbook written.
  ✅ *Done when: a written checklist of every prod screen has a ✔ against beta.*
- **Phase 8 — Cutover.** See below.
- **Phase 9 — Post-cutover cleanup** (~2 weeks after cutover). See below.

## Cutover & Rollback

**Pre-cutover (week before):** add prod callbacks to all four OAuth apps; create real
Polar product + webhook config; email the paying customer (what's changing, Polar link
coming, comp offer); in-app maintenance banner on prod ("you'll need to log in again");
one runbook dry-run (copy + verify, no DNS flip).

**Cutover day (target < 1 hour, low-traffic time):**
1. Prod → maintenance mode (existing `/maintenance` page)
2. Final copy-script run (beta Convex data replaced with real snapshot)
3. DNS flip: main domain → Worker; `beta.` stays alive on the same Worker
4. Smoke test on prod domain: OTP login, one social login, board entry, scoreboard,
   PWA opens on phone
5. Switch Polar webhook + OAuth primary URLs to prod domain
6. Send Polar checkout link to the customer
7. Announce done

**PWA continuity:** installs are domain-keyed and survive the flip; new SW takes over on
next visit. The Phase 6 kill switch ensures the old Serwist worker unregisters cleanly so
no one is stuck on a stale cache.

**Rollback (kept 2 weeks):** Vercel deployment and Supabase stay live and untouched;
rollback = flip DNS back. **One-way data rule:** scores entered post-cutover exist only
in Convex — rolling back loses them unless manually re-entered. Accepted at this scale;
breakage would surface within hours, not days.

**Post-cutover cleanup (Phase 9):** cancel/retire Vercel project, Supabase project
(after a final archived pg_dump), Novu, QStash, Lemon Squeezy store (after the
subscription is confirmed moved); promote `v2/` to repo root (old app lives in git
history); delete dead env vars.

## Testing, Error Handling & Observability

**Testing (proportionate, concentrated where rewrite risk lives):**
- **Convex function tests** (`convex-test` + Vitest), priority order: monthly-winner
  computation, invite/signup flows, upgrade/downgrade logic, access-check helpers —
  including negative cases (non-member *cannot* read another team's scores).
- **Parity spot-checks:** after each copy run, a script asserts row counts and known
  aggregates (e.g., a specific month's winner) match Supabase vs Convex.
- **UI:** manual and structured — each phase's done-when plus the Phase 7 route
  checklist. No component-test suite for a 1:1 port.
- **One smoke E2E** (Playwright: OTP login → enter board → see score) before each phase
  merge and on cutover day. One test, not a suite.

**Error handling:**
- Convex mutations throw `ConvexError` with typed codes; UI maps codes → sonner toasts.
- **Webhook handlers idempotent** (Polar retries): `webhook_events` dedup by event ID.
  Reminder cron never double-sends (last-reminder timestamp guard, ported).
- TanStack Router error boundaries per route section + root boundary → Sentry.

**Observability:** Sentry from Phase 0; Workers Logs for request logs; LogSnag continues
for business-event pings; Cloudflare Web Analytics snippet at Phase 7; Axiom dropped.

## Out of Scope

- Any new features or redesigns (except the two sanctioned: live-updating scoreboards
  via Convex reactivity, passkey enrollment)
- Live/two-way data sync between Supabase and Convex
- Zero-downtime cutover machinery (maintenance window is acceptable)
- Notification platform (Knock etc.) — revisit only if notification complexity
  materializes post-cutover
- Migrating Vercel-specific features with no user impact (Speed Insights, Edge Config)

## Acceptance Criteria (project level)

1. New app at the production domain on Cloudflare Workers with TanStack Start + Convex +
   Better Auth + Polar, at 1:1 functional parity per the Phase 7 checklist
2. All migrated users can log in (OTP or retained social provider) and see their full
   score history
3. The paying customer is subscribed via Polar; Lemon Squeezy retired
4. Reminders (push + email) fire correctly from Convex cron
5. Installed PWAs survive cutover without user reinstallation
6. Old stack fully retired within ~2 weeks of cutover; rollback path verified live
   until then

---

# Amendments (2026-08-03)

`dev` was merged into `feat/v2-replatform` on 2026-08-03 after ~93 commits of v1 work that
post-date this design. Three bodies of work land on it: the Lemon Squeezy → Polar migration,
the invite→join fixes, and a run of performance/reliability fixes. This section records what
that changes. Where an amendment contradicts the text above, the amendment wins.

## A1. Payments — the greenfield assumption is void

The decisions table says *"Built into new app from day one; no in-place Lemon Squeezy→Polar
phase (only 1 subscriber)."* That is exactly what happened anyway: v1 migrated to Polar in
place and it has been live in production since 2026-08-03
(`docs/superpowers/specs/2026-07-31-polar-migration-design.md`).

**Phase 5 is no longer a greenfield integration.** What v2 now inherits for free:

- **Polar organisations, products and webhook endpoints already exist** in both sandbox and
  production. Pro is *two* products — Polar has no variants and a product's billing cycle is
  locked at creation — so monthly and annual are separate UUIDs, passed as a `products` array
  to one checkout session. No plan-selection UI is needed, in v1 or v2.
- **A verified event map.** `subscription.active` / `subscription.uncanceled` grant pro;
  `subscription.revoked` removes it; `subscription.canceled` and `past_due` change nothing.
  `src/lib/polar/events.ts` is a pure function with no I/O and ports to Convex almost verbatim.
  Conflating `canceled` with `revoked` would strip a paying customer's teams weeks before the
  period they paid for expires.
- **A hard-won identity lesson that v2 needs more than v1 does.** Polar does *not* reliably
  stamp `external_customer_id` onto a customer: when a checkout matches an existing customer
  by email, the value stays on the checkout and the customer keeps its own, usually null,
  external id. The webhook is delivered, logged `succeeded=true http=202`, and nobody is
  upgraded — silent, because 202 is not an error. `src/lib/polar/identity.ts` resolves the id
  from customer → checkout metadata → the checkout itself, and repairs the customer so later
  events take the fast path.

  **This is worse in v2 than it was in v1.** At cutover, every migrated user already exists as
  a Polar customer under their email — precisely the case that fails. Porting `identity.ts`'s
  three-step resolution is not optional hardening; it is a cutover prerequisite.
- **Webhook ids are not UUIDs.** Polar follows Standard Webhooks, whose ids look like
  `msg_2KWPBgLlAfxdpx2AI54pPJ85f4W`. v1 lost a day to a `uuid` column that rejected them and
  put Polar into an infinite retry loop. The Convex `webhook_events` table must key
  idempotency on a *string* webhook id taken from the `webhook-id` **header**, not the body.

**Open question this design must not assume away:** it names `@polar-sh/better-auth` as the
integration path. v1 deliberately rejected `@polar-sh/nextjs` because its `Webhooks` helper
auto-acknowledges, which destroys the store-then-process-then-500-so-Polar-retries behaviour
the whole idempotency design rests on. The Better Auth plugin may do the same. **Verify before
adopting it**; falling back to the raw `@polar-sh/sdk` is the known-good path.

**Acceptance criterion 3 is obsolete as written.** Lemon Squeezy is already retired. There is
also, as of today, *no active Polar subscriber at all*: the one paying customer is riding an
unbounded `pro` grace period with nothing behind it, to be resolved by hand on 2026-09-05
(`wordle-teams-g3k`). The cutover therefore no longer carries a "migrate the paying customer"
step — the pre-cutover email, the comp offer and the checkout link in the Phase 8 runbook can
all go. Replace criterion 3 with: *whatever Polar subscription state exists at cutover survives
it, because the v2 user resolves to the same Polar customer.*

## A2. Invites — one bug class evaporates, one survives

v1's invite→join failure had three causes. Their fate in v2 differs:

| v1 cause | Fate in v2 |
|---|---|
| Invite link never routed through `/api/auth/callback` (PKCE `?code=` needs a `code_verifier` cookie an admin-initiated invite never planted) | **Gone.** Supabase-specific; Better Auth issues its own tokens. |
| `redirectTo` built from `VERCEL_URL` — a scheme-less deployment hostname — which Supabase silently replaced with the Site URL | **Gone, and already defended against.** v2 commit `fe81c46` fails fast when `SITE_URL` is unset. Keep that reflex; it is the same lesson `src/lib/app-origin.ts` encodes in v1. |
| `invited[]` matched case-sensitively while auth stores emails lowercased | **Survives the rewrite.** This is a data-model bug, not a platform bug, and a 1:1 port reproduces it. |

**Phase 4 gains a hard acceptance criterion:** invite addresses are normalised to lowercase on
write and compared case-insensitively on read, proven by inviting a mixed-case address and
joining from the lowercase account. `scripts/verify-case-fix-dev.mjs` is the v1 proof and the
shape to copy.

The note above that `handle_invited_signup` "is correct and is not the bug" was only true
*after* the case fix. Port the fixed semantics.

One piece of scope also disappears: the v1 plan's Option B — a branded invite email sent
through the app's own infrastructure instead of Supabase's dashboard template — was filed as a
follow-up and never done. Phase 4 does exactly that natively with Resend + react-email, so
**v2 supersedes it rather than inheriting it.**

## A3. Parity is now against `dev`, not against the 2026-07-16 snapshot

"Strict 1:1 parity" was written when prod and this design agreed. Several v1 behaviours have
changed since, and a faithful port of the *old* code would now be a regression:

- **Board entry never loses a submission** (`a335ae8`). `handleSubmit` is wrapped in
  try/catch with `setSubmitting(false)` in `finally`, the sheet closes **only on success**,
  and a failed `update_monthly_winners` produces a warning toast instead of a silent success.
  Phase 2 must port this behaviour, not the version this design was written against.
- **`/me` renders no browser-only state** (`45e3cd6`) — a hydration-mismatch fix.
- **The service worker registers exactly once**, and handles its own failure (`e70592d`).
  Phase 6.
- **Middleware had never executed in production.** It sat at the repo root while Next resolves
  it at `src/middleware.ts` — no warning, no build error. So maintenance mode, the
  welcome-path PWA redirect, and auth cookie refresh were all dead until `bdca5f5`. Phase 8's
  cutover step 1 ("prod → maintenance mode") only works because of that fix. In v2, maintenance
  mode must be genuinely implemented and genuinely tested, not assumed to exist.

## A4. Caching — v2 has already planted the seed of a v1 bug it just fixed

v1's marketing pages emitted `Cache-Control: public, max-age=0, must-revalidate` despite being
prerendered, so 28–41% of requests to `/home`, `/privacy` and `/terms` missed the edge and
invoked a cold function at ~1.9s (`40e9940`).

Phase 0 shipped `wt-ksh.1.13`, "enforce `Cache-Control: no-store` on SSR document responses."
That is right for authenticated documents and **wrong for the static marketing routes** — if it
is applied at the worker level to every document, v2 reproduces `wordle-teams-jcj` on a new
platform. Phase 7's parity audit must assert cache headers per route, not just rendered output.

Cloudflare serves static assets from the edge by default, so this class of problem is smaller
in v2 — but "smaller by default" is not "verified".

## A5. The cost driver no longer survives contact with the data

This is the amendment with real consequences, and it is a decision for the owner rather than
something to resolve in a document.

The design's first stated driver is cost: *"Vercel pricing grows steeply with scale;
Cloudflare's curve is much flatter. Get ahead of growth."* Two measurements taken after the
design was approved describe a product with no growth to get ahead of:

- **Activation** (`wordle-teams-456`, prod, 2026-07-30): 526 players exist; 68 have ever
  entered a board with guesses. 458 accounts — 87% — signed up and never played once. Of the
  68, 50 are outside the owner's teams and 40 of those entered one or two boards and stopped.
  Exactly one independent team ever sustained multi-user use, and it churned in May 2025.
  Current volume is 3–7 board entries a day, essentially all from the owner's six teams.
- **Login conversion** (`wordle-teams-390`, 30d to 2026-07-30): ~163 real people reached
  `/login`; roughly 12 completed an auth round-trip. Zero server-side auth failures in the
  window.

The design's own constraint line reads "~40 DAU in production daily." The measured independent
DAU is close to zero.

**Two honest caveats before anyone over-reads this.** First, the login number probably has a
mechanical cause that is now fixed: `/login` was completely unusable for anyone blocking
`app.lemonsqueezy.com` — an infinite client-side error loop, 998 errors in 500ms, invisible in
server logs (`wordle-teams-jvt`). Lemon Squeezy is now gone from the codebase entirely, so the
funnel needs re-measuring before the 7% figure means anything. Second, some share of the 458
zero-score accounts are invite-flow casualties, and the invite bug is now fixed — that share is
unmeasured.

**What this does *not* mean:** cancel v2. DX/architecture fit and vendor reduction (~10 → ~6)
are unaffected by traffic, and a solo developer's productivity on a stack they prefer is a
legitimate driver on its own.

**What it does mean:** the *cost* justification should be demoted from lead driver to a
secondary benefit, and the sequencing question is now open rather than settled. A strict-1:1
parity rewrite faithfully reproduces a funnel that activates 13% of signups. Finishing Phases
1–9 and *then* discovering the product problem is the risk this data flags. The alternatives
worth weighing — re-measure first, or interleave funnel work with the port, or proceed as
planned on the DX driver alone — are the owner's call. Filed as `wordle-teams-dts` for that
decision.

## A6. State of the branch after the merge

- The merge (`955ead6`) touched no v2 source. `v2/` tests (3/3) and `vite build` both pass on
  the merged tree.
- v2 had run its own `bd init`, so the branch carried a *second* beads database (`wt`, 30
  issues, its own project id) that collided add/add with dev's. Resolved by keeping the
  canonical `wordle_teams` database and importing the `wt-*` issues into it (`001bd54`). The
  prefixes do not collide, so ids, the epic hierarchy and the blocking dependencies survive.
  There is now one tracker holding both v1 and v2 work.
- Phase 0 is **8 of 12 tasks done**. The four that remain are all blocked on one manual step:
  moving `wordleteams.com`'s nameservers to Cloudflare (`wt-ksh.1.1`) → beta deploy
  (`wt-ksh.1.9`) → GitHub Actions pipeline (`wt-ksh.1.10`) → Phase 0 close-out
  (`wt-ksh.1.12`). Creating the `wordle-teams-v2` Sentry project (`wt-3yb`) is a second manual
  unblock, independent of DNS. Phase 0's done-when — OTP login on `beta.wordleteams.com` —
  cannot be met until DNS moves. **The whole of v2 is blocked behind one owner action.**
