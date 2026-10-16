import { createFileRoute, redirect, Link } from '@tanstack/react-router'
import { convexQuery } from '@convex-dev/react-query'
import { ArrowLeft } from 'lucide-react'
import { ClueLadderPlayPage } from '#/components/clue-ladder/play-page.tsx'
import { Button } from '#/components/ui/button.tsx'
import { pageTitle } from '#/lib/seo'
import { api } from '../../convex/_generated/api'

type PlaySearch = { team?: string }

export const Route = createFileRoute('/play/clue-ladder')({
  head: () => ({ meta: [{ title: pageTitle('Clue ladder') }] }),
  validateSearch: (search: Record<string, unknown>): PlaySearch => ({
    team: typeof search.team === 'string' ? search.team : undefined,
  }),
  // THE SAME GUARD AS /chat AND /team. The page's queries call requirePlayer,
  // which throws for a visitor with no session or no player row yet.
  beforeLoad: async ({ context }) => {
    if (!context.isAuthenticated) throw redirect({ to: '/login' })
    const needsProfile = await context.queryClient.ensureQueryData(convexQuery(api.players.needsProfile, {}))
    if (needsProfile) throw redirect({ to: '/complete-profile' })
  },
  component: PlayRoute,
})

/**
 * A full-screen page of its own, phone first (spec section 6). `team` is only
 * for the way back: the game belongs to the player, not to a team.
 */
function PlayRoute() {
  const { team } = Route.useSearch()
  return (
    <div className="mx-auto flex w-full max-w-md flex-col gap-4 p-4">
      <div className="flex items-center gap-2">
        <Button variant="ghost" size="icon" aria-label="Back to dashboard" asChild>
          <Link to="/app" search={{ team }}>
            <ArrowLeft className="h-4 w-4" aria-hidden="true" />
          </Link>
        </Button>
        <h1 className="text-xl font-bold">Clue ladder</h1>
      </div>
      <ClueLadderPlayPage team={team} />
    </div>
  )
}
