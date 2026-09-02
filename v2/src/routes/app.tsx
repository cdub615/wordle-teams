import { createFileRoute, redirect, useNavigate } from '@tanstack/react-router'
import { Suspense } from 'react'
import { convexQuery } from '@convex-dev/react-query'
import { useSuspenseQuery } from '@tanstack/react-query'
import { useEffect, useState } from 'react'
import { api } from '../../convex/_generated/api'
import { pageTitle } from '#/lib/seo'
import { SIGNIN_PARAM, trackFunnel } from '#/lib/funnel.ts'
import { useHydrated } from '#/lib/use-hydrated.ts'
import { useDashboardSearchSync } from '#/lib/use-dashboard-search-sync.ts'
import { STORAGE_KEY } from '#/lib/dashboard-search.ts'
import { useStartUpgrade } from '#/lib/use-start-upgrade.ts'
import { CheckoutPending, useCheckoutReturn } from '#/components/checkout-return.tsx'
import { MonthPicker, monthOptions } from '#/components/month-picker.tsx'
import { TeamPicker } from '#/components/team-picker.tsx'
import { CreateTeamDialog } from '#/components/teams/create-team-dialog.tsx'
import { TeamsEmptyState } from '#/components/teams/empty-state.tsx'
import { CurrentTeamCard } from '#/components/teams/current-team-card.tsx'
import { MyTeamsCard } from '#/components/teams/my-teams-card.tsx'
import { ScoringSystemCard } from '#/components/scoring-system-card.tsx'
import { UpdateTeamDialog } from '#/components/teams/update-team-dialog.tsx'
import { ScoresTable } from '#/components/scores-table.tsx'
import { TeamBoards } from '#/components/teams/team-boards.tsx'
import { MonthlyWinnerCelebration } from '#/components/monthly-winner-celebration.tsx'
import { BoardEntryButton } from '#/components/board-entry/button.tsx'
import { DashboardError } from '#/components/dashboard-error.tsx'
import { Skeleton } from '#/components/ui/skeleton.tsx'
import {
  DashboardSkeleton,
  ScoresTableSkeleton,
  ScoringSystemCardSkeleton,
  TeamBoardsSkeleton,
} from '#/components/dashboard-skeletons.tsx'
import { monthOf, toPuzzleDay } from '../../convex/lib/puzzleDay.ts'
import type { Id } from '../../convex/_generated/dataModel'

type DashboardSearch = { team?: string; month?: string }

export const Route = createFileRoute('/app')({
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
  beforeLoad: async ({ context }) => {
    if (!context.isAuthenticated) throw redirect({ to: '/login' })
    // Every dashboard query assumes a player exists. Before Phase 4 a cold
    // signup reached this page anyway — getMyTeams returns [] rather than
    // throwing — pressed the one call to action, and got NO_PLAYER, which until
    // Task 4 rendered as "Your session expired": the wrong cause, and one
    // signing in again could not fix. See wt-ksh.5.1.
    const needsProfile = await context.queryClient.ensureQueryData(
      convexQuery(api.players.needsProfile, {}),
    )
    if (needsProfile) throw redirect({ to: '/complete-profile' })
  },
  /**
   * ISSUED TOGETHER, NOT IN SEQUENCE (`wordle-teams-dpi`). The three are
   * independent of one another, so awaiting them one at a time made the SSR of
   * the dashboard pay the SUM of three round-trips where it can pay the MAX.
   * This is on the path every OTP sign-in and every OAuth callback takes, which
   * is why it was the slowest navigation in the app.
   *
   * MEASURED against the local backend on 2026-09-02 — three runs each way,
   * twelve document requests per run, one warm-up discarded, timing the
   * document response alone rather than hydration:
   *
   *   sequential   medians 156, 133, 140 ms   (min 120-134)
   *   Promise.all  medians 109, 112, 111 ms   (min  99-106)
   *
   * So roughly 140ms to 111ms, about a fifth. Modest, and worth stating as such
   * rather than overselling it: three round-trips to a LOCAL backend are cheap,
   * and the win is proportionally larger wherever the backend is further away
   * than localhost — which is every real deployment.
   *
   * NOT PREFETCHED IN `beforeLoad` INSTEAD. `needsProfile` has to be awaited
   * alone up there, because its whole purpose is to decide whether this route
   * renders at all — starting these three beside it would issue three queries
   * for a page that is about to 307 to /complete-profile.
   *
   * `__root.tsx` has a comment explaining why the Header's two queries are
   * deliberately NOT prefetched. That reasoning is about `useQuery` versus
   * `useSuspenseQuery` and does not apply here: these three feed
   * `useSuspenseQuery`, so the component suspends on them whether or not the
   * loader warmed them, and warming them in parallel is strictly better.
   */
  loader: async ({ context }) => {
    await Promise.all([
      context.queryClient.ensureQueryData(convexQuery(api.teams.getMyTeams, {})),
      context.queryClient.ensureQueryData(convexQuery(api.teams.amIPro, {})),
      context.queryClient.ensureQueryData(convexQuery(api.scores.getMyPlayerId, {})),
    ])
  },
  errorComponent: DashboardError,
  /**
   * v1's `src/app/me/loading.tsx`, which v2 never ported (wordle-teams-9ahw).
   *
   * COVERS THE NAVIGATION INTO /app, NOT A TEAM OR MONTH SWITCH — the two are
   * different moments and both needed fixing. The loader above prefetches
   * getMyTeams, amIPro and getMyPlayerId, none of which depend on team or
   * month, so it does NOT re-run when either changes; that case is handled by
   * the Suspense boundaries in the component below.
   */
  pendingComponent: DashboardSkeleton,
  component: Dashboard,
})

function Dashboard() {
  const { team: teamParam, month: monthParam } = Route.useSearch()
  const navigate = useNavigate({ from: Route.fullPath })
  const hydrated = useHydrated()
  const { data: teams } = useSuspenseQuery(convexQuery(api.teams.getMyTeams, {}))
  const { data: isPro } = useSuspenseQuery(convexQuery(api.teams.amIPro, {}))
  const { data: myPlayerId } = useSuspenseQuery(convexQuery(api.scores.getMyPlayerId, {}))
  const [createOpen, setCreateOpen] = useState(false)
  const [settingsOpen, setSettingsOpen] = useState(false)
  /**
   * team-picker.tsx's "Upgrade for more", gated on `atFreeLimit`.
   *
   * NO LONGER THE ONLY ENTRY POINT, AND NO LONGER THE ONLY COPY OF THIS LOGIC.
   * wordle-teams-6tp: a free player holding ONE team could not reach checkout
   * at all, so Header.tsx now offers the same action unconditionally. The body
   * that used to sit here — the outcome branching, the full-page navigation and
   * the two distinct failures — moved to lib/use-start-upgrade.ts whole, so
   * both callers share one, and its doc comment carries every reason.
   *
   * `pending` IS DELIBERATELY DROPPED HERE. A DropdownMenu closes on select, so
   * there is no control left on screen for a spinner to sit in; the header's
   * button, which stays put, uses it.
   */
  const { startUpgrade } = useStartUpgrade()

  /**
   * The return leg from checkout (wordle-teams-wxg, decision L).
   *
   * DECLARED BEFORE useDashboardSearchSync, WHICH IS NOT COSMETIC: effects run
   * in the order their hooks are called, and the sync effect navigates —
   * rewriting the URL to `?team=&month=` and dropping every param it does not
   * know about, `checkout` included. Reading the marker after that would find
   * it gone on the load it matters for.
   *
   * `&& !isPro` IS THE WHOLE OF THE RESOLUTION. amIPro is a reactive Convex
   * subscription, so the webhook patching playerMembership turns isPro true,
   * which turns this false and takes the notice away with no reload, no
   * refetch and no timer — see components/checkout-return.tsx. If the webhook
   * got there first, isPro is already true on arrival and nothing is shown at
   * all, which is correct: the upgrade is not pending.
   */
  const upgradePending = useCheckoutReturn() && !isPro

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

  useDashboardSearchSync({
    teamParam,
    monthParam,
    teams,
    navigate: (search) => void navigate({ to: Route.fullPath, search, replace: true }),
  })

  // ALL THREE RETURNS BELOW RENDER THE PENDING NOTICE, and the empty state is
  // the one wordle-teams-6tn actually named: someone can upgrade before they
  // have created a single team, and that is the case where they would
  // otherwise be looking at a page with nothing on it that acknowledges the
  // payment they just made. The skeleton branch matters too — it is what every
  // load shows until useDashboardSearchSync fills the params in.
  if (teams.length === 0) {
    return (
      <main className="page-max p-2 md:p-12">
        {upgradePending && <CheckoutPending className="mb-4" />}
        <TeamsEmptyState onCreate={() => setCreateOpen(true)} />
        <CreateTeamDialog
          open={createOpen}
          onOpenChange={setCreateOpen}
          onCreated={(team) => navigate({ to: Route.fullPath, search: { team }, replace: true })}
        />
      </main>
    )
  }

  // Until the effect above resolves both params there is nothing well-defined to
  // render, and rendering a guess is what causes the mismatch.
  if (!teamParam || !monthParam) {
    return (
      <main className="page-max p-2 md:p-12">
        {upgradePending && <CheckoutPending className="mb-4" />}
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
  const selectedTeam = teams.find((team) => team.id === teamParam)

  return (
    // grid-cols-1 (mobile) is load-bearing, not decorative: Tailwind's
    // grid-cols-N emits `repeat(N, minmax(0,1fr))`, which caps a track's max
    // sizing at the AVAILABLE space. Without any grid-cols-* at the base
    // breakpoint, the single implicit column falls back to `auto`, whose max
    // sizing function is max-content — and max-content for wrapped OR nowrap
    // text is the same single-line width either way. A long team name (this
    // card's own CurrentTeamCard heading, or MyTeamsCard's row below) then
    // grows that one column, and every sibling on the page along with it,
    // producing a page-wide horizontal scrollbar with everything below the
    // header pushed edge-to-edge.
    <main className="page-max mb-12 grid grid-cols-1 gap-2 p-2 md:grid-cols-3 md:gap-6 md:p-12">
      {upgradePending && <CheckoutPending className="md:col-span-3" />}
      <CreateTeamDialog
        open={createOpen}
        onOpenChange={setCreateOpen}
        onCreated={(team) => navigate({ to: Route.fullPath, search: { team, month: monthParam } })}
      />
      {/* v1 mounts this at the top of the same grid, and only on the branch
          that has teams (src/app/me/page.tsx:58). It renders no element of its
          own — a Radix Dialog Root is not a DOM node — so its position here is
          about WHEN it mounts, not where it lands. It reads last month's winner
          for the SELECTED team, which is v1's behaviour too. */}
      <MonthlyWinnerCelebration teamId={teamParam as Id<'teams'>} />
      <div className="flex items-center gap-2 md:col-span-3">
        <TeamPicker
          teams={teams}
          value={teamParam}
          isPro={isPro}
          onChange={(team) => navigate({ to: Route.fullPath, search: { team, month: monthParam } })}
          onCreate={() => setCreateOpen(true)}
          onUpgrade={() => void startUpgrade()}
        />
        <MonthPicker
          currentMonth={currentMonth}
          value={monthParam}
          onChange={(month) => navigate({ to: Route.fullPath, search: { team: teamParam, month } })}
        />
        <div className="ml-auto">
          <BoardEntryButton teamId={teamParam as Id<'teams'>} month={monthParam} />
        </div>
      </div>
      {/*
        THE BOUNDARY IS WHY THE GRID NO LONGER BLANKS (wordle-teams-9ahw).
        This component, TeamBoards below it and ScoringSystemCard further down
        all `useSuspenseQuery(api.scores.getTeamMonth, { teamId, month })`, so
        every team or month change re-keys all three at once and suspends them
        together. With no boundary here the suspension bubbled past the route —
        router.tsx sets no defaultPendingComponent either — and unmounted the
        whole grid.

        ONE BOUNDARY PER COMPONENT RATHER THAN ONE AROUND ALL THREE, so a panel
        that resolves early is not held back by its neighbours, and so each
        fallback can be the shape of the thing it replaces rather than a
        generic block.

        THE FALLBACK CARRIES THE SAME `className` AS THE COMPONENT. Dropping it
        would collapse the grid on every switch and shove it back on arrival,
        which is the reported problem with extra steps.
      */}
      <Suspense
        fallback={
          // `rows` COMES FROM ALREADY-RESOLVED DATA, which is what makes the
          // fallback the right HEIGHT rather than a guess: team membership is
          // api.teams.getMyTeams, which does not suspend on a team or month
          // change, so the member count is known before the table's own query
          // has answered. v1's skeleton draws three rows for every team.
          <ScoresTableSkeleton
            month={monthParam}
            rows={selectedTeam?.members.length}
            className="md:col-span-3"
          />
        }
      >
        <ScoresTable teamId={teamParam as Id<'teams'>} month={monthParam} className="md:col-span-3" />
      </Suspense>
      {/* Column 1, three rows deep, immediately under the scores table — the
          slot v1 gives it (src/app/me/page.tsx, `md:row-span-3`). Outside the
          `selectedTeam &&` block below because it reads the team it needs from
          scores.getTeamMonth itself, the same already-cached query the table
          above suspends on. */}
      <Suspense fallback={<TeamBoardsSkeleton className="md:row-span-3" />}>
        {/*
          `months` AND `onMonthChange` MAKE THE DAY PICKER REACH PAST THE LOADED
          MONTH (wordle-teams-5vv3). It was clamped to the month on screen, so
          viewing an earlier day meant going up to the dropdown first. The SAME
          array the MonthPicker above is driven by bounds it, so the two
          controls offer exactly the same months and widen together when the pro
          expansion lands.
        */}
        <TeamBoards
          teamId={teamParam as Id<'teams'>}
          month={monthParam}
          months={monthOptions(currentMonth)}
          onMonthChange={(month) =>
            navigate({
              to: Route.fullPath,
              search: { team: teamParam, month },
              // KEEP THE VIEWER WHERE THEY ARE (wordle-teams-rpql). This panel
              // sits far down the grid, so on a phone crossing a month from its
              // picker or its arrows threw the reader to the top of the page
              // and made them scroll back to the board they had just asked for.
              //
              // MEASURED AT THE MECHANISM, BECAUSE NO E2E HERE COULD PIN IT.
              // With `window.scrollTo` intercepted from an init script, driving
              // the picker across a month boundary at 390x844:
              //
              //   without this flag   window.scrollTo({top:0}) fires from
              //                       scroll-restoration.js:180, final scrollY 0
              //   with it             no such call at all,      final scrollY 90
              //
              // THE E2E FOR THIS WAS WRITTEN, FOUND NOT TO DISCRIMINATE, AND
              // DELETED RATHER THAN LEFT LOOKING LIKE COVERAGE. Two things
              // defeat it, both about the harness and neither about the app:
              // Playwright scrolls a target into view before clicking it, and
              // anything positioned near the top of the viewport is judged
              // obscured by `header`'s `sticky top-0 z-50` and moved — so the
              // before/after positions the test wants to compare are the
              // harness's own, not the reader's. Several shapes of the test
              // passed against the broken code. If you reach for one again,
              // intercept the scroll API rather than sampling `window.scrollY`.
              //
              // NOT SET ON THE TeamPicker/MonthPicker NAVIGATIONS ABOVE, which
              // is a deliberate asymmetry rather than an oversight: those
              // controls sit at the top of the grid and can only be operated
              // from there, so resetting scroll costs nothing and the default
              // is what every other navigation in the app does.
              resetScroll: false,
            })
          }
          className="md:row-span-3"
        />
      </Suspense>
      {selectedTeam && (
        <>
          {/* Every member renders, including the caller's own row — see
              current-team-card.tsx's doc comment. The owner cannot be
              removed — removeMember refuses it server-side — so the card
              gates the remove control on `isOwner && member.id !==
              myPlayerId` rather than filtering the row out. */}
          <CurrentTeamCard
            teamId={selectedTeam.id}
            name={selectedTeam.name}
            members={selectedTeam.members}
            isOwner={selectedTeam.isOwner}
            myPlayerId={myPlayerId}
            onEditSettings={() => setSettingsOpen(true)}
            // Leaving the selected team leaves ?team= pointing at a team you
            // are no longer on — the same broken-param problem deleting one
            // has, so this is MyTeamsCard's onDeleted handler below, minus its
            // `deleted !== teamParam` guard: this card only ever renders the
            // selected team, so there is no other team it could have been.
            onLeft={() => {
              localStorage.removeItem(STORAGE_KEY)
              void navigate({ to: Route.fullPath, search: {}, replace: true })
            }}
          />
          <UpdateTeamDialog open={settingsOpen} onOpenChange={setSettingsOpen} team={selectedTeam} />
          {/* The third getTeamMonth consumer — see the boundary above. */}
          <Suspense fallback={<ScoringSystemCardSkeleton />}>
            <ScoringSystemCard
              teamId={teamParam as Id<'teams'>}
              month={monthParam}
              isPro={isPro}
              isOwner={selectedTeam.isOwner}
            />
          </Suspense>
        </>
      )}
      {/* Deleting the team you were looking at leaves ?team= pointing at a gone
          id. onDeleted clears both the param and the remembered team so the
          sync hook picks the first remaining team instead of the error
          boundary. */}
      <MyTeamsCard
        teams={teams}
        onDeleted={(deleted) => {
          if (deleted !== teamParam) return
          localStorage.removeItem(STORAGE_KEY)
          void navigate({ to: Route.fullPath, search: {}, replace: true })
        }}
      />
    </main>
  )
}
