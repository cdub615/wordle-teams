import { useEffect, useRef, useState } from 'react'
import { Loader2 } from 'lucide-react'
import { toast } from 'sonner'
import { convexQuery, useConvexMutation } from '@convex-dev/react-query'
import { useMutation, useSuspenseQuery } from '@tanstack/react-query'
import type { FormEventHandler, KeyboardEvent, KeyboardEventHandler } from 'react'
import { api } from '../../../convex/_generated/api'
import { Button } from '#/components/ui/button.tsx'
import { Label } from '#/components/ui/label.tsx'
import { DatePicker } from '#/components/date-picker.tsx'
import { BoardInput } from './board-input.tsx'
import { pickDefaultDay } from './pick-default-day.ts'
import { boardErrorMessage } from '#/lib/convex-error.ts'
import { cn } from '#/lib/utils.ts'
import { boardIsValid, toRows } from '../../../convex/lib/board.ts'
import { toPuzzleDay } from '../../../convex/lib/puzzleDay.ts'
import type { Id } from '../../../convex/_generated/dataModel'
import type { FunctionReturnType } from 'convex/server'

const EMPTY_ROWS = ['', '', '', '', '', '']

/**
 * One month of the caller's own scores.
 *
 * Derived from getMyMonth's return type rather than written out, so the two
 * queries that feed this form cannot drift apart silently: getMyMonth exists
 * precisely to emit the shape getTeamMonthFor already emits (scores.ts:96-101),
 * and a change to either that broke the pairing would fail here at typecheck.
 */
type MyScores = FunctionReturnType<typeof api.scores.getMyMonth>

/**
 * Board entry. Ports v1's form.tsx AS IT STANDS ON dev, per amendment A3 — not
 * the version the 2026-07-16 design was written against.
 *
 * The three behaviours a335ae8 added, which a faithful port of the older code
 * would have regressed:
 *   1. handleSubmit is wrapped in try/catch
 *   2. setSubmitting(false) runs in `finally`, so the form can never be left
 *      stuck mid-submit
 *   3. the sheet closes ONLY on success — it used to close unconditionally and
 *      throw away everything the user had typed
 *
 * The third a335ae8 behaviour, a warning toast when the winner update failed, is
 * designed out rather than dropped: the winner write shares upsertBoard's
 * transaction, so the board landing while the standings go stale is no longer a
 * reachable state.
 *
 * OWNS NO QUERY, deliberately. Everything below this line is the form exactly
 * as it was; what moved out is the pair of reads that used to sit at the top,
 * because they are the ONLY part of board entry that ever needed a team. See
 * BoardEntryForm at the bottom of this file for why that had to become a
 * component boundary rather than a condition.
 */
function BoardEntryFields({
  myScores,
  playWeekends,
  month,
  onSuccess,
}: {
  myScores: MyScores
  playWeekends: boolean
  month: string
  onSuccess: () => void
}) {
  const upsert = useMutation({ mutationFn: useConvexMutation(api.scores.upsertBoard) })

  const [day, setDay] = useState<string | undefined>(undefined)
  const [answer, setAnswer] = useState('')
  const [guesses, setGuesses] = useState<Array<string>>(EMPTY_ROWS)
  const [submitting, setSubmitting] = useState(false)
  const answerRef = useRef<HTMLDivElement>(null)
  const scrollContainerRef = useRef<HTMLDivElement>(null)

  // Deferred to an effect rather than a useState initialiser: picking the
  // default day calls new Date(), and this component also renders on the server,
  // where "now" is UTC. Same reasoning as v1's team-boards.tsx.
  useEffect(() => {
    const played = new Set(myScores.map((score) => score.puzzleDay))
    setDay(
      pickDefaultDay({
        month,
        today: toPuzzleDay(new Date()),
        playedDays: played,
        playWeekends,
      }),
    )
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [month])

  // Load whatever is already stored for the selected day.
  const existing = day ? myScores.find((score) => score.puzzleDay === day) : undefined
  useEffect(() => {
    setAnswer(existing?.answer ?? '')
    setGuesses(toRows(existing?.guesses ?? []))
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [day, existing?.id])

  useEffect(() => {
    answerRef.current?.focus()
  }, [])

  const scrollActiveRowIntoView = () => {
    const active = guesses.findIndex((guess) => guess.length < 5)
    const index = active === -1 ? guesses.length - 1 : active
    // An attribute selector, not `#${id}`: wordle-board.tsx's tile ids are
    // "1-1", "2-1", etc, and a CSS ID selector cannot start with a digit —
    // querySelector('#1-1') throws SyntaxError (getElementById has no such
    // restriction, but that only searches the whole document, not this ref).
    scrollContainerRef.current
      ?.querySelector(`[id="${index + 1}-1"]`)
      ?.scrollIntoView({ block: 'nearest' })
  }

  useEffect(scrollActiveRowIntoView, [guesses])

  const submitDisabled = !day || !boardIsValid(answer, guesses, existing !== undefined)

  const handleAnswerKeyDown: KeyboardEventHandler = (event: KeyboardEvent<HTMLDivElement>) => {
    const key = event.key
    // See board-input.tsx's handleKeyDown: Ctrl/Cmd combos (paste, copy,
    // select-all, ...) must not be swallowed as plain letters — Ctrl+V's
    // keydown carries event.key === 'v' with no modifier check otherwise.
    if (key === 'Tab' || event.ctrlKey || event.metaKey) return
    event.preventDefault()
    if (key === 'Backspace') {
      setAnswer((current) => current.slice(0, -1))
      return
    }
    const isLetter = key.length === 1 && /[a-zA-Z]/.test(key)
    if (isLetter) setAnswer((current) => (current.length < 5 ? current + key.toUpperCase() : current))
  }

  const handleSubmit: FormEventHandler<HTMLFormElement> = async (event) => {
    event.preventDefault()
    if (!day) return
    // The `disabled` attribute alone is not a re-entrancy guard — it only
    // takes effect once React commits the re-render, and a fast double-tap
    // can land both clicks inside that window and fire two concurrent
    // upsertBoard mutations. This check is synchronous, before any `await`.
    if (submitting) return
    setSubmitting(true)

    try {
      await upsert.mutateAsync({
        puzzleDay: day,
        answer,
        guesses,
        // The submitter's own local today; the server has no viewer to ask.
        today: toPuzzleDay(new Date()),
      })
      toast.success('Successfully saved board')
      // ONLY on success. A failed submit used to close the sheet too, throwing
      // away everything the user had typed.
      onSuccess()
    } catch (error) {
      // Reaching here means the mutation failed: one of our typed codes, or —
      // the case that matters — a dropped mobile connection or a platform error.
      // Without this the promise rejected, setSubmitting(false) never ran, and
      // the form sat spinning forever with the board silently lost.
      console.error('Board submission failed before it could be saved', error)
      toast.error(boardErrorMessage(error))
    } finally {
      // Always runs, so the form can never be left stuck mid-submit.
      setSubmitting(false)
    }
  }

  return (
    <form
      onSubmit={handleSubmit}
      className={cn('flex min-h-0 flex-1 flex-col', submitting && 'animate-pulse')}
    >
      <div className="ml-2 flex w-full shrink-0 items-center space-x-4 md:px-4">
        <div className="flex w-[54%] flex-col md:w-full">
          <Label htmlFor="wordle-board-date" className="mb-2 text-xs sm:text-sm">
            Wordle Date
          </Label>
          <DatePicker
            day={day}
            onSelect={setDay}
            playWeekends={playWeekends}
            tabIndex={1}
          />
        </div>
        <div className="flex w-[30%] flex-col space-y-2 md:w-full">
          <Label htmlFor="answer" className="text-xs sm:text-sm">
            Wordle Answer
          </Label>
          <div
            id="answer"
            ref={answerRef}
            contentEditable
            suppressContentEditableWarning
            tabIndex={2}
            onKeyDown={handleAnswerKeyDown}
            // See board-input.tsx's comment: keydown alone misses paste, IME
            // commits, and mobile swipe-typing/predictive-text/dictation,
            // which insert via beforeinput with no keydown at all.
            // beforeinput (unlike input) IS cancelable.
            onBeforeInput={(event) => event.preventDefault()}
            onPaste={(event) => event.preventDefault()}
            className="flex h-10 w-full rounded-md border border-input bg-background px-2 py-2 text-base uppercase caret-transparent ring-offset-background focus:outline-none focus:ring-2 focus:ring-ring focus:ring-offset-4 md:px-3"
          >
            {answer}
          </div>
        </div>
      </div>

      <div ref={scrollContainerRef} className="min-h-0 flex-1 overflow-y-auto">
        <BoardInput
          guesses={guesses}
          setGuesses={setGuesses}
          answer={answer}
          hasExistingScore={existing !== undefined}
          submitting={submitting}
          submitDisabled={submitDisabled}
          tabIndex={3}
          onBoardFocus={scrollActiveRowIntoView}
        />
      </div>

      {/* Sticky so it pins above the mobile keyboard; hidden on desktop, where
          BoardInput renders its own submit.

          `pb-[env(safe-area-inset-bottom)]` (wordle-teams-8h2p). This row is
          the last thing in a `side="top"` Sheet whose `maxHeight` is bound to
          the visual viewport, so with the keyboard closed the sheet's bottom
          edge IS the bottom of the screen — and under `viewport-fit=cover`
          that is the physical edge, with the home indicator drawn over the
          last 34px of it. The Sheet's own `p-6` puts 24px below these buttons,
          which is not enough to clear it.

          A bare `env()`, not a `max()`: this element carries `pt-2` and no
          bottom padding at all, so its base here is 0 and the inset is purely
          additive — a `max()` against a non-zero base would move the buttons
          up on every flat screen for nothing. On iOS the inset collapses to 0
          while the software keyboard is up, which is the state where the
          sheet's bottom edge is the keyboard rather than the screen, so the
          two cases agree without a media query.

          `md:p-0` STILL WINS ON DESKTOP: it is a later, more specific-in-
          source-order padding utility than this one, and tailwind-merge keeps
          both because they are different variants. */}
      <div className="sticky bottom-0 flex w-full shrink-0 flex-row space-x-2 bg-background pb-[env(safe-area-inset-bottom)] pt-2 md:invisible md:h-0 md:p-0">
        <Button type="button" variant="outline" className="w-full" onClick={onSuccess}>
          Cancel
        </Button>
        <Button
          disabled={submitting || submitDisabled}
          aria-disabled={submitting || submitDisabled}
          type="submit"
          className="w-full"
        >
          {submitting && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
          Submit
        </Button>
      </div>
    </form>
  )
}

/**
 * Prefill for a player who HAS a team: today's reads, unchanged.
 *
 * getMyPlayerId stays here and only here. getTeamMonth returns every member's
 * scores, so this branch has to be told which row is "you"; the solo branch
 * below does not, because getMyMonth is already scoped to the caller.
 */
function TeamBoardEntryForm({
  teamId,
  month,
  onSuccess,
}: {
  teamId: Id<'teams'>
  month: string
  onSuccess: () => void
}) {
  const { data } = useSuspenseQuery(convexQuery(api.scores.getTeamMonth, { teamId, month }))
  const { data: myPlayerId } = useSuspenseQuery(convexQuery(api.scores.getMyPlayerId, {}))

  const myScores = data.players.find((player) => player.id === myPlayerId)?.scores ?? []

  return (
    <BoardEntryFields
      myScores={myScores}
      playWeekends={data.team.playWeekends}
      month={month}
      onSuccess={onSuccess}
    />
  )
}

/**
 * Prefill for a player with NO team.
 *
 * `playWeekends` is true because that is v1's default for a brand-new team —
 * create-team-dialog.tsx ships both switches on — so a team-less player sees
 * the same set of playable days they will see on the team they are about to
 * create. There is no team to ask, and picking false would disable weekends
 * for someone who never chose that.
 */
function SoloBoardEntryForm({ month, onSuccess }: { month: string; onSuccess: () => void }) {
  const { data: myScores } = useSuspenseQuery(convexQuery(api.scores.getMyMonth, { month }))

  return (
    <BoardEntryFields
      myScores={myScores}
      playWeekends={true}
      month={month}
      onSuccess={onSuccess}
    />
  )
}

/**
 * Board entry, whichever query can feed it.
 *
 * SPLIT BY DATA SOURCE, NOT BY CONDITION, and that is forced rather than
 * stylistic. The team prefill needs getTeamMonth and the team-less prefill
 * needs getMyMonth, and exactly one of them may run — but useSuspenseQuery has
 * no `enabled` option in TanStack Query v5, and a hook cannot be called
 * conditionally. Components can be, so the branch is a component boundary.
 *
 * The team path is unchanged by this: TeamBoardEntryForm makes the same two
 * calls this component used to make, in the same order.
 */
export function BoardEntryForm({
  teamId,
  month,
  onSuccess,
}: {
  teamId?: Id<'teams'>
  month: string
  onSuccess: () => void
}) {
  if (teamId === undefined) return <SoloBoardEntryForm month={month} onSuccess={onSuccess} />
  return <TeamBoardEntryForm teamId={teamId} month={month} onSuccess={onSuccess} />
}

export default BoardEntryForm
