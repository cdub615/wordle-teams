# Handoff — start Phase 6 (Reminders & PWA)

**Written 2026-08-27, at the end of the Phase 5 session.**

If you are a fresh Claude session: read this whole file and follow it. It is the
prompt. You do not need the previous conversation.

---

## Start here

Start Phase 6 (Reminders & PWA) of the wordle-teams v2 re-platform, on branch
`feat/v2-replatform`. Run `bd prime`, then `bd show wt-ksh.7` — read its NOTES,
they carry two ported bugs and a Supabase-retirement trap.

**USE THE FULL FLOW**, as Phase 5 did: `superpowers:brainstorming` → a design
spec in `docs/superpowers/specs/` → a plan in `docs/superpowers/plans/` → beads
→ then `superpowers:subagent-driven-development` with a fresh implementer per
task and review before closing. Phase 5's artifacts are the model:

- `docs/superpowers/specs/2026-08-26-v2-phase5-polar-design.md`
- `docs/superpowers/plans/2026-08-26-v2-phase5-polar.md`

**Do not skip to task creation.** That is what went wrong at the start of Phase
5 and had to be redone.

---

## What Phase 6 is

Convex cron → reminder-eligibility port → web-push + Resend; `vite-plugin-pwa`,
manifest, install/offline; and a kill switch for the old Serwist service worker.

**Done when** beta sends a real push AND email reminder at the configured time,
and the PWA installs on a phone.

### Three things already written down

1. **The Novu board-entry-reminder templates hardcode public Supabase Storage
   URLs** for `wordle-teams-title.png` and `wt-icon.png`
   (`src/app/novu/workflows/board-entry-reminder/schemas.ts:10,16`). Re-host
   them before Phase 9 retires Supabase, or the emails break after cutover.
2. **Port `e70592d`** — the service worker must register exactly ONCE and handle
   its own failure. v1 shipped duplicate registrations. Amendment A3 in
   `docs/superpowers/specs/2026-07-16-replatform-v2-design.md`.
3. **`wt-ksh.7.1`** — the PWA manifest is still the scaffold's, not Wordle
   Teams', and beta is live. `wordle-teams-bpt` is adjacent: serwist's
   `defaultCache` runs every navigation through NetworkFirst and its HTML rule
   is dead code.

---

## PHASE 5 IS NOT CLOSED

All twelve implementation tasks are done, reviewed and deployed to beta green.
627 unit tests + 17 e2e, four gates green. But the **sandbox verification pass
has not run**, and Phase 5 cannot close until it does.

`bd show wordle-teams-02c` has the full state. Summary:

**Verified against real Polar (sandbox):**

- The webhook endpoint is live at
  `https://fabulous-goldfish-949.convex.site/polar/webhook` — note
  `.convex.site`, **not** `.convex.cloud`. That is the URL to register in Polar.
  No `webhook-id` → 400; bogus signature → 403. The 400 proves
  `POLAR_WEBHOOK_SECRET` is set and reaching the code, because `http.ts` checks
  the secret at `:121` *before* the header at `:144`.
- `getCustomerPortalUrl` works end to end. It returns `no-customer` for the
  owner, which is **correct** — sandbox is a wholly separate instance from
  production, so the owner has no customer there.

**The four token scopes**, one per SDK call in `convex/polar.ts`:

| Scope | Call |
|---|---|
| `checkouts:write` | `:425` `checkouts.create` |
| `customer_sessions:write` | `:657` `customerSessions.create` |
| `checkouts:read` | `:739` `checkouts.get` |
| `customers:write` | `:798` `customers.update` |

**Blocked on a test account (`wordle-teams-6tp`).** The owner's account is
comped pro, so `isPro` is true, so `team-picker.tsx:48`'s `atFreeLimit` is false
and the upgrade CTA never renders — and it is v2's **only** route to
`createProCheckout`. Running the rest needs a **fresh non-pro account on beta**
(not an `e2e+` address, which is gated on `E2E_TEST_MODE`) with **two teams**
created first.

**Still unverified**, and two may not be reachable in sandbox without setup:

- subscribe / upgrade / downgrade / cancel and their team-limit effects
- a real Polar delivery verifying through `standardwebhooks` (`wordle-teams-xm2`)
- a duplicate `webhook-id` returning 200 without reprocessing
- **the v1-uuid identity case** — a fresh v2 account has no `legacyId`, so it
  cannot reproduce what happens to a *migrated* subscriber, which is the case
  that hits every paying customer at cutover, on revocation
- **the silent-202 case** — needs a Polar sandbox customer to already exist
  under that email *before* checkout

**Why this pass is worth the trouble.** Twice in Phase 5, every gate was green
over billing code that could not work: `validateEvent` could not run on Convex's
runtime (`Buffer is not defined`) and only a live request found it; the token
scopes were invisible until a real click. Unit tests cannot see either class of
failure. Treat "the gates are green" as much weaker evidence for billing than
for the rest of the app.

Two P1s also remain open under `wt-ksh.6`, neither blocking Phase 6:
`wordle-teams-3bl` (four of five `POLAR_*` vars still unverified — close after
the sandbox pass) and `wordle-teams-c68` (the cutover runbook's `db.delete`
inventory says 14 hits; there are 21).

---

## Open and relevant to Phase 6

- **`wordle-teams-lvv` (P1)** — a frozen local Convex backend is **invisible to
  all four gates**. It refused every push for a day after the rename while lint,
  typecheck, vitest and build stayed green, because none of them talks to a
  backend. If e2e behaves impossibly, check the backend is accepting pushes
  before debugging code.
- **`wordle-teams-b31` (P1)** — `internal.migrate.counts` does six unbounded
  `.collect()`s and is the FIRST query `verify-parity.mjs` makes. Phase 7's
  problem; **do not add another caller**.
- **`wordle-teams-465` and `-5r9` (P1)** — CI installs the Convex and Supabase
  CLIs at `version: latest`, so "Verify generated types are checked in" fails on
  every PR. Worth fixing early; it will otherwise noise up every Phase 6 PR.
- **`wordle-teams-5il` (P3)** — `pnpm build` copies `.dev.vars`, with real
  secret values, into `dist/server`. `dist` is gitignored and `dist/client` is
  verified clean, but whether `wrangler deploy` could serve it is **reasoned,
  not measured**. Measure it before cutover.
- **`wordle-teams-dpi` (P3)** — `index.tsx`'s loader awaits three independent
  Convex queries sequentially. On the critical path of every page load.
- **`wordle-teams-6tp` (P2)** — one upgrade entry point, gated. A funnel
  question to decide before cutover, alongside `wordle-teams-390` and `-456`.
- **Do NOT close `wt-ksh.4`** — its done-when is the owner's side-by-side on a
  real phone, which Phase 6's PWA work is a natural moment for.

---

## Rules that cost Phase 5 real time

- **Run everything from inside `v2/` except git, and give EVERY gate its own
  `cd v2`.** The shell cwd resets between tool calls, and the repo root is v1's
  Next.js package where two of the four gate scripts do not exist and a build
  dirties `public/sw.js`.
- **NEVER pipe a gate.** This shell is zsh, where `PIPESTATUS` expands to
  **empty** (lowercase `pipestatus`, 1-indexed). A piped gate check produced
  four false greens. Redirect to a file and `echo $?`.
- **Mutation-testing extractions must `git add` new files first** — `git
  archive` and `git stash create` see only TRACKED files, and a missing new test
  file produced a **false PASS**. Assert the extraction's test count matches the
  live tree's.
- **DO NOT USE `--no-verify`.** `core.hooksPath` is `.beads/hooks`; the hook
  exports `.beads/issues.jsonl` and chains to the PII guard for this PUBLIC
  repo.
- **DO NOT COMMIT WHILE A SUBAGENT RUNS.** Queue controller commits.
- **Run reviewers SERIALLY.** Never dispatch two implementers in parallel.
- **Put every rule in the `...For` helper**, never a query/mutation wrapper —
  `convex-test` cannot stand up a Better Auth session (`wordle-teams-obw`).
- **Throw `ConvexError` via `accessError`, never a plain `Error`** — plain
  `Error` messages are redacted in production, so an operator loses the
  diagnostic exactly when they need it.
- **Hand-written Convex modules import with explicit `.ts`; GENERATED modules
  (`./_generated/*`) take NO extension.**
- **e2e drives the LOCAL backend** (`VITE_CONVEX_URL=http://127.0.0.1:3210`),
  not beta. It is green (11+ consecutive clean runs) after fixing the sign-in
  helper to wait for its own landing; keep downstream assertions at the strict
  5s so a real regression still fails fast.
- **A `convex dev` watcher has been running since 2026-08-18** against the local
  backend. It is what pushes Convex changes to the backend e2e drives — without
  it, a Convex-side change is invisible to e2e entirely. Know that before
  killing it.
- **MEASURE, DO NOT REASON.** Across Phase 5 the plan's **prose** held up and
  its **code** was wrong every single time it was checked — fourteen snippets,
  including a "release gate" test that was a byte-for-byte duplicate of the test
  above it, and a Header snippet that put Convex hooks outside the provider and
  answered `/login` with a 500. Write snippets you have run, or mark them
  unverified.
- **A commit can falsify a comment IT WRITES**, in the same commit, sometimes in
  a different file. Sweep comments you write, not only ones you find.
- **Comment accuracy is a defect here, not a nit.**

---

## Standing authorization

Push `feat/v2-replatform` and let it deploy to beta without asking; watch every
deploy with `gh run watch`. **Not prod, not main.** Subagents must NEVER push.
