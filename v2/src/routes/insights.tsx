import { createFileRoute, redirect, useNavigate, Link } from '@tanstack/react-router'
import { convexQuery } from '@convex-dev/react-query'
import { useQuery } from '@tanstack/react-query'
import { ArrowLeft } from 'lucide-react'
import { useEffect, useState } from 'react'
import { Button } from '#/components/ui/button.tsx'
import { Card, CardContent } from '#/components/ui/card.tsx'
import { Skeleton } from '#/components/ui/skeleton.tsx'
import { benchmarkCredit, loadInsightsBenchmark } from '#/lib/insights-benchmark.ts'
import type { InsightsBenchmark } from '#/lib/insights-benchmark.ts'
import { upsellFor } from '#/lib/insights-panel.ts'
import type { Boards } from '#/lib/insights-panel.ts'
import { isThin, MIN_BOARDS_FOR_STATS } from '#/lib/insights-personal.ts'
import { resolveInsightsSearch } from '#/lib/insights-search.ts'
import { STORAGE_KEY } from '#/lib/dashboard-search.ts'
import { useHydrated } from '#/lib/use-hydrated.ts'
import { formatMonthLabel } from '#/lib/format-day.ts'
import { DailyBenchmark } from '#/components/insights/daily-benchmark.tsx'
import { DailyTeamFact } from '#/components/insights/daily-team-fact.tsx'
import { NoTeamCard } from '#/components/insights/no-team-card.tsx'
import { OpenersPanel } from '#/components/insights/openers-panel.tsx'
import { PersonalSummary } from '#/components/insights/personal-summary.tsx'
import { TeamPanel } from '#/components/insights/team-panel.tsx'
import { TrendPanel } from '#/components/insights/trend-panel.tsx'
import { TrialEndedCard } from '#/components/trial-ended-card.tsx'
import { UnlockPrompt } from '#/components/insights/unlock-prompt.tsx'
import { monthOf, toPuzzleDay } from '../../convex/lib/puzzleDay.ts'
import { pageTitle } from '#/lib/seo'
import { api } from '../../convex/_generated/api'

/**
 * Layer 1 — the public benchmark.
 *
 * A TOP-LEVEL ROUTE, NOT A CHILD OF /app, and the plan decided this because the
 * spec does not: it matches /chat and /team, which are siblings for the same
 * reasons — signed-in only, their own screen, nothing for an anonymous visitor,
 * and the same beforeLoad redirect. public/robots.txt carries a Disallow line for
 * it, which src/crawler-metadata.test.ts enforces.
 *
 * THE CORPUS IS FETCHED HERE AND NOWHERE ELSE. This component is code-split by
 * the router, so a player who never opens insights never pays the ~79 KB. Do not
 * lift loadInsightsBenchmark() into a shared module the app shell imports; that
 * is the whole cost decision, and CI greps dist/client to keep it.
 */

/**
 * `?team=` AND `?month=` NAME WHAT THE PAGE IS SHOWING, the same two params the
 * dashboard carries and for the same reason: the URL is the source of truth, so
 * a link to a particular team's month is shareable and a reload lands back on
 * the same view rather than on a default one.
 *
 * SHAPE ONLY — VALIDITY IS NOT THIS FUNCTION'S JOB. validateSearch runs before
 * anything is loaded: it has no team list and no clock, so all it can do is drop
 * what is not even a string, or not shaped like a month. Whether the team is one
 * the viewer belongs to, and whether the month is inside that team's window, are
 * resolveInsightsSearch's questions (lib/insights-search.ts), answered by the
 * effect in InsightsRoute below.
 *
 * `validateSearch` IS EXHAUSTIVE: a param this function does not return is
 * dropped on the way in, so a future link that needs to carry something else
 * must declare it here — routes/app.tsx makes the same point about its `?join=`,
 * which is not a filter at all and still has to be listed.
 */
type InsightsSearch = { team?: string; month?: string }

export const Route = createFileRoute('/insights')({
  head: () => ({ meta: [{ title: pageTitle('Insights') }] }),
  validateSearch: (search: Record<string, unknown>): InsightsSearch => ({
    team: typeof search.team === 'string' ? search.team : undefined,
    // Anything not shaped like a month is dropped rather than trusted; the
    // effect below then fills in the local current month.
    month:
      typeof search.month === 'string' && /^\d{4}-\d{2}$/.test(search.month)
        ? search.month
        : undefined,
  }),
  // The same guard as /chat, /team and /app, for the same reason: every query
  // this page renders goes through requirePlayer on the server, so a visitor
  // without a session or without a player row lands on an error state rather
  // than a path anywhere.
  beforeLoad: async ({ context }) => {
    if (!context.isAuthenticated) throw redirect({ to: '/login' })
    const needsProfile = await context.queryClient.ensureQueryData(
      convexQuery(api.players.needsProfile, {}),
    )
    if (needsProfile) throw redirect({ to: '/complete-profile' })
  },
  component: InsightsRoute,
})

/**
 * The corpus, once per tab.
 *
 * NOT react-query: this is a static file with no key, no invalidation and no
 * server state — loadInsightsBenchmark already caches the promise. Wrapping it
 * would add a cache on top of a cache and a second thing to reason about.
 */
function useBenchmark() {
  const [benchmark, setBenchmark] = useState<InsightsBenchmark | null>(null)
  const [failed, setFailed] = useState(false)

  useEffect(() => {
    let live = true
    loadInsightsBenchmark().then(
      (loaded) => live && setBenchmark(loaded),
      // The corpus failing to load is not the player's problem and not
      // actionable, so it degrades to a message rather than a toast.
      () => live && setFailed(true),
    )
    return () => {
      live = false
    }
  }, [])

  return { benchmark, failed }
}

function InsightsRoute() {
  const { team: teamParam, month: monthParam } = Route.useSearch()
  const navigate = useNavigate({ from: Route.fullPath })
  const hydrated = useHydrated()
  const { data, isPending } = useQuery(convexQuery(api.insights.myBenchmarkBoards, {}))
  const { benchmark, failed } = useBenchmark()

  /*
    THE SAME QUERY TeamSection ALREADY RUNS, deduped by TanStack on the query key,
    so two components asking for it share one subscription and one read. It is
    resolved HERE rather than inside InsightsPanel so that the panel's dependency
    on team membership is a visible prop — src/routes/-insights.hook.test.ts
    renders InsightsPanel directly, and a hidden query inside it can only be
    reached from a test through the react-query mock, which reports every query
    as unresolved.

    NOT ON THE SERVER, THOUGH IT WOULD BE TIDIER THERE. Answering "is this player
    on a team" in myBenchmarkBoards means a full-table collect over teams —
    Convex cannot index array membership (see the schema comment) — and that
    query is the exact subject of wordle-teams-dcu, where database BANDWIDTH and
    not function calls is the binding free-tier limit. The client already holds
    this for TeamSection; paying for it again on the server to save a prop is the
    wrong trade in this project.

    THE EFFECT BELOW IS A SECOND READER OF THE SAME ONE SUBSCRIPTION, not a
    reason to add a query: resolveInsightsSearch checks `?team=` against the
    teams the viewer is actually on, and reaches each team's `createdAt` for the
    month window it judges `?month=` by.
  */
  const { data: teams } = useQuery(convexQuery(api.teams.getMyTeams, {}))

  /*
    FILLS IN OR CORRECTS `?team=` AND `?month=`, through the pure
    resolveInsightsSearch rather than inline: that function has a test asserting
    it is idempotent — feed it its own output and it returns null — and that
    property is the only thing standing between this effect and an infinite
    redirect. Read its header before changing what it is fed.

    AFTER HYDRATION ONLY, THE SAME GUARD useDashboardSearchSync CARRIES AND FOR
    THE SAME REASON. The month fallback is the viewer's LOCAL current month and
    the server renders in UTC, so on the first and last day of a month the two
    disagree; reading the clock before hydration is the mismatch class
    wordle-teams-uc5 was. routes/team.tsx's own one-param effect deliberately
    has NO such guard, and that is not an inconsistency: it consults only
    localStorage, which useEffect already keeps off the server for free. This
    one reads the clock, so it waits.

    `teams ?? []` RATHER THAN AN EARLY RETURN. With the team list still in
    flight the resolver has nothing to select and returns null, which is exactly
    the "do nothing" an early return would produce. The DEPENDENCY stays `teams`
    itself — the reference react-query hands back, which holds while the data is
    unchanged — because `teams ?? []` in the dependency array would be a fresh
    array on every render and re-run the effect on each one.
  */
  useEffect(() => {
    if (!hydrated) return
    const next = resolveInsightsSearch({
      teamParam,
      monthParam,
      teams: teams ?? [],
      storedTeam: localStorage.getItem(STORAGE_KEY),
      currentMonth: monthOf(toPuzzleDay(new Date())),
    })
    if (next) void navigate({ to: Route.fullPath, search: next, replace: true })
  }, [hydrated, teamParam, monthParam, teams, navigate])

  /*
    THIS PAGE SETS THE DASHBOARD'S REMEMBERED TEAM; `/team` NEVER SETS A
    SELECTION. An editor comparing the two files will otherwise conclude that one
    of them is wrong, so, precisely: routes/team.tsx READS the key in its own
    fallback effect (through resolveTeamSettingsSearch) and CLEARS it in two
    handlers — leaving the selected team, and deleting it — so that a dead id
    cannot repopulate the URL. What it never does is SELECT a team with it,
    because it has no team control of its own to keep the key in sync WITH.
    STORAGE_KEY's own note in lib/dashboard-search.ts scopes the claim the same
    careful way, to that page's fallback effect rather than to the whole file.

    THIS PAGE IS DIFFERENT: it is getting a team control of its own, so `?team=`
    here becomes a deliberate pick rather than a fallback, and a pick made here
    should follow the player back to the dashboard instead of being forgotten at
    the page boundary.

    NOT CONDITIONAL ON THE PARAM BEING VALID, matching useDashboardSearchSync
    line for line: a stale or foreign `?team=` can be written for the render or
    two before the effect above replaces it, and the corrected value is then
    written straight over it.
  */
  useEffect(() => {
    if (teamParam) localStorage.setItem(STORAGE_KEY, teamParam)
  }, [teamParam])

  return (
    /* THE CAP IS NESTED INSIDE page-max, NOT COMBINED WITH IT ON ONE ELEMENT,
       and this is not a style preference. `.page-max` is declared UNLAYERED in
       styles.css while every Tailwind utility lives in `@layer utilities`, and
       unlayered declarations beat layered ones outright regardless of source
       order or specificity. `class="page-max max-w-3xl"` therefore renders at
       --page-max's 1440px and the cap silently does nothing. wordle-teams-wty4.1.2
       already paid to learn this on /team; team.tsx:195 is the shape to copy. */
    <main className="page-max mt-2 md:mt-6">
      <div className="mx-auto w-full max-w-3xl">
        {/* THE SHAPE IS team.tsx'S AND chat.tsx'S, DOWN TO THE aria-label. This
          page was the only one carrying a "Back" text label, and three pages
          that go back differently is a worse outcome than any one of the
          shapes on its own. NO `-ml-2`: team.tsx and chat.tsx do not have one,
          and adding it here would reintroduce an 8px difference between this
          page's back arrow and /team's — the exact inconsistency this comment
          claims to be removing. */}
        <div className="flex items-center gap-2">
          <Button variant="ghost" size="icon" aria-label="Back to dashboard" asChild>
            <Link to="/app">
              <ArrowLeft className="h-4 w-4" aria-hidden="true" />
            </Link>
          </Button>
          <h1 className="text-2xl font-bold">Insights</h1>
        </div>

        <InsightsScope data={data} />

        {/*
        FIRST THING IN THE MAIN CONTENT, ABOVE THE LOADING STATE AND THE PANELS
        IT EXPLAINS. `myAccess` is its own query, independent of the benchmark
        corpus and myBenchmarkBoards below — a player whose trial ended still
        needs to see this whether or not the benchmark happens to be loading,
        failed, or empty this render, so it does not live inside any of those
        branches.
      */}
        <TrialEndedCard />

        {isPending || (!benchmark && !failed) ? (
          <div className="space-y-3" data-testid="insights-loading">
            <Skeleton className="h-28 w-full" />
            <Skeleton className="h-28 w-full" />
          </div>
        ) : failed ? (
          <p className="text-muted-foreground">
            The benchmark data could not be loaded. Try again in a moment.
          </p>
        ) : !data || data.boards.length === 0 ? (
          <p className="text-muted-foreground">
            Enter a board and we will show you how it compares.
          </p>
        ) : (
          <InsightsPanel
            benchmark={benchmark!}
            data={data}
            onATeam={teams === undefined ? undefined : teams.length > 0}
            teamParam={teamParam}
            month={monthParam}
          />
        )}
      </div>
    </main>
  )
}

/**
 * What the page is computed from. Nothing on the page stated this before, so a
 * player had no way to tell whether a number covered their whole history or
 * only what the current tier unlocks.
 *
 * ABSENT RATHER THAN ZERO while the query is in flight or empty: "0 boards" is
 * a claim, and the loading and empty branches below already say the true thing.
 */
export function InsightsScope({ data }: { data: Boards | null | undefined }) {
  if (!data || data.boards.length === 0) return null
  const earliest = data.boards.reduce(
    (min, board) => (board.puzzleDay < min ? board.puzzleDay : min),
    data.boards[0].puzzleDay,
  )
  return (
    <p className="text-muted-foreground mb-4 ml-8 text-xs" data-testid="insights-scope">
      {data.boards.length} {data.boards.length === 1 ? 'board' : 'boards'} · since{' '}
      {formatMonthLabel(monthOf(earliest))}
    </p>
  )
}

/**
 * EXPORTED SO IT CAN BE RENDERED IN A TEST, and safe to export where the ROUTED
 * component is not. src/routes.test.ts pins the distinction: the vite plugin
 * declines to code-split a route file whose routed identifier is also exported,
 * and silently — but a sibling export is fine, which is why login-error.tsx
 * exports LoginErrorPage. `InsightsRoute` above must stay unexported.
 *
 * Acceptance criterion 5 needs a real render: that Layer 1 appears for a FREE
 * player on their first board, with the CC BY 4.0 credit visible.
 */
export function InsightsPanel({
  benchmark,
  data,
  onATeam,
  teamParam,
  month,
}: {
  benchmark: InsightsBenchmark
  data: Boards
  /** `undefined` until getMyTeams resolves — the upsell withholds rather than guessing. */
  onATeam: boolean | undefined
  /**
   * `?team=` and `?month=`, HANDED DOWN TO TeamSection RATHER THAN READ THERE.
   * TeamSection cannot call `Route.useSearch()` for itself: this panel is
   * rendered directly by src/routes/-insights.hook.test.ts, whose
   * @tanstack/react-router mock replaces `createFileRoute` with a function that
   * returns its own options object, so `Route` in that file is that options
   * object and carries no hooks at all — a `Route.useSearch()` inside
   * TeamSection would throw in every test that renders this panel.
   *
   * BOTH OPTIONAL, for the same reason they are undefined in the route: nothing
   * fills them in until the post-hydration effect above navigates. TeamSection
   * renders nothing at all in that window — it does NOT show the no-team card,
   * which would be a false statement to a player who has a team; see its guards.
   */
  teamParam?: string
  month?: string
}) {
  const credit = benchmarkCredit(benchmark)
  const upsell = upsellFor({
    layer1: data.access.layer1,
    layer2: data.access.layer2,
    layer3: data.access.layer3,
    boardCount: data.boards.length,
    onATeam,
  })

  /*
    THE SUMMARIES LEAD AND THE DAY-BY-DAY LIST FOLLOWS, which is the reverse of how
    this shipped and is a correction rather than a preference. A pro player holds
    up to 400 boards, so rendering one card each ABOVE the summaries buried both
    of the panels they actually pay for under roughly four hundred screens of
    scroll. Reported by the owner: "Your Team and Your History are buried below
    miles of daily insights."

    The order is the same for a free player, whose list is one board, so nothing
    branches on tier here — the daily section is simply last, and bounded.
  */
  return (
    <div className="space-y-3">
      {data.access.layer2 === 'full' && (
        <>
          {/*
            THE THIN STATE IS A DESIGNED ONE, NOT A FAILURE — see isThin's own
            comment: Layer 2 is empty for 368 of 392 accounts and that is
            expected. It used to live inside PersonalHistory, which owned all
            three of "insights-personal", "insights-personal-thin" and
            "insights-months"; PersonalHistory is now deleted (OpenersPanel and
            TrendPanel took the first and third of those testids over, and
            PersonalSummary's Card now also answers to "insights-personal" —
            see that component's own comment) and this is the one branch of it
            that had nowhere else to go, since the tier check it depends on
            (`data.access.layer2 === 'full'`) already lives here.
          */}
          {isThin(data.boards) ? (
            <Card data-testid="insights-personal-thin">
              <CardContent className="pt-6">
                <UnlockPrompt
                  what="Your history"
                  need={MIN_BOARDS_FOR_STATS}
                  have={data.boards.length}
                  unit="boards"
                  value="your opening repertoire, your streaks and how your scores move month to month"
                  testId="insights-personal-thin-prompt"
                />
              </CardContent>
            </Card>
          ) : (
            <>
              <PersonalSummary boards={data.boards} />
              {/* SAME GATE AS PersonalSummary, FOR THE SAME REASON:
                  openerRepertoire and difficultySplit both happily compute
                  over a couple of boards, and a repertoire of one opener or a
                  difficulty split drawn from two days is worse than no panel
                  at all. */}
              <OpenersPanel benchmark={benchmark} boards={data.boards} />
              <TrendPanel boards={data.boards} />
            </>
          )}
        </>
      )}

      <TeamSection layer3={data.access.layer3} teamParam={teamParam} month={month} />

      <DailyBenchmark benchmark={benchmark} data={data} />

      {/* A CARD, NOT A MUTED LINE ABOVE THE FOOTER. The string is unchanged and
          upsellFor is untouched — placement and conversion copy belong to
          wordle-teams-iht. What changes is only this page's visual state, which
          is what wty4.1.11 owns. THE ACCENT BORDER IS WHAT SEPARATES IT FROM AN
          UnlockPrompt: this one asks for money, and an unlock prompt asks for
          play, which is why those are deliberately muted. */}
      {upsell && (
        <Card className="border-accent-solid/40">
          <CardContent className="pt-6 text-sm" data-testid="insights-upsell">
            {upsell}
          </CardContent>
        </Card>
      )}

      {/*
        ATTRIBUTION IS AN OBLIGATION, NOT A COURTESY. CC BY 4.0 requires credit
        where the data is shown, so it renders on the surface itself and is read
        OUT OF THE ARTIFACT rather than written here — a credit hardcoded beside
        the data it credits is a credit that can drift from it. The release and
        snapshot ids ride along because the difficulty numbers are revised
        between snapshots, so "which numbers were these" is a real question.
      */}
      <footer className="text-muted-foreground border-t pt-3 text-xs" data-testid="insights-attribution">
        Benchmark data from{' '}
        <a className="underline" href="https://www.fiveletterwords.io/data">
          {credit.attribution}
        </a>
        , licensed{' '}
        <a className="underline" href={credit.licenceUrl}>
          {credit.licence}
        </a>
        . Difficulty snapshot {credit.snapshotId}.
      </footer>
    </div>
  )
}

/**
 * Layer 3, for the team and month the URL names.
 *
 * STILL ONE TEAM AND ONE MONTH AT A TIME, BUT NO LONGER THE FIRST TEAM AND THIS
 * MONTH. This comment used to record the opposite — that a picker for either
 * belonged with the paywall placement work and not here — and that deferral is
 * over: `?team=` and `?month=` choose them now, settled by InsightsRoute's
 * effect above and handed down as props. Nothing about the views themselves
 * changed; they always read whatever (team, month) they were given.
 *
 * THE PARAM IS RESOLVED AGAINST THE ROSTER HERE RATHER THAN TRUSTED. `teamParam`
 * is a string anybody can type, and the effect that corrects a foreign or stale
 * one runs a render behind the URL. Looking the id up in getMyTeams means
 * `teamMonth` is only ever asked for a team the viewer is actually on, so a
 * bookmark for a team they have since left renders nothing for the moment before
 * the effect corrects it, rather than throwing NOT_A_MEMBER out of Convex —
 * requireTeamMemberFor throws
 * that for a team that does not exist as well as for one that is not yours (see
 * convex/insights.ts's own note on why the membership check comes first).
 *
 * `today` IS STILL READ FROM THE CLOCK HERE, AND ONLY `today`. The month came
 * from `monthOf(today)` before and comes from `?month=` now, but the daily fact
 * is a fact about TODAY and so has no month to choose. It stays the viewer's own
 * day, never the server's — Convex runs in UTC and "what day is it" is a
 * question about the viewer's calendar; that is the rule winners.ts states for
 * the celebration dialog and the reason puzzleDay exists at all. A consequence
 * worth knowing: with a PAST month selected, `today` is not in that month's
 * aggregate, so dailyTeamFact returns 'no-board' and DailyTeamFact renders
 * nothing — which is the honest answer to "how did you do today" asked of
 * August.
 */
function TeamSection({
  layer3,
  teamParam,
  month,
}: {
  layer3: 'none' | 'free' | 'full'
  teamParam: string | undefined
  month: string | undefined
}) {
  const { data: teams } = useQuery(convexQuery(api.teams.getMyTeams, {}))
  const selected = teams?.find((team) => team.id === teamParam)
  const teamId = selected?.id
  const teamName = selected?.name
  const today = toPuzzleDay(new Date())

  /*
    'skip' IS THE ONLY THING THAT ACTUALLY STOPS THIS QUERY, WHICH IS WHY THE
    `enabled` THAT USED TO SIT BESIDE IT IS GONE RATHER THAN WIDENED TO COVER THE
    MONTH. @convex-dev/react-query opens the Convex watch from the query CACHE's
    `added` event (ConvexQueryClient#subscribeInner), which TanStack fires for a
    disabled query too. That handler ignores keys that are not Convex queries at
    all, and then, for one that is, bails on exactly one thing: a query key whose
    args are the string 'skip'. It never consults `enabled`. Measured at
    the websocket on this project — under `enabled` alone the browser still sent
    ModifyQuerySet and took a refusal back, and the refusal is invisible in the
    console because the adapter writes it into query state instead of throwing.

    BOTH HALVES HAVE TO BE RESOLVED, not just the team. `month` arrives from the
    URL and is `undefined` until the route's post-hydration effect fills it in,
    so a team-only check would issue a read with no month at all. A month that is
    shaped right but outside the team's window needs no guard of its own, unlike
    the team: `teamMonth` finds no aggregate row for it and returns `stats: null`,
    which is the same "nobody played this month" the panels already state, and
    the effect replaces it on the next pass anyway.
  */
  const { data } = useQuery(
    convexQuery(api.insights.teamMonth, teamId && month ? { teamId, month } : 'skip'),
  )

  /*
    THREE STATES, THREE LINES, AND THEY MUST NOT BE FOLDED INTO FEWER. The
    original defect (wordle-teams-wty4.1.11.8) was one shared `!teamId || !data`
    guard rendering an unexplained blank for a player on no team. Taking the team
    from `?team=` opened a SECOND door onto the same conflation, because a
    missing `teamId` now means either "this player has no team" or "we do not
    know which team yet" — so the question NoTeamCard answers is asked of the
    ROSTER, never of `teamId`.

    NOBODY TO SHOW — `teams` has loaded and is EMPTY. A state, not a wait: the
    player has nothing here to load, ever, until they act, and that is common
    enough (a v1 migrant can have left every team) that wordle-teams-wty4.1.11.8
    requires it be said rather than silently absent. See no-team-card.tsx's own
    comment on why it is a card with a link, not an UnlockPrompt with a bar.

    WE DO NOT KNOW YET — `teams` is still in flight, or `?team=` has not been
    settled by the effect above, or it names a team this player has left. THE
    NO-TEAM CARD WOULD BE A FALSE STATEMENT IN ALL THREE: it tells a player who
    has teams that they have none and links them away to go join one. So this
    renders nothing. It closes on its own within a render or two — the roster
    lands, the effect navigates — and it deliberately gets no spinner or skeleton
    of its own: nothing is what the loading frame below has always rendered here,
    and a spinner that flashes for two renders is worse than nothing at all.

    NO DATA YET, with a real `teamId` — the loading frame it always was:
    `teamMonth` is in flight and resolves shortly. Not a state worth narrating,
    so it renders nothing, exactly as it always did.

    THE FREE SLICE IS COVERED BY THE SAME THREE LINES. DailyTeamFact is only
    reached with `data` in hand, so a free player mid-resolution sees nothing
    rather than an empty or a wrong fact card.
  */
  if (teams !== undefined && teams.length === 0) return <NoTeamCard />
  if (!teamId) return null
  if (!data) return null

  /*
    THE FREE SLICE IS A DIFFERENT COMPONENT, NOT A CUT-DOWN PANEL. The spec pins
    the free tier to one daily fact rather than a reduced version of the paid
    surface, so there is nothing here to "unlock" — the two render different
    things from the same one aggregate read.
  */
  if (layer3 !== 'full') {
    return <DailyTeamFact stats={data.stats} viewerId={data.viewerId} today={today} />
  }

  return <TeamPanel data={data} teamName={teamName} />
}

