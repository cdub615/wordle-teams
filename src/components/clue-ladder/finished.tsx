import type { ReactNode } from 'react'
import { ALL_ORDERS, orderKey, type Order } from '../../../convex/lib/clueLadder/orders.ts'
import { Button } from '#/components/ui/button.tsx'
import { cn } from '#/lib/utils.ts'
import { ShapeRow } from './shape-icon.tsx'

/**
 * The day's explanation (spec section 6). The ladder shows how each clue cut
 * the possible orders, so a player who locked in early can see what the next
 * clue would have settled, and the odds they took.
 */
export function ClueLadderFinished({
  status,
  lockedAtClue,
  answer,
  lockedOrder,
  remaining,
  possibleAtLockIn,
  shareText,
  onShare,
  actions,
  className,
}: {
  status: 'solved' | 'failed'
  /** Absent when the play ran out of time without locking in. */
  lockedAtClue?: number
  answer: Order
  /** Absent when the play ran out of time without locking in. */
  lockedOrder?: Order
  /** Orders still possible after each clue, in clue order; the last is 1. */
  remaining: ReadonlyArray<number>
  /** The orders that fit every clue revealed at lock-in. Includes the answer. */
  possibleAtLockIn: ReadonlyArray<Order>
  shareText: string
  onShare: () => void
  /** The caller's own buttons, such as back to team scores. */
  actions?: ReactNode
  className?: string
}) {
  const ladder = [ALL_ORDERS.length, ...remaining]
  const locked = lockedOrder !== undefined && lockedAtClue !== undefined
  // lockIn accepts any full order, so an X can name an order the clues had already ruled out.
  const fit = locked && possibleAtLockIn.some((order) => orderKey(order) === orderKey(lockedOrder))
  const others = locked ? possibleAtLockIn.filter((order) => orderKey(order) !== orderKey(lockedOrder)) : []

  return (
    <section className={cn('flex flex-col gap-6', className)}>
      {status === 'solved' ? (
        <h2 className="text-2xl font-bold">Solved on clue {lockedAtClue}</h2>
      ) : (
        <h2 aria-label="X: not solved" className="text-2xl font-bold">
          X
        </h2>
      )}
      {!locked && status === 'failed' && <p>Time ran out.</p>}

      <div className="flex flex-col gap-2">
        <ShapeRow order={answer} label="Answer" />
        {status === 'failed' && lockedOrder && <ShapeRow order={lockedOrder} label="Your order" className="opacity-70" />}
      </div>

      <ol aria-label="Orders still possible after each clue" className="flex flex-wrap items-center gap-x-2 gap-y-1 tabular-nums">
        {ladder.map((count, i) => (
          <li
            key={i}
            data-count={count}
            data-locked={(locked && i === lockedAtClue) || undefined}
            className={cn('flex items-center gap-2', locked && i === lockedAtClue && 'font-bold underline')}
          >
            {i > 0 && <span aria-hidden="true">→</span>}
            <span className="sr-only">{i === 0 ? 'Start: ' : `After clue ${i}: `}</span>
            {count}
            {locked && i === lockedAtClue && <span> (you locked in)</span>}
          </li>
        ))}
      </ol>

      {locked && !fit && (
        <div className="flex flex-col gap-2">
          <p>Your order didn&rsquo;t fit the clues you had.</p>
          {possibleAtLockIn.length === 1 ? (
            <ShapeRow order={possibleAtLockIn[0]} label="The order that fit was" />
          ) : (
            <>
              <p>The orders that fit were:</p>
              {possibleAtLockIn.map((order) => (
                <ShapeRow key={orderKey(order)} order={order} label="A possible order" />
              ))}
            </>
          )}
        </div>
      )}

      {fit && possibleAtLockIn.length > 1 && (
        <div className="flex flex-col gap-2">
          <p>You had a 1 in {possibleAtLockIn.length} chance.</p>
          {others.length === 1 ? (
            <ShapeRow order={others[0]} label="The other was" />
          ) : (
            <>
              <p>The others were:</p>
              {others.map((order) => (
                <ShapeRow key={orderKey(order)} order={order} label="Another possible order" />
              ))}
            </>
          )}
        </div>
      )}

      <div className="flex flex-col gap-2">
        <p className="rounded-md border p-3 font-mono text-sm">{shareText}</p>
        <Button type="button" onClick={onShare}>
          Share
        </Button>
        {actions}
      </div>
    </section>
  )
}
