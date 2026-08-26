import { FREE_TEAM_LIMIT } from './lib/teamLimits.ts'
import { cascadeDeleteTeam } from './teams.ts'
import type { Id } from './_generated/dataModel'
import type { WriterCtx } from './winners.ts'

/**
 * Billing. Phase 5 (wt-ksh.6).
 *
 * THIS MODULE OWNS WHAT A MEMBERSHIP CHANGE DOES TO APPLICATION STATE — the
 * transitions between free and pro, and the free-tier limits that get applied
 * when a subscription ends. It is deliberately not the Polar module: talking to
 * Polar (checkout, the customer portal, webhook verification) is transport, and
 * this is the part that has to be true regardless of who the payment processor
 * is. That separation is why a webhook handler can be tested against a captured
 * payload while the rules below are tested against the database alone.
 *
 * EVERYTHING HERE IS A `...For` HELPER taking an explicit playerId, never a
 * mutation reading the session. convex-test cannot stand up a Better Auth
 * session (wordle-teams-obw), so logic behind a mutation wrapper is logic no
 * unit test can reach. The wrappers that do read the session are thin and live
 * next to the code that needs them.
 */

/**
 * Apply the free-tier team limit after a subscription is revoked.
 *
 * SOFTENED — DELIBERATELY NOT A FAITHFUL PORT. Divergence 12.
 *
 * v1's handle_downgrade_team_removal keeps 2 teams, removes the player from the
 * rest, and then DELETES the teams they created beyond the keep list — taking
 * every other member's scores and monthly-winner history with them. A billing
 * event on one account destroying a third party's data is not behaviour worth
 * porting, so v2 reassigns instead and deletes only a team nobody is left on.
 *
 * PORTED FROM 20240501193430, NOT 20240501191728. The latter is the version the
 * Phase 5 epic named, and it carries a real defect: `id != any(teams_to_keep)`
 * is true whenever id differs from AT LEAST ONE element, so with two kept ids
 * every id qualifies and it deletes the teams it just decided to keep. The
 * later migration replaces both occurrences with NOT IN (SELECT UNNEST(...)).
 *
 * THE KEEP-2 ORDERING, MEASURED RATHER THAN TRANSLITERATED. v1's query is
 * `select unnest(array_agg(id)) ... group by creator, created_at
 *  order by (case when creator = player then 0 else 1 end), created_at limit 2`.
 * Whether LIMIT bounds groups or expanded rows decides whether it can keep
 * three teams. Measured against PostgreSQL 15.1: it bounds EXPANDED ROWS, so
 * this keeps exactly two — owned first, then oldest.
 *
 * NO ACCESS CHECK OF ITS OWN. The authority is the verified Polar event that
 * revoked the subscription, not the caller's session; there is no session on a
 * webhook. Every caller owes the verification that establishes it.
 */
export async function downgradeTeamRemovalFor(
  ctx: WriterCtx,
  playerId: Id<'players'>,
): Promise<void> {
  // Collect-and-filter, because Convex cannot index array membership — the
  // schema comment on `teams` records the production count that makes this
  // fine, and getMyTeamsFor reads the table the same way.
  const allTeams = await ctx.db.query('teams').collect()
  const mine = allTeams.filter((team) => team.playerIds.includes(playerId))

  // Owned first, then oldest. Mirrors getMyTeamsFor's `createdAt ?? 0`, which
  // is how a copied row with no timestamp sorts.
  const ordered = [...mine].sort((a, b) => {
    const owned = Number(b.owner === playerId) - Number(a.owner === playerId)
    if (owned !== 0) return owned
    return (a.createdAt ?? 0) - (b.createdAt ?? 0)
  })

  // FREE_TEAM_LIMIT, never a literal 2: team-picker.tsx reads the same constant
  // to swap "New Team" for "Upgrade for more", and a second literal is how the
  // client-side swap and this server-side check drift apart.
  for (const team of ordered.slice(FREE_TEAM_LIMIT)) {
    const remaining = team.playerIds.filter((id) => id !== playerId)

    // NOBODY LEFT. Only here is a delete correct, and it must cascade — a bare
    // db.delete orphans the team's monthlyWinners and scoringSystems rows.
    // copy-filters.mjs already establishes that a team with nobody on it is not
    // a team.
    if (remaining.length === 0) {
      await cascadeDeleteTeam(ctx, team)
      continue
    }

    await ctx.db.patch(team._id, {
      playerIds: remaining,
      // Reassign only if they owned it. playerIds is append-ordered, so [0] of
      // the remainder is the earliest-joined member — v2 has no joinedAt, and
      // inventing one to answer this would be a schema change for a tiebreak.
      //
      // RULED OUT: leaving the team owner-less. V2-ADDENDUM records that an
      // owner-less team cannot be edited by anyone, so manufacturing that state
      // deliberately is worse than reassigning.
      //
      // This only ever fires for a player who owns THREE OR MORE teams — the
      // keep-2 ordering puts every owned team ahead of every other one, so an
      // owner of two or fewer never reaches the slice.
      ...(team.owner === playerId ? { owner: remaining[0] } : {}),
    })
  }
}
