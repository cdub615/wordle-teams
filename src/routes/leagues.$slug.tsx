import { createFileRoute, redirect } from '@tanstack/react-router'
import { useState } from 'react'
import { toast } from 'sonner'
import { convexQuery, useConvexMutation } from '@convex-dev/react-query'
import { useMutation, useQuery } from '@tanstack/react-query'
import { api } from '../../convex/_generated/api'
import type { Id } from '../../convex/_generated/dataModel'
import { toPuzzleDay } from '../../convex/lib/puzzleDay.ts'
import { pageTitle } from '#/lib/seo'
import { useHydrated } from '#/lib/use-hydrated.ts'
import { mutationErrorMessage } from '#/lib/convex-error.ts'
import { useUpgrade } from '#/components/upgrade-dialog.tsx'
import { DashboardError } from '#/components/dashboard-error.tsx'
import { Skeleton } from '#/components/ui/skeleton.tsx'
import { LeagueFrame, LeaguePageView, leaveMessage, membershipIn } from '#/components/leagues/league-page-view.tsx'
import { regionPanelStatus } from '#/components/leagues/region-panel.tsx'

/**
 * /leagues/$slug — one league's standings, the viewer's group, and the
 * join/switch/leave controls (spec §8.2), or the region league's RegionPanel
 * (v2b). A FLAT FILE with no leagues.tsx
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

/**
 * The query's data, or the last data it had. A NEW KEY (the viewer's group
 * after a join or switch, the day at midnight) starts with no data, and if it
 * then FAILS it never gets any; keeping the last answer lets a working page
 * keep rendering through both. Safe because the component is keyed by slug, so
 * the last answer is always this league's. React's "store information from
 * previous renders" pattern: a state update during render, not a ref.
 *
 * IT RELIES ON STABLE DATA IDENTITY. React Query's structural sharing hands back
 * the same object until the answer changes, so `data !== last` settles after one
 * update. A `select` that returns a fresh object every render would make it
 * true forever and loop ("Too many re-renders").
 */
function useLastData<T>(data: T | undefined): T | undefined {
  const [last, setLast] = useState(data)
  if (data !== undefined && data !== last) setLast(data)
  return data ?? last
}

function LeagueFor({ slug }: { slug: string }) {
  // The viewer's LOCAL day, read only after hydration (the app.tsx idiom), so
  // SSR and the first client render agree. Queries tolerate a stale day
  // (readToday), so a tab left open past midnight keeps rendering.
  const hydrated = useHydrated()
  const today = hydrated ? toPuzzleDay(new Date()) : null
  const { openUpgrade } = useUpgrade()

  const mineQuery = useQuery(convexQuery(api.leagues.myLeagues, today ? { today } : 'skip'))
  const mine = useLastData(mineQuery.data)
  // Only a member has a contribution, so a visitor does not subscribe to one.
  const membership = membershipIn(mine, slug)
  // THE VIEWER'S GROUP goes to standings so a large league returns its row
  // even outside the top 10 (spec v2 §4.5). Undefined until myLeagues answers,
  // and it changes on a join or switch: each re-subscribes, and useLastData
  // stops the page dropping back to skeletons meanwhile. A small league ignores it.
  const groupId = membership?.group._id
  const standingsQuery = useQuery(convexQuery(api.leagues.standings, today ? { slug, today, groupId } : 'skip'))
  const standings = useLastData(standingsQuery.data)
  // "Find a group": nothing is read until a word is submitted.
  const [findWord, setFindWord] = useState<string | null>(null)
  const found = useQuery(convexQuery(api.leagues.groupStanding, today && findWord ? { slug, today, word: findWord } : 'skip'))
  const { data: contribution } = useQuery(
    convexQuery(api.leagues.myContribution, today && membership ? { slug, today } : 'skip'),
  )
  // Only the region league's page reads the viewer's region (RegionPanel).
  // useLastData keeps it through a new key (midnight) that then fails; a
  // failure with no data says so in the panel (regionPanelStatus), never a
  // skeleton forever, and the standings still render.
  const onRegion = Boolean(standings?.enabled && standings.view?.kind === 'region')
  const regionQuery = useQuery(convexQuery(api.leagues.myRegion, today && onRegion ? { today } : 'skip'))
  const myRegion = useLastData(regionQuery.data)

  const join = useMutation({ mutationFn: useConvexMutation(api.leagues.joinGroup) })
  const change = useMutation({ mutationFn: useConvexMutation(api.leagues.switchGroup) })
  const joinWord = useMutation({ mutationFn: useConvexMutation(api.leagues.joinWord) })
  const switchWord = useMutation({ mutationFn: useConvexMutation(api.leagues.switchWord) })
  const leave = useMutation({ mutationFn: useConvexMutation(api.leagues.leaveLeague) })
  const leaveRegion = useMutation({ mutationFn: useConvexMutation(api.leagues.leaveRegion) })
  const rejoinRegion = useMutation({ mutationFn: useConvexMutation(api.leagues.rejoinRegion) })

  // useQuery DOES NOT THROW, so without this a failed query would leave the
  // page in skeletons forever. Rethrown during render, it reaches this route's
  // errorComponent (DashboardError). Only WITHOUT data: a page that has loaded
  // keeps rendering through a transient subscription error, or a failure on a
  // new key (useLastData). A failed contribution only hides its row.
  if (standingsQuery.error && !standings) throw standingsQuery.error
  if (mineQuery.error && !mine) throw mineQuery.error

  if (!today || !standings || !mine) {
    return (
      <LeagueFrame title="Leagues">
        <div aria-busy="true" className="flex flex-col gap-4">
          <Skeleton className="h-10 w-full rounded-lg" />
          <Skeleton className="h-72 w-full rounded-lg" />
        </div>
      </LeagueFrame>
    )
  }

  // MUTATIONS READ THE CLOCK AT THE CLICK, not at render: they refuse an
  // implausible day (INVALID_DATE), and a tab rendered before midnight would
  // otherwise send yesterday.
  const run = async (action: (day: string) => Promise<unknown>, failure: string, success?: (day: string) => string) => {
    const day = toPuzzleDay(new Date())
    try {
      await action(day)
      if (success) toast.success(success(day))
    } catch (error) {
      toast.error(mutationErrorMessage(error, failure))
    }
  }

  return (
    <LeaguePageView
      slug={slug}
      today={today}
      standings={standings}
      mine={mine}
      // Rendering the last answer through an error: say so, rather than pass it off as live.
      stale={Boolean((standingsQuery.error && standings) || (mineQuery.error && mine))}
      contribution={contribution}
      busy={
        join.isPending ||
        change.isPending ||
        joinWord.isPending ||
        switchWord.isPending ||
        leave.isPending ||
        leaveRegion.isPending ||
        rejoinRegion.isPending
      }
      onJoin={(groupId) =>
        run((day) => join.mutateAsync({ groupId: groupId as Id<'leagueGroups'>, today: day }), 'Could not join that group')
      }
      onSwitch={(groupId) =>
        run((day) => change.mutateAsync({ groupId: groupId as Id<'leagueGroups'>, today: day }), 'Could not switch group')
      }
      onJoinWord={(leagueId, word) =>
        run((day) => joinWord.mutateAsync({ leagueId: leagueId as Id<'leagues'>, word, today: day }), 'Could not join that group')
      }
      onSwitchWord={(leagueId, word) =>
        run((day) => switchWord.mutateAsync({ leagueId: leagueId as Id<'leagues'>, word, today: day }), 'Could not switch group')
      }
      find={{
        onFind: setFindWord,
        // A failed search says so in the result line; it never throws the page.
        result: findWord
          ? found.error && !found.data
            ? { word: findWord, standing: undefined, failed: true }
            : { word: findWord, standing: found.data?.enabled ? found.data.standing : undefined }
          : null,
      }}
      onLeave={(m) =>
        run(
          (day) => leave.mutateAsync({ leagueId: m.leagueId as Id<'leagues'>, today: day }),
          'Could not leave the league',
          (day) => leaveMessage(m.group.name, m.since, day),
        )
      }
      region={{
        // `region` is null only before the region league is seeded (requirePlayer
        // rules out a missing player), and then the page says it couldn’t load your region.
        status: regionPanelStatus(myRegion, regionQuery.error),
        onLeave: () =>
          run(
            (day) => leaveRegion.mutateAsync({ today: day }),
            'Could not leave your region',
            () => 'You left your region. Rejoin any time — your boards count from the day after.',
          ),
        onRejoin: () =>
          run((day) => rejoinRegion.mutateAsync({ today: day }), 'Could not rejoin your region', () => 'You’re back in your region from tomorrow.'),
      }}
      onUpgrade={openUpgrade}
    />
  )
}
