import { createFileRoute, redirect, Link } from '@tanstack/react-router'
import { convexQuery } from '@convex-dev/react-query'
import { useQuery } from '@tanstack/react-query'
import { ArrowLeft } from 'lucide-react'
import { useEffect, useState } from 'react'
import { Button } from '#/components/ui/button.tsx'
import { Card, CardContent, CardHeader, CardTitle } from '#/components/ui/card.tsx'
import { Skeleton } from '#/components/ui/skeleton.tsx'
import { benchmarkCredit, loadInsightsBenchmark } from '#/lib/insights-benchmark.ts'
import type { InsightsBenchmark } from '#/lib/insights-benchmark.ts'
import {
  ALL,
  benchmarkFor,
  boardsForLayer1,
  difficultySentence,
  filterBoards,
  monthOptionsFor,
  openerOptionsFor,
  openerRankSentence,
  upsellFor,
} from '#/lib/insights-panel.ts'
import {
  attemptsByMonth,
  consistency,
  headlineComparison,
  isThin,
  openerRepertoire,
  streaks,
} from '#/lib/insights-personal.ts'
import { formatMonthLabel } from '#/lib/format-day'
import { formatDayHeaderParts } from '#/lib/format-day'
import { DailyTeamFact } from '#/components/insights/daily-team-fact.tsx'
import { TeamPanel } from '#/components/insights/team-panel.tsx'
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

  return (
    <div className="mx-auto w-full max-w-2xl p-4">
      <div className="mb-4 flex items-center gap-2">
        <Button variant="ghost" size="sm" asChild>
          <Link to="/app">
            <ArrowLeft className="mr-1 h-4 w-4" aria-hidden="true" />
            Back
          </Link>
        </Button>
        <h1 className="text-xl font-semibold">Insights</h1>
      </div>

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
        <InsightsPanel benchmark={benchmark!} data={data} />
      )}
    </div>
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
export function InsightsPanel({ benchmark, data }: { benchmark: InsightsBenchmark; data: Boards }) {
  const credit = benchmarkCredit(benchmark)
  const upsell = upsellFor({ layer1: data.access.layer1, boardCount: data.boards.length })

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
        <PersonalHistory benchmark={benchmark} boards={data.boards} />
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
 * Layer 2 — the player's own history, and the join that is the product.
 *
 * THE COMPARISON IS THE HEADLINE AND IT LEADS. "You have opened with MUSIC 41
 * times. It ranks 4,102nd. You average 4.6 guesses with it and 3.9 with CRANE" is
 * the sentence the spec says no other product can say, so it is a sentence at the
 * top rather than a rank column in the table below it.
 */
function PersonalHistory({
  benchmark,
  boards,
}: {
  benchmark: InsightsBenchmark
  boards: { puzzleDay: string; guesses: string[]; answer?: string }[]
}) {
  /*
    THIN IS A DESIGNED STATE, NOT A FAILURE. The spec is explicit that Layer 2 is
    empty for 368 of 392 accounts and that this is acceptable — the players with
    real history are the willingness-to-pay population. A mean over one board and
    a streak of one would look like a product with nothing to say, rather than one
    waiting for data.
  */
  if (isThin(boards)) {
    return (
      <Card data-testid="insights-personal-thin">
        <CardContent className="text-muted-foreground pt-6 text-sm">
          Enter a few more boards and we will show you your opening repertoire,
          your streaks and how your scores move month to month.
        </CardContent>
      </Card>
    )
  }

  const repertoire = openerRepertoire(boards, benchmark.openers)
  const headline = headlineComparison(repertoire)
  const runs = streaks(boards)
  const spread = consistency(boards)
  const months = attemptsByMonth(boards)

  return (
    <Card data-testid="insights-personal">
      <CardHeader className="pb-2">
        <CardTitle className="text-base">Your history</CardTitle>
      </CardHeader>
      <CardContent className="space-y-4 text-sm">
        {headline && (
          <p data-testid="insights-headline">
            You have opened with <span className="font-medium">{headline.most.word}</span>{' '}
            {headline.most.count} times.{' '}
            {headline.most.rank !== null && (
              <>It ranks {openerRankSentence({ ...headline.most, rank: headline.most.rank, outOf: benchmark.openers.count })}. </>
            )}
            You average {headline.most.meanAttempts} guesses with it and{' '}
            {headline.other.meanAttempts} with{' '}
            <span className="font-medium">{headline.other.word}</span>.
          </p>
        )}

        <dl className="grid grid-cols-2 gap-2" data-testid="insights-consistency">
          <Stat label="Average guesses" value={String(spread.meanAttempts)} />
          <Stat label="Consistency (±)" value={String(spread.spread)} />
          <Stat label="Current streak" value={String(runs.current)} />
          <Stat label="Longest streak" value={String(runs.longest)} />
          <Stat label="Solved" value={String(spread.solved)} />
          <Stat label="Missed" value={String(spread.failed)} />
        </dl>

        <div data-testid="insights-repertoire">
          <h3 className="mb-1 font-medium">Your openers</h3>
          <ul className="space-y-1">
            {repertoire.slice(0, 8).map((row) => (
              <li key={row.word} className="flex justify-between gap-2">
                <span className="font-medium">{row.word}</span>
                <span className="text-muted-foreground">
                  {row.count}x · avg {row.meanAttempts} ·{' '}
                  {row.rank === null
                    ? 'unranked'
                    : openerRankSentence({ word: row.word, rank: row.rank, outOf: benchmark.openers.count })}
                </span>
              </li>
            ))}
          </ul>
        </div>

        <div data-testid="insights-months">
          <h3 className="mb-1 font-medium">By month</h3>
          <ul className="space-y-1">
            {months.map((row) => (
              <li key={row.month} className="flex justify-between gap-2">
                <span>{formatMonthLabel(row.month)}</span>
                <span className="text-muted-foreground">
                  {row.boards} boards · avg {row.meanAttempts}
                </span>
              </li>
            ))}
          </ul>
        </div>
      </CardContent>
    </Card>
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
  // The viewer's own day and month, never the server's — Convex runs in UTC and
  // "today" is a question about the viewer's calendar.
  const today = toPuzzleDay(new Date())
  const month = monthOf(today)

  const { data } = useQuery({
    ...convexQuery(api.insights.teamMonth, teamId ? { teamId, month } : 'skip'),
    enabled: teamId !== undefined,
  })

  // A player on no team has no team analytics, which is a state rather than a
  // failure — and a common one, since a v1 migrant can have left every team.
  if (!teamId || !data) return null

  /*
    THE FREE SLICE IS A DIFFERENT COMPONENT, NOT A CUT-DOWN PANEL. The spec pins
    the free tier to one daily fact rather than a reduced version of the paid
    surface, so there is nothing here to "unlock" — the two render different
    things from the same one aggregate read.
  */
  if (layer3 !== 'full') {
    return <DailyTeamFact stats={data.stats} viewerId={data.viewerId} today={today} />
  }

  return <TeamPanel data={data} />
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <dt className="text-muted-foreground text-xs">{label}</dt>
      <dd className="font-medium">{value}</dd>
    </div>
  )
}

/**
 * Layer 1's day-by-day list — bounded, scrollable, and filterable.
 *
 * BOUNDED HEIGHT IS THE POINT. Four hundred cards is not a list anybody reads; it
 * is a wall that pushes everything else off the page. Inside its own scroll
 * container it occupies a fixed, predictable slice of the screen however much
 * history sits behind it, so the sections below stay reachable.
 *
 * THE FILTERS ONLY APPEAR WHEN THERE IS SOMETHING TO FILTER. A free player has one
 * board and a trialist sees one; two selects above a single row would be furniture
 * that explains nothing.
 *
 * `overflow-y-auto` NEEDS AN EXPLICIT max-height to do anything, and the count
 * below the box is what tells a reader the list continues past the fold — a
 * scroll container with no such cue reads as a short list on a touch device,
 * where there is no visible scrollbar until you drag it.
 */
function DailyBenchmark({
  benchmark,
  data,
}: {
  benchmark: InsightsBenchmark
  data: Boards
}) {
  // NOT data.boards: the query returns full history whenever Layer 2 is unlocked,
  // and the trial unlocks Layer 2 WITHOUT Layer 1. See boardsForLayer1.
  const visible = boardsForLayer1(data.boards, data.access.layer1)
  const [month, setMonth] = useState(ALL)
  const [opener, setOpener] = useState(ALL)

  const months = monthOptionsFor(visible)
  const openers = openerOptionsFor(visible)
  const shown = filterBoards(visible, { month, opener })
  const filterable = visible.length > 1

  return (
    <Card data-testid="insights-daily">
      <CardHeader className="pb-2">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <CardTitle className="text-base">Day by day</CardTitle>
          {filterable && (
            <div className="flex gap-2">
              <select
                aria-label="Filter by month"
                className="bg-background rounded border px-2 py-1 text-xs"
                value={month}
                onChange={(event) => setMonth(event.target.value)}
                data-testid="insights-filter-month"
              >
                <option value={ALL}>All months</option>
                {months.map((value) => (
                  <option key={value} value={value}>
                    {formatMonthLabel(value)}
                  </option>
                ))}
              </select>
              <select
                aria-label="Filter by opener"
                className="bg-background rounded border px-2 py-1 text-xs"
                value={opener}
                onChange={(event) => setOpener(event.target.value)}
                data-testid="insights-filter-opener"
              >
                <option value={ALL}>All openers</option>
                {openers.map((value) => (
                  <option key={value} value={value}>
                    {value}
                  </option>
                ))}
              </select>
            </div>
          )}
        </div>
      </CardHeader>
      <CardContent>
        {shown.length === 0 ? (
          <p className="text-muted-foreground text-sm" data-testid="insights-daily-none">
            No boards match those filters.
          </p>
        ) : (
          <div className="max-h-[26rem] space-y-2 overflow-y-auto pr-1" data-testid="insights-daily-scroll">
            {shown.map((board) => (
              <BoardCard key={board.puzzleDay} benchmark={benchmark} board={board} />
            ))}
          </div>
        )}
        {filterable && (
          <p className="text-muted-foreground pt-2 text-xs" data-testid="insights-daily-count">
            Showing {shown.length} of {visible.length} boards
          </p>
        )}
      </CardContent>
    </Card>
  )
}

function BoardCard({
  benchmark,
  board,
}: {
  benchmark: InsightsBenchmark
  board: { puzzleDay: string; guesses: string[] }
}) {
  const result = benchmarkFor(benchmark, board)
  const { weekday, ordinal } = formatDayHeaderParts(board.puzzleDay)

  return (
    <Card data-testid="insights-board">
      <CardHeader className="pb-2">
        <CardTitle className="text-base">
          {weekday} {ordinal}
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-2 text-sm">
        <div>
          <span className="text-muted-foreground">Opener </span>
          {result.opener ? (
            <>
              <span className="font-medium">{result.opener.word}</span>
              <span className="text-muted-foreground"> ranks </span>
              <span className="font-medium">{openerRankSentence(result.opener)}</span>
            </>
          ) : (
            /* A2's absent state. NEVER a zero — 'ranks 0th' reads as a real and
               extreme result, and 26 of our boards have an opener the corpus
               does not hold. */
            <span className="text-muted-foreground">is not in the benchmark set</span>
          )}
        </div>
        <div>
          <span className="text-muted-foreground">Difficulty: </span>
          {result.difficulty ? (
            <>
              <span className="font-medium">{result.difficulty.label}</span>
              <span className="text-muted-foreground"> — {difficultySentence(result.difficulty)}</span>
            </>
          ) : (
            /* The common miss rather than an edge case: the corpus publishes
               only globally completed days, so today never has a row. */
            <span className="text-muted-foreground">not rated yet</span>
          )}
        </div>
      </CardContent>
    </Card>
  )
}
