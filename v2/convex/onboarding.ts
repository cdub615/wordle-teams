import { mutation, query } from './_generated/server'
import { currentPlayer, requirePlayer } from './access'

/**
 * The two onboarding facts the client cannot already derive.
 *
 * WHY THIS QUERY IS SO SMALL, and why it must stay that way. The card needs
 * four booleans; three of them (hasTeam, hasInvited, and dismissal's absence)
 * come from data routes/app.tsx ALREADY subscribes to via getMyTeams. Only
 * these two are new.
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

    // NON-EMPTY GUESSES, not mere row existence. v2 deletes a board when both
    // guesses and answer are empty (scores.ts:233), so rows born in v2 always
    // carry real guesses — but rows COPIED from v1 predate that rule, and
    // wordle-teams-456 counts non-empty guesses for exactly this reason.
    // Without the filter, every migrated empty row reads as an activation.
    //
    // Iterated with an early break rather than collected: a heavy player has
    // thousands of these rows and we need to know only whether ONE qualifies.
    let enteredBoard = false
    for await (const board of ctx.db
      .query('dailyScores')
      .withIndex('by_player_and_puzzleDay', (q) => q.eq('playerId', player._id))) {
      if (board.guesses.length > 0) {
        enteredBoard = true
        break
      }
    }

    return { enteredBoard, dismissed: player.onboardingDismissedAt !== undefined }
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
