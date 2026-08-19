# v2 Phase 3 — Teams Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ship everything a team is other than getting people into one — create, switch, rename, configure, list, delete, see members, remove a member, and edit the scoring system without rewriting the past.

**Architecture:** Three layers, as Phase 2 established. Dependency-free pure logic in `convex/lib/` shared by client and server; Convex queries and mutations that call an access helper first; React components that read through `convexQuery` and write through `useConvexMutation`. Scoring-system versioning is a new `scoringSystems` table keyed on an effective-from month, resolved by a pure `systemFor` — `pointsFor`, `monthTotal` and `winnerOf` do not change, because they already take the system as a parameter.

**Tech Stack:** Convex (schema, queries, mutations, `convex-test`), TanStack Start + Router + Query, React 19, shadcn/ui on Tailwind 4, Vitest, Playwright.

**Spec:** `docs/superpowers/specs/2026-08-19-v2-phase3-teams-design.md`

---

## Ground Rules (read before Task 0)

**Every command in this plan runs from inside `v2/`.** A build from the repo root builds v1 and dirties the tracked `public/sw.js` (`wordle-teams-d9g`). The shadcn CLI misdetects the project from the root.

**The import alias is `#/`, not `@/`.** Convex files import each other with an explicit `.ts` extension (`./lib/board.ts`); `src/` files reach into Convex with a relative path (`../../convex/_generated/api`).

**The four quality gates, and the one that is not in them:**

```bash
cd v2
pnpm test:once     # vitest, all unit + convex-test suites
pnpm exec tsc --noEmit
pnpm build
pnpm e2e           # NOT part of the other three — run it yourself
```

`pnpm e2e` is not wired into `test`, `tsc` or `build`. In Phase 2 a Playwright spec stayed silently red for three tasks because nothing ran it. **Run `pnpm e2e` after any task that touches a route or rendered UI** — that is Tasks 2, 9, 10, 11, 12, 13, 14.

**Screenshots before any UI task is called done.** Light and dark, on a **touch-emulating** viewport, not a narrow desktop window. Five rendering bugs in this project have passed every automated check, and seven more were found on a real phone after Phase 2's first deploy. Use the project's own Playwright chromium from inside `v2/`; the MCP browser tool has no Chrome.

**Do not commit while a subagent is running.** A subagent's `--amend` swallows any commit that lands mid-flight.

**Never run `convex deploy` during a task.** `beta` is the deployment that *becomes production* at cutover (parent design, "Repo Layout & Environments"), so `convex deploy` writes the schema and functions real users will land on. Schema changes are pushed to your personal **dev** deployment with `pnpm exec convex dev --once`, which is what every task in this plan does. The single deploy to beta is Task 14 Step 4, and it is an **owner action** — not a subagent's, and not without the owner authorizing it in that session.

**Existing test fixtures.** `v2/convex/scores.test.ts` exports `aPlayer()` and `aTeam()`. Import them rather than redefining. Note `aTeam()` currently sets `legacyId: 206`; Task 0 makes that field optional but does not remove it from the fixture.

---

## Task 0: Make `teams.legacyId` optional

A natively created team has no Supabase primary key to carry, and `teams.legacyId` is a required `v.number()`. **`createTeam` cannot insert until this changes.** Same fix and same rationale as Phase 2's widening of `dailyScores` and `monthlyWinners`.

**Files:**
- Modify: `v2/convex/schema.ts:44-46`
- Test: `v2/convex/schema.test.ts`

- [ ] **Step 1: Write the failing test**

Append to `v2/convex/schema.test.ts`:

```ts
describe('teams.legacyId', () => {
  test('accepts a team created natively in v2, with no legacyId', async () => {
    const t = convexTest(schema, modules)
    await t.run(async (ctx) => {
      const id = await ctx.db.insert('teams', {
        name: 'Born in v2',
        playerIds: [],
        invited: [],
        oneGuess: 5,
        twoGuesses: 3,
        threeGuesses: 2,
        fourGuesses: 1,
        fiveGuesses: 0,
        sixGuesses: -1,
        failed: -3,
        nA: 0,
        playWeekends: true,
        showLetters: true,
      })
      const team = await ctx.db.get(id)
      expect(team?.legacyId).toBeUndefined()
    })
  })

  test('still accepts a copied team carrying its Supabase primary key', async () => {
    const t = convexTest(schema, modules)
    await t.run(async (ctx) => {
      const id = await ctx.db.insert('teams', {
        legacyId: 206,
        name: 'Copied',
        playerIds: [],
        invited: [],
        oneGuess: 5,
        twoGuesses: 3,
        threeGuesses: 2,
        fourGuesses: 1,
        fiveGuesses: 0,
        sixGuesses: -1,
        failed: -3,
        nA: 0,
        playWeekends: true,
        showLetters: true,
      })
      expect((await ctx.db.get(id))?.legacyId).toBe(206)
    })
  })
})
```

- [ ] **Step 2: Run it and confirm it fails**

```bash
cd v2 && pnpm test:once schema.test.ts
```

Expected: the first test FAILS on schema validation — the object is missing the required `legacyId`. The second passes.

- [ ] **Step 3: Widen the field**

In `v2/convex/schema.ts`, replace the `teams` table's first field:

```ts
  teams: defineTable({
    legacyId: v.number(),
```

with:

```ts
  teams: defineTable({
    // OPTIONAL SINCE PHASE 3, for the reason dailyScores.legacyId is optional
    // since Phase 2: a team created natively in v2 has no Supabase identity to
    // carry, and inventing a sentinel would fake one. Absence is meaningful —
    // `legacyId === undefined` means "born in v2, not copied", which is what
    // Phase 7's row-count reconciliation against Supabase needs. The copy is
    // unaffected: it matches on by_legacyId, and native rows correctly never
    // match, because the copy must not adopt them.
    legacyId: v.optional(v.number()),
```

- [ ] **Step 4: Run the test again**

```bash
cd v2 && pnpm test:once schema.test.ts
```

Expected: PASS, both tests.

- [ ] **Step 5: Push the schema to your DEV deployment**

```bash
cd v2 && pnpm exec convex dev --once
```

Expected: succeeds. Widening a required field to optional is a permissive change and needs no data migration.

- [ ] **Step 6: Full gates, then commit**

```bash
cd v2 && pnpm test:once && pnpm exec tsc --noEmit && pnpm build
cd .. && git add v2/convex/schema.ts v2/convex/schema.test.ts
git commit -m "feat(v2): teams.legacyId is optional so a native team can be created (wt-ksh.4.17)"
```

---

## Task 1: Extract `recomputeWinners` into `convex/winners.ts`

`wordle-teams-4gj`. Today it is an unexported function inside `scores.ts`, reachable only by constructing a valid board submission and passing it through the whole validity and upsert machinery. Phase 3 needs it from three more mutations. **This is a pure refactor — behaviour must not change.**

**Files:**
- Create: `v2/convex/winners.ts`
- Create: `v2/convex/winners.test.ts`
- Modify: `v2/convex/scores.ts` (delete `recomputeWinners`, import from `./winners.ts`)

- [ ] **Step 1: Write the failing tests**

Create `v2/convex/winners.test.ts`:

```ts
import { convexTest } from 'convex-test'
import { describe, expect, test } from 'vitest'
import schema from './schema'
import { toPuzzleDay } from './lib/puzzleDay.ts'
import { aPlayer, aTeam } from './scores.test.ts'
import { monthsWithWinners, recomputeTeamMonth, recomputeTeamMonths } from './winners.ts'

const today = toPuzzleDay(new Date())
const modules = import.meta.glob('./**/*.ts')

/** A board scoring `attempts` guesses, on the given day. */
const aScore = (playerId: string, puzzleDay: string, guesses: Array<string>) => ({
  playerId: playerId as never,
  puzzleDay,
  date: 1_755_500_000_000,
  answer: 'SPEED',
  guesses,
})

describe('recomputeTeamMonth', () => {
  test('writes a winner row for the team', async () => {
    const t = convexTest(schema, modules)
    await t.run(async (ctx) => {
      const ada = await ctx.db.insert('players', aPlayer())
      const bob = await ctx.db.insert('players', aPlayer({ email: 'bob@example.com', firstName: 'Bob' }))
      const teamId = await ctx.db.insert('teams', aTeam({ playerIds: [ada, bob] }))
      // Ada solves in one (5 points); Bob solves in four (1 point).
      await ctx.db.insert('dailyScores', aScore(ada, '2026-08-03', ['SPEED']))
      await ctx.db.insert('dailyScores', aScore(bob, '2026-08-03', ['CRANE', 'SLATE', 'SPELL', 'SPEED']))

      const team = (await ctx.db.get(teamId))!
      await recomputeTeamMonth(ctx, team, '2026-08', today)

      const row = await ctx.db
        .query('monthlyWinners')
        .withIndex('by_team_year_month', (q) => q.eq('teamId', teamId).eq('year', 2026).eq('month', 8))
        .first()
      expect(row?.playerId).toBe(ada)
    })
  })

  test('breaks a tie in favour of the earlier player in team order', async () => {
    const t = convexTest(schema, modules)
    await t.run(async (ctx) => {
      const ada = await ctx.db.insert('players', aPlayer())
      const bob = await ctx.db.insert('players', aPlayer({ email: 'bob@example.com', firstName: 'Bob' }))
      const teamId = await ctx.db.insert('teams', aTeam({ playerIds: [bob, ada] }))
      await ctx.db.insert('dailyScores', aScore(ada, '2026-08-03', ['SPEED']))
      await ctx.db.insert('dailyScores', aScore(bob, '2026-08-03', ['SPEED']))

      const team = (await ctx.db.get(teamId))!
      await recomputeTeamMonth(ctx, team, '2026-08', today)

      const row = await ctx.db
        .query('monthlyWinners')
        .withIndex('by_team_year_month', (q) => q.eq('teamId', teamId).eq('year', 2026).eq('month', 8))
        .first()
      // Bob is first in playerIds, so Bob wins the tie.
      expect(row?.playerId).toBe(bob)
    })
  })

  test('deletes the row when the team has no member who can win', async () => {
    const t = convexTest(schema, modules)
    await t.run(async (ctx) => {
      const ada = await ctx.db.insert('players', aPlayer())
      const teamId = await ctx.db.insert('teams', aTeam({ playerIds: [] }))
      await ctx.db.insert('monthlyWinners', {
        playerId: ada,
        teamId,
        year: 2026,
        month: 8,
        hasSeenCelebration: [],
      })

      const team = (await ctx.db.get(teamId))!
      await recomputeTeamMonth(ctx, team, '2026-08', today)

      const row = await ctx.db
        .query('monthlyWinners')
        .withIndex('by_team_year_month', (q) => q.eq('teamId', teamId).eq('year', 2026).eq('month', 8))
        .first()
      expect(row).toBeNull()
    })
  })

  test('preserves hasSeenCelebration when the winner is unchanged', async () => {
    const t = convexTest(schema, modules)
    await t.run(async (ctx) => {
      const ada = await ctx.db.insert('players', aPlayer())
      const teamId = await ctx.db.insert('teams', aTeam({ playerIds: [ada] }))
      await ctx.db.insert('dailyScores', aScore(ada, '2026-08-03', ['SPEED']))
      await ctx.db.insert('monthlyWinners', {
        playerId: ada,
        teamId,
        year: 2026,
        month: 8,
        hasSeenCelebration: [ada],
      })

      const team = (await ctx.db.get(teamId))!
      await recomputeTeamMonth(ctx, team, '2026-08', today)

      const row = await ctx.db
        .query('monthlyWinners')
        .withIndex('by_team_year_month', (q) => q.eq('teamId', teamId).eq('year', 2026).eq('month', 8))
        .first()
      expect(row?.hasSeenCelebration).toEqual([ada])
    })
  })

  test('resets hasSeenCelebration when the winner changes', async () => {
    const t = convexTest(schema, modules)
    await t.run(async (ctx) => {
      const ada = await ctx.db.insert('players', aPlayer())
      const bob = await ctx.db.insert('players', aPlayer({ email: 'bob@example.com', firstName: 'Bob' }))
      const teamId = await ctx.db.insert('teams', aTeam({ playerIds: [ada, bob] }))
      await ctx.db.insert('dailyScores', aScore(ada, '2026-08-03', ['SPEED']))
      await ctx.db.insert('monthlyWinners', {
        playerId: bob,
        teamId,
        year: 2026,
        month: 8,
        hasSeenCelebration: [bob],
      })

      const team = (await ctx.db.get(teamId))!
      await recomputeTeamMonth(ctx, team, '2026-08', today)

      const row = await ctx.db
        .query('monthlyWinners')
        .withIndex('by_team_year_month', (q) => q.eq('teamId', teamId).eq('year', 2026).eq('month', 8))
        .first()
      expect(row?.playerId).toBe(ada)
      expect(row?.hasSeenCelebration).toEqual([])
    })
  })

  test('excludes a profile-incomplete member from winning', async () => {
    const t = convexTest(schema, modules)
    await t.run(async (ctx) => {
      const ada = await ctx.db.insert('players', aPlayer())
      const invitee = await ctx.db.insert(
        'players',
        aPlayer({ email: 'new@example.com', firstName: undefined, lastName: undefined }),
      )
      const teamId = await ctx.db.insert('teams', aTeam({ playerIds: [invitee, ada] }))
      // The invitee scores higher, but has no completed profile.
      await ctx.db.insert('dailyScores', aScore(invitee, '2026-08-03', ['SPEED']))
      await ctx.db.insert('dailyScores', aScore(ada, '2026-08-03', ['CRANE', 'SLATE', 'SPELL', 'SPEED']))

      const team = (await ctx.db.get(teamId))!
      await recomputeTeamMonth(ctx, team, '2026-08', today)

      const row = await ctx.db
        .query('monthlyWinners')
        .withIndex('by_team_year_month', (q) => q.eq('teamId', teamId).eq('year', 2026).eq('month', 8))
        .first()
      expect(row?.playerId).toBe(ada)
    })
  })
})

describe('monthsWithWinners', () => {
  test('returns every month the team has a winner row for, as YYYY-MM', async () => {
    const t = convexTest(schema, modules)
    await t.run(async (ctx) => {
      const ada = await ctx.db.insert('players', aPlayer())
      const teamId = await ctx.db.insert('teams', aTeam({ playerIds: [ada] }))
      const other = await ctx.db.insert('teams', aTeam({ legacyId: 207, playerIds: [ada] }))
      for (const [year, month] of [
        [2026, 6],
        [2026, 7],
        [2025, 12],
      ] as const) {
        await ctx.db.insert('monthlyWinners', {
          playerId: ada,
          teamId,
          year,
          month,
          hasSeenCelebration: [],
        })
      }
      await ctx.db.insert('monthlyWinners', {
        playerId: ada,
        teamId: other,
        year: 2026,
        month: 1,
        hasSeenCelebration: [],
      })

      expect((await monthsWithWinners(ctx, teamId)).sort()).toEqual(['2025-12', '2026-06', '2026-07'])
    })
  })
})

describe('recomputeTeamMonths', () => {
  test('recomputes each month it is given, independently', async () => {
    const t = convexTest(schema, modules)
    await t.run(async (ctx) => {
      const ada = await ctx.db.insert('players', aPlayer())
      const bob = await ctx.db.insert('players', aPlayer({ email: 'bob@example.com', firstName: 'Bob' }))
      const teamId = await ctx.db.insert('teams', aTeam({ playerIds: [ada, bob] }))
      // Ada wins June, Bob wins July.
      await ctx.db.insert('dailyScores', aScore(ada, '2026-06-03', ['SPEED']))
      await ctx.db.insert('dailyScores', aScore(bob, '2026-07-03', ['SPEED']))

      const team = (await ctx.db.get(teamId))!
      await recomputeTeamMonths(ctx, team, ['2026-06', '2026-07'], today)

      const june = await ctx.db
        .query('monthlyWinners')
        .withIndex('by_team_year_month', (q) => q.eq('teamId', teamId).eq('year', 2026).eq('month', 6))
        .first()
      const july = await ctx.db
        .query('monthlyWinners')
        .withIndex('by_team_year_month', (q) => q.eq('teamId', teamId).eq('year', 2026).eq('month', 7))
        .first()
      expect(june?.playerId).toBe(ada)
      expect(july?.playerId).toBe(bob)
    })
  })
})
```

- [ ] **Step 2: Run it and confirm it fails**

```bash
cd v2 && pnpm test:once winners.test.ts
```

Expected: FAIL — `Cannot find module './winners.ts'`.

- [ ] **Step 3: Create `convex/winners.ts`**

Create `v2/convex/winners.ts`. The body of `recomputeTeamMonth` is lifted from the loop inside `scores.ts`'s current `recomputeWinners` **unchanged**:

```ts
import { monthRange } from './lib/puzzleDay.ts'
import { monthTotal, winnerOf } from './lib/scoring.ts'
import type { Doc, Id, DataModel } from './_generated/dataModel'
import type { PuzzleDay, PuzzleMonth } from './lib/puzzleDay.ts'
import type { GenericDatabaseWriter } from 'convex/server'

/**
 * Monthly-winner recomputation, extracted from scores.ts (wordle-teams-4gj).
 *
 * This is v1's update_monthly_winners trigger, relocated. Two differences from
 * the SQL, both deliberate and both unchanged by the extraction:
 *
 * 1. The SQL DELETEs the row and re-INSERTs it, which silently wipes
 *    hasSeenCelebration every time anyone enters a board dated in that month —
 *    re-firing the confetti at someone who already dismissed it. Here the array
 *    survives an unchanged winner and resets only when the winner really changes.
 * 2. v1 computed this on the CLIENT for every team it had loaded and passed the
 *    result to the RPC. Here it is derived server-side inside the caller's
 *    transaction, so it cannot be stale or forged.
 *
 * It lives in its own module because Phase 3 calls it from three mutations that
 * have nothing to do with board entry — removeMember, updateTeam when
 * playWeekends flips, and setScoringSystem. Before the extraction the only way
 * to reach it was to construct a valid board submission and pass it through the
 * whole upsert machinery, which is also why its five behaviours had no direct
 * tests.
 */

/**
 * Anything with a `db` writer — a mutation, or a convex-test `ctx.run` callback.
 * Mirrors scores.ts's WriterCtx for the same reason: nothing here touches
 * anything but `ctx.db`, so convex-test's callback ctx satisfies it with no cast.
 */
export type WriterCtx = { db: GenericDatabaseWriter<DataModel> }

/**
 * Recompute one team's winner for one month.
 *
 * `today` decides which missed days are already due and therefore score the
 * team's nA value; for a month in the past every day is due, which is correct.
 */
export async function recomputeTeamMonth(
  ctx: WriterCtx,
  team: Doc<'teams'>,
  month: PuzzleMonth,
  today: PuzzleDay,
): Promise<void> {
  const [year, monthNum] = month.split('-').map(Number)
  const { start, end } = monthRange(month)

  const totals = []
  for (const memberId of team.playerIds) {
    const member = await ctx.db.get(memberId)
    // Same exclusion as getTeamMonthFor: a profile-incomplete invitee is not
    // shown on the table and must not be able to win the month either.
    if (!member || !member.firstName || !member.lastName) continue

    const scores = await ctx.db
      .query('dailyScores')
      .withIndex('by_player_and_puzzleDay', (q) =>
        q.eq('playerId', memberId).gte('puzzleDay', start).lte('puzzleDay', end),
      )
      .collect()

    totals.push({
      playerId: memberId,
      total: monthTotal({
        month,
        scores,
        // A `teams` doc structurally satisfies ScoringSystem.
        system: team,
        playWeekends: team.playWeekends,
        today,
      }),
    })
  }

  const winnerId = winnerOf(totals) as Id<'players'> | null
  const existing = await ctx.db
    .query('monthlyWinners')
    .withIndex('by_team_year_month', (q) =>
      q.eq('teamId', team._id).eq('year', year).eq('month', monthNum),
    )
    .first()

  if (!winnerId) {
    // Matches the SQL, which deletes unconditionally and re-inserts only where
    // winner_id is not null.
    if (existing) await ctx.db.delete(existing._id)
    return
  }
  if (!existing) {
    await ctx.db.insert('monthlyWinners', {
      playerId: winnerId,
      teamId: team._id,
      year,
      month: monthNum,
      hasSeenCelebration: [],
    })
    return
  }
  // Unchanged winner: leave the row, and the seen-list, alone.
  if (existing.playerId === winnerId) return
  await ctx.db.patch(existing._id, { playerId: winnerId, hasSeenCelebration: [] })
}

/** Recompute several months for one team. */
export async function recomputeTeamMonths(
  ctx: WriterCtx,
  team: Doc<'teams'>,
  months: Array<PuzzleMonth>,
  today: PuzzleDay,
): Promise<void> {
  for (const month of months) {
    await recomputeTeamMonth(ctx, team, month, today)
  }
}

/**
 * Every month this team already has a winner row for, as 'YYYY-MM'.
 *
 * This is what bounds the blast radius of a membership or scoring change: a
 * team accumulates at most one row per month, so recomputing "every affected
 * month" is bounded at (months played) x (members) x (days in month) — roughly
 * thirty rows for the oldest team in production.
 */
export async function monthsWithWinners(
  ctx: WriterCtx,
  teamId: Id<'teams'>,
): Promise<Array<PuzzleMonth>> {
  const rows = await ctx.db
    .query('monthlyWinners')
    .withIndex('by_team_year_month', (q) => q.eq('teamId', teamId))
    .collect()
  return rows.map((row) => `${row.year}-${String(row.month).padStart(2, '0')}`)
}

/**
 * Recompute the month for every team the player belongs to.
 *
 * What upsertBoard calls, and the behaviour that existed before the extraction.
 *
 * Because the WHOLE teams table lands in this transaction's read set, a
 * concurrent write to ANY team forces Convex to retry the mutation via OCC even
 * though the retry's outcome never depended on that other team. Phase 3 raises
 * team-write frequency (settings edits, creation, deletion, scoring edits),
 * which is the condition scores.ts flagged as the trigger to revisit this.
 * Acceptable at 171 teams and ~40 DAU; revisit if either number moves.
 */
export async function recomputePlayerMonth(
  ctx: WriterCtx,
  playerId: Id<'players'>,
  month: PuzzleMonth,
  today: PuzzleDay,
): Promise<void> {
  const allTeams = await ctx.db.query('teams').collect()
  for (const team of allTeams) {
    if (!team.playerIds.includes(playerId)) continue
    await recomputeTeamMonth(ctx, team, month, today)
  }
}
```

- [ ] **Step 4: Run the new tests**

```bash
cd v2 && pnpm test:once winners.test.ts
```

Expected: PASS, all eight tests.

- [ ] **Step 5: Delete the old copy from `scores.ts` and call the extracted one**

In `v2/convex/scores.ts`, delete the entire `recomputeWinners` function (its doc comment and body, currently lines 174–272) and add to the imports at the top:

```ts
import { recomputePlayerMonth } from './winners.ts'
```

Then in `upsertBoardFor`, replace:

```ts
  await recomputeWinners(ctx, playerId, monthOf(puzzleDay), today)
```

with:

```ts
  await recomputePlayerMonth(ctx, playerId, monthOf(puzzleDay), today)
```

`monthTotal` and `winnerOf` are no longer referenced in `scores.ts`; remove them from its import of `./lib/scoring.ts`. `WriterCtx` stays — `upsertBoardFor` still uses it.

- [ ] **Step 6: Prove the refactor changed nothing**

```bash
cd v2 && pnpm test:once && pnpm exec tsc --noEmit
```

Expected: PASS. **`scores.test.ts` must pass untouched** — that is the whole proof that this was a pure refactor. If a `scores.test.ts` assertion needed editing, behaviour changed and the extraction is wrong.

- [ ] **Step 7: Commit**

```bash
cd v2 && pnpm build
cd .. && git add v2/convex/winners.ts v2/convex/winners.test.ts v2/convex/scores.ts
git commit -m "refactor(v2): extract winner recomputation into convex/winners.ts (wordle-teams-4gj)"
```

---

## Task 2: Extract the dashboard search-param sync

`wordle-teams-lb9`. The effect in `index.tsx` navigates to fill in URL state while racing hydration — the classic infinite-redirect shape, and the highest-risk code in the Phase 2 UI. Phase 3 adds three cards to the same file.

**The decomposition matters:** the *decision* comes out as a pure function that needs no router, and the hook becomes a thin effect around it. That is what makes it testable, which is `lb9`'s acceptance criterion.

**Files:**
- Create: `v2/src/lib/dashboard-search.ts`
- Create: `v2/src/lib/dashboard-search.test.ts`
- Create: `v2/src/lib/use-dashboard-search-sync.ts`
- Modify: `v2/src/routes/index.tsx:60-94`

- [ ] **Step 1: Write the failing test**

Create `v2/src/lib/dashboard-search.test.ts`:

```ts
import { describe, expect, test } from 'vitest'
import { resolveDashboardSearch } from './dashboard-search.ts'

const teams = [{ id: 'a' }, { id: 'b' }]

describe('resolveDashboardSearch', () => {
  test('returns null when both params are already valid — no navigation', () => {
    expect(
      resolveDashboardSearch({
        teamParam: 'a',
        monthParam: '2026-08',
        teams,
        storedTeam: null,
        currentMonth: '2026-08',
      }),
    ).toBeNull()
  })

  test('fills in the current month when only the team is set', () => {
    expect(
      resolveDashboardSearch({
        teamParam: 'a',
        monthParam: undefined,
        teams,
        storedTeam: null,
        currentMonth: '2026-08',
      }),
    ).toEqual({ team: 'a', month: '2026-08' })
  })

  test('prefers the stored team when the URL has none', () => {
    expect(
      resolveDashboardSearch({
        teamParam: undefined,
        monthParam: '2026-08',
        teams,
        storedTeam: 'b',
        currentMonth: '2026-08',
      }),
    ).toEqual({ team: 'b', month: '2026-08' })
  })

  test('falls back to the first team when the stored team is not one of yours', () => {
    expect(
      resolveDashboardSearch({
        teamParam: undefined,
        monthParam: '2026-08',
        teams,
        storedTeam: 'gone',
        currentMonth: '2026-08',
      }),
    ).toEqual({ team: 'a', month: '2026-08' })
  })

  test('treats a team you are not on as if it were missing — a stale bookmark', () => {
    expect(
      resolveDashboardSearch({
        teamParam: 'gone',
        monthParam: '2026-08',
        teams,
        storedTeam: null,
        currentMonth: '2026-08',
      }),
    ).toEqual({ team: 'a', month: '2026-08' })
  })

  test('returns null when there is no team to select at all', () => {
    expect(
      resolveDashboardSearch({
        teamParam: undefined,
        monthParam: undefined,
        teams: [],
        storedTeam: null,
        currentMonth: '2026-08',
      }),
    ).toBeNull()
  })

  test('is idempotent — its own output resolves to null on the next run', () => {
    const first = resolveDashboardSearch({
      teamParam: undefined,
      monthParam: undefined,
      teams,
      storedTeam: null,
      currentMonth: '2026-08',
    })!
    expect(
      resolveDashboardSearch({
        teamParam: first.team,
        monthParam: first.month,
        teams,
        storedTeam: null,
        currentMonth: '2026-08',
      }),
    ).toBeNull()
  })
})
```

The last test is the one that matters: it is the termination proof for the redirect, expressed as an assertion rather than as a comment.

- [ ] **Step 2: Run it and confirm it fails**

```bash
cd v2 && pnpm test:once dashboard-search.test.ts
```

Expected: FAIL — `Cannot find module './dashboard-search.ts'`.

- [ ] **Step 3: Write the pure resolver**

Create `v2/src/lib/dashboard-search.ts`:

```ts
/**
 * Deciding what the dashboard URL should say, with no router and no clock.
 *
 * Extracted from routes/index.tsx (wordle-teams-lb9). The effect that consumed
 * this inline was the highest-risk code in the Phase 2 UI — it navigates to
 * fill in URL state while racing hydration, which is the shape an infinite
 * redirect takes. Pulling the decision out means the termination property can
 * be a test rather than a comment: feed this function its own output and it
 * must return null.
 */

export type DashboardSearchInput = {
  /** `?team=` as it stands, or undefined. */
  teamParam: string | undefined
  /** `?month=`, already shape-validated by the route, or undefined. */
  monthParam: string | undefined
  /** The teams the caller actually belongs to. */
  teams: Array<{ id: string }>
  /** localStorage's remembered team, or null. */
  storedTeam: string | null
  /** The viewer's local current month, 'YYYY-MM'. */
  currentMonth: string
}

/**
 * The search params to navigate to, or null when the URL is already correct
 * (or when there is no team to select and nothing sensible to say).
 */
export function resolveDashboardSearch({
  teamParam,
  monthParam,
  teams,
  storedTeam,
  currentMonth,
}: DashboardSearchInput): { team: string; month: string } | null {
  // A teamParam that isn't one of the caller's teams is treated the same as a
  // missing one — a bookmarked or shared URL for a team you've since left.
  // Falling through unvalidated would hand that id straight to the pickers and
  // to real Convex calls.
  const teamValid = teamParam !== undefined && teams.some((team) => team.id === teamParam)
  if (teamValid && monthParam) return null

  const team =
    (teamValid ? teamParam : undefined) ??
    (storedTeam && teams.some((t) => t.id === storedTeam) ? storedTeam : teams[0]?.id)
  if (!team) return null

  return { team, month: monthParam ?? currentMonth }
}
```

- [ ] **Step 4: Run the tests**

```bash
cd v2 && pnpm test:once dashboard-search.test.ts
```

Expected: PASS, all seven.

- [ ] **Step 5: Write the hook around it**

Create `v2/src/lib/use-dashboard-search-sync.ts`:

```ts
import { useEffect } from 'react'
import { useHydrated } from '#/lib/use-hydrated.ts'
import { resolveDashboardSearch } from '#/lib/dashboard-search.ts'
import { monthOf, toPuzzleDay } from '../../convex/lib/puzzleDay.ts'

const STORAGE_KEY = 'selectedTeam'

/**
 * Keeps `?team=` and `?month=` filled in, and remembers the team.
 *
 * AFTER HYDRATION ONLY. The current month has to come from the browser's local
 * clock, and reading it during render would make the server (UTC) and the
 * client (local) disagree on the last and first days of a month — the
 * hydration-mismatch class that 45e3cd6 fixed in v1 and that wordle-teams-uc5
 * was. The URL is the source of truth; localStorage only supplies the default.
 *
 * The decision itself lives in the pure resolveDashboardSearch, which has a
 * test asserting it is idempotent — that is what guarantees this effect
 * terminates rather than navigating in a loop.
 */
export function useDashboardSearchSync({
  teamParam,
  monthParam,
  teams,
  navigate,
}: {
  teamParam: string | undefined
  monthParam: string | undefined
  teams: Array<{ id: string }>
  navigate: (search: { team: string; month: string }) => void
}): void {
  const hydrated = useHydrated()

  useEffect(() => {
    if (!hydrated) return
    const next = resolveDashboardSearch({
      teamParam,
      monthParam,
      teams,
      storedTeam: localStorage.getItem(STORAGE_KEY),
      currentMonth: monthOf(toPuzzleDay(new Date())),
    })
    if (next) navigate(next)
  }, [hydrated, teamParam, monthParam, teams, navigate])

  useEffect(() => {
    if (teamParam) localStorage.setItem(STORAGE_KEY, teamParam)
  }, [teamParam])
}
```

- [ ] **Step 6: Use it in the route**

In `v2/src/routes/index.tsx`, delete the second and third `useEffect` blocks (currently lines 67–94 — the search-param sync and the team-persistence effect) and replace them with:

```ts
  useDashboardSearchSync({
    teamParam,
    monthParam,
    teams,
    navigate: (search) => void navigate({ to: '/', search, replace: true }),
  })
```

Add the import:

```ts
import { useDashboardSearchSync } from '#/lib/use-dashboard-search-sync.ts'
```

Leave the login-funnel effect (the first one) where it is — it is unrelated. `useHydrated` is still used further down for `currentMonth`, so keep that import.

- [ ] **Step 7: Run everything, including e2e**

```bash
cd v2 && pnpm test:once && pnpm exec tsc --noEmit && pnpm build && pnpm e2e
```

Expected: all PASS. This task changes a route, so `pnpm e2e` is mandatory — it is the only thing that exercises the redirect against a real browser.

- [ ] **Step 8: Commit**

```bash
cd .. && git add v2/src/lib/dashboard-search.ts v2/src/lib/dashboard-search.test.ts \
  v2/src/lib/use-dashboard-search-sync.ts v2/src/routes/index.tsx
git commit -m "refactor(v2): extract the dashboard search-param sync into a tested hook (wordle-teams-lb9)"
```

---

## Task 3: `scoringSystems` table and `lib/scoringSystem.ts`

The versioning primitive. Pure, dependency-free, and the reason `pointsFor`, `monthTotal` and `winnerOf` need no changes at all.

**Files:**
- Modify: `v2/convex/schema.ts`
- Create: `v2/convex/lib/scoringSystem.ts`
- Create: `v2/convex/lib/scoringSystem.test.ts`

- [ ] **Step 1: Write the failing test**

Create `v2/convex/lib/scoringSystem.test.ts`:

```ts
import { describe, expect, test } from 'vitest'
import { DEFAULT_SYSTEM, effectiveFromOf, systemFor } from './scoringSystem.ts'
import type { ScoringSystem } from './scoring.ts'

const values = (oneGuess: number): ScoringSystem => ({
  oneGuess,
  twoGuesses: 3,
  threeGuesses: 2,
  fourGuesses: 1,
  fiveGuesses: 0,
  sixGuesses: -1,
  failed: -3,
  nA: 0,
})

const base = values(5)
const versions = [
  { effectiveFrom: '2026-06', ...values(10) },
  { effectiveFrom: '2026-08', ...values(20) },
]

describe('systemFor', () => {
  test('falls back to the base when no version precedes the month', () => {
    expect(systemFor(base, versions, '2026-05').oneGuess).toBe(5)
  })

  test('falls back to the base when there are no versions at all', () => {
    expect(systemFor(base, [], '2026-08').oneGuess).toBe(5)
  })

  test('applies a version in the month it becomes effective', () => {
    expect(systemFor(base, versions, '2026-06').oneGuess).toBe(10)
  })

  test('keeps applying a version to later months until the next one', () => {
    expect(systemFor(base, versions, '2026-07').oneGuess).toBe(10)
  })

  test('applies the latest version that precedes the month', () => {
    expect(systemFor(base, versions, '2026-09').oneGuess).toBe(20)
  })

  test('orders across a year boundary — YYYY-MM sorts lexicographically', () => {
    const acrossYears = [
      { effectiveFrom: '2025-12', ...values(11) },
      { effectiveFrom: '2026-01', ...values(12) },
    ]
    expect(systemFor(base, acrossYears, '2025-12').oneGuess).toBe(11)
    expect(systemFor(base, acrossYears, '2026-01').oneGuess).toBe(12)
    expect(systemFor(base, acrossYears, '2025-11').oneGuess).toBe(5)
  })

  test('does not depend on the input being sorted', () => {
    const shuffled = [versions[1], versions[0]]
    expect(systemFor(base, shuffled, '2026-07').oneGuess).toBe(10)
  })
})

describe('effectiveFromOf', () => {
  test('is null when the month resolves to the base', () => {
    expect(effectiveFromOf(versions, '2026-05')).toBeNull()
  })

  test('is the resolved version month otherwise', () => {
    expect(effectiveFromOf(versions, '2026-07')).toBe('2026-06')
    expect(effectiveFromOf(versions, '2026-09')).toBe('2026-08')
  })
})

describe('DEFAULT_SYSTEM', () => {
  test("is v1's defaultSystem, value for value", () => {
    expect(DEFAULT_SYSTEM).toEqual({
      oneGuess: 5,
      twoGuesses: 3,
      threeGuesses: 2,
      fourGuesses: 1,
      fiveGuesses: 0,
      sixGuesses: -1,
      failed: -3,
      nA: 0,
    })
  })
})
```

- [ ] **Step 2: Run it and confirm it fails**

```bash
cd v2 && pnpm test:once scoringSystem.test.ts
```

Expected: FAIL — `Cannot find module './scoringSystem.ts'`.

- [ ] **Step 3: Write the module**

Create `v2/convex/lib/scoringSystem.ts`:

```ts
import type { ScoringSystem } from './scoring.ts'
import type { PuzzleMonth } from './puzzleDay.ts'

/**
 * Resolving which scoring system governed a given month.
 *
 * wordle-teams-1j3: a team's scoring system used to be a single set of values
 * read at compute time, so editing it silently rewrote every past month's
 * totals and could flip who had won. A change now applies to the current month
 * forward, and past months keep the values they were played under.
 *
 * DEPENDENCY-FREE, like everything else in convex/lib/ — no Convex, React or
 * DOM imports. It is bundled into Convex functions AND imported by the browser.
 *
 * Note what is NOT here: pointsFor, monthTotal and winnerOf are untouched.
 * They already took the system as a parameter, so versioning only changes what
 * gets passed in.
 */

/** A stored version: the eight values, plus the month they take effect. */
export type ScoringSystemVersion = ScoringSystem & { effectiveFrom: PuzzleMonth }

/**
 * v1's `defaultSystem` (src/lib/types.ts), value for value. What createTeam
 * writes onto a new team.
 */
export const DEFAULT_SYSTEM: ScoringSystem = {
  oneGuess: 5,
  twoGuesses: 3,
  threeGuesses: 2,
  fourGuesses: 1,
  fiveGuesses: 0,
  sixGuesses: -1,
  failed: -3,
  nA: 0,
}

/**
 * The version that governed `month`: the one with the greatest `effectiveFrom`
 * not after it.
 *
 * `base` — the team doc's own eight fields — is the fallback, and that is what
 * makes this need no backfill and no change to the copy script. A team with no
 * version rows has always scored the way it scores now, which is true.
 *
 * 'YYYY-MM' sorts lexicographically, so this is a string comparison. The input
 * is sorted defensively rather than trusting a caller's index order.
 */
export function systemFor(
  base: ScoringSystem,
  versions: Array<ScoringSystemVersion>,
  month: PuzzleMonth,
): ScoringSystem {
  return resolve(versions, month) ?? base
}

/**
 * The `effectiveFrom` of the version governing `month`, or null when it
 * resolved to the base. This is what the Scoring System card's badge renders,
 * and null is what tells it there is no badge to show.
 */
export function effectiveFromOf(
  versions: Array<ScoringSystemVersion>,
  month: PuzzleMonth,
): PuzzleMonth | null {
  return resolve(versions, month)?.effectiveFrom ?? null
}

function resolve(
  versions: Array<ScoringSystemVersion>,
  month: PuzzleMonth,
): ScoringSystemVersion | undefined {
  return versions
    .filter((version) => version.effectiveFrom <= month)
    .sort((a, b) => (a.effectiveFrom < b.effectiveFrom ? -1 : 1))
    .at(-1)
}
```

- [ ] **Step 4: Run the tests**

```bash
cd v2 && pnpm test:once scoringSystem.test.ts
```

Expected: PASS, all eleven.

- [ ] **Step 5: Add the table to the schema**

In `v2/convex/schema.ts`, insert after the `teams` table definition and before `dailyScores`:

```ts
  // Versioned scoring systems (wordle-teams-1j3). A team's `teams` doc still
  // carries eight point values; those are now THE ORIGINAL SYSTEM, and the
  // editor never writes them again. Resolution for a month is "the row with the
  // greatest effectiveFrom <= month, else the team doc's own fields" — see
  // lib/scoringSystem.ts.
  //
  // NO legacyId, and that is not an oversight: this table has no Supabase
  // counterpart, so nothing is ever copied into it. The fallback to the team
  // doc is what lets that be true — existing teams need no backfill, and the
  // copy script needs no change, because "no version rows" already means "it
  // has always been this".
  scoringSystems: defineTable({
    teamId: v.id('teams'),
    effectiveFrom: v.string(), // 'YYYY-MM'
    oneGuess: v.number(),
    twoGuesses: v.number(),
    threeGuesses: v.number(),
    fourGuesses: v.number(),
    fiveGuesses: v.number(),
    sixGuesses: v.number(),
    failed: v.number(),
    nA: v.number(),
  }).index('by_team_and_effectiveFrom', ['teamId', 'effectiveFrom']),
```

- [ ] **Step 6: Push the schema to your DEV deployment**

```bash
cd v2 && pnpm exec convex dev --once
```

Expected: succeeds.

- [ ] **Step 7: Full gates, then commit**

```bash
cd v2 && pnpm test:once && pnpm exec tsc --noEmit && pnpm build
cd .. && git add v2/convex/schema.ts v2/convex/lib/scoringSystem.ts v2/convex/lib/scoringSystem.test.ts
git commit -m "feat(v2): versioned scoring systems, resolved by effective-from month (wordle-teams-1j3)"
```

---

## Task 4: `requireTeamCreator`, `isPro`, and the three new error codes

**Files:**
- Modify: `v2/convex/access.ts`
- Modify: `v2/src/lib/convex-error.ts`
- Test: `v2/convex/access.test.ts`

- [ ] **Step 1: Write the failing tests**

Append to `v2/convex/access.test.ts`:

```ts
describe('requireTeamCreatorFor', () => {
  test('returns the team for its creator', async () => {
    const t = convexTest(schema, modules)
    await t.run(async (ctx) => {
      const ada = await ctx.db.insert('players', aPlayer())
      const teamId = await ctx.db.insert('teams', aTeam({ playerIds: [ada], creator: ada }))
      const team = await requireTeamCreatorFor(ctx, ada, teamId)
      expect(team._id).toBe(teamId)
    })
  })

  test('refuses a member who is not the creator, with NOT_TEAM_CREATOR', async () => {
    const t = convexTest(schema, modules)
    await t.run(async (ctx) => {
      const ada = await ctx.db.insert('players', aPlayer())
      const bob = await ctx.db.insert('players', aPlayer({ email: 'bob@example.com' }))
      const teamId = await ctx.db.insert('teams', aTeam({ playerIds: [ada, bob], creator: ada }))
      await expect(requireTeamCreatorFor(ctx, bob, teamId)).rejects.toThrow(/NOT_TEAM_CREATOR/)
    })
  })

  test('refuses a non-member with NOT_A_MEMBER, so a probe cannot tell the two apart', async () => {
    const t = convexTest(schema, modules)
    await t.run(async (ctx) => {
      const ada = await ctx.db.insert('players', aPlayer())
      const outsider = await ctx.db.insert('players', aPlayer({ email: 'out@example.com' }))
      const teamId = await ctx.db.insert('teams', aTeam({ playerIds: [ada], creator: ada }))
      await expect(requireTeamCreatorFor(ctx, outsider, teamId)).rejects.toThrow(/NOT_A_MEMBER/)
    })
  })

  test('refuses everyone when the creator was not copied', async () => {
    // A scoped copy may not include the team's creator, so `creator` is
    // optional. Such a team has nobody who can edit it. Honest, but it looks
    // like a bug on beta unless it is asserted somewhere.
    const t = convexTest(schema, modules)
    await t.run(async (ctx) => {
      const ada = await ctx.db.insert('players', aPlayer())
      const teamId = await ctx.db.insert('teams', aTeam({ playerIds: [ada], creator: undefined }))
      await expect(requireTeamCreatorFor(ctx, ada, teamId)).rejects.toThrow(/NOT_TEAM_CREATOR/)
    })
  })
})

describe('isProFor', () => {
  test('is true only for membershipStatus pro', async () => {
    const t = convexTest(schema, modules)
    await t.run(async (ctx) => {
      const ada = await ctx.db.insert('players', aPlayer())
      expect(await isProFor(ctx, ada)).toBe(false)

      await ctx.db.insert('playerMembership', {
        legacyId: 'lm-1',
        playerId: ada,
        membershipStatus: 'pro',
      })
      expect(await isProFor(ctx, ada)).toBe(true)
    })
  })

  test('is false for every non-pro status', async () => {
    const t = convexTest(schema, modules)
    for (const status of ['new', 'free', 'cancelled', 'expired'] as const) {
      await t.run(async (ctx) => {
        const ada = await ctx.db.insert('players', aPlayer())
        await ctx.db.insert('playerMembership', {
          legacyId: `lm-${status}`,
          playerId: ada,
          membershipStatus: status,
        })
        expect(await isProFor(ctx, ada)).toBe(false)
      })
    }
  })
})
```

Extend the existing import at the top of `access.test.ts` to pull in the two new helpers:

```ts
import { isProFor, requireTeamCreatorFor } from './access'
```

(keep whatever it already imports alongside them), and import the fixtures if the file does not already have them:

```ts
import { aPlayer, aTeam } from './scores.test.ts'
```

- [ ] **Step 2: Run it and confirm it fails**

```bash
cd v2 && pnpm test:once access.test.ts
```

Expected: FAIL — `requireTeamCreatorFor is not a function` / `isProFor is not a function`.

- [ ] **Step 3: Add the helpers**

In `v2/convex/access.ts`, widen the code union:

```ts
export type AccessCode = 'UNAUTHENTICATED' | 'NO_PLAYER' | 'NOT_A_MEMBER' | 'INVALID_BOARD'
```

becomes:

```ts
export type AccessCode =
  | 'UNAUTHENTICATED'
  | 'NO_PLAYER'
  | 'NOT_A_MEMBER'
  | 'INVALID_BOARD'
  | 'NOT_TEAM_CREATOR'
  | 'INVALID_TEAM'
  | 'INVALID_SYSTEM'
```

Then append to the same file:

```ts
/**
 * The team, if that player created it.
 *
 * WHY CREATOR-ONLY, AND WHY SERVER-SIDE. v1's UI offers Settings, Invite and
 * Delete only to the creator, but its RLS policy permits UPDATE to the creator
 * OR any member — including writes to player_ids, so any member can remove any
 * other member through the API. v2 makes the UI's rule the real one. No user
 * sees a behaviour change; the rule simply stops being cosmetic. Recorded as
 * divergence 4 in V2-ADDENDUM 7a.
 *
 * A non-member gets NOT_A_MEMBER rather than NOT_TEAM_CREATOR, matching
 * requireTeamMemberFor: a probe must not be able to distinguish "no such team"
 * from "not yours" from "yours but not yours to edit".
 *
 * `creator` is optional because a scoped copy may not include it. Such a team
 * has NOBODY who can edit it. That is honest — you are not the creator — and it
 * is asserted in the tests so it is a known property rather than a beta
 * surprise.
 */
export async function requireTeamCreatorFor(
  ctx: ReaderCtx,
  playerId: Id<'players'>,
  teamId: Id<'teams'>,
): Promise<Doc<'teams'>> {
  const team = await requireTeamMemberFor(ctx, playerId, teamId)
  if (team.creator !== playerId) throw accessError('NOT_TEAM_CREATOR')
  return team
}

/** The signed-in player and a team they created. */
export async function requireTeamCreator(
  ctx: AuthCtx,
  teamId: Id<'teams'>,
): Promise<{ player: Doc<'players'>; team: Doc<'teams'> }> {
  const player = await requirePlayer(ctx)
  const team = await requireTeamCreatorFor(ctx, player._id, teamId)
  return { player, team }
}

/**
 * Whether this player is on the pro plan.
 *
 * READ ONLY, AND NOT ENFORCED. Phase 3 uses this to hide the scoring editor and
 * to swap "New Team" for "Upgrade for more" past two teams — the same two gates
 * v1 has. v1's gates are UI-only too: its `save` action does not check pro, and
 * nothing stops a free account creating five teams through the API. Enforcing
 * here would be a behaviour change rather than a port. Phase 5 owns whether
 * that changes.
 */
export async function isProFor(ctx: ReaderCtx, playerId: Id<'players'>): Promise<boolean> {
  const membership = await ctx.db
    .query('playerMembership')
    .withIndex('by_player', (q) => q.eq('playerId', playerId))
    .first()
  return membership?.membershipStatus === 'pro'
}
```

- [ ] **Step 4: Run the access tests**

```bash
cd v2 && pnpm test:once access.test.ts
```

Expected: PASS.

- [ ] **Step 5: Watch `tsc` fail on purpose, then give the new codes copy**

```bash
cd v2 && pnpm exec tsc --noEmit
```

Expected: **FAIL** in `src/lib/convex-error.ts` — `Type 'NOT_TEAM_CREATOR' is not assignable to type 'never'`. That exhaustive switch exists precisely so a new code cannot be silently routed to a generic message. It is working.

Fix it. In `v2/src/lib/convex-error.ts`, extend the runtime guard:

```ts
  if (
    code === 'UNAUTHENTICATED' ||
    code === 'NO_PLAYER' ||
    code === 'NOT_A_MEMBER' ||
    code === 'INVALID_BOARD'
  ) {
    return code
  }
```

becomes:

```ts
  if (
    code === 'UNAUTHENTICATED' ||
    code === 'NO_PLAYER' ||
    code === 'NOT_A_MEMBER' ||
    code === 'INVALID_BOARD' ||
    code === 'NOT_TEAM_CREATOR' ||
    code === 'INVALID_TEAM' ||
    code === 'INVALID_SYSTEM'
  ) {
    return code
  }
```

and add three cases to `typedCodeMessage`, before the `default`:

```ts
    case 'NOT_TEAM_CREATOR':
      return 'Only the person who created this team can change it.'
    case 'INVALID_TEAM':
      return 'A team needs a name.'
    case 'INVALID_SYSTEM':
      return 'Points must be whole numbers between -100 and 100.'
```

- [ ] **Step 6: Confirm `tsc` is clean and everything passes**

```bash
cd v2 && pnpm test:once && pnpm exec tsc --noEmit && pnpm build
```

Expected: all PASS.

- [ ] **Step 7: Commit**

```bash
cd .. && git add v2/convex/access.ts v2/convex/access.test.ts v2/src/lib/convex-error.ts
git commit -m "feat(v2): creator-only access helper, pro read, and three typed error codes (wt-ksh.4.21)"
```

---

## Task 5: `convex/teams.ts` — the widened read

`getMyTeams` moves out of `scores.ts` and grows members, creator and settings. **One subscription, not two:** the read set is the whole `teams` table either way (Convex cannot index array membership), so splitting into a thin picker query and a scoped detail query would double the subscriptions without shrinking the read set.

**Files:**
- Create: `v2/convex/teams.ts`
- Create: `v2/convex/teams.test.ts`
- Modify: `v2/convex/scores.ts` (delete `getMyTeams`)
- Modify: `v2/src/routes/index.tsx` (`api.scores.getMyTeams` → `api.teams.getMyTeams`)

- [ ] **Step 1: Write the failing tests**

Create `v2/convex/teams.test.ts`:

```ts
import { convexTest } from 'convex-test'
import { describe, expect, test } from 'vitest'
import schema from './schema'
import { aPlayer, aTeam } from './scores.test.ts'
import { getMyTeamsFor } from './teams.ts'

const modules = import.meta.glob('./**/*.ts')

describe('getMyTeamsFor', () => {
  test('returns only the teams the caller belongs to', async () => {
    const t = convexTest(schema, modules)
    await t.run(async (ctx) => {
      const ada = await ctx.db.insert('players', aPlayer())
      const bob = await ctx.db.insert('players', aPlayer({ email: 'bob@example.com' }))
      const mine = await ctx.db.insert('teams', aTeam({ name: 'Mine', playerIds: [ada], creator: ada }))
      await ctx.db.insert('teams', aTeam({ legacyId: 207, name: 'Theirs', playerIds: [bob], creator: bob }))

      const teams = await getMyTeamsFor(ctx, ada)
      expect(teams.map((team) => team.id)).toEqual([mine])
    })
  })

  test('carries members, creator flag and settings', async () => {
    const t = convexTest(schema, modules)
    await t.run(async (ctx) => {
      const ada = await ctx.db.insert('players', aPlayer())
      const bob = await ctx.db.insert('players', aPlayer({ email: 'bob@example.com', firstName: 'Bob', lastName: 'Ross' }))
      await ctx.db.insert(
        'teams',
        aTeam({ playerIds: [ada, bob], creator: ada, playWeekends: false, showLetters: false }),
      )

      const [team] = await getMyTeamsFor(ctx, ada)
      expect(team.isCreator).toBe(true)
      expect(team.playWeekends).toBe(false)
      expect(team.showLetters).toBe(false)
      expect(team.members.map((member) => member.firstName)).toEqual(['Ada', 'Bob'])
    })
  })

  test('isCreator is false for a member who did not create the team', async () => {
    const t = convexTest(schema, modules)
    await t.run(async (ctx) => {
      const ada = await ctx.db.insert('players', aPlayer())
      const bob = await ctx.db.insert('players', aPlayer({ email: 'bob@example.com' }))
      await ctx.db.insert('teams', aTeam({ playerIds: [ada, bob], creator: ada }))

      const [team] = await getMyTeamsFor(ctx, bob)
      expect(team.isCreator).toBe(false)
    })
  })

  test('excludes profile-incomplete members, as the scores table does', async () => {
    const t = convexTest(schema, modules)
    await t.run(async (ctx) => {
      const ada = await ctx.db.insert('players', aPlayer())
      const invitee = await ctx.db.insert(
        'players',
        aPlayer({ email: 'new@example.com', firstName: undefined, lastName: undefined }),
      )
      await ctx.db.insert('teams', aTeam({ playerIds: [ada, invitee], creator: ada }))

      const [team] = await getMyTeamsFor(ctx, ada)
      expect(team.members).toHaveLength(1)
    })
  })

  test('does not leak the invite list onto the wire', async () => {
    const t = convexTest(schema, modules)
    await t.run(async (ctx) => {
      const ada = await ctx.db.insert('players', aPlayer())
      await ctx.db.insert(
        'teams',
        aTeam({ playerIds: [ada], creator: ada, invited: ['someone@example.com'] }),
      )

      const [team] = await getMyTeamsFor(ctx, ada)
      expect(JSON.stringify(team)).not.toContain('someone@example.com')
    })
  })

  test('orders by createdAt, oldest first', async () => {
    const t = convexTest(schema, modules)
    await t.run(async (ctx) => {
      const ada = await ctx.db.insert('players', aPlayer())
      await ctx.db.insert('teams', aTeam({ name: 'Second', playerIds: [ada], creator: ada, createdAt: 2000 }))
      await ctx.db.insert(
        'teams',
        aTeam({ legacyId: 207, name: 'First', playerIds: [ada], creator: ada, createdAt: 1000 }),
      )

      const teams = await getMyTeamsFor(ctx, ada)
      expect(teams.map((team) => team.name)).toEqual(['First', 'Second'])
    })
  })
})
```

- [ ] **Step 2: Run it and confirm it fails**

```bash
cd v2 && pnpm test:once teams.test.ts
```

Expected: FAIL — `Cannot find module './teams.ts'`.

- [ ] **Step 3: Write the query module**

Create `v2/convex/teams.ts`:

```ts
import { query } from './_generated/server'
import { currentPlayer, isProFor } from './access'
import type { Id, DataModel } from './_generated/dataModel'
import type { GenericDatabaseReader } from 'convex/server'

/**
 * Team management. Phase 3 (wt-ksh.4).
 *
 * getMyTeams moved here from scores.ts and grew members, creator and settings,
 * so that ONE subscription drives the picker, the CurrentTeam card and the
 * MyTeams card.
 *
 * Splitting it into a thin picker query plus a scoped per-team detail query
 * would NOT have been cheaper: the read set is the entire teams table either
 * way, because Convex cannot index array membership (see the schema comment on
 * `teams`), so the split doubles subscriptions without shrinking what a write
 * invalidates. What is on the wire stays small — a player's own teams, one to
 * six of them.
 *
 * The cost that does exist: a write to ANY team invalidates this subscription
 * for EVERY connected client. Phase 3 raises team-write frequency, which is the
 * condition scores.ts flagged as the trigger to revisit. Acceptable at 171
 * teams and ~40 DAU; revisit if either number moves, not simply because the
 * table grows.
 */

type ReaderCtx = { db: GenericDatabaseReader<DataModel> }

export async function getMyTeamsFor(ctx: ReaderCtx, playerId: Id<'players'>) {
  const allTeams = await ctx.db.query('teams').collect()
  const mine = allTeams
    .filter((team) => team.playerIds.includes(playerId))
    .sort((a, b) => (a.createdAt ?? 0) - (b.createdAt ?? 0))

  return await Promise.all(
    mine.map(async (team) => {
      const resolved = await Promise.all(
        team.playerIds.map(async (memberId) => {
          const member = await ctx.db.get(memberId)
          if (!member) return null
          // Same exclusion as getTeamMonthFor and the winner recomputation: a
          // just-accepted invitee sits in playerIds with no name, and v1's
          // fromDbPlayer throws on one, crashing the client render.
          if (!member.firstName || !member.lastName) return null
          return { id: member._id, firstName: member.firstName, lastName: member.lastName }
        }),
      )

      return {
        id: team._id,
        name: team.name,
        // Not `creator` itself: the caller only ever needs to know whether the
        // buttons are theirs, and a raw creator id is one more thing on the wire.
        isCreator: team.creator === playerId,
        playWeekends: team.playWeekends,
        showLetters: team.showLetters,
        // Fields are picked explicitly rather than spreading the doc, so the
        // wire payload cannot carry `invited`, which holds real email addresses.
        members: resolved.filter((member): member is NonNullable<typeof member> => member !== null),
      }
    }),
  )
}

export const getMyTeams = query({
  args: {},
  handler: async (ctx) => {
    const player = await currentPlayer(ctx)
    if (!player) return []
    return await getMyTeamsFor(ctx, player._id)
  },
})

/**
 * Whether the caller is on the pro plan, for the two UI gates v1 has: the
 * scoring editor, and "New Team" swapping to "Upgrade for more" past two teams.
 * Nothing is enforced server-side — see isProFor.
 */
export const amIPro = query({
  args: {},
  handler: async (ctx) => {
    const player = await currentPlayer(ctx)
    if (!player) return false
    return await isProFor(ctx, player._id)
  },
})
```

- [ ] **Step 4: Run the tests**

```bash
cd v2 && pnpm test:once teams.test.ts
```

Expected: PASS, all six.

- [ ] **Step 5: Delete the old `getMyTeams` and repoint its caller**

In `v2/convex/scores.ts`, delete the `getMyTeams` export (its doc comment and body, currently lines 112–140). Remove `currentPlayer` from its `./access` import **only if** nothing else in the file uses it — `getMyPlayerId` still does, so keep it.

In `v2/src/routes/index.tsx`, change both references:

```ts
    await context.queryClient.ensureQueryData(convexQuery(api.scores.getMyTeams, {}))
```

```ts
  const { data: teams } = useSuspenseQuery(convexQuery(api.scores.getMyTeams, {}))
```

to:

```ts
    await context.queryClient.ensureQueryData(convexQuery(api.teams.getMyTeams, {}))
```

```ts
  const { data: teams } = useSuspenseQuery(convexQuery(api.teams.getMyTeams, {}))
```

`TeamPicker` still takes `{ id, name }` and the widened objects satisfy that structurally, so it needs no change yet — Task 9 rewrites it.

- [ ] **Step 6: Push to dev, run everything including e2e**

```bash
cd v2 && pnpm exec convex dev --once
pnpm test:once && pnpm exec tsc --noEmit && pnpm build && pnpm e2e
```

Expected: all PASS. `pnpm e2e` because the dashboard route's loader changed.

- [ ] **Step 7: Commit**

```bash
cd .. && git add v2/convex/teams.ts v2/convex/teams.test.ts v2/convex/scores.ts v2/src/routes/index.tsx
git commit -m "feat(v2): convex/teams.ts — one widened getMyTeams carrying members and settings (wt-ksh.4.22)"
```

---

## Task 6: `createTeam`, `updateTeam`, `deleteTeam`

**Files:**
- Modify: `v2/convex/teams.ts`
- Modify: `v2/convex/teams.test.ts`

- [ ] **Step 1: Write the failing tests**

Append to `v2/convex/teams.test.ts`:

```ts
import { toPuzzleDay } from './lib/puzzleDay.ts'
import { createTeamFor, deleteTeamFor, updateTeamFor } from './teams.ts'

const today = toPuzzleDay(new Date())

describe('createTeamFor', () => {
  test('creates a team owned by the caller, with the default scoring system', async () => {
    const t = convexTest(schema, modules)
    await t.run(async (ctx) => {
      const ada = await ctx.db.insert('players', aPlayer())
      const teamId = await createTeamFor(ctx, ada, {
        name: 'New Team',
        playWeekends: true,
        showLetters: false,
      })

      const team = (await ctx.db.get(teamId))!
      expect(team.name).toBe('New Team')
      expect(team.creator).toBe(ada)
      expect(team.playerIds).toEqual([ada])
      expect(team.invited).toEqual([])
      expect(team.showLetters).toBe(false)
      expect(team.oneGuess).toBe(5)
      expect(team.failed).toBe(-3)
      // Born in v2: no Supabase identity to carry.
      expect(team.legacyId).toBeUndefined()
      expect(typeof team.createdAt).toBe('number')
    })
  })

  test('trims the name and refuses an empty one', async () => {
    const t = convexTest(schema, modules)
    await t.run(async (ctx) => {
      const ada = await ctx.db.insert('players', aPlayer())
      const teamId = await createTeamFor(ctx, ada, {
        name: '  Padded  ',
        playWeekends: true,
        showLetters: true,
      })
      expect((await ctx.db.get(teamId))!.name).toBe('Padded')

      await expect(
        createTeamFor(ctx, ada, { name: '   ', playWeekends: true, showLetters: true }),
      ).rejects.toThrow(/INVALID_TEAM/)
    })
  })

  test('does NOT enforce a team cap — v1 gates that in the UI only', async () => {
    const t = convexTest(schema, modules)
    await t.run(async (ctx) => {
      const ada = await ctx.db.insert('players', aPlayer())
      for (const name of ['one', 'two', 'three']) {
        await createTeamFor(ctx, ada, { name, playWeekends: true, showLetters: true })
      }
      expect(await getMyTeamsFor(ctx, ada)).toHaveLength(3)
    })
  })
})

describe('updateTeamFor', () => {
  test('renames without touching the scoring system', async () => {
    const t = convexTest(schema, modules)
    await t.run(async (ctx) => {
      const ada = await ctx.db.insert('players', aPlayer())
      const teamId = await ctx.db.insert('teams', aTeam({ playerIds: [ada], creator: ada }))

      await updateTeamFor(ctx, ada, {
        teamId,
        name: 'Renamed',
        playWeekends: true,
        showLetters: true,
        today,
      })

      const team = (await ctx.db.get(teamId))!
      expect(team.name).toBe('Renamed')
      expect(team.oneGuess).toBe(5)
    })
  })

  test('refuses a member who is not the creator', async () => {
    const t = convexTest(schema, modules)
    await t.run(async (ctx) => {
      const ada = await ctx.db.insert('players', aPlayer())
      const bob = await ctx.db.insert('players', aPlayer({ email: 'bob@example.com' }))
      const teamId = await ctx.db.insert('teams', aTeam({ playerIds: [ada, bob], creator: ada }))

      await expect(
        updateTeamFor(ctx, bob, {
          teamId,
          name: 'Hijacked',
          playWeekends: true,
          showLetters: true,
          today,
        }),
      ).rejects.toThrow(/NOT_TEAM_CREATOR/)
    })
  })

  test('recomputes past winners when playWeekends flips', async () => {
    const t = convexTest(schema, modules)
    await t.run(async (ctx) => {
      const ada = await ctx.db.insert('players', aPlayer())
      const bob = await ctx.db.insert('players', aPlayer({ email: 'bob@example.com', firstName: 'Bob' }))
      const teamId = await ctx.db.insert(
        'teams',
        aTeam({ playerIds: [ada, bob], creator: ada, playWeekends: true }),
      )
      // 2026-06-06 is a Saturday, 2026-06-08 a Monday.
      // With weekends on, Ada (weekend win) leads; with weekends off she scores nothing.
      await ctx.db.insert('dailyScores', {
        playerId: ada,
        puzzleDay: '2026-06-06',
        date: 1_755_500_000_000,
        answer: 'SPEED',
        guesses: ['SPEED'],
      })
      await ctx.db.insert('dailyScores', {
        playerId: bob,
        puzzleDay: '2026-06-08',
        date: 1_755_500_000_000,
        answer: 'SPEED',
        guesses: ['CRANE', 'SLATE', 'SPELL', 'SPEED'],
      })
      await ctx.db.insert('monthlyWinners', {
        playerId: ada,
        teamId,
        year: 2026,
        month: 6,
        hasSeenCelebration: [ada],
      })

      await updateTeamFor(ctx, ada, {
        teamId,
        name: 'team 206',
        playWeekends: false,
        showLetters: true,
        today,
      })

      const row = await ctx.db
        .query('monthlyWinners')
        .withIndex('by_team_year_month', (q) => q.eq('teamId', teamId).eq('year', 2026).eq('month', 6))
        .first()
      expect(row?.playerId).toBe(bob)
    })
  })
})

describe('deleteTeamFor', () => {
  test('deletes the team and cascades to winners and scoring versions, but not to boards', async () => {
    const t = convexTest(schema, modules)
    await t.run(async (ctx) => {
      const ada = await ctx.db.insert('players', aPlayer())
      const teamId = await ctx.db.insert('teams', aTeam({ playerIds: [ada], creator: ada }))
      const scoreId = await ctx.db.insert('dailyScores', {
        playerId: ada,
        puzzleDay: '2026-06-08',
        date: 1_755_500_000_000,
        answer: 'SPEED',
        guesses: ['SPEED'],
      })
      await ctx.db.insert('monthlyWinners', {
        playerId: ada,
        teamId,
        year: 2026,
        month: 6,
        hasSeenCelebration: [],
      })
      await ctx.db.insert('scoringSystems', {
        teamId,
        effectiveFrom: '2026-06',
        oneGuess: 9,
        twoGuesses: 3,
        threeGuesses: 2,
        fourGuesses: 1,
        fiveGuesses: 0,
        sixGuesses: -1,
        failed: -3,
        nA: 0,
      })

      await deleteTeamFor(ctx, ada, teamId)

      expect(await ctx.db.get(teamId)).toBeNull()
      expect(await ctx.db.query('monthlyWinners').collect()).toEqual([])
      expect(await ctx.db.query('scoringSystems').collect()).toEqual([])
      // A board belongs to a player and is shared across all their teams, so it
      // survives — exactly as in Postgres, where daily_scores has no team fkey.
      expect(await ctx.db.get(scoreId)).not.toBeNull()
    })
  })

  test('refuses a member who is not the creator', async () => {
    const t = convexTest(schema, modules)
    await t.run(async (ctx) => {
      const ada = await ctx.db.insert('players', aPlayer())
      const bob = await ctx.db.insert('players', aPlayer({ email: 'bob@example.com' }))
      const teamId = await ctx.db.insert('teams', aTeam({ playerIds: [ada, bob], creator: ada }))
      await expect(deleteTeamFor(ctx, bob, teamId)).rejects.toThrow(/NOT_TEAM_CREATOR/)
      expect(await ctx.db.get(teamId)).not.toBeNull()
    })
  })

  test('does not touch another team’s winner rows', async () => {
    const t = convexTest(schema, modules)
    await t.run(async (ctx) => {
      const ada = await ctx.db.insert('players', aPlayer())
      const doomed = await ctx.db.insert('teams', aTeam({ playerIds: [ada], creator: ada }))
      const kept = await ctx.db.insert('teams', aTeam({ legacyId: 207, playerIds: [ada], creator: ada }))
      await ctx.db.insert('monthlyWinners', {
        playerId: ada,
        teamId: doomed,
        year: 2026,
        month: 6,
        hasSeenCelebration: [],
      })
      await ctx.db.insert('monthlyWinners', {
        playerId: ada,
        teamId: kept,
        year: 2026,
        month: 6,
        hasSeenCelebration: [],
      })

      await deleteTeamFor(ctx, ada, doomed)

      const remaining = await ctx.db.query('monthlyWinners').collect()
      expect(remaining.map((row) => row.teamId)).toEqual([kept])
    })
  })
})
```

- [ ] **Step 2: Run it and confirm it fails**

```bash
cd v2 && pnpm test:once teams.test.ts
```

Expected: FAIL — `createTeamFor is not a function`.

- [ ] **Step 3: Write the mutations**

Append to `v2/convex/teams.ts`. Extend the existing imports first:

```ts
import { v } from 'convex/values'
import { mutation, query } from './_generated/server'
import { accessError, currentPlayer, isProFor, requirePlayer, requireTeamCreatorFor } from './access'
import { DEFAULT_SYSTEM } from './lib/scoringSystem.ts'
import { addDays, toPuzzleDay } from './lib/puzzleDay.ts'
import { monthsWithWinners, recomputeTeamMonths } from './winners.ts'
import type { WriterCtx } from './winners.ts'
import type { PuzzleDay } from './lib/puzzleDay.ts'
```

Then append:

```ts
/**
 * The submitter's own local today, bounded server-side.
 *
 * Lifted from upsertBoardFor's guard and shared, because it is needed for the
 * same reason: `today` is client-supplied, the server has no viewer whose
 * midnight it could ask for, and the value is NOT confined to the caller — it
 * decides which missed days are due for every member of the team, and the
 * result is written to monthlyWinners, which the whole team reads. An unbounded
 * value is shared-state corruption, not a personal view quirk.
 *
 * ±1 day of the server's date. Convex runs UTC, and UTC-12..UTC+14 spans 26
 * hours, so a legitimate client anywhere on earth is always within one calendar
 * day of it. See wordle-teams-04r: that Convex's clock is UTC is currently an
 * inference, and confirming it is a pre-cutover task.
 */
function requirePlausibleToday(today: PuzzleDay): PuzzleDay {
  const serverToday = toPuzzleDay(new Date())
  if (today < addDays(serverToday, -1) || today > addDays(serverToday, 1)) {
    throw accessError('INVALID_TEAM')
  }
  return today
}

function requireName(name: string): string {
  const trimmed = name.trim()
  if (trimmed.length === 0) throw accessError('INVALID_TEAM')
  return trimmed
}

export type TeamSettings = { name: string; playWeekends: boolean; showLetters: boolean }

/**
 * Create a team, with the caller as its only member and its creator.
 *
 * NO SERVER-SIDE TEAM CAP. v1 shows "Upgrade for more" once a free account has
 * two teams, but that is UI only — nothing stops a free account creating five
 * through the API. Phase 3 reproduces the gate where v1 has it. Phase 5 owns
 * whether it becomes real.
 */
export async function createTeamFor(
  ctx: WriterCtx,
  playerId: Id<'players'>,
  settings: TeamSettings,
): Promise<Id<'teams'>> {
  return await ctx.db.insert('teams', {
    name: requireName(settings.name),
    creator: playerId,
    playerIds: [playerId],
    invited: [],
    playWeekends: settings.playWeekends,
    showLetters: settings.showLetters,
    createdAt: Date.now(),
    // The ORIGINAL system. The editor writes scoringSystems rows from here on
    // and never touches these eight fields again — see lib/scoringSystem.ts.
    ...DEFAULT_SYSTEM,
  })
}

export const createTeam = mutation({
  args: { name: v.string(), playWeekends: v.boolean(), showLetters: v.boolean() },
  handler: async (ctx, args) => {
    const player = await requirePlayer(ctx)
    return await createTeamFor(ctx, player._id, args)
  },
})

/**
 * Rename a team and set its two flags.
 *
 * RECOMPUTES EVERY MONTH WITH A WINNER ROW WHEN playWeekends FLIPS, and nothing
 * otherwise. playWeekends is an input to monthTotal — turning it off removes
 * every Saturday and Sunday from every month's total — so leaving the stored
 * winners alone would leave the card and the scoreboard disagreeing on the same
 * screen. A rename changes no total and triggers no recompute.
 */
export async function updateTeamFor(
  ctx: WriterCtx,
  playerId: Id<'players'>,
  args: TeamSettings & { teamId: Id<'teams'>; today: PuzzleDay },
): Promise<void> {
  const team = await requireTeamCreatorFor(ctx, playerId, args.teamId)
  const today = requirePlausibleToday(args.today)
  const name = requireName(args.name)
  const weekendsChanged = team.playWeekends !== args.playWeekends

  await ctx.db.patch(team._id, {
    name,
    playWeekends: args.playWeekends,
    showLetters: args.showLetters,
  })

  if (!weekendsChanged) return
  const updated = (await ctx.db.get(team._id))!
  await recomputeTeamMonths(ctx, updated, await monthsWithWinners(ctx, team._id), today)
}

export const updateTeam = mutation({
  args: {
    teamId: v.id('teams'),
    name: v.string(),
    playWeekends: v.boolean(),
    showLetters: v.boolean(),
    today: v.string(),
  },
  handler: async (ctx, args) => {
    const player = await requirePlayer(ctx)
    await updateTeamFor(ctx, player._id, args)
  },
})

/**
 * Delete a team, CASCADING BY HAND.
 *
 * Postgres has ON DELETE CASCADE on monthly_winners.team_id; Convex has no such
 * thing, so the rows have to go explicitly or they become unreachable orphans
 * that still count against the free tier and still turn up in a parity
 * reconciliation.
 *
 * dailyScores are NOT deleted. A board belongs to a player and is shared across
 * every team they are on — daily_scores has no team foreign key in Postgres
 * either — so deleting a team must never destroy anybody's history.
 */
export async function deleteTeamFor(
  ctx: WriterCtx,
  playerId: Id<'players'>,
  teamId: Id<'teams'>,
): Promise<void> {
  const team = await requireTeamCreatorFor(ctx, playerId, teamId)

  const winners = await ctx.db
    .query('monthlyWinners')
    .withIndex('by_team_year_month', (q) => q.eq('teamId', team._id))
    .collect()
  for (const row of winners) await ctx.db.delete(row._id)

  const systems = await ctx.db
    .query('scoringSystems')
    .withIndex('by_team_and_effectiveFrom', (q) => q.eq('teamId', team._id))
    .collect()
  for (const row of systems) await ctx.db.delete(row._id)

  await ctx.db.delete(team._id)
}

export const deleteTeam = mutation({
  args: { teamId: v.id('teams') },
  handler: async (ctx, { teamId }) => {
    const player = await requirePlayer(ctx)
    await deleteTeamFor(ctx, player._id, teamId)
  },
})
```

Note `getMyTeamsFor` takes a `ReaderCtx` and the mutations take a `WriterCtx`; a `WriterCtx` satisfies `ReaderCtx` structurally, so the test that calls `getMyTeamsFor` after `createTeamFor` needs no cast.

- [ ] **Step 4: Run the tests**

```bash
cd v2 && pnpm test:once teams.test.ts
```

Expected: PASS, all of them.

- [ ] **Step 5: Push to dev and run the gates**

```bash
cd v2 && pnpm exec convex dev --once
pnpm test:once && pnpm exec tsc --noEmit && pnpm build
```

Expected: all PASS.

- [ ] **Step 6: Commit**

```bash
cd .. && git add v2/convex/teams.ts v2/convex/teams.test.ts
git commit -m "feat(v2): createTeam, updateTeam and deleteTeam with a hand-written cascade (wt-ksh.4.23)"
```

---

## Task 7: `removeMember`

**Files:**
- Modify: `v2/convex/teams.ts`
- Modify: `v2/convex/teams.test.ts`

- [ ] **Step 1: Write the failing tests**

Append to `v2/convex/teams.test.ts`:

```ts
describe('removeMemberFor', () => {
  test('removes the member from playerIds', async () => {
    const t = convexTest(schema, modules)
    await t.run(async (ctx) => {
      const ada = await ctx.db.insert('players', aPlayer())
      const bob = await ctx.db.insert('players', aPlayer({ email: 'bob@example.com' }))
      const teamId = await ctx.db.insert('teams', aTeam({ playerIds: [ada, bob], creator: ada }))

      await removeMemberFor(ctx, ada, { teamId, playerId: bob, today })

      expect((await ctx.db.get(teamId))!.playerIds).toEqual([ada])
    })
  })

  test('recomputes EVERY month the team has a winner row for', async () => {
    const t = convexTest(schema, modules)
    await t.run(async (ctx) => {
      const ada = await ctx.db.insert('players', aPlayer())
      const bob = await ctx.db.insert('players', aPlayer({ email: 'bob@example.com', firstName: 'Bob' }))
      const teamId = await ctx.db.insert('teams', aTeam({ playerIds: [ada, bob], creator: ada }))
      // Bob won both June and July outright.
      for (const puzzleDay of ['2026-06-08', '2026-07-08']) {
        await ctx.db.insert('dailyScores', {
          playerId: bob,
          puzzleDay,
          date: 1_755_500_000_000,
          answer: 'SPEED',
          guesses: ['SPEED'],
        })
      }
      for (const [year, month] of [
        [2026, 6],
        [2026, 7],
      ] as const) {
        await ctx.db.insert('monthlyWinners', {
          playerId: bob,
          teamId,
          year,
          month,
          hasSeenCelebration: [],
        })
      }

      await removeMemberFor(ctx, ada, { teamId, playerId: bob, today })

      // Ada has no scores at all, so with Bob gone nobody can win: prod would
      // have left Bob named as the winner of two months he is no longer in.
      expect(await ctx.db.query('monthlyWinners').collect()).toEqual([])
    })
  })

  test('refuses to remove the creator', async () => {
    const t = convexTest(schema, modules)
    await t.run(async (ctx) => {
      const ada = await ctx.db.insert('players', aPlayer())
      const bob = await ctx.db.insert('players', aPlayer({ email: 'bob@example.com' }))
      const teamId = await ctx.db.insert('teams', aTeam({ playerIds: [ada, bob], creator: ada }))

      await expect(
        removeMemberFor(ctx, ada, { teamId, playerId: ada, today }),
      ).rejects.toThrow(/INVALID_TEAM/)
      expect((await ctx.db.get(teamId))!.playerIds).toEqual([ada, bob])
    })
  })

  test('refuses a member who is not the creator', async () => {
    const t = convexTest(schema, modules)
    await t.run(async (ctx) => {
      const ada = await ctx.db.insert('players', aPlayer())
      const bob = await ctx.db.insert('players', aPlayer({ email: 'bob@example.com' }))
      const carol = await ctx.db.insert('players', aPlayer({ email: 'carol@example.com' }))
      const teamId = await ctx.db.insert('teams', aTeam({ playerIds: [ada, bob, carol], creator: ada }))

      await expect(
        removeMemberFor(ctx, bob, { teamId, playerId: carol, today }),
      ).rejects.toThrow(/NOT_TEAM_CREATOR/)
    })
  })

  test('leaves the removed player’s boards intact', async () => {
    const t = convexTest(schema, modules)
    await t.run(async (ctx) => {
      const ada = await ctx.db.insert('players', aPlayer())
      const bob = await ctx.db.insert('players', aPlayer({ email: 'bob@example.com' }))
      const teamId = await ctx.db.insert('teams', aTeam({ playerIds: [ada, bob], creator: ada }))
      const scoreId = await ctx.db.insert('dailyScores', {
        playerId: bob,
        puzzleDay: '2026-06-08',
        date: 1_755_500_000_000,
        answer: 'SPEED',
        guesses: ['SPEED'],
      })

      await removeMemberFor(ctx, ada, { teamId, playerId: bob, today })

      expect(await ctx.db.get(scoreId)).not.toBeNull()
    })
  })
})
```

Extend the `./teams.ts` import in that file to include `removeMemberFor`.

- [ ] **Step 2: Run it and confirm it fails**

```bash
cd v2 && pnpm test:once teams.test.ts
```

Expected: FAIL — `removeMemberFor is not a function`.

- [ ] **Step 3: Write the mutation**

Append to `v2/convex/teams.ts`:

```ts
/**
 * Take a member off a team.
 *
 * RECOMPUTES EVERY MONTH WITH A WINNER ROW. This is divergence 5 in
 * V2-ADDENDUM 7a: v1's update_monthly_winners is a trigger on daily_scores, and
 * removing a player touches `teams`, so it never fires — a removed player stays
 * named as the winner of months they are no longer in, and production is
 * carrying stale rows today.
 *
 * The creator cannot be removed, matching v1's UI, which hides the remove
 * button on your own row. Since only the creator can reach this at all, that
 * makes "remove yourself" unreachable rather than merely hidden — v1 has no
 * leave-team affordance and neither does this.
 */
export async function removeMemberFor(
  ctx: WriterCtx,
  playerId: Id<'players'>,
  args: { teamId: Id<'teams'>; playerId: Id<'players'>; today: PuzzleDay },
): Promise<void> {
  const team = await requireTeamCreatorFor(ctx, playerId, args.teamId)
  const today = requirePlausibleToday(args.today)
  if (args.playerId === team.creator) throw accessError('INVALID_TEAM')

  await ctx.db.patch(team._id, {
    playerIds: team.playerIds.filter((memberId) => memberId !== args.playerId),
  })

  const updated = (await ctx.db.get(team._id))!
  await recomputeTeamMonths(ctx, updated, await monthsWithWinners(ctx, team._id), today)
}

export const removeMember = mutation({
  args: { teamId: v.id('teams'), playerId: v.id('players'), today: v.string() },
  handler: async (ctx, args) => {
    const player = await requirePlayer(ctx)
    await removeMemberFor(ctx, player._id, args)
  },
})
```

- [ ] **Step 4: Run the tests**

```bash
cd v2 && pnpm test:once teams.test.ts
```

Expected: PASS.

- [ ] **Step 5: Push to dev and run the gates**

```bash
cd v2 && pnpm exec convex dev --once
pnpm test:once && pnpm exec tsc --noEmit && pnpm build
```

Expected: all PASS.

- [ ] **Step 6: Commit**

```bash
cd .. && git add v2/convex/teams.ts v2/convex/teams.test.ts
git commit -m "feat(v2): removeMember recomputes every affected month's winner (wt-ksh.4.24)"
```

---

## Task 8: Version resolution in `getTeamMonth`, and `setScoringSystem`

The load-bearing task. Without the resolution half, a past month's totals are computed under today's rules — the exact bug the feature exists to remove.

**Files:**
- Modify: `v2/convex/winners.ts` (resolve the version per month)
- Modify: `v2/convex/scores.ts` (`getTeamMonthFor` returns the resolved system)
- Modify: `v2/convex/teams.ts` (`setScoringSystem`)
- Modify: `v2/convex/scores.test.ts`, `v2/convex/teams.test.ts`

- [ ] **Step 1: Write the failing tests**

Append to `v2/convex/scores.test.ts`:

```ts
describe('getTeamMonthFor — scoring version resolution', () => {
  test('returns the team’s own values when there are no versions', async () => {
    const t = convexTest(schema, modules)
    await t.run(async (ctx) => {
      const playerId = await ctx.db.insert('players', aPlayer())
      const teamId = await ctx.db.insert('teams', aTeam({ playerIds: [playerId] }))
      const result = await getTeamMonthFor(ctx, playerId, teamId, '2026-08')
      expect(result.team.system.oneGuess).toBe(5)
      expect(result.team.systemEffectiveFrom).toBeNull()
    })
  })

  test('a past month resolves to the version that governed it, not the current one', async () => {
    const t = convexTest(schema, modules)
    await t.run(async (ctx) => {
      const playerId = await ctx.db.insert('players', aPlayer())
      const teamId = await ctx.db.insert('teams', aTeam({ playerIds: [playerId] }))
      await ctx.db.insert('scoringSystems', {
        teamId,
        effectiveFrom: '2026-08',
        oneGuess: 20,
        twoGuesses: 3,
        threeGuesses: 2,
        fourGuesses: 1,
        fiveGuesses: 0,
        sixGuesses: -1,
        failed: -3,
        nA: 0,
      })

      const july = await getTeamMonthFor(ctx, playerId, teamId, '2026-07')
      expect(july.team.system.oneGuess).toBe(5)
      expect(july.team.systemEffectiveFrom).toBeNull()

      const august = await getTeamMonthFor(ctx, playerId, teamId, '2026-08')
      expect(august.team.system.oneGuess).toBe(20)
      expect(august.team.systemEffectiveFrom).toBe('2026-08')
    })
  })
})
```

Append to `v2/convex/teams.test.ts`:

```ts
describe('setScoringSystemFor', () => {
  const newValues = {
    oneGuess: 20,
    twoGuesses: 10,
    threeGuesses: 5,
    fourGuesses: 2,
    fiveGuesses: 1,
    sixGuesses: 0,
    failed: -10,
    nA: -1,
  }

  test('writes a version effective from the current month and leaves the team doc alone', async () => {
    const t = convexTest(schema, modules)
    await t.run(async (ctx) => {
      const ada = await ctx.db.insert('players', aPlayer())
      const teamId = await ctx.db.insert('teams', aTeam({ playerIds: [ada], creator: ada }))

      await setScoringSystemFor(ctx, ada, { teamId, values: newValues, today })

      const versions = await ctx.db.query('scoringSystems').collect()
      expect(versions).toHaveLength(1)
      expect(versions[0].effectiveFrom).toBe(today.slice(0, 7))
      expect(versions[0].oneGuess).toBe(20)
      // The team doc keeps THE ORIGINAL system — it is the fallback for every
      // month before the first version.
      expect((await ctx.db.get(teamId))!.oneGuess).toBe(5)
    })
  })

  test('a second edit in the same month patches the row rather than adding one', async () => {
    const t = convexTest(schema, modules)
    await t.run(async (ctx) => {
      const ada = await ctx.db.insert('players', aPlayer())
      const teamId = await ctx.db.insert('teams', aTeam({ playerIds: [ada], creator: ada }))

      await setScoringSystemFor(ctx, ada, { teamId, values: newValues, today })
      await setScoringSystemFor(ctx, ada, {
        teamId,
        values: { ...newValues, oneGuess: 21 },
        today,
      })

      const versions = await ctx.db.query('scoringSystems').collect()
      expect(versions).toHaveLength(1)
      expect(versions[0].oneGuess).toBe(21)
    })
  })

  test('refuses a member who is not the creator', async () => {
    const t = convexTest(schema, modules)
    await t.run(async (ctx) => {
      const ada = await ctx.db.insert('players', aPlayer())
      const bob = await ctx.db.insert('players', aPlayer({ email: 'bob@example.com' }))
      const teamId = await ctx.db.insert('teams', aTeam({ playerIds: [ada, bob], creator: ada }))

      await expect(
        setScoringSystemFor(ctx, bob, { teamId, values: newValues, today }),
      ).rejects.toThrow(/NOT_TEAM_CREATOR/)
    })
  })

  test('refuses a non-integer or out-of-range value', async () => {
    const t = convexTest(schema, modules)
    await t.run(async (ctx) => {
      const ada = await ctx.db.insert('players', aPlayer())
      const teamId = await ctx.db.insert('teams', aTeam({ playerIds: [ada], creator: ada }))

      await expect(
        setScoringSystemFor(ctx, ada, { teamId, values: { ...newValues, oneGuess: 1.5 }, today }),
      ).rejects.toThrow(/INVALID_SYSTEM/)
      await expect(
        setScoringSystemFor(ctx, ada, { teamId, values: { ...newValues, oneGuess: 101 }, today }),
      ).rejects.toThrow(/INVALID_SYSTEM/)
      await expect(
        setScoringSystemFor(ctx, ada, { teamId, values: { ...newValues, nA: -101 }, today }),
      ).rejects.toThrow(/INVALID_SYSTEM/)
    })
  })

  test('THE POINT OF THE WHOLE FEATURE: an edit leaves a past month’s winner and totals alone', async () => {
    const t = convexTest(schema, modules)
    await t.run(async (ctx) => {
      const ada = await ctx.db.insert('players', aPlayer())
      const bob = await ctx.db.insert('players', aPlayer({ email: 'bob@example.com', firstName: 'Bob' }))
      const teamId = await ctx.db.insert('teams', aTeam({ playerIds: [ada, bob], creator: ada }))
      const lastMonth = addMonths(today.slice(0, 7), -1)

      // Last month: Ada solved in one (5), Bob failed (-3). Ada won.
      await ctx.db.insert('dailyScores', {
        playerId: ada,
        puzzleDay: `${lastMonth}-05`,
        date: 1_755_500_000_000,
        answer: 'SPEED',
        guesses: ['SPEED'],
      })
      await ctx.db.insert('dailyScores', {
        playerId: bob,
        puzzleDay: `${lastMonth}-05`,
        date: 1_755_500_000_000,
        answer: 'SPEED',
        guesses: ['CRANE', 'SLATE', 'SPELL', 'SPILL', 'STEEL', 'SPEND'],
      })
      await ctx.db.insert('monthlyWinners', {
        playerId: ada,
        teamId,
        year: Number(lastMonth.slice(0, 4)),
        month: Number(lastMonth.slice(5, 7)),
        hasSeenCelebration: [ada],
      })

      // Now invert the system: failing is worth more than solving in one.
      await setScoringSystemFor(ctx, ada, {
        teamId,
        values: { ...newValues, oneGuess: -50, failed: 50 },
        today,
      })

      const row = await ctx.db
        .query('monthlyWinners')
        .withIndex('by_team_year_month', (q) =>
          q
            .eq('teamId', teamId)
            .eq('year', Number(lastMonth.slice(0, 4)))
            .eq('month', Number(lastMonth.slice(5, 7))),
        )
        .first()
      // Under the new rules Bob would have won last month. He must not.
      expect(row?.playerId).toBe(ada)
      expect(row?.hasSeenCelebration).toEqual([ada])

      // And the read path agrees: last month still resolves to the original.
      const past = await getTeamMonthFor(ctx, ada, teamId, lastMonth)
      expect(past.team.system.oneGuess).toBe(5)
    })
  })
})
```

Extend that file's imports:

```ts
import { addMonths } from './lib/puzzleDay.ts'
import { getTeamMonthFor } from './scores.ts'
import { setScoringSystemFor } from './teams.ts'
```

- [ ] **Step 2: Run and confirm both suites fail**

```bash
cd v2 && pnpm test:once scores.test.ts teams.test.ts
```

Expected: FAIL — `systemEffectiveFrom` is undefined, and `setScoringSystemFor is not a function`.

- [ ] **Step 3: Resolve the version in `winners.ts`**

In `v2/convex/winners.ts`, add the imports:

```ts
import { systemFor } from './lib/scoringSystem.ts'
```

and add a helper plus one changed line in `recomputeTeamMonth`. Insert this above `recomputeTeamMonth`:

```ts
/**
 * The scoring system that governed one month for one team.
 *
 * Reads every version row for the team — a team accumulates one per month it
 * was edited in, which is a handful — and resolves with the pure systemFor. The
 * team doc's own eight fields are the fallback, which is what makes existing
 * teams need no backfill.
 */
export async function systemForTeamMonth(
  ctx: WriterCtx,
  team: Doc<'teams'>,
  month: PuzzleMonth,
) {
  const versions = await ctx.db
    .query('scoringSystems')
    .withIndex('by_team_and_effectiveFrom', (q) => q.eq('teamId', team._id))
    .collect()
  return systemFor(team, versions, month)
}
```

Then inside `recomputeTeamMonth`, immediately after the `const { start, end } = monthRange(month)` line, add:

```ts
  const system = await systemForTeamMonth(ctx, team, month)
```

and change the `monthTotal` call from `system: team,` to `system,`:

```ts
      total: monthTotal({
        month,
        scores,
        // The version that governed THIS month, not the team's current values.
        // Without this a scoring edit would rewrite every past month's winner,
        // which is the bug wordle-teams-1j3 exists to prevent.
        system,
        playWeekends: team.playWeekends,
        today,
      }),
```

- [ ] **Step 4: Resolve the version in `getTeamMonthFor`**

In `v2/convex/scores.ts`, add the import:

```ts
import { effectiveFromOf, systemFor } from './lib/scoringSystem.ts'
```

In `getTeamMonthFor`, after `const { start, end } = monthRange(month)`, add:

```ts
  // The system that governed the month being VIEWED. The team doc's own eight
  // fields are the original, used until the first edit; every edit since writes
  // a scoringSystems row. Reading the team's live values here would compute a
  // past month's totals under today's rules — wordle-teams-1j3.
  const versions = await ctx.db
    .query('scoringSystems')
    .withIndex('by_team_and_effectiveFrom', (q) => q.eq('teamId', teamId))
    .collect()
  const system = systemFor(team, versions, month)
```

and replace the `system: { ... }` block in the returned `team` object with:

```ts
      system,
      // null when the month resolved to the team's original values — that is
      // what tells the Scoring System card there is no "historical" badge.
      systemEffectiveFrom: effectiveFromOf(versions, month),
```

- [ ] **Step 5: Write `setScoringSystem`**

Append to `v2/convex/teams.ts`. Extend its imports:

```ts
import { monthOf } from './lib/puzzleDay.ts'
import type { ScoringSystem } from './lib/scoring.ts'
```

(`monthsWithWinners` and `recomputeTeamMonths` are already imported from `./winners.ts` by Task 6. Do **not** import `systemForTeamMonth` here — `setScoringSystemFor` never calls it, and `noUnusedLocals` is on, so an unused import fails `tsc`.)

Then append:

```ts
const SYSTEM_FIELDS = [
  'oneGuess',
  'twoGuesses',
  'threeGuesses',
  'fourGuesses',
  'fiveGuesses',
  'sixGuesses',
  'failed',
  'nA',
] as const

/** Whole numbers only, in the range v1's PointsInput clamps to. */
function requireValues(values: ScoringSystem): ScoringSystem {
  for (const field of SYSTEM_FIELDS) {
    const value = values[field]
    if (!Number.isInteger(value) || value < -100 || value > 100) {
      throw accessError('INVALID_SYSTEM')
    }
  }
  return values
}

/**
 * Change a team's scoring system, from THIS MONTH FORWARD.
 *
 * wordle-teams-1j3. Writes (or patches) the scoringSystems row for the current
 * month rather than overwriting the team doc, so every earlier month keeps
 * resolving to whatever governed it. Then recomputes this month and every later
 * month with a winner row, because those totals really did change.
 *
 * MID-MONTH EDITS DO RECOMPUTE THE RUNNING MONTH. That is the literal reading of
 * "applies to the current month forward": days already played this month
 * re-score, and the month's leader can change immediately. The month is still in
 * play, so nothing anyone has been told is final is being rewritten.
 *
 * NO PRO CHECK. v1 hides the editor from non-pro accounts in the UI and its
 * `save` server action does not check either. Phase 3 reproduces the gate where
 * v1 has it; Phase 5 owns whether it becomes real.
 */
export async function setScoringSystemFor(
  ctx: WriterCtx,
  playerId: Id<'players'>,
  args: { teamId: Id<'teams'>; values: ScoringSystem; today: PuzzleDay },
): Promise<void> {
  const team = await requireTeamCreatorFor(ctx, playerId, args.teamId)
  const today = requirePlausibleToday(args.today)
  const values = requireValues(args.values)
  const effectiveFrom = monthOf(today)

  const existing = await ctx.db
    .query('scoringSystems')
    .withIndex('by_team_and_effectiveFrom', (q) =>
      q.eq('teamId', team._id).eq('effectiveFrom', effectiveFrom),
    )
    .first()

  if (existing) await ctx.db.patch(existing._id, values)
  else await ctx.db.insert('scoringSystems', { teamId: team._id, effectiveFrom, ...values })

  // This month, plus every later month that already has a winner row. Earlier
  // months resolve to an earlier version and are deliberately untouched.
  const later = (await monthsWithWinners(ctx, team._id)).filter((month) => month > effectiveFrom)
  await recomputeTeamMonths(ctx, team, [effectiveFrom, ...later], today)
}

export const setScoringSystem = mutation({
  args: {
    teamId: v.id('teams'),
    values: v.object({
      oneGuess: v.number(),
      twoGuesses: v.number(),
      threeGuesses: v.number(),
      fourGuesses: v.number(),
      fiveGuesses: v.number(),
      sixGuesses: v.number(),
      failed: v.number(),
      nA: v.number(),
    }),
    today: v.string(),
  },
  handler: async (ctx, args) => {
    const player = await requirePlayer(ctx)
    await setScoringSystemFor(ctx, player._id, args)
  },
})
```

- [ ] **Step 6: Run both suites**

```bash
cd v2 && pnpm test:once
```

Expected: PASS, everything. The `scores.test.ts` test asserting `result.team.system.oneGuess` from Phase 2 still passes — a team with no versions resolves to its own fields.

- [ ] **Step 7: Deploy and run the gates**

```bash
cd v2 && pnpm exec convex dev --once
pnpm test:once && pnpm exec tsc --noEmit && pnpm build
```

Expected: all PASS. `src/components/scores-table.tsx` reads `data.team.system` and needs no change — it was already parameterised.

- [ ] **Step 8: Commit**

```bash
cd .. && git add v2/convex/winners.ts v2/convex/scores.ts v2/convex/scores.test.ts \
  v2/convex/teams.ts v2/convex/teams.test.ts
git commit -m "feat(v2): resolve the scoring version per month, and edit from this month forward (wordle-teams-1j3)"
```

---

## Task 9: Team picker dropdown and the create-team dialog

**Files:**
- Rewrite: `v2/src/components/team-picker.tsx`
- Create: `v2/src/components/teams/create-team-dialog.tsx`
- Modify: `v2/src/routes/index.tsx`

- [ ] **Step 1: Add the shared mutation-error helper first**

Every dialog in Tasks 9–12 imports this, so it lands before any of them.

Append to `v2/src/lib/convex-error.ts`:

```ts
/**
 * What to tell the user after a failed TEAM mutation.
 *
 * A third sibling of boardErrorMessage and dashboardErrorMessage, and it exists
 * for the same reason they are separate: the typed cases read identically, but
 * the fallback has to say something true about what just failed. `fallback` is
 * the caller's own wording for "this specific thing did not work".
 */
export function mutationErrorMessage(error: unknown, fallback: string): string {
  const code = convexErrorCode(error)
  return code ? typedCodeMessage(code) : fallback
}
```

`typedCodeMessage` is module-private, which is why this has to live in that file rather than beside the components.

- [ ] **Step 2: Write the create-team dialog**

Create `v2/src/components/teams/create-team-dialog.tsx`:

```tsx
import { useState } from 'react'
import { Loader2 } from 'lucide-react'
import { toast } from 'sonner'
import { useConvexMutation } from '@convex-dev/react-query'
import { useMutation } from '@tanstack/react-query'
import type { FormEventHandler } from 'react'
import { api } from '../../../convex/_generated/api'
import { Button } from '#/components/ui/button.tsx'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '#/components/ui/dialog.tsx'
import { Input } from '#/components/ui/input.tsx'
import { Label } from '#/components/ui/label.tsx'
import { Switch } from '#/components/ui/switch.tsx'
import { mutationErrorMessage } from '#/lib/convex-error.ts'

/**
 * Create a team. Ports v1's create-team.tsx: name, Play Weekends, Show Letters,
 * both switches defaulting on.
 *
 * The a335ae8 submit shape Phase 2 ported applies here too — try/catch,
 * setSubmitting(false) in `finally`, and the dialog closes ONLY on success, so
 * a failed create never discards what was typed.
 */
export function CreateTeamDialog({
  open,
  onOpenChange,
  onCreated,
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
  onCreated: (teamId: string) => void
}) {
  const create = useMutation({ mutationFn: useConvexMutation(api.teams.createTeam) })
  const [name, setName] = useState('')
  const [playWeekends, setPlayWeekends] = useState(true)
  const [showLetters, setShowLetters] = useState(true)
  const [submitting, setSubmitting] = useState(false)

  const handleSubmit: FormEventHandler<HTMLFormElement> = async (event) => {
    event.preventDefault()
    setSubmitting(true)
    try {
      const teamId = await create.mutateAsync({ name, playWeekends, showLetters })
      toast.success('Successfully created team')
      setName('')
      setPlayWeekends(true)
      setShowLetters(true)
      onOpenChange(false)
      onCreated(teamId)
    } catch (error) {
      toast.error(mutationErrorMessage(error, 'Team creation failed, please try again'))
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Create Team</DialogTitle>
          <DialogDescription>
            Enter your team&apos;s name and select desired team settings
          </DialogDescription>
        </DialogHeader>
        <form onSubmit={handleSubmit} className="w-full space-y-6">
          <div className="flex flex-col space-y-4 py-4">
            <div className="flex items-center justify-between">
              <Label htmlFor="team-name">Team Name</Label>
              <Input
                id="team-name"
                required
                className="w-48 md:w-80"
                value={name}
                onChange={(event) => setName(event.target.value)}
              />
            </div>
            <div className="flex items-center justify-between">
              <Label htmlFor="create-play-weekends">Play Weekends</Label>
              <Switch
                id="create-play-weekends"
                checked={playWeekends}
                onCheckedChange={setPlayWeekends}
              />
            </div>
            <div className="flex items-center justify-between">
              <Label htmlFor="create-show-letters">Show Letters in Completed Boards</Label>
              <Switch
                id="create-show-letters"
                checked={showLetters}
                onCheckedChange={setShowLetters}
              />
            </div>
          </div>
          <DialogFooter>
            <Button type="submit" variant="secondary" disabled={submitting} aria-disabled={submitting}>
              {submitting && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
              Create
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}
```

- [ ] **Step 3: Rewrite the team picker**

Replace `v2/src/components/team-picker.tsx` entirely:

```tsx
import { ChevronDown, Plus, Sparkles } from 'lucide-react'
import { Button } from '#/components/ui/button.tsx'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '#/components/ui/dropdown-menu.tsx'

/**
 * Team selection, and the entry point for creating one.
 *
 * A DropdownMenu rather than a Select because that is where "New Team" and
 * "Upgrade for more" live in v1 — a Select would need a second button beside
 * it, which is a shape prod does not have.
 *
 * THE UPGRADE SWAP IS UI-ONLY, exactly as in v1: past two teams a free account
 * is shown "Upgrade for more" instead of "New Team", but createTeam does not
 * enforce a cap and neither does v1's server action.
 */
export type TeamOption = { id: string; name: string }

const FREE_TEAM_LIMIT = 2

export function TeamPicker({
  teams,
  value,
  isPro,
  onChange,
  onCreate,
  onUpgrade,
}: {
  teams: Array<TeamOption>
  value: string
  isPro: boolean
  onChange: (teamId: string) => void
  onCreate: () => void
  onUpgrade: () => void
}) {
  if (teams.length === 0) return null

  const selected = teams.find((team) => team.id === value)
  const name = selected?.name ?? 'No team selected'
  const label = name.length > 15 ? `${name.slice(0, 15)}...` : name
  const atFreeLimit = !isPro && teams.length >= FREE_TEAM_LIMIT

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button
          variant="outline"
          aria-label="Team"
          className="max-w-[9.5rem] px-2 text-xs md:max-w-none md:px-4 md:text-sm"
        >
          {label}
          <ChevronDown className="ml-1 h-4 w-4 md:ml-2" />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="start">
        <DropdownMenuLabel>Change Team</DropdownMenuLabel>
        <DropdownMenuSeparator />
        <DropdownMenuRadioGroup value={value} onValueChange={onChange}>
          {teams.map((team) => (
            <DropdownMenuRadioItem key={team.id} value={team.id}>
              {team.name}
            </DropdownMenuRadioItem>
          ))}
        </DropdownMenuRadioGroup>
        <DropdownMenuSeparator />
        {atFreeLimit ? (
          <DropdownMenuItem onSelect={onUpgrade}>
            <Sparkles size={18} />
            <span>Upgrade for more</span>
          </DropdownMenuItem>
        ) : (
          <DropdownMenuItem onSelect={onCreate}>
            <Plus size={18} />
            <span>New Team</span>
          </DropdownMenuItem>
        )}
      </DropdownMenuContent>
    </DropdownMenu>
  )
}

export default TeamPicker
```

- [ ] **Step 4: Wire both into the dashboard**

In `v2/src/routes/index.tsx`, add imports:

```ts
import { CreateTeamDialog } from '#/components/teams/create-team-dialog.tsx'
```

Add state and the pro query inside `Dashboard`:

```ts
  const [createOpen, setCreateOpen] = useState(false)
  const { data: isPro } = useSuspenseQuery(convexQuery(api.teams.amIPro, {}))
```

Replace the `<TeamPicker .../>` element with:

```tsx
        <TeamPicker
          teams={teams}
          value={teamParam}
          isPro={isPro}
          onChange={(team) => navigate({ to: '/', search: { team, month: monthParam } })}
          onCreate={() => setCreateOpen(true)}
          // Checkout is Phase 5. Until then, say so rather than doing nothing:
          // a dead menu item is indistinguishable from a broken one.
          onUpgrade={() => toast.info('Upgrading arrives with payments, in a later phase.')}
        />
```

and render the dialog just inside `<main>`:

```tsx
      <CreateTeamDialog
        open={createOpen}
        onOpenChange={setCreateOpen}
        onCreated={(team) => navigate({ to: '/', search: { team, month: monthParam } })}
      />
```

Add `useState` to the React import and `import { toast } from 'sonner'`. Also add `api.teams.amIPro` to the route loader beside `getMyTeams`:

```ts
  loader: async ({ context }) => {
    await context.queryClient.ensureQueryData(convexQuery(api.teams.getMyTeams, {}))
    await context.queryClient.ensureQueryData(convexQuery(api.teams.amIPro, {}))
  },
```

- [ ] **Step 5: Run the gates and e2e**

```bash
cd v2 && pnpm test:once && pnpm exec tsc --noEmit && pnpm build && pnpm e2e
```

Expected: all PASS.

- [ ] **Step 6: Screenshot the dropdown, open and closed, light and dark**

```bash
cd v2 && pnpm dev &
# in another shell, drive the project's own chromium:
pnpm exec playwright screenshot --viewport-size=390,844 --device="iPhone 13" \
  http://localhost:3000/ /tmp/teampicker-light.png
```

Open the dropdown and capture it. Confirm: the trigger truncates a long name at 15 characters, the radio group shows a check against the selected team, the separator is visible (a zero-height separator is the exact `radix-nova` symptom V2-ADDENDUM §5 describes), and "New Team" is tappable at a touch target size. Repeat with the dark class applied. **Do not proceed until both themes have been looked at.**

- [ ] **Step 7: Commit**

```bash
cd .. && git add v2/src/components/team-picker.tsx v2/src/components/teams/create-team-dialog.tsx \
  v2/src/lib/convex-error.ts v2/src/routes/index.tsx
git commit -m "feat(v2): team dropdown with create-team, and the free-tier upgrade swap (wt-ksh.4.26)"
```

---

## Task 10: CurrentTeam card, member removal, and the settings dialog

The settings dialog ships with the button that opens it rather than in the next task. `noUnusedLocals` is on, so splitting them would leave Task 10 with an unused `settingsOpen` local and a failing `tsc`.

**Files:**
- Create: `v2/src/components/teams/current-team-card.tsx`
- Create: `v2/src/components/teams/update-team-dialog.tsx`
- Modify: `v2/src/routes/index.tsx`

- [ ] **Step 1: Write the card**

Create `v2/src/components/teams/current-team-card.tsx`:

```tsx
import { useState } from 'react'
import { Loader2, Settings, Trash2 } from 'lucide-react'
import { toast } from 'sonner'
import { useConvexMutation } from '@convex-dev/react-query'
import { useMutation } from '@tanstack/react-query'
import { api } from '../../../convex/_generated/api'
import { Button } from '#/components/ui/button.tsx'
import { Card, CardContent, CardHeader, CardTitle } from '#/components/ui/card.tsx'
import { Popover, PopoverContent, PopoverTrigger } from '#/components/ui/popover.tsx'
import { Separator } from '#/components/ui/separator.tsx'
import { mutationErrorMessage } from '#/lib/convex-error.ts'
import { toPuzzleDay } from '../../../convex/lib/puzzleDay.ts'
import type { Id } from '../../../convex/_generated/dataModel'

export type TeamMember = { id: string; firstName: string; lastName: string }

/**
 * The selected team's members, and the creator's controls.
 *
 * Ports v1's current-team-client.tsx, minus the Invite button — invites are
 * Phase 4. Settings and the per-member remove are creator-only, matching v1's
 * UI; unlike v1 that is now also true of the mutation (divergence 4).
 *
 * The creator has no remove control on their own row: removeMember refuses it
 * server-side, and v1 hides it the same way.
 */
export function CurrentTeamCard({
  teamId,
  name,
  members,
  isCreator,
  onEditSettings,
  className,
}: {
  teamId: string
  name: string
  members: Array<TeamMember>
  isCreator: boolean
  onEditSettings: () => void
  className?: string
}) {
  const remove = useMutation({ mutationFn: useConvexMutation(api.teams.removeMember) })
  const [pendingId, setPendingId] = useState<string | null>(null)

  const handleRemove = async (playerId: string) => {
    setPendingId(playerId)
    try {
      await remove.mutateAsync({
        teamId: teamId as Id<'teams'>,
        playerId: playerId as Id<'players'>,
        today: toPuzzleDay(new Date()),
      })
      toast.success('Successfully removed player')
    } catch (error) {
      toast.error(mutationErrorMessage(error, 'Failed to remove player'))
    } finally {
      setPendingId(null)
    }
  }

  return (
    <Card className={className}>
      <CardHeader>
        <CardTitle asChild>
          <div className="flex items-center justify-between">
            <h2>{name}</h2>
            {isCreator && (
              <Button size="icon" variant="outline" aria-label="Team settings" onClick={onEditSettings}>
                <Settings size={22} />
              </Button>
            )}
          </div>
        </CardTitle>
      </CardHeader>
      <CardContent>
        <ul className="flex flex-col space-y-2">
          {members.map((member, index) => (
            <li key={member.id}>
              <div className="flex w-full items-center justify-between">
                <span>
                  {member.firstName} {member.lastName}
                </span>
                {isCreator && (
                  <Popover>
                    <PopoverTrigger asChild>
                      <Button variant="ghost" aria-label={`Remove ${member.firstName}`}>
                        <Trash2 size={16} className="text-danger" />
                      </Button>
                    </PopoverTrigger>
                    <PopoverContent className="w-auto">
                      <div className="flex flex-col space-y-4">
                        <span>Remove player from {name}?</span>
                        <Button
                          variant="destructive"
                          disabled={pendingId === member.id}
                          aria-disabled={pendingId === member.id}
                          onClick={() => handleRemove(member.id)}
                        >
                          {pendingId === member.id && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
                          Remove
                        </Button>
                      </div>
                    </PopoverContent>
                  </Popover>
                )}
              </div>
              {index < members.length - 1 && <Separator className="mt-2" />}
            </li>
          ))}
        </ul>
      </CardContent>
    </Card>
  )
}
```

The card renders a remove control against every row it is given. **The creator's own row is filtered at the call site** in Step 3 — the card receives `members` already narrowed, so it needs no knowledge of who the creator is.

- [ ] **Step 2: Write the settings dialog**

Create `v2/src/components/teams/update-team-dialog.tsx`:

```tsx
import { useEffect, useState } from 'react'
import { Loader2 } from 'lucide-react'
import { toast } from 'sonner'
import { useConvexMutation } from '@convex-dev/react-query'
import { useMutation } from '@tanstack/react-query'
import type { FormEventHandler } from 'react'
import { api } from '../../../convex/_generated/api'
import { Button } from '#/components/ui/button.tsx'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '#/components/ui/dialog.tsx'
import { Input } from '#/components/ui/input.tsx'
import { Label } from '#/components/ui/label.tsx'
import { Switch } from '#/components/ui/switch.tsx'
import { mutationErrorMessage } from '#/lib/convex-error.ts'
import { toPuzzleDay } from '../../../convex/lib/puzzleDay.ts'
import type { Id } from '../../../convex/_generated/dataModel'

/**
 * Rename a team and set its two flags. Ports v1's update-team.tsx.
 *
 * Turning Play Weekends off re-scores every month the team has a winner row
 * for — weekends stop contributing to any total — so the mutation recomputes.
 * That is server-side; nothing here has to know about it.
 */
export function UpdateTeamDialog({
  open,
  onOpenChange,
  team,
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
  team: { id: string; name: string; playWeekends: boolean; showLetters: boolean }
}) {
  const update = useMutation({ mutationFn: useConvexMutation(api.teams.updateTeam) })
  const [name, setName] = useState(team.name)
  const [playWeekends, setPlayWeekends] = useState(team.playWeekends)
  const [showLetters, setShowLetters] = useState(team.showLetters)
  const [submitting, setSubmitting] = useState(false)

  // Re-seed when the selected team changes underneath an open dialog, and when
  // a live update changes the team's settings from another browser.
  useEffect(() => {
    setName(team.name)
    setPlayWeekends(team.playWeekends)
    setShowLetters(team.showLetters)
  }, [team.id, team.name, team.playWeekends, team.showLetters])

  const handleSubmit: FormEventHandler<HTMLFormElement> = async (event) => {
    event.preventDefault()
    setSubmitting(true)
    try {
      await update.mutateAsync({
        teamId: team.id as Id<'teams'>,
        name,
        playWeekends,
        showLetters,
        today: toPuzzleDay(new Date()),
      })
      toast.success('Successfully updated team')
      onOpenChange(false)
    } catch (error) {
      toast.error(mutationErrorMessage(error, 'Team update failed, please try again'))
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Update Team</DialogTitle>
          <DialogDescription>
            Enter your team&apos;s name and select desired team settings
          </DialogDescription>
        </DialogHeader>
        <form onSubmit={handleSubmit} className="w-full space-y-6">
          <div className="flex flex-col space-y-4 py-4">
            <div className="flex items-center justify-between">
              <Label htmlFor="update-team-name">Team Name</Label>
              <Input
                id="update-team-name"
                required
                className="w-48 md:w-80"
                value={name}
                onChange={(event) => setName(event.target.value)}
              />
            </div>
            <div className="flex items-center justify-between">
              <Label htmlFor="update-play-weekends">Play Weekends</Label>
              <Switch
                id="update-play-weekends"
                checked={playWeekends}
                onCheckedChange={setPlayWeekends}
              />
            </div>
            <div className="flex items-center justify-between">
              <Label htmlFor="update-show-letters">Show Letters in Completed Boards</Label>
              <Switch
                id="update-show-letters"
                checked={showLetters}
                onCheckedChange={setShowLetters}
              />
            </div>
          </div>
          <DialogFooter>
            <Button type="submit" variant="secondary" disabled={submitting} aria-disabled={submitting}>
              {submitting && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
              Update
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}
```

- [ ] **Step 3: Render both on the dashboard**

In `v2/src/routes/index.tsx`, add these imports:

```ts
import { CurrentTeamCard } from '#/components/teams/current-team-card.tsx'
import { UpdateTeamDialog } from '#/components/teams/update-team-dialog.tsx'
```

Add the state and the two derived values inside `Dashboard`, beside the existing `createOpen` state:

```ts
  const [settingsOpen, setSettingsOpen] = useState(false)
  const { data: myPlayerId } = useSuspenseQuery(convexQuery(api.scores.getMyPlayerId, {}))
  const selectedTeam = teams.find((team) => team.id === teamParam)
```

`getMyPlayerId` is the query Phase 2 already ships; it is what tells the card which row is yours. Add it to the route loader too, beside the other two:

```ts
    await context.queryClient.ensureQueryData(convexQuery(api.scores.getMyPlayerId, {}))
```

Then render both below the scores table:

```tsx
      {selectedTeam && (
        <>
          <CurrentTeamCard
            teamId={selectedTeam.id}
            name={selectedTeam.name}
            // The creator cannot be removed — removeMember refuses it — so the
            // control is not offered against their own row, as in v1.
            members={selectedTeam.members.filter(
              (member) => !selectedTeam.isCreator || member.id !== myPlayerId,
            )}
            isCreator={selectedTeam.isCreator}
            onEditSettings={() => setSettingsOpen(true)}
          />
          <UpdateTeamDialog open={settingsOpen} onOpenChange={setSettingsOpen} team={selectedTeam} />
        </>
      )}
```

- [ ] **Step 4: Run the gates and e2e**

```bash
cd v2 && pnpm test:once && pnpm exec tsc --noEmit && pnpm build && pnpm e2e
```

Expected: all PASS.

- [ ] **Step 5: Screenshot, both themes, touch viewport**

Confirm: the Separator between members is **visible** (a zero-height separator is the `radix-nova` symptom), the destructive Remove button is solid rather than transparent, the popover sits above the card rather than behind it, the remove control does not appear on your own row when you are the creator, and the Settings dialog's two Switches have a visible track (an invisible Switch is the other `radix-nova` symptom).

- [ ] **Step 6: Commit**

```bash
cd .. && git add v2/src/components/teams/current-team-card.tsx \
  v2/src/components/teams/update-team-dialog.tsx v2/src/routes/index.tsx
git commit -m "feat(v2): CurrentTeam card, creator-only member removal, team settings dialog (wt-ksh.4.27)"
```

---

## Task 11: MyTeams card and team deletion

**Files:**
- Create: `v2/src/components/teams/my-teams-card.tsx`
- Modify: `v2/src/routes/index.tsx`

- [ ] **Step 1: Write the MyTeams card**

Create `v2/src/components/teams/my-teams-card.tsx`:

```tsx
import { useState } from 'react'
import { Loader2, Trash2 } from 'lucide-react'
import { toast } from 'sonner'
import { useConvexMutation } from '@convex-dev/react-query'
import { useMutation } from '@tanstack/react-query'
import { api } from '../../../convex/_generated/api'
import { Button } from '#/components/ui/button.tsx'
import { Card, CardContent, CardHeader, CardTitle } from '#/components/ui/card.tsx'
import { Popover, PopoverContent, PopoverTrigger } from '#/components/ui/popover.tsx'
import { Separator } from '#/components/ui/separator.tsx'
import { mutationErrorMessage } from '#/lib/convex-error.ts'
import type { Id } from '../../../convex/_generated/dataModel'

export type MyTeam = {
  id: string
  name: string
  isCreator: boolean
  members: Array<{ id: string; firstName: string; lastName: string }>
}

/**
 * Every team you are on, with its members. Ports v1's my-teams.tsx.
 *
 * Delete is creator-only in the UI, as in v1, and now also in the mutation.
 * Deleting cascades to the team's winner rows and scoring versions but leaves
 * every board alone — a board belongs to a player, not to a team.
 */
export function MyTeamsCard({
  teams,
  onDeleted,
  className,
}: {
  teams: Array<MyTeam>
  onDeleted: (teamId: string) => void
  className?: string
}) {
  const remove = useMutation({ mutationFn: useConvexMutation(api.teams.deleteTeam) })
  const [pendingId, setPendingId] = useState<string | null>(null)

  const handleDelete = async (teamId: string) => {
    setPendingId(teamId)
    try {
      await remove.mutateAsync({ teamId: teamId as Id<'teams'> })
      toast.success('Successfully deleted team')
      onDeleted(teamId)
    } catch (error) {
      toast.error(mutationErrorMessage(error, 'Team deletion failed, please try again'))
    } finally {
      setPendingId(null)
    }
  }

  return (
    <Card className={className}>
      <CardHeader>
        <CardTitle asChild>
          <h2>My Teams</h2>
        </CardTitle>
      </CardHeader>
      <CardContent>
        <ul className="flex flex-col space-y-2">
          {teams.map((team, index) => (
            <li key={team.id}>
              <div className="flex items-start justify-between gap-2">
                <span className="min-w-0 truncate">{team.name}</span>
                <div className="flex items-start gap-2">
                  <ul className="text-right">
                    {team.members.map((member) => (
                      <li key={member.id}>
                        <span>{member.firstName}</span>
                        <span className="hidden md:inline">&nbsp;{member.lastName}</span>
                      </li>
                    ))}
                  </ul>
                  {team.isCreator && (
                    <Popover>
                      <PopoverTrigger asChild>
                        <Button variant="ghost" aria-label={`Delete ${team.name}`}>
                          <Trash2 size={16} className="text-danger" />
                        </Button>
                      </PopoverTrigger>
                      <PopoverContent className="w-auto">
                        <div className="flex flex-col space-y-4">
                          <span>Delete {team.name}?</span>
                          <Button
                            variant="destructive"
                            size="sm"
                            disabled={pendingId === team.id}
                            aria-disabled={pendingId === team.id}
                            onClick={() => handleDelete(team.id)}
                          >
                            {pendingId === team.id && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
                            Delete
                          </Button>
                        </div>
                      </PopoverContent>
                    </Popover>
                  )}
                </div>
              </div>
              {index < teams.length - 1 && <Separator className="mt-2" />}
            </li>
          ))}
        </ul>
      </CardContent>
    </Card>
  )
}
```

- [ ] **Step 2: Wire it into the dashboard**

In `v2/src/routes/index.tsx`, add the imports — including `STORAGE_KEY`:

```ts
import { MyTeamsCard } from '#/components/teams/my-teams-card.tsx'
import { STORAGE_KEY } from '#/lib/dashboard-search.ts'
```

and render after the `CurrentTeamCard` fragment:

```tsx
      <MyTeamsCard
        teams={teams}
        // Deleting the team you were looking at leaves ?team= pointing at a
        // gone id. Clear both the param and the remembered team so the sync
        // hook picks the first remaining team instead of the error boundary.
        onDeleted={(deleted) => {
          if (deleted !== teamParam) return
          // STORAGE_KEY, imported from #/lib/dashboard-search.ts — NOT the raw
          // string. Task 2 made that constant the single source of truth after a
          // review found the literal copy-pasted across three sites; this would
          // have been the fourth. A typo'd localStorage key fails silently.
          localStorage.removeItem(STORAGE_KEY)
          void navigate({ to: '/', search: {}, replace: true })
        }}
      />
```

- [ ] **Step 3: Run the gates and e2e**

```bash
cd v2 && pnpm test:once && pnpm exec tsc --noEmit && pnpm build && pnpm e2e
```

Expected: all PASS.

- [ ] **Step 4: Exercise the delete-the-selected-team path by hand**

With the dev server running, create a throwaway team, select it, then delete it from MyTeams. Expected: a success toast, the dashboard falls back to another team, and **the error boundary does not appear**. This is the path most likely to be broken and no test covers it.

- [ ] **Step 5: Screenshot, both themes, touch viewport**

Confirm: long team names truncate rather than pushing the member list off-screen, separators are visible, the delete popover is reachable and the destructive button is solid.

- [ ] **Step 6: Commit**

```bash
cd .. && git add v2/src/components/teams/my-teams-card.tsx v2/src/routes/index.tsx
git commit -m "feat(v2): MyTeams card with creator-only team deletion (wt-ksh.4.28)"
```

---

## Task 12: Scoring System card and editor

**Files:**
- Create: `v2/src/components/scoring-system-card.tsx`
- Create: `v2/src/components/scoring-system-editor.tsx`
- Modify: `v2/src/routes/index.tsx`

- [ ] **Step 1: Write the card**

Create `v2/src/components/scoring-system-card.tsx`:

```tsx
import { useState } from 'react'
import { Settings2 } from 'lucide-react'
import { convexQuery } from '@convex-dev/react-query'
import { useSuspenseQuery } from '@tanstack/react-query'
import { api } from '../../convex/_generated/api'
import { Badge } from '#/components/ui/badge.tsx'
import { Button } from '#/components/ui/button.tsx'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '#/components/ui/card.tsx'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '#/components/ui/table.tsx'
import { ScoringSystemEditor } from '#/components/scoring-system-editor.tsx'
import { monthOf, toPuzzleDay } from '../../convex/lib/puzzleDay.ts'
import { useHydrated } from '#/lib/use-hydrated.ts'
import type { Id } from '../../convex/_generated/dataModel'
import type { ScoringSystem } from '../../convex/lib/scoring.ts'

/**
 * Points awarded by attempts, FOR THE MONTH CURRENTLY BEING VIEWED.
 *
 * wordle-teams-1j3: a scoring change applies from the month it is made, and
 * past months keep the values they were played under. This card is where you
 * see which version applied — it reads the same resolved system the scores
 * table computes with, so the two can never disagree.
 *
 * Customize is hidden when viewing a past month (there is nothing to edit — a
 * past month's rules are settled), when the viewer is not pro, and when they
 * did not create the team. The first is a correctness rule; the other two are
 * v1's gates, and like v1's they are UI-only.
 */
const ROWS: Array<{ label: string; field: keyof ScoringSystem }> = [
  { label: '1', field: 'oneGuess' },
  { label: '2', field: 'twoGuesses' },
  { label: '3', field: 'threeGuesses' },
  { label: '4', field: 'fourGuesses' },
  { label: '5', field: 'fiveGuesses' },
  { label: '6', field: 'sixGuesses' },
  { label: 'X', field: 'failed' },
  // NOT "0" as v1 labels it, and not "N/A". The schema field is nA, which is a
  // misnomer: it is what an unplayed day before today scores, and has nothing
  // to do with the N/A shown for weekends on a no-weekends team.
  { label: 'Missed day', field: 'nA' },
]

function formatEffectiveFrom(month: string): string {
  const [year, monthNum] = month.split('-').map(Number)
  return new Intl.DateTimeFormat(undefined, { month: 'short', year: 'numeric' }).format(
    new Date(year, monthNum - 1, 1),
  )
}

export function ScoringSystemCard({
  teamId,
  month,
  isPro,
  isCreator,
  className,
}: {
  teamId: Id<'teams'>
  month: string
  isPro: boolean
  isCreator: boolean
  className?: string
}) {
  const hydrated = useHydrated()
  const [open, setOpen] = useState(false)
  const { data } = useSuspenseQuery(convexQuery(api.scores.getTeamMonth, { teamId, month }))
  const { system, systemEffectiveFrom } = data.team

  // Reading the clock is safe only after hydration — the server is UTC and the
  // viewer is not, and they disagree on the first and last days of a month.
  // Before hydration, assume the month is current, which hides nothing.
  const isCurrentMonth = hydrated ? month === monthOf(toPuzzleDay(new Date())) : true
  const canEdit = isCurrentMonth && isPro && isCreator

  return (
    <Card className={className}>
      <CardHeader>
        <CardTitle asChild>
          <div className="flex items-center justify-between">
            <h2>Scoring System</h2>
            {canEdit && (
              <Button
                size="icon"
                variant="outline"
                aria-label="Customize scoring system"
                onClick={() => setOpen(true)}
              >
                <Settings2 size={24} />
              </Button>
            )}
          </div>
        </CardTitle>
        <CardDescription>Points awarded by number of attempts</CardDescription>
        {systemEffectiveFrom && (
          <Badge variant="secondary">In effect from {formatEffectiveFrom(systemEffectiveFrom)}</Badge>
        )}
      </CardHeader>
      <CardContent>
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Attempts</TableHead>
              <TableHead className="text-right">Points</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {ROWS.map((row) => (
              <TableRow key={row.field}>
                <TableCell>{row.label}</TableCell>
                <TableCell className="text-right tabular-nums">{system[row.field]}</TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </CardContent>
      {canEdit && (
        <ScoringSystemEditor open={open} onOpenChange={setOpen} teamId={teamId} system={system} />
      )}
    </Card>
  )
}
```

- [ ] **Step 2: Write the editor**

Create `v2/src/components/scoring-system-editor.tsx`:

```tsx
import { useEffect, useState } from 'react'
import { Loader2 } from 'lucide-react'
import { toast } from 'sonner'
import { useConvexMutation } from '@convex-dev/react-query'
import { useMutation } from '@tanstack/react-query'
import type { FormEventHandler } from 'react'
import { api } from '../../convex/_generated/api'
import { Button } from '#/components/ui/button.tsx'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '#/components/ui/dialog.tsx'
import { Input } from '#/components/ui/input.tsx'
import { Label } from '#/components/ui/label.tsx'
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetFooter,
  SheetHeader,
  SheetTitle,
} from '#/components/ui/sheet.tsx'
import { useMediaQuery } from '#/lib/use-media-query.ts'
import { mutationErrorMessage } from '#/lib/convex-error.ts'
import { toPuzzleDay } from '../../convex/lib/puzzleDay.ts'
import type { Id } from '../../convex/_generated/dataModel'
import type { ScoringSystem } from '../../convex/lib/scoring.ts'

/**
 * Edit the team's scoring system. Dialog on desktop, Sheet on mobile — the same
 * split v1's CustomizeButton uses and Phase 2's board entry ports.
 *
 * THE EDIT APPLIES FROM THIS MONTH FORWARD. The mutation writes a version row
 * rather than overwriting the team, so no past month is rewritten. The copy
 * says so, because an editor that silently changed history is what
 * wordle-teams-1j3 was filed about — and an editor that visibly does not is
 * worth stating.
 */
const FIELDS: Array<{ label: string; field: keyof ScoringSystem }> = [
  { label: '1', field: 'oneGuess' },
  { label: '2', field: 'twoGuesses' },
  { label: '3', field: 'threeGuesses' },
  { label: '4', field: 'fourGuesses' },
  { label: '5', field: 'fiveGuesses' },
  { label: '6', field: 'sixGuesses' },
  { label: 'X', field: 'failed' },
  { label: 'Missed day', field: 'nA' },
]

const MIN = -100
const MAX = 100

export function ScoringSystemEditor({
  open,
  onOpenChange,
  teamId,
  system,
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
  teamId: Id<'teams'>
  system: ScoringSystem
}) {
  const isDesktop = useMediaQuery('(min-width: 768px)')
  const save = useMutation({ mutationFn: useConvexMutation(api.teams.setScoringSystem) })
  // Held as strings so a half-typed '-' or an empty box does not become 0 and
  // silently rewrite a value the user was in the middle of changing.
  const [draft, setDraft] = useState<Record<string, string>>(() => asDraft(system))
  const [submitting, setSubmitting] = useState(false)

  useEffect(() => {
    if (open) setDraft(asDraft(system))
  }, [open, system])

  const parsed = FIELDS.map(({ field }) => Number(draft[field]))
  const valid = parsed.every(
    (value, index) =>
      draft[FIELDS[index].field].trim() !== '' &&
      Number.isInteger(value) &&
      value >= MIN &&
      value <= MAX,
  )

  const handleSubmit: FormEventHandler<HTMLFormElement> = async (event) => {
    event.preventDefault()
    if (!valid) return
    setSubmitting(true)
    try {
      const values = Object.fromEntries(
        FIELDS.map(({ field }, index) => [field, parsed[index]]),
      ) as unknown as ScoringSystem
      await save.mutateAsync({ teamId, values, today: toPuzzleDay(new Date()) })
      toast.success('Successfully saved scoring system')
      onOpenChange(false)
    } catch (error) {
      toast.error(mutationErrorMessage(error, 'Failed to save scoring system'))
    } finally {
      setSubmitting(false)
    }
  }

  const body = (
    <form onSubmit={handleSubmit} className="space-y-4">
      <div className="flex flex-col space-y-3">
        {FIELDS.map(({ label, field }) => (
          <div key={field} className="flex items-center justify-between gap-4">
            <Label htmlFor={`points-${field}`}>{label}</Label>
            <Input
              id={`points-${field}`}
              inputMode="numeric"
              className="w-24 text-right tabular-nums"
              value={draft[field]}
              onChange={(event) => setDraft({ ...draft, [field]: event.target.value })}
            />
          </div>
        ))}
      </div>
      <p className="text-text-subtle text-sm">
        Applies from this month onward. Past months keep the points they were played under.
      </p>
      <div className="flex gap-2">
        <Button type="button" variant="outline" className="w-full" onClick={() => onOpenChange(false)}>
          Cancel
        </Button>
        <Button
          type="submit"
          className="w-full"
          disabled={submitting || !valid}
          aria-disabled={submitting || !valid}
        >
          {submitting && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
          Save
        </Button>
      </div>
    </form>
  )

  if (isDesktop) {
    return (
      <Dialog open={open} onOpenChange={onOpenChange}>
        <DialogContent>
          <DialogHeader className="pb-4">
            <DialogTitle className="text-2xl">Scoring System</DialogTitle>
            <DialogDescription>Points awarded by number of attempts</DialogDescription>
          </DialogHeader>
          {body}
          <DialogFooter className="hidden" />
        </DialogContent>
      </Dialog>
    )
  }

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent side="top" className="overflow-y-auto">
        <SheetHeader>
          <SheetTitle className="text-2xl">Scoring System</SheetTitle>
          <SheetDescription>Points awarded by number of attempts</SheetDescription>
        </SheetHeader>
        <div className="px-4 pb-4">{body}</div>
        <SheetFooter className="hidden" />
      </SheetContent>
    </Sheet>
  )
}

function asDraft(system: ScoringSystem): Record<string, string> {
  return Object.fromEntries(FIELDS.map(({ field }) => [field, String(system[field])]))
}
```

- [ ] **Step 3: Render the card on the dashboard**

In `v2/src/routes/index.tsx`, add the import and render between `CurrentTeamCard` and `MyTeamsCard`:

```tsx
      {selectedTeam && (
        <ScoringSystemCard
          teamId={teamParam as Id<'teams'>}
          month={monthParam}
          isPro={isPro}
          isCreator={selectedTeam.isCreator}
        />
      )}
```

- [ ] **Step 4: Run the gates and e2e**

```bash
cd v2 && pnpm test:once && pnpm exec tsc --noEmit && pnpm build && pnpm e2e
```

Expected: all PASS.

- [ ] **Step 5: Prove the feature by hand — this is the acceptance criterion**

With the dev server running against a team that has scores in a previous month:

1. Note last month's totals and the row order in the scores table.
2. Switch to the current month, edit the scoring system to something drastically different, save.
3. Switch back to last month. **The totals and the order must be exactly what you noted**, and the card must show the old values with no "In effect from" badge (or the previous version's badge, if the team had already been edited before).
4. Switch to the current month. Totals recomputed, badge reads "In effect from <this month>".
5. Confirm the Customize button is **absent** while viewing last month.

- [ ] **Step 6: Screenshot, both themes, touch viewport**

Confirm: the badge is legible in both themes, the editor's number inputs are large enough to tap and do not trigger a zoom on iOS, the Sheet scrolls if the eight rows exceed the viewport, and Save is reachable with the keyboard open.

- [ ] **Step 7: Commit**

```bash
cd .. && git add v2/src/components/scoring-system-card.tsx \
  v2/src/components/scoring-system-editor.tsx v2/src/routes/index.tsx
git commit -m "feat(v2): month-scoped scoring system card and editor (wordle-teams-1j3)"
```

---

## Task 13: The zero-teams empty state

**Files:**
- Create: `v2/src/components/teams/empty-state.tsx`
- Modify: `v2/src/routes/index.tsx:96-104`

- [ ] **Step 1: Write the card**

Create `v2/src/components/teams/empty-state.tsx`:

```tsx
import { Plus } from 'lucide-react'
import { Button } from '#/components/ui/button.tsx'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '#/components/ui/card.tsx'

/**
 * What a signed-in player with no teams sees.
 *
 * NOT a port of v1's Intro, which renders the whole marketing About component
 * with an animated gradient wordmark and a button on it. v2 already carries
 * that copy at /about, amendment A7 makes the onboarding surface a sanctioned
 * exception to strict parity, and this is the exact step where 87% of prod
 * signups stall (wordle-teams-456). One card, one action.
 */
export function TeamsEmptyState({ onCreate }: { onCreate: () => void }) {
  return (
    <Card className="mx-auto max-w-md">
      <CardHeader>
        <CardTitle asChild>
          <h1>You&apos;re not on a team yet</h1>
        </CardTitle>
        <CardDescription>
          Create one to start tracking your Wordle scores. You can invite people once it exists.
        </CardDescription>
      </CardHeader>
      <CardContent>
        <Button onClick={onCreate} className="w-full">
          <Plus size={18} className="mr-2" />
          Create a Team
        </Button>
      </CardContent>
    </Card>
  )
}
```

- [ ] **Step 2: Replace the placeholder**

In `v2/src/routes/index.tsx`, replace:

```tsx
  if (teams.length === 0) {
    return (
      <main className="p-2 md:p-12">
        <p className="text-muted-foreground">
          You are not on a team yet. Creating and joining teams arrives in Phase 3.
        </p>
      </main>
    )
  }
```

with:

```tsx
  if (teams.length === 0) {
    return (
      <main className="p-2 md:p-12">
        <TeamsEmptyState onCreate={() => setCreateOpen(true)} />
        <CreateTeamDialog
          open={createOpen}
          onOpenChange={setCreateOpen}
          onCreated={(team) => navigate({ to: '/', search: { team }, replace: true })}
        />
      </main>
    )
  }
```

Add the `TeamsEmptyState` import. Note this branch renders its **own** `CreateTeamDialog` — the one in the main return is unreachable from here, and the two must not both mount.

- [ ] **Step 3: Run the gates and e2e**

```bash
cd v2 && pnpm test:once && pnpm exec tsc --noEmit && pnpm build && pnpm e2e
```

Expected: all PASS.

- [ ] **Step 4: Exercise it by hand**

Sign in as an account on no teams (or temporarily remove yourself from all of them in the Convex dashboard). Expected: the card, a working Create Team button, and after creating, the dashboard lands on the new team with `?team=` set.

- [ ] **Step 5: Screenshot, both themes, touch viewport**

- [ ] **Step 6: Commit**

```bash
cd .. && git add v2/src/components/teams/empty-state.tsx v2/src/routes/index.tsx
git commit -m "feat(v2): focused create-team empty state, replacing the Phase 2 placeholder (wt-ksh.4.30)"
```

---

## Task 14: E2E, deploy, `wt-ksh.4.1`, phase close

**Files:**
- Create: `v2/e2e/teams.spec.ts`
- Modify: `docs/design-system/V2-ADDENDUM.md` (§7a — add divergences 4 and 5)

- [ ] **Step 1: Write the e2e spec**

Create `v2/e2e/teams.spec.ts`, following the shape of the existing `board-entry.spec.ts`:

```ts
import { expect, test } from '@playwright/test'
import { signIn } from './sign-in'

test('a signed-in player can create a team and it becomes the selected one', async ({ page }) => {
  await signIn(page)

  const name = `E2E Team ${Date.now()}`

  await page.getByRole('button', { name: 'Team' }).click()
  await page.getByRole('menuitem', { name: 'New Team' }).click()
  await page.getByLabel('Team Name').fill(name)
  await page.getByRole('button', { name: 'Create' }).click()

  // The dropdown trigger truncates at 15 characters, so match the prefix.
  await expect(page.getByRole('button', { name: 'Team' })).toContainText(name.slice(0, 15))
  await expect(page).toHaveURL(/team=/)
  // The new team is on the MyTeams card too.
  await expect(page.getByRole('heading', { name: 'My Teams' })).toBeVisible()
})

test('the scoring system card shows the eight rows for the selected month', async ({ page }) => {
  await signIn(page)
  await expect(page.getByRole('heading', { name: 'Scoring System' })).toBeVisible()
  await expect(page.getByRole('cell', { name: 'Missed day' })).toBeVisible()
})
```

- [ ] **Step 2: Run it**

```bash
cd v2 && pnpm e2e
```

Expected: PASS, including the two Phase 2 specs. If `signIn` needs a team to exist first, seed one through `convex/e2eSeed.ts` rather than depending on test-order.

- [ ] **Step 3: Record the two new divergences**

In `docs/design-system/V2-ADDENDUM.md`, extend the §7a table. Change its opening line from "Three known differences" to "Five known differences", and append two rows:

```markdown
| 4 | Team mutations are creator-only, enforced server-side | Phase 3 (`wt-ksh.4.6`) | v1's UI offers Settings, Invite and Delete only to the creator, but its RLS policy permits UPDATE to the creator **or any member** — including writes to `player_ids`, so any member can remove any other member through the API. v2 makes the UI's rule the real one via `requireTeamCreator`. No user sees a behaviour change; the rule stops being cosmetic |
| 5 | Membership and scoring changes recompute past winner rows | Phase 3 (`wt-ksh.4.9`, `wt-ksh.4.10`) | v1's `update_monthly_winners` is a trigger on `daily_scores`, so removing a player never fires it and they stay named as the winner of months they are no longer in. **Production is carrying stale rows today.** v2 recomputes every month the team has a winner row for |
```

Add below the table, alongside the existing "not divergences" notes:

```markdown
- **The scoring system is versioned by effective-from month.** Not a divergence:
  v2 had no reachable editor before Phase 3, so no v2 user has ever had a system
  rewritten in place. See `2026-08-19-v2-phase3-teams-design.md`.
- **The missed-day row is labelled "Missed day", not `0`.** `n_a` is a misnomer —
  v1's own card files it under "0 attempts" and it has nothing to do with the
  `N/A` shown for weekends. The schema field name is unchanged.
- **A team whose creator was not copied cannot be edited by anyone.** A property
  of the scoped copy, not of the permission rule.
```

- [ ] **Step 4: Deploy to beta — OWNER ACTION, NOT A SUBAGENT'S**

**STOP. Do not run this as a subagent, and do not run it without the owner
saying so in this session.** `beta` is the deployment that *becomes production*
at cutover (parent design, "Repo Layout & Environments"), so a `convex deploy`
here writes the schema and functions that real users will land on. Every other
schema push in this plan goes to your personal **dev** deployment via
`convex dev --once`; this is the only step that leaves it, and it is the owner's
call, made once, deliberately.

```bash
cd v2 && pnpm exec convex deploy && pnpm run deploy
```

Expected: both succeed. Confirm the beta URL loads and you are signed in.

- [ ] **Step 5: Verify the phase done-when on beta, side by side with prod**

Open prod and beta beside each other on a **real phone**, signed in as the same account, and walk:

- The team dropdown lists the same teams in the same order.
- The CurrentTeam card lists the same members.
- MyTeams lists the same teams with the same members.
- The Scoring System card shows the same eight values for the current month.
- Create a throwaway team on beta; it appears in both cards and becomes selected.
- Rename it, flip both switches, delete it.

Anything that differs and is not divergence 1–5 is a bug — file it.

- [ ] **Step 6: Verify `wt-ksh.4.1` — the deferred Phase 2 criterion**

This needs **two browsers and two different signed-in players on one team**, which is exactly what this phase makes possible. Add a second copied account to a team on beta (via the Convex dashboard's `playerIds` if the invite flow — Phase 4 — is needed to do it in-app).

1. Browser A: signed in as player 1, dashboard open on the shared team's current month.
2. Browser B: signed in as player 2, same team, same month, **do not touch it**.
3. In A, enter a board.
4. In B, **without refreshing and without interacting**, the cell fills in, the total updates and the row order re-sorts.

This proves the subscription pushes to other connected clients, which the Phase 2 single-browser check could not. Nothing in the repo covers it and nothing can.

- [ ] **Step 7: Close the phase in Beads and commit**

```bash
cd .. && git add v2/e2e/teams.spec.ts docs/design-system/V2-ADDENDUM.md
git commit -m "test(v2): team-creation e2e, and record divergences 4 and 5 (wt-ksh.4.31)"

bd close wt-ksh.4.1 wordle-teams-4gj wordle-teams-lb9 wordle-teams-1j3
bd close wt-ksh.4
git pull --rebase && bd dolt push && git push && git status
```

`git status` must read "up to date with origin". Work is not complete until the push succeeds.

---

## Notes for whoever executes this

**The three tasks most likely to go wrong, and why:**

1. **Task 8.** It touches the read path and the write path in one commit, and getting only half of it right produces a system that looks correct until someone views a past month. The end-to-end test in Step 1 — invert the scoring system, assert last month's winner is unchanged — is the one that actually proves the feature. Do not let it be weakened into a shallower assertion.
2. **Task 11's delete-the-selected-team path.** No automated test covers it, and the failure mode is the route error boundary rather than a toast, because `?team=` still points at a deleted id. Step 5 exercises it by hand for that reason.
3. **Every UI task.** `vite build`, `tsc --noEmit` and the full suite were all green in Phase 2 while ~80 component selectors were dead, and again while the pinned columns drifted under a real touch drag. Tailwind emits nothing for a selector that cannot match, and no part of the toolchain looks at a rendered pixel. **Screenshot, in both themes, on a touch-emulating viewport, before calling any UI task done.**

**Plan task number → Beads issue.** The commit messages already carry these; this
is the lookup if you need `bd show`.

| Plan task | Beads | Plan task | Beads |
|---|---|---|---|
| Task 0 | `wt-ksh.4.17` | Task 8 | `wt-ksh.4.25` |
| Task 1 | `wt-ksh.4.18` | Task 9 | `wt-ksh.4.26` |
| Task 2 | `wt-ksh.4.19` | Task 10 | `wt-ksh.4.27` |
| Task 3 | `wt-ksh.4.20` | Task 11 | `wt-ksh.4.28` |
| Task 4 | `wt-ksh.4.21` | Task 12 | `wt-ksh.4.29` |
| Task 5 | `wt-ksh.4.22` | Task 13 | `wt-ksh.4.30` |
| Task 6 | `wt-ksh.4.23` | Task 14 | `wt-ksh.4.31` |
| Task 7 | `wt-ksh.4.24` | | |

**If `pnpm e2e` fails on a task that did not touch routes,** it is more likely a stale dev server on port 3001 than a regression — `lsof -ti :3000` and kill strays first.
