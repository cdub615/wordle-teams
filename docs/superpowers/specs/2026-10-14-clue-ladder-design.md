# Clue ladder — the first owned game, its play surface and the game abstraction

**Issues:** wordle-teams-9j7o.2.2 (game abstraction), wordle-teams-9j7o.3.2 (play surface),
wordle-teams-9j7o.2.3 (first owned game); covers the pilot minimum of wordle-teams-9j7o.3.1
(where play lives). Parent epic: wordle-teams-9j7o.
**Date:** 2026-10-14
**Status:** approved design, awaiting implementation plans

---

## 1. What this is

A daily logic puzzle the app owns, played in the app, scored 1–6 or X like Wordle, and
shown on its own team scoreboard. It is the mechanic for Season 1: a small go/no-go with
the current players (about 7 weekly actives) on whether friends will play an owned game.

**The game.** Five distinct shapes (▲ ■ ● ◆ ★) belong in a row in one hidden order.
Clues arrive one at a time, in the same order for everyone. The player locks in an order
whenever they are sure. Score = the number of clues revealed at lock-in. One lock-in;
a wrong one is X.

**What a result counts toward:** the clue ladder team scoreboard only. Wordle scoring,
stored monthly winners, challenges, leagues, reminders and onboarding are untouched, but
the design leaves a single, named seam for each (section 7).

## 2. Decisions and what was ruled out

| Decision | Ruled out, and why |
|---|---|
| A deduction puzzle you figure out | Code breaker: Wordle with symbols, guess and check. Hidden shapes / hot and cold: guess and check. |
| Clue ladder | Fewest-moves puzzles: learnable tricks, higher boredom risk, needs a new rule set for variety. Classic logic grid: good players all score 0, so most days tie. |
| Day changes at each player's local midnight; one puzzle per date worldwide (Wordle's model) | One global switch moment: lands mid-day for many players and needs a second day model. |
| One lock-in; wrong = X; the last clue always proves the answer | Penalty and continue: cheapens the gamble and runs past 6. Two lock-ins: an extra rule. |
| Pilot access: team owner opts the team in, behind a global env switch | Everyone: exposes all users to a possible no-go. Hand-picked players: half-empty team boards. |
| A dashboard card under the Wordle entry; full-screen play page; Wordle / Clue ladder switch on scores | Whole-dashboard game switch: hides the other game. Separate menu page: easy to forget. |
| Pilot ships play, scoreboard, share line and after-game explanation | Streaks, personal stats and insights: after the go/no-go. |
| A row of five shapes (120 orders) | Shape plus colour: more to learn, colour-blind readability. 3x3 grid: harder to tune and to fit on a phone. Both stay possible as later variants. |
| The scoreboard reuses the team's Wordle points for 1–6 and missed days, but X is a fixed −1 for the clue ladder | The team's own X (default −3) unchanged: the simulation dry run showed careful play then wins about 90% of months, because gambling is a losing bet. A separate settings screen: no evidence other weights should differ. Plain average: ranks differently from the Wordle board beside it. |
| New tables for the game; shared scoring through a game registry | A game field on `dailyScores`: touches every Wordle rebuilder and risks pooling. A stand-alone feature: duplicates scoring, leaves no abstraction. |

The main risk is **score convergence**: skilled players all lock in at the proving
clue and tie, and the gamble stops mattering. The simulation (section 8) must clear it
before any app code is written.

## 3. The daily puzzle

**Clue types (pilot).** Each is a predicate over an order:

- at an end / not at an end
- in slot N / not in slot N
- left of / right of
- next to / not next to
- between (X is somewhere between Y and Z)
- exactly N apart

**Generation.** A seed from the date plus a server-only secret (`CLUE_LADDER_SEED`)
picks the answer and drives clue choice, so a date always yields the same puzzle and
nobody can derive it without the secret. The generator builds a ladder of 4 to 6
clues, all true for the answer, such that:

1. every clue removes at least one order still possible;
2. after the last clue exactly one order remains;
3. before the last clue more than one order remains.

The ladder length varies by day. Three-clue ladders were tried and dropped: under these rules they are almost never possible. The tuning levers, set from the simulation, are the
distribution of ladder lengths and the temptation profile (how many orders remain one or
two clues before the end; "two left" is the pull to lock in early).

**Storage.** `clueLadderPuzzles`: `{ date, answer, clues, remaining, generatorVersion }`,
where `remaining[i]` is the count of orders still possible after clue `i + 1`. Unique by
`date`. A puzzle is created the first time anyone requests a date, and only for dates
that pass `requirePlausibleToday` (`convex/access.ts`). Generation is deterministic, so
two simultaneous first requests produce identical content.

**The solver** is a pure module under `convex/lib/clueLadder/` with no Convex
imports. The generator, the after-game explanation and the simulation script all use it.

**Hidden ladder length.** The player never sees how many clues the ladder has; showing
it would announce "this clue proves it" and replace reasoning with counting.

## 4. Playing a day

**Data.**

- `clueLadderPlays`: `{ playerId, date, cluesRevealed, status: 'playing' | 'solved' | 'failed', scratch, lockedOrder?, lockedAtClue?, startedAt, finishedAt? }`,
  unique by `by_player_and_date`. `scratch` is the player's in-progress slot arrangement.
- `teams.clueLadderEnabled?: boolean`. Only the team owner can change it.
- Env var `CLUE_LADDER_ENABLED`. Only the exact string `'true'` enables it, like
  `CHALLENGES_ENABLED`. Disabled queries return `{ enabled: false }`; disabled mutations
  throw `CLUE_LADDER_DISABLED`.

**Who can play:** a player on at least one team with the clue ladder on. A result
belongs to the player, as a Wordle board does, and appears on every opted-in team they
are in.

**Server functions** (all take the player's local `today`):

- **`today`** (query): the revealed clues only, the status and the scratch arrangement.
  Once the game is finished it also returns the answer, `remaining`, the result, and the
  orders still possible at the clue the player locked in on. While status is `playing`,
  nothing returned contains the answer or an unrevealed clue.
- **`start`** (mutation): creates the puzzle if needed, then the play row with clue 1
  revealed. Idempotent.
- **`nextClue`** (mutation): reveals one more clue. Irreversible. When none remain it
  returns `{ noMoreClues: true }` and changes nothing.
- **`saveScratch`** (mutation): stores the arrangement. The client batches calls
  (one per few seconds at most). It never checks the arrangement against the answer.
- **`lockIn`** (mutation): takes a full order of the five shapes. Correct: `solved`,
  score = `cluesRevealed`. Wrong: `failed` (X). A second call throws `ALREADY_FINISHED`.

**Edge rules.**

- No past dates: a play can only start for a date `requirePlausibleToday` accepts.
  There is no backfill.
- A play still `playing` once its date has passed reads as X. "Passed" is judged on the
  server: the date lies outside the window `requirePlausibleToday` would still accept, so
  no player anywhere can still be on it. Until then the cell shows as not yet played.
  Never starting reads as a missed day under the team's existing missed-day rule.
- Progress lives on the server, so a game resumes on any device the same day.
- Errors are `ConvexError` codes (`CLUE_LADDER_DISABLED`, `CLUE_LADDER_NOT_ON_TEAM`,
  `ALREADY_FINISHED`, `INVALID_ORDER`, `INVALID_DATE`). Plain `Error` messages are redacted in
  production.

**Not in the pilot:** replays, practice, past puzzles, hints.

## 5. Game registry and scoreboard

**Registry** (`convex/lib/games.ts`). Each game declares:

- `id` (`'wordle' | 'clueLadder'`) and a display name;
- `resultsFor(ctx, playerId, fromDay, toDay)` → `Array<{ puzzleDay, attempts }>`,
  with attempts 1–6, or 7 for X;
- `hasPlayed(ctx, playerId, day)` → boolean.

Wordle's entry reads `dailyScores` through the existing `attemptsFor`
(`convex/lib/board.ts`). The clue ladder's entry reads `clueLadderPlays`:
`solved` → `lockedAtClue`; `failed`, or `playing` on a passed date (section 4) → 7.

**Scoring.** `monthTotal` (`convex/lib/scoring.ts`) changes to take attempts per day
instead of Wordle boards; Wordle's caller converts first. `pointsFor` and `winnerOf`
are already game-neutral.

**Team scoreboard.** `getTeamMonth` (`convex/scores.ts`) gains an optional `game`
argument defaulting to `'wordle'`, so every current caller is unchanged. For
`'clueLadder'` it refuses unless the global switch is on and the team has opted in.
Otherwise it walks the roster as it does today, applies the team's scoring system (with X fixed at −1, section 2) and
missed-day rule, and works out the month winner when read. The month dropdown and the
free/Pro month window use the existing rules. The earliest month comes from the game's
results, so a new game starts with only the current month.

**One write path.** Every clue ladder result is written through one function, which
plays the role `upsertBoardFor` plays for Wordle. Later hooks (section 7) attach there.

## 6. Play surface

**Dashboard (`/app`), opted-in teams only.** A "Today's clue ladder" card sits below
the Wordle entry. Its states:

- not started → **Play**
- playing → "Clue N · Continue"
- solved → "Solved on clue N", with a link to the explanation
- failed → "X", with a link to the explanation

The scores area gets a Wordle / Clue ladder switch. The clue ladder view reuses the
scores table, with cells showing the clue number or X. Teams that have not opted in see
no change.

**Play page.** A full-screen route of its own, built phone first, with a back link to
the dashboard.

- **Playing:** five slots above a tray of shapes; tap a shape, then a slot, or drag.
  Revealed clues are listed beneath, with **Next clue** and **Lock in**.
- **Lock in:** enabled once all five slots are filled. It confirms once: "One try. If
  it's wrong, today is an X."
- **Finished:** the answer, the ladder of possible orders (for example
  120 → 12 → 2 → 1), and, if the player locked in before the proving clue, the orders
  they were choosing between ("You had a 1 in 2 chance. The other was …").
  Then a share line and a button back to team scores.

**Share line:** `Clue ladder #N: solved on clue K`, or `Clue ladder #N: X`. N counts days
from a fixed start date constant in code (#1 on that date). Share copies to the clipboard, or opens the native share sheet
where available.

**Accessibility:** shapes differ by outline, not colour; tap targets are full size;
every shape has a text label for screen readers.

## 7. Extension points (designed, not built)

Each later integration is one change at a named seam:

| Feature | Seam | Change |
|---|---|---|
| Stored monthly winners and notifications | the clue ladder write path (section 5) | call a game-keyed `recomputePlayerMonth` |
| Stored team totals (`teamMonthStats`) | the aggregate tables | add an optional `game` field defaulting to `'wordle'`; existing rows stay valid with no migration |
| Challenges | `convex/lib/challenge.ts` and the challenge tables | optional `game` key defaulting to `'wordle'`; read the aggregate for that game |
| Leagues | `convex/lib/league.ts`, which already takes `{ puzzleDay, attempts }` | optional `game` key; feed it `resultsFor` from the registry |
| Reminders and onboarding | their "has played today" checks | call the registry's `hasPlayed` for each enabled game |
| More puzzle formats | the generator | a format field on the puzzle, picked by date |

## 8. Simulation, testing and rollout

**Simulation, before any app code.** A standalone script (`scripts/`) uses the real
generator and solver to play many simulated days with four player types:

- **careful:** locks in only at proof;
- **bold:** locks in when 2 orders remain;
- **reckless:** locks in when 3 or fewer remain;
- **mixed:** chooses among the three each day.

It plays teams of 7 over 28-day months and reports the score spread, ties, fail rates
and month wins by type.

**Bar to clear** (owner may revise):

- careful players win between 10% and 50% of months (skill counts, but does not decide);
- no single player type wins more than half of months;
- bold players fail 15–35% of days.

A daily "tie for first" check was dropped after the dry run: seven players on a 1–6 scale
share the best score on about three quarters of days at every setting, as Wordle groups do.

If the bar is missed, tune the ladder-length distribution and temptation profile and
rerun. If tuning cannot clear the bar, return to the mechanic before building.

**Tests.**

- **Generator and solver:** over thousands of dates, every ladder obeys the three
  rules, and the same date always yields the same puzzle.
- **Server (convex-test):**
  - while a game is playing, `today` never returns the answer or an unrevealed clue;
  - one lock-in only;
  - a stale `playing` row reads as X;
  - opt-in and the global switch are enforced;
  - past dates are refused;
  - each error carries its code.
- **Scoring refactor:** Wordle month totals are identical before and after.
- **Components (jsdom):** play page, card states, scores switch.
- **One Playwright happy path.** `CLUE_LADDER_ENABLED` is added to
  `.github/workflows/deploy-v2.yml` and to the local e2e notes in `CLAUDE.md`.
- All four gates (`test:once`, `typecheck`, `lint`, `build`) run separately on every
  change.

**Rollout.** The switch goes on in dev first. In production the owner sets
`CLUE_LADDER_SEED` and `CLUE_LADDER_ENABLED`, then turns the game on for their own team.
No other team sees a change until the go/no-go (wordle-teams-9j7o.2.7). The kill switch is the env var.

**Build order.** The simulation runs first. Then three plans:

1. **Game abstraction (2.2):** registry, `monthTotal` change, the `getTeamMonth` game
   option, the team opt-in field and the global switch.
2. **Play surface (3.2):** play route, dashboard card and scores switch, against a stub
   game.
3. **Clue ladder (2.3):** puzzle and play tables, server functions, real screens and the
   explanation. The generator and solver from the simulation move into this plan.
