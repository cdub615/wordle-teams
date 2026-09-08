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
  benchmarkFor,
  difficultySentence,
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
  access: { layer1: 'none' | 'free' | 'full'; layer2: 'none' | 'free' | 'full' }
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

  return (
    <div className="space-y-3">
      {data.boards.map((board) => (
        <BoardCard key={board.puzzleDay} benchmark={benchmark} board={board} />
      ))}

      {data.access.layer2 === 'full' && (
        <PersonalHistory benchmark={benchmark} boards={data.boards} />
      )}

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

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <dt className="text-muted-foreground text-xs">{label}</dt>
      <dd className="font-medium">{value}</dd>
    </div>
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
