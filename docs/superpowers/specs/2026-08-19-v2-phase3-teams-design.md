# v2 Phase 3 — Teams: Design

**Date:** 2026-08-19
**Status:** Approved design, not yet built
**Tracks:** `wt-ksh.4` (Phase 3 of epic `wt-ksh`)
**Governed by:** `2026-07-16-replatform-v2-design.md` and its amendments, especially
**A3** (parity target is `dev` as of 2026-08-03, not the 2026-07-16 snapshot) and
**A7** (login/onboarding is a sanctioned exception to strict parity).
**Builds on:** `2026-08-18-v2-phase2-core-loop-design.md`.
**Read before touching UI:** `docs/design-system/V2-ADDENDUM.md` — §6 for the shadcn
`Table` traps, §7a for the divergence list this phase extends.

## Summary

Everything a team is, other than getting people into one: create it, switch to it, name
it, set how it scores, see who is on it, take someone off it, delete it. Plus the two
things the phase makes reachable for the first time and therefore has to settle —
**scoring-system versioning**, so the editor cannot rewrite history, and a **creator-only
permission rule** that is real rather than cosmetic.

Phase 3 is also the first phase with a second signed-in player available, so it closes
the one Phase 2 acceptance criterion that was deferred rather than met (`wt-ksh.4.1`).

## Context

Two findings shaped the scope before any decision was made.

**v1 gates two of this phase's surfaces behind pro.** The scoring-system editor
(`CustomizeButton`) renders only when `memberStatus === 'pro'`, and the "New Team" item in
the teams dropdown flips to "Upgrade for more" once a free account has two teams. v2 copies
`playerMembership` into Convex but **reads it from nowhere** — the pro gate does not exist
in v2 at all, and Phase 2 deliberately left it out (the month picker already shows everyone
the free three-month window).

**v1's RLS is looser than v1's UI.** On `public.teams`: `DELETE` is creator-only, `UPDATE`
is permitted to the creator *or any member* — including writes to `player_ids`, i.e.
removing people — and `SELECT` is `USING (true)`, so any authenticated user can read any
team row. The UI offers Settings, Invite and Delete only to the creator. Phase 2 already
closed the read hole with `requireTeamMemberFor`; this phase decides what to do about the
write hole.

A third finding is scope rather than design: three prod surfaces have **no owning phase**.
The TeamBoards carousel and the monthly-winner celebration dialog were deferred by Phase 2;
`CheckoutReturn` belongs with payments. Phase 3's scope does not reach any of them and
Phase 7 is an audit, not a build. They are filed separately so the audit does not discover
them.

## Decisions Made (and alternatives ruled out)

| Decision | Chosen | Ruled out / why |
|---|---|---|
| Pro gate | **Read it, gate the UI, enforce nothing** — Phase 3 reads `playerMembership` to hide the editor button and swap "New Team" for "Upgrade for more"; no mutation checks it | Enforcing server-side — v1's own gates are UI-only (`save` does not check pro, nothing stops a free account creating five teams through the API), so enforcing would be a behaviour change, not a port. Building both surfaces ungated — leaves two more retrofits for Phase 5 and lets beta accounts create state a free account could not. Deferring the editor to Phase 5 — leaves versioning designed but unproven |
| Scoring versioning | **Versions table keyed on an effective-from month**, resolved as "the greatest `effectiveFrom <= month`, else the team doc's own fields" | Snapshotting the system onto `monthlyWinners` — those rows exist only for months that *have* a winner and are deleted when nobody does, so a past month's scoreboard still has nothing to resolve against. Both — duplicates what the versions table already answers, at one wider write per team per board submission. Freezing months at close — adds a scheduled job and a correctness cliff if it ever fails to run |
| Baseline for existing teams | **The `teams` doc's own eight fields are the fallback**, used when no version row precedes the month | Backfilling a baseline row per team — needs a migration, and the copy script would have to write one too. The fallback is free and states something already true: "no versions yet" means "it has always been this" |
| Mid-month edit | **`effectiveFrom` = the current month.** Days already played this month recompute; the running month's winner can flip immediately | Applying from next month — the editor's effect is invisible for up to 31 days, which reads as a bug. Letting the user choose — a decision on every nudge of a number, and a second path through the mutation and its tests |
| Surfacing the version | **The Scoring System card is month-scoped** — it shows the system that governed the month in the URL, badges it when historical, and hides Customize on a past month | A separate version-history view — an extra dialog and a query that sits empty for every team that has never edited. A note on the scores table instead — leaves the card actively lying about the month on screen, which is the confusion the feature exists to remove |
| Permissions | **Creator-only for every team mutation, enforced server-side** via `requireTeamCreator` | Matching v1's RLS exactly — ships a rule v2's own UI contradicts, and "any member can remove any other member" is a live hazard once Phase 4 adds invites. Adding a self-removal path — genuinely useful, but v1 has no such affordance, so it is a new feature the parity rule does not sanction |
| Recompute blast radius | **Every affected month.** Member removal recomputes every month the team has a winner row for; a scoring edit recomputes the edited month and every later one | Current month only — parity with prod, but parity with a known-wrong result the editor makes far easier to hit. Recomputing nothing — the card and the scoreboard would disagree with each other on the same screen after an edit |
| Team-management query shape | **One widened `getMyTeams`**, returning id, name, creator, settings and members | A thin picker query plus a scoped `getTeamDetail` — the read set is the whole `teams` table either way (Convex cannot index array membership), so the split doubles subscriptions without shrinking the read set |
| Team picker | **Rewritten from `Select` to v1's `DropdownMenu` radio group** | Keeping the `Select` and adding a separate button — "New Team" and "Upgrade for more" live *inside* the dropdown in prod, so a `Select` needs a shape prod does not have |
| Zero-teams state | **A focused create-team card** | Porting v1's `Intro` (the marketing `About` component with an animated gradient wordmark) — a marketing surface to build in a phase about team management, reproducing the funnel step `wordle-teams-456` already indicts. v2 already carries the marketing copy at `/about`, and A7 makes onboarding a sanctioned exception |

## Prerequisite: `teams.legacyId` must become optional

Phase 2 hit this with `dailyScores` and `monthlyWinners`. `teams.legacyId` is still a
required `v.number()`, and a natively created team has no Supabase primary key to carry, so
**`createTeam` cannot insert as the schema stands.**

Make it optional, for the reasons Phase 2 recorded: it is the honest model, the copy is
unaffected because idempotency runs through `by_legacyId` and native rows correctly never
match, and `legacyId === undefined` is the marker Phase 7's row-count reconciliation against
Supabase needs. `playerMembership` and `webhookEvents` keep theirs required; nothing in this
phase creates rows in them.

This is task 0 and it blocks every creation task.

## Architecture

### Layer 1 — pure logic, `convex/lib/scoringSystem.ts`

Dependency-free, no Convex, React or DOM imports — the same rule as the rest of
`convex/lib/`.

| Export | Behaviour |
|---|---|
| `systemFor(base, versions, month)` | The version with the greatest `effectiveFrom <= month`; `base` when none precedes it. `'YYYY-MM'` sorts lexicographically, so this is a string comparison |
| `effectiveFromOf(versions, month)` | The resolved version's `effectiveFrom`, or `null` when it fell back to `base` — this is what the badge renders |
| `DEFAULT_SYSTEM` | v1's `defaultSystem`: 1→5, 2→3, 3→2, 4→1, 5→0, 6→−1, failed→−3, missed day→0. What `createTeam` writes |

`ScoringSystem` already exists in `convex/lib/scoring.ts` and is imported, not redeclared.
**`pointsFor`, `monthTotal` and `winnerOf` do not change.** They already take the system as
a parameter, so versioning only changes what is passed in — which is precisely what
`wordle-teams-1j3` predicted when it called the architecture "already well positioned".

### Layer 2 — Convex functions

#### `convex/winners.ts` — the `wordle-teams-4gj` extraction

`recomputeWinners` today is an unexported function inside `scores.ts`, reachable only by
constructing a valid board submission and passing it through the whole validity and upsert
machinery. Phase 3 needs it from three different mutations, so it moves out **first**, before
anything else in this phase is written. Typed against the same narrow `WriterCtx` `scores.ts`
already uses.

| Entry point | Called by |
|---|---|
| `recomputeTeamMonth(ctx, team, month, today)` | The other two; the unit of work |
| `recomputePlayerMonth(ctx, playerId, month, today)` | `upsertBoard` — today's behaviour, unchanged |
| `recomputeTeamMonths(ctx, team, months, today)` | `removeMember`, `updateTeam` when `playWeekends` flips, `setScoringSystem` |

Each resolves the scoring version for the month it is recomputing, via `systemFor`. The five
behaviours the extraction exists to make testable — a row per team, tie-break by team order,
no-winner deletes the row, `hasSeenCelebration` preserved on an unchanged winner and reset on
a changed one — are unchanged, and become directly unit-testable, which is `4gj`'s acceptance
criterion.

**Which months.** "Every affected month" means every month the team has a `monthlyWinners`
row for, plus the month being edited. A team accumulates at most one row per month, so the
work is bounded at (months with a row) × (members) × (days in month) — roughly thirty rows
for the oldest team in production.

#### `convex/access.ts`

- `requireTeamCreatorFor(ctx, playerId, teamId)` → the team. Throws `NOT_A_MEMBER` for a
  non-member, so a probe still cannot distinguish "no such team" from "not yours"; throws
  `NOT_TEAM_CREATOR` for a member who is not the creator.
- `isPro(ctx, playerId)` → reads `playerMembership` `by_player`; true when
  `membershipStatus === 'pro'`.

`AccessCode` gains `NOT_TEAM_CREATOR`, `INVALID_TEAM`, `INVALID_DATE`, `CREATOR_NOT_REMOVABLE` and `INVALID_SYSTEM`. The exhaustive
switch in `src/lib/convex-error.ts` stops compiling until each has copy — that check is
deliberate and is doing its job.

**`teams.creator` is optional**, because a scoped copy may not include the creator (schema
comment, Phase 1). Consequence to accept: a team whose creator was not copied has **nobody
who can edit it**. That is honest — you are not the creator — but it will look like a bug on
beta, so it gets a schema comment and an explicit test rather than being discovered.

#### `convex/teams.ts`

`getMyTeams` is **widened** and replaces the Phase 2 version: id, name, creator, settings,
and members (`id`, `firstName`, `lastName`), for the teams the caller belongs to, ordered by
`createdAt`. It drives the picker, the CurrentTeam card and the MyTeams card from **one
subscription**. Members exclude profile-incomplete players, matching `getTeamMonthFor` and
v1's `getTeams`.

The read set is still the whole `teams` table, as Phase 2 documented — Convex cannot index
array membership, and the schema's own comment defers a join table until team count changes
by an order of magnitude. Phase 3 does not change team count, but it does raise team-write
frequency, which is the *other* axis `scores.ts` flagged. Recorded, not acted on: at 171
teams and ~40 DAU the re-push is small. Revisit if either number moves.

`amIPro` returns a boolean for the two UI gates. A boolean rather than the raw
`membershipStatus`: every gate in v1 is "are they pro", and nothing has ever branched on
which non-pro status someone holds.

Mutations — all `requireTeamCreator` except `createTeam`, which is `requirePlayer`:

| Mutation | Notes |
|---|---|
| `createTeam({name, playWeekends, showLetters})` | Inserts with `creator` and `playerIds: [caller]`, `invited: []`, `createdAt: Date.now()` and `DEFAULT_SYSTEM`'s eight values. No `legacyId`. **No server-side team cap** — v1's is UI-only |
| `updateTeam({teamId, name, playWeekends, showLetters})` | Recomputes every affected month **when `playWeekends` changes** — it is an input to `monthTotal`, so flipping it re-scores every month. A name-only edit recomputes nothing |
| `deleteTeam({teamId})` | **Cascades by hand.** Postgres has `ON DELETE CASCADE` on `monthly_winners.team_id`; Convex has nothing. Deletes the team's `monthlyWinners` and `scoringSystems` rows explicitly. `dailyScores` belong to players and survive, as in Postgres |
| `removeMember({teamId, playerId})` | **Refuses to remove the creator**, matching v1's UI, which hides the button on your own row. Patches `playerIds`, then recomputes every affected month |
| `setScoringSystem({teamId, values, today})` | Upserts the `scoringSystems` row for `monthOf(today)`, then recomputes that month and every later month with a winner row. Does **not** check pro — see the gate decision |

`today` is client-supplied and bounded to ±1 day of the server's date, reusing the guard
`upsertBoard` already carries and for the same reason: it is not confined to the caller, it
decides which month a version governs for the whole team.

#### `getTeamMonth` resolves the version for the month being viewed

This is the load-bearing change. `getTeamMonth` currently returns the team's live eight
fields as `system`; it must instead return `systemFor(team, versions, month)`. Without it the
scores table computes a past month's totals under today's rules, which is exactly the bug the
feature exists to remove. It also returns `effectiveFrom` for the card's badge.

### Layer 3 — UI

| Component | Notes |
|---|---|
| `lib/use-dashboard-search-sync.ts` | The `wordle-teams-lb9` extraction. Done **before** any card is added to `index.tsx` — it is the highest-risk code in the Phase 2 UI (an effect that navigates to fill in URL state while racing hydration) and this phase adds weight to the same file |
| `components/team-picker.tsx` | Rewritten from `Select` to `DropdownMenu` + radio group, with a separator and either "New Team" or "Upgrade for more" beneath, per v1 |
| `components/teams/create-team-dialog.tsx` | Name, Play Weekends, Show Letters. Both switches default on, as v1 |
| `components/teams/update-team-dialog.tsx` | The same three fields, populated |
| `components/teams/current-team-card.tsx` | The selected team's members; Settings button and a per-member remove popover, both creator-only |
| `components/teams/my-teams-card.tsx` | Every team with its members; delete popover, creator-only |
| `components/scoring-system-card.tsx` | Month-scoped. Badge — "In effect from Jun 2026" — only when the resolved version is not the current one. Customize button hidden on a past month, and hidden entirely for non-pro or non-creator |
| `components/scoring-system-editor.tsx` | Dialog on desktop, Sheet on mobile via `use-media-query`, as v1's `CustomizeButton` |
| `components/teams/empty-state.tsx` | Replaces the Phase 2 placeholder text. One card, one Create Team button, opening the same dialog as the picker |

**Grid.** Without TeamBoards: pickers row, scores table full width, then CurrentTeam,
ScoringSystem and MyTeams as three columns from `md`.

**One label change.** The missed-day value renders as **"Missed day"**, not v1's `0`. `n_a`
is a misnomer — v1's own card files it under "0 attempts", and it has nothing to do with the
`N/A` shown for weekends. The schema field name stays `nA`; it is the copy contract.

## Error handling

| Code | Meaning | UI |
|---|---|---|
| `NOT_TEAM_CREATOR` | A member tried to edit, remove or delete | Error toast; the dialog stays open |
| `INVALID_TEAM` | Empty or whitespace-only team name | Error toast; the dialog stays open |
| `INVALID_DATE` | The client's `today` is more than a day off the server clock | Error toast; the dialog stays open |
| `CREATOR_NOT_REMOVABLE` | Refusing to remove a team's creator | Error toast; the popover stays open |
| `INVALID_SYSTEM` | A point value that is not an integer in −100…100 | Error toast; the editor stays open with the typed values |

`NOT_A_MEMBER` keeps its Phase 2 treatment: on the read path it is the route error boundary,
not a toast (see the Phase 2 design's amendment). The three new codes are all **mutation**
failures, so a toast is the right surface for each — there is a rendered page underneath to
float it over, which is the distinction that amendment turned on.

Mutation forms follow the `a335ae8` shape Phase 2 ported: `try`/`catch`, `setSubmitting(false)`
in `finally`, and the dialog closes **only on success**.

## Divergences from v1 — the list goes from three to five

`V2-ADDENDUM.md` §7a records three. Phase 3 adds two, both deliberate, and both must be
added to that table so Phase 7's audit does not treat them as bugs.

| # | Divergence | Why |
|---|---|---|
| 4 | **Team mutations are creator-only, enforced server-side** | Prod's RLS permits any member to UPDATE the team row, including `player_ids` — so any member can remove any other member through the API, while the UI offers it only to the creator. v2 makes the UI's rule the real one. No user sees a behaviour change; the rule stops being cosmetic |
| 5 | **Membership and scoring changes recompute past winner rows** | Prod's `update_monthly_winners` is a trigger on `daily_scores`, so removing a player never fires it and they stay named as the winner of months they are no longer in. **Prod is carrying stale rows today.** v2 recomputes every affected month |

Both are on the **write** path and invisible in a static route-by-route comparison, like the
two Phase 2 added. Exercising them takes a member removal and a scoring edit.

**Scoring-system versioning is not a divergence.** v2 has no reachable editor before this
phase, so no v2 user has ever had a system rewritten in place; there is no prod behaviour it
departs from that any v2 user has experienced. It is recorded here as a design decision, not
in the parity table.

Not divergences, but recorded because they look like ones:

- **A team whose creator was not copied cannot be edited by anyone.** A property of the
  scoped copy, not of the permission rule.
- **The 2-team cap and the pro-only editor are UI-only**, exactly as in prod. Not an
  oversight, and not something Phase 5 needs to "fix" unless it decides to.

## Testing

- **`convex/lib/scoringSystem.test.ts`** (vitest, pure) — resolution picks the greatest
  `effectiveFrom <= month`; falls back to the base when none precedes; month-boundary cases
  (a version effective in the month being viewed applies to it); lexicographic ordering across
  a year boundary.
- **`convex/winners.test.ts`** (`convex-test`) — the five behaviours, driven directly rather
  than through a board submission: a row per team, tie-break by team order, no-winner deletes,
  `hasSeenCelebration` preserved on an unchanged winner and reset on a changed one. This is
  `wordle-teams-4gj`'s acceptance criterion.
- **`convex/teams.test.ts`** (`convex-test`) — create, update, delete, remove member; the
  negative cases: a non-member is refused, a member who is not the creator is refused, the
  creator cannot be removed, and a team with no copied creator is refused to everyone. Delete
  proven by asserting the `monthlyWinners` and `scoringSystems` rows are gone and the
  `dailyScores` are not.
- **Versioning end-to-end** (`convex-test`) — a team with scores in July and August; edit the
  system in August; assert July's month totals **and** July's `monthlyWinners` row are
  byte-identical, and August's are recomputed.
- **`use-dashboard-search-sync`** tested standalone — the thing the extraction buys, and what
  `wordle-teams-pow` wants.
- **Playwright** gains a team-creation spec. `pnpm e2e` is **not** part of `test`/`tsc`/`build`
  and runs after every task that touches routes or rendered UI — in Phase 2 a spec stayed
  silently red for three tasks because nothing ran it.
- **Screenshots in light and dark, on a touch-emulating viewport, before any UI task is
  called done.** V2-ADDENDUM §5 and §6: five rendering bugs have passed every automated check
  in this project, and the owner found seven more on a real phone after Phase 2's first
  deploy. A narrow desktop window is not a substitute — the §6 scroll and sticky-column bugs
  were only reproducible under real touch input.

## Out of Scope

- **Invites** — the `InvitePlayer` dialog and everything behind it. Phase 4.
- **Polar, and enforcement of either gate.** Phase 5.
- **TeamBoards carousel**, **monthly-winner celebration dialog**, **`CheckoutReturn` card** —
  no phase owns these today. Filed separately; Phase 3 does not absorb them.
- **v1's `Intro` marketing card** — superseded by the focused empty state.
- **A `teamMembers` join table.** The schema defers it until team count changes by an order
  of magnitude; Phase 3 does not change team count.
- **Self-removal ("leave team")** — v1 has no such affordance.
- **The pro month-history window.** Phase 2 deferred the pro gate on month navigation and
  this phase does not revisit it.

## Acceptance Criteria

1. A multi-team account behaves identically to prod side-by-side. *(Phase done-when,
   inherited from the parent design.)*
2. A player can create a team, switch to it, rename it, change its settings and delete it;
   can see its members; and can remove one.
3. A member who is not the creator is refused by the **mutation**, not merely by a hidden
   button — proven by test.
4. Editing a team's scoring system in August leaves July's month totals and July's winner
   unchanged, and July's Scoring System card shows which version applied.
5. Removing a member recomputes every month that team has a winner row for.
6. `wt-ksh.4.1` — two browsers, two different signed-in players on one team: a board entered
   by one appears in the other's table with no refresh and no interaction.

## Task Breakdown

Fifteen issues under `wt-ksh.4`, in dependency order.

| # | Task | Done when |
|---|---|---|
| 0 | `teams.legacyId` optional | `convex deploy` accepts the schema and an insert without `legacyId` succeeds. **Blocks 6** |
| 1 | Extract `recomputeWinners` → `convex/winners.ts` (`wordle-teams-4gj`) | The five winner behaviours are proven by tests that never construct a board submission; `upsertBoard` is unchanged in behaviour. **Blocks 7, 8** |
| 2 | Extract `use-dashboard-search-sync` (`wordle-teams-lb9`) | `index.tsx` holds the route and layout; the sync lives in its own tested hook. **Blocks 9–13** |
| 3 | `scoringSystems` table + `convex/lib/scoringSystem.ts` | Resolution, fallback and boundary cases green; the table deploys. **Blocks 6** (which writes `DEFAULT_SYSTEM`) **and 8** |
| 4 | `requireTeamCreator`, `isPro`, the three new error codes | A non-creator member is refused and an uncopied-creator team is refused to everyone, both by test; `convex-error.ts` compiles again. **Blocks 6, 7, 8** |
| 5 | Widened `getMyTeams` + `amIPro` | One query returns members, creator and settings for the caller's teams only; a non-member's team is absent |
| 6 | `createTeam` / `updateTeam` / `deleteTeam` + manual cascade | Create/update/delete proven; delete removes `monthlyWinners` and `scoringSystems` and leaves `dailyScores`; `playWeekends` flip recomputes |
| 7 | `removeMember` + recompute | The member is gone, the creator cannot be removed, and every affected month's winner row is recomputed |
| 8 | `getTeamMonth` version resolution + `setScoringSystem` + forward recompute | Edit in August; July's totals and winner byte-identical, August recomputed |
| 9 | Team picker dropdown + create-team dialog | The dropdown switches teams and creates one; the free 2-team cap swaps in "Upgrade for more"; screenshotted light and dark |
| 10 | CurrentTeam card + remove-member UI | Members render; Settings and remove appear only for the creator; a failed remove leaves the popover open |
| 11 | MyTeams card + delete + update-team dialog | Every team with its members; delete confirms and works; settings round-trip |
| 12 | Scoring system card + editor | The card is month-scoped and badges a historical version; Customize is hidden on a past month, for non-pro and for non-creators; the editor round-trips and does not rewrite July |
| 13 | Empty-state CTA | A player with no teams sees one card and one working Create Team button |
| 14 | e2e, screenshots, beta deploy, `wt-ksh.4.1`, phase close | A multi-team account matches prod side-by-side, and two browsers show a live cross-player update |

## Gotchas Carried Into This Phase

- Run everything from **inside `v2/`**. A build from the repo root builds v1 and dirties the
  tracked `public/sw.js` (`wordle-teams-d9g`). The shadcn CLI misdetects the project from the
  root.
- v2's import alias is `#/`, not `@/`.
- `pnpm e2e` is not part of `test`/`tsc`/`build`. Run it after any task touching routes or
  rendered UI.
- Screenshots on a **touch-emulating** viewport, not a narrow desktop window.
- Do not commit to the branch while a subagent is running — its `--amend` swallows the commit.
  Controller-side commits happen in the same step that closes one task and claims the next.
- Kill stray dev servers by port (`lsof -ti :3000`); a second `pnpm dev` silently binds 3001
  and you end up testing a stale server.
- Do not switch shadcn off `style: "default"` to a `radix-*` preset (V2-ADDENDUM §5).
- `bd create --description` mangles backticks through shell command substitution; use
  `--body-file`.

## Deferred Past This Phase, Do Not Lose

- **`wordle-teams-7az`** (P1) — `E2E_TEST_MODE` must not survive onto the deployment that
  becomes production. Beta *becomes* prod carrying its environment.
- **`wordle-teams-04r`** (P2) — confirm Convex's backend clock is UTC. The `today`
  anti-spoofing bound in `upsertBoard`, which `setScoringSystem` now reuses, depends on it,
  and it is currently an inference rather than an observation.
