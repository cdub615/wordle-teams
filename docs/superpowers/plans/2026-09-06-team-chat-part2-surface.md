# Team Chat, Part 2 — the surface

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Put a working chat surface in front of real teams — the route, the live sync client, the composer, unread badges, batched push — and settle the one design question Part 1 could not.

**Architecture:** Clients subscribe to one small pointer query and, when it changes, fetch only the messages they lack. Everything expensive is either bounded per call or metered server-side; Part 1 built all of that. Part 2 is the browser half, plus the two server pieces Part 1 deliberately left for it.

**Tech Stack:** TanStack Start + TanStack Router, `@convex-dev/react-query`, React, Tailwind, Playwright, vitest (`edge-runtime`), pnpm.

**Spec:** `docs/superpowers/specs/2026-09-05-team-chat-design.md` (revision 3).
**Epic:** `wordle-teams-qix`. **Part 1:** `docs/superpowers/plans/2026-09-05-team-chat-part1-core.md`.

---

## Why Task 2 comes second, and what it can stop

`wordle-teams-qix.13` is open and P1: **`chatPointerFor` may cause the app-wide
invalidation the design claims it avoids.** Every team's pointer query reads the
same monthly `chatBudget` row, and every send writes it — so a message in *any*
team may re-fire *every* open pointer subscription.

No test can settle it. `convex-test` models function calls, not live
subscription invalidation. It needs two real clients on a real deployment.

So Task 1 builds the smallest thing that can hold a live subscription, and
**Task 2 answers the question before anything else is built on the cost model.**

**What a NO-GO changes, and what it does not.** If the fan-out is confirmed, the
fix is to take `degraded` out of the pointer — a change to `chatPointerFor` and
the Task 1 hook, plus a correction to spec §4/§6. It does **not** invalidate the
message list, composer, scrollback, badges, push or the UGC clause. Tasks 3-11
are worth building either way. Do not skip Task 2 on the theory that it can be
checked later; later means rebuilding on a number we know might be wrong.

## Decisions taken before planning

Three questions the spec left to Part 2, answered by the owner on 2026-09-06:

- **Scrollback is an explicit button, disabled while a request is in flight.**
  Not infinite scroll. §6's limit of ten pages per player per team per minute was
  sized for a manual action; an eager fetch can trip it in one gesture. Disabling
  in flight also avoids an OCC retry on the caller's own `chatReads` row, which
  all three writers share.
- **A rejoining member's read cursor is reset when they are added to a team**
  (`wordle-teams-qix.11`), not cleaned up at every removal site. Removal happens
  in three places today and every future one would have to remember; addition
  happens in two, and resetting there fixes the only visible symptom — a
  returning member seeing no unread badge for their absence.
- **`wordle-teams-qix.10`** (the cascade's unbounded `.collect()`) stays open and
  out of scope. It is a P3 that bites only at volumes this app is nowhere near.

## File structure

| File | Responsibility |
| --- | --- |
| `v2/convex/chat.ts` | *Modified.* Two server additions Part 1 left for Part 2: `unreadTeamsFor` and the notify sweep |
| `v2/convex/chatNotify.ts` | The batched push sweep, kept out of `chat.ts` which is already ~560 lines |
| `v2/convex/teams.ts` | *Modified.* Reset a rejoining member's cursor |
| `v2/convex/billing.ts` | *Modified.* The second add-member path does the same |
| `v2/convex/crons.ts` | *Modified.* One more hourly job |
| `v2/src/routes/chat.tsx` | The `/chat?team=<id>` route |
| `v2/src/components/chat/use-chat-sync.ts` | The sync client: append, refetch-on-revision, gap |
| `v2/src/components/chat/message-list.tsx` | Rendering messages, and the "load older" control |
| `v2/src/components/chat/composer.tsx` | The keyboard-aware input |
| `v2/src/components/chat/unread-badge.tsx` | The badge, fed by `unreadTeams` |
| `v2/src/routes/terms.tsx`, `privacy.tsx` | *Modified.* Chat brought under the UGC clause |
| `v2/e2e/chat.spec.ts` | The one e2e §8 calls for |

`use-chat-sync.ts` holds all the sync reasoning and no rendering; the components
render and hold none. That split is what lets the sync logic be unit-tested
without a DOM, the same way Part 1's logic was.

---

### Task 1: the pointer hook and the smallest route that can hold a subscription

**Files:**
- Create: `v2/src/components/chat/use-chat-sync.ts`
- Create: `v2/src/routes/chat.tsx`

This task exists to make Task 2 possible. Build no more than it needs: a live
pointer subscription and enough on screen to confirm it is live.

- [ ] **Step 1: Write the sync hook's first slice**

Create `v2/src/components/chat/use-chat-sync.ts`:

```ts
import { convexQuery } from '@convex-dev/react-query'
import { useQuery } from '@tanstack/react-query'
import { api } from '../../../convex/_generated/api'
import type { Id } from '../../../convex/_generated/dataModel'

/**
 * The live pointer for one team's chat.
 *
 * THIS IS THE ONLY SUBSCRIPTION CHAT HOLDS. Everything else is fetched in
 * response to it changing. The pointer is two small documents; a naive
 * subscription to the message window would be ~17x more expensive per wake,
 * which is the whole argument of the design's section 4.
 */
export function useChatPointer(teamId: Id<'teams'>) {
  return useQuery(convexQuery(api.chat.pointer, { teamId }))
}
```

- [ ] **Step 2: Write the route**

Create `v2/src/routes/chat.tsx`. It mirrors `/team?team=<id>` — a flat route
with a search param, not a path param, matching the convention in
`v2/src/routes/team.tsx`:

```tsx
import { createFileRoute } from '@tanstack/react-router'
import { useChatPointer } from '#/components/chat/use-chat-sync.ts'
import { pageTitle } from '#/lib/seo'
import type { Id } from '../../convex/_generated/dataModel'

type ChatSearch = { team?: string }

export const Route = createFileRoute('/chat')({
  head: () => ({ meta: [{ title: pageTitle('Chat') }] }),
  validateSearch: (search: Record<string, unknown>): ChatSearch => ({
    team: typeof search.team === 'string' ? search.team : undefined,
  }),
  component: ChatRoute,
})

function ChatRoute() {
  const { team } = Route.useSearch()
  if (!team) return <p className="p-4">No team selected.</p>
  return <ChatPanel teamId={team as Id<'teams'>} />
}

/**
 * DELIBERATELY MINIMAL FOR NOW. Task 2 needs exactly one thing from this
 * screen: a live pointer subscription whose value is visible, so two browsers
 * can be watched side by side. The message list, composer and scrollback are
 * Tasks 3-5 and must not be built here.
 */
function ChatPanel({ teamId }: { teamId: Id<'teams'> }) {
  const pointer = useChatPointer(teamId)
  if (pointer.isPending) return <p className="p-4">Loading…</p>
  if (pointer.error) return <p className="p-4">Could not load chat.</p>
  return (
    <pre className="p-4 text-xs" data-testid="chat-pointer">
      {JSON.stringify(pointer.data, null, 2)}
    </pre>
  )
}
```

- [ ] **Step 3: Verify it renders and typechecks**

Run these as separate commands, reading each exit status yourself — do NOT pipe
and read `PIPESTATUS`; this shell is zsh, where it is empty, and a piped check
has reported a false green in this repo before:

```
cd /home/cdub/projects/wordle-teams/v2
pnpm typecheck
pnpm lint
pnpm build
```

Expected: all pass. The route is registered by the vite plugin — do NOT run
`tsr generate` by hand; see the `//generate-routes` note in `package.json`.

- [ ] **Step 4: Commit**

```bash
cd /home/cdub/projects/wordle-teams
git add v2/src/components/chat/use-chat-sync.ts v2/src/routes/chat.tsx
git commit -m "feat(chat): the pointer subscription and a route that can hold it"
```

---

### Task 2: SPIKE — does the pointer wake every client in the app?

**This task produces no shipped code.** Its deliverable is an answer recorded on
`wordle-teams-qix.13`, and it may change the design.

**Files:** none. Deploy and observe.

- [ ] **Step 1: Deploy to beta**

Beta deploys of `feat/v2-replatform` are pre-authorised. Do NOT deploy to
production. Note that a bare `convex` CLI command targets beta and the CLI calls
it "prod" — see `wordle-teams-ldm8`. Push the branch and deploy the Convex
functions to beta by the project's usual route.

- [ ] **Step 2: Set up two teams with chat open**

You need two DIFFERENT teams, each with at least one member, and a browser
holding `/chat?team=<id>` for each. Two profiles or two browsers — the point is
two independent live pointer subscriptions.

Record the `revision` and `lastMessageAt` shown by each `data-testid="chat-pointer"`.

- [ ] **Step 3: Send a message in team A only**

Use the Convex dashboard, or `api.chat.send` directly, to write one message to
team A. Do not touch team B.

- [ ] **Step 4: Observe team B**

**The question:** does team B's pointer re-render?

- If team B's pointer value is unchanged and React did not re-render it, the
  design holds and the ~7% cost model stands.
- If team B re-renders — even with identical values — the subscription was
  invalidated, and every send in any team wakes every open chat in the app.

Convex's dev tools or a `console.count()` in `ChatPanel` will make a re-render
visible where an unchanged value would not.

- [ ] **Step 5: Record the answer and decide**

Write the result on `wordle-teams-qix.13` with `bd note`, then close it if the
design holds.

**IMPORTANT — run every `bd` command inside a memory cap:**

```bash
systemd-run --user --scope -p MemoryMax=2G -p MemorySwapMax=0 --quiet bd note wordle-teams-qix.13 "..."
```

`bd` has OOM-killed this machine four times on an unbounded read. The cap makes
a runaway kill `bd` instead of the host. `timeout` does not help — bd's own heap
is what grows.

**If the fan-out is CONFIRMED, stop and report.** The fix is to move `degraded`
out of `chatPointerFor` — a server change plus a correction to spec §4 and §6 —
and it should be decided before Tasks 3-11 build on the current shape. Tasks
3-11 remain valid either way; only the pointer's contents change.

---

### Task 3: the sync client — append, refetch-on-revision, and the gap

**Files:**
- Modify: `v2/src/components/chat/use-chat-sync.ts`
- Test: `v2/src/components/chat/use-chat-sync.test.ts`

The sync *decision* is pure: given a previous pointer, a new pointer and what we
hold, decide whether to append, refetch the window, or do nothing. That decision
is unit-tested with no DOM. The hook wires it to Convex.

- [ ] **Step 1: Write the failing test**

Create `v2/src/components/chat/use-chat-sync.test.ts`:

```ts
import { describe, expect, it } from 'vitest'
import { nextSyncAction } from './use-chat-sync.ts'

const at = (lastMessageAt: number, revision: number) => ({ lastMessageAt, revision, degraded: false })

describe('nextSyncAction', () => {
  it('loads the window when we hold nothing', () => {
    expect(nextSyncAction(null, at(500, 3), 0)).toEqual({ kind: 'window' })
  })

  it('does nothing when the pointer has not moved', () => {
    expect(nextSyncAction(at(500, 3), at(500, 3), 500)).toEqual({ kind: 'none' })
  })

  // The ordinary case: a new message arrived, so fetch only what we lack.
  it('appends from our newest when lastMessageAt advances', () => {
    expect(nextSyncAction(at(500, 3), at(600, 4), 500)).toEqual({ kind: 'since', since: 500 })
  })

  // A DELETE looks like this: history changed, but the newest message did not
  // move. We cannot know WHICH message went, so the window is refetched.
  it('refetches the window when revision moves alone', () => {
    expect(nextSyncAction(at(500, 3), at(500, 4), 500)).toEqual({ kind: 'window' })
  })

  // Both moved: a send and a delete coalesced into one delivered update. The
  // append would miss the deletion, so the window wins.
  it('prefers the window when both moved by more than one revision', () => {
    expect(nextSyncAction(at(500, 3), at(600, 5), 500)).toEqual({ kind: 'window' })
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd v2 && pnpm vitest run src/components/chat/use-chat-sync.test.ts`
Expected: FAIL — `nextSyncAction` is not exported.

- [ ] **Step 3: Write the implementation**

Append to `v2/src/components/chat/use-chat-sync.ts`:

```ts
export type ChatPointerValue = {
  lastMessageAt: number
  revision: number
  degraded: boolean
}

export type SyncAction =
  | { kind: 'none' }
  | { kind: 'since'; since: number }
  | { kind: 'window' }

/**
 * What to do when the pointer changes. Pure on purpose: this is the whole of
 * the sync reasoning, and it is the part worth testing.
 *
 * THE THREE CASES, and why the third is not an append:
 *   lastMessageAt advanced by exactly one revision  -> fetch since our newest
 *   revision advanced alone                         -> a DELETE; refetch
 *   revision jumped more than one                   -> updates coalesced
 *
 * A delete does not move lastMessageAt, so a client watching only the
 * timestamp would keep showing a message that is gone — which is why the
 * server bumps `revision` on every history change (see bumpChatMeta).
 *
 * COALESCING IS WHY THE THIRD CASE EXISTS. Convex delivers the latest value,
 * not every intermediate one, so a send and a delete can arrive as a single
 * change. Appending would then miss the deletion silently. Refetching a
 * 30-message window is the more expensive branch and it is deliberately the
 * fallback: correctness first, and it is rare.
 */
export function nextSyncAction(
  previous: ChatPointerValue | null,
  current: ChatPointerValue,
  newestHeld: number,
): SyncAction {
  if (previous === null) return { kind: 'window' }
  if (current.revision === previous.revision) return { kind: 'none' }

  const revisionsMoved = current.revision - previous.revision
  const gotNewer = current.lastMessageAt > previous.lastMessageAt

  if (gotNewer && revisionsMoved === 1) return { kind: 'since', since: newestHeld }
  return { kind: 'window' }
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd v2 && pnpm vitest run src/components/chat/use-chat-sync.test.ts`
Expected: PASS, 5 tests.

- [ ] **Step 5: Prove the delete branch is load-bearing**

Change `if (gotNewer && revisionsMoved === 1)` to `if (gotNewer)`, re-run, and
confirm **"prefers the window when both moved by more than one revision"**
FAILS. Then revert.

Without that guard a coalesced send-plus-delete appends the new message and
silently keeps the deleted one on screen — the exact bug `revision` exists to
prevent. Report the observed output.

- [ ] **Step 6: Wire the hook to Convex**

Append to `v2/src/components/chat/use-chat-sync.ts`:

```ts
import { useQueryClient } from '@tanstack/react-query'
import { useEffect, useRef, useState } from 'react'

export type ChatMessage = {
  _id: Id<'chatMessages'>
  playerId: Id<'players'>
  body: string
  createdAt: number
}

/**
 * Holds one team's messages and keeps them current.
 *
 * The pointer is the only subscription. Everything else runs in response to it
 * moving, which is what keeps a wake at roughly 450 bytes instead of a whole
 * window — see the design's section 4.
 */
export function useChatMessages(teamId: Id<'teams'>) {
  const pointer = useChatPointer(teamId)
  const [messages, setMessages] = useState<Array<ChatMessage>>([])
  const previous = useRef<ChatPointerValue | null>(null)

  // recentMessages and messagesSince are QUERIES, fetched imperatively here
  // rather than subscribed — the pointer is the only subscription this feature
  // holds. fetchQuery runs one and resolves; it does not open a second live
  // subscription, which is the entire point of the architecture.
  const queryClient = useQueryClient()
  const loadWindow = () => queryClient.fetchQuery(convexQuery(api.chat.recentMessages, { teamId }))
  const loadSince = (since: number) =>
    queryClient.fetchQuery(convexQuery(api.chat.messagesSince, { teamId, since }))

  useEffect(() => {
    const current = pointer.data
    if (!current) return
    const newestHeld = messages.length === 0 ? 0 : messages[messages.length - 1].createdAt
    const action = nextSyncAction(previous.current, current, newestHeld)
    previous.current = current

    if (action.kind === 'none') return
    if (action.kind === 'window') {
      void loadWindow().then(setMessages)
      return
    }
    void loadSince(action.since).then((result) => {
      // A gap means the server refused to send a truncated list rather than one
      // a caller could mistake for complete — the recovery is a window refetch.
      if (result.gap) { void loadWindow().then(setMessages); return }
      setMessages((held) => [...held, ...result.messages])
    })
  }, [pointer.data, teamId, loadSince, loadWindow, messages])

  return { messages, degraded: pointer.data?.degraded ?? false, isPending: pointer.isPending }
}
```

- [ ] **Step 7: Run the gates and commit**

```
cd /home/cdub/projects/wordle-teams/v2
pnpm test:once
pnpm lint
pnpm typecheck
pnpm build
```

Four separate commands, each exit status read directly.

```bash
cd /home/cdub/projects/wordle-teams
git add v2/src/components/chat/use-chat-sync.ts v2/src/components/chat/use-chat-sync.test.ts
git commit -m "feat(chat): the sync client, and why a delete refetches"
```

---

### Task 4: the message list

**Files:**
- Create: `v2/src/components/chat/message-list.tsx`
- Modify: `v2/src/routes/chat.tsx`

- [ ] **Step 1: Write the component**

Create `v2/src/components/chat/message-list.tsx`:

```tsx
import type { ChatMessage } from './use-chat-sync.ts'
import type { Id } from '../../../convex/_generated/dataModel'

type Props = {
  messages: Array<ChatMessage>
  nameFor: (playerId: Id<'players'>) => string
  onDelete?: (id: Id<'chatMessages'>) => void
  canDelete: (message: ChatMessage) => boolean
}

/**
 * Messages oldest-first, newest at the bottom — the server already returns
 * them in that order, so nothing here re-sorts.
 *
 * A DEPARTED AUTHOR RENDERS AS "Former member". Messages survive their author
 * leaving a team, deliberately, so the conversation stays readable; see the
 * design's section 7. `nameFor` is what resolves that.
 */
export function MessageList({ messages, nameFor, onDelete, canDelete }: Props) {
  if (messages.length === 0) {
    return <p className="p-4 text-sm text-muted-foreground">No messages yet. Say something.</p>
  }
  return (
    <ol className="flex flex-col gap-3 p-4" data-testid="chat-messages">
      {messages.map((message) => (
        <li key={message._id} className="flex flex-col gap-1">
          <span className="text-xs text-muted-foreground">{nameFor(message.playerId)}</span>
          <span className="whitespace-pre-wrap break-words">{message.body}</span>
          {onDelete && canDelete(message) ? (
            <button
              type="button"
              className="self-start text-xs text-muted-foreground underline"
              onClick={() => onDelete(message._id)}
            >
              Delete
            </button>
          ) : null}
        </li>
      ))}
    </ol>
  )
}
```

`whitespace-pre-wrap break-words` matters: a message is plain text that may
contain newlines, and a 2000-character word must not blow out the layout.

- [ ] **Step 2: Render it from the route**

In `v2/src/routes/chat.tsx`, replace the `<pre>` in `ChatPanel` with the list,
fed by `useChatMessages`. Keep the `data-testid="chat-pointer"` element — Task 2
may still be being re-run, and the e2e in Task 10 does not depend on it.

- [ ] **Step 3: Gates and commit**

Run the four gates separately, then:

```bash
cd /home/cdub/projects/wordle-teams
git add v2/src/components/chat/message-list.tsx v2/src/routes/chat.tsx
git commit -m "feat(chat): render the conversation"
```

---

### Task 5: the composer

**Files:**
- Create: `v2/src/components/chat/composer.tsx`
- Modify: `v2/src/routes/chat.tsx`

Traffic is heavily iPhone. The keyboard problem here is the same one solved for
board entry — read
`docs/superpowers/specs/2026-07-15-mobile-board-entry-keyboard-aware-sheet-design.md`
and follow it rather than rediscovering it. `v2/src/components/board-entry/form.tsx`
is the working reference, including its sticky-footer comment at line ~208.

- [ ] **Step 1: Write the component**

Create `v2/src/components/chat/composer.tsx`:

```tsx
import { useState } from 'react'
import { Button } from '#/components/ui/button.tsx'
import { MAX_BODY_LENGTH } from '../../../convex/lib/chat.ts'

type Props = { onSend: (body: string) => Promise<void>; disabled?: boolean }

/**
 * STICKY, so it pins above the mobile keyboard — the same treatment board
 * entry's footer gets, for the same reason.
 *
 * The length cap is imported rather than retyped: the server refuses anything
 * over MAX_BODY_LENGTH with INVALID_MESSAGE, and a client that disagreed with
 * it would let someone type a message that can only fail.
 */
export function Composer({ onSend, disabled }: Props) {
  const [body, setBody] = useState('')
  const [sending, setSending] = useState(false)
  const trimmed = body.trim()
  const tooLong = trimmed.length > MAX_BODY_LENGTH

  async function submit() {
    if (trimmed.length === 0 || tooLong || sending) return
    setSending(true)
    try {
      await onSend(trimmed)
      setBody('')
    } finally {
      setSending(false)
    }
  }

  return (
    <form
      className="sticky bottom-0 flex gap-2 border-t bg-background p-3"
      onSubmit={(e) => { e.preventDefault(); void submit() }}
    >
      <textarea
        className="min-h-10 flex-1 resize-none rounded border p-2"
        value={body}
        onChange={(e) => setBody(e.target.value)}
        placeholder="Message your team"
        disabled={disabled || sending}
        data-testid="chat-composer"
      />
      <Button type="submit" disabled={disabled || sending || trimmed.length === 0 || tooLong}>
        Send
      </Button>
    </form>
  )
}
```

- [ ] **Step 2: Wire it up**

In `v2/src/routes/chat.tsx`, add `useConvexMutation(api.chat.send)` and pass a
handler to `Composer`. On a rejected send, surface the typed code through the
existing `convexErrorCode` / `typedCodeMessage` path in
`v2/src/lib/convex-error.ts` — `RATE_LIMITED` and `INVALID_MESSAGE` both already
have copy there.

- [ ] **Step 3: Gates and commit**

```bash
cd /home/cdub/projects/wordle-teams
git add v2/src/components/chat/composer.tsx v2/src/routes/chat.tsx
git commit -m "feat(chat): the composer, keyboard-aware like board entry"
```

---

### Task 6: "load older", disabled in flight

**Files:**
- Modify: `v2/src/components/chat/message-list.tsx`
- Modify: `v2/src/routes/chat.tsx`

- [ ] **Step 1: Add the control**

Add to `MessageList`'s props `onLoadOlder?: () => void` and `loadingOlder?: boolean`,
and render above the list:

```tsx
{onLoadOlder ? (
  <button
    type="button"
    className="self-center p-2 text-xs underline disabled:opacity-50"
    onClick={onLoadOlder}
    disabled={loadingOlder}
    data-testid="chat-load-older"
  >
    {loadingOlder ? 'Loading…' : 'Load older messages'}
  </button>
) : null}
```

**The `disabled` is not cosmetic.** `olderMessages` is a mutation that charges
the bandwidth meter and is rate-limited to ten pages per player per team per
minute. A double-click spends two of those ten, and two overlapping requests
contend on the caller's own `chatReads` row — which `sendMessageFor`,
`markReadFor` and `olderMessagesFor` all write — costing an OCC retry.

- [ ] **Step 2: Wire it**

In the route, call `useConvexMutation(api.chat.olderMessages)` with `before` set
to the oldest held `createdAt`, prepend the result, and hold a `loadingOlder`
flag across the call. On `SCROLL_RATE_LIMITED`, show the typed message and do
not retry automatically.

- [ ] **Step 3: Verify the refusal copy — it already exists**

`SCROLL_RATE_LIMITED` already has a case in `typedCodeMessage`
(`v2/src/lib/convex-error.ts:144`) and appears in `convexErrorCode`'s condition;
Part 1 added both when it introduced the code. Read what it says and make sure
the UI actually surfaces it rather than a generic failure. Do NOT add a second
case — that switch is exhaustive over `AccessCode` and a duplicate will not
compile.

- [ ] **Step 4: Gates and commit**

```bash
cd /home/cdub/projects/wordle-teams
git add v2/src/components/chat/message-list.tsx v2/src/routes/chat.tsx v2/src/lib/convex-error.ts
git commit -m "feat(chat): load older history, one page at a time"
```

---

### Task 7: unread badges — and the server query Part 1 left out

**Files:**
- Modify: `v2/convex/chat.ts`
- Test: `v2/convex/chat.test.ts` (append)
- Create: `v2/src/components/chat/unread-badge.tsx`

Part 1 built `markRead` but never the read side. There is **no cross-team unread
query** — this task adds it.

- [ ] **Step 1: Write the failing test**

Append to `v2/convex/chat.test.ts`, adding `unreadTeamsFor` to the `./chat.ts` import:

```ts
describe('unreadTeamsFor', () => {
  test('reports a team unread when a teammate has posted since we last read', async () => {
    const t = convexTest(schema, modules)
    await t.run(async (ctx) => {
      const ada = await ctx.db.insert('players', aPlayer())
      const bob = await ctx.db.insert('players', aPlayer({ email: 'bob@example.com' }))
      const team = await ctx.db.insert('teams', aTeam({ playerIds: [ada, bob], owner: ada }))

      await sendMessageFor(ctx, bob, team, 'hello ada')

      expect(await unreadTeamsFor(ctx, ada)).toEqual([team])
    })
  })

  // Sending advances your own cursor, so your own message is never unread.
  test('does not report your own message as unread', async () => {
    const t = convexTest(schema, modules)
    await t.run(async (ctx) => {
      const ada = await ctx.db.insert('players', aPlayer())
      const team = await ctx.db.insert('teams', aTeam({ playerIds: [ada], owner: ada }))
      await sendMessageFor(ctx, ada, team, 'mine')

      expect(await unreadTeamsFor(ctx, ada)).toEqual([])
    })
  })

  test('clears once the conversation is marked read', async () => {
    const t = convexTest(schema, modules)
    await t.run(async (ctx) => {
      const ada = await ctx.db.insert('players', aPlayer())
      const bob = await ctx.db.insert('players', aPlayer({ email: 'bob@example.com' }))
      const team = await ctx.db.insert('teams', aTeam({ playerIds: [ada, bob], owner: ada }))
      await sendMessageFor(ctx, bob, team, 'hello')

      await markReadFor(ctx, ada, team)

      expect(await unreadTeamsFor(ctx, ada)).toEqual([])
    })
  })

  test('never reports a team the caller is not on', async () => {
    const t = convexTest(schema, modules)
    await t.run(async (ctx) => {
      const ada = await ctx.db.insert('players', aPlayer())
      const mallory = await ctx.db.insert('players', aPlayer({ email: 'mallory@example.com' }))
      const team = await ctx.db.insert('teams', aTeam({ playerIds: [ada], owner: ada }))
      await sendMessageFor(ctx, ada, team, 'private')

      expect(await unreadTeamsFor(ctx, mallory)).toEqual([])
    })
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd v2 && pnpm vitest run convex/chat.test.ts`
Expected: FAIL — `unreadTeamsFor is not a function`.

- [ ] **Step 3: Write the implementation**

Append to `v2/convex/chat.ts`:

```ts
/**
 * Which of the caller's teams have messages they have not read.
 *
 * READS NO MESSAGES, which is the point. A badge is a comparison of two small
 * documents per team — the team's chatMeta pointer against the caller's own
 * chatReads cursor — so it stays cheap enough to run on any page load. Counting
 * unread messages instead would read the messages themselves, on every load,
 * for every team, which is exactly the cost this feature is built to avoid.
 *
 * NO MEMBERSHIP CHECK IS NEEDED HERE and that is not an oversight: it starts
 * from the caller's own teams and never accepts a teamId from anyone, so there
 * is nothing to probe. Every other function in this file takes a teamId from
 * the caller and must therefore gate on it.
 */
export async function unreadTeamsFor(
  ctx: ReaderCtx,
  playerId: Id<'players'>,
): Promise<Array<Id<'teams'>>> {
  const teams = await getMyTeamsFor(ctx, playerId)
  const unread: Array<Id<'teams'>> = []

  for (const team of teams) {
    const meta = await ctx.db
      .query('chatMeta')
      .withIndex('by_team', (q) => q.eq('teamId', team.id))
      .unique()
    if (meta === null) continue

    const cursor = await ctx.db
      .query('chatReads')
      .withIndex('by_player_team', (q) => q.eq('playerId', playerId).eq('teamId', team.id))
      .unique()

    if (meta.lastMessageAt > (cursor?.lastReadAt ?? 0)) unread.push(team.id)
  }

  return unread
}

export const unreadTeams = query({
  args: {},
  handler: async (ctx) => {
    const player = await requirePlayer(ctx)
    return await unreadTeamsFor(ctx, player._id)
  },
})
```

`getMyTeamsFor` is exported from `v2/convex/teams.ts`; import it. If its return
shape does not expose `id`, adapt to what it actually returns rather than
changing that function.

- [ ] **Step 4: Run test to verify it passes**

Run: `cd v2 && pnpm vitest run convex/chat.test.ts`
Expected: PASS, 4 new tests.

- [ ] **Step 5: Prove the cursor comparison is load-bearing**

Change `meta.lastMessageAt > (cursor?.lastReadAt ?? 0)` to `meta.lastMessageAt > 0`,
re-run, and confirm both **"does not report your own message as unread"** and
**"clears once the conversation is marked read"** FAIL. Then revert.

Report the observed output.

- [ ] **Step 6: The badge component and marking read on open**

Create `v2/src/components/chat/unread-badge.tsx` rendering a dot when a team id
appears in `useQuery(convexQuery(api.chat.unreadTeams, {}))`, and call
`api.chat.markRead` when a chat is opened, so the badge clears.

- [ ] **Step 7: Gates and commit**

```bash
cd /home/cdub/projects/wordle-teams
git add v2/convex/chat.ts v2/convex/chat.test.ts v2/src/components/chat/unread-badge.tsx
git commit -m "feat(chat): unread badges, and the query Part 1 left for Part 2"
```

---

### Task 8: reset a rejoining member's cursor

**Files:**
- Modify: `v2/convex/teams.ts:651`
- Modify: `v2/convex/billing.ts:279`
- Test: `v2/convex/chat.test.ts` (append)

Closes `wordle-teams-qix.11`. A departed member's `chatReads` row outlives them
when the team survives, so on rejoining their cursor still says they have read
everything and they get no badge for anything sent while away.

**Reset on ADD, not cleanup on remove.** Removal happens in three places today
(`removeMemberFor`, `leaveTeamFor`, and the Phase 5 downgrade in `billing.ts`)
and every future one would have to remember; addition happens in exactly two.

- [ ] **Step 1: Write the failing test**

Append to `v2/convex/chat.test.ts`:

```ts
describe('rejoining a team', () => {
  // qix.11. Their cursor survived them leaving, so without a reset they would
  // rejoin already "caught up" on everything said while they were gone.
  test('a rejoining member sees messages sent while they were away as unread', async () => {
    const t = convexTest(schema, modules)
    await t.run(async (ctx) => {
      const ada = await ctx.db.insert('players', aPlayer())
      const gone = await ctx.db.insert('players', aPlayer({ email: 'gone@example.com' }))
      const team = await ctx.db.insert('teams', aTeam({ playerIds: [ada, gone], owner: ada }))

      await sendMessageFor(ctx, ada, team, 'before they left')
      await markReadFor(ctx, gone, team)
      await ctx.db.patch(team, { playerIds: [ada] })          // they leave

      await sendMessageFor(ctx, ada, team, 'while they were away')

      await resetChatCursorFor(ctx, gone, team)                // they rejoin
      await ctx.db.patch(team, { playerIds: [ada, gone] })

      expect(await unreadTeamsFor(ctx, gone)).toEqual([team])
    })
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Expected: FAIL — `resetChatCursorFor` is not a function.

- [ ] **Step 3: Write the helper**

Append to `v2/convex/chat.ts`:

```ts
/**
 * Forget what a player had read in a team, called when they are ADDED to one.
 *
 * WHY ON ADD RATHER THAN ON REMOVE. A departed member's cursor outlives them
 * whenever the team itself survives, and three separate paths remove a player
 * (removeMemberFor, leaveTeamFor, and the Phase 5 downgrade in billing.ts). An
 * invariant spread across three call sites and every future one is the shape
 * that rots — the same argument that made the team-deletion cascade index by
 * team rather than walk the roster. Addition happens in two places, and the
 * only visible symptom is here: a rejoining member would otherwise arrive
 * already caught up on everything said while they were gone.
 *
 * Leaves the orphaned row alone when nobody rejoins. It is small, unreachable
 * (every read is gated on CURRENT membership) and harmless.
 */
export async function resetChatCursorFor(
  ctx: WriterCtx,
  playerId: Id<'players'>,
  teamId: Id<'teams'>,
): Promise<void> {
  const cursor = await readCursorFor(ctx, playerId, teamId)
  if (cursor !== null) await ctx.db.delete(cursor._id)
}
```

Deleting rather than zeroing also clears the stale rate-limit windows, which a
returning member should not inherit.

- [ ] **Step 4: Call it from both add-member paths**

In `v2/convex/teams.ts`, in `invitePlayerFor` where an existing player is added
(around line 651, the `playerIds: [...team.playerIds, existing._id]` patch), call
`await resetChatCursorFor(ctx, existing._id, team._id)` before the patch.

In `v2/convex/billing.ts`, in the loop around line 279 that re-adds a player to
parked teams, call `await resetChatCursorFor(ctx, playerId, team._id)` in the
branch where they were NOT already a member.

Import from `./chat.ts` in both.

- [ ] **Step 5: Run tests and the existing suites this touches**

```
cd v2 && pnpm vitest run convex/chat.test.ts
cd v2 && pnpm vitest run convex/teams.test.ts
cd v2 && pnpm vitest run convex/billing.test.ts
```

All three must pass. If `teams.test.ts` or `billing.test.ts` fails, that is a
finding — report it rather than adjusting those tests.

- [ ] **Step 6: Gates and commit**

```bash
cd /home/cdub/projects/wordle-teams
git add v2/convex/chat.ts v2/convex/teams.ts v2/convex/billing.ts v2/convex/chat.test.ts
git commit -m "fix(chat): a rejoining member should not arrive already caught up"
```

---

### Task 9: the batched push sweep

**Files:**
- Create: `v2/convex/chatNotify.ts`
- Modify: `v2/convex/crons.ts`
- Test: `v2/convex/chatNotify.test.ts`

Kept out of `chat.ts`, which is already ~560 lines and whose concern is the
conversation, not delivery.

**One notification per team per sweep, never one per message.** Push-per-message
is a spam and cost risk the epic flags, and one chatty team could drive people to
disable notifications for the app entirely — which would cost the board-entry
reminders that already work.

- [ ] **Step 1: Write the failing test**

Create `v2/convex/chatNotify.test.ts`:

```ts
import { convexTest } from 'convex-test'
import { describe, expect, test } from 'vitest'
import schema from './schema'
import { aPlayer, aTeam } from './fixtures.ts'
import { sendMessageFor, markReadFor } from './chat.ts'
import { pendingChatNotificationsFor } from './chatNotify.ts'

const modules = import.meta.glob('./**/*.ts')

describe('pendingChatNotificationsFor', () => {
  test('notifies a member with unread messages they have not been told about', async () => {
    const t = convexTest(schema, modules)
    await t.run(async (ctx) => {
      const ada = await ctx.db.insert('players', aPlayer())
      const bob = await ctx.db.insert('players', aPlayer({ email: 'bob@example.com' }))
      const team = await ctx.db.insert('teams', aTeam({ playerIds: [ada, bob], owner: ada }))
      await sendMessageFor(ctx, ada, team, 'hello')

      const pending = await pendingChatNotificationsFor(ctx)
      expect(pending.map((p) => p.playerId)).toEqual([bob])
    })
  })

  test('does not notify the sender', async () => {
    const t = convexTest(schema, modules)
    await t.run(async (ctx) => {
      const ada = await ctx.db.insert('players', aPlayer())
      const team = await ctx.db.insert('teams', aTeam({ playerIds: [ada], owner: ada }))
      await sendMessageFor(ctx, ada, team, 'mine')

      expect(await pendingChatNotificationsFor(ctx)).toEqual([])
    })
  })

  test('does not notify twice for the same messages', async () => {
    const t = convexTest(schema, modules)
    await t.run(async (ctx) => {
      const ada = await ctx.db.insert('players', aPlayer())
      const bob = await ctx.db.insert('players', aPlayer({ email: 'bob@example.com' }))
      const team = await ctx.db.insert('teams', aTeam({ playerIds: [ada, bob], owner: ada }))
      await sendMessageFor(ctx, ada, team, 'hello')

      const first = await pendingChatNotificationsFor(ctx)
      for (const p of first) await markChatNotifiedFor(ctx, p.playerId, p.teamId)

      expect(await pendingChatNotificationsFor(ctx)).toEqual([])
    })
  })

  test('stops notifying once the member has read the conversation', async () => {
    const t = convexTest(schema, modules)
    await t.run(async (ctx) => {
      const ada = await ctx.db.insert('players', aPlayer())
      const bob = await ctx.db.insert('players', aPlayer({ email: 'bob@example.com' }))
      const team = await ctx.db.insert('teams', aTeam({ playerIds: [ada, bob], owner: ada }))
      await sendMessageFor(ctx, ada, team, 'hello')

      await markReadFor(ctx, bob, team)

      expect(await pendingChatNotificationsFor(ctx)).toEqual([])
    })
  })
})
```

Add `markChatNotifiedFor` to the import from `./chatNotify.ts`.

- [ ] **Step 2: Run test to verify it fails**

Expected: FAIL — `Failed to load .../chatNotify.ts`.

- [ ] **Step 3: Write the implementation**

Create `v2/convex/chatNotify.ts`:

```ts
import { internalMutation } from './_generated/server'
import type { Id } from './_generated/dataModel'
import type { WriterCtx, ReaderCtx } from './winners.ts'

export type PendingChatNotification = {
  playerId: Id<'players'>
  teamId: Id<'teams'>
  teamName: string
}

/**
 * Who is owed a chat notification right now.
 *
 * ONE PER TEAM PER SWEEP, NEVER ONE PER MESSAGE. Push-per-message is a spam and
 * cost risk, and a single chatty team could drive somebody to disable
 * notifications for the whole app — taking the board-entry reminders that
 * already work down with it.
 *
 * A player is owed one when the team's lastMessageAt is newer than BOTH their
 * lastReadAt (they have not seen it) and their lastNotifiedAt (we have not
 * already told them). The second condition is what makes this idempotent across
 * sweeps.
 */
export async function pendingChatNotificationsFor(
  ctx: ReaderCtx,
): Promise<Array<PendingChatNotification>> {
  const metas = await ctx.db.query('chatMeta').collect()
  const pending: Array<PendingChatNotification> = []

  for (const meta of metas) {
    const team = await ctx.db.get(meta.teamId)
    if (team === null) continue

    for (const playerId of team.playerIds) {
      const cursor = await ctx.db
        .query('chatReads')
        .withIndex('by_player_team', (q) => q.eq('playerId', playerId).eq('teamId', meta.teamId))
        .unique()

      const seen = cursor?.lastReadAt ?? 0
      const told = cursor?.lastNotifiedAt ?? 0
      if (meta.lastMessageAt > seen && meta.lastMessageAt > told) {
        pending.push({ playerId, teamId: meta.teamId, teamName: team.name })
      }
    }
  }

  return pending
}

/** Record that we have told this player about this team's current state. */
export async function markChatNotifiedFor(
  ctx: WriterCtx,
  playerId: Id<'players'>,
  teamId: Id<'teams'>,
): Promise<void> {
  const cursor = await ctx.db
    .query('chatReads')
    .withIndex('by_player_team', (q) => q.eq('playerId', playerId).eq('teamId', teamId))
    .unique()
  const now = Date.now()
  if (cursor === null) {
    await ctx.db.insert('chatReads', { playerId, teamId, lastReadAt: 0, lastNotifiedAt: now })
    return
  }
  await ctx.db.patch(cursor._id, { lastNotifiedAt: now })
}

export const sweep = internalMutation({
  args: {},
  handler: async (ctx) => {
    for (const pending of await pendingChatNotificationsFor(ctx)) {
      await markChatNotifiedFor(ctx, pending.playerId, pending.teamId)
      // Delivery reuses Phase 6's plumbing wholesale — push.subscriptionsFor
      // and pushSend.deliverTo, including its 410 endpoint cleanup. Schedule
      // the action rather than awaiting it: a dead endpoint must not fail the
      // sweep for everybody else.
    }
  },
})
```

- [ ] **Step 4: Wire delivery**

Inside the loop, look up the player's subscriptions with
`internal.push.subscriptionsFor` and schedule `internal.pushSend.deliverTo` with
a title naming the team and a deep link to `/chat?team=<teamId>`. Follow exactly
how `v2/convex/reminders.ts`'s `sweep` does it — same scheduling, same payload
shape — rather than inventing a second pattern.

- [ ] **Step 5: Register the cron**

In `v2/convex/crons.ts`, add alongside the existing hourly job:

```ts
crons.hourly('chat notifications', { minuteUTC: 30 }, internal.chatNotify.sweep, {})
```

`minuteUTC: 30` so it does not contend with board-entry reminders on the hour.
**Pass `{}` and nothing else** — a cron's args are serialised to JSON when the
module is evaluated, not when the job fires, so passing `{ now: Date.now() }`
would freeze the timestamp at deploy time forever. `reminders.ts` carries a long
comment about exactly this bug; read it before touching this file.

- [ ] **Step 6: Run tests and gates, then commit**

`crons.test.ts` asserts the registered jobs — expect it to need updating for the
new one, and update it.

```bash
cd /home/cdub/projects/wordle-teams
git add v2/convex/chatNotify.ts v2/convex/chatNotify.test.ts v2/convex/crons.ts v2/convex/crons.test.ts
git commit -m "feat(chat): one batched notification per team per sweep"
```

---

### Task 10: bring chat under the UGC clause

**Files:**
- Modify: `v2/src/routes/terms.tsx:92-110`
- Modify: `v2/src/routes/privacy.tsx`

`/terms` already has a **User Content** section, but it enumerates "wordle
scores, game boards, and team information" — chat messages are not covered, and
there is no moderation or removal language. Chat is the product's first
user-generated-content surface and the first thing that could require acting on
a complaint.

- [ ] **Step 1: Extend the enumeration**

In `v2/src/routes/terms.tsx`, change the User Content list to include chat
messages, e.g. "wordle scores, game boards, team information, and messages you
post in team chat".

- [ ] **Step 2: Add moderation and removal language**

Add a paragraph to that section stating that team owners may remove any message
in their team, that authors may remove their own, and that removal is permanent.
That matches what the code actually does — `deleteMessageFor` is a hard delete
with no tombstone — and a terms page that promised recoverable deletion would be
false.

- [ ] **Step 3: Privacy**

In `v2/src/routes/privacy.tsx`, note that chat messages are stored, visible to
other members of the team, and deleted with the team. All three are true of the
implementation: messages are plain rows, every read is gated on team membership,
and `cascadeDeleteTeam` removes them.

- [ ] **Step 4: Gates and commit**

`src/about-screenshots.test.ts` and any route test asserting page copy may need
updating. Run the full suite.

```bash
cd /home/cdub/projects/wordle-teams
git add v2/src/routes/terms.tsx v2/src/routes/privacy.tsx
git commit -m "docs(chat): bring chat under the user-content and privacy terms"
```

---

### Task 11: the e2e, and the GA bandwidth gate

**Files:**
- Create: `v2/e2e/chat.spec.ts`

- [ ] **Step 1: Write the e2e**

§8 calls for exactly one: **a non-member cannot read a team's chat.** None of the
four gates would catch a regression in an authorization rule, and e2e sits
outside them — so this must be run deliberately rather than assumed green.

Follow the existing patterns in `v2/e2e/invites.spec.ts` for signing in as two
players. Assert that a non-member navigating to `/chat?team=<id>` sees the
refusal rather than the conversation.

- [ ] **Step 2: Run it**

```
cd v2 && pnpm e2e --grep chat
```

**Playwright attaches to whatever already holds port 3000.** A stale dev server
will silently test old code — a two-day-old process once made every run test
stale code here. Confirm nothing is already on :3000 before running.

- [ ] **Step 3: Measure the bandwidth, which is the GA gate**

Acceptance criterion 8 of the spec, and it also discharges `wordle-teams-dcu`,
open since Phase 3.

After chat has been live on beta with real use, read the Convex dashboard's
database-I/O figure and compare it against this spec's model: ~450 B per wake,
~7% of the 1 GB ceiling. Record the measured figure on `wordle-teams-qix` — and
if it diverges materially from the model, say so rather than adjusting the model
to match.

Remember the memory cap on every `bd` command:

```bash
systemd-run --user --scope -p MemoryMax=2G -p MemorySwapMax=0 --quiet bd note wordle-teams-qix "..."
```

- [ ] **Step 4: Commit**

```bash
cd /home/cdub/projects/wordle-teams
git add v2/e2e/chat.spec.ts
git commit -m "test(chat): the one e2e no quality gate would catch"
```

---

## What this plan does NOT cover

- **`wordle-teams-qix.10`** — the cascade's unbounded `.collect()` of a team's
  whole history. P3, bites only at volumes far beyond this app's.
- **Reactions, images, editing, threads, search, typing indicators** — §1's
  out-of-scope list, several rejected for cost reasons rather than product ones.
- **Retention** — chat history is deliberately unbounded; §0 establishes that
  storage is trivial and the reactive window is what governs cost.

## Spec coverage for Part 2

| Spec requirement | Where |
| --- | --- |
| §10.6 route, message list, keyboard-aware composer | Tasks 1, 4, 5 |
| §10.7 client sync: append, refetch-on-revision, gap | Task 3 |
| §10.8 unread badges | Task 7 |
| §10.9 batched push sweep on the hourly cron | Task 9 |
| §10.10 UGC clause | Task 10 |
| §10.11 bandwidth measurement and GA gate | Task 11 |
| §4 scrollback unsubscribed, button disabled in flight | Task 6 |
| §6 SCROLL_RATE_LIMITED surfaced, no auto-retry | Task 6 |
| §8 one e2e: a non-member cannot read | Task 11 |
| `qix.11` rejoining member's cursor | Task 8 |
| `qix.13` pointer invalidation | Task 2 |
