// What the Supabase -> Convex copy REFUSES to bring across, and why.
//
// Extracted out of copy-from-supabase.mjs rather than left inline because that
// script cannot be imported: it does its work at module scope, against a live
// deployment. A rule nobody can execute without a service-role key is a rule
// nobody tests, and these two decide whether real rows are silently left behind.
// Pure functions over plain Supabase row objects, so scripts/lib/copy-filters.test.mjs
// can pin them with no network and no deployment.
//
// SHARED WITH verify-parity.mjs SINCE wt-ksh.13.7, through lib/verify-filters.mjs
// rather than directly. The verifier has to expect exactly the rows the copy
// wrote — otherwise a legitimate exclusion reads as a parity failure — and the
// only safe way to agree about that is one implementation of the rules, so
// verify-filters.mjs calls selectCopyable rather than restating it. What lives
// there instead of here is the narrowing the VERIFIER alone needs: memberships
// belonging to a skipped player, which the copier leaves to upsertMemberships'
// own orphan tally.
//
// Still not folded into supabase-scope.mjs. That module's contract is what "in
// scope" means, which both scripts resolve identically; these rules are what the
// copy refuses to bring across, which is a different question, and the verifier
// has to be able to talk about the difference between the two.

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

/**
 * How many of a copy's dropped team memberships the filters ALREADY EXPLAIN.
 *
 * WHY THIS EXISTS. copy-from-supabase.mjs used to print, whenever
 * `teams.droppedMembers > 0`:
 *
 *   Expected with --scope=mine. It would be a real problem with --scope=all.
 *
 * That sentence predates the skip filters above and is wrong because of them. A
 * real `--scope=all` run against beta on 2026-09-02 dropped 6 memberships and
 * told the operator it was "a real problem" — at cutover, under time pressure,
 * which is the worst available moment to send someone chasing a non-issue.
 * (wordle-teams-vlve)
 *
 * THE DROPS ARE STRUCTURAL UNDER BOTH SCOPES. upsertTeams resolves each member
 * uuid against the players actually written and counts what it cannot resolve.
 * Two things make a uuid unresolvable, and NEITHER is a fault:
 *
 *   - NAMELESS. The player was read, and isNamed() left it behind. 151 of 543
 *     on production's data, so under `--scope=all` this is the whole story.
 *   - OUT OF SCOPE. Under `--scope=mine` the player was never read at all.
 *
 * So the honest question is not "were any dropped" but "were MORE dropped than
 * these two rules account for", and only that remainder is worth an alarm.
 *
 * COUNTED OVER copyableTeams, NOT EVERY SCOPED TEAM, because a team the copy is
 * skipping is never handed to upsertTeams and cannot contribute a drop. Counting
 * the others would inflate the prediction and mask a real anomaly underneath it.
 *
 * DUPLICATES ARE NOT DEDUPED, deliberately: upsertTeams walks the roster array
 * and increments once per ENTRY, so a uuid listed twice on one team is two
 * drops. The prediction has to count the same way or it cannot be subtracted.
 *
 * @returns counts that sum to `total`, the number of drops the filters predict.
 */
export function explainTeamMemberDrops(scopedPlayers, copyable) {
  const scopedIds = new Set(scopedPlayers.map((p) => p.id))
  const copiedIds = new Set(copyable.players.map((p) => p.id))

  let nameless = 0
  let outOfScope = 0
  for (const team of copyable.teams) {
    for (const id of team.player_ids || []) {
      if (copiedIds.has(id)) continue
      // Read but not copied means the name filter took it; never read at all
      // means the scope did.
      if (scopedIds.has(id)) nameless++
      else outOfScope++
    }
  }
  return { nameless, outOfScope, total: nameless + outOfScope }
}
