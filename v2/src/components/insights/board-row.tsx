import { Badge } from '#/components/ui/badge.tsx'
import { formatDayHeaderParts } from '#/lib/format-day.ts'
import { benchmarkFor, difficultySentence, openerRankSentence } from '#/lib/insights-panel.ts'
import type { InsightsBenchmark } from '#/lib/insights-benchmark.ts'
import { attemptsFor } from '../../../convex/lib/board.ts'
import { MiniBoard } from './mini-board.tsx'

/**
 * One board in the day-by-day list — the app's SIGNATURE COMPONENT finally
 * appearing on the page about board performance.
 *
 * REPLACES A NESTED CARD. `BoardCard` used to render two lines of text inside
 * its own `<Card>`, itself sitting inside the day-by-day list's `<Card>`,
 * itself sitting inside that list's scroll container — three borders to say
 * one thing. This is a plain row instead: the real board via `MiniBoard`, the
 * day and the score beside it, then the opener and difficulty sentences below.
 *
 * `data-testid="insights-board"` STAYS ON THIS ELEMENT, unchanged from
 * `BoardCard`. Sixteen existing assertions across -insights.hook.test.ts key
 * off it, and every absent-state wording below is copied verbatim from that
 * component for the same reason — see benchmarkFor's own comment on why a
 * missing benchmark rendering as a confident zero is the one bug this whole
 * panel exists to avoid.
 */
export function BoardRow({
  benchmark,
  board,
}: {
  benchmark: InsightsBenchmark
  board: { puzzleDay: string; guesses: string[]; answer?: string }
}) {
  const result = benchmarkFor(benchmark, board)
  const { weekday, ordinal } = formatDayHeaderParts(board.puzzleDay)

  /*
    THE SENTINEL NEVER REACHES THE SCREEN. attemptsFor (convex/lib/board.ts)
    returns 7 for a board that used all six rows without landing on the
    answer, and nobody takes seven guesses at a five-letter word. 'X' is v1's
    own convention for exactly this case — see lib/wordle.ts's scoreCell,
    which scores-table.tsx already renders it through — so this row matches
    the app's existing spelling of "failed" rather than inventing a second
    one. `board.answer ?? ''` matches every other call site of attemptsFor in
    this codebase (insights-personal.ts, teamStats.ts, scoring.ts): a board
    with no answer can never equal it, so it is scored on guess count alone
    and never lands on the sentinel by accident.
  */
  const attempts = attemptsFor(board.guesses, board.answer ?? '')
  const score = attempts === 7 ? 'X' : String(attempts)

  return (
    <div className="flex items-start gap-3 py-1" data-testid="insights-board">
      <MiniBoard guesses={board.guesses} answer={board.answer} />
      <div className="min-w-0 flex-1 space-y-1 text-sm">
        <div className="flex items-baseline justify-between gap-2">
          <span className="font-medium">
            {weekday} {ordinal}
          </span>
          {/*
            THE TEXT A SCREEN READER ACTUALLY GETS. MiniBoard is aria-hidden
            BY DESIGN, on the premise that "the score sits beside it as real
            text" (see that component's own comment) — this span is that
            text, so it must never be hidden, decorative, or dropped in
            favour of an image.
          */}
          <span className="text-muted-foreground shrink-0 tabular-nums">{score}/6</span>
        </div>

        <div>
          <span className="text-muted-foreground">Opener </span>
          {result.opener ? (
            <>
              <span className="font-medium">{result.opener.word}</span>{' '}
              <Badge variant="secondary">{openerRankSentence(result.opener)}</Badge>
            </>
          ) : (
            /* A2's absent state, copied verbatim from BoardCard. NEVER a zero
               — 'ranks 0th' reads as a real and extreme result, and 26 of our
               boards have an opener the corpus does not hold. */
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
            /* Copied verbatim from BoardCard. The common miss rather than an
               edge case: the corpus publishes only globally completed days,
               so today never has a row. */
            <span className="text-muted-foreground">not rated yet</span>
          )}
        </div>
      </div>
    </div>
  )
}
