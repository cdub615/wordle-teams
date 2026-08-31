# v2 Phase 7 — Parity audit + hardening Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Complete v2's public surface, prove route by route that it matches production, and write the cutover runbook Phase 8 executes from.

**Architecture:** Three ordered stages. Stage A builds what v2 is missing — the dashboard moves to `/app`, `/` becomes the marketing landing, the legal/error/maintenance pages and crawler metadata land, and two orphaned dashboard features get their UI. Stage B measures the result against production with a header/metadata script plus a hand-walked checklist. Stage C closes Phase 5's sandbox pass, clears P3 debt, and writes the runbook.

**Tech Stack:** TanStack Start (Router + Query) on Cloudflare Workers, Convex, Better Auth, Vitest under `edge-runtime`, Playwright for e2e.

**Spec:** `docs/superpowers/specs/2026-08-31-v2-phase7-parity-audit-design.md`

---

## Before you start

Read all of this. Each line below cost this project real time.

1. **Run everything from inside `v2/`, and give EVERY command its own `cd v2`.** The shell cwd resets between tool calls. `cd` is aliased to zoxide on this box and will refuse with "you are already in the only match" if you are already there — prefer absolute paths in commands that must not fail.

2. **NEVER pipe a command whose exit code matters.** zsh's `PIPESTATUS` is empty, so a piped gate check reports a false green.

3. **Run all four gates every time:** `pnpm lint`, `pnpm typecheck`, `pnpm test:once`, `pnpm build`. `build` does not typecheck, and lint reaches `public/*.js` that build only copies.

4. **e2e is NOT one of the four gates, and this is the sharpest illustration in the project.** Nothing in `lint`/`typecheck`/`test:once`/`build` runs Playwright, and CI does not either. In August the local Convex deployment was frozen for a day by a schema rejection and **all four gates stayed green the whole time**, because none of them talks to a backend — `convex-test` builds its own schema in memory. The only signal was e2e. Run `pnpm e2e` deliberately. It needs a local Convex backend on `127.0.0.1:3210` — see Task 0.

5. **`convex codegen` needs Node 20/22/24.** This box defaults to v25.2.1 and the local backend rejects a `'use node'` push under it. Use `mise exec node@22 -- npx convex dev`.

6. **`convex run --prod` and `convex env --prod` silently fall back to the LOCAL backend** at `127.0.0.1:3210`. Before believing any output about beta, check for a value only beta has. And `convex env get` exits 0 whether or not the variable exists — match on the "not found" text, never the exit code.

7. **Backticks inside `git commit -m "..."` or `bd note "..."` are executed by the shell.** Use `git commit -F -` with a quoted heredoc.

8. **DO NOT USE `--no-verify`.** The hook chains to a PII guard — **this repository is public**. Never put a real email address in a commit, test, comment or beads issue.

9. **Subagents must NEVER push.** Committing is theirs; pushing is the controller's.

10. **Comment and document accuracy is a defect here, not a nit.** Every review round in Phase 6 found at least one claim asserting something untrue. When you move code, move its comments' truth with it.

### The trap this phase is most likely to fall into

Phase 6's reviews found this three times, and it is worth stating plainly:

> **An extraction can move the untested part rather than shrink it.**

Twice a pure function was pulled out and thoroughly tested while the wiring that decides whether it is ever called stayed uncovered — and in one case an exact revert of the fix passed every gate.

This phase is unusually exposed to it, because **v2 has no component-rendering tests at all.** Every file under `src/**/*.test.ts` is a `.ts` test of a pure function or an extracted hook; the vitest environment is `edge-runtime`, not jsdom, so there is no DOM and no React Testing Library. That means a task like "per-route cache headers" naturally decomposes into a pure `cachePolicyFor()` that is trivially unit-tested and a `server.ts` wiring that is not tested at all — which is the trap exactly.

**Every task in Stage A that changes behaviour visible over HTTP therefore requires an assertion on a real response**, in `e2e/`, in addition to any unit test of the extracted logic. A unit test alone does not close a Stage A task.

### Snippet provenance

Code blocks quoting v1 are from this repository at `src/`, which is untouched and remains the reference. Where a task says "port the prose from `<path>`", the prose is the deliverable and the markup is to be rewritten against v2's tokens — v1's pages hardcode `text-gray-50`, `bg-gray-50`, `dark:bg-background` and `GeistSans`, none of which exist in v2's Tailwind 4 token set (`v2/src/styles.css`).

---

## File Structure

**Created:**

| Path | Responsibility |
| --- | --- |
| `v2/src/routes/app.tsx` | The dashboard. Moved wholesale from `routes/index.tsx` |
| `v2/src/routes/index.tsx` | Rewritten: the marketing landing |
| `v2/src/routes/home.tsx` | The same landing at `/home`, without the PWA branch |
| `v2/src/routes/me.tsx` | Permanent redirect to `/app`, for installed PWAs |
| `v2/src/routes/privacy.tsx` | Legal copy |
| `v2/src/routes/terms.tsx` | Legal copy |
| `v2/src/routes/login-error.tsx` | Sign-in failure page |
| `v2/src/routes/maintenance.tsx` | The maintenance document |
| `v2/src/routes/sitemap[.]xml.ts` | Server route emitting the sitemap |
| `v2/src/components/home/landing.tsx` | Composes the three landing pieces |
| `v2/src/components/home/title.tsx` | Landing hero |
| `v2/src/components/home/feature-cards.tsx` | Landing feature grid |
| `v2/src/components/home/dashboard-preview.tsx` | Landing screenshot + sign-in CTA |
| `v2/src/components/teams/team-boards.tsx` | The TeamBoards carousel |
| `v2/src/components/teams/team-boards-model.ts` | Pure: team + day + viewer -> which boards, hidden or shown |
| `v2/src/components/teams/team-boards-model.test.ts` | Its unit tests |
| `v2/src/lib/celebration.ts` | Pure: winner row + viewer -> open the dialog, and did they win |
| `v2/src/components/winner-celebration.tsx` | Monthly-winner celebration dialog |
| `v2/src/lib/cache-policy.ts` | Pure: path + auth → `Cache-Control` value |
| `v2/src/lib/cache-policy.test.ts` | Its unit tests |
| `v2/src/lib/maintenance.ts` | Pure: path + flag → is this request gated |
| `v2/src/lib/maintenance.test.ts` | Its unit tests |
| `v2/scripts/parity-routes.mjs` | The audit harness -- fetching only |
| `v2/scripts/lib/parity-routes-report.mjs` | Pure: two responses -> a verdict and a table row |
| `v2/scripts/lib/parity-routes-report.test.mjs` | Its unit tests |
| `v2/e2e/routes.spec.ts` | Real-response assertions for every Stage A route |
| `v2/public/robots.txt` | Replaces the Vite starter default |
| `v2/public/opengraph-image.png` | Copied from `src/app/opengraph-image.png` |
| `v2/public/welcome-screenshot.png` | Copied from `public/welcome-screenshot.png` |
| `docs/runbooks/2026-cutover.md` | The phase deliverable |

**Modified:**

| Path | Change |
| --- | --- |
| `v2/src/server.ts` | Blanket `no-store` becomes route-aware; maintenance gate added |
| `v2/src/components/Footer.tsx` | Legal links restored |
| `v2/src/components/Header.tsx` | Always-reachable upgrade entry point |
| `v2/src/routes/about.tsx` | The eight screenshots |
| `v2/public/manifest.json` | `start_url` → `/app` |
| `v2/convex/polar.ts:431,653` | `successUrl` and `returnUrl` → `/app` |
| `v2/convex/pushSend.ts:93` | `url: '/'` → `/app` |
| `v2/convex/reminderEmails.ts` | CTA button, both halves |
| `v2/wrangler.jsonc` | `MAINTENANCE` var |
| `docs/design-system/V2-ADDENDUM.md` | §7a divergences #19 and #20 |

---

## Task 0: Establish the e2e baseline (`wordle-teams-lvv`)

**CORRECTED 2026-08-31, after this task was run.** This task was originally written as "restore the local Convex backend", on the belief that it had silently refused every push since the `creator`→`owner` rename. **That premise was false.** The outage was real but lasted one day — from the schema drop landing (`2247b25`, 2026-08-26) until 16:56 the same day, when `migrate.backfillTeamOwner` and `migrate.clearTeamCreator` were run against local. `wordle-teams-lvv`'s description is written in the past tense about a live failure and was read as current state.

**The task belongs first anyway, for the reason `lvv` itself records:** every one of the four gates stayed green for the whole outage, because none of them talks to a backend. A deployment can be frozen for an arbitrary period while `lint`, `typecheck`, `test:once` and `build` all report success. e2e was the only signal, and e2e is not a gate. So Phase 7 establishes the e2e baseline before it changes anything, rather than discovering mid-phase that it never had one.

**OPERATIONAL GOTCHA, found running this task and worth more than the task itself:** killing the `convex dev` CLI leaves the `convex-local-backend` binary alive holding ports 3210 and 3211. The next `convex dev --once` then fails with

```
✖ A local backend is still running on port 3210. Please stop it and run this command again.
```

which looks exactly like a backend fault and is not one. Kill both processes, not just the CLI. This is very likely how this task's original premise was formed.

**Files:**
- Investigate: `v2/convex/schema.ts`, `v2/convex/teams.ts`
- No production code change expected; if one is needed it belongs to this task

- [ ] **Step 1: Find out whether a watcher is already running**

```bash
pgrep -af convex
ss -ltn | grep -E '3210|3211'
```

A live watcher is evidence of **health**, not of a problem — and it owns port 3210, so a `--once` against it will refuse with the port message above. If one is running and its log shows `Convex functions ready!` rather than `Schema validation failed`, the backend is fine; go straight to Step 5.

- [ ] **Step 2: Read `wordle-teams-lvv` for what was already established**

```bash
bd show wordle-teams-lvv
```

- [ ] **Step 3: Fix the cause, not the symptom**

The likely cause is a stale local deployment holding documents with a `creator` field against a schema now declaring `owner`, or an index defined on the old name. Do **not** reach for `--typecheck=disable` or a schema `v.any()` — either would push a lie to a backend Playwright then trusts. Clearing the local deployment's data is acceptable; it holds nothing but test rows.

- [ ] **Step 4: Verify the push succeeds and stays up**

```bash
cd /home/cdub/projects/wordle-teams/v2 && mise exec node@22 -- npx convex dev --once
```

Expected: exit 0, and the functions listed as deployed.

- [ ] **Step 5: Start a watcher and verify e2e is green BEFORE any Phase 7 change**

```bash
cd /home/cdub/projects/wordle-teams/v2 && mise exec node@22 -- npx convex dev
```

Leave it running in another shell. Then:

```bash
cd /home/cdub/projects/wordle-teams/v2 && pnpm e2e
```

Expected: 22 passed — the Phase 6 close-out figure. **If it is not 22, stop and find out why before touching anything else.** A baseline you did not establish is not a baseline.

- [ ] **Step 6: Commit and close**

```bash
cd /home/cdub/projects/wordle-teams && git add -A v2/ && git commit -F - <<'MSG'
fix(convex): the local backend accepts a push again

MSG
bd close wordle-teams-lvv
```

---

## Task 1: The dashboard moves to `/app`, and `/me` redirects to it

**Files:**
- Create: `v2/src/routes/app.tsx` (the current `index.tsx`, moved)
- Create: `v2/src/routes/me.tsx`
- Modify: `v2/public/manifest.json`
- Modify: `v2/convex/polar.ts` (`:387` comment, `:431`, `:653`)
- Modify: `v2/convex/pushSend.ts:93`
- Modify: `v2/src/components/Header.tsx`, `v2/src/components/Footer.tsx`, and every internal `to="/"` that meant the dashboard
- Modify: `v2/e2e/*.spec.ts` — every spec that asserts `toHaveURL('/')` for a signed-in page
- Test: `v2/e2e/routes.spec.ts` (new)

### Why `/me` stays forever

`src/app/manifest.json` sets `"start_url": "/me"`. Every production user who installed the PWA has that burned into their installed app, and an installed iOS PWA does not adopt a new `start_url` from a re-fetched manifest. This redirect is permanent, not transitional. Say so in a comment in `me.tsx` so nobody deletes it in a tidy-up.

- [ ] **Step 1: Write the failing e2e**

Create `v2/e2e/routes.spec.ts`:

```ts
import { test, expect } from '@playwright/test'

// REAL RESPONSES, NOT UNIT TESTS. v2 has no component-rendering tests — the
// vitest environment is edge-runtime, so there is no DOM — which means the
// wiring in server.ts and the route tree is reachable from nowhere else. See
// "the trap this phase is most likely to fall into" in the plan.
test.describe('route shape', () => {
  test('/me redirects to /app, because installed PWAs carry start_url: /me', async ({ page }) => {
    await page.goto('/me')
    await expect(page).toHaveURL('/app')
  })

  test('/app is the dashboard and bounces an anonymous visitor to /login', async ({ page }) => {
    await page.goto('/app')
    await expect(page).toHaveURL('/login')
  })
})
```

- [ ] **Step 2: Run it and watch it fail**

```bash
cd /home/cdub/projects/wordle-teams/v2 && pnpm e2e routes.spec.ts
```

Expected: FAIL — `/me` 404s and `/app` does not exist.

- [ ] **Step 3: Move the dashboard**

```bash
cd /home/cdub/projects/wordle-teams/v2 && git mv src/routes/index.tsx src/routes/app.tsx
```

In `app.tsx`, change the route id:

```ts
export const Route = createFileRoute('/app')({
```

`useNavigate({ from: Route.fullPath })` inside `Dashboard` picks the new path up automatically — do not hardcode it.

- [ ] **Step 4: Add the redirect route**

Create `v2/src/routes/me.tsx`:

```tsx
import { createFileRoute, redirect } from '@tanstack/react-router'

/**
 * PERMANENT, NOT TRANSITIONAL. DO NOT DELETE THIS IN A TIDY-UP.
 *
 * v1's src/app/manifest.json sets "start_url": "/me". Every production user
 * who installed the PWA has that path burned into their installed app, and an
 * installed iOS PWA does not adopt a new start_url from a re-fetched manifest.
 * At cutover the domain flips to v2, and without this route their app opens on
 * a route that does not exist.
 *
 * The same applies to bookmarks and to any link anyone ever shared.
 */
export const Route = createFileRoute('/me')({
  beforeLoad: () => {
    throw redirect({ to: '/app', replace: true })
  },
})
```

- [ ] **Step 5: Move every URL-bearing consumer**

`v2/public/manifest.json`:

```json
  "start_url": "/app",
```

`v2/convex/polar.ts:431`:

```ts
        successUrl: `${siteUrl()}/app?checkout=success`,
```

`v2/convex/polar.ts:653`:

```ts
    const returnUrl = `${siteUrl()}/app`
```

`v2/convex/pushSend.ts:93`:

```ts
      url: '/app',
```

**And correct the comment at `polar.ts:387`.** It currently says v1 used `/me?checkout=success` and v2 lands on `/`. The second half is now false. Comment accuracy is a defect here.

- [ ] **Step 6: Find every remaining internal link that meant the dashboard**

```bash
cd /home/cdub/projects/wordle-teams/v2 && grep -rn "to=\"/\"\|to='/'\|toHaveURL('/')\|href=\"/\"" src e2e --include='*.ts' --include='*.tsx'
```

Every hit is either the marketing landing (leave it — Task 4 makes `/` real) or the dashboard (change to `/app`). Decide each one; there is no safe blanket rule.

- [ ] **Step 7: Run the whole e2e suite, not just the new spec**

```bash
cd /home/cdub/projects/wordle-teams/v2 && pnpm e2e
```

Expected: 24 passed (22 baseline + the 2 new). Any spec asserting `toHaveURL('/')` for a signed-in page needs updating — that is real work this step surfaces, not noise.

- [ ] **Step 8: All four gates**

```bash
cd /home/cdub/projects/wordle-teams/v2 && pnpm lint
cd /home/cdub/projects/wordle-teams/v2 && pnpm typecheck
cd /home/cdub/projects/wordle-teams/v2 && pnpm test:once
cd /home/cdub/projects/wordle-teams/v2 && pnpm build
```

Run them as four separate commands. Do not pipe.

- [ ] **Step 9: Commit**

```bash
cd /home/cdub/projects/wordle-teams && git add -A v2/ && git commit -F - <<'MSG'
feat(routes): the dashboard is /app, and /me redirects to it forever

Owner's decision: /app names the whole application surface, where every
other route serves some other function.

/me is kept as a permanent redirect rather than dropped. v1's manifest
sets start_url: /me, so every production PWA install has that path burned
in, and an installed iOS PWA never adopts a new start_url from a
re-fetched manifest. At cutover those apps would otherwise open on a
route v2 does not have.

Moved with it: manifest start_url, polar's successUrl and returnUrl,
pushSend's notification target, and the comment at polar.ts:387 that
described the old landing spot.

MSG
```

---

## Task 2: A real call-to-action in the reminder email, to `/app`

**Files:**
- Modify: `v2/convex/reminderEmails.ts`
- Test: `v2/convex/reminderEmails.test.ts`

### Why this is not a parity violation

The email's only link today is the brand wordmark beside the icon (`:146`), pointing at the bare origin. It reaches the dashboard purely because `/` currently *is* the dashboard; after Task 1 it lands a player on the marketing page instead of the board they were just reminded to enter.

Owner's decision, 2026-08-31: it gets a real button rather than a re-pointed wordmark. The email's whole purpose is to get the reader to enter a board and it has never given them anything to click that does that. v1's reminder email was a Novu template that does not exist in this repo, so there is no v1 rendering to diverge from.

### Both halves, or it is a new bug

`reminderEmails.ts:101-118` builds a plain-text alternative deliberately, with a comment recording that a mail without one scores worse with spam filters. A CTA in the HTML and not in the text is a parity bug of its own.

- [ ] **Step 1: Write the failing tests**

Append to `v2/convex/reminderEmails.test.ts`:

```ts
describe('the call to action', () => {
  // ASSERT ON THE EMITTED STRING, not on a round trip through a helper that
  // builds the same URL. A codec you own both halves of will happily agree
  // with itself about a wrong answer — that is how the base64url substitution
  // bug survived a green decode(encode(x)) === x test in Phase 6.
  test('the HTML half links to /app on the configured origin', () => {
    const { html } = boardEntryReminderEmail({
      firstName: 'Sam',
      siteUrl: 'https://beta.wordleteams.com',
    })
    expect(html).toContain('href="https://beta.wordleteams.com/app"')
  })

  test('the plain-text half carries the same URL', () => {
    const { text } = boardEntryReminderEmail({
      firstName: 'Sam',
      siteUrl: 'https://beta.wordleteams.com',
    })
    expect(text).toContain('https://beta.wordleteams.com/app')
  })

  // The bare origin is the marketing page after Phase 7. A reminder that lands
  // a player there has failed at the one thing it exists to do.
  test('neither half sends the reader to the bare origin as its call to action', () => {
    const { html, text } = boardEntryReminderEmail({
      firstName: 'Sam',
      siteUrl: 'https://beta.wordleteams.com',
    })
    expect(html).not.toContain('href="https://beta.wordleteams.com"')
    expect(text).not.toMatch(/^https:\/\/beta\.wordleteams\.com$/m)
  })
})
```

Match the existing call signature in that file — read the top of `reminderEmails.ts` for the real parameter names before writing this, and use them.

- [ ] **Step 2: Run and watch it fail**

```bash
pnpm vitest run convex/reminderEmails.test.ts
```

Expected: FAIL on all three.

- [ ] **Step 3: Add the button to the HTML half**

Replace the wordmark table (`:139-150`, the `<table>` holding `iconImage` and the `<a href="${site}">`) with a button above it. Keep the icon row — it is branding and it is fine — but its link becomes the app too:

```html
          <table role="presentation" cellpadding="0" cellspacing="0" style="margin:0 0 24px;">
            <tr>
              <td bgcolor="${PANEL_COLOR}" style="background-color:${PANEL_COLOR};border-radius:8px;">
                <a href="${site}/app" style="display:inline-block;color:#ffffff;text-decoration:none;padding:12px 20px;font-size:15px;font-weight:600;">Enter your board</a>
              </td>
            </tr>
          </table>
```

**The `bgcolor` attribute AND the inline `background-color` are both required** and neither is guaranteed — `wordle-teams-cih` records that this pairing is best-effort in dark mode. So the link text must stay legible if the background does not apply: do not rely on white-on-panel alone. Give the anchor a `color` that reads on the email's own `#ffffff` card as well as on `PANEL_COLOR`, or add a border. This is the same pattern `inviteEmails.ts:87` already uses — read it and match.

- [ ] **Step 4: Add the URL to the plain-text half**

In the `text` array at `:101`, after the "Don't miss out" line:

```ts
    '',
    `Enter your board: ${siteUrl}/app`,
```

Leave the existing `siteUrl` line in the signature block — that is branding, not the CTA, and dropping it changes the sign-off.

- [ ] **Step 5: Run the tests**

```bash
cd /home/cdub/projects/wordle-teams/v2 && pnpm vitest run convex/reminderEmails.test.ts
```

Expected: PASS.

- [ ] **Step 6: Look at the rendered email before believing the test**

A string assertion cannot tell you the button is legible. Add a temporary test that writes the rendered HTML out, look at it, then delete the test:

```ts
  test('LOOK AT IT — delete this test before committing', () => {
    const { html } = boardEntryReminderEmail({ firstName: 'Sam', siteUrl: 'https://beta.wordleteams.com' })
    require('node:fs').writeFileSync('/tmp/reminder.html', html)
  })
```

```bash
cd /home/cdub/projects/wordle-teams/v2 && pnpm vitest run convex/reminderEmails.test.ts
xdg-open /tmp/reminder.html
```

Check it in both light and dark, then **delete that test.** `wordle-teams-cih` is open precisely because this cannot be asserted — a look is the only check there is, and a throwaway test that writes to `/tmp` must not survive into the commit.

- [ ] **Step 7: All four gates, then commit**

```bash
cd /home/cdub/projects/wordle-teams/v2 && pnpm lint
cd /home/cdub/projects/wordle-teams/v2 && pnpm typecheck
cd /home/cdub/projects/wordle-teams/v2 && pnpm test:once
cd /home/cdub/projects/wordle-teams/v2 && pnpm build
cd /home/cdub/projects/wordle-teams && git add -A v2/ && git commit -F - <<'MSG'
feat(email): the reminder gets a real call to action, in both halves

Its only link was the brand wordmark pointing at the bare origin, which
reached the dashboard only because / was the dashboard. After the /app
move that lands a player on the marketing page instead of the board the
email just reminded them to enter.

Both halves: reminderEmails.ts builds a plain-text alternative
deliberately, with a comment recording that a mail without one scores
worse with spam filters, so a CTA in only the HTML is a new bug.

Assertions are on the emitted string, not a round trip.

MSG
```

---

## Task 3: Per-route cache headers

**Files:**
- Create: `v2/src/lib/cache-policy.ts`
- Create: `v2/src/lib/cache-policy.test.ts`
- Modify: `v2/src/server.ts`
- Test: `v2/e2e/routes.spec.ts`

### What is actually wrong today

`v2/src/server.ts`'s `withNoStoreOnDocuments` sets `cache-control: private, no-store` on every `text/html` response. Amendment A4 on `wt-ksh.8` predicted this in as many words:

> Phase 0 shipped `wt-ksh.1.13` enforcing 'no-store' on SSR document responses — correct for authenticated documents, WRONG for the static marketing routes. If that is applied at the worker level to every document, v2 reproduces jcj on a new platform.

`wordle-teams-jcj`: v1's marketing pages emitted `must-revalidate` despite being prerendered, so 28–41% of requests to `/home`, `/privacy` and `/terms` missed the edge and invoked a cold function at roughly 1.9s.

### The rule is two-dimensional, and this is the part that is easy to get wrong

**A static route is not unconditionally cacheable.** `__root.tsx`'s `beforeLoad` returns `{ isAuthenticated, token }` into router context, and TanStack Start serializes route context into the SSR document for hydration. That is what `server.ts`'s existing comment means by "the dehydrated router/query state, which includes the auth JWT".

So a signed-in user's `GET /privacy` **also** embeds a token. Caching that publicly would serve one person's JWT to the next visitor.

The rule is therefore: **public caching requires a static route AND a request with no session cookie.** An anonymous visitor and a crawler get the edge-cached fast path — which is every visitor `jcj` was about. A signed-in visitor gets `private, no-store` on every route, including `/privacy`.

- [ ] **Step 1: Write the failing unit tests**

Create `v2/src/lib/cache-policy.test.ts`:

```ts
import { describe, expect, test } from 'vitest'
import { NO_STORE, STATIC_CACHE, cachePolicyFor, hasSessionCookie } from './cache-policy.ts'

describe('cachePolicyFor', () => {
  test('an anonymous request for a static route is edge-cacheable', () => {
    expect(cachePolicyFor('/privacy', false)).toBe(STATIC_CACHE)
  })

  // THE WHOLE REASON THIS FUNCTION TAKES TWO ARGUMENTS. __root.tsx's
  // beforeLoad returns the auth token into router context, and TanStack
  // serializes context into the SSR document — so a signed-in user's
  // /privacy embeds their JWT just as /app does. Caching it publicly
  // would hand one person's token to the next visitor.
  test('a signed-in request for the SAME static route is not cacheable', () => {
    expect(cachePolicyFor('/privacy', true)).toBe(NO_STORE)
  })

  test('the dashboard is never cacheable, signed in or not', () => {
    expect(cachePolicyFor('/app', false)).toBe(NO_STORE)
    expect(cachePolicyFor('/app', true)).toBe(NO_STORE)
  })

  // FAIL SAFE. A route added later that nobody thought about must be slow,
  // never shared. This is the assertion that protects code not yet written,
  // and it is the one worth keeping if you keep only one.
  test('an unrecognised path defaults to no-store', () => {
    expect(cachePolicyFor('/some-route-nobody-has-written-yet', false)).toBe(NO_STORE)
  })

  test('a trailing slash does not defeat the static list', () => {
    expect(cachePolicyFor('/privacy/', false)).toBe(STATIC_CACHE)
  })

  test('every route in the static list is actually cacheable when anonymous', () => {
    for (const path of ['/', '/home', '/about', '/privacy', '/terms', '/maintenance', '/login-error']) {
      expect(cachePolicyFor(path, false)).toBe(STATIC_CACHE)
    }
  })

  // /login is deliberately absent from the static list. It is static for an
  // anonymous visitor, but it is the top of the funnel and nothing is gained
  // by caching a page whose whole job is to start a session. Fail safe.
  test('/login is not cached', () => {
    expect(cachePolicyFor('/login', false)).toBe(NO_STORE)
  })
})

describe('hasSessionCookie', () => {
  test('no cookie header at all is anonymous', () => {
    expect(hasSessionCookie(null)).toBe(false)
  })

  test('unrelated cookies are anonymous', () => {
    expect(hasSessionCookie('theme=dark; sidebar=open')).toBe(false)
  })

  test('the plain better-auth session cookie counts', () => {
    expect(hasSessionCookie('better-auth.session_token=abc')).toBe(true)
  })

  // Secure cookies are prefixed in production and NOT in local dev over
  // http, so both spellings have to count or the policy is right on one
  // environment and wrong on the other.
  test('the __Secure- prefixed form counts too', () => {
    expect(hasSessionCookie('__Secure-better-auth.session_token=abc')).toBe(true)
  })

  test('it is found when it is not the first cookie', () => {
    expect(hasSessionCookie('theme=dark; better-auth.session_token=abc')).toBe(true)
  })

  // A cookie whose VALUE mentions better-auth must not be mistaken for the
  // session cookie — otherwise anything can turn a cacheable page uncacheable.
  test('a mention inside another cookie value does not count', () => {
    expect(hasSessionCookie('note=better-auth.session_token')).toBe(false)
  })
})
```

- [ ] **Step 2: Run and watch it fail**

```bash
cd /home/cdub/projects/wordle-teams/v2 && pnpm vitest run src/lib/cache-policy.test.ts
```

Expected: FAIL — module not found.

- [ ] **Step 3: Write the module**

Create `v2/src/lib/cache-policy.ts`:

```ts
/**
 * Which documents may sit in a shared cache, and which may never.
 *
 * TWO DIMENSIONS, NOT ONE. A static route is not unconditionally cacheable:
 * __root.tsx's beforeLoad returns { isAuthenticated, token } into router
 * context, and TanStack Start serializes route context into the SSR document
 * for hydration — so a signed-in user's GET /privacy embeds their JWT exactly
 * as /app does. Public caching therefore requires a static route AND a request
 * with no session cookie.
 *
 * The anonymous visitor is the one wordle-teams-jcj was about: 28-41% of
 * requests to v1's /home, /privacy and /terms missed the edge and invoked a
 * cold function at ~1.9s, because Next emitted must-revalidate on prerendered
 * pages. They get the fast path here. A signed-in visitor gets no-store
 * everywhere, which costs them nothing they were not already paying.
 */

/** Routes whose anonymous rendering contains nothing user-specific. */
const STATIC_DOCUMENTS = new Set([
  '/',
  '/home',
  '/about',
  '/privacy',
  '/terms',
  '/maintenance',
  '/login-error',
])

export const NO_STORE = 'private, no-store'

/**
 * A day at the edge, a week of serving stale while revalidating behind it.
 * Matches the shape v1's `export const revalidate = 86400` produced, which is
 * the fix wordle-teams-jcj landed on. Deploys invalidate, so the window only
 * bounds how stale a between-deploy edge can get.
 */
export const STATIC_CACHE = 'public, s-maxage=86400, stale-while-revalidate=604800'

export function cachePolicyFor(pathname: string, hasSession: boolean): string {
  if (hasSession) return NO_STORE
  // '/foo/' and '/foo' are the same document; '/' must survive the trim.
  const normalized = pathname.length > 1 ? pathname.replace(/\/+$/, '') || '/' : pathname
  return STATIC_DOCUMENTS.has(normalized) ? STATIC_CACHE : NO_STORE
}

/**
 * Anchored to a cookie-name position so a mention inside another cookie's
 * VALUE cannot flip the policy. Both the plain and __Secure- prefixed spellings
 * count: secure cookies are prefixed in production and not in local dev over
 * http, and a rule right on one environment and wrong on the other is worse
 * than no rule.
 *
 * VERIFY THE REAL NAME BEFORE SHIPPING — see the step in the plan. This is
 * better-auth's default and defaults change.
 */
export function hasSessionCookie(cookieHeader: string | null): boolean {
  if (!cookieHeader) return false
  return /(?:^|;\s*)(?:__Secure-)?better-auth\.[^=;\s]*=/i.test(cookieHeader)
}
```

- [ ] **Step 4: Run the unit tests**

```bash
cd /home/cdub/projects/wordle-teams/v2 && pnpm vitest run src/lib/cache-policy.test.ts
```

Expected: PASS, all fifteen.

- [ ] **Step 5: VERIFY THE COOKIE NAME AGAINST A REAL SESSION**

The unit tests above pin better-auth's *documented default*. They cannot tell you it is the name this deployment actually sets — and if it is not, `hasSessionCookie` returns `false` for every signed-in user and the policy caches their token-bearing documents publicly. **This is the most dangerous single line in the phase.**

Sign in on local dev, then in DevTools → Application → Cookies read the real names. Or:

```bash
cd /home/cdub/projects/wordle-teams/v2 && grep -rn "cookiePrefix\|cookieName\|useSecureCookies" convex/auth.ts src/lib/auth-client.ts node_modules/better-auth/dist/index.d.ts 2>/dev/null | head
```

If the name differs, fix the regex and add a test naming the real cookie. Do not proceed on the default.

- [ ] **Step 6: Wire it into the worker**

In `v2/src/server.ts`, replace `withNoStoreOnDocuments`:

```ts
import { cachePolicyFor, hasSessionCookie } from './lib/cache-policy'

/**
 * SSR document responses embed the dehydrated router/query state, which
 * includes the auth JWT — those must never land in a shared cache. Static
 * assets (JS/CSS/images) are served by the Workers assets layer and don't pass
 * through this handler, and the content-type guard keeps this from touching
 * anything but HTML documents. (wt-ksh.1.13)
 *
 * WHAT CHANGED IN PHASE 7: this used to set no-store unconditionally, which is
 * what amendment A4 on wt-ksh.8 predicted would reproduce wordle-teams-jcj on a
 * new platform. The decision now depends on the route AND on whether the
 * request carries a session — see lib/cache-policy.ts for why both are needed.
 */
const withCachePolicy = {
  async fetch(request: Request, env: unknown, ctx: ExecutionContext): Promise<Response> {
    const response = await sentryFetch(request, env, ctx)
    const contentType = response.headers.get('content-type') ?? ''
    if (!contentType.includes('text/html')) return response
    const doc = new Response(response.body, response)
    doc.headers.set(
      'cache-control',
      cachePolicyFor(
        new URL(request.url).pathname,
        hasSessionCookie(request.headers.get('cookie')),
      ),
    )
    return doc
  },
}
```

and change the default export's second argument from `withNoStoreOnDocuments` to `withCachePolicy`.

- [ ] **Step 7: Assert on a REAL response, which is the step that actually closes this task**

The unit tests above cover `cache-policy.ts` thoroughly and cover `server.ts` not at all. That is the extraction trap named in "Before you start" — deleting the `doc.headers.set` line entirely would leave every one of them green.

Append to `v2/e2e/routes.spec.ts`:

```ts
test.describe('cache headers on real responses', () => {
  // THIS IS THE ASSERTION THAT COVERS server.ts. cache-policy.test.ts passes
  // whether or not the worker ever calls it — an exact revert of the wiring
  // leaves the unit suite green. Do not delete this in favour of "we already
  // test the policy".
  // /about, not /privacy: /privacy does not exist until Task 5, and this task
  // must be closeable on its own. /about is already in the static list.
  test('an anonymous static document is edge-cacheable', async ({ request }) => {
    const response = await request.get('/about')
    expect(response.headers()['cache-control']).toBe(
      'public, s-maxage=86400, stale-while-revalidate=604800',
    )
  })

  test('an anonymous dashboard request is not cacheable', async ({ request }) => {
    const response = await request.get('/app')
    expect(response.headers()['cache-control']).toBe('private, no-store')
  })

  test('a signed-in request for a static document is not cacheable', async ({ page, request }) => {
    await signIn(page)
    const cookies = await page.context().cookies()
    const header = cookies.map((c) => `${c.name}=${c.value}`).join('; ')
    const response = await request.get('/about', { headers: { cookie: header } })
    expect(response.headers()['cache-control']).toBe('private, no-store')
  })
})
```

Import `signIn` from `./sign-in` at the top of the file.

- [ ] **Step 8: Run e2e**

```bash
cd /home/cdub/projects/wordle-teams/v2 && pnpm e2e routes.spec.ts
```

Expected: PASS.

When Task 5 lands `/privacy`, add a case for it here too — the list in `cache-policy.ts` is longer than the set of routes that exist at this point, and every entry should end up with a real-response assertion behind it.

- [ ] **Step 9: Mutation-test the wiring before you believe it**

Delete the `doc.headers.set(...)` call in `server.ts`, run `pnpm test:once` and then `pnpm e2e routes.spec.ts`. The unit suite must stay green and the e2e must go red. If the e2e stays green, your assertion is not reaching the worker and this task is not done. Restore the line.

- [ ] **Step 10: All four gates, then commit**

```bash
cd /home/cdub/projects/wordle-teams/v2 && pnpm lint
cd /home/cdub/projects/wordle-teams/v2 && pnpm typecheck
cd /home/cdub/projects/wordle-teams/v2 && pnpm test:once
cd /home/cdub/projects/wordle-teams/v2 && pnpm build
cd /home/cdub/projects/wordle-teams && git add -A v2/ && git commit -F - <<'MSG'
feat(worker): cache headers depend on the route and on the session

server.ts set private, no-store on every text/html response. Amendment
A4 on wt-ksh.8 predicted exactly that would reproduce wordle-teams-jcj
on a new platform: v1's marketing pages emitted must-revalidate despite
being prerendered, so 28-41% of requests to /home, /privacy and /terms
missed the edge and cold-started a function at ~1.9s.

The rule needs both dimensions. A static route is NOT unconditionally
cacheable, because __root.tsx returns the auth token into router context
and TanStack serializes context into the SSR document — so a signed-in
user's /privacy embeds their JWT too. Public caching requires a static
route AND no session cookie.

An unrecognised path defaults to no-store, so a route nobody has written
yet is slow rather than shared.

MSG
```

---

## Task 4: The marketing landing at `/` and `/home`

**Files:**
- Create: `v2/src/routes/index.tsx` (a new file at the path Task 1 vacated)
- Create: `v2/src/routes/home.tsx`
- Create: `v2/src/components/home/title.tsx`
- Create: `v2/src/components/home/feature-cards.tsx`
- Create: `v2/src/components/home/dashboard-preview.tsx`
- Copy: `public/welcome-screenshot.png` → `v2/public/welcome-screenshot.png`
- Modify: `v2/src/routes/login.tsx` (its authenticated redirect target)
- Test: `v2/e2e/routes.spec.ts`

### What is being ported, and what is being dropped

Source: `src/components/home/` — `home.tsx`, `title.tsx`, `feature-cards.tsx`, `dashboard-preview.tsx`, `dashboard-skeleton.tsx`, `footer.tsx`.

**Dropped, deliberately:**

- **`Highlight` and `HeroHighlight`** (`@/components/ui/aceternity/hero-highlight`) and **`BorderBeam`** (`magicui`). `wt-ksh.12.5` already ruled the aceternity dependency out for the About carousel; the same reasoning applies here. Render the highlighted phrase as a plain styled `<span>` against v2's tokens.
- **`framer-motion`.** The entrance animation on `DashboardPreview` is one `motion.h1`. v2 does not have the dependency and one fade-in does not justify adding it.
- **`GeistSans`.** v2 has `font-display` in `src/styles.css`. Use it.
- **`dashboard-skeleton.tsx` and the `Suspense` around the preview.** They exist because v1's `DashboardPreview` was a client component doing a Supabase session read. v2's has no async work.
- **The client-side PWA standalone redirect** (`dashboard-preview.tsx:17-28`). Do not port it. Its job — stop an installed PWA opening on the welcome screen — is done server-side and more reliably by the redirect in Step 3 below. Porting both would be two mechanisms for one rule, and the client one would race hydration. **Write this down in a comment** so the next reader does not "restore" it.
- **`AppBar`.** v2 renders `Header` from `__root.tsx` on every route already.
- **v1's `home/footer.tsx`.** v2 renders `Footer` from `__root.tsx` on every route. Task 5 restores its legal links.

### `/` and `/home` are the same page

In v1 they differ only by `redirectForPwa`, and that prop is being dropped. So `home.tsx` renders the same component. Keep both routes: `/home` is in v1's sitemap at priority 0.9 and has inbound links.

- [ ] **Step 1: Write the failing e2e**

Append to `v2/e2e/routes.spec.ts`:

```ts
test.describe('the marketing landing', () => {
  test('an anonymous visitor to / gets the landing page, not a bounce to /login', async ({ page }) => {
    await page.goto('/')
    await expect(page).toHaveURL('/')
    await expect(page.getByRole('heading', { name: /compete with friends/i })).toBeVisible()
  })

  test('/home renders the same landing', async ({ page }) => {
    await page.goto('/home')
    await expect(page.getByRole('heading', { name: /compete with friends/i })).toBeVisible()
  })

  // v1's middleware comment: "A signed-in user should never land here (e.g. an
  // iOS PWA relaunch that ignores manifest start_url and restores the welcome
  // page) — bounce them into the app instead." That rule is what this ports,
  // and it is why the client-side PWA redirect in v1's dashboard-preview.tsx
  // is deliberately NOT ported.
  test('a signed-in visitor to / is sent to the app', async ({ page }) => {
    await signIn(page)
    await page.goto('/')
    await expect(page).toHaveURL('/app')
  })
})
```

Note `signIn(page)` mints an account with no `players` row, so it lands on `/complete-profile`. Complete the profile in this test, or assert `/complete-profile` — read `e2e/complete-profile.spec.ts` for the house helper before writing the assertion, and use whatever it already does rather than inventing a second way.

- [ ] **Step 2: Run and watch it fail**

```bash
pnpm e2e routes.spec.ts
```

Expected: FAIL — `/` currently 404s (Task 1 moved it away).

- [ ] **Step 3: Write the route**

Create `v2/src/routes/index.tsx`:

```tsx
import { createFileRoute, redirect } from '@tanstack/react-router'
import { pageTitle } from '#/lib/seo'
import Landing from '#/components/home/landing.tsx'

export const Route = createFileRoute('/')({
  head: () => ({ meta: [{ title: pageTitle() }] }),
  /**
   * Ported from v1's src/lib/supabase/middleware.ts `welcomePaths`.
   *
   * Its comment there: "A signed-in user should never land here (e.g. an iOS
   * PWA relaunch that ignores manifest start_url and restores the welcome
   * page) — bounce them into the app instead."
   *
   * THIS IS WHY v1's CLIENT-SIDE PWA REDIRECT IS NOT PORTED. v1 had both: this
   * rule in middleware, and a standalone-mode check inside DashboardPreview
   * that called router.replace('/me'). Two mechanisms for one rule, and the
   * client one races hydration. Do not restore it.
   */
  beforeLoad: ({ context }) => {
    if (context.isAuthenticated) throw redirect({ to: '/app' })
  },
  component: Landing,
})
```

Create `v2/src/routes/home.tsx` with the same body and `createFileRoute('/home')`, and a comment recording that `/` and `/home` are the same page — v1 differed only by a `redirectForPwa` prop that is not ported, and `/home` is kept because it sits in v1's sitemap at priority 0.9 with inbound links.

- [ ] **Step 4: Write the landing components**

Create `v2/src/components/home/landing.tsx` composing the three pieces:

```tsx
import DashboardPreview from './dashboard-preview.tsx'
import FeatureCards from './feature-cards.tsx'
import Title from './title.tsx'

/**
 * Ported from v1's src/components/home/home.tsx.
 *
 * v1 also rendered AppBar and its own Footer here; v2's __root.tsx renders
 * Header and Footer on every route, so composing them again would double them.
 */
export default function Landing() {
  return (
    <main className="flex w-full flex-col">
      <Title />
      <DashboardPreview />
      <FeatureCards />
    </main>
  )
}
```

`title.tsx` — port the copy from `src/components/home/title.tsx` verbatim: the logo image (`/wt-icon-144x144.png`), the h1 **"Compete with friends"**, the paragraph "Keep score to establish bragging rights in the **ultimate app for Wordle enthusiasts**" with the bold phrase as a plain styled span rather than aceternity's `Highlight`, and a "Get Started" `Link to="/login"` wrapping the existing `Button` from `#/components/ui/button.tsx`.

`feature-cards.tsx` — port all six cards from `src/components/home/feature-cards.tsx` verbatim in copy: Create Teams, Wordle Boards, Competitive Scoring, Go Pro, Easy Sign In, Privacy, each with its `lucide-react` icon (`Users`, `LayoutGrid`, `Trophy`, `Rocket`, `ThumbsUp`, `Lock`) and its paragraph. **Replace v1's hardcoded `bg-secondary-foreground dark:bg-secondary`, `text-gray-50` and `text-gray-400`** — none of those read correctly against v2's token set. Use v2's tokens from `src/styles.css`, and check the result in both themes.

`dashboard-preview.tsx` — the `welcome-screenshot.png` at 1000×695 with `max-w-full`, and the "Sign In" `Link to="/login"`. No `HeroHighlight`, no `BorderBeam`, no `motion`, no Supabase read, no standalone check.

- [ ] **Step 5: Copy the screenshot**

```bash
cp /home/cdub/projects/wordle-teams/public/welcome-screenshot.png /home/cdub/projects/wordle-teams/v2/public/welcome-screenshot.png
```

- [ ] **Step 6: Point `/login`'s authenticated redirect at the app**

`v2/src/routes/login.tsx` currently does `if (context.isAuthenticated) throw redirect({ to: '/' })`. After Task 1, `/` is the marketing page, so a signed-in user opening `/login` would be bounced to marketing and then bounced again by Step 3. Change the target:

```ts
    if (context.isAuthenticated) throw redirect({ to: '/app' })
```

- [ ] **Step 7: Run e2e**

```bash
cd /home/cdub/projects/wordle-teams/v2 && pnpm e2e
```

Expected: all green, with the three new landing tests passing.

- [ ] **Step 8: Look at it in both themes**

Run `pnpm dev` and open `/` in light and dark. The feature-card colour translation is the part a test cannot check, and v1's values will look wrong if pasted through.

- [ ] **Step 9: All four gates, then commit**

```bash
cd /home/cdub/projects/wordle-teams/v2 && pnpm lint
cd /home/cdub/projects/wordle-teams/v2 && pnpm typecheck
cd /home/cdub/projects/wordle-teams/v2 && pnpm test:once
cd /home/cdub/projects/wordle-teams/v2 && pnpm build
cd /home/cdub/projects/wordle-teams && git add -A v2/ && git commit -F - <<'MSG'
feat(routes): the marketing landing returns, at / and /home

v2's apex was the dashboard and bounced anonymous visitors to /login, so
after cutover a first-time visitor and every crawler would find nothing
describing the product. v1's sitemap puts the apex at priority 1, and two
funnel bugs are already open against production.

Dropped on the way over: aceternity's Highlight/HeroHighlight and
magicui's BorderBeam (wt-ksh.12.5 already ruled that dependency out),
framer-motion for one fade-in, GeistSans, and v1's client-side PWA
standalone redirect — that last one is now done server-side by the
ported welcomePaths rule, and having both would race hydration.

MSG
```

---

## Task 5: `/privacy` and `/terms`, and the footer links come back

**Files:**
- Create: `v2/src/routes/privacy.tsx`
- Create: `v2/src/routes/terms.tsx`
- Modify: `v2/src/components/Footer.tsx`
- Test: `v2/e2e/routes.spec.ts`

The prose is the deliverable. Sources: `src/app/privacy/page.tsx` (111 lines) and `src/app/terms/page.tsx` (181 lines). **Copy the text verbatim** — it is a legal document and paraphrasing it is not a refactor. Rewrite only the markup.

v1's markup hardcodes `bg-gray-50 dark:bg-background`, `text-gray-900 dark:text-gray-100` and `text-gray-700 dark:text-gray-300`. Replace with v2's tokens. `about.tsx` is the house pattern for a prose page — read it and match its `page-wrap` / `island-shell` structure.

- [ ] **Step 1: Write the failing e2e**

```ts
test.describe('legal pages', () => {
  test('/privacy renders', async ({ page }) => {
    await page.goto('/privacy')
    await expect(page.getByRole('heading', { name: /privacy policy/i })).toBeVisible()
  })

  test('/terms renders', async ({ page }) => {
    await page.goto('/terms')
    await expect(page.getByRole('heading', { name: /terms/i })).toBeVisible()
  })

  // v2/src/components/Footer.tsx carries a comment saying these links were
  // dropped because "a footer full of 404s is worse than a shorter footer".
  // The routes exist now, so the comment and the omission both go.
  test('the footer links to both', async ({ page }) => {
    await page.goto('/')
    await expect(page.getByRole('link', { name: /privacy policy/i })).toBeVisible()
    await expect(page.getByRole('link', { name: /^terms$/i })).toBeVisible()
  })
})
```

- [ ] **Step 2: Run and watch it fail**

```bash
cd /home/cdub/projects/wordle-teams/v2 && pnpm e2e routes.spec.ts
```

- [ ] **Step 3: Write both routes**

Follow this shape, with the full prose from the v1 source:

```tsx
import { createFileRoute } from '@tanstack/react-router'
import { pageTitle } from '#/lib/seo'

export const Route = createFileRoute('/privacy')({
  head: () => ({ meta: [{ title: pageTitle('Privacy Policy') }] }),
  component: Privacy,
})

function Privacy() {
  return (
    <main className="page-wrap px-4 py-12">
      <section className="island-shell rounded-2xl p-6 sm:p-8">
        <h1 className="font-display mb-6 text-3xl font-bold text-foreground">Privacy Policy</h1>
        {/* prose from src/app/privacy/page.tsx, verbatim */}
      </section>
    </main>
  )
}
```

Check v1's titles: `src/app/privacy/layout.tsx` and `src/app/terms/layout.tsx` hold the metadata titles. Match them through `pageTitle()`.

- [ ] **Step 4: Restore the footer links**

In `v2/src/components/Footer.tsx`, delete the "DELIBERATELY OMITTED" comment — it is no longer true — and add the links in v1's position. v1's `src/components/home/footer.tsx` puts them bottom-right, opposite a "Wordle Teams" span:

```tsx
        <div className="flex justify-between text-xs">
          <span>Wordle Teams</span>
          <div>
            <Link to="/privacy">Privacy Policy</Link>
            <Link to="/terms" className="ml-6">
              Terms
            </Link>
          </div>
        </div>
```

Keep v2's existing `&copy; {year} Wordle Teams` line or fold it into this row — one of them, not both.

- [ ] **Step 5: Run e2e, all four gates, commit**

```bash
cd /home/cdub/projects/wordle-teams/v2 && pnpm e2e routes.spec.ts
cd /home/cdub/projects/wordle-teams/v2 && pnpm lint
cd /home/cdub/projects/wordle-teams/v2 && pnpm typecheck
cd /home/cdub/projects/wordle-teams/v2 && pnpm test:once
cd /home/cdub/projects/wordle-teams/v2 && pnpm build
cd /home/cdub/projects/wordle-teams && git add -A v2/ && git commit -F - <<'MSG'
feat(routes): /privacy and /terms, and the footer links come back

Footer.tsx dropped both links because the routes 404'd, with a comment
saying so. The routes exist now and the comment is gone with them.

Prose copied verbatim from v1 — it is a legal document. Only the markup
is rewritten, because v1 hardcodes gray-scale utilities that do not read
against v2's token set.

MSG
```

---

## Task 6: `/login-error`, and a decision on `wordle-teams-vjh`

**Files:**
- Create: `v2/src/routes/login-error.tsx`
- Test: `v2/e2e/routes.spec.ts`
- Close or re-scope: `wordle-teams-vjh`

Source: `src/app/login-error/page.tsx` (34 lines). Port the copy verbatim — the two asterisked notes explain real failure modes to a user who just hit one.

**v1 calls `clearAllCookies()` in a `useEffect` on mount.** Decide whether that ports. v2's auth is Better Auth on Convex, not Supabase, and clearing every cookie indiscriminately is a blunt instrument that would also drop the theme preference. Prefer signing out through `authClient` if a stale session is the actual problem, or drop it and say why in a comment. Do not port it unexamined.

### The `vjh` decision this task must make

`wordle-teams-vjh`: v1's auth callback ignores the provider's `?error=` param and shows this generic page, so a user who hit "access denied" at Google sees the same screen as a user whose OTP expired.

Either is acceptable; leaving it undecided is not.

- **Port as-is** — `/login-error` shows the generic copy, `vjh` stays open against v1 and is closed as won't-fix for v2 with a note.
- **Carry the param through** — the callback passes the provider's error into `/login-error?reason=...` and the page adds one line for the known cases. This is a real improvement on a page a confused user is already looking at, and it costs a search-param and a switch.

Record the choice in `wordle-teams-vjh` either way.

- [ ] **Step 1: Write the failing e2e**

```ts
test('/login-error renders and offers a way back to sign in', async ({ page }) => {
  await page.goto('/login-error')
  await expect(page.getByRole('heading', { name: /sign in failed/i })).toBeVisible()
  await expect(page.getByRole('link', { name: /head to sign in/i })).toBeVisible()
})
```

- [ ] **Step 2: Run and watch it fail**

```bash
cd /home/cdub/projects/wordle-teams/v2 && pnpm e2e routes.spec.ts
```

- [ ] **Step 3: Write the route**

Port the copy from `src/app/login-error/page.tsx`: the "Sign In Failed" heading, "Please try again", both asterisked notes, and the "Head to Sign In" button linking to `/login`. Use `Link to="/login"` and the existing `Button`.

- [ ] **Step 4: Make and record the vjh decision**

```bash
bd show wordle-teams-vjh
```

Then record the decision. Use a **quoted** heredoc — backticks in a `bd note` string are executed by the shell and the word disappears:

```bash
bd note wordle-teams-vjh <<'NOTE'
PHASE 7 DECISION: <ported as-is | the provider error is carried through>.

WHY: <one or two sentences>.

WHAT /login-error SHOWS NOW: <the generic copy | the generic copy plus one
line covering the known provider error cases>.

v1 REMAINS AFFECTED and is not being fixed here - src/ is untouched until
cutover, and v1 retires at it.
NOTE
```

- [ ] **Step 5: Run e2e, all four gates, commit**

```bash
cd /home/cdub/projects/wordle-teams/v2 && pnpm lint
cd /home/cdub/projects/wordle-teams/v2 && pnpm typecheck
cd /home/cdub/projects/wordle-teams/v2 && pnpm test:once
cd /home/cdub/projects/wordle-teams/v2 && pnpm build
cd /home/cdub/projects/wordle-teams/v2 && pnpm e2e routes.spec.ts
git add -A v2/ && git commit -F - <<'MSG'
feat(routes): /login-error, ported from v1

Copy ported verbatim: the two asterisked notes explain real failure
modes to a user who has just hit one.

v1 called clearAllCookies() on mount. Not ported unexamined - v2's auth
is Better Auth on Convex, not Supabase, and clearing every cookie would
also drop the theme preference.

MSG
```

---

## Task 7: `/maintenance`, and a maintenance switch that is actually exercised

**Files:**
- Create: `v2/src/routes/maintenance.tsx`
- Create: `v2/src/lib/maintenance.ts`
- Create: `v2/src/lib/maintenance.test.ts`
- Modify: `v2/src/server.ts`
- Modify: `v2/wrangler.jsonc`
- Test: `v2/e2e/routes.spec.ts`

### Read this before writing anything

`wt-ksh.8`'s own notes:

> v1's middleware had NEVER executed in production — it sat at the repo root while Next resolves it at `src/middleware.ts`, with no warning and no build error, so maintenance mode, the welcome-path PWA redirect and auth cookie refresh were all dead until `bdca5f5`. **Do not assume maintenance mode works in v2 because it exists; test it.**

A feature that has never once run in production for the life of a project is the strongest possible argument for asserting the off state, the on state, the exclusions and the failure path — not just "it renders".

### What ports from v1's middleware, and what does not

`src/middleware.ts` + `src/lib/supabase/middleware.ts`:

- **The flag read and the rewrite** — ports, as a Worker var instead of Edge Config.
- **Fail open** — ports. v1 wraps the read in `try/catch` and continues on error, with a comment: "A transient Edge Config or Supabase outage must degrade to 'let the request through', never to a 500."
- **The allowlist** — ports, and its reasoning is the interesting half. v1 deliberately does **not** cover `/home`, `/about`, `/privacy` and `/terms`: "The trade-off is that maintenance mode no longer covers those four pages — which is the better behaviour, since they are static and render fine while the app is down."
- **The auth cookie refresh** — does not port. That is Supabase session machinery with no Better Auth equivalent.
- **`welcomePaths` / `protectedPaths`** — already ported, in Task 4 and in each route's own `beforeLoad`.

- [ ] **Step 1: Write the failing unit tests**

Create `v2/src/lib/maintenance.test.ts`:

```ts
import { describe, expect, test } from 'vitest'
import { isMaintenanceGated, maintenanceEnabled } from './maintenance.ts'

describe('maintenanceEnabled', () => {
  // UNSET MEANS OFF. This is v1's fail-open semantics for free, and it is the
  // state every environment is in almost always.
  test('an unset var is off', () => {
    expect(maintenanceEnabled(undefined)).toBe(false)
  })

  test('an empty string is off', () => {
    expect(maintenanceEnabled('')).toBe(false)
  })

  test('"true" is on', () => {
    expect(maintenanceEnabled('true')).toBe(true)
  })

  // A var set to the STRING "false" is the classic way to turn something on by
  // accident. It must be off.
  test('"false" is off', () => {
    expect(maintenanceEnabled('false')).toBe(false)
  })
})

describe('isMaintenanceGated', () => {
  test('the dashboard is gated', () => {
    expect(isMaintenanceGated('/app')).toBe(true)
  })

  test('complete-profile is gated', () => {
    expect(isMaintenanceGated('/complete-profile')).toBe(true)
  })

  // v1's middleware comment, verbatim: the static pages "are static and render
  // fine while the app is down", and covering them is the WORSE behaviour.
  // Someone reading the terms while the app is in maintenance should get the
  // terms.
  test('the static pages are NOT gated', () => {
    for (const path of ['/', '/home', '/about', '/privacy', '/terms']) {
      expect(isMaintenanceGated(path)).toBe(false)
    }
  })

  // If the page the gate rewrites TO were itself gated, the rewrite would loop.
  test('/maintenance is not gated, or the rewrite would loop', () => {
    expect(isMaintenanceGated('/maintenance')).toBe(false)
  })

  test('a sub-path of a gated route is gated', () => {
    expect(isMaintenanceGated('/app/anything')).toBe(true)
  })
})
```

- [ ] **Step 2: Run and watch it fail**

```bash
cd /home/cdub/projects/wordle-teams/v2 && pnpm vitest run src/lib/maintenance.test.ts
```

- [ ] **Step 3: Write the module**

```ts
/**
 * Maintenance mode, ported from v1's src/middleware.ts.
 *
 * v1 read `maintenance_${ENVIRONMENT}` from Vercel Edge Config, which is on the
 * epic's "killed with no replacement" list. This reads a plain Worker var
 * instead: editing it in the Cloudflare dashboard takes effect without a code
 * deploy, which is the property Edge Config was providing.
 *
 * NOTE FOR ANYONE ADDING A ROUTE: v1's matcher was an ALLOWLIST, not a filter,
 * and its comment argues the static pages should keep rendering while the app
 * is down — "they are static and render fine". A new authenticated route needs
 * adding here; a new static one does not.
 *
 * v1's maintenance mode had never once executed in production before bdca5f5,
 * because the middleware file sat at a path Next silently ignores. That is why
 * this has unit tests for all four states AND an e2e against a real response.
 */
const GATED_PREFIXES = ['/app', '/complete-profile', '/login']

export function maintenanceEnabled(value: string | undefined): boolean {
  return value === 'true'
}

export function isMaintenanceGated(pathname: string): boolean {
  return GATED_PREFIXES.some(
    (prefix) => pathname === prefix || pathname.startsWith(`${prefix}/`),
  )
}
```

Decide whether `/login` belongs in `GATED_PREFIXES`. v1 matched it. Signing in while the app is down puts a user straight into a broken dashboard, so gating it is defensible — but v1's matcher covered it for cookie refresh, not for maintenance. Make the call and write the reason in the comment; then make the test above match your decision.

- [ ] **Step 4: Write the route**

Port `src/components/maintenance.tsx`: the "Coming Soon" heading and "Site is under construction". The gradient SVG uses `hsl(var(--color-stop-1..3))`, which do not exist in v2's token set — either define them in `styles.css` or render the icon in a single token colour. Do not ship a reference to an undefined custom property; it renders black and looks broken.

- [ ] **Step 5: Wire it into the worker, in front of the cache policy**

In `v2/src/server.ts`, inside `withCachePolicy.fetch`, before calling `sentryFetch`:

```ts
    const url = new URL(request.url)
    // FAIL OPEN, like v1. A flag that cannot be read must let the request
    // through, never 500. v1's comment: "This middleware has never run in
    // production before, so it gets no benefit of the doubt."
    let gated = false
    try {
      gated =
        maintenanceEnabled((env as { MAINTENANCE?: string })?.MAINTENANCE) &&
        isMaintenanceGated(url.pathname)
    } catch {
      gated = false
    }
    if (gated) {
      const rewritten = new Request(new URL('/maintenance', url).toString(), request)
      const response = await sentryFetch(rewritten, env, ctx)
      const doc = new Response(response.body, response)
      doc.headers.set('cache-control', 'private, no-store')
      return doc
    }
```

The maintenance response is `no-store` deliberately: it is a transient state, and an edge that cached it for a day would outlive the outage.

- [ ] **Step 6: Add the var**

In `v2/wrangler.jsonc`, under `vars`:

```jsonc
		/**
		 * Maintenance mode. Unset or anything but the exact string "true" means
		 * off — see src/lib/maintenance.ts. Flip it in the Cloudflare dashboard
		 * to take effect without a code deploy, which is what v1 used Vercel
		 * Edge Config for.
		 *
		 * It gates the APP routes only. The static pages keep rendering, which
		 * is v1's deliberate behaviour and the better one.
		 */
		"MAINTENANCE": "false",
```

- [ ] **Step 7: Assert on a real response, in both states**

The unit tests cover `maintenance.ts` and cover `server.ts` not at all — the same trap as Task 3. Add to `v2/e2e/routes.spec.ts`:

```ts
test('/maintenance renders on its own', async ({ page }) => {
  await page.goto('/maintenance')
  await expect(page.getByRole('heading', { name: /coming soon/i })).toBeVisible()
})
```

Then verify the gate itself by hand, because Playwright's dev server does not read `wrangler.jsonc` vars:

```bash
cd /home/cdub/projects/wordle-teams/v2 && pnpm build
cd /home/cdub/projects/wordle-teams/v2 && MAINTENANCE=true npx wrangler dev
```

In another shell:

```bash
curl -sI http://localhost:8787/app | head -1
curl -sI http://localhost:8787/privacy | head -1
```

Expected: `/app` serves the maintenance document; `/privacy` serves the privacy page. **Record the two outputs in the commit message** — this is the only evidence the gate has ever run, and v1's went unexercised for the life of the project.

- [ ] **Step 8: Demonstrate it ON BETA, which is the acceptance criterion**

Steps 1-7 prove it works locally. Acceptance criterion 4 says **on beta**, and the difference is not pedantry: spike S1 answered its question on the local backend and reported it as beta, which is why beta's ICU data is still not independently established. Do not repeat that.

Push, let it deploy, then flip the var in the Cloudflare dashboard for the `wordle-teams-v2` Worker and check all three facts:

```bash
curl -sI https://beta.wordleteams.com/app      | head -1
curl -sI https://beta.wordleteams.com/privacy  | head -1
curl -s  https://beta.wordleteams.com/app      | grep -o "Coming Soon"
```

Expected while on: `/app` serves the maintenance document, `/privacy` still serves the privacy page. **Then turn it back off and re-check `/app`** — leaving beta in maintenance is how the next person concludes the deployment is broken.

Record all three outputs, on and off, in the commit message. This is the only evidence the gate has ever run against the real platform.

- [ ] **Step 9: All four gates, then commit**

```bash
cd /home/cdub/projects/wordle-teams/v2 && pnpm lint
cd /home/cdub/projects/wordle-teams/v2 && pnpm typecheck
cd /home/cdub/projects/wordle-teams/v2 && pnpm test:once
cd /home/cdub/projects/wordle-teams/v2 && pnpm build
cd /home/cdub/projects/wordle-teams && git add -A v2/ && git commit -F - <<'MSG'
feat(worker): maintenance mode, and evidence that it runs

v1's read a Vercel Edge Config flag, which is killed with no replacement.
This reads a plain Worker var: editing it in the Cloudflare dashboard
takes effect without a code deploy, which is the property Edge Config
was providing. Unset means off, which is v1's fail-open semantics free.

It gates the app routes only. v1's matcher deliberately excluded the
static pages, arguing they "are static and render fine while the app is
down" — that is the better behaviour and it ports.

v1's maintenance mode had NEVER executed in production, because the
middleware sat at a path Next silently ignores. So this has unit tests
for every state and a hand-run check against a real wrangler dev, whose
output is recorded here rather than asserted only in a pure function.

MSG
```

---

## Task 8: `robots.txt`, `sitemap.xml`, and the OpenGraph image

**Files:**
- Modify: `v2/public/robots.txt`
- Create: `v2/src/routes/sitemap[.]xml.ts`
- Copy: `src/app/opengraph-image.png` → `v2/public/opengraph-image.png`
- Modify: `v2/src/routes/__root.tsx` (OG meta tags)
- Test: `v2/e2e/routes.spec.ts`

v2's `public/robots.txt` is the Vite starter default — `User-agent: *` and an empty `Disallow:`, allowing everything and naming no sitemap. v1's `src/app/robots.ts` disallows `/me/`, `/branding`, `/complete-profile`, `/novu` and `/api`.

- [ ] **Step 1: Write the failing e2e**

```ts
test.describe('crawler and social metadata', () => {
  test('robots.txt disallows the app and names the sitemap', async ({ request }) => {
    const body = await (await request.get('/robots.txt')).text()
    expect(body).toContain('Disallow: /app')
    expect(body).toContain('Disallow: /complete-profile')
    expect(body).toContain('Disallow: /api')
    expect(body).toMatch(/Sitemap: https?:\/\/\S+\/sitemap\.xml/)
  })

  test('the sitemap lists the public routes and NOT the private ones', async ({ request }) => {
    const body = await (await request.get('/sitemap.xml')).text()
    for (const path of ['/home', '/about', '/privacy', '/terms', '/login', '/maintenance']) {
      expect(body).toContain(path)
    }
    // If the dashboard is in the sitemap while robots disallows it, the two
    // files are telling crawlers opposite things.
    expect(body).not.toContain('/app')
    expect(body).not.toContain('/complete-profile')
  })

  test('the OpenGraph image is served', async ({ request }) => {
    const response = await request.get('/opengraph-image.png')
    expect(response.status()).toBe(200)
    expect(response.headers()['content-type']).toContain('image/png')
  })
})
```

- [ ] **Step 2: Run and watch it fail**

- [ ] **Step 3: Write `robots.txt`**

```
# Ported from v1's src/app/robots.ts. The dashboard moved from /me to /app in
# Phase 7; /me still redirects there, so both are excluded.
User-agent: *
Allow: /
Disallow: /app
Disallow: /me
Disallow: /complete-profile
Disallow: /api

Sitemap: https://wordleteams.com/sitemap.xml
```

`/branding` and `/novu` are dropped: neither exists in v2.

**Note the sitemap URL is the production origin, on beta too.** That is what v1 does and it is correct — a sitemap directive names the canonical host. Do not template it off `SITE_URL` without deciding that deliberately.

- [ ] **Step 4: Write the sitemap route**

A server route, following `src/routes/api/funnel.ts`'s shape. Port the entries and priorities from `src/app/sitemap.ts` — apex 1.0, `/home` 0.9, `/about` 0.8, `/privacy` 0.7, `/terms` 0.6, `/login` 0.5, `/maintenance` 0.4 — emitting `application/xml`.

`lastModified: new Date()` in v1 makes every entry claim it changed on every request, which is not useful information for a crawler. Use the build date or drop `lastmod`; say which in a comment.

- [ ] **Step 5: Copy the OG image and wire the meta tags**

```bash
cp /home/cdub/projects/wordle-teams/src/app/opengraph-image.png /home/cdub/projects/wordle-teams/v2/public/opengraph-image.png
cat /home/cdub/projects/wordle-teams/src/app/opengraph-image.alt.txt
```

Add `og:image`, `og:title`, `og:description`, `og:type`, `og:url` and the `twitter:` equivalents to `__root.tsx`'s `head().meta`, using the alt text from that file. Check `src/app/layout.tsx` for v1's exact OG values and match them — this is a parity port, not a rewrite.

- [ ] **Step 6: Run e2e, all four gates, commit**

```bash
cd /home/cdub/projects/wordle-teams/v2 && pnpm e2e routes.spec.ts
cd /home/cdub/projects/wordle-teams/v2 && pnpm lint
cd /home/cdub/projects/wordle-teams/v2 && pnpm typecheck
cd /home/cdub/projects/wordle-teams/v2 && pnpm test:once
cd /home/cdub/projects/wordle-teams/v2 && pnpm build
cd /home/cdub/projects/wordle-teams && git add -A v2/ && git commit -F - <<'MSG'
feat(seo): a real robots.txt, a sitemap, and the OpenGraph image

v2's robots.txt was the Vite starter default: it allowed everything and
named no sitemap, so /complete-profile and /api were crawlable and
nothing pointed at a sitemap that did not exist.

Ported from v1's robots.ts and sitemap.ts, with /me and /app both
excluded and /branding and /novu dropped since neither exists in v2.

MSG
```

---

## Task 9: About's missing half — the eight screenshots

**Files:**
- Modify: `v2/src/routes/about.tsx`
- Copy: eight PNGs from `public/` → `v2/public/`
- Test: `v2/e2e/routes.spec.ts`

`v2/src/routes/about.tsx` carries the comment: "This is the SUBSTANCE of v1's About page, not the whole thing. v1 also has eight annotated product screenshots and an aceternity InfiniteMovingCards carousel; porting that marketing surface belongs to Phase 7's route-by-route static-page walk."

The eight, from `src/components/about.tsx`: `board-entry.png`, `install-button.png`, `create-team.png`, `upgrade-button.png`, `feedback-page.png`, `changelog-page.png`, `twitter-acct.png`, `github-repo.png`.

**The carousel is not ported** — `wt-ksh.12.5` ruled the aceternity `InfiniteMovingCards` dependency out. Lay the four "community" images out as a plain responsive grid.

- [ ] **Step 1: Copy the assets**

```bash
cd /home/cdub/projects/wordle-teams && for f in board-entry install-button create-team upgrade-button feedback-page changelog-page twitter-acct github-repo; do cp "public/$f.png" "v2/public/$f.png"; done
ls -la /home/cdub/projects/wordle-teams/v2/public/*.png
```

- [ ] **Step 2: Write the failing e2e**

```ts
test('the about page shows the product screenshots', async ({ page }) => {
  await page.goto('/about')
  await expect(page.getByAltText(/board entry screenshot/i)).toBeVisible()
  await expect(page.getByAltText(/create team screenshot/i)).toBeVisible()
})
```

- [ ] **Step 3: Port the sections**

Read `src/components/about.tsx` and port each image with its surrounding annotation copy, keeping v1's `alt` text verbatim — it is the accessible description and it is already written. Every image needs explicit `width`/`height` (or an aspect-ratio container) so the page does not reflow as they load; v1 got that from `next/image` and v2 has no equivalent.

- [ ] **Step 4: Delete the comment that is no longer true**

The "This is the SUBSTANCE … not the whole thing" comment describes a state that no longer exists. Remove it, and remove the sentence naming Phase 7 as the owner. Leave the note about the carousel being ruled out — that one stays true.

- [ ] **Step 5: Run e2e, all four gates, commit**

```bash
cd /home/cdub/projects/wordle-teams/v2 && pnpm lint
cd /home/cdub/projects/wordle-teams/v2 && pnpm typecheck
cd /home/cdub/projects/wordle-teams/v2 && pnpm test:once
cd /home/cdub/projects/wordle-teams/v2 && pnpm build
cd /home/cdub/projects/wordle-teams/v2 && pnpm e2e routes.spec.ts
cd /home/cdub/projects/wordle-teams && git add -A v2/ && git commit -F - <<'MSG'
feat(about): the eight product screenshots v1 has and v2 did not

The carousel is still not ported - wt-ksh.12.5 ruled the aceternity
dependency out - so the community images are a plain responsive grid.

MSG
```

---

## Task 10: The TeamBoards carousel (`wordle-teams-ry1`)

**Files:**
- Create: `v2/src/components/teams/team-boards.tsx`
- Modify: `v2/src/routes/app.tsx`
- Possibly create: `v2/src/components/ui/carousel.tsx`
- Test: `v2/e2e/board-entry.spec.ts` or a new `v2/e2e/team-boards.spec.ts`

### Read this first: it needs a decision, not just a port

v1's `src/components/app-grid-items/team-boards.tsx` (168 lines) uses shadcn's `Carousel`, which is a wrapper over `embla-carousel-react`.

**v2 has neither.** `v2/src/components/ui/` holds nineteen components and `carousel` is not one of them; `package.json` has no `embla` dependency.

So this task starts with a choice:

- **Add the dependency.** `pnpm dlx shadcn@latest add carousel` from inside `v2/` — note the CLI must run from `v2/`, because from the repo root it misdetects the project as v1 and resolves the Tailwind CSS file to `docs/design-system/globals.v2.css`. Closest to v1, and embla is small and well-maintained.
- **Build it without a carousel.** The content is one board per teammate. A horizontal scroll-snap container with CSS (`overflow-x-auto snap-x snap-mandatory`) plus the two arrow buttons gives the same affordance in no dependency at all.

**Recommendation: the scroll-snap container.** The epic's whole direction is vendor and dependency reduction, this is one screen, and the arrows and the loop are the only embla features v1 actually uses. But either is defensible — decide, and record the reason in `wordle-teams-ry1`.

### What ports, and the trap inside it

v1's component carries two comments about **server/client date divergence** that are load-bearing:

> Starts undefined rather than `getDate()`. `getDate()` calls `new Date()`, and this is a `'use client'` component so it also renders on the server — where "now" is UTC. For any user whose local date differs from UTC (every US evening, every Australian morning) the server and client disagree about today, and every `isToday()` below resolves differently.

**v2 has the same hazard and a better tool.** `convex/lib/puzzleDay.ts` exists precisely so a day is resolved in the player's zone rather than the server's, and `useHydrated` (`src/lib/use-hydrated.ts`) is already the house answer to "do not render a client-only value during SSR". Use both. Do not port `date-fns`' `isToday` against a raw `new Date()` — that is the defect class divergences 14 and 15 in §7a document, and reintroducing it on a new screen would be the phase's own worst finding.

The score-matching logic (`dayKeyOf(s.date, p.timeZone)`) has a direct v2 equivalent in `puzzleDay`. Use it.

- [ ] **Step 1: Decide, and record the decision**

```bash
bd show wordle-teams-ry1
```

Write the choice and its reason into the issue with `bd note` and a quoted heredoc.

- [ ] **Step 2: Extract the pure part FIRST, and be honest about what that leaves**

The testable logic is: given a team, a selected day and the current player, which boards are shown, which are hidden, and what the hidden message says. Put it in `v2/src/components/teams/team-boards-model.ts` as pure functions over plain data.

**But read this before you feel finished.** Extracting that and testing it thoroughly is exactly the pattern Phase 6's reviews caught three times: *an extraction can move the untested part rather than shrink it.* The part that decides whether the model is ever called — the effects, the day arithmetic on navigation, the hydration guard — is the part that broke in v1, and it stays uncovered by a model test. The e2e in Step 5 is not optional.

- [ ] **Step 3: Write the model tests**

Create `v2/src/components/teams/team-boards-model.test.ts`:

```ts
import { describe, expect, test } from 'vitest'
import { boardsForDay, hiddenMessage, shouldHideBoards } from './team-boards-model.ts'

describe('shouldHideBoards', () => {
  // v1's rule: today's boards are concealed until you have entered your own,
  // so nobody can copy an answer off a teammate. On any past day they show.
  test("today's boards are hidden until the viewer has entered their own", () => {
    expect(shouldHideBoards({ day: '2026-08-31', today: '2026-08-31', viewerEnteredToday: false })).toBe(true)
  })

  test("today's boards show once the viewer has entered", () => {
    expect(shouldHideBoards({ day: '2026-08-31', today: '2026-08-31', viewerEnteredToday: true })).toBe(false)
  })

  test('a past day is never hidden, even with nothing entered today', () => {
    expect(shouldHideBoards({ day: '2026-08-30', today: '2026-08-31', viewerEnteredToday: false })).toBe(false)
  })
})

describe('hiddenMessage', () => {
  // TWO DISTINCT STRINGS IS THE POINT. "no board" and "not yet visible" are
  // different facts, and v1 says so — showing the same sentence for both tells
  // a player their teammate did not play when in fact they did.
  test('a concealed board says it becomes visible after submission', () => {
    expect(hiddenMessage(true)).toBe("Visible after today's submission")
  })

  test('a genuinely absent board says so', () => {
    expect(hiddenMessage(false)).toBe('No board for player on this date')
  })
})

describe('boardsForDay', () => {
  // Matched on the PUZZLE DAY, not on a timestamp compared in the viewer's
  // zone. This is the defect class §7a divergences 14 and 15 document: v1's
  // reminder rule resolved the day on the server and applied it to every
  // player wherever they were. A board entered on the entrant's Aug 31 must
  // appear on Aug 31 for a teammate reading it from another zone.
  test('a board matches on the entrant puzzle day, not the viewer clock', () => {
    const boards = boardsForDay({
      day: '2026-08-31',
      players: [
        { id: 'p1', name: 'Sam', scores: [{ id: 's1', puzzleDay: '2026-08-31', answer: 'crane', guesses: ['crane'] }] },
        { id: 'p2', name: 'Alex', scores: [] },
      ],
    })
    expect(boards).toHaveLength(2)
    expect(boards[0]).toMatchObject({ playerName: 'Sam', exists: true, answer: 'crane' })
    expect(boards[1]).toMatchObject({ playerName: 'Alex', exists: false })
  })

  // Every teammate gets a slot whether or not they played. v1 does this and it
  // matters: a missing slot silently changes the carousel's length and makes
  // "who is on this team" unanswerable from the screen.
  test('a player with no score still gets a slot', () => {
    const boards = boardsForDay({
      day: '2026-08-31',
      players: [{ id: 'p1', name: 'Sam', scores: [] }],
    })
    expect(boards).toHaveLength(1)
    expect(boards[0].exists).toBe(false)
  })
})
```

Adjust the shapes to the real Convex return types from `api.teams.getMyTeams` — read them, do not guess.

- [ ] **Step 4: Run, watch fail, implement, run again**

```bash
pnpm vitest run src/components/teams/team-boards-model.test.ts
```

- [ ] **Step 5: Build the component and assert it on a real page**

Mount it in `v2/src/routes/app.tsx` beside the existing cards. Then assert against a real dashboard, which is the only coverage the wiring gets:

```ts
test('the dashboard shows the team boards panel', async ({ page }) => {
  // reuse the signed-in-with-a-team fixture this suite already has —
  // read e2e/teams.spec.ts and use its helper rather than writing a second one
  await expect(page.getByRole('heading', { name: /team boards/i })).toBeVisible()
  await expect(page.getByRole('button', { name: /previous day/i })).toBeVisible()
})
```

- [ ] **Step 6: Check hydration, because this is where v1 got it wrong**

Run `pnpm dev`, open the dashboard, and check the browser console for a hydration mismatch warning. v1 hit exactly this and left two comments about it. A mismatch here is a real defect, not noise.

- [ ] **Step 7: All four gates, e2e, commit, close `wordle-teams-ry1`**

---

## Task 11: The monthly-winner celebration dialog (`wordle-teams-k7w`)

**Files:**
- Create: `v2/src/components/winner-celebration.tsx`
- Create: `v2/convex/winners` public functions (see Step 1)
- Modify: `v2/src/routes/app.tsx`
- Test: unit tests for the pure decision + an e2e
- Modify: `docs/design-system/V2-ADDENDUM.md` if the v1 bug below is fixed

### v2 has the backend and no way to call it

`v2/convex/winners.ts` exports `recomputeTeamMonth`, `recomputeTeamMonths`, `monthsWithWinners`, `recomputePlayerMonth`, `loadTeamMonthSystem` — all internal helpers taking a `ctx`. **There is no public query returning last month's winner, and no mutation marking a celebration seen.** §7a divergence #3 is a careful argument about `hasSeenCelebration`'s rewrite semantics for a dialog that has never existed.

So this task builds three things, not one: the query, the mutation, and the UI.

### v1 has a bug here, and you must decide about it

`src/app/me/monthly-winner-celebration.tsx`:

```tsx
{!isCurrentUserWinner && <DialogTitle>{user.firstName} {user.lastName} won!</DialogTitle>}
```

`user` is the **current** user, not the winner. So when someone else won, v1 tells you *your own name* won, and then the body says "<your own name> won last month for <team>. Better luck next time!"

**Recommendation: fix it.** It is a defect, not a behaviour — nobody decided the dialog should misname the winner — and shipping it knowingly is worse than the divergence. If you fix it, add it to §7a as a divergence row in Task 16 with this evidence. If you port it, say in a comment that it is deliberate and why.

### Two more decisions

- **`react-confetti-explosion` is a v1 dependency v2 does not have.** Either add it, or do the celebration with CSS. The epic's direction is dependency reduction; a CSS or `prefers-reduced-motion`-respecting animation is the smaller answer. Note that v1's confetti fires only for the winner — whichever you choose, respect `prefers-reduced-motion`, which v1 does not.
- **The `hasSeenCelebration` write is a read-modify-write** in v1: read the array, append, write it back. `wordle-teams-069` is the open issue for exactly this pattern losing updates elsewhere in this codebase. In Convex a mutation is transactional, so do the append **inside** the mutation rather than sending a computed array from the client. Do not port v1's shape.

- [ ] **Step 1: Write the Convex functions, test-first**

A query returning last month's winner row for a team — or `null` — and a mutation that adds the calling player to `hasSeenCelebration` for that row. Both go through `access.ts`'s helpers, and **anything a caller sees must be a `ConvexError` via `accessError`**: plain `Error` messages are redacted in production while `convex-test` never redacts, so no test can catch that mistake. It is a review-only check.

Write the tests in `v2/convex/winners.test.ts` alongside the existing ones. At minimum:

- **`marking a celebration seen appends without dropping the players already there`** — seed a `monthlyWinners` row whose `hasSeenCelebration` already holds one player, call the mutation as a second player, and assert the array holds **both**. This is the assertion that fails if you port v1's read-modify-write shape.
- **`marking it seen twice does not duplicate the player`** — idempotence. The dialog can mount twice on a fast remount, and a duplicated id is how an array like this quietly grows without bound.
- **`a winner rewrite that does not change the winner preserves the seen list`** — §7a divergence #3 is the reason this field has careful semantics at all, and nothing has ever read it. Recompute the same month with the same winner and assert the array survives.
- **`a rewrite that DOES change the winner resets the seen list`** — the other half of #3. Without this, the first test passes for a function that never resets, which is v1's bug in the opposite direction.

Seed through the harness `v2/convex/winners.test.ts` already uses — read its existing setup and reuse it rather than writing a second way to build a team with players and scores.

- [ ] **Step 2: Write the pure decision and its tests**

Whether to open the dialog is a pure function of (winner row, viewer id): open when a row exists and the viewer is not in `hasSeenCelebration`; and separately, whether the viewer is the winner. Put it in `v2/src/lib/celebration.ts` and test both branches plus the null-row case.

- [ ] **Step 3: Build the dialog**

Use `#/components/ui/dialog.tsx`, which v2 already has. Port v1's copy, with the winner's name fixed if you took the recommendation.

- [ ] **Step 4: Assert on a real page**

The model test does not prove the dialog ever mounts. An e2e that seeds a winner row and loads the dashboard is the coverage that does.

- [ ] **Step 5: All four gates, e2e, commit, close `wordle-teams-k7w`**

---

## Task 12: An always-reachable upgrade entry point (`wordle-teams-6tp`)

**Files:**
- Modify: `v2/src/components/Header.tsx`
- Test: `v2/e2e/billing.spec.ts`

### The gap

`v2/src/components/team-picker.tsx:78` is the only call site of `createProCheckout`, inside a dropdown item rendered when `atFreeLimit = !isPro && teams.length >= FREE_TEAM_LIMIT` (`:48`). A free player with one team cannot pay. The owner's account is comped Pro, so `isPro` is true and the item never renders for them at all — which is why Phase 5's sandbox pass has never been runnable.

**Owner's decision: one always-reachable entry point, not v1's three.** One reachable route is what `6tp` requires and what unblocks Task 18; three is a funnel experiment and this is a parity phase.

### Where it goes

`v2/src/components/Header.tsx` already renders a Billing button for authenticated users (`:155-165`) and already computes `isPro === false` at `:106` — with a comment explaining why it is written that way rather than `!isPro`:

> `isPro === false` RATHER THAN `!isPro`. `isPro` is undefined while the query …

**Follow that.** A free player sees **Upgrade** where a pro player sees **Billing**. `isPro === undefined` (still loading) must render neither a wrong label nor a flash — match how the existing invite badge handles it.

`team-picker.tsx`'s existing gated CTA stays. Two entry points to the same action is fine; that is what v1 had.

- [ ] **Step 1: Write the failing e2e**

In `v2/e2e/billing.spec.ts`:

```ts
// wordle-teams-6tp: v2's only route to checkout was the team-picker item that
// renders when a free player is ALREADY at the 2-team cap, so a free player
// with one team could not pay at all — and the owner, comped pro, could not
// reach checkout as themselves to run Phase 5's sandbox pass.
test('a free player holding one team can reach the upgrade action', async ({ page }) => {
  // sign in, create exactly ONE team — below FREE_TEAM_LIMIT, which is the
  // whole point of the test — then assert the header offers Upgrade
  await expect(page.getByRole('button', { name: /upgrade/i })).toBeVisible()
})
```

Read `e2e/billing.spec.ts` and `e2e/teams.spec.ts` for the existing sign-in and team-creation helpers, and use them.

- [ ] **Step 2: Run and watch it fail**

```bash
cd /home/cdub/projects/wordle-teams/v2 && pnpm e2e billing.spec.ts
```

- [ ] **Step 3: Add the entry point**

Reuse `startUpgrade`'s logic from `app.tsx` rather than writing a second copy — it already handles the three-way `checkoutOutcome` correctly, and `wordle-teams-9fm` is the bug from when that logic treated every cause alike. Lift it into `src/lib/` if two call sites need it, and keep the outcome branching in `billing-copy.ts` where a test can see it.

- [ ] **Step 4: Run e2e, all four gates, commit**

```bash
cd /home/cdub/projects/wordle-teams/v2 && pnpm e2e
cd /home/cdub/projects/wordle-teams/v2 && pnpm lint
cd /home/cdub/projects/wordle-teams/v2 && pnpm typecheck
cd /home/cdub/projects/wordle-teams/v2 && pnpm test:once
cd /home/cdub/projects/wordle-teams/v2 && pnpm build
cd /home/cdub/projects/wordle-teams && git add -A v2/ && git commit -F - <<'MSG'
feat(billing): an always-reachable upgrade entry point in the header

v2's only route to createProCheckout was team-picker's item, rendered
only when a free player was ALREADY at the two-team cap. So a free
player with one team could not pay, and the owner — comped pro — could
not reach checkout as themselves, which is why Phase 5's sandbox pass
has never been runnable.

One entry point, not v1's three: that is what wordle-teams-6tp requires
and what unblocks the sandbox pass. Three is a funnel experiment and
this is a parity phase.

The header already computed isPro === false for the invite badge, with a
comment on why it is not !isPro. This follows it.

MSG
bd close wordle-teams-6tp
```

---

# Stage B — the audit

Stage A is finished when every task above is closed and `pnpm e2e` is green. Do not start Stage B before that: the walk exists to measure the surface, and measuring a half-built one produces a checklist that has to be thrown away.

---

## Task 13: `scripts/parity-routes.mjs`

**Files:**
- Create: `v2/scripts/parity-routes.mjs`
- Create: `v2/scripts/lib/parity-routes-report.mjs`
- Create: `v2/scripts/lib/parity-routes-report.test.mjs`

### Why the split

`vitest.config.ts`'s comment records the house rule: most scripts do their work at module scope against production and are untestable, so **what is worth asserting is lifted into `scripts/lib/*.mjs`**. Follow it. The fetching stays in `parity-routes.mjs`; the table-building and the difference-classifying go in `lib/`, where a test can reach them.

### What it compares

For each route, against both origins: HTTP status, `Cache-Control`, `Content-Type`, `<title>`, canonical link, OpenGraph tags, and whether the route exists at all.

Routes to cover — the union of both apps' public surface, so a route missing on one side shows up as a difference rather than being silently skipped:

```
/  /home  /about  /privacy  /terms  /login  /login-error  /maintenance
/me  /app  /complete-profile  /robots.txt  /sitemap.xml  /opengraph-image.png
```

`/branding` goes in the list too, and is **expected** to be absent on beta — that is divergence-worthy output, not an error.

- [ ] **Step 1: Write the report tests first**

Create `v2/scripts/lib/parity-routes-report.test.mjs`:

```js
import { describe, expect, test } from 'vitest'
import { classify, formatTable } from './parity-routes-report.mjs'

describe('classify', () => {
  test('identical responses are a match', () => {
    const row = classify({
      path: '/about',
      prod: { status: 200, cacheControl: 'public, s-maxage=86400', title: 'About - Wordle Teams' },
      beta: { status: 200, cacheControl: 'public, s-maxage=86400', title: 'About - Wordle Teams' },
    })
    expect(row.verdict).toBe('match')
  })

  test('a route present on prod and absent on beta is a gap', () => {
    const row = classify({
      path: '/terms',
      prod: { status: 200, title: 'Terms - Wordle Teams' },
      beta: { status: 404 },
    })
    expect(row.verdict).toBe('missing-on-beta')
  })

  // The jcj case, and the reason amendment A4 exists. A page that renders
  // identically but caches differently is a DIFFERENCE, and it is exactly the
  // one a screenshot comparison cannot see.
  test('same body, different cache header, is still a difference', () => {
    const row = classify({
      path: '/privacy',
      prod: { status: 200, cacheControl: 'public, max-age=0, must-revalidate', title: 'Privacy' },
      beta: { status: 200, cacheControl: 'public, s-maxage=86400', title: 'Privacy' },
    })
    expect(row.verdict).toBe('differs')
    expect(row.fields).toContain('cacheControl')
  })

  // A known divergence must be reportable as expected, or the report cries
  // wolf on eighteen rows and stops being read.
  test('a route marked expected-absent is not a gap', () => {
    const row = classify({
      path: '/branding',
      expectAbsentOnBeta: true,
      prod: { status: 200 },
      beta: { status: 404 },
    })
    expect(row.verdict).toBe('expected')
  })
})
```

- [ ] **Step 2: Run, watch fail, implement `lib/parity-routes-report.mjs`, run again**

```bash
pnpm vitest run scripts/lib/parity-routes-report.test.mjs
```

- [ ] **Step 3: Write the fetcher**

`parity-routes.mjs` takes two origins (defaulting to `https://wordleteams.com` and `https://beta.wordleteams.com`), requests each path against both, and prints the markdown table.

Two things to get right:

- **Do not follow redirects silently.** `/me` returning a 301 to `/app` is the *interesting* answer. Use `redirect: 'manual'` and report the status and `Location`.
- **Send no cookies.** The whole point is the anonymous rendering — that is what a crawler and a first-time visitor get, and it is the case the cache policy makes cacheable.

- [ ] **Step 4: Run it against both origins and read the output**

```bash
cd /home/cdub/projects/wordle-teams/v2 && node scripts/parity-routes.mjs
```

Save the output. It is the mechanical half of Task 17's checklist.

- [ ] **Step 5: All four gates, commit**

```bash
cd /home/cdub/projects/wordle-teams/v2 && pnpm lint
cd /home/cdub/projects/wordle-teams/v2 && pnpm typecheck
cd /home/cdub/projects/wordle-teams/v2 && pnpm test:once
cd /home/cdub/projects/wordle-teams/v2 && pnpm build
cd /home/cdub/projects/wordle-teams && git add -A v2/ && git commit -F - <<'MSG'
feat(scripts): parity-routes compares both origins route by route

Status, Cache-Control, Content-Type, title, canonical and OG tags, with
redirects reported rather than followed and no cookies sent - the
anonymous rendering is what a crawler and a first-time visitor get, and
it is the case the cache policy makes cacheable.

Verdict logic lives in scripts/lib/ per the rule recorded in
vitest.config.ts's comment, so a test can reach it; the fetching cannot.

MSG
```

---

## Task 14: Env and secret hygiene

**Issues:** `wordle-teams-cd8`, `-7az`, `-3bl`, `-5il`

### The measurement rule for this whole task

`convex env --prod` and `convex run --prod` **silently fall back to the local backend** at `127.0.0.1:3210`. A bare `convex env list --prod` on 2026-08-31 returned the *local* backend's variables, including `SITE_URL=http://localhost:3000`. And `convex env get` **exits 0 whether or not the variable exists**.

So: **before believing any output about beta, check for a value only beta has**, and match on the "not found" text rather than the exit code. Any step in this task whose evidence is a bare command's exit status is not evidence.

- [ ] **Step 1: Establish a beta sentinel**

Pick a variable whose value on beta is known and cannot be the local backend's — the beta deployment name `fabulous-goldfish-949` appears in `VITE_CONVEX_SITE_URL`, and `SITE_URL` on beta is `https://beta.wordleteams.com`, not `http://localhost:3000`. Read it first, in every shell where you are about to trust `convex env`:

```bash
cd /home/cdub/projects/wordle-teams/v2 && npx convex env get SITE_URL --prod
```

Expected: `https://beta.wordleteams.com`. **If it says `http://localhost:3000`, you are talking to the local backend and every other reading in this task is worthless.** Load the prod `CONVEX_DEPLOY_KEY` and try again.

- [ ] **Step 2: `wordle-teams-cd8` — SITE_URL and E2E_TEST_MODE on beta**

With the sentinel confirmed, read both. `E2E_TEST_MODE` must be **unset** — match the "not found" text, not the exit code.

- [ ] **Step 3: `wordle-teams-7az` — the same, framed for cutover**

Beta *becomes* production. Record in the runbook (Task 20) that `E2E_TEST_MODE` must be unset on it at cutover, and why: `sendEmail`'s throwaway-address filter is gated on it, and beta holds copied production rows — real people who have never heard of this beta.

- [ ] **Step 4: `wordle-teams-3bl` — five POLAR_* vars, not four**

Read the issue for the list, and cross-check against the actual call sites: `wordle-teams-02c`'s notes enumerate four scopes, one per SDK call in `convex/polar.ts` — `checkouts:write` (`:425`), `customer_sessions:write` (`:657`), `checkouts:read` (`:739`), `customers:write` (`:798`). Scopes and env vars are different things; verify both.

- [ ] **Step 5: `wordle-teams-5il` — secrets in the build output**

```bash
cd /home/cdub/projects/wordle-teams/v2 && pnpm build
grep -rl "dev.vars" dist/ 2>/dev/null
ls -la dist/server/ | grep -i "dev.vars"
```

If `.dev.vars` is in `dist/server` with real values, fix the build so it is not. **Then check whether it was ever deployed** — `wrangler deploy` uploads `dist`, so a secret that reached a deployment must be rotated, not just excluded going forward. Say which case it is in the commit.

- [ ] **Step 6: Commit, close all four**

---

## Task 15: A fresh copy run and `verify-parity.mjs`

**Issues:** part of `wt-ksh.8`; verifies `wt-ksh.7.32`

- [ ] **Step 1: Read what a re-run overwrites before running one**

`wt-ksh`'s *Data Model & Migration* section. The short version: a row **born in v2 is safe** — no `legacyId`, and `byLegacyId` is the whole upsert key for `players` and `teams`. What a re-run reverts is a **copied** row v2 has since edited. `monthlyWinners` is the exception: it matches on `(teamId, year, month)`, so a winner row v2 computed itself *is* matched and overwritten.

- [ ] **Step 2: Run the copy**

- [ ] **Step 3: Read the overwrite report at FIELD level**

`upsertPlayers`, `upsertTeams` and `upsertMonthlyWinners` return per-field counts of the rows they patched to a different value. A framed block prints when non-zero. **Per-field, not per-row** — "12 players patched" tells you nothing; "12 players patched `timeZone`" tells you what happened.

- [ ] **Step 4: Check resurrection by hand**

No diff-based report can see a row v2 deleted and the copy brought back (`wt-ksh.13.10`). Pick the teams and players v2 has deleted since the last copy and check each one by hand.

- [ ] **Step 5: Verify `wt-ksh.7.32` — no beta player left with reminders on**

The copy carries five reminder fields (`scripts/copy-from-supabase.mjs:151-155`), of which `reminderDeliveryMethods` and `timeZone` are the two that together decide eligibility. After the run, measure beta: **no player may hold a non-empty `reminderDeliveryMethods`.**

If any do, that is the issue's acceptance criterion failing, and the fix belongs here — a documented omission with both halves written down (what is removed, and the runbook line that restores it), not a silent line deletion.

- [ ] **Step 6: Run the verifier**

```bash
cd /home/cdub/projects/wordle-teams/v2 && node scripts/verify-parity.mjs --scope=all
```

**Counts come from `countTable`, which loops across transactions and is therefore not a consistent snapshot** — rows can change between pages. `verify-parity.mjs` says so at the call site. If a count is off by one or two, **re-run before believing it.**

- [ ] **Step 7: Record the results and close `wt-ksh.7.32`**

---

## Task 16: The §7a accuracy pass

**Files:**
- Modify: `docs/design-system/V2-ADDENDUM.md`
- Issues: `wordle-teams-c68`, and a new one for `inviteEmails.ts:70`

§7a is the audit's baseline. If it is stale, the walk measures against the wrong thing and every finding is suspect.

- [ ] **Step 1: `wordle-teams-c68` — the delete-site inventories**

They say 14; it is now 21. They are asserted in **four places** — read the issue for the list, and `wordle-teams-r9d`'s notes name them: `convex/migrate.ts`, `scripts/lib/copy-tallies.mjs`, the `wt-ksh` epic description, and `wt-ksh.9`'s notes. Fix all four. A count corrected in three places is a new stale-figure bead.

- [ ] **Step 2: Add divergence #19 — the dashboard is `/app`**

Evidence-cited, in the register of the existing eighteen: the owner's decision, `src/app/manifest.json`'s `start_url: /me`, why the redirect is permanent, and the consumers that moved.

- [ ] **Step 3: Add divergence #20 — the copy omits reminder settings until cutover**

Per `wt-ksh.7.32`. Beta is expected to differ from production on `reminderDeliveryMethods` and `timeZone`. Name the runbook line that restores it.

- [ ] **Step 4: Record `/branding` as a recorded drop**

62 lines of press-kit images, disallowed in v1's own `robots.ts`. Owner's decision, 2026-08-31.

- [ ] **Step 5: Fix the header count**

It reads **"Eighteen known differences from production, all deliberate."** It becomes twenty. `wt-ksh.13.11` is the bead from the last time this figure went stale — it is load-bearing, because the sentence after it says *"Anything else the audit finds is a bug."*

- [ ] **Step 6: Re-verify the existing eighteen**

Every row asserts something about v1 or v2 at a file and line. Stage A moved code. Spot-check every row that names a path Stage A touched — at minimum rows 2, 3, 16, 17 and 18 — and correct anything that has drifted.

- [ ] **Step 7: File the `inviteEmails` finding, do not fix it**

`v2/convex/inviteEmails.ts:70` hardcodes `https://wordleteams.com` in the plain-text footer regardless of deployment, so a beta invite signs itself with the production origin. Real, pre-existing, and too small to displace anything in this phase.

```bash
bd create --title="Invite email's text footer hardcodes the production origin" --type=bug --priority=3 --description="convex/inviteEmails.ts:70 puts a literal https://wordleteams.com in the plain-text signature block regardless of deployment, so a beta invite signs itself with the production origin. The HTML half and the signInUrl both come from SITE_URL correctly; only the text footer is hardcoded. Found during Phase 7 planning."
```

- [ ] **Step 8: Commit, close `wordle-teams-c68`**

---

## Task 17: The written checklist walk

**Files:**
- Create: `docs/superpowers/handoffs/2026-XX-XX-phase7-parity-checklist.md` (or alongside the runbook)

This is `wt-ksh.8`'s acceptance criterion: **a written checklist of every prod screen has a ✔ against beta.**

- [ ] **Step 1: Paste in Task 13's table as the mechanical half**

Status, cache headers, content type, titles, canonical, OG. That half is done and re-runnable.

- [ ] **Step 2: Walk the interactive surface by hand**

The half a script cannot do. With the owner:

- Sign in — OTP and each social provider.
- The dashboard: team picker, month picker, scores table, board entry, scoring system, TeamBoards, the celebration dialog.
- Teams: create, rename, invite, cancel an invite, remove a member, leave, delete.
- Billing: the upgrade entry point and the portal.
- Settings: every control, including notifications.
- Error states: `/login-error`, a `NOT_A_MEMBER` screen, the dashboard error boundary.
- Maintenance mode, on and off.
- The PWA: install from beta, launch it, confirm it opens on `/app` — **and separately confirm an install carrying the old `/me` start_url still lands correctly**, which is the one thing that cannot be checked after cutover.

- [ ] **Step 3: Every difference goes to one of two places**

Into §7a as a divergence, or into Beads as a bug. **Nothing stays in the walk document as a note** — a checklist with unresolved observations in it is how a known problem becomes an unknown one.

- [ ] **Step 4: Commit the checklist**

---

# Stage C — close out

---

## Task 18: The Polar sandbox pass (`wordle-teams-02c`)

Now runnable, because Task 12 built a reachable upgrade path.

- [ ] **Step 1: Read `wordle-teams-02c`'s notes for what is already verified**

Already confirmed against real Polar sandbox: the webhook endpoint is live at `https://fabulous-goldfish-949.convex.site/polar/webhook` (**`.convex.site`, not `.convex.cloud`** — that is the URL registered in Polar), no webhook-id → 400, bogus signature → 403. And `getCustomerPortalUrl` works end to end.

- [ ] **Step 2: Create a fresh non-pro test account on beta**

**Not an `e2e+` address** — those are gated on `E2E_TEST_MODE`, which is not set on beta. Create **one** team, so the account sits *below* the free cap: that is the case `wordle-teams-6tp` was about and the one Task 12 fixed.

- [ ] **Step 3: Run the pass**

Subscribe, upgrade, downgrade, cancel. Confirm team limits move correctly each time, and specifically that **`subscription.canceled` does NOT remove teams while `subscription.revoked` does.**

- [ ] **Step 4: Try the two cases that need setup, and record honestly if they stay unreachable**

From `02c`'s notes:

- **The silent-202 case** — needs a Polar sandbox customer to exist under that email *before* checkout. Create one in the Polar dashboard first, then check out with the same address.
- **The v1-uuid identity case** — a fresh v2 account has no `legacyId`, so it cannot reproduce what happens to a *migrated* subscriber on revocation, which is the case that hits every paying customer at cutover. It is pinned by unit tests and by the portal's dual-namespace lookup. If the sandbox cannot reach it, **say so in the runbook** rather than letting a green sandbox pass imply it was covered.

- [ ] **Step 5: Close `wt-ksh.6`'s six acceptance criteria against evidence, then close `02c` and `wt-ksh.6`**

---

## Task 19: P3 correctness polish

Each of these is independent. Do them one at a time, commit each, close each.

- [ ] **`wordle-teams-p37` — two paths throw a plain `Error` where a caller sees it**

`convex/teams.ts:686` in `invitePlayer`, and `convex/polar.ts:270` via `getCustomerPortalUrl`, whose `siteUrl()` call at `:653` sits outside every `try`.

The real rule this codebase follows: **anything a caller sees must be a `ConvexError` via `accessError`.** Plain messages are redacted in production while `convex-test` never redacts, so **no test can catch this** — it is a review-only check. Operator-facing failures with no user-facing caller correctly use a plain `Error` so they fail loudly in the logs.

Both require an operator to strip `SITE_URL` from a live deployment, so the blast radius is small. **Fix, or document the exception deliberately** — Phase 7 decides, and either outcome closes the issue.

- [ ] **`wordle-teams-069` — delivery-method writes lose updates across a slow browser prompt**

Read-modify-write. Pre-existing, not introduced by Phase 6. Task 11 is doing the same thing correctly for `hasSeenCelebration` — do the append inside the mutation, and reuse that shape.

- [ ] **`wordle-teams-uhx` — `useLocalCapture` refs outlive the account once sign-out exists**

- [ ] **`wordle-teams-dpi` — the dashboard SSR loader awaits three independent Convex queries in sequence**

`app.tsx`'s loader has three sequential `await ensureQueryData` calls. They are independent. `Promise.all` them. Note `__root.tsx`'s comment explaining why the Header's two queries are deliberately *not* prefetched — that reasoning is about `useQuery` vs `useSuspenseQuery` and does not apply here; these three feed `useSuspenseQuery`.

---

## Task 20: The cutover runbook

**Files:**
- Create: `docs/runbooks/2026-cutover.md`

This is the phase's deliverable, and Phase 8 (`wt-ksh.9`) executes from it. Write it as a checklist someone can follow at 6am without reading anything else.

Required lines, gathered across Phases 5, 6 and 7:

- [ ] **Convex environment**
  - `REMINDERS_ENABLED=true` on the **production** deployment.
  - `REMINDERS_ALLOWLIST` left unset/empty — unrestricted is the production setting. (On beta the opposite is true and must stay true: the allowlist goes in *first*, in the same sitting, because beta holds copied production rows and `E2E_TEST_MODE` is not set there, so `sendEmail`'s throwaway filter suppresses nothing.)
  - `E2E_TEST_MODE` **unset** (`wordle-teams-7az`).
  - `SITE_URL` set to the production origin (`wordle-teams-cd8`).
  - All five `POLAR_*` vars, with all four token scopes (`wordle-teams-3bl`).
  - **Every one of these verified against a value only that deployment has** — `convex env --prod` silently reads the local backend, and `convex env get` exits 0 either way.

- [ ] **The copy**
  - Restore whatever `wt-ksh.7.32` removed, so real reminder preferences arrive with the cutover copy. Check that issue for what was actually taken out — an earlier note claimed the copy carried neither `reminder_delivery_methods` nor `time_zone`, which was wrong; it carries both, plus three more.
  - Read the overwrite report at **field** level.
  - Check resurrection **by hand** — no diff-based report can see a row v2 deleted (`wt-ksh.13.10`).
  - The final run **discards beta team and player state on purpose.** Owner's decision, 2026-08-24. It reads like data loss and is not.

- [ ] **Routing and the PWA**
  - Confirm `/me` redirects to `/app` **against a real installed PWA carrying the old start_url**, before the flip. This cannot be tested afterwards.
  - `wrangler.jsonc` routes and the custom domain. Note the wildcard `*.wordleteams.com` A record points at Vercel — an explicit record outranks it, but if a hostname ever serves Vercel again, suspect that wildcard first.
  - `MAINTENANCE` set to `false` (or unset).

- [ ] **Vendors**
  - OAuth production callback URLs registered for every provider. `wordle-teams-bnv`: Microsoft users span 12 tenants, each with its own consent policy.
  - Polar's webhook URL is `.convex.site`, **not** `.convex.cloud`.
  - The one paying customer is migrated personally.

- [ ] **After the flip**
  - Re-run `scripts/parity-routes.mjs` against the new production origin.
  - Watch the deploy's *effect*, not just its green — for a Convex change, the "Deploy Convex and build the client" step. And `gh run list --limit 1` right after a push returns the **previous** run; select by SHA.

- [ ] **Commit the runbook, close `wt-ksh.8`**

---

## Notes for whoever executes this

- **Stage A before Stage B, without exception.** Every task in A is independent of the others *except* Task 1, which every later route task builds on. Do Task 0 and Task 1 in order; A2–A11 can be reordered freely.

- **Do not push.** Committing is yours; pushing is the controller's. Standing authorization covers `feat/v2-replatform` → beta, never prod and never main.

- **Do not flip `REMINDERS_ENABLED` on any deployment without asking.** It is the only thing between a config slip and mailing every copied production row.

- **`REMINDERS_ENABLED` is currently OFF on beta and must stay that way.** Beta is in its designed resting state: the cron fires hourly and returns having done nothing.

- **Do not treat a 2xx from `webpush.sendNotification` as proof of delivery** — in a comment, a test, or an acceptance check. A push service returns **201 without decrypting**.

- **A timezone test can pass in CI while proving nothing.** `Intl.DateTimeFormat` with `timeZone: undefined` falls back to the **host** zone. Run timezone mutants both ways: on the dev box and under `TZ=UTC`, which is what CI runs.

- **Beta's ICU data is not independently established.** Spike S1 answered "yes, `Intl` supports named timezones" on the **local** backend, not beta, because `convex run --prod` silently fell back. If a timezone ever resolves oddly, re-check on beta specifically.

- **Every reviewer gets told to mutation-test**, and gets told the recurring finding: *an extraction can move the untested part rather than shrink it.* In this phase that means: a green `cache-policy.test.ts` and a green `maintenance.test.ts` prove nothing about `server.ts`. The e2e assertions are what close those tasks.
