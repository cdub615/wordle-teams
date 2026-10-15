import { useState } from 'react'
import type { Shape } from '../../../convex/lib/clueLadder/orders.ts'
import { Button } from '#/components/ui/button.tsx'
import { clearSlot, placeShape, trayShapes, type Slots } from '#/lib/clue-ladder-board.ts'
import { cn } from '#/lib/utils.ts'
import { SHAPE_NAMES, ShapeIcon } from './shape-icon.tsx'

/**
 * Five slots above a tray of the shapes not yet placed. Tap a shape, then a
 * slot. TAP ONLY: drag is a follow-up (plan 2's departure 1), since HTML drag
 * does not work on phones and this is built phone first.
 *
 * Controlled: the caller owns `slots` (plan 3 saves them as the play's scratch).
 * This component owns only which tray shape is picked up.
 */
export function ClueLadderBoard({
  slots,
  onChange,
  disabled = false,
  className,
}: {
  slots: Slots
  onChange: (slots: Slots) => void
  disabled?: boolean
  className?: string
}) {
  const [selected, setSelected] = useState<Shape | null>(null)

  // A parent may change `slots` under us; drop a pick that is no longer in the tray.
  if (selected && !trayShapes(slots).includes(selected)) setSelected(null)

  const tapSlot = (index: number) => {
    if (selected) {
      onChange(placeShape(slots, selected, index))
      setSelected(null)
    } else if (slots[index]) {
      onChange(clearSlot(slots, index))
    }
  }

  return (
    <div className={cn('flex flex-col items-center gap-6', className)}>
      <div role="group" aria-label="Your order" className="flex gap-2">
        {slots.map((shape, i) => (
          <Button
            key={i}
            type="button"
            variant="outline"
            disabled={disabled}
            aria-label={`Slot ${i + 1}, ${shape ? SHAPE_NAMES[shape] : 'empty'}`}
            className="size-14 border-2 border-dashed p-0 data-[filled=true]:border-solid"
            data-filled={shape !== null}
            onClick={() => tapSlot(i)}
          >
            {shape && <ShapeIcon shape={shape} decorative className="size-8" />}
          </Button>
        ))}
      </div>
      <div role="group" aria-label="Shapes to place" className="flex min-h-14 gap-2">
        {trayShapes(slots).map((shape) => (
          <Button
            key={shape}
            type="button"
            variant={selected === shape ? 'default' : 'secondary'}
            disabled={disabled}
            aria-label={SHAPE_NAMES[shape]}
            aria-pressed={selected === shape}
            className="size-14 p-0"
            onClick={() => setSelected(selected === shape ? null : shape)}
          >
            <ShapeIcon shape={shape} decorative className="size-8" />
          </Button>
        ))}
      </div>
    </div>
  )
}
