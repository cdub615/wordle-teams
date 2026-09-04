import { useId } from 'react'
import { convexQuery } from '@convex-dev/react-query'
import { useSuspenseQuery } from '@tanstack/react-query'
import { api } from '../../convex/_generated/api'
import { Button } from '#/components/ui/button.tsx'
import { cn } from '#/lib/utils.ts'
import { SYSTEM_FIELDS, SYSTEM_FIELD_LABELS } from '../../convex/lib/scoringSystem.ts'
import type { Id } from '../../convex/_generated/dataModel'

/**
 * The team's points, as a read-only chip strip.
 *
 * DERIVED, NEVER HAND-LISTED. Order comes from SYSTEM_FIELDS and labels from
 * SYSTEM_FIELD_LABELS, for the reason that module's own header gives: a literal
 * list compiles fine after a ninth field is added and silently never shows it.
 * `nA`'s label is "Missed day" and is deliberately NOT abbreviated even though
 * it is the longest chip — it is the value a player is least likely to guess.
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
 * A `<dl>` OF LABEL/VALUE PAIRS, NOT A BARE SPAN STRIP. Each chip is one
 * `dt`/`dd` pair rather than two unrelated spans, so a screen reader announces
 * "1, plus 5" as a unit instead of eight labels followed by eight numbers with
 * no structural link between them. `useId` keeps the `dl`'s `aria-labelledby`
 * unique if this component is ever rendered more than once on a page.
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
    <div className={cn('flex flex-wrap items-center gap-3', className)}>
      <span id={labelId} className="text-xs text-muted-foreground">
        Scoring
      </span>
      <dl aria-labelledby={labelId} className="m-0 flex flex-wrap items-center gap-x-3 gap-y-2">
        {SYSTEM_FIELDS.map((field) => {
          const value = system[field]
          return (
            <div
              key={field}
              className="inline-flex items-baseline gap-1 rounded-full border px-2 py-0.5 text-xs"
            >
              <dt className="text-muted-foreground">{SYSTEM_FIELD_LABELS[field]}</dt>
              {/* The sign is kept, so -1 and -3 read as penalties rather than
                  as bare numbers. A leading + on positives makes the two
                  visually symmetrical; 0 stays unsigned. */}
              <dd className="m-0 font-medium tabular-nums">
                {value > 0 ? `+${value}` : String(value)}
              </dd>
            </div>
          )
        })}
      </dl>
      {/* CREATOR ONLY. isOwner is a prop, not a new query — team mutations are
          creator-only and enforced server-side (7a 4), so showing this to a
          member would offer an action the server refuses.
          aria-label spells out WHAT is being edited: a bare "Edit" is
          ambiguous to a screen reader user navigating a page's button list out
          of context, the same reason scoring-system-card.tsx's icon button
          carries `aria-label="Customize scoring system"` rather than none. */}
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
  )
}

export default ScoringLegend
