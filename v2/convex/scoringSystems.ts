import { v } from 'convex/values'
import { mutation } from './_generated/server'
import { accessError, requirePlausibleToday, requirePlayer, requireTeamCreatorFor } from './access'
import { SYSTEM_FIELDS, SYSTEM_VALUE_MAX, SYSTEM_VALUE_MIN } from './lib/scoringSystem.ts'
import { monthOf } from './lib/puzzleDay.ts'
import { monthsWithWinners, recomputeTeamMonths } from './winners.ts'
import type { Id } from './_generated/dataModel'
import type { WriterCtx } from './winners.ts'
import type { PuzzleDay } from './lib/puzzleDay.ts'
import type { ScoringSystem } from './lib/scoring.ts'

/**
 * The scoring-system slice of team management, split out of teams.ts
 * (wt-ksh.4.32). teams.ts owns team IDENTITY and MEMBERSHIP — name,
 * playerIds, creator, playWeekends, showLetters; this module owns the
 * scoringSystems table exclusively and never touches those fields.
 */

/**
 * Whole numbers only, in the range v1's PointsInput clamps to.
 *
 * SYSTEM_FIELDS (lib/scoringSystem.ts) is what makes this exhaustive rather
 * than hand-listed — see that constant's comment. Chosen over iterating
 * `Object.keys(values)` because that validates only the keys that happen to
 * arrive: it would pass an object missing a field rather than rejecting it,
 * which is the wrong direction for a validator.
 */
function requireValues(values: ScoringSystem): ScoringSystem {
  for (const field of SYSTEM_FIELDS) {
    const value = values[field]
    if (!Number.isInteger(value) || value < SYSTEM_VALUE_MIN || value > SYSTEM_VALUE_MAX) {
      throw accessError('INVALID_SYSTEM')
    }
  }
  return values
}

/**
 * Change a team's scoring system, from THIS MONTH FORWARD.
 *
 * wordle-teams-1j3. Writes (or patches) the scoringSystems row for the current
 * month rather than overwriting the team doc, so every earlier month keeps
 * resolving to whatever governed it. Then recomputes this month and every later
 * month with a winner row, because those totals really did change.
 *
 * MID-MONTH EDITS DO RECOMPUTE THE RUNNING MONTH. That is the literal reading of
 * "applies to the current month forward": days already played this month
 * re-score, and the month's leader can change immediately. The month is still in
 * play, so nothing anyone has been told is final is being rewritten.
 *
 * NO PRO CHECK. v1 hides the editor from non-pro accounts in the UI and its
 * `save` server action does not check either. Phase 3 reproduces the gate where
 * v1 has it; Phase 5 owns whether it becomes real.
 */
export async function setScoringSystemFor(
  ctx: WriterCtx,
  playerId: Id<'players'>,
  args: { teamId: Id<'teams'>; values: ScoringSystem; today: PuzzleDay },
): Promise<void> {
  const team = await requireTeamCreatorFor(ctx, playerId, args.teamId)
  const today = requirePlausibleToday(args.today)
  const values = requireValues(args.values)
  const effectiveFrom = monthOf(today)

  const existing = await ctx.db
    .query('scoringSystems')
    .withIndex('by_team_and_effectiveFrom', (q) =>
      q.eq('teamId', team._id).eq('effectiveFrom', effectiveFrom),
    )
    .first()

  if (existing) await ctx.db.patch(existing._id, values)
  else await ctx.db.insert('scoringSystems', { teamId: team._id, effectiveFrom, ...values })

  // This month, plus every later month that already has a winner row. Earlier
  // months resolve to an earlier version and are deliberately untouched.
  //
  // Strictly `>`: an `>=` would list the edited month twice when it already has
  // a winner row. recomputeTeamMonth is idempotent so that would only be wasted
  // work, but the intent — "this month, then the ones after it" — is clearer
  // stated once.
  const later = (await monthsWithWinners(ctx, team._id)).filter((month) => month > effectiveFrom)
  await recomputeTeamMonths(ctx, team, [effectiveFrom, ...later], today)
}

export const setScoringSystem = mutation({
  args: {
    teamId: v.id('teams'),
    values: v.object({
      oneGuess: v.number(),
      twoGuesses: v.number(),
      threeGuesses: v.number(),
      fourGuesses: v.number(),
      fiveGuesses: v.number(),
      sixGuesses: v.number(),
      failed: v.number(),
      nA: v.number(),
    }),
    today: v.string(),
  },
  handler: async (ctx, args) => {
    const player = await requirePlayer(ctx)
    await setScoringSystemFor(ctx, player._id, args)
  },
})
