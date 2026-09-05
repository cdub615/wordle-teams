# Team chat — the free retention surface, built to a hard bandwidth budget

**Epic:** `wordle-teams-qix` (post-v2 roadmap #1)
**Phase:** 7.5 — delivered WITH v2, before the Phase 8 cutover
**Status:** approved 2026-09-05. Replaces the epic's stub body.

---

## Why this exists

An in-app chat surface inside each team, free for every tier. It is a retention
and activation play, not a monetizable add-on.

The funnel is the argument. 322 of 392 accounts have never entered a single
board, so for most of the user base the scoreboard is *literally empty* — there
is nothing to look at and therefore no reason to open the app. Chat is the only
item on the post-v2 roadmap that gives a never-activated user something to come
back to that does not require them to have played first.

Convex reactivity makes realtime messaging cheap to *build*, which is why this
is roadmap item #1: the highest engagement leverage per unit of implementation
effort on the new stack.

### One premise the brainstorm corrected

The epic's body worried that a never-activated user would never discover a new
chat tab on their own, which would make outbound notification the load-bearing
part of the feature. That is not the situation. **The v2 launch email is the
discovery mechanism** — the owner is emailing every existing player about the
redesign at cutover, and that email can link straight into a team's chat.

So chat does not need to perform its own cold outreach. What it needs is to
handle the *second* visit: a teammate posts a week later and the returning user
is not in the app. That is what section 5 is for, and it is a much smaller
problem than cold re-engagement.

---

## The binding constraint, and why it shapes everything

Production runs on the **Convex free tier and must stay there until app revenue
covers an upgrade.** As of 2026-09-05 that revenue is zero: `wordle-teams-g3k`
closed the same day, downgrading the last comped Lemon Squeezy holdover, so
there are no active paying subscribers. The owner's and their spouse's accounts
remain deliberately comped and are not revenue.

Chat is therefore a **free feature with a real marginal cost and nothing funding
it.** Cheapness is a correctness requirement here, not a preference.

`wordle-teams-dcu` established that **database I/O — not function calls, not
storage — is the binding free-tier limit**, at 1 GB/month, and that free-plan
caps are hard: mutations begin *failing* rather than generating a bill. A
bandwidth overrun is an availability incident.

### Where the cost actually comes from

The epic's re-scope note reasoned from team counts and concluded the cost was
likely comfortable. That reasoning is incomplete. Convex re-runs a reactive
query on every write that touches it, so the driver is not how many teams exist
but:

```
message rate  ×  connected clients  ×  subscribed window size
```

Modelled on a lively conversation — a 5-person team, everyone with chat open,
50 messages traded, a 50-message window at ~250 bytes per document:

| | per re-run | per conversation | 10 teams × 30 days |
| --- | --- | --- | --- |
| 50-message window | 12.5 KB | 3.1 MB | **~940 MB** |
| 30-message window (chosen) | 7.5 KB | 1.9 MB | **~560 MB** |

The naive design lands within a rounding error of the ceiling. The chosen one
has real headroom, and — more importantly — **its cost is bounded by
construction** rather than by user behaviour. See section 4.

These are worst-case figures: they assume every member has the chat screen open
for the duration. Section 3's placement decision is what makes that rare.

---

## 1. Scope

One channel per team. Plain text and emoji. Free for all tiers.

Emoji need no special handling — they are Unicode and travel in a string, which
is why they cost nothing extra and are in v1 while everything else below is not.

### Explicitly out of scope

Cross-team and global chat, DMs, voice, file sharing, chat search, images,
message editing, read receipts, and threads or topics (one channel per team is
the v1 answer, confirmed).

**Reactions are out**, and for a cost reason rather than a product one: every
reaction is a write that invalidates the message window and re-runs it for every
connected client. At this scale reactions could plausibly outnumber messages,
which would double or triple the only metric we cannot afford to spend.

**Typing indicators are out**, and are called out separately because they are the
single worst thing that could be added to this design. A write per keystroke
against a reactive window would dominate the entire I/O budget by itself.

---

## 2. Schema

```ts
chatMessages: defineTable({
  teamId: v.id('teams'),
  playerId: v.id('players'),   // author
  body: v.string(),            // trimmed, 1..2000 chars
}).index('by_team', ['teamId'])

chatMeta: defineTable({        // exactly one row per team that has ever had a message
  teamId: v.id('teams'),
  lastMessageAt: v.number(),
}).index('by_team', ['teamId'])

chatReads: defineTable({
  playerId: v.id('players'),
  teamId: v.id('teams'),
  lastReadAt: v.number(),
  lastNotifiedAt: v.optional(v.number()),

  // Rate-limit window. Lives here rather than in its own table because the send
  // mutation already reads and writes this row — see section 6.
  postWindowStartedAt: v.optional(v.number()),
  postsInWindow: v.optional(v.number()),
})
  .index('by_player_team', ['playerId', 'teamId'])
  .index('by_player', ['playerId'])
```

### Ordering uses `_creationTime`, not an explicit `createdAt`

It is already indexed, already ordered within `by_team`, and free. Several
existing tables carry an explicit optional `createdAt`, but that exists to
support the Supabase copy — a row copied from v1 has a real timestamp to
preserve. Chat has no Supabase counterpart and never will, so there is nothing
to carry and a second timestamp field would be redundant storage on the hot
path.

### `lastMessageAt` lives in `chatMeta`, NOT on the team document

This is the most important line in the schema. Denormalising it onto `teams`
would be the obvious move and it would be a serious mistake: **every message
would invalidate every query watching that team document, so posting a chat
message would re-run the scoreboard for everyone looking at it.** That is
precisely the hidden multiplier this design exists to avoid. A separate small
table confines the invalidation to things that actually care about chat.

### Deletes are hard, not soft

A tombstone would occupy a slot in the 30-message window and be scanned on every
re-run for the life of the team. With no report path there is no evidence to
preserve (see section 3), so the cost buys nothing.

### Unread badges cost nothing

A badge is `chatMeta.lastMessageAt > chatReads.lastReadAt` — a comparison of two
small documents per team, with **no message reads at all.** A player belongs to
few teams, so the badge query stays trivial no matter how much chat volume
exists.

---

## 3. Authorization, placement, and moderation

### Every function checks membership. The route guard is not the boundary.

`requireTeamMemberFor` already exists in `convex/access.ts` and throws
`NOT_A_MEMBER`. Every chat query and mutation calls it — **reads included.**

The `/chat` route guard exists only so that a non-member is not shown a screen
that cannot load. It is UX, not security: the Convex functions are callable
directly and are the real gate.

Reusing `NOT_A_MEMBER` rather than inventing a chat-specific code preserves an
existing deliberate property documented in `access.ts` — a non-member and a
nonexistent team return the same error, so chat cannot be used to probe whether
a given team id exists.

**An ex-member loses access to history**, because the check reads the team's
current `playerIds`. This is intended.

### Placement: `/chat?team=<id>`

A flat route with a search param, matching the existing `/team?team=<id>`
convention rather than introducing a nested path-param route alongside it.

Placement is a **cost decision as much as a UX one**, which is why it is in this
section. Every client subscribed to the chat window multiplies the re-run cost
of every message. Putting chat inline on the scoreboard would make every open
scoreboard a live chat subscriber — the worst case in the table above, and the
one most likely to hit the ceiling. A dedicated route means clients subscribe
only while actually looking at chat.

It also gives the launch email a direct, linkable destination, and a full-height
mobile layout for a keyboard-driven surface. Traffic is heavily iPhone; the
composer faces the same iOS keyboard problems already solved in
`2026-07-15-mobile-board-entry-keyboard-aware-sheet-design.md`, and should reuse
that work rather than rediscover it.

### Moderation: delete own, owner deletes any

A member may delete their own messages. The team owner may delete any message in
their team. No report path, no app-level admin tooling, no per-user blocking.

This matches the actual threat model. Teams are invite-only groups of friends,
so the realistic bad case is someone in a team being unpleasant, not strangers
arriving. The owner already holds remove-member powers, so the escalation path
exists without building one.

`requireTeamOwnerFor` is the existing helper for the owner branch. Note that
ownership is a role rather than authorship — Phase 5's softened downgrade
reassigns it to the earliest-joined remaining member — so "the owner" is
whoever currently holds the role, not whoever created the team.

Chat is the product's first user-generated-content surface. `/terms` and
`/privacy` need a UGC clause; that is in scope for this epic.

---

## 4. Reads: a fixed tail, and non-reactive scrollback

The live query is `by_team` → `.order('desc').take(30)`.

**This is pinned at roughly 7.5 KB per re-run regardless of how much history a
team accumulates.** That property is the point: cost cannot degrade over time or
with user behaviour.

"Load older" is a **separate one-shot query that is not subscribed.** Older
messages do not live-update, which is correct behaviour for history in any case.

### Alternatives ruled out

**Convex `paginate()` / `usePaginatedQuery`** is the idiomatic pattern and was
rejected deliberately. It re-runs *all currently loaded pages* on invalidation,
so a user who scrolls far back becomes progressively more expensive for as long
as they stay connected. That is exactly the unbounded behaviour a hard-capped
free tier punishes.

**A denormalized "recent messages" blob** — one document per team holding the
last N messages — would be cheapest of all, scanning a single document per
re-run. Rejected as premature and as fighting Convex's grain: write contention
on a single hot document, the 1 MB document limit, and deletes becoming surgery
on an array. Revisit only if measured volume goes far beyond what 70 active
players suggest.

---

## 5. Notifications: batched, never per-message

Extend the existing hourly Convex cron (`reminders.sweep`, `convex/crons.ts`),
which already exists and already runs.

For each team where `chatMeta.lastMessageAt` is newer than a member's
`chatReads.lastReadAt` **and** newer than their `lastNotifiedAt`, send one
coalesced web push — "3 new messages in *Team Name*" — deep-linked to
`/chat?team=<id>`. Then advance `lastNotifiedAt`.

### The count in that message costs reads, and that is fine here

Section 2 states that unread *badges* cost no message reads. Producing the
number "3" does require reading messages, so these two are not the same
mechanism and the difference is deliberate:

- **The badge** is evaluated on page loads, for every team a player belongs to,
  potentially constantly. It must be free, so it is a timestamp comparison and
  shows presence-of-unread only — a dot, not a number.
- **The push count** is computed at most once per team per hour, inside a cron,
  only for teams that actually have new messages, and never inside a reactive
  subscription. It is a bounded range scan on `by_team` since `lastReadAt`.

If that scan ever proves non-trivial in the section 9 measurement, the fallback
is to drop the count and send "New messages in *Team Name*". The notification is
still useful without the number; the badge could not be made free after the
fact.

**One notification per team per sweep, never one per message.** Push-per-message
is a spam and cost risk the epic flags, and one chatty team could drive people to
disable notifications for the app entirely — which would cost us the board-entry
reminders that already work.

This reuses the Phase 6 plumbing wholesale: `pushSend.deliverTo`,
`push.subscriptionsFor`, and the endpoint-410 cleanup path. The cron's own cost
is a scan of small `chatMeta` and `chatReads` rows, not messages.

---

## 6. Limits

- **Body:** trimmed, 1–2000 characters. Empty rejected.
- **Rate limit:** 20 messages per rolling 60 seconds, per player per team,
  enforced in the send mutation.

The rate limit is not politeness. On a hard-capped free tier a runaway client —
a loop, a stuck key, a bad retry — is an **availability risk**, because
exhausting database I/O makes mutations start failing app-wide, not just in
chat.

### Where the rate-limit state lives, so that enforcing it is free

Counting a player's recent messages by scanning `chatMessages` would make every
send more expensive — paying I/O to protect I/O. Instead the counter lives on
the `chatReads` row for that `(playerId, teamId)`, which **the send mutation
already reads and writes anyway**, because sending a message also advances your
own `lastReadAt`:

```ts
postWindowStartedAt: v.optional(v.number()),
postsInWindow: v.optional(v.number()),
```

If `now - postWindowStartedAt >= 60_000`, reset the window to `now` and the
count to 1; otherwise increment and reject once it exceeds 20. No additional
document is read to enforce it.

---

## 7. Membership and lifecycle

- **A member leaves:** their messages remain, so the conversation stays
  coherent. A departed author renders as "Former member".
- **A team is deleted:** cascade to that team's `chatMessages`, `chatMeta`, and
  `chatReads`.
- **A non-member reads:** refused by `requireTeamMemberFor`, including for
  someone who was previously a member.

---

## 8. Testing

`convex-test` covers membership enforcement on every function, the rate limit,
delete permissions for both the author and owner branches, cursor advancement,
and the cascade on team deletion.

**Errors must go through the existing `accessError` path rather than plain
`Error`.** Plain `Error` messages are redacted in production but are *never*
redacted by `convex-test`, so a test can assert a message that production would
never actually show.

**One e2e is warranted:** a non-member cannot read a team's chat. None of the
four quality gates would catch a regression in an authorization rule, and e2e
sits outside those gates, so this needs to be run deliberately rather than
assumed green.

---

## 9. Acceptance criteria

1. A team member can send and read plain-text messages in their team, in
   realtime, at `/chat?team=<id>`.
2. A non-member is refused by the Convex functions themselves — verified by
   test, not by the route guard.
3. A member can delete their own message; the team owner can delete any message
   in their team.
4. Unread state shows without reading any messages.
5. A member with unread messages receives at most one coalesced push per team
   per hourly sweep, deep-linked into the conversation.
6. `/terms` and `/privacy` carry a UGC clause.
7. **Convex database I/O per active team is measured against the 1 GB monthly
   ceiling before GA.** This is the epic's own ship gate and it also discharges
   `wordle-teams-dcu`'s acceptance criteria, which has been open since Phase 3.

---

## 10. How this decomposes

Roughly, and to be confirmed by the implementation plan:

1. Schema, plus the `chatMessages`/`chatMeta`/`chatReads` tables and indexes.
2. Convex functions: send, list-tail, load-older, delete — each with
   `requireTeamMemberFor`, plus the rate limit and body validation.
3. The `/chat?team=<id>` route and message list, reusing the keyboard-aware
   composer learnings.
4. Unread badges via the timestamp comparison.
5. The batched push sweep, extending the existing hourly cron.
6. Team-deletion cascade.
7. UGC clause in `/terms` and `/privacy`.
8. The bandwidth measurement and the GA gate.
