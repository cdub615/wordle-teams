// What the Supabase -> Convex copy REFUSES to bring across, and why.
//
// Extracted out of copy-from-supabase.mjs rather than left inline because that
// script cannot be imported: it does its work at module scope, against a live
// deployment. A rule nobody can execute without a service-role key is a rule
// nobody tests, and these two decide whether real rows are silently left behind.
// Pure functions over plain Supabase row objects, so scripts/lib/copy-filters.test.mjs
// can pin them with no network and no deployment.
//
// NOT shared with verify-parity.mjs, and that is worth knowing: the verifier
// still compares every scoped Supabase row against Convex, so a copy that
// legitimately skips rows will read as a parity failure until the verifier
// learns about these exclusions. Kept here, addressable, rather than folded into
// supabase-scope.mjs, whose whole contract is that the copier and the verifier
// share it — putting these there would imply an agreement that does not exist
// yet.

/**
 * A player is copyable only if they have BOTH names.
 *
 * Falsy, not `!= null`, so an EMPTY STRING counts as nameless. That is the whole
 * point rather than sloppiness: players.firstName/lastName are `v.string()` as of
 * Phase 4, and `v.string()` accepts '' forever, so `!= null` here would let the
 * copy write a row that satisfies the schema and still has no name — precisely
 * the state the narrowing exists to make impossible.
 *
 * THIS IS NOW THE ONLY GATE. A one-off mutation cleared the nameless rows the
 * deployments were already holding so the narrowing could be pushed, and was
 * deleted with the state it operated on; this filter is what keeps the copy from
 * putting them back, and the copy runs again at the Phase 7 parity audit and once
 * more inside the cutover window.
 *
 * Safe to drop them: measured against production 2026-08-20, 151 of 533 players
 * are nameless and not one of them owns a dailyScore or a monthlyWinners row.
 */
export const isNamed = (player) => Boolean(player.first_name && player.last_name)

/**
 * Narrow the scoped Supabase rows to the ones the copy will actually write.
 *
 * Teams are filtered AFTER players because the two are coupled: a team is kept
 * only while at least one of its members survived the name filter. A team all of
 * whose members were skipped has nobody who could see or administer it, so
 * copying it would leave an unreachable row that still counts against the free
 * tier and still turns up in a row-count reconciliation. Production has 29 such
 * teams, all of them dead.
 *
 * A team whose `player_ids` was ALREADY empty in Supabase is skipped too — it has
 * no member to survive, so it cannot pass the test. That is the intended reading:
 * a team with nobody on it is not a team.
 *
 * Rosters need no cleaning here. upsertTeams resolves each member uuid and drops
 * the ones with no matching player, counting them into `droppedMembers`, so a
 * surviving team loses its skipped members on the way in. Likewise `creator`:
 * upsertTeams simply omits it when the uuid resolves to nothing, and the column
 * is optional.
 *
 * @returns the rows to copy, plus how many of each were left behind.
 */
export function selectCopyable(players, teams) {
  const copyablePlayers = players.filter(isNamed)
  const copyableIds = new Set(copyablePlayers.map((p) => p.id))
  const copyableTeams = teams.filter((t) => (t.player_ids || []).some((id) => copyableIds.has(id)))

  return {
    players: copyablePlayers,
    teams: copyableTeams,
    skippedPlayers: players.length - copyablePlayers.length,
    skippedTeams: teams.length - copyableTeams.length,
  }
}
