# v2 Phase 6 — Reminders & PWA Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Beta sends a real push notification and a real email reminder at each player's configured local time, and Wordle Teams installs to a phone home screen.

**Architecture:** An hourly Convex cron calls one internal mutation that decides eligibility against a consistent snapshot, claims each player by stamping `lastBoardEntryReminder`, enqueues email through the existing Resend component, and schedules a `'use node'` action per player for web push. The PWA is `vite-plugin-pwa` in `injectManifest` mode over a hand-written service worker that precaches static assets, never caches a document, serves a static offline page, handles push, and purges v1's Serwist caches on activate. A Header dropdown and settings dialog give players the controls all of that reads.

**Tech Stack:** Convex 1.42 (crons, scheduler, `'use node'` actions), `@convex-dev/resend`, `web-push` 3.6.7, `vite-plugin-pwa` 1.3.0 / Workbox 7, TanStack Start on Cloudflare Workers, React 19, Radix + Tailwind 4, vitest + `convex-test`, Playwright.

**Spec:** `docs/superpowers/specs/2026-08-27-v2-phase6-reminders-pwa-design.md`

---

## Before you start

**Read these five rules. Four of them cost Phase 5 real time.**

1. **Run everything from inside `v2/` except git, and give EVERY command its own `cd v2`.** The
   shell working directory resets between tool calls. The repo root is v1's Next.js package, where
   `typecheck` and `test:once` do not exist and a build dirties `public/sw.js`.
2. **NEVER pipe a gate.** This shell is zsh, where `PIPESTATUS` expands to **empty**. A piped gate
   check produced four false greens in Phase 5. Always redirect to a file and read `$?` on its own:
   ```bash
   cd v2 && pnpm test:once > /tmp/gate.txt 2>&1; echo "EXIT=$?"
   ```
3. **DO NOT USE `--no-verify`.** `core.hooksPath` is `.beads/hooks`; the hook exports
   `.beads/issues.jsonl` and chains to a PII guard, because **this repository is public**. Never
   put a real user email in a beads issue or a commit message.
4. **Hand-written Convex modules import with an explicit `.ts`. Generated modules
   (`./_generated/*`) take NO extension.** `convex/authEmails`, `convex/lib/puzzleDay` and
   `convex/lib/board` are imported without it in three places; they are stragglers, not the rule.
   Follow the rule.
5. **Every access rule goes in a `...For` helper in `convex/access.ts`, never in a query or
   mutation wrapper body.** `convex-test` cannot stand up a Better Auth session
   (`wordle-teams-obw`), so a rule in a wrapper is a rule no test can reach.

**Throw `ConvexError` via `accessError`, never a plain `Error`.** Plain messages are redacted in
production, so an operator loses the diagnostic exactly when they need it. `convex-test` never
redacts, so no test can catch this for you — it is a review-only check.

**A `convex dev` watcher has been running against the local backend since 2026-08-18.** It is what
pushes Convex changes to the backend Playwright drives. Without it a Convex-side change is invisible
to e2e entirely. Know that before killing it. If e2e behaves impossibly, check the backend accepts a
push before debugging code (`wordle-teams-lvv`).

**e2e is NOT one of the four gates.** `pnpm lint`, `pnpm typecheck`, `pnpm test:once` and
`pnpm build` never run Playwright. A spec stayed red for three tasks on that assumption.

### Snippet provenance

Phase 5's plan carried fourteen code snippets and every one that was checked turned out to be
wrong. So each snippet below is labelled:

- **VERIFIED** — executed, with the output recorded here.
- **UNVERIFIED** — written from the docs and not run. Treat it as a sketch of intent, expect to
  correct it, and correct the plan too.

---

## File Structure

**Created**

| Path | Responsibility |
|---|---|
| `v2/convex/lib/reminders.ts` | Pure eligibility arithmetic. No Convex, no I/O, no env. |
| `v2/convex/lib/reminders.test.ts` | Its tests. |
| `v2/convex/lib/html.ts` | `escapeHtml`, moved out of `inviteEmails.ts`. |
| `v2/convex/crons.ts` | One hourly entry. |
| `v2/convex/reminders.ts` | `sweep`, the internal mutation. |
| `v2/convex/reminders.test.ts` | `convex-test` coverage of `sweep`. |
| `v2/convex/reminderEmails.ts` | Subject, HTML and text bodies. |
| `v2/convex/reminderEmails.test.ts` | Template tests. |
| `v2/convex/push.ts` | Subscription CRUD + `publicKey`. Default runtime. |
| `v2/convex/push.test.ts` | Subscription tests. |
| `v2/convex/pushSend.ts` | **`'use node'`.** `web-push` delivery. Actions only. |
| `v2/convex/settings.ts` | `mySettings` + four self-service mutations. |
| `v2/convex/settings.test.ts` | Their tests. |
| `v2/src/sw.ts` | The service worker. |
| `v2/src/lib/push-subscribe.ts` | Permission, `pushManager`, key encoding. |
| `v2/src/lib/push-subscribe.test.ts` | Encoding tests. |
| `v2/src/lib/register-sw.ts` | The single registration. |
| `v2/src/lib/time-zones.ts` | Grouped option list + `timeZoneMapping`. |
| `v2/src/components/user-menu.tsx` | Header dropdown. |
| `v2/src/components/settings/settings-dialog.tsx` | Tabs shell. |
| `v2/src/components/settings/notifications-tab.tsx` | Timezone, time, two switches. |
| `v2/src/components/settings/install-tab.tsx` | Add-to-Home-Screen guide. |
| `v2/src/lib/use-local-capture.ts` | Silent `timeZone` / `hasPwa` capture. |
| `v2/public/offline.html` | The offline fallback. Static, not a route. |
| `v2/public/wordle-teams-title.png` | Re-hosted from Supabase Storage. |
| `v2/e2e/settings.spec.ts` | Settings e2e. |

**Modified**

| Path | Change |
|---|---|
| `v2/convex/schema.ts` | Add `pushSubscriptions`. |
| `v2/convex/e2ePrune.ts` | Delete subscriptions with their player. |
| `v2/convex/inviteEmails.ts` | Import `escapeHtml` instead of defining it. |
| `v2/convex/access.ts` | Three new `AccessCode` literals. |
| `v2/src/lib/convex-error.ts` | Their copy — `typedCodeMessage` is exhaustiveness-checked, so typecheck fails without it. |
| `v2/convex/convex.config.ts` | Nothing — no new component. Listed so nobody adds one. |
| `v2/src/components/Header.tsx` | Mount the user menu. |
| `v2/src/routes/__root.tsx` | Link the manifest, add `theme-color`, register the SW. |
| `v2/vite.config.ts` | Add `VitePWA`. |
| `docs/design-system/V2-ADDENDUM.md` | Divergences 14-18 into §7a. |

---

## Task 0: Bring the branch up to date with `origin/main`

`feat/v2-replatform` is 31 commits behind `origin/main` and 372 ahead. The gap is entirely v1 work.
Nothing in this phase depends on it; it is first because the gap only widens and the reconciliation
is owed at cutover regardless.

**Files:** merge only. No source edits.

- [ ] **Step 1: Confirm the starting position**

```bash
cd /home/cdub/projects/wordle-teams && git fetch origin && git rev-list --left-right --count origin/main...HEAD
```

Expected: two numbers, tab separated. Left is commits on `main` only, right is commits on this
branch only. At the time of writing: `31	372`. If left is already `0`, this task is done — skip to
Step 5.

- [ ] **Step 2: Confirm the working tree is clean**

```bash
cd /home/cdub/projects/wordle-teams && git status --porcelain
```

Expected: no output. If anything is listed, stop and resolve it before merging.

- [ ] **Step 3: Merge**

```bash
cd /home/cdub/projects/wordle-teams && git merge origin/main
```

**`.beads/issues.jsonl` WILL conflict.** The pre-commit hook re-exports the entire tracker on every
commit, so both sides have rewritten that file continuously. Do not hand-merge it — take one side
wholesale, then let the hook regenerate it on the merge commit:

```bash
cd /home/cdub/projects/wordle-teams && git checkout --ours .beads/issues.jsonl && git add .beads/issues.jsonl
```

Resolve any other conflict normally. Almost everything else in the gap is v1 files this branch has
not touched.

- [ ] **Step 4: Run all four gates, each separately, none piped**

```bash
cd /home/cdub/projects/wordle-teams/v2 && pnpm lint > /tmp/g-lint.txt 2>&1; echo "LINT=$?"
cd /home/cdub/projects/wordle-teams/v2 && pnpm typecheck > /tmp/g-tsc.txt 2>&1; echo "TSC=$?"
cd /home/cdub/projects/wordle-teams/v2 && pnpm test:once > /tmp/g-test.txt 2>&1; echo "TEST=$?"
cd /home/cdub/projects/wordle-teams/v2 && pnpm build > /tmp/g-build.txt 2>&1; echo "BUILD=$?"
```

Expected: `LINT=0 TSC=0 TEST=0 BUILD=0`. Test count should be 627 or more. If any is non-zero, read
the corresponding file — do not re-run through a pipe to "see it better".

- [ ] **Step 5: Verify the CI pins actually arrived**

```bash
cd /home/cdub/projects/wordle-teams && grep -n "version:" .github/workflows/ci.yaml .github/workflows/dev.yaml .github/workflows/prod.yaml
```

Expected: `2.114.0` three times. Not `latest`.

- [ ] **Step 6: Commit and push**

```bash
cd /home/cdub/projects/wordle-teams && git commit --no-edit && git push origin feat/v2-replatform
```

The merge commit may already exist if there were no conflicts; `git commit --no-edit` is a no-op
then and `git push` is what matters. Watch the deploy:

```bash
cd /home/cdub/projects/wordle-teams && gh run watch
```

- [ ] **Step 7: Close the two stale issues**

```bash
cd /home/cdub/projects/wordle-teams && bd close wordle-teams-465 wordle-teams-5r9 --reason "Already fixed on main by PRs #158/#159 and commit 33b07b9 — all three workflows pin Supabase CLI 2.114.0 and ci.yaml generates types for --schema public only. This branch only appeared unpinned because it was 31 commits behind; picked up by the Phase 6 task 0 merge. Not fixed by Phase 6, only observed to be already fixed."
```

---

## Task 1: SPIKE S1 — does `Intl` support named timezones on Convex's runtime? ✅ DONE

**ANSWERED 2026-08-27, AND THE STEPS BELOW WERE NEVER NEEDED. Read this first.**

`convex run --inline-query` evaluates arbitrary readonly JS **on the Convex runtime**, from the
command line, with no probe file and no deploy:

```bash
cd /home/cdub/projects/wordle-teams/v2 && pnpm exec convex run --inline-query "$(command cat /tmp/s1.js)" > /tmp/s1.out 2>&1; echo "EXIT=$?"
```

The result, matching Node exactly: `kolkata` `19:30:00` (half-hour offset kept), `calcutta` the
same (the Postgres alias resolves identically, which copied rows depend on), `sydney`
`2026-08-28 00:00:00` (rolls over, and midnight is `00` not `24`), `resolved` `UTC`.
**Full ICU is present. Task 3 needed no redesign, and shipped green.**

> ### ⚠️ THIS RAN ON THE LOCAL BACKEND, NOT BETA — AND `--prod` WILL NOT CHANGE THAT
>
> `v2/.env.local` sets `CONVEX_DEPLOYMENT=anonymous:anonymous-v2`. There is no cloud deployment for
> `--prod` to resolve to, so **it silently falls back to `http://127.0.0.1:3210` with no warning**.
> An earlier version of this section claimed the result was "identical on local and beta". It was
> local twice.
>
> `convex run` **cannot** reach beta at all. Pointing `CONVEX_DEPLOY_KEY` at
> `fabulous-goldfish-949` returns `You do not have permission to perform this operation
> (deployment:functions:runTestQuery)`.
>
> **Always print the host before trusting any reading:**
> ```bash
> cd /home/cdub/projects/wordle-teams/v2 && pnpm exec convex run --inline-query 'return { url: process.env.CONVEX_CLOUD_URL }'
> ```
> `127.0.0.1` means local, whatever flag you passed.
>
> This is fine for a **runtime-capability** question like S1 — the local backend runs the same
> binary. It is worthless for any question about beta's **data** or **env**, and mistaking one for
> the other produced a bogus P1 bug on 2026-08-28 (`SITE_URL=http://localhost:3000`, which is simply
> the correct value for a local backend). To read beta, use `ConvexHttpClient` +
> `setAdminAuth(CONVEX_MIGRATION_KEY)` against an **internal** function — which means measuring
> anything new there costs a deploy.

**The technique still helps S2** — see Task 10 — but only for the "what does the default runtime
have" half. The `'use node'` question needs a deployed probe regardless.

The original steps are kept below only as a record of what was planned.

### (superseded) original steps

Every eligibility rule in Task 3 depends on `Intl.DateTimeFormat` accepting an arbitrary IANA zone.
Convex's default runtime is not Node and not a browser. If it ships without full ICU, `localParts`
needs a different implementation and Task 3 changes shape.

Phase 5's lesson: `validateEvent` passed all four gates and could not run on this runtime. Only a
live request found it.

**Files:**
- Create (temporarily): `v2/convex/spikeIntl.ts`

- [ ] **Step 1: Write the probe**

**UNVERIFIED** — the point of the task is to run it.

```typescript
// TEMPORARY. Delete in step 5. Exists to answer one question that no gate can:
// does this runtime have full ICU?
import { query } from './_generated/server'

export const probe = query({
  args: {},
  handler: async () => {
    const at = new Date('2026-08-27T14:00:00Z')
    const fmt = (timeZone: string) =>
      new Intl.DateTimeFormat('en-US', {
        timeZone,
        year: 'numeric',
        month: '2-digit',
        day: '2-digit',
        hour: '2-digit',
        minute: '2-digit',
        second: '2-digit',
        hourCycle: 'h23',
      }).format(at)

    return {
      utc: fmt('UTC'),
      chicago: fmt('America/Chicago'),
      kolkata: fmt('Asia/Kolkata'),
      calcutta: fmt('Asia/Calcutta'),
      sydney: fmt('Australia/Sydney'),
      resolved: Intl.DateTimeFormat().resolvedOptions().timeZone,
    }
  },
})
```

- [ ] **Step 2: Deploy to beta**

```bash
cd /home/cdub/projects/wordle-teams && git add v2/convex/spikeIntl.ts && git commit -m "spike(phase6): probe Intl timezone support on Convex's runtime" && git push origin feat/v2-replatform && gh run watch
```

- [ ] **Step 3: Call it**

The owner must run this — no key in this project can run `npx convex run`. Ask them to open the
Convex dashboard for the beta deployment, go to Functions → `spikeIntl:probe`, and run it with `{}`.

- [ ] **Step 4: Record the answer**

Expected if full ICU is present (these are the values Node produced for the same instant, so they
are what "correct" looks like):

```
utc:      08/27/2026, 14:00:00
chicago:  08/27/2026, 09:00:00
kolkata:  08/27/2026, 19:30:00
calcutta: 08/27/2026, 19:30:00
sydney:   08/28/2026, 00:00:00
```

**The failure signals to watch for**, any of which means Task 3 must be redesigned:

- a `RangeError: Invalid time zone specified`
- every zone returning the same value as `utc` (ICU stubbed to UTC only)
- `sydney` not rolling to the 28th
- `kolkata` showing `19:00:00` rather than `19:30:00` (half-hour offsets dropped)

Paste the real output into `bd update wt-ksh.7 --notes`.

- [ ] **Step 5: Delete the probe and push**

```bash
cd /home/cdub/projects/wordle-teams && git rm v2/convex/spikeIntl.ts && git commit -m "spike(phase6): S1 answered — remove the probe" && git push origin feat/v2-replatform && gh run watch
```

---

## Task 2: SPIKE S3 — does `vite-plugin-pwa` build here, and is `/sw.js` served?

`v2/wrangler.jsonc:101` has the `assets` binding commented out, so `public/` is served by
`@cloudflare/vite-plugin`'s own build-time configuration. How that interacts with a plugin that
emits a root-scope service worker is not documented anywhere in this repo and has not been measured.

A service worker served from the wrong path, with the wrong content type, or with a long cache
lifetime fails in three different ways, all of them quiet.

**Files:**
- Modify: `v2/vite.config.ts`
- Create: `v2/src/sw.ts` (a stub for now — the real one is Task 13)

- [ ] **Step 1: Install the plugin**

```bash
cd /home/cdub/projects/wordle-teams/v2 && pnpm add -D vite-plugin-pwa workbox-build workbox-window
```

`vite-plugin-pwa@1.3.0` declares `workbox-build` and `workbox-window` as peers, so install them
explicitly rather than relying on hoisting.

- [ ] **Step 2: Write a stub service worker**

**UNVERIFIED.**

```typescript
// Stub for spike S3. Task 13 replaces this entirely.
import { precacheAndRoute } from 'workbox-precaching'

declare const self: ServiceWorkerGlobalScope

precacheAndRoute(self.__WB_MANIFEST)
```

- [ ] **Step 3: Add the plugin**

**UNVERIFIED.** Modify `v2/vite.config.ts`. Plugin order matters — put `VitePWA` last so it sees
the final asset graph.

```typescript
import { VitePWA } from 'vite-plugin-pwa'
// ...existing imports

const config = defineConfig({
  resolve: { tsconfigPaths: true },
  ssr: { noExternal: ['@convex-dev/better-auth'] },
  plugins: [
    devtools(),
    cloudflare({ viteEnvironment: { name: 'ssr' } }),
    tailwindcss(),
    tanstackStart(),
    viteReact(),
    VitePWA({
      strategies: 'injectManifest',
      srcDir: 'src',
      filename: 'sw.ts',
      // The manifest at public/manifest.json is already correct Wordle Teams
      // identity (commit bc8e061). Generating a second one would be two sources
      // of truth for the same document.
      manifest: false,
      // Registration is ours and singular. v1 shipped duplicate registrations
      // because serwist injected one alongside the app's own; see e70592d and
      // amendment A3. This flag is what makes "exactly once" structural.
      injectRegister: false,
      injectManifest: {
        globPatterns: ['**/*.{js,css,html,ico,png,svg,webmanifest}'],
      },
    }),
  ],
})
```

- [ ] **Step 4: Build, and read the exit code without a pipe**

```bash
cd /home/cdub/projects/wordle-teams/v2 && pnpm build > /tmp/s3-build.txt 2>&1; echo "EXIT=$?"
```

Expected: `EXIT=0`.

If it fails, the likely causes in order: `injectManifest` cannot find `self.__WB_MANIFEST` because
of how TanStack Start transforms `src/`; the Cloudflare plugin's SSR environment tries to bundle
`src/sw.ts` as server code; or two plugins both claim the `generateBundle` hook. Record whichever it
is in `bd`, because the answer determines whether Task 13 is the plan's shape or a different one.

- [ ] **Step 5: Confirm `sw.js` is in the client output at the root**

```bash
cd /home/cdub/projects/wordle-teams/v2 && ls -la dist/client/sw.js && head -c 200 dist/client/sw.js
```

Expected: the file exists directly under `dist/client/`, not in an `assets/` subdirectory. A service
worker can only control the scope it is served from, so a hashed path under `assets/` cannot control
`/` and the whole design fails.

- [ ] **Step 6: Confirm `dist/` carries no secrets**

`wordle-teams-5il` records that `pnpm build` copies `.dev.vars`, with real secret values, into
`dist/server`. Do not add a second copy of that problem:

```bash
cd /home/cdub/projects/wordle-teams/v2 && ls dist/client && grep -rl "CONVEX_DEPLOY_KEY\|POLAR_\|VAPID_PRIVATE" dist/client || echo "clean"
```

Expected: `clean`.

- [ ] **Step 7: Deploy and fetch it over the wire**

```bash
cd /home/cdub/projects/wordle-teams && git add v2/vite.config.ts v2/src/sw.ts v2/package.json v2/pnpm-lock.yaml && git commit -m "spike(phase6): probe vite-plugin-pwa against the Cloudflare build" && git push origin feat/v2-replatform && gh run watch
```

Then:

```bash
curl -sSI https://beta.wordleteams.com/sw.js
```

Expected: `HTTP/2 200`, and a `content-type` of `application/javascript` or `text/javascript`. Note
the `cache-control` value — a long `max-age` on a service worker delays every future update and
would need a header rule. Record it either way.

- [ ] **Step 8: Record the result**

```bash
cd /home/cdub/projects/wordle-teams && bd update wt-ksh.7 --notes "S3 answered: <build outcome>, sw.js at <path>, content-type <value>, cache-control <value>"
```

---

## Task 3: `convex/lib/reminders.ts` — the eligibility arithmetic

Pure functions only. No Convex imports, no clock reads, no env. This is the module every
eligibility rule lives in, and the only one that can be tested exhaustively.

**Files:**
- Create: `v2/convex/lib/reminders.ts`
- Test: `v2/convex/lib/reminders.test.ts`

**Do not start this task until Task 1 has answered S1.**

- [ ] **Step 1: Write the failing tests**

**VERIFIED** — every assertion below was executed against Node 22 and passed 25/25. The
implementation in Step 3 is the one they were run against.

Create `v2/convex/lib/reminders.test.ts`:

```typescript
import { describe, expect, test } from 'vitest'
import {
  alreadyRemindedToday,
  enteredOn,
  hasRecentActivity,
  isDueThisHour,
  localParts,
  needsWeekendOptIn,
} from './reminders.ts'

// A Thursday, 14:00 UTC.
const utc2pm = new Date('2026-08-27T14:00:00Z')

describe('localParts', () => {
  test('UTC is the identity case', () => {
    expect(localParts('UTC', utc2pm)).toEqual({ day: '2026-08-27', time: '14:00:00' })
  })

  test('America/Chicago is UTC-5 in August (CDT)', () => {
    expect(localParts('America/Chicago', utc2pm)).toEqual({
      day: '2026-08-27',
      time: '09:00:00',
    })
  })

  test('keeps a half-hour offset', () => {
    // Kolkata is UTC+5:30. Dropping the :30 would shift every Indian player's
    // window by half an hour, which is exactly enough to miss it.
    expect(localParts('Asia/Kolkata', utc2pm)).toEqual({
      day: '2026-08-27',
      time: '19:30:00',
    })
  })

  test('the Postgres spelling resolves identically to the IANA one', () => {
    // Copied rows carry v1's Postgres names (timeZoneMapping in
    // app-bar-base.tsx:14-21 produced them). Intl accepts both as aliases, which
    // is what lets copied and natively-created rows share one code path.
    expect(localParts('Asia/Calcutta', utc2pm)).toEqual(localParts('Asia/Kolkata', utc2pm))
  })

  test('rolls to the next day east of the dateline-facing zones', () => {
    expect(localParts('Australia/Sydney', utc2pm)).toEqual({
      day: '2026-08-28',
      time: '00:00:00',
    })
  })

  test('uses a 24-hour cycle, so 14:00 is not formatted as 02', () => {
    // MEASURED, after an earlier version of this comment got it backwards:
    //   hourCycle:'h23'  -> 00   hour12:false -> 00   (identical)
    //   hourCycle:'h24'  -> 24
    //   option omitted   -> 12, plus a dayPeriod part
    // So `hour12: false` is NOT the hazard the old comment claimed. OMITTING
    // the option is: en-US then defaults to h12 and 14:00 formats as '02',
    // which compares against reminder times as a morning.
    expect(localParts('UTC', utc2pm).time).toBe('14:00:00')
    expect(localParts('Australia/Sydney', utc2pm).time).toBe('00:00:00')
  })

  test('holds a large western offset, and rolls the day back across it', () => {
    // Honolulu is UTC-10 with no DST. The first case pins the offset; the
    // second is the one that matters — at 04:00Z it is still the PREVIOUS day
    // there, which is the westward mirror of the Sydney case. An earlier draft
    // asserted only the first, and its name claimed a rollback it never
    // exercised. Getting this wrong misfiles the reminder day for every
    // US-Pacific and Hawaii player.
    expect(localParts('Pacific/Honolulu', utc2pm)).toEqual({
      day: '2026-08-27',
      time: '04:00:00',
    })
    expect(localParts('Pacific/Honolulu', new Date('2026-08-27T04:00:00Z'))).toEqual({
      day: '2026-08-26',
      time: '18:00:00',
    })
  })
})

describe('isDueThisHour', () => {
  test('fires on the hour', () => {
    expect(isDueThisHour('09:00:00', '09:00:00', '08:00:00')).toBe(true)
  })

  test('the lower bound is inclusive', () => {
    expect(isDueThisHour('08:00:00', '09:00:00', '08:00:00')).toBe(true)
  })

  test('a time that has aged out does not fire', () => {
    expect(isDueThisHour('07:00:00', '09:00:00', '08:00:00')).toBe(false)
  })

  test('a time still ahead does not fire', () => {
    expect(isDueThisHour('10:00:00', '09:00:00', '08:00:00')).toBe(false)
  })

  test('a half-hour zone still catches an on-the-hour reminder', () => {
    // The cron ticks at :00 UTC, which is :30 local in Kolkata, so the window is
    // [18:30, 19:30] and a 19:00 reminder lands inside it.
    expect(isDueThisHour('19:00:00', '19:30:00', '18:30:00')).toBe(true)
  })

  test('every one of the eighteen offered times is reachable', () => {
    const offered = Array.from(
      { length: 18 },
      (_, i) => `${String(i + 5).padStart(2, '0')}:00:00`,
    )
    for (const time of offered) {
      const hour = Number(time.slice(0, 2))
      const now = `${String(hour).padStart(2, '0')}:30:00`
      const hourAgo = `${String(hour - 1).padStart(2, '0')}:30:00`
      expect(isDueThisHour(time, now, hourAgo)).toBe(true)
    }
  })

  test("v1's midnight wrap is unsatisfiable, and is ported that way on purpose", () => {
    // At 00:30 local the lower bound wraps to 23:30, so no string can satisfy
    // both bounds. Unreachable behind the 05:00-22:00 picker; see spec Context
    // §2. Pinned so that widening the picker fails here rather than in silence.
    expect(isDueThisHour('00:00:00', '00:30:00', '23:30:00')).toBe(false)
    expect(isDueThisHour('23:45:00', '00:30:00', '23:30:00')).toBe(false)
  })
})

describe('alreadyRemindedToday', () => {
  test('never reminded is not today', () => {
    expect(alreadyRemindedToday(undefined, 'America/Chicago', '2026-08-27')).toBe(false)
  })

  test('earlier today counts', () => {
    const earlier = new Date('2026-08-27T12:00:00Z').getTime() // 07:00 Chicago
    expect(alreadyRemindedToday(earlier, 'America/Chicago', '2026-08-27')).toBe(true)
  })

  test('yesterday does not', () => {
    const yesterday = new Date('2026-08-26T12:00:00Z').getTime()
    expect(alreadyRemindedToday(yesterday, 'America/Chicago', '2026-08-27')).toBe(false)
  })

  test('resolves the stamp locally, not in UTC', () => {
    // 02:00 UTC is still 21:00 the previous day in Chicago. A UTC comparison
    // would call this "today" and suppress a reminder that is genuinely due.
    const lateNight = new Date('2026-08-27T02:00:00Z').getTime()
    expect(alreadyRemindedToday(lateNight, 'America/Chicago', '2026-08-27')).toBe(false)
  })
})

describe('hasRecentActivity', () => {
  test('exactly ten days back is inside the window', () => {
    expect(hasRecentActivity(['2026-08-17'], '2026-08-27')).toBe(true)
  })

  test('eleven days back is outside it', () => {
    expect(hasRecentActivity(['2026-08-16'], '2026-08-27')).toBe(false)
  })

  test('no scores at all is outside it', () => {
    expect(hasRecentActivity([], '2026-08-27')).toBe(false)
  })

  test('the window crosses a month boundary', () => {
    expect(hasRecentActivity(['2026-07-30'], '2026-08-05')).toBe(true)
    expect(hasRecentActivity(['2026-07-25'], '2026-08-05')).toBe(false)
  })
})

describe('enteredOn', () => {
  test('finds the day, or does not', () => {
    expect(enteredOn(['2026-08-26', '2026-08-27'], '2026-08-27')).toBe(true)
    expect(enteredOn(['2026-08-26'], '2026-08-27')).toBe(false)
  })
})

describe('needsWeekendOptIn', () => {
  test('Saturday and Sunday need it; Friday does not', () => {
    expect(needsWeekendOptIn('2026-08-29')).toBe(true) // Saturday
    expect(needsWeekendOptIn('2026-08-30')).toBe(true) // Sunday
    expect(needsWeekendOptIn('2026-08-28')).toBe(false) // Friday
  })

  test('the case v1 gets wrong', () => {
    // Sydney is UTC+10 in August (AEST — no DST in the southern winter), so
    // 2026-08-28T20:00Z is still Friday in UTC and 06:00 Saturday in Sydney.
    // v1 asks EXTRACT(DOW FROM CURRENT_DATE), which reads the UTC day, and so
    // applies the weekday rule to a player whose weekend has already started.
    const at = new Date('2026-08-28T20:00:00Z')
    expect(needsWeekendOptIn(localParts('Australia/Sydney', at).day)).toBe(true)
    expect(needsWeekendOptIn(localParts('UTC', at).day)).toBe(false)
  })
})
```

- [ ] **Step 2: Run them and watch them fail**

```bash
cd /home/cdub/projects/wordle-teams/v2 && pnpm exec vitest run convex/lib/reminders.test.ts > /tmp/t3.txt 2>&1; echo "EXIT=$?"
```

Expected: non-zero, with `Failed to resolve import "./reminders.ts"`.

- [ ] **Step 3: Write the implementation**

**VERIFIED** — this exact logic passed all 25 assertions above.

Create `v2/convex/lib/reminders.ts`:

```typescript
/**
 * Eligibility arithmetic for the daily board-entry reminder.
 *
 * Pure by construction — no Convex, no I/O, no env, no clock. `sweep`
 * (convex/reminders.ts) reads the clock once and passes instants in, which is
 * what makes every rule here directly testable, including the ones that only
 * misbehave in a particular timezone at a particular hour.
 *
 * THE RULES ARE v1's, MINUS TWO BUGS. `get_players_for_reminder`
 * (supabase/migrations/20250416172516_limit_daily_reminders.sql) resolves the
 * weekend check and the ten-day activity window against CURRENT_DATE, which is
 * the SERVER's day. That is the same defect the schema note on
 * dailyScores.puzzleDay documents: 733 of production's 7468 score rows land on
 * a different calendar day in UTC than in America/Chicago, across 57 player
 * timezones. Here every rule resolves in the player's own zone. See
 * divergences 14 and 15.
 *
 * The one v1 bug that is ported UNCHANGED is the midnight window — see
 * isDueThisHour.
 */
import { addDays, isWeekendDay, type PuzzleDay } from './puzzleDay.ts'

/** A wall-clock time of day, 'HH:MM:SS', in some player's zone. */
export type LocalTime = string

/**
 * Resolve an instant into a player's local calendar day and wall-clock time.
 *
 * `hourCycle: 'h23'` IS LOAD-BEARING, but not for the reason an earlier draft
 * of this comment gave. Measured:
 *
 *   hourCycle:'h23'   -> 00     hour12:false -> 00     (identical; h23 either way)
 *   hourCycle:'h24'   -> 24
 *   option omitted    -> 12, and a separate dayPeriod part appears
 *
 * So `hour12: false` is harmless, and only an explicit 'h24' produces the '24'
 * the old comment warned about. The actual hazard is OMITTING the option: en-US
 * defaults to h12, 14:00 formats as '02', and every afternoon reminder then
 * compares against a morning string. 'h23' is written rather than
 * `hour12: false` because it states the intent directly.
 *
 * Accepts both IANA spellings of an aliased zone, which is load-bearing:
 * copied rows carry v1's Postgres names ('Asia/Calcutta'), natively-created
 * ones carry whatever the browser reports ('Asia/Kolkata'), and both must reach
 * the same answer.
 */
export function localParts(
  timeZone: string,
  at: Date,
): { day: PuzzleDay; time: LocalTime } {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hourCycle: 'h23',
  }).formatToParts(at)

  const get = (type: Intl.DateTimeFormatPartTypes) =>
    parts.find((part) => part.type === type)!.value

  return {
    day: `${get('year')}-${get('month')}-${get('day')}`,
    time: `${get('hour')}:${get('minute')}:${get('second')}`,
  }
}

/**
 * v1's one-hour window, ported exactly: the reminder time must fall in
 * [an hour ago, now], both resolved in the player's zone.
 *
 * BOTH BOUNDS ARE INCLUSIVE, matching v1's SQL, which uses <= and >=. An
 * earlier draft of this comment wrote the interval as (an hour ago, now] and
 * was simply wrong about its own code — caught in review. The test named "the
 * lower bound is inclusive" is what pins it.
 *
 * BOTH BOUNDS ARE PASSED IN rather than derived here, because deriving "an hour
 * ago" from a wall-clock string means doing timezone arithmetic on a string. The
 * caller has the instant and can format it twice.
 *
 * THE MIDNIGHT WRAP IS A v1 BUG AND IS PORTED. When the hour spans midnight the
 * lower bound wraps to 23:xx while the upper stays at 00:xx, so no value can
 * satisfy both and nobody is reminded. It is unreachable today: the picker
 * offers exactly eighteen times, 05:00:00 through 22:00:00
 * (board-entry-reminders.tsx:86-103). It is left alone rather than fixed so the
 * ported rule stays comparable with production, and pinned in the tests so that
 * widening the picker fails loudly instead of quietly dropping reminders.
 */
export function isDueThisHour(
  reminderTime: LocalTime,
  nowLocalTime: LocalTime,
  hourAgoLocalTime: LocalTime,
): boolean {
  return reminderTime <= nowLocalTime && reminderTime >= hourAgoLocalTime
}

/**
 * The once-per-day guard, resolved in the player's zone.
 *
 * v1: `last_board_entry_reminder IS NULL OR last < DATE_TRUNC('day', now AT
 * TIME ZONE tz)`. Negated, that is "the stamp's local day is today or later".
 * `>=` rather than `===` so a clock skew into tomorrow still suppresses rather
 * than double-sending.
 */
export function alreadyRemindedToday(
  lastReminder: number | undefined,
  timeZone: string,
  localDay: PuzzleDay,
): boolean {
  if (lastReminder === undefined) return false
  return localParts(timeZone, new Date(lastReminder)).day >= localDay
}

/**
 * v1's "has played recently" gate: at least one board in the trailing ten days,
 * inclusive of the tenth. Stops the reminder chasing people who have already
 * left.
 *
 * `days` is the puzzleDay list from ONE index range query — see sweep.
 */
export function hasRecentActivity(days: Array<PuzzleDay>, localDay: PuzzleDay): boolean {
  const floor = addDays(localDay, -10)
  return days.some((day) => day >= floor)
}

/** Whether today's board is already in. */
export function enteredOn(days: Array<PuzzleDay>, localDay: PuzzleDay): boolean {
  return days.includes(localDay)
}

/**
 * Whether the weekend opt-in rule applies at all — i.e. whether it is the
 * weekend WHERE THE PLAYER IS. v1 asks the server. See divergence 14.
 */
export function needsWeekendOptIn(localDay: PuzzleDay): boolean {
  return isWeekendDay(localDay)
}
```

- [ ] **Step 4: Run the tests and watch them pass**

```bash
cd /home/cdub/projects/wordle-teams/v2 && pnpm exec vitest run convex/lib/reminders.test.ts > /tmp/t3.txt 2>&1; echo "EXIT=$?"; tail -20 /tmp/t3.txt
```

Expected: `EXIT=0`, 25 tests passed across 6 suites.

- [ ] **Step 5: Run all four gates**

```bash
cd /home/cdub/projects/wordle-teams/v2 && pnpm lint > /tmp/g-lint.txt 2>&1; echo "LINT=$?"
cd /home/cdub/projects/wordle-teams/v2 && pnpm typecheck > /tmp/g-tsc.txt 2>&1; echo "TSC=$?"
cd /home/cdub/projects/wordle-teams/v2 && pnpm test:once > /tmp/g-test.txt 2>&1; echo "TEST=$?"
cd /home/cdub/projects/wordle-teams/v2 && pnpm build > /tmp/g-build.txt 2>&1; echo "BUILD=$?"
```

Expected: all `0`.

- [ ] **Step 6: Commit**

```bash
cd /home/cdub/projects/wordle-teams && git add v2/convex/lib/reminders.ts v2/convex/lib/reminders.test.ts && git commit -m "feat(reminders): eligibility arithmetic, in the player's zone

Ports v1's get_players_for_reminder rules minus two timezone bugs: the
weekend check and the ten-day activity window both resolved against the
server's CURRENT_DATE, so a player in Sydney had the weekday rule applied
through eight hours of their Saturday. Both now resolve where the player is.

The midnight-wrap bug is ported unchanged and pinned in a test — it is
unreachable behind the eighteen-option picker, and pinning it means widening
that picker fails here rather than silently dropping reminders."
```

---

## Task 4: `pushSubscriptions` — schema and prune coverage

**Files:**
- Modify: `v2/convex/schema.ts`
- Modify: `v2/convex/e2ePrune.ts`
- Test: `v2/convex/e2ePrune.test.ts`

- [ ] **Step 1: Add the table**

**UNVERIFIED** — adding a table cannot fail schema validation the way a narrowing can, but the
push itself is the proof.

In `v2/convex/schema.ts`, after `webhookEvents` and before the `--- Phase 0 scaffolding ---`
comment:

```typescript
  // WEB PUSH ENDPOINTS. Phase 6, and NOT copied from anywhere: v1 never stored
  // one. Its subscribe route returns before doing anything
  // (src/app/api/subscribe/route.ts:5), its button ships the literal string
  // 'YOUR_PUBLIC_VAPID_KEY', and the push workflow was never registered with
  // Novu. So this table has no legacyId, for the same reason scoringSystems has
  // none — there is no Supabase counterpart for the copy to match against.
  //
  // ONE PLAYER, MANY ROWS. A subscription belongs to a browser profile on a
  // device, not to a person: phone, laptop and a second browser are three
  // endpoints, and all three should buzz.
  //
  // THE ENDPOINT IS THE IDENTITY, not a surrogate. It is what the push service
  // returns 410 for once the browser has thrown the subscription away, and
  // by_endpoint is how that response finds the row to delete.
  pushSubscriptions: defineTable({
    playerId: v.id('players'),
    endpoint: v.string(),
    p256dh: v.string(),
    auth: v.string(),
    createdAt: v.number(),
  })
    .index('by_player', ['playerId'])
    .index('by_endpoint', ['endpoint']),
```

- [ ] **Step 2: Write the failing prune test**

**UNVERIFIED.** Add to `v2/convex/e2ePrune.test.ts`, matching the file's existing style — read its
neighbours first and follow them rather than this sketch's incidental choices.

```typescript
test('deletes a pruned player&apos;s push subscriptions', async () => {
  const t = convexTest(schema)
  const playerId = await t.run(async (ctx) =>
    ctx.db.insert('players', aPlayer({ email: 'e2e+prune-push@wordleteams.com' })),
  )
  const survivorId = await t.run(async (ctx) =>
    ctx.db.insert('players', aPlayer({ email: 'real@example.com' })),
  )
  await t.run(async (ctx) => {
    await ctx.db.insert('pushSubscriptions', {
      playerId,
      endpoint: 'https://push.example/doomed',
      p256dh: 'k',
      auth: 'a',
      createdAt: 0,
    })
    await ctx.db.insert('pushSubscriptions', {
      playerId: survivorId,
      endpoint: 'https://push.example/kept',
      p256dh: 'k',
      auth: 'a',
      createdAt: 0,
    })
  })

  await t.mutation(internal.e2ePrune.pruneOnce, {})

  const left = await t.run(async (ctx) => ctx.db.query('pushSubscriptions').collect())
  expect(left).toHaveLength(1)
  expect(left[0].endpoint).toBe('https://push.example/kept')
})
```

The mutation name and args must match what `e2ePrune.ts` actually exports — read it, do not assume
`pruneOnce`.

- [ ] **Step 3: Run it and watch it fail**

```bash
cd /home/cdub/projects/wordle-teams/v2 && pnpm exec vitest run convex/e2ePrune.test.ts > /tmp/t4.txt 2>&1; echo "EXIT=$?"; tail -20 /tmp/t4.txt
```

Expected: fails on the length assertion — 2 rows survive, not 1.

- [ ] **Step 4: Delete subscriptions alongside the player**

In `v2/convex/e2ePrune.ts`, wherever the player deletion happens, add the subscription sweep before
deleting the player document, and add a `pushSubscriptionsDeleted` counter to the result type and
its zero value, mirroring `playerMembershipsDeleted` exactly.

**UNVERIFIED:**

```typescript
      const subscriptions = await ctx.db
        .query('pushSubscriptions')
        .withIndex('by_player', (q) => q.eq('playerId', player._id))
        .collect()
      for (const subscription of subscriptions) {
        await ctx.db.delete(subscription._id)
        result.pushSubscriptionsDeleted += 1
      }
```

- [ ] **Step 5: Run the test and watch it pass**

```bash
cd /home/cdub/projects/wordle-teams/v2 && pnpm exec vitest run convex/e2ePrune.test.ts > /tmp/t4.txt 2>&1; echo "EXIT=$?"
```

Expected: `EXIT=0`.

- [ ] **Step 6: Run all four gates, then push and confirm the schema lands**

```bash
cd /home/cdub/projects/wordle-teams/v2 && pnpm lint > /tmp/g-lint.txt 2>&1; echo "LINT=$?"
cd /home/cdub/projects/wordle-teams/v2 && pnpm typecheck > /tmp/g-tsc.txt 2>&1; echo "TSC=$?"
cd /home/cdub/projects/wordle-teams/v2 && pnpm test:once > /tmp/g-test.txt 2>&1; echo "TEST=$?"
cd /home/cdub/projects/wordle-teams/v2 && pnpm build > /tmp/g-build.txt 2>&1; echo "BUILD=$?"
```

Then commit and push. A schema change is only real once a deployment has accepted it:

```bash
cd /home/cdub/projects/wordle-teams && git add v2/convex/schema.ts v2/convex/e2ePrune.ts v2/convex/e2ePrune.test.ts && git commit -m "feat(push): a table for web push endpoints, pruned with its player

No legacyId: v1 never stored a subscription, so there is nothing for the copy
to match. Keyed by endpoint because that is what a push service 410s, and
by_endpoint is how the 410 finds the row to delete.

e2ePrune covers it from the start rather than after a snapshot finds thousands
of orphans, which is how the other five tables got there." && git push origin feat/v2-replatform && gh run watch
```

---

## Task 5: `convex/settings.ts` — the player's own settings

**Files:**
- Create: `v2/convex/settings.ts`
- Test: `v2/convex/settings.test.ts`

- [ ] **Step 1: Write the failing tests**

**UNVERIFIED.** Read `convex/teams.test.ts` for how this project exercises a `...For` helper
without a Better Auth session, and follow that shape. The rules live in the helpers, so the tests
call the helpers.

```typescript
import { convexTest } from 'convex-test'
import { describe, expect, test } from 'vitest'
import schema from './schema.ts'
import { aPlayer } from './fixtures.ts'
import {
  updateReminderMethodsFor,
  updateReminderTimeFor,
  updateTimeZoneFor,
  markPwaInstalledFor,
} from './settings.ts'

describe('updateReminderMethodsFor', () => {
  test('accepts email and push, in any combination', async () => {
    const t = convexTest(schema)
    const playerId = await t.run(async (ctx) => ctx.db.insert('players', aPlayer()))

    for (const methods of [[], ['email'], ['push'], ['email', 'push']]) {
      await t.run(async (ctx) => updateReminderMethodsFor(ctx, playerId, methods))
      const player = await t.run(async (ctx) => ctx.db.get(playerId))
      expect(player!.reminderDeliveryMethods).toEqual(methods)
    }
  })

  test('rejects anything else', async () => {
    // The schema cannot express this: reminderDeliveryMethods is
    // v.array(v.string()) because narrowing it would be validated against every
    // COPIED row on push, and schema.ts:44-66 records what that costs. So the
    // constraint lives here, and this is the test that it exists.
    const t = convexTest(schema)
    const playerId = await t.run(async (ctx) => ctx.db.insert('players', aPlayer()))
    await expect(
      t.run(async (ctx) => updateReminderMethodsFor(ctx, playerId, ['sms'])),
    ).rejects.toThrow()
  })

  test('rejects duplicates', async () => {
    const t = convexTest(schema)
    const playerId = await t.run(async (ctx) => ctx.db.insert('players', aPlayer()))
    await expect(
      t.run(async (ctx) => updateReminderMethodsFor(ctx, playerId, ['email', 'email'])),
    ).rejects.toThrow()
  })
})

describe('updateReminderTimeFor', () => {
  test('accepts each of the eighteen offered times', async () => {
    const t = convexTest(schema)
    const playerId = await t.run(async (ctx) => ctx.db.insert('players', aPlayer()))
    for (let hour = 5; hour <= 22; hour += 1) {
      const time = `${String(hour).padStart(2, '0')}:00:00`
      await t.run(async (ctx) => updateReminderTimeFor(ctx, playerId, time))
      const player = await t.run(async (ctx) => ctx.db.get(playerId))
      expect(player!.reminderDeliveryTime).toBe(time)
    }
  })

  test('rejects a malformed time', async () => {
    const t = convexTest(schema)
    const playerId = await t.run(async (ctx) => ctx.db.insert('players', aPlayer()))
    for (const bad of ['9am', '25:00:00', '09:00', '', '09:00:00 ']) {
      await expect(
        t.run(async (ctx) => updateReminderTimeFor(ctx, playerId, bad)),
      ).rejects.toThrow()
    }
  })
})

describe('updateTimeZoneFor', () => {
  test('stores a zone Intl can resolve', async () => {
    const t = convexTest(schema)
    const playerId = await t.run(async (ctx) => ctx.db.insert('players', aPlayer()))
    await t.run(async (ctx) => updateTimeZoneFor(ctx, playerId, 'America/Chicago'))
    const player = await t.run(async (ctx) => ctx.db.get(playerId))
    expect(player!.timeZone).toBe('America/Chicago')
  })

  test('rejects a zone Intl cannot resolve', async () => {
    // An unresolvable zone would throw inside sweep, at 06:00 on some future
    // morning, taking the whole batch down with it. Refuse it at the door.
    const t = convexTest(schema)
    const playerId = await t.run(async (ctx) => ctx.db.insert('players', aPlayer()))
    await expect(
      t.run(async (ctx) => updateTimeZoneFor(ctx, playerId, 'Mars/Olympus_Mons')),
    ).rejects.toThrow()
  })
})

describe('markPwaInstalledFor', () => {
  test('sets hasPwa and is idempotent', async () => {
    const t = convexTest(schema)
    const playerId = await t.run(async (ctx) =>
      ctx.db.insert('players', aPlayer({ hasPwa: false })),
    )
    await t.run(async (ctx) => markPwaInstalledFor(ctx, playerId))
    await t.run(async (ctx) => markPwaInstalledFor(ctx, playerId))
    const player = await t.run(async (ctx) => ctx.db.get(playerId))
    expect(player!.hasPwa).toBe(true)
  })
})
```

- [ ] **Step 2: Run and watch them fail**

```bash
cd /home/cdub/projects/wordle-teams/v2 && pnpm exec vitest run convex/settings.test.ts > /tmp/t5.txt 2>&1; echo "EXIT=$?"
```

Expected: non-zero, unresolved import.

- [ ] **Step 3: Implement**

**UNVERIFIED.** Create `v2/convex/settings.ts`. Note the shape: each rule is an exported `...For`
helper taking an explicit `playerId`; the wrappers do nothing but resolve the caller and delegate.

```typescript
/**
 * The signed-in player's own notification settings.
 *
 * v2 had none of this. The FOUR fields it writes — timeZone,
 * reminderDeliveryTime, reminderDeliveryMethods, hasPwa — are in the schema and
 * populated by the Supabase copy, and until now nothing in v2 read or wrote one
 * of them. A player who signed up in v2 therefore had no timeZone at all, which
 * is the one field the reminder sweep cannot proceed without.
 *
 * EVERY RULE IS IN A `...For` HELPER, never in the wrapper below it.
 * convex-test cannot stand up a Better Auth session (wordle-teams-obw), so a
 * rule written into a mutation body is a rule no test can reach.
 */
import { v } from 'convex/values'
import { mutation, query } from './_generated/server'
import { accessError, requirePlayer } from './access.ts'
import type { Id } from './_generated/dataModel'
import type { MutationCtx } from './_generated/server'

/** The only two delivery methods that exist. */
const METHODS = ['email', 'push'] as const

// NO REGEX HERE. An earlier draft validated the SHAPE, 00:00:00-23:59:59, which
// is wider than what the reminder engine can deliver: the cron ticks on the
// hour, so isDueThisHour can never match '23:30:00'. It passed validation,
// stored fine, and the player was silently never reminded — measured against
// the real isDueThisHour across a full day of ticks. Membership in the eighteen
// offered times is the check that matches reality, and it is also what makes
// the error copy ("Pick a reminder time from the list") true.

export async function updateReminderMethodsFor(
  ctx: MutationCtx,
  playerId: Id<'players'>,
  methods: Array<string>,
): Promise<void> {
  // The schema types this v.array(v.string()) and cannot do better: narrowing it
  // to a union would be validated against every copied row on the next push, and
  // schema.ts:44-66 records what that cost when firstName was narrowed. So this
  // is the only place the constraint exists.
  const unknown = methods.filter((m) => !METHODS.includes(m as (typeof METHODS)[number]))
  if (unknown.length > 0) accessError('INVALID_REMINDER_METHOD')
  if (new Set(methods).size !== methods.length) accessError('INVALID_REMINDER_METHOD')
  await ctx.db.patch(playerId, { reminderDeliveryMethods: methods })
}

export async function updateReminderTimeFor(
  ctx: MutationCtx,
  playerId: Id<'players'>,
  time: string,
): Promise<void> {
  if (!REMINDER_TIMES.includes(time)) throw accessError('INVALID_REMINDER_TIME')
  await ctx.db.patch(playerId, { reminderDeliveryTime: time })
}

export async function updateTimeZoneFor(
  ctx: MutationCtx,
  playerId: Id<'players'>,
  timeZone: string,
): Promise<void> {
  // Validated by asking Intl, which is the same thing the sweep will ask every
  // hour. An unresolvable zone stored here does not fail now — it throws inside
  // sweep at 06:00 on a future morning and takes the whole batch with it.
  try {
    new Intl.DateTimeFormat('en-US', { timeZone })
  } catch {
    accessError('INVALID_TIME_ZONE')
  }
  await ctx.db.patch(playerId, { timeZone })
}

export async function markPwaInstalledFor(
  ctx: MutationCtx,
  playerId: Id<'players'>,
): Promise<void> {
  await ctx.db.patch(playerId, { hasPwa: true })
}

export const mySettings = query({
  args: {},
  handler: async (ctx) => {
    const player = await requirePlayer(ctx)
    return {
      timeZone: player.timeZone ?? null,
      reminderDeliveryTime: player.reminderDeliveryTime,
      reminderDeliveryMethods: player.reminderDeliveryMethods,
      hasPwa: player.hasPwa,
    }
  },
})

export const updateReminderMethods = mutation({
  args: { methods: v.array(v.string()) },
  handler: async (ctx, { methods }) => {
    const player = await requirePlayer(ctx)
    await updateReminderMethodsFor(ctx, player._id, methods)
  },
})

export const updateReminderTime = mutation({
  args: { time: v.string() },
  handler: async (ctx, { time }) => {
    const player = await requirePlayer(ctx)
    await updateReminderTimeFor(ctx, player._id, time)
  },
})

export const updateTimeZone = mutation({
  args: { timeZone: v.string() },
  handler: async (ctx, { timeZone }) => {
    const player = await requirePlayer(ctx)
    await updateTimeZoneFor(ctx, player._id, timeZone)
  },
})

export const markPwaInstalled = mutation({
  args: {},
  handler: async (ctx) => {
    const player = await requirePlayer(ctx)
    await markPwaInstalledFor(ctx, player._id)
  },
})
```

- [ ] **Step 4: Add the three new access codes — in BOTH files**

`AccessCode` is a union of eleven `SCREAMING_SNAKE_CASE` literals at `convex/access.ts:29`. Add:

```typescript
  | 'INVALID_REMINDER_METHOD'
  | 'INVALID_REMINDER_TIME'
  | 'INVALID_TIME_ZONE'
```

**Then add the user-facing copy to `typedCodeMessage` in `src/lib/convex-error.ts:55`.** That switch
ends in an exhaustiveness check:

```typescript
    default: {
      const _exhaustive: never = code
      return _exhaustive
    }
```

so `pnpm typecheck` fails until all three have a case. That is the feature — you cannot ship a code
with no copy behind it. Suggested wording, matching the register of its neighbours:

```typescript
    case 'INVALID_REMINDER_METHOD':
      // True of BOTH branches that throw this. An earlier draft said
      // "Reminders can be sent by email or push notification", which is a
      // constraint a duplicated ['email','email'] already satisfies — so it
      // described nothing about what actually failed.
      return 'Choose email, push notification, or both.'
    case 'INVALID_REMINDER_TIME':
      return 'Pick a reminder time from the list.'
    case 'INVALID_TIME_ZONE':
      // NOT "not one we recognise", which reads as a rejected choice. The
      // zone is read from Intl.DateTimeFormat().resolvedOptions() — the user
      // picked nothing and can do nothing about a rejection. Points at the
      // real cause, the way INVALID_DATE does.
      return "We could not read your device's time zone, so reminders can't be scheduled yet."
```

Read the comments on `NOT_TEAM_OWNER` and `INVALID_DATE` before writing yours. They record that
these are string literals in a switch, so lint, tsc, build and the whole suite stay green while the
copy lies — which is why the wording is treated as a defect surface rather than a nicety.

- [ ] **Step 5: Run the tests and the gates**

```bash
cd /home/cdub/projects/wordle-teams/v2 && pnpm exec vitest run convex/settings.test.ts > /tmp/t5.txt 2>&1; echo "EXIT=$?"
cd /home/cdub/projects/wordle-teams/v2 && pnpm lint > /tmp/g-lint.txt 2>&1; echo "LINT=$?"
cd /home/cdub/projects/wordle-teams/v2 && pnpm typecheck > /tmp/g-tsc.txt 2>&1; echo "TSC=$?"
cd /home/cdub/projects/wordle-teams/v2 && pnpm test:once > /tmp/g-test.txt 2>&1; echo "TEST=$?"
cd /home/cdub/projects/wordle-teams/v2 && pnpm build > /tmp/g-build.txt 2>&1; echo "BUILD=$?"
```

- [ ] **Step 6: Commit**

```bash
cd /home/cdub/projects/wordle-teams && git add v2/convex/settings.ts v2/convex/settings.test.ts v2/convex/access.ts v2/src/lib/convex-error.ts && git commit -m "feat(settings): the player's own notification settings

Five fields have been in the schema and populated by the copy since Phase 1,
and nothing in v2 read or wrote one of them — so a player who signed up in v2
had no timeZone, the one field the reminder sweep cannot proceed without.

reminderDeliveryMethods stays v.array(v.string()) and the constraint lives in
the mutation instead: narrowing the schema is validated against every copied
row on push, and schema.ts records what that cost for firstName.

A timezone is validated by asking Intl, because an unresolvable one stored here
does not fail here — it throws inside the sweep on a future morning and takes
the batch with it."
```

---

## Task 6: The settings UI — dropdown, dialog, both tabs

**Files:**
- Create: `v2/src/lib/time-zones.ts`
- Create: `v2/src/components/user-menu.tsx`
- Create: `v2/src/components/settings/settings-dialog.tsx`
- Create: `v2/src/components/settings/notifications-tab.tsx`
- Create: `v2/src/components/settings/install-tab.tsx`
- Modify: `v2/src/components/Header.tsx`
- Test: `v2/e2e/settings.spec.ts`

The Push switch is **not** part of this task — it lands in Task 12, after S2 has proven push can
work at all. Render only the Email switch here.

- [ ] **Step 1: Port the timezone option list**

Copy the five groups from `src/components/app-bar/user-dialog.tsx:50-103` verbatim — 26 zones with
`value`, `label` and `shortLabel` — into `v2/src/lib/time-zones.ts` as `TIME_ZONE_GROUPS`, plus
`timeZoneMapping` from `src/components/app-bar/app-bar-base.tsx:14-21`. Export both under exactly
those names; Steps 4 and Task 7 import them that way.

Add this comment above `timeZoneMapping`, because its reason for existing has changed:

```typescript
/**
 * v1 mapped five JS zone names onto the spellings Postgres wanted, because
 * `AT TIME ZONE` needed them. Convex asks Intl, which accepts both spellings as
 * aliases, so this is now COSMETIC — it is ported anyway so that a copied row
 * and a natively-created row spell the same zone identically, which is one
 * fewer false difference for Phase 7's parity audit to chase.
 */
```

- [ ] **Step 2: Write the failing e2e spec**

**UNVERIFIED.** Read `v2/e2e/teams.spec.ts` and `v2/e2e/sign-in.ts` first and follow their setup
exactly — the sign-in helper waits for its own landing, and downstream assertions stay at the strict
5s so a real regression still fails fast.

```typescript
import { expect, test } from '@playwright/test'
import { signIn } from './sign-in'

test('a player can change their reminder settings and they persist', async ({ page }) => {
  await signIn(page)

  await page.getByRole('button', { name: 'Account' }).click()
  await page.getByRole('menuitem', { name: 'Notifications' }).click()

  const dialog = page.getByRole('dialog')
  await expect(dialog.getByRole('tab', { name: 'Notifications' })).toBeVisible({ timeout: 5000 })
  await expect(dialog.getByRole('tab', { name: 'Install Guide' })).toBeVisible({ timeout: 5000 })

  await dialog.getByLabel('Reminder time').click()
  await page.getByRole('option', { name: '7 AM' }).click()
  await expect(page.getByText('Delivery time updated')).toBeVisible({ timeout: 5000 })

  await dialog.getByLabel('Email').click()
  await expect(page.getByText('Delivery methods updated')).toBeVisible({ timeout: 5000 })

  await page.reload()
  await page.getByRole('button', { name: 'Account' }).click()
  await page.getByRole('menuitem', { name: 'Notifications' }).click()
  await expect(page.getByRole('dialog').getByLabel('Reminder time')).toHaveText(/7 AM/, {
    timeout: 5000,
  })
})
```

- [ ] **Step 3: Run it and watch it fail**

```bash
cd /home/cdub/projects/wordle-teams/v2 && pnpm e2e settings.spec.ts > /tmp/t6.txt 2>&1; echo "EXIT=$?"; tail -30 /tmp/t6.txt
```

Expected: fails — no Account button exists. If it fails for a *different* reason, check the local
Convex backend is accepting pushes before debugging anything (`wordle-teams-lvv`).

- [ ] **Step 4: Build `notifications-tab.tsx`**

**UNVERIFIED.** This is the only one of the four with behaviour; the other three are structure.

```typescript
import { convexQuery, useConvexMutation } from '@convex-dev/react-query'
import { useQuery } from '@tanstack/react-query'
import { useState } from 'react'
import { toast } from 'sonner'
import { Loader2 } from 'lucide-react'
import { api } from '../../../convex/_generated/api'
import { Label } from '#/components/ui/label.tsx'
import { Switch } from '#/components/ui/switch.tsx'
import {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectLabel,
  SelectTrigger,
  SelectValue,
} from '#/components/ui/select.tsx'
import { mutationErrorMessage } from '#/lib/convex-error.ts'
import { TIME_ZONE_GROUPS } from '#/lib/time-zones.ts'
import { useMediaQuery } from '#/lib/use-media-query.ts'

// IMPORTED, NOT REDEFINED. `REMINDER_TIMES` lives in convex/lib/reminders.ts
// and is the same list updateReminderTimeFor validates against, so the picker
// and the server cannot drift. A second copy here is exactly how '23:30:00'
// became storable-but-undeliverable — see the note in Task 5.
import { REMINDER_TIMES } from '../../../convex/lib/reminders.ts'

/** '13:00:00' -> '1 PM'. Local formatting only; never sent to the server. */
function label(time: string): string {
  const hour = Number(time.slice(0, 2))
  const suffix = hour < 12 ? 'AM' : 'PM'
  const twelve = hour % 12 === 0 ? 12 : hour % 12
  return `${twelve} ${suffix}`
}

export function NotificationsTab() {
  const { data: settings } = useQuery(convexQuery(api.settings.mySettings, {}))
  const updateTimeZone = useConvexMutation(api.settings.updateTimeZone)
  const updateReminderTime = useConvexMutation(api.settings.updateReminderTime)
  const updateReminderMethods = useConvexMutation(api.settings.updateReminderMethods)
  const isSmallScreen = useMediaQuery('(max-width: 640px)')
  const [pending, setPending] = useState<'zone' | 'time' | 'email' | null>(null)

  // NOT A SPINNER-ONLY GUARD. Until the query lands there is no defaultValue to
  // give the selects, and a Radix Select that mounts with the wrong value keeps
  // it — v1 has the same shape and hides the whole block behind `timeZone &&`.
  if (!settings) return <Loader2 className="animate-spin" aria-label="Loading settings" />

  /** Every control here is fire-and-report: optimistic UI would have nothing to be optimistic about. */
  const run = async (key: 'zone' | 'time' | 'email', action: () => Promise<unknown>, ok: string) => {
    setPending(key)
    try {
      await action()
      toast.success(ok)
    } catch (error) {
      toast.error(mutationErrorMessage(error, 'Could not save that.'))
    } finally {
      setPending(null)
    }
  }

  const emailOn = settings.reminderDeliveryMethods.includes('email')

  const toggleEmail = (checked: boolean) => {
    // Rebuilt from the current array rather than toggled in place, so a value
    // this UI does not render — 'push', once Task 12 lands — survives untouched.
    const methods = checked
      ? [...settings.reminderDeliveryMethods, 'email']
      : settings.reminderDeliveryMethods.filter((m) => m !== 'email')
    void run('email', () => updateReminderMethods({ methods }), 'Delivery methods updated')
  }

  const zoneLabel =
    TIME_ZONE_GROUPS.flatMap((group) => group.items).find(
      (item) => item.value === settings.timeZone,
    ) ?? null

  return (
    <div className="flex flex-col gap-8 py-6">
      <div className="flex items-center justify-between">
        <Label htmlFor="timeZone">Time Zone</Label>
        {pending === 'zone' ? (
          <Loader2 className="animate-spin" />
        ) : (
          <Select
            value={settings.timeZone ?? undefined}
            onValueChange={(timeZone) =>
              void run('zone', () => updateTimeZone({ timeZone }), 'Time zone updated')
            }
          >
            <SelectTrigger id="timeZone" className="w-[115px] md:w-[280px]">
              <SelectValue placeholder="Select a timezone">
                {zoneLabel
                  ? isSmallScreen
                    ? zoneLabel.shortLabel
                    : zoneLabel.label
                  : 'Select a timezone'}
              </SelectValue>
            </SelectTrigger>
            <SelectContent className="max-h-[300px] overflow-y-auto">
              {TIME_ZONE_GROUPS.map((group) => (
                <SelectGroup key={group.label}>
                  <SelectLabel>{group.label}</SelectLabel>
                  {group.items.map((item) => (
                    <SelectItem key={item.value} value={item.value}>
                      {item.label}
                    </SelectItem>
                  ))}
                </SelectGroup>
              ))}
            </SelectContent>
          </Select>
        )}
      </div>

      <div className="flex flex-col gap-2">
        <div className="flex items-center justify-between">
          <div className="flex flex-col gap-1">
            <Label htmlFor="reminderTime">Board Entry Reminder</Label>
            <p className="text-sm text-muted-foreground">Daily reminder for incomplete boards</p>
          </div>
          {pending === 'time' ? (
            <Loader2 className="animate-spin" />
          ) : (
            <Select
              value={settings.reminderDeliveryTime}
              onValueChange={(time) =>
                void run('time', () => updateReminderTime({ time }), 'Delivery time updated')
              }
            >
              <SelectTrigger id="reminderTime" className="w-[125px]">
                <SelectValue />
              </SelectTrigger>
              <SelectContent className="max-h-[300px] overflow-y-auto">
                {REMINDER_TIMES.map((time) => (
                  <SelectItem key={time} value={time}>
                    {label(time)}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          )}
        </div>

        <div className="flex items-center gap-2 py-2 text-muted-foreground">
          <Label htmlFor="emailReminders">Email</Label>
          {pending === 'email' ? (
            <Loader2 className="animate-spin" />
          ) : (
            <Switch id="emailReminders" checked={emailOn} onCheckedChange={toggleEmail} />
          )}
        </div>
        {/* The Push switch lands in Task 12, after spike S2 proves push can work. */}
      </div>
    </div>
  )
}
```

Note `useQuery(convexQuery(api.settings.mySettings, {}))` with no `'skip'` — unlike `Header.tsx`,
this component only ever mounts inside the dialog, which only ever opens for a signed-in player.
If that stops being true, it needs the `isAuthenticated ? {} : 'skip'` gate the Header documents;
`enabled: false` is **not** the one that works, and that was measured on this project.

- [ ] **Step 5: Build the other three**

`install-tab.tsx` ports `user-dialog.tsx:158-176` verbatim — heading, subheading and the three-step
Add-to-Home-Screen list, with the `MoreHorizontal` and `Share` icons from `lucide-react`
(`DotsHorizontalIcon` is `@radix-ui/react-icons`, which v2 does not use). It carries real weight
rather than being decoration: iOS grants push only to an installed PWA, so on iPhone this tab is the
only route to what the other tab offers.

`settings-dialog.tsx` is a `Dialog` wrapping `Tabs` with `defaultValue` from a `defaultTab` prop —
v1's shape at `user-dialog.tsx:117-121`. Follow `v2/src/components/teams/update-team-dialog.tsx`
for how this project composes a controlled dialog.

`user-menu.tsx` is a `DropdownMenu` with an `Account` trigger and two items, `Notifications` and
`Install Guide`, each opening the dialog on the matching tab.

- [ ] **Step 6: Mount it in the Header**

In `v2/src/components/Header.tsx`, add `<UserMenu />` inside the `{isAuthenticated && (…)}` region
beside the Billing button, before `<ThemeToggle />`.

- [ ] **Step 7: Run the spec and watch it pass**

```bash
cd /home/cdub/projects/wordle-teams/v2 && pnpm e2e settings.spec.ts > /tmp/t6.txt 2>&1; echo "EXIT=$?"
```

- [ ] **Step 8: Four gates, then commit and push**

```bash
cd /home/cdub/projects/wordle-teams/v2 && pnpm lint > /tmp/g-lint.txt 2>&1; echo "LINT=$?"
cd /home/cdub/projects/wordle-teams/v2 && pnpm typecheck > /tmp/g-tsc.txt 2>&1; echo "TSC=$?"
cd /home/cdub/projects/wordle-teams/v2 && pnpm test:once > /tmp/g-test.txt 2>&1; echo "TEST=$?"
cd /home/cdub/projects/wordle-teams/v2 && pnpm build > /tmp/g-build.txt 2>&1; echo "BUILD=$?"
```

Commit as `feat(settings): a user menu and a settings dialog`, then push and `gh run watch`.

---

## Task 7: Silent `timeZone` and `hasPwa` capture

Ports `src/components/app-bar/app-bar-base.tsx:31-68`. Without this, every player who signs up in v2
has no `timeZone` and is skipped by the sweep forever, with nothing to indicate why.

**Files:**
- Create: `v2/src/lib/use-local-capture.ts`
- Modify: `v2/src/components/Header.tsx`

- [ ] **Step 1: Write the hook**

**UNVERIFIED.**

```typescript
import { useConvexAuth, useConvexMutation } from '@convex-dev/react-query'
import { useQuery } from '@tanstack/react-query'
import { convexQuery } from '@convex-dev/react-query'
import { useEffect, useRef } from 'react'
import { api } from '../../convex/_generated/api'
import { timeZoneMapping } from './time-zones.ts'
import { captureError } from './sentry-capture.ts'

/**
 * Records two things the player never tells us directly: which zone they are
 * in, and whether they have installed the app.
 *
 * PORTED FROM v1 (app-bar-base.tsx:31-68) AND LOad-BEARING. The reminder sweep
 * skips any player with no timeZone, and until this ran, nobody who signed up in
 * v2 had one — so the whole feature would have been silently inert for every new
 * account while looking configured.
 *
 * SILENT ON PURPOSE. Neither write is something the player asked for, so neither
 * toasts. A failure is reported and otherwise ignored: this is telemetry for a
 * daily email, not a transaction.
 */
export function useLocalCapture() {
  const { isAuthenticated } = useConvexAuth()
  const { data: settings } = useQuery(
    convexQuery(api.settings.mySettings, isAuthenticated ? {} : 'skip'),
  )
  const updateTimeZone = useConvexMutation(api.settings.updateTimeZone)
  const markPwaInstalled = useConvexMutation(api.settings.markPwaInstalled)

  // Guards against a second write while the first is in flight: `settings` does
  // not update until the mutation lands, so without this the effect refires on
  // every render in between.
  const wroteZone = useRef(false)
  const wrotePwa = useRef(false)

  useEffect(() => {
    if (!settings) return

    if (!settings.timeZone && !wroteZone.current) {
      wroteZone.current = true
      const resolved = Intl.DateTimeFormat().resolvedOptions().timeZone
      const mapped = timeZoneMapping[resolved] ?? resolved
      void updateTimeZone({ timeZone: mapped }).catch((error: unknown) =>
        captureError(error, { where: 'useLocalCapture.timeZone', resolved, mapped }),
      )
    }

    // v1 reads navigator.standalone for iOS Safari, which does not report
    // display-mode. Both are needed; neither alone covers both platforms.
    const standalone =
      window.matchMedia('(display-mode: standalone)').matches ||
      (window.navigator as { standalone?: boolean }).standalone === true

    if (standalone && !settings.hasPwa && !wrotePwa.current) {
      wrotePwa.current = true
      void markPwaInstalled({}).catch((error: unknown) =>
        captureError(error, { where: 'useLocalCapture.hasPwa' }),
      )
    }
  }, [settings, updateTimeZone, markPwaInstalled])
}
```

- [ ] **Step 2: Call it from the Header**

`Header` is already inside `ConvexBetterAuthProvider` (`__root.tsx`'s `RootComponent`), which is
load-bearing — a Convex hook above that provider throws, and was measured answering `GET /login`
with a 500. Add `useLocalCapture()` as the first line of the component body.

- [ ] **Step 3: Verify by hand against the local backend**

```bash
cd /home/cdub/projects/wordle-teams/v2 && pnpm dev
```

Sign in as a fresh account, then confirm in the Convex dashboard that the player row now carries a
`timeZone`. There is no unit test for this — it reads two browser APIs that jsdom does not
meaningfully implement, and a test that mocks both would assert only that the mocks were called.

- [ ] **Step 4: Four gates, commit, push**

Commit as `feat(settings): capture the player's zone and PWA install silently`.

---

## Task 8: The reminder email, and re-hosting its branding

**Files:**
- Create: `v2/convex/lib/html.ts`
- Modify: `v2/convex/inviteEmails.ts`
- Create: `v2/convex/reminderEmails.ts`
- Test: `v2/convex/reminderEmails.test.ts`
- Create: `v2/public/wordle-teams-title.png`

- [ ] **Step 1: Fetch the branding image before anything can depend on it**

```bash
cd /home/cdub/projects/wordle-teams/v2 && curl -sSf -o public/wordle-teams-title.png "https://dcfqzbdusxhrfgvnpwqc.supabase.co/storage/v1/object/public/images/wordle-teams-title.png" && file public/wordle-teams-title.png && ls -la public/wordle-teams-title.png
```

Expected: `PNG image data`. This is the Supabase trap in `wt-ksh.7`'s notes — Supabase retires in
Phase 9, and an email whose images 404 breaks silently, in someone else's inbox.

`wt-icon-192x192.png` is already in `public/`, so the second image needs nothing.

- [ ] **Step 2: Move `escapeHtml` into a shared module**

Cut the function and its entire doc comment from `v2/convex/inviteEmails.ts` into
`v2/convex/lib/html.ts` unchanged, and import it back:

```typescript
import { escapeHtml } from './lib/html.ts'
```

Then run the existing tests to prove the move changed nothing:

```bash
cd /home/cdub/projects/wordle-teams/v2 && pnpm exec vitest run convex/inviteEmails.test.ts > /tmp/t8a.txt 2>&1; echo "EXIT=$?"
```

Expected: `EXIT=0`, same count as before the move.

- [ ] **Step 3: Write the failing template tests**

**UNVERIFIED.**

```typescript
import { describe, expect, test } from 'vitest'
import { boardEntryReminderEmail } from './reminderEmails.ts'

const email = () =>
  boardEntryReminderEmail({ firstName: 'Ada', siteUrl: 'https://beta.wordleteams.com' })

describe('boardEntryReminderEmail', () => {
  test('greets by first name', () => {
    expect(email().html).toContain('Hello Ada,')
    expect(email().text).toContain('Hello Ada,')
  })

  test('carries a plain-text part', () => {
    // Not optional politeness: some clients render text by preference, and a
    // mail with no text alternative scores worse with spam filters. Same
    // reasoning as inviteEmails.ts.
    expect(email().text.length).toBeGreaterThan(0)
  })

  test('escapes a hostile name in the HTML part only', () => {
    const hostile = boardEntryReminderEmail({
      firstName: '<script>alert(1)</script>',
      siteUrl: 'https://beta.wordleteams.com',
    })
    expect(hostile.html).not.toContain('<script>')
    expect(hostile.html).toContain('&lt;script&gt;')
    // The text part is not markup. Escaping it would show a reader the literal
    // &amp; in a name containing an ampersand.
    expect(hostile.text).toContain('<script>')
  })

  test('every image is served from our own origin', () => {
    // The whole point of this task. Supabase retires in Phase 9.
    expect(email().html).not.toContain('supabase.co')
    expect(email().html).toContain('https://beta.wordleteams.com/wordle-teams-title.png')
    expect(email().html).toContain('https://beta.wordleteams.com/wt-icon-192x192.png')
  })

  test('the subject names the app', () => {
    expect(email().subject).toContain('Wordle Teams')
  })
})
```

- [ ] **Step 4: Run and watch fail, then implement**

**UNVERIFIED.** Create `v2/convex/reminderEmails.ts`, following `inviteEmails.ts` exactly for
structure — a `subject`, a `text` and an `html`, hand-written, with `escapeHtml` applied to the HTML
part only. Port the copy from `src/app/novu/emails/board-entry-reminder-email.tsx`:

- heading: "Reminder to enter your Wordle board into **Wordle Teams**"
- body: "It looks like you have not yet entered your Wordle board for today. Don't miss out on those
  potential points!"
- sign-off: "Best of luck!" then the icon and "Wordle Teams"
- footer: how to change or stop reminders — **and update v1's wording**, which says to use "the
  Notifications option in the user dropdown at the top right of your screen". That is still accurate
  for v2 after Task 6. Confirm it against what you actually built rather than copying it blind; a
  commit can falsify a comment it writes.

The subject: v1's is `Board Entry Reminder ${formatDate(new Date(), 'M/dd/yy')}`, and note that in
v1 that default is evaluated **once at module load**, so a long-running server sends every reminder
stamped with the date it booted. Take the date as a parameter here, or drop it from the subject —
either is better than reproducing that.

- [ ] **Step 5: Tests pass, four gates, commit**

```bash
cd /home/cdub/projects/wordle-teams/v2 && pnpm exec vitest run convex/reminderEmails.test.ts > /tmp/t8.txt 2>&1; echo "EXIT=$?"
```

Commit as `feat(reminders): the board-entry reminder email, self-hosted images and all`.

---

## Task 9: The cron and the sweep

**Files:**
- Create: `v2/convex/crons.ts`
- Create: `v2/convex/reminders.ts`
- Test: `v2/convex/reminders.test.ts`

Push delivery is **not** wired here — Task 11 adds it, after S2. This task delivers email only, and
that is enough to satisfy half the phase's done-when.

### THE SWEEP IS OFF BY DEFAULT, AND GATED TWICE

**Owner decision, 2026-08-28.** Beta holds copied production rows — real people who do not know
this beta exists, and who are already receiving real reminders from v1. Sending them a second
reminder from an app they have never heard of is not recoverable by an apology.

Two gates, both in `sweep`, both checked **before any player is claimed**:

1. **`REMINDERS_ENABLED`** — unless it is exactly `'true'`, the sweep returns immediately having
   done nothing. Not set on beta. This is the switch that makes "off" the default state rather
   than a property of the data.
2. **`REMINDERS_ALLOWLIST`** — a comma-separated list of addresses. When `REMINDERS_ENABLED` is
   on and this is non-empty, only players whose email is in it may be claimed or delivered to.
   Empty means no restriction, which is the intended **production** setting at cutover.

```typescript
    // GATE 1. Off unless explicitly switched on for this deployment. Beta does
    // not set it. A copy, a schema change or a settings-UI bug cannot turn
    // reminders on; only an operator can.
    if (process.env.REMINDERS_ENABLED !== 'true') return { claimed: 0, gated: 'disabled' as const }

    // GATE 2. During beta, even with the switch on, only named testers receive.
    // Empty list = no restriction, which is what production wants at cutover.
    const allowlist = new Set(
      (process.env.REMINDERS_ALLOWLIST ?? '')
        .split(',')
        .map((address) => address.trim().toLowerCase())
        .filter((address) => address.length > 0),
    )
```

and in the per-player filter, alongside the `timeZone` and methods checks:

```typescript
      if (allowlist.size > 0 && !allowlist.has(player.email)) return []
```

`players.email` is always lowercase (see the schema note), which is why the list is lowercased on
read rather than compared case-insensitively per player.

**Test all three states** — disabled, allowlisted, unrestricted. The gate is the only thing
standing between a config slip and mailing every copied row, so it gets the same coverage as the
eligibility rules. `convex-test` can set `process.env` per test.

**At cutover:** set `REMINDERS_ENABLED=true` and leave `REMINDERS_ALLOWLIST` unset. That is a
runbook line, and Task 14 must add it.

### The copy stays out of it until cutover

`scripts/copy-from-supabase.mjs` currently carries **neither** `reminder_delivery_methods` nor
`time_zone`. Leave it that way through Phase 7's parity run: a re-copy must never be able to switch
reminders on for a beta row. Adding both fields is an explicit **cutover** step, so real
preferences arrive exactly when the app becomes real — Task 14 writes it into the runbook, or it
will be forgotten and every existing subscriber will silently lose a feature they had.

Note this makes Phase 7's parity audit expect a difference on those two columns. Record it.

### Read this before writing the claim: every player matches TWICE

Measured during Task 3's review, and it changes how you must think about the stamp.

`isDueThisHour`'s bounds are both inclusive, matching v1's SQL. The cron ticks at `minuteUTC: 0`.
So in any **whole-hour-offset** zone, an `09:00:00` reminder satisfies the *upper* bound on the
09:00 tick and the *lower* bound on the 10:00 tick — it matches on two consecutive runs. Simulated
over 399 days across the eighteen offered times:

| Zone | Missed | Double-matched |
|---|---|---|
| `America/Chicago`, `Australia/Sydney`, `Europe/London`, `Pacific/Honolulu` | 0 | 7182 |
| `Asia/Kolkata`, `Asia/Kathmandu`, `Pacific/Chatham`, `America/St_Johns` | 0 | 0 |

Nobody is ever missed, including across DST transitions. But **most players match twice every
day**, and the only thing standing between that and two emails a day is
`alreadyRemindedToday` reading a stamp that was already written.

That is why the claim is written **before delivery and unconditionally** (decision F, divergence
16). Writing it after a successful send, or only on success, would double-send to every
whole-hour-offset player — which is the majority. Do not "improve" this into a
write-after-success; the failure it would introduce is the common case, not an edge case.

### A performance note, not a change

`localParts` builds a fresh `Intl.DateTimeFormat` per call — measured at ~38µs including
construction. The sweep calls it two or three times per player. At production's 533 players that is
negligible; against an e2e-debris table of 2520 it is ~0.2-0.3s of the mutation's budget. If that
ever gets tight, cache formatters in a `Map` keyed by zone **inside `sweep`** — not in
`lib/reminders.ts`, which is correct to stay stateless.

- [ ] **Step 1: Write the failing tests**

**UNVERIFIED.** Six cases, one per eligibility rule. `sweep` must take `now` as an argument so the
tests can choose the instant — a mutation that reads its own clock is a mutation that can only be
tested on the hour it happens to run.

```typescript
import { convexTest } from 'convex-test'
import { describe, expect, test } from 'vitest'
import schema from './schema.ts'
import { aPlayer, aTeam } from './fixtures.ts'
import { internal } from './_generated/api'

// 2026-08-27T14:00:00Z is 09:00 in Chicago, so a 09:00:00 reminder is due.
const THURSDAY_2PM_UTC = new Date('2026-08-27T14:00:00Z').getTime()
// 2026-08-29T14:00:00Z is 09:00 Chicago on a Saturday.
const SATURDAY_2PM_UTC = new Date('2026-08-29T14:00:00Z').getTime()

const dueChicagoPlayer = (over: Record<string, unknown> = {}) =>
  aPlayer({
    timeZone: 'America/Chicago',
    reminderDeliveryTime: '09:00:00',
    reminderDeliveryMethods: ['email'],
    ...over,
  })

/** A score history that satisfies the ten-day activity gate. */
const recentScores = ['2026-08-24', '2026-08-25', '2026-08-26']

async function seed(
  t: ReturnType<typeof convexTest>,
  playerOver: Record<string, unknown>,
  days: Array<string>,
  teamOver: Record<string, unknown> = {},
) {
  return await t.run(async (ctx) => {
    const playerId = await ctx.db.insert('players', dueChicagoPlayer(playerOver))
    for (const puzzleDay of days) {
      await ctx.db.insert('dailyScores', {
        playerId,
        puzzleDay,
        date: 0,
        guesses: ['xxxxx'],
      })
    }
    await ctx.db.insert('teams', aTeam({ playerIds: [playerId], ...teamOver }))
    return playerId
  })
}

describe('sweep', () => {
  test('claims and enqueues a due player who has not entered today', async () => {
    const t = convexTest(schema)
    const playerId = await seed(t, {}, recentScores)

    await t.mutation(internal.reminders.sweep, { now: THURSDAY_2PM_UTC })

    const player = await t.run(async (ctx) => ctx.db.get(playerId))
    expect(player!.lastBoardEntryReminder).toBe(THURSDAY_2PM_UTC)
  })

  test('skips a player who already entered today', async () => {
    const t = convexTest(schema)
    const playerId = await seed(t, {}, [...recentScores, '2026-08-27'])

    await t.mutation(internal.reminders.sweep, { now: THURSDAY_2PM_UTC })

    const player = await t.run(async (ctx) => ctx.db.get(playerId))
    expect(player!.lastBoardEntryReminder).toBeUndefined()
  })

  test('skips a player already reminded earlier in their local day', async () => {
    const t = convexTest(schema)
    const earlier = new Date('2026-08-27T13:00:00Z').getTime()
    const playerId = await seed(t, { lastBoardEntryReminder: earlier }, recentScores)

    await t.mutation(internal.reminders.sweep, { now: THURSDAY_2PM_UTC })

    const player = await t.run(async (ctx) => ctx.db.get(playerId))
    expect(player!.lastBoardEntryReminder).toBe(earlier)
  })

  test('skips a player dormant for more than ten days', async () => {
    const t = convexTest(schema)
    const playerId = await seed(t, {}, ['2026-08-10'])

    await t.mutation(internal.reminders.sweep, { now: THURSDAY_2PM_UTC })

    const player = await t.run(async (ctx) => ctx.db.get(playerId))
    expect(player!.lastBoardEntryReminder).toBeUndefined()
  })

  test('on a Saturday, skips a player whose only team does not play weekends', async () => {
    const t = convexTest(schema)
    const playerId = await seed(t, {}, ['2026-08-26', '2026-08-27'], { playWeekends: false })

    await t.mutation(internal.reminders.sweep, { now: SATURDAY_2PM_UTC })

    const player = await t.run(async (ctx) => ctx.db.get(playerId))
    expect(player!.lastBoardEntryReminder).toBeUndefined()
  })

  test('on a Saturday, reminds a player on a team that does play weekends', async () => {
    const t = convexTest(schema)
    const playerId = await seed(t, {}, ['2026-08-26', '2026-08-27'], { playWeekends: true })

    await t.mutation(internal.reminders.sweep, { now: SATURDAY_2PM_UTC })

    const player = await t.run(async (ctx) => ctx.db.get(playerId))
    expect(player!.lastBoardEntryReminder).toBe(SATURDAY_2PM_UTC)
  })

  test('skips a player with no timeZone', async () => {
    const t = convexTest(schema)
    const playerId = await seed(t, { timeZone: undefined }, recentScores)

    await t.mutation(internal.reminders.sweep, { now: THURSDAY_2PM_UTC })

    const player = await t.run(async (ctx) => ctx.db.get(playerId))
    expect(player!.lastBoardEntryReminder).toBeUndefined()
  })

  test('skips a player with no delivery methods', async () => {
    const t = convexTest(schema)
    const playerId = await seed(t, { reminderDeliveryMethods: [] }, recentScores)

    await t.mutation(internal.reminders.sweep, { now: THURSDAY_2PM_UTC })

    const player = await t.run(async (ctx) => ctx.db.get(playerId))
    expect(player!.lastBoardEntryReminder).toBeUndefined()
  })
})
```

Note the fixtures: `aPlayer` has no `timeZone` and `reminderDeliveryTime: '18:00:00'` by default,
so `dueChicagoPlayer` must set both. Check `fixtures.ts` before assuming any default.

- [ ] **Step 2: Run and watch them fail**

```bash
cd /home/cdub/projects/wordle-teams/v2 && pnpm exec vitest run convex/reminders.test.ts > /tmp/t9.txt 2>&1; echo "EXIT=$?"
```

- [ ] **Step 3: Write the sweep**

**UNVERIFIED.** Create `v2/convex/reminders.ts`.

```typescript
/**
 * The daily board-entry reminder sweep.
 *
 * A MUTATION, NOT AN ACTION, and that is the design. Eligibility is decided
 * against one consistent snapshot, the claim is written in the same
 * transaction, and email is enqueued into the Resend component transactionally
 * — so if this retries under OCC contention, no mail has been sent and no claim
 * has been committed. A retry is clean by construction.
 *
 * `now` IS AN ARGUMENT rather than a clock read. The cron passes Date.now();
 * the tests pass whichever instant exercises the rule they care about. A
 * mutation that reads its own clock can only be tested on the hour it happens
 * to run.
 *
 * REPLACES v1's TWO ROUTES AND TWO VENDORS. /api/board-entry-reminder ran the
 * eligibility SQL and published one QStash message per player;
 * /api/process-board-entry-reminder consumed each one and triggered Novu. The
 * fan-out survives — as ctx.scheduler, per player, for push — and the vendors
 * do not.
 */
import { v } from 'convex/values'
import { internalMutation } from './_generated/server'
import { internal } from './_generated/api'
import { sendEmail } from './email.ts'
import { boardEntryReminderEmail } from './reminderEmails.ts'
import {
  alreadyRemindedToday,
  enteredOn,
  hasRecentActivity,
  isDueThisHour,
  localParts,
  needsWeekendOptIn,
} from './lib/reminders.ts'
import { addDays } from './lib/puzzleDay.ts'

const HOUR_MS = 60 * 60 * 1000

export const sweep = internalMutation({
  args: { now: v.number() },
  handler: async (ctx, { now }) => {
    const at = new Date(now)
    const anHourAgo = new Date(now - HOUR_MS)

    // Production holds 533 players. This is the same bounded-collect
    // justification schema.ts:137-140 already makes for `teams`: revisit if that
    // count changes by an order of magnitude, not before.
    const players = await ctx.db.query('players').collect()

    // Cheapest predicates first, so the expensive per-player read below runs for
    // roughly a thirtieth of the table — one of eighteen reminder hours matches
    // on any given tick.
    const candidates = players.flatMap((player) => {
      const timeZone = player.timeZone
      if (!timeZone) return []
      if (player.reminderDeliveryMethods.length === 0) return []

      let local: { day: string; time: string }
      let hourAgo: { day: string; time: string }
      try {
        local = localParts(timeZone, at)
        hourAgo = localParts(timeZone, anHourAgo)
      } catch (error) {
        // updateTimeZoneFor rejects an unresolvable zone, but a row copied from
        // Supabase never passed through it. One bad row must not take the batch
        // down with it.
        console.error('[reminders] unresolvable timeZone on a player', {
          playerId: player._id,
          timeZone,
        }, error)
        return []
      }

      if (!isDueThisHour(player.reminderDeliveryTime, local.time, hourAgo.time)) return []
      if (alreadyRemindedToday(player.lastBoardEntryReminder, timeZone, local.day)) return []
      return [{ player, localDay: local.day }]
    })

    if (candidates.length === 0) return { claimed: 0 }

    // Collected once, and only when somebody's LOCAL day is a weekend — five
    // days a week this read never happens. Convex cannot index array
    // membership, so this is the sanctioned shape; see the schema note on teams.
    const weekendCandidates = candidates.filter((c) => needsWeekendOptIn(c.localDay))
    const teams = weekendCandidates.length > 0 ? await ctx.db.query('teams').collect() : []

    let claimed = 0
    for (const { player, localDay } of candidates) {
      // ONE range query answers both remaining questions.
      const scores = await ctx.db
        .query('dailyScores')
        .withIndex('by_player_and_puzzleDay', (q) =>
          q
            .eq('playerId', player._id)
            .gte('puzzleDay', addDays(localDay, -10))
            .lte('puzzleDay', localDay),
        )
        .collect()
      const days = scores.map((score) => score.puzzleDay)

      if (enteredOn(days, localDay)) continue
      if (!hasRecentActivity(days, localDay)) continue

      if (needsWeekendOptIn(localDay)) {
        const playsWeekends = teams.some(
          (team) => team.playWeekends && team.playerIds.includes(player._id),
        )
        if (!playsWeekends) continue
      }

      // CLAIM BEFORE DELIVERING. A duplicate cron run or an OCC retry can never
      // send twice. The cost is that a delivery failure means no reminder that
      // day — which is why the push path schedules its own retry rather than
      // waiting for a cron window this player has already aged out of. See
      // divergence 16; v1 stamps this AFTER sending.
      await ctx.db.patch(player._id, { lastBoardEntryReminder: now })
      claimed += 1

      if (player.reminderDeliveryMethods.includes('email')) {
        const siteUrl = process.env.SITE_URL
        if (!siteUrl) {
          // Every image in the mail is an absolute URL built from this. Sending
          // without it means sending a mail with broken images, which is worse
          // than not sending.
          console.error('[reminders] SITE_URL is not set on this deployment')
        } else {
          const { subject, html, text } = boardEntryReminderEmail({
            firstName: player.firstName,
            siteUrl,
          })
          await sendEmail(ctx, { to: player.email, subject, html, text })
        }
      }

      // Push is scheduled in Task 11, once S2 has proven web-push runs here.
    }

    return { claimed }
  },
})
```

**Two things to check against reality rather than trusting this snippet.** The exact `sendEmail`
options shape — read `convex/email.ts` and `SendEmailOptions`, which requires a `from`. And whether
`.gte(...).lte(...)` is the correct index range syntax for this Convex version; the compiler will
tell you.

- [ ] **Step 4: Register the cron**

**UNVERIFIED.** Create `v2/convex/crons.ts`:

```typescript
/**
 * One entry. Hourly on the hour, because v1's window is one hour wide and its
 * picker offers only whole hours — see lib/reminders.ts.
 *
 * A HALF-HOUR ZONE STILL WORKS. At a :00 UTC tick Kolkata is at :30 local, so
 * its window is [18:30, 19:30] and a 19:00 reminder lands inside it. Pinned in
 * lib/reminders.test.ts.
 */
import { cronJobs } from 'convex/server'
import { internal } from './_generated/api'

const crons = cronJobs()

crons.hourly(
  'board entry reminders',
  { minuteUTC: 0 },
  internal.reminders.sweep,
  // The clock is read here, at the one place that legitimately has one, and
  // passed down so every rule below is a pure function of its inputs.
  { now: Date.now() },
)

export default crons
```

**This snippet has a real risk and you must check it.** `Date.now()` is evaluated when the crons
module is *defined*, not when the job fires — the same class of bug as v1's email subject, which
freezes at module load. If that is how Convex evaluates it, the sweep will be handed the deploy time
forever. Verify before trusting it. If it is frozen, the fix is for `sweep` to default `now` to
`Date.now()` inside the handler when the argument is absent, and for the cron to pass `{}`.

- [ ] **Step 5: Tests pass, four gates, deploy, and watch a real one fire**

```bash
cd /home/cdub/projects/wordle-teams/v2 && pnpm exec vitest run convex/reminders.test.ts > /tmp/t9.txt 2>&1; echo "EXIT=$?"
```

Then all four gates, commit, push, `gh run watch`. Then set your own player's
`reminderDeliveryTime` to the next hour through the settings dialog on beta, with Email on, and
confirm the mail arrives. That is half the phase's done-when and no test substitutes for it.

- [ ] **Step 6: Commit**

Commit as `feat(reminders): an hourly sweep that claims before it sends`.

---

## Task 10: SPIKE S2 — does `web-push` run on Convex?

**The highest-risk unknown in the phase.** Phase 5 shipped `validateEvent` through all four green
gates and it could not run on Convex's runtime — `Buffer is not defined` — and only a live request
found it. `web-push` needs Node crypto for VAPID JWT signing and AES128GCM payload encryption. The
`'use node'` directive is supposed to give it that. Prove it before Tasks 11-13 are built on it.

**Files:**
- Create (temporarily): `v2/convex/spikePush.ts`

**Step 3 has a cheap precursor.** Check what the DEFAULT runtime has before spending a deploy
finding out what the Node one adds — locally, which is fine for a capability question:

```bash
cd /home/cdub/projects/wordle-teams/v2 && pnpm exec convex run --inline-query 'return { hasBuffer: typeof Buffer !== "undefined", hasCrypto: typeof crypto !== "undefined", hasSubtle: typeof crypto !== "undefined" && typeof crypto.subtle !== "undefined" }' > /tmp/s2pre.out 2>&1; echo "EXIT=$?"
```

**That does NOT replace the probe.** An inline query runs in the *query* runtime; `'use node'`
applies to a deployed action module, which is the actual question. And per the warning in Task 1,
`convex run` reaches only the local backend — it is refused against beta — so the deployed probe
must be invoked from the Convex dashboard, not from the CLI. Steps 3-6 stand as written.

- [ ] **Step 1: Generate a VAPID keypair**

```bash
cd /home/cdub/projects/wordle-teams/v2 && pnpm add web-push && pnpm add -D @types/web-push && pnpm exec web-push generate-vapid-keys
```

**The private key is a secret and this repository is public.** Do not paste it into a file, a commit
message, a beads issue, or this plan. It goes into Convex env and nowhere else.

- [ ] **Step 2: Set the three env vars on beta**

The owner does this in the Convex dashboard for the beta deployment: `VAPID_PUBLIC_KEY`,
`VAPID_PRIVATE_KEY`, `VAPID_SUBJECT` (a `mailto:` address). Beta reads the prod block; prod vars sit
commented above the dev ones in this project's env notes.

- [ ] **Step 3: Write the probe**

**UNVERIFIED.**

```typescript
'use node'

// TEMPORARY. Delete in step 7. Answers one question no gate can: does web-push
// import and execute on Convex's Node runtime? Phase 5's `Buffer is not
// defined` is the precedent.
import { v } from 'convex/values'
import webpush from 'web-push'
import { action } from './_generated/server'

export const probe = action({
  args: { endpoint: v.string(), p256dh: v.string(), auth: v.string() },
  handler: async (_ctx, { endpoint, p256dh, auth }) => {
    webpush.setVapidDetails(
      process.env.VAPID_SUBJECT!,
      process.env.VAPID_PUBLIC_KEY!,
      process.env.VAPID_PRIVATE_KEY!,
    )
    const result = await webpush.sendNotification(
      { endpoint, keys: { p256dh, auth } },
      JSON.stringify({ title: 'Wordle Teams', body: 'S2 probe' }),
    )
    return { statusCode: result.statusCode }
  },
})
```

- [ ] **Step 4: Get a real subscription to send to**

In the browser on beta, with the SW stub from Task 2 registered, in DevTools console:

```javascript
const reg = await navigator.serviceWorker.ready
const sub = await reg.pushManager.subscribe({
  userVisibleOnly: true,
  applicationServerKey: '<the VAPID public key>',
})
console.log(JSON.stringify(sub))
```

The public key is not a secret. Copy `endpoint`, `keys.p256dh` and `keys.auth`.

- [ ] **Step 5: Deploy and run the probe**

Push, `gh run watch`, then have the owner run `spikePush:probe` from the Convex dashboard with those
three values.

- [ ] **Step 6: Record what happened**

**Success:** `{ statusCode: 201 }` and a notification appears on the device.

**The failure signals, and what each means:**

| Symptom | Meaning |
|---|---|
| `Buffer is not defined`, `crypto.createECDH is not a function` | `'use node'` is not giving this module a Node runtime. Tasks 11-13 need redesigning. |
| `403` from the push service | The VAPID keypair does not match what the subscription was created with. Re-subscribe with the deployed public key. |
| `410` | The subscription is already stale. Re-subscribe. |
| Module resolution failure at deploy | `web-push` cannot be bundled for the Node action. Check whether it needs declaring as an external. |

Paste the outcome into `bd`. **If this fails, stop and re-plan rather than working around it** —
that is exactly the blocker-surfacing rule, and a workaround built on a runtime that cannot do
crypto will not be a workaround.

- [ ] **Step 7: Delete the probe**

```bash
cd /home/cdub/projects/wordle-teams && git rm v2/convex/spikePush.ts && git commit -m "spike(phase6): S2 answered — remove the probe" && git push origin feat/v2-replatform && gh run watch
```

---

## Task 11: Push storage and delivery

**Files:**
- Create: `v2/convex/push.ts`
- Create: `v2/convex/pushSend.ts`
- Test: `v2/convex/push.test.ts`
- Modify: `v2/convex/reminders.ts`

**Do not start until Task 10 has answered S2.**

- [ ] **Step 1: Write the failing subscription tests**

**UNVERIFIED.**

```typescript
import { convexTest } from 'convex-test'
import { describe, expect, test } from 'vitest'
import schema from './schema.ts'
import { aPlayer } from './fixtures.ts'
import { removeByEndpointFor, saveSubscriptionFor, subscriptionsForPlayer } from './push.ts'

const SUB = {
  endpoint: 'https://fcm.googleapis.com/fcm/send/abc',
  p256dh: 'BEl6dxjb',
  auth: 'k1JqTmFR',
}

describe('saveSubscriptionFor', () => {
  test('stores an endpoint for a player', async () => {
    const t = convexTest(schema)
    const playerId = await t.run(async (ctx) => ctx.db.insert('players', aPlayer()))
    await t.run(async (ctx) => saveSubscriptionFor(ctx, playerId, SUB))

    const rows = await t.run(async (ctx) => ctx.db.query('pushSubscriptions').collect())
    expect(rows).toHaveLength(1)
    expect(rows[0].endpoint).toBe(SUB.endpoint)
    expect(rows[0].playerId).toBe(playerId)
  })

  test('the same endpoint twice updates rather than duplicating', async () => {
    // A browser can hand back the same endpoint with refreshed keys — that is a
    // renewal, not a second device. Convex has no unique constraints, so this is
    // the only thing stopping one device accumulating a row per sign-in and
    // getting N copies of every notification.
    const t = convexTest(schema)
    const playerId = await t.run(async (ctx) => ctx.db.insert('players', aPlayer()))
    await t.run(async (ctx) => saveSubscriptionFor(ctx, playerId, SUB))
    await t.run(async (ctx) =>
      saveSubscriptionFor(ctx, playerId, { ...SUB, p256dh: 'ROTATED' }),
    )

    const rows = await t.run(async (ctx) => ctx.db.query('pushSubscriptions').collect())
    expect(rows).toHaveLength(1)
    expect(rows[0].p256dh).toBe('ROTATED')
  })

  test('two devices are two rows', async () => {
    const t = convexTest(schema)
    const playerId = await t.run(async (ctx) => ctx.db.insert('players', aPlayer()))
    await t.run(async (ctx) => saveSubscriptionFor(ctx, playerId, SUB))
    await t.run(async (ctx) =>
      saveSubscriptionFor(ctx, playerId, { ...SUB, endpoint: 'https://push.example/phone' }),
    )

    const rows = await t.run(async (ctx) => ctx.db.query('pushSubscriptions').collect())
    expect(rows).toHaveLength(2)
  })
})

describe('subscriptionsForPlayer', () => {
  test('returns only that player&apos;s', async () => {
    const t = convexTest(schema)
    const mine = await t.run(async (ctx) => ctx.db.insert('players', aPlayer()))
    const theirs = await t.run(async (ctx) =>
      ctx.db.insert('players', aPlayer({ email: 'other@example.com' })),
    )
    await t.run(async (ctx) => saveSubscriptionFor(ctx, mine, SUB))
    await t.run(async (ctx) =>
      saveSubscriptionFor(ctx, theirs, { ...SUB, endpoint: 'https://push.example/theirs' }),
    )

    const rows = await t.run(async (ctx) => subscriptionsForPlayer(ctx, mine))
    expect(rows).toHaveLength(1)
    expect(rows[0].endpoint).toBe(SUB.endpoint)
  })
})

describe('removeByEndpointFor', () => {
  test('deletes exactly the one row', async () => {
    const t = convexTest(schema)
    const playerId = await t.run(async (ctx) => ctx.db.insert('players', aPlayer()))
    await t.run(async (ctx) => saveSubscriptionFor(ctx, playerId, SUB))
    await t.run(async (ctx) =>
      saveSubscriptionFor(ctx, playerId, { ...SUB, endpoint: 'https://push.example/kept' }),
    )

    await t.run(async (ctx) => removeByEndpointFor(ctx, SUB.endpoint))

    const rows = await t.run(async (ctx) => ctx.db.query('pushSubscriptions').collect())
    expect(rows).toHaveLength(1)
    expect(rows[0].endpoint).toBe('https://push.example/kept')
  })

  test('removing an endpoint that is not there is not an error', async () => {
    // The 410 path can race a sign-out that already removed the row. A throw
    // here would turn a successful cleanup into a failed action.
    const t = convexTest(schema)
    await expect(
      t.run(async (ctx) => removeByEndpointFor(ctx, 'https://push.example/ghost')),
    ).resolves.not.toThrow()
  })
})
```

- [ ] **Step 2: Implement `convex/push.ts`**

**UNVERIFIED.** Default runtime — queries and mutations only, because a `'use node'` file cannot
hold either.

```typescript
/**
 * Web push subscription storage.
 *
 * SPLIT FROM pushSend.ts DELIBERATELY, and not for tidiness: a 'use node' file
 * can contain only actions, so the reads and writes the delivery action needs
 * cannot live beside it and are reached through ctx.runQuery / ctx.runMutation.
 */
import { v } from 'convex/values'
import { internalMutation, internalQuery, mutation, query } from './_generated/server'
import { requirePlayer } from './access.ts'
import type { Doc, Id } from './_generated/dataModel'
import type { MutationCtx, QueryCtx } from './_generated/server'

type SubscriptionInput = { endpoint: string; p256dh: string; auth: string }

export async function saveSubscriptionFor(
  ctx: MutationCtx,
  playerId: Id<'players'>,
  subscription: SubscriptionInput,
): Promise<void> {
  // UPSERT ON ENDPOINT. Convex has no unique constraints, and a browser hands
  // back the same endpoint with refreshed keys on renewal — so a blind insert
  // gives one device a row per sign-in, and that device N copies of every
  // notification.
  const existing = await ctx.db
    .query('pushSubscriptions')
    .withIndex('by_endpoint', (q) => q.eq('endpoint', subscription.endpoint))
    .first()

  if (existing) {
    await ctx.db.patch(existing._id, {
      // The endpoint can migrate between accounts on a shared device.
      playerId,
      p256dh: subscription.p256dh,
      auth: subscription.auth,
    })
    return
  }

  await ctx.db.insert('pushSubscriptions', {
    playerId,
    endpoint: subscription.endpoint,
    p256dh: subscription.p256dh,
    auth: subscription.auth,
    createdAt: Date.now(),
  })
}

export async function subscriptionsForPlayer(
  ctx: QueryCtx,
  playerId: Id<'players'>,
): Promise<Array<Doc<'pushSubscriptions'>>> {
  return await ctx.db
    .query('pushSubscriptions')
    .withIndex('by_player', (q) => q.eq('playerId', playerId))
    .collect()
}

export async function removeByEndpointFor(ctx: MutationCtx, endpoint: string): Promise<void> {
  const existing = await ctx.db
    .query('pushSubscriptions')
    .withIndex('by_endpoint', (q) => q.eq('endpoint', endpoint))
    .first()
  // Absent is success, not failure. The 410 path can race a sign-out that
  // already removed the row, and a throw would turn a completed cleanup into a
  // failed action.
  if (existing) await ctx.db.delete(existing._id)
}

/**
 * The VAPID public key the browser needs to subscribe.
 *
 * A QUERY RATHER THAN A `VITE_` VARIABLE, so there is one source of truth. A
 * second copy in a second config system is a second thing to set correctly on
 * two deployments, and getting it wrong produces a subscription encrypted to a
 * key nobody holds — which fails at delivery, hours later, not at subscribe.
 *
 * NULL RATHER THAN A THROW when unset, so the UI can hide the Push switch on a
 * deployment where push is not configured instead of offering a control that
 * cannot work.
 */
export const publicKey = query({
  args: {},
  handler: async () => process.env.VAPID_PUBLIC_KEY ?? null,
})

export const savePushSubscription = mutation({
  args: { endpoint: v.string(), p256dh: v.string(), auth: v.string() },
  handler: async (ctx, subscription) => {
    const player = await requirePlayer(ctx)
    await saveSubscriptionFor(ctx, player._id, subscription)
  },
})

export const removePushSubscription = mutation({
  args: { endpoint: v.string() },
  handler: async (ctx, { endpoint }) => {
    // requirePlayer for the auth check, even though the endpoint alone would
    // find the row: an unauthenticated caller must not be able to unsubscribe a
    // stranger's device by guessing or replaying an endpoint.
    await requirePlayer(ctx)
    await removeByEndpointFor(ctx, endpoint)
  },
})

export const subscriptionsFor = internalQuery({
  args: { playerId: v.id('players') },
  handler: async (ctx, { playerId }) => await subscriptionsForPlayer(ctx, playerId),
})

export const removeByEndpoint = internalMutation({
  args: { endpoint: v.string() },
  handler: async (ctx, { endpoint }) => await removeByEndpointFor(ctx, endpoint),
})
```

- [ ] **Step 3: Implement `convex/pushSend.ts`**

**UNVERIFIED.** `'use node'`, actions only.

```typescript
'use node'

import { v } from 'convex/values'
import webpush from 'web-push'
import { internalAction } from './_generated/server'
import { internal } from './_generated/api'

const RETRY_DELAY_MS = 60_000

/**
 * Deliver one player's reminder to every endpoint they have registered.
 *
 * 'use node' IS LOAD-BEARING. web-push signs a VAPID JWT and encrypts the
 * payload with AES128GCM, both of which need Node crypto that Convex's default
 * runtime does not have. Proven on beta before this file was written — see
 * spike S2, and Phase 5's `Buffer is not defined`, which is the same failure
 * one phase earlier and reached production-shaped code through four green
 * gates.
 *
 * `attempt` BOUNDS THE RETRY. This action reschedules ITSELF, so without a stop
 * condition a push service having a bad hour becomes an infinite loop against
 * it. One retry, then log and stop. The bound is an argument checked in one
 * place rather than a comment promising restraint.
 *
 * WHY A RETRY AT ALL: sweep claims a player before delivering (divergence 16),
 * and the hour window makes each player eligible during exactly one cron run
 * per day — so a failure here is not picked up by the next tick. Nothing else
 * would try again.
 */
export const deliverTo = internalAction({
  args: { playerId: v.id('players'), attempt: v.number() },
  handler: async (ctx, { playerId, attempt }) => {
    const subject = process.env.VAPID_SUBJECT
    const publicKey = process.env.VAPID_PUBLIC_KEY
    const privateKey = process.env.VAPID_PRIVATE_KEY

    // A MISCONFIGURATION, NOT AN OUTAGE, and worth telling apart in the log —
    // the same distinction Phase 5 drew on both billing paths. Retrying would
    // not help, so do not.
    if (!subject || !publicKey || !privateKey) {
      console.error('[reminders] VAPID is not configured on this deployment', {
        hasSubject: Boolean(subject),
        hasPublicKey: Boolean(publicKey),
        hasPrivateKey: Boolean(privateKey),
      })
      return
    }

    webpush.setVapidDetails(subject, publicKey, privateKey)

    const subscriptions = await ctx.runQuery(internal.push.subscriptionsFor, { playerId })
    if (subscriptions.length === 0) return

    const payload = JSON.stringify({
      title: 'Wordle Teams',
      body: "You have not entered today's board yet. Don't miss out on those points!",
      url: '/',
    })

    let transientFailure = false

    for (const subscription of subscriptions) {
      try {
        await webpush.sendNotification(
          {
            endpoint: subscription.endpoint,
            keys: { p256dh: subscription.p256dh, auth: subscription.auth },
          },
          payload,
        )
      } catch (error) {
        const statusCode = (error as { statusCode?: number }).statusCode

        // 404/410 mean the browser threw the subscription away — an uninstall, a
        // cleared profile, a revoked permission. Expected, not an error, and the
        // row must go or it is retried forever.
        if (statusCode === 404 || statusCode === 410) {
          await ctx.runMutation(internal.push.removeByEndpoint, {
            endpoint: subscription.endpoint,
          })
          continue
        }

        // Everything else. Note the endpoint is NOT logged: it is a capability
        // URL, and anyone holding it can push to that device.
        console.error('[reminders] push delivery failed', { playerId, statusCode }, error)
        transientFailure = true
      }
    }

    if (transientFailure && attempt === 0) {
      await ctx.scheduler.runAfter(RETRY_DELAY_MS, internal.pushSend.deliverTo, {
        playerId,
        attempt: 1,
      })
    }
  },
})
```

- [ ] **Step 4: Wire it into the sweep**

In `v2/convex/reminders.ts`, replace the `// Push is scheduled in Task 11` comment with:

```typescript
      if (player.reminderDeliveryMethods.includes('push')) {
        await ctx.scheduler.runAfter(0, internal.pushSend.deliverTo, {
          playerId: player._id,
          attempt: 0,
        })
      }
```

- [ ] **Step 5: Add a sweep test for the scheduled push**

`convex-test` exposes the scheduler; assert a job was scheduled for a `['push']` player and none for
an `['email']` one. Read `convex-test`'s API for the exact accessor rather than guessing.

- [ ] **Step 6: Tests, four gates, deploy, and send yourself one**

Turn Push on in the settings dialog on beta, set the reminder time to the next hour, and confirm the
notification arrives on a real phone. That is the other half of the done-when.

- [ ] **Step 7: Commit**

Commit as `feat(push): deliver reminders to registered endpoints`.

---

## Task 12: The Push switch

**Files:**
- Create: `v2/src/lib/push-subscribe.ts`
- Test: `v2/src/lib/push-subscribe.test.ts`
- Modify: `v2/src/components/settings/notifications-tab.tsx`
- Modify: `v2/e2e/settings.spec.ts`

- [ ] **Step 1: Write the failing encoding tests**

**VERIFIED** — these six assertions were executed against Node 22 and passed 6/6, using a real
P-256 keypair from WebCrypto rather than invented bytes.

```typescript
import { describe, expect, test } from 'vitest'
import { urlBase64ToUint8Array } from './push-subscribe.ts'

describe('urlBase64ToUint8Array', () => {
  test('decodes an unpadded url-safe string', () => {
    // 'YWJjZA' is 'abcd' base64url without padding — what pushManager hands back.
    expect(Array.from(urlBase64ToUint8Array('YWJjZA'))).toEqual([97, 98, 99, 100])
  })

  test('decodes an already-padded string too', () => {
    // (4 - 0 % 4) % 4 must be 0 rather than 4. Nothing stops a hand-set env var
    // carrying padding.
    expect(Array.from(urlBase64ToUint8Array('YWJjZA=='))).toEqual([97, 98, 99, 100])
  })

  test('translates the url-safe alphabet back', () => {
    // '-' and '_' are base64url's substitutes for '+' and '/'. A VAPID key
    // containing either decodes to the wrong bytes without this, and the failure
    // surfaces as a 403 from the push service rather than as an error here.
    expect(Array.from(urlBase64ToUint8Array('--__'))).toEqual([251, 239, 255])
  })

  test('a real VAPID application server key decodes to 65 bytes starting 0x04', () => {
    // An uncompressed P-256 point. The length is the check that matters:
    // pushManager rejects a key of any other size with an opaque error.
    const key =
      'BEl6dxjbRhIu1yTPy0iBk7-5eXVc4RRTVEnJcO3vBBUvSHhVJfKvXFB0Q0Mv8G7lQ0d5r6ThPNmQ0lYqTmFRPjA'
    const bytes = urlBase64ToUint8Array(key)
    expect(bytes.length).toBe(65)
    expect(bytes[0]).toBe(0x04)
  })
})
```

The literal key in the last test is structurally valid and the test **passes as written** —
verified: 87 characters, decoding to 65 bytes, first byte `0x04`. It is not a key anybody holds,
which is fine because the assertion is about shape. Swapping in the real public key from Task 10
Step 1 would make it slightly more honest; the private key never appears anywhere but Convex env.

- [ ] **Step 2: Implement**

**VERIFIED** — this exact function passed the round-trip and residue tests.

```typescript
/**
 * pushManager.subscribe wants the application server key as raw bytes, and
 * every transport we have gives it to us as base64url. Both halves of that
 * conversion are here.
 *
 * Getting this wrong does not fail here. It produces a subscription encrypted
 * to a key nobody holds, which surfaces as a 403 from the push service, hours
 * later, inside a Convex action.
 */
export function urlBase64ToUint8Array(base64Url: string): Uint8Array {
  const padding = '='.repeat((4 - (base64Url.length % 4)) % 4)
  const base64 = (base64Url + padding).replace(/-/g, '+').replace(/_/g, '/')
  const raw = atob(base64)
  const bytes = new Uint8Array(raw.length)
  for (let i = 0; i < raw.length; i += 1) bytes[i] = raw.charCodeAt(i)
  return bytes
}

export function uint8ArrayToUrlBase64(bytes: Uint8Array): string {
  let binary = ''
  for (const byte of bytes) binary += String.fromCharCode(byte)
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')
}
```

Then the subscribe flow itself, **UNVERIFIED**: request `Notification.requestPermission()`, bail if
it is not `'granted'`, `await navigator.serviceWorker.ready`, `pushManager.subscribe` with
`userVisibleOnly: true` and the decoded key, read `getKey('p256dh')` and `getKey('auth')` back out
through `uint8ArrayToUrlBase64`, and hand all three to `savePushSubscription`.

- [ ] **Step 3: Add the switch**

In `notifications-tab.tsx`, beside the Email switch. Three rules:

- Hide the switch entirely when `api.push.publicKey` returns `null` — push is not configured on this
  deployment and a control that cannot work is worse than no control.
- On denied permission: toast, leave the switch off, and **do not** write `'push'` into
  `reminderDeliveryMethods`. A method the browser will never honour is worse than no method.
- Turning it off removes the subscription *and* the method.

- [ ] **Step 4: Extend the e2e spec**

Grant the permission at the context level so the browser prompt never appears:

```typescript
test.use({ permissions: ['notifications'] })
```

Assert the subscription reached Convex. Do not fake the delivery leg — it is not e2e-testable and a
mocked assertion would only prove the mock was called.

- [ ] **Step 5: Tests, four gates, commit, push**

Commit as `feat(push): a Push switch that refuses to lie about permission`.

---

## Task 13: The real service worker

**Files:**
- Modify: `v2/src/sw.ts` (replacing the Task 2 stub)
- Create: `v2/public/offline.html`
- Create: `v2/src/lib/register-sw.ts`
- Modify: `v2/src/routes/__root.tsx`
- Modify: `v2/vite.config.ts`

- [ ] **Step 1: Write the offline page**

`v2/public/offline.html`. **Static, not a route** — `injectManifest` precaches build *output*, and a
server-rendered `/offline` route has no build-time artifact to hash and store. It would look
configured, build green, and be absent exactly when it is needed.

Self-contained: inline CSS, no external font, no script. Match the dark background `#0a0a0a` from
`manifest.json`. Say the app needs a connection, and that scores are safe.

- [ ] **Step 2: Write the service worker**

**UNVERIFIED.** Four responsibilities, and the comments explaining why each is shaped as it is:

```typescript
/// <reference lib="webworker" />
import { precacheAndRoute, createHandlerBoundToURL } from 'workbox-precaching'
import { NavigationRoute, registerRoute } from 'workbox-routing'
import { NetworkOnly } from 'workbox-strategies'

declare const self: ServiceWorkerGlobalScope

// 1. Static assets only.
precacheAndRoute(self.__WB_MANIFEST)

// 2. NAVIGATIONS ARE NEVER CACHED, with the offline page as the fallback.
//
// v1 does the opposite, and wordle-teams-bpt measured what that costs: serwist's
// defaultCache matches its HTML rule on the REQUEST's Content-Type, which a
// navigation GET never sends, so that rule is dead code and every same-origin
// document falls through to a NetworkFirst catch-all writing into a cache named
// 'others'. One user's rendered /me dashboard then sits in Cache Storage for up
// to 24 hours and can be served to the next person on a shared device after
// sign-out.
//
// Nothing here is cacheable anyway: every screen reads live Convex data.
registerRoute(
  new NavigationRoute(
    new NetworkOnly({
      plugins: [
        {
          handlerDidError: async () => caches.match('/offline.html'),
        },
      ],
    }),
  ),
)

// 3. Push.
self.addEventListener('push', (event) => {
  const data = event.data?.json() ?? {}
  event.waitUntil(
    self.registration.showNotification(data.title ?? 'Wordle Teams', {
      body: data.body ?? "You have not entered today's board yet.",
      // v1 points at /icon.png and /badge.png, both marked TODO and neither
      // present in public/. This one exists.
      icon: '/wt-icon-192x192.png',
      badge: '/wt-icon-192x192.png',
      data: { url: data.url ?? '/' },
    }),
  )
})

self.addEventListener('notificationclick', (event) => {
  event.notification.close()
  const url = event.notification.data?.url ?? '/'
  event.waitUntil(
    self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then((clients) => {
      // Focus a tab that is already open rather than opening a second one.
      const existing = clients.find((client) => 'focus' in client)
      if (existing) return existing.focus()
      return self.clients.openWindow(url)
    }),
  )
})

// 4. THE SERWIST KILL SWITCH.
//
// v1 registers /sw.js; this is served at /sw.js. At cutover the domain points at
// the Worker, the browser byte-compares the script on the next navigation, finds
// it different, and installs this one. skipWaiting plus clients.claim make that
// takeover immediate rather than two visits later, and deleting every cache we
// did not create removes serwist's 'others' and 'pages'.
//
// Nobody can be stranded on a stale serwist cache, because the only way to keep
// the old worker is to never visit the site again.
self.addEventListener('install', () => {
  void self.skipWaiting()
})

self.addEventListener('activate', (event) => {
  event.waitUntil(
    (async () => {
      const names = await caches.keys()
      await Promise.all(
        names
          .filter((name) => !name.startsWith('workbox-') && !name.includes('precache'))
          .map((name) => caches.delete(name)),
      )
      await self.clients.claim()
    })(),
  )
})
```

**Check the cache-name predicate against reality.** Workbox's own cache names are configurable and
the `startsWith('workbox-')` guess may not match what this build actually produces. Read
`caches.keys()` in DevTools after a build and make the filter match, or it will delete its own
precache on every activate.

- [ ] **Step 3: Register it exactly once**

`v2/src/lib/register-sw.ts` — ports the semantics of `e70592d` and
`src/components/service-worker-registration.tsx`, whose comment lists the legitimate failure causes:
private browsing that disables the API, extensions or enterprise policy blocking the fetch,
automated browsers, transient network errors mid-deploy. The PWA is an enhancement, so log a warning
and carry on; never let it reject unhandled.

`injectRegister: false` in `vite.config.ts` is what makes "exactly once" structural rather than a
promise. v1 needed a comment and a config flag to say the same thing, and a future edit could have
undone either.

- [ ] **Step 4: Link the manifest**

In `v2/src/routes/__root.tsx`'s `head()`, add to `links`:

```typescript
      { rel: 'manifest', href: '/manifest.json' },
```

and to `meta`:

```typescript
      { name: 'theme-color', content: '#0a0a0a' },
```

`#0a0a0a` matches `public/manifest.json`'s `theme_color`. **This is what makes the app installable
at all** — `manifest.json` has been correct since commit `bc8e061` and nothing has ever linked it.

Call `registerServiceWorker()` from a client-only effect in `RootComponent`.

- [ ] **Step 5: Verify offline, install, and the cache purge**

```bash
cd /home/cdub/projects/wordle-teams/v2 && pnpm build > /tmp/t13.txt 2>&1; echo "EXIT=$?"
```

Then deploy to beta and check, in a real browser:

1. DevTools → Application → Manifest shows Wordle Teams with four icons and no errors.
2. Application → Service Workers shows exactly **one** registration.
3. Load `/`, then Network → Offline, then reload → the offline page, not the browser's error.
4. Application → Cache Storage after loading `/` → **no** entry for the dashboard document.
5. Install to a phone home screen and open it. It opens standalone, portrait.

Point 4 is `wordle-teams-bpt`'s acceptance criterion, and satisfying it here is what lets that issue
close.

- [ ] **Step 6: Four gates, commit, push**

Commit as `feat(pwa): a service worker that installs, works offline, and evicts serwist`.

---

## Task 14: Divergences, issue close-out, and the phase handoff

**Files:**
- Modify: `docs/design-system/V2-ADDENDUM.md`

- [ ] **Step 1: Write divergences 14-18 into §7a**

The table at `docs/design-system/V2-ADDENDUM.md:309` has columns `# | Divergence | Added | Why`.
Match its style — the existing entries are long and explain the measurement behind each. Add:

| # | Divergence |
|---|---|
| 14 | Weekend rule evaluated in the player's zone, not the server's |
| 15 | Ten-day activity window evaluated in the player's zone, not the server's |
| 16 | `lastBoardEntryReminder` written before delivery, not after |
| 17 | Web push actually delivers |
| 18 | Navigations are never cached; one static offline page |

For 14 and 15, cite the measurement: 733 of production's 7468 score rows fall on a different
calendar day in UTC than in `America/Chicago`, across 57 player timezones.

For 17, be explicit that this is not "v2 fixed a bug" but "v1 never built the feature" — the
subscribe route returns before doing anything, the VAPID key is the literal string
`'YOUR_PUBLIC_VAPID_KEY'`, the switch is commented out, and the push workflow was never registered
with Novu.

Record the **non**-divergence too: the midnight-wrapping hour window is ported unchanged and pinned
in a test, because it is unreachable behind the eighteen-option picker.

- [ ] **Step 2: Close what this phase actually resolved**

```bash
cd /home/cdub/projects/wordle-teams && bd close wt-ksh.7.1 --reason "The manifest itself was already correct as of bc8e061 — what was missing was the link. __root.tsx now carries rel=manifest and theme-color, so v2 is installable for the first time."
cd /home/cdub/projects/wordle-teams && bd close wordle-teams-bpt --reason "Resolved by replacement rather than by fixing v1. v2's service worker handles navigations with NetworkOnly and an offline fallback, so no document reaches Cache Storage — verified in DevTools: no dashboard entry after loading it. The activate handler also purges serwist's caches at cutover."
```

- [ ] **Step 3: Verify every acceptance criterion in the spec**

Walk all thirteen in `§Acceptance Criteria`. For each, name the command you ran or the thing you
observed. **Do not mark one green from reasoning** — that is the failure mode this phase's spec was
written against.

- [ ] **Step 4: Do NOT close `wt-ksh.4`**

Its done-when is the owner's side-by-side comparison on a real phone. Phase 6's PWA work is the
natural moment for it, but it is the owner's call, not a task outcome.

- [ ] **Step 5: Final gates, push, and confirm**

```bash
cd /home/cdub/projects/wordle-teams/v2 && pnpm lint > /tmp/g-lint.txt 2>&1; echo "LINT=$?"
cd /home/cdub/projects/wordle-teams/v2 && pnpm typecheck > /tmp/g-tsc.txt 2>&1; echo "TSC=$?"
cd /home/cdub/projects/wordle-teams/v2 && pnpm test:once > /tmp/g-test.txt 2>&1; echo "TEST=$?"
cd /home/cdub/projects/wordle-teams/v2 && pnpm build > /tmp/g-build.txt 2>&1; echo "BUILD=$?"
cd /home/cdub/projects/wordle-teams/v2 && pnpm e2e > /tmp/g-e2e.txt 2>&1; echo "E2E=$?"
```

Then:

```bash
cd /home/cdub/projects/wordle-teams && git pull --rebase && bd dolt push && git push && git status
```

`git status` MUST show up to date with origin. Work is not complete until `git push` succeeds.

- [ ] **Step 6: Write the handoff**

`docs/superpowers/handoffs/YYYY-MM-DD-phase7-start.md`, following
`2026-08-27-phase6-start.md` — self-contained, so a fresh session needs nothing but that file.

It must carry: whether Phase 5's sandbox pass ever ran (`wordle-teams-02c`, blocked on
`wordle-teams-6tp`); that Phase 7 is blocked on **both** phases; divergences 14-18 and what the
parity walk should expect from each; whatever S1, S2 and S3 actually returned, since all three are
facts about this runtime that no gate records; and any rule in this plan's *Before you start* that
turned out to be wrong.

---

## Notes for whoever executes this

**Run reviewers serially. Never dispatch two implementers in parallel. Do not commit while a
subagent runs** — a subagent's `--amend` swallows any commit that lands mid-flight, so queue
controller commits.

**Subagents must NEVER push.** The standing authorization to push `feat/v2-replatform` and let it
deploy to beta is the controller's, and it is beta only — not prod, not main.

**When a snippet marked UNVERIFIED turns out to be wrong, fix the plan too.** Phase 5's plan stayed
wrong in fourteen places while the work around it went green, including a "release gate" test that
was a byte-for-byte duplicate of the test above it. A plan nobody corrects is a plan that teaches
the next reader something false.

**A commit can falsify a comment it writes**, in the same commit, sometimes in a different file.
Sweep the comments you write, not only the ones you find. Comment accuracy is a defect here, not a
nit.
