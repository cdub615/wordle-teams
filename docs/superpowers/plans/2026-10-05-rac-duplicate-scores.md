# rac: duplicate daily scores — measure, dry-run, repair

**bd:** `wordle-teams-rac` and children `rac.1`–`rac.5`. This document specifies
`rac.1` (the functions) and `rac.2` (the runner). `rac.3`–`rac.5` are the controller's
and the owner's: a PR into `main`, a read-only production measurement, then a dry-run
diff the owner approves before anything is written.

## Why

v1 created duplicate `dailyScores` rows — two rows for one `(player, puzzle day)` —
and the cutover copied them into production v2 faithfully, by design. v2 cannot
create new ones (`upsertBoardFor` finds then patches inside one transaction), so this
is a one-time repair. A duplicate counts a day twice: it inflates a player's board
count and skews their average guesses, the metric team-vs-team challenges compare
on (which is why rac gates turning them on), and every insights statistic, and it may
have changed past monthly winners.

## Owner decisions (2026-10-05)

1. **A pair whose rows DIFFER keeps the LATER-written row.** Every dropped row is
   listed in the report before anything is written.
2. **Recompute exactly the affected months** — `teamMonthStats` and `monthlyWinners` —
   but only after the owner approves a dry-run diff of every month whose stats or
   winner would change.
3. **Route:** internal functions shipped to production via a PR into `main`, run by an
   admin-key `ConvexHttpClient` script. `convex run` cannot reach the cloud deployment
   and `--prod` silently hits the local backend (bd memory). Read-only measurement
   first; production is written only after approval.

## What already exists (reuse it; do not reimplement)

- `convex/migrate.ts`: paginated internal "probe" queries (`insightsPairProbe`,
  `parityProbe`) called by scripts with the migration key. **Read their headers**:
  they return legacy ids rather than document ids, and say why (a public repo).
- `convex/teamStats.ts` `backfillMonth`: schedules `rollupOne` per named team for a
  month — the precedent for a by-hand repair that is NOT gated on `SWEEPS_ENABLED`.
- `convex/winners.ts` `recomputeTeamMonth(ctx, team, month, today)`: the real
  recompute — winners AND the `teamMonthStats` rollup ride it. The repair calls it.
- Pure: `monthTotal`, `winnerOf` (`convex/lib/scoring.ts`), `aggregateTeamMonth`,
  `sameStats`, `meanAttemptsOf` (`convex/lib/teamStats.ts`), `loadTeamMonthSystem`
  (`convex/winners.ts`). The dry run composes these.
- `scripts/copy-from-supabase.mjs` / `scripts/verify-parity.mjs`: how a script loads
  the PROD Convex URL and migration key by name from `.env.local`'s commented block
  (bd memory `convex-env-and-key-scopes`) and calls internal functions with
  `setAdminAuth`. Copy that loading exactly.

## rac.1 — the functions

### 1. The rule, pure: `convex/lib/duplicateScores.ts`

`planCollapse(rows)` over ONE player's rows → for every `puzzleDay` with more than one
row: `{ puzzleDay, keep, drop: [...], differing }`.
- **Survivor = the later-written row**: greatest `createdAt` (v1's created_at, carried
  by the copy); ties → greater `legacyId` (v1's serial id); ties → greater
  `_creationTime`. Rows with no `createdAt` sort before rows with one.
- `differing` is true when any dropped row's `guesses` or `answer` differs from the
  survivor's.
- A day with one row produces nothing. No imports beyond `convex/lib/`.

Unit tests: identical pair; differing pair (later kept); three rows; missing
`createdAt`; legacyId tiebreak; single rows ignored; input order irrelevant.

### 2. The measurement: `duplicateScoresProbe` (internalQuery, in `migrate.ts`)

Paginated over `players` (cursor, 10 per page, like `insightsPairProbe`). For each
player with any collapse group, return the player's legacy id (or, for a v2-native
player, an opaque marker — follow migrate.ts's id policy), and per group:
`puzzleDay`, row count, `differing`, and the kept/dropped rows' `createdAt` and
`legacyId`, plus their attempts. **No emails, no names.** Reads only.

### 3. The impact: `duplicateScoresImpact` (internalQuery, in `migrate.ts`)

Input: a page of affected players (as the probe identifies them). For every team whose
`playerIds` include one of them, for every month containing one of their dropped
days: compute the month's winner and stats **as stored** (the `monthlyWinners` row and
`teamMonthStats` doc) and **as they would be without the dropped rows** (reading the
members' `dailyScores` for the month, excluding the dropped ids, through
`loadTeamMonthSystem` + `monthTotal` + `winnerOf` and `aggregateTeamMonth`, with every
day due — these are past months). Return one entry per (team, month):
`{ team, month, winnerBefore, winnerAfter, winnerChanged, statsChanged, players:
[{ player, boardsBefore, boardsAfter, avgBefore, avgAfter }] }`, ids per the same
policy. Reads only. Keep each call inside Convex's per-execution read limit — the
runner batches; document the bound you chose.

**This is the diff the owner approves.**

### 4. The repair: `repairDuplicateScores` (internalMutation, in `migrate.ts`)

Args: one player (as the probe identifies them), `dryRun` defaulting to **true**.
Re-reads that player's rows and re-plans with `planCollapse` (never trusts a list
passed in), deletes the `drop` rows unless `dryRun`, and returns exactly what it
deleted (or would). **Idempotent:** a second run finds no groups and deletes nothing.
Then, unless `dryRun`, it calls `recomputeTeamMonth` for every (team, month) the
dropped rows touched, with `today` = the server's day. Not gated on
`SWEEPS_ENABLED` or `CHALLENGES_ENABLED` (backfillMonth's reason).

**Before writing it, read how `recomputeTeamMonth` writes the winner row** — patch vs
replace, and what happens to `hasSeenCelebration` when the winner changes — and
REPORT what a changed winner does to the celebration state. Do not change that
behaviour in this task.

### 5. The guarantee v2 already has, pinned

A test that `upsertBoardFor` called twice for the same `(player, puzzleDay)` leaves
exactly one row (if one does not already exist — check `scores.test.ts`). Add one
sentence to `migrate.ts`'s copier comment: it inserts by `legacyId` and is the only
path that can create a duplicate, and only from source data that has one.

### Tests (convex-test, `convex/migrate.test.ts` or a new `convex/duplicateScores.test.ts`)

- probe: finds an identical pair, a differing pair, a triple; ignores clean players;
  pages correctly across a cursor boundary; returns no email or name anywhere.
- impact: a duplicate that FLIPS a month's winner is reported `winnerChanged`; one that
  does not, isn't; averages before/after are correct; a team the player is not on is
  not reported; writes nothing.
- repair: `dryRun` (the default) writes nothing and reports the same rows a real run
  deletes; a real run deletes exactly `drop`, keeps the later row, and recomputes the
  winner; a second run is a no-op; it never deletes a row of a day with one row.

**Mutants to prove:** survivor rule inverted (earlier kept); `dryRun` default flipped;
repair trusting no re-plan (deletes a stale list); impact counting the dropped rows
(winner never changes); a non-duplicate row deleted.

## rac.2 — the runner: `scripts/rac-duplicate-scores.mjs`

Modes: `measure` (probe, all pages), `impact` (probe then impact, batched), `repair
--dry-run` (default) and `repair --apply`. Loads the PROD URL and migration key by
name exactly as `copy-from-supabase.mjs` does, and **prints the deployment host first
and refuses to run if it is `127.0.0.1` or anything other than the expected cloud
host**, unless `--local` is passed for testing against the local backend. `--apply`
also requires an exact confirmation argument naming the host. Output goes to stdout or
a path under the OS temp dir — **never into the repository** (it names real players'
data). Every mode is read-only except `repair --apply`.

Test it against the LOCAL backend with seeded duplicates (`--local`), and show the
`measure` → `impact` → `repair --dry-run` → `repair --apply` → `measure` (now clean)
sequence end to end. That run is the evidence rac.3 needs.

## Gates

The four gates, separately. Commits per function group. No production access of any
kind in rac.1/rac.2: production is rac.4 onward, and it is the controller's.

## Revision 2 (2026-10-06) — after the adversarial review

The review found that "later-written" is not "last edited" (a v2 edit patches whichever
duplicate `.first()` returns, without touching `createdAt`), and that grouping by
`puzzleDay` can merge two different puzzles (days were derived from v1 instants in the
player's CURRENT zone). Owner decisions, superseding decision 1 above:

- **Survivor = the row v2 edits:** the FIRST row in `by_player_and_puzzleDay` index
  order (for one player and day, ascending `_creationTime`). Every v2 edit since the
  cutover landed on it, so no v2 edit can be lost. Applies to identical and differing
  groups alike. (v1 source comparison was rejected: no dependable read access.)
- **Held, never deleted, and listed for the owner:** a group whose non-empty answers
  differ (two puzzles — needs re-dating, not deleting); a group whose `date` instants
  are more than 10 minutes apart (not the double-submit signature); and a group with
  any row lacking `legacyId` (a v2-written row). The report gives the reason.

Also from the review, all to be fixed before any production run:
- **Winners only where they already exist** (I1): recompute winners only for months
  that already have a `monthlyWinners` row for that team, as `recomputeForJoiner`
  does; always roll up stats. Never create a winner row for a month before a team
  existed. The impact report must not count `null -> X` as a winner change.
- **One recompute per (team, month), after all deletes** (I3): no member's partial
  repair may flip and reset `hasSeenCelebration` before another's flips it back.
- **Results are streamed** (I2): each call's result is printed and appended to `--out`
  as it returns, so a failure mid-run keeps the record of what was deleted.
- **`--apply` is tied to the approved plan** (I4): the dry run prints a fingerprint of
  exactly what it would delete; `--apply` requires `--expect=<fingerprint>` and refuses
  on mismatch.
- **Past months only** (M1): impact and repair refuse the current month.
- **Stable impact paging** (M2) and a check that the runner saw every pair.
- **Output guard resolves symlinks** (M3).
- **Tests that can fail** (M5): replace the trivially-true "query writes nothing"
  tests; add fixtures with differing answers and far-apart `date` instants.
