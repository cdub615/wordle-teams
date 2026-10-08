import { createFileRoute, Link, redirect } from '@tanstack/react-router'
import { convexQuery } from '@convex-dev/react-query'
import { useSuspenseQuery } from '@tanstack/react-query'
import { ArrowLeft } from 'lucide-react'
import { api } from '../../convex/_generated/api'
import { pageTitle } from '#/lib/seo'
import { DashboardError } from '#/components/dashboard-error.tsx'
import { Button } from '#/components/ui/button.tsx'
import { Card, CardHeader, CardTitle } from '#/components/ui/card.tsx'

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
  return (
    <main className="page-max mt-2 md:mt-6">
      <div className="mx-auto flex w-full max-w-3xl flex-col gap-4">
        <div className="flex items-center gap-2">
          <Button variant="ghost" size="icon" aria-label="Back to dashboard" asChild>
            <Link to="/app">
              <ArrowLeft className="h-4 w-4" aria-hidden="true" />
            </Link>
          </Button>
          <h1 className="text-2xl font-bold">Leagues</h1>
        </div>
        {!data.enabled ? (
          <p>Leagues aren’t available yet.</p>
        ) : data.leagues.length === 0 ? (
          <p>There are no leagues yet.</p>
        ) : (
          data.leagues.map((league) => (
            <Link key={league.slug} to="/leagues/$slug" params={{ slug: league.slug }}>
              <Card>
                <CardHeader>
                  <CardTitle asChild>
                    <h2>{league.name}</h2>
                  </CardTitle>
                </CardHeader>
              </Card>
            </Link>
          ))
        )}
      </div>
    </main>
  )
}
