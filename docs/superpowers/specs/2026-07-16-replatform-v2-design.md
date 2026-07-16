# Re-platform to v2: Cloudflare + TanStack + Convex — Design

**Date:** 2026-07-16
**Status:** Approved design, pending implementation plan

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
