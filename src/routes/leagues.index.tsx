import { createFileRoute, redirect } from '@tanstack/react-router'
import { convexQuery } from '@convex-dev/react-query'
import { useQuery, useSuspenseQuery } from '@tanstack/react-query'
import { api } from '../../convex/_generated/api'
import { pageTitle } from '#/lib/seo'
import { DashboardError } from '#/components/dashboard-error.tsx'
import { LeagueFrame } from '#/components/leagues/league-page-view.tsx'
import { LeagueDirectory } from '#/components/leagues/league-directory.tsx'
import { useHydrated } from '#/lib/use-hydrated.ts'
import { toPuzzleDay } from '../../convex/lib/puzzleDay.ts'

/**
 * /leagues. WITH ONE LEAGUE IT REDIRECTS to that league's page, so v1 never
 * shows an index of one (spec §8.1). With several it is the directory. Same
 * signed-in guard as /leagues/$slug.
 */
export const Route = createFileRoute('/leagues/')({
  head: () => ({ meta: [{ title: pageTitle('Leagues') }] }),
  beforeLoad: async ({ context }) => {
    if (!context.isAuthenticated) throw redirect({ to: '/login' })
    const needsProfile = await context.queryClient.ensureQueryData(convexQuery(api.players.needsProfile, {}))
    if (needsProfile) throw redirect({ to: '/complete-profile' })
  },
  loader: async ({ context }) => {
    const result = await context.queryClient.ensureQueryData(convexQuery(api.leagues.leagues, {}))
    if (result.enabled && result.leagues.length === 1) {
      throw redirect({ to: '/leagues/$slug', params: { slug: result.leagues[0].slug }, replace: true })
    }
  },
  errorComponent: DashboardError,
  component: LeaguesIndex,
})

function LeaguesIndex() {
  const { data } = useSuspenseQuery(convexQuery(api.leagues.leagues, {}))
  // The viewer's LOCAL day, read only after hydration (the house pattern), so
  // SSR and the first client render agree.
  const hydrated = useHydrated()
  const today = hydrated ? toPuzzleDay(new Date()) : null
  const mineQuery = useQuery(convexQuery(api.leagues.myLeagues, today ? { today } : 'skip'))
  const mine = mineQuery.data
  // A failed myLeagues goes to the route's errorComponent rather than a
  // forever "Loading…" (as the league page does).
  if (mineQuery.error && !mine) throw mineQuery.error
  return (
    <LeagueFrame title="Leagues">
      {!data.enabled ? (
        <p>Leagues aren’t available yet.</p>
      ) : data.leagues.length === 0 ? (
        <p>There are no leagues yet.</p>
      ) : !mine ? (
        // Until myLeagues answers we cannot tell which leagues are the viewer's.
        <p role="status">Loading…</p>
      ) : (
        <LeagueDirectory leagues={data.leagues} mine={mine.enabled ? mine.leagues : []} />
      )}
    </LeagueFrame>
  )
}
