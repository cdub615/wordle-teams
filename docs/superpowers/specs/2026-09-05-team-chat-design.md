# Team chat — the free retention surface, built to a hard bandwidth budget

**Epic:** `wordle-teams-qix` (post-v2 roadmap #1)
**Phase:** 7.5 — delivered WITH v2, before the Phase 8 cutover
**Status:** approved 2026-09-05. Revised the same day — see "Revision 1" below.
Replaces the epic's stub body.

---

## Revision 1, and why the first version was wrong

The first approved version subscribed a reactive query to the newest 30
messages. That works and it fit the free tier with some headroom, but it was
paying for the same data over and over: **a reactive `.take(30)` re-reads all
thirty messages every time one arrives**, when a client that already holds
history up to time *T* needs only the messages after *T* — normally exactly one.

Revision 1 replaces it with **subscribe to the pointer, fetch incrementally**
(section 4), which costs about 17× less, and adds a **budget meter** (section 6)
that turns a large margin into an actual guarantee. Section 11 records the
free-versus-paid question that prompted the rethink, so it does not get
re-litigated.

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
is not in the app. That is section 5, and it is a much smaller problem than cold
re-engagement.

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
bandwidth overrun is an availability incident, not an invoice.

### Where the cost actually comes from

The epic's re-scope note reasoned from team counts and concluded the cost was
likely comfortable. That reasoning is incomplete. Convex re-runs a reactive
query on every write that touches it, so the driver is not how many teams exist
but:

```
message rate  ×  connected clients  ×  bytes re-read per wake
```

The last term is the one the design controls, and it is where revision 1 lives.
Modelled on a lively conversation — a 5-person team, everyone with chat open, 50
messages traded, ~250 bytes per message document:

| architecture | per wake, per client | one conversation | 10 teams × 30 days |
| --- | --- | --- | --- |
| Reactive 50-message window (naive) | 12.5 KB | 3.1 MB | ~940 MB |
| Reactive 30-message window (v1 of this spec) | 7.5 KB | 1.9 MB | ~560 MB |
| **Pointer + incremental fetch (chosen)** | **~450 B** | **~113 KB** | **~34 MB** |

Adding the one-off window load each time somebody opens chat — 7.5 KB per
session per team, generously ~34 MB/month — the chosen design lands near
**68 MB against a 1 GB ceiling, about 7%.**

These remain worst-case figures: they assume every member has chat open for the
duration. Section 3's placement decision is what makes that rare, and section 6's
meter is what makes the bound hard rather than merely likely.

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
reaction is a write that wakes every connected client. At this scale reactions
could plausibly outnumber messages, and unlike a message a reaction carries
almost no conversational value per byte.

**Typing indicators are out**, and are called out separately because they are the
single worst thing that could be added to this design. A write per keystroke
against a live subscription would dominate the entire I/O budget by itself.

---

## 2. Schema

```ts
chatMessages: defineTable({
  teamId: v.id('teams'),
  playerId: v.id('players'),   // author
  body: v.string(),            // trimmed, 1..2000 chars
  createdAt: v.number(),
}).index('by_team_createdAt', ['teamId', 'createdAt'])

chatMeta: defineTable({        // exactly one row per team that has ever had a message
  teamId: v.id('teams'),
  lastMessageAt: v.number(),
  // Bumped by ANY mutation to the team's history, deletes included — see §4.
  revision: v.number(),
}).index('by_team', ['teamId'])

chatReads: defineTable({
  playerId: v.id('players'),
  teamId: v.id('teams'),
  lastReadAt: v.number(),
  lastNotifiedAt: v.optional(v.number()),

  // Rate-limit window. Lives here rather than in its own table because the send
  // mutation already reads and writes this row — see §6.
  postWindowStartedAt: v.optional(v.number()),
  postsInWindow: v.optional(v.number()),
})
  .index('by_player_team', ['playerId', 'teamId'])
  .index('by_player', ['playerId'])

chatBudget: defineTable({      // one row per calendar month — see §6
  month: v.string(),           // 'YYYY-MM'
  estimatedBytes: v.number(),
  degraded: v.boolean(),
}).index('by_month', ['month'])
```

### An explicit `createdAt`, walking back v1's `_creationTime` decision

Version 1 of this spec used `_creationTime` because it is already indexed and
free. Revision 1 needs to range-scan *"messages since T"* on every wake, and an
explicit `createdAt` with a `['teamId', 'createdAt']` index makes that
unambiguously expressible. Relying on `_creationTime` as an implicit trailing
index field may well work, but this query is the hot path of the whole feature
and it should not rest on a detail worth double-checking. The cost is one number
per message; it buys the 17×.

### `lastMessageAt` lives in `chatMeta`, NOT on the team document

This is the most important line in the schema. Denormalising it onto `teams`
would be the obvious move and it would be a serious mistake: **every message
would invalidate every query watching that team document, so posting a chat
message would re-run the *scoreboard* for everyone looking at it.** That is
precisely the hidden multiplier this design exists to avoid. A separate small
table confines the invalidation to things that actually care about chat.

### Deletes are hard, not soft

A tombstone would occupy a slot in the loaded window and be re-read on every
window refresh for the life of the team. With no report path there is no
evidence to preserve (see §3), so the cost buys nothing.

### Unread badges cost nothing

A badge is `chatMeta.lastMessageAt > chatReads.lastReadAt` — a comparison of two
small documents per team, with **no message reads at all.** A player belongs to
few teams, so the badge query stays trivial no matter how much chat volume
exists.

---

## 3. Authorization, placement, and moderation

### Every function checks membership. The route guard is not the boundary.

`requireTeamMemberFor` already exists in `convex/access.ts` and throws
`NOT_A_MEMBER`. Every chat query and mutation calls it — **reads included**, and
that emphatically includes the pointer subscription and the incremental fetch,
which are the two easiest places to forget.

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
section. Every client subscribed to a team's pointer is woken by every message.
Putting chat inline on the scoreboard would make every open scoreboard a live
subscriber — the worst case in the table above. A dedicated route means clients
subscribe only while actually looking at chat.

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

## 4. Reads: subscribe to the pointer, fetch incrementally

**This is the core of revision 1.** Convex reactivity is used for *notification*,
not for *data transfer*.

1. **The live subscription watches `chatMeta` for one team** — a single small
   document. A new message bumps `lastMessageAt` and `revision`, which is what
   wakes the client. Cost per wake: one small document.
2. **On waking, the client fetches only what it lacks:** messages with
   `createdAt` greater than the newest it already holds, via
   `by_team_createdAt`. In a live conversation that is one document.
3. **On opening chat**, the client loads the newest 30 messages once.
4. **"Load older"** is a separate one-shot query, not subscribed.

Together, a message costs a connected client roughly 450 bytes instead of
7.5 KB — see §6 for why it is 450 rather than 350.

### `revision` exists because deletes do not move `lastMessageAt`

Deleting an older message changes history without changing the newest timestamp,
so a client watching `lastMessageAt` alone would never notice and would keep
showing a deleted message. `revision` increments on **any** mutation to a team's
history. A client that sees `revision` jump without new messages **refetches its
loaded window** rather than appending — the rarer, more expensive path, taken
only when it is actually needed.

### The honest costs of this approach

- **It is hand-rolled incremental sync**, not the idiomatic Convex one-liner. It
  needs tests for the append path, the refetch-on-revision path, and the gap
  case where a client was disconnected long enough to miss more than a window's
  worth of messages (in which case it must refetch, not append).
- **Older messages are not live.** Scrollback does not update in realtime, which
  is correct behaviour for history in any case.

### Alternatives ruled out

**Convex `paginate()` / `usePaginatedQuery`** re-runs *all currently loaded
pages* on invalidation, so a user who scrolls far back becomes progressively
more expensive for as long as they stay connected — the unbounded behaviour a
hard cap punishes.

**A reactive `.take(30)` window** — version 1 of this spec — is simple and
correct but re-reads thirty documents to deliver one, which is the 17× being
recovered here.

**A denormalized "recent messages" blob**, one document per team holding the
last N messages, would scan a single document per wake. Rejected as fighting
Convex's grain: write contention on one hot document, the 1 MB document limit,
and deletes becoming surgery on an array. The pointer design gets most of the
benefit without any of that.

---

## 5. Notifications: batched, never per-message

Extend the existing hourly Convex cron (`reminders.sweep`, `convex/crons.ts`),
which already exists and already runs.

For each team where `chatMeta.lastMessageAt` is newer than a member's
`chatReads.lastReadAt` **and** newer than their `lastNotifiedAt`, send one
coalesced web push — "3 new messages in *Team Name*" — deep-linked to
`/chat?team=<id>`. Then advance `lastNotifiedAt`.

**One notification per team per sweep, never one per message.** Push-per-message
is a spam and cost risk the epic flags, and one chatty team could drive people to
disable notifications for the app entirely — which would cost us the
board-entry reminders that already work.

This reuses the Phase 6 plumbing wholesale: `pushSend.deliverTo`,
`push.subscriptionsFor`, and the endpoint-410 cleanup path.

### The count in that message costs reads, and that is fine here

§2 states that unread *badges* cost no message reads. Producing the number "3"
does require reading messages, so these are not the same mechanism and the
difference is deliberate:

- **The badge** is evaluated on page loads, for every team a player belongs to,
  potentially constantly. It must be free, so it is a timestamp comparison and
  shows presence-of-unread only — a dot, not a number.
- **The push count** is computed at most once per team per hour, inside a cron,
  only for teams that actually have new messages, and never inside a live
  subscription. It is a bounded range scan on `by_team_createdAt` since
  `lastReadAt`.

If that scan ever proves non-trivial in the §9 measurement, the fallback is to
drop the count and send "New messages in *Team Name*". The notification is still
useful without the number; the badge could not be made free after the fact.

---

## 6. Limits, and the budget meter

### Message limits

- **Body:** trimmed, 1–2000 characters. Empty rejected.
- **Rate limit:** 20 messages per rolling 60 seconds, per player per team,
  enforced in the send mutation.

The rate limit is **purely an availability backstop and carries no upgrade
messaging** — see §11. On a hard-capped free tier a runaway client (a loop, a
stuck key, a bad retry) can exhaust database I/O and make mutations start
failing *app-wide*, not just in chat. It is set high enough that real
conversations never encounter it.

#### Where the rate-limit state lives, so that enforcing it is free

Counting a player's recent messages by scanning `chatMessages` would make every
send more expensive — paying I/O to protect I/O. Instead the counter lives on
the `chatReads` row for that `(playerId, teamId)`, which **the send mutation
already reads and writes anyway**, because sending a message also advances your
own `lastReadAt`.

If `now - postWindowStartedAt >= 60_000`, reset the window to `now` and the
count to 1; otherwise increment and reject once it exceeds 20. No additional
document is read to enforce it.

### The budget meter, which makes the bound hard

§0's ~6% figure is a large margin, not a proof. The meter converts it into a
guarantee.

On each send, the mutation increments `chatBudget.estimatedBytes` for the
current month by a **deliberately conservative upper bound**:

```
teamSize × BYTES_PER_WAKE      // every member treated as if connected
```

This over-counts on purpose — most members are not connected — so the meter
trips early rather than late. It is one small document write inside a mutation
already writing three.

When `estimatedBytes` crosses a threshold (**700 MB**, leaving headroom for
every other query in the app), `degraded` is set. While degraded:

- the pointer subscription is not opened; chat falls back to **manual refresh**,
- sending still works, so a conversation is never cut off,
- the client shows an honest notice that live updates are paused.

`degraded` clears at the start of a new month.

#### How the client learns it is degraded

`degraded` lives in `chatBudget`, which clients do not subscribe to, so the
**pointer query returns it** — that query reads the team's `chatMeta` row and
the current month's `chatBudget` row and returns
`{ lastMessageAt, revision, degraded }`.

That makes a wake two small documents rather than one. Folded into the model:

```
BYTES_PER_WAKE ≈ 450 B      // ~200 B pointer (2 small docs) + ~250 B one new message
```

which is the constant the meter multiplies by `teamSize`. The month's worst case
is ~34 MB — around 7% of the ceiling once the ~34 MB of window loads is
included, and bounded by the meter regardless.

The alternative, a separate subscription to the budget row, would wake every
connected client in the app whenever any team sent a message. That is exactly
the cross-team invalidation this design avoids elsewhere, so the extra document
on the existing pointer is the cheaper shape.

**Degrading chat is always preferable to the alternative**, which is Convex
refusing mutations app-wide and taking board entry down with it.

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

`convex-test` covers membership enforcement on every function, the rate limit
and its window reset, delete permissions for both the author and owner branches,
cursor advancement, the cascade on team deletion, and the budget meter's
increment and threshold.

The incremental-sync logic needs its own tests and is the most defect-prone part
of this design: **the append path, the refetch-on-`revision`-bump path, and the
gap case** where a client missed more than a window's worth of messages and must
refetch rather than append.

**Errors must go through the existing `accessError` path rather than plain
`Error`.** Plain `Error` messages are redacted in production but are *never*
redacted by `convex-test`, so a test can assert a message that production would
never actually show.

**One e2e is warranted:** a non-member cannot read a team's chat. None of the
four quality gates would catch a regression in an authorization rule, and e2e
sits outside those gates, so it must be run deliberately rather than assumed
green.

---

## 9. Acceptance criteria

1. A team member can send and read plain-text messages in their team, in
   realtime, at `/chat?team=<id>`.
2. A non-member is refused by the Convex functions themselves — verified by
   test, not by the route guard.
3. A member can delete their own message; the team owner can delete any message
   in their team, and connected clients see the deletion without a reload.
4. Unread state shows without reading any messages.
5. A member with unread messages receives at most one coalesced push per team
   per hourly sweep, deep-linked into the conversation.
6. The budget meter increments on send, and crossing the threshold demonstrably
   degrades chat to manual refresh without breaking sending.
7. `/terms` and `/privacy` carry a UGC clause.
8. **Convex database I/O per active team is measured against the 1 GB monthly
   ceiling before GA**, and the measured figure is compared against this spec's
   ~450 B/wake model. This is the epic's own ship gate and it also discharges
   `wordle-teams-dcu`'s acceptance criteria, open since Phase 3.

---

## 10. How this decomposes

**Part 1 — the logic core.** Pure logic over plain data, testable in the
existing `edge-runtime` vitest environment with no DOM:

1. Schema: the four tables and their indexes.
2. Convex functions — send, pointer, incremental fetch, window load, load-older,
   delete — each calling `requireTeamMemberFor`.
3. Rate limiting and body validation on the `chatReads` row.
4. The budget meter and its degrade threshold.
5. The team-deletion cascade.

**Part 2 — the surface.** Planned after Part 1 lands:

6. The `/chat?team=<id>` route, message list, and keyboard-aware composer.
7. Client-side incremental sync: append, refetch-on-revision, gap handling.
8. Unread badges.
9. The batched push sweep on the existing hourly cron.
10. The UGC clause in `/terms` and `/privacy`.
11. The bandwidth measurement and the GA gate.

This mirrors how `wordle-teams-418` was split, and for the same reason: the
logic can be built and proven without touching a browser, so it should be.

---

## 11. Considered and rejected: making chat paid

Recorded so it is not re-proposed. The question was raised directly by the owner
on 2026-09-05, once the free-tier bandwidth pressure became visible.

**Per-member Pro gate — rejected.** Chat is a group feature: its value to you is
a function of other people being able to use it, so a team where one of five is
Pro has a chat with one person in it. Worse, it **inverts the feature's
purpose** — chat exists to reach the 322 accounts that have never entered a
board, and those are the least-engaged and least likely to pay.

**Team-level Pro gate** (owner pays, whole team gets chat) — **rejected, though
it is the coherent version.** It solves the group problem entirely and is a real
upgrade incentive. But it still excludes most teams from the launch email's
headline feature, and with revision 1 the cost pressure that motivated it is
gone.

**Volume throttle with an upgrade prompt — rejected, and it was the best of the
three.** A volume cap charges exactly the people generating the cost, which no
feature gate does; nobody is excluded from the conversation; and the people who
hit a cap are by definition the best conversion targets. It also does not
violate the Pro spec's "nothing currently free moves behind the paywall",
because chat is not currently anything. Rejected because:

- At ~6% of the ceiling the throttle would protect nothing real. It would be
  artificial scarcity, and on a social feature that reads as petty.
- It puts a paywall in the middle of a conversation, visibly, in front of the
  user's friends — the worst available moment.
- It fits nowhere in the approved tier's one-line story, *"free shows you today,
  Pro shows you everything you have done."* It would be the only Pro benefit
  that is not about history or insight, weakening the sentence the Pro spec
  calls the pricing page and the email.
- `docs/superpowers/specs/2026-09-05-pro-tier-and-insights-design.md` already
  lists chat as ✔ for both tiers. Changing that is a real edit to an approved
  spec and needs a better reason than a cost problem that has been solved.

**The standing decision:** chat is free, the rate limit is an availability
backstop with no upgrade messaging, and the budget meter collects the volume
data. If chat ever becomes genuinely expensive, revisit with evidence — the
argument for charging will be far stronger then than it is today, with zero
subscribers and a feature that has not shipped.
