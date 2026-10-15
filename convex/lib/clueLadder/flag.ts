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
