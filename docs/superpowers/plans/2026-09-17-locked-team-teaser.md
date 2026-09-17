# Locked Team Teaser Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Give a free member of a team a second card on `/insights` showing the real shape of the paid team panel with every figure redacted, one real headline, and one call to action.

**Architecture:** `teamRank` stops returning a nullable pair and returns a tagged value, because the browser can no longer tell *why* a rank is missing — the per-member totals it would need were withheld by wordle-teams-iht.3. `teamMonth` returns that tag to free viewers. A new presentational component renders it. No new query and no new document read: the free branch already issues `teamMonth` and this reads the same response.

**Tech Stack:** Convex (queries, `convex-test`), TanStack Start + React, Tailwind v4, vitest (`edge-runtime` by default, `jsdom` for `*.hook.test.ts`), Playwright.

**Spec:** `docs/superpowers/specs/2026-09-17-locked-team-teaser-design.md`

---

## Working agreements for this plan

- **Branch:** work on `feat/v2-replatform` directly. This project pushes that branch and deploys to beta from it; no worktree.
- **Four gates after every task:** `pnpm typecheck`, `pnpm lint`, `pnpm test:once`, `pnpm build`. All from `v2/`.
- **e2e is a deploy gate here** and does not run in the four gates. Tasks 2, 4 and 5 change what a real session sees; run `pnpm e2e` at the end of Task 5. It needs the local Convex backend — see Task 5, Step 9.
- **Do not use `--no-verify`.** The pre-commit hook runs a PII scan and a beads export.
- **`bd` writes lag one commit.** After `bd close`, check `git status` and commit `.beads/issues.jsonl` again if it changed.

## File structure

| File | Change | Responsibility |
|---|---|---|
| `convex/lib/teamStats.ts` | modify | `TeamRankTeaser` type; `teamRank` returns it |
| `convex/lib/teamStats.test.ts` | modify | the five ranking rules, unchanged in behaviour |
| `convex/insights.ts` | modify | resolve the tag, including the solo and missing-aggregate cases |
| `convex/insights.test.ts` | modify | one response-level case per tag |
| `src/components/insights/team-locked-card.tsx` | **create** | renders the locked card. Decides nothing about tiers |
| `src/components/insights/team-locked-card.hook.test.ts` | **create** | one case per state, plus the no-digits rule |
| `src/components/insights/team-section.tsx` | modify | render the card on the existing free branch |
| `src/components/insights/team-section.hook.test.ts` | modify | card renders free, never pro |
| `src/routes/insights.tsx` | modify | supply `onUpgrade` and `onInvite` |
| `src/components/insights/daily-team-fact.tsx` | modify | remove the dead "See the full month" affordance |
| `src/components/insights/daily-team-fact.hook.test.ts` | modify | drop the tests for it |
| `e2e/team-insights.spec.ts` | modify | move the assertion onto the locked card |

### One scope decision the spec left implicit

The spec's §2 diagram shows **two** sections — Head to head and Averages — not the paid panel's four. Build exactly two. The other two paid sections (Best & worst days, Consistency) have no per-teammate row to put a real name in, so they would render as bare labels with a redacted bar, which is the "section list" treatment the owner explicitly rejected. If they are wanted later that is a follow-up, not a judgement call to make mid-task.

---

## Task 1: `teamRank` returns a tagged value

**Files:**
- Modify: `convex/lib/teamStats.ts` (the `teamRank` function and its doc comment)
- Test: `convex/lib/teamStats.test.ts`

**Why the existing tests matter:** the five ranking rules below were mutation-tested in wordle-teams-iht.3.3. Only the *shape* of the return changes. **If any assertion about ranking has to change to make a test pass, the change has altered behaviour and is wrong** — competition ranking, the denominator counting who played, and comparison on the rounded average all stay exactly as they are.

- [ ] **Step 1: Add the type, above `teamRank`**

In `convex/lib/teamStats.ts`, immediately before `export function teamRank`:

```ts
/**
 * Why the viewer has a standing, or why they do not.
 *
 * A TAG RATHER THAN A NULLABLE PAIR, because the free client cannot work the
 * reason out for itself any more (wordle-teams-iht.2). Since iht.3 it holds
 * identities and today's entry; "have I played this month" and "has anybody
 * else" are both facts about the per-member totals that the payload gate
 * deliberately withholds. The server knows, so the server says.
 *
 * IT LEAKS NOTHING NEW. Each tag is something the viewer can already establish:
 * they know whether they have played, the roster is on the dashboard, and
 * "nobody else has played" is visible in the scores table.
 *
 * `solo` IS NOT DECIDED HERE — see teamMonth. It is a fact about the ROSTER,
 * and this function only sees the aggregate, which can lag a roster change.
 */
export type TeamRankTeaser =
  | { kind: 'ranked'; rank: number; of: number }
  | { kind: 'not-played' }
  | { kind: 'nobody-else' }
  | { kind: 'solo' }
```

- [ ] **Step 2: Update the five existing ranking tests to the new shape**

In `convex/lib/teamStats.test.ts`, inside `describe('teamRank', ...)`, change only the expected values. The inputs and the rules they assert do not change:

```ts
// 'fewer attempts is better, and the reader is counted from the front'
expect(rank).toEqual({ kind: 'ranked', rank: 2, of: 3 })

// 'the denominator counts who PLAYED, not the roster'
expect(rank).toEqual({ kind: 'ranked', rank: 2, of: 2 })

// 'a viewer who has not played is absent, never last'
expect(teamRank([member('me', 0, 0), member('a', 10, 30)], 'me')).toEqual({
  kind: 'not-played',
})

// 'a lone player is absent rather than "1st of 1"' — BOTH assertions in it
expect(teamRank([member('me', 10, 35)], 'me')).toEqual({ kind: 'nobody-else' })
expect(teamRank([member('me', 10, 35), member('idle', 0, 0)], 'me')).toEqual({
  kind: 'nobody-else',
})

// 'a viewer who is not on the roster at all gets nothing'
expect(teamRank([member('a', 10, 30)], 'me')).toEqual({ kind: 'not-played' })

// ties > 'share a rank, COMPETITION style (1, 2, 2, 4) rather than dense'
expect(teamRank([best, tiedA, tiedB, me], 'a')).toEqual({ kind: 'ranked', rank: 2, of: 4 })
expect(teamRank([best, tiedA, tiedB, me], 'b')).toEqual({ kind: 'ranked', rank: 2, of: 4 })
expect(teamRank([best, tiedA, tiedB, me], 'me')).toEqual({ kind: 'ranked', rank: 4, of: 4 })

// ties > 'everyone level is 1st, not last'
expect(teamRank([member('me', 10, 30), member('a', 10, 30)], 'me')).toEqual({
  kind: 'ranked',
  rank: 1,
  of: 2,
})

// 'RANKS THE ROUNDED AVERAGE, the one the paid panel prints'
expect(rank).toEqual({ kind: 'ranked', rank: 1, of: 2 })
```

Note the two renames of meaning, both deliberate and both in the spec:
- A **lone player** was `null`; it is now `nobody-else`. The old test name says "absent rather than 1st of 1" — rename it to `'a lone player is nobody-else, never "1st of 1"'`.
- A viewer **not on the aggregate at all** was `null`; it is now `not-played`, because they have no boards this month.

- [ ] **Step 3: Add a test that distinguishes the two missing-rank reasons**

Append inside `describe('teamRank', ...)`:

```ts
  test('says WHY there is no rank, because the browser cannot work it out', () => {
    // THE WHOLE REASON THIS RETURNS A TAG. Both of these were `null` before, and
    // they need opposite sentences: one asks the reader for a board, the other
    // tells a diligent player their teammates have not shown up. Collapsing them
    // would blame the wrong person.
    expect(teamRank([member('me', 0, 0), member('a', 10, 30)], 'me')).toEqual({
      kind: 'not-played',
    })
    expect(teamRank([member('me', 10, 30), member('a', 0, 0)], 'me')).toEqual({
      kind: 'nobody-else',
    })
  })
```

- [ ] **Step 4: Run the tests and watch them fail**

Run: `cd v2 && npx vitest run convex/lib/teamStats.test.ts`
Expected: FAIL — `teamRank` still returns `{ rank, of } | null`, so every `toEqual` above mismatches.

- [ ] **Step 5: Change the implementation**

Replace the body of `teamRank` in `convex/lib/teamStats.ts`. The signature's return type changes; the ranking arithmetic is copied across untouched:

```ts
export function teamRank<PlayerId extends string>(
  members: MemberTotals<PlayerId>[],
  viewerId: PlayerId,
): TeamRankTeaser {
  const played = members
    .map((member) => ({ playerId: member.playerId, mean: meanAttemptsOf(member) }))
    .filter((member): member is { playerId: PlayerId; mean: number } => member.mean !== null)

  const mine = played.find((member) => member.playerId === viewerId)
  // THE ASK IS ON THEM. Also covers a viewer absent from the aggregate entirely,
  // which is the same thing from the reader's side: no boards this month.
  if (!mine) return { kind: 'not-played' }
  // THEY TURNED UP AND NOBODY ELSE DID. Not their fault, and the copy says so.
  if (played.length < 2) return { kind: 'nobody-else' }

  // Competition ranking: one plus however many are strictly better.
  const ahead = played.filter((member) => member.mean < mine.mean).length
  return { kind: 'ranked', rank: ahead + 1, of: played.length }
}
```

Also update the function's doc comment: the two `NULL RATHER THAN A FLATTERING ANSWER` bullets now describe tags rather than `null`. Keep both reasons — they are the product decisions, not implementation notes.

- [ ] **Step 6: Run the tests and watch them pass**

Run: `cd v2 && npx vitest run convex/lib/teamStats.test.ts`
Expected: PASS.

- [ ] **Step 7: Prove the two reasons cannot be collapsed**

Temporarily replace `if (!mine) return { kind: 'not-played' }` with `if (!mine) return { kind: 'nobody-else' }`, run the file, and confirm it FAILS. Restore.

Run: `cd v2 && npx vitest run convex/lib/teamStats.test.ts`
Expected after restore: PASS.

- [ ] **Step 8: Four gates**

Run each from `v2/`, expecting exit 0:
`pnpm typecheck` · `pnpm lint` · `pnpm test:once` · `pnpm build`

**`pnpm typecheck` stays GREEN here — it is `pnpm test:once` that fails.**
`convex/insights.ts` declares no `returns` validator, so `rank` is *inferred*
rather than annotated and there is nothing for the new shape to mismatch; nothing
in `src/` reads `data.rank` yet either. What breaks is `convex/insights.test.ts`,
whose two rank assertions still expect the old `{ rank, of }`. That is Task 2's
Step 1. **Fold Task 2 in before committing** rather than committing a red suite.

- [ ] **Step 9: Commit**

```bash
cd /home/cdub/projects/wordle-teams
git add v2/convex/lib/teamStats.ts v2/convex/lib/teamStats.test.ts
git commit -m "refactor(insights): teamRank says WHY there is no rank"
```

---

## Task 2: `teamMonth` resolves and returns the tag

**Files:**
- Modify: `convex/insights.ts:264` (the free branch's `rank`) and `:277` (the pro branch's)
- Test: `convex/insights.test.ts`

- [ ] **Step 1: Write the failing tests**

In `convex/insights.test.ts`, replace the existing free-tier rank assertion (in `test('gets the rank headline, which is the one real figure it gains')`):

```ts
    expect(res?.rank).toEqual({ kind: 'ranked', rank: 1, of: 2 })
```

**That test has a SECOND assertion two lines below, and it also changes.** It reads
`expect(Object.keys(res?.rank ?? {}).sort()).toEqual(['of', 'rank'])` — the tag adds
a key, so it becomes:

```ts
    expect(Object.keys(res?.rank ?? {}).sort()).toEqual(['kind', 'of', 'rank'])
```

and the pro assertion in `describe('teamMonth — pro', ...)` stays as it is (`expect(res?.rank).toBeNull()`).

Then append a new describe block at the end of the file:

```ts
describe('teamMonth — why there is no rank', () => {
  test('a solo team is solo, decided from the ROSTER not the aggregate', async () => {
    // THE AGGREGATE CAN LAG THE ROSTER. teamMonthStats.members is written at
    // rollup time, so a member who joined since the last rollup is missing from
    // it — and "how many people are on this team" is a question about the team,
    // not about who has played. Decided from team.playerIds for that reason.
    const t = convexTest(schema, modules)
    registerBetterAuth(t)
    const teamId = await t.run(async (ctx) => {
      const me = await ctx.db.insert('players', aPlayer({ email: ME }))
      return await ctx.db.insert('teams', aTeam({ playerIds: [me], owner: me }))
    })

    const asMe = await authenticatedAs(t, ME)
    const res = await asMe.query(api.insights.teamMonth, { teamId, month, today })

    expect(res?.rank).toEqual({ kind: 'solo' })
  })

  test('a month nobody has played at all is not-played, not nobody-else', async () => {
    // No teamMonthStats document exists for the month. The viewer has no boards
    // in it either, so the ask is genuinely on them.
    const t = convexTest(schema, modules)
    registerBetterAuth(t)
    const teamId = await t.run(async (ctx) => {
      const me = await ctx.db.insert('players', aPlayer({ email: ME }))
      const mate = await ctx.db.insert(
        'players',
        aPlayer({
          legacyId: '44444444-4444-4444-8444-444444444444',
          email: MATE,
          firstName: 'Grace',
        }),
      )
      return await ctx.db.insert('teams', aTeam({ playerIds: [me, mate], owner: me }))
    })

    const asMe = await authenticatedAs(t, ME)
    const res = await asMe.query(api.insights.teamMonth, { teamId, month, today })

    expect(res?.teaser).toBeNull()
    expect(res?.rank).toEqual({ kind: 'not-played' })
  })
})
```

- [ ] **Step 2: Run them and watch them fail**

Run: `cd v2 && npx vitest run convex/insights.test.ts`
Expected: FAIL — the two new tests get `null` where they expect a tag. Note the
`ranked` case now **passes** already: Task 1 changed `teamRank` and `insights.ts`
calls it unchanged, so that assertion went green one task ago. Only the two new
cases and the `Object.keys` line above are red here.

- [ ] **Step 3: Resolve the tag in the query**

In `convex/insights.ts`, replace line 264 (`rank: stats ? teamRank(stats.members, player._id) : null,`) with:

```ts
        /*
          THE ONE REAL FIGURE THE FREE TIER GAINS (wordle-teams-iht.3.3), now
          carrying its own reason when there is no figure (wordle-teams-iht.2).

          `solo` IS DECIDED FROM THE ROSTER, NOT THE AGGREGATE, and the two can
          disagree: teamMonthStats.members is written at rollup time, so a
          teammate who joined since the last rollup is absent from it. "Is this
          a team of one" is a question about the team.

          A MISSING AGGREGATE IS `not-played` rather than `nobody-else`. Nobody
          has played the month, the viewer included, so the ask is on them.
        */
        rank:
          roster.length < 2
            ? ({ kind: 'solo' } as const)
            : stats
              ? teamRank(stats.members, player._id)
              : ({ kind: 'not-played' } as const),
```

Leave line 277's `rank: null` on the pro branch exactly as it is — pro and trial have the real panel and need no teaser.

- [ ] **Step 4: Run them and watch them pass**

Run: `cd v2 && npx vitest run convex/insights.test.ts`
Expected: PASS, 11 tests.

- [ ] **Step 5: Prove the roster decides solo**

Temporarily change `roster.length < 2` to `stats !== null && stats.members.length < 2`, run the file, and confirm the solo test FAILS (that team has no aggregate, so it falls through to `not-played`). Restore.

- [ ] **Step 6: Four gates, then commit**

```bash
cd /home/cdub/projects/wordle-teams
git add v2/convex/insights.ts v2/convex/insights.test.ts
git commit -m "feat(insights): teamMonth tells the free tier why it has no rank"
```

---

## Task 3: The locked card component

**Files:**
- Create: `src/components/insights/team-locked-card.tsx`
- Test: `src/components/insights/team-locked-card.hook.test.ts`

Presentational only. It takes what it renders, calls no hooks, and decides nothing about tiers.

**The reason is `onInvite`, not `onUpgrade`.** A component may perfectly well call
`useStartUpgrade` — three do today (`Header.tsx:76`, `trial-ended-card.tsx:21`,
`board-entry/import-upsell.tsx:24`, the last recording the convention outright as
"ONE MORE CALLER OF useStartUpgrade"). What cannot be done bare is `useNavigate`,
which `onInvite` needs: without a `RouterProvider` it throws, and every component
test in this directory renders its component bare. Both callbacks are props so the
pair stays symmetrical.

- [ ] **Step 1: Write the failing test**

Create `src/components/insights/team-locked-card.hook.test.ts`:

```ts
// @vitest-environment jsdom
//
// jsdom and `.hook.test.ts` with createElement, matching every other component
// test here — vitest.config.ts's glob is `src/**/*.test.ts`, so .tsx would not run.
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { createElement } from 'react'
import { afterEach, describe, expect, test, vi } from 'vitest'
import { TeamLockedCard } from './team-locked-card.tsx'
import type { TeamRankTeaser } from '../../../convex/lib/teamStats.ts'

afterEach(cleanup)

const ROSTER = [
  { playerId: 'me', firstName: 'Ada', lastName: 'Lovelace' },
  { playerId: 'a', firstName: 'Grace', lastName: 'Hopper' },
  { playerId: 'b', firstName: 'Alan', lastName: 'Turing' },
]

const card = (rank: TeamRankTeaser, over: { roster?: typeof ROSTER } = {}) =>
  render(
    createElement(TeamLockedCard, {
      teamName: 'Alpha Analysts',
      month: '2026-09',
      roster: over.roster ?? ROSTER,
      viewerId: 'me',
      rank,
      onUpgrade: vi.fn(),
      onInvite: vi.fn(),
    }),
  )

describe('the headline says what would make the numbers appear', () => {
  test('ranked: the standing itself', () => {
    card({ kind: 'ranked', rank: 3, of: 5 })
    // A TYPOGRAPHIC APOSTROPHE, matching every other shipped string here —
    // daily-team-fact.tsx's "Enter today’s board to see how you compare." and
    // the e2e assertions that match on it.
    expect(screen.getByTestId('insights-locked-headline').textContent).toBe(
      'You’re 3rd of 5 this month',
    )
  })

  test('ranked: the ordinal is right at 1, 2, 3 and beyond', () => {
    // `ordinal` is lib/format-day.ts's, NOT a local copy — that helper already
    // exists and already handles the teens. This stays as a CALL-SITE check
    // (that the headline uses it at all), not a second test of the helper.
    for (const [rank, expected] of [
      [1, '1st'],
      [2, '2nd'],
      [3, '3rd'],
      [4, '4th'],
      [11, '11th'],
      [21, '21st'],
    ] as const) {
      cleanup()
      card({ kind: 'ranked', rank, of: 30 })
      expect(screen.getByTestId('insights-locked-headline').textContent).toContain(expected)
    }
  })

  test('not-played: asks the reader for a board', () => {
    card({ kind: 'not-played' })
    const text = screen.getByTestId('insights-locked-headline').textContent ?? ''
    expect(text).toContain('See where you rank')
    expect(screen.getByTestId('insights-locked-note').textContent).toContain('Enter a board')
  })

  test('nobody-else: does NOT blame the reader', () => {
    // A diligent player whose teammates have not shown up. The two missing-rank
    // states exist as separate tags precisely so this sentence is not the one
    // above (wordle-teams-iht.2).
    card({ kind: 'nobody-else' })
    const text = screen.getByTestId('insights-locked-headline').textContent ?? ''
    expect(text).toContain('only one playing')
    expect(screen.getByTestId('insights-locked-note').textContent).toContain('teammates')
  })

  test('solo: names the missing thing as a team', () => {
    card({ kind: 'solo' }, { roster: [ROSTER[0]!] })
    expect(screen.getByTestId('insights-locked-headline').textContent).toContain(
      'Team insights need a team',
    )
  })
})

describe('the rows', () => {
  test('carry the real teammates, and never the viewer, in head to head', () => {
    card({ kind: 'ranked', rank: 3, of: 5 })
    const rows = screen.getByTestId('insights-locked-h2h')
    expect(rows.textContent).toContain('Grace Hopper')
    expect(rows.textContent).toContain('Alan Turing')
    // You do not play yourself.
    expect(rows.textContent).not.toContain('Ada Lovelace')
  })

  test('a solo team gets a generic row instead, since there are no names', () => {
    card({ kind: 'solo' }, { roster: [ROSTER[0]!] })
    expect(screen.getByTestId('insights-locked-h2h').textContent).toContain('Your teammates')
  })

  test('NO DIGIT EVER APPEARS IN A REDACTED SLOT', () => {
    // THE REGRESSION TEST FOR THE WHOLE DESIGN. The figures do not reach the
    // client at all since wordle-teams-iht.3, so anything numeric in a value
    // slot is necessarily invented — which is the "invented team's head-to-head"
    // this feature exists to avoid. Scoped to the slots, not the card: the
    // ranked headline legitimately contains "3rd of 5".
    card({ kind: 'ranked', rank: 3, of: 5 })
    for (const slot of screen.getAllByTestId('insights-locked-value')) {
      expect(slot.textContent ?? '').not.toMatch(/\d/)
    }
  })

  test('every redacted slot says something to a screen reader', () => {
    // A grey bar conveys nothing without sight. Each slot carries its own
    // sr-only label naming what is hidden.
    card({ kind: 'ranked', rank: 3, of: 5 })
    const slots = screen.getAllByTestId('insights-locked-value')
    expect(slots.length).toBeGreaterThan(0)
    for (const slot of slots) {
      expect((slot.textContent ?? '').trim().length).toBeGreaterThan(0)
    }
  })
})

describe('the call to action', () => {
  test('offers the upgrade in the three states where it would deliver', () => {
    for (const rank of [
      { kind: 'ranked', rank: 3, of: 5 },
      { kind: 'not-played' },
      { kind: 'nobody-else' },
    ] as TeamRankTeaser[]) {
      cleanup()
      const onUpgrade = vi.fn()
      render(
        createElement(TeamLockedCard, {
          teamName: 'Alpha Analysts',
          month: '2026-09',
          roster: ROSTER,
          viewerId: 'me',
          rank,
          onUpgrade,
          onInvite: vi.fn(),
        }),
      )
      fireEvent.click(screen.getByTestId('insights-locked-cta'))
      expect(onUpgrade).toHaveBeenCalledOnce()
      expect(screen.queryByTestId('insights-locked-cta')!.textContent).toContain('Unlock')
    }
  })

  test('but asks a SOLO team to invite instead, because upgrading buys them nothing', () => {
    // team-panel.tsx tells a solo player outright that there is "nobody to
    // compare with". Selling the upgrade here would be selling a dud.
    const onUpgrade = vi.fn()
    const onInvite = vi.fn()
    render(
      createElement(TeamLockedCard, {
        teamName: 'Alpha Analysts',
        month: '2026-09' as const,
        roster: [ROSTER[0]!],
        viewerId: 'me',
        rank: { kind: 'solo' },
        onUpgrade,
        onInvite,
      }),
    )
    const cta = screen.getByTestId('insights-locked-cta')
    expect(cta.textContent).toContain('Invite')
    fireEvent.click(cta)
    expect(onInvite).toHaveBeenCalledOnce()
    expect(onUpgrade).not.toHaveBeenCalled()
  })
})

describe('the card frame', () => {
  test('gives the region a heading, as every sibling card does', () => {
    card({ kind: 'ranked', rank: 3, of: 5 })
    expect(screen.getByRole('heading', { level: 2 }).textContent).toContain('Alpha Analysts')
  })

  test('names the team and the month', () => {
    card({ kind: 'ranked', rank: 3, of: 5 })
    const head = screen.getByTestId('insights-locked-scope').textContent ?? ''
    expect(head).toContain('Alpha Analysts')
    // "Sep 2026", NOT "September". format-day.ts's formatMonthLabel is a
    // `{ month: 'short', year: 'numeric' }` formatter, and daily-benchmark and
    // trend-panel already render months that way — matching them matters more
    // than the longer word.
    expect(head).toContain('Sep 2026')
  })
})
```

- [ ] **Step 2: Run it and watch it fail**

Run: `cd v2 && npx vitest run src/components/insights/team-locked-card.hook.test.ts`
Expected: FAIL — `Failed to resolve import "./team-locked-card.tsx"`.

- [ ] **Step 3: Write the component**

Create `src/components/insights/team-locked-card.tsx`:

```tsx
import { Button } from '#/components/ui/button.tsx'
import { Card, CardContent, CardHeader, CardTitle } from '#/components/ui/card.tsx'
import { formatMonthLabel, ordinal } from '#/lib/format-day.ts'
import type { PuzzleMonth } from '../../../convex/lib/puzzleDay.ts'
import type { TeamRankTeaser } from '../../../convex/lib/teamStats.ts'

/**
 * What a FREE member of a team is shown beneath their daily fact: the real shape
 * of the paid panel, with every figure redacted.
 *
 * REDACTED RATHER THAN BLURRED, AND THE DIFFERENCE IS NOT COSMETIC. The original
 * brief (wordle-teams-iht.2) asked for the real panel with its numbers blurred.
 * That assumed the numbers were on the client and merely hidden. Since
 * wordle-teams-iht.3 they are not sent at all — so a blur here would be blurring
 * fiction, which is the "invented team's head-to-head" that issue rejected,
 * wearing the viewer's own team's name. A redacted bar is the honest rendering
 * of a value that genuinely is not here.
 *
 * IT IS THE SHAPE OF THE THING BEING BOUGHT, which is why this beat a list of
 * section names with padlocks: after upgrading, the bars become numbers and
 * nothing else on the card moves.
 *
 * IT ALWAYS RENDERS, and only the headline changes. The owner's reason overrides
 * the tidier rule of hiding it when there is no rank: the players with too little
 * engagement to be ranked are the ones most at risk of never getting there, so
 * they are exactly the ones who need to see what is possible.
 *
 * PRESENTATIONAL ONLY. It calls no hooks and knows nothing about tiers —
 * team-section.tsx decides whether it renders at all.
 *
 * THE CALLBACKS ARE PROPS BECAUSE OF `onInvite`, NOT `onUpgrade`. Calling
 * useStartUpgrade in a component is fine and three components do it. useNavigate
 * is the one that cannot: without a RouterProvider it throws, and every component
 * test in this directory renders its component bare. Taking both as props keeps
 * the pair symmetrical.
 */
export function TeamLockedCard({
  teamName,
  month,
  roster,
  viewerId,
  rank,
  onUpgrade,
  onInvite,
}: {
  teamName: string
  month: PuzzleMonth
  roster: { playerId: string; firstName: string; lastName: string }[]
  viewerId: string
  /**
   * §3's tagged value, NEVER null here: this card renders only on the free
   * branch, and `null` is the pro/trial case that branch cannot reach.
   */
  rank: TeamRankTeaser
  onUpgrade: () => void
  onInvite: () => void
}) {
  const solo = rank.kind === 'solo'
  const headline = headlineFor(rank)
  const teammates = roster.filter((member) => member.playerId !== viewerId)

  return (
    <Card data-testid="insights-team-locked">
      <CardHeader className="pb-2">
        {/*
          A REAL <h2>, NOT A <p> (review finding). Every sibling card carries
          one — daily-team-fact.tsx and team-panel.tsx both give theirs an `h2`
          so the region has a name to navigate to, which is the defect
          wordle-teams-4b0m fixed on the card directly above this one. Here the
          scope line is already visible and already names the team, so it BECOMES
          the heading rather than an sr-only duplicate of itself.
        */}
        <CardTitle asChild className="text-muted-foreground text-xs font-normal">
          <h2 data-testid="insights-locked-scope">
            {teamName} · {formatMonthLabel(month)}
          </h2>
        </CardTitle>
        <p className="m-0 text-base font-semibold" data-testid="insights-locked-headline">
          {headline.title}
        </p>
        {headline.note && (
          <p className="text-muted-foreground m-0 text-xs" data-testid="insights-locked-note">
            {headline.note}
          </p>
        )}
      </CardHeader>

      <CardContent className="space-y-4 text-sm">
        <div data-testid="insights-locked-h2h">
          <h3 className="mb-1 font-medium">Head to head</h3>
          <ul className="m-0 list-none space-y-1 p-0">
            {solo || teammates.length === 0 ? (
              <LockedRow label="Your teammates" hidden="your record against each teammate" />
            ) : (
              teammates.map((member) => (
                <LockedRow
                  key={member.playerId}
                  label={`${member.firstName} ${member.lastName}`}
                  hidden={`your record against ${member.firstName}`}
                />
              ))
            )}
          </ul>
        </div>

        <div data-testid="insights-locked-averages">
          <h3 className="mb-1 font-medium">Averages</h3>
          <ul className="m-0 list-none space-y-1 p-0">
            <LockedRow label="You vs team" hidden="your average and the team's" />
          </ul>
        </div>

        <Button
          className="w-full"
          variant={solo ? 'outline' : 'default'}
          onClick={solo ? onInvite : onUpgrade}
          data-testid="insights-locked-cta"
        >
          {solo ? 'Invite a teammate' : 'Unlock team insights'}
        </Button>
      </CardContent>
    </Card>
  )
}

/**
 * One row: a real label, and a bar where the number is not.
 *
 * `hidden` IS NOT DECORATION. A grey bar conveys nothing without sight, so each
 * slot carries an sr-only sentence naming what is being withheld. The bar itself
 * is aria-hidden so a screen reader gets the sentence and not both.
 *
 * NOT `ui/skeleton.tsx`, WHICH WOULD BE THE OBVIOUS REACH. Skeleton is
 * `animate-pulse`: a shimmer reads as "this is loading and will arrive in a
 * moment", which is the opposite of what is true here.
 */
function LockedRow({ label, hidden }: { label: string; hidden: string }) {
  return (
    <li className="flex items-center justify-between gap-2">
      <span className="text-muted-foreground">{label}</span>
      <span data-testid="insights-locked-value">
        <span className="sr-only">{hidden} — hidden until you upgrade</span>
        <span aria-hidden className="bg-muted inline-block h-3 w-16 rounded" />
      </span>
    </li>
  )
}

/**
 * The one line that changes, and it changes to say what would make the numbers
 * appear rather than merely that they are missing.
 *
 * `not-played` AND `nobody-else` ARE DELIBERATELY DIFFERENT SENTENCES. One asks
 * the reader for something; the other tells them it is not their fault.
 * Collapsing them would blame a diligent player for their teammates' silence,
 * and separating them is the entire reason teamRank returns a tag.
 */
function headlineFor(rank: TeamRankTeaser): { title: string; note?: string } {
  switch (rank.kind) {
    case 'ranked':
      return { title: `You’re ${ordinal(rank.rank)} of ${rank.of} this month` }
    case 'not-played':
      return {
        title: 'See where you rank this month',
        note: 'Enter a board and you’ll have a standing.',
      }
    case 'nobody-else':
      return {
        title: 'You’re the only one playing so far',
        note: 'When your teammates join in, you’ll have a standing.',
      }
    case 'solo':
      return {
        title: 'Team insights need a team',
        note: 'Invite someone and this fills in.',
      }
  }
}
```

- [ ] **Step 4: Run it and watch it pass**

Run: `cd v2 && npx vitest run src/components/insights/team-locked-card.hook.test.ts`
Expected: PASS.

- [ ] **Step 5: Prove the no-digit rule can fail**

Temporarily change `LockedRow`'s bar span to `<span aria-hidden>3.4</span>`, run the file, confirm `NO DIGIT EVER APPEARS IN A REDACTED SLOT` FAILS. Restore and re-run to PASS.

- [ ] **Step 6: Four gates, then commit**

```bash
cd /home/cdub/projects/wordle-teams
git add v2/src/components/insights/team-locked-card.tsx v2/src/components/insights/team-locked-card.hook.test.ts
git commit -m "feat(insights): the locked team card"
```

---

## Task 4: Render it on the free branch

**Files:**
- Modify: `src/components/insights/team-section.tsx` (props, and the free-branch return)
- Modify: `src/routes/insights.tsx` (supply the two callbacks)
- Test: `src/components/insights/team-section.hook.test.ts`

- [ ] **Step 1: Write the failing test**

In `src/components/insights/team-section.hook.test.ts`, the `section()` helper must now pass the two callbacks. Add them to the `createElement(TeamSection, {...})` call:

```ts
      onUpgrade: vi.fn(),
      onInvite: vi.fn(),
```

**Two more call sites bypass that helper entirely and will fail typecheck
otherwise** (`TS2345`, missing properties), both inside `describe('Layer 3 tells
"no team" and "not resolved yet" apart, on the page')`:

- `team-section.hook.test.ts:519` and `:538` — each is a bare
  `createElement(TeamSection, { layer3, teams, team, month, onTeamChange,
  onMonthChange })`. Add to **both** object literals:

```ts
        onUpgrade: () => undefined,
        onInvite: () => undefined,
```

Then append a new describe block:

```ts
describe('the locked card', () => {
  test('renders for a free viewer, beneath the daily fact', () => {
    section({ layer3: 'free', teamCount: 2 })
    const fact = screen.getByTestId('insights-daily-fact')
    const locked = screen.getByTestId('insights-team-locked')
    // Node.compareDocumentPosition: 4 means `locked` FOLLOWS `fact`. The order is
    // the design — what you have above, what you do not have below.
    expect(fact.compareDocumentPosition(locked) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy()
  })

  test('and NEVER for pro, who already has the real panel', () => {
    section({ layer3: 'full', teamCount: 2 })
    expect(screen.queryByTestId('insights-team-locked')).toBeNull()
    expect(screen.queryByTestId('insights-team')).not.toBeNull()
  })
})
```

The fixture's `answerFor` already returns `teamMonth`/`pastTeamMonth`; add a `rank` to both so the free branch has one to render. In `src/components/insights/team-section.hook.test.ts`, inside the free branch of `answerFor`, add `rank: { kind: 'solo' } as const` alongside `teaser`, and `rank: null` alongside the pro branch's `stats`.

`solo` rather than a `ranked` tag, because that fixture's `roster` holds one
member — `'ranked'` would contradict it, and `{ rank: 1, of: 1 }` is not a value
`teamRank` can produce at all (it returns `nobody-else` there). A fixture that
cannot occur is how a component gets tested against a state it will never see.

- [ ] **Step 2: Run it and watch it fail**

Run: `cd v2 && npx vitest run src/components/insights/team-section.hook.test.ts`
Expected: FAIL — `insights-team-locked` is not in the document.

- [ ] **Step 3: Take the callbacks as props**

In `src/components/insights/team-section.tsx`, add to the props object and its type:

```ts
  onUpgrade,
  onInvite,
```

```ts
  /**
   * Straight to checkout, for now. wordle-teams-iht.2 says this should route
   * through iht.1's interstitial instead, and it will — that issue's whole
   * premise is one shared component behind one call site, so it re-points every
   * caller including this one. Wiring it now is what makes the card shippable
   * before that conversation has happened.
   */
  onUpgrade: () => void
  /** Only reachable from a solo team's card. See TeamLockedCard on why. */
  onInvite: () => void
```

- [ ] **Step 4: Render it on the free branch**

Import it:

```ts
import { TeamLockedCard } from '#/components/insights/team-locked-card.tsx'
```

Then in the `if (!hasFullTeamMonth(layer3))` branch, wrap the existing `<DailyTeamFact …/>` return in a fragment and add the card beneath it:

**Do not retype the `<DailyTeamFact …/>` element.** Leave its five props and
their comments exactly as they are — they carry reasoning this task has no
business editing. Wrap the existing element in a fragment and add the card after
it, so the change is two opening lines, two closing lines, and the new element:

```tsx
    return (
      <>
        <DailyTeamFact … />   {/* unchanged, in place */}
        {/*
          BENEATH THE FACT, NEVER MERGED INTO IT (wordle-teams-iht.2). The line
          between "what you have" and "what you don't have but would" is the
          owner's stated reason for two cards rather than one grown card.

          `monthOf(today)` RATHER THAN `queryMonth`. `PuzzleMonth` is a bare
          alias for `string`, so the type is not the obstacle — the `| undefined`
          is: TeamSection's `month` prop is `string | undefined` and `queryMonth`
          inherits it. And on this branch `queryMonth` IS `monthOf(today)`
          already (see its own note above), because the free card is always about
          the current month. Saying so directly drops the undefined and states
          the fact rather than re-deriving it.

          `data.rank` IS NON-NULL ON THIS BRANCH by construction: teamMonth
          returns the tag for exactly the tier this branch serves, and `null`
          only for pro and trial. The fallback keeps the types honest without
          inventing a state — a viewer who somehow arrives here without one is
          told the truth, that there is nothing to rank yet.
        */}
        <TeamLockedCard
          teamName={team.name}
          month={monthOf(today)}
          roster={data.roster}
          viewerId={data.viewerId}
          rank={data.rank ?? { kind: 'not-played' }}
          onUpgrade={onUpgrade}
          onInvite={onInvite}
        />
      </>
    )
```

- [ ] **Step 5: Supply the callbacks from the route**

In `src/routes/insights.tsx`, add the import:

```ts
import { useStartUpgrade } from '#/lib/use-start-upgrade.ts'
```

Next to the existing `const navigate = useNavigate({ from: Route.fullPath })` (line 115), add:

```ts
  const { startUpgrade } = useStartUpgrade()
```

And on the `<TeamSection …>` element, add:

```tsx
                onUpgrade={() => void startUpgrade()}
                onInvite={() =>
                  void navigate({ to: '/team', search: { team: teamParam } })
                }
```

- [ ] **Step 6: Run the tests and watch them pass**

Run: `cd v2 && npx vitest run src/components/insights/team-section.hook.test.ts`
Expected: PASS.

- [ ] **Step 7: Four gates, then commit**

```bash
cd /home/cdub/projects/wordle-teams
git add v2/src/components/insights/team-section.tsx v2/src/components/insights/team-section.hook.test.ts v2/src/routes/insights.tsx
git commit -m "feat(insights): show the locked card to free members of a team"
```

---

## Task 5: Remove the dead "See the full month" affordance

**Files:**
- Modify: `src/components/insights/daily-team-fact.tsx`
- Modify: `src/components/insights/daily-team-fact.hook.test.ts`
- Modify: `e2e/team-insights.spec.ts:357`

**What this is.** `daily-team-fact.tsx` renders a "See the full month →" button whenever `fact.kind === 'beat'`, and `team-section.tsx` has never passed `onSeeFullMonth`. It renders with `onClick={undefined}` and does nothing when clicked. That was a deliberate deferral, not an oversight — the component test says so outright: *"The affordance is what this task owes; the destination belongs to wordle-teams-iht."* This issue is that destination, and it answered the question differently: the locked card sits directly beneath and shows the full month, locked. The link is now redundant, and keeping it would put two competing calls to action in one region.

**It is last on purpose.** Removing it before Task 4 would leave `e2e/team-insights.spec.ts:357` red — that spec asserts the button is visible — with nothing to replace the assertion with.

- [ ] **Step 1: Delete the button**

In `src/components/insights/daily-team-fact.tsx`, remove this block from `CardContent`:

```tsx
        {fact.kind === 'beat' && (
          <button
            type="button"
            className="text-muted-foreground underline"
            onClick={onSeeFullMonth}
            data-testid="insights-see-full-month"
          >
            See the full month →
          </button>
        )}
```

- [ ] **Step 2: Delete the prop**

Remove `onSeeFullMonth,` from the destructured parameters and `onSeeFullMonth?: () => void` from the props type. If `CardContent`'s `space-y-2` now wraps a single `<p>`, leave it — it costs nothing and the card may gain content again.

- [ ] **Step 3: Update the component test**

In `src/components/insights/daily-team-fact.hook.test.ts`:

1. Remove `onSeeFullMonth?: () => void,` from the `fact` helper's signature (it is the **second positional parameter**) and `onSeeFullMonth,` from its `createElement` call.
2. Fix the **six call sites that pass a positional second argument** — they will silently shift `teamName` into the removed slot otherwise, and the four-argument ones fail typecheck outright (`TS2554: Expected 1-3 arguments, but got 4`):
   - `:146` `fact(statsOf({ a: 4 }, ['me', 'a']), undefined, undefined, aDropdown)` → `fact(statsOf({ a: 4 }, ['me', 'a']), undefined, aDropdown)`
   - `:159` `fact(null, undefined, undefined, aDropdown)` → `fact(null, undefined, aDropdown)`
   - `:166` `fact(statsOf({ a: 4 }, ['me', 'a']), vi.fn(), undefined, aDropdown)` → `fact(statsOf({ a: 4 }, ['me', 'a']), undefined, aDropdown)`
   - `:173` `fact(statsOf({ a: 4 }, ['me', 'a']), undefined, 'The Wordlers', aDropdown)` → `fact(statsOf({ a: 4 }, ['me', 'a']), 'The Wordlers', aDropdown)`
   - `:188` (inside the block being deleted — goes with it)
   - `:221` `fact(statsOf({ me: 3, a: 4 }, ['me', 'a']), undefined, 'The Wordlers')` → `fact(statsOf({ me: 3, a: 4 }, ['me', 'a']), 'The Wordlers')`
3. Delete the whole `describe('the paywall hook', …)` block (both tests).
4. **Delete the whole test at `:163-168`** (`'and offers no paywall hook off an empty state'`). Do NOT retitle it and keep the rest: its body is two lines, and the one assertion in it is the `insights-see-full-month` one being removed. Retitling would leave an assertion-free test that is otherwise a byte-duplicate of the test at `:145`. The case it covered — a card rendering for the control alone — is already that test's subject.
5. Remove the now-unused imports. `tsconfig.json` sets `noUnusedLocals: true`, so a leftover import is a typecheck failure, not a lint nit. **Both** `vi` and `fireEvent` are affected — `fireEvent`'s only use is `:192`, inside the `describe('the paywall hook')` block deleted in step 3. Check each before removing:

```bash
cd v2
grep -n 'vi\.'        src/components/insights/daily-team-fact.hook.test.ts
grep -n 'fireEvent\.' src/components/insights/daily-team-fact.hook.test.ts
```

Remove from the `vitest` / `@testing-library/react` import lines whichever now has no remaining use.

- [ ] **Step 3b: Update the file's own doc comment**

`daily-team-fact.tsx`'s header still documents the thing being deleted, and in a
codebase this comment-dense a paragraph insisting the removed control "MUST STAY"
is a defect of its own. Two edits:

- `:8` — `Layer 3's FREE slice — one fact a day, and the hook to the paid surface.`
  → `Layer 3's FREE slice — one fact a day.`
- `:21-25` — replace the whole `THE "SEE THE FULL MONTH" TARGET IS A PLACEHOLDER
  AND MUST STAY ONE` paragraph with:

```
 * THE PAYWALL HOOK LEFT THIS FILE (wordle-teams-iht.2). It used to render a
 * "See the full month →" button whose handler was deliberately never wired —
 * the affordance was this card's to own and the destination was iht's. iht
 * answered with a card instead: team-locked-card.tsx now sits directly beneath
 * this one and shows the full month, locked. Two calls to action in one region
 * is why the link went rather than gained a handler.
```

- [ ] **Step 4: Run it**

Run: `cd v2 && npx vitest run src/components/insights/daily-team-fact.hook.test.ts`
Expected: PASS.

- [ ] **Step 5: Move the e2e assertion onto the locked card**

In `e2e/team-insights.spec.ts`, in `test('sees the daily fact and the "see the full month" hook', …)`:

- Rename it to `test('sees the daily fact and the locked team card beneath it', …)`.
- Replace `await expect(page.getByTestId('insights-see-full-month')).toBeVisible()` with:

```ts
    // THE TEASER, wordle-teams-iht.2. It replaces a "see the full month" link
    // that rendered with no handler and did nothing when clicked.
    await expect(page.getByTestId('insights-team-locked')).toBeVisible()
    await expect(page.getByTestId('insights-locked-cta')).toContainText('Unlock')
```

- [ ] **Step 6: Replace the two vacuous negative assertions**

`:383` and `:534` assert `insights-see-full-month` has count 0. After the removal those pass for the wrong reason — the testid no longer exists anywhere, so they assert nothing. Replace **both** with the fact that matters now:

```ts
    // The card is present even here — the owner's rule is that it ALWAYS shows,
    // because a player with too little engagement to be ranked is exactly who
    // needs to see what is possible. Only its headline changes.
    await expect(page.getByTestId('insights-team-locked')).toBeVisible()
```

- [ ] **Step 7: Check nothing else references the testid**

Run: `cd v2 && grep -rn "insights-see-full-month\|onSeeFullMonth" src/ e2e/`
Expected: no output.

- [ ] **Step 8: Four gates**

`pnpm typecheck` · `pnpm lint` · `pnpm test:once` · `pnpm build`, each exit 0.

- [ ] **Step 9: Run the full e2e suite**

It needs a local Convex backend, and a bare `convex dev` would target a real cloud deployment because `.env.local` carries `CONVEX_DEPLOY_KEY`. Use a scratch env file holding only the anonymous deployment, and Node 22 (the workstation default is Node 25, which refuses `use node` actions):

```bash
cd /home/cdub/projects/wordle-teams/v2
printf 'CONVEX_DEPLOYMENT=anonymous:anonymous-v2\n' > /tmp/convex.anon.env
PATH="$HOME/.local/share/mise/installs/node/22.23.2/bin:$PATH" CONVEX_AGENT_MODE=anonymous \
  nohup pnpm exec convex dev --env-file /tmp/convex.anon.env > /tmp/convex-dev.log 2>&1 &
until grep -q 'Convex functions ready' /tmp/convex-dev.log; do sleep 2; done
grep -iE 'convex\.cloud|Production' /tmp/convex-dev.log && echo 'STOP: cloud target' || echo 'local only'
PATH="$HOME/.local/share/mise/installs/node/22.23.2/bin:$PATH" CONVEX_AGENT_MODE=anonymous \
  pnpm exec convex env set SITE_URL http://localhost:3000 --env-file /tmp/convex.anon.env
PATH="$HOME/.local/share/mise/installs/node/22.23.2/bin:$PATH" CONVEX_AGENT_MODE=anonymous \
  pnpm exec convex env set E2E_TEST_MODE true --env-file /tmp/convex.anon.env
pnpm e2e --reporter=line
```

Expected: `101 passed` (Playwright starts its own dev server; `reuseExistingServer` is false, so nothing else may hold port 3000). The 101 is measured, not counted from the source — grepping `test(` over `e2e/*.spec.ts` gives 103, because one is a `test.skip` INSIDE a test body and the count includes non-declarations. This task adds no e2e test, so 101 is still the number. The run takes ~11 minutes — longer than a foreground tool-call limit, so run it backgrounded and poll the log for the `N passed` summary line.

- [ ] **Step 10: Commit**

```bash
cd /home/cdub/projects/wordle-teams
git add v2/src/components/insights/daily-team-fact.tsx v2/src/components/insights/daily-team-fact.hook.test.ts v2/e2e/team-insights.spec.ts
git commit -m "fix(insights): remove the dead see-the-full-month link"
```

- [ ] **Step 11: Close the issue**

```bash
cd /home/cdub/projects/wordle-teams
bd close wordle-teams-iht.2 --reason "Free members of a team now get the locked card beneath their daily fact: real teammate names, every figure redacted, and a headline that says what would make the numbers appear. Always rendered, per the owner's rule that the least-engaged players are the ones who most need to see it. Solo teams are asked to invite rather than to upgrade, because upgrading would not deliver what the card shows. The dead see-the-full-month link is gone. Four gates green, e2e 101/101."
git status --short   # bd writes lag; commit .beads/issues.jsonl if it changed
```
