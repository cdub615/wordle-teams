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
 * with it. The membership shortfall is therefore the player shortfall by
 * construction, not by coincidence. If a run reports the two moving by different
 * amounts, the predicate below has drifted from `isNamed` and that is a bug in
 * this file, not a problem in the data.
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
 * ROSTER needs the same narrowing at a finer grain: upsertTeams resolves each
 * member uuid and drops the ones with no matching player, so a team that kept a
 * nameless member arrives one member lighter than its Supabase `player_ids`.
 * Handing the set out keeps that comparison reading the same answer as this
 * function rather than recomputing it.
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
