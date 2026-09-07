import { createFileRoute, redirect, useNavigate, Link } from '@tanstack/react-router'
import { MessageSquare, Settings } from 'lucide-react'
import { toast } from 'sonner'
import { Suspense } from 'react'
import { convexQuery, useConvexMutation } from '@convex-dev/react-query'
import { useMutation, useSuspenseQuery } from '@tanstack/react-query'
import { useEffect, useState } from 'react'
import { api } from '../../convex/_generated/api'
import { pageTitle } from '#/lib/seo'
import { SIGNIN_PARAM, trackFunnel } from '#/lib/funnel.ts'
import { useHydrated } from '#/lib/use-hydrated.ts'
import { captureError } from '#/lib/sentry-capture.ts'
import { useDashboardSearchSync } from '#/lib/use-dashboard-search-sync.ts'
import { mutationErrorMessage } from '#/lib/convex-error.ts'
import { takePendingInvite } from '#/lib/pending-invite.ts'
import { useStartUpgrade } from '#/lib/use-start-upgrade.ts'
import { UnreadBadge } from '#/components/chat/unread-badge.tsx'
import { chatEntryLabel, hasUnread, unreadTeamIds, useUnreadTeams } from '#/components/chat/use-chat-sync.ts'
import { CheckoutPending, useCheckoutReturn } from '#/components/checkout-return.tsx'
import { MonthPicker, monthOptions } from '#/components/month-picker.tsx'
import { TeamPicker } from '#/components/team-picker.tsx'
import { CreateTeamDialog } from '#/components/teams/create-team-dialog.tsx'
import { InvitePlayerDialog } from '#/components/teams/invite-player-dialog.tsx'
import { ScoresTable } from '#/components/scores-table.tsx'
import { TeamBoards } from '#/components/teams/team-boards.tsx'
import { TodayPanel } from '#/components/today-panel.tsx'
import { ScoringLegend } from '#/components/scoring-legend.tsx'
import { MonthlyWinnerCelebration } from '#/components/monthly-winner-celebration.tsx'
import { BoardEntryButton, BoardEntrySurface } from '#/components/board-entry/button.tsx'
import { NextStepCard } from '#/components/onboarding/next-step-card.tsx'
import { onboardingFactsFrom } from '#/lib/onboarding-facts.ts'
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

/**
 * `join` IS NOT A FILTER LIKE THE OTHER TWO — it is a one-shot instruction
 * carried here by routes/join.$token.tsx for an ALREADY signed-in link holder,
 * and the effect below strips it from the URL the moment it has been read. It
 * has to be declared here all the same: validateSearch is exhaustive, so an
 * undeclared param is dropped on the way in and the redirect that carries it
 * would arrive empty.
 */
type DashboardSearch = { team?: string; month?: string; join?: string }

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
    join: typeof search.join === 'string' ? search.join : undefined,
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
   * ISSUED TOGETHER, NOT IN SEQUENCE (`wordle-teams-dpi`). They are
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
   * `useSuspenseQuery` and does not apply here: every one of these feeds
   * `useSuspenseQuery`, so the component suspends on them whether or not the
   * loader warmed them, and warming them in parallel is strictly better.
   *
   * THE MEASUREMENTS ABOVE WERE TAKEN AT THREE QUERIES. onboarding.getStatus
   * made it four (see its own note below); the shape of the argument is
   * unchanged — still MAX rather than SUM — but the numbers were not re-taken.
   */
  loader: async ({ context }) => {
    await Promise.all([
      context.queryClient.ensureQueryData(convexQuery(api.teams.getMyTeams, {})),
      context.queryClient.ensureQueryData(convexQuery(api.teams.amIPro, {})),
      context.queryClient.ensureQueryData(convexQuery(api.scores.getMyPlayerId, {})),
      // THE FOURTH, ADDED WITH THE ONBOARDING CARD, AND WARMED FOR THE REASON
      // THE PARAGRAPH ABOVE ALREADY GIVES. getStatus feeds a useSuspenseQuery in
      // the component, so the component suspends on it whether or not it is
      // warmed here — and an unwarmed one suspends AFTER this loader has
      // resolved, which is a fourth round trip in SERIES rather than in
      // parallel. Worse, that suspension has no boundary between it and the
      // route, so `pendingComponent` (DashboardSkeleton) replaces the WHOLE
      // page for its duration, on every /app load, including for the activated
      // players who will never see the card at all.
      context.queryClient.ensureQueryData(convexQuery(api.onboarding.getStatus, {})),
    ])
  },
  errorComponent: DashboardError,
  /**
   * v1's `src/app/me/loading.tsx`, which v2 never ported (wordle-teams-9ahw).
   *
   * COVERS THE NAVIGATION INTO /app, NOT A TEAM OR MONTH SWITCH — the two are
   * different moments and both needed fixing. The loader above prefetches
   * getMyTeams, amIPro, getMyPlayerId and onboarding.getStatus, none of which
   * depend on team or month, so it does NOT re-run when either changes; that
   * case is handled by the Suspense boundaries in the component below.
   */
  pendingComponent: DashboardSkeleton,
  component: Dashboard,
})

function Dashboard() {
  const { team: teamParam, month: monthParam, join: joinParam } = Route.useSearch()
  const navigate = useNavigate({ from: Route.fullPath })
  const hydrated = useHydrated()
  const { data: teams } = useSuspenseQuery(convexQuery(api.teams.getMyTeams, {}))
  const { data: isPro } = useSuspenseQuery(convexQuery(api.teams.amIPro, {}))
  const { data: myPlayerId } = useSuspenseQuery(convexQuery(api.scores.getMyPlayerId, {}))
  // Deliberately TINY, and warmed in the loader above. See convex/onboarding.ts
  // for why it reads nothing team-shaped: a second query built on getMyTeamsFor
  // would double the full-teams-table fan-out for every connected client.
  const { data: onboardingStatus } = useSuspenseQuery(convexQuery(api.onboarding.getStatus, {}))
  /**
   * THE ARGUMENT THAT REPLACED A FULL `teams` SCAN (wordle-teams-w7g2), AND
   * THE ONE PLACE IT IS DERIVED.
   *
   * `unreadTeams` used to take none and work the list out server-side, which
   * meant its read set was the entire `teams` table — so every rename, invite,
   * join and billing change ANYWHERE in the app re-fired this subscription for
   * EVERY connected player, and by Part 2 essentially every authenticated
   * session holds it open. The client already has its own teams, three lines
   * up; handing them over narrows the read set to three small documents per
   * team. The server still gates every id (see unreadTeamsFor) — this list is
   * a question, not a permission.
   *
   * DERIVED HERE AND PASSED TO THE ONE HOOK CALL, rather than rebuilt by each
   * consumer. The ids are the TanStack query key now, so two callers with the
   * same set in a different order would open TWO Convex subscriptions for one
   * answer, with no symptom any gate can see. `unreadTeamIds` sorts for the
   * same reason; both halves are pinned in src/routes.test.ts.
   */
  const teamIds = unreadTeamIds(teams)
  /**
   * THE ONE SUBSCRIPTION BEHIND EVERY UNREAD DOT ON THIS PAGE, AND NOW THE ONE
   * CALL SITE (wordle-teams-pnhe). It feeds the "Team chat" button's accessible
   * NAME (see chatEntryLabel) and, as a prop, every `UnreadBadge` on the page —
   * the dashboard's own and the ones inside TeamPicker's menu.
   *
   * THE CONSUMERS TAKE THE ANSWER, NOT THE HOOK, and that is a requirement
   * rather than tidiness. This hook SHEDS its subscription while chat is
   * degraded, and `removeQueries` on a key a second component is still
   * observing gets that query rebuilt and refetched on the spot — so one
   * observer is the precondition for the valve working at all. See
   * `useUnreadTeams`.
   *
   * `useQuery` UNDER THE HOOD, NOT `useSuspenseQuery` LIKE ITS THREE
   * NEIGHBOURS: none of the three prefetched-in-the-loader queries above wants
   * a fourth round trip added to the critical path for a decoration, and
   * `hasUnread` already reads the unresolved `undefined` as "no dot".
   */
  const { unread: unreadTeams } = useUnreadTeams(teamIds)
  const [createOpen, setCreateOpen] = useState(false)
  const [boardOpen, setBoardOpen] = useState(false)
  /**
   * The onboarding card's invite task, which used to be a navigation to /team.
   *
   * A SECOND MOUNT OF InvitePlayerDialog, NOT A MOVE. current-team-card.tsx:333
   * keeps its own and /team is unchanged; this adds an entry point, it does not
   * relocate the first. That is safe here in a way it was NOT for
   * CreateTeamDialog — two of those were refused because both would have been
   * mounted on the SAME page. These two live on different routes and can never
   * be mounted together.
   */
  const [inviteOpen, setInviteOpen] = useState(false)
  /**
   * NULL UNTIL THE CARD'S BOARD TASK IS PRESSED, AND THAT IS THE HYDRATION
   * GUARDRAIL, not laziness. See where it is set below.
   */
  const [boardMonth, setBoardMonth] = useState<string | null>(null)
  const dismissOnboarding = useMutation({
    mutationFn: useConvexMutation(api.onboarding.dismiss),
  })
  const consumeInvite = useMutation({ mutationFn: useConvexMutation(api.inviteLinks.consumeLink) })
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

  /**
   * THE OTHER END OF routes/join.$token.tsx, AND THE ONLY PLACE A LINK TOKEN
   * CAN BE SPENT.
   *
   * `consumeLink` calls requirePlayer, so a brand-new account cannot spend a
   * token until /complete-profile has made a player row. That is the whole
   * reason the token waits somewhere rather than being consumed by the /join
   * route itself: the signed-out holder goes /join -> /login ->
   * /complete-profile -> here, and only the last hop has a player.
   *
   * TWO CARRIERS, AND NEITHER IS REDUNDANT. `?join=` is the faster one and is
   * preferred whenever it survives. It does not always survive: the beforeLoad
   * above redirects an account with no player row to /complete-profile, and
   * that redirect drops the search params — which lost the invite outright for
   * anyone who authenticated but abandoned onboarding half way. sessionStorage
   * is the carrier that survives that hop, so routes/join.$token.tsx fills in
   * both and this reads whichever arrived.
   *
   * DECLARED BEFORE useDashboardSearchSync, FOR THE SAME REASON THE CHECKOUT
   * MARKER ABOVE IS. Effects run in the order their hooks are called, and the
   * sync effect navigates with `{ team, month }` — a whole new search object,
   * so `join` is gone from the URL after it runs. Reading it afterwards would
   * find nothing on the one load it matters for.
   *
   * THE CLEAR AND THE THROW-SAFETY ARE NOT THIS FILE'S TO GET RIGHT any more —
   * `takePendingInvite` reads and clears as one operation, and neither of its
   * two functions can throw at a storage failure. Both properties have real
   * tests in lib/pending-invite.test.ts, which is worth more than the source
   * assertions this file can be held to: `Dashboard` is not exported and a
   * route module cannot be rendered under vitest.
   */
  useEffect(() => {
    // BOTH CARRIERS ARE EMPTIED BEFORE EITHER IS SPENT, and the URL is emptied
    // through `window.location` + replaceState rather than through the router
    // — exactly as the funnel marker above is, and for exactly the reason its
    // comment gives: "so a refresh or a share cannot double-count".
    //
    // MEASURED, and this is not defensive coding. Instrumenting this effect on
    // the signed-in path showed it running THREE times for one arrival:
    //
    //   joinParam=<token> stashed=<token>      -> consumed
    //   joinParam=<token> stashed=undefined    -> consumed AGAIN
    //   joinParam=undefined
    //
    // The second run has the same dependency value as the first, so it is a
    // REMOUNT of Dashboard, and React re-runs effects on a remount whatever the
    // deps say. `takePendingInvite` had already emptied the storage carrier —
    // which is why that one refused — but `navigate()` is asynchronous, so the
    // router still held `?join=` and handed it over a second time. A `useRef`
    // guard would not have helped: a remount resets it too.
    //
    // consumeLinkFor is idempotent (`if (team.playerIds.includes(playerId))
    // return`), so the damage was two toasts rather than two roster entries.
    // Two toasts is still wrong, and the next carrier added here will not
    // necessarily land in front of an idempotent mutation.
    const stashed = takePendingInvite()
    const url = new URL(window.location.href)
    const fromUrl = url.searchParams.get('join') ?? undefined
    if (fromUrl) {
      url.searchParams.delete('join')
      window.history.replaceState({}, '', url.pathname + url.search + url.hash)
    }
    const token = fromUrl ?? stashed
    if (!token) return
    void consumeInvite
      .mutateAsync({ token })
      .then(() => toast.success('You joined the team'))
      .catch((error: unknown) =>
        toast.error(mutationErrorMessage(error, 'That invite link is no longer valid')),
      )
    // NO `navigate()` TO TIDY THE URL, deliberately. replaceState above already
    // did it, synchronously, which is the whole point; a navigation here would
    // additionally race useDashboardSearchSync's. The router's own search state
    // keeps a spent `join` until that sync effect rewrites it moments later,
    // and nothing reads it in the meantime — the funnel marker above leaves
    // `signin` in exactly the same state for the same reason.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [joinParam])

  useDashboardSearchSync({
    teamParam,
    monthParam,
    teams,
    navigate: (search) => void navigate({ to: Route.fullPath, search, replace: true }),
  })

  const onboardingFacts = onboardingFactsFrom(teams, onboardingStatus)

  /**
   * The onboarding card, as a FUNCTION OF ITS className rather than one shared
   * element, for exactly the reason CheckoutPending is given a different one on
   * each branch below: the no-team branch is a plain <main> where the card wants
   * its own bottom margin, and the dashboard is a grid EVERY child of which
   * carries `md:col-span-3` — without it the card would sit in one of three
   * columns. A wrapper <div> would have done the same job at the cost of an
   * empty grid item, and therefore a gap, on every render where the card is
   * finished and returns null; a component returning null contributes no grid
   * item at all, which is why the class goes on the card.
   *
   * CheckoutPending, two lines into each branch below, is the precedent for the
   * PROP — same component, `mb-4` on one branch and `md:col-span-3` on the
   * other. MonthlyWinnerCelebration is the precedent for the other half of the
   * argument only: it is a grid child that renders no element, and so costs the
   * grid nothing. It takes no className and is not a model for this prop.
   */
  const onboardingCard = (className?: string) => (
    <NextStepCard
      className={className}
      facts={onboardingFacts}
      onBoard={() => {
        // COMPUTED IN THE HANDLER BECAUSE `currentMonth` IS OUT OF REACH, and
        // that — not hydration on its own — is the argument. A render-scope
        // const that only ever feeds a click handler never reaches the DOM, so
        // deriving the month during render could not by itself produce the
        // hydration mismatch today-panel.tsx and scores-table.tsx warn about.
        // What is actually true is narrower and sufficient: `currentMonth` at
        // the bottom of this component (`hydrated ? monthOf(...) : monthParam`)
        // is the right idiom and does this job, but it sits BELOW the
        // `teams.length === 0` early return, so the branch that most needs a
        // month cannot reach it — and a team-less player never reaches the
        // `!teamParam || !monthParam` guard either, so `monthParam` is
        // undefined for them. Hoisting `currentMonth` above the return would
        // make every render of that branch depend on a hydration flag for a
        // value only a click ever reads. A click is post-hydration by
        // construction, so the handler needs no flag at all.
        setBoardMonth(monthParam ?? monthOf(toPuzzleDay(new Date())))
        setBoardOpen(true)
      }}
      onTeam={() => setCreateOpen(true)}
      // OPENS THE DIALOG HERE RATHER THAN NAVIGATING TO /team, which is what
      // this used to do. The task's whole job is to get one more person into
      // the room, and a route change to a settings page — where the invite
      // control is one of several — is a detour off the screen the person is
      // already on. The dialog is mounted on the dashboard branch below.
      //
      // THE DIALOG IS ONLY MOUNTED ON THAT BRANCH, and pressing this on the
      // team-less branch would therefore set state nothing reads. It cannot be
      // pressed there: `hasTeam &&` in incompleteTasks is what stops the invite
      // task from rendering at all until a team exists. That gate is not a
      // convenience — before it existed the task was on screen for a brand-new
      // signup, navigating to /team with no team id, and routes/team.tsx
      // bounced it straight back to /app. If it is ever relaxed this button
      // goes dead; onboarding-tasks.test.ts is what holds it.
      //
      // `teamParam` IS DEFINED WHEREVER THIS CAN BE PRESSED, by the same gate,
      // which is why the dialog below can take it without a fallback.
      onInvite={() => setInviteOpen(true)}
      // `mutate`, NOT `void mutateAsync(...)`. A rejected mutateAsync with
      // nothing attached to it is an unhandled promise rejection; `mutate`
      // routes the same failure into the mutation's own state instead. Dismiss
      // is idempotent and has no success UI, so there is nothing to await.
      //
      // REPORTED, NOT TOASTED — monthly-winner-celebration.tsx's markSeen is
      // the house pattern for this exact shape and its reasoning transfers
      // whole. The card does not hide optimistically, so a failure leaves the
      // X visibly doing nothing, and without this line that is invisible
      // everywhere: no toast, no Sentry event, no retry. It matters more than
      // the usual fire-and-forget because dismiss is the ONLY escape for the
      // population this card is newly permanent for — a v1 migrant on a solo
      // team sees "One more thing / Invite someone" on every load, and
      // replay-from-the-menu (qt4.9) is still an open task.
      onDismiss={() =>
        dismissOnboarding.mutate(
          {},
          { onError: (error: unknown) => captureError(error, { where: 'onboarding.dismiss' }) },
        )
      }
    />
  )

  /**
   * The board panel the card's first task opens, on BOTH branches.
   *
   * IT GETS ITS OWN SUSPENSE BOUNDARY, and this is the one place on the page
   * that genuinely needs one. BoardEntryButton in the controls row sits above
   * all three boundaries further down, which never bites because its
   * getTeamMonth is already warm from TodayPanel. Nothing warms getMyMonth, the
   * query BoardEntryForm uses when there is no team — so without a boundary
   * here the FIRST tap by a team-less player suspends all the way to the route
   * and blanks the page, hitting precisely the person this card exists to
   * convert, on their first meaningful action.
   *
   * No `trigger` prop: the card's task button is the trigger, and
   * BoardEntrySurface renders no button of its own without one.
   */
  const boardSurface = boardMonth !== null && (
    <Suspense fallback={null}>
      <BoardEntrySurface
        open={boardOpen}
        onOpenChange={setBoardOpen}
        // NOT `as Id<'teams'>`. Since teamId became optional, an undefined
        // slipping through a bare cast no longer throws inside getTeamMonth —
        // it silently routes to the solo form and shows a team-less prefill on
        // a team page. Keeping `| undefined` in the type makes the team-less
        // case explicit rather than accidental.
        teamId={teamParam as Id<'teams'> | undefined}
        month={boardMonth}
      />
    </Suspense>
  )

  // ALL THREE RETURNS BELOW RENDER THE PENDING NOTICE, and the empty state is
  // the one wordle-teams-6tn actually named: someone can upgrade before they
  // have created a single team, and that is the case where they would
  // otherwise be looking at a page with nothing on it that acknowledges the
  // payment they just made. The skeleton branch matters too — it is what every
  // load shows until useDashboardSearchSync fills the params in.
  if (teams.length === 0) {
    return (
      <main className="page-max mt-2 md:mt-6">
        {/*
          THE ROUTE'S <h1>, VISUALLY HIDDEN, AND ON ALL THREE RETURNS SO IT IS
          STABLE (wordle-teams review of qt4.7). ui/card.tsx's own note states
          the doctrine — "a Card used as a page's main region silently leaves
          that page with no h1. That is an accessibility defect, not just a
          testing inconvenience" — and until now /app was the only route in the
          app without one: about, chat, complete-profile, login, login-error,
          maintenance, privacy, team, terms and the landing hero all have theirs.
          TeamsEmptyState carried this route's only h1 and it rendered on ONE
          branch, so the dashboard proper never had one at all.

          HIDDEN RATHER THAN DRAWN because this page has no title in its design
          and inventing one would be a visual change the review did not ask for.
          `sr-only` is the app's existing spelling for this (notifications-tab).

          NOT THE ONBOARDING CARD'S HEADING PROMOTED TO h1, which was the first
          thing tried and is worse: it would give /app a top heading level that
          appears and disappears as tasks are completed or the card is dismissed.
          The card stays at h2, which is the right level RELATIVE to this — the
          same level TodayPanel uses.
        */}
        <h1 className="sr-only">Dashboard</h1>
        {upgradePending && <CheckoutPending className="mb-4" />}
        {/* `mx-auto max-w-md` KEEPS TeamsEmptyState'S BOX, which is the one
            thing worth carrying over from it. This branch is a plain <main>
            inside `.page-max`, so without a cap the card runs the full 1232px
            at desktop with its task buttons stretched across it, where the
            component it replaces was a centred 448px card. The
            dashboard branch wants the opposite — full width, in a grid — which
            is exactly why this class is the caller's and not the card's. */}
        {onboardingCard('mx-auto mb-4 max-w-md')}
        {boardSurface}
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
        {/* The route's <h1>, on every return so it is stable. Full note on the
            no-team branch above. */}
        <h1 className="sr-only">Dashboard</h1>
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
      {/* The route's <h1>, on every return so it is stable. Full note on the
          no-team branch above. */}
      <h1 className="sr-only">Dashboard</h1>
      {upgradePending && <CheckoutPending className="md:col-span-3" />}
      {boardSurface}
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
      {/* THE ONBOARDING CARD'S INVITE TASK, mounted here and not on the two
          branches above because it is the only branch that has a team to name.
          `selectedTeam` is the guard AND the source of `teamName`; there is no
          `?? ''` fallback because a missing team must render no dialog rather
          than one addressed to nobody.

          NOT GATED ON `selectedTeam.isOwner`, unlike current-team-card.tsx:333,
          and the difference is that its gate protects a dialog with NO TRIGGER
          for a non-owner — its Invite button is owner-only, so mounting it
          would attach useVisualViewport's listeners for something that can
          never open. Here the trigger is the onboarding card, which is not
          owner-gated. It does not need to be: both mutations behind this dialog
          call requireTeamOwnerFor, and a non-owner cannot see the invite task
          in the first place — being a non-owner member means the team has a
          second member, which makes `hasInvited` true, which removes the task.
          Were that chain ever to break, an error toast from the server is a
          better outcome than a button that silently does nothing. */}
      {selectedTeam && (
        <InvitePlayerDialog
          open={inviteOpen}
          onOpenChange={setInviteOpen}
          teamId={teamParam as Id<'teams'>}
          teamName={selectedTeam.name}
        />
      )}
      <MonthlyWinnerCelebration teamId={teamParam as Id<'teams'>} />
      {/* THIS ROW FITS A PHONE ON ONE LINE, AND IT ONLY JUST DOES. Five
          controls live here — team picker, month picker, "Team settings",
          "Team chat" and BoardEntryButton — and at 390px there are 374px to
          put them in, after `.page-max`'s own 0.5rem gutters.

          THE FIRST ATTEMPT WAS `flex-wrap` ALONE, AND IT WAS WRONG. It stopped
          the document scrolling sideways (billing.spec.ts asserts
          `scrollWidth - clientWidth <= 0` at 390x844, and the "Team settings"
          note below records that overflow once costing 64px), but wrapping is
          not the same as fitting: the owner's phone put four controls on line
          one and dropped the "+" — the page's PRIMARY action — onto a line of
          its own, pinned hard right by its `ml-auto` under a strip of empty
          space. It looked broken because it was.

          MEASURED AGAINST THE BUILT STYLESHEET IN HEADLESS CHROMIUM AT
          390x844, with the team name long enough to hold TeamPicker at its cap
          — the widest this row can ever be — and tailwind-merge's
          `px-2`-over-`px-4` resolution applied by hand:

            before   152 + 97 + 34 + 34 + 52, gap 8   row 401px   OVER by 27
            after    120 + 97 + 34 + 34 + 52, gap 6   row 361px   13px spare

          TWO TRIMS, BOTH REVERSED AT `sm`, AND NEITHER TOUCHES THE "+".
          TeamPicker's cap drops 9.5rem -> 7.5rem below `sm` (see its own note:
          it is the only control here whose width is someone's data rather than
          a fixed label, so it is the one that should yield), and this gap goes
          8px -> 6px. The two icon-only buttons keep their `px-2`: at 34px they
          are already under the 44px touch target guidance, and taking padding
          off a control someone has to hit with a thumb is a worse trade than
          two pixels of gap. BoardEntryButton is untouched at 52px, so the
          primary action stays the widest thing in the row after the picker.

          `flex-wrap` STAYS AS A BACKSTOP, NOT AS THE FIX. Nothing in the
          measured case wraps any more, but a larger system font size, a 320px
          device or a sixth control would each put this back over the edge, and
          a wrapped row is still a better failure than a page that scrolls
          sideways.

          AND THEN IT WRAPPED AGAIN, IN LANDSCAPE (wordle-teams-mkix). Every
          measurement above was taken at 390x844 portrait, which is the one
          orientation this row is NOT widest in. Rotate the phone and the
          viewport more than doubles, but four separate things expand at
          `md` (768px) AT ONCE while the space to put them in SHRINKS:

            BoardEntryButton  48 -> 141   its `useMediaQuery('(min-width:
                                          768px)')` flips from the icon-only
                                          Sheet trigger to the labelled Dialog
                                          one — a JS media query, not a class,
                                          which is why grepping for `sm:` finds
                                          nothing to blame
            TeamPicker       152 -> 192   `md:max-w-none md:px-4 md:text-sm`
            MonthPicker      101 -> 132   `md:px-4 md:text-sm`
            .page-max         -32         its gutter goes 0.5rem -> 1.5rem a
                                          side at the same 48rem boundary

          MEASURED THE SAME WAY AS THE TABLE ABOVE — real components bundled
          over the BUILT stylesheet in headless chromium, team name at the
          picker's 15-character truncation — but at every width, not one:

            768   content 777 into 720 usable    2 LINES
            844   content 777 into 796 usable    1 line, 19px spare
            844   with 47px safe-area insets, 750 usable    2 LINES

          That last row is the owner's phone. `viewport-fit=cover` is on, so in
          landscape `.page-max`'s `max(1.5rem, env(safe-area-inset-*))` resolves
          to the cutout, not the gutter, and the usable width is 46px less than
          the viewport. A harness that leaves `env()` at its headless zero
          measures a device that does not exist.

          THE FIX IS THAT PHONE LANDSCAPE IS `md`, SO `md` MUST STAY ICON-ONLY.
          844 and 926 both sit in the `md` band; the smallest thing in that band
          that is not a phone is a tablet. So the two secondary labels moved
          from `sm` to `lg` (1024px) — `hidden lg:inline`, with the matching
          `px-2` -> `lg:px-4` — and nothing else changed:

            768   content 565 into 720 usable    155px spare
            844   with insets, 565 into 750      185px spare
            640   content 401 into 624           223px spare
            1024  content 777 into 976           199px spare

          WHAT WAS DELIBERATELY NOT DONE. TeamPicker's `md:max-w-none` was the
          obvious co-conspirator and it is measured innocent: with the labels
          gone the `md` band has 155px of slack, so re-capping the trigger there
          would truncate someone's team name to buy room nothing needs. The
          `md` split for the picker and the month is about a phone-vs-tablet
          TYPE SCALE, which is a real distinction at 768; the labels are about
          horizontal room, which is not. BoardEntryButton's 768px switch stayed
          too — it chooses Dialog over Sheet, a different interaction and not a
          width tweak, and the labelled form IS the prominent primary action
          this row is required to keep.

          `ml-auto` ALSO STAYED, and it is what made the failure look like a
          bug rather than a squeeze: on the wrapped row the "+" was the only
          item on line two and `ml-auto` pinned it hard right under empty space.
          It is not the cause — a row that fits never wraps — and removing it
          would demote the primary action from its own end of the row to sit
          flush against the two secondary controls at every width. The
          measurements above are what keep it safe. */}
      <div className="flex flex-wrap items-center gap-1.5 sm:gap-2 md:col-span-3">
        <TeamPicker
          teams={teams}
          // THE SAME VALUE THE BADGE BELOW GETS, AND THAT IS THE POINT — see
          // the note on the hook above. TeamPicker deliberately does not read
          // it for itself, which would open a second observer of the one
          // subscription the valve has to be able to remove.
          unread={unreadTeams}
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
            className="px-2 text-foreground lg:px-4"
            asChild
          >
            <Link to="/team" search={{ team: teamParam }}>
              <Settings className="h-4 w-4" aria-hidden="true" />
              <span className="hidden lg:inline">Team settings</span>
            </Link>
          </Button>
        )}
        {/* THE APP'S ONLY WAY INTO /chat (wordle-teams-qix.25). Part 2 built
            the route, the message list, the composer and this very badge, and
            then linked to none of it: typing the URL was the entire entry
            point, and `UnreadBadge` rendered nowhere in `src/`.

            A COPY OF "Team settings" ABOVE, DOWN TO THE `size`-less Button,
            the `px-2 lg:px-4` collapse, the `aria-label`, the `aria-hidden`
            icon and `text-foreground` — every one of those has a reason
            recorded on that block and none of them is weaker here. Gated on
            `selectedTeam` for its reason too: a stale `?team=` would otherwise
            leave a live control pointing at a conversation there is no team
            for.

            THE NAME IS COMPUTED, WHICH IS THE ONE DIVERGENCE. `aria-label`
            replaces this element's content in the accessibility tree, badge
            included, so the dot below is decoration to a screen reader and the
            button's own name is the only place unread state can be said. See
            chatEntryLabel.

            THE DOT IS POSITIONED OUT OF FLOW, and that is about the phone
            rather than about taste. This row already runs close to the edge of
            a 390px viewport — billing.spec.ts measures the document's
            horizontal overflow there, and the comment on "Team settings"
            records the 64px of it that a third control once caused — so an
            in-flow dot would widen this button by the dot plus a gap EXACTLY
            when there is unread traffic, which is the worst moment to discover
            it. `absolute` costs the row nothing in either state. */}
        {selectedTeam && (
          <Button
            variant="outline"
            aria-label={chatEntryLabel(hasUnread(unreadTeams, teamParam as Id<'teams'>))}
            className="relative px-2 text-foreground lg:px-4"
            asChild
          >
            <Link to="/chat" search={{ team: teamParam }}>
              <MessageSquare className="h-4 w-4" aria-hidden="true" />
              <span className="hidden lg:inline">Team chat</span>
              <UnreadBadge
                teamId={teamParam as Id<'teams'>}
                unread={unreadTeams}
                className="absolute right-1 top-1"
              />
            </Link>
          </Button>
        )}
        <div className="ml-auto">
          {/* THE CAST IS SAFE BECAUSE OF THE EARLY RETURN, NOT BECAUSE THE
              VALUE IS FIXED. `teamParam` is `string | undefined`, and every
              cast like it in this block — TodayPanel's, ScoresTable's,
              MonthlyWinnerCelebration's — leans on the same one thing: the
              `!teamParam || !monthParam` return above, which means nothing
              below it renders until both params are real strings.

              IT IS NOT "teamId is fixed for the life of the mount", which is
              false and worth saying so explicitly: TeamPicker changes `?team=`
              through `navigate`, this route does not remount on a search
              change, and so this prop DOES change under a live component.
              That is fine — BoardEntryForm re-keys on it — but it means the
              invariant is about the guard, not about stability.

              CONTRAST THE CARD-DRIVEN SURFACE ABOVE, which keeps
              `| undefined` in its cast. It is rendered by BOTH branches,
              including the team-less one that returns before this guard, so
              there `undefined` is a real value and the honest type is the
              point. Here it cannot be. */}
          <BoardEntryButton teamId={teamParam as Id<'teams'>} month={monthParam} />
        </div>
      </div>
      {/* THE FIRST THING IN THE CONTENT, BUT BELOW THE CONTROLS ROW, WHICH IS A
          DELIBERATE READING OF "top of the dashboard". Above the row would push
          the team and month pickers — the chrome this page is navigated by, and
          a row four separate measurements defend at 390px — down the screen for
          a card that is temporary by design. Above the upgrade notice would be
          worse still: that notice is first on all three returns on purpose. */}
      {onboardingCard('md:col-span-3')}
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
