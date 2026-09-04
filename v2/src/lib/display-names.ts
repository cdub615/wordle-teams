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
 * which is honest: there is no initial to disambiguate them with. An empty
 * LAST name is handled because it is constructible — a player can genuinely
 * have a first name and no last name — which is why the `&& initial` guard
 * above exists.
 *
 * AN EMPTY FIRST NAME IS NOT HANDLED, AND DOES NOT NEED TO BE: it is
 * unconstructible in v2. Both write paths are guarded — isCompleteName
 * (convex/lib/invite.ts) rejects a blank first or last name at the mutation,
 * and isNamed (scripts/lib/copy-filters.mjs) drops nameless rows from the
 * Supabase copy rather than carrying them across (schema.ts:44-70 walks both
 * in full). If those guards were ever relaxed, two colliding empty first
 * names would produce a leading space and an empty label — `' A'` and `''` —
 * so that is the cost of relaxing them, written down here rather than guarded
 * against a state that cannot currently occur.
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
