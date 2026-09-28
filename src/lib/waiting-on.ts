/** One team member, reduced to what this summary needs. */
export type WaitingMember = { id: string; label: string }

export type WaitingOnSummary = {
  /** Everyone on the team, whether or not they have a score. */
  total: number
  /**
   * How many members have a score. Counted from `members` independently of
   * `waiting` — NOT `total - waiting.length` — so that narrowing the
   * `waiting` filter later (e.g. excluding the caller for a self-only line)
   * cannot silently change this count too.
   */
  playedCount: number
  /** Every waiting member's label, for the disclosure that reveals the rest. */
  waiting: Array<string>
  /**
   * The first `limit` of them — what is shown before the disclosure. A
   * negative `limit` is clamped to zero rather than sliced from the end.
   */
  shown: Array<string>
  /** How many `waiting` are NOT in `shown`. Zero when they all fit. */
  othersCount: number
}

/**
 * "N of M played", and who is being waited on.
 *
 * THE CAP IS THE POINT, NOT A DETAIL. Team size is unbounded — FREE_TEAM_LIMIT
 * caps teams per player, not members per team, and nothing in convex/ caps
 * membership — so any layout that renders one element per member is
 * disqualified. `shown` is bounded by `limit` and `othersCount` carries the
 * remainder, which keeps the panel a constant height at any team size.
 *
 * `playedCount` is derived from the MEMBER list rather than from the size of
 * `played`, so a stale id for someone who has left the team cannot report more
 * players than the team has.
 *
 * Order is the caller's team order, untouched — this function does no
 * sorting of its own. (Compare scores-table.tsx, which sorts by month total
 * descending before rendering; that ordering is a caller concern too, not
 * something replicated here.)
 */
export function waitingOnSummary(
  members: ReadonlyArray<WaitingMember>,
  played: ReadonlySet<string>,
  limit: number,
): WaitingOnSummary {
  const waiting = members.filter((m) => !played.has(m.id)).map((m) => m.label)
  const shown = waiting.slice(0, Math.max(0, limit))

  return {
    total: members.length,
    playedCount: members.filter((m) => played.has(m.id)).length,
    waiting,
    shown,
    othersCount: waiting.length - shown.length,
  }
}
