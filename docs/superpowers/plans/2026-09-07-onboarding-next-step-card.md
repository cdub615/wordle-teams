# Onboarding Next-Step Card Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the single-purpose "You're not on a team yet" empty state with a state-driven next-step card at the top of `/app` that carries three independent tasks — enter today's board, create a team, invite someone — each retiring as it completes, instrumented so post-launch drop-off is attributable to a specific task.

**Architecture:** A pure task-state module (`src/lib/onboarding-tasks.ts`) decides which tasks are incomplete from four booleans. Three of those booleans come from queries `/app` **already subscribes to**; only one new query is added, and it reads the caller's own rows exclusively. The card is presentational and receives callbacks that open the dialogs `/app` already mounts.

**Tech Stack:** TanStack Start + React 19, Convex (`convex-test` for backend tests), Vitest (edge-runtime default, jsdom for component tests), Tailwind + shadcn, LogSnag via the existing `/api/funnel` Worker route.

---

## Design source

`docs/superpowers/specs/2026-09-07-onboarding-activation-design.md`. Read it first — it carries the evidence and the rejected alternatives.

**One refinement this plan makes to that spec.** The spec says the card is "driven by a reactive query" and warns about event dedupe. While planning, `getMyTeamsFor` was found to run `ctx.db.query('teams').collect()` (`convex/teams.ts:61`) — a full scan of every team in the system, so any reactive query built on it is invalidated whenever *any* team anywhere changes. `getMyTeams` already has this property and `/app` already subscribes to it, so this plan **adds no second app-wide subscription**: `hasPendingInvite` is added as a boolean to the payload `getMyTeamsFor` already builds, and the only new query reads the caller's own `dailyScores` and player row.

Emails stay off the wire. `getMyTeamsFor` picks fields explicitly *because* `invited` holds real addresses (`convex/teams.ts:108-110`); a boolean preserves that.

---

## File structure

**Create**
- `src/lib/onboarding-tasks.ts` — pure task-state machine and copy. No React, no Convex.
- `src/lib/onboarding-tasks.test.ts` — unit tests, default edge-runtime.
- `convex/onboarding.ts` — `getStatus` query, `dismiss` and `replay` mutations.
- `convex/onboarding.test.ts` — `convex-test` backend tests.
- `src/components/onboarding/next-step-card.tsx` — presentational card.
- `src/components/onboarding/next-step-card.hook.test.ts` — jsdom render + dedupe tests.

**Modify**
- `convex/schema.ts` — `onboardingDismissedAt` on `players`.
- `convex/teams.ts:103-112` — add `hasPendingInvite` to the returned team shape.
- `src/routes/app.tsx:222-232` — render the card; drop the no-team short-circuit.
- `src/lib/funnel.ts` — four new event variants.
- `src/lib/funnel-payload.ts` — allowlist the four events and their tags.
- `src/lib/funnel-payload.test.ts` — extend.
- `src/components/app-menu.tsx` — "Show getting started" replay entry.

**Delete**
- `src/components/teams/empty-state.tsx` — superseded entirely by the card.

**Deferred to the second plan** (`2026-09-07-invite-links.md`): the invite task's action opens the existing `InvitePlayerDialog` until then.

---

## Task 1: Pure task-state module

**Files:**
- Create: `v2/src/lib/onboarding-tasks.ts`
- Test: `v2/src/lib/onboarding-tasks.test.ts`

- [ ] **Step 1: Write the failing test**

Create `v2/src/lib/onboarding-tasks.test.ts`:

> **CORRECTED 2026-09-07, AFTER TASK 7 SHIPPED.** The task list below was
> written as three independent tasks. It is three, but `invite` carries a
> PREREQUISITE the original text missed: `incompleteTasks` gated it on
> `!hasInvited` alone, so a brand-new signup with no team was shown a live
> "Invite someone" button that navigated to `/team` with no team id — and
> `routes/team.tsx` redirects a team-less player straight back to `/app`. A
> dead-end CTA on the exact screen wordle-teams-456 is about, emitting an
> `onboarding_task_click` that can never convert. The fix is
> `if (facts.hasTeam && !facts.hasInvited)` in `incompleteTasks`, NOT a check in
> the route. This is a prerequisite ("you cannot invite someone to nothing"),
> not the precedence the design forbids: board and team stay independent.
>
> Consequence for the expectations below: `team` and `invite` are now MUTUALLY
> EXCLUSIVE, so a card shows at most TWO tasks and a fresh signup owes
> `['board', 'team']`. Every expectation naming three has been corrected.

```ts
import { describe, expect, test } from 'vitest'
import {
  MODEL_LINE,
  cardHeading,
  incompleteTasks,
  shouldShowCard,
  taskSetKey,
  type OnboardingFacts,
} from './onboarding-tasks.ts'

/** Every fact false — a brand-new self-signup who has done nothing. */
const nothing: OnboardingFacts = {
  enteredBoard: false,
  hasTeam: false,
  hasInvited: false,
  dismissed: false,
}

describe('incompleteTasks', () => {
  test('an invited joiner owes only the board', () => {
    // completeProfileFor auto-joins them to a populated team, so create and
    // invite are both already satisfied on arrival. See convex/players.ts:226.
    const joiner: OnboardingFacts = { ...nothing, hasTeam: true, hasInvited: true }
    expect(incompleteTasks(joiner).map((t) => t.id)).toEqual(['board'])
  })

  test('the 456 shape — played, made a team of one — owes only the invite', () => {
    const soloTeam: OnboardingFacts = { ...nothing, enteredBoard: true, hasTeam: true }
    expect(incompleteTasks(soloTeam).map((t) => t.id)).toEqual(['invite'])
  })

  test('every task carries its copy, attached to the right id', () => {
    // TWO FIXTURES: 'team' and 'invite' cannot co-occur — see the correction
    // note at the head of this task.
    expect(incompleteTasks(nothing)).toEqual([
      { id: 'board', title: "Enter today's board", hint: 'About 10 seconds' },
      { id: 'team', title: 'Create a team', hint: 'Where scores get compared' },
    ])
    expect(incompleteTasks({ ...nothing, hasTeam: true })).toEqual([
      { id: 'board', title: "Enter today's board", hint: 'About 10 seconds' },
      { id: 'invite', title: 'Invite someone', hint: 'A scoreboard needs someone to score against' },
    ])
  })

  test('the invite task needs a team first, because it has nowhere to point without one', () => {
    expect(incompleteTasks(nothing).map((t) => t.id)).not.toContain('invite')
    expect(incompleteTasks({ ...nothing, hasTeam: true }).map((t) => t.id)).toEqual([
      'board',
      'invite',
    ])
  })
})

describe('shouldShowCard', () => {
  test('shows while any task is incomplete', () => {
    expect(shouldShowCard(nothing)).toBe(true)
  })

  test('retires when every task is complete', () => {
    const done: OnboardingFacts = {
      enteredBoard: true,
      hasTeam: true,
      hasInvited: true,
      dismissed: false,
    }
    expect(shouldShowCard(done)).toBe(false)
  })

  test('a dismissal hides it even with work outstanding', () => {
    expect(shouldShowCard({ ...nothing, dismissed: true })).toBe(false)
  })
})

describe('cardHeading', () => {
  test('reads "Get started" while more than one task remains', () => {
    expect(cardHeading(nothing)).toBe('Get started')
  })

  test('reads "One more thing" on the last remaining task', () => {
    const soloTeam: OnboardingFacts = { ...nothing, enteredBoard: true, hasTeam: true }
    expect(cardHeading(soloTeam)).toBe('One more thing')
  })

  test('reads "Get started" when nothing remains at all', () => {
    const done: OnboardingFacts = { enteredBoard: true, hasTeam: true, hasInvited: true, dismissed: false }
    expect(cardHeading(done)).toBe('Get started')
  })
})

describe('MODEL_LINE', () => {
  // The scoring defaults (convex/fixtures.ts:34) run +5 for one guess down to
  // -3 for a failure — that's the illustration. The rule itself lives in
  // convex/lib/scoring.ts:119's winnerOf: a strict `>` while walking the list
  // in order, so the HIGHEST monthly total wins. An earlier draft of this
  // copy said "lowest", which would teach the wrong rule on the one screen
  // built to explain the model. Pinned so it cannot regress.
  test('says highest wins, never lowest', () => {
    expect(MODEL_LINE).toContain('Highest monthly total wins')
    expect(MODEL_LINE.toLowerCase()).not.toContain('lowest')
  })
})

describe('taskSetKey', () => {
  test('is stable for the same set and distinct across sets', () => {
    expect(taskSetKey(incompleteTasks(nothing))).toBe('board,team')
    expect(taskSetKey(incompleteTasks({ ...nothing, hasTeam: true }))).toBe('board,invite')
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run from `v2/`: `pnpm vitest run src/lib/onboarding-tasks.test.ts`
Expected: FAIL — `Failed to resolve import "./onboarding-tasks.ts"`.

- [ ] **Step 3: Write minimal implementation**

Create `v2/src/lib/onboarding-tasks.ts`:

```ts
/**
 * Which onboarding tasks a player still owes, and the copy for each.
 *
 * PURE, AND SEPARATE FROM THE COMPONENT, following lib/celebration.ts: the
 * component's job is a subscription and some callbacks, while this is the set
 * of decisions that are actually worth asserting. Keeping them here means the
 * copy and the predicates are pinned by plain unit tests under the default
 * edge-runtime rather than only by the jsdom suite next door.
 *
 * THE THREE TASKS ARE INDEPENDENT AND CARRY NO PRECEDENCE. That is a product
 * decision taken 2026-09-07, not an oversight: there is no evidence for
 * whether playing first or inviting first converts better, and the funnel
 * events exist to answer it after launch. Do not "fix" this into a sequence.
 */

export type OnboardingTaskId = 'board' | 'team' | 'invite'

/**
 * The four booleans the card renders from.
 *
 * Deliberately primitives rather than Convex documents, so this module — and
 * its test — stay independent of codegen, matching lib/celebration.ts's
 * WinnerRow. Where each is sourced is the component's problem, not this one's.
 */
export type OnboardingFacts = {
  /** Has >=1 dailyScores row with NON-EMPTY guesses. See convex/onboarding.ts. */
  enteredBoard: boolean
  hasTeam: boolean
  /** On a team with another member, OR holding a pending invite. */
  hasInvited: boolean
  dismissed: boolean
}

export type OnboardingTask = {
  id: OnboardingTaskId
  title: string
  hint: string
}

/**
 * The model, stated in one line, because it is stated NOWHERE ELSE inside the
 * app. The Phase 7 landing page makes this pitch pre-signup; someone who
 * arrived by an invite link never saw it.
 *
 * "Highest", not "lowest". convex/fixtures.ts:34 gives +5 for a one-guess
 * solve down to -3 for a failure, so fewer guesses earns MORE — that's the
 * illustration, not the rule. The rule lives in convex/lib/scoring.ts:119's
 * winnerOf, whose doc comment states a strict `>` while walking the list in
 * order, so the BIGGEST monthly total wins. Cite scoring.ts, not the fixture,
 * if the scoring numbers ever change — the fixture only supplies concrete
 * values.
 * Pinned by test.
 */
export const MODEL_LINE =
  'Everyone plays their own Wordle. Fewer guesses scores more points. Highest monthly total wins.'

const TASK_COPY: Record<OnboardingTaskId, { title: string; hint: string }> = {
  board: { title: "Enter today's board", hint: 'About 10 seconds' },
  team: { title: 'Create a team', hint: 'Where scores get compared' },
  invite: { title: 'Invite someone', hint: 'A scoreboard needs someone to score against' },
}

/**
 * The tasks still outstanding, in a FIXED order.
 *
 * Fixed order is presentation, not precedence — the list must not reshuffle
 * under the reader's finger as tasks complete, and a stable order is also what
 * makes taskSetKey below a usable dedupe key.
 */
export function incompleteTasks(facts: OnboardingFacts): OnboardingTask[] {
  const ids: OnboardingTaskId[] = []
  if (!facts.enteredBoard) ids.push('board')
  if (!facts.hasTeam) ids.push('team')
  if (!facts.hasInvited) ids.push('invite')
  return ids.map((id) => ({ id, ...TASK_COPY[id] }))
}

export function shouldShowCard(facts: OnboardingFacts): boolean {
  return !facts.dismissed && incompleteTasks(facts).length > 0
}

export function cardHeading(facts: OnboardingFacts): string {
  return incompleteTasks(facts).length === 1 ? 'One more thing' : 'Get started'
}

/**
 * A stable key for one task set, for funnel dedupe.
 *
 * The card renders from a reactive query, so without a key onboarding_view
 * would emit on every invalidation and drown the channel. See
 * src/components/onboarding/next-step-card.tsx.
 *
 * RETURNS '' FOR AN EMPTY SET, which collides with the empty-string sentinel a
 * useRef dedupe would naturally start from. Not reachable through the card
 * today — shouldShowCard is false at zero tasks, so it never renders — but a
 * caller that compares against '' to mean "not yet emitted" would silently
 * suppress a genuine all-complete emission. Compare against a separate "seen"
 * flag, not against ''.
 */
export function taskSetKey(tasks: OnboardingTask[]): string {
  return tasks.map((task) => task.id).join(',')
}
```

- [ ] **Step 4: Run test to verify it passes**

Run from `v2/`: `pnpm vitest run src/lib/onboarding-tasks.test.ts`
Expected: PASS, 11 tests.

- [ ] **Step 5: Commit**

```bash
git add v2/src/lib/onboarding-tasks.ts v2/src/lib/onboarding-tasks.test.ts
git commit -m "feat(onboarding): pure task-state module for the next-step card"
```

---

## Task 2: `onboardingDismissedAt` on the player document

**Files:**
- Modify: `v2/convex/schema.ts` (the `players` table, around line 83)

- [ ] **Step 1: Add the field**

In `v2/convex/schema.ts`, inside `players: defineTable({ ... })`, immediately after the `createdAt` line, add:

```ts
    // WHEN THE PLAYER DISMISSED THE ONBOARDING CARD, absent if they never did.
    //
    // SERVER-SIDE, NOT localStorage, matching the monthly-winner dialog's
    // hasSeen (lib/celebration.ts): the flag has to follow one person across
    // their phone and their laptop, and it has to be readable by whatever
    // measures activation later. A per-device flag would do neither.
    //
    // A TIMESTAMP RATHER THAN A BOOLEAN, because "when did they give up on
    // onboarding" is a question the activation review will actually ask, and a
    // boolean cannot answer it. Nothing reads the value yet; absence is the
    // only thing the UI tests.
    onboardingDismissedAt: v.optional(v.number()),
```

- [ ] **Step 2: Verify the schema still pushes and types regenerate**

Run from `v2/`:

```bash
CONVEX_DEPLOY_KEY= CONVEX_URL= pnpm exec convex codegen
```

Expected: exits 0, no schema validation errors.

**Do NOT run a bare `pnpm exec convex dev`** — `CONVEX_DEPLOY_KEY` sits uncommented in `v2/.env.local` and a bare invocation pushes to **beta**. The blank-variable prefix above is what targets local. Node 22 must be on PATH.

- [ ] **Step 3: Typecheck**

Run from `v2/`: `pnpm typecheck`
Expected: exits 0. The field is optional, so no existing writer breaks.

- [ ] **Step 4: Commit**

```bash
git add v2/convex/schema.ts
git commit -m "feat(onboarding): record onboarding card dismissal on the player"
```

---

## Task 3: `convex/onboarding.ts` — status query and dismiss/replay mutations

**Files:**
- Create: `v2/convex/onboarding.ts`
- Test: `v2/convex/onboarding.test.ts`

- [ ] **Step 1: Write the failing test**

Create `v2/convex/onboarding.test.ts`:

```ts
import { describe, expect, test } from 'vitest'
import { convexTest } from 'convex-test'
import betterAuthTest from '@convex-dev/better-auth/test'
import schema from './schema.ts'
import { api } from './_generated/api'
import { aPlayer, authenticatedAs } from './fixtures.ts'

// Every convexTest call site in this repo passes `modules`; see chat.test.ts:35.
const modules = import.meta.glob('./**/*.ts')

describe('onboarding.getStatus', () => {
  test('is null for a caller with no player row', async () => {
    const t = convexTest(schema, modules)
    betterAuthTest.register(t)
    const as = await authenticatedAs(t, 'nobody@example.com')
    expect(await as.query(api.onboarding.getStatus, {})).toBeNull()
  })

  test('enteredBoard is false with no boards at all', async () => {
    const t = convexTest(schema, modules)
    betterAuthTest.register(t)
    await t.run(async (ctx) => {
      await ctx.db.insert('players', aPlayer({ email: 'a@example.com' }))
    })
    const as = await authenticatedAs(t, 'a@example.com')
    expect(await as.query(api.onboarding.getStatus, {})).toEqual({
      enteredBoard: false,
      dismissed: false,
    })
  })

  test('a row with EMPTY guesses does not count as entered', async () => {
    // Migrated v1 rows predate v2's delete-on-empty rule (scores.ts:233), so
    // empty-guess rows exist in copied data. wordle-teams-456 counts non-empty
    // guesses for exactly this reason: without the filter every migrated empty
    // row reads as an activation and the number is inflated.
    const t = convexTest(schema, modules)
    betterAuthTest.register(t)
    await t.run(async (ctx) => {
      const playerId = await ctx.db.insert('players', aPlayer({ email: 'b@example.com' }))
      await ctx.db.insert('dailyScores', {
        playerId,
        puzzleDay: '2026-09-01',
        date: Date.now(),
        answer: '',
        guesses: [],
      })
    })
    const as = await authenticatedAs(t, 'b@example.com')
    expect((await as.query(api.onboarding.getStatus, {}))?.enteredBoard).toBe(false)
  })

  test('a row with real guesses counts as entered', async () => {
    const t = convexTest(schema, modules)
    betterAuthTest.register(t)
    await t.run(async (ctx) => {
      const playerId = await ctx.db.insert('players', aPlayer({ email: 'c@example.com' }))
      await ctx.db.insert('dailyScores', {
        playerId,
        puzzleDay: '2026-09-01',
        date: Date.now(),
        answer: 'crane',
        guesses: ['stare', 'crane'],
      })
    })
    const as = await authenticatedAs(t, 'c@example.com')
    expect((await as.query(api.onboarding.getStatus, {}))?.enteredBoard).toBe(true)
  })

  test('finds a non-empty row even when an empty one sorts first', async () => {
    // The scan must not stop at the first row it sees, in EITHER traversal
    // direction. An empty row at both ends (2026-09-01 and 2026-09-03), with
    // the only non-empty row in the middle, means neither an ascending nor a
    // descending scan can pass by examining just the first row it meets.
    const t = convexTest(schema, modules)
    betterAuthTest.register(t)
    await t.run(async (ctx) => {
      const playerId = await ctx.db.insert('players', aPlayer({ email: 'd@example.com' }))
      await ctx.db.insert('dailyScores', {
        playerId,
        puzzleDay: '2026-09-01',
        date: Date.now(),
        answer: '',
        guesses: [],
      })
      await ctx.db.insert('dailyScores', {
        playerId,
        puzzleDay: '2026-09-02',
        date: Date.now(),
        answer: 'crane',
        guesses: ['crane'],
      })
      await ctx.db.insert('dailyScores', {
        playerId,
        puzzleDay: '2026-09-03',
        date: Date.now(),
        answer: '',
        guesses: [],
      })
    })
    const as = await authenticatedAs(t, 'd@example.com')
    expect((await as.query(api.onboarding.getStatus, {}))?.enteredBoard).toBe(true)
  })

  test("does not see another player's boards", async () => {
    const t = convexTest(schema, modules)
    betterAuthTest.register(t)
    await t.run(async (ctx) => {
      await ctx.db.insert('players', aPlayer({ email: 'mine@example.com' }))
      const otherId = await ctx.db.insert('players', aPlayer({ email: 'other@example.com' }))
      await ctx.db.insert('dailyScores', {
        playerId: otherId,
        puzzleDay: '2026-09-01',
        date: Date.now(),
        answer: 'crane',
        guesses: ['crane'],
      })
    })
    const as = await authenticatedAs(t, 'mine@example.com')
    expect((await as.query(api.onboarding.getStatus, {}))?.enteredBoard).toBe(false)
  })
})

describe('onboarding.dismiss and replay', () => {
  test('dismiss sets the flag and replay clears it', async () => {
    const t = convexTest(schema, modules)
    betterAuthTest.register(t)
    const playerId = await t.run(async (ctx) => {
      return await ctx.db.insert('players', aPlayer({ email: 'e@example.com' }))
    })
    const as = await authenticatedAs(t, 'e@example.com')

    await as.mutation(api.onboarding.dismiss, {})
    expect((await as.query(api.onboarding.getStatus, {}))?.dismissed).toBe(true)

    // The flag is a TIMESTAMP, not a boolean, so the design can stay
    // measurable — that value is load-bearing, not just its presence.
    const stamp = await t.run(async (ctx) => (await ctx.db.get(playerId))?.onboardingDismissedAt)
    expect(stamp).toBeGreaterThan(Date.now() - 60_000)

    await as.mutation(api.onboarding.replay, {})
    expect((await as.query(api.onboarding.getStatus, {}))?.dismissed).toBe(false)
  })

  test('dismiss is idempotent', async () => {
    const t = convexTest(schema, modules)
    betterAuthTest.register(t)
    await t.run(async (ctx) => {
      await ctx.db.insert('players', aPlayer({ email: 'f@example.com' }))
    })
    const as = await authenticatedAs(t, 'f@example.com')
    await as.mutation(api.onboarding.dismiss, {})
    await as.mutation(api.onboarding.dismiss, {})
    expect((await as.query(api.onboarding.getStatus, {}))?.dismissed).toBe(true)
  })

  // THE OTHER HALF OF `requirePlayer`: a session and user genuinely exist
  // (Better Auth is satisfied), but no `players` row matches that email.
  // dismiss/replay use requirePlayer, not currentPlayer, so both must refuse
  // rather than silently no-op — matching chat.test.ts's
  // "refuses an authenticated caller with no player row, with NO_PLAYER".
  test('dismiss and replay refuse an authenticated caller with no player row, with NO_PLAYER', async () => {
    const t = convexTest(schema, modules)
    betterAuthTest.register(t)
    const asStranger = await authenticatedAs(t, 'stranger@example.com')

    await expect(asStranger.mutation(api.onboarding.dismiss, {})).rejects.toMatchObject({
      data: { code: 'NO_PLAYER' },
    })
    await expect(asStranger.mutation(api.onboarding.replay, {})).rejects.toMatchObject({
      data: { code: 'NO_PLAYER' },
    })
  })
})
```

**The imports above are verified, not assumed** (checked 2026-09-07 against `convex/chat.test.ts`). `convex/fixtures.ts` exports `aPlayer`, `aTeam` and `authenticatedAs` — there is no `asPlayer`, and `betterAuthTest` is a DEFAULT import from `@convex-dev/better-auth/test`, not a fixture. `betterAuthTest.register(t)` is called synchronously, not awaited. All 413 `convexTest` call sites in this repo pass `modules`; omitting it will fail. Do not invent new fixtures.

- [ ] **Step 2: Run test to verify it fails**

Run from `v2/`: `pnpm vitest run convex/onboarding.test.ts`
Expected: FAIL — `api.onboarding` is undefined / module not found.

- [ ] **Step 3: Write minimal implementation**

Create `v2/convex/onboarding.ts`:

```ts
import { mutation, query } from './_generated/server'
import { currentPlayer, requirePlayer } from './access'

/**
 * The two onboarding facts the client cannot already derive.
 *
 * WHY THIS QUERY IS SO SMALL, and why it must stay that way. The card needs
 * four booleans; three of them (hasTeam, hasInvited, and dismissal's absence)
 * come from data routes/app.tsx ALREADY subscribes to via getMyTeams. Only
 * these two are new.
 *
 * THAT IS A DELIBERATE FAN-OUT DECISION, not a coincidence. getMyTeamsFor runs
 * `ctx.db.query('teams').collect()` — a full scan of every team in the system
 * (teams.ts:61) — so a reactive query built on it is invalidated whenever ANY
 * team anywhere changes. getMyTeams already pays that cost and the dashboard
 * already subscribes to it; adding a SECOND such query would double it for
 * every connected client, and this card mounts for everyone who has not yet
 * finished onboarding. Everything read below is keyed to the caller's own
 * player id, so nobody else's activity can invalidate it.
 *
 * DO NOT add a team read here. If something needs one, put a boolean on
 * getMyTeamsFor's existing payload instead — that is what hasPendingInvite is.
 */
export const getStatus = query({
  args: {},
  handler: async (ctx) => {
    // currentPlayer, NOT requirePlayer: this mounts on /app, which is also
    // reachable in the moment before a player row exists. Returning null lets
    // the card render nothing rather than throwing NO_PLAYER at someone who is
    // mid-signup. Same reasoning as players.ts's myName.
    const player = await currentPlayer(ctx)
    if (!player) return null

    // NON-EMPTY GUESSES, not mere row existence. The real guarantee is
    // boardIsValid's `rows[0].length === 5` requirement for any non-empty
    // submission (lib/board.ts:59-60, enforced at scores.ts:211) — a row with
    // guesses but no first entry never passes that check, so it can never be
    // written. scores.ts:233's delete-on-fully-empty rule is a secondary,
    // narrower point: it only covers the case where BOTH guesses and answer
    // are empty, and would not by itself rule out a row like
    // `{ guesses: [], answer: 'crane' }`. Together they mean rows born in v2
    // always carry real guesses — but rows COPIED from v1 predate both rules,
    // and wordle-teams-456 counts non-empty guesses for exactly this reason.
    // Without the filter, every migrated empty row reads as an activation.
    //
    // DESCENDING, not ascending. The rows that motivate the filter — migrated
    // v1 empties — are the OLDEST a player has; the row that flips
    // enteredBoard true is the NEWEST one they enter. Walking oldest-first
    // means a long-tenured migrated player's every prior empty row gets
    // examined before the scan reaches the one that matters; walking
    // newest-first finds it on the first row. Strictly better or equal in
    // every case, and it also narrows the recorded read range once
    // enteredBoard is true (see chat.test.ts's watchReads on why the READ SET,
    // not just the return value, is what makes a subscription cheap or not).
    //
    // Iterated with an early break rather than collected: a heavy player has
    // thousands of these rows and we need to know only whether ONE qualifies.
    let enteredBoard = false
    for await (const board of ctx.db
      .query('dailyScores')
      .withIndex('by_player_and_puzzleDay', (q) => q.eq('playerId', player._id))
      .order('desc')) {
      if (board.guesses.length > 0) {
        enteredBoard = true
        break
      }
    }

    return { enteredBoard, dismissed: player.onboardingDismissedAt !== undefined }
  },
})

/** Hide the card early. Idempotent — a second call just rewrites the stamp. */
export const dismiss = mutation({
  args: {},
  handler: async (ctx) => {
    const player = await requirePlayer(ctx)
    await ctx.db.patch(player._id, { onboardingDismissedAt: Date.now() })
  },
})

/** Bring it back, from the app menu's "Show getting started". */
export const replay = mutation({
  args: {},
  handler: async (ctx) => {
    const player = await requirePlayer(ctx)
    await ctx.db.patch(player._id, { onboardingDismissedAt: undefined })
  },
})
```

- [ ] **Step 4: Run test to verify it passes**

Run from `v2/`: `pnpm vitest run convex/onboarding.test.ts`
Expected: PASS, 9 tests.

If `requirePlayer` is not exported from `convex/access.ts`, check how `convex/scores.ts` imports it and match that — `upsertBoard` uses it (`convex/scores.ts:266`).

- [ ] **Step 5: Commit**

```bash
git add v2/convex/onboarding.ts v2/convex/onboarding.test.ts
git commit -m "feat(onboarding): status query and dismiss/replay mutations"
```

---

## Task 4: `hasPendingInvite` on the teams payload

**Files:**
- Modify: `v2/convex/teams.ts:103-112`
- Test: `v2/convex/teams.test.ts`

- [ ] **Step 1: Write the failing test**

Add a new `describe` block to `v2/convex/teams.test.ts`, alongside the existing `describe('getMyTeamsFor')` at line 26.

**Note the idiom, which is this file's and NOT the one the other convex tasks use.** `teams.test.ts` imports the `getMyTeamsFor` HELPER directly (`teams.test.ts:5`) and calls it inside `t.run(async (ctx) => ...)`. It does not go through `api.teams.getMyTeams`, does not import `betterAuthTest`, and needs no `authenticatedAs` — there is no auth in the picture at all, because the helper takes a `playerId` argument. Match that.

```ts
describe('getMyTeamsFor hasPendingInvite', () => {
  test('is true when an address is parked, false when not', async () => {
    const t = convexTest(schema, modules)
    await t.run(async (ctx) => {
      const ada = await ctx.db.insert('players', aPlayer())
      await ctx.db.insert(
        'teams',
        aTeam({ name: 'parked', playerIds: [ada], owner: ada, invited: ['friend@example.com'] }),
      )
      await ctx.db.insert(
        'teams',
        aTeam({ legacyId: 207, name: 'alone', playerIds: [ada], owner: ada, invited: [] }),
      )

      const teams = await getMyTeamsFor(ctx, ada)
      // Located by name rather than by index: getMyTeamsFor sorts on createdAt,
      // which the aTeam fixture does not set, so both compare equal and the
      // order is insertion order by accident rather than by contract.
      expect(teams.find((team) => team.name === 'parked')?.hasPendingInvite).toBe(true)
      expect(teams.find((team) => team.name === 'alone')?.hasPendingInvite).toBe(false)
    })
  })

  test('the payload still carries no email addresses', async () => {
    // getMyTeamsFor picks its fields by hand BECAUSE `invited` holds real
    // addresses (teams.ts:108-110). hasPendingInvite is a boolean precisely so
    // that stays true. This asserts the property rather than trusting the comment.
    const t = convexTest(schema, modules)
    await t.run(async (ctx) => {
      const ada = await ctx.db.insert('players', aPlayer())
      await ctx.db.insert(
        'teams',
        aTeam({ playerIds: [ada], owner: ada, invited: ['secret@example.com'] }),
      )

      const teams = await getMyTeamsFor(ctx, ada)
      expect(JSON.stringify(teams)).not.toContain('secret@example.com')
    })
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run from `v2/`: `pnpm vitest run convex/teams.test.ts -t hasPendingInvite`
Expected: FAIL — `expected undefined to be true`.

- [ ] **Step 3: Write minimal implementation**

In `v2/convex/teams.ts`, inside the object literal returned by `getMyTeamsFor` (currently lines 103-112), add after `showLetters`:

```ts
        // WHETHER AN INVITE IS OUTSTANDING, as a boolean.
        //
        // The onboarding card needs to know whether this player has got anyone
        // else into the room — a second member OR a parked invite. Members are
        // already on this payload; the invite was not, and could not be: the
        // field holds real email addresses, which is why every field here is
        // picked by hand rather than spread (see below).
        //
        // A BOOLEAN IS THE WHOLE POINT. It answers the card's question and
        // carries no address, so the privacy property of this function is
        // unchanged. Do not widen this to the array.
        hasPendingInvite: team.invited.length > 0,
```

- [ ] **Step 4: Run tests to verify they pass**

Run from `v2/`: `pnpm vitest run convex/teams.test.ts`
Expected: PASS, including the two new tests and every pre-existing one.

- [ ] **Step 5: Commit**

```bash
git add v2/convex/teams.ts v2/convex/teams.test.ts
git commit -m "feat(teams): expose hasPendingInvite without putting addresses on the wire"
```

---

## Task 5: Funnel events

**Files:**
- Modify: `v2/src/lib/funnel.ts`
- Modify: `v2/src/lib/funnel-payload.ts`
- Test: `v2/src/lib/funnel-payload.test.ts`

- [ ] **Step 1: Write the failing test**

Append to `v2/src/lib/funnel-payload.test.ts`:

```ts
describe('onboarding events', () => {
  test('onboarding_view carries the incomplete task set', () => {
    const payload = toLogSnagPayload({ name: 'onboarding_view', tasks: 'board,team' }, 'beta')
    expect(payload?.event).toBe('Onboarding viewed')
    expect(payload?.tags.tasks).toBe('board,team')
    expect(payload?.tags.env).toBe('beta')
  })

  test('onboarding_task_click carries the task', () => {
    const payload = toLogSnagPayload({ name: 'onboarding_task_click', task: 'invite' }, 'prod')
    expect(payload?.event).toBe('Onboarding task clicked')
    expect(payload?.tags.task).toBe('invite')
  })

  test('onboarding_complete and onboarding_dismiss are allowed', () => {
    expect(toLogSnagPayload({ name: 'onboarding_complete' }, 'beta')?.event).toBe(
      'Onboarding complete',
    )
    expect(toLogSnagPayload({ name: 'onboarding_dismiss' }, 'beta')?.event).toBe(
      'Onboarding dismissed',
    )
  })

  test('an unknown task id is dropped, not passed through', () => {
    // /api/funnel is public and unauthenticated. Tags are BUILT from
    // allowlists, never forwarded, or anyone could write arbitrary tags into
    // the project's LogSnag.
    const payload = toLogSnagPayload({ name: 'onboarding_task_click', task: 'evil' }, 'beta')
    expect(payload).not.toBeNull()
    expect(payload?.tags.task).toBeUndefined()
  })

  test('unknown ids inside a task set are filtered out', () => {
    const payload = toLogSnagPayload({ name: 'onboarding_view', tasks: 'board,evil' }, 'beta')
    expect(payload?.tags.tasks).toBe('board')
  })

  test('a task set of only unknown ids sets no tag at all', () => {
    const payload = toLogSnagPayload({ name: 'onboarding_view', tasks: 'evil,worse' }, 'beta')
    expect(payload?.tags.tasks).toBeUndefined()
  })

  test('a repeated id cannot inflate the tag', () => {
    // The element-wise filter above bounds the ALPHABET to three known ids but
    // not the COUNT: 'board,'.repeat(100000) passes it untouched and forwards a
    // ~600KB tag to a third party from a public, unauthenticated endpoint.
    const payload = toLogSnagPayload(
      { name: 'onboarding_view', tasks: 'board,'.repeat(1000) },
      'beta',
    )
    expect(payload?.tags.tasks).toBe('board')
  })

  test('prototype-chain keys are not allowlisted values', () => {
    // TASK_IDS, PROVIDERS and METHODS are Sets, not object literals, for the
    // same reason EVENTS is a Map: an object-literal allowlist plus `in` or `[]`
    // lookup resolves '__proto__'/'constructor'/etc up the prototype chain and
    // passes a truthy check for a value that was never allowed.
    for (const hostile of ['__proto__', 'constructor', 'toString', 'valueOf']) {
      expect(
        toLogSnagPayload({ name: 'onboarding_task_click', task: hostile }, 'beta')?.tags.task,
      ).toBeUndefined()
      expect(
        toLogSnagPayload({ name: 'onboarding_view', tasks: hostile }, 'beta')?.tags.tasks,
      ).toBeUndefined()
      expect(
        toLogSnagPayload({ name: 'login_provider_click', provider: hostile }, 'beta')?.tags
          .provider,
      ).toBeUndefined()
      expect(
        toLogSnagPayload({ name: 'login_callback_arrived', method: hostile }, 'beta')?.tags
          .method,
      ).toBeUndefined()
    }
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run from `v2/`: `pnpm vitest run src/lib/funnel-payload.test.ts`
Expected: FAIL — `toLogSnagPayload` returns `null` for `onboarding_view`.

- [ ] **Step 3: Write minimal implementation**

In `v2/src/lib/funnel-payload.ts`, replace the `EVENTS` map with a `Record` keyed by
`FunnelEvent['name']` feeding a `Map`, so adding a variant to the union without an
entry here is a compile error rather than an event that silently vanishes at
runtime (this module exists precisely because server logs cannot explain a
funnel loss):

```ts
import type { FunnelEvent } from './funnel.ts'

// A RECORD FOR COMPLETENESS, A MAP FOR LOOKUP, and both halves matter.
// The Record's key type is FunnelEvent['name'], so adding a variant to that
// union without adding it here is a COMPILE error rather than an event that
// silently vanishes at runtime -- which is the worst failure this module can
// have, given it exists because server logs cannot explain a funnel loss.
// The lookup still goes through a Map because EVENTS['__proto__'] on a literal
// resolves up the prototype chain and passes a truthy check for a name that was
// never allowed; a unit test caught exactly that.
const EVENT_SPECS: Record<FunnelEvent['name'], { event: string; icon: string }> = {
  login_view: { event: 'Login viewed', icon: '👀' },
  login_provider_click: { event: 'Login provider clicked', icon: '🔘' },
  login_code_requested: { event: 'Login code requested', icon: '📧' },
  login_callback_arrived: { event: 'Login completed', icon: '✅' },
  onboarding_view: { event: 'Onboarding viewed', icon: '🧭' },
  onboarding_task_click: { event: 'Onboarding task clicked', icon: '👉' },
  onboarding_complete: { event: 'Onboarding complete', icon: '🎉' },
  onboarding_dismiss: { event: 'Onboarding dismissed', icon: '🙈' },
}
const EVENTS = new Map(Object.entries(EVENT_SPECS))
```

`import type` is fully erased at compile time (this repo's tsconfig sets
`verbatimModuleSyntax`, which enforces the `type` modifier on type-only
imports), so this does not give `funnel-payload.ts` a runtime dependency on
`funnel.ts` — it stays reachable from the Worker route exactly as before.

Below the existing `METHODS` set, add:

```ts
/**
 * The onboarding task ids, allowlisted for the same reason PROVIDERS is:
 * /api/funnel is public and unauthenticated, so tags are BUILT here and never
 * forwarded from the body. Must stay in step with OnboardingTaskId in
 * lib/onboarding-tasks.ts — a Set literal rather than an import because this
 * module is also reached from the Worker route and stays dependency-free.
 */
const TASK_IDS = new Set(['board', 'team', 'invite'])
```

In `toLogSnagPayload`, widen the destructure and add the two tag branches:

```ts
  const { name, provider, method, task, tasks } = body as Record<string, unknown>
```

and, after the existing `method` branch:

```ts
  if (typeof task === 'string' && TASK_IDS.has(task)) tags.task = task
  if (typeof tasks === 'string') {
    // Filtered element-wise, not accepted or rejected whole: a set carrying one
    // bad id still has useful known ids in it, and dropping the tag entirely
    // would lose them. An all-unknown set yields no tag rather than an empty one.
    //
    // Deduped, not just filtered. The filter alone bounds the ALPHABET to three
    // known ids but not the COUNT — 'board,'.repeat(100000) passes the filter
    // untouched and forwards a ~600KB tag to a third party from a public,
    // unauthenticated endpoint. That is both CPU cost (the split/filter/join
    // scales with input size) and Sentry-amplification risk (an oversized tag
    // hitting an undocumented LogSnag limit turns into a captureError in
    // logsnag.ts, and sentry-capture.ts has no sampling or dedupe). Dedupe
    // bounds the result at three by construction and is semantically right
    // anyway: a task SET should not contain duplicates, and taskSetKey can
    // never emit one. Set preserves first-seen order, so the canonical
    // board,team,invite ordering survives.
    const known = [...new Set(tasks.split(',').filter((id) => TASK_IDS.has(id)))]
    if (known.length > 0) tags.tasks = known.join(',')
  }
```

- [ ] **Step 4: Run test to verify it passes**

Run from `v2/`: `pnpm vitest run src/lib/funnel-payload.test.ts`
Expected: PASS, including all pre-existing login-event tests.

- [ ] **Step 5: Extend the client event union**

In `v2/src/lib/funnel.ts`, extend `FunnelEvent`:

```ts
export type FunnelEvent =
  | { name: 'login_view' }
  | { name: 'login_provider_click'; provider: string }
  | { name: 'login_code_requested' }
  | { name: 'login_callback_arrived'; method: 'oauth' | 'otp' }
  // ACTIVATION HALF (wordle-teams-qt4). The login events above answer "did they
  // get in"; these answer "did they then do anything", which is the larger leak
  // — 82% of players have never entered a board.
  //
  // `tasks` is the comma-joined incomplete set from taskSetKey, and it doubles
  // as the funnel STAGE: the player's own state is the stage, so there is no
  // separate step counter that can drift out of sync with what is on screen.
  | { name: 'onboarding_view'; tasks: string }
  | { name: 'onboarding_task_click'; task: string }
  | { name: 'onboarding_complete' }
  | { name: 'onboarding_dismiss' }
```

Nothing else in that module changes — `trackFunnel` and `send` are already generic over the union, and the fire-and-forget and no-PII rules apply unchanged.

- [ ] **Step 6: Typecheck and commit**

Run from `v2/`: `pnpm typecheck`
Expected: exits 0.

```bash
git add v2/src/lib/funnel.ts v2/src/lib/funnel-payload.ts v2/src/lib/funnel-payload.test.ts
git commit -m "feat(funnel): activation-half events for the onboarding card"
```

---

## Task 6: The card component

**Files:**
- Create: `v2/src/components/onboarding/next-step-card.tsx`
- Test: `v2/src/components/onboarding/next-step-card.hook.test.ts`

- [ ] **Step 1: Write the failing test**

Create `v2/src/components/onboarding/next-step-card.hook.test.ts`:

```ts
 // @vitest-environment jsdom
 //
 // jsdom, not the suite's default edge-runtime (vitest.config.ts), because this
 // renders the real component. `.hook.test.ts` matches the existing precedents,
 // and `.test.ts` rather than `.test.tsx` because vitest.config.ts's glob is
 // `src/**/*.test.ts`, so elements go through `createElement` by hand.
 //
 // WHY THIS FILE EXISTS: the dedupe below is invisible to every gate. Deleting
 // the emitted-set guard type-checks, lints, builds and passes every other
 // test — the card simply fires onboarding_view on every reactive invalidation
 // and drowns the LogSnag channel, which is only observable in production.
 import { cleanup, fireEvent, render, screen } from '@testing-library/react'
 import { createElement } from 'react'
 import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'
 import { NextStepCard } from './next-step-card.tsx'
 import { MODEL_LINE, type OnboardingFacts } from '#/lib/onboarding-tasks.ts'

 const sent: string[] = []

 vi.mock('#/lib/funnel.ts', () => ({
   trackFunnel: (event: { name: string; tasks?: string; task?: string }) => {
     sent.push([event.name, event.tasks ?? event.task ?? ''].join(':'))
   },
   SIGNIN_PARAM: 'signin',
 }))

 const nothing: OnboardingFacts = {
   enteredBoard: false,
   hasTeam: false,
   hasInvited: false,
   dismissed: false,
 }

 const noop = () => {}
 const handlers = { onBoard: noop, onTeam: noop, onInvite: noop, onDismiss: noop }

 beforeEach(() => {
   sent.length = 0
 })
 afterEach(cleanup)

 describe('NextStepCard', () => {
   test('renders the two tasks a fresh signup owes, and the model line', () => {
     render(createElement(NextStepCard, { facts: nothing, ...handlers }))
     expect(screen.getByText("Enter today's board")).toBeTruthy()
     expect(screen.getByText('Create a team')).toBeTruthy()
     expect(screen.getByText('Invite someone')).toBeTruthy()
     expect(screen.getByText(MODEL_LINE)).toBeTruthy()
   })

   test('an invited joiner sees only the board task', () => {
     const joiner = { ...nothing, hasTeam: true, hasInvited: true }
     render(createElement(NextStepCard, { facts: joiner, ...handlers }))
     expect(screen.getByText("Enter today's board")).toBeTruthy()
     // Satisfied tasks VANISH rather than rendering as pre-checked busywork the
     // user did not do. This is the design's wording and its intent.
     expect(screen.queryByText('Create a team')).toBeNull()
     expect(screen.queryByText('Invite someone')).toBeNull()
   })

   test('renders nothing once every task is complete', () => {
     const done = { enteredBoard: true, hasTeam: true, hasInvited: true, dismissed: false }
     const { container } = render(createElement(NextStepCard, { facts: done, ...handlers }))
     expect(container.textContent).toBe('')
     // SILENCE IS THE OTHER HALF, and textContent alone does not assert it: the
     // blank screen comes from `if (!visible) return null` in the render path,
     // so deleting the effect's own `if (!visible) return` leaves this passing
     // while every activated player emits `onboarding_view:` on every /app load.
     // That empty `tasks` is also exactly the empty-string key taskSetKey's doc
     // comment warns callers about.
     expect(sent).toEqual([])
   })

   test('renders nothing when dismissed', () => {
     const { container } = render(
       createElement(NextStepCard, { facts: { ...nothing, dismissed: true }, ...handlers }),
     )
     expect(container.textContent).toBe('')
     // As above: a dismissed player must be silent, not merely blank. Without
     // the effect's visibility gate this one emits the full task set forever.
     expect(sent).toEqual([])
   })

   test('emits onboarding_view once per task set, not once per render', () => {
     const { rerender } = render(createElement(NextStepCard, { facts: nothing, ...handlers }))
     rerender(createElement(NextStepCard, { facts: { ...nothing }, ...handlers }))
     rerender(createElement(NextStepCard, { facts: { ...nothing }, ...handlers }))
     expect(sent.filter((entry) => entry.startsWith('onboarding_view'))).toEqual([
       'onboarding_view:board,team',
     ])
   })

   test('emits again when the task set actually changes', () => {
     const { rerender } = render(createElement(NextStepCard, { facts: nothing, ...handlers }))
     rerender(createElement(NextStepCard, { facts: { ...nothing, hasTeam: true }, ...handlers }))
     expect(sent.filter((entry) => entry.startsWith('onboarding_view'))).toEqual([
       'onboarding_view:board,team',
       'onboarding_view:board,invite',
     ])
   })

   test('does not re-emit onboarding_view when an already-seen task set is re-entered', () => {
     // THIS is the test that actually pins the `reported` ref; the two above do
     // not. The effect's deps are [visible, key], both primitives, so React
     // already skips the effect on a rerender that leaves the task set alone —
     // delete the ref entirely and 'once per task set, not once per render'
     // still passes. The ref only earns its place when a set is RE-ENTERED, and
     // these facts do come back: an invite expires and hasInvited goes
     // true -> false, a team is deleted, a dismissal is undone. Without the ref
     // every such round trip puts another onboarding_view in the channel.
     const { rerender } = render(createElement(NextStepCard, { facts: nothing, ...handlers }))
     rerender(createElement(NextStepCard, { facts: { ...nothing, hasTeam: true }, ...handlers }))
     rerender(createElement(NextStepCard, { facts: { ...nothing }, ...handlers }))
     expect(sent.filter((entry) => entry.startsWith('onboarding_view'))).toEqual([
       'onboarding_view:board,team',
       'onboarding_view:board,invite',
     ])
   })

   test('does NOT emit onboarding_complete for someone who arrives already finished', () => {
     // Every activated player mounts this on every /app load with zero tasks.
     // Firing here would emit one completion per page view for the whole
     // activated population and destroy the metric this epic is measured by.
     const done = { enteredBoard: true, hasTeam: true, hasInvited: true, dismissed: false }
     render(createElement(NextStepCard, { facts: done, ...handlers }))
     expect(sent.filter((entry) => entry.startsWith('onboarding_complete'))).toEqual([])
   })

   test('emits onboarding_complete once when the last task finishes', () => {
     const { rerender } = render(
       createElement(NextStepCard, {
         facts: { ...nothing, hasTeam: true, hasInvited: true },
         ...handlers,
       }),
     )
     rerender(
       createElement(NextStepCard, {
         facts: { enteredBoard: true, hasTeam: true, hasInvited: true, dismissed: false },
         ...handlers,
       }),
     )
     expect(sent.filter((entry) => entry.startsWith('onboarding_complete'))).toEqual([
       'onboarding_complete:',
     ])
   })

   test('emits onboarding_complete once across a complete / un-complete / re-complete trip', () => {
     // THIS is the test that pins the `completed` latch; the one above does not.
     // The dep is [tasks.length] and that test rerenders into the zero-task
     // state exactly once, so React's memoization supplies the "once" on its
     // own — drop the latch and it still passes. The latch is for the round
     // trip, and these are the same facts coming back that the re-entry test
     // above lists: here the player finishes, deletes their team, and finishes
     // again. Without the latch that player is counted as activated twice, and
     // the activation number is the one thing this epic is measured by.
     const oneLeft = { ...nothing, hasTeam: true, hasInvited: true }
     const done = { enteredBoard: true, hasTeam: true, hasInvited: true, dismissed: false }
     const { rerender } = render(createElement(NextStepCard, { facts: oneLeft, ...handlers }))
     rerender(createElement(NextStepCard, { facts: done, ...handlers }))
     rerender(createElement(NextStepCard, { facts: { ...done, hasTeam: false }, ...handlers }))
     rerender(createElement(NextStepCard, { facts: done, ...handlers }))
     expect(sent.filter((entry) => entry.startsWith('onboarding_complete'))).toEqual([
       'onboarding_complete:',
     ])
   })

   test('every task button reports its own id and calls its own handler', () => {
     // ALL THREE, because `Record<OnboardingTaskId, () => void>` makes the KEYS
     // exhaustive and says nothing about which callback each key holds. Clicking
     // only one button leaves the other two edges of the map unpinned, and
     // swapping `board` and `team` in it — so that tapping "Enter today's board"
     // opens the Create Team dialog on the screen where signups already stall —
     // type-checks, lints and passes every other test.
     const calls: string[] = []
     render(
       createElement(NextStepCard, {
         facts: nothing,
         onBoard: () => calls.push('board'),
         onTeam: () => calls.push('team'),
         onInvite: () => calls.push('invite'),
         onDismiss: noop,
       }),
     )
     fireEvent.click(screen.getByRole('button', { name: /Enter today's board/ }))
     fireEvent.click(screen.getByRole('button', { name: /Create a team/ }))
     fireEvent.click(screen.getByRole('button', { name: /Invite someone/ }))
     expect(calls).toEqual(['board', 'team', 'invite'])
     expect(sent.filter((entry) => entry.startsWith('onboarding_task_click'))).toEqual([
       'onboarding_task_click:board',
       'onboarding_task_click:team',
       'onboarding_task_click:invite',
     ])
   })

   test('dismiss reports and calls its handler', () => {
     const calls: string[] = []
     render(
       createElement(NextStepCard, { facts: nothing, ...handlers, onDismiss: () => calls.push('x') }),
     )
     fireEvent.click(screen.getByRole('button', { name: /Dismiss/ }))
     expect(calls).toEqual(['x'])
     expect(sent).toContain('onboarding_dismiss:')
   })
 })
```

- [ ] **Step 2: Run test to verify it fails**

Run from `v2/`: `pnpm vitest run src/components/onboarding/next-step-card.hook.test.ts`
Expected: FAIL — cannot resolve `./next-step-card.tsx`.

- [ ] **Step 3: Write minimal implementation**

Create `v2/src/components/onboarding/next-step-card.tsx`:

```tsx
 import { useEffect, useRef } from 'react'
 import { X } from 'lucide-react'
 import { Button } from '#/components/ui/button.tsx'
 import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '#/components/ui/card.tsx'
 import { trackFunnel } from '#/lib/funnel.ts'
 import {
   MODEL_LINE,
   cardHeading,
   incompleteTasks,
   shouldShowCard,
   taskSetKey,
   type OnboardingFacts,
   type OnboardingTaskId,
 } from '#/lib/onboarding-tasks.ts'

 /**
  * What a player who has not finished onboarding sees at the top of /app.
  *
  * REPLACES TeamsEmptyState OUTRIGHT. That component handled exactly one state —
  * "you have no team" — which is now one of three tasks here, and it rendered
  * INSTEAD of the dashboard, which is why a team-less player had nothing to do
  * (wordle-teams-456 traced a signup whose entire lifetime was 39 seconds and
  * ended on that screen).
  *
  * PRESENTATIONAL. Every action is a callback, because the dialogs these open
  * are already mounted by routes/app.tsx and owning them here would mean a
  * second CreateTeamDialog on the same page.
  */
 export function NextStepCard({
   facts,
   onBoard,
   onTeam,
   onInvite,
   onDismiss,
 }: {
   facts: OnboardingFacts
   onBoard: () => void
   onTeam: () => void
   onInvite: () => void
   onDismiss: () => void
 }) {
   const tasks = incompleteTasks(facts)
   const visible = shouldShowCard(facts)
   const key = taskSetKey(tasks)

   /**
    * THE DEDUPE, and the reason this component has a test at all.
    *
    * This card renders from a reactive Convex subscription, and getMyTeams is
    * invalidated by every team in the system (teams.ts:61). Emitting on render
    * would put an onboarding_view in LogSnag every time any stranger renamed a
    * team. The ref holds the task sets already reported in THIS mount, so the
    * event fires on genuine state changes and nothing else.
    *
    * A ref rather than state: recording what we sent must not itself cause a
    * render, or the effect re-runs and we are back where we started.
    *
    * PER MOUNT IS THE DELIBERATE SCOPE, not an accident of using a ref. A fresh
    * mount means a genuine navigation back to /app, which is a genuine new view;
    * hoisting this to a module-level Set would dedupe across the whole session
    * and make the view/click ratio meaningless as a funnel denominator, since
    * the clicks would keep counting while the views stopped. What the ref is
    * for is the SAME mount re-entering a set it already reported — see the
    * re-entry test, and note the dep array alone does not cover that.
    *
    * Allocated lazily inside the effect: `useRef(new Set())` would build and
    * discard a Set on every render.
    */
   const reported = useRef<Set<string> | null>(null)
   useEffect(() => {
     if (!visible) return
     const seen = (reported.current ??= new Set<string>())
     if (seen.has(key)) return
     seen.add(key)
     trackFunnel({ name: 'onboarding_view', tasks: key })
   }, [visible, key])

   /**
    * Completion, emitted once, ON THE TRANSITION rather than on the state.
    *
    * `sawIncomplete` is the whole point and this is wrong without it. An
    * activated player mounts this component on EVERY /app load with zero
    * incomplete tasks, so firing whenever `tasks.length === 0` would emit an
    * onboarding_complete per page view for the entire activated population —
    * swamping the channel and destroying the one number this epic is measured
    * by. The event has to mean "they just finished", which requires having seen
    * them unfinished first.
    *
    * A dismissal is deliberately NOT a completion; it is its own event, or the
    * activation number would flatter itself.
    *
    * `completed` IS A SEPARATE GUARD FROM `sawIncomplete`, AND ALSO LOAD-BEARING.
    * The dep is [tasks.length], so React's own memoization delivers "once" for a
    * one-way trip and hides this latch entirely. It earns its place on a ROUND
    * TRIP: tasks.length goes 0 -> 1 -> 0 whenever a fact comes back — a team is
    * deleted and recreated, an invite is cancelled, a dismissal is undone — and
    * without the latch every such cycle emits another onboarding_complete and
    * inflates the activation count permanently.
    */
   const sawIncomplete = useRef(false)
   const completed = useRef(false)
   useEffect(() => {
     if (tasks.length > 0) {
       sawIncomplete.current = true
       return
     }
     if (!sawIncomplete.current || completed.current) return
     completed.current = true
     trackFunnel({ name: 'onboarding_complete' })
   }, [tasks.length])

   if (!visible) return null

   const act = (id: OnboardingTaskId, run: () => void) => () => {
     trackFunnel({ name: 'onboarding_task_click', task: id })
     run()
   }

   const runners: Record<OnboardingTaskId, () => void> = {
     board: onBoard,
     team: onTeam,
     invite: onInvite,
   }

   return (
     <Card className="mb-4">
       <CardHeader className="relative">
         <CardTitle asChild>
           <h2>{cardHeading(facts)}</h2>
         </CardTitle>
         <CardDescription>{MODEL_LINE}</CardDescription>
         {/*
           An icon-only control needs a real accessible name. v1's tooltip-only
           OAuth labels are the cautionary tale this app already paid for
           (wordle-teams-390): a Tooltip does not open on tap, and the login
           traffic here is heavily iPhone.
         */}
         <Button
           variant="ghost"
           size="icon"
           aria-label="Dismiss getting started"
           className="absolute right-2 top-2"
           onClick={() => {
             trackFunnel({ name: 'onboarding_dismiss' })
             onDismiss()
           }}
         >
           <X size={16} />
         </Button>
       </CardHeader>
       <CardContent className="flex flex-col gap-2">
         {tasks.map((task) => (
           <Button
             key={task.id}
             variant="outline"
             className="h-auto w-full justify-start whitespace-normal py-3 text-left"
             onClick={act(task.id, runners[task.id])}
           >
             {/*
               `whitespace-normal` on the Button above overrides the
               `whitespace-nowrap` in buttonVariants' base (ui/button.tsx), and
               `break-words` here is the same pairing chat/message-list.tsx:721
               and confirm-popover.tsx:46 already use. Without both, the longest
               hint — "A scoreboard needs someone to score against" — escapes the
               button border at 360px and forces the whole document to scroll
               horizontally at 320px. `h-auto` lets the button grow but nothing
               in it lets the text wrap.
             */}
             <span className="flex flex-col items-start">
               <span className="font-semibold">{task.title}</span>
               <span className="text-muted-foreground break-words text-sm font-normal">
                 {task.hint}
               </span>
             </span>
           </Button>
         ))}
       </CardContent>
     </Card>
   )
 }
```

- [ ] **Step 4: Run test to verify it passes**

Run from `v2/`: `pnpm vitest run src/components/onboarding/next-step-card.hook.test.ts`
Expected: PASS, 12 tests.

If the accessible-name query fails, check how `Button` composes its content in `src/components/ui/button.tsx` — the name is the visible text, and the dismiss control's name comes from `aria-label`.

- [ ] **Step 5: Commit**

```bash
git add v2/src/components/onboarding/
git commit -m "feat(onboarding): the next-step card"
```

---

## Task 7: Wire the card into `/app` and delete the empty state

> **SEQUENCING CORRECTED 2026-09-07: run Task 8 BEFORE this one.** As originally
> written, Task 7 shipped a card whose "Enter today's board" task had nothing to
> open for a team-less player, and the plan managed that with a "must land
> together" warning instead of fixing it. Task 8's steps are independent of this
> one, so running it first removes the broken intermediate state entirely. Task 8
> now also extracts `BoardEntrySurface`, which this task's `onBoard` renders.
> The beads edge is flipped to match: `qt4.7` depends on `qt4.8`.

**Files:**
- Modify: `v2/src/routes/app.tsx` (imports; the `teams.length === 0` branch at 222-232; the main render)
- Delete: `v2/src/components/teams/empty-state.tsx`
- Test: `v2/src/routes.test.ts` (only if it references the deleted file)

- [ ] **Step 1: Confirm nothing else imports the empty state**

Run from `v2/`:

```bash
grep -rn "empty-state\|TeamsEmptyState" src/ convex/ e2e/ 2>/dev/null
```

Expected: only `src/routes/app.tsx:19` and `src/components/teams/empty-state.tsx` itself. **If anything else appears — an e2e spec especially — update it in this task rather than leaving a dangling import.**

- [ ] **Step 2: Replace the import**

In `v2/src/routes/app.tsx`, delete line 19 (`import { TeamsEmptyState } ...`) and add alongside the other component imports:

```ts
import { NextStepCard } from '#/components/onboarding/next-step-card.tsx'
import { onboardingFactsFrom } from '#/lib/onboarding-facts.ts'
```

- [ ] **Step 3: Write the failing test for the facts adapter**

Create `v2/src/lib/onboarding-facts.test.ts`:

```ts
import { describe, expect, test } from 'vitest'
import { onboardingFactsFrom } from './onboarding-facts.ts'

const team = (over: Partial<{ members: unknown[]; hasPendingInvite: boolean }> = {}) => ({
  members: [{ id: 'p1' }],
  hasPendingInvite: false,
  ...over,
})

describe('onboardingFactsFrom', () => {
  test('no teams and no status means everything is outstanding', () => {
    expect(onboardingFactsFrom([], null)).toEqual({
      enteredBoard: false,
      hasTeam: false,
      hasInvited: false,
      dismissed: false,
    })
  })

  test('a solo team with no invite satisfies hasTeam only', () => {
    const facts = onboardingFactsFrom([team()], { enteredBoard: false, dismissed: false })
    expect(facts.hasTeam).toBe(true)
    expect(facts.hasInvited).toBe(false)
  })

  test('a second member satisfies hasInvited', () => {
    const facts = onboardingFactsFrom(
      [team({ members: [{ id: 'p1' }, { id: 'p2' }] })],
      { enteredBoard: false, dismissed: false },
    )
    expect(facts.hasInvited).toBe(true)
  })

  test('a pending invite satisfies hasInvited even on a solo team', () => {
    const facts = onboardingFactsFrom([team({ hasPendingInvite: true })], {
      enteredBoard: false,
      dismissed: false,
    })
    expect(facts.hasInvited).toBe(true)
  })

  test('hasInvited is global — any one team satisfying it is enough', () => {
    // Deliberate. The task is "be in a room with someone", and someone already
    // on a populated team should not be nagged after later making a solo one.
    const facts = onboardingFactsFrom(
      [team({ members: [{ id: 'p1' }, { id: 'p2' }] }), team()],
      { enteredBoard: false, dismissed: false },
    )
    expect(facts.hasInvited).toBe(true)
  })

  test('status flows straight through', () => {
    const facts = onboardingFactsFrom([], { enteredBoard: true, dismissed: true })
    expect(facts.enteredBoard).toBe(true)
    expect(facts.dismissed).toBe(true)
  })
})
```

- [ ] **Step 4: Run it and watch it fail**

Run from `v2/`: `pnpm vitest run src/lib/onboarding-facts.test.ts`
Expected: FAIL — cannot resolve `./onboarding-facts.ts`.

- [ ] **Step 5: Write the adapter**

Create `v2/src/lib/onboarding-facts.ts`:

```ts
import type { OnboardingFacts } from './onboarding-tasks.ts'

/** The shape this needs off getMyTeams. Structural, so codegen is not imported. */
type TeamSummary = { members: unknown[]; hasPendingInvite: boolean }

/** The shape this needs off onboarding.getStatus. */
type Status = { enteredBoard: boolean; dismissed: boolean } | null | undefined

/**
 * Joins the two subscriptions into the four booleans the card renders from.
 *
 * PURE AND SEPARATE FROM THE ROUTE so the global-hasInvited rule is asserted by
 * a plain unit test rather than by reading routes/app.tsx. That rule is the one
 * a future reader is most likely to "fix" into a per-team check.
 */
export function onboardingFactsFrom(teams: TeamSummary[], status: Status): OnboardingFacts {
  return {
    enteredBoard: status?.enteredBoard ?? false,
    hasTeam: teams.length > 0,
    // GLOBAL, not per team. See the test of the same name.
    hasInvited: teams.some((team) => team.members.length > 1 || team.hasPendingInvite),
    dismissed: status?.dismissed ?? false,
  }
}
```

- [ ] **Step 6: Run it and watch it pass**

Run from `v2/`: `pnpm vitest run src/lib/onboarding-facts.test.ts`
Expected: PASS, 6 tests.

- [ ] **Step 7: Render the card in the route**

> **REWRITTEN 2026-09-07, after Task 8 landed.** The previous version predated
> `BoardEntrySurface` and left `onBoard` as "wire it to the existing button's open
> state if one is lifted". It also missed a hydration hazard and two findings that
> came out of Task 8's review. All four are handled below.

Add to the component body, near the existing `teams` query:

```ts
  const { data: onboardingStatus } = useSuspenseQuery(convexQuery(api.onboarding.getStatus, {}))
  const dismissOnboarding = useMutation({
    mutationFn: useConvexMutation(api.onboarding.dismiss),
  })
  const onboardingFacts = onboardingFactsFrom(teams, onboardingStatus)

  const [boardOpen, setBoardOpen] = useState(false)
  const [boardMonth, setBoardMonth] = useState<string | null>(null)
```

`useMutation` / `useConvexMutation` come from `@tanstack/react-query` and `@convex-dev/react-query`, matching `create-team-dialog.tsx:4-5`.

**The month is a client-only fact, and this is the hydration hazard.** The `teams.length === 0` branch returns at `app.tsx:222`, *before* the `!teamParam || !monthParam` guard at `:238` fills the params in — so a team-less player has no `monthParam` at all. Deriving "this month" during render would put a server-rendered guess into the HTML and mismatch on hydration, which is a minified React #418 in production; `today-panel.tsx` and `scores-table.tsx` both document this rule. Compute it in the **click handler** instead, which is post-hydration by construction:

```tsx
  const onboarding = (
    <NextStepCard
      facts={onboardingFacts}
      onBoard={() => {
        // `today` is client-only. Deriving it here rather than during render is
        // what keeps it out of the SSR pass — the rule today-panel.tsx states.
        setBoardMonth(monthParam ?? monthOf(toPuzzleDay(new Date())))
        setBoardOpen(true)
      }}
      onTeam={() => setCreateOpen(true)}
      onInvite={() => void navigate({ to: '/team', search: { team: teamParam } })}
      onDismiss={() => void dismissOnboarding.mutateAsync({})}
    />
  )
```

`monthOf` and `toPuzzleDay` are already imported in this file.

**Why not reuse the existing pattern?** `app.tsx:252` already does exactly this
guard — `const currentMonth = hydrated ? monthOf(toPuzzleDay(new Date())) : monthParam`,
via `useHydrated()` at `:118`. It is the right idiom and you should read it. But it
sits *below* the `teams.length === 0` early return at `:222`, so it is not reachable
from the branch that needs it, and hoisting it would make every render of the
no-team branch depend on a hydration flag for a value only a click ever consumes.
Computing it in the handler is post-hydration by construction and needs no flag.
If you find hoisting cleaner once you are in the file, that is a defensible call —
say so in your report rather than doing it silently.

Then the surface itself, rendered by both branches. **Give it its own Suspense boundary** — this is Task 8's review finding: `BoardEntryButton` sits at `:537`, above all three existing boundaries (`:579`, `:587`, `:639`). On the team path that never bites because `getTeamMonth` is already warm from `TodayPanel`. Nothing warms `getMyMonth`, so without a boundary here the **first** tap by a team-less player suspends all the way to the route boundary and blanks the page — hitting precisely the person this epic exists to convert, on their first meaningful action:

```tsx
  const boardSurface = boardMonth && (
    <Suspense fallback={null}>
      <BoardEntrySurface
        open={boardOpen}
        onOpenChange={setBoardOpen}
        // NOT `as Id<'teams'>`. Since Task 8 made teamId optional, an undefined
        // slipping through a bare cast no longer throws inside getTeamMonth —
        // it silently routes to the solo form and shows a team-less prefill on
        // a team page. Keeping `| undefined` in the type makes the team-less
        // case explicit rather than accidental.
        teamId={teamParam as Id<'teams'> | undefined}
        month={boardMonth}
      />
    </Suspense>
  )
```

No `trigger` prop: the card's task button is the trigger, and `BoardEntrySurface` renders no button without it — pinned by `button.hook.test.ts`'s `no trigger prop means no button`.

Replace the `teams.length === 0` branch (`:222-232`) with:

```tsx
  if (teams.length === 0) {
    return (
      <main className="page-max mt-2 md:mt-6">
        {upgradePending && <CheckoutPending className="mb-4" />}
        {onboarding}
        {boardSurface}
        <CreateTeamDialog
          open={createOpen}
          onOpenChange={setCreateOpen}
          onCreated={(team) => navigate({ to: Route.fullPath, search: { team }, replace: true })}
        />
      </main>
    )
  }
```

And render `{onboarding}` as the first child of the main dashboard container, immediately above `TodayPanel`, with `{boardSurface}` alongside the other dialogs.

**`onInvite` navigates to `/team`** for now, where `CurrentTeamCard` already hosts `InvitePlayerDialog`. Plan B's Task 5 repoints it at the share-a-link dialog.

> **THIS PARAGRAPH USED TO END WITH A FALSE CLAIM**, corrected 2026-09-07 after
> Task 7 shipped it into a code comment: "The invite task cannot be reached from
> the no-team branch anyway: `hasTeam` false means the create task is showing
> too." Both halves are wrong. `incompleteTasks` pushed `invite` on
> `!hasInvited` ALONE, with no `hasTeam` dependence, so the two tasks rendered
> TOGETHER for a fresh signup — and the create task being on screen was never a
> reason the invite one would not be. A team-less player could tap it, fire a
> funnel click, navigate to `/team` with `team: undefined` and be redirected
> straight back to `/app`.
>
> The fix is in the pure module, not here: `incompleteTasks` now gates the
> invite push on `facts.hasTeam`, so `teamParam` is guaranteed defined wherever
> this callback can run. See the correction note on Task 1.

- [ ] **Step 8: Delete the empty state, and fix every e2e assertion that named it**

```bash
git rm v2/src/components/teams/empty-state.tsx
```

**FIVE e2e references depend on that component's heading, across THREE files** — verified by grep on 2026-09-07, and this is more than an earlier note in this plan claimed:

```
e2e/complete-profile.spec.ts:45    getByRole('heading', { name: /not on a team yet/i })
e2e/complete-profile.spec.ts:53    same
e2e/complete-profile.spec.ts:129   same
e2e/invites.spec.ts:414            same, on the `newcomer` context
e2e/board-entry.spec.ts:10         prose in a doc comment, not an assertion
```

Update the four assertions to the card's heading, and correct the comment. **This will not be caught by any gate** — e2e sits outside `test`/`lint`/`typecheck`/`build`, so all four stay green while these rot. Run `pnpm exec playwright test e2e/complete-profile.spec.ts e2e/invites.spec.ts` before you commit, after checking what holds port 3000.

Decide deliberately whether `/app` should carry an `h1` once this component is gone — it is currently the route's only one. The card's `h2` is the right *relative* level (`TodayPanel:93` is also `h2`), so the honest options are to promote the card's heading on this route or to accept that `/app` starts at `h2`. Either is defensible; picking one by accident is not.

- [ ] **Step 9: Run all four gates**

Run from `v2/`, capturing exit codes directly — **zsh `PIPESTATUS` is empty, so a piped check reports a false green**:

```bash
pnpm test:once; echo "test=$?"
pnpm lint;      echo "lint=$?"
pnpm typecheck; echo "typecheck=$?"
pnpm build;     echo "build=$?"
```

Expected: all four `=0`.

- [ ] **Step 10: Commit**

```bash
git add -A v2/src/routes/app.tsx v2/src/lib/onboarding-facts.ts v2/src/lib/onboarding-facts.test.ts v2/src/components/teams/empty-state.tsx
git commit -m "feat(onboarding): render the next-step card on /app, retire TeamsEmptyState"
```

---

## Task 8: Team-less board entry

> **RUN THIS BEFORE TASK 7** (sequencing corrected 2026-09-07). Nothing here
> touches `src/routes/app.tsx`; all route wiring is Task 7's. See that task's
> banner for why the order changed.

**Files:**
- Modify: `v2/convex/scores.ts` (add a team-less prefill query)
- Modify: `v2/src/components/board-entry/form.tsx:39-47`
- Modify: `v2/src/components/board-entry/button.tsx`
- Test: `v2/convex/scores.test.ts`
- Test (new): `v2/src/components/board-entry/button.hook.test.ts` — the trigger render prop
- Test (new): `v2/src/components/board-entry/form.hook.test.ts` — prefill scoping and the solo `playWeekends` default

Both test files were added by Step 9 after review; the directory previously held only `board-input.test.ts` and `pick-default-day.test.ts`, so neither `form.tsx` nor `button.tsx` had any test at all.

**Why this task exists.** `upsertBoard` takes no `teamId` (`convex/scores.ts:256`) and `dailyScores` has no team column, so the *write* already works with no team. Only the *read* is blocked: `BoardEntryForm` gets its prefill from `getTeamMonth(teamId, month)` (`form.tsx:47`) and its `showLetters` from the team. This is the one piece of "let them play immediately" that is not free.

> **REWRITTEN 2026-09-07 against the real `form.tsx`.** The original steps
> specified a `getMyBoard({ puzzleDay })` query and two conditional
> `useSuspenseQuery` calls. Both were wrong: the form needs a whole MONTH of the
> player's scores (`form.tsx:64` builds a `Set` of played days to pick a default),
> and `useSuspenseQuery` does not accept `enabled` in TanStack Query v5, so the
> conditional-query shape is not expressible. Verified: the form consumes exactly
> two things from `getTeamMonth` — the caller's own scores, and
> `team.playWeekends` (`:70`, `:167`). It never reads `showLetters`.

- [ ] **Step 1: Write the failing test for a month-scoped query**

Append to `v2/convex/scores.test.ts`, matching that file's existing idiom:

```ts
describe('scores.getMyMonth', () => {
  test("returns only the caller's own scores, only for the month asked for", async () => {
    const t = convexTest(schema, modules)
    betterAuthTest.register(t)
    await t.run(async (ctx) => {
      const ada = await ctx.db.insert('players', aPlayer())
      const bob = await ctx.db.insert('players', aPlayer({ email: 'bob@example.com' }))
      for (const [playerId, puzzleDay] of [
        [ada, '2026-09-01'],
        [ada, '2026-09-30'],
        [ada, '2026-08-31'],
        [ada, '2026-10-01'],
        [bob, '2026-09-15'],
      ] as const) {
        await ctx.db.insert('dailyScores', {
          playerId,
          puzzleDay,
          date: Date.now(),
          answer: 'crane',
          guesses: ['crane'],
        })
      }
    })
    const as = await authenticatedAs(t, 'member@example.com')
    const scores = await as.query(api.scores.getMyMonth, { month: '2026-09' })
    // Boundaries both included, neighbouring months both excluded, and nothing
    // of Bob's — the month filter is a lexical range on puzzleDay, so an
    // off-by-one at either end is a silent data bug rather than an error.
    expect(scores.map((score) => score.puzzleDay)).toEqual(['2026-09-01', '2026-09-30'])
  })

  test('includes the 31st of a 31-day month', async () => {
    // THE UPPER BOUND IS '<month>-31', AND SEPTEMBER CANNOT PROVE IT. Every
    // assertion in the test above passes just as well with a bound of
    // '<month>-30', because no September day exceeds it — so that test guards
    // the lower bound and the player filter, but not this. Only a 31-day month
    // separates the two, and getting it wrong silently drops the last board of
    // seven months a year: no error, no empty state, just a day the player
    // entered that the form no longer prefills.
    const t = convexTest(schema, modules)
    betterAuthTest.register(t)
    await t.run(async (ctx) => {
      const ada = await ctx.db.insert('players', aPlayer())
      for (const puzzleDay of ['2026-10-01', '2026-10-31', '2026-11-01']) {
        await ctx.db.insert('dailyScores', {
          playerId: ada,
          puzzleDay,
          date: Date.now(),
          answer: 'crane',
          guesses: ['crane'],
        })
      }
    })
    const as = await authenticatedAs(t, 'member@example.com')
    const scores = await as.query(api.scores.getMyMonth, { month: '2026-10' })
    expect(scores.map((score) => score.puzzleDay)).toEqual(['2026-10-01', '2026-10-31'])
  })

  test('carries the same fields getTeamMonth puts on a score', async () => {
    // The form derives from ONE shape regardless of which query fed it, so a
    // drift here is a runtime break in the team-less branch only.
    const t = convexTest(schema, modules)
    betterAuthTest.register(t)
    await t.run(async (ctx) => {
      const ada = await ctx.db.insert('players', aPlayer())
      await ctx.db.insert('dailyScores', {
        playerId: ada,
        puzzleDay: '2026-09-02',
        date: Date.now(),
        answer: 'crane',
        guesses: ['stare', 'crane'],
      })
    })
    const as = await authenticatedAs(t, 'member@example.com')
    const [score] = await as.query(api.scores.getMyMonth, { month: '2026-09' })
    expect(Object.keys(score).sort()).toEqual(['answer', 'guesses', 'id', 'puzzleDay'])
    expect(score).toMatchObject({ answer: 'crane', guesses: ['stare', 'crane'] })
  })

  test("a row with no answer at all comes back as '', not undefined", async () => {
    // THE `?? ''` FALLBACK, WHICH NOTHING ELSE IN THIS FILE REACHES. `answer`
    // is v.optional in the schema — v1 rows predate it — and getTeamMonthFor
    // coalesces it for exactly that reason (scores.ts:96-101). Drop the
    // coalesce here and all four gates stay green: the shape test above asserts
    // Object.keys, which still lists `answer` when the value is undefined, and
    // every other fixture in this file sets one. The TYPE link does not catch
    // it either — `string | undefined` still satisfies the team branch's
    // `string`. Only a row with the field genuinely absent proves it, and the
    // symptom it prevents is React dropping an uncontrolled contentEditable
    // back to its previous text in the entry form.
    const t = convexTest(schema, modules)
    betterAuthTest.register(t)
    await t.run(async (ctx) => {
      const ada = await ctx.db.insert('players', aPlayer())
      await ctx.db.insert('dailyScores', {
        playerId: ada,
        puzzleDay: '2026-09-04',
        date: Date.now(),
        guesses: ['stare'],
      })
    })
    const as = await authenticatedAs(t, 'member@example.com')
    const [score] = await as.query(api.scores.getMyMonth, { month: '2026-09' })
    expect(score.answer).toBe('')
  })

  test('is empty rather than throwing for a caller with no player row', async () => {
    const t = convexTest(schema, modules)
    betterAuthTest.register(t)
    const as = await authenticatedAs(t, 'nobody@example.com')
    expect(await as.query(api.scores.getMyMonth, { month: '2026-09' })).toEqual([])
  })
})
```

**Three corrections found during implementation, already folded into the block above.** `aPlayer()`'s default email is `member@example.com`, not `ada@example.com`. `authenticatedAs` requires `betterAuthTest.register(t)` first, which the original block omitted. And the query reuses `monthRange(month)` from `convex/lib/puzzleDay.ts:51` — already imported in `scores.ts` and already what `getTeamMonthFor` uses — rather than inlining the same template literals.

**A fourth correction is why there are four tests rather than three.** The original block claimed its boundary assertion guarded "an off-by-one at either end". It did not: mutating the upper bound from `-31` to `-30` SURVIVED, because September has no 31st, so both bounds include `2026-09-30` identically. Only a **31-day** month separates them, which is what the October test exists for. This is the same recurring shape as four earlier defects in this plan — an assertion satisfied by something other than the guard it is named for.

- [ ] **Step 2: Run it and watch it fail**

`pnpm vitest run convex/scores.test.ts -t getMyMonth` → FAIL, `api.scores.getMyMonth` undefined.

- [ ] **Step 3: Write the query**

Add to `v2/convex/scores.ts`:

```ts
/**
 * The caller's own scores for one month, with no team in the question.
 *
 * WHY THIS EXISTS. Boards are PLAYER-owned: upsertBoard takes no teamId and
 * dailyScores has no team column, so a player with no team can already WRITE
 * one. Only the read was blocked — the entry form prefilled from getTeamMonth,
 * which needs a team a brand-new signup does not have. wordle-teams-456 traced
 * a signup whose whole life was 39 seconds on a team-less screen with nothing
 * to do; this is what gives them something to do.
 *
 * A MONTH, NOT A DAY. The form picks a default day from the set of days already
 * played (form.tsx:64), so a single-day read cannot feed it.
 *
 * THE SAME SCORE SHAPE getTeamMonthFor emits (scores.ts:96-101), deliberately,
 * so the form derives from one shape whichever query fed it. It reads the same
 * index through the same monthRange bounds for the same reason: given a
 * WELL-FORMED 'YYYY-MM', `end` is '<month>-31' as a LEXICAL bound on
 * 'YYYY-MM-DD', so it includes a 30-day month's last day and cannot reach into
 * the next month.
 *
 * THAT GUARANTEE IS CONDITIONAL ON THE ARGUMENT'S SHAPE, and `v.string()` does
 * not enforce it: `{ month: '2026' }` bounds '2026-01'..'2026-31', which
 * lexically brackets every day of the year. The route is what enforces the
 * shape — app.tsx's validateSearch requires /^\d{4}-\d{2}$/ before a month can
 * reach here — and getTeamMonthFor has exactly the same property, so this is a
 * shared pre-existing contract rather than something to patch in one caller.
 *
 * NULL-SAFE FOR A MISSING PLAYER, like onboarding.getStatus: this renders on
 * /app, which is reachable in the window before a player row exists.
 */
export const getMyMonth = query({
  args: { month: v.string() },
  handler: async (ctx, { month }) => {
    const player = await currentPlayer(ctx)
    if (!player) return []
    const { start, end } = monthRange(month)
    const scores = await ctx.db
      .query('dailyScores')
      .withIndex('by_player_and_puzzleDay', (q) =>
        q.eq('playerId', player._id).gte('puzzleDay', start).lte('puzzleDay', end),
      )
      .collect()
    return scores.map((score) => ({
      id: score._id,
      puzzleDay: score.puzzleDay,
      answer: score.answer ?? '',
      guesses: score.guesses,
    }))
  },
})
```

`${month}-31` as the upper bound is a lexical comparison on `YYYY-MM-DD`, so it correctly includes a 30-day month's last day and cannot reach into the next month **for a well-formed `YYYY-MM`**. It is not a validator: `{ month: '2026' }` bounds `'2026-01'..'2026-31'` and returns the whole year. `app.tsx`'s `validateSearch` enforces `/^\d{4}-\d{2}$/` before a month can reach here, and `getTeamMonthFor` shares the property, so this is a pre-existing contract of the pair rather than something to patch in one caller — do not add validation to just this query. Confirm `currentPlayer` is imported in this file; `requirePlayer` already is.

- [ ] **Step 4: Run it and watch it pass**

`pnpm vitest run convex/scores.test.ts` → PASS, including every pre-existing test.

- [ ] **Step 5: Split the form by data source, not by condition**

`useSuspenseQuery` has no `enabled` option, and hooks cannot be called conditionally — but COMPONENTS can. Restructure `v2/src/components/board-entry/form.tsx` (currently 248 lines) into four pieces in the same file:

1. `BoardEntryFields` — everything the form renders today, taking `{ myScores, playWeekends, month, onSuccess }` as props and owning no query. This is a move of the existing body; do not rewrite its logic, its `pickDefaultDay` effect, or its submit handling.
2. `TeamBoardEntryForm({ teamId, month, onSuccess })` — keeps today's two `useSuspenseQuery` calls (`getTeamMonth` and `getMyPlayerId`), derives `myScores` exactly as `form.tsx:51` does now, and renders `BoardEntryFields` with `playWeekends={data.team.playWeekends}`.
3. `SoloBoardEntryForm({ month, onSuccess })` — one `useSuspenseQuery` on `api.scores.getMyMonth`, and `playWeekends={true}`. That default is v1's for a new team (`create-team-dialog.tsx` defaults both switches on), so a team-less player sees what they would see on the team they are about to create.
4. `BoardEntryForm({ teamId, month, onSuccess })` — the existing export, now with `teamId?: Id<'teams'>`, returning `SoloBoardEntryForm` when `teamId` is undefined and `TeamBoardEntryForm` otherwise.

The team path must be behaviourally unchanged. `getMyPlayerId` stays in the team branch only — the solo branch does not need it, because `getMyMonth` is already scoped to the caller.

- [ ] **Step 6: Split the surface from its trigger**

> This step was accidentally deleted from an earlier revision of this plan and is
> restored here documenting **what actually shipped in `70cbbc9`**, not a fresh
> design. The implementer built it from prose when they found the step missing.

`BoardEntryButton` owns `open` in local state behind a `DialogTrigger` / `SheetTrigger` whose trigger **is** its visible button. The onboarding card's task button is a different control that must open the same surface and cannot reach a trigger's internal state. So extract the body into a controlled component that the button composes:

```tsx
export function BoardEntrySurface({
  open,
  onOpenChange,
  teamId,
  month,
  trigger,
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
  teamId?: Id<'teams'>
  month: string
  trigger?: (isDesktop: boolean) => ReactNode
})
```

**`trigger` is a render prop, and that is forced rather than stylistic.** The desktop and mobile triggers differ — visible text versus an `aria-label` — and a Radix trigger must be a descendant of its own root, so the caller cannot hand over one node and the `useMediaQuery` call has to stay inside the surface. Task 7 omits `trigger` entirely for the card's controlled panel.

`BoardEntryButton` keeps its `useState`, its two trigger buttons and its `label` prop, and renders the surface. **Its rendered DOM must be unchanged** — `e2e/board-entry.spec.ts` selects on `getByRole('button', { name: 'Board Entry' })` and `getByRole('dialog', { name: 'Add or Update Board' })`, and e2e sits outside the four gates, so a regression here is invisible to them.

The `label` prop matters: two controls sharing one accessible name is a hazard for a locator and a screen reader both (`button.tsx:36-46`), and after Task 7 `/app` carries the toolbar button *and* the card's task button on one page.

**Do NOT touch `src/routes/app.tsx`.** All route wiring is Task 7's.

- [ ] **Step 7: Run all four gates**

```bash
pnpm test:once; echo "test=$?"
pnpm lint;      echo "lint=$?"
pnpm typecheck; echo "typecheck=$?"
pnpm build;     echo "build=$?"
```

Expected: all four `=0`. The rendered app is unchanged by this task — `BoardEntryButton` looks and behaves exactly as before; only its internals moved.

- [ ] **Step 8: Commit**

```bash
git add v2/convex/scores.ts v2/convex/scores.test.ts v2/src/components/board-entry/
git commit -m "feat(board-entry): let a team-less player enter today's board"
```

- [ ] **Step 9: Defend it (added after review of `70cbbc9`)**

The code above was reviewed and found correct — the form-body diff is a pure move, `BoardEntryButton`'s DOM and accessible names are identical at both breakpoints, and `getMyMonth` is right across every month of a leap and a common year. **The defences were not.** Six mutants were planted against the shipped commit and four survived all four gates; one survived the e2e suite as well. Every one is this plan's recurring shape — *an assertion satisfied by something other than the guard it is named for*.

| Mutant | Why it lived |
| --- | --- |
| Invert the `trigger` callback so each breakpoint renders the other's trigger | Both triggers answer to `getByRole('button', { name: 'Board Entry' })` — that is what `label` is for — so all five e2e specs are blind. Symptom is `text-sm` where `text-xs` belongs. |
| Drop `?? ''` from `answer: score.answer ?? ''` | `Object.keys` still lists `answer` when the value is `undefined`, and every fixture set one. The type link does not help: `string \| undefined` still satisfies the team branch's `string`. |
| `player.id === myPlayerId` → `!==` in the team branch | `signInWithTeam` builds a ONE-MEMBER team, so `find(!==)` returns `undefined`, falls through `?? []`, and looks exactly like a fresh board. |
| Solo `playWeekends={true}` → `{false}` | The one genuinely new product decision in the task, shipped with a five-line justification and zero assertions. |

Close them with two new test files (see the Files list). Assert on what the accessible name **collapses** — which mechanism supplies the name, plus the icon-only button's own `text-xs` — never on "a button named Board Entry exists", which the mutant satisfies. For the score shape, add a fixture row with `answer` genuinely **omitted** (the schema has it optional) and assert `''` comes back. For the prefill scoping, build the TWO-member team e2e never builds, put the teammate's board on the selected day and the caller's nowhere, and assert the form prefills empty; add the mirror so it cannot be satisfied by a form that never prefills at all. For `playWeekends`, assert the prop each branch hands `DatePicker` — `date-picker.hook.test.ts:101` already owns what the picker *does* with the flag.

Also soften `getMyMonth`'s doc comment: the "cannot reach into the next month" guarantee holds only for a well-formed `YYYY-MM`. Do not add validation; see Step 3.

```bash
git add v2/convex/scores.ts v2/convex/scores.test.ts v2/src/components/board-entry/ docs/superpowers/plans/2026-09-07-onboarding-next-step-card.md
git commit -m "test(board-entry): defend the trigger contract, the score shape and the solo default"
```

---

## Task 9: "Show getting started" in the app menu

**Files:**
- Modify: `v2/src/components/app-menu.tsx`
- Test: `v2/src/components/app-menu.hook.test.ts`

- [ ] **Step 1: Read the existing menu and its test**

```bash
sed -n '1,80p' v2/src/components/app-menu.tsx
sed -n '1,40p' v2/src/components/app-menu.hook.test.ts
```

Match the existing item structure exactly — this task adds one entry, it does not restructure the menu.

- [ ] **Step 2: Write the failing test**

Add to `v2/src/components/app-menu.hook.test.ts`. **There is no `renderMenu` helper** — an earlier revision of this plan invented one. The file's real idiom is module-level `let` state (`isAuthenticated`, `isPro`, `currentUser`, …) that the mocked hooks read, then `render(createElement(AppMenu))` followed by its `openMenu()` helper, which uses `fireEvent.pointerDown` because a Radix menu does not open on a plain click (`:229-233`). Follow that.

```ts
test('offers to replay onboarding once it has been dismissed', () => {
  // The card is dismissible precisely so a deliberate solo player is not nagged
  // forever; that is only defensible if they can get it back.
  renderMenu({ onboardingDismissed: true })
  expect(screen.getByText('Show getting started')).toBeTruthy()
})

test('does not offer the replay while the card is still showing', () => {
  renderMenu({ onboardingDismissed: false })
  expect(screen.queryByText('Show getting started')).toBeNull()
})
```

- [ ] **Step 3: Run it and watch it fail**

Run from `v2/`: `pnpm vitest run src/components/app-menu.hook.test.ts`
Expected: FAIL — no such text.

- [ ] **Step 4: Add the menu entry**

> **Corrected 2026-09-07 against the real `app-menu.tsx`.** The earlier version used
> `onSelect`, bare `DropdownMenuItem` children, `void mutateAsync`, and an ungated
> query. All four differ from this file.

Subscribe using this file's own skip idiom (`app-menu.tsx:83-91` — every query here
passes `'skip'` rather than an `enabled` flag), and add the mutation imports:

```tsx
  const { data: onboardingStatus } = useQuery(
    convexQuery(api.onboarding.getStatus, isAuthenticated ? {} : 'skip'),
  )
  const replayOnboarding = useMutation({ mutationFn: useConvexMutation(api.onboarding.replay) })
```

`useMutation` comes from `@tanstack/react-query` and `useConvexMutation` from
`@convex-dev/react-query`; this file currently imports `useConvexAction` from the
latter but not `useConvexMutation`, so add it.

Render the item inside the existing `isAuthenticated &&` block, matching the
structure of its neighbours exactly — `onClick` (not `onSelect`), an icon with
`aria-hidden`, and the label in a `<span>`:

```tsx
  {onboardingStatus?.dismissed && (
    <DropdownMenuItem
      onClick={() =>
        replayOnboarding.mutate(
          {},
          {
            // Reported rather than toasted, matching monthly-winner-celebration.tsx:105
            // and the dismiss half in app.tsx: nothing the viewer can do about it, and
            // the failure mode is benign — the menu item is simply still there.
            onError: (error: unknown) => captureError(error, { where: 'onboarding.replay' }),
          },
        )
      }
    >
      <Sparkles className="mr-2 h-4 w-4" aria-hidden="true" />
      <span>Show getting started</span>
    </DropdownMenuItem>
  )}
```

Pick whichever `lucide-react` icon fits the set already imported at the top of the
file; `Sparkles` is a suggestion, not a requirement.

**`mutate` with `onError`, not `void mutateAsync`.** `void mutateAsync` on a
rejecting mutation is an unhandled promise rejection, and `replay` calls
`requirePlayer`, which throws. There is no `void mutateAsync` anywhere in `src/`.
This is the same correction Task 7 had to make for `dismiss`.

**Why this item matters more than it looks.** Until it lands, dismissing the card
is irreversible for the player, and the card now appears for every v1 migrant
sitting on a solo team — a permanent "One more thing / Invite someone" whose only
escape is a dismissal they can never undo.

- [ ] **Step 5: Run it and watch it pass**

Run from `v2/`: `pnpm vitest run src/components/app-menu.hook.test.ts`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add v2/src/components/app-menu.tsx v2/src/components/app-menu.hook.test.ts
git commit -m "feat(onboarding): replay the getting-started card from the app menu"
```

---

## Task 10: End-to-end walk of the three paths

**Files:**
- Create: `v2/e2e/onboarding.spec.ts`

**Before running anything:** check what holds port 3000. Playwright attaches to whatever is already there, and a stale dev server means every assertion below tests old code.

```bash
lsof -i :3000
```

If something old is listening, kill it before running. **e2e sits outside the four gates** — it is not run by `test:once`, `lint`, `typecheck` or `build`, so a red spec here will not be caught by any of them.

- [ ] **Step 1: Write the spec**

Create `v2/e2e/onboarding.spec.ts`, following the seeding helpers in the existing `e2e/invites.spec.ts`:

```ts
import { expect, test } from '@playwright/test'

test.describe('onboarding next-step card', () => {
  test('a fresh signup sees its two tasks and can play with no team', async ({ page }) => {
    // Seed an account with a player row, no team, no boards.
    await page.goto('/app')
    await expect(page.getByText('Get started')).toBeVisible()
    await expect(page.getByRole('button', { name: /Enter today's board/ })).toBeVisible()
    await expect(page.getByRole('button', { name: /Create a team/ })).toBeVisible()
    // NOT the invite task — it needs a team to point at, and asserting its
    // ABSENCE here is what pins the dead end fixed after Task 7. See the
    // correction note on Task 1.
    await expect(page.getByRole('button', { name: /Invite someone/ })).toBeHidden()

    // The point of the whole design: this works with no team.
    await page.getByRole('button', { name: /Enter today's board/ }).click()
    await expect(page.getByRole('dialog')).toBeVisible()
  })

  test('the board task disappears once a board is entered', async ({ page }) => {
    await page.goto('/app')
    // ...enter a board through the dialog, using the same steps as the existing
    // board-entry spec...
    await expect(page.getByRole('button', { name: /Enter today's board/ })).toBeHidden()
    await expect(page.getByRole('button', { name: /Create a team/ })).toBeVisible()
  })

  test('dismissing hides the card and the menu offers it back', async ({ page }) => {
    await page.goto('/app')
    await page.getByRole('button', { name: 'Dismiss getting started' }).click()
    await expect(page.getByText('Get started')).toBeHidden()

    await page.reload()
    await expect(page.getByText('Get started')).toBeHidden() // the flag is server-side

    // ...open the app menu and click "Show getting started"...
    await expect(page.getByText('Get started')).toBeVisible()
  })
})
```

Fill the elided steps from the neighbouring specs rather than inventing selectors — `e2e/invites.spec.ts` already has the seed-and-sign-in helper, and the board-entry spec already has the dialog interaction.

- [ ] **Step 2: Run it**

```bash
pnpm exec playwright test e2e/onboarding.spec.ts
```

Expected: 3 passed.

- [ ] **Step 3: Commit**

```bash
git add v2/e2e/onboarding.spec.ts
git commit -m "test(e2e): walk the onboarding card's three paths"
```

---

## Task 11: Close out

- [ ] **Step 1: Run all four gates from a clean tree**

```bash
cd v2
pnpm test:once; echo "test=$?"
pnpm lint;      echo "lint=$?"
pnpm typecheck; echo "typecheck=$?"
pnpm build;     echo "build=$?"
```

Expected: all four `=0`.

- [ ] **Step 2: Run the suite under CI's timezone**

```bash
TZ=UTC pnpm test:once; echo "test=$?"
```

Expected: `=0`. A test that passes on the host clock and fails here is the exact shape that has bitten this repo before.

- [ ] **Step 3: Confirm no frontend bundle reached the auth module**

```bash
grep -rn "SITE_URL" dist/client/ | head
```

Expected: no hits. `convex/auth.ts` throws at module scope without `process.env.SITE_URL`, which is always true in a browser, and a module-scope throw cannot be tree-shaken — this shipped a broken `/chat` to beta once already. Nothing in this plan should reach it, and this check proves it.

- [ ] **Step 4: Update the beads issues**

Close the child issues, and record on `wordle-teams-qt4` that the pre-launch activation baseline is **70 of 392 (18%), measured 2026-09-05**, with the post-launch number due 30 days after cutover.

---

## Self-review

**Spec coverage.** Card placement and supersession of `TeamsEmptyState` — Task 7. Three tasks with no precedence, and the fixed display order — Task 1. Model line with the corrected direction — Task 1, pinned by test. Non-empty-guesses predicate — Task 3. Live, non-latched predicate — Task 3 (nothing caches it). Global `hasInvited` — Task 7's adapter, with a test of that name. Dismissal on the player document — Tasks 2 and 3. Replay in the app menu — Task 9. Team-less board entry — Task 8. Four funnel events with dedupe — Tasks 5 and 6. Testing tiers — pure (1, 7), jsdom (6, 9), convex-test (3, 4, 8), Playwright (10). Measurement — Task 11.

**Not covered here, by design:** invite links, which the spec calls the largest single piece and separable. They are `docs/superpowers/plans/2026-09-07-invite-links.md`. Until that plan lands, the invite task navigates to `/team`, where `InvitePlayerDialog` already lives.

**Known soft spots**, flagged rather than hidden. Task 7 leaves `onBoard` provisional until Task 8 lifts the board-entry state — **the two must land together**. Task 8's form edit depends on the exact shape `getTeamMonth` returns, which the implementer must read first; the step says so rather than guessing. Task 3's convex-test idiom was originally wrong in this plan and is now corrected against `chat.test.ts` — `authenticatedAs` not `asPlayer`, `betterAuthTest` as a default package import, and `convexTest(schema, modules)`. Task 9's menu markup must match its neighbours.

**Type consistency.** `OnboardingFacts` carries the same four properties in Tasks 1, 6 and 7. `OnboardingTaskId` is `'board' | 'team' | 'invite'` in Task 1 and the `TASK_IDS` allowlist in Task 5 mirrors it (a Set literal, deliberately, so `funnel-payload.ts` stays importable from the Worker route). `taskSetKey` produces the comma-joined string that `onboarding_view`'s `tasks` tag consumes in Task 5 and asserts in Task 6.
