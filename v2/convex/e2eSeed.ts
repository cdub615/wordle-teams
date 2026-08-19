import { mutation } from './_generated/server'
import { v } from 'convex/values'
import { isE2eEmail } from './testOtps'

/**
 * Gives an e2e test account a team, so the dashboard clears its "not on a
 * team yet" empty state and shows the board-entry button (wt-ksh.3.11).
 *
 * A fresh signIn() account has no `players` row at all — access.ts links a
 * session to a player purely by email, and nothing in the login flow creates
 * one. board-entry.spec.ts needs both a player row AND a team that contains
 * it before the dashboard renders anything to click. This is committed
 * rather than a scratch mutation, per the same idempotent-seed shape as
 * testOtps.ts, so repeated e2e runs do not require hand-editing the backend.
 *
 * Guarded exactly like testOtps.takeFor: E2E_TEST_MODE must be 'true' (set
 * on the local dev deployment, never on production) and the email must match
 * the e2e+*@wordleteams.com pattern, so this can never create data outside a
 * throwaway test run.
 *
 * legacyId is a synthetic value here on purpose. Real players/teams always
 * carry their Supabase primary key (see schema.ts's header comment), but an
 * e2e-only account has no Supabase row to point at, and this phase left
 * `players.legacyId` / `teams.legacyId` required rather than widening them
 * the way dailyScores/monthlyWinners were in Task 0 — inventing a value here
 * is the least invasive way to satisfy that without touching the schema.
 */
export const ensureTeamFor = mutation({
  args: { email: v.string() },
  handler: async (ctx, { email }) => {
    if (process.env.E2E_TEST_MODE !== 'true' || !isE2eEmail(email)) {
      throw new Error('e2eSeed.ensureTeamFor is only available in E2E test mode for e2e+* addresses')
    }
    const lower = email.toLowerCase()

    const existingPlayer = await ctx.db
      .query('players')
      .withIndex('by_email', (q) => q.eq('email', lower))
      .first()
    const playerId =
      existingPlayer?._id ??
      (await ctx.db.insert('players', {
        legacyId: `e2e-${lower}`,
        email: lower,
        firstName: 'E2E',
        lastName: 'Tester',
        hasPwa: false,
        reminderDeliveryMethods: [],
        reminderDeliveryTime: '18:00:00',
      }))

    // No index for "teams containing player X" — same collect-and-filter as
    // scores.ts's getMyTeams, and just as fine at e2e scale.
    const teams = await ctx.db.query('teams').collect()
    const existingTeam = teams.find((team) => team.playerIds.includes(playerId))
    if (existingTeam) return existingTeam._id

    return await ctx.db.insert('teams', {
      legacyId: Date.now(),
      name: 'E2E Team',
      playerIds: [playerId],
      invited: [],
      oneGuess: 5,
      twoGuesses: 3,
      threeGuesses: 2,
      fourGuesses: 1,
      fiveGuesses: 0,
      sixGuesses: -1,
      failed: -3,
      nA: 0,
      playWeekends: true,
      showLetters: true,
    })
  },
})
