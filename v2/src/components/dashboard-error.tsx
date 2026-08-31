import { useNavigate, type ErrorComponentProps } from '@tanstack/react-router'
import { dashboardErrorMessage } from '#/lib/convex-error.ts'
import { STORAGE_KEY } from '#/lib/dashboard-search.ts'
import { Button } from '#/components/ui/button.tsx'

/**
 * The dashboard route's error boundary (Amendment to Task 7, filed after Task
 * 6's review). Extracted out of routes/app.tsx (quality review, wt-ksh.3.10)
 * once that file also grew the board entry wiring — Phase 3 adds team
 * management to the same route, so the error boundary earning its own file now
 * keeps that growth from compounding on top of it.
 *
 * `ScoresTable` is the first thing in the app that runs a Convex query that
 * can legitimately throw at a user: `getTeamMonth` calls `requirePlayer` and
 * `requireTeamMemberFor`, which throw `NOT_A_MEMBER` for a bookmarked or
 * shared URL carrying a stale `?team=`. Task 6's client-side validation of
 * `?team=` against the caller's own team list closes the common case, but not
 * a team deleted between render
 * and query, a revoked membership mid-session, or a Convex outage — this is
 * the backstop for those. Without a boundary here, a `useSuspenseQuery`
 * rejection is an uncaught render error, not the toast copy convex-error.ts
 * was built to produce.
 *
 * DESIGN_SYSTEM.md §7 "Error state": `text-lg` headline, muted body, single
 * primary retry button. The retry navigates to `/app` with no search params
 * rather than just calling `reset()` — `reset()` alone would immediately
 * re-run the same query with the same bad `?team=` and throw again.
 *
 * It also clears `localStorage.selectedTeam` before navigating. Without that,
 * useDashboardSearchSync (src/lib/use-dashboard-search-sync.ts) can repopulate
 * `?team=` from localStorage with the very team that just threw:
 * `convex/teams.ts`'s `getMyTeams` is a live subscription, and in the window
 * before it catches up to a just-revoked membership, the stale id still
 * passes resolveDashboardSearch's
 * `teams.some(...)` validity check, sending the user right back into the same
 * throw with no escape hatch on this screen. This does NOT make termination
 * unconditional — it removes the one input (a stale localStorage entry) that
 * could otherwise re-select the bad team; the sync still self-heals once
 * `teams` catches up even without this.
 */
export function DashboardError({ error, reset }: ErrorComponentProps) {
  const navigate = useNavigate()
  return (
    <main className="flex w-full justify-center p-2 md:p-12">
      <div className="flex max-w-lg flex-col items-center gap-4 pt-10 text-center">
        <p className="text-lg">Ruh roh, something went wrong!</p>
        <p className="text-muted-foreground">{dashboardErrorMessage(error)}</p>
        <Button
          onClick={() => {
            localStorage.removeItem(STORAGE_KEY)
            reset()
            void navigate({ to: '/app', search: {} })
          }}
        >
          Try again
        </Button>
      </div>
    </main>
  )
}

export default DashboardError
