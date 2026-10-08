import { createFileRoute, Link, redirect } from '@tanstack/react-router'
import { toast } from 'sonner'
import { convexQuery, useConvexMutation } from '@convex-dev/react-query'
import { useMutation, useQuery } from '@tanstack/react-query'
import { ArrowLeft } from 'lucide-react'
import type { ReactNode } from 'react'
import { api } from '../../convex/_generated/api'
import type { Id } from '../../convex/_generated/dataModel'
import { monthOf, toPuzzleDay } from '../../convex/lib/puzzleDay.ts'
import { pageTitle } from '#/lib/seo'
import { useHydrated } from '#/lib/use-hydrated.ts'
import { mutationErrorMessage } from '#/lib/convex-error.ts'
import { useUpgrade } from '#/components/upgrade-dialog.tsx'
import { DashboardError } from '#/components/dashboard-error.tsx'
import { Button } from '#/components/ui/button.tsx'
import { Skeleton } from '#/components/ui/skeleton.tsx'
import { GroupPicker } from '#/components/leagues/group-picker.tsx'
import { LeagueStandings, monthName } from '#/components/leagues/league-standings.tsx'
import { ContributionRow } from '#/components/leagues/contribution-row.tsx'

/**
 * /leagues/$slug — one league's standings, the viewer's group, and the
 * join/switch/leave controls (spec §8.2). A FLAT FILE with no leagues.tsx
 * parent, so nothing needs an <Outlet/>. Signed-in only, with the same guard
 * as /insights, /chat and /team: every query here goes through requirePlayer.
 */
export const Route = createFileRoute('/leagues/$slug')({
  head: () => ({ meta: [{ title: pageTitle('Leagues') }] }),
  beforeLoad: async ({ context }) => {
    if (!context.isAuthenticated) throw redirect({ to: '/login' })
    const needsProfile = await context.queryClient.ensureQueryData(convexQuery(api.players.needsProfile, {}))
    if (needsProfile) throw redirect({ to: '/complete-profile' })
  },
  errorComponent: DashboardError,
  component: LeaguePage,
})

/** KEYED BY SLUG: TanStack reuses the component across a param change. */
function LeaguePage() {
  const { slug } = Route.useParams()
  return <LeagueFor key={slug} slug={slug} />
}

/** The page frame every state shares, so a loading → loaded swap does not jump. */
function Frame({ title, children }: { title: ReactNode; children?: ReactNode }) {
  return (
    <main className="page-max mt-2 md:mt-6">
      <div className="mx-auto flex w-full max-w-3xl flex-col gap-4">
        <div className="flex items-center gap-2">
          <Button variant="ghost" size="icon" aria-label="Back to dashboard" asChild>
            <Link to="/app">
              <ArrowLeft className="h-4 w-4" aria-hidden="true" />
            </Link>
          </Button>
          <h1 className="text-2xl font-bold">{title}</h1>
        </div>
        {children}
      </div>
    </main>
  )
}

function LeagueFor({ slug }: { slug: string }) {
  // The viewer's LOCAL day, read only after hydration (the app.tsx idiom), so
  // SSR and the first client render agree. Queries tolerate a stale day
  // (readToday), so a tab left open past midnight keeps rendering.
  const hydrated = useHydrated()
  const today = hydrated ? toPuzzleDay(new Date()) : null
  const { openUpgrade } = useUpgrade()

  const { data: standings } = useQuery(convexQuery(api.leagues.standings, today ? { slug, today } : 'skip'))
  const { data: mine } = useQuery(convexQuery(api.leagues.myLeagues, today ? { today } : 'skip'))
  const { data: contribution } = useQuery(convexQuery(api.leagues.myContribution, today ? { slug, today } : 'skip'))

  const join = useMutation({ mutationFn: useConvexMutation(api.leagues.joinGroup) })
  const change = useMutation({ mutationFn: useConvexMutation(api.leagues.switchGroup) })
  const leave = useMutation({ mutationFn: useConvexMutation(api.leagues.leaveLeague) })

  if (!today || !standings || !mine) {
    return (
      <Frame title="Leagues">
        <div aria-busy="true" className="flex flex-col gap-4">
          <Skeleton className="h-10 w-full rounded-lg" />
          <Skeleton className="h-72 w-full rounded-lg" />
        </div>
      </Frame>
    )
  }
  if (!standings.enabled || !mine.enabled) {
    return (
      <Frame title="Leagues">
        <p>Leagues aren’t available yet.</p>
      </Frame>
    )
  }
  const view = standings.view
  if (!view) {
    return (
      <Frame title="Leagues">
        <p>That league doesn’t exist.</p>
        <Link to="/leagues" className="self-start text-sm underline underline-offset-4">
          See all leagues
        </Link>
      </Frame>
    )
  }

  const membership = mine.leagues.find((l) => l.league.slug === slug) ?? null
  const busy = join.isPending || change.isPending || leave.isPending
  // MUTATIONS READ THE CLOCK AT THE CLICK, not at render: they refuse an
  // implausible day (INVALID_DATE), and a tab rendered before midnight would
  // otherwise send yesterday.
  const run = async (action: (day: string) => Promise<unknown>, failure: string) => {
    try {
      await action(toPuzzleDay(new Date()))
    } catch (error) {
      toast.error(mutationErrorMessage(error, failure))
    }
  }

  return (
    <Frame title={view.league.name}>
      {membership ? (
        <p className="text-sm">
          You play for <span className="font-mono tracking-widest">{membership.group.name}</span>
          {membership.pending &&
            ` · switching to ${membership.pending.group.name} on ${monthName(monthOf(membership.pending.from))} 1`}
        </p>
      ) : (
        <section aria-labelledby="league-join-heading" className="flex flex-col gap-2">
          <h2 id="league-join-heading" className="font-medium">
            Pick your opener
          </h2>
          <GroupPicker
            groups={view.groups}
            currentGroupId={null}
            disabled={busy}
            label="Pick your opener"
            onPick={(groupId) =>
              run((day) => join.mutateAsync({ groupId: groupId as Id<'leagueGroups'>, today: day }), 'Could not join that group')
            }
          />
          <p className="text-xs text-muted-foreground">Your boards count for your group from tomorrow.</p>
        </section>
      )}
      <LeagueStandings
        month={view.month}
        groups={view.groups}
        standings={view.standings}
        myGroupId={membership?.group._id ?? null}
        lastMonth={view.lastMonth}
        monthsWon={view.monthsWon}
      />
      {membership && contribution?.enabled && (
        <ContributionRow
          view={contribution.locked ? { locked: true } : { locked: false, contribution: contribution.contribution }}
          groupName={membership.group.name}
          onUpgrade={() => openUpgrade('leagues')}
        />
      )}
      {membership && (
        <section aria-labelledby="league-switch-heading" className="flex flex-col gap-2">
          <h2 id="league-switch-heading" className="font-medium">
            Switch group
          </h2>
          <GroupPicker
            groups={view.groups}
            currentGroupId={membership.pending?.group._id ?? membership.group._id}
            disabled={busy}
            label="Switch group"
            onPick={(groupId) =>
              run((day) => change.mutateAsync({ groupId: groupId as Id<'leagueGroups'>, today: day }), 'Could not switch group')
            }
          />
          <p className="text-xs text-muted-foreground">A switch takes effect on the 1st.</p>
          <Button
            type="button"
            variant="ghost"
            className="self-start"
            disabled={busy}
            onClick={() => run((day) => leave.mutateAsync({ leagueId: membership.leagueId, today: day }), 'Could not leave the league')}
          >
            Leave league
          </Button>
        </section>
      )}
    </Frame>
  )
}
