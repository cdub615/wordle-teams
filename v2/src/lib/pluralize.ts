/**
 * The correct noun form for a count — the caller supplies BOTH forms, not
 * just a suffix to append.
 *
 * THE ISSUE THIS EXISTS FOR (wordle-teams-fqws): openers-panel.tsx rendered
 * "would save you about {n} guesses a day" with no singular form, so a saving
 * of exactly one read "about 1 guesses a day" — on a paid surface, in the
 * sentence that argues the feature is worth money. Four sentences across two
 * panels had that shape, and all four are callers of this helper:
 *   - openers-panel.tsx — "You have opened with MUSIC {n} time(s)". THE MOST
 *     REACHABLE OF THE FOUR, and the one the issue did not name:
 *     `headlineComparison` (insights-personal.ts) puts no floor on
 *     `most.count` — the only floor, MIN_OPENER_USES_FOR_ADVICE, gates the
 *     advice sentence's `other` — so five boards with five different openers
 *     reach it as soon as MIN_BOARDS_FOR_STATS is met.
 *   - openers-panel.tsx — "You average {n} guess(es) with it".
 *   - openers-panel.tsx — "would save you about {n} guess(es) a day".
 *   - trend-panel.tsx — the sr-only "{n} board(s), average {n} guess(es)",
 *     which already agreed on `board` and not on `guess`. Both nouns go
 *     through this helper now, so that sentence has one idiom rather than two.
 *
 * WHAT MAKES ANY OF IT REACHABLE IS THAT `round1` (insights-personal.ts)
 * RETURNS A PLAIN NUMBER: 1.0 renders as "1", with no formatter in between to
 * notice the agreement problem.
 *
 * BOTH FORMS EXPLICIT, NOT AN APPENDED "s", BECAUSE THE NOUNS ARE NOT
 * UNIFORMLY REGULAR: "guess" takes "guesses" (-es), "time" takes "times"
 * (-s). A helper that appended "s" to the singular would produce "guesss"
 * and would be wrong on the very sentence this module is named after.
 *
 * THE INLINE `=== 1` TERNARIES ALREADY IN THE REPO ARE DELIBERATELY NOT
 * MIGRATED — they are already correct, and churning correct code widens a bug
 * fix into a refactor. Reach for this helper in new copy; do not sweep the
 * old. NO COUNT IS GIVEN HERE ON PURPOSE: an earlier version of this comment
 * said "four" and named four, and a grep for the shape finds them in
 * components/board-entry/import-prefill.ts, components/today-panel.tsx,
 * components/insights/team-panel.tsx, components/insights/daily-team-fact.tsx,
 * routes/insights.tsx, lib/billing-copy.ts, convex/lib/otpExpiry.ts and
 * trend-panel.tsx's OWN card footer — so a number in a comment here would be
 * a claim nothing enforces and one new sentence away from being false.
 *
 * TWO SITES LOOK LIKE THIS BUG AND ARE NOT — for different reasons, which is
 * the part worth stating:
 *   - insights/daily-benchmark.tsx:143 — "Showing {shown.length} of
 *     {visible.length} boards" is gated on `filterable = visible.length > 1`
 *     (line 48), so "1 of 1 boards" cannot render, and "Showing 1 of 5
 *     boards" is correct English: the noun agrees with the TOTAL
 *     (visible.length), not the shown subset.
 *   - insights/personal-summary.tsx:108 (and again at :118, the same constant
 *     inside UnlockPrompt's `value`) — "over your last
 *     {TRAILING_FORM_WINDOW} boards" is safe because TRAILING_FORM_WINDOW
 *     (insights-personal.ts:356) is a constant, fixed at 30. It can never be
 *     1. That is a different reason from daily-benchmark's — gating on a
 *     runtime condition vs. a value that is simply never 1 — not the same
 *     safety argument twice.
 */
export function pluralize(count: number, singular: string, plural: string): string {
  return count === 1 ? singular : plural
}
