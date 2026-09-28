import { type ScoreCell as ScoreCellValue, scoreCell } from '#/lib/wordle.ts'

/**
 * One day's cell in the scores table. DESIGN_SYSTEM.md section 6, "Scoring
 * display rules", ported from v1's table-config.tsx.
 *
 * Presentational: the caller decides whether the day is in the past and
 * whether the team plays weekends. The scores table itself is Phase 2.
 */
export type ScoreCellProps = {
  attempts?: number | null
  hasScore: boolean
  isBeforeToday: boolean
  isWeekend?: boolean
  playWeekends?: boolean
}

export function ScoreCell({
  attempts,
  hasScore,
  isBeforeToday,
  isWeekend = false,
  playWeekends = true,
}: ScoreCellProps) {
  // v1 renders N/A at the column level, before consulting the score at all.
  if (isWeekend && !playWeekends) {
    // text-muted-foreground, not text-subtle: N/A is content, and --text-subtle
    // is only 4.31:1 in light. v1 uses the muted token here too.
    return <div className="text-xs text-muted-foreground">N/A</div>
  }

  const value: ScoreCellValue = scoreCell({ attempts, hasScore, isBeforeToday })
  return <div>{value}</div>
}

export default ScoreCell
