/**
 * Standings rank for an ALREADY-SORTED list of rows.
 *
 * STANDARD COMPETITION RANKING (1, 2, 2, 4), decided in the dashboard design
 * rather than left to the implementer. Two players on equal points are equal,
 * and the alternative — dense ranking, 1, 2, 2, 3 — would tell the
 * fourth-placed player they came third. A tie is the normal case in a small
 * team on a slow month, so this is not an edge case.
 *
 * SORTING IS THE CALLER'S JOB AND STAYS THERE. scores-table.tsx already sorts
 * by month total descending, exactly as v1's getData did; re-sorting here would
 * be a second opinion about order that could drift from the one on screen.
 * This function only reads `total` to find the boundaries between places.
 */
export function rankWithTies<T extends { total: number }>(
  rows: ReadonlyArray<T>,
): Array<T & { rank: number }> {
  let rank = 0
  let previousTotal: number | undefined

  return rows.map((row, index) => {
    // The rank only advances when the total CHANGES — and it advances to the
    // 1-based position, not to `rank + 1`, which is what makes the place after
    // a tie skip. index is 0-based, so the position is index + 1.
    if (row.total !== previousTotal) {
      rank = index + 1
      previousTotal = row.total
    }
    return { ...row, rank }
  })
}
