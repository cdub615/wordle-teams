/**
 * Whether the monthly-winner dialog opens, and what it says.
 *
 * PURE, AND SEPARATE FROM THE COMPONENT, because the component's job is a
 * subscription and an effect while this is three decisions that are wrong in v1
 * production today. Keeping them here means the copy is asserted by a plain
 * unit test under the default edge-runtime environment rather than only by the
 * jsdom suite next door.
 *
 * THE BUG THIS FIXES. v1's monthly-winner-celebration.tsx reads the winner id
 * off the row and then renders `user.firstName` / `user.lastName` — where
 * `user` is the CURRENT viewer, taken from the teams context, not the winner it
 * just looked up. So when somebody else wins, v1 tells you "<your own name>
 * won!" and then, underneath, "<your own name> won last month for <team>.
 * Better luck next time!". Every member of a team where they did not win is
 * shown their own name as the winner's, and the two halves of the dialog
 * contradict each other in the same breath.
 *
 * It is FIXED here rather than ported, and recorded as V2-ADDENDUM §7a row 35.
 * It is a defect and not a behaviour: nobody decided the dialog should misname
 * the winner, there is no data or UI that depends on it, and the correct name
 * costs one extra field on a query that had to exist anyway. `winner` below is
 * the winner and there is no viewer name in this module at all, which is what
 * makes the mistake unrepresentable rather than merely fixed.
 */

/**
 * What `winners.getLastMonthWinner` returns, structurally.
 *
 * Declared here rather than imported from the generated Convex types so this
 * module — and its test — stay independent of codegen. `id` is a plain string
 * for the same reason; the only thing done with it is an equality test against
 * the viewer's own id.
 */
export type WinnerRow = {
  teamName: string
  winner: { id: string; firstName: string; lastName: string }
  hasSeen: boolean
}

export type CelebrationView = {
  /**
   * Whether the dialog should be OPENED — not whether it should stay open. The
   * component latches this on the first true and never consults it again, and
   * that is deliberate: dismissing the dialog writes the viewer's id into the
   * row, the reactive query re-pushes it with `hasSeen: true`, and reading this
   * value continuously would slam the dialog shut in the same frame it opened.
   */
  shouldOpen: boolean
  viewerWon: boolean
  title: string
  message: string
}

/**
 * Null when there is nothing to say at all — no winner row for that month, or
 * no known viewer to say it to.
 *
 * A NULL VIEWER IS NOT "SOMEBODY ELSE WON". `scores.getMyPlayerId` is a plain,
 * non-suspending query on the dashboard, so it is briefly undefined on first
 * paint; treating that as "not the winner" would render the third-person copy
 * to the winner themselves for one frame, and — worse — would mean an
 * unauthenticated render could name a winner. Returning null makes the dialog
 * wait for an answer instead of guessing at one.
 */
export function celebrationView(
  row: WinnerRow | null | undefined,
  viewerId: string | null | undefined,
): CelebrationView | null {
  if (!row) return null
  if (!viewerId) return null

  const { firstName, lastName } = row.winner
  const viewerWon = row.winner.id === viewerId

  return {
    shouldOpen: !row.hasSeen,
    viewerWon,
    // v1's four strings, kept verbatim apart from whose name goes in them.
    title: viewerWon ? `Congratulations ${firstName}!` : `${firstName} ${lastName} won!`,
    message: viewerWon
      ? `You won last month for ${row.teamName}. Nice work! 🎉`
      : `${firstName} ${lastName} won last month for ${row.teamName}. Better luck next time!`,
  }
}
