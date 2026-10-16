import type { ReactNode } from 'react'
import { ALL_ORDERS, orderKey, type Order } from '../../../convex/lib/clueLadder/orders.ts'
import { Button } from '#/components/ui/button.tsx'
import { cn } from '#/lib/utils.ts'
import { ShapeRow } from './shape-icon.tsx'

/**
 * How the play ended. A solve or an X always names the clue and the order the
 * player locked in; a play that ran out of time has neither, so it is its own
 * case and the type cannot describe a solve without them.
 */
export type ClueLadderResult =
  | { status: 'solved'; lockedAtClue: number; lockedOrder: Order }
  | { status: 'failed'; lockedAtClue: number; lockedOrder: Order }
  | { status: 'timedOut' }

/**
 * Orders listed by name at most (owner decision, 2026-10-15). A lock-in on
 * clue 1 can leave dozens possible, and a screen of rows says less than a count.
 */
export const LISTED_ORDERS = 6

function OrderRows({ orders, label }: { orders: ReadonlyArray<Order>; label: string }) {
  const listed = orders.slice(0, LISTED_ORDERS)
  const rest = orders.length - listed.length
  return (
    <>
      {listed.map((order) => (
        <ShapeRow key={orderKey(order)} order={order} label={label} />
      ))}
      {rest > 0 && <p className="text-sm text-muted-foreground">{`and ${rest} more`}</p>}
    </>
  )
}

/**
 * The day's explanation (spec section 6). The ladder shows how each clue cut
 * the possible orders, so a player who locked in early can see what the next
 * clue would have settled, and the odds they took.
 */
export function ClueLadderFinished({
  result,
  answer,
  remaining,
  possibleAtLockIn,
  shareText,
  onShare,
  actions,
  className,
}: {
  result: ClueLadderResult
  answer: Order
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
  const lockedAtClue = result.status === 'timedOut' ? undefined : result.lockedAtClue
  const lockedOrder = result.status === 'timedOut' ? undefined : result.lockedOrder
  // lockIn accepts any full order, so an X can name an order the clues had already ruled out.
  const fit = lockedOrder !== undefined && possibleAtLockIn.some((order) => orderKey(order) === orderKey(lockedOrder))
  const others = lockedOrder !== undefined ? possibleAtLockIn.filter((order) => orderKey(order) !== orderKey(lockedOrder)) : []

  return (
    <section className={cn('flex flex-col gap-6', className)}>
      {result.status === 'solved' ? (
        <h2 className="text-2xl font-bold">Solved on clue {lockedAtClue}</h2>
      ) : (
        <h2 aria-label="X: not solved" className="text-2xl font-bold">
          X
        </h2>
      )}
      {result.status === 'timedOut' && <p>Time ran out.</p>}

      <div className="flex flex-col gap-2">
        <ShapeRow order={answer} label="Answer" />
        {result.status === 'failed' && <ShapeRow order={result.lockedOrder} label="Your order" className="opacity-70" />}
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
            <span className="sr-only">{i === 0 ? 'Start: ' : `After clue ${i}: `}</span>
            {count}
            {i === lockedAtClue && <span> (you locked in)</span>}
          </li>
        ))}
      </ol>

      {lockedOrder !== undefined && !fit && (
        <div className="flex flex-col gap-2">
          <p>Your order didn&rsquo;t fit the clues you had.</p>
          {possibleAtLockIn.length === 1 ? (
            <ShapeRow order={possibleAtLockIn[0]} label="The order that fit was" />
          ) : (
            <>
              <p>The orders that fit were:</p>
              <OrderRows orders={possibleAtLockIn} label="A possible order" />
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
              <OrderRows orders={others} label="Another possible order" />
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
