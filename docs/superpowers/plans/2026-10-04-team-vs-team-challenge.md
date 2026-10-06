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
round trips spent on a line this plan should never have prescribed. **The same now
applies to the `Claude-Session:` line**: the session changed on 2026-10-05, so the
one written below is stale. Use the full trailer your own system reminder gives you,
or the one the controller hands you, and ignore the literal below.

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

  // BOTH OF declineChallengeFor's GUARDS, NEITHER OF WHICH THIS PLAN PINNED.
  // Measured by the Task 8 implementer: deleting either one left all 55 of this
  // plan's tests green. The status guard is the serious one — without it any
  // member of the opponent team could "decline" a LIVE contest and flip it to
  // 'declined', ending a running challenge as though it were never agreed to.
  test('an ACTIVE challenge cannot be declined', async () => {
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
      await expect(declineChallengeFor(ctx, accepterId, id)).rejects.toMatchObject({
        data: { code: 'CHALLENGE_NOT_PENDING' },
      })
      // THE SECOND ASSERTION IS THE POINT: refused, and the row untouched.
      expect((await ctx.db.get(id))?.status).toBe('active')
    })
  })

  // A link proposal has no opponent bound, so there is no team whose member could
  // decline it. Refused with an accessError rather than crashing inside the
  // membership lookup on an undefined id.
  test('a link proposal with no opponent cannot be declined', async () => {
    const t = convexTest(schema, modules)
    await t.run(async (ctx) => {
      const { playerId, challengerTeamId } = await seedTwoTeams(ctx)
      const { accepterId } = await seedAccepter(ctx)
      const id = await ctx.db.insert('teamChallenges', {
        challengerTeamId,
        proposedBy: playerId,
        status: 'pending',
        expiresAt: Date.now() + TTL,
        createdAt: Date.now(),
      })
      await expect(declineChallengeFor(ctx, accepterId, id)).rejects.toMatchObject({
        data: { code: 'INVALID_TEAM' },
      })
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

Expected: `exit=0`, **57** tests in `convex/challenges.test.ts` and **4162** in the full suite.

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

## Task 9: The live scoreboard query, the head-to-head record, and the Pro gate

**bd:** `wordle-teams-zic8.2.9`, "challengesForTeam query and scoreboard projection".

**Files:**
- Modify: `convex/challenges.ts`
- Modify: `convex/challenges.test.ts`
- Modify: `convex/access.ts` — one new `AccessCode`
- Modify: `src/lib/convex-error.ts` — **BOTH halves** for that code; see the Ground Rule. The `typedCodeMessage` half is compiler-enforced, the `convexErrorCode` half is not.

**THIS TASK WAS REWRITTEN BEFORE EXECUTION (2026-10-05) from the zic8.2.16 review.**
What changed, so a reader holding the old text knows which parts not to trust:

- `statsDaysFor` returned `Array<StatsDay>`, which defaults `PlayerId` to `string` and
  ERASES the `Id<'players'>` branding — typecheck fails in `sideFrom`, while the
  comment three lines below said no cast was needed. It now carries
  `StatsDay<Id<'players'>>` and `ChallengeTotals<Id<'players'>>` explicitly.
- `CHALLENGE_NOT_ACTIVE` was added to `access.ts` with no `convex-error.ts` step.
- The head-to-head record was written, tested and UNREACHABLE: `challengesForTeam`
  never returned it, while Task 12 and spec §11 both consume it. `recordAgainstFor`
  (one opponent, re-scanning every closed row per call) is replaced by
  `headToHeadFor`, which collects the closed set ONCE and tallies per opponent.
- The Pro gate lived inside the `query({...})` wrapper, where nothing can execute it
  (wordle-teams-obw), and the task had zero tests for it. It now lives in
  `challengesForTeamFor`, which is tested; the wrapper is two lines.
- `pending` was returned as raw `Doc`s — shipping the link `token` to every member of
  the challenging team and carrying no team names for Task 12 to label rows with. It
  is now an explicit projection with no token and no numbers (AC3).
- Tests hardcoded the board floor (`12`, `3`). They now derive from
  `MIN_CHALLENGE_BOARDS` and test BOTH sides of it at the query level.
- A comment called the `outcomeOf` argument order "the one defect no test in this
  feature can catch". The first scoreboard test catches it; the comment was false.
  There are now tests in both directions and the comment names them.
- Spec §13's `ChallengeOutcome` type-equality assertion existed nowhere. It is a test
  here.

**AFTER EXECUTION, the code diverges from the blocks below in two places**, both from
the Task 9 review: `statsDaysFor` walks EVERY month from start to end with `addMonths`
(it read only the two ends, while its comment claimed full enumeration), and
`ChallengeScoreboard` carries the narrowed `startDay`/`endDay`, which the page rows
now take from the board rather than from the `string | undefined` doc fields. Two tests
pin them. `convex/challenges.ts` is authoritative.

**THE TEST EXPECTATIONS ARE THE SPECIFICATION.** If a test below disagrees with the
implementation below, REPORT the mismatch — do not edit the test to agree.

- [ ] **Step 0: Record the baseline**

```bash
TZ=UTC pnpm test:once > /tmp/t9-base.txt 2>&1; echo "exit=$?"; rg 'Tests +[0-9]+' /tmp/t9-base.txt
```

Write down the total. Step 5 is checked as a DELTA against it, never against an
absolute number: absolute predictions in this plan have drifted every task, and three
suites generate one test per git-tracked file.

- [ ] **Step 1: Write the failing tests**

Extend the imports AT THE TOP of `convex/challenges.test.ts` — do not add `import`
lines mid-file:

```ts
import { afterEach, beforeEach, describe, expect, expectTypeOf, test, vi } from 'vitest'
// add to the existing ./challenges.ts import:
//   challengeScoreboardFor, challengesForTeamFor, headToHeadFor
import { MAX_ACTIVE_CHALLENGES, MIN_CHALLENGE_BOARDS, PROPOSAL_TTL_DAYS } from './lib/challenge.ts'
import type { ChallengeOutcome } from './lib/challenge.ts'
import type { DataModel, Doc, Id } from './_generated/dataModel'
```

Then append:

```ts
type SeedDay = { puzzleDay: string; entries: Array<{ playerId: Id<'players'>; attempts: number }> }

/** One teamMonthStats document. `members` is left empty: the projection reads days[] only. */
async function seedStats(
  ctx: Ctx,
  teamId: Id<'teams'>,
  month: { year: number; month: number },
  days: Array<SeedDay>,
) {
  await ctx.db.insert('teamMonthStats', {
    teamId,
    year: month.year,
    month: month.month,
    members: [],
    days,
    computedAt: Date.now(),
  })
}

const OCTOBER = { year: 2026, month: 10 }

/**
 * `count` boards of `attempts` each for one player, on consecutive October days
 * from the 5th. The window under test starts on the 5th, so every one is inside it.
 */
function octoberDays(playerId: Id<'players'>, attempts: number, count: number): Array<SeedDay> {
  // 5 + count - 1 must stay a real October day. MIN_CHALLENGE_BOARDS is 10 today;
  // if it ever passes 25 this helper needs a second month, and should say so loudly.
  if (count > 27) throw new Error('octoberDays: count runs past October 31')
  return Array.from({ length: count }, (_, i) => ({
    puzzleDay: `2026-10-${String(i + 5).padStart(2, '0')}`,
    entries: [{ playerId, attempts }],
  }))
}

/** Comfortably above the floor, derived rather than written as 12. */
const ENOUGH = MIN_CHALLENGE_BOARDS + 2

async function seedActive(
  ctx: Ctx,
  challengerTeamId: Id<'teams'>,
  opponentTeamId: Id<'teams'>,
  proposedBy: Id<'players'>,
  window = { startDay: '2026-10-05', endDay: '2026-10-31' },
) {
  const id = await ctx.db.insert('teamChallenges', {
    challengerTeamId,
    opponentTeamId,
    proposedBy,
    status: 'active',
    ...window,
    expiresAt: Date.now() + TTL,
    createdAt: Date.now(),
  })
  return (await ctx.db.get(id))!
}

describe('challengeScoreboardFor', () => {
  // BOTH DIRECTIONS, AND THAT IS WHAT PINS THE ARGUMENT ORDER. outcomeOf's two
  // parameters are structurally identical, so a transposed call compiles. These
  // two tests are the only thing that sees it at the query level.
  test('the lower average wins: challenger 3 against opponent 4', async () => {
    const t = convexTest(schema, modules)
    await t.run(async (ctx) => {
      const { playerId, challengerTeamId } = await seedTwoTeams(ctx)
      const { accepterId, theirTeamId } = await seedAccepter(ctx)
      await seedStats(ctx, challengerTeamId, OCTOBER, octoberDays(playerId, 3, ENOUGH))
      await seedStats(ctx, theirTeamId, OCTOBER, octoberDays(accepterId, 4, ENOUGH))

      const board = await challengeScoreboardFor(
        ctx,
        await seedActive(ctx, challengerTeamId, theirTeamId, playerId),
      )
      expect(board.challenger).toMatchObject({
        teamId: challengerTeamId,
        teamName: 'Challengers',
        boards: ENOUGH,
        attempts: 3 * ENOUGH,
        average: 3,
      })
      expect(board.opponent).toMatchObject({ teamId: theirTeamId, teamName: 'Theirs', average: 4 })
      expect(board.outcome).toBe('challenger')
    })
  })

  test('the lower average wins: challenger 4 against opponent 3', async () => {
    const t = convexTest(schema, modules)
    await t.run(async (ctx) => {
      const { playerId, challengerTeamId } = await seedTwoTeams(ctx)
      const { accepterId, theirTeamId } = await seedAccepter(ctx)
      await seedStats(ctx, challengerTeamId, OCTOBER, octoberDays(playerId, 4, ENOUGH))
      await seedStats(ctx, theirTeamId, OCTOBER, octoberDays(accepterId, 3, ENOUGH))

      const board = await challengeScoreboardFor(
        ctx,
        await seedActive(ctx, challengerTeamId, theirTeamId, playerId),
      )
      expect(board.outcome).toBe('opponent')
    })
  })

  test('a side exactly AT the board floor is judged', async () => {
    const t = convexTest(schema, modules)
    await t.run(async (ctx) => {
      const { playerId, challengerTeamId } = await seedTwoTeams(ctx)
      const { accepterId, theirTeamId } = await seedAccepter(ctx)
      await seedStats(ctx, challengerTeamId, OCTOBER, octoberDays(playerId, 3, ENOUGH))
      await seedStats(ctx, theirTeamId, OCTOBER, octoberDays(accepterId, 4, MIN_CHALLENGE_BOARDS))

      const board = await challengeScoreboardFor(
        ctx,
        await seedActive(ctx, challengerTeamId, theirTeamId, playerId),
      )
      expect(board.opponent.boards).toBe(MIN_CHALLENGE_BOARDS)
      expect(board.outcome).toBe('challenger')
    })
  })

  test('a side one board BELOW the floor makes the result void', async () => {
    const t = convexTest(schema, modules)
    await t.run(async (ctx) => {
      const { playerId, challengerTeamId } = await seedTwoTeams(ctx)
      const { accepterId, theirTeamId } = await seedAccepter(ctx)
      await seedStats(ctx, challengerTeamId, OCTOBER, octoberDays(playerId, 3, ENOUGH))
      await seedStats(ctx, theirTeamId, OCTOBER, octoberDays(accepterId, 4, MIN_CHALLENGE_BOARDS - 1))

      const board = await challengeScoreboardFor(
        ctx,
        await seedActive(ctx, challengerTeamId, theirTeamId, playerId),
      )
      expect(board.outcome).toBe('void')
    })
  })

  test('boards before startDay are excluded — the retroactivity guard, end to end', async () => {
    const t = convexTest(schema, modules)
    await t.run(async (ctx) => {
      const { playerId, challengerTeamId } = await seedTwoTeams(ctx)
      const { accepterId, theirTeamId } = await seedAccepter(ctx)
      await seedStats(ctx, challengerTeamId, OCTOBER, [
        { puzzleDay: '2026-10-01', entries: [{ playerId, attempts: 1 }] },
        { puzzleDay: '2026-10-04', entries: [{ playerId, attempts: 1 }] },
        ...octoberDays(playerId, 3, ENOUGH),
      ])
      await seedStats(ctx, theirTeamId, OCTOBER, octoberDays(accepterId, 4, ENOUGH))

      const board = await challengeScoreboardFor(
        ctx,
        await seedActive(ctx, challengerTeamId, theirTeamId, playerId),
      )
      expect(board.challenger.boards).toBe(ENOUGH)
      expect(board.challenger.average).toBe(3) // not pulled down by the 1-attempt days
    })
  })

  test('reads BOTH monthly documents when the window crosses a month', async () => {
    const t = convexTest(schema, modules)
    await t.run(async (ctx) => {
      const { playerId, challengerTeamId } = await seedTwoTeams(ctx)
      const { accepterId, theirTeamId } = await seedAccepter(ctx)
      await seedStats(ctx, challengerTeamId, OCTOBER, [
        { puzzleDay: '2026-10-28', entries: [{ playerId, attempts: 3 }] },
      ])
      await seedStats(ctx, challengerTeamId, { year: 2026, month: 11 }, [
        { puzzleDay: '2026-11-01', entries: [{ playerId, attempts: 5 }] },
      ])
      await seedStats(ctx, theirTeamId, { year: 2026, month: 11 }, [
        { puzzleDay: '2026-11-01', entries: [{ playerId: accepterId, attempts: 5 }] },
      ])

      const board = await challengeScoreboardFor(
        ctx,
        await seedActive(ctx, challengerTeamId, theirTeamId, playerId, {
          startDay: '2026-10-28',
          endDay: '2026-11-30',
        }),
      )
      // 3 + 5 over two boards: one from EACH document. Reading only the start
      // month gives 1 board / 3 attempts; only the end month, 1 board / 5.
      expect(board.challenger.boards).toBe(2)
      expect(board.challenger.attempts).toBe(8)
      // The opponent has no October document at all — absent, not an error.
      expect(board.opponent.boards).toBe(1)
    })
  })

  test('a missing monthly document is zero boards, not a throw', async () => {
    const t = convexTest(schema, modules)
    await t.run(async (ctx) => {
      const { playerId, challengerTeamId } = await seedTwoTeams(ctx)
      const { theirTeamId } = await seedAccepter(ctx)
      const board = await challengeScoreboardFor(
        ctx,
        await seedActive(ctx, challengerTeamId, theirTeamId, playerId),
      )
      expect(board.challenger.boards).toBe(0)
      expect(board.challenger.average).toBeNull()
      expect(board.challenger.members).toEqual([])
      expect(board.outcome).toBe('void')
    })
  })

  test('member rows lead with the lowest average, and more boards break a tie', async () => {
    const t = convexTest(schema, modules)
    await t.run(async (ctx) => {
      const { playerId, challengerTeamId } = await seedTwoTeams(ctx)
      const { theirTeamId } = await seedAccepter(ctx)
      const second = await ctx.db.insert('players', aPlayer({ email: 'second@example.com' }))
      const third = await ctx.db.insert('players', aPlayer({ email: 'third@example.com' }))
      // FIRST-SEEN ORDER IS playerId, second, third — the order teamTotalsOver
      // emits. Expected is third, second, playerId: a missing sort gives the
      // first-seen order, and a reversed tiebreak gives third, playerId, second,
      // so neither can pass.
      //   playerId: 4,4      -> 4.0 over 2
      //   second:   4,4,4    -> 4.0 over 3   (ties playerId, more boards)
      //   third:    3        -> 3.0 over 1   (lowest average)
      await seedStats(ctx, challengerTeamId, OCTOBER, [
        { puzzleDay: '2026-10-05', entries: [{ playerId, attempts: 4 }, { playerId: second, attempts: 4 }] },
        { puzzleDay: '2026-10-06', entries: [{ playerId, attempts: 4 }, { playerId: second, attempts: 4 }] },
        { puzzleDay: '2026-10-07', entries: [{ playerId: second, attempts: 4 }, { playerId: third, attempts: 3 }] },
      ])

      const board = await challengeScoreboardFor(
        ctx,
        await seedActive(ctx, challengerTeamId, theirTeamId, playerId),
      )
      expect(board.challenger.members.map((m) => m.playerId)).toEqual([third, second, playerId])
      expect(board.challenger.members[0]).toEqual({ playerId: third, boards: 1, attempts: 3, average: 3 })
    })
  })

  test('a challenge that is not active is refused with CHALLENGE_NOT_ACTIVE', async () => {
    const t = convexTest(schema, modules)
    await t.run(async (ctx) => {
      const { playerId, challengerTeamId } = await seedTwoTeams(ctx)
      const { theirTeamId } = await seedAccepter(ctx)
      // A CLOSED ROW STILL HAS ITS WINDOW AND ITS OPPONENT. So this is refused
      // by the status check and nothing else — a pending row with no startDay
      // would be refused by the narrowing below it too, and could not tell the
      // two apart. (Cancel is not a status: a cancelled challenge is 'closed'.)
      const active = await seedActive(ctx, challengerTeamId, theirTeamId, playerId)
      await ctx.db.patch(active._id, { status: 'closed' })
      await expect(
        challengeScoreboardFor(ctx, (await ctx.db.get(active._id))!),
      ).rejects.toMatchObject({ data: { code: 'CHALLENGE_NOT_ACTIVE' } })
    })
  })

  test('an active challenge whose team row is gone is refused with INVALID_TEAM', async () => {
    const t = convexTest(schema, modules)
    await t.run(async (ctx) => {
      const { playerId, challengerTeamId } = await seedTwoTeams(ctx)
      const { theirTeamId } = await seedAccepter(ctx)
      const active = await seedActive(ctx, challengerTeamId, theirTeamId, playerId)
      // UNREACHABLE ONCE TASK 11 CLOSES A TEAM'S CHALLENGES BEFORE DELETING IT.
      // Pinned so the guard is a known refusal rather than a crash on a null
      // team's `.name` if that ordering is ever lost.
      await ctx.db.delete(theirTeamId)
      await expect(challengeScoreboardFor(ctx, active)).rejects.toMatchObject({
        data: { code: 'INVALID_TEAM' },
      })
    })
  })
})

/** A closed row with a result, from challengerTeamId's point of view as the challenger. */
function closedRow(
  challengerTeamId: Id<'teams'>,
  opponentTeamId: Id<'teams'>,
  proposedBy: Id<'players'>,
  outcome: ChallengeOutcome,
  { challengerName = 'Challengers', opponentName = 'Theirs', closedAt = Date.now() } = {},
) {
  return {
    challengerTeamId,
    opponentTeamId,
    proposedBy,
    status: 'closed' as const,
    startDay: '2026-10-05',
    endDay: '2026-10-31',
    expiresAt: Date.now(),
    createdAt: Date.now(),
    result: {
      challenger: { teamId: challengerTeamId, name: challengerName, boards: ENOUGH, attempts: 3 * ENOUGH, average: 3, members: [] },
      opponent: { teamId: opponentTeamId, name: opponentName, boards: ENOUGH, attempts: 4 * ENOUGH, average: 4, members: [] },
      outcome,
      closedAt,
    },
  }
}

describe('headToHeadFor', () => {
  test('void counts as neither a win nor a loss', async () => {
    const t = convexTest(schema, modules)
    await t.run(async (ctx) => {
      const { playerId, challengerTeamId } = await seedTwoTeams(ctx)
      const { theirTeamId } = await seedAccepter(ctx)
      for (const outcome of ['challenger', 'opponent', 'tie', 'void'] as const) {
        await ctx.db.insert('teamChallenges', closedRow(challengerTeamId, theirTeamId, playerId, outcome))
      }

      expect(await headToHeadFor(ctx, challengerTeamId)).toEqual([
        {
          opponentTeamId: theirTeamId,
          opponentName: 'Theirs',
          record: { won: 1, lost: 1, tied: 1, noResult: 1 },
        },
      ])
    })
  })

  test("the record is from the VIEWING team's side", async () => {
    const t = convexTest(schema, modules)
    await t.run(async (ctx) => {
      const { playerId, challengerTeamId } = await seedTwoTeams(ctx)
      const { theirTeamId } = await seedAccepter(ctx)
      await ctx.db.insert('teamChallenges', closedRow(challengerTeamId, theirTeamId, playerId, 'challenger'))

      expect(await headToHeadFor(ctx, challengerTeamId)).toEqual([
        { opponentTeamId: theirTeamId, opponentName: 'Theirs', record: { won: 1, lost: 0, tied: 0, noResult: 0 } },
      ])
      // From the other side the same row is a loss, labelled with the OTHER name.
      expect(await headToHeadFor(ctx, theirTeamId)).toEqual([
        { opponentTeamId: challengerTeamId, opponentName: 'Challengers', record: { won: 0, lost: 1, tied: 0, noResult: 0 } },
      ])
    })
  })

  test('each opponent gets its own tally', async () => {
    const t = convexTest(schema, modules)
    await t.run(async (ctx) => {
      const { playerId, challengerTeamId, opponentTeamId } = await seedTwoTeams(ctx)
      const { theirTeamId } = await seedAccepter(ctx)
      // OLDER INSERTED FIRST. The index returns rows in creation order, so
      // inserting newest-first would make the Map's insertion order already
      // match the expected order and a deleted sort would pass unnoticed.
      await ctx.db.insert(
        'teamChallenges',
        closedRow(challengerTeamId, opponentTeamId, playerId, 'opponent', { opponentName: 'Opponents', closedAt: 1000 }),
      )
      await ctx.db.insert(
        'teamChallenges',
        closedRow(challengerTeamId, theirTeamId, playerId, 'challenger', { closedAt: 2000 }),
      )

      // MOST RECENTLY PLAYED FIRST.
      expect(await headToHeadFor(ctx, challengerTeamId)).toEqual([
        { opponentTeamId: theirTeamId, opponentName: 'Theirs', record: { won: 1, lost: 0, tied: 0, noResult: 0 } },
        { opponentTeamId, opponentName: 'Opponents', record: { won: 0, lost: 1, tied: 0, noResult: 0 } },
      ])
    })
  })

  test('the label is the name from the most recent close, not the first one found', async () => {
    const t = convexTest(schema, modules)
    await t.run(async (ctx) => {
      const { playerId, challengerTeamId } = await seedTwoTeams(ctx)
      const { theirTeamId } = await seedAccepter(ctx)
      // THREE ROWS, NEWEST IN THE MIDDLE. Rows come back in creation order, so
      // first-found is 'Original', last-found is 'Interim' and most recent is
      // 'Renamed' — all three disagree. With two rows, one insertion order lets
      // first-found-wins pass and the other lets last-found-wins pass; each
      // mutant survived one version of this test.
      for (const [opponentName, closedAt] of [['Original', 1000], ['Renamed', 3000], ['Interim', 2000]] as const) {
        await ctx.db.insert(
          'teamChallenges',
          closedRow(challengerTeamId, theirTeamId, playerId, 'tie', { opponentName, closedAt }),
        )
      }

      const [entry] = await headToHeadFor(ctx, challengerTeamId)
      expect(entry.opponentName).toBe('Renamed')
      expect(entry.record.tied).toBe(3)
    })
  })

  test("an 'opponent' outcome is a win for the team that was challenged", async () => {
    const t = convexTest(schema, modules)
    await t.run(async (ctx) => {
      const { playerId, challengerTeamId } = await seedTwoTeams(ctx)
      const { theirTeamId } = await seedAccepter(ctx)
      await ctx.db.insert('teamChallenges', closedRow(challengerTeamId, theirTeamId, playerId, 'opponent'))

      expect(await headToHeadFor(ctx, theirTeamId)).toEqual([
        { opponentTeamId: challengerTeamId, opponentName: 'Challengers', record: { won: 1, lost: 0, tied: 0, noResult: 0 } },
      ])
    })
  })

  test('a closed row with no result is skipped, and live rows are never counted', async () => {
    const t = convexTest(schema, modules)
    await t.run(async (ctx) => {
      const { playerId, challengerTeamId } = await seedTwoTeams(ctx)
      const { theirTeamId } = await seedAccepter(ctx)
      // SPEC §13: result-present <=> status-closed is load-bearing and not
      // expressible in the schema. A row breaking it must vanish from the record,
      // not appear as an opponent with an all-zero tally.
      await ctx.db.insert('teamChallenges', {
        challengerTeamId,
        opponentTeamId: theirTeamId,
        proposedBy: playerId,
        status: 'closed',
        startDay: '2026-10-05',
        endDay: '2026-10-31',
        expiresAt: Date.now(),
        createdAt: Date.now(),
      })
      await seedActive(ctx, challengerTeamId, theirTeamId, playerId)

      expect(await headToHeadFor(ctx, challengerTeamId)).toEqual([])
    })
  })
})

describe('challengesForTeamFor', () => {
  test('a free member gets both averages, both board counts and the outcome — and no member rows', async () => {
    const t = convexTest(schema, modules)
    await t.run(async (ctx) => {
      const { playerId, challengerTeamId } = await seedTwoTeams(ctx, { pro: false })
      const { accepterId, theirTeamId } = await seedAccepter(ctx)
      await seedStats(ctx, challengerTeamId, OCTOBER, octoberDays(playerId, 3, ENOUGH))
      await seedStats(ctx, theirTeamId, OCTOBER, octoberDays(accepterId, 4, ENOUGH))
      const challenge = await seedActive(ctx, challengerTeamId, theirTeamId, playerId)

      const view = await challengesForTeamFor(ctx, playerId, challengerTeamId)
      expect(view.pro).toBe(false)
      expect(view.active).toHaveLength(1)
      const [row] = view.active
      expect(row).toMatchObject({
        challengeId: challenge._id,
        startDay: '2026-10-05',
        endDay: '2026-10-31',
        viewerIsChallenger: true,
      })
      expect(row.challenger).toMatchObject({ boards: ENOUGH, average: 3, members: [] })
      expect(row.opponent).toMatchObject({ boards: ENOUGH, average: 4, members: [] })
      expect(row.outcome).toBe('challenger')
    })
  })

  test('a Pro member gets the member rows on both sides', async () => {
    const t = convexTest(schema, modules)
    await t.run(async (ctx) => {
      const { playerId, challengerTeamId } = await seedTwoTeams(ctx)
      const { accepterId, theirTeamId } = await seedAccepter(ctx)
      await seedStats(ctx, challengerTeamId, OCTOBER, octoberDays(playerId, 3, ENOUGH))
      await seedStats(ctx, theirTeamId, OCTOBER, octoberDays(accepterId, 4, ENOUGH))
      await seedActive(ctx, challengerTeamId, theirTeamId, playerId)

      const view = await challengesForTeamFor(ctx, playerId, challengerTeamId)
      expect(view.pro).toBe(true)
      expect(view.active[0].challenger.members.map((m) => m.playerId)).toEqual([playerId])
      expect(view.active[0].opponent.members.map((m) => m.playerId)).toEqual([accepterId])
    })
  })

  test('viewed from the challenged team, the viewer is not the challenger', async () => {
    const t = convexTest(schema, modules)
    await t.run(async (ctx) => {
      const { playerId, challengerTeamId } = await seedTwoTeams(ctx)
      const { accepterId, theirTeamId } = await seedAccepter(ctx)
      const challenge = await seedActive(ctx, challengerTeamId, theirTeamId, playerId)

      const view = await challengesForTeamFor(ctx, accepterId, theirTeamId)
      expect(view.active).toHaveLength(1)
      expect(view.active[0]).toMatchObject({ challengeId: challenge._id, viewerIsChallenger: false })
    })
  })

  test('a non-member is refused with NOT_A_MEMBER', async () => {
    const t = convexTest(schema, modules)
    await t.run(async (ctx) => {
      const { challengerTeamId } = await seedTwoTeams(ctx)
      const { accepterId } = await seedAccepter(ctx)
      await expect(
        challengesForTeamFor(ctx, accepterId, challengerTeamId),
      ).rejects.toMatchObject({ data: { code: 'NOT_A_MEMBER' } })
    })
  })

  test('an incoming proposal is labelled, carries no numbers, and no token', async () => {
    const t = convexTest(schema, modules)
    await t.run(async (ctx) => {
      const { playerId, challengerTeamId } = await seedTwoTeams(ctx)
      const { accepterId, theirTeamId } = await seedAccepter(ctx)
      const expiresAt = Date.now() + TTL
      const challengeId = await ctx.db.insert('teamChallenges', {
        challengerTeamId,
        opponentTeamId: theirTeamId,
        proposedBy: playerId,
        status: 'pending',
        expiresAt,
        createdAt: Date.now(),
      })

      const view = await challengesForTeamFor(ctx, accepterId, theirTeamId)
      // toEqual, NOT toMatchObject: an EXACT shape, so a field added later — a
      // token, a board count — fails here rather than shipping. AC3: nothing
      // numeric about either team renders before acceptance.
      expect(view.pending).toEqual([
        {
          challengeId,
          direction: 'incoming',
          otherTeamName: 'Challengers',
          isLink: false,
          expiresAt,
          proposedByViewer: false,
        },
      ])
      expect(view.active).toEqual([])
    })
  })

  test('an outgoing link proposal has no opponent name and does not re-ship its token', async () => {
    const t = convexTest(schema, modules)
    await t.run(async (ctx) => {
      const { playerId, challengerTeamId } = await seedTwoTeams(ctx)
      const token = await proposeByLinkFor(ctx, playerId, challengerTeamId)

      const view = await challengesForTeamFor(ctx, playerId, challengerTeamId)
      expect(view.pending).toHaveLength(1)
      expect(view.pending[0]).toMatchObject({
        direction: 'outgoing',
        otherTeamName: null,
        isLink: true,
        proposedByViewer: true,
      })
      expect(JSON.stringify(view)).not.toContain(token)
    })
  })

  test('the head-to-head record is part of the answer', async () => {
    const t = convexTest(schema, modules)
    await t.run(async (ctx) => {
      const { playerId, challengerTeamId } = await seedTwoTeams(ctx)
      const { theirTeamId } = await seedAccepter(ctx)
      await ctx.db.insert('teamChallenges', closedRow(challengerTeamId, theirTeamId, playerId, 'void'))

      const view = await challengesForTeamFor(ctx, playerId, challengerTeamId)
      expect(view.records).toEqual([
        { opponentTeamId: theirTeamId, opponentName: 'Theirs', record: { won: 0, lost: 0, tied: 0, noResult: 1 } },
      ])
    })
  })
})

// SPEC §13. ChallengeOutcome is declared twice — a TS union in lib/challenge.ts
// and four v.literals in schema.ts — and lib/challenge.ts must stay import-free,
// so the duplication is unavoidable. This makes the drift a TYPECHECK failure.
// It is a no-op at runtime: `pnpm typecheck` is what kills its mutant, not vitest.
test('ChallengeOutcome is exactly the schema result.outcome union', () => {
  expectTypeOf<ChallengeOutcome>().toEqualTypeOf<
    NonNullable<Doc<'teamChallenges'>['result']>['outcome']
  >()
})
```

- [ ] **Step 2: Run it and confirm it fails**

```bash
TZ=UTC pnpm test:once convex/challenges.test.ts > /tmp/t9.txt 2>&1; echo "exit=$?"; tail -20 /tmp/t9.txt
```

Expected: non-zero exit; `challengeScoreboardFor is not a function` (or the file
failing to import the three missing exports).

- [ ] **Step 3: Add the access code — BOTH files**

`convex/access.ts`, at the end of the zic8.2 block, and extend that block's comment
with one sentence: "CHALLENGE_NOT_ACTIVE is a scoreboard asked of a challenge that is
not running."

```ts
  | 'CHALLENGE_NOT_ACTIVE'
```

`src/lib/convex-error.ts` — BOTH halves:

1. `convexErrorCode`: append `|| code === 'CHALLENGE_NOT_ACTIVE'` after
   `CHALLENGE_LINK_INVALID`. **No compiler checks this half.** Miss it and the copy
   below is unreachable.
2. `typedCodeMessage`: a case before `default`:

```ts
    case 'CHALLENGE_NOT_ACTIVE':
      return "That challenge isn't running."
```

- [ ] **Step 4: Write the implementation**

In `convex/challenges.ts`: add `query` to the `./_generated/server` import; extend
the `./lib/challenge.ts` import with `outcomeOf`, `teamTotalsOver` and
`type ChallengeOutcome, type ChallengeTotals, type StatsDay`; add `meanAttemptsOf`
from `./lib/teamStats.ts` and `monthOf` from `./lib/puzzleDay.ts`. Then append:

```ts
export type ChallengeMemberRow = {
  playerId: Id<'players'>
  boards: number
  attempts: number
  average: number | null
}

export type ChallengeSide = {
  teamId: Id<'teams'>
  teamName: string
  boards: number
  attempts: number
  average: number | null
  members: Array<ChallengeMemberRow>
}

export type ChallengeScoreboard = {
  challenger: ChallengeSide
  opponent: ChallengeSide
  outcome: ChallengeOutcome
}

/**
 * Every monthly document a window touches, for one team, flattened to days[].
 *
 * ONE DOCUMENT IN THE ORDINARY CASE AND TWO UNDER THE SHORT-WINDOW RULE, which
 * is the only way a window crosses a month boundary. Months are enumerated from
 * the window rather than guessed, so a window that grows later cannot silently
 * read a month short.
 *
 * THE RETURN TYPE NAMES Id<'players'> AND MUST. StatsDay's PlayerId defaults to
 * `string`, so a bare Array<StatsDay> compiles here and then erases the branding
 * for everything downstream — teamTotalsOver infers PlayerId from this array,
 * and sideFrom's playerId stops being an Id. The doc's own days[] type is
 * already branded; this annotation is what keeps it so.
 */
async function statsDaysFor(
  ctx: ReaderCtx,
  teamId: Id<'teams'>,
  startDay: string,
  endDay: string,
): Promise<Array<StatsDay<Id<'players'>>>> {
  const months = new Set([monthOf(startDay), monthOf(endDay)])
  const days: Array<StatsDay<Id<'players'>>> = []
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
    //
    // THE SAME PROPERTY IS A HAZARD FOR TEAM DELETION (Task 11): a cascade that
    // removes teamMonthStats before closing the team's challenges gets a
    // silently ZEROED, 'void' snapshot from here, never an error.
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
 * leads, and break ties on boards played to match the outcome rule.
 *
 * THE NULL BRANCHES ARE UNREACHABLE TODAY: teamTotalsOver creates a member only
 * from an entry, so every member has boards >= 1 and a non-null average. They
 * are kept because meanAttemptsOf's type says null, and a null must never sort
 * as 0 — a member who did not play would appear to have won. Their mutants
 * SURVIVE the suite, as outcomeOf's identical null guard does; that is expected.
 */
function sideFrom(
  teamId: Id<'teams'>,
  teamName: string,
  totals: ChallengeTotals<Id<'players'>>,
): ChallengeSide {
  return {
    teamId,
    teamName,
    boards: totals.boards,
    attempts: totals.attempts,
    average: meanAttemptsOf(totals),
    // NO `as Id<'players'>` CAST, and none is needed: `totals` is
    // ChallengeTotals<Id<'players'>> because statsDaysFor's return type says so.
    // If you find yourself adding a cast here, that annotation has been lost —
    // fix it there, because a cast is where an Id for the wrong table slips in.
    members: totals.members
      .map((m) => ({
        playerId: m.playerId,
        boards: m.boards,
        attempts: m.attempts,
        average: meanAttemptsOf(m),
      }))
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
 *
 * ACTIVE ONLY. A closed challenge's numbers are its frozen `result`; recomputing
 * one live would let a backfilled board restate a finished contest. Task 10's
 * close calls this on a row that is still 'active', immediately before freezing.
 */
export async function challengeScoreboardFor(
  ctx: ReaderCtx,
  challenge: Doc<'teamChallenges'>,
): Promise<ChallengeScoreboard> {
  if (challenge.status !== 'active') throw accessError('CHALLENGE_NOT_ACTIVE')
  // NARROWING, NOT A GUARD: an active row always has all three (activate sets
  // them in one patch). Unreachable past the status check, and its mutant
  // survives for that reason.
  if (
    challenge.startDay === undefined ||
    challenge.endDay === undefined ||
    challenge.opponentTeamId === undefined
  ) {
    throw accessError('CHALLENGE_NOT_ACTIVE')
  }

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
    // ARGUMENT ORDER MATTERS AND THE COMPILER CANNOT SEE IT: outcomeOf's two
    // parameters are structurally identical, so a transposed call compiles and
    // names the wrong winner. The two "the lower average wins" tests run both
    // directions through THIS line and are what pin it.
    outcome: outcomeOf(challengerTotals, opponentTotals),
  }
}

export type HeadToHeadRecord = { won: number; lost: number; tied: number; noResult: number }

export type HeadToHead = {
  opponentTeamId: Id<'teams'>
  opponentName: string
  record: HeadToHeadRecord
}

/**
 * One team's record against every team it has finished a challenge with, from
 * the VIEWING team's side, most recently played first.
 *
 * READS THE CLOSED SET ONCE — two index queries — and tallies per opponent in
 * memory. Never one scan per opponent. Reads ZERO teamMonthStats documents: the
 * snapshot is the record.
 *
 * 'void' IS NEITHER A WIN NOR A LOSS. It is counted as noResult and shown as
 * "no result", because a void means the boards were never there to judge —
 * folding it into either column would invent an outcome nobody played for.
 *
 * THE LABEL IS THE OPPONENT'S NAME AT ITS MOST RECENT CLOSE, read from the
 * snapshot rather than the live team row. That keeps a deleted opponent
 * labelled, and costs no extra read.
 *
 * A 'closed' ROW WITH NO `result` IS SKIPPED. result-present <=> closed is an
 * invariant the schema cannot express (spec §13); a row breaking it must not
 * appear as an opponent with an all-zero tally.
 *
 * UNBOUNDED OVER A TEAM'S LIFETIME: closed rows are never deleted. At one
 * challenge per pair at a time and five at once, that is a few dozen a year per
 * team. If that ever stops being true, this is the read to bound.
 */
export async function headToHeadFor(
  ctx: ReaderCtx,
  teamId: Id<'teams'>,
): Promise<Array<HeadToHead>> {
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

  const byOpponent = new Map<Id<'teams'>, HeadToHead & { lastClosedAt: number }>()
  for (const challenge of closed) {
    const result = challenge.result
    if (result === undefined) continue

    const viewerIsChallenger = challenge.challengerTeamId === teamId
    const other = viewerIsChallenger ? result.opponent : result.challenger
    const entry = byOpponent.get(other.teamId) ?? {
      opponentTeamId: other.teamId,
      opponentName: other.name,
      record: { won: 0, lost: 0, tied: 0, noResult: 0 },
      lastClosedAt: -Infinity,
    }
    if (result.closedAt > entry.lastClosedAt) {
      entry.lastClosedAt = result.closedAt
      entry.opponentName = other.name
    }

    switch (result.outcome) {
      case 'void':
        entry.record.noResult += 1
        break
      case 'tie':
        entry.record.tied += 1
        break
      case 'challenger':
        if (viewerIsChallenger) entry.record.won += 1
        else entry.record.lost += 1
        break
      case 'opponent':
        if (viewerIsChallenger) entry.record.lost += 1
        else entry.record.won += 1
        break
    }
    byOpponent.set(other.teamId, entry)
  }

  return [...byOpponent.values()]
    .sort((a, b) => b.lastClosedAt - a.lastClosedAt)
    .map(({ opponentTeamId, opponentName, record }) => ({ opponentTeamId, opponentName, record }))
}

/**
 * A pending proposal as the team page may see it.
 *
 * AN EXPLICIT PROJECTION, NEVER THE DOC. The doc carries the link `token` —
 * a capability that would otherwise reach every member of the challenging
 * team, Pro or not — and carries no team names. proposeByLink returns the token
 * once, to the person who made it. AND NOTHING NUMERIC: AC3 says nothing about
 * either team's scores renders before acceptance.
 */
export type PendingChallengeView = {
  challengeId: Id<'teamChallenges'>
  /** 'incoming': this team was challenged and may accept or decline. */
  direction: 'incoming' | 'outgoing'
  /** null for a link proposal nobody has claimed yet. */
  otherTeamName: string | null
  isLink: boolean
  /** The client renders "expired" against its own clock; see AC5. */
  expiresAt: number
  /** The proposer may withdraw; so may the challenging team's owner. */
  proposedByViewer: boolean
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
 *
 * IN A *For HELPER rather than the query wrapper, because a rule inside
 * `query({...})` is a rule no test here can execute (wordle-teams-obw).
 */
export async function challengesForTeamFor(
  ctx: ReaderCtx,
  playerId: Id<'players'>,
  teamId: Id<'teams'>,
) {
  await requireTeamMemberFor(ctx, playerId, teamId)
  const pro = await isProFor(ctx, playerId)

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

  const pending: Array<PendingChallengeView> = []
  for (const challenge of live.filter((c) => c.status === 'pending')) {
    const incoming = challenge.opponentTeamId === teamId
    const otherTeamId = incoming ? challenge.challengerTeamId : challenge.opponentTeamId
    const otherTeam = otherTeamId === undefined ? null : await ctx.db.get(otherTeamId)
    pending.push({
      challengeId: challenge._id,
      direction: incoming ? 'incoming' : 'outgoing',
      otherTeamName: otherTeam?.name ?? null,
      isLink: challenge.token !== undefined,
      expiresAt: challenge.expiresAt,
      proposedByViewer: challenge.proposedBy === playerId,
    })
  }

  return { pro, active, pending, records: await headToHeadFor(ctx, teamId) }
}

export const challengesForTeam = query({
  args: { teamId: v.id('teams') },
  handler: async (ctx, { teamId }) => {
    const player = await requirePlayer(ctx)
    return await challengesForTeamFor(ctx, player._id, teamId)
  },
})
```

- [ ] **Step 5: Run it and confirm it passes**

```bash
TZ=UTC pnpm test:once convex/challenges.test.ts > /tmp/t9.txt 2>&1; echo "exit=$?"; tail -30 /tmp/t9.txt
```

Expected: `exit=0`. Then the full suite, as a DELTA against Step 0: **+24** in
`convex/challenges.test.ts` (10 scoreboard, 6 head-to-head, 7 page, 1 type equality)
and **+1** generated in `src/lib/convex-error.test.ts` for `CHALLENGE_NOT_ACTIVE` —
**+25** overall. (Executed: 4162 -> 4187.) A different delta is a finding to report, not a number to adjust.

- [ ] **Step 6: Prove the new tests bite**

For each mutant, apply it, run the named check, confirm it goes RED, revert. Report
each one with the test that killed it. A mutant that survives is a finding — report
it, do not weaken the mutant.

| # | Mutant | Must be killed by |
| --- | --- | --- |
| 1 | `outcomeOf(opponentTotals, challengerTotals)` | both "the lower average wins" tests |
| 2 | `statsDaysFor` reads only `monthOf(startDay)` | "reads BOTH monthly documents" |
| 3 | `statsDaysFor` reads only `monthOf(endDay)` | "reads BOTH monthly documents" |
| 4 | delete the member `.sort(...)` | "member rows lead with the lowest average" |
| 5 | swap the tiebreak to `a.boards - b.boards` | "member rows lead with the lowest average" |
| 6 | delete the `status !== 'active'` line | "not active is refused" |
| 7 | in `headToHeadFor`, `case 'void'` falls through to `'tie'` | "void counts as neither" |
| 8 | `viewerIsChallenger` hardcoded `true` | "VIEWING team's side" |
| 9 | key the map on a constant instead of `other.teamId` | "each opponent gets its own tally" |
| 10 | delete the `.sort` on the returned records | "each opponent gets its own tally" |
| 11a | `closedAt >` comparison → `true` (last name found wins) | "the label is the name from the most recent close" |
| 11b | first name found wins | "the label is the name from the most recent close" |
| 12 | delete `if (result === undefined) continue` | "a closed row with no result is skipped" (it throws on `result.opponent`) |
| 13 | `pro ? … : …` → always the Pro branch | "a free member gets … no member rows" |
| 14 | `pending` returns the raw docs | both pending tests |
| 15 | `records` omitted from the return | "the head-to-head record is part of the answer" |
| 16 | `direction` computed from `challengerTeamId === teamId` inverted | "an incoming proposal is labelled" |
| 17 | in `schema.ts`, remove `v.literal('void')` from `result.outcome` | `pnpm typecheck` (the `expectTypeOf` test) — **not** vitest |
| 18 | remove `CHALLENGE_NOT_ACTIVE` from `convexErrorCode`'s chain | `src/lib/convex-error.test.ts` |
| 19 | active row `viewerIsChallenger: true` | "viewed from the challenged team" |
| 20 | active row drops `startDay` / `challengeId` | "a free member gets …" |
| 21 | `'opponent'` outcome from the opponent's side counted as lost | "an 'opponent' outcome is a win for the team that was challenged" |
| 22 | delete the `INVALID_TEAM` guard | "an active challenge whose team row is gone" |

**AS EXECUTED, rows 10 and 11b SURVIVED the first version of this table's tests,
and rows 19-22 were survivors nobody had asked about.** Rows come back from an
index in creation order, and the head-to-head tests inserted newest-first — so the
Map's insertion order already matched the expected order and a deleted sort, or a
first-found-wins label, passed. A two-row label test cannot kill both 11a and 11b
in either insertion order; it needs three rows with the newest in the middle. The
tests above are the corrected versions.

Mutants that are EXPECTED to survive, and why: the null branches of the member sort
and the `startDay/endDay/opponentTeamId === undefined` narrowing (both unreachable,
see their comments). Report any OTHER survivor you notice.

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
git add convex/challenges.ts convex/challenges.test.ts convex/access.ts src/lib/convex-error.ts
git commit -F - <<'EOF'
feat(zic8.2): live scoreboard, head-to-head record, and the page query

At most two teamMonthStats documents per side and never a dailyScores read. A
missing monthly document is zero boards rather than a throw, because the rollup
skips unchanged months and a team that has never played has no row.

The Pro gate is applied server-side in challengesForTeamFor, where a test can
reach it: free members get both averages, both board counts and the outcome, and
not the per-member rows. Pending proposals are an explicit projection that
carries the other team's name and never the link token or any number.

The head-to-head record reads the closed set once and tallies per opponent. A
void result counts as neither a win nor a loss.

<YOUR OWN attribution trailer>
Claude-Session: https://claude.ai/code/session_01J5oECn6C61LEH6aeUMiSA8
EOF
```

---

## Plan Pass on Tasks 10-14 (2026-10-05) — READ BEFORE ANY OF THEM

**DECIDED AND APPLIED (2026-10-05).** The owner took the recommended option on all
four decisions — D1 consent actions in the section, the switch on team settings, Task
12 split into 12a/12b; D2 a fail-OFF `CHALLENGES_ENABLED` variable; D3 Pro-gated
display names, live and frozen; D4 only the surviving team is notified. Tasks 9b, 9c,
10, 11, 12a, 12b, 13 and 14 below are the rewritten text, and every finding in this
section is folded into them. **Execution order: 9b, 9c, 10, 11, 12a, 12b, 13, 14.**
This section is kept as the record of why each task says what it says.

### Owner decisions needed

- **D1 — the consent UI no task builds.** No task renders accept, decline,
  withdraw, cancel or the owner's `acceptsChallenges` switch, so AC3 and AC4 cannot
  be met and Task 14's "a member accepts" has nothing to click. Task 9's `pending`
  projection already carries what the buttons need (`direction`,
  `proposedByViewer`, `challengeId`). Proposed: incoming rows get Accept/Decline,
  outgoing rows get Withdraw (proposer or challenger's owner), active rows get
  Cancel (either owner), and the switch goes on team settings. Split Task 12 into
  12a (scoreboard + section + consent actions) and 12b (propose dialog).
- **D2 — "deployed dark" has no mechanism**, and the rac gate sits in Task 14, two
  tasks after Task 12 wires the UI in unconditionally. Proposed: a server-side
  `CHALLENGES_ENABLED` deployment env var, **failing toward OFF** (the opposite of
  `lib/sweeps.ts`, deliberately: there the costly mistake is the brake left on,
  here it is a scoreboard published before rac). `challengesForTeamFor` returns
  `{ enabled: false }` and the propose/accept mutations refuse while it is off.
  It flips in the Convex dashboard with no deploy. The rac gate moves to Task 12
  Step 0: the var is not set in production until rac closes.
- **D3 — opponent member rows cannot be labelled** (wordle-teams-zic8.2.17). Rows
  carry only `playerId`, and no query gives team A the names on team B. The
  snapshot validator has no `name` either, and **Task 10's first close freezes
  that shape.** Options: (a) project names server-side under the Pro gate and add
  `name` to the snapshot before Task 10; (b) name your own team's rows only; (c)
  drop the opponent's rows. This is also the spec §3 cross-team-visibility
  question, so it is not an implementation call.
- **D4 — who hears that a deleted team's challenge closed.** `closeOne` pushes to
  both rosters; on deletion one roster's team no longer exists and the deep link
  is dead. Proposed: notify the surviving team only.

### Verified findings that are mechanical — applied when the task text is rewritten

**Task 10**
1. **Its tests call Task 9's OLD helpers.** `seedStats(ctx, teamId, playerId, …)`
   and `octoberDays(3, 12)` no longer exist; Task 9 changed both signatures
   (`seedStats(ctx, teamId, month, days)`, `octoberDays(playerId, attempts, count)`,
   `ENOUGH`). This is the meta-lesson from zic8.2.16 recurring: an amended task
   whose consumers were not re-checked.
2. `WriterCtx` has no scheduler. `closeOne`, `notifyBothRosters`, `activate` and
   their callers need `SchedulingCtx` from `winners.ts:73`, which `chat.ts` and
   `billing.ts` already import.
3. Hardcoded `'push'`. Derive `PUSH_METHOD` from `METHODS` as `reminders.ts:31` and
   `chatNotify.ts:117` do; `reminderDeliveryMethods` is `v.array(v.string())`, so a
   drift would be silent non-delivery.
4. **Every push path is untested.** `aPlayer()` has `reminderDeliveryMethods:
   ['email']` (fixtures.ts:26) and no test counts scheduled jobs. Add tests counting
   `_scheduled_functions`, the way `chatNotify.test.ts:41` does: push only to
   consenting players, each side's body names the OTHER team, and running the
   close twice schedules nothing new.
5. `result !== undefined` sits after `status !== 'active'`, so it can never fire;
   its mutant survives. The status check IS the idempotence guard. Delete the
   line and correct spec §13, which names it. The transposition assert is
   tautological (it compares the board against the ids it was built from) and
   should go too.
6. One bad row aborts the whole sweep: `challengeScoreboardFor` throws on a
   missing team row (pinned in Task 9). Skip and count such rows, logging each;
   it throws before writing anything, so a catch leaves no partial state.
7. **`cancelChallengeFor` ships with no tests**, though AC4 requires it. Needed:
   each side's owner may cancel; a non-owner member gets `NOT_TEAM_OWNER`; a
   non-active row gets `CHALLENGE_NOT_ACTIVE`; the cancel freezes a result.
8. The clamp is not "byte-identical": `chatNotify.ts:71` exports
   `MAX_NOTIFIED_TEAM_NAME = 40`, and the plan adds a private 30 with the same
   name. Extract one pure clamp into `convex/lib/` and use it for both bodies,
   rather than adding a "change one, change the other" comment. The body is
   server-only, so it does not belong in client-safe `lib/challenge.ts` (and that
   module's banner then needs no exception).
9. **The citation is inverted.** `crons.ts:140` says the bill grew with **DATA**,
   not run count. Step 9's comment, Step 12's commit message and the
   `collect()` note all say the reverse.
10. `pushableModules.test.ts` holds no list of push modules; it pins that nothing
    the CLI pushes evaluates `import.meta`. Drop the Step 11 sentence.
11. Imports mid-file (Step 1 and Step 6); test counts as absolute numbers.

**Task 11** — the finding is **wider than zic8.2.16 recorded.**
12. `cascadeDeleteTeam` (teams.ts:327) deletes `teamMonthStats` at lines 346-350
    and the team row at 413. It has **four** callers: `deleteTeamFor`
    (teams.ts:430), last-member `leaveTeam` (549), `billing.ts:431`, and
    `e2ePrune.ts:314`. The close must be **the first statement of
    `cascadeDeleteTeam`**, which covers all four. "Before the team row is deleted"
    is not enough: after the aggregate goes, `statsDaysFor` reads zero boards and
    freezes `void` without throwing.
13. Both prescribed tests seed no aggregate, so a zeroed close and a correct one
    look the same, and both call the helper directly, so they pass if the cascade
    is never wired. Required instead: seed `teamMonthStats` on both sides above
    the floor, drive `cascadeDeleteTeam` itself, and assert a **non-void** outcome
    and real averages in the frozen result.

**Task 12**
14. The component test is JSX in a `.ts` file. Renaming it to `.tsx` makes vitest
    **skip it silently** (`vitest.config.ts:20` includes `src/**/*.test.ts` only;
    the repo has zero `.tsx` tests), so the step would report exit 0 with 0 tests.
    Use `createElement` in a `.hook.test.ts`, as `Header.hook.test.ts` does.
    `toBeInTheDocument` needs `@testing-library/jest-dom`, which is not a
    dependency.
15. zic8.2.15 (regenerate `api.d.ts` against a LOCAL anonymous backend) must land
    first, as the Ground Rules say.
16. Free-tier copy: `challengesForTeamFor` already strips rows server-side, so the
    component's `pro` prop only chooses between "rows" and "upgrade hint"; it is not
    a gate.

**Task 13**
17. A new route turns exact-list assertions red in two suites the task never names:
    `src/crawler-metadata.test.ts` (sorted Disallow list at :170; "every route is
    listed, disallowed or deliberately neither" at :591) and
    `src/lib/maintenance.test.ts` (three `toEqual` path lists at :159, :193, :204).
    It also needs `Disallow: /challenge` plus its rationale paragraph in
    `public/robots.txt` (the path is a capability, exactly like `/join`), and an
    entry in `GATED_SUBTREES` (`src/lib/maintenance.ts:124`).
18. Step 3's sitemap grep can never fail: `src/routes/sitemap[.]xml.ts` holds no
    entries. The crawler test at :591 is the real check.

**Task 14**
19. **NOT A GAP — the zic8.2.16 finding is stale.** `e2eSeed.seedInsightsFor` takes
    `pro: boolean` and writes `playerMembership` (e2eSeed.ts:309-314), and
    `e2e/insights.spec.ts` already uses it. `ensureTeamFor(A)` +
    `ensureSharedTeamFor(A, B)` puts A on two teams with B on one, so the happy
    path is seedable today.
20. **"The scoreboard renders with both averages" cannot happen in an e2e run.**
    The window starts the day AFTER acceptance, so a freshly accepted challenge has
    zero boards and is `void`. Assert the "not enough boards yet" state and both
    team names, not averages.
21. The rac gate moves to Task 12 Step 0 under D2.

---

## Task 9b: Display names on member rows, live and frozen (D3)

**bd:** `wordle-teams-zic8.2.17`.

**Owner decision D3 (2026-10-05):** Pro members see the opponent's member rows WITH
display names, projected server-side under the existing Pro gate, and the frozen
snapshot stores the name so a closed challenge stays labelled. **This task must land
before Task 10**, because the first close freezes the snapshot's shape.

**Files:**
- Create: `convex/lib/displayNames.ts` — `displayNamesFor` and `NamedPlayer`, MOVED
  verbatim (doc comment included) from `src/lib/display-names.ts`
- Modify: `src/lib/display-names.ts` — becomes a one-line re-export, so
  `today-panel.tsx`, `scores-table.tsx` and `display-names.test.ts` are untouched
- Modify: `convex/schema.ts` — `challengeSideValidator.members[]` gains `name: v.string()`
- Modify: `convex/schema.test.ts` — its fully-populated member (line ~668) gains `name`
- Modify: `convex/challenges.ts`, `convex/challenges.test.ts`
- Modify: `docs/superpowers/specs/2026-10-04-team-vs-team-challenge-design.md` §11, §12

**WHY MOVE THE RULE RATHER THAN WRITE A SERVER COPY.** Its own banner: "two copies of
a naming rule is how the same person ends up called two things on one screen." The
server cannot import `src/`; the client already imports `convex/lib/` (see
`src/lib/insights-team.ts`). Moving it keeps one rule.

**THE COLLISION SET IS THE WHOLE ROSTER, not just the rows**, so a scoreboard calls a
player what the scores table on the same page calls them. "Ada" with a second Ada who
did not play in the window is still "Ada L".

**A ROW WHOSE PLAYER IS NOT ON THE ROSTER** (left the team mid-window; their entries
remain in `days[]` until the next rollup) is labelled `'Former member'`. Never an id,
never blank.

**READ COST:** one `players` read per roster member per side, every time a scoreboard
is computed, including for free viewers whose rows are then stripped. Bounded by roster
size (single digits). Correct spec §12 to say so.

**WHAT CROSSES THE TEAM BOUNDARY** is a display label — a first name, plus a last
initial on a collision — and only to Pro members. Add one sentence to spec §11 saying
so, and that `days[]` still never crosses (AC11).

- [ ] **Step 0: Record the baseline** (as Task 9 Step 0).

- [ ] **Step 1: Failing tests** — append to `convex/challenges.test.ts`, in the
  `challengeScoreboardFor` describe:

```ts
  test('member rows carry display names, with an initial only on a first-name collision', async () => {
    const t = convexTest(schema, modules)
    await t.run(async (ctx) => {
      const { playerId, challengerTeamId } = await seedTwoTeams(ctx) // Ada Lovelace
      const { theirTeamId } = await seedAccepter(ctx)
      const adaB = await ctx.db.insert('players', aPlayer({ email: 'adab@example.com', lastName: 'Byron' }))
      const bo = await ctx.db.insert('players', aPlayer({ email: 'bo@example.com', firstName: 'Bo' }))
      // adaB IS ON THE ROSTER AND PLAYS NOTHING: the collision set is the whole
      // roster, so playerId is still 'Ada L'.
      await ctx.db.patch(challengerTeamId, { playerIds: [playerId, adaB, bo] })
      await seedStats(ctx, challengerTeamId, OCTOBER, [
        { puzzleDay: '2026-10-05', entries: [{ playerId, attempts: 3 }, { playerId: bo, attempts: 4 }] },
      ])

      const board = await challengeScoreboardFor(
        ctx,
        await seedActive(ctx, challengerTeamId, theirTeamId, playerId),
      )
      expect(board.challenger.members.map((m) => m.name)).toEqual(['Ada L', 'Bo'])
    })
  })

  test('a row for a player no longer on the roster is a former member', async () => {
    const t = convexTest(schema, modules)
    await t.run(async (ctx) => {
      const { playerId, challengerTeamId } = await seedTwoTeams(ctx)
      const { theirTeamId } = await seedAccepter(ctx)
      const gone = await ctx.db.insert('players', aPlayer({ email: 'gone@example.com', firstName: 'Gus' }))
      await seedStats(ctx, challengerTeamId, OCTOBER, [
        { puzzleDay: '2026-10-05', entries: [{ playerId: gone, attempts: 3 }] },
      ])

      const board = await challengeScoreboardFor(
        ctx,
        await seedActive(ctx, challengerTeamId, theirTeamId, playerId),
      )
      // 'Former member', NOT 'Gus': the row's player document exists, but they
      // are not on this roster, so naming them would be a lookup of anyone's id.
      expect(board.challenger.members).toEqual([
        { playerId: gone, name: 'Former member', boards: 1, attempts: 3, average: 3 },
      ])
    })
  })
```

Also update the existing `member rows lead with the lowest average` test's exact
`toEqual` on `members[0]` to include `name` — the three players there are not on the
roster, so it is `'Former member'`. **That is a test edit the task prescribes, not a
weakening; report it.** And the free-member test gains
`expect(JSON.stringify(view)).not.toContain('Ada')` — names are stripped with the rows.

- [ ] **Step 2: Confirm red** for the right reason (no `name` on rows).

- [ ] **Step 3: Implement.**
  - Move the rule; `src/lib/display-names.ts` becomes
    `export { displayNamesFor, type NamedPlayer } from '../../convex/lib/displayNames.ts'`
    with a one-line comment saying where the rule lives and why.
  - Schema: `name: v.string()` in `challengeSideValidator.members[]`, between
    `playerId` and `boards`. **Required, not optional**: no `teamChallenges` row exists
    in any deployment (this branch has never been deployed), so there is nothing to
    migrate, and optional would let Task 10 freeze a row without it.
  - `ChallengeMemberRow` gains `name: string`.
  - In `challengeScoreboardFor`, after the two team reads:

```ts
/**
 * Display labels for one team's roster, by player id.
 *
 * THE COLLISION SET IS THE WHOLE ROSTER, so a scoreboard calls a player what the
 * scores table on the same page does. One players read per roster member.
 */
async function rosterNamesFor(ctx: ReaderCtx, team: Doc<'teams'>): Promise<Map<string, string>> {
  const players = []
  for (const id of team.playerIds) {
    const player = await ctx.db.get(id)
    if (player !== null) players.push({ id, firstName: player.firstName, lastName: player.lastName })
  }
  return displayNamesFor(players)
}

/** A row whose player is not on the roster: they left mid-window. */
const FORMER_MEMBER = 'Former member'
```

  `sideFrom` takes the map as a fourth parameter and sets
  `name: names.get(m.playerId) ?? FORMER_MEMBER`.

- [ ] **Step 4: Prove the tests bite.** Mutants, each RED then reverted:

| # | Mutant | Killed by |
| --- | --- | --- |
| 1 | collision set = the row players only, not the roster | "display names … collision" |
| 2 | `?? FORMER_MEMBER` → `?? ''` | "no longer on the roster" |
| 3 | names not stripped for free viewers (spread keeps members) | free-member test |
| 4 | `name` dropped from the schema validator | `pnpm typecheck` |

- [ ] **Step 5: Four gates; commit** (`convex/lib/displayNames.ts src/lib/display-names.ts
  convex/schema.ts convex/schema.test.ts convex/challenges.ts convex/challenges.test.ts`
  and the spec). Expected delta: +2 tests, plus any per-tracked-file generated tests for
  the new module — report the number rather than predicting it.

---

## Task 9c: The deployed-dark switch (D2)

**bd:** `wordle-teams-zic8.2.18`.

**Owner decision D2 (2026-10-05):** a `CHALLENGES_ENABLED` Convex deployment variable,
**OFF unless it is exactly `'true'`**. While off, the page query reports
`{ enabled: false }` and nothing else, and the four mutations that START or ACTIVATE a
challenge refuse. It flips in the Convex dashboard with no deploy. **The rac ship gate
attaches here:** this variable is not set in production until `wordle-teams-rac` is
closed (Task 12a Step 0 re-checks it).

**THE POLARITY IS THE OPPOSITE OF `lib/sweeps.ts`, DELIBERATELY.** That module fails
toward ON because a brake left on is the silent failure. Here the costly mistake is a
scoreboard published before rac is repaired — a finished result later restated — so
this fails toward OFF. Say so in the banner, citing sweeps.ts, so nobody "fixes" the
inconsistency.

**WHAT STAYS WORKING WHILE OFF:** decline, withdraw, cancel, `setAcceptsChallenges` and
the daily close. Each only ends or refuses something; turning the feature off must not
strand a challenge that is already running.

**Files:**
- Modify: `convex/lib/challenge.ts` — `CHALLENGES_ON` and `challengesEnabled(value)`
- Modify: `convex/lib/challenge.test.ts`
- Modify: `convex/challenges.ts` — the gate as the FIRST statement of five wrappers
- Modify: `convex/challenges.test.ts` — a source test that pins that
- Modify: `convex/access.ts` + `src/lib/convex-error.ts` (BOTH halves) — `CHALLENGES_DISABLED`

- [ ] **Step 1: Failing tests.**

`convex/lib/challenge.test.ts`:

```ts
describe('challengesEnabled', () => {
  test('only the exact string enables it', () => {
    expect(challengesEnabled(CHALLENGES_ON)).toBe(true)
  })

  // FAILS TOWARD OFF: every near-miss is off, so a typo keeps the feature dark
  // rather than publishing it.
  test.each([undefined, '', 'TRUE', 'True', ' true', '1', 'yes', 'false'])('%j is off', (value) => {
    expect(challengesEnabled(value)).toBe(false)
  })
})
```

`convex/challenges.test.ts` — wrappers cannot be driven (wordle-teams-obw), so pin
the gate's POSITION in source, the way `convex/lib/sweeps.test.ts` pins
`teamStats.sweep`'s:

```ts
describe('the CHALLENGES_ENABLED gate', () => {
  /** The first non-comment line inside `export const <name>`'s handler. */
  function firstHandlerLine(source: string, name: string): string | undefined {
    const start = source.indexOf(`export const ${name} = `)
    expect(start, `no export const ${name}`).toBeGreaterThan(-1)
    const body = source.slice(start).split(/handler: async \(.*?\) => \{/)[1]
    expect(body, `no handler in ${name}`).toBeDefined()
    return body!
      .split('\n')
      .map((line) => line.trim())
      .find((line) => line !== '' && !line.startsWith('//'))
  }

  // THE FIVE THAT START, ACTIVATE OR DISPLAY A CHALLENGE. Decline, withdraw,
  // cancel and the owner's switch are deliberately NOT gated: they only end or
  // refuse, and switching the feature off must not strand a running challenge.
  test.each(['proposeToTeam', 'proposeByLink', 'acceptChallenge', 'claimChallengeLink', 'challengesForTeam'])(
    '%s checks CHALLENGES_ENABLED first',
    async (name) => {
      const { readFileSync } = await import('node:fs')
      const source = readFileSync(new URL('./challenges.ts', import.meta.url), 'utf8')
      expect(firstHandlerLine(source, name)).toContain('challengesEnabled(process.env.CHALLENGES_ENABLED)')
    },
  )

  test.each(['declineChallenge', 'withdrawChallenge', 'cancelChallenge', 'setAcceptsChallenges'])(
    '%s is NOT gated, so a running challenge can always be ended',
    async (name) => {
      const { readFileSync } = await import('node:fs')
      const source = readFileSync(new URL('./challenges.ts', import.meta.url), 'utf8')
      expect(firstHandlerLine(source, name)).not.toContain('CHALLENGES_ENABLED')
    },
  )
})
```

**`cancelChallenge` does not exist until Task 10.** Either land this task after
Task 10, or leave `cancelChallenge` out of the second list here and add it in Task 10.
The plan's order puts 9c BEFORE 10, so: leave it out here, and Task 10 Step 9 adds it.

- [ ] **Step 2: Implement.**

```ts
// lib/challenge.ts
/** The one value that turns challenges ON. Exported so no caller spells it. */
export const CHALLENGES_ON = 'true'

export function challengesEnabled(value: string | undefined): boolean {
  return value === CHALLENGES_ON
}
```

In each of the four gated mutations, the first statement:

```ts
    if (!challengesEnabled(process.env.CHALLENGES_ENABLED)) throw accessError('CHALLENGES_DISABLED')
```

In `challengesForTeam`, the first statement returns instead of throwing, so a page
that renders the section never errors on a dark deployment:

```ts
    if (!challengesEnabled(process.env.CHALLENGES_ENABLED)) return { enabled: false as const }
```

and the enabled path returns
`{ enabled: true as const, ...(await challengesForTeamFor(ctx, player._id, teamId)) }`.
`challengesForTeamFor` itself is unchanged, so none of its tests move.

`CHALLENGES_DISABLED` copy: `"Challenges aren't available yet."`

- [ ] **Step 3: Mutants.** Move the gate to the second line of `acceptChallenge`
  (RED: the gate test); gate `declineChallenge` (RED); change `===` to a truthiness
  check (RED: `'false'` and `'1'` cases); drop the `convexErrorCode` chain entry (RED:
  convex-error.test.ts).

- [ ] **Step 4: Four gates; commit.**

---

## Task 10: Close on the existing daily sweep, idempotently, with push

**bd:** `wordle-teams-zic8.2.10`.

**REWRITTEN 2026-10-05 from the plan pass.** Findings 1-11 applied, plus two found
while rewriting:

- **THE SWEEP DOES NOT ROLL UP INLINE.** `teamStats.sweep` SCHEDULES `rollupOne` per
  team, and only for the CURRENT month. The old text's "runs AFTER the rollups so a
  month that has just ended has its final aggregate" was false twice: the rollups run
  later, and a just-ended month is not among them. A past month's aggregate is kept
  current by the INCREMENTAL write path in `winners.ts`, which is what the close
  relies on. Do not reintroduce the ordering claim.
- **A UTC CLOSE ON endDay+1 CUTS OFF THE AMERICAS' LAST DAY.** The sweep runs 00:45
  UTC; on that day a player at UTC-7 is still in the evening of `endDay`, and UTC-12
  has until 12:00 UTC. Closing then freezes the result without their last-day boards,
  permanently. **A challenge closes on `endDay + 2` (server day)**, which covers every
  timezone; results arrive one day later. Spec §9 gains this paragraph.

**Files:**
- Create: `convex/lib/pushText.ts` (+ `.test.ts`) — the one name clamp
- Modify: `convex/chatNotify.ts` — use the shared clamp; its "app's only user-typed
  push body" sentence is corrected
- Modify: `convex/challenges.ts`, `convex/challenges.test.ts`
- Modify: `convex/teamStats.ts` — call the close from `sweep`
- Modify: spec §9 and §13

- [ ] **Step 0: Record the baseline.**

- [ ] **Step 1: One clamp, shared.**

Move `MAX_NOTIFIED_TEAM_NAME` (40) and `ELLIPSIS` from `chatNotify.ts` into
`convex/lib/pushText.ts` with a new export:

```ts
/**
 * A team name as it may appear in a push body: at most MAX_NOTIFIED_TEAM_NAME
 * code points, cut on a code point and marked with an ellipsis.
 *
 * (Move chatNotificationBody's three paragraphs on code points, trailing
 * whitespace and "not an injection defence" here; they describe this rule.)
 */
export function clampTeamNameForPush(name: string): string {
  const points = [...name]
  if (points.length <= MAX_NOTIFIED_TEAM_NAME) return name
  return `${points.slice(0, MAX_NOTIFIED_TEAM_NAME - 1).join('').replace(/\s+$/u, '')}${ELLIPSIS}`
}
```

`chatNotificationBody` becomes `` `New messages in ${clampTeamNameForPush(teamName)}` ``.
Keep `MAX_NOTIFIED_TEAM_NAME` re-exported from `chatNotify.ts` only if
`chatNotify.test.ts` still imports it from there; prefer pointing the test at the new
module. **`chatNotify.test.ts`'s `chatNotificationBody` tests must pass UNCHANGED** —
that is what proves the extraction preserved behaviour. Move the code-point and
whitespace tests to `pushText.test.ts` only if they are about the clamp rather than the
chat wording; when in doubt, leave them.

Correct `chatNotify.ts`'s closing sentence: it is no longer the app's only push body
built from user text; `challengeNotificationBody` in `challenges.ts` interpolates an
opposing team's name through the same `clampTeamNameForPush`.

- [ ] **Step 2: Failing tests** — append to `convex/challenges.test.ts`. Add imports
at the TOP of the file: `cancelChallengeFor, challengeNotificationBody,
closeDueChallengesFor` from `./challenges.ts`, and `MAX_NOTIFIED_TEAM_NAME` from
`./lib/pushText.ts`.

```ts
/** Every pushSend:deliverTo job queued so far, with its args. As chatNotify.test.ts. */
async function pushJobs(ctx: Ctx) {
  const rows = await ctx.db.system.query('_scheduled_functions').collect()
  return rows.filter((row) => row.name === 'pushSend:deliverTo')
}

/** Turn a player's push consent on. aPlayer() ships email-only, so without this every push assertion is 0 === 0. */
async function consentToPush(ctx: Ctx, playerId: Id<'players'>) {
  await ctx.db.patch(playerId, { reminderDeliveryMethods: ['email', 'push'] })
}

/** A due challenge: challenger 3.0 vs opponent 4.0 over ENOUGH boards each. Both players consent to push. */
async function seedDueChallenge(ctx: Ctx) {
  const { playerId, challengerTeamId } = await seedTwoTeams(ctx)
  const { accepterId, theirTeamId } = await seedAccepter(ctx)
  await consentToPush(ctx, playerId)
  await consentToPush(ctx, accepterId)
  await seedStats(ctx, challengerTeamId, OCTOBER, octoberDays(playerId, 3, ENOUGH))
  await seedStats(ctx, theirTeamId, OCTOBER, octoberDays(accepterId, 4, ENOUGH))
  const challenge = await seedActive(ctx, challengerTeamId, theirTeamId, playerId)
  return { id: challenge._id, playerId, accepterId, challengerTeamId, theirTeamId }
}

describe('challengeNotificationBody', () => {
  test('names the opponent', () => {
    expect(challengeNotificationBody('accepted', 'The Wordlers')).toBe('Challenge accepted: The Wordlers')
    expect(challengeNotificationBody('closed', 'The Wordlers')).toBe('Challenge finished: The Wordlers')
  })

  test('clamps through the shared rule', () => {
    const long = 'n'.repeat(MAX_NOTIFIED_TEAM_NAME + 10)
    expect(challengeNotificationBody('closed', long)).toBe(
      `Challenge finished: ${'n'.repeat(MAX_NOTIFIED_TEAM_NAME - 1)}…`,
    )
  })
})

describe('closeDueChallengesFor', () => {
  // endDay is 2026-10-31. Closes on endDay + 2 = 2026-11-02: see the task banner.
  test('closes on endDay + 2 and freezes a result', async () => {
    const t = convexTest(schema, modules)
    await t.run(async (ctx) => {
      const { id, challengerTeamId, theirTeamId } = await seedDueChallenge(ctx)
      expect(await closeDueChallengesFor(ctx, '2026-11-02')).toMatchObject({ closed: 1 })
      const doc = (await ctx.db.get(id))!
      expect(doc.status).toBe('closed')
      expect(doc.result).toMatchObject({
        outcome: 'challenger',
        challenger: { teamId: challengerTeamId, name: 'Challengers', boards: ENOUGH, average: 3 },
        opponent: { teamId: theirTeamId, name: 'Theirs', boards: ENOUGH, average: 4 },
      })
      expect(doc.result!.challenger.members).toEqual([
        { playerId: expect.any(String), name: 'Ada', boards: ENOUGH, attempts: 3 * ENOUGH, average: 3 },
      ])
    })
  })

  // BOTH SIDES OF THE BOUNDARY. endDay + 1 is the day the Americas are still
  // playing endDay's puzzle.
  test.each(['2026-10-31', '2026-11-01'])('does not close on %s', async (today) => {
    const t = convexTest(schema, modules)
    await t.run(async (ctx) => {
      const { id } = await seedDueChallenge(ctx)
      expect(await closeDueChallengesFor(ctx, today)).toMatchObject({ closed: 0 })
      expect((await ctx.db.get(id))!.status).toBe('active')
    })
  })

  test('pushes each consenting member the OTHER team\'s name', async () => {
    const t = convexTest(schema, modules)
    await t.run(async (ctx) => {
      const { playerId, accepterId } = await seedDueChallenge(ctx)
      await closeDueChallengesFor(ctx, '2026-11-02')
      const jobs = await pushJobs(ctx)
      const bodyFor = (id: Id<'players'>) =>
        jobs.find((job) => (job.args[0] as { playerId: string }).playerId === id)?.args[0]
      expect(jobs).toHaveLength(2)
      expect(bodyFor(playerId)).toMatchObject({ notification: { body: 'Challenge finished: Theirs' } })
      expect(bodyFor(accepterId)).toMatchObject({ notification: { body: 'Challenge finished: Challengers' } })
    })
  })

  test('a member without push consent is not pushed', async () => {
    const t = convexTest(schema, modules)
    await t.run(async (ctx) => {
      const { accepterId } = await seedDueChallenge(ctx)
      await ctx.db.patch(accepterId, { reminderDeliveryMethods: ['email'] })
      await closeDueChallengesFor(ctx, '2026-11-02')
      expect(await pushJobs(ctx)).toHaveLength(1)
    })
  })

  test('running twice neither restates the result nor re-notifies', async () => {
    const t = convexTest(schema, modules)
    await t.run(async (ctx) => {
      const { id } = await seedDueChallenge(ctx)
      await closeDueChallengesFor(ctx, '2026-11-02')
      const frozen = (await ctx.db.get(id))!.result
      expect(await closeDueChallengesFor(ctx, '2026-11-03')).toMatchObject({ closed: 0 })
      expect((await ctx.db.get(id))!.result).toEqual(frozen)
      expect(await pushJobs(ctx)).toHaveLength(2)
    })
  })

  // THE SNAPSHOT IS WHAT MAKES THIS TRUE, and it is why the snapshot exists.
  test('a later rewrite of the month does NOT restate a closed result', async () => {
    const t = convexTest(schema, modules)
    await t.run(async (ctx) => {
      const { id, playerId, challengerTeamId } = await seedDueChallenge(ctx)
      await closeDueChallengesFor(ctx, '2026-11-02')
      const before = (await ctx.db.get(id))!.result
      const stats = await ctx.db
        .query('teamMonthStats')
        .withIndex('by_team_year_month', (q) => q.eq('teamId', challengerTeamId).eq('year', 2026).eq('month', 10))
        .unique()
      await ctx.db.patch(stats!._id, { days: octoberDays(playerId, 6, ENOUGH) })
      await closeDueChallengesFor(ctx, '2026-11-03')
      expect((await ctx.db.get(id))!.result).toEqual(before)
    })
  })

  test('one challenge whose team row is gone does not stop the others closing', async () => {
    const t = convexTest(schema, modules)
    await t.run(async (ctx) => {
      const { id, playerId, challengerTeamId } = await seedDueChallenge(ctx)
      const otherId = await ctx.db.insert(
        'teams',
        aTeam({ legacyId: 901, name: 'Other', playerIds: [playerId], owner: playerId }),
      )
      const broken = await seedActive(ctx, challengerTeamId, otherId, playerId)
      await ctx.db.delete(otherId)

      expect(await closeDueChallengesFor(ctx, '2026-11-02')).toMatchObject({ closed: 1, failed: 1 })
      expect((await ctx.db.get(id))!.status).toBe('closed')
      expect((await ctx.db.get(broken._id))!.status).toBe('active')
    })
  })

  test('expires a pending proposal past its TTL, and leaves a live one alone', async () => {
    const t = convexTest(schema, modules)
    await t.run(async (ctx) => {
      const { playerId, challengerTeamId } = await seedTwoTeams(ctx)
      const { theirTeamId } = await seedAccepter(ctx)
      const pending = (expiresAt: number) => ({
        challengerTeamId,
        opponentTeamId: theirTeamId,
        proposedBy: playerId,
        status: 'pending' as const,
        expiresAt,
        createdAt: Date.now(),
      })
      const stale = await ctx.db.insert('teamChallenges', pending(Date.now() - 1))
      const live = await ctx.db.insert('teamChallenges', pending(Date.now() + TTL))
      expect(await closeDueChallengesFor(ctx, '2026-10-20')).toMatchObject({ expired: 1 })
      expect((await ctx.db.get(stale))!.status).toBe('expired')
      expect((await ctx.db.get(live))!.status).toBe('pending')
    })
  })
})

describe('cancelChallengeFor', () => {
  test.each(['challenger', 'opponent'] as const)("the %s team's owner may cancel, and it freezes a result", async (side) => {
    const t = convexTest(schema, modules)
    await t.run(async (ctx) => {
      const { id, playerId, accepterId } = await seedDueChallenge(ctx)
      await cancelChallengeFor(ctx, side === 'challenger' ? playerId : accepterId, id)
      const doc = (await ctx.db.get(id))!
      expect(doc.status).toBe('closed')
      expect(doc.result?.outcome).toBe('challenger')
    })
  })

  test('a member who is not an owner is refused', async () => {
    const t = convexTest(schema, modules)
    await t.run(async (ctx) => {
      const { id, theirTeamId } = await seedDueChallenge(ctx)
      const member = await ctx.db.insert('players', aPlayer({ email: 'member2@example.com' }))
      const team = (await ctx.db.get(theirTeamId))!
      await ctx.db.patch(theirTeamId, { playerIds: [...team.playerIds, member] })
      await expect(cancelChallengeFor(ctx, member, id)).rejects.toMatchObject({
        data: { code: 'NOT_TEAM_OWNER' },
      })
    })
  })

  test('a challenge that is not active is refused', async () => {
    const t = convexTest(schema, modules)
    await t.run(async (ctx) => {
      const { id, playerId } = await seedDueChallenge(ctx)
      await closeDueChallengesFor(ctx, '2026-11-02')
      await expect(cancelChallengeFor(ctx, playerId, id)).rejects.toMatchObject({
        data: { code: 'CHALLENGE_NOT_ACTIVE' },
      })
    })
  })
})
```

And in the existing `acceptChallengeFor` describe (frozen clock), one push test:

```ts
  test('acceptance pushes both rosters, naming the other team', async () => {
    const t = convexTest(schema, modules)
    await t.run(async (ctx) => {
      const { playerId, challengerTeamId } = await seedTwoTeams(ctx)
      const { accepterId, theirTeamId } = await seedAccepter(ctx)
      await consentToPush(ctx, playerId)
      await consentToPush(ctx, accepterId)
      const id = await ctx.db.insert('teamChallenges', {
        challengerTeamId,
        opponentTeamId: theirTeamId,
        proposedBy: playerId,
        status: 'pending',
        expiresAt: Date.now() + TTL,
        createdAt: Date.now(),
      })
      await acceptChallengeFor(ctx, accepterId, id, today)
      const bodies = (await pushJobs(ctx)).map((job) => (job.args[0] as { notification: { body: string } }).notification.body)
      expect(bodies.sort()).toEqual(['Challenge accepted: Challengers', 'Challenge accepted: Theirs'])
    })
  })
```

**Helper placement:** module scope, anywhere. They are only CALLED inside tests,
which run after the module has evaluated, so the `const`s they read (`ENOUGH`,
`OCTOBER`) are initialised by then even though they are declared further down.
`ctx.db.system` is reachable on `Ctx` because `GenericDatabaseWriter` extends
`GenericDatabaseReader`, which carries `system`; if typecheck disagrees, report it
rather than casting.

- [ ] **Step 3: Confirm red.**

- [ ] **Step 4: Implement.** In `convex/challenges.ts`:

  - `import type { SchedulingCtx } from './winners.ts'`; `import { internal } from './_generated/api'`;
    `import { METHODS } from './lib/reminders.ts'`; `import { clampTeamNameForPush } from './lib/pushText.ts'`;
    `addDays` from `./lib/puzzleDay.ts`.
  - `const [, PUSH_METHOD] = METHODS` — as `chatNotify.ts:117`. Never the literal.
  - `activate`, `acceptChallengeFor`, `claimChallengeLinkFor` take `SchedulingCtx`.
    After `activate`'s patch: re-read the row (it takes an id) and
    `await notifyRosters(ctx, activated, 'accepted')`.

```ts
export function challengeNotificationBody(event: 'accepted' | 'closed', opponentName: string): string {
  const name = clampTeamNameForPush(opponentName)
  return event === 'accepted' ? `Challenge accepted: ${name}` : `Challenge finished: ${name}`
}

/**
 * Push to every consenting member of both teams — or of one, when the other has
 * been deleted (Task 11, owner decision D4: a deleted team's members would be
 * sent a link to a page that no longer exists).
 *
 * (Keep the old notifyBothRosters doc: scheduled never awaited; one Push switch,
 * no per-feature setting; each side is told the OTHER team's name.)
 */
async function notifyRosters(
  ctx: SchedulingCtx,
  challenge: Doc<'teamChallenges'>,
  event: 'accepted' | 'closed',
  { skipTeamId }: { skipTeamId?: Id<'teams'> } = {},
): Promise<void> {
  if (challenge.opponentTeamId === undefined) return
  const challenger = await ctx.db.get(challenge.challengerTeamId)
  const opponent = await ctx.db.get(challenge.opponentTeamId)
  if (challenger === null || opponent === null) return

  for (const { team, otherName } of [
    { team: challenger, otherName: opponent.name },
    { team: opponent, otherName: challenger.name },
  ]) {
    if (team._id === skipTeamId) continue
    for (const playerId of team.playerIds) {
      const player = await ctx.db.get(playerId)
      if (player === null || !player.reminderDeliveryMethods.includes(PUSH_METHOD)) continue
      await ctx.scheduler.runAfter(0, internal.pushSend.deliverTo, {
        playerId,
        attempt: 0,
        notification: {
          title: 'Wordle Teams',
          body: challengeNotificationBody(event, otherName),
          url: `/team?team=${team._id}`,
        },
      })
    }
  }
}

/**
 * Freeze an ACTIVE challenge's numbers, then notify.
 *
 * THE SNAPSHOT IS BUILT FIELD BY FIELD because ChallengeSide spells the team's
 * name `teamName` and the validator wants `name`; a spread fails validation.
 */
async function closeOne(
  ctx: SchedulingCtx,
  challenge: Doc<'teamChallenges'>,
  notify: { skipTeamId?: Id<'teams'> } = {},
): Promise<void> {
  const board = await challengeScoreboardFor(ctx, challenge)
  const frozen = (side: ChallengeSide) => ({
    teamId: side.teamId,
    name: side.teamName,
    boards: side.boards,
    attempts: side.attempts,
    average: side.average,
    members: side.members,
  })
  await ctx.db.patch(challenge._id, {
    status: 'closed',
    result: {
      challenger: frozen(board.challenger),
      opponent: frozen(board.opponent),
      outcome: board.outcome,
      closedAt: Date.now(),
    },
  })
  await notifyRosters(ctx, challenge, 'closed', notify)
}

/**
 * Close every active challenge whose window has ended, and expire stale proposals.
 *
 * CLOSES ON endDay + 2, NOT endDay + 1. `today` is the server's UTC day and this
 * runs at 00:45 UTC; on endDay + 1 a player at UTC-12 has until 12:00 UTC to play
 * endDay's puzzle, and a close then would freeze the result without it, for good.
 *
 * THE STATUS CHECK IS THE IDEMPOTENCE GUARD. A closed row is not 'active', so a
 * re-run skips it. There is deliberately no separate `result !== undefined` check:
 * after the status check it could never fire.
 *
 * ONE BAD ROW DOES NOT STOP THE REST. challengeScoreboardFor throws on a missing
 * team row before anything is written, so catching it leaves no partial state;
 * the row stays 'active', is counted in `failed`, and is logged.
 *
 * WALKS THE WHOLE TABLE. Correct at this volume — at most MAX_ACTIVE_CHALLENGES live
 * rows per team, closed rows accumulating slowly. crons.ts records that this
 * deployment's sweeps cost grows with the DATA; this scan is part of that, and is
 * the read to index by status if the table passes a few thousand rows.
 */
export async function closeDueChallengesFor(
  ctx: SchedulingCtx,
  today: string,
): Promise<{ closed: number; expired: number; failed: number }> {
  let closed = 0
  let expired = 0
  let failed = 0
  const now = Date.now()

  for (const challenge of await ctx.db.query('teamChallenges').collect()) {
    if (challenge.status === 'pending' && challenge.expiresAt <= now) {
      await ctx.db.patch(challenge._id, { status: 'expired' })
      expired += 1
      continue
    }
    if (challenge.status !== 'active' || challenge.endDay === undefined) continue
    if (today < addDays(challenge.endDay, 2)) continue

    try {
      await closeOne(ctx, challenge)
      closed += 1
    } catch (error) {
      console.error(`closeDueChallengesFor: could not close ${challenge._id}`, error)
      failed += 1
    }
  }
  return { closed, expired, failed }
}
```

  `cancelChallengeFor` and the `cancelChallenge` wrapper as in the previous text of
  this task, taking `SchedulingCtx`. **Simplify the owner check**: `requireTeamOwnerFor`
  on the challenger team; on `NOT_TEAM_OWNER` or `NOT_A_MEMBER`, fall through to
  `requireTeamOwnerFor` on the opponent team, whose refusal is the one that propagates.
  Report whichever shape you choose and why.

  **`closeOne` writes BEFORE `notifyRosters`. If a future change makes notification
  throw after the patch, the catch above would count a closed row as failed.** It
  cannot throw today (it only reads and schedules); say so in a comment.

- [ ] **Step 5: Wire it into the sweep.** In `teamStats.sweep`, AFTER the
  `sweepsEnabled` gate and after the rollup scheduling loop:

```ts
    // CHALLENGES CLOSE ON THIS SWEEP, NOT A CRON OF THEIR OWN (wordle-teams-zic8.2):
    // a daily pass at 00:45 UTC is already the right cadence, and crons.ts keeps
    // lanes apart deliberately. NOT ORDERED AFTER THE ROLLUPS ABOVE IN ANY USEFUL
    // SENSE: those are scheduled, run later, and cover only the current month. A
    // closed window's month is kept current by the incremental write path.
    const challenges = await closeDueChallengesFor(ctx, toPuzzleDay(new Date()))
```

  and add `challenges` to the returned object. `sweep`'s ctx is a mutation ctx and
  satisfies `SchedulingCtx`.

  **Add `cancelChallenge` to Task 9c's "NOT gated" list** in `challenges.test.ts`.

- [ ] **Step 6: Spec.** §9: the endDay + 2 paragraph, and delete "a challenge already
  holding a `result` is skipped" in favour of "a challenge no longer `active` is
  skipped". §13: the idempotency bullet names the status check, not `result`.

- [ ] **Step 7: Mutants.** Each RED, then reverted:

| # | Mutant | Killed by |
| --- | --- | --- |
| 1 | `addDays(endDay, 2)` → `addDays(endDay, 1)` | "does not close on 2026-11-01" |
| 2 | → `addDays(endDay, 3)` | "closes on endDay + 2" |
| 3 | `skipTeamId` ignored | Task 11's survivor-only test (record it here as killed there) |
| 4 | `otherName` → the team's own name | "pushes each consenting member the OTHER team's name" |
| 5 | consent check deleted | "without push consent" |
| 6 | status check `!== 'active'` deleted | "running twice …" |
| 7 | the try/catch removed | "one challenge whose team row is gone" |
| 8 | the accept push deleted from `activate` | "acceptance pushes both rosters" |
| 9 | `'Challenge finished'` ↔ `'Challenge accepted'` swapped | body test |
| 10 | `frozen` drops `members` | "closes on endDay + 2" (members toEqual) |
| 11 | `clampTeamNameForPush` bypassed in the challenge body | "clamps through the shared rule" |
| 12 | cancel owner check accepts any member | "a member who is not an owner" |

- [ ] **Step 8: Four gates; commit** `convex/lib/pushText.ts convex/lib/pushText.test.ts
  convex/chatNotify.ts convex/chatNotify.test.ts convex/challenges.ts
  convex/challenges.test.ts convex/teamStats.ts` and the spec.

---

**AS EXECUTED (aef2cb54 + follow-up):** five of this task's prescribed tests let a
mutant through, and `convex/challenges.test.ts` is authoritative over the blocks
above. The worst: deleting `status === 'pending'` from the expiry branch passed,
and would have expired every RUNNING challenge a week after its proposal, since
`activate` leaves `expiresAt` on the row. Also added: "running twice" asserts
`failed: 0` (the per-row catch hid a deleted status check), a driven
`teamStats.sweep` test, the `<=` expiry boundary on a frozen clock, and the push
`url`. The Task 9c gate tests were made exact-line in the same pass.

---

## Task 11: Team deletion closes challenges (cascade-first)

**bd:** `wordle-teams-zic8.2.11`.

**REWRITTEN 2026-10-05.** `cascadeDeleteTeam` (teams.ts:327) deletes `teamMonthStats`
around lines 346-350 and the team row at ~413, and it has FOUR callers: `deleteTeamFor`,
the last-member `leaveTeam` path, `billing.ts`, and `e2ePrune.ts`. The close must be
**the first statement of `cascadeDeleteTeam`**: after the aggregate is gone,
`statsDaysFor` reads zero boards and freezes `'void'` WITHOUT throwing, so "before the
team row" is not enough and nothing would notice. **Owner decision D4:** only the
SURVIVING team is notified.

**Files:** `convex/challenges.ts`, `convex/teams.ts`, `convex/teams.test.ts`.

- [ ] **Step 1: Failing tests** — in `convex/teams.test.ts`, driven through
  `deleteTeamFor` (the real entry point), NOT the helper, so an unwired cascade fails.
  Seed aggregates on BOTH sides above the floor, so a zeroed close (`void`) and a
  correct one differ:

```ts
describe('deleting a team resolves its challenges', () => {
  async function seedPair(ctx: Ctx) {
    const owner = await ctx.db.insert('players', aPlayer({ reminderDeliveryMethods: ['email', 'push'] }))
    const rival = await ctx.db.insert('players', aPlayer({ email: 'rival@example.com', reminderDeliveryMethods: ['email', 'push'] }))
    const doomedId = await ctx.db.insert('teams', aTeam({ name: 'Doomed', playerIds: [owner], owner }))
    const survivorId = await ctx.db.insert('teams', aTeam({ legacyId: 900, name: 'Survivor', playerIds: [rival], owner: rival }))
    const days = (playerId: Id<'players'>, attempts: number) =>
      Array.from({ length: MIN_CHALLENGE_BOARDS }, (_, i) => ({
        puzzleDay: `2026-10-${String(i + 5).padStart(2, '0')}`,
        entries: [{ playerId, attempts }],
      }))
    for (const [teamId, playerId, attempts] of [[doomedId, owner, 3], [survivorId, rival, 4]] as const) {
      await ctx.db.insert('teamMonthStats', {
        teamId, year: 2026, month: 10, members: [], days: days(playerId, attempts), computedAt: Date.now(),
      })
    }
    return { owner, rival, doomedId, survivorId }
  }

  test('an active challenge is CLOSED with the real numbers, not zeroed, and the survivor keeps it', async () => {
    const t = convexTest(schema, modules)
    await t.run(async (ctx) => {
      const { owner, doomedId, survivorId } = await seedPair(ctx)
      const challengeId = await ctx.db.insert('teamChallenges', {
        challengerTeamId: doomedId, opponentTeamId: survivorId, proposedBy: owner,
        status: 'active', startDay: '2026-10-05', endDay: '2026-10-31',
        expiresAt: Date.now(), createdAt: Date.now(),
      })

      await deleteTeamFor(ctx, owner, doomedId)

      const doc = (await ctx.db.get(challengeId))!
      expect(doc.status).toBe('closed')
      // NOT 'void': the doomed team's aggregate was read before the cascade deleted it.
      expect(doc.result).toMatchObject({
        outcome: 'challenger',
        challenger: { name: 'Doomed', boards: MIN_CHALLENGE_BOARDS, average: 3 },
        opponent: { name: 'Survivor', average: 4 },
      })
    })
  })

  test('only the surviving team is pushed', async () => {
    const t = convexTest(schema, modules)
    await t.run(async (ctx) => {
      const { owner, rival, doomedId, survivorId } = await seedPair(ctx)
      await ctx.db.insert('teamChallenges', {
        challengerTeamId: doomedId, opponentTeamId: survivorId, proposedBy: owner,
        status: 'active', startDay: '2026-10-05', endDay: '2026-10-31',
        expiresAt: Date.now(), createdAt: Date.now(),
      })
      await deleteTeamFor(ctx, owner, doomedId)
      const jobs = (await ctx.db.system.query('_scheduled_functions').collect())
        .filter((row) => row.name === 'pushSend:deliverTo')
      expect(jobs.map((job) => (job.args[0] as { playerId: string }).playerId)).toEqual([rival])
    })
  })

  test('a pending proposal is WITHDRAWN', async () => {
    const t = convexTest(schema, modules)
    await t.run(async (ctx) => {
      const { owner, doomedId, survivorId } = await seedPair(ctx)
      const challengeId = await ctx.db.insert('teamChallenges', {
        challengerTeamId: doomedId, opponentTeamId: survivorId, proposedBy: owner,
        status: 'pending', expiresAt: Date.now() + 1000, createdAt: Date.now(),
      })
      await deleteTeamFor(ctx, owner, doomedId)
      expect((await ctx.db.get(challengeId))!.status).toBe('withdrawn')
    })
  })

  test('the close is the FIRST statement of cascadeDeleteTeam', async () => {
    // Source position, the way convex/lib/sweeps.test.ts pins its gate: four
    // callers reach the cascade, and a close moved below the teamMonthStats
    // deletes would freeze 'void' while every behavioural test above still
    // passes for deleteTeamFor if someone also moves the aggregate delete.
    const { readFileSync } = await import('node:fs')
    const source = readFileSync(new URL('./teams.ts', import.meta.url), 'utf8')
    const after = source.split('export async function cascadeDeleteTeam')[1]!
    const firstLine = after
      .slice(after.indexOf('{', after.indexOf(')')) + 1)
      .split('\n')
      .map((line) => line.trim())
      .find((line) => line !== '' && !line.startsWith('//'))
    expect(firstLine).toContain('closeChallengesForDeletedTeam(ctx, team._id)')
  })
})
```

The source test's slicing is fragile by nature; the implementer may replace it with
`callSitesOf`/`orderedIn` from `src/test-support/source-ast.ts` if that expresses
"before every `teamMonthStats` query" more robustly — **report which.** Imports to add
at the top of `teams.test.ts`: `deleteTeamFor` (if the existing `./teams.ts` import
block lacks it), `MIN_CHALLENGE_BOARDS` from `./lib/challenge.ts`. For the `Ctx`
parameter, use the type the file already builds from `GenericMutationCtx<DataModel>`.

- [ ] **Step 2: Confirm red.**

- [ ] **Step 3: Implement.** In `convex/challenges.ts`:

```ts
/**
 * Resolve a deleted team's challenges. Called as the FIRST statement of
 * cascadeDeleteTeam, before the derived teamMonthStats rows are removed — see
 * the call site.
 *
 * CLOSED, NOT DELETED: a challenge is a played result, not derived data.
 * A PENDING PROPOSAL IS WITHDRAWN, having never been agreed to.
 * ONLY THE SURVIVOR IS NOTIFIED (owner decision D4).
 */
export async function closeChallengesForDeletedTeam(
  ctx: SchedulingCtx,
  teamId: Id<'teams'>,
): Promise<void> {
  for (const challenge of await liveChallengesFor(ctx, teamId)) {
    if (challenge.status === 'pending') {
      await ctx.db.patch(challenge._id, { status: 'withdrawn' })
      continue
    }
    await closeOne(ctx, challenge, { skipTeamId: teamId })
  }
}
```

In `cascadeDeleteTeam`, as the first statement, with a comment naming the hazard and
the four callers.

**Import direction:** `teams.ts` will import from `challenges.ts`. Confirm
`challenges.ts` imports nothing from `teams.ts` (it does not today) — a cycle here would
be a module-evaluation-order bug in Convex.

- [ ] **Step 4: Mutants.** Move the call below the `teamMonthStats` deletes (RED: the
  first test, outcome becomes `'void'`, AND the source test); delete the call (RED);
  drop `skipTeamId` (RED: survivor-only). Report each.

- [ ] **Step 5: Four gates; commit.**

---

## Task 10b: Fan the close out, one push per person, and a cancel that says so

**bd:** `wordle-teams-zic8.2.20`.

**Owner decisions (2026-10-05), from the Task 10 review:**

- **D5 — one job per challenge.** Every window ends on a month's last day, so every
  challenge comes due on the same day, and Task 10 closes them all inside
  `teamStats.sweep`'s own transaction — beside the team rollups, against one
  execution's read and scheduling limits. Past that limit the whole sweep rolls back,
  rollups included, and does so again every day. Instead the sweep SCHEDULES one
  small close per due challenge, the idiom it already uses for `rollupOne`, and reads
  only live rows through new status indexes.
- **D6 — one push per person.** A direct challenge always has a member on both teams
  (the proposer), who today gets two pushes per event, each calling one of their own
  teams "the opponent". De-duplicate by player: someone on both rosters gets ONE push
  whose body names both teams, `Challengers vs Theirs`, linking to the CHALLENGING
  team's page.
- **D7 — cancel says cancelled.** `cancelChallengeFor` pushes `Challenge cancelled: X`,
  not `Challenge finished: X`.

**Files:** `convex/schema.ts` (+ `schema.test.ts`), `convex/challenges.ts`,
`convex/teamStats.ts`, `convex/challenges.test.ts`, spec §9, §10, §12.

**WHY THE JOB LIVES IN teamStats.ts:** an internal mutation in `challenges.ts` would be
`internal.challenges.*`, and `api.d.ts` does not list `challenges` until
zic8.2.15 regenerates it, so typecheck would fail. `teamStats.ts` is already listed,
already imports from `challenges.ts`, and already holds `rollupOne`, the job this copies.

### The design

1. **Indexes** on `teamChallenges`: `by_status_and_endDay` `['status', 'endDay']` and
   `by_status_and_expiresAt` `['status', 'expiresAt']`. Per the Ground Rules, each
   gets a schema test that queries through it.
2. **`closeDueChallengesFor(ctx, today)`** no longer closes anything. It:
   - expires pending rows through `by_status_and_expiresAt`
     (`eq('status','pending').lte('expiresAt', Date.now())`). Expiry stays inline: it
     is one small patch per row and never pushes;
   - schedules `internal.teamStats.closeChallenge` with `{ challengeId }` for every
     row from `by_status_and_endDay` with `eq('status','active').lte('endDay',
     addDays(today, -2))`. That is the same "closes on endDay + 2" rule:
     `today >= endDay + 2  <=>  endDay <= today - 2`;
   - returns `{ scheduled, expired }`. **There is no try/catch and no `failed`**: a
     close that throws fails its own job and nothing else.
3. **`closeDueChallengeFor(ctx, challengeId)`** (exported from `challenges.ts`): reads
   the row; returns without doing anything if it is gone or not `'active'` (this is
   the idempotence guard: a retried, duplicated or already-cancelled job is a no-op);
   otherwise `closeOne`. **It does not re-check the date**: the sweep decided that, and
   re-deciding it would put the rule in two places.
4. **`teamStats.closeChallenge`** = `internalMutation({ args: { challengeId:
   v.id('teamChallenges') }, handler: (ctx, { challengeId }) => closeDueChallengeFor(ctx,
   challengeId) })`. **Not gated** on `SWEEPS_ENABLED` or `CHALLENGES_ENABLED`: the
   sweep that schedules it is already gated, and a job already scheduled must finish.
5. **`notifyRosters`** builds ONE recipient map over the non-skipped rosters:
   `playerId -> { teamIds }`. A player on one team is pushed as today (the other team's
   name, a link to their own team). A player on BOTH is pushed once, with
   `challengeNotificationBody(event, bothNames)` where `bothNames` is
   `` `${clamp(challenger.name)} vs ${clamp(opponent.name)}` ``, and
   `url: /team?team=<challengerTeamId>`. **The clamp applies to each name, not to the
   joined string**, so neither name can be cut away entirely.
   `challengeNotificationBody` gains a variant for this, or takes the already-composed
   label; your choice, report it. "Shared" is decided only over the rosters being
   notified: with `skipTeamId`, nobody is shared.
6. **The event type** becomes `'accepted' | 'closed' | 'cancelled'`, with body
   `Challenge cancelled: X`. `closeOne` takes the event; `cancelChallengeFor` passes
   `'cancelled'`; the sweep and the deletion close pass `'closed'`.
7. **Comments:** delete every claim that notification "cannot throw" and every
   mention of the per-row catch. `notifyRosters`'s banner stops saying it handles a
   deleted team (its null branch returns without pushing, and is unreachable via
   `closeOne`, which throws first); it says the deleted-team case is `skipTeamId`.

### Tests (the specification)

Rework `describe('closeDueChallengesFor')` and the sweep describe in
`convex/challenges.test.ts`:

- **Scheduling:** on `2026-11-02` a due challenge produces exactly one
  `teamStats:closeChallenge` job whose args are `{ challengeId }`, and the row is
  STILL `'active'` (nothing closes inline). On `2026-10-31` and `2026-11-01`, zero jobs.
- **Expiry:** keep the three expiry tests (stale vs live, the `<=` boundary on a frozen
  clock, and an active row with a past `expiresAt` NOT expired), now through the index.
- **A closed or cancelled row is never scheduled**: a row patched to `'closed'` with an
  old `endDay` produces zero jobs. This is the index's `eq('status','active')` doing its
  job, and its mutant is dropping that `eq`.
- **`closeDueChallengeFor`:** move the freeze assertions here (`closes … and freezes a
  result`, members with names, the push bodies and urls, consent, "a later rewrite of
  the month does NOT restate"). **Twice in a row: the second call writes nothing and
  schedules no push.** A row whose team is gone: it REJECTS with `INVALID_TEAM` and the
  row stays `'active'`. Isolation is now structural, so there is no "does not stop the
  others" test to keep; say so in a comment where it used to be.
- **The wiring, end to end:** drive `internal.teamStats.sweep` on a frozen
  `2026-11-02T00:45Z`, then RUN each queued `teamStats:closeChallenge` job yourself
  with `t.mutation(internal.teamStats.closeChallenge, job.args[0])`, read off
  `_scheduled_functions`. **Do NOT use `finishAllScheduledFunctions`**: it would also
  run `pushSend:deliverTo`, a Node action that talks to a push service. Assert the
  challenge is closed.
- **That describe stubs the env**: `vi.stubEnv('CHALLENGES_ENABLED', '')` in
  `beforeEach`, `vi.unstubAllEnvs()` in `afterEach`. The claim that the close is not
  gated rests on that variable being unset; a host shell with it exported would
  otherwise hide a gated close (Task 10 review, finding 6).
- **D6:** a member on BOTH rosters gets exactly ONE push on accept and on close, body
  `Challenge accepted: Challengers vs Theirs` / `Challenge finished: …`, url the
  challenger team's. Build it with `seedTwoTeams` (whose player IS on both teams) and
  a direct challenge between its two teams; single-team members of each side still get
  the single-name body. And with a 41-code-point name on each side, the shared body
  contains a clamped form of BOTH names.
- **D7:** cancel pushes `Challenge cancelled: <other team>`; the natural close still
  says `finished`.
- **The link-claim accept push** (Task 10 review, finding 5): `claimChallengeLinkFor`
  pushes both rosters, naming the other team. This is the path where `opponentTeamId`
  arrives in the same patch, which is why `activate` re-reads the row.

Mutants to prove (each RED, then reverted): drop `eq('status','active')` from the
scheduling query; `addDays(today, -2)` -> `-1`; the status guard removed from
`closeDueChallengeFor`; recipients not de-duplicated; the clamp applied to the joined
string; `'cancelled'` -> `'closed'` in cancel; the close gated on CHALLENGES_ENABLED
while the host shell exports `CHALLENGES_ENABLED=true` (it must still be RED: that is
what proves the `vi.stubEnv` shields the test from the host); the claim path's re-read replaced by the pre-patch doc.

Then the four gates, and commit.

---

## Task 12a: Team page — the Challenges card, its consent actions, and a dashboard nudge

**bd:** `wordle-teams-zic8.2.12`.

**Owner decisions (2026-10-05):**
- **D1:** pending rows carry their actions — incoming: **Accept / Decline**; outgoing:
  **Withdraw**, shown to the proposer and to the challenging team's owner. Active
  scoreboards carry **Cancel** for either team's owner. Propose is Task 12b.
- **D8 — placement:** a `ChallengesCard` on `/team`, directly BELOW `CurrentTeamCard`
  and ABOVE the scoring card. The owner's "accept challenges" switch sits at the
  bottom of that card, rendered only for the owner.
- **D9 — discovery:** nothing pushes on a proposal, so the DASHBOARD (`/app`) shows a
  one-line nudge — "Your team has been challenged" linking to `/team?team=<id>` —
  when the current team has an incoming, unexpired pending challenge.
- **D10 — verification:** component tests here; then the CONTROLLER runs the app
  against the local e2e backend and screenshots mobile and desktop for the owner.
  The implementer does not run the app.
- `api.d.ts` already lists `challenges` (zic8.2.15, hand-edited): use
  `api.challenges.*` freely. **Do not run any Convex CLI command.**

- [ ] **Step 0: SHIP GATE CHECK.** `bd show wordle-teams-rac`. This task proceeds
  either way, because everything here renders nothing unless the server reports
  `enabled: true`. If rac is open, say so in the report.

**Files:**
- Modify: `convex/challenges.ts` — one small query for the nudge (below)
- Modify: `convex/challenges.test.ts` — its tests, and add it to the gate describe's
  exact-line list
- Create: `src/components/challenges/challenges-card.tsx` — the card (section)
- Create: `src/components/challenges/challenge-scoreboard.tsx` — one active challenge
- Create: `src/components/challenges/pending-challenge-row.tsx` — one pending row
- Create: `src/components/challenges/challenge-nudge.tsx` — the dashboard line
- Create: `src/components/challenges/challenges.hook.test.ts`
- Modify: `src/routes/team.tsx` (the card), `src/routes/app.tsx` (the nudge)

### The nudge query

`incomingChallengeFor(ctx, playerId, teamId, now): Promise<boolean>` in
`convex/challenges.ts`: `requireTeamMemberFor`, then ONE indexed query —
`by_opponent_and_status` with `eq('opponentTeamId', teamId).eq('status','pending')` —
returning whether any row has `expiresAt > now`. No scoreboards, no names, nothing
numeric. Wrapper `incomingChallenge = query({ args: { teamId } })`, whose FIRST
statement is `if (!challengesEnabled(process.env.CHALLENGES_ENABLED)) return false`,
then `requirePlayer`, then the helper with `Date.now()`. Add that exact line to the
gate describe as a third pinned form (a query that answers `false` when dark).

Tests: true for an incoming unexpired pending row; false for an OUTGOING one (this team
is the challenger); false once `expiresAt <= now`; false for an active or declined row;
`NOT_A_MEMBER` for a non-member.

**Why `now` is a parameter:** Convex caches a query's result and does not re-run it
as time passes, so an expiry decided inside a query is stale until something else
invalidates it. That is acceptable for a nudge, and the parameter keeps the helper
testable on a frozen clock. Say so in a comment.

### Components and their tests (the specification)

Tests live in `src/components/challenges/challenges.hook.test.ts`: **a `.ts` file using
`createElement`, NOT JSX** (`vitest.config.ts` includes `src/**/*.test.ts` only, so a
`.tsx` test is SKIPPED SILENTLY), under `// @vitest-environment jsdom`, following
`src/components/Header.hook.test.ts`. **No `toBeInTheDocument`**: jest-dom is not a
dependency; use `queryBy…` with `toBeNull()` / `not.toBeNull()`. Mock Convex the way
the precedent does. Every component takes plain props, so most tests need no Convex.

`ChallengeScoreboard` (props: one entry of `challengesForTeam`'s `active`, plus `pro`,
`viewerIsOwner`, `onCancel`):
1. Both team names, both averages to ONE decimal, both board counts.
2. The window start, as "since 5 Oct", from `startDay`.
3. Who is ahead, named from the VIEWER's side ("You're ahead" / "<Other> is ahead" /
   "Level"), using `viewerIsChallenger` and `outcome`; for `void`, "Not enough boards
   yet" and NO winner wording anywhere.
4. With `pro` and rows present: a member table labelled by `name`, under each team.
   Without `pro`: no member table, and a one-line upgrade hint instead (follow
   `team-picker.tsx`'s upgrade pattern). **The component does not gate**: the server
   already stripped the rows; `pro` only chooses table vs hint.
5. Cancel renders only when `viewerIsOwner`, and calls `onCancel(challengeId)`.

`PendingChallengeRow` (props: one `pending` entry, `viewerIsOwner`, `now`, callbacks):
6. Incoming: the other team's name, Accept and Decline, and NO numbers of any kind (AC3).
7. Outgoing: Withdraw only when `proposedByViewer || viewerIsOwner`.
8. A link proposal (`otherTeamName === null`): "Waiting for a team to claim your link".
9. `expiresAt <= now`: "Expired", and NO actions (AC5).

`ChallengesCard` (props: the query result, `isOwner`, `acceptsChallenges`, `now`,
mutation callbacks):
10. `enabled: false` renders NOTHING — no heading, no empty state.
11. Enabled with nothing live: a one-line empty state (12b adds the propose button).
12. The head-to-head list: "<name> — won W, lost L, tied T" plus "N no result" only when
    non-zero.
13. The owner's switch renders only for an owner, reflects `acceptsChallenges` (absent
    means on), and calls `setAcceptsChallenges` with the flipped value.

`ChallengeNudge` (props: `teamId`, `incoming: boolean`):
14. Renders the line and a link to `/team?team=<teamId>` only when `incoming`.

### Wiring

- **`/team`:** `useSuspenseQuery(convexQuery(api.challenges.challengesForTeam, {
  teamId }))` **inside its own `<Suspense>`** with a small skeleton, the way the
  scoring card is wrapped, so a slow scoreboard never blocks the page. Accept passes
  the viewer's local `today` (`toPuzzleDay(new Date())`, as other mutations on these
  routes do). Errors surface through `convexErrorMessage`, as the page's other
  mutations do. `acceptsChallenges` is NOT in `getMyTeams` today (checked). Add it to
  that query's per-team projection in `convex/teams.ts`, beside `playWeekends` and
  `showLetters`, as a BOOLEAN — `team.acceptsChallenges !== false`, since absent means
  yes — and update any exact-shape `getMyTeams` test that breaks. Add `convex/teams.ts`
  and `convex/teams.test.ts` to this task's files. No new query.
- **`/app`:** `useQuery` (NOT suspense, like the chat-unread signal there) on
  `api.challenges.incomingChallenge` for the current team, rendering `ChallengeNudge`.
  It must never block or delay the dashboard.

### Mutants to prove (each RED, then reverted)
Drop the `enabled` check (10); show Withdraw to everyone (7); name a winner on void
(3); drop the expiry check (9); render the member table regardless of rows (4); flip
the ahead/behind wording for the opponent viewer (3); invert the nudge's
`expiresAt > now` (query test); the nudge query's dark line inverted (gate test).

### Then
Four gates; commit. **The controller then runs the screenshot pass (D10) before the
task is closed** — the implementer reports and stops.

---

## Task 12b: The propose dialog

**bd:** `wordle-teams-zic8.2.19`.

The "Challenge a team" control in the Challenges card header (12a left a marked slot
in `challenges-card.tsx`) and the dialog it opens. AC2: a Pro member can propose to
another team they are on, or make a challenge link; a non-Pro member is shown the
upgrade path rather than a dead control.

**Files:**
- Create: `src/components/challenges/propose-challenge-dialog.tsx`
- Create: `src/lib/share-link.ts` (+ test) — EXTRACTED from
  `src/components/teams/invite-player-dialog.tsx`'s `shareLink`: `navigator.share`
  first where it exists, the clipboard as the fallback, and the same handling of a
  dismissed share sheet and an insecure context. **The invite dialog then calls it,
  and `invite-player-dialog.hook.test.ts` must pass UNCHANGED** — that is the proof
  the extraction preserved behaviour. Two copies of a share rule is how the two
  surfaces come to disagree; that file's own banner says neither API appears
  anywhere else in `src/`, and after this it still won't, outside the helper.
- Modify: `src/components/challenges/challenges-card.tsx` (the control, in the slot)
- Modify: `src/routes/team.tsx` (wires the two mutations and the dialog's data)
- Create: `src/components/challenges/propose-challenge-dialog.hook.test.ts`
  (`.ts` + `createElement`, jsdom, no jest-dom — as 12a)

**The control (in the card header):**
1. A Pro viewer gets a "Challenge a team" button that opens the dialog.
2. A free viewer gets the same label as an upgrade affordance calling `onUpgrade`
   (`openUpgrade('insights')`, as 12a's hint does), never a disabled button.
3. On a dark deployment the card renders nothing (12a), so neither appears.

**The dialog — two entry points:**
4. **Your other teams:** every team from `getMyTeams` EXCEPT the current one, each a
   button calling `proposeToTeam({ challengerTeamId: current, opponentTeamId })`.
   With no other teams, a one-line explanation instead of an empty list, pointing to
   the link option.
5. **A challenge link:** "Create a challenge link" calls
   `proposeByLink({ challengerTeamId })`, builds
   `` `${window.location.origin}/challenge/${token}` `` (the Task 13 route), and
   shares it through `src/lib/share-link.ts`. After a clipboard copy the dialog shows
   a lasting "Link copied", as the invite dialog does.
6. **The link is shown once.** `challengesForTeam` never returns a token, so a
   dismissed link cannot be recovered; the dialog says so in one line ("You can
   withdraw it and make a new one."). Do not add a query that returns tokens.
7. **Every refusal surfaces its own copy** through `mutationErrorMessage`, in a toast,
   with the dialog left open so the user can pick another team:
   `PRO_REQUIRED`, `CHALLENGE_LIMIT_REACHED`, `CHALLENGE_EXISTS`,
   `CHALLENGES_REFUSED`, `CHALLENGES_DISABLED`. A test per code asserts its
   `typedCodeMessage` text is what the user sees.
8. **No double submit:** while a proposal is in flight every team button and the link
   button are disabled.
9. On a successful direct proposal: toast "Challenge sent to <team>", close the
   dialog. (The card's pending list updates by subscription.)

**Mutants to prove:** the current team NOT excluded (4); free viewer gets the dialog
(2); the link built from the wrong path (5); buttons not disabled in flight (8); the
dialog closing on a refusal (7); and, for the extraction, clipboard-first instead of
share-first (the invite dialog's existing tests must catch it).

Four gates; commit. The controller re-shoots the card with the dialog open.

---

## Task 13: The challenge link route

**bd:** `wordle-teams-zic8.2.13`.

`/challenge/<token>`: where a challenge link opens. Unlike a join link it cannot be
spent automatically on `/app`, because the holder must CHOOSE which of their teams
accepts — so the claim happens on this page, and a signed-out holder is brought back
to it after signing in.

**Files:**
- Create: `src/routes/challenge.$token.tsx` — thin: params, auth context, wiring
- Create: `src/components/challenges/challenge-claim.tsx` — the page body, plain props
- Create: `src/components/challenges/challenge-claim.hook.test.ts` (`.ts` +
  `createElement`, jsdom, no jest-dom)
- Create: `src/lib/pending-challenge.ts` (+ `.test.ts`) — sessionStorage stash,
  mirroring `src/lib/pending-invite.ts` exactly (same try/catch tolerance, its own key
  `wt.pendingChallengeToken`)
- Modify: `src/routes/app.tsx` — the resume (below)
- Modify: `public/robots.txt` — `Disallow: /challenge` AND a rationale paragraph in the
  header block beside `/join`'s: the path segment IS the capability
- Modify: `src/crawler-metadata.test.ts` — its sorted exact Disallow list (~170) and
  that test's title
- Modify: `src/lib/maintenance.ts` — `/challenge` in `GATED_SUBTREES` (~124), beside
  `/join`
- Modify: `src/lib/maintenance.test.ts` — its three exact `toEqual` path lists
- Commit: the regenerated `src/routeTree.gen.ts`

**The old sitemap grep is gone:** `src/routes/sitemap[.]xml.ts` holds no entries, so it
could never fail. The real check is `crawler-metadata.test.ts`'s "every route in the app
is listed, disallowed, or deliberately neither" (~591): **run it once with the route
added and BEFORE the robots line, and record that it went red.**

### Behaviour (the specification)

`ChallengeClaim` props: `state` (`'signed-out' | 'loading' | 'ready'`), `teams` (the
viewer's teams from `getMyTeams`), `onClaim(teamId)` returning a promise, `outcome`
(none, or a terminal refusal code). The route supplies them.

1. **Signed out:** the route stashes the token (`rememberPendingChallenge`) and
   replace-navigates to `/login`. The page shows "Opening a challenge" / "One moment…"
   and names nothing — like the join route, it never looks the token up, so an
   anonymous holder learns nothing about whether it is real.
2. **Signed in WITHOUT a player row** (`api.players.needsProfile` is true): the route
   stashes and replace-navigates to `/app`, whose guard sends them through
   `/complete-profile`; the resume brings them back. **Signed in WITH a player row:**
   the route CLEARS any stash on arrival and stashes nothing.

   **WHY NOT STASH FOR EVERY SIGNED-IN VIEWER, as the join route does (defect found by
   the Task 13 implementer, 2026-10-05).** The join route can, because `/app` SPENDS a
   join token. Here `/app` only FORWARDS to this page, so a page that re-stashed on
   every visit would send a player who left without accepting back here on every
   later dashboard visit, for the life of the tab — and a player with no team could
   never reach the dashboard to make one. The stash exists only to carry a token
   through `/login` and `/complete-profile`, so it is set only while there is no
   player row, and cleared the moment a player arrives here.

   With a player row, the page shows "You've been challenged", one line explaining that a team accepts
   on behalf of its members and the window starts tomorrow, and the viewer's teams.
3. **One team:** it is pre-selected and the button reads "Accept for <team>". **Several:**
   radio choices, nothing pre-selected, and the button disabled until one is chosen.
4. **No team at all:** "You need a team to accept a challenge", a link to `/app`, and
   no button.
5. **Accept** calls `claimChallengeLink({ token, opponentTeamId, today:
   toPuzzleDay(new Date()) })` — the viewer's LOCAL day. While in flight the button is
   disabled. On success: clear the stash, toast "Challenge accepted", replace-navigate
   to `/team?team=<chosen>`.
6. **Terminal refusals replace the page body with one message and no buttons:**
   `CHALLENGE_LINK_INVALID` → its `typedCodeMessage` ("That challenge link is no
   longer valid."), and `CHALLENGES_DISABLED` → its message. One message for unknown,
   expired, claimed and withdrawn alike — the server already makes them
   indistinguishable, and the page must not undo that. Clear the stash.
7. **Recoverable refusals toast and leave the picker** so another team can be tried:
   `CHALLENGE_LIMIT_REACHED`, `CHALLENGE_EXISTS`, `CHALLENGES_REFUSED`,
   `INVALID_TEAM` (the challenger's own team), `INVALID_DATE`. Each with its
   `typedCodeMessage`, through `mutationErrorMessage`.

**The resume on `/app`:** when the dashboard renders for a player and a challenge token
is stashed, take it (read AND clear in one step) and replace-navigate to
`/challenge/<token>`. **Only when there is no `?join=` and no pending invite.**
`usePendingInvite` DESTROYS its stash inside its own effect, so: declare the resume
hook BEFORE `usePendingInvite` in `Dashboard`, read `?join` from `window.location` as
that hook does, and add a non-destructive `hasPendingInvite()` peek to
`src/lib/pending-invite.ts` (add it and `pending-invite.test.ts` to this task's files).
**"Invite first, then the challenge in the same arrival" is accepted**: once the invite
stash is taken, the resume may fire on the next effect run while `consumeLink` is still
in flight — the mutation and its toast survive the navigation. Read
`src/lib/use-pending-invite.ts`'s comments on timing first.

Tests: 1-7 for the component; `pending-challenge.ts` mirroring
`pending-invite.test.ts`; the resume as a hook test if `use-pending-invite` has one to
mirror, otherwise report how you pinned it.

**Mutants to prove:** pre-select with several teams (3); the button enabled with none
chosen (3); a UTC `today` (5 — if your test can see it; if not, say so); a terminal
refusal leaving the buttons (6); a recoverable refusal replacing the page (7); the
resume not clearing the stash (loop); the resume running while an invite is pending;
**a signed-in player WITH a row being stashed for** (the trap above — pin "a player who
leaves /challenge reaches /app" with a test that renders the route state for a player
and asserts the stash is empty afterwards); and a needsProfile viewer NOT stashed.

Four gates; commit. The controller screenshots the page signed in with one team, with
several, and the dead-link message.

---

## Task 14: E2E, then the ship gate

**bd:** `wordle-teams-zic8.2.14`.

**Files:**
- Create: `e2e/challenge.spec.ts`
- Modify: `.github/workflows/deploy-v2.yml` — `pnpm exec convex env set
  CHALLENGES_ENABLED true` beside `E2E_TEST_MODE` (~line 229), with one comment line.
  **Without it the spec passes locally and fails in CI**, because the feature is dark
  everywhere the variable is unset. It touches only CI's LOCAL anonymous backend.

**Seed with what exists** (read each function's args first, in `convex/e2eSeed.ts`):
`ensureTeamFor({ email })` gives a player and a team named "E2E Team";
`ensureSharedTeamFor({ emailA, emailB, name })` puts both on a team with that name;
`seedInsightsFor({ email, boards: 0, lastDay: <today>, pro: true })` makes a player
Pro. **Unique e2e emails per run** (`e2e+…-${Date.now()}@wordleteams.com`, as the
other specs do): the backend is shared across runs and a team holds at most five live
challenges.

### Test 1 — a direct challenge, proposed and accepted

A (Pro) is on X ("E2E Team", from `ensureTeamFor`) and Y (`ensureSharedTeamFor(A, B,
'Rivals …')`); B is on Y only.
1. A opens `/team?team=<X>`, opens "Challenge a team", picks Y. The toast says the
   challenge was sent, and X's card lists an outgoing proposal to Y.
2. B (a fresh context) opens `/app?team=<Y>`: the dashboard nudge "Your team has been
   challenged" is visible. B follows it to `/team?team=<Y>` and presses Accept.
3. Both X's page (as A) and Y's page (as B) show a scoreboard naming both teams and
   **"Not enough boards yet"** — NOT averages: the window starts the day after
   acceptance, so a just-accepted challenge has no boards.

### Test 2 — a challenge link, opened while signed out

A creates a link from X. C has their own team only (`ensureTeamFor(C)`).
1. Grant the context `clipboard-read`/`clipboard-write`; headless Chromium has no
   share sheet, so the dialog copies to the clipboard. Read the URL back with
   `navigator.clipboard.readText()` and assert it is `/challenge/<token>`.
2. A fresh, SIGNED-OUT context opens that URL and lands on `/login`. Sign C in with the
   suite's `signIn` **in the same page** (the token rides in sessionStorage, which is
   per tab): C must arrive back on `/challenge/<token>`, not stay on `/app`. This is
   the resume, end to end, which no unit test can render.
3. C's only team is pre-selected; Accept; C lands on `/team?team=<C's team>` with a
   scoreboard showing "Not enough boards yet".
4. Opening the same link again, signed in as C, shows "That challenge link is no
   longer valid." and no buttons.

### Robustness rules (each has cost time in this repo — see bd memories)
- **Wait for data before clicking.** A click right after `goto` can land before
  hydration and do nothing. Wait for a data-driven element first.
- **Every click gets an explicit `{ timeout }`**: `actionTimeout` is 0 here, so a click
  on an element that has gone hangs until the test times out.
- **Never `waitForLoadState('networkidle')`**: Convex keeps a WebSocket open.
- Assert on roles and visible text, as the other specs do; no CSS selectors.

### Running it
The CONTROLLER runs the backend: a local anonymous backend under Node 22 with
`SITE_URL`, `E2E_TEST_MODE` and `CHALLENGES_ENABLED` set. The implementer runs ONLY
the new spec: `pnpm exec playwright test e2e/challenge.spec.ts` (Playwright starts its
own `pnpm dev` on :3000; nothing must already hold that port). The controller then
runs the FULL suite in the background (~11 min; it exceeds the foreground cap).

**Mutants to prove** (each RED in the new spec, then reverted): the resume's forward
removed in `app.tsx` (Test 2.2 must fail); the claim route's `onClaimed` navigation
removed (2.3); the nudge not rendered (1.2); `incomingChallenge` answering `false`
always (1.2).

### Then — the ship gate
`bd show wordle-teams-rac`. If it is not closed, the feature merges and deploys DARK:
`CHALLENGES_ENABLED` stays unset in production and on beta, and that is reported to
the owner rather than decided. Close the issues; a bd-only commit aborts once — retry
with `||`.

---

## Self-Review

**Spec coverage.** Every section maps to a task: §3 metric/fairness → Tasks 1-3; §4 data model → Task 4; §5 rules module → Tasks 1-3; §6 snapshot → Tasks 4, 10; §7 the five constants → Task 1 (defined), Tasks 5-7, 10 (enforced); §8 server surface → Tasks 5-9; §8.1 propose-vs-accept checks → Task 7 (four bypass tests); §8.2 record semantics → Task 9; §8.3 deletion cascade → Task 11; §9 close on the sweep → Task 10; §10 push → Task 10; §11 UI → Tasks 12-13; §12 read cost → Task 9 (asserted by the two-document test); §13 testing → throughout; §15 acceptance criteria 1 → Task 14 Step 4.

**Two things deliberately not in a task.** The §8.3 mid-window roster property needs no code — it is what `teamStats` already does — and it is documented in the spec rather than enforced. The §10 push defects (`2dl6`, `i5pj`, `cvvn`) are explicitly out of scope and must not grow a workaround here.

**Type consistency.** `ChallengeTotals` / `ChallengeMemberTotal` / `StatsDay` (Task 2) are used unchanged in Tasks 9-10. `ChallengeOutcome` (Task 3) is the same union as the schema literal union (Task 4) and the `result.outcome` field. `challengeSideValidator` (Task 4) requires `name` as well as `teamId`, and `ChallengeSide` spells that field `teamName` — which is why `closeOne` needs an explicit `strip` that RENAMES it rather than a spread. The snapshot stores the name ON PURPOSE: a rename must not rewrite who a closed challenge was against, and the deletion cascade reads both names before the row goes. **This sentence previously claimed the opposite, as settled fact, because the field was added during Task 4's review and never propagated here — two independent adversarial reviewers ranked that contradiction the single most likely thing to stop a later task.** `meanAttemptsOf` is the only averaging function anywhere; no `teamAverageOf` is ever defined.

**One known gap, filed rather than hidden.** `closeDueChallengesFor` uses `collect()` over the whole table. Correct at this volume, wrong eventually. Task 10 Step 8 says to file the bd issue.
