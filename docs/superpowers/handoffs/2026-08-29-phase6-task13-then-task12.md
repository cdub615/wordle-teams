# Handoff — Phase 6: Task 13 (the real service worker), then Task 12 (the Push switch)

**Written 2026-08-29.** Supersedes `2026-08-28-phase6-task12-then-task7.md`, which
told you to do Task 12 next. **Task 12 is blocked** — see below.

If you are a fresh Claude session: read this whole file and follow it. It is the
prompt.

---

## Start here

Run `bd prime`. Then `bd show wt-ksh.7` for the epic, `bd show wt-ksh.7.30`
(Task 13) and `bd show wt-ksh.7.29` (Task 12). **Read Task 13's notes before the
plan** — the plan's shape for it is dead.

Plan: `docs/superpowers/plans/2026-08-27-v2-phase6-reminders-pwa.md`.
Spec: `docs/superpowers/specs/2026-08-27-v2-phase6-reminders-pwa-design.md`.

**Use `superpowers:subagent-driven-development`**: fresh implementer per task,
then spec-compliance review, then code-quality review, then fix, then close.
It has found something real in **every** task this phase — most recently a
Critical where the entire feature's only call site could be deleted with tests,
typecheck and lint all staying green. Tell every reviewer to **mutation-test**,
and to run timezone-touching mutants under `TZ=UTC` too.

---

## Where Phase 6 stands: 12 of 15 done

Closed: Tasks 0, 1, 2, 3, 4, 5, 6, 7, 8, 10.
Code-complete and deployed but **not closable** without a human observing a real
delivery: **11** and **9**.
Open: **13 (yours first)**, **12 (yours second)**, 14, plus `wt-ksh.7.32`,
`wt-ksh.7.1`, `wordle-teams-vsx`, `wordle-teams-uhx`.

Baseline: **776 tests across 50 files**, all four gates green, full suite also
green under `TZ=UTC`, and the **e2e suite is 21 passed**. Branch is up to date
with origin at `fa9ffc0`, deployed and healthy on beta.

---

## Read this first: the plan's Task 13 is dead, and here is what replaces it

Spike S3 answered **no**. `vite-plugin-pwa@1.3.0` emits nothing in this repo:
`pnpm build` exits 0, `dist` holds no `sw.js` and no workbox file, and the log
never mentions pwa, workbox or service worker. No error, no warning, not even the
plugin's own banner.

Root cause, read out of the plugin's source rather than guessed:

- `dist/index.js:986` — `configResolved(config)` does `ctx.viteConfig = config`,
  unconditionally, with no per-environment awareness.
- `dist/index.js:422` — `closeBundle` guards on `if (!ctx.viteConfig.build.ssr)`.

`vite build` here runs Vite's Environment API multi-environment build, driven by
`@cloudflare/vite-plugin`, resolving root → client (`build.ssr` false) → ssr
(`build.ssr` true). The ssr config lands **last** and pins `build.ssr` true, so
the guard never passes. **1.3.0 is the latest published version**, and scoping the
plugins with `applyToEnvironment` to the client environment does not help either
— measured; `applyToEnvironment` gates build hooks but `configResolved` is global.

**Owner-approved replacement:** bundle `src/sw.ts` with **esbuild**, then inject
the precache manifest with **`workbox-build`'s `injectManifest`**, as a step the
`build` script runs **after** `vite build`, writing `dist/client/sw.js`. That
keeps Workbox and puts the worker at root scope by construction — and scope is
the whole game, because a worker can only control the path it is served from, so
a hashed file under `assets/` would collapse the design.

Already in place from the spike (`d73b846`): `src/sw.ts` as a starting stub, plus
`workbox-build` and `workbox-precaching`. `vite-plugin-pwa` and `workbox-window`
were removed rather than left as dead config.

**Two gotchas measured during the spike:**

1. Any file under `src/` naming `ServiceWorkerGlobalScope` gets **Cloudflare's**
   Workers-flavoured ambient interface, from `worker-configuration.d.ts` included
   project-wide via tsconfig's `types`. This tsconfig has no `webworker` lib. The
   stub carries an explicit intersection to get `__WB_MANIFEST`. Decide
   deliberately whether to keep riding Cloudflare's type or add the lib.
2. `injectManifest` does **string replacement only** — it does not bundle or
   transpile. That is exactly why the approach is esbuild-then-injectManifest.

**Verify over the wire, not just in `dist`.** Beta returns **404** for `/sw.js`
today (confirmed 2026-08-29). Afterwards check status, **content-type**, and
**cache-control** — a long `max-age` on a service worker delays every future
update and would need a header rule.

---

## Then Task 12, which is blocked until Task 13 lands

`pushManager.subscribe` needs an **active registration**, and v2 has no service
worker at all. Task 12's dependency graph now records this.

Its encoding half is the risky part, and the plan marks those snippets
**VERIFIED**. `getKey('p256dh')` and `getKey('auth')` return `ArrayBuffer`s that
must be base64url-encoded exactly as the VAPID key is decoded. **If they are
mis-encoded, delivery fails silently** — the push service answers 201 and the
browser drops the undecryptable message. A round-trip test is not optional.

**Do not treat a 2xx from `webpush.sendNotification` as proof of delivery**
anywhere — not in a comment, a test, or an acceptance check. A push service
returns 201 **without decrypting**.

---

## What still needs a human, not an agent

**Task 9** needs a real email on beta. On the **beta** deployment set
`REMINDERS_ALLOWLIST` to your own address **first**, then `REMINDERS_ENABLED=true`,
set your reminder time to the next hour, and turn it back off after. Beta holds
copied production rows — real people who already get real reminders from v1 — and
`E2E_TEST_MODE` is not set there, so `sendEmail` suppresses nothing. The allowlist
is the only thing keeping the sweep off them.

**Task 11** needs a notification rendering on a real phone, which needs Task 12.

---

## Running e2e — it is not a gate, and it needs a backend

`pnpm lint`, `typecheck`, `test:once` and `build` **never run Playwright**, and CI
does not either. So any e2e protection exists only when someone runs it.

`pnpm dev` is only vite. `VITE_CONVEX_URL` is `http://127.0.0.1:3210`, a **local**
Convex backend that must be started separately:

```bash
cd v2 && mise exec node@22 -- npx convex dev
```

Node 22 is required because `convex/pushSend.ts` is `'use node'` and this box
defaults to v25.2.1, which the local backend rejects for such a push. With that
running, `pnpm exec playwright test` passes 21/21.

**This matters right now:** `e2e/settings.spec.ts` contains the only thing
standing between the reminder feature and silent inertness — a test asserting a
player with no seeded zone gets one captured. Verified both ways: deleting
`useLocalCapture()` from `Header` turns it red, while tests, typecheck and lint
all stay green.

---

## Rules that have each cost real time this phase

- **Run everything from inside `v2/`, and give EVERY command its own `cd v2`.**
  The shell cwd resets between tool calls — it bit again this session.
- **NEVER pipe a command whose exit code matters.** zsh's `PIPESTATUS` is empty.
- **Run all four gates every time.** `build` does not typecheck; lint reaches
  `public/*.js` that build only copies.
- **A timezone test can pass in CI while proving nothing.** `Intl.DateTimeFormat`
  with `timeZone: undefined` falls back to the **host** zone. Deleting the sweep's
  `timeZone` guard failed on this box (CDT) and passed clean under `TZ=UTC`, which
  is what CI runs. Run timezone mutants both ways.
- **`gh run list --limit 1` right after a push returns the PREVIOUS run.** Select
  by SHA, and verify the deploy's effect — for Convex changes, the "Deploy Convex
  and build the client" step, not just the overall green.
- **Backticks inside `git commit -m "..."` or `bd note "..."` are executed by the
  shell.** Use `git commit -F -` and quoted heredocs.
- **`convex run --prod` silently hits the LOCAL backend.** `convex env` reaches
  beta; `convex run` cannot.
- **DO NOT USE `--no-verify`.** The hook chains to a PII guard — **this repository
  is public**. Never put a real email in a commit, test, comment or beads issue.
- **Subagents must NEVER push.** Committing is theirs; pushing is yours. Be ready
  for one to die mid-commit — an implementer lost its connection right before
  amending this week, and the fix was to verify and commit its staged work
  directly rather than re-run it.
- **Comment accuracy is a defect, not a nit.** Every review round this phase found
  at least one comment asserting something untrue.

## Standing authorization

Push `feat/v2-replatform` and let it deploy to beta without asking; watch every
deploy. **Not prod, not main.** Do **not** flip `REMINDERS_ENABLED` on any
deployment without asking.
