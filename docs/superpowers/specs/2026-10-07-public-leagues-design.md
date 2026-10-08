# Public leagues — join a group, play for it

**Issue:** wordle-teams-zic8.3 (parent epic: wordle-teams-zic8)
**Date:** 2026-10-07
**Status:** approved design, awaiting implementation plan

---

## 1. What this is

A **league** is a curated, fixed set of **groups**. A player joins one group per league,
individually, with one tap and no invite, and every board they play counts towards their
group. Each calendar month the groups are ranked on **pooled average guesses**, and a
closed month is a frozen snapshot.

v1 ships exactly one league, **Starting Words**, with five groups named for popular
openers: **CRANE, SLATE, ADIEU, STARE, ORATE**. Leagues are data, so a second league is a
seed run rather than a build.

Strangers see **group totals only**. No names, no rosters, no chat, and no user-written
text anywhere on the surface.

## 2. Why this shape

**It is the one avenue that gives a stranger arriving alone something to do.** 87% of
signups never enter a board, and today a teamless player has nothing to compete in. A
league they can join in one tap, during onboarding, is this avenue's line to
wordle-teams-ay21.

**Curated and mark-free, because of the owner's three goals:** no licensing exposure, as
little maintenance as possible, and maximum engagement. The options were weighed in the
brainstorm (§3.1). User-created groups lose on maintenance (moderation, takedowns, dead
groups) and on Wall 2 (dozens of one-person groups at ~70 actives). Official sports
names carry real trademark exposure. A small fixed set built on an identity players
already have keeps the population concentrated and needs nothing from us after seeding.

**Starting words are built for Wordle.** Players already argue about which opener is best,
the scoreboard settles a debate they care about, the names belong to nobody, and it works
the same in every country.

**It reuses zic8.2's precedents wholesale.** The metric, rounding, failure-as-7 rule,
tiebreak, minimum-board voiding, snapshot-at-close and close-via-sweep rules all come from
`docs/superpowers/specs/2026-10-04-team-vs-team-challenge-design.md` and are not
re-argued here.

## 3. Decisions

Settled in the brainstorm of 2026-10-07 and not to be re-litigated during implementation.

| Question | Decision |
| --- | --- |
| Group naming / licensing | Curated, fixed, mark-free. v1 = starting words. No sports names in v1 |
| Structure | Leagues as data: `leagues` → `leagueGroups` → `leagueMemberships`. Not the `teams` entity |
| Groups in v1 | CRANE, SLATE, ADIEU, STARE, ORATE (no "other" group) |
| Visibility to strangers | Group totals only: average, boards, contributors, member count |
| Moderation | None needed. Nothing user-written is ever shown |
| Metric | Pooled: total attempts ÷ total boards, rounded 1dp before comparison; failure = 7 |
| Group-size fairness | Pooled average is size-independent; no top-N, no participation floor |
| Small samples | `MIN_LEAGUE_BOARDS = 10` per group per month, else "not yet ranked" |
| Ties | Broken on boards played |
| Season | Calendar month; snapshot at close; all-time months-won tally |
| Joining | Counts from the day after joining (non-retroactive) |
| Switching | Allowed; takes effect on the 1st of next month |
| Leaving | Effective today; boards already counted this month stay counted |
| Teams vs league | Independent. Every board counts for your teams AND your group |
| Free vs Pro | Joining, standings, winners and history free. Personal contribution view: Pro OR an active Insights trial (owner decision 2026-10-08 — the one Pro feature the trial unlocks; challenges and the month window stay Pro-only) |
| Entry points | `/leagues` index + `/leagues/$slug`, home card, onboarding step for teamless players, app menu |
| Many leagues later | Routes, home card, picker and onboarding are multi-league-ready in v1 (§8.5) |
| Notifications | None in v1 |
| Admin UI | None. Leagues are seeded by an internal mutation |
| Launch flag | `LEAGUES_ENABLED`, modelled on `CHALLENGES_ENABLED` |

### 3.1 Why not sports-fan groups, and how to add them later

The owner's original example was NFL-shaped (Vikings fans vs Packers fans). It is
**deferred, not rejected**. Recorded so the next brainstorm starts from here:

- "They are public names" does not help. Every trademark is public; the question is
  whether a use suggests affiliation or endorsement, especially inside a paid product.
- Nominative fair use permits naming a team to refer to it ("Vikings fans") when only
  plain words are used (no logos, colours or helmet emoji), no more of the mark than needed,
  and nothing implies sponsorship. Fan sites and fantasy apps rely on this routinely.
- The NFL enforces aggressively. The realistic worst case is a cease-and-desist letter
  and a forced rename, which is cheap **only because group names are data**.
- Commercial context raises exposure: fan groups must not be Pro-gated or used in
  marketing.
- 32 groups at ~70 actives is about two players per group, so it is also premature on
  Wall 2.
- A mark-free hedge exists: geographic groups ("Minnesota" vs "Wisconsin") sort the same
  fans with no marks at all.

**Prerequisites for a fan league:** a population that can fill it, and a short IP
attorney consult on the exact wording. Filed as its own issue.

### 3.2 Why group totals only

Every privacy assumption in the app today rests on "you were invited by someone". The
owner's earlier position, that an average guess count is a game score and not sensitive
data (zic8.2 §3.2), still holds. What a public space adds is **strangers seeing names**,
plus anything user-written, which brings moderation, reporting and blocking with it. The
app has none of that machinery. Showing group totals only means none of it is needed.

A residual inference exists and is accepted: in a group with two contributors, one of
them can derive the other's monthly average by subtraction. They cannot learn **who**
the other player is, because no identity crosses the boundary, so nothing about a
person is disclosed. The same holds for the live view: in a one-contributor group, each
change to the group's totals is that player's board arriving in real time, which is
finer-grained than a monthly average but still carries no identity. The
`globalThreshold.ts` minimum-cohort rule therefore has
nothing to protect here and is **not** imported.

## 4. Data model

Six new tables. No existing table changes.

```ts
leagues: defineTable({
  slug: v.string(),            // 'starting-words'; the route key
  name: v.string(),
  featured: v.boolean(),       // the league onboarding offers (§8.4)
  createdAt: v.number(),
}).index('by_slug', ['slug']),

leagueGroups: defineTable({
  leagueId: v.id('leagues'),
  slug: v.string(),            // 'crane'
  name: v.string(),            // 'CRANE'
  order: v.number(),           // display order in the picker
  memberCount: v.number(),     // maintained at join/switch/leave; never counted on read
}).index('by_league', ['leagueId']),

leagueMemberships: defineTable({
  playerId: v.id('players'),
  leagueId: v.id('leagues'),
  groupId: v.id('leagueGroups'),
  fromDay: v.string(),         // 'YYYY-MM-DD', inclusive
  toDay: v.optional(v.string()), // inclusive; ABSENT MEANS OPEN (started or pending)
}).index('by_player_and_league', ['playerId', 'leagueId']),

leagueMemberMonth: defineTable({
  playerId: v.id('players'),
  leagueId: v.id('leagues'),
  groupId: v.id('leagueGroups'),
  year: v.number(),
  month: v.number(),           // 1-12, matching teamMonthStats
  boards: v.number(),
  attempts: v.number(),
}).index('by_player_league_year_month', ['playerId', 'leagueId', 'year', 'month']),

leagueGroupMonth: defineTable({
  leagueId: v.id('leagues'),
  groupId: v.id('leagueGroups'),
  year: v.number(),
  month: v.number(),
  boards: v.number(),
  attempts: v.number(),
  contributors: v.number(),    // members with boards > 0 this month
})
  .index('by_league_year_month', ['leagueId', 'year', 'month'])
  .index('by_group_year_month', ['groupId', 'year', 'month']),

leagueMonthResults: defineTable({
  leagueId: v.id('leagues'),
  year: v.number(),
  month: v.number(),
  standings: v.array(v.object({
    groupId: v.id('leagueGroups'),
    boards: v.number(),
    attempts: v.number(),
    average: v.union(v.number(), v.null()),  // null below MIN_LEAGUE_BOARDS
    contributors: v.number(),
  })),
  winnerGroupId: v.union(v.id('leagueGroups'), v.null()), // null: no group qualified, or an exact tie
  closedAt: v.number(),
}).index('by_league_year_month', ['leagueId', 'year', 'month']),
```

### 4.1 Invariants

- **Membership is an interval.** A player has at most one **open** interval per league
  (`toDay` absent). Intervals for one player and league never overlap.
- **Switches happen only on a month boundary**, so a player belongs to **exactly one
  group per league per month**. That is what lets a member-month row carry a single
  `groupId` and never split. A join mid-month starts mid-month; a leave mid-month ends
  mid-month; neither changes the group within the month.
- **Membership liveness differs from board coverage, deliberately.** An interval with a
  `toDay` is a *live* membership only while a pending successor exists (a switch closed at
  month end). Without one it has been left, so leaving ends membership the same day and a
  same-day rejoin is allowed. Board coverage is unaffected: the left interval still
  covers today, so a board played before leaving counts.
- **A board counts for a group iff its `puzzleDay` lies inside one of the player's
  intervals for that group.** This one rule produces non-retroactive joining,
  next-month switching and history.
- **`leagueMonthResults` is authoritative for closed months.** Every closed-month read
  goes there and never to `leagueGroupMonth`. This is forced, not chosen, for zic8.2
  §6's reason: backfill is a free feature, so a re-derived closed month would silently
  restate "CRANE won September" whenever anyone edited an old board.
- **`average` is stored in the snapshot** even though it is derivable, because the
  rounding is display-coupled.

## 5. Rules live in `convex/lib/league.ts`, importing only browser-safe siblings

It imports only `./puzzleDay.ts` and `./teamStats.ts`, as `challenge.ts` does, and never
`../access.ts` or `../auth.ts`: the client needs these rules, and reaching them through `../access.ts` drags the
Better Auth server surface into the client chunk. And because wordle-teams-obw means no
test can drive an authed Convex wrapper, **a rule left inside a mutation is a rule no
test can execute.**

Pure functions:

- `joinFromDay(todayPuzzleDay)` → the day after.
- `switchDays(todayPuzzleDay)` → `{ closeOn: lastDayOfMonth, openOn: firstOfNextMonth }`.
- `intervalCovers(interval, puzzleDay)` → boolean.
- `memberTotalsFor(boards, intervals, month)` (a `'YYYY-MM'` month; callers convert to the stored numeric year/month) → `{ groupId, boards, attempts } | null`.
  Sums `attemptsFor` over boards in the month that fall inside an interval. Generic over
  the id types, using the `lib/teamStats.ts` idiom.
- `groupDelta(oldRow | null, newRow | null)` → `{ boards, attempts, contributors }`.
- `groupAverageOf({ boards, attempts })` → `number | null`, rounded to 1dp, null when
  `boards < MIN_LEAGUE_BOARDS`.
- `standingsOf(groupRows)` → ordered rows: ranked groups by average ascending, ties
  broken on boards played (more wins), then unranked groups by boards descending.
- `winnerOf(standings)` → `groupId | null`.
- `contributionOf(memberRow, groupRow)` → `{ mine, group, shift }`. `shift` is the
  group average with the member minus without them, rounded 1dp, null when either side
  is below the minimum.
- Constants: `MIN_LEAGUE_BOARDS = 10`, `PICKER_INLINE_MAX = 6`, `HOME_CARD_MAX_LEAGUES = 3`.

`attemptsFor` (`convex/lib/board.ts`) remains the single definition of a board's
attempts (failure = 7). `groupAverageOf` rounds **before** comparison, for
`meanAttemptsOf`'s reason (wordle-teams-iht.3.3).

## 6. Server surface — `convex/leagues.ts`

Each public function is a thin wrapper over an exported `…For(ctx, playerId, args)`
handler, following the `challenges.ts` pattern, so the handler is what tests drive. All
refusals go through `accessError`. Plain `Error` messages are redacted in production
and `convex-test` never redacts. Every public function first checks
`leaguesEnabled(process.env.LEAGUES_ENABLED)` and refuses with `LEAGUES_DISABLED`.

| Function | Kind | Auth | Does |
| --- | --- | --- | --- |
| `joinGroup` | mutation | any player | Opens an interval from `joinFromDay(today)`. Refused `ALREADY_IN_LEAGUE` if an open interval exists. `memberCount += 1` |
| `switchGroup` | mutation | member | Sets the open interval's `toDay` to month end, inserts a new interval from the 1st. Calling again before the 1st **replaces** the pending interval; switching back to the current group **deletes** it and clears `toDay`. `memberCount` moves at call time (a pending switcher counts for their new group) |
| `leaveLeague` | mutation | member | Sets `toDay` to today and deletes any pending future interval. `memberCount -= 1`. Recomputes the member's month (§7) |
| `leagues` | query | any player | All leagues with their groups, for the index page |
| `standings` | query | any player | By slug: current month's group rows via `standingsOf`, last month's snapshot, and the all-time months-won tally. Signed-in only |
| `myLeagues` | query | player | Per joined league: group, current rank and average, any pending switch, interval start |
| `myContribution` | query | **Pro** | By slug: `contributionOf(memberRow, groupRow)` for the current month |
| `seedLeague` | internalMutation | — | Idempotent by slug: creates or updates a league and its groups. Run once per deployment for Starting Words (`featured: true`) |

"Today" follows the same puzzle-day convention as `acceptChallenge`'s `startDay`,
validated two ways, deliberately. **Mutations** use `requirePlausibleToday` and refuse an
implausible day (`INVALID_DATE`). **Queries** (`standings`, `myLeagues`, `myContribution`) never
refuse: they fall back to the server's day when the client's is implausible
(`readToday`, the `insights.ts` `teamMonth` precedent). A reactive query re-runs on every
board write by any league member, not when the clock moves, so a refusing query would throw
on a tab left open past midnight while the user did nothing. `today` only chooses which
month is current, and those totals are public, so nothing is lost by the fallback.

`standings` returns last month as `{ month, winnerGroupId }` only, which is all §8.2 renders,
not the full snapshot.

**The months-won tally** reads `leagueMonthResults` `by_league_year_month` for the
league. At one row per month that is about 12 rows a year; when it outgrows that, a
running tally on `leagues` is the fix, filed rather than built.

## 7. Write path — incremental, on board write

`scores.ts`'s board-write path already calls `winners.ts`'s `recomputePlayerMonth`. A new
`recomputeLeagueMonth(ctx, playerId, year, month)` runs beside it, covering inserts,
edits, deletes and backfill into any month:

1. Read the player's memberships (`by_player_and_league`, ranged by player). **Zero rows
   for most players, so the common case costs one index read.**
2. For each league with an interval touching the month: read the player's boards for the
   month (the existing `by_player_and_puzzleDay` range), compute `memberTotalsFor`, and
   upsert `leagueMemberMonth`. Delete the row if the result is null.
3. Apply `groupDelta(old, new)` to that group's `leagueGroupMonth`, creating it if absent.

**Delta, not re-sum.** Re-summing every member row on each write is O(group size) and
would not survive a popular group. The delta is O(1) and stays exact because it comes
from a **full recompute of one member** rather than from a running counter, and Convex's
serializable transactions make concurrent deltas correct. At high write rates one hot
group row becomes an OCC contention point. That is a scale problem, filed rather than
solved in v1.

`joinGroup` needs no recompute because its interval starts tomorrow. `leaveLeague` does
(step 2 with the shortened interval).

**Player deletion.** The app has no account-deletion path today. The only place a
player row is deleted is `e2ePrune.ts`, which must therefore also delete that player's
intervals and member rows and apply the negative delta to each affected group row.
Otherwise pruned e2e players leave phantom boards in beta standings. Whoever later
builds account deletion inherits the same obligation.

A backfill into a **closed** month updates the live rows and **never** the snapshot.

## 8. UI

### 8.1 `/leagues` — index

Lists every league as a card: name, your group and rank if joined, otherwise a "Join"
call to action. **With one league it redirects to `/leagues/$slug`**, so v1 never shows
an index of one.

### 8.2 `/leagues/$slug` — standings

```
 Starting Words · October               ← your group pill: SLATE
 ┌───────────────────────────────────────┐
 │ 1  CRANE   3.8   142 boards · 9 played│
 │ 2  SLATE   3.9    96 boards · 6 played│  ← you
 │ 3  STARE   4.1    31 boards · 3 played│
 │ –  ADIEU   not yet ranked  (6/10)     │
 │ –  ORATE   not yet ranked  (0/10)     │
 └───────────────────────────────────────┘
 September winner: CRANE 🏆   All-time: CRANE 3 · SLATE 2 · …
 [Pro] Your 3.6 vs SLATE's 3.9 — you pull SLATE down by 0.1 guesses
 Switch group ▾ (takes effect Nov 1)      Leave league
```

- "played" is `contributors`. A member count is shown on the group in the picker.
- Below `MIN_LEAGUE_BOARDS`, a group shows a progress count (`6/10`) instead of an
  average, so a thin month still has a target.
- Not a member: the same standings, with the group picker above them.
- Free members see the Pro row as a locked teaser, reusing the existing locked-teaser
  pattern.
- A month with no snapshot winner reads "No winner in September".

### 8.3 Group picker (shared component)

Renders inline buttons when a league has `≤ PICKER_INLINE_MAX` groups, and a searchable
sheet above that. Used by the standings page, the home card and onboarding.

### 8.4 Home card and onboarding

- **Home card** (`app.tsx`): one row per joined league (group, rank, average), capped at
  `HOME_CARD_MAX_LEAGUES` with "See all". **The picker is offered only to a player who
  has NEVER joined a league, and only on a team player's dashboard** (owner decision
  2026-10-08): a teamless never-joined player gets the offer once, as the onboarding step
  below, so the card hides its picker there; anyone who has ever joined, leavers included,
  sees only their current league rows or no card. "Ever joined" is `getStatus.inLeague`.
  Built on `myLeagues` (+ `leagues`, read only while a picker could show), both keyed so
  that team changes do not invalidate them. This respects `onboarding.ts`'s rule against
  adding a second full-team-scan subscription.
- **Onboarding** (`next-step-card`): a new step for a **teamless** player who has never joined a league (a player who left is not re-offered it: they chose to leave), "No team yet?
  Pick your opener and play for a group today", offering the featured league. Joining
  completes the step. Players with a team keep their current flow.
- **App menu**: a "Leagues" entry linking to `/leagues`.

### 8.5 Built for many leagues, shipped with one

The four places that would otherwise assume a single league are generalised in v1 at
near-zero cost: routes (`/leagues` + `/leagues/$slug`), `myLeagues` (plural), the
picker (inline or sheet), and onboarding (`featured`). Standings are already one range
read per league, snapshots and closes are per league, and membership is per league. A
league **directory with search** is not built: at a handful of leagues the index page is
the directory.

### 8.6 Copy

Nothing implies affiliation with anyone. Group names are plain words.

## 9. Close rides the existing daily sweep

`teamStats.sweep` (00:45 UTC) gains one step: for each league with no
`leagueMonthResults` row for last month, **from day 2 of the new month**, schedule one
`internal.leagues.closeLeagueMonth({ leagueId, year, month })` job. That is the D5 idiom:
the sweep schedules closes and never performs them inline.

- **Day 2, not day 1**, for zic8.2 §9's reason. At 00:45 UTC on the 1st, players at
  UTC-12 still have about eleven hours to play the last day, and closing then would
  permanently freeze the result without their boards.
- **Idempotent:** the job re-reads `by_league_year_month` and does nothing if a result
  row exists. A duplicated or retried job cannot restate the snapshot.
- The job reads the league's `leagueGroupMonth` rows, includes zero-rows for groups with
  none, applies `standingsOf` and `winnerOf`, and inserts the snapshot.
- Gated by `SWEEPS_ENABLED` as the sweep's **first statement** (the `lib/sweeps.ts`
  rule), and **not** by `LEAGUES_ENABLED`: switching the feature off must not leave a
  played month unclosed. The scheduled job is gated on neither.
- No new cron lane, per `crons.ts`.

## 10. Errors and edge cases

| Case | Behaviour |
| --- | --- |
| Join while already in the league | `ALREADY_IN_LEAGUE` |
| Switch or leave while not a member | `NOT_IN_LEAGUE` |
| Join or switch to a group id that does not exist | `UNKNOWN_GROUP` |
| Switch to a group in a league you are not in | `NOT_IN_LEAGUE` (the group's league is where the switch is attempted) |
| Unknown league slug | `UNKNOWN_LEAGUE` (query returns null for the page's 404) |
| Feature flag off | `LEAGUES_DISABLED` from every public function |
| Join, leave, rejoin in one month | Two intervals in the same group; both count; one member row |
| Leave, then join a **different** group in the same month | Allowed, but the new interval opens on the **1st of next month**, not tomorrow. This preserves one-group-per-month (§4.1) |
| No group reaches 10 boards | Snapshot with `winnerGroupId: null` |
| Top two groups tie on BOTH the 1dp average and boards | No single winner: `winnerGroupId: null` |
| Board edited in a closed month | Live rows update; snapshot never does |
| Board for the month's last day entered after the day-2 close | Counts for the player's teams; not for that month's league result (the snapshot is final) |
| Player pruned by `e2ePrune` | Intervals and member rows deleted; group rows get the negative delta (§7) |

## 11. Testing

- **`lib/league.ts`**: unit tests for every function in §5, including interval
  boundaries (fromDay/toDay inclusive), the month-end switch, the 1dp rounding tie case,
  the minimum-board cutoff at 9/10, the tiebreak, and a delta from null to row, row to
  row and row to null.
- **`convex/leagues.test.ts`** (convex-test, driving the `…For` handlers): join counts
  from tomorrow; switch takes effect on the 1st and replace/cancel semantics; leave keeps
  earlier boards; the §10 refusals; `memberCount` across join/switch/leave; the write path
  keeps `leagueGroupMonth` equal to the sum of member rows across insert, edit, delete
  and backfill (an invariant test); and `e2ePrune` leaving no league rows behind.
- **Close**: the sweep schedules on day 2 and not day 1; close is idempotent; a backfill
  after close leaves the snapshot unchanged; `SWEEPS_ENABLED` gating.
- **Components** (jsdom `*.hook.test.ts`): picker switches inline↔sheet at
  `PICKER_INLINE_MAX`; standings render unranked progress; the Pro teaser locks for free
  users; the onboarding step shows only for a teamless player; `/leagues` redirects with
  one league.
- **e2e**: one spec, a teamless player picks an opener from onboarding and sees their
  group on standings. Needs `LEAGUES_ENABLED` on the e2e deployment. Run in the
  background (it is not one of the gates).
- **Mutation-check** the write-path delta and the close idempotency guard. Those are the
  two places where a deleted line leaves a suite green.
- All four gates run separately: `TZ=UTC pnpm test:once`, `pnpm typecheck`, `pnpm lint`,
  `pnpm build`.

## 12. Rollout

1. Ship behind `LEAGUES_ENABLED` unset.
2. Run `seedLeague` for Starting Words on beta; set the flag on beta; verify.
3. PR dev → main; deploy; run `seedLeague` on prod; set the flag on prod.
4. The first close happens on the 2nd of the month after launch.

## 13. Out of scope — filed as follow-ups

- Sports-fan or geography leagues (gated on population plus an IP consult; §3.1)
- User-created groups (needs moderation, naming policy and takedown)
- League chat, member rosters, public handles, reporting and blocking
- Push notifications for league results
- An admin UI for leagues
- A league directory with search
- A running months-won tally on `leagues` (when history outgrows a range read)
- Hot-group OCC contention on `leagueGroupMonth` at scale
