import {
  createFileRoute,
  redirect,
  useNavigate,
  type ErrorComponentProps,
} from '@tanstack/react-router'
import { convexQuery } from '@convex-dev/react-query'
import { useSuspenseQuery } from '@tanstack/react-query'
import { useEffect } from 'react'
import { api } from '../../convex/_generated/api'
import { pageTitle } from '#/lib/seo'
import { SIGNIN_PARAM, trackFunnel } from '#/lib/funnel.ts'
import { useHydrated } from '#/lib/use-hydrated.ts'
import { dashboardErrorMessage } from '#/lib/convex-error.ts'
import { MonthPicker } from '#/components/month-picker.tsx'
import { TeamPicker } from '#/components/team-picker.tsx'
import { ScoresTable } from '#/components/scores-table.tsx'
import { BoardEntryButton } from '#/components/board-entry/button.tsx'
import { Skeleton } from '#/components/ui/skeleton.tsx'
import { Button } from '#/components/ui/button.tsx'
import { monthOf, toPuzzleDay } from '../../convex/lib/puzzleDay.ts'
import type { Id } from '../../convex/_generated/dataModel'

type DashboardSearch = { team?: string; month?: string }

export const Route = createFileRoute('/')({
  head: () => ({ meta: [{ title: pageTitle('Dashboard') }] }),
  validateSearch: (search: Record<string, unknown>): DashboardSearch => ({
    team: typeof search.team === 'string' ? search.team : undefined,
    // Anything not shaped like a month is dropped rather than trusted; the
    // effect below then fills in the local current month.
    month:
      typeof search.month === 'string' && /^\d{4}-\d{2}$/.test(search.month)
        ? search.month
        : undefined,
  }),
  beforeLoad: ({ context }) => {
    if (!context.isAuthenticated) throw redirect({ to: '/login' })
  },
  loader: async ({ context }) => {
    await context.queryClient.ensureQueryData(convexQuery(api.scores.getMyTeams, {}))
  },
  errorComponent: DashboardError,
  component: Dashboard,
})

/**
 * The route's error boundary (Amendment to Task 7, filed after Task 6's
 * review).
 *
 * `ScoresTable` is the first thing in the app that runs a Convex query that
 * can legitimately throw at a user: `getTeamMonth` calls `requireTeamMember`,
 * which throws `NOT_A_MEMBER` for a bookmarked or shared URL carrying a stale
 * `?team=`. Task 6's client-side validation of `?team=` against the caller's
 * own team list closes the common case, but not a team deleted between render
 * and query, a revoked membership mid-session, or a Convex outage — this is
 * the backstop for those. Without a boundary here, a `useSuspenseQuery`
 * rejection is an uncaught render error, not the toast copy convex-error.ts
 * was built to produce.
 *
 * DESIGN_SYSTEM.md §7 "Error state": `text-lg` headline, muted body, single
 * primary retry button. The retry navigates to `/` with no search params
 * rather than just calling `reset()` — `reset()` alone would immediately
 * re-run the same query with the same bad `?team=` and throw again.
 *
 * It also clears `localStorage.selectedTeam` before navigating. Without that,
 * the redirect effect below can repopulate `?team=` from localStorage with the
 * very team that just threw: `getMyTeams` is a live subscription, and in the
 * window before it catches up to a just-revoked membership, the stale id still
 * passes the effect's `teams.some(...)` validity check, sending the user right
 * back into the same throw with no escape hatch on this screen. This does NOT
 * make termination unconditional — it removes the one input (a stale
 * localStorage entry) that could otherwise re-select the bad team; the effect
 * still self-heals once `teams` catches up even without this.
 */
function DashboardError({ error, reset }: ErrorComponentProps) {
  const navigate = useNavigate()
  return (
    <main className="flex w-full justify-center p-2 md:p-12">
      <div className="flex max-w-lg flex-col items-center gap-4 pt-10 text-center">
        <p className="text-lg">Ruh roh, something went wrong!</p>
        <p className="text-muted-foreground">{dashboardErrorMessage(error)}</p>
        <Button
          onClick={() => {
            localStorage.removeItem('selectedTeam')
            reset()
            void navigate({ to: '/', search: {} })
          }}
        >
          Try again
        </Button>
      </div>
    </main>
  )
}

function Dashboard() {
  const { team: teamParam, month: monthParam } = Route.useSearch()
  const navigate = useNavigate({ from: Route.fullPath })
  const hydrated = useHydrated()
  const { data: teams } = useSuspenseQuery(convexQuery(api.scores.getMyTeams, {}))

  // Bottom of the login funnel (wt-ksh.12.7). Reaching here authenticated is the
  // only reliable "they made it" signal: the OAuth round-trip finishes as a fresh
  // document load, so nothing on /login survives to observe it. The marker is
  // stripped from the URL immediately so a refresh or a share cannot double-count.
  useEffect(() => {
    const url = new URL(window.location.href)
    const method = url.searchParams.get(SIGNIN_PARAM)
    if (method !== 'oauth' && method !== 'otp') return
    trackFunnel({ name: 'login_callback_arrived', method })
    url.searchParams.delete(SIGNIN_PARAM)
    window.history.replaceState({}, '', url.pathname + url.search + url.hash)
  }, [])

  // Fill in whatever the URL did not specify, AFTER hydration.
  //
  // The current month has to come from the browser's local clock, and reading it
  // during render would make the server (UTC) and the client (local) disagree on
  // the last and first days of a month — the hydration-mismatch class that
  // 45e3cd6 fixed in v1 and that wordle-teams-uc5 was. The URL is the source of
  // truth; localStorage only supplies the default.
  useEffect(() => {
    if (!hydrated) return

    // A teamParam that isn't one of the caller's teams is treated the same as
    // a missing one — e.g. a bookmarked or shared URL for a team you've since
    // left. Falling through unvalidated would hand that id straight to the
    // pickers and, once Tasks 7/8 land, to real Convex calls.
    const teamValid = teamParam !== undefined && teams.some((t) => t.id === teamParam)
    if (teamValid && monthParam) return

    const storedTeam = localStorage.getItem('selectedTeam')
    const team =
      (teamValid ? teamParam : undefined) ??
      (storedTeam && teams.some((t) => t.id === storedTeam) ? storedTeam : teams[0]?.id)
    const month = monthParam ?? monthOf(toPuzzleDay(new Date()))
    if (!team) return

    // Terminates: this redirect only fires once. It replaces the URL with a
    // team that IS in `teams` (either the validated teamParam, a validated
    // storedTeam, or teams[0]), so the render this triggers has teamValid
    // true and monthParam set, and the guard above short-circuits on the very
    // next run of this effect — no second navigate.
    void navigate({ to: '/', search: { team, month }, replace: true })
  }, [hydrated, teamParam, monthParam, teams, navigate])

  useEffect(() => {
    if (teamParam) localStorage.setItem('selectedTeam', teamParam)
  }, [teamParam])

  if (teams.length === 0) {
    return (
      <main className="p-2 md:p-12">
        <p className="text-muted-foreground">
          You are not on a team yet. Creating and joining teams arrives in Phase 3.
        </p>
      </main>
    )
  }

  // Until the effect above resolves both params there is nothing well-defined to
  // render, and rendering a guess is what causes the mismatch.
  if (!teamParam || !monthParam) {
    return (
      <main className="p-2 md:p-12">
        <Skeleton className="h-96 w-full rounded-lg" />
      </main>
    )
  }

  // Reading the clock here does not reintroduce the guardrail above: `hydrated`
  // is false on every render that has to match the server (SSR itself, and the
  // client's first render before its post-mount effect flips it), so this
  // branch is unreachable until a client-only re-render, by which point nothing
  // is being compared against server output any more.
  const currentMonth = hydrated ? monthOf(toPuzzleDay(new Date())) : monthParam

  return (
    <main className="mb-12 grid gap-2 p-2 md:grid-cols-3 md:gap-6 md:p-12">
      <div className="flex items-center gap-2 md:col-span-3">
        <TeamPicker
          teams={teams}
          value={teamParam}
          onChange={(team) => navigate({ to: '/', search: { team, month: monthParam } })}
        />
        <MonthPicker
          currentMonth={currentMonth}
          value={monthParam}
          onChange={(month) => navigate({ to: '/', search: { team: teamParam, month } })}
        />
        <div className="ml-auto">
          <BoardEntryButton teamId={teamParam as Id<'teams'>} month={monthParam} />
        </div>
      </div>
      <ScoresTable teamId={teamParam as Id<'teams'>} month={monthParam} className="md:col-span-3" />
    </main>
  )
}
