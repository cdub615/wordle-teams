# Team Chat, Part 1 — the logic core

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build every server-side rule of team chat — membership, sending, reading, deleting, rate limiting, the bandwidth budget meter, and the team-deletion cascade — with no DOM and no UI.

**Architecture:** Convex reactivity carries *notification*, not *data*. Clients subscribe to a one-document pointer (`chatMeta`) and, on waking, fetch only the messages they lack. Every function follows this repo's established shape: a pure `xxxFor(ctx, playerId, …)` core that tests call directly, plus a thin `mutation`/`query` wrapper that resolves the caller via `requirePlayer`.

**Tech Stack:** TypeScript, Convex, `convex-test`, vitest (`edge-runtime`), pnpm.

**Spec:** `docs/superpowers/specs/2026-09-05-team-chat-design.md` (revision 1).
**Epic:** `wordle-teams-qix`.

---

## Why this plan stops where it stops

Spec §10 splits the work. Part 1 is everything testable without a browser; Part 2
is the `/chat?team=<id>` route, the client-side incremental sync, unread badges,
the push sweep, and the UGC clause in `/terms` and `/privacy`.

The split is the same one `wordle-teams-418` used, for the same reason: this half
is pure logic over plain data and can be proven in the existing `edge-runtime`
vitest environment, so it should be.

**Part 1 ships no user-visible feature.** Nothing routes to these functions until
Part 2. That is intended — the rules are worth proving before anything depends on
them.

## File structure

| File | Responsibility |
| --- | --- |
| `v2/convex/schema.ts` | *Modified.* The four chat tables and their indexes |
| `v2/convex/lib/chat.ts` | Pure rules: body validation, rate-limit window, budget math. No `ctx` |
| `v2/convex/lib/chat.test.ts` | Tests for the above — no `convexTest` needed |
| `v2/convex/chat.ts` | All chat queries and mutations, `For`-cores plus wrappers |
| `v2/convex/chat.test.ts` | Tests for the above, via `convexTest` |
| `v2/convex/access.ts` | *Modified.* Two new `AccessCode` members |
| `v2/src/lib/convex-error.ts` | *Modified.* Copy for those two codes |
| `v2/convex/teams.ts` | *Modified.* `cascadeDeleteTeam` grows three deletes |

`lib/chat.ts` holds nothing that touches the database, which is what lets its
rules be tested as plain functions. `chat.ts` holds the database work. The split
is the same one `lib/scoring.ts` and `scores.ts` already use in this repo.

---

### Task 1: the schema, and proving the index range works

**Files:**
- Modify: `v2/convex/schema.ts`
- Test: `v2/convex/chat.test.ts` (create)

This task exists to prove one assumption before anything is built on it: that
`by_team_createdAt` supports the *"messages since T"* range scan that the whole
architecture depends on. Spec §2 deliberately chose an explicit `createdAt` over
`_creationTime` for exactly this reason. **If step 4 fails, stop** — the read
design in §4 needs rethinking, not the plan.

- [ ] **Step 1: Write the failing test**

Create `v2/convex/chat.test.ts`:

```ts
import { convexTest } from 'convex-test'
import { describe, expect, test } from 'vitest'
import schema from './schema'
import { aPlayer, aTeam } from './fixtures.ts'

const modules = import.meta.glob('./**/*.ts')

describe('the chat schema', () => {
  // THE LOAD-BEARING ASSUMPTION OF THE WHOLE DESIGN. Every wake does a
  // "messages since T" range scan on this index. If this does not work, the
  // pointer architecture in spec section 4 does not work.
  test('finds only the messages after a given time, by team', async () => {
    const t = convexTest(schema, modules)
    await t.run(async (ctx) => {
      const ada = await ctx.db.insert('players', aPlayer())
      const team = await ctx.db.insert('teams', aTeam({ playerIds: [ada], owner: ada }))

      await ctx.db.insert('chatMessages', { teamId: team, playerId: ada, body: 'first', createdAt: 1000 })
      await ctx.db.insert('chatMessages', { teamId: team, playerId: ada, body: 'second', createdAt: 2000 })
      await ctx.db.insert('chatMessages', { teamId: team, playerId: ada, body: 'third', createdAt: 3000 })

      const since = await ctx.db
        .query('chatMessages')
        .withIndex('by_team_createdAt', (q) => q.eq('teamId', team).gt('createdAt', 1000))
        .collect()

      expect(since.map((m) => m.body)).toEqual(['second', 'third'])
    })
  })

  test('keeps one team\'s messages out of another\'s range scan', async () => {
    const t = convexTest(schema, modules)
    await t.run(async (ctx) => {
      const ada = await ctx.db.insert('players', aPlayer())
      const mine = await ctx.db.insert('teams', aTeam({ playerIds: [ada], owner: ada }))
      const theirs = await ctx.db.insert('teams', aTeam({ legacyId: 900, name: 'Theirs', playerIds: [ada], owner: ada }))

      await ctx.db.insert('chatMessages', { teamId: mine, playerId: ada, body: 'mine', createdAt: 1000 })
      await ctx.db.insert('chatMessages', { teamId: theirs, playerId: ada, body: 'theirs', createdAt: 1000 })

      const found = await ctx.db
        .query('chatMessages')
        .withIndex('by_team_createdAt', (q) => q.eq('teamId', mine))
        .collect()

      expect(found.map((m) => m.body)).toEqual(['mine'])
    })
  })

  test('holds a pointer, a read cursor and a budget row', async () => {
    const t = convexTest(schema, modules)
    await t.run(async (ctx) => {
      const ada = await ctx.db.insert('players', aPlayer())
      const team = await ctx.db.insert('teams', aTeam({ playerIds: [ada], owner: ada }))

      await ctx.db.insert('chatMeta', { teamId: team, lastMessageAt: 5, revision: 1 })
      await ctx.db.insert('chatReads', { playerId: ada, teamId: team, lastReadAt: 5 })
      await ctx.db.insert('chatBudget', { month: '2026-09', estimatedBytes: 0, degraded: false })

      const meta = await ctx.db
        .query('chatMeta')
        .withIndex('by_team', (q) => q.eq('teamId', team))
        .unique()
      const cursor = await ctx.db
        .query('chatReads')
        .withIndex('by_player_team', (q) => q.eq('playerId', ada).eq('teamId', team))
        .unique()
      const budget = await ctx.db
        .query('chatBudget')
        .withIndex('by_month', (q) => q.eq('month', '2026-09'))
        .unique()

      expect(meta?.revision).toBe(1)
      expect(cursor?.lastReadAt).toBe(5)
      expect(budget?.degraded).toBe(false)
    })
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd v2 && pnpm vitest run convex/chat.test.ts`
Expected: FAIL — the `chatMessages` table is not in the schema.

- [ ] **Step 3: Add the tables**

In `v2/convex/schema.ts`, immediately before the `// --- Phase 0 scaffolding, still in use ---` comment, add:

```ts
  // TEAM CHAT (wordle-teams-qix). Phase 7.5, and native to v2 — there is no
  // Supabase counterpart, so no legacyId on any of these four, for the same
  // reason scoringSystems and pushSubscriptions have none.
  //
  // AN EXPLICIT createdAt, WHERE _creationTime WOULD HAVE BEEN FREE. Every
  // client wake range-scans "messages since T" on by_team_createdAt, which is
  // the hot path of the entire feature. Relying on _creationTime as an implicit
  // trailing index field may well work; this is not the place to find out.
  chatMessages: defineTable({
    teamId: v.id('teams'),
    playerId: v.id('players'),
    body: v.string(),
    createdAt: v.number(),
  }).index('by_team_createdAt', ['teamId', 'createdAt']),

  // THE POINTER. Clients subscribe to THIS, not to messages: a wake costs one
  // small document instead of a whole window. See the design's section 4.
  //
  // IT IS NOT ON THE TEAM DOC, AND THAT IS THE POINT. Denormalising
  // lastMessageAt onto `teams` would make every chat message invalidate every
  // query watching that team — posting a message would re-run the SCOREBOARD
  // for everyone reading it.
  //
  // `revision` EXISTS BECAUSE DELETES DO NOT MOVE lastMessageAt. A client
  // watching only the timestamp would never notice a deleted message and would
  // go on showing it. Any mutation to a team's history bumps revision.
  chatMeta: defineTable({
    teamId: v.id('teams'),
    lastMessageAt: v.number(),
    revision: v.number(),
  }).index('by_team', ['teamId']),

  // PER-PLAYER, PER-TEAM read cursor. Also carries the rate-limit window,
  // because the send mutation already reads and writes this row — counting a
  // player's recent messages instead would pay database I/O to protect
  // database I/O.
  chatReads: defineTable({
    playerId: v.id('players'),
    teamId: v.id('teams'),
    lastReadAt: v.number(),
    lastNotifiedAt: v.optional(v.number()),
    postWindowStartedAt: v.optional(v.number()),
    postsInWindow: v.optional(v.number()),
  })
    .index('by_player_team', ['playerId', 'teamId'])
    .index('by_player', ['playerId']),

  // THE BANDWIDTH BUDGET, one row per calendar month. Convex's free tier caps
  // database I/O at 1GB/month and the cap is HARD — mutations start failing
  // rather than generating a bill, which would take board entry down with it.
  // This meter degrades chat to manual refresh first. See lib/chat.ts.
  chatBudget: defineTable({
    month: v.string(), // 'YYYY-MM'
    estimatedBytes: v.number(),
    degraded: v.boolean(),
  }).index('by_month', ['month']),

```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd v2 && pnpm vitest run convex/chat.test.ts`
Expected: PASS, 3 tests.

**If the first test fails on the index range rather than passing, STOP and
report.** The pointer architecture rests on it.

- [ ] **Step 5: Commit**

```bash
cd /home/cdub/projects/wordle-teams
git add v2/convex/schema.ts v2/convex/chat.test.ts
git commit -m "feat(chat): the four chat tables, and proof the range scan works"
```

---

### Task 2: `lib/chat.ts` — the rules that need no database

**Files:**
- Modify: `v2/convex/access.ts`
- Modify: `v2/src/lib/convex-error.ts`
- Create: `v2/convex/lib/chat.ts`
- Test: `v2/convex/lib/chat.test.ts`

Two new `AccessCode` members are needed. `src/lib/convex-error.ts`'s
`typedCodeMessage` is **exhaustive against that union on purpose** — its
`default` branch assigns to `never` — so adding a code without adding copy stops
`pnpm typecheck` compiling. That is a feature; do not work around it.

- [ ] **Step 1: Write the failing test**

Create `v2/convex/lib/chat.test.ts`:

```ts
import { describe, expect, test } from 'vitest'
import {
  BUDGET_THRESHOLD_BYTES,
  RATE_LIMIT_MESSAGES,
  budgetIncrementFor,
  budgetMonthFor,
  isOverBudget,
  nextPostWindow,
  requireBody,
} from './chat.ts'

describe('requireBody', () => {
  test('trims and keeps ordinary text', () => {
    expect(requireBody('  hello  ')).toBe('hello')
  })

  test('keeps emoji intact, which is the whole of v1 rich content', () => {
    expect(requireBody('nice 🎉')).toBe('nice 🎉')
  })

  test('refuses a message that is empty once trimmed', () => {
    expect(() => requireBody('   ')).toThrow()
  })

  test('refuses a message past the length cap', () => {
    expect(() => requireBody('x'.repeat(2001))).toThrow()
  })

  test('accepts a message exactly at the cap', () => {
    expect(requireBody('x'.repeat(2000))).toHaveLength(2000)
  })
})

describe('nextPostWindow', () => {
  test('opens a window for a player who has never posted', () => {
    expect(nextPostWindow({}, 10_000)).toEqual({ postWindowStartedAt: 10_000, postsInWindow: 1 })
  })

  test('counts up inside an open window', () => {
    const current = { postWindowStartedAt: 10_000, postsInWindow: 3 }
    expect(nextPostWindow(current, 10_500)).toEqual({ postWindowStartedAt: 10_000, postsInWindow: 4 })
  })

  // THE REFUSAL. null means "rejected", and it is the only thing standing
  // between a runaway client and an exhausted monthly I/O budget.
  test('refuses once the window is full', () => {
    const full = { postWindowStartedAt: 10_000, postsInWindow: RATE_LIMIT_MESSAGES }
    expect(nextPostWindow(full, 10_500)).toBeNull()
  })

  test('reopens the window once sixty seconds have passed', () => {
    const full = { postWindowStartedAt: 10_000, postsInWindow: RATE_LIMIT_MESSAGES }
    expect(nextPostWindow(full, 70_000)).toEqual({ postWindowStartedAt: 70_000, postsInWindow: 1 })
  })
})

describe('the budget meter', () => {
  // DELIBERATELY CONSERVATIVE: every member is counted as if connected, so the
  // meter trips early rather than late.
  test('charges every member of the team for a wake', () => {
    expect(budgetIncrementFor(5)).toBe(budgetIncrementFor(1) * 5)
  })

  test('is under budget at zero and over it at the threshold', () => {
    expect(isOverBudget(0)).toBe(false)
    expect(isOverBudget(BUDGET_THRESHOLD_BYTES)).toBe(true)
  })

  // Built from a LOCAL Date on purpose, matching toPuzzleDay, so this test
  // does not pass on the host's zone and fail under CI's TZ=UTC.
  test('keys the budget by calendar month', () => {
    expect(budgetMonthFor(new Date(2026, 8, 5, 12).getTime())).toBe('2026-09')
    expect(budgetMonthFor(new Date(2026, 11, 31, 12).getTime())).toBe('2026-12')
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd v2 && pnpm vitest run convex/lib/chat.test.ts`
Expected: FAIL — `Failed to load .../lib/chat.ts`

- [ ] **Step 3: Add the two access codes**

In `v2/convex/access.ts`, add two members to the `AccessCode` union, after
`'INVALID_PUSH_ENDPOINT'`:

```ts
  | 'INVALID_PUSH_ENDPOINT'
  | 'INVALID_MESSAGE'
  | 'RATE_LIMITED'
```

And extend the comment block above the union, which enumerates where each code
is thrown, with:

```ts
// INVALID_MESSAGE and RATE_LIMITED are thrown in lib/chat.ts, by requireBody
// and by the send path's rate-limit check.
```

- [ ] **Step 4: Add the copy for both codes**

In `v2/src/lib/convex-error.ts`, add both codes to the `convexErrorCode`
condition:

```ts
    code === 'INVALID_PUSH_ENDPOINT' ||
    code === 'INVALID_MESSAGE' ||
    code === 'RATE_LIMITED'
```

and add both cases to the `typedCodeMessage` switch, alongside the others:

```ts
    case 'INVALID_MESSAGE':
      return 'A message needs some text, and has to be under 2000 characters.'
    case 'RATE_LIMITED':
      return 'You are sending messages very quickly — give it a moment.'
```

- [ ] **Step 5: Write the implementation**

Create `v2/convex/lib/chat.ts`:

```ts
import { accessError } from '../access.ts'
import { monthOf, toPuzzleDay } from './puzzleDay.ts'

/**
 * The rules of team chat that need no database.
 *
 * Everything here is a plain function over plain values, which is what lets it
 * be tested without convex-test and reasoned about without a ctx. The database
 * work lives in ../chat.ts. Same split as lib/scoring.ts and scores.ts.
 */

export const MAX_BODY_LENGTH = 2000

/** Twenty messages a minute, per player per team. See the note on the limit. */
export const RATE_LIMIT_MESSAGES = 20
export const RATE_LIMIT_WINDOW_MS = 60_000

/** How many messages a client loads when it opens a conversation. */
export const RECENT_WINDOW = 30

/**
 * What one client's wake costs us, in bytes, as a round upper bound: roughly
 * 200B for the pointer read (chatMeta plus the budget row, both small) and
 * ~250B for the one new message it then fetches.
 */
export const BYTES_PER_WAKE = 450

/**
 * 700MB of Convex's 1GB monthly database-I/O allowance, leaving headroom for
 * every other query in the app. Crossing it degrades chat, never the app.
 */
export const BUDGET_THRESHOLD_BYTES = 700 * 1024 * 1024

/**
 * A message body, trimmed, or a refusal.
 *
 * Emoji need no special handling — they are Unicode and travel in the string,
 * which is why they are the whole of v1's rich content and cost nothing.
 */
export function requireBody(raw: string): string {
  const body = raw.trim()
  if (body.length === 0) accessError('INVALID_MESSAGE')
  if (body.length > MAX_BODY_LENGTH) accessError('INVALID_MESSAGE')
  return body
}

export type PostWindow = {
  postWindowStartedAt?: number
  postsInWindow?: number
}

/**
 * The player's next rate-limit window, or `null` if this message is refused.
 *
 * THIS IS AN AVAILABILITY CONTROL, NOT POLITENESS, and it carries no upgrade
 * messaging — see section 11 of the design, which records why chat is not
 * monetized. On a hard-capped free tier a runaway client (a loop, a stuck key,
 * a bad retry) can exhaust database I/O and make mutations start failing
 * APP-WIDE, not just in chat. Twenty a minute is set high enough that a real
 * conversation never meets it.
 *
 * Both fields are optional because a player's first message has no window yet;
 * absent is treated as an expired window, which opens a fresh one.
 */
export function nextPostWindow(current: PostWindow, now: number): Required<PostWindow> | null {
  const startedAt = current.postWindowStartedAt ?? 0
  const count = current.postsInWindow ?? 0

  if (now - startedAt >= RATE_LIMIT_WINDOW_MS) {
    return { postWindowStartedAt: now, postsInWindow: 1 }
  }
  if (count >= RATE_LIMIT_MESSAGES) return null

  return { postWindowStartedAt: startedAt, postsInWindow: count + 1 }
}

/**
 * What to charge the monthly budget for one message.
 *
 * DELIBERATELY CONSERVATIVE: every member is billed as though they were
 * connected and watching, which is rarely true. Over-counting makes the meter
 * trip early, and tripping early is the safe direction — the failure it exists
 * to prevent is Convex refusing mutations across the whole app.
 */
export function budgetIncrementFor(teamSize: number): number {
  return teamSize * BYTES_PER_WAKE
}

export function isOverBudget(estimatedBytes: number): boolean {
  return estimatedBytes >= BUDGET_THRESHOLD_BYTES
}

/**
 * The 'YYYY-MM' key for a timestamp, via toPuzzleDay — so the budget month
 * matches every other month in this product rather than introducing a second,
 * UTC notion of when a month turns over. A counter that resets a few hours
 * early or late is harmless; two disagreeing definitions of "September" are
 * not.
 */
export function budgetMonthFor(now: number): string {
  return monthOf(toPuzzleDay(new Date(now)))
}
```

- [ ] **Step 6: Run test to verify it passes**

Run: `cd v2 && pnpm vitest run convex/lib/chat.test.ts`
Expected: PASS, 12 tests.

- [ ] **Step 7: Prove the rate limit is not vacuous**

Change `if (count >= RATE_LIMIT_MESSAGES) return null` to `if (false) return null`,
re-run, and confirm **"refuses once the window is full"** FAILS. Then revert.

A limit that has never been seen to refuse is not a limit. This repo has caught
a vacuous assertion this way before.

- [ ] **Step 8: Verify the exhaustive switch actually caught the new codes**

Run: `cd v2 && pnpm typecheck`
Expected: PASS. If it fails complaining about `never` in `typedCodeMessage`, step
4 was skipped or incomplete — that is the guard working.

- [ ] **Step 9: Commit**

```bash
cd /home/cdub/projects/wordle-teams
git add v2/convex/lib/chat.ts v2/convex/lib/chat.test.ts v2/convex/access.ts v2/src/lib/convex-error.ts
git commit -m "feat(chat): the rules that need no database, and two typed codes"
```

---

### Task 3: `sendMessageFor` — membership, validation, and the pointer bump

**Files:**
- Create: `v2/convex/chat.ts`
- Test: `v2/convex/chat.test.ts` (append)

- [ ] **Step 1: Write the failing test**

Append to `v2/convex/chat.test.ts`, and add these imports at the top of the file:

```ts
import { sendMessageFor } from './chat.ts'
```

```ts
describe('sendMessageFor', () => {
  test('stores a trimmed message for a member', async () => {
    const t = convexTest(schema, modules)
    await t.run(async (ctx) => {
      const ada = await ctx.db.insert('players', aPlayer())
      const team = await ctx.db.insert('teams', aTeam({ playerIds: [ada], owner: ada }))

      await sendMessageFor(ctx, ada, team, '  hello team  ')

      const stored = await ctx.db
        .query('chatMessages')
        .withIndex('by_team_createdAt', (q) => q.eq('teamId', team))
        .collect()
      expect(stored.map((m) => m.body)).toEqual(['hello team'])
      expect(stored[0].playerId).toBe(ada)
    })
  })

  // THE SECURITY BOUNDARY. The route guard in Part 2 is UX; this is the gate.
  test('refuses a non-member', async () => {
    const t = convexTest(schema, modules)
    await t.run(async (ctx) => {
      const ada = await ctx.db.insert('players', aPlayer())
      const mallory = await ctx.db.insert('players', aPlayer({ email: 'mallory@example.com' }))
      const team = await ctx.db.insert('teams', aTeam({ playerIds: [ada], owner: ada }))

      await expect(sendMessageFor(ctx, mallory, team, 'let me in')).rejects.toThrow()

      const stored = await ctx.db.query('chatMessages').collect()
      expect(stored).toEqual([])
    })
  })

  test('refuses an empty message', async () => {
    const t = convexTest(schema, modules)
    await t.run(async (ctx) => {
      const ada = await ctx.db.insert('players', aPlayer())
      const team = await ctx.db.insert('teams', aTeam({ playerIds: [ada], owner: ada }))

      await expect(sendMessageFor(ctx, ada, team, '   ')).rejects.toThrow()
    })
  })

  test('creates the pointer on the first message and advances it on the next', async () => {
    const t = convexTest(schema, modules)
    await t.run(async (ctx) => {
      const ada = await ctx.db.insert('players', aPlayer())
      const team = await ctx.db.insert('teams', aTeam({ playerIds: [ada], owner: ada }))

      await sendMessageFor(ctx, ada, team, 'one')
      const first = await ctx.db
        .query('chatMeta')
        .withIndex('by_team', (q) => q.eq('teamId', team))
        .unique()

      await sendMessageFor(ctx, ada, team, 'two')
      const second = await ctx.db
        .query('chatMeta')
        .withIndex('by_team', (q) => q.eq('teamId', team))
        .unique()

      expect(first?.revision).toBe(1)
      expect(second?.revision).toBe(2)
      expect(second?.lastMessageAt ?? 0).toBeGreaterThanOrEqual(first?.lastMessageAt ?? 0)
    })
  })

  // Sending is reading: you have obviously seen your own message.
  test('advances the sender\'s own read cursor', async () => {
    const t = convexTest(schema, modules)
    await t.run(async (ctx) => {
      const ada = await ctx.db.insert('players', aPlayer())
      const team = await ctx.db.insert('teams', aTeam({ playerIds: [ada], owner: ada }))

      await sendMessageFor(ctx, ada, team, 'hello')

      const cursor = await ctx.db
        .query('chatReads')
        .withIndex('by_player_team', (q) => q.eq('playerId', ada).eq('teamId', team))
        .unique()
      const meta = await ctx.db
        .query('chatMeta')
        .withIndex('by_team', (q) => q.eq('teamId', team))
        .unique()

      expect(cursor?.lastReadAt).toBe(meta?.lastMessageAt)
    })
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd v2 && pnpm vitest run convex/chat.test.ts`
Expected: FAIL — `Failed to load .../chat.ts`

- [ ] **Step 3: Write the implementation**

Create `v2/convex/chat.ts`:

```ts
import { requireTeamMemberFor } from './access'
import { requireBody } from './lib/chat.ts'
import type { Id } from './_generated/dataModel'
import type { WriterCtx } from './winners.ts'

/**
 * Team chat (wordle-teams-qix). Phase 7.5.
 *
 * Design: docs/superpowers/specs/2026-09-05-team-chat-design.md.
 *
 * EVERY FUNCTION IN HERE CHECKS MEMBERSHIP, READS INCLUDED. Part 2's route
 * guard exists so nobody is shown a screen that cannot load; it is not the
 * security boundary, because these functions are callable directly.
 *
 * requireTeamMemberFor throws NOT_A_MEMBER for a nonexistent team as well as
 * for someone else's, so chat cannot be used to probe whether a team id exists.
 * Do not "improve" that into a more specific error.
 */

/**
 * Advance a team's pointer, which is what wakes every connected client.
 *
 * REVISION BUMPS ON EVERY HISTORY CHANGE, not only on new messages. A delete
 * does not move lastMessageAt, so a client watching the timestamp alone would
 * go on showing a message that is gone.
 */
async function bumpChatMeta(
  ctx: WriterCtx,
  teamId: Id<'teams'>,
  now: number,
  movesLastMessage: boolean,
): Promise<void> {
  const existing = await ctx.db
    .query('chatMeta')
    .withIndex('by_team', (q) => q.eq('teamId', teamId))
    .unique()

  if (existing === null) {
    await ctx.db.insert('chatMeta', { teamId, lastMessageAt: now, revision: 1 })
    return
  }

  await ctx.db.patch(existing._id, {
    revision: existing.revision + 1,
    ...(movesLastMessage ? { lastMessageAt: now } : {}),
  })
}

/** The caller's read cursor for a team, created on first use. */
async function readCursorFor(ctx: WriterCtx, playerId: Id<'players'>, teamId: Id<'teams'>) {
  return await ctx.db
    .query('chatReads')
    .withIndex('by_player_team', (q) => q.eq('playerId', playerId).eq('teamId', teamId))
    .unique()
}

export async function sendMessageFor(
  ctx: WriterCtx,
  playerId: Id<'players'>,
  teamId: Id<'teams'>,
  rawBody: string,
): Promise<Id<'chatMessages'>> {
  await requireTeamMemberFor(ctx, playerId, teamId)
  const body = requireBody(rawBody)
  const now = Date.now()

  const id = await ctx.db.insert('chatMessages', { teamId, playerId, body, createdAt: now })
  await bumpChatMeta(ctx, teamId, now, true)

  // Sending is reading — you have seen your own message. This also creates the
  // row that Task 4 hangs the rate-limit window on.
  const cursor = await readCursorFor(ctx, playerId, teamId)
  if (cursor === null) {
    await ctx.db.insert('chatReads', { playerId, teamId, lastReadAt: now })
  } else {
    await ctx.db.patch(cursor._id, { lastReadAt: now })
  }

  return id
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd v2 && pnpm vitest run convex/chat.test.ts`
Expected: PASS, 8 tests.

- [ ] **Step 5: Prove the membership check is load-bearing**

Delete the `await requireTeamMemberFor(ctx, playerId, teamId)` line, re-run, and
confirm **"refuses a non-member"** FAILS. Then revert.

An authorization test that has never been seen to fail is not evidence, and this
is the one rule in the feature that matters most.

- [ ] **Step 6: Commit**

```bash
cd /home/cdub/projects/wordle-teams
git add v2/convex/chat.ts v2/convex/chat.test.ts
git commit -m "feat(chat): send a message, with membership as the real gate"
```

---

### Task 4: the rate limit on the send path

**Files:**
- Modify: `v2/convex/chat.ts`
- Test: `v2/convex/chat.test.ts` (append)

- [ ] **Step 1: Write the failing test**

Append to `v2/convex/chat.test.ts`, and add `RATE_LIMIT_MESSAGES` to the imports
from `./lib/chat.ts`:

```ts
import { RATE_LIMIT_MESSAGES } from './lib/chat.ts'
```

```ts
describe('the send rate limit', () => {
  test('allows a full window and refuses the one after it', async () => {
    const t = convexTest(schema, modules)
    await t.run(async (ctx) => {
      const ada = await ctx.db.insert('players', aPlayer())
      const team = await ctx.db.insert('teams', aTeam({ playerIds: [ada], owner: ada }))

      for (let i = 0; i < RATE_LIMIT_MESSAGES; i++) {
        await sendMessageFor(ctx, ada, team, `message ${i}`)
      }
      await expect(sendMessageFor(ctx, ada, team, 'one too many')).rejects.toThrow()

      const stored = await ctx.db
        .query('chatMessages')
        .withIndex('by_team_createdAt', (q) => q.eq('teamId', team))
        .collect()
      expect(stored).toHaveLength(RATE_LIMIT_MESSAGES)
    })
  })

  // The limit is per player per team, so one chatty person must not silence
  // their teammates — this is a group feature.
  test('does not let one player\'s limit block another', async () => {
    const t = convexTest(schema, modules)
    await t.run(async (ctx) => {
      const ada = await ctx.db.insert('players', aPlayer())
      const bob = await ctx.db.insert('players', aPlayer({ email: 'bob@example.com' }))
      const team = await ctx.db.insert('teams', aTeam({ playerIds: [ada, bob], owner: ada }))

      for (let i = 0; i < RATE_LIMIT_MESSAGES; i++) {
        await sendMessageFor(ctx, ada, team, `message ${i}`)
      }
      await expect(sendMessageFor(ctx, ada, team, 'blocked')).rejects.toThrow()

      // Bob is unaffected.
      await expect(sendMessageFor(ctx, bob, team, 'still fine')).resolves.toBeDefined()
    })
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd v2 && pnpm vitest run convex/chat.test.ts`
Expected: FAIL — the 21st message is stored instead of refused.

- [ ] **Step 3: Write the implementation**

In `v2/convex/chat.ts`, extend the imports:

```ts
import { accessError, requireTeamMemberFor } from './access'
import { nextPostWindow, requireBody } from './lib/chat.ts'
```

and replace the body of `sendMessageFor` with:

```ts
export async function sendMessageFor(
  ctx: WriterCtx,
  playerId: Id<'players'>,
  teamId: Id<'teams'>,
  rawBody: string,
): Promise<Id<'chatMessages'>> {
  await requireTeamMemberFor(ctx, playerId, teamId)
  const body = requireBody(rawBody)
  const now = Date.now()

  // THE RATE CHECK COMES BEFORE THE INSERT. Refusing after writing would let a
  // runaway client spend the I/O it is being refused for.
  const cursor = await readCursorFor(ctx, playerId, teamId)
  const window = nextPostWindow(cursor ?? {}, now)
  // `throw` even though accessError throws internally: the spread of `window`
  // below needs TypeScript to narrow away the null, and access.ts writes it
  // this way for the same reason.
  if (window === null) throw accessError('RATE_LIMITED')

  const id = await ctx.db.insert('chatMessages', { teamId, playerId, body, createdAt: now })
  await bumpChatMeta(ctx, teamId, now, true)

  // Sending is reading — you have seen your own message.
  if (cursor === null) {
    await ctx.db.insert('chatReads', { playerId, teamId, lastReadAt: now, ...window })
  } else {
    await ctx.db.patch(cursor._id, { lastReadAt: now, ...window })
  }

  return id
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd v2 && pnpm vitest run convex/chat.test.ts`
Expected: PASS, 10 tests.

- [ ] **Step 5: Commit**

```bash
cd /home/cdub/projects/wordle-teams
git add v2/convex/chat.ts v2/convex/chat.test.ts
git commit -m "feat(chat): rate limit the send path, per player per team"
```

---

### Task 5: the budget meter

**Files:**
- Modify: `v2/convex/chat.ts`
- Test: `v2/convex/chat.test.ts` (append)

- [ ] **Step 1: Write the failing test**

Append to `v2/convex/chat.test.ts`, adding `BUDGET_THRESHOLD_BYTES`,
`budgetIncrementFor` and `budgetMonthFor` to the `./lib/chat.ts` imports:

```ts
describe('the budget meter', () => {
  test('charges every member of the team for each message sent', async () => {
    const t = convexTest(schema, modules)
    await t.run(async (ctx) => {
      const ada = await ctx.db.insert('players', aPlayer())
      const bob = await ctx.db.insert('players', aPlayer({ email: 'bob@example.com' }))
      const team = await ctx.db.insert('teams', aTeam({ playerIds: [ada, bob], owner: ada }))

      await sendMessageFor(ctx, ada, team, 'hello')

      const budget = await ctx.db
        .query('chatBudget')
        .withIndex('by_month', (q) => q.eq('month', budgetMonthFor(Date.now())))
        .unique()
      expect(budget?.estimatedBytes).toBe(budgetIncrementFor(2))
      expect(budget?.degraded).toBe(false)
    })
  })

  test('degrades once the month crosses the threshold', async () => {
    const t = convexTest(schema, modules)
    await t.run(async (ctx) => {
      const ada = await ctx.db.insert('players', aPlayer())
      const team = await ctx.db.insert('teams', aTeam({ playerIds: [ada], owner: ada }))

      await ctx.db.insert('chatBudget', {
        month: budgetMonthFor(Date.now()),
        estimatedBytes: BUDGET_THRESHOLD_BYTES,
        degraded: false,
      })

      await sendMessageFor(ctx, ada, team, 'over the line')

      const budget = await ctx.db
        .query('chatBudget')
        .withIndex('by_month', (q) => q.eq('month', budgetMonthFor(Date.now())))
        .unique()
      expect(budget?.degraded).toBe(true)
    })
  })

  // DEGRADED MUST NOT MEAN SILENCED. Live updates pause; the conversation does
  // not stop. Cutting sending would be a worse outcome than the cost it saves.
  test('still accepts messages while degraded', async () => {
    const t = convexTest(schema, modules)
    await t.run(async (ctx) => {
      const ada = await ctx.db.insert('players', aPlayer())
      const team = await ctx.db.insert('teams', aTeam({ playerIds: [ada], owner: ada }))

      await ctx.db.insert('chatBudget', {
        month: budgetMonthFor(Date.now()),
        estimatedBytes: BUDGET_THRESHOLD_BYTES * 2,
        degraded: true,
      })

      await expect(sendMessageFor(ctx, ada, team, 'still talking')).resolves.toBeDefined()
    })
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd v2 && pnpm vitest run convex/chat.test.ts`
Expected: FAIL — no `chatBudget` row is written, so `budget` is null.

- [ ] **Step 3: Write the implementation**

In `v2/convex/chat.ts`, extend the imports:

```ts
import {
  budgetIncrementFor,
  budgetMonthFor,
  isOverBudget,
  nextPostWindow,
  requireBody,
} from './lib/chat.ts'
```

Add this helper next to `bumpChatMeta`:

```ts
/**
 * Charge the month's bandwidth budget for one message, and set `degraded` once
 * the threshold is crossed.
 *
 * WHY A METER AT ALL. The modelled worst case is ~7% of Convex's free-tier
 * database-I/O allowance, which is a large margin and not a guarantee. This
 * turns it into one. When it trips, chat stops opening live subscriptions and
 * falls back to manual refresh — SENDING KEEPS WORKING, because the failure
 * this exists to prevent is Convex refusing mutations app-wide and taking board
 * entry down along with chat.
 */
async function chargeBudget(ctx: WriterCtx, teamSize: number, now: number): Promise<void> {
  const month = budgetMonthFor(now)
  const row = await ctx.db
    .query('chatBudget')
    .withIndex('by_month', (q) => q.eq('month', month))
    .unique()

  const estimatedBytes = (row?.estimatedBytes ?? 0) + budgetIncrementFor(teamSize)
  const degraded = isOverBudget(estimatedBytes)

  if (row === null) {
    await ctx.db.insert('chatBudget', { month, estimatedBytes, degraded })
    return
  }
  await ctx.db.patch(row._id, { estimatedBytes, degraded })
}
```

In `sendMessageFor`, capture the team from the membership check and charge the
budget after the insert:

```ts
  const team = await requireTeamMemberFor(ctx, playerId, teamId)
```

and, immediately after the `bumpChatMeta` call:

```ts
  await chargeBudget(ctx, team.playerIds.length, now)
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd v2 && pnpm vitest run convex/chat.test.ts`
Expected: PASS, 13 tests.

- [ ] **Step 5: Commit**

```bash
cd /home/cdub/projects/wordle-teams
git add v2/convex/chat.ts v2/convex/chat.test.ts
git commit -m "feat(chat): the bandwidth budget meter, and what degrading means"
```

---

### Task 6: the reads — pointer, window, incremental, older

**Files:**
- Modify: `v2/convex/chat.ts`
- Test: `v2/convex/chat.test.ts` (append)

Four reads, each with membership enforced. The pointer returns `degraded`
alongside the team's own state, because `chatBudget` is app-wide and clients must
not subscribe to it directly — a shared subscription would wake every connected
client in the app whenever any team sent a message.

- [ ] **Step 1: Write the failing test**

Append to `v2/convex/chat.test.ts`, adding the four functions to the `./chat.ts`
import:

```ts
describe('the chat reads', () => {
  test('the pointer carries the team\'s state and the app\'s degraded flag', async () => {
    const t = convexTest(schema, modules)
    await t.run(async (ctx) => {
      const ada = await ctx.db.insert('players', aPlayer())
      const team = await ctx.db.insert('teams', aTeam({ playerIds: [ada], owner: ada }))
      await sendMessageFor(ctx, ada, team, 'hello')

      const pointer = await chatPointerFor(ctx, ada, team)
      expect(pointer.revision).toBe(1)
      expect(pointer.lastMessageAt).toBeGreaterThan(0)
      expect(pointer.degraded).toBe(false)
    })
  })

  test('the pointer is empty but valid for a team that has never chatted', async () => {
    const t = convexTest(schema, modules)
    await t.run(async (ctx) => {
      const ada = await ctx.db.insert('players', aPlayer())
      const team = await ctx.db.insert('teams', aTeam({ playerIds: [ada], owner: ada }))

      const pointer = await chatPointerFor(ctx, ada, team)
      expect(pointer).toEqual({ lastMessageAt: 0, revision: 0, degraded: false })
    })
  })

  test('the window returns the newest messages oldest-first', async () => {
    const t = convexTest(schema, modules)
    await t.run(async (ctx) => {
      const ada = await ctx.db.insert('players', aPlayer())
      const team = await ctx.db.insert('teams', aTeam({ playerIds: [ada], owner: ada }))
      for (let i = 0; i < RECENT_WINDOW + 5; i++) {
        await ctx.db.insert('chatMessages', { teamId: team, playerId: ada, body: `m${i}`, createdAt: 1000 + i })
      }

      const window = await recentMessagesFor(ctx, ada, team)
      expect(window).toHaveLength(RECENT_WINDOW)
      // Oldest-first, and it is the TAIL of the conversation, not the head.
      expect(window[0].body).toBe('m5')
      expect(window[window.length - 1].body).toBe(`m${RECENT_WINDOW + 4}`)
    })
  })

  test('the incremental fetch returns only what the client lacks', async () => {
    const t = convexTest(schema, modules)
    await t.run(async (ctx) => {
      const ada = await ctx.db.insert('players', aPlayer())
      const team = await ctx.db.insert('teams', aTeam({ playerIds: [ada], owner: ada }))
      await ctx.db.insert('chatMessages', { teamId: team, playerId: ada, body: 'old', createdAt: 1000 })
      await ctx.db.insert('chatMessages', { teamId: team, playerId: ada, body: 'new', createdAt: 2000 })

      const since = await messagesSinceFor(ctx, ada, team, 1000)
      expect(since.map((m) => m.body)).toEqual(['new'])
    })
  })

  test('older messages page backwards from a given time', async () => {
    const t = convexTest(schema, modules)
    await t.run(async (ctx) => {
      const ada = await ctx.db.insert('players', aPlayer())
      const team = await ctx.db.insert('teams', aTeam({ playerIds: [ada], owner: ada }))
      for (let i = 0; i < 5; i++) {
        await ctx.db.insert('chatMessages', { teamId: team, playerId: ada, body: `m${i}`, createdAt: 1000 + i })
      }

      const older = await olderMessagesFor(ctx, ada, team, 1003)
      expect(older.map((m) => m.body)).toEqual(['m0', 'm1', 'm2'])
    })
  })

  // EVERY READ IS GATED, not just the writes. This is the easiest rule in the
  // feature to forget, because reads feel harmless.
  test('refuses a non-member on every read', async () => {
    const t = convexTest(schema, modules)
    await t.run(async (ctx) => {
      const ada = await ctx.db.insert('players', aPlayer())
      const mallory = await ctx.db.insert('players', aPlayer({ email: 'mallory@example.com' }))
      const team = await ctx.db.insert('teams', aTeam({ playerIds: [ada], owner: ada }))
      await sendMessageFor(ctx, ada, team, 'private')

      await expect(chatPointerFor(ctx, mallory, team)).rejects.toThrow()
      await expect(recentMessagesFor(ctx, mallory, team)).rejects.toThrow()
      await expect(messagesSinceFor(ctx, mallory, team, 0)).rejects.toThrow()
      await expect(olderMessagesFor(ctx, mallory, team, Date.now())).rejects.toThrow()
    })
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd v2 && pnpm vitest run convex/chat.test.ts`
Expected: FAIL — `chatPointerFor is not a function`.

- [ ] **Step 3: Write the implementation**

In `v2/convex/chat.ts`, add `RECENT_WINDOW` to the `./lib/chat.ts` imports, add
`ReaderCtx` to the type imports from `./winners.ts`, and append:

```ts
export type ChatPointer = {
  lastMessageAt: number
  revision: number
  degraded: boolean
}

/**
 * What a client subscribes to — and the only thing it subscribes to.
 *
 * TWO SMALL DOCUMENTS, deliberately. `degraded` lives in the app-wide
 * chatBudget row, and returning it here rather than letting clients subscribe
 * to that row directly is the difference between waking one team and waking
 * every connected client in the app whenever anybody sends a message.
 *
 * A team that has never chatted has no pointer row; zeroes are the honest
 * answer, and they make the client's "everything after 0" first fetch correct
 * without a special case.
 */
export async function chatPointerFor(
  ctx: ReaderCtx,
  playerId: Id<'players'>,
  teamId: Id<'teams'>,
): Promise<ChatPointer> {
  await requireTeamMemberFor(ctx, playerId, teamId)

  const meta = await ctx.db
    .query('chatMeta')
    .withIndex('by_team', (q) => q.eq('teamId', teamId))
    .unique()

  const budget = await ctx.db
    .query('chatBudget')
    .withIndex('by_month', (q) => q.eq('month', budgetMonthFor(Date.now())))
    .unique()

  return {
    lastMessageAt: meta?.lastMessageAt ?? 0,
    revision: meta?.revision ?? 0,
    degraded: budget?.degraded ?? false,
  }
}

/**
 * The newest RECENT_WINDOW messages, oldest-first for rendering.
 *
 * Read once when a conversation opens, and again only when `revision` jumps
 * without new messages — which is what a delete looks like from the client's
 * side. It is NOT what a new message costs; that is messagesSinceFor.
 */
export async function recentMessagesFor(
  ctx: ReaderCtx,
  playerId: Id<'players'>,
  teamId: Id<'teams'>,
) {
  await requireTeamMemberFor(ctx, playerId, teamId)

  const newestFirst = await ctx.db
    .query('chatMessages')
    .withIndex('by_team_createdAt', (q) => q.eq('teamId', teamId))
    .order('desc')
    .take(RECENT_WINDOW)

  return newestFirst.reverse()
}

/**
 * Everything after `since` — the hot path, and normally one document.
 *
 * This is the whole reason the architecture is cheap: a client that already
 * holds history up to T pays for what it lacks, not for the window it already
 * has.
 */
export async function messagesSinceFor(
  ctx: ReaderCtx,
  playerId: Id<'players'>,
  teamId: Id<'teams'>,
  since: number,
) {
  await requireTeamMemberFor(ctx, playerId, teamId)

  return await ctx.db
    .query('chatMessages')
    .withIndex('by_team_createdAt', (q) => q.eq('teamId', teamId).gt('createdAt', since))
    .collect()
}

/**
 * The page of messages immediately before `before`, oldest-first.
 *
 * Deliberately NOT subscribed by the client — scrollback does not live-update,
 * which is correct for history and is what keeps a deep scroll from becoming
 * permanently expensive.
 */
export async function olderMessagesFor(
  ctx: ReaderCtx,
  playerId: Id<'players'>,
  teamId: Id<'teams'>,
  before: number,
) {
  await requireTeamMemberFor(ctx, playerId, teamId)

  const newestFirst = await ctx.db
    .query('chatMessages')
    .withIndex('by_team_createdAt', (q) => q.eq('teamId', teamId).lt('createdAt', before))
    .order('desc')
    .take(RECENT_WINDOW)

  return newestFirst.reverse()
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd v2 && pnpm vitest run convex/chat.test.ts`
Expected: PASS, 19 tests.

- [ ] **Step 5: Commit**

```bash
cd /home/cdub/projects/wordle-teams
git add v2/convex/chat.ts v2/convex/chat.test.ts
git commit -m "feat(chat): the four reads, each gated on membership"
```

---

### Task 7: deleting a message

**Files:**
- Modify: `v2/convex/chat.ts`
- Test: `v2/convex/chat.test.ts` (append)

Hard delete, per spec §2 — a tombstone would occupy a slot in the window and be
re-read forever, and with no report path there is no evidence to preserve.

- [ ] **Step 1: Write the failing test**

Append to `v2/convex/chat.test.ts`, adding `deleteMessageFor` to the `./chat.ts`
import:

```ts
describe('deleteMessageFor', () => {
  test('lets an author delete their own message', async () => {
    const t = convexTest(schema, modules)
    await t.run(async (ctx) => {
      const ada = await ctx.db.insert('players', aPlayer())
      const bob = await ctx.db.insert('players', aPlayer({ email: 'bob@example.com' }))
      const team = await ctx.db.insert('teams', aTeam({ playerIds: [ada, bob], owner: ada }))
      const id = await sendMessageFor(ctx, bob, team, 'mine to remove')

      await deleteMessageFor(ctx, bob, id)

      expect(await ctx.db.get(id)).toBeNull()
    })
  })

  test('lets the team owner delete anyone\'s message', async () => {
    const t = convexTest(schema, modules)
    await t.run(async (ctx) => {
      const ada = await ctx.db.insert('players', aPlayer())
      const bob = await ctx.db.insert('players', aPlayer({ email: 'bob@example.com' }))
      const team = await ctx.db.insert('teams', aTeam({ playerIds: [ada, bob], owner: ada }))
      const id = await sendMessageFor(ctx, bob, team, 'something regrettable')

      await deleteMessageFor(ctx, ada, id)

      expect(await ctx.db.get(id)).toBeNull()
    })
  })

  test('refuses a member who is neither the author nor the owner', async () => {
    const t = convexTest(schema, modules)
    await t.run(async (ctx) => {
      const ada = await ctx.db.insert('players', aPlayer())
      const bob = await ctx.db.insert('players', aPlayer({ email: 'bob@example.com' }))
      const cass = await ctx.db.insert('players', aPlayer({ email: 'cass@example.com' }))
      const team = await ctx.db.insert('teams', aTeam({ playerIds: [ada, bob, cass], owner: ada }))
      const id = await sendMessageFor(ctx, bob, team, 'not yours')

      await expect(deleteMessageFor(ctx, cass, id)).rejects.toThrow()
      expect(await ctx.db.get(id)).not.toBeNull()
    })
  })

  test('refuses a non-member outright', async () => {
    const t = convexTest(schema, modules)
    await t.run(async (ctx) => {
      const ada = await ctx.db.insert('players', aPlayer())
      const mallory = await ctx.db.insert('players', aPlayer({ email: 'mallory@example.com' }))
      const team = await ctx.db.insert('teams', aTeam({ playerIds: [ada], owner: ada }))
      const id = await sendMessageFor(ctx, ada, team, 'private')

      await expect(deleteMessageFor(ctx, mallory, id)).rejects.toThrow()
      expect(await ctx.db.get(id)).not.toBeNull()
    })
  })

  // THE REASON `revision` EXISTS. A delete does not move lastMessageAt, so
  // without this bump a connected client would go on showing a deleted message
  // forever.
  test('bumps revision without moving lastMessageAt', async () => {
    const t = convexTest(schema, modules)
    await t.run(async (ctx) => {
      const ada = await ctx.db.insert('players', aPlayer())
      const team = await ctx.db.insert('teams', aTeam({ playerIds: [ada], owner: ada }))
      await sendMessageFor(ctx, ada, team, 'first')
      const id = await sendMessageFor(ctx, ada, team, 'second')

      const before = await chatPointerFor(ctx, ada, team)
      await deleteMessageFor(ctx, ada, id)
      const after = await chatPointerFor(ctx, ada, team)

      expect(after.revision).toBe(before.revision + 1)
      expect(after.lastMessageAt).toBe(before.lastMessageAt)
    })
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd v2 && pnpm vitest run convex/chat.test.ts`
Expected: FAIL — `deleteMessageFor is not a function`.

- [ ] **Step 3: Write the implementation**

In `v2/convex/chat.ts`, append:

```ts
/**
 * Delete a message. The author may remove their own; the team owner may remove
 * any in their team.
 *
 * HARD DELETE, NOT A TOMBSTONE. A tombstone would occupy a slot in the loaded
 * window and be re-read on every refresh for the life of the team, and with no
 * report path there is no evidence it would preserve.
 *
 * OWNERSHIP IS A ROLE, NOT AUTHORSHIP — Phase 5's softened downgrade reassigns
 * `owner` to the earliest-joined remaining member, so this grants the power to
 * whoever holds the role now, which is the intent.
 *
 * A non-member gets NOT_A_MEMBER from requireTeamMemberFor before anything else
 * is considered, so this cannot be used to probe which message ids exist.
 */
export async function deleteMessageFor(
  ctx: WriterCtx,
  playerId: Id<'players'>,
  messageId: Id<'chatMessages'>,
): Promise<void> {
  const message = await ctx.db.get(messageId)
  if (message === null) throw accessError('NOT_A_MEMBER')

  const team = await requireTeamMemberFor(ctx, playerId, message.teamId)
  const mayDelete = message.playerId === playerId || team.owner === playerId
  if (!mayDelete) throw accessError('NOT_TEAM_OWNER')

  await ctx.db.delete(messageId)
  // History changed without the newest message moving — see bumpChatMeta.
  await bumpChatMeta(ctx, message.teamId, Date.now(), false)
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd v2 && pnpm vitest run convex/chat.test.ts`
Expected: PASS, 24 tests.

- [ ] **Step 5: Prove the revision bump is load-bearing**

Change the final call to `await bumpChatMeta(ctx, message.teamId, Date.now(), true)`,
re-run, and confirm **"bumps revision without moving lastMessageAt"** FAILS on the
`lastMessageAt` assertion. Then revert.

This proves the test would catch a delete that silently masqueraded as a new
message, which would make every client's incremental fetch return nothing and
leave the deleted message on screen.

- [ ] **Step 6: Commit**

```bash
cd /home/cdub/projects/wordle-teams
git add v2/convex/chat.ts v2/convex/chat.test.ts
git commit -m "feat(chat): delete a message, and bump revision so clients notice"
```

---

### Task 8: the team-deletion cascade

**Files:**
- Modify: `v2/convex/teams.ts:272-289` (`cascadeDeleteTeam`)
- Test: `v2/convex/chat.test.ts` (append)

`cascadeDeleteTeam` already exists and already deletes `monthlyWinners` and
`scoringSystems` by hand. Chat adds three more tables to it. Do **not** write a
separate cascade — a second one would drift.

- [ ] **Step 1: Write the failing test**

Append to `v2/convex/chat.test.ts`, adding `import { deleteTeamFor } from './teams.ts'`:

```ts
describe('deleting a team', () => {
  test('takes its messages, pointer and read cursors with it', async () => {
    const t = convexTest(schema, modules)
    await t.run(async (ctx) => {
      const ada = await ctx.db.insert('players', aPlayer())
      const bob = await ctx.db.insert('players', aPlayer({ email: 'bob@example.com' }))
      const team = await ctx.db.insert('teams', aTeam({ playerIds: [ada, bob], owner: ada }))
      await sendMessageFor(ctx, ada, team, 'hello')
      await sendMessageFor(ctx, bob, team, 'hi back')

      await deleteTeamFor(ctx, ada, team)

      expect(await ctx.db.query('chatMessages').collect()).toEqual([])
      expect(await ctx.db.query('chatMeta').collect()).toEqual([])
      expect(await ctx.db.query('chatReads').collect()).toEqual([])
    })
  })

  // The budget is app-wide and monthly, not per team. Deleting a team must not
  // hand back bandwidth that has already been spent.
  test('leaves the bandwidth budget alone', async () => {
    const t = convexTest(schema, modules)
    await t.run(async (ctx) => {
      const ada = await ctx.db.insert('players', aPlayer())
      const team = await ctx.db.insert('teams', aTeam({ playerIds: [ada], owner: ada }))
      await sendMessageFor(ctx, ada, team, 'hello')

      await deleteTeamFor(ctx, ada, team)

      const budget = await ctx.db.query('chatBudget').collect()
      expect(budget).toHaveLength(1)
      expect(budget[0].estimatedBytes).toBeGreaterThan(0)
    })
  })

  test('does not touch another team\'s chat', async () => {
    const t = convexTest(schema, modules)
    await t.run(async (ctx) => {
      const ada = await ctx.db.insert('players', aPlayer())
      const doomed = await ctx.db.insert('teams', aTeam({ playerIds: [ada], owner: ada }))
      const kept = await ctx.db.insert('teams', aTeam({ legacyId: 901, name: 'Kept', playerIds: [ada], owner: ada }))
      await sendMessageFor(ctx, ada, doomed, 'goodbye')
      await sendMessageFor(ctx, ada, kept, 'still here')

      await deleteTeamFor(ctx, ada, doomed)

      const left = await ctx.db.query('chatMessages').collect()
      expect(left.map((m) => m.body)).toEqual(['still here'])
    })
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd v2 && pnpm vitest run convex/chat.test.ts`
Expected: FAIL — the messages, pointer and cursors survive the team.

- [ ] **Step 3: Extend the cascade**

In `v2/convex/teams.ts`, inside `cascadeDeleteTeam`, immediately before the
`await ctx.db.delete(team._id)` line, add:

```ts
  // CHAT (wordle-teams-qix). Three tables, and the budget is deliberately NOT
  // one of them: chatBudget is an app-wide monthly meter, and deleting a team
  // must not hand back bandwidth that has already been spent.
  const messages = await ctx.db
    .query('chatMessages')
    .withIndex('by_team_createdAt', (q) => q.eq('teamId', team._id))
    .collect()
  for (const row of messages) await ctx.db.delete(row._id)

  const meta = await ctx.db
    .query('chatMeta')
    .withIndex('by_team', (q) => q.eq('teamId', team._id))
    .collect()
  for (const row of meta) await ctx.db.delete(row._id)

  // No by_team index on chatReads — it is keyed by player first, and a team's
  // roster is right here, so this reads O(members) rather than scanning.
  for (const playerId of team.playerIds) {
    const cursor = await ctx.db
      .query('chatReads')
      .withIndex('by_player_team', (q) => q.eq('playerId', playerId).eq('teamId', team._id))
      .unique()
    if (cursor !== null) await ctx.db.delete(cursor._id)
  }
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd v2 && pnpm vitest run convex/chat.test.ts`
Expected: PASS, 27 tests.

- [ ] **Step 5: Run the existing team tests, which this file changed**

Run: `cd v2 && pnpm vitest run convex/teams.test.ts`
Expected: PASS, unchanged. `cascadeDeleteTeam` is reached by `deleteTeamFor` and
by `leaveTeamFor`'s empty-roster branch, so both paths now delete chat too.

- [ ] **Step 6: Commit**

```bash
cd /home/cdub/projects/wordle-teams
git add v2/convex/teams.ts v2/convex/chat.test.ts
git commit -m "feat(chat): carry chat into the existing team-deletion cascade"
```

---

### Task 9: the public wrappers

**Files:**
- Modify: `v2/convex/chat.ts`
- Test: `v2/convex/chat.test.ts` (append)

Thin `query`/`mutation` wrappers that resolve the caller and delegate. They hold
no rules of their own — this is the same shape as `createTeam`, `deleteTeam` and
every other public function in this codebase.

- [ ] **Step 1: Write the failing test**

Append to `v2/convex/chat.test.ts`:

```ts
describe('the public surface', () => {
  test('refuses an unauthenticated caller', async () => {
    const t = convexTest(schema, modules)
    const teamId = await t.run(async (ctx) => {
      const ada = await ctx.db.insert('players', aPlayer())
      return await ctx.db.insert('teams', aTeam({ playerIds: [ada], owner: ada }))
    })

    await expect(t.query(api.chat.pointer, { teamId })).rejects.toThrow()
    await expect(t.mutation(api.chat.send, { teamId, body: 'hello' })).rejects.toThrow()
  })
})
```

and add to the imports at the top of the file:

```ts
import { api } from './_generated/api'
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd v2 && pnpm vitest run convex/chat.test.ts`
Expected: FAIL — `api.chat.pointer` is undefined.

- [ ] **Step 3: Write the implementation**

In `v2/convex/chat.ts`, add to the imports:

```ts
import { v } from 'convex/values'
import { mutation, query } from './_generated/server'
import { accessError, requirePlayer, requireTeamMemberFor } from './access'
```

and append:

```ts
export const pointer = query({
  args: { teamId: v.id('teams') },
  handler: async (ctx, { teamId }) => {
    const player = await requirePlayer(ctx)
    return await chatPointerFor(ctx, player._id, teamId)
  },
})

export const recentMessages = query({
  args: { teamId: v.id('teams') },
  handler: async (ctx, { teamId }) => {
    const player = await requirePlayer(ctx)
    return await recentMessagesFor(ctx, player._id, teamId)
  },
})

export const messagesSince = query({
  args: { teamId: v.id('teams'), since: v.number() },
  handler: async (ctx, { teamId, since }) => {
    const player = await requirePlayer(ctx)
    return await messagesSinceFor(ctx, player._id, teamId, since)
  },
})

export const olderMessages = query({
  args: { teamId: v.id('teams'), before: v.number() },
  handler: async (ctx, { teamId, before }) => {
    const player = await requirePlayer(ctx)
    return await olderMessagesFor(ctx, player._id, teamId, before)
  },
})

export const send = mutation({
  args: { teamId: v.id('teams'), body: v.string() },
  handler: async (ctx, { teamId, body }) => {
    const player = await requirePlayer(ctx)
    return await sendMessageFor(ctx, player._id, teamId, body)
  },
})

export const deleteMessage = mutation({
  args: { messageId: v.id('chatMessages') },
  handler: async (ctx, { messageId }) => {
    const player = await requirePlayer(ctx)
    await deleteMessageFor(ctx, player._id, messageId)
  },
})

/**
 * Mark a team's conversation read up to now.
 *
 * Separate from `send` because opening a conversation is the common case and
 * costs nothing: it writes one small row and reads no messages. Part 2's unread
 * badge is `chatMeta.lastMessageAt > chatReads.lastReadAt`, which is why this
 * has to exist as its own call.
 */
export const markRead = mutation({
  args: { teamId: v.id('teams') },
  handler: async (ctx, { teamId }) => {
    const player = await requirePlayer(ctx)
    await requireTeamMemberFor(ctx, player._id, teamId)

    const now = Date.now()
    const cursor = await readCursorFor(ctx, player._id, teamId)
    if (cursor === null) {
      await ctx.db.insert('chatReads', { playerId: player._id, teamId, lastReadAt: now })
      return
    }
    await ctx.db.patch(cursor._id, { lastReadAt: now })
  },
})
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd v2 && pnpm vitest run convex/chat.test.ts`
Expected: PASS, 28 tests.

- [ ] **Step 5: Run all four gates**

Run these as **four separate commands** and read each exit status yourself:

```bash
cd v2 && pnpm test:once
cd v2 && pnpm lint
cd v2 && pnpm typecheck
cd v2 && pnpm build
```

**Do not pipe them and read `PIPESTATUS`.** This shell is zsh, where
`PIPESTATUS` is empty, and a piped gate check has reported a false green in this
repo before.

Expected: all four pass. Build is not lint is not typecheck.

- [ ] **Step 6: Commit**

```bash
cd /home/cdub/projects/wordle-teams
git add v2/convex/chat.ts v2/convex/chat.test.ts
git commit -m "feat(chat): the public query and mutation surface"
```

---

## What Part 2 covers

Planned after Part 1 lands:

- **The `/chat?team=<id>` route**, matching the existing `/team?team=<id>` flat
  search-param convention
- **Client-side incremental sync** — append on a `lastMessageAt` change, refetch
  the window on a bare `revision` change, and the gap case where a client was
  disconnected long enough to miss more than a window's worth of messages
- **The keyboard-aware composer**, reusing
  `2026-07-15-mobile-board-entry-keyboard-aware-sheet-design.md` rather than
  rediscovering iOS keyboard behaviour
- **Unread badges**, via the free timestamp comparison
- **The batched push sweep** on the existing hourly cron
- **The UGC clause** in `/terms` and `/privacy`
- **The degraded fallback UI** — manual refresh, with an honest notice
- **One e2e**: a non-member cannot read a team's chat. None of the four gates
  would catch a regression in an authorization rule, and e2e sits outside them
- **The bandwidth measurement** against the ~450 B/wake model, which is the GA
  gate and also discharges `wordle-teams-dcu`

## Spec coverage for Part 1

| Spec requirement | Where |
| --- | --- |
| §2 schema, four tables, explicit `createdAt` | Task 1 |
| §2 `revision` bumps on any history change | Tasks 3, 7 |
| §3 every function checks membership, reads included | Tasks 3, 6, 7 |
| §3 moderation: delete own, owner deletes any | Task 7 |
| §4 pointer + incremental fetch + window + scrollback | Task 6 |
| §6 body validation and the rate limit | Tasks 2, 4 |
| §6 budget meter, threshold, degrade, sending survives | Task 5 |
| §7 team deletion cascades | Task 8 |
| §8 `accessError` rather than plain `Error` | Task 2 |
| Acceptance criterion 2 — refusal proven by test | Tasks 3, 6, 7 |
| Acceptance criterion 6 — degrade demonstrated | Task 5 |

**Deliberately not in Part 1**, and not gaps: acceptance criteria 1 (the route),
4 (badges — `markRead` exists, the badge UI does not), 5 (the push sweep), 7 (the
UGC clause) and 8 (the measurement) are all Part 2 by §10's split.

**No V2-ADDENDUM §7a divergence row is needed.** That table records v1→v2
behaviour differences, and chat has no v1 counterpart to diverge from.
