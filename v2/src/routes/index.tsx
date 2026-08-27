import { createFileRoute, redirect, useNavigate } from '@tanstack/react-router'
import { convexQuery, useConvexAction } from '@convex-dev/react-query'
import { useSuspenseQuery } from '@tanstack/react-query'
import { useEffect, useState } from 'react'
import { toast } from 'sonner'
import { api } from '../../convex/_generated/api'
import { pageTitle } from '#/lib/seo'
import { SIGNIN_PARAM, trackFunnel } from '#/lib/funnel.ts'
import { useHydrated } from '#/lib/use-hydrated.ts'
import { useDashboardSearchSync } from '#/lib/use-dashboard-search-sync.ts'
import { STORAGE_KEY } from '#/lib/dashboard-search.ts'
import { CHECKOUT_FAILED, checkoutOutcome } from '#/lib/billing-copy.ts'
import { mutationErrorMessage } from '#/lib/convex-error.ts'
import { CheckoutPending, useCheckoutReturn } from '#/components/checkout-return.tsx'
import { MonthPicker } from '#/components/month-picker.tsx'
import { TeamPicker } from '#/components/team-picker.tsx'
import { CreateTeamDialog } from '#/components/teams/create-team-dialog.tsx'
import { TeamsEmptyState } from '#/components/teams/empty-state.tsx'
import { CurrentTeamCard } from '#/components/teams/current-team-card.tsx'
import { MyTeamsCard } from '#/components/teams/my-teams-card.tsx'
import { ScoringSystemCard } from '#/components/scoring-system-card.tsx'
import { UpdateTeamDialog } from '#/components/teams/update-team-dialog.tsx'
import { ScoresTable } from '#/components/scores-table.tsx'
import { BoardEntryButton } from '#/components/board-entry/button.tsx'
import { DashboardError } from '#/components/dashboard-error.tsx'
import { Skeleton } from '#/components/ui/skeleton.tsx'
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
  loader: async ({ context }) => {
    await context.queryClient.ensureQueryData(convexQuery(api.teams.getMyTeams, {}))
    await context.queryClient.ensureQueryData(convexQuery(api.teams.amIPro, {}))
    await context.queryClient.ensureQueryData(convexQuery(api.scores.getMyPlayerId, {}))
  },
  errorComponent: DashboardError,
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
  const createCheckout = useConvexAction(api.polar.createProCheckout)

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

  /**
   * The upgrade path, behind team-picker.tsx's existing "Upgrade for more".
   *
   * ONE ENTRY POINT, NOT A SECOND BUTTON. The CTA is already there, gated on
   * `atFreeLimit`; wiring it is the whole change. v1's three upgrade buttons
   * are identical to each other and take no plan, because the customer chooses
   * monthly or annual on Polar's hosted page — proProductIds passes both.
   *
   * A FULL-PAGE NAVIGATION, NOT the router: the URL is on polar.sh, and
   * `navigate` only knows this app's routes.
   *
   * A URL-LESS CheckoutResult IS THE ONLY FAILURE SHAPE createProCheckout HAS —
   * it catches its own Polar errors, and an unset SITE_URL with them, since
   * that read is inside its `try` — so the catch below is for the transport or
   * for the identity query throwing before the action could answer at all. Both
   * must say something; a dead menu item is indistinguishable from a broken one.
   *
   * AND THE TWO FAILURES IT REPORTS ARE NOT THE SAME FAILURE, which is why this
   * asks billing-copy.ts rather than testing for a URL. `not-configured` cannot
   * be retried into working, so it must not be shown the sentence that says to
   * try — see checkoutOutcome, and wordle-teams-9fm, where this treated every
   * cause alike.
   */
  const startUpgrade = async () => {
    try {
      const outcome = checkoutOutcome(await createCheckout({}))
      if (outcome.action === 'navigate') {
        window.location.href = outcome.url
        return
      }
      // Header.tsx's portal does the same thing with the same reasoning: the
      // level is chosen in billing-copy.ts, where a test can see it.
      toast[outcome.level](outcome.message)
    } catch (error) {
      toast.error(mutationErrorMessage(error, CHECKOUT_FAILED))
    }
  }

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
    navigate: (search) => void navigate({ to: '/', search, replace: true }),
  })

  // ALL THREE RETURNS BELOW RENDER THE PENDING NOTICE, and the empty state is
  // the one wordle-teams-6tn actually named: someone can upgrade before they
  // have created a single team, and that is the case where they would
  // otherwise be looking at a page with nothing on it that acknowledges the
  // payment they just made. The skeleton branch matters too — it is what every
  // load shows until useDashboardSearchSync fills the params in.
  if (teams.length === 0) {
    return (
      <main className="p-2 md:p-12">
        {upgradePending && <CheckoutPending className="mb-4" />}
        <TeamsEmptyState onCreate={() => setCreateOpen(true)} />
        <CreateTeamDialog
          open={createOpen}
          onOpenChange={setCreateOpen}
          onCreated={(team) => navigate({ to: '/', search: { team }, replace: true })}
        />
      </main>
    )
  }

  // Until the effect above resolves both params there is nothing well-defined to
  // render, and rendering a guess is what causes the mismatch.
  if (!teamParam || !monthParam) {
    return (
      <main className="p-2 md:p-12">
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
    <main className="mb-12 grid grid-cols-1 gap-2 p-2 md:grid-cols-3 md:gap-6 md:p-12">
      {upgradePending && <CheckoutPending className="md:col-span-3" />}
      <CreateTeamDialog
        open={createOpen}
        onOpenChange={setCreateOpen}
        onCreated={(team) => navigate({ to: '/', search: { team, month: monthParam } })}
      />
      <div className="flex items-center gap-2 md:col-span-3">
        <TeamPicker
          teams={teams}
          value={teamParam}
          isPro={isPro}
          onChange={(team) => navigate({ to: '/', search: { team, month: monthParam } })}
          onCreate={() => setCreateOpen(true)}
          onUpgrade={() => void startUpgrade()}
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
              void navigate({ to: '/', search: {}, replace: true })
            }}
          />
          <UpdateTeamDialog open={settingsOpen} onOpenChange={setSettingsOpen} team={selectedTeam} />
          <ScoringSystemCard
            teamId={teamParam as Id<'teams'>}
            month={monthParam}
            isPro={isPro}
            isOwner={selectedTeam.isOwner}
          />
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
          void navigate({ to: '/', search: {}, replace: true })
        }}
      />
    </main>
  )
}
