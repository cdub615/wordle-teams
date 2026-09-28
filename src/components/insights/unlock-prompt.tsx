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
  /**
   * Pluralised by the caller — "boards", "hard days". NEVER INTERPOLATED
   * AGAINST `have`, only against `need` in the "unlocks at N unit" line above —
   * so the only way this reads wrong is a caller passing `need: 1` ("1
   * boards"). Every floor today is a constant of 5, 10 or 40; if that ever
   * changes to a floor of 1, this prop is where the plural breaks, not here.
   * Not worth a pluralisation helper for a case no caller has.
   */
  unit: string
  /** One clause of actual value, no leading capital. */
  value: string
  testId: string
}) {
  // Clamped because a caller may hold a count past the floor for a render or two
  // while another condition gates the insight, and a bar wider than its track
  // would overflow the card.
  //
  // NEED IS ASSUMED POSITIVE, MATCHING mean()'S STANCE IN insights-personal.ts:
  // every caller passes a floor constant (5, 10, 40), never zero, so a
  // `Math.max(1, need)` guard here would only paper over a caller bug that
  // does not exist today. `need: 0` would produce `NaN` and a silently
  // zero-width bar rather than a crash — the harder failure to notice — but
  // that is the honest cost of not inventing a guard for an unreachable input.
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
          // CLAMPED LIKE `pct`, AND FOR THE SAME OVERSHOOT REASON — but this is
          // a second, deliberate divergence from the visible "{have} / {need}"
          // text below, not a duplicate of it. aria-valuenow describes the BAR
          // (it must never exceed aria-valuemax, or the progressbar role is an
          // invalid ARIA state and fails axe's aria-valid-attr-value); the
          // text describes the PLAYER, who has genuinely played `have` boards
          // and should see that true count even past the floor. Clamping the
          // text too would understate their play.
          aria-valuenow={Math.min(have, need)}
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
