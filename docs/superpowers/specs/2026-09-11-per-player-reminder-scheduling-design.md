# Per-player reminder scheduling

**Date:** 2026-09-11
**Issue:** wordle-teams-spcu (P1) · parent analysis on the closed wordle-teams-yhii
**Status:** design approved, plan pending

## What we are building and why

`reminders.sweep` runs hourly and opens with `ctx.db.query('players').collect()` — a
full table scan, unconditionally, 720 times a month. At 393 rows that is ~283,000
document reads a month, roughly 82 MB at the ~291 bytes/document wordle-teams-yhii
estimates, as a **fixed floor that exists whether or not anybody opens the app**.

That cost is not being paid today. `REMINDERS_ENABLED` is empty on beta and the gate
is the handler's first line, above the `players` collect — so the sweep returns
having read zero documents. **The cost is deferred to a launch action.** Somebody
sets that variable to `'true'` on cutover day and ~8% of a 1 GB ceiling appears from
a one-line env change.

The ceiling is hard. Free-plan caps make mutations **fail rather than bill**
(wordle-teams-dcu), so hitting it means players cannot save boards — at launch.

**Decision taken 2026-09-11 (owner):** reminders are **ON at cutover**. The cheap
option of deferring the flag a week until the 30-day I/O figure is readable
(wordle-teams-l10c.2, ~2026-10-10) was considered and **rejected** — the launch email
targets 322 dormant accounts and the daily nudge is part of what brings them back.
**This work is therefore a launch blocker**: it must be executed and verified on beta
before the flag flips.

## The insight

Hourly is not the waste. With 57 distinct player timezones, somebody is due in
nearly every UTC hour, so as designed the sweep **must** be hourly. This was tested
rather than assumed:

- `America/Chicago` (UTC−5): local 05:00–22:00 covers **UTC hours 10…23, 0…3**
- `Europe/London` (UTC+1): local 05:00–22:00 covers **UTC hours 4…21**

Two zones, and all 24 UTC hours are occupied. Production has 57. So the issue's
option B — a self-scheduling sweep that only runs in hours where somebody is due —
resolves to "run all 24 hours", a saving of approximately nothing, plus a new
mechanism to maintain. **Ruled out.**

The cost factors as `720 runs × 393 reads`. The first factor is already at its floor.
All of the money is in the second, and only per-player scheduling touches it:
reads-per-run drops from 393 to **1**.

```
sweep:       720 runs    × 393 reads = 283,000 reads/month
per-player: ~11,800 jobs ×   1 read  =  11,800 reads/month    (24x)
```

Note this is the same 24x the `teamStats.sweep` fix got, reached from the opposite
direction — that one divided the runs, this one divides the reads.

## Verified platform facts

Everything below was read from shipped source in `node_modules`, not from memory.
Each is load-bearing for a specific design decision.

| Fact | Source | Consequence |
|---|---|---|
| `runAt(ts, fn, args)` returns `Id<'_scheduled_functions'>`; `cancel(id)` takes it back | `convex/server/scheduler.d.ts` | the primitives exist; repo already uses `runAfter` in six places |
| Scheduled **mutations** are exactly-once and auto-retried on transient errors | ibid. | the chain-break risk is a **permanent** throw, not flakiness |
| cancel "throws" is documented for scheduled **actions**; for **mutations** the wording is "atomically cancel it entirely or fail to cancel if it has committed" | ibid. | the issue's item 2 is directionally right but less crisp than recorded; §4's staleness guard makes it moot either way |
| `runAt` rejects timestamps >5 years out | ibid. | no bound we can reach |
| `undefined` ranks **0**, numbers rank **3**, in the total value order | `convex/values/compare.js:126` | an index range `.lte(field, x)` **returns rows where the field is absent** — bootstrap and repair are one query |
| `convex-test` sorts index entries with that same `compareValues` | `convex-test/dist/index.js:477` | the unit suite behaves identically to the backend here |
| Hard cap: **1000 `functionsScheduled` per transaction** | `convex-test/dist/transactionMetrics.js:16` | **this decides the design** — see §Alternatives |
| `transactionLimits` meters `documentsRead` **and** `functionsScheduled` | `convex-test/dist/transactionMetrics.d.ts` | every cost claim here is assertable as a test |
| `convex-test`'s `1.0/cancel_job` patches state to `canceled` **unconditionally, from any state** | `convex-test/dist/index.js:1166` | the real backend's cancel failure is **unreachable** by the unit suite |
| `finishAllScheduledFunctions` loops until nothing is pending | `convex-test/dist/index.d.ts` | it would **never terminate** against a self-rescheduling chain |
| `timeZone` is written only when absent (`writeZone: hasTimeZone ? null : resolvedZone`) | `src/lib/use-local-capture.ts:88` | no per-sign-in reschedule churn to design around |

## Architecture

### Data model

Three fields on `players`, one index, no join table:

| field | meaning |
|---|---|
| `reminderJobId?: Id<'_scheduled_functions'>` | the pending job |
| `nextReminderAt?: number` | when it is due — **the row is the source of truth** |
| `playsWeekends?: boolean` | derived from `teams` by ONE writer (§4) |

Plus `.index('by_nextReminderAt', ['nextReminderAt'])`.

`lastBoardEntryReminder` stays exactly as it is. It is the sweep's own bookkeeping
and remains the double-send guard.

### 1. The reschedule helper

`reschedulePlayerReminderFor(ctx, playerId)` — a `...For` helper taking `MutationCtx`,
per this repo's rule that a rule written into a mutation body is a rule no test can
reach (convex-test cannot stand up a Better Auth session, wordle-teams-obw).

1. Cancel `reminderJobId` if present, inside `try/catch` — **best-effort**, see §2.
2. Compute the next occurrence (§3).
3. `runAt`, then patch `reminderJobId` and `nextReminderAt` in the same transaction.

Called from the four existing settings helpers, which are already `...For` helpers:
`updateTimeZoneFor`, `updateReminderTimeFor`, `setReminderMethodFor`,
`updateReminderMethodsFor`.

### 2. The delivery job — `internalMutation({ playerId, dueAt })`

Reads **one player row**, and no `teams` at all.

**Staleness guard first.** If `dueAt !== player.nextReminderAt`, this job has been
superseded — return without delivering and without rescheduling.

This is the design's most important property and it is stronger than the issue asked
for. Because the row is authoritative and every job carries the instant it was
scheduled for, a superseded job **self-retires**. It does not matter whether the
cancel threw, no-opped, or succeeded. Issue item 2 — "a stale id is a duplicate
reminder or one at the old time" — stops being a hazard to tolerate and becomes a
state that cannot produce a wrong send.

Then, in order:

- Eligibility, via the narrowed reads of §5.
- **Claim `lastBoardEntryReminder` unconditionally, before delivering.**
  `reminders.ts:219-227`'s rule is kept verbatim and for its original reason.
- Deliver per `reminderDeliveryMethods`, unchanged.
- **Reschedule the next occurrence — always, including when gated off.**

That last point is issue item 4 with its consequence made explicit. Keeping
`REMINDERS_ENABLED` at *delivery* rather than at *scheduling* means flipping the flag
costs nothing. But it also means the job must reschedule even when it delivers
nothing — otherwise setting the flag to `false` would break all 393 chains
permanently, and setting it back to `true` would need a re-bootstrap.

`REMINDERS_ALLOWLIST` and the `SITE_URL` throw keep their current positions and
reasoning.

**Still a mutation, not an action**, for every reason `reminders.ts:30-40` already
gives: one consistent snapshot, the claim committing with the decision, `sendEmail`
enqueueing through `ctx.runMutation`, and an OCC retry re-running cleanly from
scratch.

### 3. Next occurrence — a pure helper in `convex/lib/reminders.ts`

`nextOccurrence(timeZone, reminderTime, from, playsWeekends)` → instant.

Probe-and-correct: guess an instant from the zone's offset near `from`, format it
back with the existing `localParts`, apply the drift, repeat until stable (converges
in ≤3 iterations). **No stored offsets and no 24-hour arithmetic** — issue item 1.
DST is handled by Intl at the moment of asking, for exactly the reason the current
sweep is DST-safe: nothing time-dependent is ever stored.

**Prototyped and swept before this design was written**: all **418** IANA zones ×
5 reminder times × 40 instants straddling the world's DST transitions =
**83,600 cases, zero failures**. The gap to the next occurrence ranged
**0.25h to 25.00h**, and that varying gap *is* the DST proof:

| case | gap |
|---|---|
| ordinary day | +24.00h |
| `America/Chicago` across spring-forward | **+23.00h** |
| `America/Chicago` across fall-back | **+25.00h** |
| `Australia/Lord_Howe` (30-minute shift) | **+0.50h** |
| `Asia/Kathmandu` (45-minute offset) | +23.25h |

`Asia/Calcutta` and `Asia/Kolkata` both resolve, which is load-bearing — copied rows
carry v1's Postgres spellings.

Ambiguous times (fall-back) resolve to the **first** occurrence — verified:
`America/Chicago` 2026-11-01 01:30 resolves to 06:30Z, the earlier of the two.

**CORRECTED 2026-09-11, after the spec review measured it.** This paragraph
originally claimed nonexistent times resolve to "the instant just after the gap" and
that "neither is reachable through `REMINDER_TIMES` (05:00–22:00) today". **Both
claims were false**, and the second one mattered:

- The behaviour is the instant just **before** the gap.
  `instantForLocal('America/Chicago','2026-03-08','02:30:00')` gives 07:30Z, which is
  01:30 local — an hour early, not an hour late.
- **The parity of the probe's round bound decides which side**, which makes four
  rounds load-bearing rather than the belt-and-braces the comment called it. Measured
  directly: bounds of 1, 3 and 5 converge post-gap; 2 and 4 converge pre-gap. A future
  "tidy" from 4 to 5 would silently flip it, so the bound is now documented as
  load-bearing and the behaviour is pinned by a test.
- **It IS reachable in production.** `Pacific/Easter` transitions at 22:00 local, and
  `22:00:00` is one of the eighteen offered reminder times. Confirmed by binary-search
  on the transition instant: 2026-09-06T04:00:00Z, where local time jumps from
  2026-09-05 21:59:59 to 23:00:00, so 22:00:00 genuinely does not exist that day.
  Reproduced for 2027-09-04 and 2028-09-02 as well.

**The accepted consequence, stated rather than discovered later:** a `Pacific/Easter`
player with a 22:00 reminder gets it at 21:00 local, one day a year. Walked across the
transition, the chain's gaps run 24h, 23h, 24h, 24h — **no spin and no drift**, and the
wall clock self-corrects the next day. That is small enough to accept and too specific
to leave undocumented.

Both paths are pinned by tests so that widening the picker fails loudly rather than
quietly.

**The weekend rule moves into this function.** A player with `playsWeekends === false`
skips Saturday and Sunday when scheduling. The delivery job therefore never asks
about teams, and no wasted weekend jobs are created.

### 4. The daily reconciliation pass — and why it is not optional

A sweep is self-healing: it recomputes from scratch every run, so a lost job or a
missed cancel fixes itself. Per-player scheduling has no such property, and its
failure is silent — a player just stops getting reminders.

The concrete mechanism, now that the platform facts are in: scheduled mutations are
auto-retried on *transient* errors, so flakiness is not the risk. A **permanent**
throw is. `sweep` today catches an unresolvable `timeZone` per player precisely
because one bad row must not take the batch down (`reminders.ts:167-177`) — in a
chain, that same bad row rolls back the whole transaction *including the reschedule*,
and that player is dead silently, forever.

So the daily pass is **load-bearing, not a mitigation to weigh**. It does four jobs
at once:

1. **Derives `playsWeekends`** — one `teams` collect, patch the players whose flag
   differs.
2. **Repairs broken chains** — `by_nextReminderAt` range query for absent-or-overdue.
3. **Bootstraps** — existing players simply have no `nextReminderAt`, which is *the
   same case a broken chain presents*, and the same query returns it because
   `undefined` sorts before every number.
4. Bounded with `.take(n)` so the transaction is finite forever regardless of
   player count.

Issue item 3 dissolves: **no migration mutation, no runbook step, no separate
bootstrap path.** That matters more than convenience — a manual cutover step would
have to be run against prod, and `convex run --prod` silently hits the local
deployment on this machine.

#### Why `playsWeekends` is derived daily rather than hooked

`teams.playerIds` / `teams.playWeekends` have **8 write paths across 6 modules**:
`teams.ts` (×4), `players.ts`, `inviteLinks.ts`, `billing.ts` (×2), plus `migrate.ts`
and `e2eSeed.ts`. Maintaining a derived flag from all of them is a drift factory of
exactly the kind `schema.ts` and `settings.ts` keep warning about, and drift there
would be permanent and silent.

A daily recompute has **one writer**, so drift is impossible beyond 24 hours and
self-corrects. The cost of that staleness is bounded and mild: a player who joins a
weekend-playing team today might miss one Saturday reminder; one who leaves might get
one extra. This is the same trade `teamStats.sweep` accepted when it went daily.

### 5. The `dailyScores` narrowing

Today's ≤11-row collect answers two questions. Both are single index lookups:

- **entered today** — `eq('playerId', id).eq('puzzleDay', localDay).first()` → ≤1 doc
- **still active** — `eq('playerId', id).gte('puzzleDay', floor).first()` → ≤1 doc

≤2 documents instead of ~6–11. Approved as scope because this code path is being
rewritten anyway; `hasRecentActivity` and `enteredOn` keep their current semantics
and tests, now fed existence checks rather than a day list.

## Cost accounting — stated honestly

| term | now (once the flag flips) | after |
|---|---|---|
| `players` scan | 283,000 reads · **82 MB** | ~23,600 · **6.8 MB** |
| `dailyScores` per candidate | ~72,000 · **~21 MB** | ~23,600 · **~7 MB** |
| weekend `teams` collect | ~33,000 · **~10 MB** | 5,130 · **1.5 MB** |
| `_scheduled_functions` | small | ~12,000 jobs/month — **cannot bound from here** |

**12x on the term the issue is about; roughly 4x overall** — not "82 MB gone". The
scheduled-function traffic is the one number this design cannot bound from the
repository, and it is not claimed to be zero. It is bounded by the post-cutover
30-day reading (wordle-teams-l10c.2) beside the 460.26 MB baseline.

### The trap this design had to avoid

Fanning out **de-amortises the weekend `teams` collect.** Today it is paid once per
sweep run — 24 times a day, only when some candidate's local day is a weekend. Naive
per-player jobs pay it *once per job*: 171 team rows × every active player due on a
Saturday. It scales with **active** users, so a successful launch makes it worse —
at 500 active players it is ~200 MB/month on its own, swallowing the 82 MB being
removed and more.

This is why §4's `playsWeekends` derivation is mandatory rather than a nicety, and
why the weekend rule moved into §3's scheduling.

## Alternatives ruled out

**B — self-scheduling sweep** (the issue's option B). Ruled out on arithmetic above:
two zones already occupy all 24 UTC hours, so it saves approximately nothing while
still reading all 393 players per run.

**C — daily planner, no chain.** One daily cron reads every player and schedules the
day's jobs. Genuinely attractive: self-healing *by construction* rather than by
repair, and simpler to test. Ruled out by the **1000-schedules-per-transaction cap**
— it schedules ~393 in one transaction (39% of the cap today) and **fails outright
past ~1000 players**, needing a two-level fan-out to survive growth. It also still
reads all 393 players daily and still needs the cancel-and-reschedule path so a
player's same-day settings edit applies the same day. The chain design schedules
**one per transaction** and is never near the cap.

**Denormalising `reminderHourUTC` and indexing it** (yhii's original proposal).
Already correctly ruled out on the parent issue: the stored value is wrong twice a
year at DST transitions for every player in an observing zone.

**Maintaining `playsWeekends` from the 8 team write paths.** See §4.

## Testing

`convex-test`'s `transactionLimits` meters `documentsRead` and `functionsScheduled`,
so every number in the accounting table becomes a test in the
`dashboardBandwidth.test.ts` style — **asserted from both sides**, because a ceiling
alone would pass at any number above the truth and would stop being a measurement.

The decisive assertion: **the daily pass does zero repair work when nothing is
broken**, which is the statement that the 82 MB floor is gone.

Three harness hazards the plan must respect:

1. **`finishAllScheduledFunctions` would never terminate** against a self-rescheduling
   chain. Eight existing call sites use it; the new tests need
   `finishInProgressScheduledFunctions`.
2. **`convex-test` never throws from `cancel_job`.** The real backend's cancel
   failure is unreachable by the unit suite, so it is only testable by injecting a
   throwing `scheduler.cancel` into the `...For` helper. Same blind-spot shape as the
   known ConvexError redaction gap.
3. **`undefined`-sorts-first must be pinned by a test.** It is the load-bearing
   property of the repair query and it is subtle enough that a future reader could
   "tidy it away". A test asserting an absent-field row is returned by the range
   query is what stops that.

`convex/crons.test.ts` asserts the **whole** cron map with `toEqual`, so it fails on
any added, removed or moved job by construction. It must be updated deliberately.

## Acceptance criteria

1. Enabling `REMINDERS_ENABLED` no longer starts an hourly full-table scan of
   `players`.
2. A player's reminder fires at their chosen local wall-clock time, across DST
   transitions in both directions, without ever adding 24 hours.
3. Changing `timeZone`, `reminderDeliveryTime` or `reminderDeliveryMethods`
   reschedules, and a superseded job delivers nothing.
4. `cancel()` failing — in any of its documented forms — cannot produce a duplicate
   reminder or one at the old time.
5. Existing players are scheduled without a migration mutation or a manual step.
6. A broken chain is repaired within 24 hours.
7. `REMINDERS_ENABLED=false` does not break the chains, and flipping it back needs no
   re-bootstrap.
8. Per-execution costs are pinned from both sides by tests.
9. All four gates green, run separately with no pipe: lint, typecheck, test:once,
   build. Baseline 2646 tests across 152 files.
10. e2e green in CI. **This means no regression, not new coverage** — and that is
    stated rather than left to look like a gap. Scheduling is not observable through
    the UI, so an e2e spec could only assert that the settings surface still works,
    which `e2e/settings.spec.ts` already does. Building a test-only surface to expose
    `nextReminderAt` to Playwright would be more machinery than proof. The real
    evidence for this work is the unit suite's metered costs plus a beta
    verification; e2e's job here is to catch a settings-path regression.

## Explicitly out of scope

- `chatNotify.sweep`, the other hourly cron — small today for structural reasons
  (`chatMeta` rows exist only per team that has ever chatted).
- Pricing or taking the Convex plan upgrade (wordle-teams-dcu option C).
- Widening `REMINDER_TIMES` beyond the 18 offered times.
- The ~5,000-player ceiling at which the daily pass's own `players` scan would
  deserve revisiting. Documented as a bound, not solved.
- Widening the picker to exercise the v1 midnight-wrap bug. That bug lived in
  `isDueThisHour`, which this design **deletes** (see below); the wrap is not "fixed",
  it ceases to have a host.

## One deletion, decided here rather than left to the plan

`isDueThisHour` becomes **unreachable** once scheduling is exact. The one-hour
inclusive window exists only because a cron ticks on the hour and has to ask "is this
player due *near* now"; a job that fires at the player's instant does not ask.

**It is deleted, with its tests.** Dead code carrying load-bearing comments is a trap:
the next reader cannot tell that the rules it documents no longer govern anything.

Two things it documented are worth keeping, so they move rather than vanish:

- **The double-match property.** Both bounds being inclusive meant most players
  matched twice a day (measured: 7,182 duplicate matches per zone over 399 days in
  each of four whole-hour-offset zones), and only `alreadyRemindedToday` absorbed it.
  Exact scheduling removes the double match — but `lastBoardEntryReminder` is
  **still claimed unconditionally before delivery**, because a duplicate job from a
  race would otherwise double-send. The guard survives its original reason.
- **The v1 midnight-wrap bug**, and the reason `REMINDER_TIMES` is a membership check
  rather than a shape check. That reasoning belongs on `REMINDER_TIMES` itself, where
  it still governs, and the plan moves it there.

Expect the test baseline to fall below 2,646 by the count of deleted
`isDueThisHour` cases. That is a deliberate reduction, and the plan states the
expected new number so it cannot be confused with a regression.
