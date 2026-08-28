/**
 * Initials for the avatar fallback, derived from the PLAYER's own name — not
 * Better Auth's `user.name` (api.auth.getCurrentUser), which is whatever the
 * OAuth provider handed back at sign-up (or nothing at all, for the OTP path)
 * and has no relationship to the `players` table this app actually shows
 * everywhere else — the scoreboard, the team card, the dropdown label.
 *
 * BOTH NAMES CAN BE EMPTY STRINGS. schema.ts:44-66 documents this at length:
 * firstName/lastName are required so they can never be ABSENT, but v.string()
 * accepts '', and a real slice of production's copied players have exactly
 * that. v1's scores-table.tsx reads `lastName[0]`, which is `undefined` for
 * '' — rendering the literal string "undefined" beside a first initial for
 * every one of them. `.charAt(0)` rather than `[0]` is the fix: it returns ''
 * instead of throwing or yielding `undefined`, so an empty side simply
 * contributes nothing instead of corrupting the result.
 *
 * Falls back to the first character of the email — the one field genuinely
 * non-empty for every signed-in player — when both names are empty, and to
 * `null` (render a generic icon instead of a fallback letter) when even that
 * is unavailable.
 */
export function initialsFor(firstName: string, lastName: string, email?: string | null): string | null {
  const fromNames = `${firstName.trim().charAt(0)}${lastName.trim().charAt(0)}`.toUpperCase()
  if (fromNames.length > 0) return fromNames

  const fromEmail = (email ?? '').trim().charAt(0).toUpperCase()
  return fromEmail.length > 0 ? fromEmail : null
}
