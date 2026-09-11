# Per-Player Reminder Scheduling Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace `reminders.sweep`'s hourly full-table scan of `players` with one scheduled job per player, so that setting `REMINDERS_ENABLED=true` at cutover no longer adds ~82 MB/month of database I/O against a hard 1 GB cap.

**Architecture:** Each player holds one pending scheduled job. The player row is authoritative: every job carries the instant it was scheduled for (`dueAt`), so a superseded job self-retires and a failed `cancel()` cannot produce a duplicate or a wrong-time send. The delivery job reschedules the next occurrence as its last act, recomputing it live in the player's zone. A daily `maintain` pass derives `playsWeekends` from `teams`, repairs broken chains, and bootstraps players who have never been scheduled — one mechanism for all three.

**Tech Stack:** Convex (`internalMutation`, `ctx.scheduler.runAt`/`cancel`), TypeScript, Vitest + `convex-test`, Playwright (e2e regression only).

**Spec:** `docs/superpowers/specs/2026-09-11-per-player-reminder-scheduling-design.md`

**Issue:** wordle-teams-spcu (P1, launch blocker — reminders are ON at cutover)

---

## Before you start

**Working directory is `v2/`.** Every command below assumes it. `cd` does NOT
reliably persist inside a compound command in this shell (zoxide alias): put `cd` on
its own line, then run `pwd` to confirm.

**Run all four gates SEPARATELY after every task**, reading each exit code with no
pipe — zsh leaves `PIPESTATUS` empty, so a piped check can report a false green:

```
pnpm lint
pnpm typecheck
pnpm test:once
pnpm build
```

**Test baseline before this plan: 2646 tests across 152 files.** Task 7 deletes
`isDueThisHour`, `enteredOn` and `hasRecentActivity` with their tests, so the count
**will fall**. Task 7 records the expected new number. A falling count is only
correct at that task; anywhere else it is a regression.

**Do NOT run `convex init`.** It overwrites `v2/.env.local`, which holds a
prod-scoped `CONVEX_DEPLOY_KEY`. That key also outranks `CONVEX_DEPLOYMENT`, so
`convex env` and even `convex codegen` reach the BETA deployment rather than a local
one. `convex env list` is read-only and safe.

**Adding a new `convex/*.ts` needs `npx convex codegen --typecheck disable`** to
regenerate `api.d.ts`, or typecheck fails. This plan adds no new Convex module — only
new exports in existing ones — but `deliver` and `maintain` are new function
references, so **run codegen after Task 5 and Task 6** before typechecking.

**Branch:** `feat/v2-replatform`. Pushing it auto-deploys to beta when `v2/**`
changes, which is authorised. Not prod, not main. (The writing-plans skill suggests a
dedicated worktree; this repo's deploy pipeline and the standing beta authorisation
are tied to this branch, so work on the branch directly.)

**Three `convex-test` harness hazards this plan works around. Do not "fix" them:**

1. `finishAllScheduledFunctions` loops until nothing is pending, so it would **never
   terminate** against a self-rescheduling chain. Eight existing call sites use it.
   Every new test uses `finishInProgressScheduledFunctions` instead.
2. `convex-test`'s `1.0/cancel_job` patches state to `canceled` **unconditionally,
   from any state** (`node_modules/convex-test/dist/index.js:1166`). The real
   backend's cancel failure is unreachable by the unit suite, so it is tested by
   injecting a throwing `scheduler.cancel` into the `...For` helper.
3. `convex-test` enforces a hard **1000 `functionsScheduled` per transaction**
   (`node_modules/convex-test/dist/transactionMetrics.js:16`). That is the figure to
   design against; Task 6's cap exists because of it.

---

## File Structure

| File | Responsibility | Change |
|---|---|---|
| `convex/lib/reminders.ts` | Pure eligibility and time arithmetic. No Convex, no I/O, no env, no clock. | Add `instantForLocal`, `nextOccurrence`, `activityFloor`, `weekendPlayerIdsFrom`. Task 7 removes `isDueThisHour`, `enteredOn`, `hasRecentActivity`. |
| `convex/reminders.ts` | The scheduling and delivery mechanism. | Add `scheduleNextFor`, `reschedulePlayerReminderFor`, `deliver`, `maintain`. Task 7 removes `sweep`. |
| `convex/schema.ts` | `players` gains three fields. | Modify |
| `convex/settings.ts` | The four write paths that must trigger a reschedule. | Modify |
| `convex/crons.ts` | Swap the hourly reminder sweep for the daily maintenance pass. | Modify |
| `convex/lib/reminders.test.ts` | Pure-helper tests, including the multi-zone DST sweep. | Modify |
| `convex/reminders.test.ts` | Mechanism tests: staleness, cancel failure, reschedule-always, repair, bootstrap. | Rewrite |
| `convex/settings.test.ts` | Asserts each of the four write paths reschedules. | Modify |
| `convex/crons.test.ts` | Asserts the whole cron map with `toEqual`. | Modify |
| `convex/dashboardBandwidth.test.ts` | Metered per-execution cost ceilings. | Modify |
| `docs/runbooks/2026-cutover.md` | Ordering requirement before the flag flips. | Modify |

---

## Task 1: Pure time and weekend helpers

> **AMENDED AFTER IMPLEMENTATION, 2026-09-11. The committed code is correct and this
> section's original text was not.** Three changes were made during execution, all
> approved, and the code in `convex/lib/reminders.ts` is now the source of truth over
> the snippets below:
>
> 1. **`localParts` memoizes its `Intl.DateTimeFormat` per timezone.** It was
>    constructing a new formatter on every call — roughly 56,000 constructions in the
>    sweep test, which made that test 7.2s under full-suite contention and prompted a
>    20s timeout override. Memoizing measured **13.2x faster** (768ms → 58ms per
>    20,000 calls), the sweep dropped to ~450ms, and the override was removed. It also
>    cuts CPU on the per-player delivery path. The cache is populated only after a
>    successful construction, so an invalid zone still throws `RangeError` from the
>    constructor — verified empirically that `localParts('GMT+5')` throws on the second
>    and third calls, not just the first.
> 2. **The nonexistent-time claim below is FALSE and has been corrected in the code.**
>    See the correction in the spec's §3, and note that four probe rounds are
>    **load-bearing** (parity decides which side of a DST gap you land on), not the
>    belt-and-braces the original comment called them.
> 3. **The sweep's `DATES` gained `2026-09-27` and `2026-10-04`** to straddle the
>    southern-hemisphere and New Zealand spring-forward, which the original ten dates
>    missed (they covered the northern transitions both ways and the southern
>    fall-back only). **The pinned case count is therefore 13,440, not 11,200.**

All four are pure, so they are directly testable — which matters here because
`convex-test` cannot authenticate (wordle-teams-obw), making anything inside a
query/mutation wrapper unreachable by the unit suite.

**Files:**
- Modify: `convex/lib/reminders.ts`
- Test: `convex/lib/reminders.test.ts`

- [ ] **Step 1: Write the failing tests**

Append to `convex/lib/reminders.test.ts`. Add `instantForLocal`, `nextOccurrence`,
`activityFloor` and `weekendPlayerIdsFrom` to the existing import from
`./reminders.ts`.

```ts
describe('instantForLocal', () => {
  test('resolves a wall clock in a zone to the instant it happens at', () => {
    // 2026-09-11 09:00 in Chicago (CDT, UTC-5) is 14:00 UTC.
    expect(instantForLocal('America/Chicago', '2026-09-11', '09:00:00')).toBe(
      new Date('2026-09-11T14:00:00Z').getTime(),
    )
  })

  test('accepts both IANA spellings of an aliased zone', () => {
    // Load-bearing: copied rows carry v1's Postgres names ('Asia/Calcutta'),
    // natively-created ones carry whatever the browser reports ('Asia/Kolkata').
    expect(instantForLocal('Asia/Calcutta', '2026-09-11', '07:00:00')).toBe(
      instantForLocal('Asia/Kolkata', '2026-09-11', '07:00:00'),
    )
  })

  test('handles a half-hour offset zone', () => {
    // Kolkata is UTC+5:30, so 07:00 local is 01:30 UTC.
    expect(instantForLocal('Asia/Kolkata', '2026-09-11', '07:00:00')).toBe(
      new Date('2026-09-11T01:30:00Z').getTime(),
    )
  })
})

describe('nextOccurrence', () => {
  const at = (iso: string) => new Date(iso).getTime()

  test('returns today if the time has not passed yet in the player zone', () => {
    // 14:00:01 UTC is 09:00:01 Chicago, so a 09:00 reminder has just gone by;
    // an 18:00 one has not.
    expect(nextOccurrence('America/Chicago', '18:00:00', at('2026-09-11T14:00:01Z'), true)).toBe(
      at('2026-09-11T23:00:00Z'),
    )
  })

  test('rolls to tomorrow once the time has passed', () => {
    expect(nextOccurrence('America/Chicago', '09:00:00', at('2026-09-11T14:00:01Z'), true)).toBe(
      at('2026-09-12T14:00:00Z'),
    )
  })

  // THE DST CASES ARE THE POINT OF THIS FUNCTION. The gap to the next
  // occurrence is NOT 24 hours across a transition, and asserting the gap is
  // what proves nothing anywhere adds 24h — see the doc comment.
  test('spans 23 hours across a spring-forward, not 24', () => {
    const from = at('2027-03-13T15:00:00Z') // 09:00 Chicago, the day before
    const next = nextOccurrence('America/Chicago', '09:00:00', from, true)
    expect(next).toBe(at('2027-03-14T14:00:00Z'))
    expect(next - from).toBe(23 * 60 * 60 * 1000)
  })

  test('spans 25 hours across a fall-back, not 24', () => {
    const from = at('2026-10-31T14:00:01Z') // just after 09:00 Chicago
    const next = nextOccurrence('America/Chicago', '09:00:00', from, true)
    expect(next).toBe(at('2026-11-01T15:00:00Z'))
    expect(next - from).toBe(25 * 60 * 60 * 1000 - 1000)
  })

  test('handles a 30-minute DST shift (Lord Howe)', () => {
    const from = at('2027-04-03T18:00:01Z')
    const next = nextOccurrence('Australia/Lord_Howe', '05:00:00', from, true)
    expect(next - from).toBe(30 * 60 * 1000 - 1000)
  })

  test('skips the weekend when the player is on no weekend-playing team', () => {
    // 2026-09-11 is a Friday. 14:00:01 UTC is 09:00:01 Chicago, so the next
    // 09:00 is Saturday — which a weekday-only player must skip, landing on
    // Monday, 72 hours later.
    const from = at('2026-09-11T14:00:01Z')
    const next = nextOccurrence('America/Chicago', '09:00:00', from, false)
    expect(next).toBe(at('2026-09-14T14:00:00Z'))
    expect(next - from).toBe(72 * 60 * 60 * 1000 - 1000)
  })

  test('does not skip the weekend when the player does play weekends', () => {
    const from = at('2026-09-11T14:00:01Z')
    expect(nextOccurrence('America/Chicago', '09:00:00', from, true)).toBe(
      at('2026-09-12T14:00:00Z'),
    )
  })

  test('always returns an instant strictly in the future', () => {
    // The delivery job schedules from `now`; an instant equal to `now` would
    // fire immediately and could spin.
    const from = at('2026-09-11T14:00:00Z') // EXACTLY 09:00 Chicago
    expect(nextOccurrence('America/Chicago', '09:00:00', from, true)).toBeGreaterThan(from)
  })
})

/**
 * THE SWEEP. Every case asserts three properties at once: the instant lands on
 * the requested wall clock in that zone, it is strictly in the future, and a
 * weekday-only player never lands on a weekend.
 *
 * ZONE LIST IS CURATED, NOT `Intl.supportedValuesOf('timeZone')`. The full 418
 * zones is 167,200 cases and takes ~35s, which does not belong in a suite of
 * 152 files. These 28 were chosen to cover both DST directions, the southern
 * hemisphere, half-hour and 45-minute offsets, a 30-minute DST shift, the
 * aliased spellings copied rows carry, and the extremes of the offset range.
 * MEASURED: 13,440 cases in ~450ms (was 11,200 in ~1.8s before localParts
 * memoized its formatter; see the amendment note at the top of this task).
 *
 * The full 418-zone sweep WAS run before this design was accepted — 167,200
 * cases, zero failures, gaps from 0.25h to 72.00h — and again under TZ=UTC,
 * America/Chicago and Asia/Kolkata with identical results, which is what rules
 * out a helper that only works on the host's timezone. Re-run it by widening
 * ZONES here if this function is ever reworked.
 */
describe('nextOccurrence across zones and DST transitions', () => {
  const ZONES = [
    'UTC', 'America/Chicago', 'America/New_York', 'America/Denver',
    'America/Los_Angeles', 'America/Phoenix', 'America/Sao_Paulo',
    'America/St_Johns', 'Europe/London', 'Europe/Lisbon', 'Europe/Berlin',
    'Europe/Dublin', 'Africa/Cairo', 'Africa/Lagos', 'Asia/Jerusalem',
    'Asia/Tehran', 'Asia/Kolkata', 'Asia/Calcutta', 'Asia/Kathmandu',
    'Asia/Tokyo', 'Asia/Shanghai', 'Australia/Sydney', 'Australia/Adelaide',
    'Australia/Lord_Howe', 'Pacific/Honolulu', 'Pacific/Auckland',
    'Pacific/Chatham', 'Pacific/Kiritimati',
  ]
  // Chosen to straddle the world's DST transitions plus ordinary days.
  const DATES = [
    '2026-03-08', '2026-03-29', '2026-04-05', '2026-09-11', '2026-10-25',
    '2026-11-01', '2027-03-14', '2027-04-04', '2027-09-17', '2027-10-31',
  ]
  const TIMES = ['05:00:00', '09:00:00', '13:00:00', '18:00:00', '22:00:00']

  test('lands on the requested wall clock, in the future, honouring weekends', () => {
    let checked = 0
    for (const timeZone of ZONES) {
      for (const time of TIMES) {
        for (const date of DATES) {
          for (const hour of [0, 6, 12, 18]) {
            for (const playsWeekends of [true, false]) {
              const from = new Date(`${date}T${String(hour).padStart(2, '0')}:00:01Z`).getTime()
              const next = nextOccurrence(timeZone, time, from, playsWeekends)
              const local = localParts(timeZone, new Date(next))
              // Asserted with a message because a bare failure among 13,440
              // cases is not diagnosable.
              const where = `${timeZone} ${time} from ${date}T${hour} pw=${playsWeekends}`
              expect(local.time, where).toBe(time)
              expect(next, where).toBeGreaterThan(from)
              if (!playsWeekends) expect(isWeekendDay(local.day), where).toBe(false)
              checked++
            }
          }
        }
      }
    }
    // Pinned so that silently emptying a loop bound cannot make this pass
    // vacuously — 28 zones x 5 times x 10 dates x 4 hours x 2.
    expect(checked).toBe(13440)
  })
})

describe('activityFloor', () => {
  test('is the tenth day back, inclusive', () => {
    expect(activityFloor('2026-09-11')).toBe('2026-09-01')
  })
})

describe('weekendPlayerIdsFrom', () => {
  test('collects members of weekend-playing teams only', () => {
    const teams = [
      { playWeekends: true, playerIds: ['a', 'b'] },
      { playWeekends: false, playerIds: ['c'] },
      { playWeekends: true, playerIds: ['b', 'd'] },
    ]
    expect(weekendPlayerIdsFrom(teams)).toEqual(new Set(['a', 'b', 'd']))
  })

  test('is empty when no team plays weekends', () => {
    expect(weekendPlayerIdsFrom([{ playWeekends: false, playerIds: ['a'] }])).toEqual(new Set())
  })
})
```

`isWeekendDay` must be imported in the test file from `./puzzleDay.ts`.

- [ ] **Step 2: Run the tests to verify they fail**

```
pnpm test:once convex/lib/reminders.test.ts
```

Expected: FAIL — `instantForLocal is not a function`, and the same for the other
three.

- [ ] **Step 3: Implement the four helpers**

Append to `convex/lib/reminders.ts`. `addDays` and `isWeekendDay` are already
imported at the top of that file; add nothing to the import.

```ts
/**
 * The instant at which `day` + `time` is the wall clock in `timeZone`.
 *
 * PROBE AND CORRECT, NOT AN OFFSET TABLE. There is no API that inverts
 * `Intl.DateTimeFormat`, so this guesses the instant as if the zone were UTC,
 * formats that guess BACK through localParts, and shifts by the difference.
 * Two or three rounds converge for every zone ICU knows, because the drift is
 * the offset and applying it can only be wrong again by the amount a DST
 * boundary moved inside the correction — which the next round absorbs. Four
 * rounds is belt-and-braces; measured convergence is within three.
 *
 * NOTHING TIME-DEPENDENT IS STORED OR ASSUMED. The zone's offset is asked for
 * at the moment of asking, which is the same reason the sweep this replaces
 * was DST-safe.
 *
 * AMBIGUOUS AND NONEXISTENT TIMES. A fall-back makes a wall clock happen twice;
 * this returns the FIRST. A spring-forward erases one entirely; this returns
 * the instant just BEFORE the gap. CORRECTED DURING EXECUTION: this originally
 * read "just after the gap", and claimed neither case was reachable through
 * REMINDER_TIMES in any zone today. BOTH WERE FALSE. Pacific/Easter transitions
 * at 22:00 local and 22:00:00 is one of the eighteen offered times, so a player
 * there gets a 22:00 reminder at 21:00 local, one day a year -- measured across
 * 2026-2028, and walked across the transition to confirm no spin and no drift.
 * The FOUR-ROUND BOUND IS LOAD-BEARING, not belt-and-braces: its parity decides
 * which side of a gap you land on (1/3/5 post-gap, 2/4 pre-gap). Both paths are
 * pinned in the tests so that widening the picker fails loudly rather than
 * quietly.
 *
 * PRECONDITION: `timeZone` must be a zone ICU accepts — see localParts, whose
 * RangeError this propagates unchanged. Callers skip the player rather than
 * letting one bad copied row abort anything.
 */
export function instantForLocal(timeZone: string, day: PuzzleDay, time: LocalTime): number {
  const [year, month, date] = day.split('-').map(Number)
  const [hour, minute, second] = time.split(':').map(Number)
  const wanted = Date.UTC(year, month - 1, date, hour, minute, second)

  let guess = wanted
  for (let round = 0; round < 4; round++) {
    const back = localParts(timeZone, new Date(guess))
    const [by, bm, bd] = back.day.split('-').map(Number)
    const [bh, bmi, bs] = back.time.split(':').map(Number)
    const drift = wanted - Date.UTC(by, bm - 1, bd, bh, bmi, bs)
    if (drift === 0) return guess
    guess += drift
  }
  return guess
}

/**
 * The next instant at which it is `reminderTime` in `timeZone`, strictly after
 * `from`, skipping Saturday and Sunday unless the player plays weekends.
 *
 * RECOMPUTED FROM SCRATCH EVERY TIME IT IS SCHEDULED. Never derived by adding
 * 24 hours to the last one: that drifts by an hour across every DST transition
 * and the drift accumulates. The tests assert the GAP rather than only the
 * result — 23h across a spring-forward, 25h across a fall-back, 30min for Lord
 * Howe, 72h across a skipped weekend — because the gap is the only thing that
 * distinguishes this from `+24h` on an ordinary day.
 *
 * STRICTLY AFTER `from` IS LOAD-BEARING. The delivery job calls this with
 * `Date.now()` at the exact instant it was itself due, so a non-strict
 * comparison would return that same instant, fire immediately, and spin.
 *
 * THE WEEKEND RULE LIVES HERE rather than in the delivery job, and that is what
 * keeps the job's cost at one document. Asking "is this player on a team that
 * plays weekends" at delivery time means a `teams` scan PER PLAYER, because
 * Convex cannot index array membership — 171 rows times every active player due
 * on a Saturday, a cost that scales with active users and would be larger than
 * the sweep this whole change removes. `playsWeekends` is derived onto the
 * player row by `maintain` instead; see convex/reminders.ts.
 *
 * The ten-day loop bound cannot be reached: two consecutive skipped days is the
 * most the weekend rule can ask for. It exists so that a future rule that
 * skipped more could never hang a mutation.
 */
export function nextOccurrence(
  timeZone: string,
  reminderTime: LocalTime,
  from: number,
  playsWeekends: boolean,
): number {
  let day = localParts(timeZone, new Date(from)).day
  for (let i = 0; i < 10; i++) {
    if (playsWeekends || !isWeekendDay(day)) {
      const at = instantForLocal(timeZone, day, reminderTime)
      if (at > from) return at
    }
    day = addDays(day, 1)
  }
  throw new Error(`[reminders] no next occurrence for ${timeZone} at ${reminderTime}`)
}

/**
 * The oldest day that still counts as recent activity: v1's trailing ten days,
 * inclusive of the tenth.
 *
 * Extracted from the deleted `hasRecentActivity` so the rule survives the move
 * from "collect eleven days and inspect them" to "ask the index whether
 * anything exists at or after this day". The window is the part worth keeping
 * testable; the existence check is the index's job.
 */
export function activityFloor(localDay: PuzzleDay): PuzzleDay {
  return addDays(localDay, -10)
}

/**
 * The players who are on at least one weekend-playing team.
 *
 * Structurally typed rather than taking `Doc<'teams'>` so this stays pure and
 * testable with plain objects — the same reason every other rule in this file
 * takes primitives. Convex cannot index array membership (see schema.ts's note
 * on the `teams` table), so the caller collects the table; this is the rule it
 * applies to the result.
 */
export function weekendPlayerIdsFrom<Id extends string>(
  teams: ReadonlyArray<{ playWeekends: boolean; playerIds: ReadonlyArray<Id> }>,
): Set<Id> {
  const ids = new Set<Id>()
  for (const team of teams) {
    if (!team.playWeekends) continue
    for (const id of team.playerIds) ids.add(id)
  }
  return ids
}
```

- [ ] **Step 4: Run the tests to verify they pass**

```
pnpm test:once convex/lib/reminders.test.ts
```

Expected: PASS. The sweep test should report roughly 1.8s.

- [ ] **Step 5: Confirm the helpers are not host-timezone dependent**

The suite runs under UTC in CI but on the host's zone locally, and a time helper
that only works in one is a real hazard here.

```
TZ=UTC pnpm test:once convex/lib/reminders.test.ts
TZ=Asia/Kolkata pnpm test:once convex/lib/reminders.test.ts
TZ=Pacific/Kiritimati pnpm test:once convex/lib/reminders.test.ts
```

Expected: identical PASS in all three. If any differs, stop — the helper is
reading the host clock somewhere it should be reading `timeZone`.

- [ ] **Step 6: Run all four gates**

```
pnpm lint
pnpm typecheck
pnpm test:once
pnpm build
```

Expected: all pass. Test count rises from 2646 by the number of cases added.

- [ ] **Step 7: Commit**

```bash
git add convex/lib/reminders.ts convex/lib/reminders.test.ts
git commit -F - <<'EOF'
feat(reminders): DST-safe next-occurrence and weekend helpers

nextOccurrence recomputes the next instant in the player's own zone from
scratch every time, never by adding 24 hours -- the tests assert the GAP
(23h across a spring-forward, 25h across a fall-back, 30min for Lord Howe,
72h across a skipped weekend) because the gap is the only thing that
distinguishes this from +24h on an ordinary day.

instantForLocal inverts Intl by probing and correcting rather than storing an
offset, so nothing time-dependent is ever stored.

The weekend rule lives in the scheduling rather than at delivery, which is
what will keep the delivery job at one document read: asking "is this player
on a weekend-playing team" per player means a teams scan per player, since
Convex cannot index array membership.

Swept over all 418 IANA zones x 5 times x 40 instants straddling the world's
DST transitions before landing: 167,200 cases, zero failures, and identical
under TZ=UTC, America/Chicago and Asia/Kolkata. The committed test keeps a
curated 28 zones -- 13,440 cases in ~450ms -- because the full sweep takes 35s.

Refs: wordle-teams-spcu

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>
EOF
```

---

## Task 2: Schema fields

**Files:**
- Modify: `convex/schema.ts` (the `players` table, after `lastBoardEntryReminder`)
- Test: `convex/schema.test.ts`

No index is added. `maintain` (Task 6) scans `players` in full to derive
`playsWeekends`, so the repair reads from that same scan; an index on
`nextReminderAt` would narrow a query nothing makes.

- [ ] **Step 1: Write the failing test**

Append to `convex/schema.test.ts`:

```ts
describe('players reminder scheduling fields', () => {
  test('accepts a scheduled job id, its due instant, and a weekend flag', async () => {
    const t = convexTest(schema, modules)
    const playerId = await t.run(async (ctx) => {
      const id = await ctx.db.insert('players', aPlayer())
      const jobId = await ctx.scheduler.runAfter(60_000, internal.reminders.deliver, {
        playerId: id,
        dueAt: 1,
      })
      await ctx.db.patch(id, {
        reminderJobId: jobId,
        nextReminderAt: 1_760_000_000_000,
        playsWeekends: true,
      })
      return id
    })

    const player = await t.run((ctx) => ctx.db.get(playerId))
    expect(player?.nextReminderAt).toBe(1_760_000_000_000)
    expect(player?.playsWeekends).toBe(true)
    expect(player?.reminderJobId).toBeDefined()
  })

  test('all three are optional, so an unscheduled player is a valid row', async () => {
    // Existing players have none of them. This is what makes Task 6's bootstrap
    // the same case as a broken chain rather than a separate migration.
    const t = convexTest(schema, modules)
    const player = await t.run(async (ctx) => {
      const id = await ctx.db.insert('players', aPlayer())
      return await ctx.db.get(id)
    })
    expect(player?.nextReminderAt).toBeUndefined()
    expect(player?.reminderJobId).toBeUndefined()
    expect(player?.playsWeekends).toBeUndefined()
  })
})
```

This test references `internal.reminders.deliver`, which does not exist until
Task 5. **Write this test now but expect it to fail on that reference**; it turns
green at Task 5. If you prefer a green gate at every task, schedule
`internal.reminders.sweep` here and change it to `deliver` in Task 5.

- [ ] **Step 2: Run to verify it fails**

```
pnpm test:once convex/schema.test.ts
```

Expected: FAIL — the three fields are not in the schema, so `ctx.db.patch` throws a
validation error naming them.

- [ ] **Step 3: Add the three fields**

In `convex/schema.ts`, inside `players: defineTable({ ... })`, immediately after
`lastBoardEntryReminder: v.optional(v.number()),`:

```ts
    // THE PENDING REMINDER JOB, and the instant it is due. Absent means this
    // player has no reminder scheduled — which is the state every existing row
    // is in, and is exactly why `maintain` needs no migration to bootstrap
    // them: "never scheduled" and "chain broke" are the same case to it.
    //
    // nextReminderAt IS THE SOURCE OF TRUTH, NOT reminderJobId. Every scheduled
    // job carries the instant it was scheduled for as an argument, and refuses
    // to act if it does not match this field. That is what makes
    // `ctx.scheduler.cancel` best-effort rather than load-bearing: Convex
    // documents cancel as able to FAIL once a job has committed, and a stale
    // job that cannot be cancelled would otherwise deliver at the old time.
    // Here it reads this field, sees it has been superseded, and retires.
    //
    // DO NOT ADD AN INDEX ON nextReminderAt. It would narrow a query nothing
    // makes: `maintain` already collects the whole table to derive
    // playsWeekends below, and reads the repair set from that same scan.
    reminderJobId: v.optional(v.id('_scheduled_functions')),
    nextReminderAt: v.optional(v.number()),

    // WHETHER THIS PLAYER IS ON ANY TEAM WITH playWeekends, DERIVED — never set
    // by a user and never authoritative. `teams` is the truth; this is a cache
    // of it, recomputed by `maintain` daily and by nothing else.
    //
    // ONE WRITER, DELIBERATELY, AND THE ALTERNATIVE WAS MEASURED. teams.playerIds
    // and teams.playWeekends have EIGHT write paths across six modules
    // (teams.ts x4, players.ts, inviteLinks.ts, billing.ts x2). Maintaining this
    // from all of them is the drift shape this schema keeps warning about, and
    // drift here is silent and permanent. A daily recompute cannot drift for
    // more than a day and repairs itself; the cost of that staleness is one
    // possibly-missed or one extra weekend reminder, which is the same trade
    // teamStats.sweep took when it went daily.
    //
    // WHY IT IS DENORMALISED AT ALL: the reminder is delivered by a per-player
    // scheduled job, and Convex cannot index array membership, so asking `teams`
    // the question at delivery time costs a 171-row scan PER PLAYER. That scales
    // with ACTIVE users — roughly 200 MB/month at 500 active players, larger
    // than the hourly sweep this replaced. See lib/reminders.ts's nextOccurrence.
    //
    // ABSENT MEANS "not yet derived", which `maintain` treats as false. False is
    // the safe answer: it suppresses a weekend reminder rather than sending one
    // to somebody whose team does not play weekends.
    playsWeekends: v.optional(v.boolean()),
```

- [ ] **Step 4: Run to verify the field tests pass**

```
pnpm test:once convex/schema.test.ts
```

Expected: the "all three are optional" test PASSES. The first test still fails on
`internal.reminders.deliver` until Task 5 — that is expected and noted in Step 1.

- [ ] **Step 5: Run all four gates**

```
pnpm lint
pnpm typecheck
pnpm test:once
pnpm build
```

Expected: lint, typecheck and build pass. `test:once` has the one known failure
above.

- [ ] **Step 6: Commit**

```bash
git add convex/schema.ts convex/schema.test.ts
git commit -F - <<'EOF'
feat(schema): reminder scheduling fields on players

nextReminderAt is the source of truth, not reminderJobId. Every scheduled job
carries the instant it was scheduled for and refuses to act unless it matches,
which is what makes ctx.scheduler.cancel best-effort: Convex documents cancel
as able to fail once a job has committed, and a stale job that could not be
cancelled would otherwise deliver at the old time.

All three are optional, so an unscheduled player is a valid row -- that is
what lets the maintenance pass treat "never scheduled" and "chain broke" as
one case and bootstrap existing players with no migration.

playsWeekends is derived by ONE writer. teams.playerIds and playWeekends have
eight write paths across six modules, and drift in a cache maintained from all
of them would be silent and permanent.

Refs: wordle-teams-spcu

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>
EOF
```

---

## Task 3: The scheduling helpers

Two functions, and the split matters. `deliver` (Task 5) reschedules itself, and at
that moment `reminderJobId` points at the job that is currently running —
cancelling it would hit precisely the "fail to cancel if it has committed" case
Convex documents. So `deliver` uses `scheduleNextFor`, which does not cancel.
Everything else uses `reschedulePlayerReminderFor`, which does.

Both are `...For` helpers taking `MutationCtx`, per this repo's rule that a rule in
a mutation body is a rule no test can reach.

**Files:**
- Modify: `convex/reminders.ts`
- Test: `convex/reminders.test.ts`

- [ ] **Step 1: Write the failing tests**

Add to `convex/reminders.test.ts`:

```ts
describe('scheduleNextFor', () => {
  test('schedules the next occurrence and records both the id and the instant', async () => {
    const t = convexTest(schema, modules)
    const playerId = await t.run(async (ctx) =>
      ctx.db.insert('players', dueChicagoPlayer({ playsWeekends: true })),
    )

    const from = new Date('2026-09-11T14:00:01Z').getTime() // just after 09:00 Chicago
    await t.run(async (ctx) => {
      await scheduleNextFor(ctx, playerId, from)
    })

    const player = await t.run((ctx) => ctx.db.get(playerId))
    expect(player?.nextReminderAt).toBe(new Date('2026-09-12T14:00:00Z').getTime())
    expect(player?.reminderJobId).toBeDefined()

    const jobs = await t.run((ctx) => ctx.db.system.query('_scheduled_functions').collect())
    expect(jobs).toHaveLength(1)
    expect(jobs[0].name).toBe('reminders:deliver')
    // THE ARGS CARRY dueAt, AND IT MATCHES THE ROW. This is the whole staleness
    // mechanism; a job scheduled without it could never tell it was superseded.
    expect(jobs[0].args[0]).toEqual({ playerId, dueAt: player?.nextReminderAt })
  })

  test('does not schedule a player with no timeZone', async () => {
    // A copied row can have none, and there is no zone to compute an occurrence
    // in. updateTimeZoneFor schedules them the moment they get one.
    const t = convexTest(schema, modules)
    const playerId = await t.run(async (ctx) =>
      ctx.db.insert('players', dueChicagoPlayer({ timeZone: undefined })),
    )

    await t.run((ctx) => scheduleNextFor(ctx, playerId, Date.now()))

    const player = await t.run((ctx) => ctx.db.get(playerId))
    expect(player?.nextReminderAt).toBeUndefined()
    const jobs = await t.run((ctx) => ctx.db.system.query('_scheduled_functions').collect())
    expect(jobs).toHaveLength(0)
  })

  test('does not schedule a player whose timeZone is unresolvable', async () => {
    // updateTimeZoneFor rejects these, but a row copied from Supabase never
    // passed through it. One bad row must not take a batch down, so this is
    // swallowed and logged rather than thrown — the same rule the sweep had.
    const t = convexTest(schema, modules)
    const playerId = await t.run(async (ctx) =>
      ctx.db.insert('players', dueChicagoPlayer({ timeZone: 'GMT+5' })),
    )

    await t.run((ctx) => scheduleNextFor(ctx, playerId, Date.now()))

    const player = await t.run((ctx) => ctx.db.get(playerId))
    expect(player?.nextReminderAt).toBeUndefined()
  })

  test('treats an absent playsWeekends as false', async () => {
    // Absent means "not yet derived". False is the safe reading: it suppresses a
    // weekend reminder rather than sending one to a weekday-only team.
    const t = convexTest(schema, modules)
    const playerId = await t.run(async (ctx) =>
      ctx.db.insert('players', dueChicagoPlayer({ playsWeekends: undefined })),
    )

    // 2026-09-11 is a Friday; 14:00:01Z is just after 09:00 Chicago.
    await t.run((ctx) =>
      scheduleNextFor(ctx, playerId, new Date('2026-09-11T14:00:01Z').getTime()),
    )

    const player = await t.run((ctx) => ctx.db.get(playerId))
    // Monday, not Saturday.
    expect(player?.nextReminderAt).toBe(new Date('2026-09-14T14:00:00Z').getTime())
  })
})

describe('reschedulePlayerReminderFor', () => {
  test('cancels the previous job before scheduling the new one', async () => {
    const t = convexTest(schema, modules)
    const playerId = await t.run(async (ctx) =>
      ctx.db.insert('players', dueChicagoPlayer({ playsWeekends: true })),
    )

    const from = new Date('2026-09-11T14:00:01Z').getTime()
    await t.run((ctx) => scheduleNextFor(ctx, playerId, from))
    const first = await t.run((ctx) => ctx.db.get(playerId))

    await t.run((ctx) => reschedulePlayerReminderFor(ctx, playerId, from))
    const second = await t.run((ctx) => ctx.db.get(playerId))

    expect(second?.reminderJobId).not.toBe(first?.reminderJobId)

    const jobs = await t.run((ctx) => ctx.db.system.query('_scheduled_functions').collect())
    const byId = new Map(jobs.map((j) => [j._id, j]))
    expect(byId.get(first!.reminderJobId!)?.state.kind).toBe('canceled')
    expect(byId.get(second!.reminderJobId!)?.state.kind).toBe('pending')
  })

  test('still schedules when cancel throws', async () => {
    // THIS IS UNREACHABLE THROUGH THE HARNESS. convex-test's cancel_job patches
    // state to 'canceled' unconditionally from any state and never throws
    // (node_modules/convex-test/dist/index.js:1166), while the real backend
    // documents cancel as able to fail once a job has committed. So the only way
    // to reach the catch is to inject a throwing scheduler — which is possible
    // ONLY because this rule lives in a ...For helper taking MutationCtx rather
    // than in a mutation body.
    const t = convexTest(schema, modules)
    const playerId = await t.run(async (ctx) =>
      ctx.db.insert('players', dueChicagoPlayer({ playsWeekends: true })),
    )
    const from = new Date('2026-09-11T14:00:01Z').getTime()
    await t.run((ctx) => scheduleNextFor(ctx, playerId, from))

    await t.run(async (ctx) => {
      const hostile = {
        ...ctx,
        db: ctx.db,
        scheduler: {
          runAt: ctx.scheduler.runAt.bind(ctx.scheduler),
          runAfter: ctx.scheduler.runAfter.bind(ctx.scheduler),
          cancel: () => Promise.reject(new Error('job already completed')),
        },
      } as unknown as Parameters<typeof reschedulePlayerReminderFor>[0]
      await reschedulePlayerReminderFor(hostile, playerId, from)
    })

    const player = await t.run((ctx) => ctx.db.get(playerId))
    // The new job exists despite the cancel failing. The old one is left
    // pending, and harmlessly so: it carries the old dueAt and will retire.
    expect(player?.nextReminderAt).toBe(new Date('2026-09-12T14:00:00Z').getTime())
    expect(player?.reminderJobId).toBeDefined()
  })
})
```

Import `scheduleNextFor` and `reschedulePlayerReminderFor` from `./reminders.ts` at
the top of the test file.

- [ ] **Step 2: Run to verify they fail**

```
pnpm test:once convex/reminders.test.ts
```

Expected: FAIL — `scheduleNextFor is not a function`.

- [ ] **Step 3: Implement both helpers**

Add to `convex/reminders.ts`. Add `nextOccurrence` to the existing import from
`./lib/reminders.ts`, and import `MutationCtx` and `Id`:

```ts
import type { Id } from './_generated/dataModel'
import type { MutationCtx } from './_generated/server'
```

```ts
/**
 * Schedule this player's next reminder WITHOUT cancelling their current one.
 *
 * THE MISSING CANCEL IS THE POINT, not an omission. `deliver` calls this to
 * schedule tomorrow, and at that moment `player.reminderJobId` is the id of
 * the job that is running right now. Convex documents `cancel` as able to fail
 * once a job has committed, so cancelling yourself is the one call guaranteed
 * to be pointless at best. Everything with a genuinely stale job to clear calls
 * `reschedulePlayerReminderFor` below instead.
 *
 * PATCHES BOTH FIELDS TOGETHER, AND `dueAt` GOES INTO THE JOB'S ARGS. That
 * pairing is the staleness mechanism: the row says when the pending job is for,
 * the job says which instant it was created for, and `deliver` refuses to act
 * unless they agree. Split them, or drop `dueAt` from the args, and a job that
 * outlived a settings change starts delivering at the old time.
 *
 * A PLAYER WITH NO USABLE ZONE IS LEFT UNSCHEDULED, not thrown over. There is
 * no zone to compute an occurrence in. `updateTimeZoneFor` schedules them the
 * moment they get one, and `maintain` retries them daily at no extra cost,
 * since it is already reading every row. An unresolvable zone is logged and
 * swallowed for the reason the sweep did the same: `schema.ts` types timeZone
 * as unvalidated `v.optional(v.string())`, a copied Supabase row never passed
 * through `updateTimeZoneFor`, and one bad row must not abort a batch that
 * `maintain` runs over all 393 players.
 */
export async function scheduleNextFor(
  ctx: MutationCtx,
  playerId: Id<'players'>,
  from: number,
): Promise<void> {
  const player = await ctx.db.get(playerId)
  if (!player) return

  const timeZone = player.timeZone
  if (!timeZone) return

  let dueAt: number
  try {
    dueAt = nextOccurrence(
      timeZone,
      player.reminderDeliveryTime,
      from,
      player.playsWeekends ?? false,
    )
  } catch (error) {
    console.error(
      '[reminders] cannot compute a next occurrence for a player',
      { playerId, timeZone, reminderDeliveryTime: player.reminderDeliveryTime },
      error,
    )
    return
  }

  const reminderJobId = await ctx.scheduler.runAt(dueAt, internal.reminders.deliver, {
    playerId,
    dueAt,
  })
  await ctx.db.patch(playerId, { reminderJobId, nextReminderAt: dueAt })
}

/**
 * Cancel this player's pending reminder, if any, and schedule the next one.
 *
 * Called from every path that changes an input to the schedule — `timeZone`,
 * `reminderDeliveryTime`, `reminderDeliveryMethods` (settings.ts) — and from
 * `maintain` when it finds a chain that needs repairing or has never existed.
 *
 * THE CANCEL IS BEST-EFFORT AND ITS FAILURE IS HARMLESS, which is a stronger
 * property than tolerating a throw. Convex documents `cancel` as throwing for a
 * completed action and as able to "fail to cancel if it has committed" for a
 * mutation, and neither case can be reproduced in `convex-test` at all. It does
 * not matter: the row is the source of truth, so an uncancelled job carrying a
 * superseded `dueAt` reads the row, sees the mismatch, and retires without
 * delivering or rescheduling. Cancelling is a tidiness measure that keeps
 * `_scheduled_functions` from filling with jobs that will no-op.
 *
 * SO DO NOT "FIX" THIS BY LETTING THE ERROR PROPAGATE. Throwing here would roll
 * back the whole transaction, which means the settings change the player just
 * made would be discarded because a cleanup step failed.
 */
export async function reschedulePlayerReminderFor(
  ctx: MutationCtx,
  playerId: Id<'players'>,
  from: number = Date.now(),
): Promise<void> {
  const player = await ctx.db.get(playerId)
  if (!player) return

  if (player.reminderJobId) {
    try {
      await ctx.scheduler.cancel(player.reminderJobId)
    } catch (error) {
      console.warn(
        '[reminders] could not cancel a pending reminder job; it will retire on its own',
        { playerId, reminderJobId: player.reminderJobId },
        error,
      )
    }
  }

  await scheduleNextFor(ctx, playerId, from)
}
```

- [ ] **Step 4: Regenerate the API types**

`internal.reminders.deliver` does not exist yet, so typecheck will fail on it. Add a
placeholder export to `convex/reminders.ts` now and fill it in at Task 5:

```ts
export const deliver = internalMutation({
  args: { playerId: v.id('players'), dueAt: v.number() },
  handler: async () => ({ delivered: false, reason: 'not-implemented' as const }),
})
```

```
npx convex codegen --typecheck disable
```

- [ ] **Step 5: Run to verify the tests pass**

```
pnpm test:once convex/reminders.test.ts
```

Expected: the four `scheduleNextFor` tests and both
`reschedulePlayerReminderFor` tests PASS.

- [ ] **Step 6: Run all four gates**

```
pnpm lint
pnpm typecheck
pnpm test:once
pnpm build
```

- [ ] **Step 7: Commit**

```bash
git add convex/reminders.ts convex/reminders.test.ts convex/_generated
git commit -F - <<'EOF'
feat(reminders): scheduling helpers, with cancel as a tidiness measure

Two functions rather than one, and the split is load-bearing. deliver
reschedules itself, and at that moment reminderJobId is the job currently
running -- Convex documents cancel as able to fail once a job has committed,
so cancelling yourself is pointless at best. scheduleNextFor therefore does
not cancel; reschedulePlayerReminderFor, used by settings and by repair, does.

The cancel failing is HARMLESS rather than merely tolerated: the row is the
source of truth, every job carries the dueAt it was created for, and a job
whose dueAt no longer matches the row retires without delivering. Letting the
error propagate would roll back the transaction and discard the settings
change the player just made.

The cancel-throws path is unreachable through convex-test, whose cancel_job
patches state unconditionally and never throws. It is tested by injecting a
hostile scheduler, which is only possible because the rule lives in a ...For
helper taking MutationCtx rather than in a mutation body.

Refs: wordle-teams-spcu

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>
EOF
```

---

## Task 4: Wire the four settings write paths

**Files:**
- Modify: `convex/settings.ts:29-48` (`updateReminderMethodsFor`), `:101-113` (`updateReminderTimeFor`), `:115-129` (`updateTimeZoneFor`)
- Test: `convex/settings.test.ts`

`setReminderMethodFor` delegates to `updateReminderMethodsFor`, so hooking the
latter covers both — and covering it there rather than in each caller is what stops
the two from drifting.

- [ ] **Step 1: Write the failing tests**

Append to `convex/settings.test.ts`:

```ts
describe('reminder rescheduling on settings changes', () => {
  const pendingFor = async (t: ReturnType<typeof convexTest>, playerId: Id<'players'>) => {
    const player = await t.run((ctx) => ctx.db.get(playerId))
    return player?.nextReminderAt
  }

  test('changing the reminder time reschedules', async () => {
    const t = convexTest(schema, modules)
    const playerId = await t.run((ctx) =>
      ctx.db.insert('players', aPlayer({ timeZone: 'America/Chicago', playsWeekends: true })),
    )
    await t.run((ctx) => updateReminderTimeFor(ctx, playerId, '09:00:00'))
    const first = await pendingFor(t, playerId)

    await t.run((ctx) => updateReminderTimeFor(ctx, playerId, '18:00:00'))
    const second = await pendingFor(t, playerId)

    expect(first).toBeDefined()
    expect(second).not.toBe(first)
  })

  test('changing the time zone reschedules', async () => {
    const t = convexTest(schema, modules)
    const playerId = await t.run((ctx) =>
      ctx.db.insert('players', aPlayer({ timeZone: 'America/Chicago', playsWeekends: true })),
    )
    await t.run((ctx) => updateTimeZoneFor(ctx, playerId, 'America/Chicago'))
    const first = await pendingFor(t, playerId)

    await t.run((ctx) => updateTimeZoneFor(ctx, playerId, 'Asia/Tokyo'))
    const second = await pendingFor(t, playerId)

    expect(second).not.toBe(first)
  })

  test('a player with no time zone is scheduled the moment they get one', async () => {
    // There is no natural trigger otherwise — use-local-capture writes the zone
    // only when it is ABSENT, so this fires exactly once per player, on their
    // first authenticated load.
    const t = convexTest(schema, modules)
    const playerId = await t.run((ctx) => ctx.db.insert('players', aPlayer()))
    expect(await pendingFor(t, playerId)).toBeUndefined()

    await t.run((ctx) => updateTimeZoneFor(ctx, playerId, 'America/Chicago'))
    expect(await pendingFor(t, playerId)).toBeDefined()
  })

  test('changing delivery methods reschedules', async () => {
    const t = convexTest(schema, modules)
    const playerId = await t.run((ctx) =>
      ctx.db.insert('players', aPlayer({ timeZone: 'America/Chicago', playsWeekends: true })),
    )
    await t.run((ctx) => updateReminderMethodsFor(ctx, playerId, ['email']))
    const first = await pendingFor(t, playerId)
    expect(first).toBeDefined()

    await t.run((ctx) => setReminderMethodFor(ctx, playerId, 'push', true))
    const player = await t.run((ctx) => ctx.db.get(playerId))
    expect(player?.reminderDeliveryMethods).toEqual(['email', 'push'])
    expect(player?.reminderJobId).toBeDefined()
  })

  test('a rejected settings change schedules nothing', async () => {
    // The reschedule must sit AFTER the validation, so a throw rolls back both
    // the write and the job. A job scheduled for a change that was refused
    // would fire against settings the player never chose.
    const t = convexTest(schema, modules)
    const playerId = await t.run((ctx) =>
      ctx.db.insert('players', aPlayer({ timeZone: 'America/Chicago' })),
    )
    await expect(
      t.run((ctx) => updateReminderTimeFor(ctx, playerId, '23:30:00')),
    ).rejects.toThrow()

    const jobs = await t.run((ctx) => ctx.db.system.query('_scheduled_functions').collect())
    expect(jobs).toHaveLength(0)
  })
})
```

- [ ] **Step 2: Run to verify they fail**

```
pnpm test:once convex/settings.test.ts
```

Expected: FAIL — `nextReminderAt` is `undefined` because nothing schedules.

- [ ] **Step 3: Add the reschedule calls**

In `convex/settings.ts`, add the import:

```ts
import { reschedulePlayerReminderFor } from './reminders.ts'
```

Then add the call as the last statement of each of the three helpers, **after** the
existing `ctx.db.patch`:

```ts
  await ctx.db.patch(playerId, { reminderDeliveryMethods: methods })
  await reschedulePlayerReminderFor(ctx, playerId)
```

```ts
  if (!REMINDER_TIMES.includes(time)) throw accessError('INVALID_REMINDER_TIME')
  await ctx.db.patch(playerId, { reminderDeliveryTime: time })
  await reschedulePlayerReminderFor(ctx, playerId)
```

```ts
  await ctx.db.patch(playerId, { timeZone })
  await reschedulePlayerReminderFor(ctx, playerId)
```

Add this to the module doc comment at the top of `settings.ts`, after the paragraph
about `lastBoardEntryReminder`:

```
 * EVERY WRITE HERE RESCHEDULES, AND THE CALL GOES AFTER THE VALIDATION. Each of
 * these three fields is an input to when the next reminder fires, so a write
 * that did not reschedule would leave the player's pending job pointing at
 * their old settings — the reminder would keep arriving at the time they just
 * changed away from, with nothing logged. Placing the call after the guard
 * matters too: a rejected change throws, which rolls back the patch AND the
 * job, so nothing is ever scheduled for settings the player was refused.
 *
 * setReminderMethodFor is NOT hooked separately, deliberately — it delegates to
 * updateReminderMethodsFor, so hooking the one place they meet is what stops
 * the two from drifting.
 *
 * IT IS THE ONLY TRIGGER FOR A PLAYER WHO HAS NEVER HAD A ZONE. use-local-capture
 * writes timeZone only when it is ABSENT (src/lib/use-local-capture.ts:88), so
 * updateTimeZoneFor fires once per player, on their first authenticated load,
 * and that is what puts a natively-signed-up player onto the schedule at all.
```

- [ ] **Step 4: Run to verify they pass**

```
pnpm test:once convex/settings.test.ts
```

Expected: PASS.

- [ ] **Step 5: Run all four gates**

```
pnpm lint
pnpm typecheck
pnpm test:once
pnpm build
```

- [ ] **Step 6: Commit**

```bash
git add convex/settings.ts convex/settings.test.ts
git commit -F - <<'EOF'
feat(settings): reschedule the reminder on every change that moves it

timeZone, reminderDeliveryTime and reminderDeliveryMethods are all inputs to
when the next reminder fires, so a write that did not reschedule would leave
the pending job pointing at the player's old settings -- the reminder would
keep arriving at the time they just changed away from, with nothing logged.

The call goes AFTER the validation in each helper, so a rejected change rolls
back the patch and the job together and nothing is ever scheduled for settings
the player was refused.

setReminderMethodFor is not hooked separately: it delegates to
updateReminderMethodsFor, and hooking the one place they meet is what stops
the two from drifting.

updateTimeZoneFor is also the only trigger that puts a natively-signed-up
player onto the schedule at all -- use-local-capture writes the zone only when
it is absent, so it fires once, on their first authenticated load.

Refs: wordle-teams-spcu

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>
EOF
```

---

## Task 5: The delivery job

**Files:**
- Modify: `convex/reminders.ts` (replace the Task 3 placeholder `deliver`)
- Test: `convex/reminders.test.ts`

Keeps every rule the sweep had, minus the hour window. Two reads: the player row,
and up to two `dailyScores` index lookups. No `teams` read at all.

- [ ] **Step 1: Write the failing tests**

Add to `convex/reminders.test.ts`. `sendEmailMock` and the `seed` helper already
exist in that file.

```ts
describe('deliver', () => {
  const DUE = new Date('2026-09-11T14:00:00Z').getTime() // 09:00 Chicago, a Friday

  beforeEach(() => {
    vi.stubEnv('REMINDERS_ENABLED', 'true')
    vi.stubEnv('SITE_URL', 'https://example.com')
  })

  /** Puts a player on the schedule with `nextReminderAt === DUE`. */
  async function scheduled(
    t: ReturnType<typeof convexTest>,
    over: Record<string, unknown> = {},
    days: Array<string> = recentScores,
  ) {
    const playerId = await seed(t, { playsWeekends: true, ...over }, days)
    await t.run((ctx) => ctx.db.patch(playerId, { nextReminderAt: DUE }))
    return playerId
  }

  test('delivers to a player whose job matches the row, and reschedules', async () => {
    const t = convexTest(schema, modules)
    const playerId = await scheduled(t)

    const result = await t.mutation(internal.reminders.deliver, { playerId, dueAt: DUE })

    expect(result.delivered).toBe(true)
    expect(sendEmailMock).toHaveBeenCalledTimes(1)

    const player = await t.run((ctx) => ctx.db.get(playerId))
    expect(player?.lastBoardEntryReminder).toBeDefined()
    // Rescheduled to Saturday: this player plays weekends.
    expect(player?.nextReminderAt).toBe(new Date('2026-09-12T14:00:00Z').getTime())
  })

  // THE STALENESS GUARD. This is the property that makes a failed cancel
  // harmless, so it is asserted from both directions.
  test('a superseded job delivers nothing and reschedules nothing', async () => {
    const t = convexTest(schema, modules)
    const playerId = await scheduled(t)
    // The player moved their reminder after this job was created.
    const moved = DUE + 60 * 60 * 1000
    await t.run((ctx) => ctx.db.patch(playerId, { nextReminderAt: moved }))

    const result = await t.mutation(internal.reminders.deliver, { playerId, dueAt: DUE })

    expect(result.reason).toBe('superseded')
    expect(sendEmailMock).not.toHaveBeenCalled()

    const player = await t.run((ctx) => ctx.db.get(playerId))
    // Untouched: no claim stamp, and the newer schedule still stands.
    expect(player?.lastBoardEntryReminder).toBeUndefined()
    expect(player?.nextReminderAt).toBe(moved)
  })

  test('a job for a player with no pending schedule at all is superseded', async () => {
    const t = convexTest(schema, modules)
    const playerId = await seed(t, { playsWeekends: true }, recentScores)

    const result = await t.mutation(internal.reminders.deliver, { playerId, dueAt: DUE })

    expect(result.reason).toBe('superseded')
    expect(sendEmailMock).not.toHaveBeenCalled()
  })

  // RESCHEDULES EVEN WHEN IT DELIVERS NOTHING. Every one of these cases would
  // otherwise end that player's chain permanently.
  test('reschedules when the kill switch is off', async () => {
    // Keeping REMINDERS_ENABLED at DELIVERY rather than at scheduling is what
    // makes the launch-day env change free. But it means the flag being off
    // must not break the chain: if this did not reschedule, turning reminders
    // off would strand all 393 players and turning them back on would need a
    // full re-bootstrap.
    vi.stubEnv('REMINDERS_ENABLED', '')
    const t = convexTest(schema, modules)
    const playerId = await scheduled(t)

    const result = await t.mutation(internal.reminders.deliver, { playerId, dueAt: DUE })

    expect(result.reason).toBe('disabled')
    expect(sendEmailMock).not.toHaveBeenCalled()
    const player = await t.run((ctx) => ctx.db.get(playerId))
    expect(player?.nextReminderAt).toBe(new Date('2026-09-12T14:00:00Z').getTime())
    // NOT claimed: the stamp means "reminded today", and nobody was.
    expect(player?.lastBoardEntryReminder).toBeUndefined()
  })

  test('reschedules when today is already entered', async () => {
    const t = convexTest(schema, modules)
    const playerId = await scheduled(t, {}, [...recentScores, '2026-09-11'])

    const result = await t.mutation(internal.reminders.deliver, { playerId, dueAt: DUE })

    expect(result.reason).toBe('already-entered')
    expect(sendEmailMock).not.toHaveBeenCalled()
    const player = await t.run((ctx) => ctx.db.get(playerId))
    expect(player?.nextReminderAt).toBe(new Date('2026-09-12T14:00:00Z').getTime())
  })

  test('reschedules when the player has not played in ten days', async () => {
    const t = convexTest(schema, modules)
    const playerId = await scheduled(t, {}, ['2026-08-01'])

    const result = await t.mutation(internal.reminders.deliver, { playerId, dueAt: DUE })

    expect(result.reason).toBe('inactive')
    expect(sendEmailMock).not.toHaveBeenCalled()
    const player = await t.run((ctx) => ctx.db.get(playerId))
    expect(player?.nextReminderAt).toBeDefined()
  })

  test('reschedules when the player is not on the allowlist', async () => {
    vi.stubEnv('REMINDERS_ALLOWLIST', 'someone@else.test')
    const t = convexTest(schema, modules)
    const playerId = await scheduled(t)

    const result = await t.mutation(internal.reminders.deliver, { playerId, dueAt: DUE })

    expect(result.reason).toBe('not-allowlisted')
    expect(sendEmailMock).not.toHaveBeenCalled()
    const player = await t.run((ctx) => ctx.db.get(playerId))
    expect(player?.nextReminderAt).toBeDefined()
  })

  test('claims before delivering, so a duplicate job cannot double-send', async () => {
    // The sweep claimed unconditionally because both bounds of its hour window
    // were inclusive, which made double-matching the NORMAL case. Exact
    // scheduling removes that — but a duplicate job can still exist (a repair
    // racing a settings change), so the guard keeps its original job.
    const t = convexTest(schema, modules)
    const playerId = await scheduled(t)

    await t.mutation(internal.reminders.deliver, { playerId, dueAt: DUE })
    expect(sendEmailMock).toHaveBeenCalledTimes(1)

    // Replay the same job against the same instant.
    await t.run((ctx) => ctx.db.patch(playerId, { nextReminderAt: DUE }))
    const replay = await t.mutation(internal.reminders.deliver, { playerId, dueAt: DUE })

    expect(replay.reason).toBe('already-reminded')
    expect(sendEmailMock).toHaveBeenCalledTimes(1)
  })

  test('enqueues a push when push is a chosen method', async () => {
    const t = convexTest(schema, modules)
    const playerId = await scheduled(t, { reminderDeliveryMethods: ['push'] })

    await t.mutation(internal.reminders.deliver, { playerId, dueAt: DUE })

    expect(sendEmailMock).not.toHaveBeenCalled()
    const jobs = await t.run((ctx) => ctx.db.system.query('_scheduled_functions').collect())
    expect(jobs.map((j) => j.name)).toContain('pushSend:deliverTo')
  })

  test('throws when SITE_URL is missing, so nobody is claimed', async () => {
    // Throwing rolls the whole transaction back — no claim, no reschedule — and
    // `maintain` puts the chain back once the deployment is fixed.
    vi.stubEnv('SITE_URL', '')
    const t = convexTest(schema, modules)
    const playerId = await scheduled(t)

    await expect(
      t.mutation(internal.reminders.deliver, { playerId, dueAt: DUE }),
    ).rejects.toThrow(/SITE_URL/)

    const player = await t.run((ctx) => ctx.db.get(playerId))
    expect(player?.lastBoardEntryReminder).toBeUndefined()
  })

  test('does not schedule a weekend reminder for a weekday-only player', async () => {
    const t = convexTest(schema, modules)
    const playerId = await scheduled(t, { playsWeekends: false })

    await t.mutation(internal.reminders.deliver, { playerId, dueAt: DUE })

    const player = await t.run((ctx) => ctx.db.get(playerId))
    // Friday delivery, so the next is Monday.
    expect(player?.nextReminderAt).toBe(new Date('2026-09-14T14:00:00Z').getTime())
  })
})
```

- [ ] **Step 2: Run to verify they fail**

```
pnpm test:once convex/reminders.test.ts
```

Expected: FAIL — the placeholder returns `not-implemented`.

- [ ] **Step 3: Implement `deliver`**

Replace the placeholder in `convex/reminders.ts`:

```ts
/**
 * Deliver one player's board-entry reminder, then schedule their next one.
 *
 * REPLACES THE HOURLY SWEEP. That sweep opened with
 * `ctx.db.query('players').collect()` — a full table scan, unconditionally,
 * 720 times a month. It cost nothing only because REMINDERS_ENABLED was empty
 * and the gate sat above the collect; setting that one variable on cutover day
 * would have added ~283,000 document reads a month, roughly 82 MB, about 8% of
 * a 1 GB cap whose failure mode is mutations FAILING rather than a bill
 * (wordle-teams-dcu). This reads one player row instead.
 *
 * STILL A MUTATION, NOT AN ACTION, for every reason the sweep was one:
 * eligibility has to be decided against one consistent snapshot, the claim has
 * to commit in the same transaction as that decision, `sendEmail` enqueues into
 * the Resend component's tables via `ctx.runMutation`, and an OCC retry simply
 * re-runs the whole handler having committed nothing.
 *
 * THE STALENESS GUARD IS FIRST, AND IT IS WHAT MAKES THE DESIGN SAFE. `dueAt`
 * is the instant this job was created for; `player.nextReminderAt` is the
 * instant the row currently expects. If they disagree, this job has been
 * superseded by a settings change or a repair, and it retires — delivering
 * nothing and, crucially, rescheduling nothing, because the job that replaced
 * it already owns the schedule. Without this, `ctx.scheduler.cancel` would have
 * to be reliable, and Convex documents it as able to fail once a job has
 * committed.
 *
 * IT RESCHEDULES ON EVERY PATH THAT IS NOT "SUPERSEDED", including when the
 * kill switch is off and when the player turns out to be ineligible. Each of
 * those is a day this player is not reminded; none of them is a reason to end
 * their chain forever. Miss this and turning REMINDERS_ENABLED off would strand
 * every player, and turning it back on would need a full re-bootstrap — which
 * is exactly the coupling keeping the gate at delivery was meant to avoid.
 *
 * ORDERING WITHIN THE HANDLER DOES NOT PROTECT THE CHAIN, so do not reorder it
 * hoping to. This is one transaction: `runAt` takes effect on commit, so if
 * anything throws, the reschedule is rolled back with everything else no matter
 * where it sat. A throw ends this player's chain until `maintain` repairs it,
 * and `maintain` is the only thing that protects against that.
 *
 * NO `teams` READ. The weekend rule is applied when the next occurrence is
 * computed, from the derived `playsWeekends` on the row — see
 * lib/reminders.ts's nextOccurrence for why asking `teams` here would cost more
 * than the sweep this replaces.
 */
export const deliver = internalMutation({
  args: { playerId: v.id('players'), dueAt: v.number() },
  handler: async (ctx, { playerId, dueAt }) => {
    const player = await ctx.db.get(playerId)
    if (!player) return { delivered: false, reason: 'no-player' as const }

    if (player.nextReminderAt !== dueAt) {
      return { delivered: false, reason: 'superseded' as const }
    }

    const now = Date.now()
    // Every `return` below this point goes through here, so that no eligibility
    // outcome can silently end the chain.
    const withReschedule = async <R extends string>(reason: R) => {
      await scheduleNextFor(ctx, playerId, now)
      return { delivered: false, reason }
    }

    if (process.env.REMINDERS_ENABLED !== 'true') {
      return await withReschedule('disabled' as const)
    }

    const timeZone = player.timeZone
    if (!timeZone) return await withReschedule('no-time-zone' as const)

    if (!player.reminderDeliveryMethods.some((m) => (METHODS as ReadonlyArray<string>).includes(m)))
      return await withReschedule('no-method' as const)

    const allowlist = new Set(
      (process.env.REMINDERS_ALLOWLIST ?? '')
        .split(',')
        .map((address) => address.trim().toLowerCase())
        .filter((address) => address.length > 0),
    )
    if (allowlist.size > 0 && !allowlist.has(player.email)) {
      return await withReschedule('not-allowlisted' as const)
    }

    let local
    try {
      local = localParts(timeZone, new Date(now))
    } catch (error) {
      console.error('[reminders] unresolvable timeZone on a player', { playerId, timeZone }, error)
      return { delivered: false, reason: 'bad-time-zone' as const }
    }

    if (alreadyRemindedToday(player.lastBoardEntryReminder, timeZone, local.day)) {
      return await withReschedule('already-reminded' as const)
    }

    // TWO INDEX LOOKUPS, NOT AN ELEVEN-ROW COLLECT. The sweep read the whole
    // trailing eleven days and inspected the list; these ask the index the two
    // questions directly and stop at the first row, so the cost is at most two
    // documents instead of six to eleven. With the players scan gone, this was
    // the dominant remaining read.
    const enteredToday = await ctx.db
      .query('dailyScores')
      .withIndex('by_player_and_puzzleDay', (q) =>
        q.eq('playerId', playerId).eq('puzzleDay', local.day),
      )
      .first()
    if (enteredToday) return await withReschedule('already-entered' as const)

    const recent = await ctx.db
      .query('dailyScores')
      .withIndex('by_player_and_puzzleDay', (q) =>
        q.eq('playerId', playerId).gte('puzzleDay', activityFloor(local.day)),
      )
      .first()
    if (!recent) return await withReschedule('inactive' as const)

    // SITE_URL is read only once a player is genuinely about to be mailed, and
    // throwing here rolls the whole transaction back — no claim, no reschedule —
    // so `maintain` restores the chain once the deployment is fixed. It also
    // gates push, which does not itself need the value; that is an accepted,
    // live consequence, unchanged from the sweep.
    const siteUrl = process.env.SITE_URL
    if (!siteUrl) throw new Error('[reminders] SITE_URL is not set on this deployment')

    // CLAIM BEFORE DELIVERING, UNCONDITIONALLY. The sweep needed this because
    // its hour window's inclusive bounds made double-matching the normal case.
    // Exact scheduling removes that, but a duplicate job can still exist — a
    // repair racing a settings change — so the guard keeps its original job.
    // Move this after a successful send, or condition it on one, and that race
    // becomes a double email.
    await ctx.db.patch(playerId, { lastBoardEntryReminder: now })

    if (player.reminderDeliveryMethods.includes(EMAIL_METHOD)) {
      const { subject, html, text } = boardEntryReminderEmail({
        firstName: player.firstName,
        siteUrl,
      })
      await sendEmail(ctx, {
        from: 'Wordle Teams <reminders@wordleteams.com>',
        to: player.email,
        subject,
        html,
        text,
      })
    }

    if (player.reminderDeliveryMethods.includes(PUSH_METHOD)) {
      await ctx.scheduler.runAfter(0, internal.pushSend.deliverTo, { playerId, attempt: 0 })
    }

    await scheduleNextFor(ctx, playerId, now)
    return { delivered: true, reason: 'sent' as const }
  },
})
```

Update the import from `./lib/reminders.ts` to add `activityFloor` and drop nothing
yet (Task 7 removes the dead names).

- [ ] **Step 4: Regenerate the API types**

```
npx convex codegen --typecheck disable
```

- [ ] **Step 5: Run to verify they pass**

```
pnpm test:once convex/reminders.test.ts
```

Expected: PASS, including the `schema.test.ts` test from Task 2 that referenced
`internal.reminders.deliver`.

- [ ] **Step 6: Run all four gates**

```
pnpm lint
pnpm typecheck
pnpm test:once
pnpm build
```

- [ ] **Step 7: Commit**

```bash
git add convex/reminders.ts convex/reminders.test.ts convex/_generated
git commit -F - <<'EOF'
feat(reminders): per-player delivery job, replacing the hourly scan

Reads one player row where the sweep read all 393, 720 times a month.

The staleness guard is first and is what makes the design safe: dueAt is the
instant this job was created for, nextReminderAt is what the row expects now,
and a mismatch means this job was superseded -- so it retires, delivering
nothing and rescheduling nothing. Without it, cancel would have to be
reliable, and Convex documents it as able to fail once a job has committed.

It reschedules on every path except "superseded", including when the kill
switch is off and when the player is ineligible. Each of those is one missed
day, not a reason to end a chain forever -- and without it, turning
REMINDERS_ENABLED off would strand all 393 players and turning it back on
would need a full re-bootstrap, which is the coupling that keeping the gate at
delivery was meant to avoid.

Ordering inside the handler does not protect the chain and must not be
reordered hoping it does: this is one transaction, runAt takes effect on
commit, so a throw rolls the reschedule back wherever it sat. maintain is the
only protection against that.

Also narrows the eligibility read from an eleven-day collect to two index
lookups that stop at the first row -- with the players scan gone, that was the
dominant remaining cost.

Refs: wordle-teams-spcu

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>
EOF
```

---

## Task 6: The daily maintenance pass

One pass, four jobs: derive `playsWeekends`, repair broken chains, bootstrap players
who never had one, and do it all in a bounded transaction.

**Files:**
- Modify: `convex/reminders.ts`
- Test: `convex/reminders.test.ts`

- [ ] **Step 1: Write the failing tests**

Add to `convex/reminders.test.ts`:

```ts
describe('maintain', () => {
  beforeEach(() => {
    vi.stubEnv('REMINDERS_ENABLED', 'true')
    vi.stubEnv('SITE_URL', 'https://example.com')
  })

  test('bootstraps a player who has never been scheduled', async () => {
    // THE ENTIRE BOOTSTRAP STORY. Existing players have no nextReminderAt, which
    // is the same state a broken chain leaves behind, so no migration mutation
    // and no manual cutover step is needed for the 393 rows already in the table.
    const t = convexTest(schema, modules)
    const playerId = await t.run((ctx) =>
      ctx.db.insert('players', aPlayer({ timeZone: 'America/Chicago' })),
    )

    const result = await t.mutation(internal.reminders.maintain, {})

    expect(result.scheduled).toBe(1)
    const player = await t.run((ctx) => ctx.db.get(playerId))
    expect(player?.nextReminderAt).toBeGreaterThan(Date.now())
  })

  test('repairs a chain whose job never fired', async () => {
    // The silent failure this pass exists for: a permanent throw inside deliver
    // rolls back its own reschedule, so the player simply stops being reminded
    // and nothing notices.
    const t = convexTest(schema, modules)
    const playerId = await t.run((ctx) =>
      ctx.db.insert(
        'players',
        aPlayer({ timeZone: 'America/Chicago', nextReminderAt: Date.now() - 48 * 3600 * 1000 }),
      ),
    )

    const result = await t.mutation(internal.reminders.maintain, {})

    expect(result.scheduled).toBe(1)
    const player = await t.run((ctx) => ctx.db.get(playerId))
    expect(player?.nextReminderAt).toBeGreaterThan(Date.now())
  })

  test('leaves a healthy chain alone', async () => {
    // The assertion that this pass is nearly free in steady state: it must not
    // churn 393 rows a day rescheduling jobs that are perfectly fine.
    const t = convexTest(schema, modules)
    const future = Date.now() + 6 * 3600 * 1000
    const playerId = await t.run((ctx) =>
      ctx.db.insert('players', aPlayer({ timeZone: 'America/Chicago', nextReminderAt: future })),
    )

    const result = await t.mutation(internal.reminders.maintain, {})

    expect(result.scheduled).toBe(0)
    const player = await t.run((ctx) => ctx.db.get(playerId))
    expect(player?.nextReminderAt).toBe(future)
  })

  test('derives playsWeekends from weekend-playing teams', async () => {
    const t = convexTest(schema, modules)
    const { weekend, weekday } = await t.run(async (ctx) => {
      const weekend = await ctx.db.insert(
        'players',
        aPlayer({ email: 'weekend@example.com', timeZone: 'America/Chicago' }),
      )
      const weekday = await ctx.db.insert(
        'players',
        aPlayer({ email: 'weekday@example.com', timeZone: 'America/Chicago' }),
      )
      await ctx.db.insert('teams', aTeam({ playerIds: [weekend], playWeekends: true }))
      await ctx.db.insert('teams', aTeam({ playerIds: [weekday], playWeekends: false }))
      return { weekend, weekday }
    })

    await t.mutation(internal.reminders.maintain, {})

    expect((await t.run((ctx) => ctx.db.get(weekend)))?.playsWeekends).toBe(true)
    expect((await t.run((ctx) => ctx.db.get(weekday)))?.playsWeekends).toBe(false)
  })

  test('clears playsWeekends when the player leaves the weekend team', async () => {
    const t = convexTest(schema, modules)
    const { playerId, teamId } = await t.run(async (ctx) => {
      const playerId = await ctx.db.insert(
        'players',
        aPlayer({ timeZone: 'America/Chicago', playsWeekends: true }),
      )
      const teamId = await ctx.db.insert(
        'teams',
        aTeam({ playerIds: [playerId], playWeekends: true }),
      )
      return { playerId, teamId }
    })

    await t.run((ctx) => ctx.db.patch(teamId, { playerIds: [] }))
    await t.mutation(internal.reminders.maintain, {})

    expect((await t.run((ctx) => ctx.db.get(playerId)))?.playsWeekends).toBe(false)
  })

  test('does not patch playsWeekends when it already agrees', async () => {
    // Writes cost bandwidth too. In steady state this pass must be reads only.
    const t = convexTest(schema, modules)
    const playerId = await t.run(async (ctx) => {
      const id = await ctx.db.insert(
        'players',
        aPlayer({
          timeZone: 'America/Chicago',
          playsWeekends: true,
          nextReminderAt: Date.now() + 6 * 3600 * 1000,
        }),
      )
      await ctx.db.insert('teams', aTeam({ playerIds: [id], playWeekends: true }))
      return id
    })

    const result = await t.mutation(internal.reminders.maintain, {})

    expect(result.weekendFlagsChanged).toBe(0)
    expect(result.scheduled).toBe(0)
    expect(playerId).toBeDefined()
  })

  test('skips a player with no time zone without wedging on them', async () => {
    // These can never be scheduled, and there may be many: 151 of production's
    // 533 rows are nameless leftovers. They must not consume the schedule
    // budget or stop the pass reaching anyone else.
    const t = convexTest(schema, modules)
    const { zoneless, schedulable } = await t.run(async (ctx) => ({
      zoneless: await ctx.db.insert('players', aPlayer({ email: 'z@example.com' })),
      schedulable: await ctx.db.insert(
        'players',
        aPlayer({ email: 's@example.com', timeZone: 'America/Chicago' }),
      ),
    }))

    const result = await t.mutation(internal.reminders.maintain, {})

    expect(result.scheduled).toBe(1)
    expect((await t.run((ctx) => ctx.db.get(zoneless)))?.nextReminderAt).toBeUndefined()
    expect((await t.run((ctx) => ctx.db.get(schedulable)))?.nextReminderAt).toBeDefined()
  })

  test('stops at the schedule budget and reports that it did', async () => {
    // convex-test enforces a hard 1000 functionsScheduled per transaction
    // (transactionMetrics.js:16). A bootstrap over a table larger than the
    // budget must make progress across runs rather than throwing.
    const t = convexTest(schema, modules)
    await t.run(async (ctx) => {
      for (let i = 0; i < 5; i++) {
        await ctx.db.insert(
          'players',
          aPlayer({ email: `p${i}@example.com`, timeZone: 'America/Chicago' }),
        )
      }
    })

    const result = await t.mutation(internal.reminders.maintain, { budget: 3 })

    expect(result.scheduled).toBe(3)
    expect(result.deferred).toBe(2)

    // The next run finishes the job.
    const second = await t.mutation(internal.reminders.maintain, { budget: 3 })
    expect(second.scheduled).toBe(2)
    expect(second.deferred).toBe(0)
  })
})
```

- [ ] **Step 2: Run to verify they fail**

```
pnpm test:once convex/reminders.test.ts
```

Expected: FAIL — `internal.reminders.maintain` does not exist.

- [ ] **Step 3: Implement `maintain`**

Add to `convex/reminders.ts`, importing `weekendPlayerIdsFrom` from
`./lib/reminders.ts`:

```ts
/**
 * The number of reminders one maintenance run will schedule.
 *
 * BELOW A HARD PLATFORM LIMIT, not a tuning knob. convex-test enforces 1000
 * `functionsScheduled` per transaction
 * (node_modules/convex-test/dist/transactionMetrics.js:16), and that is the
 * figure to design against. 800 leaves headroom for the pass's own reads and
 * writes while comfortably covering a one-shot bootstrap of production's 393
 * players.
 *
 * EXCEEDING IT IS SAFE, WHICH IS THE POINT. A table with more unscheduled
 * players than the budget makes progress across successive runs rather than
 * throwing and repairing nobody. The `deferred` count in the return value says
 * when that is happening, so a bootstrap that needs several days is visible
 * rather than mysterious.
 */
const MAINTAIN_SCHEDULE_BUDGET = 800

/**
 * The safety net for per-player scheduling, and the only thing standing between
 * a broken chain and a player who is silently never reminded again.
 *
 * WHY THIS IS LOAD-BEARING RATHER THAN A NICE-TO-HAVE. A sweep is self-healing:
 * it recomputes from scratch every run, so a lost job fixes itself. A chain has
 * no such property. Scheduled mutations are exactly-once and auto-retried on
 * TRANSIENT errors, so flakiness is not the risk — a PERMANENT throw is. The
 * old sweep caught an unresolvable timeZone per player precisely because one bad
 * row must not take a batch down; in a chain, that same row rolls back the whole
 * transaction INCLUDING the reschedule, and that player is gone with nothing
 * logged and nobody looking. This pass is what finds them.
 *
 * DAILY, NOT HOURLY, and the cadence is the whole economy of this design. It
 * collects the entire `players` table, which is exactly the read the hourly
 * sweep was killed for: at 720 runs a month that was ~283,000 reads and about
 * 82 MB. At 30 runs it is ~11,800 reads, under 4 MB, and it buys back the
 * self-healing property for 1/24th of the cost. Putting this back on an hourly
 * cron would restore the original bug in full.
 *
 * FOUR JOBS IN ONE PASS, deliberately, because they all need the same scan:
 *
 *  1. DERIVE playsWeekends. `teams` is collected once — Convex cannot index
 *     array membership — and the flag is written only where it actually differs,
 *     so steady state is reads-only.
 *  2. REPAIR a chain whose job never fired (nextReminderAt in the past).
 *  3. BOOTSTRAP a player who never had one (nextReminderAt absent). This is the
 *     SAME CASE as 2 from here, which is why the 393 existing rows need no
 *     migration mutation and no manual cutover step — and that matters beyond
 *     convenience, because a manual step would have to be run against prod, and
 *     `convex run --prod` silently hits the local deployment on at least one
 *     machine.
 *  4. STAY BOUNDED. See MAINTAIN_SCHEDULE_BUDGET.
 *
 * NOT GATED ON REMINDERS_ENABLED, and that is intentional. The gate lives at
 * delivery so that flipping it costs nothing; gating the schedule too would mean
 * the flag had to cancel and recreate 393 jobs, which is the coupling the whole
 * arrangement avoids.
 *
 * A PLAYER WITH NO timeZone IS SKIPPED AND COSTS NOTHING. They cannot be
 * scheduled — there is no zone to compute an occurrence in — and they are
 * numerous: 151 of production's 533 rows are nameless leftovers. They are
 * retried every run at no extra cost, because this pass is already reading
 * every row, and they never consume the schedule budget.
 */
export const maintain = internalMutation({
  // `budget` exists for the tests, the same way `sweep`'s `now` did, and for the
  // same reason it must NOT be passed from crons.ts: a cron's args are
  // serialised when that module is EVALUATED, not when the job fires.
  args: { budget: v.optional(v.number()) },
  handler: async (ctx, { budget }) => {
    const limit = budget ?? MAINTAIN_SCHEDULE_BUDGET
    const now = Date.now()

    const teams = await ctx.db.query('teams').collect()
    const weekendPlayerIds = weekendPlayerIdsFrom(teams)

    const players = await ctx.db.query('players').collect()

    let weekendFlagsChanged = 0
    let scheduled = 0
    let deferred = 0

    for (const player of players) {
      // BEFORE the reschedule, so a newly-derived flag is what the next
      // occurrence is computed from rather than being a day behind it.
      const playsWeekends = weekendPlayerIds.has(player._id)
      if (player.playsWeekends !== playsWeekends) {
        await ctx.db.patch(player._id, { playsWeekends })
        weekendFlagsChanged += 1
      }

      if (!player.timeZone) continue

      const healthy = player.nextReminderAt !== undefined && player.nextReminderAt > now
      if (healthy) continue

      if (scheduled >= limit) {
        deferred += 1
        continue
      }

      await reschedulePlayerReminderFor(ctx, player._id, now)
      scheduled += 1
    }

    return { players: players.length, teams: teams.length, weekendFlagsChanged, scheduled, deferred }
  },
})
```

- [ ] **Step 4: Regenerate the API types**

```
npx convex codegen --typecheck disable
```

- [ ] **Step 5: Run to verify they pass**

```
pnpm test:once convex/reminders.test.ts
```

Expected: PASS.

- [ ] **Step 6: Run all four gates**

```
pnpm lint
pnpm typecheck
pnpm test:once
pnpm build
```

- [ ] **Step 7: Commit**

```bash
git add convex/reminders.ts convex/reminders.test.ts convex/_generated
git commit -F - <<'EOF'
feat(reminders): daily maintenance pass -- the net, the flag, and bootstrap

This is load-bearing, not a mitigation. A sweep is self-healing; a chain is
not. Scheduled mutations are auto-retried on TRANSIENT errors, so the risk is
a PERMANENT throw -- an unresolvable timeZone on a copied row rolls back the
whole transaction including the reschedule, and that player is silently never
reminded again. This pass is what finds them.

Four jobs in one scan, because they all need the same read:

  1. derives playsWeekends from one teams collect, writing only where it
     differs, so steady state is reads-only
  2. repairs a chain whose job never fired
  3. bootstraps a player who never had one -- the SAME CASE as (2) from here,
     which is why the 393 existing rows need no migration and no manual
     cutover step. That matters beyond convenience: a manual step would have
     to run against prod, and `convex run --prod` silently hits local here.
  4. stays under a schedule budget of 800, below the hard 1000
     functionsScheduled per transaction the harness enforces. Exceeding it
     defers to the next run rather than throwing, and says so in `deferred`.

DAILY is the whole economy: this collects the entire players table, which is
exactly the read the hourly sweep was killed for. At 30 runs a month it is
~11,800 reads instead of ~283,000, buying the self-healing property back for
1/24th of the cost. Putting it on an hourly cron restores the original bug.

Refs: wordle-teams-spcu

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>
EOF
```

---

## Task 7: Swap the cron and delete the sweep

One atomic change: `crons.ts` cannot reference `internal.reminders.sweep` after it is
deleted, so the swap and the deletion land together.

**Files:**
- Modify: `convex/crons.ts:20-22`, `convex/crons.test.ts:26-64`
- Modify: `convex/reminders.ts` (delete `sweep`), `convex/lib/reminders.ts` (delete
  `isDueThisHour`, `enteredOn`, `hasRecentActivity`)
- Modify: `convex/lib/reminders.test.ts`, `convex/reminders.test.ts`,
  `convex/settings.ts:106-110`

- [ ] **Step 1: Update the cron test first**

`crons.test.ts` asserts the WHOLE map with `toEqual`, which is what makes a moved or
deleted job a failure rather than something nobody notices. Replace the
`'board entry reminders'` entry:

```ts
      'reminder maintenance': {
        name: 'reminders:maintain',
        // DAILY, AND THE CADENCE IS THE ASSERTION (wordle-teams-spcu). This pass
        // collects the whole players table, which is exactly the read the hourly
        // reminder sweep was deleted for: at 720 runs a month that was ~283,000
        // document reads, about 82 MB, roughly 8% of a 1 GB free-tier cap whose
        // failure mode is mutations FAILING rather than a bill. At 30 runs it is
        // ~11,800 reads. Putting this back to hourly would restore the original
        // bug in full and nothing else in the suite would notice.
        //
        // 01:15 KEEPS ITS OWN LANE, for the reason the other two do: all of these
        // are mutations that walk a table, and stacking them on one minute means
        // the whole deployment's table walks contend for the scheduler at once.
        // :30 is the chat sweep's and 00:45 is teamStats'.
        schedule: { type: 'daily', hourUTC: 1, minuteUTC: 15 },
        // NOT [{ budget: 800 }] — a cron's args are serialised when crons.ts is
        // EVALUATED, not when the job fires, so anything here is frozen at deploy
        // time forever. `maintain` defaults internally instead.
        args: [{}],
      },
```

Delete the `'board entry reminders'` entry entirely.

- [ ] **Step 2: Run to verify it fails**

```
pnpm test:once convex/crons.test.ts
```

Expected: FAIL — the map still holds `'board entry reminders'` and has no
`'reminder maintenance'`.

- [ ] **Step 3: Swap the cron**

In `convex/crons.ts`, replace the `crons.hourly('board entry reminders', ...)` call
and its doc comment with:

```ts
/**
 * Phase 6's board-entry reminders. NO LONGER THE MECHANISM — it is the net.
 *
 * WHAT THIS REPLACED, AND WHY (wordle-teams-spcu). This was
 * `crons.hourly('board entry reminders', { minuteUTC: 0 }, internal.reminders.sweep)`,
 * and that sweep opened with a full `players` collect on every one of its 720
 * monthly runs: ~283,000 document reads, about 82 MB, roughly 8% of a 1 GB
 * free-tier database-I/O cap whose failure mode is mutations FAILING rather than
 * generating a bill (wordle-teams-dcu). It cost nothing only because
 * REMINDERS_ENABLED was empty and the gate sat above the collect — so the entire
 * cost was deferred to whoever set that variable on cutover day.
 *
 * HOURLY WAS NOT THE WASTE, which is worth knowing before "optimising" the
 * cadence again. Reminder times are local, and with 57 distinct player timezones
 * somebody is due in nearly every UTC hour — measured: America/Chicago alone
 * covers 18 of the 24, and Europe/London covers exactly the six it misses. So a
 * sweep that only ran in hours where somebody was due would still run 24 times a
 * day. The waste was reading all 393 players to find the handful owed.
 *
 * THE MECHANISM IS NOW ONE SCHEDULED JOB PER PLAYER, each rescheduling the next
 * as its last act (internal.reminders.deliver). What remains here derives
 * `playsWeekends`, repairs a chain whose job never fired, and bootstraps a player
 * who never had one — see the doc comment on `maintain` for why that is
 * load-bearing rather than optional, and why it must stay DAILY.
 *
 * 01:15 KEEPS ITS OWN LANE. The chat sweep holds :30 hourly and teamStats holds
 * 00:45 daily; all three walk a table, and stacking them on one minute means the
 * whole deployment's table walks contend at once.
 *
 * `{}` AND NOTHING ELSE, for the reason the other two say: a cron's args are
 * serialised to JSON when THIS MODULE is evaluated, not when the job fires.
 * `maintain` takes an optional `budget` for its tests, and passing one here
 * would freeze it at deploy time — harmless for a constant, but the habit is
 * what froze v1's email subject at server-boot time.
 */
crons.daily('reminder maintenance', { hourUTC: 1, minuteUTC: 15 }, internal.reminders.maintain, {})
```

- [ ] **Step 4: Delete `sweep` and the three dead pure helpers**

Delete from `convex/reminders.ts`: the whole `export const sweep = internalMutation({...})`
block and its doc comment. Keep the `EMAIL_METHOD`/`PUSH_METHOD` derivation and the
`HOUR_MS` constant only if still referenced — `HOUR_MS` will not be, so delete it.

Delete from `convex/lib/reminders.ts`: `isDueThisHour`, `enteredOn`,
`hasRecentActivity` and their doc comments. `alreadyRemindedToday` and `localParts`
STAY — `deliver` uses both. `needsWeekendOptIn` is no longer called (the weekend rule
moved into `nextOccurrence`); delete it too.

Delete the corresponding `describe` blocks from `convex/lib/reminders.test.ts`.

**Relocate the reasoning that still governs.** `REMINDER_TIMES`'s doc comment
currently justifies itself by pointing at `isDueThisHour`, which will no longer
exist. Replace that paragraph with:

```
 * MEMBERSHIP IS ENFORCED SERVER-SIDE, AND THE REASON OUTLIVED THE FUNCTION THAT
 * MOTIVATED IT. v1's picker offered exactly these eighteen and nothing checked
 * them; a shape-only check accepts '23:30:00'. Under the old hourly sweep that
 * value could never match, because the cron ticked on the hour, and the player
 * was silently never reminded. Per-player scheduling would now honour '23:30:00'
 * perfectly well — so the hazard is no longer "never matches" but "the UI offers
 * eighteen options and the server would accept any string", which is a
 * validation gap either way. settings.ts's updateReminderTimeFor is where it is
 * closed.
 *
 * WIDENING THIS LIST IS NOW SAFE IN A WAY IT WAS NOT BEFORE, and that is worth
 * recording: nextOccurrence resolves any wall-clock time in any zone, including
 * ones that are ambiguous or nonexistent across a DST transition (it takes the
 * first occurrence and the instant after the gap respectively). The old
 * isDueThisHour could not — its midnight wrap, ported from v1, made any time in
 * the 23:xx-00:xx band unmatchable. That function is gone.
```

Also update `convex/settings.ts:106-110`'s comment on `updateReminderTimeFor`, which
names `isDueThisHour`:

```ts
  // MEMBERSHIP, NOT SHAPE. v1 enforced nothing server-side, and a shape-only
  // check ('HH:MM:SS' in range) accepts any string the picker never offered.
  // This is the only place the eighteen offered times are actually required.
  // See REMINDER_TIMES's doc comment for what this used to protect against
  // under the hourly sweep, and why widening the list is now safe.
```

Two comments in `src/components/settings/notifications-tab.test.ts:64` and
`convex/settings.test.ts:81` also name `isDueThisHour`. Update both to refer to
`REMINDER_TIMES` instead.

- [ ] **Step 5: Rewrite the remaining sweep tests**

Delete every `describe('sweep', ...)` block from `convex/reminders.test.ts` and the
`THURSDAY_3PM_UTC` / `SATURDAY_2PM_UTC` constants if now unused. The behaviours they
covered are all re-asserted in Task 5's `deliver` tests.

- [ ] **Step 6: Regenerate and verify**

```
npx convex codegen --typecheck disable
pnpm test:once convex/crons.test.ts convex/reminders.test.ts convex/lib/reminders.test.ts convex/settings.test.ts
```

Expected: PASS.

- [ ] **Step 7: Record the new test baseline**

```
pnpm test:once
```

**Write down the reported totals and put them in the commit message.** The count
falls here by the deleted `isDueThisHour`/`enteredOn`/`hasRecentActivity`/
`needsWeekendOptIn` cases and the deleted `sweep` cases, and rises by everything
Tasks 1-6 added. A falling count is correct ONLY at this task.

- [ ] **Step 8: Run all four gates**

```
pnpm lint
pnpm typecheck
pnpm test:once
pnpm build
```

Note: `lint` reaches `public/*.js` too, and a docs-only change can fail tests in
this repo, so run all four even though this task looks like deletion.

- [ ] **Step 9: Commit**

```bash
git add convex/crons.ts convex/crons.test.ts convex/reminders.ts convex/reminders.test.ts convex/lib/reminders.ts convex/lib/reminders.test.ts convex/settings.ts convex/settings.test.ts src/components/settings/notifications-tab.test.ts convex/_generated
git commit -F - <<'EOF'
feat(reminders)!: delete the hourly sweep; daily maintenance takes its place

The hourly cron is gone. Setting REMINDERS_ENABLED=true no longer starts a
full players scan every hour, which is what this whole change was for: that
was ~283,000 document reads a month, about 82 MB, roughly 8% of a 1 GB cap
where mutations fail rather than bill.

crons.test.ts asserts the whole cron map with toEqual, so the swap had to be
made there first -- that assertion is what makes a moved or deleted job a
failure rather than something nobody notices until a job stops running.

Deletes isDueThisHour, enteredOn, hasRecentActivity and needsWeekendOptIn,
all unreachable now that scheduling is exact and the weekend rule lives in
nextOccurrence. Dead code carrying load-bearing comments is a trap: the next
reader cannot tell the rules it documents no longer govern anything.

Two things those comments recorded DO still govern, so they moved rather than
vanished. REMINDER_TIMES keeps its membership check, but the justification is
rewritten -- the old one said '23:30:00' could never match because the cron
ticked on the hour, and per-player scheduling would now honour it perfectly
well, so the real reason is the plain validation gap. And widening the list is
now safe in a way it was not before: nextOccurrence resolves ambiguous and
nonexistent wall clocks, where isDueThisHour's ported v1 midnight wrap made
the whole 23:xx-00:xx band unmatchable.

The unconditional claim before delivery survives on its own merit: exact
scheduling removes the double-match that originally required it, but a
duplicate job from a repair racing a settings change would still double-send.

Test baseline: <FILL IN from Step 7> tests across <N> files.

Refs: wordle-teams-spcu

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>
EOF
```

---

## Task 8: Pin the costs

The claim this whole change rests on is a cost claim, so it gets a test. `convex-test`
meters `documentsRead` and `functionsScheduled` per transaction, which is what makes
the numbers assertable rather than modelled.

**Files:**
- Modify: `convex/dashboardBandwidth.test.ts`

- [ ] **Step 1: Write the failing tests**

Append to `convex/dashboardBandwidth.test.ts`:

```ts
/**
 * WHAT A REMINDER COSTS PER EXECUTION (wordle-teams-spcu).
 *
 * Same method as the read-path guards above: bisect `transactionLimits` until
 * the call stops throwing, and assert FROM BOTH SIDES. A ceiling alone would
 * pass at any number above the truth and would stop being a measurement.
 *
 * WHY THESE TWO NUMBERS AND NOT THE DASHBOARD'S BYTES. Bytes are (documents x
 * row size x executions). Of those three only the document count can regress
 * silently in a pull request, and it is the term this change exists to cut:
 * the deleted hourly sweep read ALL 393 players on every one of 720 monthly
 * runs. If `deliver` ever starts collecting a table again, this fails.
 */
describe('reminder delivery bandwidth', () => {
  const DUE = new Date('2026-09-11T14:00:00Z').getTime()

  async function aScheduledPlayer(t: ReturnType<typeof convexTest>) {
    return await t.run(async (ctx) => {
      const playerId = await ctx.db.insert(
        'players',
        aPlayer({
          timeZone: 'America/Chicago',
          reminderDeliveryTime: '09:00:00',
          reminderDeliveryMethods: ['email'],
          playsWeekends: true,
          nextReminderAt: DUE,
        }),
      )
      for (const puzzleDay of ['2026-09-08', '2026-09-09', '2026-09-10']) {
        await ctx.db.insert('dailyScores', { playerId, puzzleDay, date: 0, guesses: ['xxxxx'] })
      }
      return playerId
    })
  }

  /** MEASURED: the player row, plus the two `dailyScores` index lookups. */
  const DELIVER_READS = 3

  test(`delivering reads exactly ${DELIVER_READS} documents`, async () => {
    const t = convexTest(schema, modules)
    const playerId = await aScheduledPlayer(t)

    await expect(
      t.mutation(
        internal.reminders.deliver,
        { playerId, dueAt: DUE },
        { transactionLimits: { documentsRead: DELIVER_READS - 1 } },
      ),
    ).rejects.toThrow(/Scanned too many documents/)
  })

  test('delivering fits inside that ceiling', async () => {
    const t = convexTest(schema, modules)
    const playerId = await aScheduledPlayer(t)

    await expect(
      t.mutation(
        internal.reminders.deliver,
        { playerId, dueAt: DUE },
        { transactionLimits: { documentsRead: DELIVER_READS } },
      ),
    ).resolves.toMatchObject({ delivered: true })
  })

  test('delivering schedules exactly one follow-on job', async () => {
    // One: tomorrow's reminder. An email player enqueues nothing else, so this
    // is the number that makes the chain O(1) per player per day rather than
    // fanning out.
    const t = convexTest(schema, modules)
    const playerId = await aScheduledPlayer(t)

    await expect(
      t.mutation(
        internal.reminders.deliver,
        { playerId, dueAt: DUE },
        { transactionLimits: { functionsScheduled: 0 } },
      ),
    ).rejects.toThrow(/Scheduled too many functions/)

    const t2 = convexTest(schema, modules)
    const playerId2 = await aScheduledPlayer(t2)
    await expect(
      t2.mutation(
        internal.reminders.deliver,
        { playerId: playerId2, dueAt: DUE },
        { transactionLimits: { functionsScheduled: 1 } },
      ),
    ).resolves.toMatchObject({ delivered: true })
  })

  /**
   * THE DECISIVE ASSERTION OF THE WHOLE CHANGE: a superseded job is nearly free.
   * The staleness guard runs before anything else, so a leftover job costs ONE
   * document — not a `dailyScores` query, and not a reschedule.
   */
  test('a superseded job reads one document and schedules nothing', async () => {
    const t = convexTest(schema, modules)
    const playerId = await aScheduledPlayer(t)
    await t.run((ctx) => ctx.db.patch(playerId, { nextReminderAt: DUE + 3600_000 }))

    await expect(
      t.mutation(
        internal.reminders.deliver,
        { playerId, dueAt: DUE },
        { transactionLimits: { documentsRead: 1, functionsScheduled: 0 } },
      ),
    ).resolves.toMatchObject({ reason: 'superseded' })
  })
})

describe('reminder maintenance bandwidth', () => {
  /**
   * IN STEADY STATE THIS PASS WRITES AND SCHEDULES NOTHING, which is the
   * statement that the 82 MB/month floor is gone. It still reads the tables — a
   * daily full scan is the deliberate price of the self-healing property, and
   * at 30 runs a month rather than 720 it is under 4 MB — but if it starts
   * rescheduling healthy players every day, it is churning 393 rows daily and
   * this fails.
   */
  test('does no work when every chain is healthy', async () => {
    const t = convexTest(schema, modules)
    await t.run(async (ctx) => {
      for (let i = 0; i < 3; i++) {
        const id = await ctx.db.insert(
          'players',
          aPlayer({
            email: `p${i}@example.com`,
            timeZone: 'America/Chicago',
            playsWeekends: true,
            nextReminderAt: Date.now() + 6 * 3600 * 1000,
          }),
        )
        await ctx.db.insert('teams', aTeam({ playerIds: [id], playWeekends: true }))
      }
    })

    await expect(
      t.mutation(internal.reminders.maintain, {}, { transactionLimits: { functionsScheduled: 0 } }),
    ).resolves.toMatchObject({ scheduled: 0, weekendFlagsChanged: 0, deferred: 0 })
  })
})
```

- [ ] **Step 2: Run and bisect the real numbers**

```
pnpm test:once convex/dashboardBandwidth.test.ts
```

`DELIVER_READS = 3` is the predicted value: the player row plus two index lookups.
**If it is wrong, bisect rather than widen it** — lower the limit until the call
throws, raise it until it passes, and set the constant to the value where both
assertions hold. Then update the comment to state what the documents actually are. A
number that does not match a named list of documents is not a measurement.

- [ ] **Step 3: Run all four gates**

```
pnpm lint
pnpm typecheck
pnpm test:once
pnpm build
```

- [ ] **Step 4: Commit**

```bash
git add convex/dashboardBandwidth.test.ts
git commit -F - <<'EOF'
test(reminders): pin the per-execution cost of the new scheduling

The claim this change rests on is a cost claim, so it gets a test. convex-test
meters documentsRead and functionsScheduled per transaction, which makes the
numbers assertable rather than modelled -- and asserted from BOTH sides, since
a ceiling alone would pass at any number above the truth.

deliver reads exactly 3 documents (the player row and two dailyScores index
lookups) and schedules exactly 1 follow-on job. The deleted sweep read all 393
players on every one of 720 monthly runs; if deliver ever starts collecting a
table again, this fails.

Two assertions carry the design's key properties. A superseded job reads ONE
document and schedules nothing, because the staleness guard runs first. And
the maintenance pass writes and schedules nothing when every chain is healthy,
which is the statement that the 82 MB/month floor is actually gone rather than
merely moved.

Refs: wordle-teams-spcu

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>
EOF
```

---

## Task 9: Record the cutover ordering requirement

Reminders are ON at cutover, and a player is not scheduled until `maintain` has seen
them. The copy therefore has to precede a `maintain` run.

**Files:**
- Modify: `docs/runbooks/2026-cutover.md`

- [ ] **Step 1: Read the runbook's reminder section**

```
grep -n "REMINDERS_ENABLED" -B 5 -A 15 ../docs/runbooks/2026-cutover.md
```

- [ ] **Step 2: Add the ordering requirement**

Add to that section, adapting the surrounding style:

```markdown
### Reminders are scheduled per player, not swept (wordle-teams-spcu)

There is no longer an hourly sweep that finds whoever is due. Each player holds
their own scheduled job, and a player is put on the schedule by one of:

- `updateTimeZoneFor`, on their first authenticated load, or
- the `reminder maintenance` cron, daily at **01:15 UTC**.

**So the final copy must precede a `reminder maintenance` run, and that run must
precede setting `REMINDERS_ENABLED=true`.** A copied player with no
`nextReminderAt` has no pending job, and would get no reminder until that cron
next fires.

**Verify before flipping the flag** — this is a read, so it is safe:

```
npx convex run --prod reminders:maintain '{"budget": 0}'
```

`budget: 0` schedules nothing and reports what it WOULD do. Expect
`deferred` to equal the number of copied players still unscheduled. If it is
non-zero, wait for the cron or re-run without the budget.

**Note the `--prod` hazard:** `CONVEX_DEPLOY_KEY` in `v2/.env.local` outranks
`CONVEX_DEPLOYMENT`, and `convex run --prod` has been observed silently hitting
the LOCAL deployment on a developer machine. Confirm from the Convex dashboard
that `nextReminderAt` is populated rather than trusting the CLI's output alone.
```

- [ ] **Step 3: Commit**

```bash
git add ../docs/runbooks/2026-cutover.md
git commit -F - <<'EOF'
docs(runbook): reminders need a maintenance run between copy and cutover

Reminders are ON at cutover, and with the hourly sweep gone a player gets no
reminder until something puts them on the schedule -- their first
authenticated load, or the daily 01:15 UTC maintenance cron. So the final copy
has to precede a maintenance run, and that run has to precede
REMINDERS_ENABLED=true.

The verification is a read (`budget: 0` schedules nothing and reports what it
would do), but it carries the known --prod hazard: CONVEX_DEPLOY_KEY in
.env.local outranks CONVEX_DEPLOYMENT and `convex run --prod` has been seen
silently hitting the local deployment, so the dashboard is the confirmation,
not the CLI output.

Refs: wordle-teams-spcu

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>
EOF
```

---

## Task 10: Gates, deploy, and read the e2e result

**e2e is a gate and it runs in CI, not here.** `.github/workflows/deploy-v2.yml`
stands up a local Convex backend itself and runs Playwright against it before
deploying. You do not need a local backend; push and read the result.

- [ ] **Step 1: Run all four gates one final time, separately**

```
pnpm lint
pnpm typecheck
pnpm test:once
pnpm build
```

Read each exit code on its own. Do not pipe — zsh leaves `PIPESTATUS` empty, so a
piped check can report a false green.

- [ ] **Step 2: Confirm the e2e suite is not attached to a stale dev server**

If you run Playwright locally at all, make sure nothing else holds port 3000 —
Playwright attaches to whatever is there, and a days-old `vite dev` makes every run
test stale code.

```
lsof -ti:3000 || echo "3000 is free"
```

- [ ] **Step 3: Push and capture the commit SHA**

```
git pull --rebase
bd dolt push
git push
git rev-parse HEAD
git status
```

`git status` MUST show "up to date with origin".

- [ ] **Step 4: Watch the run for THIS sha**

Do not use `--limit 1` — after a push it returns the PREVIOUS run. Select by SHA:

```
gh run list --commit "$(git rev-parse HEAD)" --limit 5
gh run watch <run-id-from-above>
```

- [ ] **Step 5: Read the Playwright pass count**

Playwright's default reporter names only failures, so **the count is the evidence**:

```
gh run view <run-id> --log | grep -E "[0-9]+ passed|[0-9]+ failed"
```

Expected: the same pass count as before this branch, with no failures. Reminder
scheduling is not observable through the UI, so no new spec was added — e2e's job
here is to catch a regression in the settings path, which `e2e/settings.spec.ts`
already covers.

- [ ] **Step 6: Verify on beta**

The deploy is automatic for `v2/**` changes on this branch, and authorised.

```
npx convex env list
```

Confirm `REMINDERS_ENABLED` is still EMPTY on beta. It must stay that way — beta
holds copied production rows, real people who do not know this beta exists and who
already get real reminders from v1.

Then confirm the maintenance cron actually ran and scheduled, from the Convex
dashboard's logs and scheduled-functions view: `reminders:maintain` should appear
once at 01:15 UTC, and `reminders:deliver` jobs should be pending. **This is the
verification the unit suite cannot give**, because `convex-test`'s scheduler is a
fake.

- [ ] **Step 7: Close the issue and hand off**

Close BEFORE the commit that should carry it. A beads-only commit aborts the first
time with "nothing to commit" — run `git commit` again, never `--no-verify`, since
that hook is also the PII guard.

```bash
bd update wordle-teams-spcu --append-notes "$(cat <<'EOF'
SHIPPED. Per-player scheduling replaced the hourly sweep.

<record: the measured DELIVER_READS, the new test baseline, the CI e2e pass
count, and the beta dashboard confirmation that maintain ran and deliver jobs
are pending>

WHAT THE ISSUE ASKED FOR, AND WHERE IT LANDED:
  1. DST — nextOccurrence recomputes live in the player's zone, never +24h.
     Swept over all 418 IANA zones, 167,200 cases, zero failures; the test
     asserts the GAP (23h/25h/30min/72h) because that is what distinguishes it
     from +24h on an ordinary day.
  2. cancel() — did not need tolerating. Every job carries the dueAt it was
     created for and retires if the row disagrees, so a failed cancel is
     HARMLESS rather than handled. Note Convex documents the throw for
     ACTIONS; for mutations the wording is "fail to cancel if it has
     committed".
  3. Bootstrap — dissolved. Existing players have no nextReminderAt, which is
     the same case a broken chain presents, so maintain covers both and no
     migration mutation exists.
  4. REMINDERS_ENABLED stayed at delivery. The consequence that needed making
     explicit: deliver must reschedule EVEN WHEN GATED OFF, or flipping the
     flag off would strand every player.

THE TRADE, RESOLVED: the daily reconciliation pass is LOAD-BEARING, not a
mitigation to weigh. Scheduled mutations are auto-retried on transient errors,
so the risk is a permanent throw — an unresolvable timeZone on a copied row
rolls back the reschedule with everything else.

TWO THINGS THE ISSUE DID NOT ANTICIPATE:
  - Fanning out DE-AMORTISES the weekend teams collect (paid once per sweep
    run before, once per job after). It scales with ACTIVE users: ~200 MB/month
    at 500 active players, worse than the 82 MB removed. Hence playsWeekends,
    derived by ONE daily writer rather than hooked into the 8 team write paths
    across 6 modules.
  - A hard 1000-functionsScheduled-per-transaction cap ruled out the
    daily-planner alternative, which would have sat at 39% of it and failed
    past ~1000 players.

HONEST ACCOUNTING, and it is smaller than "82 MB gone": 12x on the players
term, ~4x overall. The dailyScores read was narrowed from an 11-day collect to
two index lookups in the same pass. The _scheduled_functions traffic (~12,000
jobs/month) is the one number this could not bound from the repository — it
needs the 30-day dashboard reading on wordle-teams-l10c.2 beside the 460.26 MB
baseline.

STILL OPEN, filed separately if not already: nothing blocking. chatNotify.sweep
remains the last hourly cron.
EOF
)"
bd close wordle-teams-spcu
git commit -m "chore(beads): close per-player reminder scheduling" || git commit -m "chore(beads): close per-player reminder scheduling"
git push
```

---

## Self-Review

**Spec coverage.** Every section maps to a task: §1 data model → Task 2; §2 delivery
job → Task 5; §3 next-occurrence → Task 1; §4 daily pass and the `playsWeekends`
derivation → Tasks 1 and 6; §5 `dailyScores` narrowing → Task 5; cost accounting →
Task 8; the `isDueThisHour` deletion → Task 7; acceptance criteria 1-8 → Tasks 5-8;
criterion 9 (four gates) → every task; criterion 10 (e2e) → Task 10. The cutover
ordering requirement is new in Task 9 — it follows from the spec's decision that
reminders are ON at cutover, which the spec recorded but did not turn into a step.

**Two deliberate deviations from the spec, both simplifications:**

1. **No `by_nextReminderAt` index.** The spec proposed one so the repair could be an
   index range query returning zero rows. But `maintain` must collect the whole
   `players` table anyway to derive `playsWeekends`, so the repair reads from that
   same scan and the index would narrow a query nobody makes. The
   `undefined`-sorts-before-numbers property the spec verified is consequently NOT
   load-bearing here, and no test pins it — pinning a property nothing depends on is
   the "tests passing for the wrong reason" hazard in reverse.
2. **`scheduleNextFor` split out from `reschedulePlayerReminderFor`.** The spec
   described one helper. `deliver` reschedules itself, and at that moment
   `reminderJobId` is the currently-running job, so cancelling would hit exactly the
   "fail to cancel if it has committed" case. Two functions, one of which does not
   cancel.

**Placeholder scan.** One intentional fill-in remains: the test baseline in Task 7's
commit message, which cannot be known until Step 7 measures it, and `DELIVER_READS`
in Task 8 which Step 2 instructs the implementer to bisect rather than assume. Both
are measurements with an explicit procedure, not TBDs.

**Type consistency.** `scheduleNextFor(ctx, playerId, from)`,
`reschedulePlayerReminderFor(ctx, playerId, from?)`,
`nextOccurrence(timeZone, reminderTime, from, playsWeekends)`,
`instantForLocal(timeZone, day, time)`, `activityFloor(localDay)`,
`weekendPlayerIdsFrom(teams)`, `deliver({ playerId, dueAt })`,
`maintain({ budget? })`. Field names `reminderJobId`, `nextReminderAt`,
`playsWeekends` are used identically in the schema, the helpers, the tests and the
runbook. `maintain`'s return shape
`{ players, teams, weekendFlagsChanged, scheduled, deferred }` is the one asserted in
Tasks 6 and 8.
