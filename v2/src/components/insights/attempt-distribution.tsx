import { cn } from '#/lib/utils.ts'
import type { DistributionRow } from '#/lib/insights-personal.ts'

/**
 * The statistic every Wordle player already knows how to read.
 *
 * A LIST, NOT A CHART. Each row is a real `li` carrying its label and its count
 * as text, so a screen reader gets the distribution rather than a decorative
 * div. The bars are presentation on top of that, not a replacement for it.
 *
 * SCALED AGAINST THE LARGEST ROW, NOT THE TOTAL. Against the total, a player
 * with an even spread gets seven stubs and the shape disappears; the question a
 * distribution answers is which outcome is most common, which is a comparison
 * between rows.
 *
 * COLOUR IS NEVER THE ONLY CARRIER. The modal row is also the longest bar and
 * its count is the emphasised one, so the accent is reinforcement.
 */
export function AttemptDistribution({ rows }: { rows: DistributionRow[] }) {
  const max = Math.max(...rows.map((row) => row.count), 1)

  return (
    <div>
      <h3 className="text-muted-foreground mb-2 text-xs font-semibold tracking-wide uppercase">
        Distribution
      </h3>
      <ul className="space-y-1" data-testid="insights-distribution">
        {rows.map((row) => (
          <li
            key={row.label}
            className="flex items-center gap-2"
            data-testid={`insights-distribution-${row.label}`}
          >
            <span
              className={cn('w-2 text-xs font-semibold', row.label === 'X' && 'text-muted-foreground')}
            >
              {row.label}
            </span>
            <div className="flex-1">
              <div
                className={cn(
                  'h-3.5 rounded-sm motion-safe:transition-[width]',
                  row.isModal ? 'bg-accent-solid' : 'bg-muted',
                )}
                style={{ width: `${Math.round((row.count / max) * 100)}%` }}
                data-testid={`insights-distribution-${row.label}-fill`}
              />
            </div>
            <span
              className={cn(
                'w-8 text-right text-xs tabular-nums',
                row.isModal ? 'text-foreground font-semibold' : 'text-muted-foreground',
              )}
            >
              {row.count}
            </span>
          </li>
        ))}
      </ul>
    </div>
  )
}
