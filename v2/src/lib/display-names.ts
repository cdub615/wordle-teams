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
 *
 * NEITHER AN EMPTY FIRST NAME NOR AN EMPTY LAST NAME IS CONSTRUCTIBLE IN V2 —
 * there is no asymmetry here, because both write paths guard both fields the
 * same way. isCompleteName (convex/lib/invite.ts), enforced at
 * convex/players.ts:146, rejects a blank first OR last name at the mutation;
 * isNamed (scripts/lib/copy-filters.mjs) is `Boolean(first_name && last_name)`
 * and keeps the 151 nameless production rows out of the Supabase copy rather
 * than carrying either half across. reminderEmails.ts:105-118 makes this exact
 * argument for firstName; it applies unchanged to lastName, since both guards
 * check both fields identically.
 *
 * SO THE `&& initial` GUARD ABOVE IS NOT DEFENDING A REACHABLE STATE. Its
 * honest value is defence in depth, not a live fix, and relaxing either guard
 * costs both fields at once: a colliding empty last name would degrade here
 * to a bare first name instead of reproducing the literal "Ada undefined"
 * that scores-table.tsx's inline `lastName[0]` still produces today, and two
 * colliding empty FIRST names would produce a leading space and an empty
 * label — `' A'` and `''`. That is the cost of relaxing this pair of guards,
 * written down here rather than defended against a state that cannot
 * currently occur.
 */
export function displayNamesFor(players: ReadonlyArray<NamedPlayer>): Map<string, string> {
  const seen = new Set<string>()
  const duplicated = new Set<string>()
  for (const p of players) {
    if (seen.has(p.firstName)) duplicated.add(p.firstName)
    seen.add(p.firstName)
  }

  // A repeated id would silently let the later entry win — `new Map` keeps
  // the last write for a given key. Assumed unreachable: ids are Convex
  // document ids, unique by construction at both call sites.
  return new Map(
    players.map((p) => {
      const initial = p.lastName.charAt(0)
      const label = duplicated.has(p.firstName) && initial ? `${p.firstName} ${initial}` : p.firstName
      return [p.id, label]
    }),
  )
}
