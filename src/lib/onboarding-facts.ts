import type { OnboardingFacts } from './onboarding-tasks.ts'

/** The shape this needs off getMyTeams. Structural, so codegen is not imported. */
type TeamSummary = { members: unknown[]; hasPendingInvite: boolean }

/** The shape this needs off onboarding.getStatus. */
type Status = { enteredBoard: boolean; dismissed: boolean } | null | undefined

/**
 * Joins the two subscriptions into the four booleans the card renders from.
 *
 * PURE AND SEPARATE FROM THE ROUTE so the global-hasInvited rule is asserted by
 * a plain unit test rather than by reading routes/app.tsx. That rule is the one
 * a future reader is most likely to "fix" into a per-team check.
 */
export function onboardingFactsFrom(teams: TeamSummary[], status: Status): OnboardingFacts {
  return {
    enteredBoard: status?.enteredBoard ?? false,
    hasTeam: teams.length > 0,
    // GLOBAL, not per team. See the test of the same name.
    hasInvited: teams.some((team) => team.members.length > 1 || team.hasPendingInvite),
    dismissed: status?.dismissed ?? false,
  }
}
