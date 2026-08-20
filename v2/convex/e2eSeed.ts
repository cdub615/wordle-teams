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
    // teams.ts's getMyTeams, and just as fine at e2e scale.
    const teams = await ctx.db.query('teams').collect()
    const existingTeam = teams.find((team) => team.playerIds.includes(playerId))
    if (existingTeam) return existingTeam._id

    return await ctx.db.insert('teams', {
      legacyId: Date.now(),
      name: 'E2E Team',
      creator: playerId,
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

/**
 * Two e2e accounts, both profile-complete, on one shared team.
 *
 * wt-ksh.4.1 — the deferred Phase 2 acceptance criterion — needs two
 * authenticated sessions on the same team to prove a board entered by one
 * player pushes to another connected client's scores table with no refresh
 * (e2e/teams.spec.ts). ensureTeamFor above cannot seed this: it is called by
 * the same account that then signs in, so calling it twice — once per email —
 * creates two separate single-player teams with nothing joining them.
 *
 * Both players get firstName AND lastName up front. hasCompleteProfile
 * (lib/player.ts) filters an incomplete profile out of getTeamMonthFor
 * (scores.ts) the same way it filters getMyTeamsFor — a member missing either
 * name would never appear in the scores table this test reads, which would
 * make the live-update assertion pass for the wrong reason (nothing to see
 * updating, rather than proof it updates).
 *
 * Idempotent the same way ensureTeamFor is: found-or-created player rows, and
 * an existing team reused if one already holds both players, so repeated
 * local runs do not pile up teams.
 */
export const ensureSharedTeamFor = mutation({
  args: { emailA: v.string(), emailB: v.string() },
  handler: async (ctx, { emailA, emailB }) => {
    if (
      process.env.E2E_TEST_MODE !== 'true' ||
      !isE2eEmail(emailA) ||
      !isE2eEmail(emailB)
    ) {
      throw new Error(
        'e2eSeed.ensureSharedTeamFor is only available in E2E test mode for e2e+* addresses',
      )
    }

    const ensurePlayer = async (email: string, firstName: string) => {
      const lower = email.toLowerCase()
      const existing = await ctx.db
        .query('players')
        .withIndex('by_email', (q) => q.eq('email', lower))
        .first()
      if (existing) return existing._id
      return await ctx.db.insert('players', {
        legacyId: `e2e-${lower}`,
        email: lower,
        firstName,
        lastName: 'E2E',
        hasPwa: false,
        reminderDeliveryMethods: [],
        reminderDeliveryTime: '18:00:00',
      })
    }

    const playerA = await ensurePlayer(emailA, 'PlayerA')
    const playerB = await ensurePlayer(emailB, 'PlayerB')

    // No index for "teams containing player X" — same collect-and-filter as
    // ensureTeamFor above and teams.ts's getMyTeams, and just as fine at e2e
    // scale.
    const teams = await ctx.db.query('teams').collect()
    const existing = teams.find(
      (team) => team.playerIds.includes(playerA) && team.playerIds.includes(playerB),
    )
    if (existing) return existing._id

    return await ctx.db.insert('teams', {
      legacyId: Date.now(),
      name: 'E2E Live Update Team',
      creator: playerA,
      playerIds: [playerA, playerB],
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
