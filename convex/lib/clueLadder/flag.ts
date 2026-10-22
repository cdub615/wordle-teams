/**
 * The clue ladder's deployment switch, CLUE_LADDER_ENABLED
 * (wordle-teams-9j7o.2.2). The same rule as CHALLENGES_ENABLED
 * (lib/challenge.ts): only the exact string 'true' turns it on, so a typo
 * fails closed.
 *
 * TAKES THE VALUE AS A PARAMETER rather than reading process.env, for the
 * reason challengesEnabled gives: every call site names the variable it
 * consults, and the host's shell stays out of the assertions.
 */

/** The one value that turns the clue ladder ON. Exported so no caller spells it. */
export const CLUE_LADDER_ON = 'true'

export function clueLadderSwitchOn(value: string | undefined): boolean {
  return value === CLUE_LADDER_ON
}

/**
 * Whether a team has the clue ladder, leaving the deployment switch aside
 * (wordle-teams-9j7o.2.11). ON UNLESS THE OWNER SWITCHED IT OFF: absent means
 * on, as acceptsChallenges does, so every team that never touched the setting
 * has it. `!== false`, never `=== true`. The one rule every reader of
 * teams.clueLadderEnabled goes through.
 */
export function teamHasClueLadder(team: { clueLadderEnabled?: boolean }): boolean {
  return team.clueLadderEnabled !== false
}
