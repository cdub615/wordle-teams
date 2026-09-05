import { createFileRoute, redirect, useNavigate, Link } from '@tanstack/react-router'
import { ArrowLeft } from 'lucide-react'
import { Suspense, useEffect, useState } from 'react'
import { convexQuery } from '@convex-dev/react-query'
import { useSuspenseQuery } from '@tanstack/react-query'
import { api } from '../../convex/_generated/api'
import { pageTitle } from '#/lib/seo'
import { STORAGE_KEY, resolveTeamSettingsSearch } from '#/lib/dashboard-search.ts'
import { CurrentTeamCard } from '#/components/teams/current-team-card.tsx'
import { MyTeamsCard } from '#/components/teams/my-teams-card.tsx'
import { UpdateTeamDialog } from '#/components/teams/update-team-dialog.tsx'
import { ScoringSystemCard } from '#/components/scoring-system-card.tsx'
import { ScoringSystemCardSkeleton, TeamSettingsSkeleton } from '#/components/dashboard-skeletons.tsx'
import { DashboardError } from '#/components/dashboard-error.tsx'
import { Button } from '#/components/ui/button.tsx'
import { Skeleton } from '#/components/ui/skeleton.tsx'
import { monthOf, toPuzzleDay } from '../../convex/lib/puzzleDay.ts'

type TeamSettingsSearch = { team?: string }

/**
 * Team admin, on its own page (wordle-teams-5jcn.29).
 *
 * REPLACES TeamSettingsDialog, WHICH IS DELETED OUTRIGHT. That component
 * hosted CurrentTeamCard, MyTeamsCard and ScoringSystemCard behind a Tabs strip
 * inside a Dialog opened FROM INSIDE routes/app.tsx — and both of that dialog's
 * own affordances (CurrentTeamCard's Settings/Invite buttons) opened a SECOND
 * dialog on top of it. Functional (5jcn.17 verified the overlay order, focus
 * and Escape all behaved), but the owner's own words after using it: "the
 * dialog on top of a dialog is janky". A page fixes it for free — update-team
 * and invite-player (the latter rendered unconditionally by CurrentTeamCard
 * itself, unchanged) are now the only modal layer anywhere in team admin.
 *
 * A SIBLING TOP-LEVEL ROUTE, NOT NESTED UNDER /app IN THE ROUTE TREE, even
 * though the design doc this reverses called the rejected version "/app/team".
 * Verified empirically before choosing this shape: naming this file
 * `app.team.tsx` (or a directory `app/team.tsx` alongside the existing
 * `app.tsx`) makes the route GENERATOR itself register it as a CHILD of
 * `/app` (`getParentRoute: () => AppRoute` in the regenerated
 * routeTree.gen.ts) — TanStack's file convention nests on ANY shared path
 * prefix, regardless of dot-notation vs. directory. A child route only ever
 * renders through its parent's `<Outlet/>`, and routes/app.tsx's `Dashboard`
 * renders none — it IS the page, at every one of its renders, with no leaf
 * left for a nested child to occupy. Adding one would force splitting that
 * file into a thin layout plus an index route carrying everything it
 * currently does, entirely to keep a URL segment that buys nothing: the
 * owner asked for "another route", not for this one specifically nested
 * under that one. `/team` gets the exact same deep-linkable,
 * back-button-able, single-page outcome with no surgery on routes/app.tsx's
 * loader, its Suspense boundaries, or the comments pinned to its grid.
 *
 * OPEN TO ANY TEAM MEMBER, NOT OWNER-ONLY, matching the dashboard's own
 * "Team settings" button exactly (see routes/app.tsx — that control has never
 * been owner-gated): a member gets Leave on their own row and can view (but
 * not edit) the other two cards, an owner additionally gets every admin
 * control each card already gates internally. Gating the ROUTE itself to
 * owners would also have to explain what a member's "Team settings" click
 * should do instead, and there is no good answer.
 */
export const Route = createFileRoute('/team')({
  head: () => ({ meta: [{ title: pageTitle('Team Settings') }] }),
  validateSearch: (search: Record<string, unknown>): TeamSettingsSearch => ({
    team: typeof search.team === 'string' ? search.team : undefined,
  }),
  // Identical to routes/app.tsx's own guard, and for the same reason
  // (wt-ksh.5.1): every card this page hosts assumes a player row already
  // exists — CurrentTeamCard keys its own-row gating off `myPlayerId`, and
  // that read throws for an account with none.
  beforeLoad: async ({ context }) => {
    if (!context.isAuthenticated) throw redirect({ to: '/login' })
    const needsProfile = await context.queryClient.ensureQueryData(
      convexQuery(api.players.needsProfile, {}),
    )
    if (needsProfile) throw redirect({ to: '/complete-profile' })
  },
  /**
   * THE SAME THREE routes/app.tsx PREFETCHES, ISSUED TOGETHER FOR THE SAME
   * REASON (wordle-teams-dpi) — see that file's own comment for the measured
   * numbers, which apply here unchanged: this page needs the identical trio.
   * getMyTeams supplies the selected team's name/members/isOwner AND
   * MyTeamsCard's whole list; amIPro gates ScoringSystemCard's edit control;
   * getMyPlayerId is CurrentTeamCard's own-row gate.
   *
   * `getTeamMonth` IS DELIBERATELY NOT PREFETCHED HERE, matching how
   * routes/app.tsx treats that exact query for ScoresTable, TeamBoards and
   * TodayPanel (wordle-teams-9ahw): it is fetched lazily where
   * ScoringSystemCard uses it, behind its own local `<Suspense>` below, rather
   * than gating this whole route on a query only one of its three cards
   * needs.
   */
  loader: async ({ context }) => {
    const [teams] = await Promise.all([
      context.queryClient.ensureQueryData(convexQuery(api.teams.getMyTeams, {})),
      context.queryClient.ensureQueryData(convexQuery(api.teams.amIPro, {})),
      context.queryClient.ensureQueryData(convexQuery(api.scores.getMyPlayerId, {})),
    ])
    // Nothing to administer with no team at all — that empty state is /app's
    // own (TeamsEmptyState, gated the same way there), not a second copy here.
    if (teams.length === 0) throw redirect({ to: '/app' })

    /**
     * FIXED HERE, ONCE PER NAVIGATION — NOT READ FROM `new Date()` INSIDE THE
     * COMPONENT ON EVERY RENDER. This page carries no `?month=` of its own (it
     * always means "right now"; there is no month browsing control here the
     * way the dashboard's MonthPicker gives /app one), so there is nothing
     * else to pin `getTeamMonth`'s key to. routes/app.tsx's `currentMonth`
     * guards a client-clock read behind `hydrated` because that value ONLY
     * feeds display, while the URL's `monthParam` — resolved once, the same
     * way this loader value is — is what actually keys its queries. Reading
     * the clock reactively here instead would key ScoringSystemCard's query by
     * the SERVER's UTC "now" on the first SSR render and the CLIENT's local
     * "now" on the very next one — a real hydration-timing mismatch, not
     * merely a display flicker. Computing it once, in the loader, means the
     * same value ships in the dehydrated payload and is reused on the client
     * rather than recomputed, so there is nothing to disagree about.
     */
    return { month: monthOf(toPuzzleDay(new Date())) }
  },
  errorComponent: DashboardError,
  pendingComponent: TeamSettingsSkeleton,
  component: TeamSettingsPage,
})

function TeamSettingsPage() {
  const { team: teamParam } = Route.useSearch()
  const { month } = Route.useLoaderData()
  const navigate = useNavigate({ from: Route.fullPath })
  const { data: teams } = useSuspenseQuery(convexQuery(api.teams.getMyTeams, {}))
  const { data: isPro } = useSuspenseQuery(convexQuery(api.teams.amIPro, {}))
  const { data: myPlayerId } = useSuspenseQuery(convexQuery(api.scores.getMyPlayerId, {}))
  const [editOpen, setEditOpen] = useState(false)

  /**
   * FILLS IN OR CORRECTS `?team=`, THROUGH resolveTeamSettingsSearch (see that
   * function's own comment) rather than the fuller resolveDashboardSearch this
   * mirrors: this page has no `?month=` to also settle, so there is nothing
   * for the pair-shaped resolver to return once the team half is right.
   *
   * NO `hydrated` GUARD, UNLIKE useDashboardSearchSync. That hook waits on
   * hydration because its decision depends on the local CLOCK, which the
   * server cannot read — this one only depends on `localStorage`, which
   * `useEffect` already keeps off the server for free (effects do not run
   * during SSR), so there is no SSR/client disagreement to wait out.
   */
  useEffect(() => {
    const next = resolveTeamSettingsSearch({
      teamParam,
      teams,
      storedTeam: localStorage.getItem(STORAGE_KEY),
    })
    if (next) void navigate({ to: Route.fullPath, search: { team: next }, replace: true })
  }, [teamParam, teams, navigate])

  const selectedTeam = teams.find((team) => team.id === teamParam)

  // Mirrors routes/app.tsx's own guard: a stale, missing, or not-yet-corrected
  // `?team=` renders `selectedTeam` undefined for the few renders before the
  // effect above fixes the URL, and there is nothing well-defined to show
  // until then.
  if (!selectedTeam) {
    return (
      <main className="page-max mt-2 md:mt-6">
        <Skeleton className="h-96 w-full rounded-lg" />
      </main>
    )
  }

  return (
    <main className="page-max mt-2 flex flex-col gap-6 md:mt-6">
      <div className="flex items-center gap-2">
        <Button variant="ghost" size="icon" aria-label="Back to dashboard" asChild>
          <Link to="/app" search={{ team: teamParam }}>
            <ArrowLeft className="h-4 w-4" aria-hidden="true" />
          </Link>
        </Button>
        <h1 className="text-2xl font-bold">Team settings</h1>
      </div>
      <CurrentTeamCard
        teamId={selectedTeam.id}
        name={selectedTeam.name}
        members={selectedTeam.members}
        isOwner={selectedTeam.isOwner}
        myPlayerId={myPlayerId}
        onEditSettings={() => setEditOpen(true)}
        // Same repair app.tsx used to make from inside TeamSettingsDialog:
        // leaving the selected team leaves `?team=` on THIS page pointing at
        // a team the caller is no longer on, so send them back to /app with
        // empty search and let its own sync effect pick a live one.
        onLeft={() => {
          localStorage.removeItem(STORAGE_KEY)
          void navigate({ to: '/app', search: {} })
        }}
      />
      <MyTeamsCard
        teams={teams}
        // Deleting the SELECTED team (the one this page is showing) leaves
        // `?team=` pointing at a gone id, same repair as onLeft above.
        // Deleting any OTHER team from this list is a no-op here — the list
        // itself updates reactively and there is nothing else to fix.
        onDeleted={(deleted) => {
          if (deleted !== teamParam) return
          localStorage.removeItem(STORAGE_KEY)
          void navigate({ to: '/app', search: {} })
        }}
      />
      {/*
        `id="scoring"` IS THE SCORING DEEP LINK'S WHOLE MECHANISM
        (wordle-teams-5jcn.29). routes/app.tsx's ScoringLegend "Edit" control
        navigates here with `hash: 'scoring'`; TanStack Router's scroll
        restoration calls `document.getElementById(hash)?.scrollIntoView(...)`
        by default (`defaultHashScrollIntoView`, unset here and true) once the
        navigation settles, with no wiring needed on this end beyond the id
        existing. AN ANCHOR, NOT A ROUTE OR SEARCH PARAM, because this page has
        no tabs left to switch between — CurrentTeamCard, MyTeamsCard and
        ScoringSystemCard are three plain, always-mounted Cards stacked on one
        page (the fix for wordle-teams-5jcn.16's nested dialog+Card chrome and
        redundant tab-label/heading pairs), not panels behind a strip that
        hides the other two. A route or search param would be answering "which
        panel is active" — a question this page no longer asks.
        THE `id` SITS ON THIS WRAPPER, NOT INSIDE THE `<Suspense>` BELOW,
        DELIBERATELY: it has to exist the instant this component commits, not
        only once ScoringSystemCard's own query resolves, or a fast scroll
        attempt would find nothing yet to scroll to.
      */}
      <div id="scoring">
        {/*
          KEPT, NOT DROPPED — components/teams/team-settings-dialog.tsx
          (deleted) wrapped this same component in a `<Suspense>` because
          Radix's Tabs never mounted an inactive tab's content, so
          ScoringSystemCard mounted only on first switch to the Scoring tab
          rather than on open. THAT REASON
          IS GONE — there are no tabs here, so ScoringSystemCard mounts the
          instant this page does. But the boundary is still needed for the
          reason routes/app.tsx's OWN three getTeamMonth consumers keep theirs
          (wordle-teams-9ahw): this route's loader deliberately does not
          prefetch `getTeamMonth` (see the loader's own comment), so
          ScoringSystemCard's `useSuspenseQuery` for it can still be in flight
          after CurrentTeamCard and MyTeamsCard above have already painted.
          Dropping this would suspend the WHOLE page — including the two cards
          that have nothing to do with this query — back to `TeamSettingsSkeleton`
          on every mount.
        */}
        <Suspense fallback={<ScoringSystemCardSkeleton />}>
          <ScoringSystemCard
            teamId={selectedTeam.id}
            month={month}
            isPro={isPro}
            isOwner={selectedTeam.isOwner}
          />
        </Suspense>
      </div>
      <UpdateTeamDialog open={editOpen} onOpenChange={setEditOpen} team={selectedTeam} />
    </main>
  )
}
