# Implementation Plan: Fix Team Invite → Join Flow

**Date:** 2026-07-28
**Branch:** `fix/team-invite-join-flow` (off `dev`)
**Beads epic:** wordle-teams-yst (bug) → see child issues
**Reported by:** mariabaseleon@gmail.com ("MedLocations" team)

---

## 1. Problem & Root Cause

**Symptom:** People Maria invites to her team click the invite email link but end up on
the empty state where "all they can do is make a team" — they never see MedLocations and
can't enter their Wordle board.

**Root cause (confirmed with prod read-only diagnostics):** The invite email link never
routes the invitee through `/api/auth/callback`, so an authenticated session is never
established and the invited→team join never runs.

Evidence (prod project `dcfqzbdusxhrfgvnpwqc`, 2026-07-28):

| Fact | Value |
| --- | --- |
| Team 206 "MedLocations" `player_ids` | `[Maria]` only |
| Team 206 `invited[]` | `["jonathan.m.esparza@gmail.com"]` — still pending |
| `auth.users` jonathan | `user_metadata.invited=true`, provider `email`, **`last_sign_in_at=NULL`, email unconfirmed** |
| `auth.users` maria | provider `google`, signed in fine |

Jonathan has an account (created by the invite) but has **never successfully signed in**.
If the invite link had ever worked, `last_sign_in_at` would be set and he'd be on the team.

**Mechanism:**
1. `invitePlayer` (`src/app/me/actions.ts:120` and `:145`) calls
   `supabase.auth.admin.inviteUserByEmail(email, { data: { invited: true } })` with
   **no `redirectTo`**. The invite link therefore redirects to the project's default
   **Site URL**, not `/api/auth/callback` — the only route that runs `finishSignIn` →
   `handleInvite` → `handle_invited_signup`.
2. Both Supabase clients (`src/lib/supabase/{client,server}.ts`) use `@supabase/ssr` with
   the **default PKCE flow** (no `flowType` override). The default invite template relies on
   a `?code=` exchange that requires a `code_verifier` cookie — which an admin-initiated
   invite never planted in the invitee's browser — so the session cannot complete.
3. Net: the invitee lands **unauthenticated** on the app shell, sees the empty state, and
   the only available action is "Create a team." Exactly the report.

**Why only invites break:** Normal email login works because it uses the 6-digit **OTP code
entry** (`verifyOtp`), not the email link. Google OAuth works because it's browser-initiated
PKCE (the `code_verifier` cookie is present). The invite is the one path that relies solely
on an email link through the broken callback.

**Note:** The Postgres RPC `handle_invited_signup` (migration `20240517174331`) is **correct**
and is *not* the bug — it simply never gets a chance to run.

---

## 2. Expected Behavior After Fix

1. Maria invites `teammate@example.com`.
2. Teammate clicks the invite email link → `/api/auth/callback?token_hash=…&type=invite&next=/me`.
3. Callback runs `verifyOtp({ token_hash, type: 'invite' })` → session established →
   `finishSignIn` → `handleInvite` (because `user_metadata.invited === true`) →
   `handle_invited_signup` appends them to MedLocations `player_ids`, removes them from
   `invited[]`, and sets `user_metadata.invited=false`.
4. Because the new user has no name yet, `/me` redirects to `/complete-profile`
   (`src/app/me/page.tsx:32`); after they enter their name they land on `/me` and see
   **MedLocations** with the daily board ready for entry.

---

## 3. Scope

**In scope (this fix):**
- Route the invite email through `/api/auth/callback` using the `token_hash` path the
  callback already supports.
- Pass a correct `redirectTo` to both `inviteUserByEmail` call sites.
- Ensure prod Supabase Site URL + redirect allowlist include the app domain + callback.
- Verification via Axiom logs + a manual token_hash walkthrough (+ optional e2e smoke).
- Data remediation for Maria's existing pending invite.

**Out of scope (explicitly):**
- Any change to `handle_invited_signup` or other join RPCs (they are correct).
- The v2 replatform (`feat/v2-replatform`) — this fixes the live `dev`/prod v1 app.
- Reworking the general email-login flow (OTP code entry already works).
- Team-limit / pro-upgrade invite branching (unchanged).

---

## 4. Approach

Two options. **Recommendation: ship Option A now as the hotfix to unblock Maria, then do
Option B as the durable follow-up.**

### Option A — Route the default invite template through the callback (hotfix)

The callback already handles `verifyOtp({ token_hash, type })` in `handleEmailSignin`. We just
need the invite link to hit it.

1. **Supabase "Invite user" email template** (prod dashboard — Authentication → Email
   Templates → Invite user). Change the confirmation link to:
   ```
   {{ .SiteURL }}/api/auth/callback?token_hash={{ .TokenHash }}&type=invite&next=/me
   ```
   This is the **critical change** — it makes the link use the server-side `verifyOtp`
   (`token_hash`) path, which needs no PKCE `code_verifier`.
2. **Code** (`src/app/me/actions.ts`, both call sites) — pass `redirectTo` so the allowlist
   and any default-template fallback also point at the callback:
   ```ts
   await supabase.auth.admin.inviteUserByEmail(email, {
     data: { invited: true },
     redirectTo: authCallbackUrl('/me'),
   })
   ```
   Extract a shared `authCallbackUrl(next?)` helper (see Task 1) and reuse it in
   `src/app/login/actions.ts` too, replacing the ad-hoc `emailRedirectTo`.
3. **Supabase Auth config** (prod dashboard — URL Configuration): confirm **Site URL** is the
   canonical app domain and **Redirect URLs** allowlist includes `https://<app-domain>/api/auth/callback`.
4. **Local parity (version-controlled):** mirror the invite template into the repo via
   `supabase/config.toml` `[auth.email.template.invite]` with a `content_path` pointing at a
   new `supabase/templates/invite.html`, so local dev and future envs match.

**Pros:** minimal code, fastest path to unblock Maria. **Cons:** the prod template edit is a
dashboard action per environment; email styling stays on Supabase's default.

### Option B — Send a branded invite via existing email infra (durable follow-up)

Replace `inviteUserByEmail` with `supabase.auth.admin.generateLink({ type: 'invite', email,
options: { data: { invited: true }, redirectTo: authCallbackUrl('/me') } })`, read
`properties.hashed_token`, and send a **branded** invite email through the app's existing
`@react-email` + Novu pipeline (same infra as the board-entry reminder) linking to
`/api/auth/callback?token_hash=<hashed_token>&type=invite&next=/me`.

**Pros:** fully in version control, consistent branding, no reliance on Supabase's default
template, testable without the dashboard. **Cons:** larger change (new email template + send
path); do it after the hotfix lands.

---

## 5. Tasks (atomic; "done when…")

**A1 — Shared callback-URL helper** (child of epic)
- Add `authCallbackUrl(next = '/me')` (e.g. `src/lib/auth-urls.ts`) using the same base as
  today's `emailRedirectTo` (`process.env.VERCEL_URL` full-URL override, localhost fallback).
- Refactor `src/app/login/actions.ts` to use it.
- **Done when:** both login OTP calls and the new invite calls use one helper; `pnpm build` passes.

**A2 — Pass `redirectTo` on both invite calls**
- Update `inviteUserByEmail` at `src/app/me/actions.ts:120` and `:145` to pass
  `redirectTo: authCallbackUrl('/me')`.
- **Done when:** both call sites include `redirectTo`; typecheck/build pass.

**A3 — Invite email template → token_hash callback**
- Update prod Supabase Invite template to the `{{ .TokenHash }}` callback URL above.
- Add `supabase/templates/invite.html` + wire `[auth.email.template.invite]` in
  `supabase/config.toml` for local parity.
- **Done when:** a fresh invite email's link points at `/api/auth/callback?token_hash=…&type=invite&next=/me`.

**A4 — Prod Auth URL configuration**
- Verify/set Site URL = canonical domain; add `…/api/auth/callback` to Redirect URLs allowlist.
- **Done when:** clicking an invite link is not blocked by redirect allowlisting.

**A5 — Verification (Axiom + manual)**
- With Axiom read access (see §6), invite a test address, click the link, and confirm the log
  sequence: `Parsing request: …/api/auth/callback…type=invite` → no "Failed to verify OTP" →
  `finishSignIn` success → no "Failed to handle invited signup"; then confirm via prod query
  that the test user moved from `invited[]` into `player_ids` and `user_metadata.invited=false`.
- **Done when:** end-to-end invite lands the test user on the team with the board visible.

**A6 — Data remediation for Maria**
- After the fix is live: resend the invite to `jonathan.m.esparza@gmail.com` (his current
  auth user is unconfirmed / never signed in). Confirm with Maria which *other* addresses she
  intended to invite (only one was ever recorded) and re-invite those.
- **Done when:** Maria's intended invitees are either joined or hold a working pending invite.

**B1 (follow-up) — Branded invite via generateLink + Novu/react-email** (separate issue).

**Optional — Minimal e2e smoke** (`dev` has no test tooling today): add a Playwright smoke that
drives invite → token_hash callback → team membership assertion, matching the direction already
taken on `feat/v2-replatform`. Track as its own issue; not a blocker for the hotfix.

---

## 6. Verification via Axiom (wiring)

The app logs server-side through `next-axiom@1.9.1` (`withAxiom` in `next.config.js`); on Vercel
this ships to Axiom via the Vercel↔Axiom integration. No Axiom token/dataset is in the repo, so
reading logs needs credentials from the user:

- An **Axiom API token** with query permission.
- The **dataset name** (the Vercel integration's target dataset).

Setup: drop `AXIOM_TOKEN=<token>` (and optionally `AXIOM_DATASET=<name>`) into `.env.local`.
`scripts/axiom-query.mjs` (added by this plan) will then list datasets and run APL queries such as:

```
['<dataset>']
| where ['request.url'] contains '/api/auth/callback'
| where ['level'] == 'error' or message contains 'invited' or message contains 'OTP'
| sort by _time desc
```

Log lines to look for (from the code): `Parsing request: <url>` (callback hit),
`Failed to verify OTP` / `Failed to exchange code for session` (auth failure),
`Failed to handle invited signup` (RPC failure). Absence of the error lines + presence of the
callback-hit line for `type=invite` = success.

---

## 7. Rollout

1. Land A1–A2 (code) on `fix/team-invite-join-flow`; open PR to `dev`.
2. Apply A3–A4 (Supabase dashboard) on the **prod** project and mirror template locally.
3. Run A5 verification against a preview/prod test invite using Axiom + prod read query.
4. Merge to `dev` → promote per normal deploy flow.
5. Perform A6 data remediation and reply to Maria.
6. File B1 (+ optional e2e) as follow-ups.

## 8. Risks / Watch-outs

- **Multi-environment templates:** the dashboard template edit must be applied to **each**
  Supabase environment (prod + staging). Option B removes this risk long-term.
- **Base-URL correctness:** `authCallbackUrl` depends on `VERCEL_URL` being set to a full
  canonical URL in prod env (as it is in `.env.local`). Confirm the prod value.
- **Existing invited users:** anyone already invited under the old flow has
  `user_metadata.invited=true` and a stale link; they need a **re-invite** with the new
  template (old links won't route correctly). A6 covers Maria's; consider a broader re-invite
  if other teams were affected.
