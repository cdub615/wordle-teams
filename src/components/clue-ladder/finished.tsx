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
  lockedAtClue: number
  answer: Order
  lockedOrder: Order
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
  const others = possibleAtLockIn.filter((order) => orderKey(order) !== orderKey(lockedOrder))

  return (
    <section className={cn('flex flex-col gap-6', className)}>
      <h2 className="text-2xl font-bold">{status === 'solved' ? `Solved on clue ${lockedAtClue}` : 'X'}</h2>

      <div className="flex flex-col gap-2">
        <ShapeRow order={answer} label="Answer" />
        {status === 'failed' && <ShapeRow order={lockedOrder} label="Your order" className="opacity-70" />}
      </div>

      <ol aria-label="Orders still possible after each clue" className="flex flex-wrap items-center gap-x-2 gap-y-1 tabular-nums">
        {ladder.map((count, i) => (
          <li
            key={i}
            data-count={count}
            data-locked={i === lockedAtClue || undefined}
            className={cn('flex items-center gap-2', i === lockedAtClue && 'font-bold underline')}
          >
            {i > 0 && <span aria-hidden="true">→</span>}
            {count}
            {i === lockedAtClue && <span className="sr-only"> (you locked in here)</span>}
          </li>
        ))}
      </ol>

      {possibleAtLockIn.length > 1 && (
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
