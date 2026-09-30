# Handoff — Phase 7, Stage B/C: what is left needs the owner

**Written 2026-09-02.** Read this whole file and follow it; it is the prompt.
You do not need any previous conversation.

---

## Start here

Run `bd prime`, then `bd show wt-ksh.8`. The phase's plan is
`docs/superpowers/plans/2026-08-31-v2-phase7-parity-audit.md`.

**Five of Stage B/C's eight tasks are closed. The three that are not are
blocked on things a session cannot do alone**, so do not open this expecting
codeable work — read §"What is actually left" before planning anything.

Branch `feat/v2-replatform`, in sync with origin. Tree clean, no stashes. The
last beta deploy is green.

| | Stage B start | Now |
| --- | --- | --- |
| Tests | 1196 / 76 files | **1257 / 78 files** |
| e2e | 2-6 failures of 60 | **60/60, six consecutive runs** |
| §7a divergence rows | 39 (header said 18) | **43, header reconciled** |
| Four gates | green | green |

---

## What got done

| Task | State |
| --- | --- |
| 13 — `parity-routes.mjs` | ✅ closed |
| 14 — env and secret hygiene | ✅ closed |
| 15 — fresh copy + verify | ⛔ code half shipped, **data half blocked** |
| 16 — the §7a accuracy pass | ✅ closed |
| 17 — the checklist walk | ⛔ **needs the owner** |
| 18 — the Polar sandbox pass | ⛔ **needs the owner** |
| 19 — P3 polish | ✅ closed (all four) |
| 20 — the cutover runbook | 📄 **file written**, bead held open by 17 and 18 |

Also closed: `wt-ksh.8.49`, `wt-ksh.8.51`, `wordle-teams-cd8`, `-7az`, `-3bl`,
`-c68`, `-p37`, `-069`, `-uhx`, `-dpi`.

**`docs/runbooks/2026-cutover.md` is the phase deliverable and it exists.** It
supersedes `wt-ksh.9`'s runbook prose and says so at the top, because two of
that text's bullets are wrong. Read it before doing anything cutover-shaped.

---

## What is actually left, and why you cannot just do it

### Task 15's data half — blocked on DNS, not on code

**`supabase.co` does not resolve on this machine.** It is network DNS
filtering: against the same resolver over UDP 53, `github.com`, `supabase.com`
and `convex.dev` all answer while `supabase.co` gets **no response at all**.

- **Not** a Supabase outage — `dns.google` over DoH resolves it fine.
- **Not** a v1 production incident — Vercel resolves it and prod serves normally.
- **Not** the Node 25 issue — it fails identically under Node 22.
- **Not** a sandbox restriction — the owner's own shell fails the same way.

**Two traps if you re-diagnose it.** The error names a **different table each
run** (`readScoped` races its reads and reports whichever loses first —
`daily_scores`, `players` and `teams` have all been seen), so it looks like a
flaky timeout on the biggest table. And **Cloudflare's resolver SERVFAILs
`supabase.co` over both UDP and DoH independently**, so "it fails on 1.1.1.1
too" proves nothing — this box points at `1.0.0.1`. Use `dns.google` over DoH
to establish the name is healthy.

**The owner's options**, neither taken yet: allowlist `supabase.co` in whatever
filters DNS (Pi-hole / NextDNS / router), or pin the host —
`172.64.149.246 dcfqzbdusxhrfgvnpwqc.supabase.co` in `/etc/hosts`, verified
end-to-end with valid TLS. **Do not suggest `DNSOverTLS=yes`:** port 853 is
blocked to `8.8.8.8`, `8.8.4.4` and `9.9.9.9`, so that would leave the machine
with no working resolver. systemd-resolved speaks DoT only, never DoH.

**When it resolves, the copy is one command.** The `wt-ksh.7.32` fix is already
shipped — **do not re-implement it**:

```
cd v2 && node --env-file=../.env.production.local --env-file=.env.local \
  scripts/copy-from-supabase.mjs --scope=all --dry-run
```

The banner must say `Reminder settings: held back`. Then the same without
`--dry-run`, then Steps 3-6 (field-level clobber report, by-hand resurrection
check, measure beta for any non-empty `reminderDeliveryMethods`,
`verify-parity.mjs --scope=all`). `--dry-run` exits before the Convex client is
constructed and writes nothing, so it is a genuine gate.

### Tasks 17 and 18 — the owner has to be in the room

Task 17 is a hand-walked checklist of every interactive surface, with the owner.
Task 18 is a Polar sandbox pass needing a browser and a fresh non-`e2e+`
account on beta. Neither is agent work. **Task 17's blocker is cleared though**
— see the e2e section below.

---

## The three things this session learned that will save you a day

### 1. e2e was flaky for three reasons, and the filed one was second

`wt-ksh.8.51` predicted an unwaited navigation. Real, but it was not the main
cause and it was **masked** by the first one.

- **A read-set conflict.** The first run did not time out — it failed with
  `OptimisticConcurrencyControlFailure` on `teams`. `e2eSeed.ensureTeamFor`
  scanned the whole table, putting every row in the mutation's read set. Six
  specs call it, so the collision rate is **quadratic in callers**, which is why
  the count climbed as the suite grew and why everything passed in isolation.
- **The unwaited profile submit**, now handled by `e2e/complete-profile.ts`.
- **Eleven Playwright workers against one Vite dev server.** The default is
  `cpus/2`. Now pinned to `4` — **as a literal**, so the flake rate stops being
  a property of the machine. Measured: 4 workers at the 5s ceiling is 60/60 at
  the *same* 1.1-1.2m wall clock.

**Run `pnpm e2e` deliberately. It is reliable now and it is still not a CI
gate.**

### 2. The convention: e2e is not a gate, so write the twin

Now a section in the plan rather than rediscovered per task. Ranked
render > parse (`src/test-support/source-ast.ts`) > read-as-string, with the two
traps: **strip comments before asserting over source** (the first textual
occurrence of almost any code string here is prose about that code), and
**bound a slice at both ends** (`slice(indexOf(x))` runs to EOF, and on a miss
`slice(-1)` silently returns the last character).

The review found **one real gap hiding behind a false claim**: §7a row 19 said
the app bar's links were guarded by `src/routes.test.ts`. They were not — that
file pins `/` and `/home`'s `beforeLoad` and never reads `Header.tsx`. Twin now
in `src/components/Header.hook.test.ts`.

### 3. Production streams its metadata into the BODY

**This is not the NUL-byte hazard, and the NUL fix does not cover it.** React
streams `<title>` and the `og:*` tags into the body on *dynamically-rendered*
routes and hoists them into the head only when the client runs: prod's
`/about` closes `</head>` at byte 2960 and emits its `<title>` at **9787**.
Prerendered routes like `/privacy` behave normally, so **half the routes look
right**.

A head-bounded reader therefore reports prod's `/`, `/about` and `/login` as
having no title and no OpenGraph tags at all — which reads as "beta invented
twelve tags production never had". The first draft of `parity-routes.mjs` did
exactly that. It now bounds on foreign content and serialized text
(`svg`/`math`/`script`/`template`) instead.

---

## Standing state you should know before touching anything

- **The beta Convex deploy key is in `v2/.env.local`.** The owner put it there
  this session. A `convex dev` watcher is live (local `anonymous-v2` on
  3210/3211) and did **not** retarget — a running process keeps its original
  environment — but **it will read that key on its next restart.** Remove it, or
  be deliberate.
- **`REMINDERS_ENABLED` is empty on beta and must stay that way.**
  `convex/reminders.ts:81` gates on `!== 'true'`, so empty is off. Beta holds
  copied production rows.
- **`E2E_TEST_MODE` is not set on beta.** Verified 2026-09-01. It must stay
  unset, and the runbook re-confirms it after the final copy.
- **`POLAR_SERVER` is `sandbox`** — correct for Task 18, and wrong the moment
  the domain flips.

---

## Rules that each cost this project real time

- **Run everything from inside `v2/`, and give EVERY command its own `cd v2`.**
  The shell cwd resets between tool calls, and `cd` is aliased to zoxide.
- **NEVER pipe a command whose exit code matters.** zsh's `PIPESTATUS` is empty.
  This bit again this session: `pnpm lint | tail` reported `LINT_EXIT=0` while
  lint had genuinely failed — the `$?` came from `tail`.
- **`convex env --prod` silently reads the LOCAL backend**, and `convex env get`
  exits 0 whether or not the variable exists. Read a beta-only sentinel first;
  match the "not found" TEXT, never the exit code.
- **Run all four gates every time** — `build` does not typecheck, and lint
  reaches `public/*.js` that build only copies.
- **Do not put a literal NUL in a source file.** Write `'\u0000'` as an escape.
  A literal one makes the file invisible to recursive greps and renders its diff
  as binary — that is `wt-ksh.8.44`, still open against `sw-push.test.ts`, and
  this session nearly added a second instance.
- **Backticks inside `git commit -m "..."` or `bd note "..."` are executed by
  the shell.** Use `git commit -F -` and `bd note --stdin` with quoted heredocs.
- **DO NOT USE `--no-verify`.** The hook chains to a PII guard — **this
  repository is public**.
- **`gh run list --limit 1` right after a push returns the PREVIOUS run.**
  Select by SHA.
- **Comment and document accuracy is a defect here, not a nit.**

---

## The discipline that keeps paying

**Mutate before believing a green test.** Every load-bearing assertion written
this session was mutation-tested, and the mutations found things reading did
not:

- Two survivors in the parity harness were **the tests' fault**, not the code's
  — one was green because backslashes in its fixture defeated the attribute
  parser, not because the stripper worked.
- Three "kills" were **no-ops** whose anchors never matched. Anchor on syntax a
  comment cannot contain, print the diff, and confirm the code line moved.
- Two anchors matched **twice** (a second nav link carried the same
  `activeProps`). Reporting those as kills would have been wrong.
- One survivor on `wordle-teams-uhx` is a genuine **equivalent mutant** and is
  recorded as one rather than killed with a contrived test.

**And check your own numbers before writing them down.** A comment in this
session's `dpi` fix claimed "a third off" with figures invented before the
measurement was taken. The real figure was a fifth. §7a row 19's false claim
about a guard that did not exist is the same failure one level up.

---

## Suggested first move

Ask the owner which of the three blockers they want to clear: the DNS filter
(unblocks Task 15 and `wt-ksh.7.32`), a session for Task 17's walk, or a
browser session for Task 18. **Nothing else in Phase 7 is codeable.**

If they want work that does not need them, the honest candidates are
`wt-ksh.8.45` (one `curl` for `cf-cache-status`, run twice — it decides whether
Task 3's whole `s-maxage` win is currently zero, and sets the severity of `.46`
and `.52`) and `wt-ksh.8.44` (remove the literal NUL from `sw-push.test.ts`).
Both are small and both are P1.
