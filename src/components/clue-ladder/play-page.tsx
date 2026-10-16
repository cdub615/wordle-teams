import { convexQuery, useConvexMutation } from '@convex-dev/react-query'
import { useMutation, useQuery } from '@tanstack/react-query'
import { Link } from '@tanstack/react-router'
import { useCallback, useEffect, useRef, useState, type ReactNode } from 'react'
import { toast } from 'sonner'
import { Button } from '#/components/ui/button.tsx'
import { Skeleton } from '#/components/ui/skeleton.tsx'
import { EMPTY_SLOTS, type Slots } from '#/lib/clue-ladder-board.ts'
import { convexErrorCode, mutationErrorMessage } from '#/lib/convex-error.ts'
import { shareText } from '#/lib/share-link.ts'
import { useHydrated } from '#/lib/use-hydrated.ts'
import { api } from '../../../convex/_generated/api'
import type { Order } from '../../../convex/lib/clueLadder/orders.ts'
import { toPuzzleDay } from '../../../convex/lib/puzzleDay.ts'
import { ClueLadderPlayView } from './play-view.tsx'
import type { ClueLadderTodayView } from './today.ts'
import { useScratchSaver } from './use-scratch-saver.ts'

/**
 * The play page's state and server calls (spec sections 4 and 6).
 *
 * OPENING THE PAGE STARTS THE GAME. The dashboard card's Play button is the
 * start, so the page calls start once per date when it finds the game not
 * started. start is idempotent, so a second call (React's dev double effect, a
 * second tab) changes nothing. A failed start says so and offers Try again,
 * which goes through the same once-per-date guard, so a double tap sends one.
 *
 * A NEW DAY IS A NEW BODY. Everything that belongs to one day's play (the
 * board, `exhausted`, `locking`, the batched saves) lives in PlayBody, keyed by
 * the play's date. Past midnight the live query answers for the new day, the
 * old body unmounts, and the saver's unmount flush sends its last move to the
 * day it was made on: that body never renders again, so its save still names
 * the old date. On a rollover the page starts the new day automatically, like
 * opening it (departure 5).
 *
 * WRITERS GET THE DAY `today` ANSWERED FOR, not the client's clock. The query
 * falls back to the server's day when the client's is implausible (a clock two
 * days off), but the writers refuse such a day with INVALID_DATE. Sending the
 * play's own date keeps the page and the server on the same day; the writers
 * still validate it. Every writer runs after `today` has answered, since nothing
 * renders a button before it.
 *
 * ONE LIVE STATUS LINE. The status region is in place from the first render, so
 * "Setting out today's shapes…" replacing "Loading" is announced; a region that
 * arrives already holding its text often is not.
 */
export function ClueLadderPlayPage({ team }: { team?: string }) {
  const hydrated = useHydrated()
  // The player's own day, read once hydrated: the server render has no clock of theirs.
  const clientDay = hydrated ? toPuzzleDay(new Date()) : null
  const { data } = useQuery(convexQuery(api.clueLadder.today, clientDay ? { today: clientDay } : 'skip'))
  const day = data?.enabled ? data.play.date : clientDay
  const status = data?.enabled ? data.play.status : null

  const start = useMutation({ mutationFn: useConvexMutation(api.clueLadder.start) })
  // The day whose start last failed. Set only in onError, cleared by Try again.
  const [failedFor, setFailedFor] = useState<string | null>(null)
  const startedFor = useRef<string | null>(null)
  const startGame = start.mutate
  const startOnce = useCallback(
    (today: string) => {
      if (startedFor.current === today) return
      startedFor.current = today
      startGame(
        { today },
        {
          onError: (error) => {
            // Forgotten, so Try again (or the answer coming back) can start it again.
            startedFor.current = null
            setFailedFor(today)
            toast.error(mutationErrorMessage(error, "Couldn't start today's clue ladder."))
          },
        },
      )
    },
    [startGame],
  )
  useEffect(() => {
    if (day !== null && status === 'not-started') startOnce(day)
  }, [day, status, startOnce])

  const back = (
    <Button variant="outline" asChild>
      <Link to="/app" search={{ team }}>
        Back to dashboard
      </Link>
    </Button>
  )

  const loading = day === null || data === undefined
  const startFailed = failedFor !== null && failedFor === day
  let line: string | null = null
  if (data && !data.enabled) line = "The clue ladder isn't available right now."
  else if (status === 'not-started') line = startFailed ? "Couldn't set out today's shapes." : "Setting out today's shapes…"

  return (
    // No gap here: the status region is empty during play and must not leave one.
    <div className="flex flex-col">
      <div role="status">
        {loading ? (
          <Skeleton className="h-96 w-full">
            <span className="sr-only">Loading</span>
          </Skeleton>
        ) : (
          line !== null && <p className="mb-4 text-muted-foreground">{line}</p>
        )}
      </div>
      {!loading && !data.enabled && back}
      {!loading && data.enabled && (
        <PlayBody
          key={data.play.date}
          play={data.play}
          startFailed={startFailed}
          onRetry={() => {
            setFailedFor(null)
            startOnce(data.play.date)
          }}
          actions={back}
        />
      )}
    </div>
  )
}

/**
 * One day's play: its board, its calls, its batched saves. Keyed by the date,
 * so nothing here outlives the day (see A NEW DAY IS A NEW BODY above).
 *
 * THE BOARD IS LOCAL ONCE TOUCHED. Until the first move it shows the server's
 * scratch, so a game resumes on any device; after that the server copy trails
 * it through useScratchSaver. A server scratch arriving under the board is safe:
 * the board drops a stale tray selection when `slots` changes from outside.
 *
 * LOCK IN FOLLOWS THE HOUSE ConfirmPopover PATTERN (plan 2's controls).
 * Confirming calls onLockIn and the popover stays open, showing `pending`, from
 * the click until lockIn settles, including while the waiting scratch is
 * flushed first. On success `today` turns finished and the view swaps to the
 * finished screen, which unmounts the controls and the popover with them. On
 * failure the popover stays open and the error shows as a toast through
 * mutationErrorMessage. So nothing here closes the popover by hand.
 *
 * ALREADY_FINISHED FROM lockIn IS NOT A FAILURE. It means an earlier tap (or a
 * second tab) already locked in, and `today` is about to show the result.
 */
function PlayBody({
  play,
  startFailed,
  onRetry,
  actions,
}: {
  play: ClueLadderTodayView
  startFailed: boolean
  onRetry: () => void
  actions: ReactNode
}) {
  const nextClue = useMutation({ mutationFn: useConvexMutation(api.clueLadder.nextClue) })
  const lockIn = useMutation({ mutationFn: useConvexMutation(api.clueLadder.lockIn) })
  const saveScratch = useConvexMutation(api.clueLadder.saveScratch)
  const saver = useScratchSaver((scratch) => saveScratch({ today: play.date, scratch: [...scratch] }))

  const [slots, setSlots] = useState<Slots | null>(null)
  const [exhausted, setExhausted] = useState(false)
  // From the Lock in click until lockIn settles. Not lockIn.isPending: that is
  // still false while the scratch is flushed first, when a second tap could
  // otherwise send a second lockIn.
  const [locking, setLocking] = useState(false)

  const board = slots ?? (play.status === 'not-started' ? EMPTY_SLOTS : play.scratch)
  const failed = (fallback: string) => (error: unknown) => toast.error(mutationErrorMessage(error, fallback))

  const onLockIn = async (order: Order) => {
    setLocking(true)
    try {
      await saver.flush()
      await lockIn.mutateAsync({ today: play.date, order: [...order] })
    } catch (error) {
      if (convexErrorCode(error) !== 'ALREADY_FINISHED') failed("Couldn't lock in. Try again.")(error)
    } finally {
      setLocking(false)
    }
  }

  return (
    <ClueLadderPlayView
      play={play}
      slots={board}
      exhausted={exhausted}
      pending={locking || nextClue.isPending}
      startFailed={startFailed}
      onRetry={onRetry}
      onSlotsChange={(next) => {
        setSlots(next)
        saver.schedule(next)
      }}
      onNextClue={() =>
        nextClue.mutate(
          // The count on screen, so a double tap reveals one clue (nextClueFor).
          { today: play.date, expectedRevealed: play.status === 'playing' ? play.cluesRevealed : 0 },
          {
            onSuccess: (result) => {
              if (result.noMoreClues) setExhausted(true)
            },
            onError: failed("Couldn't show the next clue."),
          },
        )
      }
      onLockIn={(order) => void onLockIn(order)}
      onShare={(text) => {
        void shareText({ title: 'Clue ladder', text })
          .then((outcome) => {
            if (outcome === 'copied') toast.success('Copied. Paste it to your team.')
            if (outcome === 'unavailable') toast.error("This browser can't share or copy.")
          })
          .catch(() => toast.error("Couldn't share."))
      }}
      actions={actions}
    />
  )
}
