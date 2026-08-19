/**
 * Whether a player's profile is complete enough to show.
 *
 * A just-accepted invitee sits in a team's `playerIds` with no `firstName` or
 * `lastName` yet — they exist as a row, but haven't finished onboarding. v1's
 * `fromDbPlayer` throws on one of these and crashes the client render, so v2
 * filters them out everywhere a player might otherwise reach the wire: the
 * scoreboard (`getTeamMonthFor` in scores.ts), the monthly-winner computation
 * (`recomputeTeamMonth` in winners.ts) and the team card (`getMyTeamsFor` in
 * teams.ts).
 *
 * Those three sites MUST agree — a member excluded from the scoreboard must
 * also be excluded from the team card and from winning the month, or the three
 * views of "who is on this team" disagree with each other. Three independent
 * copies of this boolean, kept in sync only by comments cross-referencing one
 * another, is one edit away from drifting; this is the one copy.
 *
 * DEPENDENCY-FREE, like everything else in convex/lib/ — no Convex imports.
 * The parameter is structural rather than `Doc<'players'>` so this stays
 * importable from anywhere a player-shaped object exists, Convex or not.
 *
 * A TYPE PREDICATE, not a plain boolean: the three call sites all read
 * `member.firstName`/`member.lastName` as non-optional right after the guard,
 * which only type-checks if this function narrows `T` for them the same way
 * their old inline `if (!member.firstName || !member.lastName)` checks did.
 */
export function hasCompleteProfile<T extends { firstName?: string; lastName?: string }>(
  player: T,
): player is T & { firstName: string; lastName: string } {
  return Boolean(player.firstName) && Boolean(player.lastName)
}
