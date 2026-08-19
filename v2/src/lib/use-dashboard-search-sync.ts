import { useEffect } from 'react'
import { useHydrated } from '#/lib/use-hydrated.ts'
import { resolveDashboardSearch } from '#/lib/dashboard-search.ts'
import { monthOf, toPuzzleDay } from '../../convex/lib/puzzleDay.ts'

const STORAGE_KEY = 'selectedTeam'

/**
 * Keeps `?team=` and `?month=` filled in, and remembers the team.
 *
 * AFTER HYDRATION ONLY. The current month has to come from the browser's local
 * clock, and reading it during render would make the server (UTC) and the
 * client (local) disagree on the last and first days of a month — the
 * hydration-mismatch class that 45e3cd6 fixed in v1 and that wordle-teams-uc5
 * was. The URL is the source of truth; localStorage only supplies the default.
 *
 * The decision itself lives in the pure resolveDashboardSearch, which has a
 * test asserting it is idempotent — that is what guarantees this effect
 * terminates rather than navigating in a loop.
 */
export function useDashboardSearchSync({
  teamParam,
  monthParam,
  teams,
  navigate,
}: {
  teamParam: string | undefined
  monthParam: string | undefined
  teams: Array<{ id: string }>
  navigate: (search: { team: string; month: string }) => void
}): void {
  const hydrated = useHydrated()

  useEffect(() => {
    if (!hydrated) return
    const next = resolveDashboardSearch({
      teamParam,
      monthParam,
      teams,
      storedTeam: localStorage.getItem(STORAGE_KEY),
      currentMonth: monthOf(toPuzzleDay(new Date())),
    })
    if (next) navigate(next)
  }, [hydrated, teamParam, monthParam, teams, navigate])

  useEffect(() => {
    if (teamParam) localStorage.setItem(STORAGE_KEY, teamParam)
  }, [teamParam])
}
