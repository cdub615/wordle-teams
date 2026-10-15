import type { ReactNode } from 'react'
import type { Shape } from '../../../convex/lib/clueLadder/orders.ts'
import { cn } from '#/lib/utils.ts'

/** Lower case, because they are read inside sentences ("Answer: star, circle, …"). */
export const SHAPE_NAMES: Readonly<Record<Shape, string>> = {
  triangle: 'triangle',
  square: 'square',
  circle: 'circle',
  diamond: 'diamond',
  star: 'star',
}

const OUTLINES: Readonly<Record<Shape, ReactNode>> = {
  triangle: <polygon points="12,3 21,20 3,20" />,
  square: <rect x="4" y="4" width="16" height="16" />,
  circle: <circle cx="12" cy="12" r="8.5" />,
  diamond: <polygon points="12,2.5 21.5,12 12,21.5 2.5,12" />,
  star: <polygon points="12,2.5 14.9,8.6 21.5,9.3 16.6,13.8 18,20.4 12,17 6,20.4 7.4,13.8 2.5,9.3 9.1,8.6" />,
}

/**
 * One shape, drawn as an outline in the current text colour. SHAPES DIFFER BY
 * OUTLINE, NEVER BY COLOUR (spec section 6), so the game reads the same to a
 * colour-blind player and in either theme.
 */
export function ShapeIcon({
  shape,
  decorative = false,
  className,
}: {
  shape: Shape
  /** True when a parent already announces the shape, as ShapeRow and the board's buttons do. */
  decorative?: boolean
  className?: string
}) {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={2}
      strokeLinejoin="round"
      className={cn('size-6', className)}
      {...(decorative ? { 'aria-hidden': true } : { role: 'img', 'aria-label': SHAPE_NAMES[shape] })}
    >
      {OUTLINES[shape]}
    </svg>
  )
}

/** A full or partial order, announced once as a sentence rather than shape by shape. */
export function ShapeRow({
  order,
  label,
  className,
}: {
  order: ReadonlyArray<Shape>
  label: string
  className?: string
}) {
  return (
    <div
      role="img"
      aria-label={`${label}: ${order.map((shape) => SHAPE_NAMES[shape]).join(', ')}`}
      className={cn('flex gap-1', className)}
    >
      {order.map((shape, i) => (
        <ShapeIcon key={i} shape={shape} decorative />
      ))}
    </div>
  )
}
