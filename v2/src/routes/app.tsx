import { createFileRoute, redirect, useNavigate, Link } from '@tanstack/react-router'
import { Settings } from 'lucide-react'
import { Suspense } from 'react'
import { convexQuery } from '@convex-dev/react-query'
import { useSuspenseQuery } from '@tanstack/react-query'
import { useEffect, useState } from 'react'
import { api } from '../../convex/_generated/api'
import { pageTitle } from '#/lib/seo'
import { SIGNIN_PARAM, trackFunnel } from '#/lib/funnel.ts'
import { useHydrated } from '#/lib/use-hydrated.ts'
import { useDashboardSearchSync } from '#/lib/use-dashboard-search-sync.ts'
import { useStartUpgrade } from '#/lib/use-start-upgrade.ts'
import { CheckoutPending, useCheckoutReturn } from '#/components/checkout-return.tsx'
import { MonthPicker, monthOptions } from '#/components/month-picker.tsx'
import { TeamPicker } from '#/components/team-picker.tsx'
import { CreateTeamDialog } from '#/components/teams/create-team-dialog.tsx'
import { TeamsEmptyState } from '#/components/teams/empty-state.tsx'
import { ScoresTable } from '#/components/scores-table.tsx'
import { TeamBoards } from '#/components/teams/team-boards.tsx'
import { TodayPanel } from '#/components/today-panel.tsx'
import { ScoringLegend } from '#/components/scoring-legend.tsx'
import { MonthlyWinnerCelebration } from '#/components/monthly-winner-celebration.tsx'
import { BoardEntryButton } from '#/components/board-entry/button.tsx'
import { DashboardError } from '#/components/dashboard-error.tsx'
import { Button } from '#/components/ui/button.tsx'
import { Skeleton } from '#/components/ui/skeleton.tsx'
import {
  DashboardSkeleton,
  ScoresTableSkeleton,
  TeamBoardsSkeleton,
  TodayPanelSkeleton,
  ScoringLegendSkeleton,
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
      <main className="page-max mt-2 md:mt-6">
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
      <main className="page-max mt-2 md:mt-6">
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
    // text is the same single-line width either way. A long team name (the
    // TeamPicker trigger's own label, below) then grows that one column, and
    // every sibling on the page along with it, producing a page-wide
    // horizontal scrollbar with everything below the header pushed
    // edge-to-edge.
    // SPACING MATCHES THE GRID'S OWN `gap`, WHICH IS THE POINT: `gap-2` below
    // `md` and `gap-6` above it, so the space above the first row and outside
    // the first and last columns is the same as the space between them. It read
    // as arbitrary before — `p-2 md:p-12`, where 48px of desktop padding
    // matched nothing.
    //
    // HORIZONTAL IS PADDING, VERTICAL IS MARGIN, AND THAT IS NOT A STYLE
    // CHOICE. `.page-max` sets `margin-inline: auto` and is UNLAYERED, while
    // Tailwind's utilities live in `@layer utilities` — unlayered CSS beats
    // every layered rule whatever its specificity, so an `mx-*` here would be
    // silently overridden and the gutter would simply not appear. Padding sits
    // inside `max-width` under the global `box-sizing: border-box`, so it
    // insets the content without shrinking the 1440 cap. `mt-*` is unaffected,
    // since page-max touches only the inline axis.
    //
    // THE HORIZONTAL GUTTER IS `.page-max`'S OWN, not a class here, and it
    // follows the same rule the top margin does: it matches the gap — 0.5rem
    // against `gap-2`, 1.5rem against `md:gap-6`, then nothing once the cap
    // alone provides it. See its note in styles.css, including why it is three
    // plain declarations rather than `px-2 md:px-6 wide:px-0`: a custom
    // Tailwind breakpoint emitted the drop BEFORE `md` in the sheet, so it
    // silently never applied.
    //
    // `md:grid-cols-3` IS CURRENTLY VESTIGIAL, AND THAT IS KNOWN. Since Task 9
    // moved the admin cards off this grid — first into TeamSettingsDialog,
    // then (wordle-teams-5jcn.29) onto their own page, routes/team.tsx — every
    // child rendered here carries `md:col-span-3` — the controls row,
    // TodayPanel, ScoresTable
    // (ScoringLegend now rides inside it, as its `footer` prop, rather than
    // being a grid child of its own — wordle-teams-ha7u), TeamBoards — so
    // nothing occupies fewer than all three columns any more, and at `md` and
    // above this produces the same layout a
    // plain vertical stack would. It stays a grid rather than becoming
    // `flex flex-col` anyway: the `grid-cols-1` base-breakpoint behaviour above
    // is load-bearing (see that note) — reasoned from Tailwind's emitted CSS
    // rather than measured, unlike the rpql numbers below — and relies on Grid track
    // sizing specifically, with no flexbox equivalent. A future multi-column
    // widget is what would make the three columns earn their keep again.
    <main className="page-max mb-12 mt-2 grid grid-cols-1 gap-2 md:mt-6 md:grid-cols-3 md:gap-6">
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
        {/* Gated on `selectedTeam`, matching the convention every other
            selectedTeam-dependent block in this file uses: a stale or invalid
            `?team=` renders `selectedTeam` undefined for the renders before
            useDashboardSearchSync's post-hydration effect corrects it, and
            there is no team yet to hand `/team` a valid `?team=` for.
            Rendering this control unconditionally would leave it on screen,
            clickable, navigating to a page with nothing to show. */}
        {selectedTeam && (
          // NO `size` PROP, WHICH IS THE FIX FOR wordle-teams-5jcn.22 (1 of 2):
          // this used to be `size="sm"` (h-9), a half-step shorter than
          // TeamPicker's and MonthPicker's Buttons beside it, both `size`-less
          // and so `h-10` (buttonVariants' default). Matching their height
          // means matching their size, not picking a new one.
          //
          // ICON-ONLY BELOW `sm`, THE SAME COLLAPSE Header.tsx's "Upgrade"
          // button USES (wordle-teams-5jcn.22, 2 of 2) — `aria-label` fixes
          // the accessible name regardless of what is visibly rendered, so it
          // stays exactly "Team settings" whether the label is on screen or
          // not; the icon carries no text of its own (`aria-hidden`). Before
          // this, a third control plus BoardEntryButton made the row wider
          // than a 390px viewport — `billing.spec.ts`'s
          // `scrollWidth - clientWidth` measured 64px of overflow — and this
          // is the one row control whose label was free to shrink: the
          // pickers' truncation is already tuned to their own content (see
          // TeamPicker's `label`), and BoardEntryButton is the page's primary
          // call to action, not a candidate for shrinking further.
          //
          // A REAL NAVIGATION NOW (wordle-teams-5jcn.29), NOT `onClick` STATE.
          // This used to open TeamSettingsDialog directly; it now renders as a
          // `<Link>` styled as this same Button (`asChild`, the pattern
          // login-error.tsx's "Head to Sign In" button also uses) so that a
          // real user gets a real anchor — middle-click, "open in new tab" and
          // `defaultPreload: 'intent'`'s hover-prefetch all keep working, none
          // of which an onClick handler gives for free.
          // `text-foreground` IS LOAD-BEARING, NOT DECORATION. Rendering this
          // as an anchor puts it in reach of styles.css's prose-link rule,
          // `a:where(:not([role]))`, which paints an unroled anchor
          // --accent-solid (green). That rule is deliberately weak — the
          // `:where()` keeps it at (0,0,1) precisely so any text-colour
          // utility beats it — but `buttonVariants`' `outline` sets NO resting
          // text colour, only `hover:text-accent-foreground`, so on a <button>
          // it simply inherits and on an <a> there was nothing to win. Naming
          // the colour restores the same --text the sibling pickers inherit.
          // Do NOT "fix" this by adding role="button": it is a navigation, the
          // anchor is correct, and the e2e locates it by its link role.
          <Button
            variant="outline"
            aria-label="Team settings"
            className="px-2 text-foreground sm:px-4"
            asChild
          >
            <Link to="/team" search={{ team: teamParam }}>
              <Settings className="h-4 w-4" aria-hidden="true" />
              <span className="hidden sm:inline">Team settings</span>
            </Link>
          </Button>
        )}
        <div className="ml-auto">
          <BoardEntryButton teamId={teamParam as Id<'teams'>} month={monthParam} />
        </div>
      </div>
      {/*
        THE BOUNDARY IS WHY THE GRID NO LONGER BLANKS (wordle-teams-9ahw).
        ScoresTable (whose `footer` prop renders ScoringLegend, folded in
        rather than left as its own detached strip — wordle-teams-ha7u),
        TeamBoards and TodayPanel all `useSuspenseQuery(api.scores.getTeamMonth,
        { teamId, month })`, so every team or month change re-keys all three at
        once — four call sites sharing three boundaries — and suspends them
        together. With no boundary here the suspension bubbled past the route —
        router.tsx sets no defaultPendingComponent either — and unmounted the
        whole grid.

        ONE BOUNDARY PER TOP-LEVEL COMPONENT RATHER THAN ONE AROUND ALL THREE,
        so each fallback can be the shape of the thing it replaces rather than
        a generic block. ScoringLegend does not get a fourth boundary of its
        own: its loading state is ScoresTableSkeleton's own `footer` prop
        (ScoringLegendSkeleton), which resolves in the same pass as the rest of
        that fallback rather than independently. NOT because one panel could
        resolve ahead of its neighbours — it cannot: all four call sites pass
        `convexQuery` the identical function and args, which TanStack Query
        hashes to the SAME cache key (`@convex-dev/react-query`'s `hashFn`,
        `` `convexQuery|${fn}|${JSON.stringify(args)}` ``), so they share one
        query, one fetch and one promise and resolve in the same pass, always.

        THE FALLBACK CARRIES THE SAME `className` AS THE COMPONENT, AND
        ScoresTableSkeleton's `footer` CARRIES ScoringLegendSkeleton THE SAME
        WAY ScoresTable's carries ScoringLegend. Dropping either would
        collapse the grid — or just the table card's footer region — on every
        switch and shove it back on arrival, which is the reported problem
        with extra steps.

        ScoringSystemCard reads the SAME QUERY too, but it is no longer part of
        this grid (Task 9): it lives on routes/team.tsx now (wordle-teams-5jcn.29,
        by way of TeamSettingsDialog in between), which gives it its own
        Suspense boundary there rather than sharing one of these.
      */}
      {/* Above the table because it answers a different clock's question --
          "did I play today" is a today question the grid answers badly, by
          asking you to locate a cell. It renders NOTHING when the viewed month
          does not contain today, so the grid closes up on a past month. */}
      <Suspense fallback={<TodayPanelSkeleton className="md:col-span-3" />}>
        <TodayPanel
          teamId={teamParam as Id<'teams'>}
          month={monthParam}
          myPlayerId={myPlayerId ?? undefined}
          className="md:col-span-3"
        />
      </Suspense>
      <Suspense
        fallback={
          // `rows` COMES FROM ALREADY-RESOLVED DATA, which is what makes the
          // fallback the right HEIGHT rather than a guess: team membership is
          // api.teams.getMyTeams, which does not suspend on a team or month
          // change, so the member count is known before the table's own query
          // has answered. v1's skeleton draws three rows for every team.
          //
          // `footer` MIRRORS THE REAL ELEMENT'S OWN, same reason: `isOwner`
          // is also already-resolved team membership data, not something the
          // suspended query answers.
          <ScoresTableSkeleton
            month={monthParam}
            rows={selectedTeam?.members.length}
            className="md:col-span-3"
            footer={selectedTeam && <ScoringLegendSkeleton isOwner={selectedTeam.isOwner} />}
          />
        }
      >
        <ScoresTable
          teamId={teamParam as Id<'teams'>}
          month={monthParam}
          myPlayerId={myPlayerId ?? undefined}
          className="md:col-span-3"
          // Folded into the card as a footer (wordle-teams-ha7u) rather than
          // its own grid child — see the Suspense comment above this block.
          // Gated on `selectedTeam` for the same reason "Team settings" above
          // is: a stale `?team=` renders it undefined for the few renders
          // before useDashboardSearchSync corrects it.
          footer={
            selectedTeam && (
              <ScoringLegend
                teamId={teamParam as Id<'teams'>}
                month={monthParam}
                isOwner={selectedTeam.isOwner}
                // NAVIGATES STRAIGHT TO THE SCORING SECTION (wordle-teams-5jcn.29),
                // not just to /team's own default landing. `hash: 'scoring'`
                // is what routes/team.tsx's `id="scoring"` wrapper answers —
                // TanStack's scroll restoration scrolls that element into view
                // once the navigation settles, with no state to carry beyond
                // the URL itself. This used to set `teamSettingsTab` to land
                // TeamSettingsDialog on its Scoring tab; the anchor is this
                // control's whole replacement for that.
                onEdit={() => void navigate({ to: '/team', search: { team: teamParam }, hash: 'scoring' })}
              />
            )
          }
        />
      </Suspense>
      {/* Full width since the admin cards left the grid. The `md:row-span-3`
          that used to be here existed only so CurrentTeamCard and
          ScoringSystemCard could sit beside it. */}
      <Suspense fallback={<TeamBoardsSkeleton className="md:col-span-3" />}>
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
          className="md:col-span-3"
        />
      </Suspense>
    </main>
  )
}
