import { Badge } from '#/components/ui/badge.tsx'
import { Card, CardContent, CardHeader, CardTitle } from '#/components/ui/card.tsx'
import type { InsightsBenchmark } from '#/lib/insights-benchmark.ts'
import { openerRankSentence } from '#/lib/insights-panel.ts'
import {
  MIN_BOARDS_PER_BAND,
  difficultySplit,
  headlineComparison,
  openerAdvice,
  openerRepertoire,
  type OpenerRow,
  type PersonalBoard,
} from '#/lib/insights-personal.ts'
import { WordTiles } from './mini-board.tsx'
import { UnlockPrompt } from './unlock-prompt.tsx'

/**
 * The two sentences this whole page exists to say, plus the repertoire that
 * backs them up.
 *
 * THE JOIN LEADS, THE ADVICE FOLLOWS IT, AND THE LIST COMES LAST. What shipped
 * before stated a player's two most-used openers' averages as flat body text
 * and left the reader to do the subtraction themselves — "4.6 with MUSIC and
 * 3.9 with CRANE" is two facts, not a conclusion. `openerAdvice` already does
 * that subtraction and gates it behind a real sample size
 * (MIN_OPENER_USES_FOR_ADVICE in insights-personal.ts), so printing its answer
 * is not a UI embellishment — it is the one sentence on this page that turns a
 * pair of numbers into a decision. THIS CALLOUT IS THE ONLY ACCENT ANYWHERE IN
 * THE CARD, deliberately: everything else here — the difficulty line, the
 * repertoire bars — states a fact, and only the advice states a recommendation
 * worth drawing the eye to.
 *
 * ONE CARD, NOT THREE. PersonalHistory used to own the headline and the
 * repertoire as two of its own testids; this component takes both over so the
 * join, the advice and the list read as one continuous argument rather than
 * three panels a reader has to piece together. Deleting the old blocks from
 * PersonalHistory (not just adding these here) is what routes/insights.tsx's
 * plan requires — see that file's diff — because `insights-headline` and
 * `insights-repertoire` are ids, and two elements sharing one throws in
 * `getByTestId` the moment both render (this already happened once on this
 * page with `insights-personal`).
 */
export function OpenersPanel({
  benchmark,
  boards,
}: {
  benchmark: InsightsBenchmark
  boards: PersonalBoard[]
}) {
  const repertoire = openerRepertoire(boards, benchmark.openers)
  const headline = headlineComparison(repertoire)
  const advice = openerAdvice(repertoire)
  const split = difficultySplit(boards, benchmark.difficulty)
  const shown = repertoire.slice(0, 8)
  // SCALED AGAINST THE WORST MEAN IN THE SHOWN LIST, NOT A FIXED 6. Against a
  // fixed ceiling every player's bars would sit in the same narrow band near
  // the left edge — nobody averages close to six guesses — and the whole point
  // of a bar here is to let two of the player's OWN openers be compared with
  // each other at a glance.
  const worstMean = Math.max(...shown.map((row) => row.meanAttempts), 1)

  return (
    <Card data-testid="insights-openers">
      <CardHeader className="pb-2">
        <CardTitle className="text-base">Your openers</CardTitle>
      </CardHeader>
      <CardContent className="space-y-4 text-sm">
        {headline && (
          <p
            className="border-accent-solid bg-muted rounded-r-md border-l-[3px] px-3 py-2"
            data-testid="insights-headline"
          >
            You have opened with <span className="font-medium">{headline.most.word}</span>{' '}
            {headline.most.count} times.{' '}
            {headline.most.rank !== null && (
              <>
                It ranks{' '}
                {openerRankSentence({
                  word: headline.most.word,
                  rank: headline.most.rank,
                  outOf: benchmark.openers.count,
                })}
                .{' '}
              </>
            )}
            You average {headline.most.meanAttempts} guesses with it and{' '}
            {headline.other.meanAttempts} with{' '}
            <span className="font-medium">{headline.other.word}</span>.{' '}
            {/*
              THE CONCLUSION, NOT JUST THE TWO INPUTS TO IT. `advice` is null
              whenever headlineComparison's own `other` opener has not been used
              enough to trust a recommendation drawn from it (see
              MIN_OPENER_USES_FOR_ADVICE), or the saving would round to zero or
              go negative — every one of those is a case where staying silent
              is more honest than a sentence with nothing behind it.
            */}
            {advice && (
              <>
                Opening <span className="font-medium">{advice.to}</span> instead would save you
                about <span className="text-accent-solid font-semibold">{advice.savingPerDay}</span>{' '}
                guesses a day.
              </>
            )}
          </p>
        )}

        {/*
          THE ONE INSIGHT THE CORPUS CAN PRODUCE THAT A PLAYER CANNOT COMPUTE
          ABOUT THEMSELVES. Everything else in this card compares the player
          against their own history; this compares them against the corpus's
          per-day difficulty percentiles, which live nowhere on the player's
          own device. difficultySplit's own comment records why an unrated day
          (the common case — the corpus publishes only globally completed days)
          is dropped from both bands rather than defaulted into "rest".
        */}
        {split.kind === 'ready' ? (
          <p data-testid="insights-difficulty-split">
            You average {split.hard} on days the world found hard, and {split.rest} on the rest.
          </p>
        ) : (
          <UnlockPrompt
            what="Your difficulty breakdown"
            need={MIN_BOARDS_PER_BAND}
            // WHICHEVER BAND IS ACTUALLY SHORT, NOT hardBoards UNCONDITIONALLY.
            // A player can be thin on "rest" (an unusually hard run of days)
            // just as easily as thin on "hard", and the floor is the same
            // MIN_BOARDS_PER_BAND for both — so the progress shown has to track
            // whichever count is further from it.
            have={Math.min(split.hardBoards, split.restBoards)}
            unit={split.hardBoards <= split.restBoards ? 'hard days' : 'ordinary days'}
            value="how you score when the world struggles"
            testId="insights-unlock-difficulty"
          />
        )}

        <div data-testid="insights-repertoire">
          <ul className="space-y-2">
            {shown.map((row) => (
              <RepertoireRow
                key={row.word}
                row={row}
                worstMean={worstMean}
                outOf={benchmark.openers.count}
              />
            ))}
          </ul>
        </div>
      </CardContent>
    </Card>
  )
}

function RepertoireRow({
  row,
  worstMean,
  outOf,
}: {
  row: OpenerRow
  worstMean: number
  outOf: number
}) {
  const pct = Math.round((row.meanAttempts / worstMean) * 100)

  return (
    <li className="flex flex-col gap-1.5 md:flex-row md:items-center md:gap-3">
      <div className="flex shrink-0 items-center gap-2">
        {/*
          UNCOLOURED, ON PURPOSE — see WordTiles' own comment. An opener used 41
          times has 41 different colourings and there is no correct one to show
          here; MiniBoard (which DOES colour) is for a single board, not a
          repertoire entry.
        */}
        <WordTiles word={row.word} />
        <Badge variant={row.rank === null ? 'outline' : 'secondary'}>
          {row.rank === null ? 'unranked' : `#${row.rank.toLocaleString()}`}
        </Badge>
        {/*
          A BADGE READS AS "#4,102" TO ASSISTIVE TECH, NOT AS A SENTENCE. This
          used to reach screen readers as openerRankSentence's full "4,102nd of
          14,855" — moving the rank into a Badge for sighted readers must not
          silently take that away from anyone using one. The visible Badge is
          NOT aria-hidden (a short, real value is still worth exposing), so this
          span is a supplement, not a replacement.
        */}
        <span className="sr-only">
          {row.rank === null
            ? `${row.word} is not in the benchmark set`
            : openerRankSentence({ word: row.word, rank: row.rank, outOf })}
        </span>
        <span className="text-muted-foreground text-xs tabular-nums">{row.count}x</span>
      </div>

      <div className="flex flex-1 items-center gap-2">
        <div className="bg-muted h-2 min-w-0 flex-1 overflow-hidden rounded-full">
          <div
            className="bg-muted-foreground h-full rounded-full motion-safe:transition-[width]"
            style={{ width: `${pct}%` }}
          />
        </div>
        <span className="w-8 text-right text-xs tabular-nums">{row.meanAttempts}</span>
      </div>
    </li>
  )
}
