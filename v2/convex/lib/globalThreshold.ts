/**
 * LAYER 4'S ONE CONSTANT, and the rule that decides whether a global slice may
 * render at all.
 *
 * THIS FILE HAS NO IMPORTS, for the reason chatLimits.ts exists: the rule is
 * needed on both sides of the wire, and reaching it through a module that pulls
 * in ../access.ts would drag auth.ts's module-scope throw into the client chunk.
 *
 * ── THE THRESHOLD ────────────────────────────────────────────────────────────
 *
 * A slice renders only when at least 30 DISTINCT PLAYERS contribute to it,
 * evaluated PER SLICE at render time.
 *
 * "CONTRIBUTE" MEANS A DISTINCT PLAYER HOLDING AT LEAST ONE BOARD COUNTED INTO
 * THAT SLICE. So a per-day percentile counts the players who entered a board on
 * that day; an opener comparison counts the players who have used that opener at
 * least once. Boards are not the unit — one player with four hundred boards is one
 * contributor, and counting boards would light up a slice for a single prolific
 * person, which is the exact failure both justifications below describe.
 *
 * ── TWO JUSTIFICATIONS, KEPT APART BECAUSE THEY BITE AT DIFFERENT SIZES ───────
 *
 * RE-IDENTIFICATION. A daily percentile computed over six players, combined with
 * the team boards a member can already read, lets a stranger's score be inferred
 * by subtraction. This is the privacy argument and it is the one the epic's
 * acceptance criteria require.
 *
 * MEANINGLESSNESS. "Top 20% globally" when global is six people is a ranking of
 * six friends presented as a population claim. This is a QUALITY argument rather
 * than a privacy one, and it BITES FIRST — the number is worthless well before it
 * is identifying.
 *
 * Keeping them apart matters because they would justify different fixes. The
 * privacy one could in principle be answered by noise or suppression; the quality
 * one cannot be answered by anything except more players.
 *
 * ── 30 IS A CONVENTION, NOT A DERIVATION ─────────────────────────────────────
 *
 * It is the conventional large-sample rule of thumb. k-anonymity practice ranges
 * from 5 to 50 depending on sensitivity, and nothing about this data picks a point
 * in that range on its own. The owner accepted 30 knowingly. This paragraph exists
 * so the next reader does not go hunting for a derivation that is not there.
 *
 * ── PER SLICE, NOT ONE GLOBAL FLAG ───────────────────────────────────────────
 *
 * The cohorts differ wildly in size: a per-day percentile draws only on players
 * who played that exact day, while a lifetime opener comparison draws on everyone
 * who has ever used that opener. One flag would either suppress views the data
 * already supports or expose views it does not. Views light up independently as
 * the data supports them.
 */
export const MIN_GLOBAL_CONTRIBUTORS = 30

/**
 * Whether a slice with this many distinct contributors may render.
 *
 * AT the threshold RENDERS; below it does not. The boundary is inclusive, and
 * both directions are tested — a threshold tested in one direction is vacuous, and
 * this repository has the scars to match.
 */
export function sliceIsVisible(contributors: number): boolean {
  return contributors >= MIN_GLOBAL_CONTRIBUTORS
}

/**
 * Distinct contributors among a slice's boards.
 *
 * COUNTS PLAYERS, NOT BOARDS, which is the whole definition above expressed as
 * code. Taking `length` here instead would be the single change that quietly
 * turns the rule into "one keen player is a population".
 */
export function contributorsOf(boards: readonly { playerId: string }[]): number {
  return new Set(boards.map((board) => board.playerId)).size
}

/**
 * A slice's value, or null when too few players contribute to it.
 *
 * RETURNS null RATHER THAN A FLAG BESIDE THE VALUE, deliberately: a caller that
 * receives `{ value, visible: false }` can render the value by mistake, and on
 * this rule a mistake is the disclosure. There is nothing to leak if the number
 * never leaves this function.
 */
export function visibleSlice<T>(
  boards: readonly { playerId: string }[],
  compute: () => T,
): { value: T; contributors: number } | { value: null; contributors: number } {
  const contributors = contributorsOf(boards)
  if (!sliceIsVisible(contributors)) return { value: null, contributors }
  return { value: compute(), contributors }
}
