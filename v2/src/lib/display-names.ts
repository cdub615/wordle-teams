/** A player, reduced to what the naming rule reads. */
export type NamedPlayer = { id: string; firstName: string; lastName: string }

/**
 * The team's display names, by player id.
 *
 * THE RULE, ported from v1 and kept deliberately: a first name alone, and
 * `First L` ONLY when two players on the same team share that first name. It is
 * a good rule — it stays short in the common case and disambiguates exactly
 * when it must.
 *
 * EXTRACTED SO THE TABLE AND THE TODAY PANEL CANNOT DISAGREE. This lived inline
 * in scores-table.tsx; the panel needs the same answer, and two copies of a
 * naming rule is how the same person ends up called two things on one screen.
 *
 * A COLLIDING PLAYER WITH AN EMPTY LAST NAME KEEPS THEIR BARE FIRST NAME rather
 * than gaining a trailing space or an "undefined" — `''[0]` is undefined, which
 * is the precise bug lib/initials.ts was written against. They stay ambiguous,
 * which is honest: there is no initial to disambiguate them with.
 */
export function displayNamesFor(players: ReadonlyArray<NamedPlayer>): Map<string, string> {
  const seen = new Set<string>()
  const duplicated = new Set<string>()
  for (const p of players) {
    if (seen.has(p.firstName)) duplicated.add(p.firstName)
    seen.add(p.firstName)
  }

  return new Map(
    players.map((p) => {
      const initial = p.lastName.charAt(0)
      const label = duplicated.has(p.firstName) && initial ? `${p.firstName} ${initial}` : p.firstName
      return [p.id, label]
    }),
  )
}
