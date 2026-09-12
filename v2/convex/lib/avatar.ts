/**
 * The avatar rules that are pure, kept out of the mutations so they can be
 * tested at all.
 *
 * WHY THIS MODULE EXISTS RATHER THAN INLINE LOGIC: syncSocialImage reads the
 * authenticated Better Auth user, and convex-test cannot stand up a Better Auth
 * session (wordle-teams-bya), so a mutation body that decides anything is a
 * mutation body no test can reach (wordle-teams-obw). Everything that decides
 * lives here; the mutation is a shell.
 */

/**
 * The hard ceiling setAvatar enforces server-side, in bytes.
 *
 * THE CLIENT ALREADY RESIZES TO 256px WebP, which lands at 8-20 KB — so this is
 * not the normal path's constraint, it is the guard against a client that did
 * not resize. A Convex upload URL accepts whatever is POSTed to it, so without
 * this a broken or hostile client puts a 12MP original in storage and every
 * byte of it back on the wire.
 */
export const MAX_AVATAR_BYTES = 100_000

/** The square edge the client crops and scales to. */
export const AVATAR_SIZE = 256

/**
 * SVG IS EXCLUDED DELIBERATELY and is the reason this is an allow-list rather
 * than a `startsWith('image/')` check. An SVG is a document: it can carry
 * script, and these files are served from a URL that Convex's own docs say
 * anyone holding it can fetch without authentication. The three raster types
 * below are what the client's canvas resize can produce anyway.
 */
const ALLOWED_AVATAR_TYPES = ['image/webp', 'image/png', 'image/jpeg']

export function isAllowedAvatarType(contentType: string | null | undefined): boolean {
  return contentType !== null && contentType !== undefined && ALLOWED_AVATAR_TYPES.includes(contentType)
}

/** What a sync should do to `players.socialImage`, given both sides. */
export type SocialImageSync = { action: 'none' } | { action: 'clear' } | { action: 'set'; value: string }

/**
 * Whether the player row's mirrored social image needs updating.
 *
 * `action: 'none'` IS THE COMMON CASE AND IT MATTERS. This runs on app load, so
 * anything other than "usually writes nothing" would put a mutation on every
 * page view.
 */
export function shouldSyncSocialImage(
  current: string | undefined,
  incoming: string | null | undefined,
): SocialImageSync {
  const next = incoming ?? null
  if (next === null) return current === undefined ? { action: 'none' } : { action: 'clear' }
  if (current === next) return { action: 'none' }
  return { action: 'set', value: next }
}
