# Onboarding and activation — the next-step card, team-less first play, and invite links

**Design for `wordle-teams-qt4` (roadmap #4, app onboarding tour).** Written
2026-09-07, after a brainstorm with the owner, during Phase 7.5
(`wordle-teams-wty4`).

It replaces `qt4`'s "open questions" body. It is also the product-side answer to
`wordle-teams-456` (87% of prod signups never enter a board) and carries the
client-side funnel events `wordle-teams-390` asks for on the activation half of
the funnel; `390` keeps the login half.

---

## Why this exists

Of 392 players in production, 70 have ever entered a single board — 18%
activated, measured directly on 2026-09-05, corroborating `456`'s 87% figure
from an independent count on a different denominator. The population this design
exists to convert is 322 accounts.

`456` traced two fresh signups end to end and found the dominant shape is not
what the epic assumed. It is not "invited and could not join" — that was the
invite→join bug, since fixed. It is **signed up, made a team of one, invited
nobody, never entered a board**. Six of the eight most recently created teams
have exactly one member and `invited=[]`. One traced signup's entire lifetime in
the product was 39 seconds and ended on a team-less screen.

### The sequencing problem, stated plainly

`qt4`'s re-scope note says "instrumentation before design remains the right
call." That is correct in principle and unbuildable as a *gate* here. v2 lives
on beta, production is still v1, and Phase 7.5 blocks the DNS cutover. Events
shipped now collect nothing meaningful until cutover, so "instrument, wait,
then design" cannot finish before the launch it is meant to inform. The data
arrives after the moment it was supposed to shape.

**The owner's decision, taken 2026-09-07: ship instrumentation AND a full
designed onboarding together in Phase 7.5.** The design is argued from the v1
evidence above, which is unusually good for this kind of problem — two
end-to-end traces and a clear structural signature in the teams table. The
events then grade it after launch.

---

## Three findings from the code that changed the design

These were not known when `qt4` was written, and each one moved a decision.

**1. There is no invite token.** `convex/inviteEmails.ts:30` says so outright:
the invite lives in `teams.invited` as a bare email string, and
`completeProfileFor` scans every team for a matching address and auto-joins
(`convex/players.ts:226`). So the invited joiner arrives at `/app` already on a
populated team, and `completeProfileFor` returns a `claimed` array — the backend
already knows, at profile-completion time, which entry path the user is on.

**2. Boards are player-owned, not team-owned.** `upsertBoard` takes no `teamId`
(`convex/scores.ts:256`) and `dailyScores` has no team column. The `teamId` in
`BoardEntryForm` exists only to read `getTeamMonth` for display. Teams aggregate
their members' boards for a month; they do not own them. **A team-less player
can therefore enter a board, and the score is waiting for them the moment they
create or join a team.** This is what makes "let them play immediately"
possible, and it directly answers the signup that died in 39 seconds on a
team-less screen with nothing to do.

**3. Half the instrumentation already exists.** `src/lib/funnel.ts` →
`/api/funnel` → LogSnag is built, with two hard rules documented and enforced:
never block or fail auth (`wordle-teams-4ov` is that bug in v1), and never carry
PII (the repo is public). It emits four login-side events and nothing after the
callback. Extending it is cheap and needs no new infrastructure.

A fourth, smaller: **`monthly-winner-celebration` already establishes the
seen-flag precedent** — `hasSeen` lives server-side in Convex, written on
dismiss, not in `localStorage`. This design follows it.

---

## What we are building

### The next-step card

One card at the top of `/app`, above `TodayPanel`, driven by player state. It
**supersedes `TeamsEmptyState` entirely** — that component's only job was the
no-team case, which is now one of three tasks — so
`src/components/teams/empty-state.tsx` is deleted and `app.tsx`'s no-team branch
stops short-circuiting the dashboard.

It carries the model line, which retires with the card:

> Everyone plays their own Wordle. Fewer guesses scores more points. Highest
> monthly total wins.

That direction is confirmed from the scoring defaults (`convex/fixtures.ts:34`):
one guess `+5`, two `+3`, three `+2`, four `+1`, five `0`, six `-1`, failed
`-3`. Fewer guesses earns more points and the **highest** monthly total wins.
An earlier draft of this copy said "lowest wins", which would have taught new
users the wrong rule on the one screen built to explain the model.

### The three tasks

Independent, **no ordering and no precedence**, each rendered only while
incomplete:

| Task | Complete when | Action |
|---|---|---|
| Enter today's board | player has ≥1 `dailyScores` row with non-empty `guesses` | opens `BoardEntryButton` |
| Create a team | `getMyTeams().length ≥ 1` | opens `CreateTeamDialog` |
| Invite someone | any of the player's teams has `playerIds.length ≥ 2` **or** `invited.length ≥ 1` | opens the invite flow |

The ordering question was put to the owner and deliberately declined: we do not
have evidence for whether playing first or inviting first converts better, and
the events will tell us after launch. Showing both without a precedence claim is
the honest version.

An **invited joiner satisfies *create* and *invite* on arrival**, so they see a
single task. Satisfied tasks *vanish* rather than rendering as pre-checked
busywork the user did not do.

### Completion predicate detail

`enteredBoard` must filter on **non-empty `guesses`**, not merely on row
existence. v2 deletes a board when guesses and answer are both empty
(`convex/scores.ts:233`), so v2-born rows always carry real guesses — but
migrated v1 rows predate that rule, which is exactly why `456` counts non-empty
guesses. Without the filter every migrated empty row reads as an activation.

The predicate is computed live and is **not latched**. Clearing a board
therefore un-completes the task and the card returns. That is intended: it
re-offers something the user can finish in ten seconds.

`hasInvited` is evaluated **globally across the player's teams, not per team**,
so someone already on a populated team is not nagged after later creating a solo
one. Slightly imprecise, deliberately: the task is "be in a room with someone",
and they are.

### Retirement and dismissal

Auto-retires when all applicable tasks complete. A dismiss control hides it
early, because a player who genuinely wants to track only their own scores would
otherwise be asked to invite somebody forever.

The flag is `onboardingDismissedAt` on the Convex **player document**, matching
the `hasSeen` precedent — server-side, so it follows the user across devices and
stays measurable. `app-menu.tsx` gains a "Show getting started" entry to replay
it.

### Team-less board entry

This is the one piece of "let them play immediately" that is not free.
`BoardEntryForm` reads `getTeamMonth(teamId, month)` for prefill and takes
`showLetters` from the team. With no team there is neither, so it needs a
team-less data path and a `showLetters` default of `true` (v1's default for a
new team).

---

## Invite links

**The largest single piece of this epic, and separable.** It gets its own child
issues so it can be cut without taking the card down with it; the card falls
back to the existing `InvitePlayerDialog` if it is.

The case for it: the only way to invite anyone today is typing their email
address. Six of eight recent teams invited nobody. "Know and type your friend's
email on a phone" is a plausible reason why, and sending a link is how people
actually invite friends.

**Shape.** New `inviteLinks` table — `teamId`, `token`, `createdBy`,
`expiresAt`, `revokedAt` — with a `by_token` index. A separate table rather than
a token on the team document because revoke and rotate are much cleaner as rows.
New route `/join/$token`: signed in consumes immediately; signed out stashes the
token, goes through `/login` and `/complete-profile`, and consumes on arrival.

**Three things it must get right.**

*The free-tier cap must be re-enforced on this path.* `completeProfileFor`
enforces `FREE_TEAM_LIMIT` during the invited-scan
(`convex/players.ts:179-197`), and a link join bypasses that code entirely.
Behavioral difference worth stating: an email invite over the cap *parks* the
address for later upgrade, and a link cannot park — it must refuse with a clear
message.

*A link is a capability; an email invite is an addressee.* Anyone holding the
link joins. That is a real change to the trust model and is accepted
deliberately here rather than by accident. Expiry, revoke, and the owner seeing
who joined are the mitigation.

*Token generation must be checked against Convex's determinism rules* before
committing to generating it inside a mutation. This design does not assert what
is permitted there; it is a short check in the first task, with an action as the
fallback.

---

## Instrumentation

Extend `src/lib/funnel.ts` and `funnel-payload.ts` with a new `activation`
channel:

- `onboarding_view` — carrying the set of incomplete tasks
- `onboarding_task_click` — which task
- `onboarding_complete`
- `onboarding_dismiss`

**Client-side, through the existing `/api/funnel` → LogSnag path**, rather than
emitting from Convex mutations. The beacon is same-origin so ad-blocking is not
a factor; the two hard rules are already written down and enforced in that
module; and putting a third-party call inside Convex would place LogSnag on the
board-write path for no reliability gain.

**One hazard specific to this app.** The card is driven by a reactive query, and
a reactive Convex query is invalidated by every document it reads. Left
unguarded, `onboarding_view` emits on every invalidation and drowns the channel.
It must be deduped by task-set within a session.

The existing four login events and the `login-funnel` channel are unchanged.

---

## Testing

Cheapest tier that can actually observe each thing, per the three tiers this
repo uses:

- **Task-state machine** — extracted as a pure module `src/lib/onboarding-tasks.ts`,
  plain unit tests under the default edge-runtime. This is where the predicate
  edge cases live: non-empty guesses, global `hasInvited`, the invited joiner
  seeing exactly one task.
- **Card emit and dedupe behavior** — jsdom `*.hook.test.ts`, following the
  existing 15-file pattern (`// @vitest-environment jsdom`, `createElement`, so
  the file stays `.ts`).
- **Link consume** — `convex-test`: cap refusal, expiry, revoked, already-member,
  unknown token.
- **Signed-out join, end to end** — Playwright. This sits **outside** the four
  gates and needs the `:3000` occupancy check first, or it tests stale code.

All four gates run from `v2/`: `pnpm test:once`, `lint`, `typecheck`, `build`,
with exit codes captured directly rather than through a pipe. Any date or
locale assertion pins `timeZone` and `locale` explicitly and is checked under
`TZ=UTC`, which is what CI runs.

---

## Acceptance criteria

Closes `qt4`'s existing criteria:

1. The card renders the correct task set for all three entry paths, asserted in
   tests.
2. Per-task events are emitted and deduped, so drop-off is attributable to a
   specific task.
3. Activation rate — signup to first non-empty board — recorded on `qt4` for a
   defined window before and after launch. **The pre-launch baseline is already
   measured: 70 of 392, 18%, on 2026-09-05.** The post number is taken 30 days
   after cutover.

---

## Explicitly out of scope

Marketing-site explainer content (roadmap #5), lifecycle re-engagement email
(roadmap #7), and an in-app help center — all carried over from `qt4`'s original
scope boundary. Also out: any change to the login half of the funnel, which
stays with `390`, and any overlay/coach-mark tour framework, which was
considered and rejected.

### Approaches ruled out

**Overlay tour with spotlight and coach marks** — the cheap build. Rejected
because it narrates rather than guides, is dismissed and then teaches nothing on
visit two, anchors popovers to live DOM on a 375px iPhone where the login
traffic actually is, and does nothing about the team-of-one shape that `456`
traced. Its apparent advantage — clean per-step analytics — is illusory: in the
chosen design the player's own state *is* the funnel stage, which is a truer
measurement that cannot drift out of sync with the UI.

**A scripted `/welcome` flow before the dashboard** — rejected as a standalone
because it puts another wall between a new account and the app, and the traced
signup died in 39 seconds against exactly such a wall. The Phase 7 landing page
already makes the model pitch pre-signup. The one part worth keeping — that the
model is stated nowhere inside the app — survives as the card's model line.

**A separate dismissible "How this works" card** above the checklist — rejected
because two stacked cards on a 375px phone push the scoreboard below the fold,
and it duplicates the landing page. If three sentences prove too thin, the
events will say so and this is a small change away.
