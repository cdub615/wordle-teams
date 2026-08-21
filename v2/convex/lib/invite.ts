/**
 * Invite-address and profile-name rules.
 *
 * DEPENDENCY-FREE, like everything else in convex/lib/ — no Convex imports, so
 * both the server functions and the route guard can use it.
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
 * ONE function, to be used by BOTH completeProfile's validation and the
 * needsProfile route guard. Neither exists yet — this module currently has no
 * consumers — so read that as the requirement on those callers rather than as
 * a description of the code today: whichever lands first, both must go through
 * here. If they ever disagree, a name that saves does not clear the guard and
 * the user is redirected to /complete-profile forever. v1 has exactly that
 * latent bug — it accepts any non-empty name but guards on `length > 1`.
 */
export function isCompleteName(firstName: string, lastName: string): boolean {
  return firstName.trim().length > 0 && lastName.trim().length > 0
}
