# Game Abstraction Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let a team's scoreboard serve more than one game, so the clue ladder can sit beside Wordle without touching Wordle's scoring, winners, challenges, leagues, reminders or onboarding.

**Architecture:** `monthTotal` stops reading Wordle boards and takes attempts per day instead. A game registry (`convex/lib/games.ts`) gives each game three readers: results for a date range, "has played" for one day, and the first day played. A new query, `getTeamGameMonth`, walks the roster through the registry. The month window and the scoring system are shared with Wordle's `getTeamMonth`, which keeps its exact shape. The clue ladder is gated twice: a deployment switch (`CLUE_LADDER_ENABLED`) and a per-team opt-in (`teams.clueLadderEnabled`) that only the owner can change.

**Tech Stack:** Convex (queries, mutations, schema), convex-test, Vitest, TypeScript (erasable syntax only).

**Spec:** `docs/superpowers/specs/2026-10-14-clue-ladder-design.md`, sections 4, 5 and 7. Build order step 1.

---

## Two departures from the spec, and why

1. **The `clueLadderPlays` table is created here, not in plan 3.** The registry's clue ladder entry reads it, and the scoreboard cannot be tested without rows to read. Plan 3 adds the puzzle table and every function that writes plays. Plan 2 can then render real rows instead of a stub.
2. **A new query, `getTeamGameMonth`, instead of a `game` argument on `getTeamMonth`.** `getTeamMonth` returns raw Wordle boards (guesses and answer), and six components read that shape through `useSuspenseQuery`. A `game` argument would turn its return type into a union and force every one of them to narrow it. A separate query returns `{ puzzleDay, attempts }` for any game, and `getTeamMonth` is left byte-identical. The month gate and scoring-system lookup are extracted and shared, so the two cannot drift.

Both are recorded on the plan's Beads epic.

## Ground rules for every task

- Imports inside `convex/lib/` use explicit `.ts` extensions. Type-only imports use `import type` / inline `type` (`verbatimModuleSyntax` is on).
- `$SCRATCH` below means the session scratchpad directory. Gate logs go there, not into the repo.
- Run one test file with: `TZ=UTC pnpm exec vitest run <path>`
- **Never pipe a gate into `tail`/`grep`.** zsh has no `PIPESTATUS`, so a piped red gate reads as green. Redirect to a file, read `$?`, then read the file.
- Commit messages end with `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`. Use a quoted heredoc (`git commit -F - <<'EOF'`), since backticks in `-m "..."` get executed. Never `--no-verify`.
- After each task, close its Beads issue (`bd close <id>`) and include `.beads/issues.jsonl` in the commit. Then check `git show HEAD:.beads/issues.jsonl` records the issue as `"status":"closed"`. If it doesn't, the export lagged: `git add .beads/issues.jsonl && git commit --amend --no-edit`.
- Tests that set `CLUE_LADDER_ENABLED` use `vi.stubEnv` and an `afterEach(() => vi.unstubAllEnvs())`. The Vitest config does not unstub automatically.
- The repo's comments explain *why* at length. Match that where you add non-obvious rules; don't add comments that restate the code.

## Beads issues

Epic: `wordle-teams-9j7o.2.2.1`. Each task blocks the next.

| Task | Issue |
|---|---|
| 1 Scoring takes attempts | `wordle-teams-9j7o.2.2.1.1` |
| 2 Schema, switch and error codes | `wordle-teams-9j7o.2.2.1.2` |
| 3 Game registry | `wordle-teams-9j7o.2.2.1.3` |
| 4 Team opt-in | `wordle-teams-9j7o.2.2.1.4` |
| 5 Game scoreboard query | `wordle-teams-9j7o.2.2.1.5` |
| 6 Gates and record | `wordle-teams-9j7o.2.2.1.6` |

Claim each with `bd update <id> --claim` before starting it. Close the epic after Task 6.

## File structure

| File | Responsibility |
|---|---|
| `convex/lib/scoring.ts` | `AttemptDay`, `wordleDays`, and `monthTotal` over attempts |
| `convex/lib/clueLadder/flag.ts` | `CLUE_LADDER_ON` and `clueLadderSwitchOn`: the deployment switch |
| `convex/schema.ts` | `teams.clueLadderEnabled` and the `clueLadderPlays` table |
| `convex/access.ts` | Two new codes: `CLUE_LADDER_DISABLED`, `CLUE_LADDER_NOT_ON_TEAM` |
| `convex/lib/games.ts` | The registry: `GameId`, `gameValidator`, `GAMES`, `clueLadderAttempts`, `requireGameOnTeam` |
| `convex/games.ts` | Public API: `setTeamClueLadder` mutation, `clueLadderSwitch` query |
| `convex/teams.ts` | `getMyTeamsFor` gains `clueLadderEnabled` |
| `convex/scores.ts` | Shared month gate and system lookup; `getTeamGameMonth`; `monthWindow` takes an optional game |

New tests: `convex/lib/games.test.ts`, `convex/games.test.ts`, `convex/teamGameMonth.test.ts`. Changed tests: `convex/lib/scoring.test.ts`, `convex/teams.test.ts`.

---

### Task 1: Scoring takes attempts

**Files:**
- Modify: `convex/lib/scoring.ts`
- Modify: `convex/lib/scoring.test.ts`
- Modify (callers): `convex/winners.ts:218`, `convex/migrate.ts:1312`, `convex/migrate.ts:1773`, `src/components/scores-table.tsx:233`

`monthTotal` currently takes Wordle boards (`scores: ScoredDay[]`) and calls `attemptsFor` itself. After this task it takes `days: AttemptDay[]`, and Wordle callers convert with `wordleDays`. Wordle totals must be identical before and after. The test below proves that against a frozen copy of today's function.

- [ ] **Step 1: Write the equivalence test and switch the existing tests to the new shape**

At the top of `convex/lib/scoring.test.ts`, change the import and add the frozen copy and the property test:

```ts
import { describe, expect, test } from 'vitest'
import { attemptsFor } from './board.ts'
import { createRng } from './clueLadder/rng.ts'
import { daysOfMonth, isWeekendDay } from './puzzleDay.ts'
import {
  monthTotal,
  pointsFor,
  winnerOf,
  wordleDays,
  type ScoredDay,
  type ScoringSystem,
} from './scoring'
```

Then, in every one of the seven `monthTotal({ ... })` calls in the existing `describe('monthTotal')` block, change the `scores:` property to `days:` and wrap its array in `wordleDays(...)`. For example:

```ts
    const total = monthTotal({
      month: '2026-08',
      days: wordleDays([
        played('2026-08-03', ['SPEED'], 'SPEED'), // 1 attempt -> 5
        played('2026-08-04', ['CRANE', 'SPEED'], 'SPEED'), // 2 -> 3
      ]),
      system,
      playWeekends: true,
      today: '2026-08-05',
    })
```

Leave every expected value unchanged. Append this block at the end of the file:

```ts
// monthTotal as it stood before it took attempts (wordle-teams-9j7o.2.2). Frozen
// here so the refactor is measured against the old behaviour, not against itself.
function legacyMonthTotal(opts: {
  month: string
  scores: Array<ScoredDay>
  system: ScoringSystem
  playWeekends: boolean
  today: string
}): number {
  const { month, scores, system, playWeekends, today } = opts
  const byDay = new Map<string, ScoredDay>()
  for (const score of scores) {
    if (!byDay.has(score.puzzleDay)) byDay.set(score.puzzleDay, score)
  }
  return daysOfMonth(month).reduce((total, day) => {
    if (!playWeekends && isWeekendDay(day)) return total
    const score = byDay.get(day)
    if (score) return total + pointsFor(attemptsFor(score.guesses, score.answer ?? ''), system)
    if (day < today) return total + system.nA
    return total
  }, 0)
}

describe('monthTotal over attempts', () => {
  const WORDS = ['SPEED', 'CRANE', 'SLATE', 'TRICE', 'MOUND', 'PLUMB', 'GHOST']

  // 500 random months of Wordle boards: wins on every guess count, six-guess
  // losses, duplicate rows for one day, missing answers, weekends on and off.
  test('Wordle totals are identical to the frozen pre-refactor function', () => {
    const rng = createRng(20261014)
    for (let i = 0; i < 500; i++) {
      const month = `2026-${String(rng.int(12) + 1).padStart(2, '0')}`
      const days = daysOfMonth(month)
      const scores: Array<ScoredDay> = []
      for (let n = rng.int(40); n > 0; n--) {
        const answer = rng.pick(WORDS)
        const length = rng.int(6) + 1
        const guesses = Array.from({ length }, () => rng.pick(WORDS))
        scores.push({ puzzleDay: rng.pick(days), guesses, answer: rng.int(10) === 0 ? undefined : answer })
      }
      const opts = {
        month,
        system,
        playWeekends: rng.int(2) === 0,
        today: rng.pick(days),
      }
      expect(monthTotal({ ...opts, days: wordleDays(scores) })).toBe(legacyMonthTotal({ ...opts, scores }))
    }
  })

  test('takes any game’s attempts, with 7 scoring the failure value', () => {
    const total = monthTotal({
      month: '2026-08',
      days: [
        { puzzleDay: '2026-08-03', attempts: 4 },
        { puzzleDay: '2026-08-04', attempts: 7 },
      ],
      system,
      playWeekends: false,
      today: '2026-08-05',
    })
    // 3rd: 4 attempts -> 1. 4th: failed -> -3. 1st and 2nd are a skipped weekend.
    expect(total).toBe(-2)
  })

  test('wordleDays keeps row order, so the first row for a day still wins', () => {
    expect(
      wordleDays([
        { puzzleDay: '2026-08-03', guesses: ['SPEED'], answer: 'SPEED' },
        { puzzleDay: '2026-08-03', guesses: ['CRANE', 'SPEED'], answer: 'SPEED' },
      ]),
    ).toEqual([
      { puzzleDay: '2026-08-03', attempts: 1 },
      { puzzleDay: '2026-08-03', attempts: 2 },
    ])
  })
})
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `TZ=UTC pnpm exec vitest run convex/lib/scoring.test.ts > "$SCRATCH/s1.log" 2>&1; echo "exit $?"`
Expected: exit 1. `wordleDays` is not exported, and `monthTotal` has no `days` option.

- [ ] **Step 3: Change `convex/lib/scoring.ts`**

Add after the `ScoredDay` type:

```ts
/**
 * One day's result for any game: attempts 1–6, or 7 for a failed day — the
 * numbers pointsFor already understands (wordle-teams-9j7o.2.2).
 */
export type AttemptDay = {
  puzzleDay: PuzzleDay
  attempts: number
}

/**
 * Wordle boards as attempts. ROW ORDER IS KEPT, so monthTotal's first-row-wins
 * rule for duplicate days applies exactly as it did when it read boards.
 */
export function wordleDays(scores: Array<ScoredDay>): Array<AttemptDay> {
  return scores.map((score) => ({
    puzzleDay: score.puzzleDay,
    attempts: attemptsFor(score.guesses, score.answer ?? ''),
  }))
}
```

Replace `monthTotal` (keep its doc comment, and add the last paragraph shown):

```ts
/**
 * One player's total for one month.
 *
 * `today` is supplied by the caller rather than read from a clock: the client
 * sends its own local today, and the pure function stays deterministic and
 * testable. Days from `today` onward are not yet due and score nothing; earlier
 * days with no board score the team's N/A value, which is how v1 penalises a
 * miss.
 *
 * GAME-NEUTRAL SINCE wordle-teams-9j7o.2.2: it takes attempts, not boards.
 * Wordle callers convert with wordleDays; the clue ladder's results arrive as
 * attempts already (lib/games.ts).
 */
export function monthTotal(opts: {
  month: PuzzleMonth
  days: Array<AttemptDay>
  system: ScoringSystem
  playWeekends: boolean
  today: PuzzleDay
}): number {
  const { month, days, system, playWeekends, today } = opts

  // First row wins for a day. Production holds 5 duplicate (player, day) pairs
  // that the copy deliberately preserved, and v1's find() takes the first too.
  const byDay = new Map<PuzzleDay, AttemptDay>()
  for (const day of days) {
    if (!byDay.has(day.puzzleDay)) byDay.set(day.puzzleDay, day)
  }

  return daysOfMonth(month).reduce((total, day) => {
    if (!playWeekends && isWeekendDay(day)) return total
    const result = byDay.get(day)
    if (result) return total + pointsFor(result.attempts, system)
    // Lexicographic compare — 'YYYY-MM-DD' sorts chronologically.
    if (day < today) return total + system.nA
    return total
  }, 0)
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `TZ=UTC pnpm exec vitest run convex/lib/scoring.test.ts > "$SCRATCH/s1.log" 2>&1; echo "exit $?"`
Expected: exit 0.

- [ ] **Step 5: Convert the four callers**

Each passes Wordle boards today, so each wraps them in `wordleDays`.

`convex/winners.ts` (around line 218): change `scores,` inside the `monthTotal({` call to `days: wordleDays(scores),`, and change the import on line 7 to:

```ts
import { monthTotal, winnerOf, wordleDays } from './lib/scoring.ts'
```

`convex/migrate.ts`, both calls (around lines 1312 and 1773): change

```ts
monthTotal({ month, scores, system, playWeekends: team.playWeekends, today })
```

to

```ts
monthTotal({ month, days: wordleDays(scores), system, playWeekends: team.playWeekends, today })
```

and change the import on line 29 to:

```ts
import { monthTotal, winnerOf, wordleDays } from './lib/scoring.ts'
```

`src/components/scores-table.tsx` (around line 233): change `scores: player.scores,` to `days: wordleDays(player.scores),`, and change the import on line 10 to:

```ts
import { monthTotal, wordleDays } from '../../convex/lib/scoring.ts'
```

Then confirm nothing else calls `monthTotal` with `scores`:

Run: `rg -n 'monthTotal\(' -g '*.ts' -g '*.tsx' . > "$SCRATCH/mt.log" 2>&1; echo "exit $?"` and read the file. Every non-test call must pass `days:`.

- [ ] **Step 6: Typecheck and run the suites that use `monthTotal`**

```bash
pnpm typecheck > "$SCRATCH/tc1.log" 2>&1; echo "tc $?"
TZ=UTC pnpm exec vitest run convex/lib/scoring.test.ts convex/winners.test.ts convex/scores.test.ts convex/migrate.test.ts src/components > "$SCRATCH/t1.log" 2>&1; echo "test $?"
pnpm lint > "$SCRATCH/l1.log" 2>&1; echo "lint $?"
```

Expected: all three print `0`. If `src/components` matches no scores-table test, Vitest still exits 0 for the other files. Read the log to confirm the files ran.

- [ ] **Step 7: Commit**

```bash
bd close wordle-teams-9j7o.2.2.1.1
git add convex/lib/scoring.ts convex/lib/scoring.test.ts convex/winners.ts convex/migrate.ts src/components/scores-table.tsx .beads/issues.jsonl
git commit -F - <<'EOF'
refactor(scoring): monthTotal takes attempts per day

Game-neutral so the clue ladder can share the team scoreboard. Wordle
callers convert with wordleDays; a property test pins Wordle totals to
a frozen copy of the old function over 500 random months.

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
EOF
```

---

### Task 2: Schema, switch and error codes

**Files:**
- Create: `convex/lib/clueLadder/flag.ts`, `convex/lib/clueLadder/flag.test.ts`
- Modify: `convex/schema.ts` (the `teams` table, ending around line 361, and a new table after it)
- Modify: `convex/access.ts` (the `AccessCode` union, ending around line 180)

- [ ] **Step 1: Write the failing test**

`convex/lib/clueLadder/flag.test.ts`:

```ts
import { describe, expect, test } from 'vitest'
import { CLUE_LADDER_ON, clueLadderSwitchOn } from './flag.ts'

describe('clueLadderSwitchOn', () => {
  test('only the exact string turns it on', () => {
    expect(clueLadderSwitchOn(CLUE_LADDER_ON)).toBe(true)
    expect(clueLadderSwitchOn('true')).toBe(true)
  })

  test.each([undefined, '', 'TRUE', '1', 'yes', ' true'])('%j leaves it off', (value) => {
    expect(clueLadderSwitchOn(value)).toBe(false)
  })
})
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `TZ=UTC pnpm exec vitest run convex/lib/clueLadder/flag.test.ts > "$SCRATCH/s2.log" 2>&1; echo "exit $?"`
Expected: exit 1, "Cannot find module './flag.ts'".

- [ ] **Step 3: Write `convex/lib/clueLadder/flag.ts`**

```ts
/**
 * The clue ladder's deployment switch, CLUE_LADDER_ENABLED
 * (wordle-teams-9j7o.2.2). The same rule as CHALLENGES_ENABLED
 * (lib/challenge.ts): only the exact string 'true' turns it on, so a typo
 * fails closed.
 *
 * TAKES THE VALUE AS A PARAMETER rather than reading process.env, for the
 * reason challengesEnabled gives: every call site names the variable it
 * consults, and the host's shell stays out of the assertions.
 */

/** The one value that turns the clue ladder ON. Exported so no caller spells it. */
export const CLUE_LADDER_ON = 'true'

export function clueLadderSwitchOn(value: string | undefined): boolean {
  return value === CLUE_LADDER_ON
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `TZ=UTC pnpm exec vitest run convex/lib/clueLadder/flag.test.ts > "$SCRATCH/s2.log" 2>&1; echo "exit $?"`
Expected: exit 0.

- [ ] **Step 5: Add the schema fields**

In `convex/schema.ts`, in the `teams` table directly after `acceptsChallenges: v.optional(v.boolean()),`, add:

```ts
    /**
     * WHETHER THIS TEAM PLAYS THE CLUE LADDER (wordle-teams-9j7o.2.2).
     *
     * ABSENT MEANS NO — the opposite of acceptsChallenges, deliberately. The
     * clue ladder is a pilot that a team opts INTO, and no existing team should
     * find a new game on its dashboard. Only the owner changes it
     * (games.ts setTeamClueLadder), and it counts only while the
     * CLUE_LADDER_ENABLED deployment switch is on (lib/games.ts
     * requireGameOnTeam).
     */
    clueLadderEnabled: v.optional(v.boolean()),
```

Directly after the `teams` table's closing `}).index('by_legacyId', ['legacyId']),`, and after the comment block that follows it, add the play table. Place it before the `scoringSystems` comment block:

```ts
  /**
   * ONE ROW PER PLAYER PER CLUE LADDER DATE (spec section 4).
   *
   * Created here so the game registry and the team scoreboard have something to
   * read (wordle-teams-9j7o.2.2). Every WRITER — start, nextClue, saveScratch,
   * lockIn — arrives with the puzzle table in plan 3 (wordle-teams-9j7o.2.3).
   *
   * `date` is the player's local day, as `dailyScores.puzzleDay` is, and the
   * index is unique by convention, not by the database: Convex has no unique
   * constraints, so the single writer (plan 3's start) looks the row up first.
   *
   * A RESULT BELONGS TO THE PLAYER, NOT A TEAM, exactly as a Wordle board does,
   * so there is no teamId: it shows on every opted-in team the player is on.
   *
   * `scratch` is the player's in-progress arrangement, five slots, null where
   * empty. It is never checked against the answer.
   */
  clueLadderPlays: defineTable({
    playerId: v.id('players'),
    date: v.string(),
    cluesRevealed: v.number(),
    status: v.union(v.literal('playing'), v.literal('solved'), v.literal('failed')),
    scratch: v.array(
      v.union(
        v.literal('triangle'),
        v.literal('square'),
        v.literal('circle'),
        v.literal('diamond'),
        v.literal('star'),
        v.null(),
      ),
    ),
    lockedOrder: v.optional(
      v.array(
        v.union(
          v.literal('triangle'),
          v.literal('square'),
          v.literal('circle'),
          v.literal('diamond'),
          v.literal('star'),
        ),
      ),
    ),
    lockedAtClue: v.optional(v.number()),
    startedAt: v.number(),
    finishedAt: v.optional(v.number()),
  }).index('by_player_and_date', ['playerId', 'date']),
```

The five literals must match `SHAPES` in `convex/lib/clueLadder/orders.ts`. Task 3 adds a test that pins this.

- [ ] **Step 6: Add the two error codes**

In `convex/access.ts`, at the end of the `AccessCode` union (after `| 'AUTOMATIC_LEAGUE'`), add:

```ts
  // The clue ladder (wordle-teams-9j7o.2.2). CLUE_LADDER_DISABLED is the
  // CLUE_LADDER_ENABLED deployment switch being off (lib/clueLadder/flag.ts);
  // CLUE_LADDER_NOT_ON_TEAM is a team whose owner has not opted it in
  // (teams.clueLadderEnabled). Turning a team's clue ladder OFF never refuses.
  | 'CLUE_LADDER_DISABLED'
  | 'CLUE_LADDER_NOT_ON_TEAM'
```

- [ ] **Step 7: Typecheck and run the schema tests**

```bash
pnpm typecheck > "$SCRATCH/tc2.log" 2>&1; echo "tc $?"
TZ=UTC pnpm exec vitest run convex/schema.test.ts convex/teams.test.ts > "$SCRATCH/t2.log" 2>&1; echo "test $?"
pnpm lint > "$SCRATCH/l2.log" 2>&1; echo "lint $?"
```

Expected: all three print `0`.

- [ ] **Step 8: Commit**

```bash
bd close wordle-teams-9j7o.2.2.1.2
git add convex/lib/clueLadder/flag.ts convex/lib/clueLadder/flag.test.ts convex/schema.ts convex/access.ts .beads/issues.jsonl
git commit -F - <<'EOF'
feat(clue-ladder): deployment switch, team opt-in field and plays table

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
EOF
```

---

### Task 3: Game registry

**Files:**
- Create: `convex/lib/games.ts`, `convex/lib/games.test.ts`

Each game answers three questions about one player: their results over a date range, whether they have finished a given day, and the first day they ever played. The clue ladder's results follow spec sections 4 and 5:

- `solved` gives `lockedAtClue`.
- `failed` gives 7.
- `playing` gives 7 once the date has passed, and is left out until then.

"Passed" means the date lies below the window `requirePlausibleToday` accepts: earlier than the server's today minus one day. At that point no player anywhere can still be on it.

- [ ] **Step 1: Write the failing test**

`convex/lib/games.test.ts`:

```ts
import { convexTest } from 'convex-test'
import { afterEach, describe, expect, test, vi } from 'vitest'
import schema from '../schema'
import { aPlayer, aTeam } from '../fixtures.ts'
import { SHAPES } from './clueLadder/orders.ts'
import {
  clueLadderAttempts,
  FAILED_ATTEMPTS,
  GAMES,
  isPassedDate,
  requireGameOnTeam,
} from './games.ts'
import { addDays, toPuzzleDay } from './puzzleDay.ts'

const modules = import.meta.glob('../**/*.ts')
const today = toPuzzleDay(new Date())

afterEach(() => vi.unstubAllEnvs())

/** The ConvexError code a synchronous guard throws, or undefined if it passes. */
function codeOf(guard: () => void): string | undefined {
  try {
    guard()
  } catch (error) {
    return (error as { data?: { code?: string } }).data?.code
  }
  return undefined
}

const aPlay = (over: Record<string, unknown> = {}) => ({
  date: today,
  cluesRevealed: 1,
  status: 'playing' as const,
  scratch: [null, null, null, null, null],
  startedAt: 1_760_000_000_000,
  ...over,
})

describe('isPassedDate', () => {
  test('a date stays live while any time zone can still be on it', () => {
    expect(isPassedDate(addDays(today, 1), today)).toBe(false)
    expect(isPassedDate(today, today)).toBe(false)
    expect(isPassedDate(addDays(today, -1), today)).toBe(false)
  })

  test('two days back has passed everywhere', () => {
    expect(isPassedDate(addDays(today, -2), today)).toBe(true)
  })
})

describe('clueLadderAttempts', () => {
  test('a solved play scores the clue it locked in on', () => {
    expect(clueLadderAttempts({ status: 'solved', lockedAtClue: 4, cluesRevealed: 4, date: today }, today)).toBe(4)
  })

  test('a failed play is an X', () => {
    expect(clueLadderAttempts({ status: 'failed', lockedAtClue: 2, cluesRevealed: 2, date: today }, today)).toBe(
      FAILED_ATTEMPTS,
    )
  })

  test('an unfinished play on a live date has no result yet', () => {
    expect(clueLadderAttempts({ status: 'playing', cluesRevealed: 3, date: addDays(today, -1) }, today)).toBeNull()
  })

  test('an unfinished play on a passed date is an X', () => {
    expect(clueLadderAttempts({ status: 'playing', cluesRevealed: 3, date: addDays(today, -2) }, today)).toBe(
      FAILED_ATTEMPTS,
    )
  })

  test('FAILED_ATTEMPTS is the count pointsFor scores as a failure', () => {
    expect(FAILED_ATTEMPTS).toBe(7)
  })
})

describe('GAMES.wordle', () => {
  test('reads boards in the range as attempts, in index order', async () => {
    await convexTest(schema, modules).run(async (ctx) => {
      const playerId = await ctx.db.insert('players', aPlayer())
      const board = { playerId, date: 1_755_500_000_000, answer: 'SPEED' }
      await ctx.db.insert('dailyScores', { ...board, puzzleDay: '2026-08-02', guesses: ['SPEED'] })
      await ctx.db.insert('dailyScores', { ...board, puzzleDay: '2026-08-03', guesses: ['CRANE', 'SPEED'] })
      await ctx.db.insert('dailyScores', { ...board, puzzleDay: '2026-09-01', guesses: ['SPEED'] })

      expect(await GAMES.wordle.resultsFor(ctx, playerId, '2026-08-01', '2026-08-31')).toEqual([
        { puzzleDay: '2026-08-02', attempts: 1 },
        { puzzleDay: '2026-08-03', attempts: 2 },
      ])
      expect(await GAMES.wordle.hasPlayed(ctx, playerId, '2026-08-03')).toBe(true)
      expect(await GAMES.wordle.hasPlayed(ctx, playerId, '2026-08-04')).toBe(false)
      expect(await GAMES.wordle.firstDay(ctx, playerId)).toBe('2026-08-02')
    })
  })

  test('a player with no boards has no first day', async () => {
    await convexTest(schema, modules).run(async (ctx) => {
      const playerId = await ctx.db.insert('players', aPlayer())
      expect(await GAMES.wordle.firstDay(ctx, playerId)).toBeNull()
    })
  })
})

describe('GAMES.clueLadder', () => {
  test('reads plays in the range, leaving out a live unfinished one', async () => {
    await convexTest(schema, modules).run(async (ctx) => {
      const playerId = await ctx.db.insert('players', aPlayer())
      const old = addDays(today, -5)
      await ctx.db.insert('clueLadderPlays', { ...aPlay({ date: addDays(today, -6) }), playerId })
      await ctx.db.insert(
        'clueLadderPlays',
        { ...aPlay({ date: old, status: 'solved', cluesRevealed: 4, lockedAtClue: 4 }), playerId },
      )
      await ctx.db.insert(
        'clueLadderPlays',
        { ...aPlay({ date: addDays(today, -4), status: 'failed', cluesRevealed: 3, lockedAtClue: 3 }), playerId },
      )
      await ctx.db.insert('clueLadderPlays', { ...aPlay({ date: today }), playerId })

      expect(await GAMES.clueLadder.resultsFor(ctx, playerId, addDays(today, -6), today)).toEqual([
        { puzzleDay: addDays(today, -6), attempts: 7 },
        { puzzleDay: old, attempts: 4 },
        { puzzleDay: addDays(today, -4), attempts: 7 },
      ])
    })
  })

  test('has played means finished, not started', async () => {
    await convexTest(schema, modules).run(async (ctx) => {
      const playerId = await ctx.db.insert('players', aPlayer())
      await ctx.db.insert('clueLadderPlays', { ...aPlay({ date: today }), playerId })
      await ctx.db.insert(
        'clueLadderPlays',
        { ...aPlay({ date: addDays(today, -1), status: 'solved', cluesRevealed: 5, lockedAtClue: 5 }), playerId },
      )
      expect(await GAMES.clueLadder.hasPlayed(ctx, playerId, today)).toBe(false)
      expect(await GAMES.clueLadder.hasPlayed(ctx, playerId, addDays(today, -1))).toBe(true)
      expect(await GAMES.clueLadder.hasPlayed(ctx, playerId, addDays(today, -2))).toBe(false)
      expect(await GAMES.clueLadder.firstDay(ctx, playerId)).toBe(addDays(today, -1))
    })
  })

  test('the plays table accepts exactly the engine’s five shapes', async () => {
    await convexTest(schema, modules).run(async (ctx) => {
      const playerId = await ctx.db.insert('players', aPlayer())
      await ctx.db.insert('clueLadderPlays', {
        ...aPlay({ scratch: [...SHAPES], lockedOrder: [...SHAPES] }),
        playerId,
      })
      await expect(
        ctx.db.insert('clueLadderPlays', { ...aPlay({ scratch: ['hexagon', null, null, null, null] }), playerId }),
      ).rejects.toThrow()
    })
  })
})

describe('requireGameOnTeam', () => {
  test('Wordle needs nothing', () => {
    expect(codeOf(() => requireGameOnTeam(aTeam(), 'wordle'))).toBeUndefined()
  })

  test('the clue ladder refuses while the deployment switch is off, even for an opted-in team', () => {
    vi.stubEnv('CLUE_LADDER_ENABLED', '')
    expect(codeOf(() => requireGameOnTeam(aTeam({ clueLadderEnabled: true }), 'clueLadder'))).toBe(
      'CLUE_LADDER_DISABLED',
    )
  })

  test('the clue ladder refuses a team that has not opted in', () => {
    vi.stubEnv('CLUE_LADDER_ENABLED', 'true')
    for (const clueLadderEnabled of [undefined, false]) {
      expect(codeOf(() => requireGameOnTeam(aTeam({ clueLadderEnabled }), 'clueLadder'))).toBe(
        'CLUE_LADDER_NOT_ON_TEAM',
      )
    }
  })

  test('the clue ladder passes with the switch on and the team opted in', () => {
    vi.stubEnv('CLUE_LADDER_ENABLED', 'true')
    expect(codeOf(() => requireGameOnTeam(aTeam({ clueLadderEnabled: true }), 'clueLadder'))).toBeUndefined()
  })
})
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `TZ=UTC pnpm exec vitest run convex/lib/games.test.ts > "$SCRATCH/s3.log" 2>&1; echo "exit $?"`
Expected: exit 1, "Cannot find module './games.ts'".

- [ ] **Step 3: Write `convex/lib/games.ts`**

```ts
import { v } from 'convex/values'
import type { GenericDatabaseReader } from 'convex/server'
import type { DataModel, Doc, Id } from '../_generated/dataModel'
import { accessError } from '../access.ts'
import { clueLadderSwitchOn } from './clueLadder/flag.ts'
import { addDays, toPuzzleDay, type PuzzleDay } from './puzzleDay.ts'
import { wordleDays, type AttemptDay } from './scoring.ts'

/**
 * The game registry (wordle-teams-9j7o.2.2, spec section 5).
 *
 * Each game answers three questions about ONE player, so the team scoreboard,
 * and later reminders, onboarding, challenges and leagues (spec section 7), can
 * ask them without knowing which table holds the answer. Results are attempts,
 * 1–6 or 7 for a failure, which is what monthTotal and pointsFor understand.
 */

type ReaderCtx = { db: GenericDatabaseReader<DataModel> }

export const GAME_IDS = ['wordle', 'clueLadder'] as const
export type GameId = (typeof GAME_IDS)[number]
export const gameValidator = v.union(v.literal('wordle'), v.literal('clueLadder'))

/** The attempt count for an X, the same number a failed Wordle board scores. */
export const FAILED_ATTEMPTS = 7

export type Game = {
  id: GameId
  name: string
  /** Results with puzzleDay in [fromDay, toDay], in index order. */
  resultsFor(ctx: ReaderCtx, playerId: Id<'players'>, fromDay: PuzzleDay, toDay: PuzzleDay): Promise<AttemptDay[]>
  /** Whether the player has FINISHED this day. Used by reminders and onboarding later. */
  hasPlayed(ctx: ReaderCtx, playerId: Id<'players'>, day: PuzzleDay): Promise<boolean>
  /** The first day the player has a row for, or null; feeds the Pro month window. */
  firstDay(ctx: ReaderCtx, playerId: Id<'players'>): Promise<PuzzleDay | null>
}

const wordle: Game = {
  id: 'wordle',
  name: 'Wordle',
  async resultsFor(ctx, playerId, fromDay, toDay) {
    const rows = await ctx.db
      .query('dailyScores')
      .withIndex('by_player_and_puzzleDay', (q) =>
        q.eq('playerId', playerId).gte('puzzleDay', fromDay).lte('puzzleDay', toDay),
      )
      .collect()
    return wordleDays(rows)
  },
  async hasPlayed(ctx, playerId, day) {
    const row = await ctx.db
      .query('dailyScores')
      .withIndex('by_player_and_puzzleDay', (q) => q.eq('playerId', playerId).eq('puzzleDay', day))
      .first()
    return row !== null
  },
  async firstDay(ctx, playerId) {
    // Ascending by default, so the index range's first row is the earliest day.
    const row = await ctx.db
      .query('dailyScores')
      .withIndex('by_player_and_puzzleDay', (q) => q.eq('playerId', playerId))
      .first()
    return row?.puzzleDay ?? null
  },
}

/**
 * Whether no player anywhere can still be on `date`.
 *
 * requirePlausibleToday (access.ts) accepts a client's today within one day of
 * the server's, so a date is live down to server-today minus one. Below that,
 * every time zone has moved on and an unfinished play can never finish.
 */
export function isPassedDate(date: PuzzleDay, serverToday: PuzzleDay): boolean {
  return date < addDays(serverToday, -1)
}

/**
 * One play's attempts, or null while it can still be finished (spec section 4).
 *
 * A solved play scores the clue it locked in on. `lockedAtClue` is set by the
 * one writer that solves a play (plan 3's lockIn) and equals `cluesRevealed`
 * from then on, so falling back to `cluesRevealed` only ever covers a row that
 * writer did not produce.
 */
export function clueLadderAttempts(
  play: Pick<Doc<'clueLadderPlays'>, 'status' | 'lockedAtClue' | 'cluesRevealed' | 'date'>,
  serverToday: PuzzleDay,
): number | null {
  if (play.status === 'solved') return play.lockedAtClue ?? play.cluesRevealed
  if (play.status === 'failed') return FAILED_ATTEMPTS
  return isPassedDate(play.date, serverToday) ? FAILED_ATTEMPTS : null
}

const clueLadder: Game = {
  id: 'clueLadder',
  name: 'Clue ladder',
  async resultsFor(ctx, playerId, fromDay, toDay) {
    const serverToday = toPuzzleDay(new Date())
    const plays = await ctx.db
      .query('clueLadderPlays')
      .withIndex('by_player_and_date', (q) => q.eq('playerId', playerId).gte('date', fromDay).lte('date', toDay))
      .collect()
    const results: AttemptDay[] = []
    for (const play of plays) {
      const attempts = clueLadderAttempts(play, serverToday)
      if (attempts !== null) results.push({ puzzleDay: play.date, attempts })
    }
    return results
  },
  async hasPlayed(ctx, playerId, day) {
    const play = await ctx.db
      .query('clueLadderPlays')
      .withIndex('by_player_and_date', (q) => q.eq('playerId', playerId).eq('date', day))
      .first()
    return play !== null && play.status !== 'playing'
  },
  async firstDay(ctx, playerId) {
    const play = await ctx.db
      .query('clueLadderPlays')
      .withIndex('by_player_and_date', (q) => q.eq('playerId', playerId))
      .first()
    return play?.date ?? null
  },
}

export const GAMES: Record<GameId, Game> = { wordle, clueLadder }

/**
 * Refuses a game this team cannot see. Wordle is every team's; the clue ladder
 * needs the CLUE_LADDER_ENABLED deployment switch AND the owner's opt-in.
 * The switch is checked first, so turning it off answers the same way for
 * every team: it is the kill switch (spec section 8).
 */
export function requireGameOnTeam(team: Pick<Doc<'teams'>, 'clueLadderEnabled'>, game: GameId): void {
  if (game === 'wordle') return
  if (!clueLadderSwitchOn(process.env.CLUE_LADDER_ENABLED)) throw accessError('CLUE_LADDER_DISABLED')
  if (team.clueLadderEnabled !== true) throw accessError('CLUE_LADDER_NOT_ON_TEAM')
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `TZ=UTC pnpm exec vitest run convex/lib/games.test.ts > "$SCRATCH/s3.log" 2>&1; echo "exit $?"`
Expected: exit 0.

- [ ] **Step 5: Typecheck and lint**

```bash
pnpm typecheck > "$SCRATCH/tc3.log" 2>&1; echo "tc $?"
pnpm lint > "$SCRATCH/l3.log" 2>&1; echo "lint $?"
```

Expected: both print `0`. `convex/pushableModules.test.ts` forbids `import.meta` in pushed files, and `games.ts` has none. The glob lives only in the test file.

- [ ] **Step 6: Commit**

```bash
bd close wordle-teams-9j7o.2.2.1.3
git add convex/lib/games.ts convex/lib/games.test.ts .beads/issues.jsonl
git commit -F - <<'EOF'
feat(games): game registry with Wordle and clue ladder readers

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
EOF
```

---

### Task 4: Team opt-in

**Files:**
- Create: `convex/games.ts`, `convex/games.test.ts`
- Modify: `convex/teams.ts` (`getMyTeamsFor`'s returned object, after `acceptsChallenges`, around line 145)
- Modify: `convex/teams.test.ts`

Only the team owner can switch the clue ladder on or off. Switching **on** is refused while the deployment switch is off. Switching **off** always works, so an owner is never stuck with a game they can't remove. The dashboard needs to know whether a team sees the game, so `getMyTeamsFor` reports the *effective* state: the switch and the opt-in together.

- [ ] **Step 1: Write the failing tests**

`convex/games.test.ts`:

```ts
import { convexTest } from 'convex-test'
import type { GenericDatabaseWriter } from 'convex/server'
import { afterEach, describe, expect, test, vi } from 'vitest'
import schema from './schema'
import type { DataModel } from './_generated/dataModel'
import { aPlayer, aTeam } from './fixtures.ts'
import { setTeamClueLadderFor } from './games'

const modules = import.meta.glob('./**/*.ts')

afterEach(() => vi.unstubAllEnvs())

type Ctx = { db: GenericDatabaseWriter<DataModel> }

async function seedTeam(ctx: Ctx) {
  const owner = await ctx.db.insert('players', aPlayer())
  const member = await ctx.db.insert('players', aPlayer({ email: 'bob@example.com', firstName: 'Bob' }))
  const teamId = await ctx.db.insert('teams', aTeam({ playerIds: [owner, member], owner }))
  return { owner, member, teamId }
}

describe('setTeamClueLadderFor', () => {
  test('the owner switches it on, and back off', async () => {
    vi.stubEnv('CLUE_LADDER_ENABLED', 'true')
    await convexTest(schema, modules).run(async (ctx) => {
      const { owner, teamId } = await seedTeam(ctx)
      await setTeamClueLadderFor(ctx, owner, teamId, true)
      expect((await ctx.db.get(teamId))?.clueLadderEnabled).toBe(true)
      await setTeamClueLadderFor(ctx, owner, teamId, false)
      expect((await ctx.db.get(teamId))?.clueLadderEnabled).toBe(false)
    })
  })

  test('a member who is not the owner is refused', async () => {
    vi.stubEnv('CLUE_LADDER_ENABLED', 'true')
    await convexTest(schema, modules).run(async (ctx) => {
      const { member, teamId } = await seedTeam(ctx)
      await expect(setTeamClueLadderFor(ctx, member, teamId, true)).rejects.toMatchObject({
        data: { code: 'NOT_TEAM_OWNER' },
      })
      expect((await ctx.db.get(teamId))?.clueLadderEnabled).toBeUndefined()
    })
  })

  test('switching on is refused while the deployment switch is off', async () => {
    vi.stubEnv('CLUE_LADDER_ENABLED', '')
    await convexTest(schema, modules).run(async (ctx) => {
      const { owner, teamId } = await seedTeam(ctx)
      await expect(setTeamClueLadderFor(ctx, owner, teamId, true)).rejects.toMatchObject({
        data: { code: 'CLUE_LADDER_DISABLED' },
      })
      expect((await ctx.db.get(teamId))?.clueLadderEnabled).toBeUndefined()
    })
  })

  test('switching off works even while the deployment switch is off', async () => {
    vi.stubEnv('CLUE_LADDER_ENABLED', '')
    await convexTest(schema, modules).run(async (ctx) => {
      const { owner, teamId } = await seedTeam(ctx)
      await ctx.db.patch(teamId, { clueLadderEnabled: true })
      await setTeamClueLadderFor(ctx, owner, teamId, false)
      expect((await ctx.db.get(teamId))?.clueLadderEnabled).toBe(false)
    })
  })
})
```

Append to `convex/teams.test.ts`, inside `describe('getMyTeamsFor', ...)`, after the `acceptsChallenges` test. If the file does not already import `afterEach` and `vi` from `vitest`, add them to its import, and add `afterEach(() => vi.unstubAllEnvs())` at the top of this `describe`:

```ts
  test('carries clueLadderEnabled: the deployment switch AND the owner’s opt-in, absent reading false', async () => {
    const t = convexTest(schema, modules)
    await t.run(async (ctx) => {
      const ada = await ctx.db.insert('players', aPlayer())
      await ctx.db.insert('teams', aTeam({ legacyId: 301, name: 'Absent', playerIds: [ada], owner: ada, createdAt: 1 }))
      await ctx.db.insert(
        'teams',
        aTeam({ legacyId: 302, name: 'Off', playerIds: [ada], owner: ada, createdAt: 2, clueLadderEnabled: false }),
      )
      await ctx.db.insert(
        'teams',
        aTeam({ legacyId: 303, name: 'On', playerIds: [ada], owner: ada, createdAt: 3, clueLadderEnabled: true }),
      )

      vi.stubEnv('CLUE_LADDER_ENABLED', 'true')
      const on = await getMyTeamsFor(ctx, ada)
      expect(Object.fromEntries(on.map((team) => [team.name, team.clueLadderEnabled]))).toEqual({
        Absent: false,
        Off: false,
        On: true,
      })

      vi.stubEnv('CLUE_LADDER_ENABLED', '')
      const off = await getMyTeamsFor(ctx, ada)
      expect(off.every((team) => team.clueLadderEnabled === false)).toBe(true)
    })
  })
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `TZ=UTC pnpm exec vitest run convex/games.test.ts convex/teams.test.ts > "$SCRATCH/s4.log" 2>&1; echo "exit $?"`
Expected: exit 1. `./games` has no `setTeamClueLadderFor`, and `clueLadderEnabled` is undefined on the team payload.

- [ ] **Step 3: Write `convex/games.ts`**

```ts
import { v } from 'convex/values'
import type { GenericDatabaseWriter } from 'convex/server'
import { mutation, query } from './_generated/server'
import type { DataModel, Id } from './_generated/dataModel'
import { accessError, requirePlayer, requireTeamOwnerFor } from './access'
import { clueLadderSwitchOn } from './lib/clueLadder/flag.ts'

/**
 * Which games a team plays (wordle-teams-9j7o.2.2). Wordle is every team's; the
 * clue ladder is a pilot the owner opts the team into (spec section 4).
 */

type WriterCtx = { db: GenericDatabaseWriter<DataModel> }

/**
 * The owner switches the team's clue ladder on or off.
 *
 * ON IS REFUSED WHILE THE DEPLOYMENT SWITCH IS OFF; OFF NEVER IS. An owner must
 * always be able to take a game off their team, whatever the deployment's
 * state, as ending a challenge always works (challenges.ts).
 */
export async function setTeamClueLadderFor(
  ctx: WriterCtx,
  playerId: Id<'players'>,
  teamId: Id<'teams'>,
  enabled: boolean,
): Promise<void> {
  if (enabled && !clueLadderSwitchOn(process.env.CLUE_LADDER_ENABLED)) throw accessError('CLUE_LADDER_DISABLED')
  await requireTeamOwnerFor(ctx, playerId, teamId)
  await ctx.db.patch(teamId, { clueLadderEnabled: enabled })
}

export const setTeamClueLadder = mutation({
  args: { teamId: v.id('teams'), enabled: v.boolean() },
  handler: async (ctx, { teamId, enabled }) => {
    const player = await requirePlayer(ctx)
    await setTeamClueLadderFor(ctx, player._id, teamId, enabled)
  },
})

/**
 * Whether the deployment offers the clue ladder at all. The owner's team
 * settings show the opt-in toggle only when it does (plan 2).
 */
export const clueLadderSwitch = query({
  args: {},
  handler: async () => ({ enabled: clueLadderSwitchOn(process.env.CLUE_LADDER_ENABLED) }),
})
```

- [ ] **Step 4: Add `clueLadderEnabled` to `getMyTeamsFor`**

In `convex/teams.ts`, add the import:

```ts
import { clueLadderSwitchOn } from './lib/clueLadder/flag.ts'
```

and in the object `getMyTeamsFor` returns, directly after the `acceptsChallenges: team.acceptsChallenges !== false,` line, add:

```ts
        // THE CLUE LADDER AS THIS TEAM SEES IT (wordle-teams-9j7o.2.2): the
        // deployment switch AND the owner's opt-in. ABSENT MEANS OFF — the
        // reverse of acceptsChallenges — because the pilot is opt-in, so
        // `=== true`, never `!== false`.
        clueLadderEnabled: clueLadderSwitchOn(process.env.CLUE_LADDER_ENABLED) && team.clueLadderEnabled === true,
```

- [ ] **Step 5: Run the tests to verify they pass**

Run: `TZ=UTC pnpm exec vitest run convex/games.test.ts convex/teams.test.ts > "$SCRATCH/s4.log" 2>&1; echo "exit $?"`
Expected: exit 0.

- [ ] **Step 6: Typecheck and lint**

```bash
pnpm typecheck > "$SCRATCH/tc4.log" 2>&1; echo "tc $?"
pnpm lint > "$SCRATCH/l4.log" 2>&1; echo "lint $?"
```

Expected: both print `0`.

- [ ] **Step 7: Commit**

```bash
bd close wordle-teams-9j7o.2.2.1.4
git add convex/games.ts convex/games.test.ts convex/teams.ts convex/teams.test.ts .beads/issues.jsonl
git commit -F - <<'EOF'
feat(games): team owner opts the team into the clue ladder

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
EOF
```

---

### Task 5: Game scoreboard query

**Files:**
- Modify: `convex/scores.ts` (`getTeamMonthFor` lines 47–243, `earliestMonthFor` lines 306–348, `monthWindowInputsFor` and `monthWindow` lines 377–392)
- Create: `convex/teamGameMonth.test.ts`

This task extracts two pieces from `getTeamMonthFor` so a second query can share them:

- the month gate, as `requireMonthInWindowFor`;
- the scoring-system lookup, as `teamMonthSystemFor`.

It makes `earliestMonthFor` game-aware through the registry, adds `getTeamGameMonthFor`/`getTeamGameMonth`, and gives `monthWindow` an optional `game`. `getTeamMonth`'s behaviour and return shape do not change. Its existing tests in `convex/scores.test.ts`, including the document-count guards, must stay green untouched.

- [ ] **Step 1: Write the failing tests**

`convex/teamGameMonth.test.ts`:

```ts
import { convexTest } from 'convex-test'
import { afterEach, describe, expect, test, vi } from 'vitest'
import schema from './schema'
import { aPlayer, aTeam } from './fixtures.ts'
import { addDays, addMonths, monthOf, toPuzzleDay } from './lib/puzzleDay.ts'
import { monthTotal, wordleDays } from './lib/scoring.ts'
import { getTeamGameMonthFor, getTeamMonthFor, monthWindowInputsFor } from './scores'

const modules = import.meta.glob('./**/*.ts')

// Days and months derive from the real clock, for the reasons scores.test.ts's
// header gives: the month gate moves with the calendar.
const today = toPuzzleDay(new Date())
const thisMonth = monthOf(today)
const ancientMonth = addMonths(thisMonth, -30)

afterEach(() => vi.unstubAllEnvs())

const aPlay = (over: Record<string, unknown> = {}) => ({
  date: today,
  cluesRevealed: 1,
  status: 'playing' as const,
  scratch: [null, null, null, null, null],
  startedAt: 1_760_000_000_000,
  ...over,
})

describe('getTeamGameMonthFor — wordle', () => {
  test('totals match getTeamMonthFor for every player', async () => {
    await convexTest(schema, modules).run(async (ctx) => {
      const ada = await ctx.db.insert('players', aPlayer())
      const bob = await ctx.db.insert('players', aPlayer({ email: 'bob@example.com', firstName: 'Bob' }))
      const teamId = await ctx.db.insert('teams', aTeam({ playerIds: [ada, bob], owner: ada }))
      const board = { date: 1_755_500_000_000, answer: 'SPEED' }
      const day = (n: number) => `${thisMonth}-${String(n).padStart(2, '0')}`
      await ctx.db.insert('dailyScores', { ...board, playerId: ada, puzzleDay: day(1), guesses: ['SPEED'] })
      // A duplicate day: the first row must win in both paths.
      await ctx.db.insert('dailyScores', { ...board, playerId: ada, puzzleDay: day(1), guesses: ['CRANE', 'SPEED'] })
      await ctx.db.insert('dailyScores', {
        ...board,
        playerId: bob,
        puzzleDay: day(2),
        guesses: ['CRANE', 'CRANE', 'CRANE', 'CRANE', 'CRANE', 'CRANE'],
      })

      const boards = await getTeamMonthFor(ctx, ada, teamId, thisMonth)
      const game = await getTeamGameMonthFor(ctx, ada, teamId, thisMonth, 'wordle')
      const opts = { month: thisMonth, playWeekends: boards.team.playWeekends, today }
      for (const player of boards.players) {
        const twin = game.players.find((p) => p.id === player.id)
        expect(twin).toBeDefined()
        expect(monthTotal({ ...opts, system: game.team.system, days: twin!.results })).toBe(
          monthTotal({ ...opts, system: boards.team.system, days: wordleDays(player.scores) }),
        )
      }
      expect(game.team.system).toEqual(boards.team.system)
      expect(game.game).toBe('wordle')
    })
  })

  test('refuses a non-member before reading anything', async () => {
    await convexTest(schema, modules).run(async (ctx) => {
      const ada = await ctx.db.insert('players', aPlayer())
      const outsider = await ctx.db.insert('players', aPlayer({ email: 'out@example.com' }))
      const teamId = await ctx.db.insert('teams', aTeam({ playerIds: [ada], owner: ada }))
      await expect(getTeamGameMonthFor(ctx, outsider, teamId, thisMonth, 'wordle')).rejects.toMatchObject({
        data: { code: 'NOT_A_MEMBER' },
      })
    })
  })
})

describe('getTeamGameMonthFor — clue ladder', () => {
  test('refuses while the deployment switch is off', async () => {
    vi.stubEnv('CLUE_LADDER_ENABLED', '')
    await convexTest(schema, modules).run(async (ctx) => {
      const ada = await ctx.db.insert('players', aPlayer())
      const teamId = await ctx.db.insert('teams', aTeam({ playerIds: [ada], owner: ada, clueLadderEnabled: true }))
      await expect(getTeamGameMonthFor(ctx, ada, teamId, thisMonth, 'clueLadder')).rejects.toMatchObject({
        data: { code: 'CLUE_LADDER_DISABLED' },
      })
    })
  })

  test('refuses a team that has not opted in', async () => {
    vi.stubEnv('CLUE_LADDER_ENABLED', 'true')
    await convexTest(schema, modules).run(async (ctx) => {
      const ada = await ctx.db.insert('players', aPlayer())
      const teamId = await ctx.db.insert('teams', aTeam({ playerIds: [ada], owner: ada }))
      await expect(getTeamGameMonthFor(ctx, ada, teamId, thisMonth, 'clueLadder')).rejects.toMatchObject({
        data: { code: 'CLUE_LADDER_NOT_ON_TEAM' },
      })
    })
  })

  test('a non-member hears NOT_A_MEMBER, not which games the team plays', async () => {
    vi.stubEnv('CLUE_LADDER_ENABLED', 'true')
    await convexTest(schema, modules).run(async (ctx) => {
      const ada = await ctx.db.insert('players', aPlayer())
      const outsider = await ctx.db.insert('players', aPlayer({ email: 'out@example.com' }))
      const teamId = await ctx.db.insert('teams', aTeam({ playerIds: [ada], owner: ada }))
      await expect(getTeamGameMonthFor(ctx, outsider, teamId, thisMonth, 'clueLadder')).rejects.toMatchObject({
        data: { code: 'NOT_A_MEMBER' },
      })
    })
  })

  test('returns each member’s results and the team’s points with X fixed at -1', async () => {
    vi.stubEnv('CLUE_LADDER_ENABLED', 'true')
    await convexTest(schema, modules).run(async (ctx) => {
      const ada = await ctx.db.insert('players', aPlayer())
      const bob = await ctx.db.insert('players', aPlayer({ email: 'bob@example.com', firstName: 'Bob' }))
      const teamId = await ctx.db.insert(
        'teams',
        aTeam({ playerIds: [ada, bob], owner: ada, clueLadderEnabled: true, failed: -3, fourGuesses: 1 }),
      )
      await ctx.db.insert('clueLadderPlays', {
        ...aPlay({ status: 'solved', cluesRevealed: 4, lockedAtClue: 4 }),
        playerId: ada,
      })
      await ctx.db.insert('clueLadderPlays', { ...aPlay(), playerId: bob })

      const month = await getTeamGameMonthFor(ctx, ada, teamId, thisMonth, 'clueLadder')
      expect(month.game).toBe('clueLadder')
      expect(month.team.system.failed).toBe(-1)
      expect(month.team.system.fourGuesses).toBe(1)
      expect(month.players.map((p) => [p.firstName, p.results])).toEqual([
        ['Ada', [{ puzzleDay: today, attempts: 4 }]],
        ['Bob', []],
      ])
    })
  })

  test('the Pro window comes from clue ladder plays, not Wordle boards', async () => {
    vi.stubEnv('CLUE_LADDER_ENABLED', 'true')
    await convexTest(schema, modules).run(async (ctx) => {
      const ada = await ctx.db.insert('players', aPlayer())
      const teamId = await ctx.db.insert('teams', aTeam({ playerIds: [ada], owner: ada, clueLadderEnabled: true }))
      await ctx.db.insert('playerMembership', { playerId: ada, membershipStatus: 'pro' })
      await ctx.db.insert('dailyScores', {
        playerId: ada,
        puzzleDay: `${ancientMonth}-14`,
        date: 1_755_500_000_000,
        answer: 'SPEED',
        guesses: ['SPEED'],
      })

      // The ancient Wordle board opens that month for Wordle...
      await expect(getTeamGameMonthFor(ctx, ada, teamId, ancientMonth, 'wordle')).resolves.toBeDefined()
      // ...but the clue ladder has no plays that old, so it stays shut.
      await expect(getTeamGameMonthFor(ctx, ada, teamId, ancientMonth, 'clueLadder')).rejects.toMatchObject({
        data: { code: 'MONTH_OUT_OF_WINDOW' },
      })
      expect(await monthWindowInputsFor(ctx, ada, teamId, 'clueLadder')).toEqual({ earliestMonth: null })
      expect(await monthWindowInputsFor(ctx, ada, teamId)).toEqual({ earliestMonth: ancientMonth })
    })
  })

  test('the month window refuses the clue ladder for a team that has not opted in', async () => {
    vi.stubEnv('CLUE_LADDER_ENABLED', 'true')
    await convexTest(schema, modules).run(async (ctx) => {
      const ada = await ctx.db.insert('players', aPlayer())
      const teamId = await ctx.db.insert('teams', aTeam({ playerIds: [ada], owner: ada }))
      await expect(monthWindowInputsFor(ctx, ada, teamId, 'clueLadder')).rejects.toMatchObject({
        data: { code: 'CLUE_LADDER_NOT_ON_TEAM' },
      })
    })
  })

  test('a passed unfinished play counts as an X on the board', async () => {
    vi.stubEnv('CLUE_LADDER_ENABLED', 'true')
    await convexTest(schema, modules).run(async (ctx) => {
      const ada = await ctx.db.insert('players', aPlayer())
      const teamId = await ctx.db.insert('teams', aTeam({ playerIds: [ada], owner: ada, clueLadderEnabled: true }))
      const passed = addDays(today, -3)
      await ctx.db.insert('clueLadderPlays', { ...aPlay({ date: passed }), playerId: ada })
      const month = await getTeamGameMonthFor(ctx, ada, teamId, monthOf(passed), 'clueLadder')
      expect(month.players[0].results).toEqual([{ puzzleDay: passed, attempts: 7 }])
    })
  })
})
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `TZ=UTC pnpm exec vitest run convex/teamGameMonth.test.ts > "$SCRATCH/s5.log" 2>&1; echo "exit $?"`
Expected: exit 1. `getTeamGameMonthFor` is not exported.

- [ ] **Step 3: Extract the month gate**

In `convex/scores.ts`, add a new function above `getTeamMonthFor`. **Move** the comment blocks that currently sit inside `getTeamMonthFor` between `const team = ...` and `const { start, end } = monthRange(month)` into this function, unchanged, at the same statements they annotate. The comments are shortened to `// ...` markers below only to keep this plan readable. The real file keeps every word.

```ts
/**
 * Refuses a month this caller may not see, for one game (wordle-teams-kusd;
 * game-aware since wordle-teams-9j7o.2.2). Shared by getTeamMonthFor and
 * getTeamGameMonthFor so the two scoreboards cannot disagree about the window.
 */
async function requireMonthInWindowFor(
  ctx: ReaderCtx,
  playerId: Id<'players'>,
  team: Doc<'teams'>,
  month: string,
  game: GameId,
): Promise<void> {
  // ... THE MONTH GATE / THE SHAPE CHECK IS FIRST comments, moved verbatim
  if (!isMonth(month)) throw accessError('MONTH_OUT_OF_WINDOW')

  // ... THE FREE FLOOR IS CHECKED FIRST / THE CLOCK READ comments, moved verbatim
  const serverMonth = monthOf(toPuzzleDay(new Date()))
  const freeFloor = serverFloorFor({ currentMonth: serverMonth, earliestMonth: null, pro: false })
  if (month < freeFloor) {
    // ... DOES THE REFUSAL RE-FIRE comment, moved verbatim
    if (!(await isProFor(ctx, playerId))) throw accessError('MONTH_OUT_OF_WINDOW')

    // ... THE SAME serverFloorFor comment, moved verbatim
    const earliestMonth = await earliestMonthFor(ctx, team.playerIds, game)
    if (month < serverFloorFor({ currentMonth: serverMonth, earliestMonth, pro: true })) {
      throw accessError('MONTH_OUT_OF_WINDOW')
    }
  }
}
```

In `getTeamMonthFor`, replace the moved region (from `if (!isMonth(month))` through the closing `}` of `if (month < freeFloor) { ... }`) with:

```ts
  await requireMonthInWindowFor(ctx, playerId, team, month, 'wordle')
```

The phrase "IT SITS HERE, BEFORE THE PER-MEMBER READS, AND MUST STAY HERE" still holds: the call stays before the reads. Leave a one-line comment at the call: `// The gate, before any per-member read — see requireMonthInWindowFor.`

- [ ] **Step 4: Extract the scoring-system lookup**

Add above `getTeamMonthFor`:

```ts
/**
 * The scoring system that governed `month` for this team, as the eight point
 * fields, plus the version's effective month (null for the team's originals).
 * Shared by both scoreboards.
 */
async function teamMonthSystemFor(ctx: ReaderCtx, team: Doc<'teams'>, month: PuzzleMonth) {
  // ... The system that governed the month being VIEWED comment, moved verbatim
  const versions = await ctx.db
    .query('scoringSystems')
    .withIndex('by_team_and_effectiveFrom', (q) => q.eq('teamId', team._id))
    .collect()
  const system = systemFor(team, versions, month)
  return {
    // `systemFor` returns either a stored version row or the team doc itself as
    // the fallback, so pick the eight fields explicitly — that is what keeps
    // the invite list (and a version row's _id) off the wire.
    system: {
      oneGuess: system.oneGuess,
      twoGuesses: system.twoGuesses,
      threeGuesses: system.threeGuesses,
      fourGuesses: system.fourGuesses,
      fiveGuesses: system.fiveGuesses,
      sixGuesses: system.sixGuesses,
      failed: system.failed,
      nA: system.nA,
    },
    // null when the month resolved to the team's original values — that is
    // what tells the Scoring System card there is no "historical" badge.
    systemEffectiveFrom: effectiveFromOf(versions, month),
  }
}
```

In `getTeamMonthFor`, replace the `versions`/`system` reads with `const { system, systemEffectiveFrom } = await teamMonthSystemFor(ctx, team, month)`. Then replace the inline eight-field `system: { ... }` object and `systemEffectiveFrom: effectiveFromOf(versions, month),` in its return with `system,` and `systemEffectiveFrom,`. Its returned shape is unchanged.

- [ ] **Step 5: Make `earliestMonthFor` game-aware**

Change its signature to take the game, and replace the `dailyScores` read with the registry's `firstDay`. Keep its doc comment and the ghost-member comments. Update the doc comment's first paragraph to say the first row now comes from `GAMES[game].firstDay`, which reads the same index with `.first()`:

```ts
async function earliestMonthFor(
  ctx: ReaderCtx,
  playerIds: readonly Id<'players'>[],
  game: GameId,
): Promise<PuzzleMonth | null> {
  const firsts = await Promise.all(
    playerIds.map(async (memberId) => {
      // (the A ROSTER ENTRY WITH NO PLAYER ROW comment, unchanged)
      const member = await ctx.db.get(memberId)
      if (!member) return null
      return GAMES[game].firstDay(ctx, memberId)
    }),
  )

  let earliest: string | null = null
  for (const day of firsts) {
    // (the PuzzleDay is 'YYYY-MM-DD' BY CONVENTION comment, unchanged)
    if (day !== null && (earliest === null || day < earliest)) earliest = day
  }
  return earliest === null ? null : monthOf(earliest)
}
```

- [ ] **Step 6: Add the game scoreboard and the game-aware window**

Add after `getTeamMonth`:

```ts
/**
 * One team's month for any game, as attempts per day (wordle-teams-9j7o.2.2).
 *
 * A SEPARATE QUERY FROM getTeamMonth, NOT A `game` ARGUMENT ON IT. getTeamMonth
 * returns raw Wordle boards, which six components read; a union return type
 * would make every one of them narrow it. This returns `{ puzzleDay, attempts }`
 * for every game, which is all the scores table needs to total a month.
 *
 * THE ORDER OF REFUSALS IS DELIBERATE: membership, then the game, then the
 * month. A non-member learns nothing about which games a team plays, and no
 * month is gated for a game the team cannot see.
 */
export async function getTeamGameMonthFor(
  ctx: ReaderCtx,
  playerId: Id<'players'>,
  teamId: Id<'teams'>,
  month: string,
  game: GameId,
) {
  const team = await requireTeamMemberFor(ctx, playerId, teamId)
  requireGameOnTeam(team, game)
  await requireMonthInWindowFor(ctx, playerId, team, month, game)

  const { start, end } = monthRange(month)
  const { system, systemEffectiveFrom } = await teamMonthSystemFor(ctx, team, month)

  // Promise.all and the missing-player guard for the reasons getTeamMonthFor gives.
  const resolved = await Promise.all(
    team.playerIds.map(async (memberId) => {
      const member = await ctx.db.get(memberId)
      if (!member) return null
      return {
        id: member._id,
        firstName: member.firstName,
        lastName: member.lastName,
        results: await GAMES[game].resultsFor(ctx, memberId, start, end),
      }
    }),
  )

  return {
    game,
    team: {
      id: team._id,
      name: team.name,
      playWeekends: team.playWeekends,
      // The clue ladder keeps the team's points for 1–6 and missed days but
      // fixes X at -1 (spec section 2): with the default -3, the simulation had
      // careful play win about 90% of months.
      system: game === 'clueLadder' ? clueLadderSystem(system) : system,
      systemEffectiveFrom,
    },
    players: resolved.filter((member): member is NonNullable<typeof member> => member !== null),
  }
}

export const getTeamGameMonth = query({
  args: { teamId: v.id('teams'), month: v.string(), game: gameValidator },
  handler: async (ctx, { teamId, month, game }) => {
    const player = await requirePlayer(ctx)
    return await getTeamGameMonthFor(ctx, player._id, teamId, month, game)
  },
})
```

Change `monthWindowInputsFor` and `monthWindow`:

```ts
export async function monthWindowInputsFor(
  ctx: ReaderCtx,
  playerId: Id<'players'>,
  teamId: Id<'teams'>,
  game: GameId = 'wordle',
): Promise<{ earliestMonth: PuzzleMonth | null }> {
  const team = await requireTeamMemberFor(ctx, playerId, teamId)
  requireGameOnTeam(team, game)
  return { earliestMonth: await earliestMonthFor(ctx, team.playerIds, game) }
}

export const monthWindow = query({
  // `game` is optional so every existing caller keeps Wordle's window.
  args: { teamId: v.id('teams'), game: v.optional(gameValidator) },
  handler: async (ctx, { teamId, game }) => {
    const player = await requirePlayer(ctx)
    return await monthWindowInputsFor(ctx, player._id, teamId, game ?? 'wordle')
  },
})
```

Update `scores.ts`'s imports:

```ts
import { clueLadderSystem } from './lib/clueLadder/points.ts'
import { GAMES, gameValidator, requireGameOnTeam, type GameId } from './lib/games.ts'
import type { Doc, Id, DataModel } from './_generated/dataModel'
```

`effectiveFromOf` and `systemFor` stay imported.

- [ ] **Step 7: Run the new tests, then the scores suites unchanged**

```bash
TZ=UTC pnpm exec vitest run convex/teamGameMonth.test.ts > "$SCRATCH/s5.log" 2>&1; echo "new $?"
TZ=UTC pnpm exec vitest run convex/scores.test.ts convex/dashboardBandwidth.test.ts convex/winners.test.ts > "$SCRATCH/s5b.log" 2>&1; echo "old $?"
```

Expected: both print `0`. `convex/scores.test.ts` is **not** edited in this task. If a document-count guard in it fails, the refactor changed the read pattern. Fix the code, not the guard.

- [ ] **Step 8: Typecheck and lint**

```bash
pnpm typecheck > "$SCRATCH/tc5.log" 2>&1; echo "tc $?"
pnpm lint > "$SCRATCH/l5.log" 2>&1; echo "lint $?"
```

Expected: both print `0`.

- [ ] **Step 9: Commit**

```bash
bd close wordle-teams-9j7o.2.2.1.5
git add convex/scores.ts convex/teamGameMonth.test.ts .beads/issues.jsonl
git commit -F - <<'EOF'
feat(scores): getTeamGameMonth serves any game's month through the registry

The month gate and scoring-system lookup move into shared helpers so
getTeamMonth and getTeamGameMonth cannot disagree; getTeamMonth's shape
is unchanged. The Pro window and monthWindow are game-aware.

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
EOF
```

---

### Task 6: Gates and record

**Files:** none changed unless a gate fails.

- [ ] **Step 1: Run all four gates separately**

```bash
TZ=UTC pnpm test:once > "$SCRATCH/t.log" 2>&1; echo "test $?"
pnpm typecheck > "$SCRATCH/tc.log" 2>&1; echo "tc $?"
pnpm lint > "$SCRATCH/l.log" 2>&1; echo "lint $?"
pnpm build > "$SCRATCH/b.log" 2>&1; echo "build $?"
```

Expected: all four print `0`. If one fails, read its log, fix the cause in the task that introduced it, and rerun all four.

- [ ] **Step 2: Record**

```bash
bd close wordle-teams-9j7o.2.2.1.6
bd update wordle-teams-9j7o.2.2 --append-notes "$(cat <<'EOF'
Plan 1 (game abstraction) done: monthTotal takes attempts (Wordle totals pinned to the old function), registry convex/lib/games.ts (resultsFor, hasPlayed, firstDay), teams.clueLadderEnabled + setTeamClueLadder, CLUE_LADDER_ENABLED switch, clueLadderPlays table, getTeamGameMonth query, game-aware monthWindow. getTeamMonth unchanged. Next: plan 2 (play surface, 9j7o.3.2).
EOF
)"
bd close wordle-teams-9j7o.2.2.1
```

- [ ] **Step 3: Commit and push**

```bash
git add .beads/issues.jsonl
git commit -F - <<'EOF'
chore(games): game abstraction recorded

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
EOF
git pull --rebase && git push
```

Before pushing, confirm both closes landed: `git show HEAD:.beads/issues.jsonl` must record `wordle-teams-9j7o.2.2.1.6` and `wordle-teams-9j7o.2.2.1` as closed. If not, `git add .beads/issues.jsonl && git commit --amend --no-edit`, then push. Never amend a commit that is already pushed.
