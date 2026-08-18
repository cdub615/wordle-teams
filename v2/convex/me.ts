import { query } from './_generated/server'
import { authComponent } from './auth'

/**
 * The signed-in user's own copied data.
 *
 * This exists to make Phase 1's done-when observable: "a real COPIED account
 * logs in on beta via OTP and via Google, and lands on a page showing its own
 * copied data." Until now the landing page showed only the account email and
 * the Phase 0 status message, so a copied account looked identical to a brand
 * new one and the criterion could not actually be checked.
 *
 * Deliberately thin. Access-check helpers and any real scoreboard are Phase 2;
 * this returns just enough to prove the copy landed and resolves to the right
 * person.
 *
 * THE LINK IS BY EMAIL. Copied players carry `legacyId` (their Supabase auth
 * uuid) but nothing joins them to a Better Auth user id, so `players.by_email`
 * is the join. That is also why account linking by verified email matters so
 * much: reach the same address by OTP or by Google and you must arrive at the
 * same player, or this returns someone else's data — or nobody's.
 */
export const myData = query({
  args: {},
  handler: async (ctx) => {
    const user = await authComponent.getAuthUser(ctx)
    if (!user?.email) return null

    // Copied emails are always lowercased on write (see the schema note on
    // `players.email`), so normalise before matching rather than trusting the
    // provider to have handed back the same case.
    const email = user.email.toLowerCase()

    const player = await ctx.db
      .query('players')
      // .first() rather than .unique(): a duplicate email would be a real data
      // problem, but throwing here would take down the whole signed-in page
      // instead of showing the user their teams. The parity script is the right
      // place for that alarm.
      .withIndex('by_email', (q) => q.eq('email', email))
      .first()

    if (!player) return { matched: false as const, email }

    // Collect-and-filter is the sanctioned approach for "teams containing player
    // X": Convex cannot index array membership, and production holds 171 teams
    // in total. See the schema comment on `teams`.
    const allTeams = await ctx.db.query('teams').collect()
    const teams = allTeams
      .filter((t) => t.playerIds.includes(player._id))
      .map((t) => ({ id: t._id, name: t.name, playerCount: t.playerIds.length }))

    const scores = await ctx.db
      .query('dailyScores')
      .withIndex('by_player_and_puzzleDay', (q) => q.eq('playerId', player._id))
      .collect()

    // puzzleDay is 'YYYY-MM-DD', so lexicographic max is the latest day. Never
    // derived from `date` — see the schema note on why grouping by the raw
    // instant is the v1 timezone bug.
    const latestPuzzleDay = scores.reduce<string | null>(
      (latest, s) => (latest === null || s.puzzleDay > latest ? s.puzzleDay : latest),
      null,
    )

    return {
      matched: true as const,
      firstName: player.firstName ?? null,
      lastName: player.lastName ?? null,
      teams,
      scoreCount: scores.length,
      latestPuzzleDay,
    }
  },
})
