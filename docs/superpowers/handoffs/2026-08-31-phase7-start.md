# Handoff — Phase 7: Parity audit + hardening

**Written 2026-08-31, at the close of Phase 6.**

If you are a fresh Claude session: read this whole file and follow it. It is the
prompt. You do not need any previous conversation.

---

## Start here

Run `bd prime`. Then `bd show wt-ksh.8` (this phase's epic) and `bd show wt-ksh`
(the re-platform epic). Phase 6's epic is `wt-ksh.7`.

**Before planning any work, read the "Phase 7 is blocked on two phases" section
below.** Two things are unfinished behind you, and one of them is a P1 that would
fail the audit on its first query.

**Do not start building.** This project's global instructions require a planning
gate: clarifying questions, scope boundaries, a Beads epic with the spec as its
body, child issues, and explicit owner approval before any code.

---

## Phase 7 is blocked on two phases, not one

**Phase 5 never finished its verification.** `wordle-teams-02c` (Phase 5's closing
task — divergences 8/12/13, sandbox verification, phase close) is still **open**.
The sandbox pass was never run, blocked on `wordle-teams-6tp`: v2 has exactly one
route to `createProCheckout` (`team-picker.tsx:78`), rendered only when
`atFreeLimit` (`team-picker.tsx:48`), so a player who is not already at the team
cap cannot reach checkout at all.

**Phase 6 is CLOSED** as of 2026-08-31, verified on a real device — see the next
section. It leaves `wt-ksh.7.32`, reparented here.

**And there is a P1 that will break the audit itself:** `wordle-teams-b31`.
`internal.migrate.counts` does six unbounded `.collect()` calls, one on
`dailyScores`, and Convex caps a function execution at 4096 reads.
`verify-parity.mjs:59` calls it as its **first** query. At `--scope=all` — which is
what this phase's audit runs — the verifier fails before comparing a single row.
Beta already holds ~6950 daily scores. **Settle this before the audit, not during
it.** Quickest first step: run `verify-parity.mjs` against beta and see whether it
is already failing.

---

## What Phase 6 shipped

An hourly Convex cron finds players due a board-entry reminder in their own
timezone, claims each by stamping `lastBoardEntryReminder`, sends email through
Resend and schedules a `'use node'` action for web push. A service worker makes
the app installable, serves a static offline page, and evicts v1's serwist caches
at cutover. A settings dialog gives players the controls all of that reads.

All fifteen tasks are closed. **887 tests across 56 files** (up from 705/43 at
the phase's start), all four gates green, the full
suite also green under `TZ=UTC`, and **e2e 22 passed**. Branch `feat/v2-replatform`
is deployed and healthy on beta.

**Divergences 14–18 plus two plan-divergences are written into
`docs/design-system/V2-ADDENDUM.md` §7a**, in the same evidence-cited register as
the first thirteen. Read them before the parity walk — they are what the audit
should *expect* to differ.

---

## Phase 6 is CLOSED — the owner verified it on a real device

**Confirmed 2026-08-31.** Wordle Teams installed as a PWA from beta, a reminder
**email** arrived, and a **push** notification arrived and opened the app when
tapped — **both deliveries from the hourly sweep**, not a manual trigger. That
last detail is what makes it a phase acceptance rather than a component test: it
proves the cron fired, eligibility was decided in the player's own timezone, the
claim was written, and the fan-out reached both Resend and `pushSend.deliverTo`.

It also resolves the ambiguity S2 left open, which no test could — see S2 below.

**The kill switch is back OFF** — the owner turned `REMINDERS_ENABLED` off
immediately after the test, confirmed 2026-08-31. Beta is in its designed resting
state: the cron fires hourly and returns having done nothing.

**Keep it that way, and if you ever turn it on, set `REMINDERS_ALLOWLIST` first,
in the same sitting.** Beta holds copied production rows — real people who already
receive reminders from v1 and have never heard of this beta — and `E2E_TEST_MODE`
is not set there, so `sendEmail`'s throwaway filter suppresses nothing. The env
gate is the *only* protection; the data is not a second layer, because the copy
carries `reminderDeliveryMethods` and `timeZone`
(`scripts/copy-from-supabase.mjs:151-155`). At cutover the runbook does the
opposite deliberately: `REMINDERS_ENABLED=true` on **production** with the
allowlist left empty.

**Do not treat a 2xx from `webpush.sendNotification` as proof of delivery** in any
future work — not in a comment, a test, or an acceptance check. A push service
returns **201 without decrypting**.

## What the three spikes actually returned

All three are facts about this runtime that no gate records.

**S1 — does `Intl` support named timezones on Convex's runtime?** *Yes*, but
**answered on the LOCAL backend, not beta.** Its own correction note records that
`convex run --prod` silently falls back to `127.0.0.1:3210`, and `convex run`
cannot reach beta at all (`deployment:functions:runTestQuery` denied). Full ICU is
present on that runtime binary, which is what `convex/lib/reminders.ts` needed.
**Beta's ICU data is not independently established** — if a timezone ever resolves
oddly in production, re-check on beta specifically rather than trusting this.

**S2 — does `web-push` run in a Convex `'use node'` action?** *Yes*, and this one
**was** answered on beta, by a dashboard probe against `fabulous-goldfish-949`:
`{ ok: true, stage: "sent", statusCode: 201, env: { hasBuffer: true, … } }`.
Note the 201 proves the push service *accepted* the request, nothing more.

**S3 — does `vite-plugin-pwa` build here?** ***No*, and it fails silently.**
`pnpm build` exits 0, `dist` holds no `sw.js`, and the log never mentions pwa,
workbox or service worker — no error, no warning, not even the plugin's banner.
Root cause, from the plugin's own source: `configResolved` does
`ctx.viteConfig = config` unconditionally, and `closeBundle` guards on
`if (!ctx.viteConfig.build.ssr)`. Vite's Environment API multi-environment build,
driven by `@cloudflare/vite-plugin`, resolves root → client → **ssr last**, pinning
`build.ssr = true` forever. **1.3.0 is the latest published version**, and scoping
with `applyToEnvironment` does not help — `configResolved` is a global hook.

The replacement, owner-approved and shipped: **esbuild bundles `src/sw.ts`, then
`workbox-build`'s `injectManifest` writes `dist/client/sw.js`**, as a step the
`build` script runs after `vite build`. It fails loudly on five conditions and
removes the artifact on every failure path.

---

## Rules from Phase 6's plan that turned out to be WRONG

The plan's *Before you start* section carried five rules. Four held. These did not:

- **"A `convex dev` watcher has been running against the local backend since
  2026-08-18."** It was not running; `ps` found zero. Without it, Convex changes
  never reach the local backend Playwright drives. **Start one before trusting any
  e2e run that touches Convex**, and note `convex codegen` needs Node 20/22/24 —
  this box defaults to v25.2.1 and the local backend rejects a `'use node'` push
  under it. `node@22` is installed: `mise exec node@22 -- npx convex dev`.

- **"`convex env` reaches beta."** Only **if you load the prod `CONVEX_DEPLOY_KEY`
  first**. Measured 2026-08-31: a bare `convex env list --prod` returned the
  *local* backend's variables, including `SITE_URL=http://localhost:3000`. The
  same silent fallback as `convex run --prod`, and `--prod` does not save you.
  Before believing any `convex env` output about beta, check for a value only beta
  has.

Two further corrections worth carrying:

- **`convex env get` exits 0 whether or not the variable exists.** Match on the
  "not found" text, never the exit code.
- **e2e is NOT one of the four gates.** Nothing in `lint`/`typecheck`/`test:once`/
  `build` runs Playwright, and CI does not either. Several protections in this
  codebase exist *only* in e2e — including the one standing between the reminder
  feature and silent inertness (`e2e/settings.spec.ts`) — so they hold only when
  someone runs it. That needs a local Convex backend on `127.0.0.1:3210`.

---

## Two acceptance criteria in Phase 6's spec were written too broadly

Both are recorded in the spec's own walk section; the audit should not treat
either as a clean pass.

**Criterion 2** ("the three spikes are answered **on beta**") is **partially met** —
see S1 above.

**Criterion 12** ("No Convex function throws a plain `Error`") is **false as
written**. Eleven non-test convex modules throw plain `Error`s and most predate
Phase 6. The real rule the codebase follows is narrower and better: **anything a
caller sees must be a `ConvexError` via `accessError`**, because plain messages are
redacted in production while `convex-test` never redacts — so no test can catch
that mistake, making it a review-only check. Operator-facing failures with no
user-facing caller correctly use a plain `Error` so they fail loudly in the logs.

Two paths do violate the *real* rule, filed as **`wordle-teams-p37`** (P3):
`teams.ts:686` in the `invitePlayer` mutation, and `polar.ts:270` via
`getCustomerPortalUrl`, whose `siteUrl()` call at `polar.ts:653` sits outside every
`try`. Both require an operator to strip `SITE_URL` from a live deployment.
Phase 7 should decide whether to fix or to document the exception.

---

## Open issues Phase 7 inherits

- `wordle-teams-b31` (**P1**) — the parity verifier's first query exceeds Convex's
  read cap at `--scope=all`. **Blocks the audit.**
- `wordle-teams-02c` (P2) — Phase 5's unfinished close-out and sandbox pass.
- `wordle-teams-6tp` (P2) — one upgrade entry point, gated behind the team cap.
- `wt-ksh.7.32` (P1) — the copy script carries reminder settings; expected to
  differ from production until cutover. **A Phase 7 parity difference to expect,
  not a bug.**
- `wordle-teams-p37` (P3) — the two plain-`Error` paths above.
- `wordle-teams-069` (P3) — delivery-method writes lose updates across a slow
  browser prompt (pre-existing read-modify-write pattern, not introduced by
  Phase 6).
- `wordle-teams-6k7` is **closed**; `wordle-teams-vsx` (P4) and `wordle-teams-uhx`
  (P3) are open and low-priority.
- `wt-ksh.4` is deliberately **left open** — its done-when is the owner's
  side-by-side comparison on a real phone, which is their call, not a task
  outcome.

## The cutover runbook this phase must produce

`wt-ksh.8` is scoped to produce it. Required lines gathered during Phase 6:

1. Set `REMINDERS_ENABLED=true` on the **production** Convex deployment.
2. Leave `REMINDERS_ALLOWLIST` unset/empty — unrestricted is the production
   setting.
3. **Restore** whatever `wt-ksh.7.32` removes from the copy script, so real
   reminder preferences arrive with the cutover copy. Check that issue for what
   was actually taken out — an earlier note claimed the copy carried neither
   `reminder_delivery_methods` nor `time_zone`, which was wrong; it carries both.
4. `wt-ksh.9`'s notes carry two further steps that are not obvious from the epic:
   read the copy's overwrite report at **field** level, and check resurrection by
   hand, because no diff-based report can see a row v2 deleted.

## Rules that have each cost this project real time

- **Run everything from inside `v2/`, and give EVERY command its own `cd v2`.**
  The shell cwd resets between tool calls. It bit twice in Phase 6.
- **NEVER pipe a command whose exit code matters.** zsh's `PIPESTATUS` is empty.
- **Run all four gates every time** — `build` does not typecheck, and lint reaches
  `public/*.js` that build only copies.
- **A timezone test can pass in CI while proving nothing.** `Intl.DateTimeFormat`
  with `timeZone: undefined` falls back to the **host** zone. Deleting the sweep's
  `timeZone` guard failed on the dev box (CDT) and passed clean under `TZ=UTC`,
  which is what CI runs. Run timezone mutants both ways.
- **A round-trip test is not sufficient for a codec you own both halves of.**
  `decode(encode(x)) === x` stayed green with the base64url encoder's `+`→`-` and
  `/`→`_` substitutions deleted, because `atob` reads the standard alphabet and
  our own decoder undid our own bug. Assert on the emitted string.
- **`gh run list --limit 1` right after a push returns the PREVIOUS run.** Select
  by SHA, and verify the deploy's *effect* — for a Convex change, the "Deploy
  Convex and build the client" step, not just the overall green.
- **Backticks inside `git commit -m "..."` or `bd note "..."` are executed by the
  shell.** Use `git commit -F -` and quoted heredocs.
- **DO NOT USE `--no-verify`.** The hook chains to a PII guard — **this repository
  is public**. Never put a real email address in a commit, test, comment or beads
  issue.
- **Subagents must NEVER push.** Committing is theirs; pushing is yours. Be ready
  for one to die mid-commit — an implementer lost its connection right before
  amending in Phase 6, and the fix was to verify and commit its staged work
  directly rather than re-run it.
- **Comment and document accuracy is a defect here, not a nit.** Every review
  round in Phase 6 found at least one claim asserting something untrue.

## The review loop, and why it is not optional

Phase 6 used `superpowers:subagent-driven-development`: a fresh implementer per
task, then a spec-compliance review, then a code-quality review, then fixes, then
close. **It found something real in every single task**, including four Criticals.

Tell every reviewer to **mutation-test**. The recurring finding, three times in
one phase, is worth stating plainly:

> **An extraction can move the untested part rather than shrink it.**

Twice a pure function was pulled out and thoroughly tested while the wiring that
decides whether it is ever called stayed uncovered — and in one case an exact
revert of the fix passed every gate. The other Criticals were a comment claiming a
capability URL was not logged directly above the line that logged it, and a test
that could not distinguish a derived value from a hardcoded one because the test
environment collapsed them to the same string.

## Standing authorization

Push `feat/v2-replatform` and let it deploy to beta without asking; watch every
deploy. **Not prod, not main.** Do **not** flip `REMINDERS_ENABLED` on any
deployment without asking — it is the only thing between a config slip and mailing
every copied production row.
