import { useId } from 'react'
import { convexQuery } from '@convex-dev/react-query'
import { useSuspenseQuery } from '@tanstack/react-query'
import { api } from '../../convex/_generated/api'
import { Button } from '#/components/ui/button.tsx'
import { cn } from '#/lib/utils.ts'
import { SYSTEM_FIELDS, SYSTEM_FIELD_LABELS } from '../../convex/lib/scoringSystem.ts'
import type { Id } from '../../convex/_generated/dataModel'

/**
 * The team's points, as a captioned two-row grid: guess counts on top, the
 * points they earn aligned beneath (wordle-teams-5jcn.23 — the flat chip
 * strip this replaced read as `1 +5` `2 +3`, which never said what the
 * numbers MEANT).
 *
 * RENDERED AS ScoresTable's `footer` PROP (routes/app.tsx), not as its own
 * grid child with its own Suspense boundary — folding it into the
 * scores-table card is the fix for it reading as visually detached from
 * every other card on the page (the owner's screenshot feedback; see
 * dashboard-cards-design.md, which specified this all along as "a chip strip
 * attached beneath the table"). This component owns none of that frame,
 * border or horizontal padding itself — scores-table.tsx's footer wrapper
 * supplies the hairline and the padding that lines this up with the table's
 * own content, so the same component still renders correctly if some future
 * caller places it somewhere else.
 *
 * DERIVED, NEVER HAND-LISTED. Order comes from SYSTEM_FIELDS and labels from
 * SYSTEM_FIELD_LABELS, for the reason that module's own header gives: a literal
 * list compiles fine after a ninth field is added and silently never shows it.
 * `nA`'s label is "Missed day" and is deliberately NOT abbreviated even though
 * it is the longest label — it is the value a player is least likely to guess.
 *
 * THE TEAM'S ACTUAL SYSTEM, NEVER DEFAULT_SYSTEM. scoringSystem.ts exports
 * DEFAULT_SYSTEM as the value createTeam writes onto a new team, but teams
 * customise from there, and a legend showing DEFAULT_SYSTEM to a team that
 * scores differently is worse than no legend at all — so this component does
 * not import it, and reads the resolved `system` off the getTeamMonth payload
 * instead.
 *
 * NO NEW QUERY — this joins the getTeamMonth subscription callers already
 * hold, the same query scores-table.tsx reads `team.system` from.
 *
 * A `<dl>` OF LABEL/VALUE PAIRS, NOT TWO UNRELATED ROWS OF SPANS. Each field
 * is still one `dt`/`dd` pair adjacent in the DOM, so a screen reader
 * announces "1, plus 5" as a unit instead of eight labels followed by eight
 * numbers with no structural link between them — the two-row VISUAL shape
 * (label above, value below) is achieved by making each pair its own flex
 * column, not by splitting the `dt`s and `dd`s into two separate DOM rows.
 * `useId` keeps the `dl`'s `aria-labelledby` unique if this component is ever
 * rendered more than once on a page.
 *
 * WRAPS WITHOUT SCROLLING, AND STAYS ALIGNED WHEN IT DOES. The outer `dl` is
 * `flex flex-wrap`, not one CSS grid spanning all eight pairs — a fixed
 * two-row grid has nowhere to put an overflowing column except further right,
 * which is exactly what forces horizontal scroll at 390px once "Missed day"
 * is in play. Wrapping instead at the PAIR boundary (each pair is its own
 * label-over-value column) means a line that runs out of width drops whole
 * pairs to the next line rather than splitting one row across two lines.
 * Every label and value is `whitespace-nowrap` single-line text at a fixed
 * size, so every pair is the same two-row height; that is what keeps a
 * wrapped line's label row and value row flush across each other, even though
 * the columns are independent flex items rather than cells of one grid.
 */
export function ScoringLegend({
  teamId,
  month,
  isOwner,
  onEdit,
  className,
}: {
  teamId: Id<'teams'>
  month: string
  isOwner: boolean
  onEdit: () => void
  className?: string
}) {
  const labelId = useId()
  const { data } = useSuspenseQuery(convexQuery(api.scores.getTeamMonth, { teamId, month }))
  const { system } = data.team

  return (
    // gap-3 (0.75rem), matching TodayPanel's own section rhythm (`mt-3`
    // between its header row and the next block) rather than picking a new
    // value now that this sits inside the same card language every other
    // panel does.
    <div className={cn('flex flex-col gap-3', className)}>
      <div className="flex flex-wrap items-center justify-between gap-2">
        <span id={labelId} className="text-xs text-muted-foreground">
          Points per result
        </span>
        {/* CREATOR ONLY. isOwner is a prop, not a new query — team mutations
            are creator-only and enforced server-side (7a 4), so showing this
            to a member would offer an action the server refuses.
            aria-label spells out WHAT is being edited: a bare "Edit" is
            ambiguous to a screen reader user navigating a page's button list
            out of context, the same reason scoring-system-card.tsx's icon
            button carries `aria-label="Customize scoring system"` rather than
            none. */}
        {isOwner && (
          <Button
            variant="link"
            className="h-auto p-0 text-xs"
            onClick={onEdit}
            aria-label="Edit scoring system"
          >
            Edit
          </Button>
        )}
      </div>
      <dl aria-labelledby={labelId} className="m-0 flex flex-wrap gap-x-4 gap-y-2">
        {SYSTEM_FIELDS.map((field) => {
          const value = system[field]
          return (
            <div key={field} className="flex flex-col items-center gap-1">
              {/* No per-item `border-b` here (dropped — it was the one
                  underline treatment nothing else in the app uses). The
                  hairline separating this whole footer from the table above
                  (scores-table.tsx) already does the "this is a distinct
                  region" job; repeating it under every label was noise on
                  top of that. */}
              <dt className="whitespace-nowrap text-xs text-muted-foreground">
                {SYSTEM_FIELD_LABELS[field]}
              </dt>
              {/* The sign is kept, so -1 and -3 read as penalties rather than
                  as bare numbers. A leading + on positives makes the two
                  visually symmetrical; 0 stays unsigned. */}
              <dd className="m-0 whitespace-nowrap text-sm font-medium tabular-nums">
                {value > 0 ? `+${value}` : String(value)}
              </dd>
            </div>
          )
        })}
      </dl>
    </div>
  )
}

export default ScoringLegend
