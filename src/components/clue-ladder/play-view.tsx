import type { ReactNode } from 'react'
import { filledOrder, type Slots } from '#/lib/clue-ladder-board.ts'
import { clueLadderShareText } from '#/lib/clue-ladder-share.ts'
import type { Order } from '../../../convex/lib/clueLadder/orders.ts'
import { ClueLadderBoard } from './board.tsx'
import { ClueLadderControls } from './controls.tsx'
import { ClueLadderFinished } from './finished.tsx'
import type { ClueLadderTodayView } from './today.ts'

/**
 * The play page's body, one branch per state of today's game (spec section 6).
 * Pure: play-page.tsx owns the queries, the mutations and the batched saves, so
 * this is tested with plain props.
 */
export function ClueLadderPlayView({
  play,
  slots,
  exhausted,
  pending,
  onSlotsChange,
  onNextClue,
  onLockIn,
  onShare,
  actions,
}: {
  play: ClueLadderTodayView
  slots: Slots
  /** True once nextClue has answered noMoreClues. The ladder's length is otherwise hidden. */
  exhausted: boolean
  pending: boolean
  onSlotsChange: (slots: Slots) => void
  onNextClue: () => void
  onLockIn: (order: Order) => void
  onShare: (text: string) => void
  /** The caller's own buttons under the result, such as back to team scores. */
  actions?: ReactNode
}) {
  if (play.status === 'not-started') {
    return (
      <p role="status" className="text-muted-foreground">
        Setting out today's shapes…
      </p>
    )
  }

  if (play.status === 'playing') {
    const order = filledOrder(slots)
    return (
      <div className="flex flex-col gap-6">
        <ClueLadderBoard slots={slots} onChange={onSlotsChange} disabled={pending} />
        <ClueLadderControls
          clues={play.clues}
          canRevealMore={!exhausted}
          canLockIn={order !== null}
          pending={pending}
          onNextClue={onNextClue}
          onLockIn={() => {
            if (order) onLockIn(order)
          }}
        />
      </div>
    )
  }

  const shareLine = clueLadderShareText(play)
  return (
    <ClueLadderFinished
      // today serves only the current date, so a finished play always locked in;
      // plan 2's { status: 'timedOut' } never comes from here.
      result={{ status: play.status, lockedAtClue: play.lockedAtClue, lockedOrder: play.lockedOrder }}
      answer={play.answer}
      remaining={play.remaining}
      possibleAtLockIn={play.possibleAtLockIn}
      shareText={shareLine}
      onShare={() => onShare(shareLine)}
      actions={actions}
    />
  )
}
