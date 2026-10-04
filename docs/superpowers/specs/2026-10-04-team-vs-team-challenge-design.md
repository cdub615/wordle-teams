# Team versus team — a challenge scoreboard between two teams

**Issue:** wordle-teams-zic8.2 (parent epic: wordle-teams-zic8)
**Date:** 2026-10-04
**Status:** approved design, awaiting implementation plan

---

## 1. What this is

A challenge is a record between two teams, scored on **pooled average guesses** over a
window that starts the day after acceptance and ends with the calendar month. A live
challenge reads through to the `teamMonthStats` aggregate that already exists; a closed
one is a frozen snapshot. A team may run several challenges at once and accumulates a
record against each opponent.

## 2. Why this avenue leads, and why it is cheap

The parent epic settled two things that shape everything below.

**The metric is raw average guesses**, the owner's decision 2026-10-03, for all three
competition avenues. This is not reopened here. The constraint behind it is still real:
`convex/schema.ts:291-302` indexes `scoringSystems` `by_team_and_effectiveFrom`, so
scoring is per-team *and* month-versioned, and team points carry no cross-team meaning
whatsoever. Guess count is raw board data, so it means the same thing for every player
regardless of team or weighting.

**This avenue is immune to the corpus-depth wall.** It compares two specific teams whose
members already share boards with one another, so it needs no cohort, no population
minimum and no new privacy posture. It is correct at 70 actives and correct at 70,000.

And a finding from this brainstorm that was not visible when the stub was written:

**The data layer already exists, built for a different feature.** `teamMonthStats`
(`convex/schema.ts:392-412`) holds one document per team per month carrying
`members[] = {playerId, boards, attempts, solved, failed}` plus `days[]` with per-day
entries. It is maintained **incrementally on board write** — `winners.ts`'s
`recomputeTeamMonth` already reads exactly those rows to find the month's winner and
hands them to `storeTeamMonthStats`, so the aggregate rides a path that already exists —
with a daily sweep for the current month as a safety net, and it skips writing an
unchanged month.

`convex/lib/teamStats.ts:232` `meanAttemptsOf` is declared "THE SINGLE DEFINITION of how
well did they do", and it **rounds to 1dp before comparison** on purpose
(wordle-teams-iht.3.3) so a teaser and a paid panel cannot disagree about who is ahead.
A failed board is 7 attempts (`convex/lib/board.ts:34` `attemptsFor`), which settles "how
is a failed board counted" by precedent rather than by a new decision.

So this feature introduces **no new aggregate**. It projects slices of one that is
already maintained.

## 3. Decisions

Settled in the brainstorm of 2026-10-04 and not to be re-litigated during
implementation.

| Question | Decision |
| --- | --- |
| Prerequisite | `wordle-teams-rac` lands **before** any scoreboard is user-visible |
| Metric | Pooled: total attempts ÷ total boards, rounded 1dp; failure = 7 attempts |
| Roster fairness | Pooled average is roster-size-independent; no top-N, no exclusions |
| Small samples | Per-team minimum board count, else the result is `void` |
| Ties | Broken on boards played |
| Initiate | Any **Pro** member of the challenging team |
| Accept | **Any** member of the challenged team — Pro **not** required |
| Backstops | Either owner may withdraw/cancel; per-team "refuse incoming" boolean; proposals expire |
| Before acceptance | Nothing numeric renders |
| Cross-boundary payload | Per-member **totals** (boards, attempts, average) on both sides; no per-day detail crosses the boundary |
| Window | Acceptance day → end of calendar month (see §7.4 for the short-window rule) |
| Entry points | Dual membership + tokenised challenge link. No directory |
| Free vs Pro | Headline free (both averages, both board counts, who is ahead); per-member rows Pro |
| Lifecycle | Multiple concurrent challenges + head-to-head history; results snapshotted |
| Notifications | Push on **accept** and **close**, reusing the existing delivery path |

### 3.1 Why consent is not a vote

A vote was considered and rejected on a measurement, not a preference. Production holds
171 teams against 392 players of whom **70 have ever entered a board**, so most rosters
carry members who will never open the app again. Any threshold defined over the *roster*
— majority, let alone unanimous — cannot pass on the teams that are most active, because
active teams still carry dead weight. A vote would mostly produce "pending forever",
which is a worse experience than a decline.

What replaces it: **a threshold of one.** The first member to respond decides. That is
the vote the owner wanted, at the only threshold with no timeout pathology, and it is
sufficient because what is consented to is *a match*, not a disclosure (§3.2).

### 3.2 Why an average guess count is not sensitive data

The owner's position, and it is correct: an average guess count is a game score. Wordle
is built around sharing results, NYT shipped its own leaderboard with score history in
April 2025 (wordle-teams-0hx finding 1), and this app already shows the number to
teammates.

**The `globalThreshold.ts` rule does not carry over, and it is worth being precise about
why.** `MIN_GLOBAL_CONTRIBUTORS = 30` exists because a percentile computed over six
people, *combined with the team boards a member can already read*, lets a stranger's
score be inferred **by subtraction**. A two-team challenge tells you the number
directly, to a named pair of consenting teams. Nothing is inferred, so the threshold has
nothing to bite on. Do not import that rule here.

Three residual concerns survive, and only the last one constrains the payload:

1. **The per-day trace, not the average.** "They average 4.1" is a score; "they played
   every day in March except the 14th" is an activity log about someone who never joined
   a team with you. This is why the cross-boundary payload carries `members[]` totals and
   never `days[]`.
2. **Being bad at it in front of strangers** is a product-feel issue rather than a
   privacy one, and the honest mitigation is the fairness rule, not a consent gate.
3. **wordle-teams-do2 is open** — today's answer is already visible to teammates who have
   not played yet. Sending `days[]` across the boundary would widen a live spoiler leak
   to people outside the team. The totals-only payload closes this by construction.

### 3.3 Why `rac` is a hard gate on shipping

`wordle-teams-rac` (P1) is a live production data defect: duplicate `(playerId,
puzzleDay)` pairs were copied faithfully from v1 and are in v2 now. A duplicate is
collected twice by `rollupTeamMonth`, so a month's `boards` and `attempts` both
double-count one day. The mean becomes `(S+a)/(n+1)` — it **over-weights one day rather
than strictly inflating**, so it can move either direction. In a ~20-board month one
duplicate shifts a player's average by up to ~0.15, enough to flip a tie at 1dp, and
`rac` records that duplicates land preferentially on the accounts with the most history —
exactly the players a scoreboard features.

The error size is not the reason for the gate. **`rac`'s step 4 is "recompute affected
monthly totals"**, which runs through the same `recomputeTeamMonth` path this scoreboard
reads. If the repair lands after a challenge has been played, a finished head-to-head
result silently restates itself — "we won March" becomes "we lost March". A slightly
wrong average is a quality bug; a restated result is a broken social claim, and that is
the one thing a competitive feature cannot survive.

Design and planning do not wait on `rac`. **Shipping does.**

### 3.4 Why initiation is Pro but acceptance is not

Initiating is the privileged act and is the monetization story. Requiring Pro on the
*accepting* side was considered and rejected: it makes reach the square of Pro
penetration, and it closes the discovery loop by hiding the feature from every free team
— so the thing most likely to sell Pro would be invisible to everyone who has not bought
it. wordle-teams-0hx established that this product's differentiators are discovered
after arrival rather than searched for, which makes a challenged free team the single
best conversion moment this feature has. Being challenged also costs nothing and consumes
no privilege, so there is no free rider to protect against.

The free/Pro split *within* an accepted challenge mirrors the existing gate exactly:
`teamRank` already sends the free tier a position derived from mean attempts while
`memberAverages` is the paid panel. A free member therefore sees the result and not the
per-member rows — the same line insights already draws, so nothing contradicts it.

## 4. Data model

One new table, one new optional field on `teams`.

```ts
teamChallenges: defineTable({
  challengerTeamId: v.id('teams'),
  // ABSENT UNTIL A LINK IS CLAIMED. A dual-membership proposal names its
  // opponent at creation; a link proposal does not know who will claim it.
  // Absence is meaningful, as with inviteLinks.revokedAt.
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
  // Link proposals only. THE TOKEN IS THE SECRET AND THE KEY, exactly as
  // inviteLinks.token is — looked up by_token on a path the claimant reaches
  // before we know which team they act for, so it must be unguessable.
  token: v.optional(v.string()),
  expiresAt: v.number(),               // proposal TTL; see §7.3
  acceptedBy: v.optional(v.id('players')),
  startDay: v.optional(v.string()),    // 'YYYY-MM-DD', set on acceptance
  endDay: v.optional(v.string()),      // 'YYYY-MM-DD', set on acceptance
  result: v.optional(challengeResult),  // frozen at close; see §6
  createdAt: v.number(),
})
  .index('by_token', ['token'])
  .index('by_challenger_and_status', ['challengerTeamId', 'status'])
  .index('by_opponent_and_status', ['opponentTeamId', 'status'])
```

**Two indexes rather than one**, because a team sits on either side of a challenge and
Convex cannot OR across indexes. "My team's challenges" is two point queries, never a
scan. An array field holding both ids would be unindexable — the same limitation
`schema.ts` already records for "teams containing player X".

`teams` gains:

```ts
acceptsChallenges: v.optional(v.boolean()),  // absent means yes
```

Optional-by-omission following `inviteLinks.revokedAt` and
`players.onboardingDismissedAt`: absence is the default state, not a missing value, so no
backfill is needed for 171 existing teams.

## 5. Rules live in `convex/lib/challenge.ts`, with no imports

This file must have **no imports**, for the reason `chatLimits.ts`, `globalThreshold.ts`
and `insightsAccess.ts` have none: the client needs these rules, and reaching them
through `../access.ts` drags `auth.ts` — the whole Better Auth server surface — into the
client chunk.

It also matters for testing. wordle-teams-obw means nothing in this repo can drive an
authed Convex wrapper, so **a rule left inside a mutation is a rule no test can
execute.** Everything decidable goes here as a pure function:

- `windowFor(acceptedOnPuzzleDay)` → `{ startDay, endDay }`, including the short-window
  rule (§7.4)
- `teamTotalsOver(days, startDay, endDay)` → `{ boards, attempts, members }`, summing
  `days[].entries` within the window. It takes `days` rather than a whole stats
  document so a caller can concatenate two months for the short-window rule of §7.4,
  and it is generic over the player id so the schema's `Id<'players'>` flows through
  without this module importing the generated data model — the idiom
  `lib/teamStats.ts` already uses for the same reason.

**The window projection reads `days[]`, never `members[]`.** `members[]` holds
whole-month totals, and a challenge window is almost never a whole month, so using it
would silently count boards played before acceptance — the retroactivity §8 exists to
avoid. `days[]` carries `{ puzzleDay, entries: [{ playerId, attempts }] }` and is
complete for the month, so summing the entries inside the window gives boards and
attempts per player and per team.

Only boards and attempts are derivable this way — not `solved`/`failed`, which exist
only on `members[]`. That is sufficient and not a gap: a failed board is already folded
into attempts as 7 by `attemptsFor`, so nothing in the metric, the outcome or the
snapshot needs a separate failure count. Do not reach for `members[]` to recover one.
- `teamAverageOf({ boards, attempts })` → `number | null`, null when no boards
- `outcomeOf(challenger, opponent)` → `'challenger' | 'opponent' | 'tie' | 'void'`
- the four constants of §7

`teamAverageOf` must round to 1dp **before** any comparison, for the reason
`meanAttemptsOf` does: rank on the raw quotient and two teams can sit one ten-thousandth
apart, rank differently, and display the identical average.

## 6. The result snapshot, and why it is forced

```ts
const challengeSide = v.object({
  teamId: v.id('teams'),
  boards: v.number(),
  attempts: v.number(),
  average: v.union(v.number(), v.null()),
  members: v.array(v.object({
    playerId: v.id('players'),
    boards: v.number(),
    attempts: v.number(),
    average: v.union(v.number(), v.null()),
  })),
})

const challengeResult = v.object({
  challenger: challengeSide,
  opponent: challengeSide,
  outcome: v.union(
    v.literal('challenger'), v.literal('opponent'),
    v.literal('tie'), v.literal('void'),
  ),
  closedAt: v.number(),
})
```

**The snapshot is forced, not chosen.** `convex/teamStats.ts` states that backfill is a
free feature: a player can edit a month from last year, and trigger 1 recomputes that
exact `(team, month)` pair on the spot. A closed challenge re-derived from
`teamMonthStats` would therefore silently restate itself whenever anyone edited an old
board — the same failure that drove the `rac` ordering in §3.3, arriving from a
legitimate source instead of a defect.

**`average` is stored even though it is derivable from `boards` and `attempts`.** The
rounding is display-coupled, so storing it is what makes it impossible for a historical
record to disagree with what was shown at the time.

## 7. The five constants

All in `convex/lib/challenge.ts`, each the single source of truth for its number, read
by both the server check and the client affordance. `teamLimits.ts`'s banner records what
happens when a cap is duplicated instead: the client swap and the server enforcement
drift apart, and a test written against a literal passes straight through the drift.

1. **`MIN_CHALLENGE_BOARDS = 10`** — per team, per challenge window. Below it that side
   has no valid figure and the outcome is `void`. This is the only place the small-sample
   hazard lives: under pooling, one lucky board carries 1/N of the weight and self-damps,
   so no per-player minimum is needed. Each team's board count renders beside its average
   so a thin win is visible rather than hidden.
2. **`MAX_ACTIVE_CHALLENGES = 5`** — per team, counting both directions. Needed because
   concurrency is allowed; without it an unbounded set of scoreboards lands on one team
   page.
3. **`PROPOSAL_TTL_DAYS = 7`** — a `pending` challenge past `expiresAt` becomes
   `expired`. Nothing sits unanswered forever.
4. **`SHORT_WINDOW_DAYS = 7`** — accepted with fewer than 7 days left in the month, the
   window runs to the end of the **following** month instead. Without this rule a
   late-month challenge is born guaranteed-`void`, which is a bad first experience of the
   feature. This is the only case where a window crosses a month boundary, costing two
   `teamMonthStats` documents per team instead of one.
5. **One active challenge per unordered team pair** — enforced, not a constant. Two
   simultaneous challenges between the same two teams would render two scoreboards over
   near-identical data. Checked by querying `by_challenger_and_status` and
   `by_opponent_and_status` for `active` and matching the other team in both directions.

## 8. Server surface — `convex/challenges.ts`

All public functions use `requirePlayer` / `requireTeamMemberFor` / `requireTeamOwnerFor`
from `access.ts`, and report refusals through `accessError` so the message is not
redacted in production. Plain `Error` messages **are** redacted in prod while
`convex-test` never redacts, so a plain throw is a message no test can see go missing
(wordle-teams, "ConvexError redaction blind spot").

| Function | Kind | Authorisation | Does |
| --- | --- | --- | --- |
| `proposeToTeam` | mutation | Pro + member of challenger | Names an opponent team the caller is also a member of. Checks §7.2 and §7.5 and the opponent's `acceptsChallenges` |
| `proposeByLink` | mutation | Pro + member of challenger | Creates a `pending` challenge with a token and no `opponentTeamId` |
| `acceptChallenge` | mutation | Member of opponent team | Sets `active`, `acceptedBy`, `startDay`, `endDay`. Schedules push to both rosters |
| `claimChallengeLink` | mutation | Member of the team they nominate | Resolves a token, binds `opponentTeamId`, then as `acceptChallenge` |
| `declineChallenge` | mutation | Member of opponent team | → `declined` |
| `withdrawChallenge` | mutation | Proposer, or challenger's owner | `pending` → `withdrawn` |
| `cancelChallenge` | mutation | Either team's owner | `active` → `closed` with the result as computed at that moment |
| `setAcceptsChallenges` | mutation | Team owner | Flips the boolean on `teams` |
| `challengesForTeam` | query | Member of the team | Active challenges with live scoreboards, plus the head-to-head record |

### 8.1 Which checks run when

A link proposal does not know its opponent at creation, so three of the four limits
**cannot** be checked at propose time and must be re-checked at acceptance. Getting this
wrong is how a link becomes a bypass for a limit the owner set.

| Check | At propose | At accept / claim |
| --- | --- | --- |
| Caller is Pro | yes | n/a — accepting never requires Pro |
| Caller is a member of the team they act for | yes | yes |
| Challenger under `MAX_ACTIVE_CHALLENGES` | yes | yes — it may have filled up while pending |
| Opponent under `MAX_ACTIVE_CHALLENGES` | only for `proposeToTeam` | **yes, always** |
| Opponent's `acceptsChallenges` | only for `proposeToTeam` | **yes, always** |
| One active challenge per pair | only for `proposeToTeam` | **yes, always** |

**`acceptsChallenges: false` blocks a link claim too**, even though the claimant is
consenting on their own team's behalf. It is the owner's setting, and a member routing
around it through a link would make it advisory rather than a control.

### 8.2 Record semantics

The head-to-head record against an opponent counts `outcome` values: `'challenger'` /
`'opponent'` resolve to a win or a loss for the viewing team, `'tie'` is a draw, and
**`'void'` is neither** — it is recorded and shown as "no result" rather than folded
into either column, because a void means the boards were never there to judge.

### 8.3 Roster changes and team deletion

**A deleted team closes its challenges.** Team deletion already cascades
(`teamMonthStats` rows are deleted "without ceremony" because they are derived). A
challenge is *not* derived, so it is set to `closed` with whatever result its window
holds at that moment rather than deleted, which keeps the surviving team's record
honest. A `pending` challenge whose team is deleted becomes `withdrawn`.

**The roster is evaluated at compute time, not snapshotted at acceptance.** `teamStats`
computes over the team's current `playerIds`, so a member who joins mid-challenge
contributes their boards from days inside the window — including days before they
joined the team. This is bounded (never boards from before acceptance) and it is the
deliberate choice: snapshotting the roster at acceptance would exclude a member who
joins legitimately mid-month, which is the more common case by far in a feature whose
point is getting teams playing. Named here so it is a known property rather than a
discovered one.

**Acceptance must not be retroactive:** `startDay` is the day *after* acceptance, so
every board that counts was played knowing the challenge was live.

**A team's figure is per-challenge.** Because each window begins on its own acceptance
day, a team can legitimately average 4.1 against one opponent and 3.9 against another in
the same month. Each scoreboard therefore carries its own "since Oct 12" label, and there
is no single team average on this surface. This is a consequence of the non-retroactive
window combined with concurrency, and it is correct rather than a defect.

## 9. Close rides the existing daily sweep

`crons.daily('team month aggregates', { hourUTC: 0, minuteUTC: 45 }, internal.teamStats.sweep, {})`
already runs just after midnight UTC. Closing due challenges joins that sweep. **No new
cron lane** — `crons.ts` records at length why lanes are kept apart and why run count
rather than data volume is what grew the bill, so adding a lane for this would be the
wrong trade when an existing daily pass is already in the right place at the right time.

Closing a challenge computes both sides from `teamMonthStats`, writes `result`, sets
`status: 'closed'`, and schedules push to both rosters. The close must be **idempotent**:
a challenge already holding a `result` is skipped, so a re-run cannot restate a frozen
record or double-notify.

The sweep must honour `sweepsEnabled(process.env.SWEEPS_ENABLED)` as its **first
statement**, the rule `chatNotify.ts` and `lib/sweeps.ts` already carry, and for the same
reason: a gate placed after the state-consuming step schedules nothing while still
marking the work done.

## 10. Notifications — push on accept and on close

Reuses the Phase 6 delivery path **wholesale**, adding nothing to the plumbing:

- Scheduled with `ctx.scheduler.runAfter(0, internal.pushSend.deliverTo, …)` and
  **never awaited**. `deliverTo` is a `'use node'` action that talks to a push service
  over the network; awaiting it would let one dead endpoint fail the mutation for
  everybody else. It carries its own 404/410 cleanup and its own single bounded retry.
- **The decision and the state change commit in the same transaction**, which is why the
  push is scheduled from the mutation (and from the sweep mutation) rather than from an
  action. Split across an action calling back into mutations, a failure between the two is
  a duplicate push — the exact thing that path is designed not to produce.
- **Gated on the player's own push consent**, the same
  `player.reminderDeliveryMethods.includes(PUSH_METHOD)` array the board-entry and chat
  sweeps honour. **No per-feature notification setting is invented**: the app has one Push
  switch and delivering to somebody who has turned it off is not a defensible reading of
  it. This matters beyond tidiness — turning the switch off deletes only the current
  browser's subscription row, so a second device's row can outlive the consent.
- Every notification **names its opponent**, because concurrency means "your challenge
  finished" has no referent.

**Known risk, not this feature's to fix but stated so a missing notification is not
debugged here:** three push defects are open against production —
wordle-teams-2dl6 (P1, subscriptions created on beta are origin-bound and silently
deliver nowhere after the cutover), wordle-teams-i5pj (P1, push can be ON with no stored
subscription and nothing notices) and wordle-teams-cvvn (P2, a rotated subscription is
never re-saved). Challenge pushes inherit that reliability exactly. They do not make it
worse, and this feature must not grow a workaround for them.

## 11. UI surface

- **`src/routes/team.tsx`** gains a Challenges section: active scoreboards (opponent
  name, both averages, both board counts, who is ahead, the window's start day), the
  head-to-head record against each opponent, and the propose affordance.
- **Propose flow**: Pro-gated. Either pick another team the caller is also a member of,
  or generate a challenge link. The free-tier affordance follows `team-picker.tsx`'s
  existing pattern of showing the upgrade path rather than a dead control.
- **`src/routes/challenge.$token.tsx`** — a new route mirroring `join.$token.tsx`, the
  proven shape for an unauthenticated-arrival tokenised path. The claimant picks which of
  their teams accepts.
- **Per-member rows** render for Pro only. The free view shows the full result and board
  counts — it is not a teaser that hides who is winning, only who is carrying it.

## 12. Read cost per refresh

A team with *k* active challenges:

- *k* `teamChallenges` documents (two point queries on the status indexes)
- 1 `teamMonthStats` document for its own current month
- *k* `teamMonthStats` documents, one per opponent
- 2 per team instead of 1 only for a challenge under the §7.4 short-window rule

Closed challenges read **zero** `teamMonthStats` documents — the snapshot is the record.
Nothing is ever re-derived from `dailyScores`, and no new aggregate is introduced. With
`MAX_ACTIVE_CHALLENGES = 5` the worst case is a bounded handful of document reads.

The one scan this feature inherits: listing "other teams you are on" for the
dual-membership proposal. `schema.ts` records that there is deliberately no index for
"teams containing player X" because Convex cannot index array membership, with 171 teams
making collect-and-filter acceptable, and that it should be revisited only if that count
changes by an order of magnitude. This feature accepts that cost and does not change it.

This satisfies the parent epic's Wall 3 hygiene note — "prefer an aggregate maintained
incrementally on board write, the shape `winners.ts` already uses" — by reusing exactly
that aggregate rather than building a second one.

## 13. Testing

- **Everything decidable is a pure function in `convex/lib/challenge.ts`** and is unit
  tested there. wordle-teams-obw means no test in this repo can drive an authed wrapper,
  so a rule inside a mutation is untestable.
- **Database-level behaviour is driven through `ctx.db` directly**, the pattern
  `convex/globalComparison.test.ts` established for exactly this reason.
- **Both sides of every threshold.** `MIN_CHALLENGE_BOARDS`, `MAX_ACTIVE_CHALLENGES` and
  the §7.4 day count are each tested at and below the boundary. `globalThreshold.ts`'s
  own banner says a threshold tested in one direction is vacuous and that this repository
  has the scars to match.
- **Tests derive their counts from the constants**, never from literals, for the reason
  `teamLimits.ts` gives: a test written against a literal keeps passing through the drift.
- **`TZ=UTC`.** Every window boundary is a `puzzleDay` string comparison through
  `lib/puzzleDay.ts`, and a date test that passes only on the host timezone passes
  locally and fails in CI.
- **`result` present ⟺ `status === 'closed'`** is load-bearing in two places and
  expressible in neither the schema nor a schema test: the close path uses
  `result !== undefined` as its idempotency guard, and `recordAgainstFor` uses
  `result === undefined` to skip rows it has already filtered to `'closed'`. So a
  `'closed'` row with no `result` is silently dropped from the head-to-head record.
  Pin the pairing behaviourally in the close tests.
- **`ChallengeOutcome` is declared twice** — a TS union in `lib/challenge.ts` and four
  `v.literal`s in `schema.ts`. Convex cannot build a validator from a TS type and
  `lib/challenge.ts` must stay import-free, so the duplication is unavoidable; the drift
  is not. A type-equality assertion between `ChallengeOutcome` and
  `NonNullable<Doc<'teamChallenges'>['result']>['outcome']` fails if either side moves.
  `teamLimits.ts`'s banner is the precedent — a duplicated value drifts, and a test
  written against a literal passes straight through the drift.
- **Idempotent close** is pinned by running the sweep twice and asserting the result and
  the notification count are unchanged.
- **The sweep's disabled path** is pinned by a disabled run followed by an enabled one,
  the shape `chatNotify.test.ts` uses, so the gate cannot be moved below the
  state-consuming step without a test failing.

## 14. Explicitly out of scope

- A searchable team directory, or any stranger-to-stranger discovery. This imports
  wordle-teams-zic8.3's moderation and naming questions into a feature that has none.
- Cross-team board visibility, or any per-day detail crossing the team boundary.
- Any negotiated, agreed or per-challenge scoring system. The metric is settled; see §2.
- Leagues, or any contest among more than two teams. That is wordle-teams-zic8.3.
- Email notification. Push only in the first release.
- A Pro requirement on the accepting side; see §3.4.
- Individual opt-out from a scoreboard row. Either the hidden row still counts toward the
  team average, in which case the number is published anyway and merely unattributed, or
  it does not, in which case a team can improve its average by hiding its weakest player.
  Both are worse than no opt-out.
- Fixing the three open push defects of §10.

## 15. Acceptance criteria

1. `wordle-teams-rac` is resolved in production before any challenge scoreboard is
   visible to users.
2. A Pro member can propose a challenge to another team they are a member of, and can
   generate a challenge link; a non-Pro member can do neither and is shown the upgrade
   path rather than a dead control.
3. Any member of the challenged team can accept, with no Pro requirement, and nothing
   numeric about either team renders before acceptance.
4. Either team's owner can withdraw or cancel, and can set their team to refuse incoming
   challenges.
5. A pending proposal expires after `PROPOSAL_TTL_DAYS` and renders as expired.
6. The scoreboard reports each team's pooled average to 1dp with its board count beside
   it; a side below `MIN_CHALLENGE_BOARDS` yields `void`; a 1dp tie is broken on boards
   played.
7. Teams of different sizes are compared without a top-N rule and with no member
   excluded.
8. The window starts the day after acceptance and ends with the calendar month, except
   under the §7.4 short-window rule.
9. A closed challenge's numbers do not change when a board inside its window is later
   edited.
10. Per-member rows render for Pro members only; free members see both averages, both
    board counts and the outcome.
11. `days[]` never crosses the team boundary in any payload.
12. A team may hold up to `MAX_ACTIVE_CHALLENGES` active challenges and at most one
    against any single opponent.
13. Push fires on accept and on close, to consenting players only, naming the opponent;
    running the close twice neither restates the result nor re-notifies.
14. Read cost per refresh is bounded as stated in §12, with no new aggregate table and no
    read path over `dailyScores`.
15. A challenge link cannot bypass `acceptsChallenges`, `MAX_ACTIVE_CHALLENGES` or the
    one-per-pair rule: each is re-checked at claim time, per §8.1.
16. A `void` result is shown as "no result" and counts as neither a win nor a loss in the
    head-to-head record.
17. Deleting a team closes its active challenges with the result its window held, and
    withdraws its pending ones, leaving the surviving team's record intact.
