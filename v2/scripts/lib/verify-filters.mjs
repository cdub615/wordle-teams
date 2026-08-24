// What verify-parity.mjs must NOT expect to find in Convex.
//
// The copy deliberately leaves rows behind — see lib/copy-filters.mjs for the
// two rules and the evidence they are safe — so a verifier that compared every
// scoped Supabase row would report a shortfall for rows that were never meant to
// cross. This narrows the scoped read to the rows the copy would have written,
// so the comparison stays EXACT. The alternative, letting the verifier tolerate
// a delta, is refused: a check with a fudge factor cannot tell a deliberate
// exclusion from a lost row, which is the one question it exists to answer.
//
// SEPARATE FROM copy-filters.mjs because the contracts differ. selectCopyable
// answers "which players and teams does the copy write", over two arrays, and
// the copier needs nothing else. This answers "which of readScoped's rows should
// the verifier expect to find", over the whole result object, and additionally
// narrows memberships — which the copier deliberately does NOT do, because
// upsertMemberships resolves each row's player and counts the unresolvable ones
// into its own `skipped` tally. Widening selectCopyable to narrow memberships
// would add a return value nothing in the copier reads.
//
// Pure functions over plain Supabase row objects. verify-parity.mjs does its own
// work at module scope against a live deployment and cannot be imported, so
// anything worth asserting lives here, where verify-filters.test.mjs can pin it
// with no network and no deployment. Same reason copy-filters.mjs exists.

import { selectCopyable } from './copy-filters.mjs'

/**
 * Narrow a readScoped() result to the rows the copy would actually have written.
 *
 * Players and teams come straight from selectCopyable rather than from a second
 * implementation of the same rules, so the verifier cannot drift from the copier
 * it is checking.
 *
 * MEMBERSHIPS ARE NARROWED HERE, and only here, by player. Measured against
 * production on 2026-08-24: player_customer holds 535 rows to players' 535, none
 * of them orphaned, and all 151 nameless players carry one — so player_customer
 * is 1:1 with players, and a skipped player takes exactly one membership row
 * with it. On that data the two shortfalls are the same number.
 *
 * IF THEY EVER DIVERGE, THAT IS A DATA FINDING, NOT A BUG HERE. The set below is
 * derived from selectCopyable's own output, so the membership predicate cannot
 * drift away from `isNamed` — it has no independent notion of who is copyable.
 * What CAN change is the 1:1 relationship: a player carrying two membership rows
 * makes the membership shortfall exceed the player shortfall, and a skipped
 * player carrying none makes it fall short. Both are real changes in
 * player_customer since 2026-08-24, and both are worth going and looking at.
 * Whoever sees 152 against 151 at the Phase 7 audit should query the table, not
 * read this file.
 *
 * SCORES, WINNERS AND WEBHOOKS ARE PASSED THROUGH UNTOUCHED, deliberately. The
 * Phase 4 measurement (2026-08-20, in the Phase 4 invites design doc) found that
 * nameless players own 0 daily scores and 0 monthly-winner rows, so there is
 * nothing here for a filter to remove; webhook_events was never claimed to be
 * affected. Each upsert mutation already counts any orphan it meets into its own
 * `skipped` tally. A verified shortfall on one of those three would be a new
 * finding to investigate, which is exactly what not filtering them preserves.
 *
 * `copiedPlayerIds` is returned as well as used, because a surviving team's
 * ROSTER needs the same narrowing at a finer grain — see expectedMemberCount.
 *
 * @returns the scoped result with `players`, `teams` and `memberships` narrowed
 *   and every other key passed through, plus the copied player ids and `skipped`
 *   counts for the three.
 */
export function narrowToCopied(src) {
  const { players, teams, skippedPlayers, skippedTeams } = selectCopyable(src.players, src.teams)
  const copiedPlayerIds = new Set(players.map((p) => p.id))
  const memberships = src.memberships.filter((m) => copiedPlayerIds.has(m.player_id))

  return {
    ...src,
    players,
    teams,
    memberships,
    copiedPlayerIds,
    skipped: {
      players: skippedPlayers,
      teams: skippedTeams,
      memberships: src.memberships.length - memberships.length,
    },
  }
}

/**
 * How many members a surviving team should have in Convex.
 *
 * The narrowing again, one level down from rows. upsertTeams resolves every
 * member uuid and DROPS the ones with no matching player — counting them into
 * `droppedMembers` — so a team that survived with a nameless member on it
 * legitimately arrives one member lighter than its Supabase `player_ids`. The
 * Phase 4 measurement found 3 live teams holding a nameless member, so a
 * verifier comparing the raw roster length would report those 3 as mismatches on
 * a full copy.
 *
 * THIS DOES NOT WIDEN WHAT THE COMPARISON ACCEPTS, it moves it. A named member
 * the copy lost still fails, because the expected count still includes them. A
 * nameless player wrongly PRESENT in Convex now fails too, where a raw-length
 * comparison passed — the count it expects is strictly more precise than the one
 * it replaced, in both directions.
 *
 * Here rather than inline in verify-parity.mjs for the reason the whole module
 * exists: that script runs at module scope against a live deployment and cannot
 * be imported, so an expression written there is an expression no test can
 * execute — and a test that restated it could drift from it silently, which is
 * the failure this task was filed to fix.
 *
 * @param team a Supabase teams row; `player_ids` may be null, which Supabase allows.
 * @param copiedPlayerIds the set narrowToCopied returns.
 */
export function expectedMemberCount(team, copiedPlayerIds) {
  return (team.player_ids || []).filter((id) => copiedPlayerIds.has(id)).length
}
