# Handoff — Phase 7, Stage B: the audit

**Written 2026-09-01, at the close of Stage A.**

If you are a fresh Claude session: read this whole file and follow it. It is the
prompt. You do not need any previous conversation.

---

## Start here

Run `bd prime`. Then `bd show wt-ksh.8` (this phase's epic). Stage A's twelve
tasks are `wt-ksh.8.23` through `.35`, all closed, and their notes carry the
reasoning — read a few before you start, particularly `.35`.

**Stage A is complete. Do not re-open it.** Every route v2 was missing now
exists, both orphaned dashboard features are built, and the checkout path that
blocked Phase 5 is reachable.

**Stage B is the audit itself, and it measures what Stage A built.** Its tasks:

| Bead | Task |
| --- | --- |
| `wt-ksh.8.36` | 13 — `scripts/parity-routes.mjs`, the harness **(claimed, not started)** |
| `wt-ksh.8.37` | 14 — env and secret hygiene (`cd8`, `7az`, `3bl`, `5il`) |
| `wt-ksh.8.38` | 15 — a fresh copy run and `verify-parity` |
| `wt-ksh.8.39` | 16 — the §7a accuracy pass |
| `wt-ksh.8.40` | 17 — the written checklist walk |
| `wt-ksh.8.41` | 18 — the Polar sandbox pass (`wordle-teams-02c`) |
| `wt-ksh.8.42` | 19 — P3 polish (`p37`, `069`, `uhx`, `dpi`) |
| `wt-ksh.8.43` | 20 — **the cutover runbook, the phase's deliverable** |

Plan: `docs/superpowers/plans/2026-08-31-v2-phase7-parity-audit.md`.
Spec: `docs/superpowers/specs/2026-08-31-v2-phase7-parity-audit-design.md`.
Branch `feat/v2-replatform`, in sync with origin at `1c3529a`.

---

## State

| | Phase 7 start | Now |
| --- | --- | --- |
| v2 routes | 4 | 12 |
| Tests | 705 / 43 files | **1196 / 76 files** |
| §7a divergence rows | 18 | **39** |
| Four gates | green | green |

v2's routes: `/`, `/home`, `/about`, `/privacy`, `/terms`, `/login`,
`/login-error`, `/maintenance`, `/complete-profile`, `/app`, `/me` (permanent
redirect), `/sitemap.xml`.

---

## READ THIS BEFORE TASK 13 — two hazards that will make the harness lie

**1. Every SSR document this app serves contains NUL bytes.** TanStack
serializes route ids with a trailing NUL; a `GET /` carries five. GNU grep
therefore treats a fetched page as **binary and reports no matches, with no
error and no warning**. `file` calls it `data`.

This already produced one confident wrong answer: greps for the landing page's
`<h1>` and its copy all came back empty against a page that was **fully
server-rendered**, and the natural reading was "the landing is client-only, so
crawlers see nothing" — alarming, false, and about the exact property the page
exists to provide.

**A harness that gets this wrong reports every route on beta as missing every
meta tag, which reads as catastrophic parity failure and is nothing of the
sort.** Parse the HTML, strip NULs, or use `grep -a`. Filed as `wt-ksh.8.44`
(P1).

**2. `robots.txt` legitimately differs between prod and beta**, and the harness
will flag it. Cloudflare **prepends** a managed block — content-signals
preamble plus nine AI-crawler `Disallow` groups — and then serves this repo's
file in full beneath it. Our rules ARE live. It is a true difference, not a
harness bug and not a defect. `wt-ksh.8.57` tracks the one real residual: the
served file then has two `User-agent: *` groups, and merging is
crawler-dependent. **The repo should not compensate** — duplicating our rules
would make the file wrong on every host that does not prepend.

A P1 was filed during Stage A claiming Cloudflare *overrides* our file. That was
**wrong and is withdrawn** — it came from piping a fetch through
`grep ... | head -20`, which truncated before our section.

---

## The instrument you are auditing with is itself broken — settle this early

**`wt-ksh.8.51` is P1 and it matters more than its title suggests.** The e2e
flake count has gone 2 → 4 → 5 → 6 across this phase, and a recent run failed
**six of sixty**, three of them not previously recorded. Everything passes in
isolation.

It is not a fixed set of bad tests. It is a **load-dependent failure rate**
across every spec that seeds shared auth state, and it climbs as the suite
grows. Two independent mechanisms are identified:

- `convex/e2eSeed.ts:69` does `ctx.db.query('teams').collect()` before
  inserting, so **every caller puts the whole table in its read set** and any
  concurrent insert forces a retry — O(n²) under parallel workers, and worse
  locally where that table holds ~1624 rows against production's ~171. Six
  specs now call `ensureTeamFor`.
- Unwaited settles after navigation and submit.

**Why it blocks Stage B specifically:** Task 17's checklist walk will lean on
e2e output, and a suite failing six of sixty cannot distinguish a regression
from noise. Settle it before Task 17, and certainly before cutover.

Related: **`wt-ksh.8.49` (P1) — CI runs no Playwright at all.** `deploy-v2.yml`
runs lint, typecheck, `test:once`, build, deploy, then smoke-tests `/login`.
Every e2e-only protection holds only when a human remembers. The convention this
phase converged on is a **source-reading unit test**, which *is* a gate —
`routes.test.ts`, `sw-push.test.ts`, `styles.test.ts`, `legal-prose.test.ts`,
`crawler-metadata.test.ts`, `Header.hook.test.ts`. Keep it.

---

## The one lesson worth carrying into every task

**Seventeen times this phase, a green test was green for a reason other than the
behaviour it named — and every single one was found by mutation, never by
reading.** The rule that emerged, in the order the phase learned it:

1. **Assert on a bounded, parsed thing, never a substring of a larger blob.**
   `slice(indexOf(x))` with one argument runs to end-of-file;
   `toContain('color:#1c2024')` matches inside `background-color:`.
2. **A test's name must match exactly what it asserts.** A test named for
   `/app` asserted `/login`'s headers.
3. **The set has to be right, not merely bounded.** A footer test was bounded,
   parsed *and exhaustive* — over `<Link to=` only, blind to the five
   `<a href>` links where the actual bug lived.
4. **The environment has to be production's.** A `matchMedia` guard's positive
   branch was asserted only under jsdom, where `matchMedia` is `undefined` — so
   a mutation that killed confetti for every real user left 1171 tests green.

**And when you mutate: this codebase is comment-dense enough that the first
textual occurrence of almost any code string is prose about that code.**
`replace(x, y, 1)` and unanchored `sed` hit the comment and leave the code
untouched; the test then correctly passes and the green misreads as coverage.
That happened five times in one session. **Anchor on syntax a comment cannot
contain, print the diff, and confirm the code line moved before believing a
green run.**

---

## Three claims about v1 have failed independent check this phase

Not carelessness — reading v1's *code* and reading v1's *intent* are different
acts, and only the second catches a comment explaining that something is
deliberate.

- v1's `/login-error` says the passcode expires in **1 hour**; this deployment
  sets `OTP_EXPIRY_SEC = 300` — five minutes — and the email says so.
- A contrast justification quoted "roughly 1.1:1"; the real figures were 3.30
  and 1.92, and the change also silently regressed light mode 6.37 → 5.72.
- **The most serious:** v1's `user-dropdown.tsx` was read as swapping Billing
  and Upgrade. It does not — two independent gates overlap *on purpose*, with a
  comment three lines above saying so. The swap that got built would have left
  **every lapsed subscriber with no route to the billing portal anywhere in
  v2**, and `migrate.ts` copies `'cancelled'` and `'expired'` straight out of
  Supabase, so they arrive in that state at cutover. Fixed; §7a row 39.

**When Task 17's walk compares a v2 screen to v1, read v1's comments, not only
its code.**

---

## Findings filed during Stage A that Stage B must resolve or carry

**P1**
- `wt-ksh.8.44` — the NUL-byte hazard above.
- `wt-ksh.8.45` — **a Worker response is not written to Cloudflare's edge cache
  by default.** That needs `caches.default.put`, `cacheEverything`, or a Cache
  Rule, and **none of the three exists in the repo.** So Task 3's whole
  `s-maxage` win may currently be **zero**. One `curl` for `cf-cache-status` on
  beta, run twice, settles it — and it sets the severity of `.46` and `.52`.
- `wt-ksh.8.49`, `wt-ksh.8.51` — above.

**P2**
- `wt-ksh.8.46` — `stale-while-revalidate=604800` with no purge on deploy. v1
  got away with this because Vercel purged ISR; Cloudflare does not. Worst case
  is eight days between shipping a fix and everyone seeing it.
- `wt-ksh.8.52` — **`/` is the only path both gated by maintenance mode and
  edge-cacheable.** Flipping `MAINTENANCE` on is not sufficient for it; a cached
  landing page outlives the flag and the Worker is never invoked. **Maintenance
  mode is two steps, not one** — this belongs in the runbook.
- `wt-ksh.8.54` — **beta has no `noindex`.** Vercel supplied `X-Robots-Tag` on
  previews automatically; Cloudflare supplies nothing, and beta now serves the
  full marketing surface on a real hostname.
- `wt-ksh.8.55` — `og:url` is the apex on every route, and `/` and `/home` are
  duplicate content with no canonical.
- `wt-ksh.8.48`, `wt-ksh.8.57`, `wt-ksh.8.58`, `wordle-teams-4yt`,
  `wordle-teams-p5mw` — read them.

**`wordle-teams-4yt` deserves a decision before cutover:** the privacy policy
and terms both name **Apple and Facebook** as sign-in providers. Neither has
ever been offered — v1 had google/twitter/azure/github/slack/discord, v2 has
google/microsoft/github/discord. The policy also claims a **username** is
collected; no such field exists in either codebase. Already wrong in v1, so not
a regression — but cutover is when these pages start being served from the new
stack, and amending legal copy is the owner's call, not a task outcome.

---

## Rules that have each cost this project real time

- **Run everything from inside `v2/`, and give EVERY command its own `cd v2`.**
  The shell cwd resets between tool calls, and `cd` is aliased to zoxide.
- **NEVER pipe a command whose exit code matters.** zsh's `PIPESTATUS` is empty.
- **`pgrep -f <string>` matches its own shell wrapper.** It produced three false
  positives in one session. Use a pattern that cannot self-match, or check the
  port.
- **Run all four gates every time** — `build` does not typecheck, and lint
  reaches `public/*.js` that build only copies.
- **`convex run --prod` and `convex env --prod` silently fall back to the LOCAL
  backend.** Before believing any output about beta, check for a value only beta
  has. And `convex env get` exits 0 whether or not the variable exists — match
  on the "not found" text, never the exit code. **Task 14 lives or dies on this.**
- **Killing the `convex dev` CLI orphans the backend binary holding 3210/3211**,
  and the next `--once` fails with "A local backend is still running on port
  3210", which looks like a fault and is not. Kill both. And **listening ports
  alone are not proof the watcher is alive** — check the CLI process, the
  backend process, and the port.
- **`convex codegen` needs Node 20/22/24**; this box defaults to v25.2.1. Use
  `mise exec node@22 -- npx convex dev`.
- **Backticks inside `git commit -m "..."` or `bd note "..."` are executed by
  the shell.** Use `git commit -F -` and `bd note --stdin` with quoted heredocs.
  A control character in a commit message is rejected outright — which happened
  while writing *about* NUL bytes.
- **DO NOT USE `--no-verify`.** The hook chains to a PII guard — **this
  repository is public**.
- **Subagents must NEVER push.** Committing is theirs; pushing is yours.
- **Comment and document accuracy is a defect here, not a nit.**

---

## The review loop, and why it is not optional

Stage A used `superpowers:subagent-driven-development`: a fresh implementer per
task, then a combined spec-and-quality review, then fixes, then close.

**It found something real in every single task**, including two Criticals that
would have shipped — a maintenance switch that passed every automated check
while protecting nothing, and the lapsed-subscriber portal regression.

Tell every reviewer to **mutation-test**, and give it the four-part rule above.
Verify the load-bearing mutations yourself rather than trusting the report;
roughly one report claim in six needed correction, and reviewers pushed back
correctly on premises the controller supplied more than once.

---

## Standing authorization

Push `feat/v2-replatform` and let it deploy to beta without asking; watch every
deploy. **Not prod, not main.** Do **not** flip `REMINDERS_ENABLED` on any
deployment without asking — it is the only thing between a config slip and
mailing every copied production row. It is currently **OFF on beta**, which is
its designed resting state.
