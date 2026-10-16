import { convexQuery, useConvexMutation } from '@convex-dev/react-query'
import { useMutation, useQuery } from '@tanstack/react-query'
import { Link } from '@tanstack/react-router'
import { useEffect, useRef, useState } from 'react'
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
import { useScratchSaver } from './use-scratch-saver.ts'

/**
 * The play page's state and server calls (spec sections 4 and 6).
 *
 * OPENING THE PAGE STARTS THE GAME. The dashboard card's Play button is the
 * start, so the page calls start once per date when it finds the game not
 * started. start is idempotent, so a second call (React's dev double effect, a
 * second tab) changes nothing.
 *
 * WRITERS GET THE DAY `today` ANSWERED FOR, not the client's clock. The query
 * falls back to the server's day when the client's is implausible (a clock two
 * days off), but the writers refuse such a day with INVALID_DATE. Sending the
 * play's own date keeps the page and the server on the same day; the writers
 * still validate it. Every writer runs after `today` has answered, since nothing
 * renders a button before it.
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
export function ClueLadderPlayPage({ team }: { team?: string }) {
  const hydrated = useHydrated()
  // The player's own day, read once hydrated: the server render has no clock of theirs.
  const clientDay = hydrated ? toPuzzleDay(new Date()) : null
  const { data } = useQuery(convexQuery(api.clueLadder.today, clientDay ? { today: clientDay } : 'skip'))
  const day = data?.enabled ? data.play.date : clientDay

  const start = useMutation({ mutationFn: useConvexMutation(api.clueLadder.start) })
  const nextClue = useMutation({ mutationFn: useConvexMutation(api.clueLadder.nextClue) })
  const lockIn = useMutation({ mutationFn: useConvexMutation(api.clueLadder.lockIn) })
  const saveScratch = useConvexMutation(api.clueLadder.saveScratch)
  const saver = useScratchSaver((scratch) =>
    day ? saveScratch({ today: day, scratch: [...scratch] }) : Promise.resolve(),
  )

  const [slots, setSlots] = useState<Slots | null>(null)
  const [exhausted, setExhausted] = useState(false)
  // From the Lock in click until lockIn settles. Not lockIn.isPending: that is
  // still false while the scratch is flushed first, when a second tap could
  // otherwise send a second lockIn.
  const [locking, setLocking] = useState(false)
  const status = data?.enabled ? data.play.status : null

  const startedFor = useRef<string | null>(null)
  const startGame = start.mutate
  useEffect(() => {
    if (day === null || status !== 'not-started' || startedFor.current === day) return
    startedFor.current = day
    startGame(
      { today: day },
      { onError: (error) => toast.error(mutationErrorMessage(error, "Couldn't start today's clue ladder.")) },
    )
  }, [day, status, startGame])

  if (day === null || data === undefined) return <Skeleton className="h-96 w-full" />

  const back = (
    <Button variant="outline" asChild>
      <Link to="/app" search={{ team }}>
        Back to team scores
      </Link>
    </Button>
  )

  if (!data.enabled) {
    return (
      <div className="flex flex-col gap-4">
        <p>The clue ladder isn't on for any of your teams.</p>
        {back}
      </div>
    )
  }

  const play = data.play
  const board = slots ?? (play.status === 'not-started' ? EMPTY_SLOTS : play.scratch)
  const failed = (fallback: string) => (error: unknown) => toast.error(mutationErrorMessage(error, fallback))

  const onLockIn = async (order: Order) => {
    setLocking(true)
    try {
      await saver.flush()
      await lockIn.mutateAsync({ today: day, order: [...order] })
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
      pending={locking || start.isPending || nextClue.isPending}
      onSlotsChange={(next) => {
        setSlots(next)
        saver.schedule(next)
      }}
      onNextClue={() =>
        nextClue.mutate(
          // The count on screen, so a double tap reveals one clue (nextClueFor).
          { today: day, expectedRevealed: play.status === 'playing' ? play.cluesRevealed : 0 },
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
      actions={back}
    />
  )
}
