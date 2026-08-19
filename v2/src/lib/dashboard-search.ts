/**
 * Deciding what the dashboard URL should say, with no router and no clock.
 *
 * Extracted from routes/index.tsx (wordle-teams-lb9). The effect that consumed
 * this inline was the highest-risk code in the Phase 2 UI — it navigates to
 * fill in URL state while racing hydration, which is the shape an infinite
 * redirect takes. Pulling the decision out means the termination property can
 * be a test rather than a comment: feed this function its own output and it
 * must return null.
 */

export type DashboardSearchInput = {
  /** `?team=` as it stands, or undefined. */
  teamParam: string | undefined
  /** `?month=`, already shape-validated by the route, or undefined. */
  monthParam: string | undefined
  /** The teams the caller actually belongs to. */
  teams: Array<{ id: string }>
  /** localStorage's remembered team, or null. */
  storedTeam: string | null
  /** The viewer's local current month, 'YYYY-MM'. */
  currentMonth: string
}

/**
 * The search params to navigate to, or null when the URL is already correct
 * (or when there is no team to select and nothing sensible to say).
 */
export function resolveDashboardSearch({
  teamParam,
  monthParam,
  teams,
  storedTeam,
  currentMonth,
}: DashboardSearchInput): { team: string; month: string } | null {
  // A teamParam that isn't one of the caller's teams is treated the same as a
  // missing one — a bookmarked or shared URL for a team you've since left.
  // Falling through unvalidated would hand that id straight to the pickers and
  // to real Convex calls.
  const teamValid = teamParam !== undefined && teams.some((team) => team.id === teamParam)
  if (teamValid && monthParam) return null

  const team =
    (teamValid ? teamParam : undefined) ??
    (storedTeam && teams.some((t) => t.id === storedTeam) ? storedTeam : teams[0]?.id)
  if (!team) return null

  return { team, month: monthParam ?? currentMonth }
}
