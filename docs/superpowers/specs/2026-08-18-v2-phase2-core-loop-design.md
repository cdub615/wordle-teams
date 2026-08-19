# v2 Phase 2 — Core Loop: Design

**Date:** 2026-08-18
**Status:** Approved design, not yet built
**Tracks:** `wt-ksh.3` (Phase 2 of epic `wt-ksh`)
**Governed by:** `2026-07-16-replatform-v2-design.md` and its amendments, especially
**A3** (parity target is `dev` as of 2026-08-03, not the 2026-07-16 snapshot) and
**A8** (the design system landed first, so Phase 2 builds its UI once).
**Read before touching UI:** `docs/design-system/V2-ADDENDUM.md`.

## Summary

Build the loop the product exists for: enter your Wordle board, see the team's month
grid update live, and have the month's winner recomputed correctly as a side effect of
the write. Plus the access-check helpers that replace Supabase RLS.

Phase 2 is the first phase with substantial product surface, so several shape decisions
that Phases 3–6 will inherit are settled here: how queries are scoped, where scoring
logic lives, and how the selected team and month are represented.

## Context

The v2 schema already made the hardest decision. `dailyScores.puzzleDay` (`'YYYY-MM-DD'`)
replaced v1's "group by instant" model, which resolved a board's day in *the viewer's*
timezone and put 733 of 7468 production rows on a different calendar day in UTC than in
`America/Chicago`. Phase 2 is the first phase that has to actually *use* `puzzleDay`, so
board entry, month grouping and the winner computation all key off day-strings rather
than `Date` objects. That is a designed divergence from v1, recorded in the schema, not
drift introduced here.

Two v1 behaviours post-date the original design and must be ported in their **current**
form, per A3:

- **`a335ae8` — board entry never loses a submission.** `handleSubmit` is wrapped in
  try/catch with `setSubmitting(false)` in `finally`; the sheet closes **only** on
  success (it used to close unconditionally and discard everything typed); a failed
  winner update raises a warning toast rather than a silent success.
- **`45e3cd6` — no browser-only state in the signed-in landing render** (hydration fix).

## Decisions Made (and alternatives ruled out)

| Decision | Chosen | Ruled out / why |
|---|---|---|
| Phase 2 scope | Scoreboard, board entry, month navigation, winner logic, access helpers, plus a minimal read-only team selector | TeamBoards carousel, the monthly-winner celebration dialog, and the pro gate on month navigation — none are needed for the done-when, and each drags a dependency or a Phase 5 coupling with it |
| Query shape | **Scoped to team + month** | One big `getDashboard` query porting v1's shape — v1 loads *all* teams, players and scores ever into a client context, and Convex re-pushes a query's whole result to every subscriber on every write. `wordle-teams-dcu` flags database **bandwidth**, not function calls, as the binding free-tier limit |
| Totals & ordering | Computed **client-side** from the scoped set, via a module shared with the server | Computing in the query — rejected to keep the table's data path simple; the sharing requirement is what keeps the two in agreement |
| "Today" for missed-day scoring | **Client sends its local `today`** as a `'YYYY-MM-DD'` argument | Player's stored `timeZone` (optional in the schema, unset for some players, and viewers would still want their own midnight); UTC (flips "today" at 6–7pm US local — a smaller cousin of the bug `puzzleDay` exists to kill) |
| Board upsert key | **`(playerId, puzzleDay)`** — look up, then update or insert | Porting v1's `scoreId`-or-insert, which creates a duplicate row on double submit and has already done so 5 times in production (`wordle-teams-rac`) |
| `hasSeenCelebration` on winner rewrite | **Preserve when the winner is unchanged; reset when it changes** | v1's SQL deletes and re-inserts the row, silently wiping the seen-list every time anyone enters a board dated in that month, which can re-fire the confetti at someone who already dismissed it |
| Scores table | **Hand-rolled** on the shadcn `table` primitive | `@tanstack/react-table` — v1 uses it, but that table never sorts, filters or paginates (`getData` pre-sorts), and its column pinning is plain `sticky left-0 bg-background` CSS that react-table plays no part in |
| Date formatting | **`Intl.DateTimeFormat`** plus a small ordinal helper | `date-fns` — nothing else in v2 needs it, and the day-string helpers must stay dependency-free so nothing pulls a date library into the Convex bundle |
| Team & month selection | **Route search params** (`/?team=<id>&month=2026-08`) | v1's context + localStorage, which needed three separate hydration guards and still produced `wordle-teams-uc5`. Search params are SSR-safe by construction — the same lesson A3's `45e3cd6` encodes |

### Divergences from v1, and where they are recorded

Phase 7's parity audit walks prod against beta. Going into Phase 2 it expected **one**
known difference (duplicate-letter tile colouring, `wt-ksh.12.10`). Phase 2 adds two, both
deliberate:

1. **A double submit can no longer create a duplicate score row.** The 5 copied pairs
   already in the data are left untouched and read first-wins, exactly as v1 renders them.
2. **`hasSeenCelebration` survives a winner rewrite** when the winner has not changed.

Nothing else. Phase 7 should expect exactly these three and treat any other difference as
a bug.

## Architecture

Three layers, each testable on its own.

### Layer 1 — pure logic, shared by client and server

Lives in `v2/convex/lib/`. That location is deliberate: the Convex bundler certainly
gets it, and Vite resolves it for the client, which already cross-imports from `convex/`
(`src/routes/index.tsx` imports `api` from `../../convex/_generated/api`). No Convex,
React or DOM imports in any of these files.

| Module | Exports | Notes |
|---|---|---|
| `puzzleDay.ts` | `monthRange(month)`, `daysOfMonth(month)`, `isWeekendDay(day)`, `monthOf(day)`, `toPuzzleDay(date)` | All operate on `'YYYY-MM-DD'` strings, which sort lexicographically. `toPuzzleDay` converts a local `Date` — the picked day, or "now" for `today`. **Dependency-free** |
| `board.ts` | `attemptsFor(guesses, answer)`, `boardIsValid(answer, guesses, hasExisting)` | The validation the submit button and the mutation both use, so they cannot disagree |
| `scoring.ts` | `pointsFor(attempts, system)`, `monthTotal(...)`, `winnerOf(...)` | The design's **first-priority** convex-test target |

`v2/src/lib/wordle.ts` keeps `tileStates` and `scoreCell` unchanged. The boundary:
**what a cell shows** stays client-side; **what a day scores** is shared.

#### Ported rules these modules must reproduce

- **`attemptsFor`** — filter empty strings first, then: 6 or more guesses whose last is
  not the answer → `7` (failed); otherwise the guess count. The empty-string filter is
  load-bearing: v1's `upsertBoard` appends a `''` sentinel to a failed 6-guess board, so
  **copied rows can carry a trailing empty guess** and `DailyScore`'s constructor filters
  it on read. v2 writes no sentinel but must tolerate one.
- **`monthTotal`** — walk every day of the month. Skip weekends when `playWeekends` is
  false. A day with a score contributes `pointsFor(attempts)`. A day with no score
  contributes the team's `nA` value **only if the day is before `today`**; days from
  `today` onward contribute nothing.
- **`winnerOf`** — highest month total wins, compared with a strict `>` while iterating
  players in team order, so **the first player at the maximum wins a tie**. This is v1's
  behaviour and is preserved exactly.
- **`boardIsValid`** — valid when either the board is entirely empty *and* a score
  already exists (the delete case), or: the answer is 5 letters, the first guess is 5
  letters, every guess is 0 or 5 letters, and the last non-empty guess is the answer or
  all six rows are full.
- **`pointsFor` is total and cannot throw.** v1's `getScore` throws
  `No score value found for number of attempts` on a lookup miss. v2's scoring system is
  eight named schema fields rather than an array lookup, so the miss is structurally
  impossible. This matters because the winner recomputation runs inside the board-entry
  transaction — a throw there would fail the board write.

### Layer 2 — Convex functions

**`convex/access.ts`** replaces the Supabase RLS policies, per the design's logic-relocation
table.

- `requirePlayer(ctx)` → the `players` doc for the signed-in user, resolved by lowercased
  email exactly as `me.ts` does. Throws `ConvexError` `UNAUTHENTICATED` or `NO_PLAYER`.
- `requireTeamMember(ctx, teamId)` → the `teams` doc, after asserting the caller's player
  id is in `playerIds`. Throws `NOT_A_MEMBER`.

Both get **negative tests**, which the parent design calls out by name: a non-member must
not be able to read another team's scores.

**`convex/scores.ts`**

- `getMyTeams()` — id and name of the teams the caller belongs to. Enough to drive the
  selector; real team management is Phase 3.
- `getTeamMonth({ teamId, month })` — `requireTeamMember` first, then a
  `by_player_and_puzzleDay` range query per member bounded to `monthRange(month)`.
  Returns the team's settings and scoring system, its members, and only that month's
  scores.
- `upsertBoard({ puzzleDay, answer, guesses, today })` — see below.

Note `dailyScores` carries no team reference — a board belongs to a player and is shared
across all their teams — so `upsertBoard` takes no `teamId` and its access check is just
`requirePlayer`.

### Layer 3 — UI

| Component | Notes |
|---|---|
| `src/routes/index.tsx` | Becomes the real dashboard, replacing the Phase 0/1 skeleton page. Grid per `DESIGN_SYSTEM.md` §8: one column on mobile, three from `md` |
| `components/scores-table.tsx` | The month grid |
| `components/board-entry/{button,form,board-input}.tsx` | Dialog on desktop, Sheet on mobile |
| `components/month-picker.tsx` | `dropdown-menu` radio group (already installed) |
| `components/team-picker.tsx` | `select` (already installed) |
| `lib/use-media-query.ts`, `lib/use-visual-viewport.ts` | Ported from v1 |

**Two shadcn components get added:** `popover` and `calendar`, installed with
`shadcn add` run **from inside `v2/`** (from the repo root the CLI misdetects the project
as v1 and resolves the Tailwind entry to `docs/design-system/globals.v2.css`). The date
picker is a genuine gap — `DESIGN_SYSTEM.md` documents no date picker at all — and board
entry needs one with `{ after: today }` and weekend-disabling matchers, per v1's
`date-picker.tsx`. `react-day-picker` works in `Date`s, so conversion happens at the
component boundary at **local noon**, which keeps DST transitions from shifting the day.

## The write path

`upsertBoard` runs as one Convex transaction:

1. `requirePlayer(ctx)`.
2. Re-validate with the shared `boardIsValid`. Throws `INVALID_BOARD` — not reachable
   through the UI, which disables the button on the same predicate, but the mutation does
   not trust the client. v1 had no server-side validation at all.
3. Look up `by_player_and_puzzleDay`:
   - empty answer **and** empty guesses, with an existing row → **delete**
   - existing row → **patch** `answer` and `guesses`
   - no existing row → **insert** with `puzzleDay`, and `date` set to the write instant
4. Recompute monthly winners for **every team the player belongs to**, for
   `monthOf(puzzleDay)`, and upsert `monthlyWinners` by `(teamId, year, month)` using the
   `by_team_year_month` index. This is the relocation of the `update_monthly_winners`
   trigger the parent design specifies. When a team has **no winner** — no member has a
   computable total — any existing row for that `(team, year, month)` is **deleted**,
   matching the SQL, which deletes unconditionally and re-inserts only where
   `winner_id is not null`.

### Prerequisite: `legacyId` must become optional on two tables

`dailyScores.legacyId` and `monthlyWinners.legacyId` are both **required** `v.number()`.
The schema was written for the copy, where every row carries its Supabase primary key, and
its header comment says so: *"EVERY TABLE CARRIES legacyId — its Supabase primary key."*
**Phase 2 is the first phase that creates rows natively**, and a natively-created row has
no Supabase identity to carry. As the schema stands, `upsertBoard` cannot insert.

Make `legacyId` **optional** on `dailyScores` and `monthlyWinners` only. Rationale:

- It is the honest model. A board entered on beta genuinely has no legacy id, and
  synthesising a sentinel would fake a Supabase identity that does not exist.
- The copy is unaffected. Idempotency runs through `by_legacyId` lookups; copied rows
  still carry theirs, and native rows simply never match — which is correct, because the
  copy must not adopt them.
- **Absence becomes a useful marker.** `legacyId === undefined` means "born in v2, not
  copied" — precisely the distinction Phase 7's parity audit and the cutover copy need,
  since row counts must otherwise reconcile against Supabase.
- Widening a required field to optional is a permissive schema change and needs no data
  migration.

The other four tables keep `legacyId` required; nothing in this phase creates rows in
them. This is task 0 in the breakdown below and blocks tasks 4 and 5.

### The A3 warning toast is designed out, not dropped

v1 needed that toast because the board saved and *then* a separate RPC failed, leaving
standings stale while the user was told "success". Here the winner write is in the same
transaction as the board write — both land or neither does, which is the trigger semantics
the parent design said would "port cleanly". The failure mode the toast reports **cannot
occur**.

The other two `a335ae8` behaviours port literally and are what the e2e actually checks:
`handleSubmit` in try/catch with `setSubmitting(false)` in `finally`, and the sheet
closing **only** on success. The acceptance test is: force a submit failure, and the sheet
stays open with every typed letter intact.

## The read path and the scores table

The table is a direct port of v1's `table-config.tsx` display rules onto the existing
`scoreCell()` helper, which already implements them:

- No score, day already past → `0`. No score, today or later → blank.
- Score with 7 attempts → `X`. Score with no attempts on a day not yet past → blank.
- Weekend on a team with `playWeekends` off → `N/A`, rendered at the column level before
  the score is consulted at all.

Layout per `DESIGN_SYSTEM.md` §8: horizontally scrolling month grid in a `rounded-md
border`; **Player column pinned left, Score column pinned right**, both painted
`bg-background` so rows slide underneath; rows sorted by month total descending; score
bold and right-aligned. Day columns are headed `'Mon 3rd'` (`Intl` + ordinal helper).
Columns for days 29–31 are hidden in months that do not have them.

The Player column ports v1's disambiguation: first name alone, or `'First L'` when two
players on the team share a first name, with initials only on mobile.

### Month navigation

A fixed window of the **current month and the two before it**, matching what v1 shows a
free account. The pro expansion (back to the team's earliest score) is out of scope with
the rest of the pro gate, so `getMonthBounds` — which existed only to compute that
earliest month — is **not built**; it lands with the gate.

Worth recording for whoever builds that gate: in v1 the month window is a **UI affordance,
not access control** — every score is loaded client-side regardless. v2's search-param URL
is no leakier, since `getTeamMonth` will return any month a team member asks for. Whether
the pro gate should be enforced server-side is an open question **for that phase**, not
this one.

## Error handling

Mutations throw `ConvexError` with typed codes; the UI maps codes to sonner toasts, per
the parent design.

| Code | Meaning | UI |
|---|---|---|
| `UNAUTHENTICATED` | No session | Redirect to `/login` |
| `NO_PLAYER` | Session with no matching copied player | The existing `me.ts` explanatory copy |
| `NOT_A_MEMBER` | Team read by a non-member | See the amendment below |
| `INVALID_BOARD` | Server-side validation rejected the board | Error toast; the form stays open and populated |

Anything else reaching the form's `catch` is treated as v1 treats it: an error toast
reading "Could not save your board. Your entry is still here — please try again", the
sheet left open, and `setSubmitting(false)` guaranteed by `finally`.

### Amendment — `NOT_A_MEMBER` is a route error boundary, not a toast

**This table originally promised "error toast; team selector falls back to the first
team" for `NOT_A_MEMBER`. What was built is materially different, and the table above
is corrected rather than the code.**

The toast plan assumed the failure surfaces somewhere a toast can sit on top of. It
does not. `NOT_A_MEMBER` is thrown by `getTeamMonth`, which the dashboard reads through
`useSuspenseQuery` — so the rejection happens *during render*, and there is no rendered
dashboard left to float a toast over. Without a boundary it is an uncaught render error.

So the read path gets a route `errorComponent` (`src/components/dashboard-error.tsx`)
which replaces the dashboard with a `DESIGN_SYSTEM.md` §7 error state, and a "Try again"
button that clears `localStorage.selectedTeam` and navigates to `/` with no search
params — which is what actually delivers the "falls back to the first team" outcome the
original row wanted, just by a different route. Clearing localStorage matters: without
it the redirect effect repopulates `?team=` from the same bad value.

Two consequences worth recording:

- **The mutation path and the read path need different copy.** `boardErrorMessage`'s
  generic branch is v1's verbatim "Could not save your board. Your entry is still here"
  — correct when a submission failed, actively wrong on a page that failed to load and
  never attempted a save. `dashboardErrorMessage` is the read-path sibling.
- **No toast is shown for `NOT_A_MEMBER` at all.** The mapped copy renders as page text.
  Phase 7's parity audit works from this document, so it should expect a full error
  screen here, not a toast.

Task 6 additionally validates `?team=` against the caller's own team list client-side,
so the common case — a stale bookmark — is corrected by a silent redirect before the
boundary is ever reached. The boundary is the backstop for what that cannot catch: a
membership revoked mid-session, a team deleted between render and query, an outage.

## Testing

- **`convex/lib/scoring.test.ts`, `board.test.ts`, `puzzleDay.test.ts`** (vitest, pure) —
  attempts including the trailing-sentinel case, points, month totals with missed days
  before today, weekends excluded when `playWeekends` is off, future days ignored, and
  tie-breaking by team order.
- **`convex/scores.test.ts`** (`convex-test`) — create / update / delete; a double submit
  yields exactly one row; a winner row written for each of the player's teams;
  `hasSeenCelebration` preserved on an unchanged winner and reset on a changed one; and
  the negative access cases — a non-member cannot read another team's month, and nobody
  can write a board for another player.
- **Playwright smoke** extended to login → enter board → see the score, per the parent
  design's "one test, not a suite".
- **Screenshots in light and dark before any UI task is called done.** V2-ADDENDUM §5:
  `vite build`, `tsc --noEmit` and the full test suite were all green while ~80 component
  selectors were dead, because Tailwind emits nothing for a selector that cannot match.
  The toolchain cannot see this class of bug. Use the project's own Playwright chromium
  from inside `v2/`; the MCP browser tool has no Chrome.

## Out of Scope

- **TeamBoards carousel** — the day-by-day view of every teammate's board, with the
  "visible after today's submission" hiding rule. Needs a carousel dependency.
- **Monthly-winner celebration dialog** — the confetti modal. Phase 2 writes the row it
  reads, including the `hasSeenCelebration` rule above, but builds no UI for it.
- **Pro gate on month navigation**, and with it `getMonthBounds`.
- **Team management** — create, switch beyond a read-only selector, member lists,
  settings, the scoring-system editor. All Phase 3.
- **`CurrentTeam`, `MyTeams`, `ScoringSystem`, `CheckoutReturn`, `Intro`** dashboard cards.
- Any new feature or redesign outside the sanctioned exceptions in the parent design.

## Acceptance Criteria

1. A signed-in player can enter, update and delete a board for any selectable day, on
   desktop (Dialog) and mobile (Sheet).
2. On a mobile viewport with the keyboard open, all six guess rows are reachable by
   finger-scroll and Submit stays visible and tappable — the `2026-07-15` keyboard-aware
   sheet design, ported.
3. A failed submit leaves the sheet open with the typed board intact and the form not
   stuck submitting (A3 / `a335ae8`).
4. The scores table shows the selected team's month with correct `X` / `0` / `N/A` /
   blank cells, pinned Player and Score columns, and rows ordered by month total.
5. A board entered in one browser updates another viewer's table **without a refresh**
   (the sanctioned reactivity exception).
6. `monthlyWinners` holds the correct winner for each of the submitting player's teams
   after the write, with ties broken as v1 breaks them.
7. A non-member cannot read another team's month, proven by test.
8. **Phase done-when:** a full fake day works on beta — enter board, live score updates,
   correct monthly winner.

## Task Breakdown

Ten issues under `wt-ksh.3`, in dependency order.

| # | Task | Done when |
|---|---|---|
| 0 | Make `legacyId` optional on `dailyScores` and `monthlyWinners` | `convex deploy` accepts the schema and an insert without `legacyId` succeeds. **Blocks 4 and 5** |
| 1 | `convex/lib/` day-string, board and scoring modules | vitest covers attempts (incl. trailing sentinel), points, month totals, tie-break; green |
| 2 | `convex/access.ts` helpers | convex-test proves a non-member is refused and an unauthenticated caller throws |
| 3 | `getMyTeams`, `getTeamMonth` | a scoped month returns only that month's rows, only for members |
| 4 | `upsertBoard` incl. the delete path | create / update / delete proven, and a double submit yields one row |
| 5 | Winner recomputation inside the mutation | a winner row per team, tie-break, and the `hasSeenCelebration` rule proven |
| 6 | Dashboard shell, team picker, month picker | URL drives team and month; a reload keeps the selection; no hydration warning |
| 7 | Scores table | pinned columns and all four cell rules render; screenshotted light and dark |
| 8 | Board entry (Dialog / Sheet, viewport hook, date picker, keyboard, submit) | six rows scrollable at an iOS viewport with Submit pinned; a failed submit keeps the board |
| 9 | Live update, e2e smoke, phase close | a full fake day on beta |

## Gotchas Carried Into This Phase

- Run everything from **inside `v2/`**. A `pnpm build` from the repo root builds v1 and
  dirties the tracked `public/sw.js` (`wordle-teams-d9g`). The shadcn CLI misdetects the
  project from the root.
- v2's import alias is `#/`, not `@/`.
- Kill stray dev servers by port (`lsof -ti :3000`); a second `pnpm dev` silently binds
  3001 and you end up testing a stale server.
- Do not switch shadcn off `style: "default"` to a `radix-*` preset — `radix-nova` is
  broken upstream and the breakage is invisible to the entire toolchain (V2-ADDENDUM §5).
- `bd create --description` mangles backticks through shell command substitution; use
  `--body-file`.
