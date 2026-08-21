/**
 * Input rules for the Phase 4 write boundary.
 *
 * Every value that reaches an invite or a profile row passes through one of
 * these on its way in, which is the whole organising principle: the rules live
 * here, once, rather than being restated at each call site where they could
 * drift apart.
 *
 * DEPENDENCY-FREE, like everything else in convex/lib/ — no Convex imports, so
 * the server functions and the browser-side form predicates can share it.
 */

// Deliberately permissive: one @, no whitespace, and a dot in the domain. This
// is a typo guard, not an RFC 5322 validator — the real proof that an address
// works is that the invite email arrives, and over-strict client-side email
// regexes reject valid addresses far more often than they catch bad ones.
const EMAIL_SHAPE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/

/**
 * An invite address, normalised, or null if it is not usable.
 *
 * LOWERCASING IS THE FIX FOR A REAL BUG, not tidiness. v1 stored teams.invited
 * as typed and matched it case-sensitively, while auth stores emails lowercased
 * — so anyone invited at a mixed-case address silently never joined their team.
 * That is a data-model bug, not a platform one, and a faithful port reproduces
 * it. See amendment A2 and scripts/verify-case-fix-dev.mjs.
 *
 * Normalise on WRITE (here) and compare case-insensitively on READ, so copied
 * rows that predate v1's own fix cannot slip through either.
 *
 * A NON-NULL RESULT IS NEVER THE EMPTY STRING, so `if (!email)` is a safe null
 * test and callers need not write `=== null`. EMAIL_SHAPE requires one or more
 * characters in all three segments, so the shortest address it admits is
 * 'a@b.c'. Several call sites lean on this; relaxing any of those quantifiers
 * to `*` would silently turn their falsy check into a wrong one, which is why
 * the tests pin each of the three separately.
 *
 * The output is a fixed point — normalising an already-normalised address is a
 * no-op — which is what lets a stored value be re-normalised on the way out
 * without producing a different key than it was written under. That property
 * is not separately tested because it cannot fail independently: it follows
 * from trim and toLowerCase each being idempotent, so a test for it passes
 * against the identity function and constrains nothing.
 */
export function normaliseInviteEmail(raw: string): string | null {
  const trimmed = raw.trim().toLowerCase()
  return EMAIL_SHAPE.test(trimmed) ? trimmed : null
}

/**
 * Whether a submitted profile name is complete.
 *
 * TWO consumers, neither of which exists yet: completeProfile's server-side
 * validation, and the profile form's canSubmit predicate. The form judges RAW,
 * UNTRIMMED React state, which is why padded input has to count as complete
 * rather than being rejected — the user typing ' Ada ' is not an error.
 *
 * NOT the route guard. needsProfile is a row-existence check and never reads a
 * name back — the redirect loop is closed by the schema instead, since
 * firstName/lastName are required and completeProfile validates before it
 * inserts, so a row cannot exist without a valid name. That is strictly
 * stronger than re-checking stored names: no names on the wire, and no
 * sensitivity to whatever whitespace got stored. Do not "fix" the guard by
 * fetching the player and re-checking here; that is the worse design.
 *
 * RETURNS A VERDICT, NOT A VALUE. A caller that persists must trim for itself —
 * see completeProfile, whose outer .trim() is load-bearing for what gets STORED
 * even though this function trims internally to judge. The two are
 * complementary, not redundant; deleting the outer one stores ' Ada ' and no
 * test here would notice, because this function is unaffected either way. Note
 * the asymmetry with normaliseInviteEmail, which hands back the normalised
 * VALUE so its callers never re-trim. This one deliberately does not.
 *
 * v1 saves any non-empty name but guards its redirect on `length > 1`, so a
 * one-character name saves and then redirects forever. v2 has no second opinion
 * to disagree with.
 */
export function isCompleteName(firstName: string, lastName: string): boolean {
  return firstName.trim().length > 0 && lastName.trim().length > 0
}
