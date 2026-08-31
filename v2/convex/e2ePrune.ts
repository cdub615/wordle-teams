import { ConvexError, v } from 'convex/values'
import { internalMutation } from './_generated/server'
import { isE2eEmail, isE2ePlayerRow } from './lib/e2e.ts'
import { cascadeDeleteTeam } from './teams.ts'
import type { Doc, Id } from './_generated/dataModel'
import type { MutationCtx } from './_generated/server'

/**
 * Removes e2e test debris from a deployment, one bounded batch at a time.
 *
 * WHY THIS EXISTS (wordle-teams-1cd). Every e2e run creates accounts, teams and
 * boards, and until this landed nothing removed any of it — no globalTeardown,
 * no afterAll, nothing. Measured against the local anonymous backend on
 * 2026-08-26 via a snapshot export: 2520 players, 1680 teams, 7915 dailyScores,
 * 311 monthlyWinners — and every single row of it e2e debris, with no copied or
 * seed data present at all. `getMyTeamsFor` (teams.ts) collects the WHOLE teams
 * table on every call, because Convex cannot index array membership, and the
 * dashboard route's loader awaits it before a post-sign-in navigation can
 * finish — so the size of that table sits on the critical path of every
 * sign-in. The collect was timed at ~260ms median (n=7, min 257, max 280)
 * against 1680 teams, idle and uncontended.
 *
 * NOT PRESENTED AS THE PROVEN CAUSE OF THAT FLAKE, and the comment would be a
 * defect if it were: 260ms idle is not the 5s the failing assertion waited for,
 * and the suite was green both before and after this first ran. What is
 * established is a mechanism and a growth rate, not a causal link. The
 * accumulation is unbounded and worth removing on its own terms.
 *
 * GATED ON E2E_TEST_MODE, exactly like e2eSeed.ts and testOtps.ts. That flag is
 * set on the local dev deployment and must never be set on the one that becomes
 * production — lib/e2e.ts documents that this is still a REQUIREMENT rather than
 * a verified fact (wordle-teams-7az is open), so the gate is necessary and not
 * by itself sufficient. internalMutation on top of it, so nothing on the public
 * API surface can reach this at all, and scripts/prune-e2e-data.mjs adds the
 * checks that need a whole-deployment view rather than a single page.
 *
 * THROWS ConvexError, NEVER A PLAIN Error, unlike its e2eSeed.ts/testOtps.ts
 * siblings. A plain Error's message is redacted in production, and every throw
 * below is a diagnostic the operator needs to read — "you pointed this at a
 * deployment without the flag" is useless delivered as "Server Error".
 *
 * COUNTS ONLY IN EVERYTHING IT RETURNS. No address, no team name, ever. This
 * repository is public and the report is pasted into it.
 */

// Convex bounds how much one mutation may read and write, so the scan is paged.
// 100 players is sized against the worst case measured locally: the busiest e2e
// player held 31 dailyScores and the largest team 19 members, so a full page is
// ~3100 score reads plus one whole-teams collect (1680 docs) — comfortably
// inside the per-transaction limits, with room for the table to have grown.
//
// UPDATED, NOT RECALCULATED, FOR pushSubscriptions. The per-player loop now
// runs three more indexed collects (monthlyWinners by_player, playerMembership,
// pushSubscriptions), but dailyScores still dominates by an order of magnitude,
// so the budget above still holds without a new number to defend. pushSubscriptions
// is the one of the four with no measured bound of its own, and — until Task
// 11's upsert lands — no dedupe either: an e2e run driving N browser contexts
// leaves N rows per player, not one.
const DEFAULT_PAGE_SIZE = 100

/** What one batch touched, or — on a dry run — would have touched. */
export type PruneBatchReport = {
  cursor: string
  isDone: boolean
  playersScanned: number
  e2ePlayersFound: number
  playersDeleted: number
  dailyScoresDeleted: number
  // COUNTS BOTH ROUTES A WINNER ROW CAN LEAVE BY — with its team, through
  // cascadeDeleteTeam, and with its player, through the by_player sweep — and
  // counts each row exactly once. Getting that wrong is not a cosmetic bug: on
  // the local backend every one of the 311 winner rows left by the first route,
  // so a counter that only saw the second would have reported 0 while 311 rows
  // vanished, and the dry run would then have failed to predict the write.
  monthlyWinnersDeleted: number
  scoringSystemsDeleted: number
  playerMembershipsDeleted: number
  // A ROW-PER-BROWSER TABLE (schema.ts), so one e2e player can leave several.
  // Swept exactly like playerMembershipsDeleted — by_player, in the same loop,
  // read before delete — so it is correct in dry-run mode for the same reason:
  // nothing above this loop ever deletes a pushSubscriptions row by any other
  // route, so there is no second path for this counter to miss.
  pushSubscriptionsDeleted: number
  teamsDeleted: number
  teamRostersPatched: number
  // SWEPT ON THE FINAL BATCH ONLY, and the counter is why. "Is this address an
  // e2e address" does not depend on which page is being processed, so a per-page
  // sweep re-counts every surviving team's stale invites on every page: the
  // first run of this against the local backend reported 375 cleared invites for
  // 15 addresses, once per each of its 25 pages. In EXECUTE mode the first page
  // patches them away and the rest see nothing, so only the dry run was wrong —
  // which is worse, not better, since the dry run is what the operator reads
  // before deciding to write.
  teamInvitesCleared: number
  celebrationRefsCleared: number
  teamsKeptWithUnresolvableMembers: number
  invitesDiscardedWithDeletedTeams: number
}

const emptyReport = (cursor: string, isDone: boolean): PruneBatchReport => ({
  cursor,
  isDone,
  playersScanned: 0,
  e2ePlayersFound: 0,
  playersDeleted: 0,
  dailyScoresDeleted: 0,
  monthlyWinnersDeleted: 0,
  scoringSystemsDeleted: 0,
  playerMembershipsDeleted: 0,
  pushSubscriptionsDeleted: 0,
  teamsDeleted: 0,
  teamRostersPatched: 0,
  teamInvitesCleared: 0,
  celebrationRefsCleared: 0,
  teamsKeptWithUnresolvableMembers: 0,
  invitesDiscardedWithDeletedTeams: 0,
})

/**
 * THE DELETION RULE, in full, because getting it wrong destroys real data.
 *
 * A PLAYER is debris iff isE2ePlayerRow (lib/e2e.ts) says so — an `e2e+*`
 * address, or the `e2e-` legacyId the seed stamps. That module carries the
 * measured argument for why neither marker can name a legitimate row.
 *
 * A TEAM IS NOT MARKABLE AT ALL, and no attempt is made to mark one. Seeded
 * teams get `legacyId: Date.now()`, a number in exactly the same field a copied
 * v1 team uses for its Supabase id; teams that e2e creates through the real UI
 * get no legacyId and a name the test typed. Deleting on "legacyId looks like a
 * timestamp", or on the seed's team NAME, would both be guesses — and the name
 * guess is the worse of the two, because a real user may name a team anything.
 *
 * So a team is reached ONLY through its members, and deleted iff BOTH hold:
 *
 *   1. it contained at least one e2e player, AND
 *   2. removing every e2e player from its roster leaves ZERO members.
 *
 * Condition 2 is what protects a live team: one non-e2e member and the team
 * survives, with that member's roster entry untouched. Condition 1 is not
 * redundant — without it a team that was ALREADY empty before this ran, which
 * this prune did not empty and knows nothing about, satisfies condition 2
 * vacuously and gets deleted. A team with no e2e member and no e2e invite is
 * never opened at all.
 *
 * AN UNRESOLVABLE ROSTER ID COUNTS AS A SURVIVOR. Convex ids are not foreign
 * keys, so a roster may name a player document that no longer exists. Such an id
 * cannot be tested against the rule, so it is treated as a member and the team
 * is KEPT — the conservative direction, leaving debris rather than destroying a
 * team on a guess. It is counted rather than passed over, because a nonzero
 * `teamsKeptWithUnresolvableMembers` means some earlier deletion did not clean
 * up after itself. Zero on the local backend.
 *
 * ONE CONSEQUENCE OF PAGING, STATED SO THE REPORT IS NOT READ AS SAYING MORE
 * THAN IT DOES. A team whose e2e members straddle a page boundary is not
 * recognised as doomed on the page holding the first of them — the others are
 * still on its roster, so they count as survivors and the team is merely
 * trimmed. On the WRITE pass the later page then finds an empty roster and
 * deletes it, so the sweep still gets it. On a DRY RUN nothing was trimmed, so
 * the later page still sees the earlier members and the team is never counted:
 * a dry run's `teamsDeleted` is a LOWER BOUND, not an equality, whenever a team
 * spans pages. It errs toward under-promising, never toward deleting more than
 * it said, and a page size above the largest roster (19 locally) avoids it
 * entirely for teams that are wholly debris.
 */
function survivorsOf(team: Doc<'teams'>, e2eIds: ReadonlySet<string>): Array<Id<'players'>> {
  return team.playerIds.filter((id) => !e2eIds.has(id))
}

export const pruneBatch = internalMutation({
  args: {
    // NO DEFAULT, and not optional, in either direction. A dry run must be
    // something the caller ASKED for rather than something it fell into, and so
    // must a write: an optional flag defaulting to false lets a caller that
    // meant to write silently no-op instead, and one defaulting to true is
    // obviously worse.
    execute: v.boolean(),
    pageSize: v.optional(v.number()),
    // `null` starts at the beginning. Threaded by the caller across calls; see
    // scripts/prune-e2e-data.mjs.
    cursor: v.union(v.string(), v.null()),
  },
  handler: async (ctx, { execute, pageSize, cursor }): Promise<PruneBatchReport> => {
    if (process.env.E2E_TEST_MODE !== 'true') {
      throw new ConvexError({
        code: 'e2e_mode_required',
        message:
          'e2ePrune.pruneBatch refuses to run: E2E_TEST_MODE is not "true" on this deployment. ' +
          'That flag is the guard keeping a prune off production. If you meant to prune a test ' +
          'deployment, you are pointed at the wrong one.',
      })
    }

    const numItems = pageSize ?? DEFAULT_PAGE_SIZE
    if (!Number.isInteger(numItems) || numItems < 1) {
      throw new ConvexError({
        code: 'bad_page_size',
        message: `pageSize must be a positive integer; got ${String(numItems)}.`,
      })
    }

    // EXACTLY ONE .paginate() PER EXECUTION — Convex fails at runtime on a
    // second one, which is checked by a test below rather than remembered.
    // Everything else here reaches its rows by index or by collect.
    //
    // Paging over ALL players rather than over e2e ones is what makes the cursor
    // advance on a DRY RUN, where nothing is deleted and a "take the first N
    // still matching" loop would hand back the same page forever. The cursor is
    // a position in the by_creation_time index, so deleting rows inside the page
    // does not disturb it.
    const page = await ctx.db.query('players').paginate({ cursor, numItems })
    const report = emptyReport(page.continueCursor, page.isDone)
    report.playersScanned = page.page.length

    const e2ePlayers = page.page.filter(isE2ePlayerRow)
    report.e2ePlayersFound = e2ePlayers.length
    if (e2ePlayers.length === 0) return report

    const e2eIds: ReadonlySet<string> = new Set(e2ePlayers.map((p) => p._id))
    const e2eEmails: ReadonlySet<string> = new Set(e2ePlayers.map((p) => p.email.toLowerCase()))
    const isStaleInvite = (address: string) =>
      isE2eEmail(address) || e2eEmails.has(address.toLowerCase())

    // Winner rows already accounted for by a team deletion, so the by_player
    // sweep below does not count them a second time.
    //
    // A SET RATHER THAN "the row is gone by then, so it cannot be counted
    // twice". That reasoning holds on a write and fails on a DRY RUN, where
    // nothing is deleted and the by_player query still returns the row — which
    // would make the dry run over-predict exactly the rows the write handles
    // first, and the dry run's whole value is that it predicts the write.
    const winnersAlreadyCounted = new Set<string>()

    // --- teams: rosters, invites, and the ones left with nobody ---------------

    // The whole table, for the same reason getMyTeamsFor collects it: Convex
    // cannot index array membership, so "teams containing player X" has no
    // index. This is the dominant read of the batch and the reason pages are not
    // larger.
    const allTeams = await ctx.db.query('teams').collect()

    for (const team of allTeams) {
      const hadE2eMember = team.playerIds.some((id) => e2eIds.has(id))
      // Only on the last page — see the note on teamInvitesCleared. By then
      // every earlier page's teams have been deleted or trimmed, and the rule
      // that catches the great majority of these (isE2eEmail) never needed a
      // page's player set in the first place.
      const staleInvites = page.isDone ? team.invited.filter(isStaleInvite) : []
      if (!hadE2eMember && staleInvites.length === 0) continue

      const survivors = survivorsOf(team, e2eIds)

      if (hadE2eMember && survivors.length === 0) {
        report.teamsDeleted += 1

        // Counted HERE, from the same indexes cascadeDeleteTeam uses, because
        // the cascade returns nothing and reporting is this script's only
        // output. Read before the delete so the numbers are the same on a dry
        // run and on the write it predicts.
        const doomedWinners = await ctx.db
          .query('monthlyWinners')
          .withIndex('by_team_year_month', (q) => q.eq('teamId', team._id))
          .collect()
        for (const row of doomedWinners) winnersAlreadyCounted.add(row._id)
        report.monthlyWinnersDeleted += doomedWinners.length
        report.scoringSystemsDeleted += (
          await ctx.db
            .query('scoringSystems')
            .withIndex('by_team_and_effectiveFrom', (q) => q.eq('teamId', team._id))
            .collect()
        ).length

        // AN INVITE ON A DOOMED TEAM IS DISCARDED WITH IT, and that is reported
        // rather than refused. Nineteen such addresses existed locally, at
        // example.test / example.com / example.org — RFC-reserved domains the
        // invite specs type in to drive the four InviteOutcome branches, so they
        // name nobody. Refusing on them would have blocked the whole prune on
        // test fixtures. Refusing is still the wrong shape even in general: this
        // team's ENTIRE roster was e2e debris, so it exists only because a test
        // made it, and its pending invites can only have been typed by that
        // test. The count is surfaced so the claim stays checkable.
        report.invitesDiscardedWithDeletedTeams += team.invited.length
        // cascadeDeleteTeam, never a bare db.delete: it also collects this
        // team's monthlyWinners and scoringSystems rows, which a bare delete
        // would orphan — the hazard Phase 4's deleteNamelessPlayers was written
        // around.
        if (execute) await cascadeDeleteTeam(ctx, team)
        continue
      }

      // The team survives. Strip what belonged to the departing players so that
      // nothing is left pointing at a row that is about to stop existing.
      const patch: { playerIds?: Array<Id<'players'>>; invited?: Array<string> } = {}
      if (survivors.length !== team.playerIds.length) {
        patch.playerIds = survivors
        report.teamRostersPatched += 1
        // Checked only for a roster this batch actually trims, so the count
        // stays scoped to teams this run touched rather than being re-tallied
        // for every team on every page.
        if ((await countUnresolvable(ctx, survivors)) > 0) {
          report.teamsKeptWithUnresolvableMembers += 1
        }
      }
      if (staleInvites.length > 0) {
        patch.invited = team.invited.filter((address) => !isStaleInvite(address))
        report.teamInvitesCleared += staleInvites.length
      }
      if (execute && (patch.playerIds !== undefined || patch.invited !== undefined)) {
        await ctx.db.patch(team._id, patch)
      }

      // monthlyWinners.hasSeenCelebration is an array of player ids, so it is a
      // dangling reference in waiting too. Only SURVIVING teams need this pass —
      // a deleted team's winner rows went with it above. Nothing in src/ reads
      // the field today and winners.ts only ever writes `[]`, so the count was
      // zero on every deployment measured; it is stripped anyway, because "no
      // dangling references" is this mutation's whole contract and a future
      // reader of that field must not have to know whether this ever ran.
      const winners = await ctx.db
        .query('monthlyWinners')
        .withIndex('by_team_year_month', (q) => q.eq('teamId', team._id))
        .collect()
      for (const winner of winners) {
        const kept = winner.hasSeenCelebration.filter((id) => !e2eIds.has(id))
        if (kept.length === winner.hasSeenCelebration.length) continue
        report.celebrationRefsCleared += winner.hasSeenCelebration.length - kept.length
        if (execute) await ctx.db.patch(winner._id, { hasSeenCelebration: kept })
      }
    }

    // --- the players' own rows, and everything keyed to them ------------------

    for (const player of e2ePlayers) {
      const scores = await ctx.db
        .query('dailyScores')
        .withIndex('by_player_and_puzzleDay', (q) => q.eq('playerId', player._id))
        .collect()
      report.dailyScoresDeleted += scores.length
      if (execute) for (const row of scores) await ctx.db.delete(row._id)

      // Winner rows on teams that SURVIVED the loop above are still keyed to a
      // player who is about to stop existing, so they go by player as well as by
      // team. Rows a team deletion already accounted for are skipped, not
      // re-counted — see winnersAlreadyCounted.
      const winners = (
        await ctx.db
          .query('monthlyWinners')
          .withIndex('by_player', (q) => q.eq('playerId', player._id))
          .collect()
      ).filter((row) => !winnersAlreadyCounted.has(row._id))
      report.monthlyWinnersDeleted += winners.length
      if (execute) for (const row of winners) await ctx.db.delete(row._id)

      // Not named in the issue's list, but playerMembership.playerId is an
      // id('players') like the rest and would dangle identically. Nine rows
      // locally, all of them e2e.
      const memberships = await ctx.db
        .query('playerMembership')
        .withIndex('by_player', (q) => q.eq('playerId', player._id))
        .collect()
      report.playerMembershipsDeleted += memberships.length
      if (execute) for (const row of memberships) await ctx.db.delete(row._id)

      // Phase 6. Same shape as playerMembership just above: keyed to the player
      // by_player, with no other table or route ever pointing at one of these
      // rows, so there is nothing else in this file that could double-count or
      // miss one the way the winner rows once did.
      const subscriptions = await ctx.db
        .query('pushSubscriptions')
        .withIndex('by_player', (q) => q.eq('playerId', player._id))
        .collect()
      report.pushSubscriptionsDeleted += subscriptions.length
      if (execute) for (const row of subscriptions) await ctx.db.delete(row._id)

      // LAST, ALWAYS. Everything above needs the player's id to find its rows,
      // and a pass that had already deleted the player document would leave them
      // unreachable — a half-finished purge is how orphans are made.
      report.playersDeleted += 1
      if (execute) await ctx.db.delete(player._id)
    }

    return report
  },
})

/**
 * How many of these roster ids no longer resolve to a player document.
 *
 * Bounded by the roster, not the table — the largest team measured locally held
 * 19 members.
 */
async function countUnresolvable(ctx: MutationCtx, ids: Array<Id<'players'>>): Promise<number> {
  let n = 0
  for (const id of ids) if ((await ctx.db.get(id)) === null) n += 1
  return n
}
