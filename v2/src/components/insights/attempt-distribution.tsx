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
              {/* h-3.5 rounded-sm, NOT the house h-2/h-1.5 rounded-full USED
                  BY today-panel.tsx, unlock-prompt.tsx AND THIS SAME FILE'S
                  NEIGHBOUR openers-panel.tsx. That is a deliberate departure,
                  not a missed one: every one of those other bars is a FILL
                  inside a full-width bg-muted TRACK — a bounded "how far
                  toward one target" indicator, where the pill shape reads as
                  a capsule being filled. This bar has no track at all; it is
                  one row of a seven-row histogram, each bar's length an
                  independent measurement compared against the others, not a
                  share of a single bounded whole. A rounded-full cap on a
                  trackless bar that can be a few percent wide (a rare
                  outcome next to a tall modal bar) would round away into a
                  blob rather than read as a short rectangle — exactly the
                  case a bar CHART cannot afford, since relative length across
                  rows is the entire point. rounded-sm keeps every row reading
                  as a bar at any length; h-3.5, taller than the others' 6-8px,
                  gives this list — which stands alone rather than sitting
                  under other text the way the house bars do — enough visual
                  weight to carry the row on its own. */}
              {/*
                bg-muted-FOREGROUND, NOT bg-muted, AND THE DIFFERENCE IS
                VISIBILITY RATHER THAN TASTE. `--muted` resolves to
                `--surface-sunken` (#f4f4f5 light, #1c1c1c dark) and this bar
                sits on a Card, which is `--surface` (#ffffff, #121212). That
                is about 1.05:1 in light and 1.1:1 in dark — the non-modal bars
                were effectively invisible, so the chart read as one green bar
                floating in empty space. Caught in a screenshot; no test,
                typecheck, lint or build can see it.

                THE HOUSE PATTERN IS A TRACK PLUS A FILL — `bg-muted` for the
                track and `bg-muted-foreground` for the fill (see
                unlock-prompt.tsx and openers-panel.tsx). This chart has no
                track, so it must use the FILL colour; taking the track colour
                for a bar with nothing behind it is what produced the bug.
              */}
              <div
                className={cn(
                  'h-3.5 rounded-sm motion-safe:transition-[width]',
                  row.isModal ? 'bg-accent-solid' : 'bg-muted-foreground',
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
