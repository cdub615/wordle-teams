/**
 * The correct noun form for a count — the caller supplies BOTH forms, not
 * just a suffix to append.
 *
 * THE ISSUE THIS EXISTS FOR: openers-panel.tsx renders "would save you about
 * {n} guesses a day" with no singular form, so a saving of exactly one reads
 * "about 1 guesses a day" — on a paid surface, arguing the feature is worth
 * money. The same shape recurs in three more sentences across two panels
 * (openers-panel.tsx and trend-panel.tsx). This module is the fix those four
 * sentences will migrate to; it does not migrate them itself — that is a
 * separate change, not yet made.
 *
 * BOTH FORMS EXPLICIT, NOT AN APPENDED "s", BECAUSE THE NOUNS ARE NOT
 * UNIFORMLY REGULAR: "guess" takes "guesses" (-es), "time" takes "times"
 * (-s). A helper that appended "s" to the singular would produce "guesss"
 * and would be wrong on the very sentence this module is named after.
 *
 * FOUR EXISTING INLINE INSTANCES ARE DELIBERATELY NOT MIGRATED to this
 * helper — they are already correct, and churning correct code widens a bug
 * fix into a refactor:
 *   - board-entry/import-prefill.ts:112 — an explicit `=== 1` branch
 *     ('Read 1 guess...' vs `Read ${n} guesses...`)
 *   - insights/trend-panel.tsx:100 — `const boardsWord = row.boards === 1 ?
 *     'board' : 'boards'`
 *   - today-panel.tsx:226 — `` `and ${n} other${n === 1 ? '' : 's'}` ``
 *   - billing-copy.ts:160 — `` `${count} Invite${count === 1 ? '' : 's'}
 *     Pending` ``
 *
 * TWO SITES LOOK LIKE THIS BUG AND ARE NOT — for different reasons, which is
 * the part worth stating:
 *   - insights/daily-benchmark.tsx:143 — "Showing {shown.length} of
 *     {visible.length} boards" is gated on `filterable = visible.length > 1`
 *     (line 48), so "1 of 1 boards" cannot render, and "Showing 1 of 5
 *     boards" is correct English: the noun agrees with the TOTAL
 *     (visible.length), not the shown subset.
 *   - insights/personal-summary.tsx:108 — "over your last
 *     {TRAILING_FORM_WINDOW} boards" is safe because TRAILING_FORM_WINDOW
 *     (insights-personal.ts:356) is a constant, fixed at 30. It can never be
 *     1. That is a different reason from daily-benchmark's — gating on a
 *     runtime condition vs. a value that is simply never 1 — not the same
 *     safety argument twice.
 */
export function pluralize(count: number, singular: string, plural: string): string {
  return count === 1 ? singular : plural
}
