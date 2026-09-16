/**
 * An unmet sample-size floor, rendered as an invitation rather than a blank.
 *
 * THE OWNER'S CALL, 2026-09-15: a player should know that more is coming, what
 * specifically it is, and how close they are — so the floor reads as a reason to
 * keep entering boards instead of a silent absence. Generalised rather than
 * invented: the thin-history message already named what was coming; what it
 * lacked was the distance.
 *
 * DELIBERATELY NOT ACCENT-COLOURED, and this is the load-bearing detail. The
 * upsell asks for money and carries the accent; this asks for play. Green is
 * reserved for what the player has ACHIEVED — the modal distribution row, the
 * best month, a winning head-to-head. A prompt for something they have not
 * earned yet must not wear the same colour as something they have.
 *
 * NOTHING UNREACHABLE GETS ONE. Every floor this renders for is reachable by
 * playing. Tier, team membership and corpus coverage have their own states: the
 * upsell, the no-team card, and "not rated yet" respectively.
 */
export function UnlockPrompt({
  what,
  need,
  have,
  unit,
  value,
  testId,
}: {
  /** What unlocks, named concretely. Never "more insights". */
  what: string
  need: number
  have: number
  /** Pluralised by the caller — "boards", "hard days". */
  unit: string
  /** One clause of actual value, no leading capital. */
  value: string
  testId: string
}) {
  // Clamped because a caller may hold a count past the floor for a render or two
  // while another condition gates the insight, and a bar wider than its track
  // would overflow the card.
  const pct = Math.min(100, Math.round((have / need) * 100))

  return (
    <div className="text-muted-foreground space-y-2 text-sm" data-testid={testId}>
      <p>
        <span className="text-foreground font-medium">
          {what} unlocks at {need} {unit}
        </span>{' '}
        — {value}.
      </p>
      <div className="flex items-center gap-2">
        <div
          className="bg-muted h-1.5 flex-1 overflow-hidden rounded-full"
          role="progressbar"
          aria-valuenow={have}
          aria-valuemin={0}
          aria-valuemax={need}
          aria-label={`${what} progress`}
        >
          <div
            className="bg-muted-foreground h-full rounded-full motion-safe:transition-[width]"
            style={{ width: `${pct}%` }}
            data-testid={`${testId}-fill`}
          />
        </div>
        <span className="text-xs tabular-nums">
          {have} / {need}
        </span>
      </div>
    </div>
  )
}
