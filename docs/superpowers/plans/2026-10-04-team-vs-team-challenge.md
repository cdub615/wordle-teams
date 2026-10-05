# Team-vs-Team Challenge Scoreboard Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let one team challenge another and show a scoreboard of the two teams' pooled average guesses over a window that starts the day after acceptance and ends with the calendar month.

**Architecture:** No new aggregate. Every number is projected from the `teamMonthStats` documents that `winners.ts` already maintains incrementally on board write. All decidable rules live in a dependency-light `convex/lib/challenge.ts` so they are unit-testable without an authed session (wordle-teams-obw). A closed challenge freezes its numbers into a snapshot, because backfill can legitimately rewrite an old month. Closing rides the existing daily `teamStats.sweep`; no new cron lane.

**Tech Stack:** Convex (schema, queries, mutations, internal actions, crons), TypeScript, TanStack Start + React for the two UI surfaces, Vitest + convex-test.

**Spec:** `docs/superpowers/specs/2026-10-04-team-vs-team-challenge-design.md`. Read it before Task 1. Section references below (§N) point into it.

---

## Ground Rules For This Plan

**Run the four quality gates separately and read each exit code.** They fail independently: `build` does not typecheck, `lint` reaches files the others never load, and a docs-only change can fail `test:once`.

```bash
TZ=UTC pnpm test:once   # vitest
pnpm typecheck          # tsc --noEmit
pnpm lint               # eslint . --max-warnings 0
pnpm build              # vite build + scripts/build-sw.mjs
```

**Never pipe a gate into `tail`/`grep` to read its result.** `PIPESTATUS` is empty in this zsh, so `$?` becomes the pipe's exit code and a red gate reads as green. Redirect to a file, read `$?`, then inspect the file:

```bash
TZ=UTC pnpm test:once > /tmp/gate.txt 2>&1; echo "exit=$?"; tail -40 /tmp/gate.txt
```

**`TZ=UTC` on every test run.** Every window boundary is a `'YYYY-MM-DD'` string comparison. A date test that passes on the host timezone and fails in CI is a known failure mode in this repo.

**Backticks inside shell strings get executed.** Write commit messages with a quoted heredoc (`git commit -F - <<'EOF'`), never `-m "...\`x\`..."`.

**Single-file test runs:** `TZ=UTC pnpm test:once convex/lib/challenge.test.ts`

**ADDING AN `AccessCode` MEANS EDITING `src/lib/convex-error.ts` TWICE, AND ONE HALF
HAS NO COMPILER BEHIND IT.** That file's own banner says it: "THIS CHAIN MUST BE
EXTENDED BY HAND EVERY TIME AccessCode GROWS, AND NO COMPILER WILL TELL YOU."

- `typedCodeMessage` IS enforced — its `default` assigns to `never`, so a new union
  member stops the build until a case exists. `pnpm typecheck` catches this half.
- `convexErrorCode`'s chain is NOT enforced. Miss it and the specific copy someone
  wrote is unreachable, so **every user sees the generic message instead** — no
  compiler, no gate, no test failure. `src/lib/convex-error.test.ts` parses the source
  to pin it, which is the only thing standing in the way.

Tasks 5, 7 and 9 each add codes (`CHALLENGES_REFUSED`, `CHALLENGE_LIMIT_REACHED`,
`CHALLENGE_EXISTS`, `PRO_REQUIRED`; then `CHALLENGE_NOT_PENDING`,
`CHALLENGE_LINK_INVALID`; then `CHALLENGE_NOT_ACTIVE`). Each must add BOTH halves, and
the task's commit therefore includes `src/lib/convex-error.ts`. This was missed in the
plan's Task 5 and found only because typecheck failed on the enforced half.

**A REFUSAL TEST MUST ASSERT THE CODE, NOT JUST THAT SOMETHING THREW.** Six of this
plan's Task 5 tests used a bare `.rejects.toThrow()`, which passes if the call throws
for ANY reason — so "a non-Pro member is refused" would have passed on an unrelated
`NOT_A_MEMBER` from a mis-seeded fixture, proving nothing about the Pro gate. Use:

```ts
await expect(promise).rejects.toMatchObject({ data: { code: 'PRO_REQUIRED' } })
```

`accessError` throws a `ConvexError` carrying `{ code }`, so the code is always
available. This applies to every refusal assertion in Tasks 6-11.

**A SCHEMA TEST THAT ONLY INSERTS A HAPPY-PATH ROW PINS ALMOST NOTHING.** Task 4
shipped with three prescribed tests and FIVE surviving mutants: both compound indexes
could have their field order reversed, a nested validator field could be renamed, the
six status literals could collapse to two, and `result.outcome` could widen from four
literals to `v.string()`. That last one is invisible to typecheck forever, because every
value ever written still satisfies the wider validator — `schema.test.ts` documents this
exact class for `reminderJobId`. For any table this plan adds or changes, the tests must
cover: every literal of each union round-tripped, one REJECTED bad literal PER UNION (not one for the table — two named fields need two assertions), one fully
populated nested object, and one query per compound index. `convex-test` rejects bad
literals and undeclared fields (measured), so these assertions have real force.

**NEVER RUN `convex codegen` — AND MOST TASKS HERE DO NOT NEED IT.**

`convex codegen` **uploads your working tree's functions to a deployment**, and in
this repo a bare Convex CLI call silently targets PRODUCTION (`wordle-teams-ldm8`).
`--dry-run` does NOT prevent the upload; it only suppresses the local file write.
`CONVEX_AGENT_MODE=anonymous` does not help either — `CONVEX_DEPLOY_KEY` outranks it.
This was triggered once during setup; blast radius was nil only because `convex/` on
`dev` was byte-identical to `origin/main`. The worktree's `.env.local` has the prod
block stripped, so the command now fails safely here, but no task should run it.

What actually needs regenerating, and when:

- **Schema changes need NOTHING.** `convex/_generated/dataModel.d.ts` is
  `DataModel = DataModelFromSchemaDefinition<typeof schema>`, computed from
  `schema.ts` at typecheck time. Task 4's new table gives you `Doc<'teamChallenges'>`
  and `Id<'teamChallenges'>` with no codegen at all. Verified.
- **`api.d.ts` enumerates modules explicitly** and is ALREADY stale — it does not list
  `lib/challenge`, added in Tasks 1-3, and typecheck passes anyway because that module
  exports no Convex functions, so nothing reaches it through `api.*`/`internal.*`.
- **It becomes load-bearing at Task 12**, which references
  `api.challenges.challengesForTeam`. That needs `challenges` present in `api.d.ts` or
  `pnpm typecheck` fails — locally AND in CI, which runs the same gate.

So the controller regenerates `api.d.ts` ONCE, before Task 12, against a LOCAL
anonymous backend — never against a remote deployment. Do not attempt it as part of a
task; report it as blocked and let the controller handle it.

**`monthRange(month).end` IS NOT A DATE.** It returns `'<month>-31'` for every
month, February included — its own doc comment calls it a lexicographic bound,
correct for an index range query and wrong for anything that must be a real day.
Task 1's plan text used it as an `endDay` and was corrected after the implementer
caught it producing `2026-11-31` and `2028-02-31`. Use `daysOfMonth(month).at(-1)`
when you need the actual last day. Reach for `monthRange` only as `withIndex`
bounds.

**Commit after every task.** **Sign it with YOUR OWN attribution trailer** — the
`Co-Authored-By` line your own system reminder gives you, naming the model that
actually wrote the code. Do NOT copy a trailer out of this plan: every implementer so
far has had to notice the pasted one was wrong for them and override it, which is three
round trips spent on a line this plan should never have prescribed. Keep the
`Claude-Session:` line as written.

```
<YOUR OWN attribution trailer — see below>
Claude-Session: https://claude.ai/code/session_01J5oECn6C61LEH6aeUMiSA8
```

**bd, never TodoWrite.** Each task below has a bd issue. Claim with `bd update <id> --claim`, close with `bd close <id>`. A bd-only commit aborts on the first try — retry once with `||`, never twice unconditionally. A `bd close` committed together with code records the PRE-close state, so verify and commit again.

---

## File Structure

| File | Responsibility |
| --- | --- |
| `convex/lib/challenge.ts` | **Create.** Constants, window arithmetic, window projection, outcome. Every decidable rule. No import that reaches `../access.ts`. |
| `convex/lib/challenge.test.ts` | **Create.** Unit tests for the above, both sides of every threshold. |
| `convex/schema.ts` | **Modify.** Add `teamChallenges`; add `acceptsChallenges` to `teams`. |
| `convex/challenges.ts` | **Create.** `*For` helpers holding the logic, plus the thin public mutations/queries that supply inputs. |
| `convex/challenges.test.ts` | **Create.** Database-level behaviour driven through `ctx.db`. |
| `src/lib/convex-error.ts` | **Modify, on every task that adds an `AccessCode`** — Tasks 5, 7 and 9. See the ground rule below; one half of it is not compiler-enforced. |
| `convex/teamStats.ts` | **Modify.** Extend `sweep` to close due challenges and expire stale proposals. |
| `convex/chatNotify.ts` | **Modify.** One comment correction only (it claims to be the app's only user-typed push body). |
| `src/routes/team.tsx` | **Modify.** Challenges section. |
| `src/components/challenges/*` | **Create.** Scoreboard, propose dialog, record list. |
| `src/routes/challenge.$token.tsx` | **Create.** Link claim route, mirroring `join.$token.tsx`. |

**Why `convex/lib/challenge.ts` may import `./puzzleDay.ts` and `./teamStats.ts`.** The "no imports" banner on `globalThreshold.ts` and `insightsAccess.ts` forbids reaching `../access.ts`, because that drags `auth.ts` — the whole Better Auth server surface — into the client chunk. It does not forbid lib→lib. `lib/puzzleDay.ts` states it "has no dependencies and must keep none", and `lib/teamStats.ts` already imports `./board.ts` while being imported by the client. So those two are safe. **Do not add an import of `../access.ts`, `../auth.ts`, or anything under `convex/_generated/` to `lib/challenge.ts`.**

**One deliberate deviation from the spec, for DRY.** §5 names a `teamAverageOf` function. Do not write one. `lib/teamStats.ts:232` `meanAttemptsOf` already takes `{ boards, attempts }`, already rounds to 1dp before comparison, and its banner declares it "THE SINGLE DEFINITION of how well did they do" precisely because a second implementation is how two surfaces come to disagree about who is ahead. Import and call it.

---

## Task 1: Constants and the window

**bd:** create as a child of `wordle-teams-zic8.2`, title "challenge constants and windowFor".

**Files:**
- Create: `convex/lib/challenge.ts`
- Create: `convex/lib/challenge.test.ts`

- [ ] **Step 1: Write the failing test**

Create `convex/lib/challenge.test.ts`:

```ts
import { describe, expect, test } from 'vitest'
import {
  MAX_ACTIVE_CHALLENGES,
  MIN_CHALLENGE_BOARDS,
  PROPOSAL_TTL_DAYS,
  SHORT_WINDOW_DAYS,
  windowFor,
} from './challenge.ts'

describe('the constants', () => {
  test('are the values the design approved', () => {
    expect(MIN_CHALLENGE_BOARDS).toBe(10)
    expect(MAX_ACTIVE_CHALLENGES).toBe(5)
    expect(PROPOSAL_TTL_DAYS).toBe(7)
    expect(SHORT_WINDOW_DAYS).toBe(7)
  })
})

describe('windowFor', () => {
  test('starts the day AFTER acceptance, so nothing retroactive counts', () => {
    expect(windowFor(today).startDay).toBe('2026-10-05')
  })

  test('ends with the calendar month when the month has room', () => {
    expect(windowFor(today)).toEqual({ startDay: '2026-10-05', endDay: '2026-10-31' })
  })

  // SHORT_WINDOW_DAYS = 7, counted INCLUSIVELY from startDay to month end.
  test('at the short-window boundary the window still ends with this month', () => {
    // start 2026-10-25, end 2026-10-31 => 7 days remaining, which is NOT fewer than 7.
    expect(windowFor('2026-10-24')).toEqual({ startDay: '2026-10-25', endDay: '2026-10-31' })
  })

  test('below the boundary it runs to the end of the FOLLOWING month', () => {
    // start 2026-10-26, end 2026-10-31 => 6 days remaining, fewer than 7.
    expect(windowFor('2026-10-25')).toEqual({ startDay: '2026-10-26', endDay: '2026-11-30' })
  })

  test('accepting on the last day of a month gets the whole next month', () => {
    expect(windowFor('2026-10-31')).toEqual({ startDay: '2026-11-01', endDay: '2026-11-30' })
  })

  test('crosses a year boundary', () => {
    expect(windowFor('2026-12-28')).toEqual({ startDay: '2026-12-29', endDay: '2027-01-31' })
  })

  test('handles February in a leap year', () => {
    expect(windowFor('2028-02-01')).toEqual({ startDay: '2028-02-02', endDay: '2028-02-29' })
  })
})
```

- [ ] **Step 2: Run it and confirm it fails**

```bash
TZ=UTC pnpm test:once convex/lib/challenge.test.ts > /tmp/t1.txt 2>&1; echo "exit=$?"; tail -20 /tmp/t1.txt
```

Expected: non-zero exit, failing to resolve `./challenge.ts`.

- [ ] **Step 3: Write the implementation**

Create `convex/lib/challenge.ts`:

```ts
import { addDays, addMonths, daysOfMonth, monthOf } from './puzzleDay.ts'
import type { PuzzleDay } from './puzzleDay.ts'

/**
 * THE RULES OF A TEAM-VS-TEAM CHALLENGE, in one dependency-light module.
 *
 * WHY EVERYTHING DECIDABLE IS IN HERE. Nothing in this repo can drive an authed
 * Convex wrapper (wordle-teams-obw), so a rule left inside a mutation is a rule
 * no test can execute. The mutations in ../challenges.ts supply inputs; this
 * file decides.
 *
 * WHAT MAY BE IMPORTED HERE. ./puzzleDay.ts and ./teamStats.ts only, both of
 * which the client already pulls in. NOT ../access.ts and NOT ../auth.ts: the
 * banner on globalThreshold.ts has the measurement — reaching the Better Auth
 * server surface from a module the browser imports used to kill the client
 * chunk and is now silent weight, which is harder to notice rather than less
 * wrong.
 */

/**
 * The per-team board floor for a challenge window. Below it that side has no
 * valid figure and the outcome is 'void'.
 *
 * THE ONLY PLACE THE SMALL-SAMPLE HAZARD LIVES. Under pooled averaging one
 * lucky board carries 1/N of the weight and self-damps, so there is deliberately
 * NO per-player minimum — adding one would silently exclude casual members,
 * which is a top-N rule by the back door and was rejected in the design.
 */
export const MIN_CHALLENGE_BOARDS = 10

/** Active challenges one team may hold, counting both directions. */
export const MAX_ACTIVE_CHALLENGES = 5

/** How long a pending proposal survives before it expires. */
export const PROPOSAL_TTL_DAYS = 7

/**
 * Fewer than this many days left in the month at acceptance and the window runs
 * to the end of the FOLLOWING month instead.
 *
 * WITHOUT THIS RULE a late-month challenge is born guaranteed-'void', because it
 * cannot reach MIN_CHALLENGE_BOARDS, which is a bad first experience of the
 * feature. It is the only case in which a window crosses a month boundary, and
 * therefore the only case costing two teamMonthStats documents per team.
 */
export const SHORT_WINDOW_DAYS = 7

export type ChallengeWindow = { startDay: PuzzleDay; endDay: PuzzleDay }

/**
 * The REAL last day of a month. NOT monthRange(month).end: that is the
 * lexicographic bound '<month>-31' even in February, which is not a date, so it
 * would be a wrong endDay and would also skew the remaining-days count.
 */
function lastDayOf(month: string): PuzzleDay {
  return daysOfMonth(month).at(-1) as PuzzleDay
}

/**
 * The window a challenge accepted on `acceptedOn` covers.
 *
 * THE START IS THE DAY AFTER, NOT THE DAY OF. Every board that counts must have
 * been played knowing the challenge was live; counting the acceptance day would
 * include boards already entered that morning. The whole-month-retroactive
 * alternative was considered and rejected in the design for the same reason.
 *
 * REMAINING DAYS ARE COUNTED BY DAY-OF-MONTH SUBTRACTION, not by date
 * arithmetic, because startDay and the month end are in the same month by
 * construction. That keeps this module's promise that day comparison, month
 * bounding and ranges are all plain string operations.
 */
export function windowFor(acceptedOn: PuzzleDay): ChallengeWindow {
  const startDay = addDays(acceptedOn, 1)
  const month = monthOf(startDay)
  const thisMonthEnd = lastDayOf(month)

  // Inclusive: a start day equal to the month end leaves one day, not zero.
  const remaining = Number(thisMonthEnd.slice(8, 10)) - Number(startDay.slice(8, 10)) + 1
  if (remaining < SHORT_WINDOW_DAYS) {
    return { startDay, endDay: lastDayOf(addMonths(month, 1)) }
  }
  return { startDay, endDay: thisMonthEnd }
}
```

- [ ] **Step 4: Run it and confirm it passes**

```bash
TZ=UTC pnpm test:once convex/lib/challenge.test.ts > /tmp/t1.txt 2>&1; echo "exit=$?"; tail -20 /tmp/t1.txt
```

Expected: `exit=0`, 9 tests passing (8 here plus the non-leap-February case added at review).

- [ ] **Step 5: Commit**

```bash
git add convex/lib/challenge.ts convex/lib/challenge.test.ts
git commit -F - <<'EOF'
feat(zic8.2): challenge constants and window arithmetic

windowFor starts the day AFTER acceptance so nothing retroactive counts, and
falls through to the end of the following month when fewer than
SHORT_WINDOW_DAYS remain - without which a late-month challenge is born
guaranteed-void. Both sides of that boundary are tested, since a threshold
tested in one direction is vacuous.

<YOUR OWN attribution trailer — see below>
Claude-Session: https://claude.ai/code/session_01J5oECn6C61LEH6aeUMiSA8
EOF
```

---

## Task 2: Project a window out of `teamMonthStats.days[]`

**bd:** child of `zic8.2`, title "teamTotalsOver window projection".

**Files:**
- Modify: `convex/lib/challenge.ts`
- Modify: `convex/lib/challenge.test.ts`

- [ ] **Step 1: Write the failing test**

Append to `convex/lib/challenge.test.ts`:

```ts
import { teamTotalsOver } from './challenge.ts'

const days = [
  { puzzleDay: '2026-10-04', entries: [{ playerId: 'a', attempts: 3 }] },
  { puzzleDay: '2026-10-05', entries: [{ playerId: 'a', attempts: 4 }, { playerId: 'b', attempts: 2 }] },
  { puzzleDay: '2026-10-31', entries: [{ playerId: 'b', attempts: 7 }] },
  { puzzleDay: '2026-11-01', entries: [{ playerId: 'a', attempts: 5 }] },
]

describe('teamTotalsOver', () => {
  test('counts only days inside the window, both bounds inclusive', () => {
    const totals = teamTotalsOver(days, '2026-10-05', '2026-10-31')
    expect(totals.boards).toBe(3)
    expect(totals.attempts).toBe(4 + 2 + 7)
  })

  test('excludes the day before the window, which is the retroactivity guard', () => {
    const totals = teamTotalsOver(days, '2026-10-05', '2026-10-31')
    expect(totals.members.find((m) => m.playerId === 'a')?.attempts).toBe(4)
  })

  // A POSITIVE ASSERTION, because `not.toBe(4)` beside a test asserting
  // `toBe(3)` on the same inputs is ZERO evidence, not weak evidence — it also
  // passes at 0, 1, 2 and 99. Player 'a' plays 10-04 (before), 10-05 (inside)
  // and 11-01 (after), so boards === 1 for 'a' holds only if BOTH ends exclude.
  test('excludes the day after the window', () => {
    const totals = teamTotalsOver(days, '2026-10-05', '2026-10-31')
    expect(totals.members.find((m) => m.playerId === 'a')).toEqual({
      playerId: 'a',
      boards: 1,
      attempts: 4,
    })
  })

  test('splits totals per player', () => {
    const totals = teamTotalsOver(days, '2026-10-05', '2026-10-31')
    // arrayContaining is right because member ORDER is deliberately
    // unspecified here (Task 9 sorts for display) — but it is satisfied by a
    // SUPERSET, so a defect emitting a spurious extra member would survive it.
    // The length pins that.
    expect(totals.members).toHaveLength(2)
    expect(totals.members).toEqual(
      expect.arrayContaining([
        { playerId: 'a', boards: 1, attempts: 4 },
        { playerId: 'b', boards: 2, attempts: 9 },
      ]),
    )
  })

  test('a failed board contributes 7, the attemptsFor sentinel', () => {
    const totals = teamTotalsOver(days, '2026-10-31', '2026-10-31')
    expect(totals.attempts).toBe(7)
    expect(totals.boards).toBe(1)
  })

  test('an empty window is zero boards rather than a throw', () => {
    expect(teamTotalsOver(days, '2026-09-01', '2026-09-30')).toEqual({
      boards: 0,
      attempts: 0,
      members: [],
    })
  })

  // THE SHORT-WINDOW CASE: two months of days, concatenated by the caller.
  test('accepts days concatenated from two monthly documents', () => {
    const totals = teamTotalsOver(days, '2026-10-31', '2026-11-30')
    expect(totals.boards).toBe(2)
    // Shown as its derivation, like `4 + 2 + 7` above: 10-31's failure and
    // 11-01's five. A bare 12 hides which fixture rows it depends on.
    expect(totals.attempts).toBe(7 + 5)
  })
})
```

- [ ] **Step 2: Run it and confirm it fails**

```bash
TZ=UTC pnpm test:once convex/lib/challenge.test.ts > /tmp/t2.txt 2>&1; echo "exit=$?"; tail -20 /tmp/t2.txt
```

Expected: non-zero exit, `teamTotalsOver is not a function` or an unresolved import.

- [ ] **Step 3: Write the implementation**

Append to `convex/lib/challenge.ts`:

```ts
import type { DayEntry } from './teamStats.ts'

/**
 * GENERIC OVER THE PLAYER ID, and the entry type is REUSED rather than
 * re-declared — both for the reason lib/teamStats.ts:28-32 already gives: a
 * branded `Id<'players'>` is a string with a phantom tag, and taking it as a
 * parameter lets the schema's exact type flow through without this file
 * importing the generated data model, which it must not do.
 *
 * THAT IDIOM IS ALREADY LOAD-BEARING, not theoretical: convex/teamStats.ts:108
 * calls `aggregateTeamMonth({ memberIds: team.playerIds, scores })`, infers
 * `PlayerId = Id<'players'>`, and writes straight into a table whose playerId is
 * `v.id('players')` with NO CAST. Widening to `string` here would force Task 9
 * to cast it back, and a cast is exactly where an Id for the wrong table slips
 * through unnoticed.
 *
 * READONLY ON THE WAY OUT. A result is a snapshot; the mutable accumulator is a
 * private detail and gets its own inline type inside the function.
 */
export type ChallengeMemberTotal<PlayerId extends string = string> = {
  readonly playerId: PlayerId
  readonly boards: number
  readonly attempts: number
}
export type ChallengeTotals<PlayerId extends string = string> = {
  readonly boards: number
  readonly attempts: number
  readonly members: ReadonlyArray<ChallengeMemberTotal<PlayerId>>
}

/**
 * The shape of teamMonthStats.days[], narrowed to what a projection needs.
 *
 * `entries` is teamStats.ts's own DayEntry. Re-declaring it inline would be a
 * second copy of a type that already exists, and declared less precisely.
 */
export type StatsDay<PlayerId extends string = string> = {
  readonly puzzleDay: PuzzleDay
  readonly entries: ReadonlyArray<DayEntry<PlayerId>>
}

/**
 * One team's totals over a challenge window.
 *
 * READS days[], NEVER members[], AND THAT IS THE WHOLE POINT. members[] holds
 * WHOLE-MONTH totals, and a challenge window is almost never a whole month, so
 * using it would silently count boards played before acceptance — exactly the
 * retroactivity windowFor exists to prevent. days[] is complete for the month,
 * so summing the entries inside the window is both correct and the only correct
 * source.
 *
 * ONLY boards AND attempts ARE DERIVABLE THIS WAY — not solved/failed, which
 * exist only on members[]. That is sufficient and not a gap: a failed board is
 * already folded into attempts as 7 by attemptsFor, so nothing in the metric,
 * the outcome or the snapshot needs a separate failure count. Do not reach for
 * members[] to recover one.
 *
 * TAKES days RATHER THAN A STATS DOCUMENT so the caller can concatenate two
 * months for the SHORT_WINDOW_DAYS case without this function knowing about
 * documents at all.
 *
 * STRING COMPARISON ON 'YYYY-MM-DD' IS THE DATE COMPARISON. See lib/puzzleDay.ts
 * on why the format exists.
 */
export function teamTotalsOver<PlayerId extends string = string>(
  days: ReadonlyArray<StatsDay<PlayerId>>,
  startDay: PuzzleDay,
  endDay: PuzzleDay,
): ChallengeTotals<PlayerId> {
  // The accumulator is mutable and private; the returned type is readonly.
  const byPlayer = new Map<PlayerId, { playerId: PlayerId; boards: number; attempts: number }>()
  let boards = 0
  let attempts = 0

  for (const day of days) {
    if (day.puzzleDay < startDay || day.puzzleDay > endDay) continue
    for (const entry of day.entries) {
      boards += 1
      attempts += entry.attempts
      const total = byPlayer.get(entry.playerId) ?? {
        playerId: entry.playerId,
        boards: 0,
        attempts: 0,
      }
      total.boards += 1
      total.attempts += entry.attempts
      byPlayer.set(entry.playerId, total)
    }
  }

  return { boards, attempts, members: [...byPlayer.values()] }
}
```

- [ ] **Step 4: Run it and confirm it passes**

```bash
TZ=UTC pnpm test:once convex/lib/challenge.test.ts > /tmp/t2.txt 2>&1; echo "exit=$?"; tail -20 /tmp/t2.txt
```

Expected: `exit=0`, 17 tests passing (9 from Task 1, 7 here, plus the same-player-twice-in-one-day case added at review).

- [ ] **Step 5: Commit**

```bash
git add convex/lib/challenge.ts convex/lib/challenge.test.ts
git commit -F - <<'EOF'
feat(zic8.2): project a challenge window out of teamMonthStats.days[]

teamTotalsOver reads days[] and never members[]: members[] holds whole-month
totals, and a challenge window is almost never a whole month, so using it would
silently count boards played before acceptance. Takes days rather than a
document so the short-window case can concatenate two months.

<YOUR OWN attribution trailer — see below>
Claude-Session: https://claude.ai/code/session_01J5oECn6C61LEH6aeUMiSA8
EOF
```

---

## Task 3: The outcome, including which direction wins

**bd:** child of `zic8.2`, title "outcomeOf: lower average wins, boards break ties".

**Files:**
- Modify: `convex/lib/challenge.ts`
- Modify: `convex/lib/challenge.test.ts`

- [ ] **Step 1: Write the failing test**

Append to `convex/lib/challenge.test.ts`:

```ts
import { outcomeOf } from './challenge.ts'

/** A side with `boards` boards averaging exactly `avg`. */
const side = (boards: number, avg: number) => {
  const attempts = boards * avg
  // THE HELPER'S WHOLE VALUE IS THAT `avg` IS THE AVERAGE. A Math.round() here
  // would make that a lie for any pair that does not divide cleanly —
  // side(3, 4.5) would claim 4.5 and produce 14/3 = 4.7 — and the resulting test
  // would assert a winner the values do not produce, passing through the boards
  // tiebreak for a reason its author never intended. Loud at authoring time
  // beats silent at review time.
  if (!Number.isInteger(attempts)) {
    throw new Error(`side(${boards}, ${avg}): ${attempts} attempts is not a whole number`)
  }
  return { boards, attempts }
}

describe('outcomeOf', () => {
  test('LOWER average guesses wins — the challenger', () => {
    expect(outcomeOf(side(20, 3.5), side(20, 4.5))).toBe('challenger')
  })

  test('LOWER average guesses wins — the opponent', () => {
    expect(outcomeOf(side(20, 4.5), side(20, 3.5))).toBe('opponent')
  })

  test('void when the challenger is below the board floor', () => {
    expect(outcomeOf(side(MIN_CHALLENGE_BOARDS - 1, 2.0), side(20, 4.5))).toBe('void')
  })

  test('void when the opponent is below the board floor', () => {
    expect(outcomeOf(side(20, 4.5), side(MIN_CHALLENGE_BOARDS - 1, 2.0))).toBe('void')
  })

  test('AT the board floor is a real result, not void', () => {
    expect(outcomeOf(side(MIN_CHALLENGE_BOARDS, 3.0), side(MIN_CHALLENGE_BOARDS, 4.0))).toBe(
      'challenger',
    )
  })

  test('a 1dp tie is broken on boards played', () => {
    // Both average 4.0; the challenger played more.
    expect(outcomeOf({ boards: 30, attempts: 120 }, { boards: 20, attempts: 80 })).toBe('challenger')
    expect(outcomeOf({ boards: 20, attempts: 80 }, { boards: 30, attempts: 120 })).toBe('opponent')
  })

  test('equal averages and equal boards is a tie', () => {
    expect(outcomeOf({ boards: 20, attempts: 80 }, { boards: 20, attempts: 80 })).toBe('tie')
  })

  // Equal RAW averages, so this pins the boards tiebreak rather than the
  // rounding. Kept for that, under a name that says so.
  // BOARDS WELL CLEAR OF MIN_CHALLENGE_BOARDS, deliberately. At 10 the
  // challenger sat exactly ON the floor, so a mutation of the floor comparison
  // failed this test as well as the floor test — measured. This test's subject
  // is the boards tiebreak and it has no business being sensitive to the floor
  // constant; raise MIN_CHALLENGE_BOARDS and it would fail with 'void', sending
  // the reader to the wrong place.
  test('equal raw averages fall through to the boards tiebreak', () => {
    const a = { boards: 20, attempts: 80 } // 4.00 exactly
    const b = { boards: 22, attempts: 88 } // 4.00 exactly
    expect(outcomeOf(a, b)).toBe('opponent') // b played more boards
  })

  // THE ROUNDING RULE ITSELF, and it needs raw quotients that genuinely DIFFER.
  // 99/25 = 3.96 and 202/50 = 4.04 both round to 4.0, so after rounding this is
  // a tie and the boards tiebreak gives 'opponent'. A raw-quotient comparison
  // would return 'challenger', since 3.96 < 4.04 — so this is the only test that
  // separates the two behaviours, and the test above does NOT, because its two
  // sides are exactly equal before rounding.
  //
  // WHY IT MATTERS: meanAttemptsOf rounds before comparison on purpose
  // (wordle-teams-iht.3.3) so a free teaser and a paid panel cannot disagree
  // about who is ahead. If that ever regressed, this assertion is what catches it.
  test('averages that DISPLAY the same are compared as the same', () => {
    const a = { boards: 25, attempts: 99 } // 3.96 raw, 4.0 displayed
    const b = { boards: 50, attempts: 202 } // 4.04 raw, 4.0 displayed
    expect(outcomeOf(a, b)).toBe('opponent')
  })
})
```

- [ ] **Step 2: Run it and confirm it fails**

```bash
TZ=UTC pnpm test:once convex/lib/challenge.test.ts > /tmp/t3.txt 2>&1; echo "exit=$?"; tail -20 /tmp/t3.txt
```

Expected: non-zero exit, `outcomeOf is not a function`.

- [ ] **Step 3: Write the implementation**

Append to `convex/lib/challenge.ts`. Note the new import at the top of the file — add `meanAttemptsOf` to the existing import block:

```ts
import { meanAttemptsOf } from './teamStats.ts'
```

Then:

```ts
export type ChallengeOutcome = 'challenger' | 'opponent' | 'tie' | 'void'

/**
 * Who won, on pooled average guesses.
 *
 * LOWER IS BETTER. Guess count is the metric, so the smaller average wins. This
 * is the single easiest thing in the feature to implement backwards, which is
 * why both directions are tested rather than one.
 *
 * ROUNDED BEFORE COMPARISON, via meanAttemptsOf rather than a second rounding of
 * our own. That function's banner (wordle-teams-iht.3.3) has the reason: compare
 * raw quotients and two sides can sit one ten-thousandth apart, rank
 * differently, and DISPLAY the identical average — a scoreboard reading 4.0 to
 * 4.0 with a winner named. Here that case must fall through to the board
 * tiebreak.
 *
 * THE BOARD FLOOR IS CHECKED FIRST, so a side that played almost nothing cannot
 * win on a tiny sample. It is the only small-sample guard; see
 * MIN_CHALLENGE_BOARDS.
 *
 * BOARDS BREAK A TIE, which makes participation the decider without making
 * volume the metric — the right incentive for a feature whose point is
 * engagement.
 */
export function outcomeOf(
  challenger: { readonly boards: number; readonly attempts: number },
  opponent: { readonly boards: number; readonly attempts: number },
): ChallengeOutcome {
  if (challenger.boards < MIN_CHALLENGE_BOARDS) return 'void'
  if (opponent.boards < MIN_CHALLENGE_BOARDS) return 'void'

  // NAMED, NOT `a`/`b`. This doc block says direction is the easiest thing here
  // to implement backwards, and the comparisons below are three lines away — so
  // they should read as the rule without the reader holding a mapping in their
  // head. The repo's `a`/`b` precedent (teamStats.ts's statsEqual) is a
  // SYMMETRIC equality, where transposing is harmless; here it inverts the answer.
  const challengerMean = meanAttemptsOf(challenger)
  const opponentMean = meanAttemptsOf(opponent)
  // UNREACHABLE GIVEN THE FLOOR ABOVE — MIN_CHALLENGE_BOARDS > 0, so neither
  // side can have zero boards here. Kept for totality rather than as a guard, and
  // a mutant deleting it SURVIVES the suite. That is expected, not a hole: the
  // alternative is a non-null assertion that would start lying if the floor ever
  // became 0.
  if (challengerMean === null || opponentMean === null) return 'void'

  if (challengerMean < opponentMean) return 'challenger'
  if (opponentMean < challengerMean) return 'opponent'
  if (challenger.boards > opponent.boards) return 'challenger'
  if (opponent.boards > challenger.boards) return 'opponent'
  return 'tie'
}
```

- [ ] **Step 4: Run it and confirm it passes**

```bash
TZ=UTC pnpm test:once convex/lib/challenge.test.ts > /tmp/t3.txt 2>&1; echo "exit=$?"; tail -20 /tmp/t3.txt
```

Expected: `exit=0`, 26 tests passing (17 from Tasks 1-2 plus 9 here).

- [ ] **Step 5: Run the full gates — this is the first task touching a client-imported module**

```bash
TZ=UTC pnpm test:once > /tmp/g-test.txt 2>&1; echo "test=$?"
pnpm typecheck > /tmp/g-tsc.txt 2>&1; echo "tsc=$?"
pnpm lint > /tmp/g-lint.txt 2>&1; echo "lint=$?"
pnpm build > /tmp/g-build.txt 2>&1; echo "build=$?"
```

Expected: all four `=0`. If any is non-zero, read that file and fix before committing.

- [ ] **Step 6: Commit**

```bash
git add convex/lib/challenge.ts convex/lib/challenge.test.ts
git commit -F - <<'EOF'
feat(zic8.2): outcomeOf - lower average wins, boards break a 1dp tie

Reuses meanAttemptsOf rather than rounding again locally: that function is
declared the single definition of how well a side did, and comparing raw
quotients is how a scoreboard comes to read 4.0 to 4.0 with a winner named.
Board floor checked first so a tiny sample cannot win. Both win directions are
tested because this is the easiest thing here to implement backwards.

<YOUR OWN attribution trailer — see below>
Claude-Session: https://claude.ai/code/session_01J5oECn6C61LEH6aeUMiSA8
EOF
```

---

## Task 4: Schema — `teamChallenges` and `teams.acceptsChallenges`

**bd:** child of `zic8.2`, title "teamChallenges schema".

**Files:**
- Modify: `convex/schema.ts` (add to `teams`, add the new table before `statusMessages`)
- Modify: `convex/schema.test.ts`

- [ ] **Step 1: Write the failing test**

Append to `convex/schema.test.ts` (match the file's existing import style and `convexTest` setup):

```ts
describe('teamChallenges', () => {
  test('a pending challenge needs neither an opponent nor a window', async () => {
    const t = convexTest(schema, modules)
    await t.run(async (ctx) => {
      const teamId = await ctx.db.insert('teams', aTeam({ name: 'challenger' }))
      const playerId = await ctx.db.insert('players', aPlayer())
      const id = await ctx.db.insert('teamChallenges', {
        challengerTeamId: teamId,
        proposedBy: playerId,
        status: 'pending',
        token: 'deadbeefdeadbeefdeadbeefdeadbeef',
        expiresAt: Date.now() + 1000,
        createdAt: Date.now(),
      })
      const doc = await ctx.db.get(id)
      expect(doc?.opponentTeamId).toBeUndefined()
      expect(doc?.startDay).toBeUndefined()
      expect(doc?.result).toBeUndefined()
    })
  })

  test('by_token finds a link proposal', async () => {
    const t = convexTest(schema, modules)
    await t.run(async (ctx) => {
      const teamId = await ctx.db.insert('teams', aTeam())
      const playerId = await ctx.db.insert('players', aPlayer())
      await ctx.db.insert('teamChallenges', {
        challengerTeamId: teamId,
        proposedBy: playerId,
        status: 'pending',
        token: 'feedfacefeedfacefeedfacefeedface',
        expiresAt: Date.now() + 1000,
        createdAt: Date.now(),
      })
      const found = await ctx.db
        .query('teamChallenges')
        .withIndex('by_token', (q) => q.eq('token', 'feedfacefeedfacefeedfacefeedface'))
        .unique()
      expect(found?.status).toBe('pending')
    })
  })

  // WHAT CONVEX-TEST ACTUALLY ENFORCES, measured rather than assumed:
  //   - an UNDECLARED TABLE is ACCEPTED (no validation at all)
  //   - a bad literal in a declared table is REJECTED
  //   - an UNDECLARED FIELD on a declared table is REJECTED
  //
  // That last line is what gives this test force. Asserting that
  // `acceptsChallenges` is merely ABSENT would be vacuous — absence is true both
  // before and after the field is declared, so the test could never fail. SETTING
  // it is the assertion: on a schema without the field, this insert is rejected.
  // A DIRECT PROPOSAL — NO TOKEN. The test above supplies one, which makes it a
  // LINK proposal despite its name; without this, the primary path of Task 5 is
  // never inserted at all. It also pins token's optionality, which nothing else
  // does: widening it to v.string() otherwise leaves every test green.
  test('a direct proposal names its opponent and carries no token', async () => {
    const t = convexTest(schema, modules)
    await t.run(async (ctx) => {
      const challenger = await ctx.db.insert('teams', aTeam({ name: 'ours' }))
      const opponent = await ctx.db.insert('teams', aTeam({ name: 'theirs' }))
      const playerId = await ctx.db.insert('players', aPlayer())
      const id = await ctx.db.insert('teamChallenges', {
        challengerTeamId: challenger,
        opponentTeamId: opponent,
        proposedBy: playerId,
        status: 'pending',
        expiresAt: Date.now() + 1000,
        createdAt: Date.now(),
      })
      const doc = await ctx.db.get(id)
      expect(doc?.token).toBeUndefined()
      expect(doc?.opponentTeamId).toBe(opponent)
    })
  })

  // EVERY STATUS THE LIFECYCLE ALLOWS, round-tripped in a loop — the shape
  // schema.test.ts already uses for membershipStatus. Collapsing the union
  // otherwise survives every other test here.
  test('round-trips every status the challenge lifecycle allows', async () => {
    const statuses = ['pending', 'active', 'declined', 'withdrawn', 'expired', 'closed'] as const
    const t = convexTest(schema, modules)
    await t.run(async (ctx) => {
      const teamId = await ctx.db.insert('teams', aTeam())
      const playerId = await ctx.db.insert('players', aPlayer())
      for (const status of statuses) {
        const id = await ctx.db.insert('teamChallenges', {
          challengerTeamId: teamId,
          proposedBy: playerId,
          status,
          expiresAt: Date.now() + 1000,
          createdAt: Date.now(),
        })
        expect((await ctx.db.get(id))?.status).toBe(status)
      }
    })
  })

  // THE NEGATIVE HALF, AND THE ONE TYPECHECK CANNOT COVER. schema.test.ts
  // already documents this exact failure class for reminderJobId: a union can
  // widen to v.string() "with BOTH typecheck and the test still green", because
  // every value ever written still satisfies the wider validator. A collapsed
  // `status` union would at least break a later task's literal; a widened
  // `result.outcome` would not break anything, ever. convex-test DOES reject a
  // bad literal (measured), so this assertion has real force.
  test('rejects a status outside the union', async () => {
    const t = convexTest(schema, modules)
    await expect(
      t.run(async (ctx) => {
        const teamId = await ctx.db.insert('teams', aTeam())
        const playerId = await ctx.db.insert('players', aPlayer())
        await ctx.db.insert('teamChallenges', {
          challengerTeamId: teamId,
          proposedBy: playerId,
          status: 'paused' as never,
          expiresAt: Date.now(),
          createdAt: Date.now(),
        })
      }),
    ).rejects.toThrow()
  })

  // THE OUTCOME UNION, SEPARATELY FROM status — AND THIS TEST EXISTS BECAUSE THE
  // COMMENT ABOVE ONCE CLAIMED COVERAGE IT DID NOT PROVIDE.
  //
  // The status test's comment named `result.outcome` as the case typecheck can
  // never catch, and then probed only `status` — so the
  // `result.outcome` -> `v.string()` mutant survived the very test set written to
  // kill it, and an implementer had to find that by applying the mutant. Two
  // fields named in a comment need two assertions.
  test('rejects a result outcome outside the union', async () => {
    const t = convexTest(schema, modules)
    await expect(
      t.run(async (ctx) => {
        const challenger = await ctx.db.insert('teams', aTeam({ name: 'ours' }))
        const opponent = await ctx.db.insert('teams', aTeam({ name: 'theirs' }))
        const playerId = await ctx.db.insert('players', aPlayer())
        const side = (teamId: typeof challenger, name: string) => ({
          teamId,
          name,
          boards: 10,
          attempts: 40,
          average: 4,
          members: [],
        })
        await ctx.db.insert('teamChallenges', {
          challengerTeamId: challenger,
          opponentTeamId: opponent,
          proposedBy: playerId,
          status: 'closed',
          expiresAt: Date.now(),
          createdAt: Date.now(),
          result: {
            challenger: side(challenger, 'ours'),
            opponent: side(opponent, 'theirs'),
            outcome: 'draw' as never,
            closedAt: Date.now(),
          },
        })
      }),
    ).rejects.toThrow()
  })

  // THE SNAPSHOT'S SHAPE, which nothing else constructs — the most intricate
  // thing this table adds and the only part with no insert coverage otherwise.
  // Renaming a nested field inside challengeSideValidator survives every other
  // test here. Also the only place an explicit `null` average is exercised.
  test('stores a frozen result, including a null average and an outcome', async () => {
    const t = convexTest(schema, modules)
    await t.run(async (ctx) => {
      const challenger = await ctx.db.insert('teams', aTeam({ name: 'ours' }))
      const opponent = await ctx.db.insert('teams', aTeam({ name: 'theirs' }))
      const playerId = await ctx.db.insert('players', aPlayer())
      const id = await ctx.db.insert('teamChallenges', {
        challengerTeamId: challenger,
        opponentTeamId: opponent,
        proposedBy: playerId,
        status: 'closed',
        expiresAt: Date.now(),
        startDay: '2026-10-05',
        endDay: '2026-10-31',
        createdAt: Date.now(),
        result: {
          challenger: {
            teamId: challenger,
            name: 'ours',
            boards: 12,
            attempts: 42,
            average: 3.5,
            members: [{ playerId, boards: 12, attempts: 42, average: 3.5 }],
          },
          opponent: {
            teamId: opponent,
            name: 'theirs',
            boards: 0,
            attempts: 0,
            average: null,
            members: [],
          },
          outcome: 'void',
          closedAt: Date.now(),
        },
      })
      const doc = await ctx.db.get(id)
      expect(doc?.result?.challenger.average).toBe(3.5)
      expect(doc?.result?.challenger.name).toBe('ours')
      expect(doc?.result?.opponent.average).toBeNull()
      expect(doc?.result?.opponent.members).toEqual([])
      expect(doc?.result?.outcome).toBe('void')
    })
  })

  // THE TWO COMPOUND INDEXES, whose FIELD ORDER is otherwise unpinned here —
  // reversing both to ['status', teamId] survives every other test. A later
  // task's query would fail typecheck against a swapped index, but this file's
  // convention is to pin an index where it is declared (see by_webhookId and
  // by_player_and_puzzleDay). It also demonstrates the two-point-query pattern
  // the table's banner describes, which Task 5 builds on.
  test('the status indexes find a team on either side', async () => {
    const t = convexTest(schema, modules)
    await t.run(async (ctx) => {
      const ours = await ctx.db.insert('teams', aTeam({ name: 'ours' }))
      const theirs = await ctx.db.insert('teams', aTeam({ name: 'theirs' }))
      const playerId = await ctx.db.insert('players', aPlayer())
      const row = (over: Record<string, unknown>) => ({
        challengerTeamId: ours,
        opponentTeamId: theirs,
        proposedBy: playerId,
        status: 'active' as const,
        expiresAt: Date.now() + 1000,
        createdAt: Date.now(),
        ...over,
      })
      await ctx.db.insert('teamChallenges', row({}))
      await ctx.db.insert('teamChallenges', row({ status: 'closed' as const }))

      const activeAsChallenger = await ctx.db
        .query('teamChallenges')
        .withIndex('by_challenger_and_status', (q) =>
          q.eq('challengerTeamId', ours).eq('status', 'active'),
        )
        .collect()
      expect(activeAsChallenger).toHaveLength(1)

      const activeAsOpponent = await ctx.db
        .query('teamChallenges')
        .withIndex('by_opponent_and_status', (q) =>
          q.eq('opponentTeamId', theirs).eq('status', 'active'),
        )
        .collect()
      expect(activeAsOpponent).toHaveLength(1)
    })
  })

  test('acceptsChallenges can be set, and absence means yes', async () => {
    const t = convexTest(schema, modules)
    await t.run(async (ctx) => {
      // Absent by default — the "means yes" half, and the reason no backfill is
      // needed for the 171 existing teams.
      const defaulted = await ctx.db.insert('teams', aTeam())
      expect((await ctx.db.get(defaulted))?.acceptsChallenges).toBeUndefined()

      // Explicitly refused — the half that proves the field is in the schema.
      const refusing = await ctx.db.insert('teams', aTeam({ acceptsChallenges: false }))
      expect((await ctx.db.get(refusing))?.acceptsChallenges).toBe(false)
    })
  })
})
```

- [ ] **Step 2: Run it and confirm it fails**

```bash
TZ=UTC pnpm test:once convex/schema.test.ts > /tmp/t4.txt 2>&1; echo "exit=$?"; tail -20 /tmp/t4.txt
```

Expected: non-zero exit.

**Only the `by_token` test fails at this point, and that is inherent.** `convex-test`
ACCEPTS a write to an undeclared table (measured), so the first test cannot fail before
the table exists — it gains its force afterwards, by proving the optional fields are
genuinely optional, since a required one would be rejected. The third test is written to
fail properly: it SETS `acceptsChallenges`, and an undeclared field IS rejected. Do not
treat "one of three failed" as a problem here.

- [ ] **Step 3: Add the field to `teams`**

In `convex/schema.ts`, inside the `teams` table definition, after `createdAt`:

```ts
    /**
     * WHETHER THIS TEAM ACCEPTS INCOMING CHALLENGES (wordle-teams-zic8.2).
     *
     * OPTIONAL-BY-OMISSION, exactly as inviteLinks.revokedAt and
     * players.onboardingDismissedAt are: ABSENT MEANS YES. That is what lets
     * 171 existing teams need no backfill, and Convex validates this schema
     * against every existing document on push.
     *
     * THE OWNER'S CONTROL, AND IT IS NOT ADVISORY. It is re-checked when a
     * challenge LINK is claimed as well as when a direct proposal is made —
     * see challenges.ts — because a link proposal does not know its opponent at
     * creation, so a check only at propose time would make this bypassable by
     * anyone holding a link.
     */
    acceptsChallenges: v.optional(v.boolean()),
```

- [ ] **Step 4: Add the table**

In `convex/schema.ts`, before `statusMessages`:

```ts
  /**
   * A CHALLENGE BETWEEN TWO TEAMS (wordle-teams-zic8.2).
   *
   * NOT DERIVED DATA, unlike teamMonthStats beside it. A challenge is a social
   * agreement and cannot be recomputed from boards, which is why team deletion
   * CLOSES one rather than deleting it — WIRED IN TASK 11, not here.
   *
   * THAT HEDGE IS NOT PEDANTRY. teams.ts's cascadeDeleteTeam banner records that
   * teamMonthStats was added to the cascade "in the same commit as the table
   * itself, which is the whole lesson of wordle-teams-2c1u — that bug's entire
   * cause was a table added the day AFTER this function was written", leaving
   * every invite link a deleted team ever issued orphaned forever. This is
   * another team-keyed table arriving without the cascade, so the present tense
   * would tell a reader of schema.ts that it is already covered. It is not,
   * until Task 11.
   *
   * TWO STATUS INDEXES RATHER THAN ONE, because a team sits on either side and
   * Convex cannot OR across indexes. "My team's challenges" is two point
   * queries, never a scan. An array field holding both ids would be
   * unindexable — the same limitation this file already records for "teams
   * containing player X".
   */
  teamChallenges: defineTable({
    challengerTeamId: v.id('teams'),

    // ABSENT UNTIL A LINK IS CLAIMED. A direct proposal names its opponent at
    // creation; a link proposal cannot know who will claim it. Absence is
    // meaningful, as with inviteLinks.revokedAt — it means "not yet bound",
    // never "missing".
    opponentTeamId: v.optional(v.id('teams')),

    proposedBy: v.id('players'),

    status: v.union(
      v.literal('pending'),
      v.literal('active'),
      v.literal('declined'),
      v.literal('withdrawn'),
      v.literal('expired'),
      v.literal('closed'),
    ),

    // LINK PROPOSALS ONLY, and THE TOKEN IS THE SECRET AND THE KEY exactly as
    // inviteLinks.token is: it is looked up on a path the claimant reaches
    // before we know which team they act for, so guessability is the only thing
    // standing between a stranger and a challenge. See newToken in
    // challenges.ts, which must stay crypto.getRandomValues.
    //
    // ⚠️ NEVER PROBE by_token WITH A POSSIBLY-UNDEFINED TOKEN. This field is
    // OPTIONAL, unlike inviteLinks.token which is v.string() — so every DIRECT
    // proposal keys on `undefined`, and
    // `withIndex('by_token', q => q.eq('token', undefined)).unique()` would
    // match all of them at once and throw "not unique", a confusing failure a
    // long way from its cause. Guard with `if (!token)` before any lookup.
    token: v.optional(v.string()),

    expiresAt: v.number(), // the PROPOSAL's TTL; see PROPOSAL_TTL_DAYS
    acceptedBy: v.optional(v.id('players')),

    // SET ON ACCEPTANCE, both 'YYYY-MM-DD'. startDay is the day AFTER
    // acceptance; see windowFor.
    startDay: v.optional(v.string()),
    endDay: v.optional(v.string()),

    /**
     * FROZEN AT CLOSE, AND THE FREEZE IS FORCED RATHER THAN CHOSEN.
     * convex/teamStats.ts states that backfill is a free feature — a player can
     * edit a month from last year and the rollup recomputes that exact (team,
     * month) pair on the spot. A closed challenge re-derived from teamMonthStats
     * would therefore silently restate itself whenever anyone edited an old
     * board, turning "we won March" into "we lost March".
     *
     * `average` IS STORED THOUGH IT IS DERIVABLE from boards and attempts. The
     * rounding is display-coupled, so storing it is what makes it impossible for
     * a historical record to disagree with what was shown at the time.
     *
     * NO solved/failed FIELDS, and that is not an omission: the window
     * projection reads days[], where a failure is already folded into attempts
     * as 7 by attemptsFor. Nothing needs a separate failure count.
     */
    result: v.optional(
      v.object({
        challenger: challengeSideValidator,
        opponent: challengeSideValidator,
        outcome: v.union(
          v.literal('challenger'),
          v.literal('opponent'),
          v.literal('tie'),
          v.literal('void'),
        ),
        closedAt: v.number(),
      }),
    ),

    createdAt: v.number(),
  })
    .index('by_token', ['token'])
    .index('by_challenger_and_status', ['challengerTeamId', 'status'])
    .index('by_opponent_and_status', ['opponentTeamId', 'status']),
```

And above `export default defineSchema({`, beside the `membershipStatus` union:

```ts
// One side of a frozen challenge result. Defined out here because the result
// object uses it twice and an inline duplicate is how the two sides drift.
const challengeSideValidator = v.object({
  teamId: v.id('teams'),

  // THE TEAM'S NAME AT CLOSE, AND IT IS THE POINT OF A SNAPSHOT.
  //
  // `average` is stored though derivable because the rounding is
  // display-coupled — a record must not disagree with what was shown. The NAME
  // is display-coupled in exactly the same way and far more visible, so leaving
  // it out would make a rename silently rewrite who every closed challenge was
  // against, which is the precise failure storing `average` exists to prevent.
  //
  // AND IT IS WHAT MAKES DELETION SURVIVABLE. §8.3 closes rather than deletes a
  // challenge "to keep the surviving team's record honest", and Task 11 closes
  // BEFORE removing the team row because closing reads both names. Without this
  // field that care buys nothing: the outcome tally survives and "who was it
  // against" does not. A snapshot is the one shape that cannot be backfilled.
  name: v.string(),

  boards: v.number(),
  attempts: v.number(),
  average: v.union(v.number(), v.null()),
  members: v.array(
    v.object({
      playerId: v.id('players'),
      boards: v.number(),
      attempts: v.number(),
      average: v.union(v.number(), v.null()),
    }),
  ),
})
```

- [ ] **Step 5: Run it and confirm it passes**

```bash
TZ=UTC pnpm test:once convex/schema.test.ts > /tmp/t4.txt 2>&1; echo "exit=$?"; tail -20 /tmp/t4.txt
```

Expected: `exit=0`.

- [ ] **Step 6: Typecheck, because the generated data model changed**

```bash
pnpm typecheck > /tmp/t4-tsc.txt 2>&1; echo "tsc=$?"; tail -20 /tmp/t4-tsc.txt
```

Expected: `tsc=0`.

- [ ] **Step 7: Commit**

```bash
git add convex/schema.ts convex/schema.test.ts
git commit -F - <<'EOF'
feat(zic8.2): teamChallenges table and teams.acceptsChallenges

Two status indexes rather than one because a team sits on either side and Convex
cannot OR across indexes. acceptsChallenges is optional-by-omission so 171
existing teams need no backfill. The result snapshot is forced rather than
chosen: backfill is a free feature in this app, so a re-derived record would
restate itself whenever an old board was edited.

<YOUR OWN attribution trailer — see below>
Claude-Session: https://claude.ai/code/session_01J5oECn6C61LEH6aeUMiSA8
EOF
```

---

## Task 5: Propose to a team you are also on

> ⚠️ **THIS TASK'S CODE BLOCK NO LONGER MATCHES WHAT TASK 5 SHIPPED.** The
> `requireChallengeablePair` listing below was retro-edited to carry the `exceptId`
> parameter, because the adversarial review proved the original would make Task 7's
> `acceptChallengeFor` throw `CHALLENGE_EXISTS` unconditionally. Task 5 is already
> committed WITHOUT it and Task 7 adds it. So do not diff this block against the file
> to audit Task 5 "as built" — you will find a phantom discrepancy.

**bd:** child of `zic8.2`, title "proposeToTeam mutation with limit checks".

**Files:**
- Create: `convex/challenges.ts`
- Create: `convex/challenges.test.ts`

- [ ] **Step 1: Write the failing test**

Create `convex/challenges.test.ts`:

```ts
import { convexTest } from 'convex-test'
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'
import schema from './schema'
import { aPlayer, aTeam } from './fixtures.ts'
import { liveChallengeCountFor, proposeToTeamFor } from './challenges.ts'
import { MAX_ACTIVE_CHALLENGES } from './lib/challenge.ts'
import type { Id } from './_generated/dataModel'
import type { DataModel } from './_generated/dataModel'
import type { GenericDatabaseWriter } from 'convex/server'

/**
 * DRIVEN THROUGH ctx.db RATHER THAN THE PUBLIC MUTATIONS, which need a Better
 * Auth session the harness cannot mint (wordle-teams-obw). The *For helpers hold
 * all the logic for exactly this reason; the public wrappers only supply a
 * player id.
 */
const modules = import.meta.glob('./**/*.ts')
type Ctx = { db: GenericDatabaseWriter<DataModel> }

/**
 * A FROZEN CLOCK, AND EVERY DATE BELOW IS ONLY MEANINGFUL UNDER IT.
 *
 * requirePlausibleToday bounds the accepter's `today` to +/-1 day of the SERVER's
 * day (access.ts, via isPlausibleToday). So a hardcoded '2026-10-04' is
 * INVALID_DATE from 2026-10-06 onward — a suite that breaks BY ITSELF, two days
 * after it was written, with a refusal that looks like a product bug. Measured:
 * at server day 2026-10-06 the bound rejects it.
 *
 * DERIVING THE EXPECTED WINDOW FROM windowFor INSTEAD WOULD BE TAUTOLOGICAL —
 * asserting the implementation against itself. So the clock moves and the
 * expectation stays literal. Same pattern as dashboardBandwidth.test.ts.
 *
 * MUST BE FILE-SCOPED, above every describe, because Task 7's dated tests and
 * Task 5's undated ones share the file.
 */
const NOW = new Date('2026-10-04T12:00:00Z')
const today = '2026-10-04'

/**
 * SCOPED TO THE DATED DESCRIBES, NOT THE FILE — matching
 * dashboardBandwidth.test.ts, teamStats.test.ts and reminders.test.ts, which all
 * combine fake timers with convexTest but put the hooks inside the describe that
 * needs them. Task 5's 15 tests in this file need no frozen clock, and freezing
 * it for them would be 15 tests' worth of risk for no benefit.
 *
 * Paste this pair INSIDE each describe that passes `today` — that is
 * `acceptChallengeFor` and `claimChallengeLinkFor`:
 *
 *   beforeEach(() => {
 *     vi.useFakeTimers()
 *     vi.setSystemTime(NOW)
 *   })
 *   afterEach(() => {
 *     vi.useRealTimers()
 *   })
 */

/** A player on two teams, Pro by default. */
async function seedTwoTeams(ctx: Ctx, { pro = true } = {}) {
  const playerId = await ctx.db.insert('players', aPlayer())
  if (pro) {
    await ctx.db.insert('playerMembership', { playerId, membershipStatus: 'pro' })
  }
  const challengerTeamId = await ctx.db.insert(
    'teams',
    aTeam({ name: 'Challengers', playerIds: [playerId], owner: playerId }),
  )
  const opponentTeamId = await ctx.db.insert(
    'teams',
    aTeam({ legacyId: 207, name: 'Opponents', playerIds: [playerId], owner: playerId }),
  )
  return { playerId, challengerTeamId, opponentTeamId }
}

describe('proposeToTeamFor', () => {
  test('a Pro member on both teams creates a pending challenge', async () => {
    const t = convexTest(schema, modules)
    await t.run(async (ctx) => {
      const { playerId, challengerTeamId, opponentTeamId } = await seedTwoTeams(ctx)
      const id = await proposeToTeamFor(ctx, playerId, challengerTeamId, opponentTeamId)
      const doc = await ctx.db.get(id)
      expect(doc?.status).toBe('pending')
      expect(doc?.opponentTeamId).toBe(opponentTeamId)
      expect(doc?.token).toBeUndefined()
    })
  })

  test('a non-Pro member is refused', async () => {
    const t = convexTest(schema, modules)
    await t.run(async (ctx) => {
      const { playerId, challengerTeamId, opponentTeamId } = await seedTwoTeams(ctx, { pro: false })
      await expect(
        proposeToTeamFor(ctx, playerId, challengerTeamId, opponentTeamId),
      ).rejects.toThrow()
    })
  })

  test('a team cannot challenge itself', async () => {
    const t = convexTest(schema, modules)
    await t.run(async (ctx) => {
      const { playerId, challengerTeamId } = await seedTwoTeams(ctx)
      await expect(
        proposeToTeamFor(ctx, playerId, challengerTeamId, challengerTeamId),
      ).rejects.toThrow()
    })
  })

  test('an opponent refusing incoming challenges is refused', async () => {
    const t = convexTest(schema, modules)
    await t.run(async (ctx) => {
      const { playerId, challengerTeamId, opponentTeamId } = await seedTwoTeams(ctx)
      await ctx.db.patch(opponentTeamId, { acceptsChallenges: false })
      await expect(
        proposeToTeamFor(ctx, playerId, challengerTeamId, opponentTeamId),
      ).rejects.toThrow()
    })
  })

  test('a second active challenge against the SAME opponent is refused', async () => {
    const t = convexTest(schema, modules)
    await t.run(async (ctx) => {
      const { playerId, challengerTeamId, opponentTeamId } = await seedTwoTeams(ctx)
      const id = await proposeToTeamFor(ctx, playerId, challengerTeamId, opponentTeamId)
      await ctx.db.patch(id, { status: 'active', startDay: '2026-10-05', endDay: '2026-10-31' })
      await expect(
        proposeToTeamFor(ctx, playerId, challengerTeamId, opponentTeamId),
      ).rejects.toThrow()
    })
  })

  test('the pair rule also catches the REVERSE direction', async () => {
    const t = convexTest(schema, modules)
    await t.run(async (ctx) => {
      const { playerId, challengerTeamId, opponentTeamId } = await seedTwoTeams(ctx)
      await ctx.db.insert('teamChallenges', {
        challengerTeamId: opponentTeamId,
        opponentTeamId: challengerTeamId,
        proposedBy: playerId,
        status: 'active',
        expiresAt: Date.now() + 1000,
        startDay: '2026-10-05',
        endDay: '2026-10-31',
        createdAt: Date.now(),
      })
      await expect(
        proposeToTeamFor(ctx, playerId, challengerTeamId, opponentTeamId),
      ).rejects.toThrow()
    })
  })

  test('at MAX_ACTIVE_CHALLENGES the challenger is refused', async () => {
    const t = convexTest(schema, modules)
    await t.run(async (ctx) => {
      const { playerId, challengerTeamId, opponentTeamId } = await seedTwoTeams(ctx)
      for (let i = 0; i < MAX_ACTIVE_CHALLENGES; i++) {
        const otherId = await ctx.db.insert(
          'teams',
          aTeam({ legacyId: 300 + i, name: `other ${i}`, playerIds: [playerId] }),
        )
        await ctx.db.insert('teamChallenges', {
          challengerTeamId,
          opponentTeamId: otherId,
          proposedBy: playerId,
          status: 'active',
          expiresAt: Date.now() + 1000,
          startDay: '2026-10-05',
          endDay: '2026-10-31',
          createdAt: Date.now(),
        })
      }
      await expect(
        proposeToTeamFor(ctx, playerId, challengerTeamId, opponentTeamId),
      ).rejects.toThrow()
    })
  })

  test('one BELOW the cap is allowed — the boundary tested in both directions', async () => {
    const t = convexTest(schema, modules)
    await t.run(async (ctx) => {
      const { playerId, challengerTeamId, opponentTeamId } = await seedTwoTeams(ctx)
      for (let i = 0; i < MAX_ACTIVE_CHALLENGES - 1; i++) {
        const otherId = await ctx.db.insert(
          'teams',
          aTeam({ legacyId: 400 + i, name: `other ${i}`, playerIds: [playerId] }),
        )
        await ctx.db.insert('teamChallenges', {
          challengerTeamId,
          opponentTeamId: otherId,
          proposedBy: playerId,
          status: 'active',
          expiresAt: Date.now() + 1000,
          startDay: '2026-10-05',
          endDay: '2026-10-31',
          createdAt: Date.now(),
        })
      }
      await expect(
        proposeToTeamFor(ctx, playerId, challengerTeamId, opponentTeamId),
      ).resolves.toBeDefined()
    })
  })

  test('counts a team on EITHER side toward its own cap', async () => {
    const t = convexTest(schema, modules)
    await t.run(async (ctx) => {
      const { playerId, challengerTeamId } = await seedTwoTeams(ctx)
      const otherId = await ctx.db.insert('teams', aTeam({ legacyId: 500, name: 'other' }))
      await ctx.db.insert('teamChallenges', {
        challengerTeamId: otherId,
        opponentTeamId: challengerTeamId,
        proposedBy: playerId,
        status: 'active',
        expiresAt: Date.now() + 1000,
        startDay: '2026-10-05',
        endDay: '2026-10-31',
        createdAt: Date.now(),
      })
      expect(await liveChallengeCountFor(ctx, challengerTeamId)).toBe(1)
    })
  })

  test('a closed challenge does not count toward the cap', async () => {
    const t = convexTest(schema, modules)
    await t.run(async (ctx) => {
      const { playerId, challengerTeamId, opponentTeamId } = await seedTwoTeams(ctx)
      const id = await proposeToTeamFor(ctx, playerId, challengerTeamId, opponentTeamId)
      await ctx.db.patch(id, { status: 'closed' })
      expect(await liveChallengeCountFor(ctx, challengerTeamId)).toBe(0)
    })
  })
})
```

- [ ] **Step 2: Run it and confirm it fails**

```bash
TZ=UTC pnpm test:once convex/challenges.test.ts > /tmp/t5.txt 2>&1; echo "exit=$?"; tail -20 /tmp/t5.txt
```

Expected: non-zero exit, unresolved `./challenges.ts`.

- [ ] **Step 3: Write the implementation**

Create `convex/challenges.ts`:

```ts
import { v } from 'convex/values'
import { mutation } from './_generated/server'
import { accessError, isProFor, requirePlayer, requireTeamMemberFor } from './access.ts'
import { MAX_ACTIVE_CHALLENGES, PROPOSAL_TTL_DAYS } from './lib/challenge.ts'
import type { Doc, Id, DataModel } from './_generated/dataModel'
import type { GenericDatabaseWriter, GenericDatabaseReader } from 'convex/server'

/**
 * TEAM-VERSUS-TEAM CHALLENGES (wordle-teams-zic8.2).
 *
 * THE LOGIC LIVES IN THE `*For` HELPERS, NOT IN THE WRAPPERS, for the reason
 * lib/insightsAccess.ts gives: nothing in this repo can drive an authed Convex
 * wrapper (wordle-teams-obw), so a rule inside a `mutation({...})` is a rule no
 * test can execute. Every wrapper below is two lines — resolve the player, call
 * the helper.
 *
 * REFUSALS GO THROUGH accessError, never a bare `throw new Error`. A plain Error
 * message is REDACTED in production while convex-test never redacts, so a plain
 * throw is a message no test can see go missing.
 */

type WriterCtx = { db: GenericDatabaseWriter<DataModel> }
type ReaderCtx = { db: GenericDatabaseReader<DataModel> }

const TTL_MS = PROPOSAL_TTL_DAYS * 24 * 60 * 60 * 1000

/** Statuses that occupy a slot against MAX_ACTIVE_CHALLENGES. */
const LIVE_STATUSES = ['pending', 'active'] as const

/**
 * Every live challenge this team is part of, on EITHER side.
 *
 * TWO QUERIES BECAUSE THERE ARE TWO INDEXES, and that is the schema's decision
 * rather than this function's: Convex cannot OR across indexes, and an array of
 * both ids would be unindexable. Four point lookups beats any scan.
 */
export async function liveChallengesFor(
  ctx: ReaderCtx,
  teamId: Id<'teams'>,
): Promise<Array<Doc<'teamChallenges'>>> {
  const found: Array<Doc<'teamChallenges'>> = []
  for (const status of LIVE_STATUSES) {
    found.push(
      ...(await ctx.db
        .query('teamChallenges')
        .withIndex('by_challenger_and_status', (q) =>
          q.eq('challengerTeamId', teamId).eq('status', status),
        )
        .collect()),
      ...(await ctx.db
        .query('teamChallenges')
        .withIndex('by_opponent_and_status', (q) =>
          q.eq('opponentTeamId', teamId).eq('status', status),
        )
        .collect()),
    )
  }
  return found
}

/**
 * How many slots this team currently occupies against MAX_ACTIVE_CHALLENGES.
 *
 * COUNTS 'pending' AND 'active', which is why it is named "live" rather than
 * "active". A pending proposal must occupy a slot: otherwise a team could hold
 * five running challenges and an unbounded pile of outstanding proposals, and
 * the cap would bound nothing that matters. The constant keeps its name because
 * it is the user-facing idea; this function is honest about the set it counts.
 */
export async function liveChallengeCountFor(
  ctx: ReaderCtx,
  teamId: Id<'teams'>,
): Promise<number> {
  return (await liveChallengesFor(ctx, teamId)).length
}

/**
 * The four checks a challenge between a KNOWN pair must pass.
 *
 * SHARED BY PROPOSE AND BY ACCEPT, AND THAT SHARING IS THE POINT (design §8.1).
 * A link proposal has no opponent at creation, so these cannot all run at
 * propose time; running them only there would make a link a bypass for every
 * limit an owner set. One function, called from both places, is what keeps the
 * two paths from drifting.
 */
export async function requireChallengeablePair(
  ctx: ReaderCtx,
  challengerTeamId: Id<'teams'>,
  opponentTeamId: Id<'teams'>,
  exceptId?: Id<'teamChallenges'>,
): Promise<void> {
  if (challengerTeamId === opponentTeamId) throw accessError('INVALID_TEAM')

  const opponent = await ctx.db.get(opponentTeamId)
  if (opponent === null) throw accessError('INVALID_TEAM')
  // ABSENT MEANS YES. Only an explicit false refuses.
  if (opponent.acceptsChallenges === false) throw accessError('CHALLENGES_REFUSED')

  // EXCLUDE THE CHALLENGE IN FLIGHT. On the accept and claim paths the row being
  // brought to life is ITSELF 'pending', so liveChallengesFor returns it for both
  // teams. Measured: without this, requireChallengeablePair hands back
  // CHALLENGE_EXISTS for the very challenge being accepted, and
  // acceptChallengeFor can NEVER succeed. The caps are off by one for the same
  // reason, so a proposal made in a team's last free slot could never be
  // activated — a bug no prescribed test could see. Propose passes nothing,
  // because there is no row yet.
  const challengerLive = (await liveChallengesFor(ctx, challengerTeamId)).filter(
    (c) => c._id !== exceptId,
  )
  const opponentLive = (await liveChallengesFor(ctx, opponentTeamId)).filter(
    (c) => c._id !== exceptId,
  )
  if (challengerLive.length >= MAX_ACTIVE_CHALLENGES) throw accessError('CHALLENGE_LIMIT_REACHED')
  if (opponentLive.length >= MAX_ACTIVE_CHALLENGES) throw accessError('CHALLENGE_LIMIT_REACHED')

  // ONE LIVE CHALLENGE PER UNORDERED PAIR. Checked in both directions, because
  // either team may have been the proposer.
  const existing = challengerLive.find(
    (c) =>
      c.opponentTeamId === opponentTeamId ||
      (c.challengerTeamId === opponentTeamId && c.opponentTeamId === challengerTeamId),
  )
  if (existing !== undefined) throw accessError('CHALLENGE_EXISTS')
}

/**
 * Propose a challenge to a team the caller is also a member of.
 *
 * PRO IS REQUIRED TO INITIATE and deliberately NOT to accept. Gating acceptance
 * would make reach the square of Pro penetration and hide the feature from every
 * free team — and a challenged free team is this feature's best conversion
 * moment, since wordle-teams-0hx established that this product's
 * differentiators are discovered after arrival rather than searched for.
 */
export async function proposeToTeamFor(
  ctx: WriterCtx,
  playerId: Id<'players'>,
  challengerTeamId: Id<'teams'>,
  opponentTeamId: Id<'teams'>,
): Promise<Id<'teamChallenges'>> {
  await requireTeamMemberFor(ctx, playerId, challengerTeamId)
  if (!(await isProFor(ctx, playerId))) throw accessError('PRO_REQUIRED')

  // THE DUAL-MEMBERSHIP ENTRY POINT: you may name a team you are on. Naming a
  // team you are NOT on is the searchable-directory feature, which is out of
  // scope — the link path is how you reach a team you do not belong to.
  await requireTeamMemberFor(ctx, playerId, opponentTeamId)

  await requireChallengeablePair(ctx, challengerTeamId, opponentTeamId)

  return await ctx.db.insert('teamChallenges', {
    challengerTeamId,
    opponentTeamId,
    proposedBy: playerId,
    status: 'pending',
    expiresAt: Date.now() + TTL_MS,
    createdAt: Date.now(),
  })
}

export const proposeToTeam = mutation({
  args: { challengerTeamId: v.id('teams'), opponentTeamId: v.id('teams') },
  handler: async (ctx, { challengerTeamId, opponentTeamId }) => {
    const player = await requirePlayer(ctx)
    return await proposeToTeamFor(ctx, player._id, challengerTeamId, opponentTeamId)
  },
})
```

- [ ] **Step 4: Add the four new access codes**

In `convex/access.ts`, add to the `AccessCode` union, after `'INVALID_PUZZLE_DAY'`:

```ts
  // wordle-teams-zic8.2. CHALLENGES_REFUSED is the owner's acceptsChallenges
  // switch; CHALLENGE_LIMIT_REACHED is MAX_ACTIVE_CHALLENGES; CHALLENGE_EXISTS
  // is the one-live-challenge-per-pair rule; PRO_REQUIRED gates INITIATING a
  // challenge and never accepting one.
  | 'CHALLENGES_REFUSED'
  | 'CHALLENGE_LIMIT_REACHED'
  | 'CHALLENGE_EXISTS'
  | 'PRO_REQUIRED'
```

- [ ] **Step 5: Run it and confirm it passes**

```bash
TZ=UTC pnpm test:once convex/challenges.test.ts > /tmp/t5.txt 2>&1; echo "exit=$?"; tail -30 /tmp/t5.txt
```

Expected: `exit=0`, 10 tests passing.

- [ ] **Step 6: Commit**

```bash
git add convex/challenges.ts convex/challenges.test.ts convex/access.ts
git commit -F - <<'EOF'
feat(zic8.2): proposeToTeam, with the pair checks factored for reuse

requireChallengeablePair holds the four limits a known pair must pass and is
shared with the accept path on purpose (design 8.1): a link proposal has no
opponent at creation, so checking only at propose time would make a link a
bypass for every limit an owner set.

Pro gates INITIATING and deliberately not accepting - gating acceptance would
make reach the square of Pro penetration and hide the feature from the free
teams that are its best conversion moment.

<YOUR OWN attribution trailer — see below>
Claude-Session: https://claude.ai/code/session_01J5oECn6C61LEH6aeUMiSA8
EOF
```

---

## Task 6: Propose by link

**bd:** child of `zic8.2`, title "proposeByLink and the token".

**Files:**
- Modify: `convex/challenges.ts`
- Modify: `convex/challenges.test.ts`

- [ ] **Step 1: Write the failing test**

Append to `convex/challenges.test.ts`:

```ts
import { proposeByLinkFor } from './challenges.ts'

describe('proposeByLinkFor', () => {
  test('a Pro member gets a token and no opponent', async () => {
    const t = convexTest(schema, modules)
    await t.run(async (ctx) => {
      const { playerId, challengerTeamId } = await seedTwoTeams(ctx)
      const token = await proposeByLinkFor(ctx, playerId, challengerTeamId)
      const doc = await ctx.db
        .query('teamChallenges')
        .withIndex('by_token', (q) => q.eq('token', token))
        .unique()
      expect(doc?.status).toBe('pending')
      expect(doc?.opponentTeamId).toBeUndefined()
    })
  })

  test('a non-Pro member is refused', async () => {
    const t = convexTest(schema, modules)
    await t.run(async (ctx) => {
      const { playerId, challengerTeamId } = await seedTwoTeams(ctx, { pro: false })
      await expect(proposeByLinkFor(ctx, playerId, challengerTeamId)).rejects.toMatchObject({
        data: { code: 'PRO_REQUIRED' },
      })
    })
  })

  // PROVES THE CALL RUNS IN THIS RUNTIME; it does NOT prove unguessability — a
  // counter would satisfy this too. The source of the bytes is a code-review
  // obligation. Same note as inviteLinks' newToken.
  // EACH ROW IS WITHDRAWN BEFORE THE NEXT DRAW. proposeByLinkFor counts
  // 'pending' against MAX_ACTIVE_CHALLENGES, which is 5 — so an unguarded
  // 25-iteration loop throws CHALLENGE_LIMIT_REACHED at i = 5. Measured against
  // the real function, which is already on disk.
  //
  // THE SHAPE ASSERTION IS NOT DECORATION: 32 hex chars is the 16 bytes newToken
  // draws. Without it the suite cannot tell Uint8Array(16) from Uint8Array(2) —
  // 25 draws from 65536 collide only about 0.5% of the time, so the set-size
  // assertion alone survives that mutant.
  test('two tokens never collide', async () => {
    const t = convexTest(schema, modules)
    await t.run(async (ctx) => {
      const { playerId, challengerTeamId } = await seedTwoTeams(ctx)
      const tokens = new Set<string>()
      for (let i = 0; i < 25; i++) {
        const token = await proposeByLinkFor(ctx, playerId, challengerTeamId)
        tokens.add(token)
        expect(token).toMatch(/^[0-9a-f]{32}$/)
        const doc = await ctx.db
          .query('teamChallenges')
          .withIndex('by_token', (q) => q.eq('token', token))
          .unique()
        if (doc !== null) await ctx.db.patch(doc._id, { status: 'withdrawn' })
      }
      expect(tokens.size).toBe(25)
    })
  })

  test('the challenger cap still applies to link proposals', async () => {
    const t = convexTest(schema, modules)
    await t.run(async (ctx) => {
      const { playerId, challengerTeamId } = await seedTwoTeams(ctx)
      for (let i = 0; i < MAX_ACTIVE_CHALLENGES; i++) {
        await ctx.db.insert('teamChallenges', {
          challengerTeamId,
          proposedBy: playerId,
          status: 'pending',
          token: `token-${i}`,
          expiresAt: Date.now() + 1000,
          createdAt: Date.now(),
        })
      }
      await expect(proposeByLinkFor(ctx, playerId, challengerTeamId)).rejects.toMatchObject({
        data: { code: 'CHALLENGE_LIMIT_REACHED' },
      })
    })
  })
})
```

- [ ] **Step 2: Run it and confirm it fails**

```bash
TZ=UTC pnpm test:once convex/challenges.test.ts > /tmp/t6.txt 2>&1; echo "exit=$?"; tail -20 /tmp/t6.txt
```

Expected: non-zero exit, `proposeByLinkFor is not a function`.

- [ ] **Step 3: Write the implementation**

Append to `convex/challenges.ts`:

```ts
/**
 * An opaque, unguessable challenge token.
 *
 * THIS IS A CAPABILITY, NOT AN IDENTIFIER: anyone holding it can put one of
 * their own teams into a challenge, which is the whole difference between a link
 * and naming a team you are already on. It is looked up on a path reachable
 * before we know which team the holder acts for.
 *
 * crypto.getRandomValues, NOT Math.random. The "two tokens never collide" test
 * proves this call runs in this runtime; it does NOT prove unguessability, since
 * a counter would satisfy it just as well. If this line ever stops being
 * getRandomValues, no test will tell you — it is a code-review obligation, the
 * same one inviteLinks' newToken carries.
 */
function newToken(): string {
  const bytes = new Uint8Array(16)
  crypto.getRandomValues(bytes)
  return Array.from(bytes, (byte) => byte.toString(16).padStart(2, '0')).join('')
}

/**
 * Propose a challenge to whoever holds the link.
 *
 * THE OPPONENT IS UNKNOWN HERE, so only the checks that do not need one run:
 * membership, Pro, and the challenger's own cap. The pair checks run at claim
 * time instead — see claimChallengeLinkFor and design §8.1.
 *
 * WHY A LINK AT ALL: "someone you know on the other team" is a social fact the
 * app does not hold, and it has no friend graph outside team rosters. A link
 * leaves that fact where it actually lives — in whatever channel the friendship
 * already uses — rather than building a directory to approximate it.
 */
export async function proposeByLinkFor(
  ctx: WriterCtx,
  playerId: Id<'players'>,
  challengerTeamId: Id<'teams'>,
): Promise<string> {
  await requireTeamMemberFor(ctx, playerId, challengerTeamId)
  if (!(await isProFor(ctx, playerId))) throw accessError('PRO_REQUIRED')
  if ((await liveChallengeCountFor(ctx, challengerTeamId)) >= MAX_ACTIVE_CHALLENGES) {
    throw accessError('CHALLENGE_LIMIT_REACHED')
  }

  const token = newToken()
  await ctx.db.insert('teamChallenges', {
    challengerTeamId,
    proposedBy: playerId,
    status: 'pending',
    token,
    expiresAt: Date.now() + TTL_MS,
    createdAt: Date.now(),
  })
  return token
}

export const proposeByLink = mutation({
  args: { challengerTeamId: v.id('teams') },
  handler: async (ctx, { challengerTeamId }) => {
    const player = await requirePlayer(ctx)
    return await proposeByLinkFor(ctx, player._id, challengerTeamId)
  },
})
```

- [ ] **Step 4: Run it and confirm it passes**

```bash
TZ=UTC pnpm test:once convex/challenges.test.ts > /tmp/t6.txt 2>&1; echo "exit=$?"; tail -20 /tmp/t6.txt
```

Expected: `exit=0`, **19** tests in `convex/challenges.test.ts` and **4122** in the full suite. (Recomputed: the plan's original chain assumed 10 after Task 5, and the real baseline was 15.)

- [ ] **Step 5: Commit**

```bash
git add convex/challenges.ts convex/challenges.test.ts
git commit -F - <<'EOF'
feat(zic8.2): proposeByLink - a tokenised challenge for someone you know

"Someone you know on the other team" is a social fact the app does not hold and
has no friend graph for. A link leaves that fact in whatever channel the
friendship already uses rather than building a directory to approximate it.

Only the checks that need no opponent run here; the pair checks run at claim
time (design 8.1). Token is crypto.getRandomValues, and the collision test
proves the call runs in this runtime without proving unguessability.

<YOUR OWN attribution trailer — see below>
Claude-Session: https://claude.ai/code/session_01J5oECn6C61LEH6aeUMiSA8
EOF
```

---

## Task 7: Accept, claim, and the window

**bd:** child of `zic8.2`, title "acceptChallenge and claimChallengeLink".

**Files:**
- Modify: `convex/challenges.ts` — **and note this task EDITS `requireChallengeablePair`,
  which Task 5 already wrote to disk. It is not purely an append.**
- Modify: `convex/challenges.test.ts` — **also not purely an append: the frozen-clock
  block below must go at FILE scope, above Task 5's describe.**
- Modify: `convex/access.ts`
- Modify: `src/lib/convex-error.ts` — **both halves**, see Step 4

- [ ] **Step 1: Write the failing test**

Append to `convex/challenges.test.ts`:

```ts
import { acceptChallengeFor, claimChallengeLinkFor } from './challenges.ts'

/**
 * A second player on a third team, to accept as somebody else.
 *
 * ⚠️ THE EMAIL OVERRIDE IS LOAD-BEARING, NOT COSMETIC. aPlayer()'s default email
 * is 'member@example.com', and access.ts's playerForEmail resolves by_email with
 * `.first()` — so two players rows sharing that address make requirePlayer
 * silently resolve to whichever Convex returns first. Every extra player seeded
 * in this file MUST override `email`.
 */
async function seedAccepter(ctx: Ctx) {
  const accepterId = await ctx.db.insert('players', aPlayer({ email: 'accepter@example.com' }))
  const theirTeamId = await ctx.db.insert(
    'teams',
    aTeam({ legacyId: 600, name: 'Theirs', playerIds: [accepterId], owner: accepterId }),
  )
  return { accepterId, theirTeamId }
}

describe('acceptChallengeFor', () => {
  test('any member of the opponent team may accept, with no Pro', async () => {
    const t = convexTest(schema, modules)
    await t.run(async (ctx) => {
      const { playerId, challengerTeamId } = await seedTwoTeams(ctx)
      const { accepterId, theirTeamId } = await seedAccepter(ctx)
      const id = await ctx.db.insert('teamChallenges', {
        challengerTeamId,
        opponentTeamId: theirTeamId,
        proposedBy: playerId,
        status: 'pending',
        expiresAt: Date.now() + TTL,
        createdAt: Date.now(),
      })

      await acceptChallengeFor(ctx, accepterId, id, today)

      const doc = await ctx.db.get(id)
      expect(doc?.status).toBe('active')
      expect(doc?.acceptedBy).toBe(accepterId)
      expect(doc?.startDay).toBe('2026-10-05')
      expect(doc?.endDay).toBe('2026-10-31')
    })
  })

  test('a non-member of the opponent team may not accept', async () => {
    const t = convexTest(schema, modules)
    await t.run(async (ctx) => {
      const { playerId, challengerTeamId } = await seedTwoTeams(ctx)
      const { theirTeamId } = await seedAccepter(ctx)
      const id = await ctx.db.insert('teamChallenges', {
        challengerTeamId,
        opponentTeamId: theirTeamId,
        proposedBy: playerId,
        status: 'pending',
        expiresAt: Date.now() + TTL,
        createdAt: Date.now(),
      })
      await expect(acceptChallengeFor(ctx, playerId, id, today)).rejects.toMatchObject({
        data: { code: 'NOT_A_MEMBER' },
      })
    })
  })

  // A DECLINED PROPOSAL, which the status guard catches but nothing seeded. The
  // suite otherwise never writes 'declined' or 'expired' at all, so guard 1's
  // coverage was one status out of the five it refuses.
  test('a declined challenge may not be accepted', async () => {
    const t = convexTest(schema, modules)
    await t.run(async (ctx) => {
      const { playerId, challengerTeamId } = await seedTwoTeams(ctx)
      const { accepterId, theirTeamId } = await seedAccepter(ctx)
      const id = await ctx.db.insert('teamChallenges', {
        challengerTeamId,
        opponentTeamId: theirTeamId,
        proposedBy: playerId,
        status: 'declined',
        expiresAt: Date.now() + TTL,
        createdAt: Date.now(),
      })
      await expect(acceptChallengeFor(ctx, accepterId, id, today)).rejects.toMatchObject({
        data: { code: 'CHALLENGE_NOT_PENDING' },
      })
    })
  })

  test('an expired proposal may not be accepted', async () => {
    const t = convexTest(schema, modules)
    await t.run(async (ctx) => {
      const { playerId, challengerTeamId } = await seedTwoTeams(ctx)
      const { accepterId, theirTeamId } = await seedAccepter(ctx)
      const id = await ctx.db.insert('teamChallenges', {
        challengerTeamId,
        opponentTeamId: theirTeamId,
        proposedBy: playerId,
        status: 'pending',
        expiresAt: Date.now() - 1,
        createdAt: Date.now(),
      })
      await expect(acceptChallengeFor(ctx, accepterId, id, today)).rejects.toMatchObject({
        data: { code: 'CHALLENGE_NOT_PENDING' },
      })
    })
  })

  // THE OFF-BY-ONE THAT NO PRESCRIBED TEST COULD SEE. The pending row being
  // accepted is itself counted by liveChallengeCountFor, so without `exceptId`
  // a proposal made in a team's FIFTH and last slot could never be activated —
  // it would be permanently pending. MAX - 1 others plus this one is exactly MAX.
  test('the proposal being accepted does not count ITSELF against either cap', async () => {
    const t = convexTest(schema, modules)
    await t.run(async (ctx) => {
      const { playerId, challengerTeamId } = await seedTwoTeams(ctx)
      const { accepterId, theirTeamId } = await seedAccepter(ctx)
      for (let i = 0; i < MAX_ACTIVE_CHALLENGES - 1; i++) {
        const otherId = await ctx.db.insert(
          'teams',
          aTeam({ legacyId: 900 + i, name: `c${i}` }),
        )
        await ctx.db.insert('teamChallenges', {
          challengerTeamId,
          opponentTeamId: otherId,
          proposedBy: playerId,
          status: 'active',
          expiresAt: Date.now() + TTL,
          startDay: '2026-10-05',
          endDay: '2026-10-31',
          createdAt: Date.now(),
        })
      }
      const id = await ctx.db.insert('teamChallenges', {
        challengerTeamId,
        opponentTeamId: theirTeamId,
        proposedBy: playerId,
        status: 'pending',
        expiresAt: Date.now() + TTL,
        createdAt: Date.now(),
      })
      await acceptChallengeFor(ctx, accepterId, id, today)
      expect((await ctx.db.get(id))?.status).toBe('active')
    })
  })

  // THE opponentTeamId GUARD. Without it requireTeamMemberFor is handed
  // undefined and ctx.db.get(undefined) is what the caller sees instead.
  test('a link proposal cannot be accepted through the direct path', async () => {
    const t = convexTest(schema, modules)
    await t.run(async (ctx) => {
      const { playerId, challengerTeamId } = await seedTwoTeams(ctx)
      const { accepterId } = await seedAccepter(ctx)
      const token = await proposeByLinkFor(ctx, playerId, challengerTeamId)
      const doc = await ctx.db
        .query('teamChallenges')
        .withIndex('by_token', (q) => q.eq('token', token))
        .unique()
      await expect(
        acceptChallengeFor(ctx, accepterId, doc!._id, today),
      ).rejects.toMatchObject({ data: { code: 'INVALID_TEAM' } })
    })
  })

  test('an already-active challenge may not be accepted again', async () => {
    const t = convexTest(schema, modules)
    await t.run(async (ctx) => {
      const { playerId, challengerTeamId } = await seedTwoTeams(ctx)
      const { accepterId, theirTeamId } = await seedAccepter(ctx)
      const id = await ctx.db.insert('teamChallenges', {
        challengerTeamId,
        opponentTeamId: theirTeamId,
        proposedBy: playerId,
        status: 'active',
        startDay: '2026-10-05',
        endDay: '2026-10-31',
        expiresAt: Date.now() + TTL,
        createdAt: Date.now(),
      })
      await expect(acceptChallengeFor(ctx, accepterId, id, today)).rejects.toMatchObject({
        data: { code: 'CHALLENGE_NOT_PENDING' },
      })
    })
  })
})

describe('claimChallengeLinkFor', () => {
  test('binds the opponent and activates', async () => {
    const t = convexTest(schema, modules)
    await t.run(async (ctx) => {
      const { playerId, challengerTeamId } = await seedTwoTeams(ctx)
      const { accepterId, theirTeamId } = await seedAccepter(ctx)
      const token = await proposeByLinkFor(ctx, playerId, challengerTeamId)

      const id = await claimChallengeLinkFor(ctx, accepterId, token, theirTeamId, today)

      const doc = await ctx.db.get(id)
      expect(doc?.status).toBe('active')
      expect(doc?.opponentTeamId).toBe(theirTeamId)
      expect(doc?.startDay).toBe('2026-10-05')
    })
  })

  test('an unknown token is refused', async () => {
    const t = convexTest(schema, modules)
    await t.run(async (ctx) => {
      const { accepterId, theirTeamId } = await seedAccepter(ctx)
      await expect(
        claimChallengeLinkFor(ctx, accepterId, 'nope', theirTeamId, today),
      ).rejects.toMatchObject({
        data: { code: 'CHALLENGE_LINK_INVALID' },
      })
    })
  })

  // DESIGN §8.1 — THE BYPASS THAT MUST NOT EXIST.
  test('a link CANNOT bypass the claiming team refusing challenges', async () => {
    const t = convexTest(schema, modules)
    await t.run(async (ctx) => {
      const { playerId, challengerTeamId } = await seedTwoTeams(ctx)
      const { accepterId, theirTeamId } = await seedAccepter(ctx)
      await ctx.db.patch(theirTeamId, { acceptsChallenges: false })
      const token = await proposeByLinkFor(ctx, playerId, challengerTeamId)
      await expect(
        claimChallengeLinkFor(ctx, accepterId, token, theirTeamId, today),
      ).rejects.toMatchObject({
        data: { code: 'CHALLENGES_REFUSED' },
      })
    })
  })

  test('a link CANNOT bypass the claiming team being at its cap', async () => {
    const t = convexTest(schema, modules)
    await t.run(async (ctx) => {
      const { playerId, challengerTeamId } = await seedTwoTeams(ctx)
      const { accepterId, theirTeamId } = await seedAccepter(ctx)
      for (let i = 0; i < MAX_ACTIVE_CHALLENGES; i++) {
        const otherId = await ctx.db.insert('teams', aTeam({ legacyId: 700 + i, name: `o${i}` }))
        await ctx.db.insert('teamChallenges', {
          challengerTeamId: otherId,
          opponentTeamId: theirTeamId,
          proposedBy: accepterId,
          status: 'active',
          expiresAt: Date.now() + TTL,
          startDay: '2026-10-05',
          endDay: '2026-10-31',
          createdAt: Date.now(),
        })
      }
      const token = await proposeByLinkFor(ctx, playerId, challengerTeamId)
      await expect(
        claimChallengeLinkFor(ctx, accepterId, token, theirTeamId, today),
      ).rejects.toMatchObject({
        data: { code: 'CHALLENGE_LIMIT_REACHED' },
      })
    })
  })

  test('a link CANNOT bypass the one-live-challenge-per-pair rule', async () => {
    const t = convexTest(schema, modules)
    await t.run(async (ctx) => {
      const { playerId, challengerTeamId } = await seedTwoTeams(ctx)
      const { accepterId, theirTeamId } = await seedAccepter(ctx)
      await ctx.db.insert('teamChallenges', {
        challengerTeamId,
        opponentTeamId: theirTeamId,
        proposedBy: playerId,
        status: 'active',
        expiresAt: Date.now() + TTL,
        startDay: '2026-10-05',
        endDay: '2026-10-31',
        createdAt: Date.now(),
      })
      const token = await proposeByLinkFor(ctx, playerId, challengerTeamId)
      await expect(
        claimChallengeLinkFor(ctx, accepterId, token, theirTeamId, today),
      ).rejects.toMatchObject({
        data: { code: 'CHALLENGE_EXISTS' },
      })
    })
  })

  // AN EMPTY TOKEN IS REFUSED — and note what this does NOT prove. '' is not
  // undefined, so the probe matches nothing and returns null, and the code is
  // CHALLENGE_LINK_INVALID with or without the guard. Measured: deleting the
  // guard leaves this test green. It is kept because '' reaching here from a
  // route param is the likely shape and the answer should be the link code
  // rather than some incidental error — but the test below is the one that
  // actually pins the guard.
  test('an empty token is refused', async () => {
    const t = convexTest(schema, modules)
    await t.run(async (ctx) => {
      const { playerId, challengerTeamId } = await seedTwoTeams(ctx)
      const { accepterId, theirTeamId } = await seedAccepter(ctx)
      await ctx.db.insert('teamChallenges', {
        challengerTeamId,
        opponentTeamId: theirTeamId,
        proposedBy: playerId,
        status: 'pending',
        expiresAt: Date.now() + TTL,
        createdAt: Date.now(),
      })
      await expect(
        claimChallengeLinkFor(ctx, accepterId, '', theirTeamId, today),
      ).rejects.toMatchObject({ data: { code: 'CHALLENGE_LINK_INVALID' } })
    })
  })

  // THE GUARD'S REAL HAZARD, and the only test that can kill it. teamChallenges
  // .token is OPTIONAL, so every DIRECT proposal keys on `undefined` in by_token
  // — and MEASURED: probing with undefined against two tokenless rows makes
  // .unique() throw "not unique", a confusing failure a long way from its cause.
  // The `string` signature makes undefined unreachable from TypeScript, which is
  // exactly why it needs `as never` and why the empty-string test above cannot
  // substitute. Task 13 feeds this from a route param, where a runtime undefined
  // is a real arrival.
  test('an undefined token is refused before the index is probed', async () => {
    const t = convexTest(schema, modules)
    await t.run(async (ctx) => {
      const { playerId, challengerTeamId } = await seedTwoTeams(ctx)
      const { accepterId, theirTeamId } = await seedAccepter(ctx)
      // TWO tokenless rows, so an unguarded probe matches both and .unique()
      // throws rather than returning.
      for (const opponentTeamId of [theirTeamId, challengerTeamId]) {
        await ctx.db.insert('teamChallenges', {
          challengerTeamId,
          opponentTeamId,
          proposedBy: playerId,
          status: 'pending',
          expiresAt: Date.now() + TTL,
          createdAt: Date.now(),
        })
      }
      await expect(
        claimChallengeLinkFor(ctx, accepterId, undefined as never, theirTeamId, today),
      ).rejects.toMatchObject({ data: { code: 'CHALLENGE_LINK_INVALID' } })
    })
  })

  // THE SELF-CLAIM, and Task 5's duplicate-unreachability argument rests on it:
  // liveChallengesFor returns a row twice if a team is on both sides, which
  // would inflate every cap count thereafter. The claim path is the SECOND way
  // to reach that state and the only one nothing asserted.
  test("you cannot claim your own team's link", async () => {
    const t = convexTest(schema, modules)
    await t.run(async (ctx) => {
      const { playerId, challengerTeamId } = await seedTwoTeams(ctx)
      const token = await proposeByLinkFor(ctx, playerId, challengerTeamId)
      await expect(
        claimChallengeLinkFor(ctx, playerId, token, challengerTeamId, today),
      ).rejects.toMatchObject({ data: { code: 'INVALID_TEAM' } })
    })
  })

  test('you cannot claim on behalf of a team you are not on', async () => {
    const t = convexTest(schema, modules)
    await t.run(async (ctx) => {
      const { playerId, challengerTeamId } = await seedTwoTeams(ctx)
      const { accepterId } = await seedAccepter(ctx)
      const strangersTeam = await ctx.db.insert('teams', aTeam({ legacyId: 800, name: 'Strangers' }))
      const token = await proposeByLinkFor(ctx, playerId, challengerTeamId)
      await expect(
        claimChallengeLinkFor(ctx, accepterId, token, strangersTeam, today),
      ).rejects.toMatchObject({
        data: { code: 'NOT_A_MEMBER' },
      })
    })
  })
})
```

Add near the top of the test file, beside `modules`:

```ts
const TTL = PROPOSAL_TTL_DAYS * 24 * 60 * 60 * 1000
```

- [ ] **Step 2: Run it and confirm it fails**

```bash
TZ=UTC pnpm test:once convex/challenges.test.ts > /tmp/t7.txt 2>&1; echo "exit=$?"; tail -20 /tmp/t7.txt
```

Expected: non-zero exit, `acceptChallengeFor is not a function`.

- [ ] **Step 3: Write the implementation**

Append to `convex/challenges.ts`. Add `windowFor` and `requirePlausibleToday` to the existing imports:

```ts
import { accessError, isProFor, requirePlausibleToday, requirePlayer, requireTeamMemberFor } from './access.ts'
import { MAX_ACTIVE_CHALLENGES, PROPOSAL_TTL_DAYS, windowFor } from './lib/challenge.ts'
```

Then:

```ts
/**
 * Bring a pending challenge to life.
 *
 * `today` IS THE ACCEPTER'S OWN LOCAL DAY, bounded server-side by
 * requirePlausibleToday — the same treatment every other mutation that feeds a
 * client `today` into a dated computation gets. See the enumeration in
 * access.ts: this is a new member of that family and belongs in that list.
 *
 * WHY IT MUST BE THE CLIENT'S DAY RATHER THAN THE SERVER'S: the window the
 * player is agreeing to starts tomorrow in THEIR calendar, and a board belongs
 * to a puzzle day rather than to an instant.
 */
async function activate(
  ctx: WriterCtx,
  challengeId: Id<'teamChallenges'>,
  accepterId: Id<'players'>,
  today: string,
  extra: Partial<Doc<'teamChallenges'>> = {},
): Promise<void> {
  const { startDay, endDay } = windowFor(requirePlausibleToday(today))
  // THE ID, NOT THE DOC. The claim path patches opponentTeamId first, so a
  // doc-taking signature would be handed a stale copy — correct today only
  // because this function reads nothing but the id, and silently wrong the
  // moment it grows to read another field (a push body naming the opponent is
  // the obvious candidate). `extra` lets the claim path fold its own patch in
  // here, so there is one write rather than two.
  await ctx.db.patch(challengeId, {
    status: 'active',
    acceptedBy: accepterId,
    startDay,
    endDay,
    ...extra,
  })
}

export async function acceptChallengeFor(
  ctx: WriterCtx,
  playerId: Id<'players'>,
  challengeId: Id<'teamChallenges'>,
  today: string,
): Promise<void> {
  const challenge = await ctx.db.get(challengeId)
  if (challenge === null) throw accessError('INVALID_TEAM')
  if (challenge.status !== 'pending') throw accessError('CHALLENGE_NOT_PENDING')
  if (challenge.expiresAt <= Date.now()) throw accessError('CHALLENGE_NOT_PENDING')
  if (challenge.opponentTeamId === undefined) throw accessError('INVALID_TEAM')

  // ANY MEMBER MAY ACCEPT, AND PRO IS NOT CHECKED HERE. See proposeToTeamFor.
  await requireTeamMemberFor(ctx, playerId, challenge.opponentTeamId)

  // RE-CHECKED AT ACCEPTANCE, not trusted from propose time: the pair may have
  // filled its slots or turned challenges off while this sat pending.
  await requireChallengeablePair(
    ctx,
    challenge.challengerTeamId,
    challenge.opponentTeamId,
    challenge._id,
  )

  await activate(ctx, challenge._id, playerId, today)
}

/**
 * Claim a challenge link on behalf of one of your own teams.
 *
 * EVERY PAIR CHECK RUNS HERE, and this is the function design §8.1 was written
 * about. A link proposal has no opponent at creation, so acceptsChallenges, the
 * cap and the one-per-pair rule could not have been checked earlier. Checking
 * them only at propose time would make a link a bypass for all three.
 *
 * acceptsChallenges: false BLOCKS A CLAIM TOO, even though the claimant is
 * consenting for their own team. It is the owner's setting; a member routing
 * around it through a link would make it advisory rather than a control.
 */
export async function claimChallengeLinkFor(
  ctx: WriterCtx,
  playerId: Id<'players'>,
  token: string,
  opponentTeamId: Id<'teams'>,
  today: string,
): Promise<Id<'teamChallenges'>> {
  // GUARD BEFORE THE LOOKUP, and schema.ts's banner on teamChallenges.token says
  // why: the field is OPTIONAL, so eq('token', undefined) matches every DIRECT
  // proposal at once and .unique() throws "not unique" — a failure a long way
  // from its cause. An empty token is also not a token. Task 13 adds a ROUTE
  // PARAM feeding this, which is exactly how an empty string gets here.
  if (!token) throw accessError('CHALLENGE_LINK_INVALID')

  const challenge = await ctx.db
    .query('teamChallenges')
    .withIndex('by_token', (q) => q.eq('token', token))
    .unique()

  // AN UNKNOWN TOKEN AND AN EXPIRED ONE ANSWER THE SAME WAY, so holding a dead
  // token tells you nothing about whether it was ever real.
  if (challenge === null) throw accessError('CHALLENGE_LINK_INVALID')
  if (challenge.status !== 'pending') throw accessError('CHALLENGE_LINK_INVALID')
  if (challenge.expiresAt <= Date.now()) throw accessError('CHALLENGE_LINK_INVALID')

  await requireTeamMemberFor(ctx, playerId, opponentTeamId)
  await requireChallengeablePair(ctx, challenge.challengerTeamId, opponentTeamId, challenge._id)

  // ONE PATCH, via activate's `extra` — see its comment on why it takes an id.
  await activate(ctx, challenge._id, playerId, today, { opponentTeamId })
  return challenge._id
}

export const acceptChallenge = mutation({
  args: { challengeId: v.id('teamChallenges'), today: v.string() },
  handler: async (ctx, { challengeId, today }) => {
    const player = await requirePlayer(ctx)
    await acceptChallengeFor(ctx, player._id, challengeId, today)
  },
})

export const claimChallengeLink = mutation({
  args: { token: v.string(), opponentTeamId: v.id('teams'), today: v.string() },
  handler: async (ctx, { token, opponentTeamId, today }) => {
    const player = await requirePlayer(ctx)
    return await claimChallengeLinkFor(ctx, player._id, token, opponentTeamId, today)
  },
})
```

- [ ] **Step 4: Add the two remaining access codes — in THREE places, not one**

This step was missing two of the three in the plan's first draft, which is exactly
how Task 5 lost an hour. See the ground rule: one half has no compiler behind it.

**1. `convex/access.ts`**, extending the block added in Task 5:

```ts
  | 'CHALLENGE_NOT_PENDING'
  | 'CHALLENGE_LINK_INVALID'
```

**2. `src/lib/convex-error.ts`**, `convexErrorCode`'s `||` chain. **NO COMPILER
BEHIND THIS.** Miss it and the copy written below is unreachable, so every user sees
the generic message instead. `src/lib/convex-error.test.ts` parses the union and is
the only guard — and it does NOT run under a single-file test of `challenges.test.ts`:

```ts
    code === 'CHALLENGE_NOT_PENDING' ||
    code === 'CHALLENGE_LINK_INVALID'
```

**3. `src/lib/convex-error.ts`**, `typedCodeMessage`. Typecheck-enforced — its
`default` assigns to `never`, so the build stops until these exist:

```ts
    case 'CHALLENGE_NOT_PENDING':
      return 'That challenge is no longer waiting for an answer.'
    case 'CHALLENGE_LINK_INVALID':
      return 'That challenge link is no longer valid.'
```

- [ ] **Step 5: Add this file to `requirePlausibleToday`'s enumeration**

`convex/access.ts`'s doc comment on `requirePlausibleToday` says "KEEP THIS LIST WHOLE — wordle-teams-04r's pre-cutover check is 'every clock-bounded surface', and this is where a reader goes to enumerate them." Add to that list:

```
 * - challenges.ts's acceptChallenge and claimChallengeLink, which resolve the
 *   challenge WINDOW from the accepter's own day (wordle-teams-zic8.2). These do
 *   not feed winner recomputation, so the "six" above is unchanged as the answer
 *   to that narrower question; they are listed because the broader question is
 *   "every clock-bounded surface".
```

- [ ] **Step 6: Run it and confirm it passes**

```bash
TZ=UTC pnpm test:once convex/challenges.test.ts > /tmp/t7.txt 2>&1; echo "exit=$?"; tail -30 /tmp/t7.txt
```

- [ ] **Step 6b: The two gates this task's new AccessCodes can break**

A single-file vitest run never loads `src/lib/convex-error.test.ts`, and nothing in
Tasks 5-8 otherwise runs `tsc`. Without this step, a missed half of Step 4 surfaces
three commits later at Task 9.

```bash
TZ=UTC pnpm test:once src/lib/convex-error.test.ts > /tmp/t7-ce.txt 2>&1; echo "ce=$?"
pnpm typecheck > /tmp/t7-tsc.txt 2>&1; echo "tsc=$?"
```

Both must be 0. `ce` guards `convexErrorCode`'s hand-written chain; `tsc` guards
`typedCodeMessage`.

Expected: `exit=0`, **29** tests in `convex/challenges.test.ts` and **4134** in the full suite — the full-suite figure includes **+2** generated tests in `src/lib/convex-error.test.ts`, one per new AccessCode.

- [ ] **Step 7: Commit**

```bash
git add convex/challenges.ts convex/challenges.test.ts convex/access.ts src/lib/convex-error.ts
git commit -F - <<'EOF'
feat(zic8.2): accept and claim, with every pair check re-run at acceptance

The four bypass tests are the point of this task. A link proposal has no
opponent at creation, so acceptsChallenges, MAX_ACTIVE_CHALLENGES and the
one-live-per-pair rule cannot be checked when it is made; checking them only
there would make a link a bypass for all three. acceptsChallenges: false blocks
a claim too, because an owner setting a member can route around is advisory
rather than a control.

Both mutations bound the accepter's `today` through requirePlausibleToday and
are added to that function's enumeration of clock-bounded surfaces.

<YOUR OWN attribution trailer — see below>
Claude-Session: https://claude.ai/code/session_01J5oECn6C61LEH6aeUMiSA8
EOF
```

---

## Task 8: Decline, withdraw, and the owner's switch

> `cancelChallengeFor` is NOT in this task — it needs the scoreboard and lands in
> Task 10. Nothing here references it.

**bd:** child of `zic8.2`, title "decline/withdraw/cancel and setAcceptsChallenges".

**Files:**
- Modify: `convex/challenges.ts`
- Modify: `convex/challenges.test.ts`

- [ ] **Step 1: Write the failing test**

Append to `convex/challenges.test.ts`:

```ts
import {
  declineChallengeFor,
  setAcceptsChallengesFor,
  withdrawChallengeFor,
} from './challenges.ts'

describe('declineChallengeFor', () => {
  test('a member of the challenged team declines', async () => {
    const t = convexTest(schema, modules)
    await t.run(async (ctx) => {
      const { playerId, challengerTeamId } = await seedTwoTeams(ctx)
      const { accepterId, theirTeamId } = await seedAccepter(ctx)
      const id = await ctx.db.insert('teamChallenges', {
        challengerTeamId,
        opponentTeamId: theirTeamId,
        proposedBy: playerId,
        status: 'pending',
        expiresAt: Date.now() + TTL,
        createdAt: Date.now(),
      })
      await declineChallengeFor(ctx, accepterId, id)
      expect((await ctx.db.get(id))?.status).toBe('declined')
    })
  })

  test('a declined challenge frees its slot', async () => {
    const t = convexTest(schema, modules)
    await t.run(async (ctx) => {
      const { playerId, challengerTeamId } = await seedTwoTeams(ctx)
      const { accepterId, theirTeamId } = await seedAccepter(ctx)
      const id = await ctx.db.insert('teamChallenges', {
        challengerTeamId,
        opponentTeamId: theirTeamId,
        proposedBy: playerId,
        status: 'pending',
        expiresAt: Date.now() + TTL,
        createdAt: Date.now(),
      })
      await declineChallengeFor(ctx, accepterId, id)
      expect(await liveChallengeCountFor(ctx, challengerTeamId)).toBe(0)
    })
  })
})

describe('withdrawChallengeFor', () => {
  test('the proposer withdraws their own pending proposal', async () => {
    const t = convexTest(schema, modules)
    await t.run(async (ctx) => {
      const { playerId, challengerTeamId } = await seedTwoTeams(ctx)
      const { theirTeamId } = await seedAccepter(ctx)
      const id = await ctx.db.insert('teamChallenges', {
        challengerTeamId,
        opponentTeamId: theirTeamId,
        proposedBy: playerId,
        status: 'pending',
        expiresAt: Date.now() + TTL,
        createdAt: Date.now(),
      })
      await withdrawChallengeFor(ctx, playerId, id)
      expect((await ctx.db.get(id))?.status).toBe('withdrawn')
    })
  })

  test('an unrelated member cannot withdraw it', async () => {
    const t = convexTest(schema, modules)
    await t.run(async (ctx) => {
      const { playerId, challengerTeamId } = await seedTwoTeams(ctx)
      const { accepterId, theirTeamId } = await seedAccepter(ctx)
      const id = await ctx.db.insert('teamChallenges', {
        challengerTeamId,
        opponentTeamId: theirTeamId,
        proposedBy: playerId,
        status: 'pending',
        expiresAt: Date.now() + TTL,
        createdAt: Date.now(),
      })
      await expect(withdrawChallengeFor(ctx, accepterId, id)).rejects.toMatchObject({
        data: { code: 'NOT_A_MEMBER' },
      })
    })
  })

  // NOT_TEAM_OWNER, NOT NOT_A_MEMBER. The test above uses seedAccepter's player,
  // who is on NO team of the challenger's, so requireTeamOwnerFor refuses at its
  // FIRST line and the owner branch's second line is never reached. This is the
  // only assertion that gets there.
  test('a member of the challenging team who did not propose it cannot withdraw', async () => {
    const t = convexTest(schema, modules)
    await t.run(async (ctx) => {
      const { playerId, challengerTeamId } = await seedTwoTeams(ctx)
      const { theirTeamId } = await seedAccepter(ctx)
      const bystander = await ctx.db.insert(
        'players',
        aPlayer({ email: 'bystander@example.com', legacyId: '33333333-3333-4333-8333-333333333333' }),
      )
      const team = await ctx.db.get(challengerTeamId)
      await ctx.db.patch(challengerTeamId, { playerIds: [...(team?.playerIds ?? []), bystander] })
      const id = await ctx.db.insert('teamChallenges', {
        challengerTeamId,
        opponentTeamId: theirTeamId,
        proposedBy: playerId,
        status: 'pending',
        expiresAt: Date.now() + TTL,
        createdAt: Date.now(),
      })
      await expect(withdrawChallengeFor(ctx, bystander, id)).rejects.toMatchObject({
        data: { code: 'NOT_TEAM_OWNER' },
      })
    })
  })

  // THE ELSE BRANCH. seedTwoTeams' player is proposer AND owner, so the
  // happy-path test above cannot tell the two branches apart — a mutant
  // collapsing the if to a single requireTeamOwnerFor survives it, silently
  // taking withdrawal away from every non-owner proposer.
  test('a NON-OWNER proposer withdraws their own proposal', async () => {
    const t = convexTest(schema, modules)
    await t.run(async (ctx) => {
      const { challengerTeamId } = await seedTwoTeams(ctx)
      const { theirTeamId } = await seedAccepter(ctx)
      const proposer = await ctx.db.insert(
        'players',
        aPlayer({ email: 'proposer@example.com', legacyId: '44444444-4444-4444-8444-444444444444' }),
      )
      const team = await ctx.db.get(challengerTeamId)
      await ctx.db.patch(challengerTeamId, { playerIds: [...(team?.playerIds ?? []), proposer] })
      const id = await ctx.db.insert('teamChallenges', {
        challengerTeamId,
        opponentTeamId: theirTeamId,
        proposedBy: proposer,
        status: 'pending',
        expiresAt: Date.now() + TTL,
        createdAt: Date.now(),
      })
      await withdrawChallengeFor(ctx, proposer, id)
      expect((await ctx.db.get(id))?.status).toBe('withdrawn')
    })
  })

  test('an ACTIVE challenge cannot be withdrawn — that is cancel', async () => {
    const t = convexTest(schema, modules)
    await t.run(async (ctx) => {
      const { playerId, challengerTeamId } = await seedTwoTeams(ctx)
      const { theirTeamId } = await seedAccepter(ctx)
      const id = await ctx.db.insert('teamChallenges', {
        challengerTeamId,
        opponentTeamId: theirTeamId,
        proposedBy: playerId,
        status: 'active',
        startDay: '2026-10-05',
        endDay: '2026-10-31',
        expiresAt: Date.now() + TTL,
        createdAt: Date.now(),
      })
      await expect(withdrawChallengeFor(ctx, playerId, id)).rejects.toMatchObject({
        data: { code: 'CHALLENGE_NOT_PENDING' },
      })
    })
  })
})

describe('setAcceptsChallengesFor', () => {
  test('the owner turns incoming challenges off', async () => {
    const t = convexTest(schema, modules)
    await t.run(async (ctx) => {
      const { playerId, challengerTeamId } = await seedTwoTeams(ctx)
      await setAcceptsChallengesFor(ctx, playerId, challengerTeamId, false)
      expect((await ctx.db.get(challengerTeamId))?.acceptsChallenges).toBe(false)
    })
  })

  // EXPLICIT true, not absence. requireChallengeablePair reads `=== false`, so
  // both representations of "yes" must round-trip — and a mutant hardcoding
  // { acceptsChallenges: false } survives a suite that only ever asserts false.
  test('the owner turns incoming challenges back on', async () => {
    const t = convexTest(schema, modules)
    await t.run(async (ctx) => {
      const { playerId, challengerTeamId } = await seedTwoTeams(ctx)
      await ctx.db.patch(challengerTeamId, { acceptsChallenges: false })
      await setAcceptsChallengesFor(ctx, playerId, challengerTeamId, true)
      expect((await ctx.db.get(challengerTeamId))?.acceptsChallenges).toBe(true)
    })
  })

  test('a non-owner member cannot', async () => {
    const t = convexTest(schema, modules)
    await t.run(async (ctx) => {
      const { challengerTeamId } = await seedTwoTeams(ctx)
      const otherId = await ctx.db.insert('players', aPlayer({ email: 'other@example.com' }))
      const team = await ctx.db.get(challengerTeamId)
      await ctx.db.patch(challengerTeamId, { playerIds: [...(team?.playerIds ?? []), otherId] })
      await expect(
        setAcceptsChallengesFor(ctx, otherId, challengerTeamId, false),
      ).rejects.toMatchObject({
        data: { code: 'NOT_TEAM_OWNER' },
      })
    })
  })
})
```

- [ ] **Step 2: Run it and confirm it fails**

```bash
TZ=UTC pnpm test:once convex/challenges.test.ts > /tmp/t8.txt 2>&1; echo "exit=$?"; tail -20 /tmp/t8.txt
```

Expected: non-zero exit, `declineChallengeFor is not a function`.

- [ ] **Step 3: Write the implementation**

Append to `convex/challenges.ts`. Add `requireTeamOwnerFor` to the `access.ts` import.

```ts
export async function declineChallengeFor(
  ctx: WriterCtx,
  playerId: Id<'players'>,
  challengeId: Id<'teamChallenges'>,
): Promise<void> {
  const challenge = await ctx.db.get(challengeId)
  if (challenge === null) throw accessError('INVALID_TEAM')
  if (challenge.status !== 'pending') throw accessError('CHALLENGE_NOT_PENDING')
  if (challenge.opponentTeamId === undefined) throw accessError('INVALID_TEAM')
  await requireTeamMemberFor(ctx, playerId, challenge.opponentTeamId)
  await ctx.db.patch(challengeId, { status: 'declined' })
}

/**
 * Take back a proposal that has not been accepted.
 *
 * WITHDRAW IS FOR 'pending' AND CANCEL IS FOR 'active'. They are separate verbs
 * because they mean different things to the other team: a withdrawn proposal was
 * never agreed to and leaves no result, while a cancelled challenge was live and
 * freezes whatever its window held. Collapsing them would let one side end a
 * running contest as though it had never happened.
 */
export async function withdrawChallengeFor(
  ctx: WriterCtx,
  playerId: Id<'players'>,
  challengeId: Id<'teamChallenges'>,
): Promise<void> {
  const challenge = await ctx.db.get(challengeId)
  if (challenge === null) throw accessError('INVALID_TEAM')
  if (challenge.status !== 'pending') throw accessError('CHALLENGE_NOT_PENDING')

  // THE PROPOSER, OR THE CHALLENGING TEAM'S OWNER. The owner is the backstop
  // that replaces the vote the design rejected; they are not in the happy path.
  if (challenge.proposedBy !== playerId) {
    await requireTeamOwnerFor(ctx, playerId, challenge.challengerTeamId)
  } else {
    await requireTeamMemberFor(ctx, playerId, challenge.challengerTeamId)
  }

  await ctx.db.patch(challengeId, { status: 'withdrawn' })
}

export async function setAcceptsChallengesFor(
  ctx: WriterCtx,
  playerId: Id<'players'>,
  teamId: Id<'teams'>,
  accepts: boolean,
): Promise<void> {
  await requireTeamOwnerFor(ctx, playerId, teamId)
  await ctx.db.patch(teamId, { acceptsChallenges: accepts })
}

export const declineChallenge = mutation({
  args: { challengeId: v.id('teamChallenges') },
  handler: async (ctx, { challengeId }) => {
    const player = await requirePlayer(ctx)
    await declineChallengeFor(ctx, player._id, challengeId)
  },
})

export const withdrawChallenge = mutation({
  args: { challengeId: v.id('teamChallenges') },
  handler: async (ctx, { challengeId }) => {
    const player = await requirePlayer(ctx)
    await withdrawChallengeFor(ctx, player._id, challengeId)
  },
})

export const setAcceptsChallenges = mutation({
  args: { teamId: v.id('teams'), accepts: v.boolean() },
  handler: async (ctx, { teamId, accepts }) => {
    const player = await requirePlayer(ctx)
    await setAcceptsChallengesFor(ctx, player._id, teamId, accepts)
  },
})
```

`cancelChallengeFor` needs the scoreboard computation, so it lands in Task 10 with the close path.

- [ ] **Step 4: Run it and confirm it passes**

```bash
TZ=UTC pnpm test:once convex/challenges.test.ts > /tmp/t8.txt 2>&1; echo "exit=$?"; tail -20 /tmp/t8.txt
```

Expected: `exit=0`, **36** tests in `convex/challenges.test.ts` and **4141** in the full suite.

- [ ] **Step 5: Commit**

```bash
git add convex/challenges.ts convex/challenges.test.ts
git commit -F - <<'EOF'
feat(zic8.2): decline, withdraw, and the owner's acceptsChallenges switch

Withdraw is for pending and cancel is for active, kept as separate verbs because
they mean different things to the other team: a withdrawn proposal was never
agreed to and leaves no result, while a cancelled challenge was live and freezes
what its window held. Collapsing them would let one side end a running contest
as though it had never happened.

<YOUR OWN attribution trailer — see below>
Claude-Session: https://claude.ai/code/session_01J5oECn6C61LEH6aeUMiSA8
EOF
```

---

## Task 9: The live scoreboard query, with the Pro gate

**bd:** child of `zic8.2`, title "challengesForTeam query and scoreboard projection".

**Files:**
- Modify: `convex/challenges.ts`
- Modify: `convex/challenges.test.ts`

- [ ] **Step 1: Write the failing test**

Append to `convex/challenges.test.ts`:

```ts
import { challengeScoreboardFor, recordAgainstFor } from './challenges.ts'

/** A teamMonthStats document with `n` boards of `attempts` each on sequential days. */
async function seedStats(
  ctx: Ctx,
  teamId: Id<'teams'>,
  playerId: Id<'players'>,
  month: { year: number; month: number },
  days: Array<{ puzzleDay: string; attempts: number }>,
) {
  await ctx.db.insert('teamMonthStats', {
    teamId,
    year: month.year,
    month: month.month,
    members: [],
    days: days.map((d) => ({
      puzzleDay: d.puzzleDay,
      entries: [{ playerId, attempts: d.attempts }],
    })),
    computedAt: Date.now(),
  })
}

const octoberDays = (attempts: number, count: number) =>
  Array.from({ length: count }, (_, i) => ({
    puzzleDay: `2026-10-${String(i + 5).padStart(2, '0')}`,
    attempts,
  }))

describe('challengeScoreboardFor', () => {
  test('projects both sides from their monthly documents', async () => {
    const t = convexTest(schema, modules)
    await t.run(async (ctx) => {
      const { playerId, challengerTeamId } = await seedTwoTeams(ctx)
      const { accepterId, theirTeamId } = await seedAccepter(ctx)
      await seedStats(ctx, challengerTeamId, playerId, { year: 2026, month: 10 }, octoberDays(3, 12))
      await seedStats(ctx, theirTeamId, accepterId, { year: 2026, month: 10 }, octoberDays(4, 12))

      const id = await ctx.db.insert('teamChallenges', {
        challengerTeamId,
        opponentTeamId: theirTeamId,
        proposedBy: playerId,
        status: 'active',
        startDay: '2026-10-05',
        endDay: '2026-10-31',
        expiresAt: Date.now() + TTL,
        createdAt: Date.now(),
      })

      const board = await challengeScoreboardFor(ctx, (await ctx.db.get(id))!)
      expect(board.challenger.boards).toBe(12)
      expect(board.challenger.average).toBe(3)
      expect(board.opponent.average).toBe(4)
      expect(board.outcome).toBe('challenger')
    })
  })

  test('a side below the board floor makes the result void', async () => {
    const t = convexTest(schema, modules)
    await t.run(async (ctx) => {
      const { playerId, challengerTeamId } = await seedTwoTeams(ctx)
      const { accepterId, theirTeamId } = await seedAccepter(ctx)
      await seedStats(ctx, challengerTeamId, playerId, { year: 2026, month: 10 }, octoberDays(3, 12))
      await seedStats(ctx, theirTeamId, accepterId, { year: 2026, month: 10 }, octoberDays(4, 3))

      const id = await ctx.db.insert('teamChallenges', {
        challengerTeamId,
        opponentTeamId: theirTeamId,
        proposedBy: playerId,
        status: 'active',
        startDay: '2026-10-05',
        endDay: '2026-10-31',
        expiresAt: Date.now() + TTL,
        createdAt: Date.now(),
      })

      const board = await challengeScoreboardFor(ctx, (await ctx.db.get(id))!)
      expect(board.outcome).toBe('void')
    })
  })

  test('boards before startDay are excluded — the retroactivity guard, end to end', async () => {
    const t = convexTest(schema, modules)
    await t.run(async (ctx) => {
      const { playerId, challengerTeamId } = await seedTwoTeams(ctx)
      const { accepterId, theirTeamId } = await seedAccepter(ctx)
      // Twelve boards on the 1st-4th plus twelve inside the window.
      await seedStats(ctx, challengerTeamId, playerId, { year: 2026, month: 10 }, [
        { puzzleDay: '2026-10-01', attempts: 1 },
        { puzzleDay: '2026-10-02', attempts: 1 },
        ...octoberDays(3, 12),
      ])
      await seedStats(ctx, theirTeamId, accepterId, { year: 2026, month: 10 }, octoberDays(4, 12))

      const id = await ctx.db.insert('teamChallenges', {
        challengerTeamId,
        opponentTeamId: theirTeamId,
        proposedBy: playerId,
        status: 'active',
        startDay: '2026-10-05',
        endDay: '2026-10-31',
        expiresAt: Date.now() + TTL,
        createdAt: Date.now(),
      })

      const board = await challengeScoreboardFor(ctx, (await ctx.db.get(id))!)
      expect(board.challenger.boards).toBe(12)
      expect(board.challenger.average).toBe(3) // not pulled down by the 1-attempt days
    })
  })

  test('reads TWO monthly documents per side when the window crosses a month', async () => {
    const t = convexTest(schema, modules)
    await t.run(async (ctx) => {
      const { playerId, challengerTeamId } = await seedTwoTeams(ctx)
      const { accepterId, theirTeamId } = await seedAccepter(ctx)
      await seedStats(ctx, challengerTeamId, playerId, { year: 2026, month: 10 }, [
        { puzzleDay: '2026-10-28', attempts: 3 },
      ])
      await seedStats(ctx, challengerTeamId, playerId, { year: 2026, month: 11 }, [
        { puzzleDay: '2026-11-01', attempts: 3 },
      ])
      await seedStats(ctx, theirTeamId, accepterId, { year: 2026, month: 11 }, [
        { puzzleDay: '2026-11-01', attempts: 5 },
      ])

      const id = await ctx.db.insert('teamChallenges', {
        challengerTeamId,
        opponentTeamId: theirTeamId,
        proposedBy: playerId,
        status: 'active',
        startDay: '2026-10-28',
        endDay: '2026-11-30',
        expiresAt: Date.now() + TTL,
        createdAt: Date.now(),
      })

      const board = await challengeScoreboardFor(ctx, (await ctx.db.get(id))!)
      expect(board.challenger.boards).toBe(2)
    })
  })

  test('a missing monthly document is zero boards, not a throw', async () => {
    const t = convexTest(schema, modules)
    await t.run(async (ctx) => {
      const { playerId, challengerTeamId } = await seedTwoTeams(ctx)
      const { theirTeamId } = await seedAccepter(ctx)
      const id = await ctx.db.insert('teamChallenges', {
        challengerTeamId,
        opponentTeamId: theirTeamId,
        proposedBy: playerId,
        status: 'active',
        startDay: '2026-10-05',
        endDay: '2026-10-31',
        expiresAt: Date.now() + TTL,
        createdAt: Date.now(),
      })
      const board = await challengeScoreboardFor(ctx, (await ctx.db.get(id))!)
      expect(board.challenger.boards).toBe(0)
      expect(board.challenger.average).toBeNull()
      expect(board.outcome).toBe('void')
    })
  })
})

describe('recordAgainstFor', () => {
  test('void counts as neither a win nor a loss', async () => {
    const t = convexTest(schema, modules)
    await t.run(async (ctx) => {
      const { playerId, challengerTeamId } = await seedTwoTeams(ctx)
      const { theirTeamId } = await seedAccepter(ctx)
      const closed = (outcome: 'challenger' | 'opponent' | 'tie' | 'void') => ({
        challengerTeamId,
        opponentTeamId: theirTeamId,
        proposedBy: playerId,
        status: 'closed' as const,
        startDay: '2026-10-05',
        endDay: '2026-10-31',
        expiresAt: Date.now(),
        createdAt: Date.now(),
        result: {
          challenger: { teamId: challengerTeamId, name: 'Challengers', boards: 12, attempts: 36, average: 3, members: [] },
          opponent: { teamId: theirTeamId, name: 'Theirs', boards: 12, attempts: 48, average: 4, members: [] },
          outcome,
          closedAt: Date.now(),
        },
      })
      await ctx.db.insert('teamChallenges', closed('challenger'))
      await ctx.db.insert('teamChallenges', closed('opponent'))
      await ctx.db.insert('teamChallenges', closed('tie'))
      await ctx.db.insert('teamChallenges', closed('void'))

      const record = await recordAgainstFor(ctx, challengerTeamId, theirTeamId)
      expect(record).toEqual({ won: 1, lost: 1, tied: 1, noResult: 1 })
    })
  })

  test("the record is from the VIEWING team's side", async () => {
    const t = convexTest(schema, modules)
    await t.run(async (ctx) => {
      const { playerId, challengerTeamId } = await seedTwoTeams(ctx)
      const { theirTeamId } = await seedAccepter(ctx)
      await ctx.db.insert('teamChallenges', {
        challengerTeamId,
        opponentTeamId: theirTeamId,
        proposedBy: playerId,
        status: 'closed',
        startDay: '2026-10-05',
        endDay: '2026-10-31',
        expiresAt: Date.now(),
        createdAt: Date.now(),
        result: {
          challenger: { teamId: challengerTeamId, name: 'Challengers', boards: 12, attempts: 36, average: 3, members: [] },
          opponent: { teamId: theirTeamId, name: 'Theirs', boards: 12, attempts: 48, average: 4, members: [] },
          outcome: 'challenger',
          closedAt: Date.now(),
        },
      })
      expect(await recordAgainstFor(ctx, challengerTeamId, theirTeamId)).toMatchObject({ won: 1 })
      expect(await recordAgainstFor(ctx, theirTeamId, challengerTeamId)).toMatchObject({ lost: 1 })
    })
  })
})
```

- [ ] **Step 2: Run it and confirm it fails**

```bash
TZ=UTC pnpm test:once convex/challenges.test.ts > /tmp/t9.txt 2>&1; echo "exit=$?"; tail -20 /tmp/t9.txt
```

Expected: non-zero exit, `challengeScoreboardFor is not a function`.

- [ ] **Step 3: Write the implementation**

Append to `convex/challenges.ts`. Extend the `lib/challenge.ts` import with `outcomeOf`, `teamTotalsOver`, and the types; add `query` to the `_generated/server` import; add `meanAttemptsOf` from `./lib/teamStats.ts` and `monthOf` from `./lib/puzzleDay.ts`.

```ts
export type ChallengeSide = {
  teamId: Id<'teams'>
  teamName: string
  boards: number
  attempts: number
  average: number | null
  members: Array<{ playerId: Id<'players'>; boards: number; attempts: number; average: number | null }>
}

export type ChallengeScoreboard = {
  challenger: ChallengeSide
  opponent: ChallengeSide
  outcome: ChallengeOutcome
}

/**
 * Every monthly document a window touches, for one team.
 *
 * ONE DOCUMENT IN THE ORDINARY CASE AND TWO UNDER THE SHORT-WINDOW RULE, which
 * is the only way a window crosses a month boundary. Months are enumerated from
 * the window rather than guessed, so a window that grows later cannot silently
 * read a month short.
 */
async function statsDaysFor(
  ctx: ReaderCtx,
  teamId: Id<'teams'>,
  startDay: string,
  endDay: string,
): Promise<Array<StatsDay>> {
  const months = new Set([monthOf(startDay), monthOf(endDay)])
  const days: Array<StatsDay> = []
  for (const month of months) {
    const [year, monthNum] = month.split('-').map(Number)
    const doc = await ctx.db
      .query('teamMonthStats')
      .withIndex('by_team_year_month', (q) =>
        q.eq('teamId', teamId).eq('year', year).eq('month', monthNum),
      )
      .unique()
    // A MISSING DOCUMENT IS ZERO BOARDS, NEVER A THROW. teamMonthStats is
    // derived data — the rollup skips writing an unchanged month and a team that
    // has never played has no row at all. Treating absence as an error would
    // make a brand-new team's scoreboard crash rather than read 0.
    if (doc !== null) days.push(...doc.days)
  }
  return days
}

/**
 * ORDER THE MEMBER ROWS HERE, because teamTotalsOver does not.
 *
 * Its `members` come out of a Map in first-seen order across days[] —
 * deterministic, but meaningless to a reader: whoever happened to play earliest
 * in the window lands first. Sort ascending by average so the best performer
 * leads, with a null average (no boards in the window) last, and break ties on
 * boards played to match the outcome rule. A null average must never sort as 0
 * or a member who did not play would appear to have won.
 */
function sideFrom(
  teamId: Id<'teams'>,
  teamName: string,
  totals: ChallengeTotals,
): ChallengeSide {
  return {
    teamId,
    teamName,
    boards: totals.boards,
    attempts: totals.attempts,
    average: meanAttemptsOf(totals),
    // NO `as Id<'players'>` CAST. teamTotalsOver is generic over the player id,
    // so passing it days from a teamMonthStats document makes PlayerId infer as
    // Id<'players'> and it flows through. If you find yourself adding a cast
    // here, the generic argument has been lost somewhere upstream — fix that
    // instead, because a cast is where an Id for the wrong table slips through.
    members: totals.members
      .map((m) => ({
        playerId: m.playerId,
        boards: m.boards,
        attempts: m.attempts,
        average: meanAttemptsOf(m),
      }))
      // Nulls last, then lower average first, then more boards first.
      .sort((a, b) => {
        if (a.average === null) return b.average === null ? 0 : 1
        if (b.average === null) return -1
        if (a.average !== b.average) return a.average - b.average
        return b.boards - a.boards
      }),
  }
}

/**
 * The live scoreboard for an active challenge.
 *
 * READS AT MOST TWO teamMonthStats DOCUMENTS PER SIDE and never touches
 * dailyScores. That is the whole cost model: the aggregate this projects is
 * already maintained incrementally on board write by winners.ts, which is the
 * shape the parent epic's hygiene note asks for.
 */
export async function challengeScoreboardFor(
  ctx: ReaderCtx,
  challenge: Doc<'teamChallenges'>,
): Promise<ChallengeScoreboard> {
  if (challenge.startDay === undefined || challenge.endDay === undefined) {
    throw accessError('CHALLENGE_NOT_ACTIVE')
  }
  if (challenge.opponentTeamId === undefined) throw accessError('CHALLENGE_NOT_ACTIVE')

  const { startDay, endDay } = challenge
  const challengerTeam = await ctx.db.get(challenge.challengerTeamId)
  const opponentTeam = await ctx.db.get(challenge.opponentTeamId)
  if (challengerTeam === null || opponentTeam === null) throw accessError('INVALID_TEAM')

  const challengerTotals = teamTotalsOver(
    await statsDaysFor(ctx, challengerTeam._id, startDay, endDay),
    startDay,
    endDay,
  )
  const opponentTotals = teamTotalsOver(
    await statsDaysFor(ctx, opponentTeam._id, startDay, endDay),
    startDay,
    endDay,
  )

  return {
    challenger: sideFrom(challengerTeam._id, challengerTeam.name, challengerTotals),
    opponent: sideFrom(opponentTeam._id, opponentTeam.name, opponentTotals),
    // ⚠️ ARGUMENT ORDER — THE ONE DEFECT NO TEST IN THIS FEATURE CAN CATCH.
    // outcomeOf's two parameters are structurally identical, so
    // outcomeOf(opponentTotals, challengerTotals) compiles and silently returns
    // the opposite winner. The unit tests exercise outcomeOf, not this query, so
    // a transposed call here produces a plausible-looking scoreboard naming the
    // wrong team. Task 9's REVIEWER must read this line against the two
    // sideFrom(...) lines above it and confirm the order by eye. An object
    // parameter would make the class of bug impossible and was considered and
    // declined: one call site, both locals named, and the return type names the
    // roles.
    outcome: outcomeOf(challengerTotals, opponentTotals),
  }
}

export type HeadToHeadRecord = { won: number; lost: number; tied: number; noResult: number }

/**
 * One team's record against another, from the VIEWING team's side.
 *
 * 'void' IS NEITHER A WIN NOR A LOSS. It is counted as noResult and shown as
 * "no result", because a void means the boards were never there to judge —
 * folding it into either column would invent an outcome nobody played for.
 */
export async function recordAgainstFor(
  ctx: ReaderCtx,
  teamId: Id<'teams'>,
  opponentId: Id<'teams'>,
): Promise<HeadToHeadRecord> {
  const record: HeadToHeadRecord = { won: 0, lost: 0, tied: 0, noResult: 0 }

  const closed = [
    ...(await ctx.db
      .query('teamChallenges')
      .withIndex('by_challenger_and_status', (q) =>
        q.eq('challengerTeamId', teamId).eq('status', 'closed'),
      )
      .collect()),
    ...(await ctx.db
      .query('teamChallenges')
      .withIndex('by_opponent_and_status', (q) =>
        q.eq('opponentTeamId', teamId).eq('status', 'closed'),
      )
      .collect()),
  ]

  for (const challenge of closed) {
    if (challenge.result === undefined) continue
    const other =
      challenge.challengerTeamId === teamId ? challenge.opponentTeamId : challenge.challengerTeamId
    if (other !== opponentId) continue

    const viewerIsChallenger = challenge.challengerTeamId === teamId
    switch (challenge.result.outcome) {
      case 'void':
        record.noResult += 1
        break
      case 'tie':
        record.tied += 1
        break
      case 'challenger':
        viewerIsChallenger ? (record.won += 1) : (record.lost += 1)
        break
      case 'opponent':
        viewerIsChallenger ? (record.lost += 1) : (record.won += 1)
        break
    }
  }

  return record
}

/**
 * Everything the team page needs about challenges.
 *
 * THE PRO GATE IS APPLIED HERE, SERVER-SIDE, AND NOT IN THE COMPONENT. Free
 * members get both teams' averages, both board counts and the outcome — the
 * whole result, honestly — and NOT the per-member rows. That is the same line
 * insights already draws: teamRank sends the free tier a position while
 * memberAverages is the paid panel. Withholding the rows in the client would
 * ship them to the browser and hide them with CSS, which is not a gate.
 */
export const challengesForTeam = query({
  args: { teamId: v.id('teams') },
  handler: async (ctx, { teamId }) => {
    const player = await requirePlayer(ctx)
    await requireTeamMemberFor(ctx, player._id, teamId)
    const pro = await isProFor(ctx, player._id)

    const live = await liveChallengesFor(ctx, teamId)
    const active = []
    for (const challenge of live.filter((c) => c.status === 'active')) {
      const board = await challengeScoreboardFor(ctx, challenge)
      active.push({
        challengeId: challenge._id,
        startDay: challenge.startDay,
        endDay: challenge.endDay,
        viewerIsChallenger: challenge.challengerTeamId === teamId,
        challenger: pro ? board.challenger : { ...board.challenger, members: [] },
        opponent: pro ? board.opponent : { ...board.opponent, members: [] },
        outcome: board.outcome,
      })
    }

    return {
      pro,
      active,
      pending: live.filter((c) => c.status === 'pending'),
    }
  },
})
```

- [ ] **Step 4: Add the last access code**

In `convex/access.ts`, extend the challenge block:

```ts
  | 'CHALLENGE_NOT_ACTIVE'
```

- [ ] **Step 5: Run it and confirm it passes**

```bash
TZ=UTC pnpm test:once convex/challenges.test.ts > /tmp/t9.txt 2>&1; echo "exit=$?"; tail -30 /tmp/t9.txt
```

Expected: `exit=0`, **43** tests in `convex/challenges.test.ts` and **4149** in the full suite — including **+1** generated test in `src/lib/convex-error.test.ts` for `CHALLENGE_NOT_ACTIVE`.

- [ ] **Step 6: Run all four gates**

```bash
TZ=UTC pnpm test:once > /tmp/g-test.txt 2>&1; echo "test=$?"
pnpm typecheck > /tmp/g-tsc.txt 2>&1; echo "tsc=$?"
pnpm lint > /tmp/g-lint.txt 2>&1; echo "lint=$?"
pnpm build > /tmp/g-build.txt 2>&1; echo "build=$?"
```

Expected: all four `=0`.

- [ ] **Step 7: Commit**

```bash
git add convex/challenges.ts convex/challenges.test.ts convex/access.ts
git commit -F - <<'EOF'
feat(zic8.2): live scoreboard projection and the head-to-head record

At most two teamMonthStats documents per side and never a dailyScores read. A
missing monthly document is zero boards rather than a throw, because the rollup
skips unchanged months and a team that has never played has no row.

The Pro gate is applied server-side: free members get both averages, both board
counts and the outcome, and not the per-member rows - the same line insights
already draws. Withholding rows in the component would ship them to the browser
and hide them with CSS, which is not a gate.

A void result counts as neither a win nor a loss.

<YOUR OWN attribution trailer — see below>
Claude-Session: https://claude.ai/code/session_01J5oECn6C61LEH6aeUMiSA8
EOF
```

---

## Task 10: Close on the existing daily sweep, idempotently, with push

**bd:** child of `zic8.2`, title "close due challenges on teamStats.sweep + push".

**Files:**
- Modify: `convex/challenges.ts`
- Modify: `convex/teamStats.ts`
- Modify: `convex/chatNotify.ts` (one comment correction)
- Modify: `convex/challenges.test.ts`
- Modify: `convex/lib/challenge.ts` (notification body)
- Modify: `convex/lib/challenge.test.ts`

- [ ] **Step 1: Write the failing test for the notification body**

Append to `convex/lib/challenge.test.ts`:

```ts
import { challengeNotificationBody } from './challenge.ts'

describe('challengeNotificationBody', () => {
  test('names the opponent, because concurrency means "your challenge" has no referent', () => {
    expect(challengeNotificationBody('accepted', 'The Wordlers')).toContain('The Wordlers')
  })

  test('clamps a long team name by CODE POINTS, not UTF-16 units', () => {
    const emoji = '🎯'.repeat(40)
    const body = challengeNotificationBody('accepted', emoji)
    // A lone surrogate renders as the replacement glyph in the shade.
    expect(body).not.toContain('�')
    expect([...body].length).toBeLessThan([...emoji].length)
  })

  test('trims trailing whitespace before the ellipsis', () => {
    const body = challengeNotificationBody('accepted', `${'a'.repeat(28)}     tail`)
    expect(body).not.toMatch(/\s…/u)
  })

  test('distinguishes accepted from closed', () => {
    expect(challengeNotificationBody('accepted', 'X')).not.toBe(
      challengeNotificationBody('closed', 'X'),
    )
  })
})
```

- [ ] **Step 2: Run it and confirm it fails**

```bash
TZ=UTC pnpm test:once convex/lib/challenge.test.ts > /tmp/t10a.txt 2>&1; echo "exit=$?"; tail -20 /tmp/t10a.txt
```

Expected: non-zero exit, `challengeNotificationBody is not a function`.

- [ ] **Step 3: Implement the notification body**

**First, widen the module's charter by one line.** `convex/lib/challenge.ts`'s banner
declares the file "THE RULES OF A TEAM-VS-TEAM CHALLENGE… the mutations in
`../challenges.ts` supply inputs; **this file decides**." `challengeNotificationBody`
is *presentation*, not a decidable rule, so as written the banner would no longer
describe its own contents. Add a sentence admitting the one exception and why it lives
here anyway — the clamping rule is needed on both sides of the wire and the module is
the client-safe one. A banner that quietly stops being true is how the next reader
learns to distrust all of them.

**Also add section separators now, and only now.** This task introduces module-private
constants (`MAX_NOTIFIED_TEAM_NAME`, `ELLIPSIS`) near the bottom, splitting the file's
constants into two clusters, and brings the file to roughly 255 lines with a second
concern. `globalThreshold.ts` already uses `── SECTION ──` separators. At Task 3's 212
lines with one concern and strict constants → window → projection → outcome ordering
they would have been noise; here they are earned.

Append to `convex/lib/challenge.ts`:

```ts
/** Visible code points of an opponent name kept in a push body. */
const MAX_NOTIFIED_TEAM_NAME = 30
const ELLIPSIS = '…'

/**
 * The push body for a challenge event.
 *
 * NOT AN INJECTION DEFENCE, and it must never be "hardened" into an escaping
 * routine. The Notification API takes plain text, not markup, and the deep link
 * beside this is built server-side and clamped to the worker's own origin by
 * resolveNotificationUrl. A crafted team name has nowhere to go. This is about
 * presentation and only about presentation.
 *
 * CODE POINTS, NOT String.prototype.slice (wordle-teams-5gm3). Slicing counts
 * UTF-16 units, so a name of emoji would be cut BETWEEN the halves of a
 * surrogate pair — a lone surrogate, which renders as the replacement glyph —
 * and would yield half as many visible characters as the budget says.
 *
 * TRAILING WHITESPACE IS TRIMMED BEFORE THE ELLIPSIS, because a cut lands
 * mid-word as often as not and "Wordle …" reads as a rendering fault rather
 * than a deliberate truncation. The result can be SHORTER than the budget,
 * which is correct: the budget is a ceiling, not a target.
 *
 * THE OPPONENT IS ALWAYS NAMED. A team may hold several challenges at once, so
 * "your challenge finished" has no referent.
 */
export function challengeNotificationBody(
  event: 'accepted' | 'closed',
  opponentName: string,
): string {
  const points = [...opponentName]
  const name =
    points.length <= MAX_NOTIFIED_TEAM_NAME
      ? opponentName
      : `${points.slice(0, MAX_NOTIFIED_TEAM_NAME - 1).join('').replace(/\s+$/u, '')}${ELLIPSIS}`

  return event === 'accepted' ? `Challenge accepted: ${name}` : `Challenge finished: ${name}`
}
```

- [ ] **Step 4: Run it and confirm it passes**

```bash
TZ=UTC pnpm test:once convex/lib/challenge.test.ts > /tmp/t10a.txt 2>&1; echo "exit=$?"; tail -20 /tmp/t10a.txt
```

Expected: `exit=0`, **30** tests in `convex/lib/challenge.test.ts` (the real baseline there is 26, not 23).

- [ ] **Step 5: Correct the now-false comment in `chatNotify.ts`**

`chatNotify.ts`'s `chatNotificationBody` doc comment ends: "THE BOARD-ENTRY REMINDER NEEDS NONE OF THIS. … This is the app's only push body built from text a user typed." That last clause becomes false with Task 10. Replace it with:

```
 * NO LONGER THE APP'S ONLY USER-TYPED PUSH BODY. challengeNotificationBody in
 * lib/challenge.ts (wordle-teams-zic8.2) interpolates an opposing TEAM NAME and
 * carries a byte-identical clamping rule for the identical reason. If you change
 * the rule here, change it there — two implementations of this is how one surface
 * starts shipping lone surrogates.
```

- [ ] **Step 6: Write the failing test for the close**

Append to `convex/challenges.test.ts`:

```ts
import { closeDueChallengesFor } from './challenges.ts'

describe('closeDueChallengesFor', () => {
  async function seedDueChallenge(ctx: Ctx) {
    const { playerId, challengerTeamId } = await seedTwoTeams(ctx)
    const { accepterId, theirTeamId } = await seedAccepter(ctx)
    await seedStats(ctx, challengerTeamId, playerId, { year: 2026, month: 10 }, octoberDays(3, 12))
    await seedStats(ctx, theirTeamId, accepterId, { year: 2026, month: 10 }, octoberDays(4, 12))
    const id = await ctx.db.insert('teamChallenges', {
      challengerTeamId,
      opponentTeamId: theirTeamId,
      proposedBy: playerId,
      status: 'active',
      startDay: '2026-10-05',
      endDay: '2026-10-31',
      expiresAt: Date.now() + TTL,
      createdAt: Date.now(),
    })
    return { id, challengerTeamId, theirTeamId }
  }

  test('closes a challenge whose window has ended and freezes the result', async () => {
    const t = convexTest(schema, modules)
    await t.run(async (ctx) => {
      const { id } = await seedDueChallenge(ctx)
      await closeDueChallengesFor(ctx, '2026-11-01')
      const doc = await ctx.db.get(id)
      expect(doc?.status).toBe('closed')
      expect(doc?.result?.outcome).toBe('challenger')
      expect(doc?.result?.challenger.average).toBe(3)
    })
  })

  test('does not close a challenge still inside its window', async () => {
    const t = convexTest(schema, modules)
    await t.run(async (ctx) => {
      const { id } = await seedDueChallenge(ctx)
      await closeDueChallengesFor(ctx, '2026-10-20')
      expect((await ctx.db.get(id))?.status).toBe('active')
    })
  })

  test('closes ON the day after endDay, not before — the boundary', async () => {
    const t = convexTest(schema, modules)
    await t.run(async (ctx) => {
      const { id } = await seedDueChallenge(ctx)
      await closeDueChallengesFor(ctx, '2026-10-31')
      expect((await ctx.db.get(id))?.status).toBe('active')
    })
  })

  // THE SNAPSHOT IS WHAT MAKES THIS TRUE, and it is why the snapshot exists.
  test('a later board edit inside the window does NOT restate a closed result', async () => {
    const t = convexTest(schema, modules)
    await t.run(async (ctx) => {
      const { id, challengerTeamId } = await seedDueChallenge(ctx)
      await closeDueChallengesFor(ctx, '2026-11-01')
      const before = (await ctx.db.get(id))?.result?.challenger.average

      // Backfill is a free feature: rewrite the month's aggregate.
      const stats = await ctx.db
        .query('teamMonthStats')
        .withIndex('by_team_year_month', (q) =>
          q.eq('teamId', challengerTeamId).eq('year', 2026).eq('month', 10),
        )
        .unique()
      await ctx.db.patch(stats!._id, {
        days: octoberDays(6, 12).map((d) => ({
          puzzleDay: d.puzzleDay,
          entries: [{ playerId: stats!.days[0].entries[0].playerId, attempts: d.attempts }],
        })),
      })

      await closeDueChallengesFor(ctx, '2026-11-02')
      expect((await ctx.db.get(id))?.result?.challenger.average).toBe(before)
    })
  })

  test('running twice neither restates the result nor re-notifies', async () => {
    const t = convexTest(schema, modules)
    await t.run(async (ctx) => {
      const { id } = await seedDueChallenge(ctx)
      const first = await closeDueChallengesFor(ctx, '2026-11-01')
      const second = await closeDueChallengesFor(ctx, '2026-11-01')
      expect(first.closed).toBe(1)
      expect(second.closed).toBe(0)
      expect((await ctx.db.get(id))?.result).toBeDefined()
    })
  })

  test('expires a pending proposal past its TTL', async () => {
    const t = convexTest(schema, modules)
    await t.run(async (ctx) => {
      const { playerId, challengerTeamId } = await seedTwoTeams(ctx)
      const { theirTeamId } = await seedAccepter(ctx)
      const id = await ctx.db.insert('teamChallenges', {
        challengerTeamId,
        opponentTeamId: theirTeamId,
        proposedBy: playerId,
        status: 'pending',
        expiresAt: Date.now() - 1,
        createdAt: Date.now(),
      })
      await closeDueChallengesFor(ctx, '2026-10-20')
      expect((await ctx.db.get(id))?.status).toBe('expired')
    })
  })

  test('leaves a pending proposal inside its TTL alone', async () => {
    const t = convexTest(schema, modules)
    await t.run(async (ctx) => {
      const { playerId, challengerTeamId } = await seedTwoTeams(ctx)
      const { theirTeamId } = await seedAccepter(ctx)
      const id = await ctx.db.insert('teamChallenges', {
        challengerTeamId,
        opponentTeamId: theirTeamId,
        proposedBy: playerId,
        status: 'pending',
        expiresAt: Date.now() + TTL,
        createdAt: Date.now(),
      })
      await closeDueChallengesFor(ctx, '2026-10-20')
      expect((await ctx.db.get(id))?.status).toBe('pending')
    })
  })
})
```

- [ ] **Step 7: Run it and confirm it fails**

```bash
TZ=UTC pnpm test:once convex/challenges.test.ts > /tmp/t10b.txt 2>&1; echo "exit=$?"; tail -20 /tmp/t10b.txt
```

Expected: non-zero exit, `closeDueChallengesFor is not a function`.

- [ ] **Step 8: Implement the close**

Append to `convex/challenges.ts`. Add `internal` from `./_generated/api` and `challengeNotificationBody` to the `lib/challenge.ts` import.

```ts
/**
 * Freeze a challenge's numbers and notify both rosters.
 *
 * IDEMPOTENT BY CONSTRUCTION: a challenge already holding a `result` is skipped
 * by the caller, so a re-run can neither restate a frozen record nor
 * double-notify. The sweep that calls this runs daily and a retried mutation is
 * an ordinary event, so this is a requirement rather than a nicety.
 */
async function closeOne(ctx: WriterCtx, challenge: Doc<'teamChallenges'>): Promise<void> {
  const board = await challengeScoreboardFor(ctx, challenge)
  const strip = (side: ChallengeSide) => ({
    teamId: side.teamId,
    // NOTE THE RENAME: ChallengeSide carries `teamName`, the validator requires
    // `name`. So a spread does NOT work — this mapping is why `strip` exists.
    // schema.ts's banner: the name at close is the point of a snapshot, because
    // a rename must not rewrite who a closed challenge was against.
    name: side.teamName,
    boards: side.boards,
    attempts: side.attempts,
    average: side.average,
    members: side.members,
  })

  // ASSERT THE SIDES ARE NOT TRANSPOSED BEFORE FREEZING THEM. `outcome` names
  // SLOTS ('challenger'/'opponent'), not teams, so a swapped write produces a
  // plausible scoreboard naming the wrong winner — and the snapshot makes it
  // permanent. The teamId redundancy against the row's own ids exists precisely
  // so this is detectable; without a check it buys nothing.
  if (
    board.challenger.teamId !== challenge.challengerTeamId ||
    board.opponent.teamId !== challenge.opponentTeamId
  ) {
    throw new Error('challenge sides transposed before freeze')
  }

  await ctx.db.patch(challenge._id, {
    status: 'closed',
    result: {
      challenger: strip(board.challenger),
      opponent: strip(board.opponent),
      outcome: board.outcome,
      closedAt: Date.now(),
    },
  })

  await notifyBothRosters(ctx, challenge, 'closed')
}

/**
 * Push to every consenting member of both teams.
 *
 * SCHEDULED, NEVER AWAITED. deliverTo is a 'use node' action that talks to a
 * push service over the network; awaiting it would let one dead endpoint fail
 * the whole sweep for everybody else. It carries its own 404/410 cleanup and its
 * own single bounded retry, and nothing here adds to either.
 *
 * GATED ON THE PLAYER'S OWN PUSH CONSENT — the same reminderDeliveryMethods
 * array the board-entry and chat sweeps honour. NO PER-FEATURE SETTING IS
 * INVENTED: the app has one Push switch, and delivering to somebody who turned
 * it off is not a defensible reading of it. It matters beyond tidiness, because
 * turning that switch off deletes only the CURRENT browser's subscription row,
 * so a second device's row can outlive the consent.
 *
 * EACH SIDE IS TOLD THE OTHER TEAM'S NAME, never its own.
 */
async function notifyBothRosters(
  ctx: WriterCtx,
  challenge: Doc<'teamChallenges'>,
  event: 'accepted' | 'closed',
): Promise<void> {
  if (challenge.opponentTeamId === undefined) return
  const challenger = await ctx.db.get(challenge.challengerTeamId)
  const opponent = await ctx.db.get(challenge.opponentTeamId)
  if (challenger === null || opponent === null) return

  const sides = [
    { team: challenger, otherName: opponent.name },
    { team: opponent, otherName: challenger.name },
  ]

  for (const { team, otherName } of sides) {
    for (const playerId of team.playerIds) {
      const player = await ctx.db.get(playerId)
      if (player === null) continue
      if (!player.reminderDeliveryMethods.includes('push')) continue

      await ctx.scheduler.runAfter(0, internal.pushSend.deliverTo, {
        playerId,
        attempt: 0,
        notification: {
          // MATCHES THE REMINDER'S AND THE CHAT NOTIFICATION'S title so the
          // three read as one app in the shade; the names go in the body, where
          // the whole line is visible rather than in a title the OS truncates
          // hardest.
          title: 'Wordle Teams',
          body: challengeNotificationBody(event, otherName),
          // A RELATIVE, SAME-ORIGIN PATH, and it has to stay one — the service
          // worker clamps this to its own origin precisely because a URL in a
          // push payload otherwise becomes an open redirect that opens inside
          // the app.
          url: `/team?team=${team._id}`,
        },
      })
    }
  }
}

/**
 * Close every challenge whose window has ended, and expire stale proposals.
 *
 * `today` IS THE SERVER'S DAY, supplied by the sweep. A challenge closes on the
 * day AFTER its endDay, so a window ending on the 31st is still live all of the
 * 31st.
 */
export async function closeDueChallengesFor(
  ctx: WriterCtx,
  today: string,
): Promise<{ closed: number; expired: number }> {
  let closed = 0
  let expired = 0
  const now = Date.now()

  const all = await ctx.db.query('teamChallenges').collect()
  for (const challenge of all) {
    if (challenge.status === 'pending' && challenge.expiresAt <= now) {
      await ctx.db.patch(challenge._id, { status: 'expired' })
      expired += 1
      continue
    }
    if (challenge.status !== 'active') continue
    // ALREADY FROZEN — the idempotence guard.
    if (challenge.result !== undefined) continue
    if (challenge.endDay === undefined || today <= challenge.endDay) continue

    await closeOne(ctx, challenge)
    closed += 1
  }

  return { closed, expired }
}

/**
 * Either owner ends a running challenge early.
 *
 * FREEZES WHAT THE WINDOW HELD rather than discarding it, which is the whole
 * difference from withdraw: this contest was agreed to and played, so it has a
 * result even when it is cut short.
 */
export async function cancelChallengeFor(
  ctx: WriterCtx,
  playerId: Id<'players'>,
  challengeId: Id<'teamChallenges'>,
): Promise<void> {
  const challenge = await ctx.db.get(challengeId)
  if (challenge === null) throw accessError('INVALID_TEAM')
  if (challenge.status !== 'active') throw accessError('CHALLENGE_NOT_ACTIVE')
  if (challenge.opponentTeamId === undefined) throw accessError('CHALLENGE_NOT_ACTIVE')

  // EITHER OWNER. A probe gets NOT_A_MEMBER from the first call it fails.
  const isChallengerOwner = await ctx.db
    .get(challenge.challengerTeamId)
    .then((team) => team?.owner === playerId)
  if (!isChallengerOwner) {
    await requireTeamOwnerFor(ctx, playerId, challenge.opponentTeamId)
  } else {
    await requireTeamOwnerFor(ctx, playerId, challenge.challengerTeamId)
  }

  await closeOne(ctx, challenge)
}

export const cancelChallenge = mutation({
  args: { challengeId: v.id('teamChallenges') },
  handler: async (ctx, { challengeId }) => {
    const player = await requirePlayer(ctx)
    await cancelChallengeFor(ctx, player._id, challengeId)
  },
})
```

Also add the accept-time push — in `activate`, after the `patch`:

```ts
  await notifyBothRosters(ctx, { ...challenge, status: 'active' }, 'accepted')
```

**Note on `collect()` here.** `closeDueChallengesFor` walks the whole table. That is correct at this volume — the table holds at most `MAX_ACTIVE_CHALLENGES` per team and closed rows accumulate slowly — but `crons.ts` records that run count rather than data volume is what grew the bill, and an unbounded daily scan is the shape to watch. File a bd issue to index by status and range-scan if the table passes a few thousand rows.

- [ ] **Step 8b: Wire the ACCEPTANCE push, which until now no task owned**

Spec §8 says `acceptChallenge` "Schedules push to both rosters" and §10 is titled
"push on accept **and** on close" — but Task 7 implements no push and, before this
amendment, neither did any other task. It lands HERE rather than in Task 7 so that
all push plumbing (`notifyBothRosters`, the consent gate, the scheduled-not-awaited
rule) lives in one task and is written once.

In `activate` (added in Task 7), after the patch:

```ts
  // SCHEDULED FROM THE MUTATION, so the decision and the state change commit in
  // the same transaction — see notifyBothRosters on why that matters for
  // duplicate pushes. The doc is re-read because activate takes an id.
  const activated = await ctx.db.get(challengeId)
  if (activated !== null) await notifyBothRosters(ctx, activated, 'accepted')
```

`activate` therefore needs `notifyBothRosters` in scope, which this task defines —
so this step comes after Step 8.

- [ ] **Step 9: Wire it into the existing sweep**

In `convex/teamStats.ts`'s `sweep` handler, after the existing per-team rollup loop and **after** the `sweepsEnabled` gate:

```ts
    // CHALLENGES CLOSE ON THIS SWEEP RATHER THAN ON A CRON OF THEIR OWN
    // (wordle-teams-zic8.2). crons.ts records that this deployment's bill grew
    // with RUN COUNT rather than with data, and that lanes are kept apart
    // deliberately; a daily pass already running just after midnight UTC is
    // exactly the right place and time, so adding a lane would be the wrong
    // trade. It runs AFTER the rollups above so a month that has just ended has
    // its final aggregate before any challenge is frozen against it.
    const challenges = await closeDueChallengesFor(ctx, toPuzzleDay(new Date()))
```

Return it alongside the existing counts so the sweep's result reports it.

- [ ] **Step 10: Run it and confirm it passes**

```bash
TZ=UTC pnpm test:once convex/challenges.test.ts convex/teamStats.test.ts > /tmp/t10b.txt 2>&1; echo "exit=$?"; tail -30 /tmp/t10b.txt
```

Expected: `exit=0`, 45 challenge tests plus the existing teamStats suite.

- [ ] **Step 11: Run all four gates**

```bash
TZ=UTC pnpm test:once > /tmp/g-test.txt 2>&1; echo "test=$?"
pnpm typecheck > /tmp/g-tsc.txt 2>&1; echo "tsc=$?"
pnpm lint > /tmp/g-lint.txt 2>&1; echo "lint=$?"
pnpm build > /tmp/g-build.txt 2>&1; echo "build=$?"
```

Expected: all four `=0`. `pushableModules.test.ts` may assert which modules schedule pushes — if it fails, add `challenges.ts` to its list.

- [ ] **Step 12: Commit**

```bash
git add convex/challenges.ts convex/challenges.test.ts convex/teamStats.ts convex/chatNotify.ts convex/lib/challenge.ts convex/lib/challenge.test.ts
git commit -F - <<'EOF'
feat(zic8.2): close on the daily sweep, idempotently, with push on accept/close

Closing rides crons.daily('team month aggregates') rather than taking a lane of
its own: crons.ts records that this deployment's bill grew with run count rather
than with data, and a daily pass already running just after midnight UTC is the
right place and time.

The idempotence test is the important one - running the close twice must neither
restate the frozen result nor re-notify. The backfill test is the reason the
snapshot exists at all: rewriting the month's aggregate after close must not
move a published result.

Push is scheduled and never awaited, gated on the player's single existing Push
switch with no per-feature setting invented, and always names the opponent
because a team may hold several challenges at once.

chatNotify's claim to be the app's only user-typed push body is now false and is
corrected in place.

<YOUR OWN attribution trailer — see below>
Claude-Session: https://claude.ai/code/session_01J5oECn6C61LEH6aeUMiSA8
EOF
```

---

## Task 11: Team deletion closes challenges

**bd:** child of `zic8.2`, title "team deletion cascades to challenges".

**Files:**
- Modify: `convex/teams.ts` (the delete path)
- Modify: `convex/challenges.ts`
- Modify: `convex/teams.test.ts`

- [ ] **Step 1: Find the delete path**

```bash
grep -n "deleteTeam\|teamMonthStats" convex/teams.ts | head -20
```

- [ ] **Step 2: Write the failing test**

Append to `convex/teams.test.ts`, matching that file's existing setup helpers:

```ts
describe('deleting a team and its challenges', () => {
  test('an active challenge is CLOSED, not deleted, so the survivor keeps its record', async () => {
    const t = convexTest(schema, modules)
    await t.run(async (ctx) => {
      const playerId = await ctx.db.insert('players', aPlayer())
      const doomedId = await ctx.db.insert(
        'teams',
        aTeam({ name: 'Doomed', playerIds: [playerId], owner: playerId }),
      )
      const survivorId = await ctx.db.insert(
        'teams',
        aTeam({ legacyId: 900, name: 'Survivor', playerIds: [playerId], owner: playerId }),
      )
      const challengeId = await ctx.db.insert('teamChallenges', {
        challengerTeamId: survivorId,
        opponentTeamId: doomedId,
        proposedBy: playerId,
        status: 'active',
        startDay: '2026-10-05',
        endDay: '2026-10-31',
        expiresAt: Date.now() + TTL,
        createdAt: Date.now(),
      })

      await closeChallengesForDeletedTeam(ctx, doomedId)

      const doc = await ctx.db.get(challengeId)
      expect(doc).not.toBeNull()
      expect(doc?.status).toBe('closed')
      expect(doc?.result).toBeDefined()
    })
  })

  test('a pending proposal is WITHDRAWN', async () => {
    const t = convexTest(schema, modules)
    await t.run(async (ctx) => {
      const playerId = await ctx.db.insert('players', aPlayer())
      const doomedId = await ctx.db.insert('teams', aTeam({ name: 'Doomed', playerIds: [playerId] }))
      const otherId = await ctx.db.insert('teams', aTeam({ legacyId: 901, name: 'Other' }))
      const challengeId = await ctx.db.insert('teamChallenges', {
        challengerTeamId: doomedId,
        opponentTeamId: otherId,
        proposedBy: playerId,
        status: 'pending',
        expiresAt: Date.now() + TTL,
        createdAt: Date.now(),
      })

      await closeChallengesForDeletedTeam(ctx, doomedId)
      expect((await ctx.db.get(challengeId))?.status).toBe('withdrawn')
    })
  })
})
```

- [ ] **Step 3: Run it and confirm it fails**

```bash
TZ=UTC pnpm test:once convex/teams.test.ts > /tmp/t11.txt 2>&1; echo "exit=$?"; tail -20 /tmp/t11.txt
```

Expected: non-zero exit, `closeChallengesForDeletedTeam is not a function`.

- [ ] **Step 4: Implement**

Append to `convex/challenges.ts`:

```ts
/**
 * Resolve a deleted team's challenges.
 *
 * CLOSED, NOT DELETED, AND THE DISTINCTION MATTERS. teamMonthStats rows beside
 * this are DERIVED and are deleted without ceremony because a lost one costs a
 * recompute and never data. A challenge is not derived — it is a social
 * agreement and a played result — so deleting it would erase the surviving
 * team's record of a contest that really happened.
 *
 * A PENDING PROPOSAL IS WITHDRAWN rather than closed, because it was never
 * agreed to and so has no result to freeze.
 */
export async function closeChallengesForDeletedTeam(
  ctx: WriterCtx,
  teamId: Id<'teams'>,
): Promise<void> {
  for (const challenge of await liveChallengesFor(ctx, teamId)) {
    if (challenge.status === 'pending') {
      await ctx.db.patch(challenge._id, { status: 'withdrawn' })
      continue
    }
    if (challenge.result !== undefined) continue
    await closeOne(ctx, challenge)
  }
}
```

Call it from the team delete path in `convex/teams.ts`, **before** the team document is deleted (the scoreboard needs both team docs to read their names):

```ts
  // BEFORE the team row goes, because closing reads both teams' names.
  await closeChallengesForDeletedTeam(ctx, teamId)
```

- [ ] **Step 5: Run it and confirm it passes**

```bash
TZ=UTC pnpm test:once convex/teams.test.ts convex/challenges.test.ts > /tmp/t11.txt 2>&1; echo "exit=$?"; tail -20 /tmp/t11.txt
```

Expected: `exit=0`.

- [ ] **Step 6: Commit**

```bash
git add convex/challenges.ts convex/teams.ts convex/teams.test.ts
git commit -F - <<'EOF'
feat(zic8.2): team deletion closes challenges rather than deleting them

teamMonthStats rows are derived and are deleted without ceremony because a lost
one costs a recompute and never data. A challenge is not derived - it is a
social agreement and a played result - so deleting it would erase the surviving
team's record of a contest that really happened. Pending proposals are withdrawn
instead, having never been agreed to.

Called before the team row is removed, because closing reads both team names.

<YOUR OWN attribution trailer — see below>
Claude-Session: https://claude.ai/code/session_01J5oECn6C61LEH6aeUMiSA8
EOF
```

---

## Task 12: Team page — the Challenges section

**bd:** child of `zic8.2`, title "team page Challenges section".

**Files:**
- Create: `src/components/challenges/challenge-scoreboard.tsx`
- Create: `src/components/challenges/challenges-section.tsx`
- Create: `src/components/challenges/propose-challenge-dialog.tsx`
- Modify: `src/routes/team.tsx`
- Create: `src/components/challenges/-challenges.hook.test.ts`

- [ ] **Step 1: Read the surrounding patterns before writing anything**

```bash
sed -n '1,80p' src/routes/team.tsx
ls src/components
```

Match the existing component conventions — do not introduce a new styling or data-fetching idiom. `useSuspenseQuery` is the established pattern on this route.

- [ ] **Step 2: Write the failing test**

Components here are testable: 15 `*.hook.test.ts` files run under jsdom, so "edge-runtime, no DOM" is only the default and not a limit. Create `src/components/challenges/-challenges.hook.test.ts`:

```ts
// @vitest-environment jsdom
import { render, screen } from '@testing-library/react'
import { describe, expect, test } from 'vitest'
import { ChallengeScoreboard } from './challenge-scoreboard.tsx'

const side = (teamName: string, average: number | null, boards: number) => ({
  teamId: 'team1' as never,
  teamName,
  boards,
  attempts: Math.round(boards * (average ?? 0)),
  average,
  members: [],
})

describe('ChallengeScoreboard', () => {
  test('shows both averages and both board counts', () => {
    render(
      <ChallengeScoreboard
        challenger={side('Ours', 3.4, 20)}
        opponent={side('Theirs', 4.1, 18)}
        outcome="challenger"
        startDay="2026-10-12"
        viewerIsChallenger
        pro={false}
      />,
    )
    expect(screen.getByText('3.4')).toBeInTheDocument()
    expect(screen.getByText('4.1')).toBeInTheDocument()
    expect(screen.getByText(/20/)).toBeInTheDocument()
    expect(screen.getByText(/18/)).toBeInTheDocument()
  })

  // A TEAM'S FIGURE IS PER-CHALLENGE, because every window starts on its own
  // acceptance day. Without the label a member comparing two scoreboards sees
  // two different averages for their own team and no reason why.
  test('labels the window start', () => {
    render(
      <ChallengeScoreboard
        challenger={side('Ours', 3.4, 20)}
        opponent={side('Theirs', 4.1, 18)}
        outcome="challenger"
        startDay="2026-10-12"
        viewerIsChallenger
        pro={false}
      />,
    )
    expect(screen.getByText(/since/i)).toBeInTheDocument()
  })

  test('a free viewer gets the result but no per-member rows', () => {
    render(
      <ChallengeScoreboard
        challenger={side('Ours', 3.4, 20)}
        opponent={side('Theirs', 4.1, 18)}
        outcome="challenger"
        startDay="2026-10-12"
        viewerIsChallenger
        pro={false}
      />,
    )
    expect(screen.queryByTestId('member-rows')).not.toBeInTheDocument()
  })

  test('a void result says so instead of naming a winner', () => {
    render(
      <ChallengeScoreboard
        challenger={side('Ours', null, 3)}
        opponent={side('Theirs', 4.1, 18)}
        outcome="void"
        startDay="2026-10-12"
        viewerIsChallenger
        pro
      />,
    )
    expect(screen.getByText(/not enough boards/i)).toBeInTheDocument()
  })
})
```

- [ ] **Step 3: Run it and confirm it fails**

```bash
TZ=UTC pnpm test:once src/components/challenges > /tmp/t12.txt 2>&1; echo "exit=$?"; tail -20 /tmp/t12.txt
```

Expected: non-zero exit, unresolved `./challenge-scoreboard.tsx`.

- [ ] **Step 4: Build the three components**

`challenge-scoreboard.tsx` renders one challenge: the two team names, the two averages, the two board counts, the window start ("since 12 Oct"), the outcome, and — only when `pro` — a `data-testid="member-rows"` table of per-member averages. A `void` outcome renders "Not enough boards yet" rather than a winner. Follow the existing component conventions found in Step 1 for styling, and reuse whatever card/table primitives the team page already uses rather than introducing new ones.

`challenges-section.tsx` lists active scoreboards and the head-to-head record, and renders the propose affordance: a button for Pro members, and the existing upgrade path for free members, following `team-picker.tsx`'s pattern of showing the upgrade route rather than a dead control.

`propose-challenge-dialog.tsx` offers the two entry points — pick one of your other teams, or generate a link to copy — calling `proposeToTeam` and `proposeByLink`.

- [ ] **Step 5: Wire the section into `src/routes/team.tsx`**

Add the section using the route's existing `useSuspenseQuery` pattern against `api.challenges.challengesForTeam`.

- [ ] **Step 6: Run it and confirm it passes**

```bash
TZ=UTC pnpm test:once src/components/challenges > /tmp/t12.txt 2>&1; echo "exit=$?"; tail -20 /tmp/t12.txt
```

Expected: `exit=0`, 4 tests passing.

- [ ] **Step 7: Run all four gates**

```bash
TZ=UTC pnpm test:once > /tmp/g-test.txt 2>&1; echo "test=$?"
pnpm typecheck > /tmp/g-tsc.txt 2>&1; echo "tsc=$?"
pnpm lint > /tmp/g-lint.txt 2>&1; echo "lint=$?"
pnpm build > /tmp/g-build.txt 2>&1; echo "build=$?"
```

Expected: all four `=0`.

- [ ] **Step 8: Commit**

```bash
git add src/components/challenges src/routes/team.tsx
git commit -F - <<'EOF'
feat(zic8.2): team page Challenges section

Each scoreboard labels its own window start, because every challenge's window
begins on its own acceptance day - so a team legitimately averages one figure
against one opponent and another against a second, and without the label a
member sees two numbers for their own team and no reason why.

A void result says "not enough boards yet" rather than naming a winner. Free
viewers get both averages, both board counts and the outcome; the per-member
rows are withheld by the server, not hidden in the component.

<YOUR OWN attribution trailer — see below>
Claude-Session: https://claude.ai/code/session_01J5oECn6C61LEH6aeUMiSA8
EOF
```

---

## Task 13: The challenge link route

**bd:** child of `zic8.2`, title "challenge.$token route".

**Files:**
- Create: `src/routes/challenge.$token.tsx`
- Modify: `src/routes/sitemap[.]xml.ts` if it enumerates routes — a tokenised page must not be listed (`wordle-teams-ef9` is the cautionary case: `/maintenance` was in the sitemap and crawlers landed on it)

- [ ] **Step 1: Read the precedent**

```bash
command cat src/routes/join.\$token.tsx
```

`join.$token.tsx` is the proven shape for an unauthenticated arrival at a tokenised path. Mirror it: the sign-in bounce, the loading state, the invalid-token message, and the post-auth resume.

- [ ] **Step 2: Build the route**

The page resolves the token, asks which of the viewer's teams should accept (a picker when they are on several, auto-selected when they are on one), and calls `claimChallengeLink` with the viewer's local `today`. An invalid, expired, or already-claimed token shows one message — holding a dead token must not reveal whether it was ever real.

- [ ] **Step 3: Confirm the route is not in the sitemap**

```bash
grep -rn "challenge" src/routes/sitemap\[.\]xml.ts || echo "not listed - correct"
```

- [ ] **Step 4: Run all four gates**

```bash
TZ=UTC pnpm test:once > /tmp/g-test.txt 2>&1; echo "test=$?"
pnpm typecheck > /tmp/g-tsc.txt 2>&1; echo "tsc=$?"
pnpm lint > /tmp/g-lint.txt 2>&1; echo "lint=$?"
pnpm build > /tmp/g-build.txt 2>&1; echo "build=$?"
```

Expected: all four `=0`. `build` matters most here — a new route changes `routeTree.gen.ts`, which the vite plugin regenerates. Commit the regenerated file.

- [ ] **Step 5: Commit**

```bash
git add src/routes/challenge.\$token.tsx src/routeTree.gen.ts
git commit -F - <<'EOF'
feat(zic8.2): the challenge link claim route

Mirrors join.$token.tsx, the proven shape for an unauthenticated arrival at a
tokenised path. An invalid, expired or already-claimed token shows ONE message,
so holding a dead token does not reveal whether it was ever real. Not added to
the sitemap - see wordle-teams-ef9 for what listing a non-landing route costs.

<YOUR OWN attribution trailer — see below>
Claude-Session: https://claude.ai/code/session_01J5oECn6C61LEH6aeUMiSA8
EOF
```

---

## Task 14: E2E, then the ship gate

**bd:** child of `zic8.2`, title "challenge e2e spec and ship gate".

**Files:**
- Create: `e2e/challenge.spec.ts`

- [ ] **Step 1: Write the spec**

Cover the happy path only: a Pro member proposes to a team they are also on, a member of that team accepts, and the scoreboard renders with both averages. The suite catches behaviour, not render order or responsive geometry, so do not try to assert layout here.

- [ ] **Step 2: Run it in the background — it exceeds the foreground timeout**

The full suite takes ~10.7 minutes against a 10-minute foreground cap, so background it or it dies at the last test with no summary. It needs a Convex backend on :3210; `CONVEX_AGENT_MODE=anonymous` provisions a local one needing no secrets.

**Kill any stale dev server on :3000 first.** Playwright attaches to whatever holds that port, and a days-old vite dev made every run test stale code once already.

```bash
lsof -ti:3000 | xargs -r kill
CONVEX_AGENT_MODE=anonymous pnpm e2e > /tmp/e2e.txt 2>&1
```

Run with `run_in_background: true`. When it finishes, read `/tmp/e2e.txt`.

- [ ] **Step 3: Commit**

```bash
git add e2e/challenge.spec.ts
git commit -F - <<'EOF'
test(zic8.2): e2e happy path for proposing, accepting and scoring a challenge

<YOUR OWN attribution trailer — see below>
Claude-Session: https://claude.ai/code/session_01J5oECn6C61LEH6aeUMiSA8
EOF
```

- [ ] **Step 4: THE SHIP GATE — do not release without this**

`wordle-teams-rac` must be resolved in production first. Its step-4 recompute runs through the same path this scoreboard reads, so repairing it after a challenge has been played restates a finished result (design §3.3).

```bash
bd show wordle-teams-rac
```

If it is not closed, **stop**. The feature may be merged and deployed dark, but no challenge scoreboard may be visible to users. Report this to the owner rather than deciding it.

- [ ] **Step 5: Close the issues**

```bash
bd close <each child id>
bd close wordle-teams-zic8.2
```

A `bd close` committed together with code records the PRE-close state, so commit the bd change on its own and verify. A bd-only commit aborts on the first try — retry once with `||`, never twice unconditionally, and never `--no-verify`.

---

## Self-Review

**Spec coverage.** Every section maps to a task: §3 metric/fairness → Tasks 1-3; §4 data model → Task 4; §5 rules module → Tasks 1-3; §6 snapshot → Tasks 4, 10; §7 the five constants → Task 1 (defined), Tasks 5-7, 10 (enforced); §8 server surface → Tasks 5-9; §8.1 propose-vs-accept checks → Task 7 (four bypass tests); §8.2 record semantics → Task 9; §8.3 deletion cascade → Task 11; §9 close on the sweep → Task 10; §10 push → Task 10; §11 UI → Tasks 12-13; §12 read cost → Task 9 (asserted by the two-document test); §13 testing → throughout; §15 acceptance criteria 1 → Task 14 Step 4.

**Two things deliberately not in a task.** The §8.3 mid-window roster property needs no code — it is what `teamStats` already does — and it is documented in the spec rather than enforced. The §10 push defects (`2dl6`, `i5pj`, `cvvn`) are explicitly out of scope and must not grow a workaround here.

**Type consistency.** `ChallengeTotals` / `ChallengeMemberTotal` / `StatsDay` (Task 2) are used unchanged in Tasks 9-10. `ChallengeOutcome` (Task 3) is the same union as the schema literal union (Task 4) and the `result.outcome` field. `challengeSideValidator` (Task 4) requires `name` as well as `teamId`, and `ChallengeSide` spells that field `teamName` — which is why `closeOne` needs an explicit `strip` that RENAMES it rather than a spread. The snapshot stores the name ON PURPOSE: a rename must not rewrite who a closed challenge was against, and the deletion cascade reads both names before the row goes. **This sentence previously claimed the opposite, as settled fact, because the field was added during Task 4's review and never propagated here — two independent adversarial reviewers ranked that contradiction the single most likely thing to stop a later task.** `meanAttemptsOf` is the only averaging function anywhere; no `teamAverageOf` is ever defined.

**One known gap, filed rather than hidden.** `closeDueChallengesFor` uses `collect()` over the whole table. Correct at this volume, wrong eventually. Task 10 Step 8 says to file the bd issue.
