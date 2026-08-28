# Handoff — Phase 6: Task 11 (push delivery), then Task 9 (the cron)

**Written 2026-08-28, mid-Phase-6.**

If you are a fresh Claude session: read this whole file and follow it. It is the
prompt. You do not need the previous conversation.

---

## Start here

Run `bd prime`. Then `bd show wt-ksh.7` for the epic, and `bd show wt-ksh.7.28`
and `bd show wt-ksh.7.26` for the two tasks you are doing, **in that order**.

The plan is `docs/superpowers/plans/2026-08-27-v2-phase6-reminders-pwa.md`
(Tasks 11 and 9). The spec is
`docs/superpowers/specs/2026-08-27-v2-phase6-reminders-pwa-design.md`.

**Use `superpowers:subagent-driven-development`**: a fresh implementer per task,
then a spec-compliance review, then a code-quality review, then fix, then close.
That loop has found something real in **every** task this phase, including two
Criticals and one data-loss-adjacent defect one file outside the review scope.
Do not skip it because a task looks small — Task 4 was the smallest and produced
the worst finding.

Reviewers should be told to mutation-test. It is what has distinguished tests
that constrain from tests that decorate, repeatedly.

---

## Where Phase 6 stands: 8 of 15 done

Closed: Task 0 (branch sync), 1 (spike S1), 3 (eligibility arithmetic), 4
(pushSubscriptions table), 5 (settings.ts), 6 (settings UI), 8 (reminder email),
10 (spike S2).

Open: **11 (yours first)**, **9 (yours second)**, 2 (spike S3), 7, 12, 13, 14,
and `wt-ksh.7.32`.

Baseline: **705 tests across 43 files**, all four gates green, beta deployed and
healthy. `feat/v2-replatform` is up to date with origin.

---

## Task 11 first: push subscription storage and delivery

Everything it needs is in place. `pushSubscriptions` exists and is deployed.
Spike S2 proved `web-push` runs in a Convex `'use node'` action — measured, on
beta, with `statusCode: 201`. VAPID is configured on the beta deployment:

```
VAPID_SUBJECT     mailto:reminders@wordleteams.com
VAPID_PUBLIC_KEY  BMw9W7iLyDb64MTd4J_T2SE8-K4bV3o8I0a-1rE3XromuPDjrX8a93sNEVcubfurRLmw3LAEJwg0KTaXVtopzVE
VAPID_PRIVATE_KEY set (43 chars; only copy is on the deployment)
```

The public key is not a secret. **The private key exists nowhere else** — if it
is lost, regenerating kills every existing subscription silently.

### The one thing that is NOT settled, and it is the important one

The S2 probe returned **201 and no notification rendered**. A separate DevTools
"Push" test button *did* render one.

Those prove different things. The DevTools button delivers a payload straight to
the service worker, bypassing the push service **and the encryption path**. A
`201` means the push service accepted the request — it does **not** decrypt
anything. So a payload encrypted against the wrong `p256dh`/`auth` produces
exactly what was seen: success upstream, silence downstream, no error anywhere.

It is equally consistent with FCM latency or a missed notification. Nobody knows
which.

**Therefore:** do not treat a 2xx from `webpush.sendNotification` as proof of
delivery — not in a comment, not in a test, not in the acceptance check. The
done-when is a notification **rendering on a real device**. If it does not, the
first suspect is the base64url round-trip of those two keys (Task 12 captures
them), not the runtime, which S2 has cleared.

### Shape

`convex/push.ts` (default runtime — queries and mutations; a `'use node'` file
cannot hold them) and `convex/pushSend.ts` (`'use node'`, actions only). The
split is forced, not stylistic.

Key decisions already made and written into the plan: upsert on `endpoint` so a
renewal is not a second device; 404/410 deletes the row; anything else logs and
schedules **exactly one** retry, bounded by an `attempt` argument so a bad hour
at a push service is not an infinite loop; the endpoint is **never logged**,
because it is a capability URL.

---

## Task 9 second: the hourly cron and the sweep

The phase's centre of gravity. Read the plan's Task 9 in full — it has three
sections you must not skip.

### The sweep ships OFF BY DEFAULT. This is an owner decision, not a default.

Two gates, both checked **before any player is claimed**:

- `REMINDERS_ENABLED` — unless exactly `'true'`, the sweep returns having done
  nothing. **Not set on beta.**
- `REMINDERS_ALLOWLIST` — comma-separated addresses; when non-empty, only those
  players may be claimed or delivered to. Empty means unrestricted, which is the
  production setting at cutover.

**Why it matters more than it looks.** Beta holds copied production rows — real
people who do not know this beta exists and who already receive real reminders
from v1. And three things I told the owner were wrong, all corrected:

1. The copy **does** carry `reminderDeliveryMethods` and `timeZone`
   (`copy-from-supabase.mjs:151-155`). It carries five reminder fields.
2. `E2E_TEST_MODE` is **not set on beta**, so `sendEmail`'s `realRecipients`
   does **not** suppress `e2e+` addresses there.
3. Beta's actual player data is **unmeasured** — the numbers I reported came
   from the local backend.

So the kill switch is the **only** protection, not a second layer. Test all
three states: disabled, allowlisted, unrestricted.

### Every player matches TWICE — measured

Both window bounds are inclusive and the cron ticks on the hour, so an
on-the-hour reminder satisfies the upper bound on one tick and the lower bound
on the next. Simulated over 399 days: **7182 double-matches** in
`America/Chicago`, `Australia/Sydney`, `Europe/London`, `Pacific/Honolulu`; zero
in the half-hour zones; nobody ever missed, including across DST.

The once-per-day stamp is the **only** thing between that and two emails a day
for the majority of players. So the claim is written **before delivery and
unconditionally**. Do not "improve" it into a write-after-success — the failure
that introduces is the common case, not an edge case.

### `Date.now()` in `crons.ts` may be evaluated at module definition

The plan flags this and it is unverified. If it freezes, the sweep is handed the
deploy time forever — the same shape as v1's email subject, which stamps every
reminder with the date the server booted. **Check it before trusting it.**

---

## Rules that have each cost real time this phase

- **Run everything from inside `v2/`, and give EVERY command its own `cd v2`.**
  The shell cwd resets between tool calls.
- **NEVER pipe a command whose exit code matters.** zsh's `PIPESTATUS` is empty.
  Redirect to a file, read `$?` on its own line.
- **Run all four gates every time** — `lint`, `typecheck`, `test:once`, `build`.
  Not just the "relevant" one. `build` does not typecheck, and lint reaches
  `public/*.js` that build merely copies. Skipping three cost a failed deploy.
- **`gh run list --limit 1` right after a push returns the PREVIOUS run**, so
  `gh run watch` reports a false green. Select by SHA and wait for it to exist.
  Then verify the deploy's actual effect, not just the green.
- **Backticks inside `git commit -m "..."` or `bd --reason "..."` are executed
  by the shell** and silently delete words. Use `git commit -F -` and
  `"$(cat <<'EOF' ... EOF)"` with quoted heredocs. This has bitten twice.
- **`convex run --prod` silently runs against the LOCAL backend** — `.env.local`
  names an anonymous deployment, so there is nothing for `--prod` to resolve to.
  It warns about nothing. `convex run` **cannot** reach beta at all
  (`deployment:functions:runTestQuery` denied). `convex env` **can**. Print
  `CONVEX_CLOUD_URL` before trusting any reading; `127.0.0.1` means local
  whatever flag you passed. This produced three wrong conclusions in one day,
  including a bogus P1.
- **`convex env get` exits 0 whether or not the variable exists.** Match on the
  "not found" text, never the exit code.
- **Do not instruct a subagent to `--amend` a commit that is already pushed.**
  Check first; make it a follow-up commit instead.
- **DO NOT USE `--no-verify`.** The hook exports the tracker and chains to a PII
  guard — **this repository is public**. Never put a real email address in a
  commit message, test, comment or beads issue.
- **Subagents must NEVER push.** Committing is theirs; pushing is yours.
- **Do not commit while a subagent runs** — its `--amend` swallows anything that
  lands mid-flight.
- **Comment accuracy is a defect here, not a nit.** Every review round this
  phase found at least one comment, test name, or user-facing string asserting
  something untrue. Two were in copy that would have reached real inboxes.

## Standing authorization

Push `feat/v2-replatform` and let it deploy to beta without asking; watch every
deploy. **Not prod, not main.**
