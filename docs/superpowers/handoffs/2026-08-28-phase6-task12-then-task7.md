# Handoff — Phase 6: Task 12 (the Push switch), then Task 7

**Written 2026-08-28, after Tasks 11 and 9.**

If you are a fresh Claude session: read this whole file and follow it. It is the
prompt. You do not need the previous conversation.

---

## Start here

Run `bd prime`. Then `bd show wt-ksh.7` for the epic, and `bd show wt-ksh.7.29`
and `bd show wt-ksh.7.24` for the two tasks, **in that order**.

Plan: `docs/superpowers/plans/2026-08-27-v2-phase6-reminders-pwa.md` (Tasks 12
and 7). Spec: `docs/superpowers/specs/2026-08-27-v2-phase6-reminders-pwa-design.md`.

**Use `superpowers:subagent-driven-development`**: a fresh implementer per task,
then spec-compliance review, then code-quality review, then fix, then close. That
loop found something real in **both** tasks this session, including a Critical
that would have written capability URLs into the production logs, and two tests
that passed against implementations that ignored their own arguments. It is not
optional and no task is too small — the smallest one this phase produced the
worst finding.

**Tell every reviewer to mutation-test**, and to run timezone-touching tests
under `TZ=UTC` as well. See "The trap that nearly got through" below.

---

## Where Phase 6 stands: 10 of 15 done

Closed: Tasks 0, 1, 3, 4, 5, 6, 8, 10.
**Code-complete and deployed to beta but NOT closable yet: 11 and 9** — both need
a human to observe a real delivery. See "What is left to verify" below.

Open: **12 (yours first)**, **7 (yours second)**, 2 (spike S3), 13, 14, plus
`wt-ksh.7.32`, `wt-ksh.7.1` and `wordle-teams-vsx`.

Baseline: **760 tests across 48 files**, up from 705/43. All four gates green,
and the full suite also green under `TZ=UTC`. `feat/v2-replatform` is up to date
with origin at `b62a577`, deployed and healthy on beta.

---

## What Tasks 11 and 9 actually shipped

`convex/push.ts` (subscription storage, default runtime), `convex/pushSend.ts`
(`'use node'`, `deliverTo`), `convex/lib/pushErrors.ts` (`safePushErrorLog`),
`convex/reminders.ts` (`sweep`), `convex/crons.ts` (one hourly entry), and their
tests.

**The sweep is live on beta and does nothing.** It fires hourly and returns
immediately because `REMINDERS_ENABLED` is unset. That is the designed resting
state, and it is mutation-tested: deleting either gate turns tests red.

Two owner-approved divergences beyond the plan, both in `79bda50` and both
recorded on `wt-ksh.7.31` for Task 14: removal is scoped to the owning player,
and an endpoint that is not a parseable `https:` URL is rejected with the new
`INVALID_PUSH_ENDPOINT` access code.

---

## What is left to verify, and why it needs you and not an agent

Neither task can close on tests. Both done-whens require a human observing a real
delivery.

**Task 9 needs an email to arrive on beta.** That requires, on the **beta**
deployment:

```
convex env set REMINDERS_ALLOWLIST <your own address>     # DO THIS FIRST
convex env set REMINDERS_ENABLED true
```

**Set the allowlist first, in the same sitting.** Beta holds copied production
rows — real people who do not know this beta exists and who already get real
reminders from v1. The allowlist is the only thing keeping the sweep off them;
`E2E_TEST_MODE` is not set on beta, so `sendEmail` suppresses nothing there. Then
set your own player's reminder time to the next hour with Email on, and wait for
the tick. Turn `REMINDERS_ENABLED` back off afterwards.

**Task 11 needs a notification to render on a real phone**, which needs Task 12
first — the Push switch is the only thing that can create a subscription.

**Do not treat a 2xx from `webpush.sendNotification` as proof of delivery**, in a
comment, a test, or an acceptance check. A push service returns 201 **without
decrypting**, so a payload encrypted against the wrong `p256dh`/`auth` looks
exactly like success from the server side. If nothing renders, suspect the
base64url round-trip of those two keys — which is Task 12's code — before
suspecting the runtime, which S2 cleared and which has now also survived a real
`convex deploy` of the `'use node'` module.

---

## The trap that nearly got through, because it will recur in Tasks 12 and 13

A test guarding timezone logic **passed in CI while proving nothing.** Deleting
`sweep`'s `if (!timeZone) return []` guard gave `1 failed | 19 passed` on the dev
box and `20 passed, exit 0` under `TZ=UTC`.

`Intl.DateTimeFormat` with `timeZone: undefined` does not throw — it silently
falls back to the **host** zone. The dev box is `America/Chicago`, which made
14:00 UTC resolve to the fixture's 09:00 and caught the missing guard by
accident. CI runs UTC, where the mutant survived untouched.

**So: any test whose fixture times differ from UTC only by the developer's offset
is validating the developer's box.** Run timezone-touching mutants under both
`pnpm exec vitest run <file>` and `TZ=UTC pnpm exec vitest run <file>`, and
require the mutant to die in both. Task 7 captures `timeZone` — this applies
directly to it.

---

## Rules that have each cost real time this phase

- **Run everything from inside `v2/`, and give EVERY command its own `cd v2`.**
  The shell cwd resets between tool calls.
- **NEVER pipe a command whose exit code matters.** zsh's `PIPESTATUS` is empty.
  Redirect to a file, read `$?` on its own line.
- **Run all four gates every time** — `lint`, `typecheck`, `test:once`, `build`.
  `build` does not typecheck, and lint reaches `public/*.js` that build only
  copies.
- **e2e is NOT one of the four gates.** No gate runs Playwright.
- **`gh run list --limit 1` right after a push returns the PREVIOUS run.** Select
  by SHA, wait for it to exist, then verify the deploy's actual effect — for a
  Convex change that means checking the "Deploy Convex and build the client" step,
  not just the overall green.
- **Backticks inside `git commit -m "..."` or `bd note "..."` are executed by the
  shell** and silently delete words. Use `git commit -F -` and `"$(cat <<'EOF' …
  EOF)"` with quoted heredocs.
- **`convex run --prod` silently runs against the LOCAL backend.** `convex env`
  reaches beta; `convex run` cannot. Print `CONVEX_CLOUD_URL` before trusting any
  reading. This produced three wrong conclusions in one day, including a bogus P1.
- **`convex env get` exits 0 whether or not the variable exists.** Match on the
  "not found" text, never the exit code.
- **There is NO `convex dev` watcher running** — the previous handoff said there
  was; `ps` finds zero. Without it, Convex changes never reach the local backend
  Playwright drives. Start one before trusting any e2e run that touches Convex.
- **`convex codegen` needs Node 20/22/24**; this box defaults to v25.2.1 and the
  local backend rejects a `'use node'` push under it. `node@22` is installed —
  use `mise exec node@22 -- npx convex codegen`.
- **DO NOT USE `--no-verify`.** The hook exports the tracker and chains to a PII
  guard — **this repository is public**. Never put a real email address in a
  commit message, test, comment or beads issue.
- **Subagents must NEVER push.** Committing is theirs; pushing is yours.
- **Do not commit while a subagent runs** — its `--amend` swallows anything that
  lands mid-flight. And be ready for one to die mid-commit: an implementer lost
  its connection right before amending this session, and the fix was to verify
  and commit its staged work directly rather than re-run it.
- **Comment accuracy is a defect here, not a nit.** Every review round this phase
  found at least one comment, test name or user-facing string asserting something
  untrue — this session alone, a "the endpoint is NOT logged" comment sitting
  directly above a line that logged it, a performance claim false in both halves,
  and a property count off by one.

## Standing authorization

Push `feat/v2-replatform` and let it deploy to beta without asking; watch every
deploy. **Not prod, not main.** Do **not** flip `REMINDERS_ENABLED` on any
deployment without asking — it is the only thing standing between a config slip
and mailing every copied production row.
