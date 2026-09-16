import { createFileRoute, redirect, Link } from '@tanstack/react-router'
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
import { isThin, MIN_BOARDS_FOR_STATS } from '#/lib/insights-personal.ts'
import { formatMonthLabel } from '#/lib/format-day'
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

export const Route = createFileRoute('/insights')({
  head: () => ({ meta: [{ title: pageTitle('Insights') }] }),
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
  */
  const { data: teams } = useQuery(convexQuery(api.teams.getMyTeams, {}))

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

type Boards = {
  access: {
    layer1: 'none' | 'free' | 'full'
    layer2: 'none' | 'free' | 'full'
    layer3: 'none' | 'free' | 'full'
  }
  boards: { puzzleDay: string; guesses: string[]; answer?: string }[]
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
}: {
  benchmark: InsightsBenchmark
  data: Boards
  /** `undefined` until getMyTeams resolves — the upsell withholds rather than guessing. */
  onATeam: boolean | undefined
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

      <TeamSection layer3={data.access.layer3} />

      <DailyBenchmark benchmark={benchmark} data={data} />

      {upsell && (
        <p className="text-muted-foreground text-sm" data-testid="insights-upsell">
          {upsell}
        </p>
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
 * Layer 3, for the viewer's first team and the current month.
 *
 * ONE TEAM AND THIS MONTH, WHICH IS A SCOPE DECISION RATHER THAN AN OVERSIGHT.
 * The spec's Layer 3 is "six view types multiplied by teammates and months", and
 * a picker for both is a surface of its own — it belongs with the paywall
 * placement work (wordle-teams-iht) that owns how this is navigated, not here.
 * What this task owed was that every view reads the aggregate and that the empty
 * cases are stated, and both hold for any (team, month) the picker later passes.
 *
 * THE MONTH IS RESOLVED IN THE VIEWER'S OWN ZONE, never on the server: "this
 * month" is a question about the viewer's calendar and Convex runs in UTC. That
 * is the same rule winners.ts states for the celebration dialog, and the reason
 * puzzleDay exists at all.
 */
function TeamSection({ layer3 }: { layer3: 'none' | 'free' | 'full' }) {
  const { data: teams } = useQuery(convexQuery(api.teams.getMyTeams, {}))
  const teamId = teams?.[0]?.id
  const teamName = teams?.[0]?.name
  // The viewer's own day and month, never the server's — Convex runs in UTC and
  // "today" is a question about the viewer's calendar.
  const today = toPuzzleDay(new Date())
  const month = monthOf(today)

  const { data } = useQuery({
    ...convexQuery(api.insights.teamMonth, teamId ? { teamId, month } : 'skip'),
    enabled: teamId !== undefined,
  })

  /*
    THE GUARD IS SPLIT ON PURPOSE — the two conditions it used to share
    (`!teamId || !data`) mean different things and must not render the same
    thing. "No team" is a STATE: the player has nothing here to load, ever,
    until they act, and that is common enough (a v1 migrant can have left
    every team) that wordle-teams-wty4.1.11.8 requires it be said rather than
    silently absent — see no-team-card.tsx's own comment on why it is a card
    with a link, not an UnlockPrompt with a bar. "No data yet" with a real
    `teamId` is a LOADING FRAME: `teamMonth` is still in flight, and it will
    resolve on this same render pass shortly — that is not a state worth
    narrating, so it renders nothing, exactly as it always did.
  */
  if (!teamId) return <NoTeamCard />
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

