import { mutation, query } from './_generated/server'
import { currentPlayer, requirePlayer } from './access'
import { leaguesEnabled } from './lib/league.ts'

/**
 * The onboarding facts the client cannot already derive (enteredBoard,
 * dismissed, inLeague), the home league card's leagueOfferDismissed, plus
 * leaguesEnabled — not an onboarding fact but a deployment one, read from the
 * environment with no DB access at all, which the app menu uses to decide
 * whether to offer "Leagues".
 *
 * WHY THIS QUERY IS SO SMALL, and why it must stay that way. The card needs
 * hasTeam and hasInvited, which come from data routes/app.tsx ALREADY
 * subscribes to via getMyTeams, plus enteredBoard, dismissed and inLeague.
 * Only those last three are new.
 *
 * THAT IS A DELIBERATE FAN-OUT DECISION, not a coincidence. getMyTeamsFor runs
 * `ctx.db.query('teams').collect()` — a full scan of every team in the system
 * (teams.ts:61) — so a reactive query built on it is invalidated whenever ANY
 * team anywhere changes. getMyTeams already pays that cost and the dashboard
 * already subscribes to it; adding a SECOND such query would double it for
 * every connected client, and this card mounts for everyone who has not yet
 * finished onboarding. Everything read below is keyed to the caller's own
 * player id, so nobody else's activity can invalidate it.
 *
 * DO NOT add a team read here. If something needs one, put a boolean on
 * getMyTeamsFor's existing payload instead — that is what hasPendingInvite is.
 */
export const getStatus = query({
  args: {},
  handler: async (ctx) => {
    // currentPlayer, NOT requirePlayer: this mounts on /app, which is also
    // reachable in the moment before a player row exists. Returning null lets
    // the card render nothing rather than throwing NO_PLAYER at someone who is
    // mid-signup. Same reasoning as players.ts's myName.
    const player = await currentPlayer(ctx)
    if (!player) return null

    // NON-EMPTY GUESSES, not mere row existence. The real guarantee is
    // boardIsValid's rejection of a leading gap for any non-empty submission
    // (see its gap rule in lib/board.ts, enforced in upsertBoardFor) — a row with
    // guesses but no first entry never passes that check, so it can never be
    // written. upsertBoardFor's delete-on-fully-empty rule is a secondary,
    // narrower point: it only covers the case where BOTH guesses and answer
    // are empty, and would not by itself rule out a row like
    // `{ guesses: [], answer: 'crane' }`. Together they mean rows born in v2
    // always carry real guesses — but rows COPIED from v1 predate both rules,
    // and wordle-teams-456 counts non-empty guesses for exactly this reason.
    // Without the filter, every migrated empty row reads as an activation.
    //
    // DESCENDING, not ascending. The rows that motivate the filter — migrated
    // v1 empties — are the OLDEST a player has; the row that flips
    // enteredBoard true is the NEWEST one they enter. Walking oldest-first
    // means a long-tenured migrated player's every prior empty row gets
    // examined before the scan reaches the one that matters; walking
    // newest-first finds it on the first row. Strictly better or equal in
    // every case, and it also narrows the recorded read range once
    // enteredBoard is true (see chat.test.ts's watchReads on why the READ SET,
    // not just the return value, is what makes a subscription cheap or not).
    //
    // Iterated with an early break rather than collected: a heavy player has
    // thousands of these rows and we need to know only whether ONE qualifies.
    let enteredBoard = false
    for await (const board of ctx.db
      .query('dailyScores')
      .withIndex('by_player_and_puzzleDay', (q) => q.eq('playerId', player._id))
      .order('desc')) {
      if (board.guesses.length > 0) {
        enteredBoard = true
        break
      }
    }

    // PUBLIC LEAGUES (zic8.3): whether to offer "Pick your opener". Keyed to the
    // caller's own id like everything else here, so nobody else's activity can
    // invalidate it. Reported as in-league while the feature is dark, so the
    // step never offers something that would refuse.
    // "EVER JOINED", INCLUDING A PLAYER WHO LEFT, deliberately: a player who
    // left chose to and is not re-offered the step (spec §8.4). Do NOT "fix"
    // this to use membershipOf.
    // TWO SOURCES, because neither suffices alone. players.leagueJoinedAt is
    // stamped on the first join and never cleared — it is what survives
    // planLeave DELETING a not-yet-started membership (join then leave the same
    // day leaves no row at all). ANY membership row covers members who joined
    // before that field existed, so no backfill. The field is on the player doc
    // already in hand, so the row read is skipped whenever it answers.
    const inLeague =
      !leaguesEnabled(process.env.LEAGUES_ENABLED) ||
      player.leagueJoinedAt !== undefined ||
      (await ctx.db
        .query('leagueMemberships')
        .withIndex('by_player_and_league', (q) => q.eq('playerId', player._id))
        .first()) !== null

    return {
      enteredBoard,
      dismissed: player.onboardingDismissedAt !== undefined,
      inLeague,
      // "Not now" on the dashboard's league card (leagues.dismissLeagueOffer).
      // Off the player doc already read: no extra read, nobody else's activity.
      leagueOfferDismissed: player.leagueOfferDismissedAt !== undefined,
      // Environment only, NO DB READ, so it cannot widen this query's read set
      // or let anyone else's activity invalidate it. Gates the app menu's
      // "Leagues" item, which would otherwise lead every player on a dark
      // deployment to "Leagues aren't available yet".
      leaguesEnabled: leaguesEnabled(process.env.LEAGUES_ENABLED),
    }
  },
})

/** Hide the card early. Idempotent — a second call just rewrites the stamp. */
export const dismiss = mutation({
  args: {},
  handler: async (ctx) => {
    const player = await requirePlayer(ctx)
    await ctx.db.patch(player._id, { onboardingDismissedAt: Date.now() })
  },
})

/** Bring it back, from the app menu's "Show getting started". */
export const replay = mutation({
  args: {},
  handler: async (ctx) => {
    const player = await requirePlayer(ctx)
    await ctx.db.patch(player._id, { onboardingDismissedAt: undefined })
  },
})
