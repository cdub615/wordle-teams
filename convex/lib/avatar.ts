import type { Doc, Id } from '../_generated/dataModel'

/**
 * This feature's avatar rules, gathered in one module rather than duplicated
 * across the surfaces that need them.
 *
 * MOST OF WHAT FOLLOWS IS PURE, kept out of the mutations so it can be tested
 * at all. WHY THAT MATTERS: syncSocialImage reads the authenticated Better
 * Auth user, and convex-test cannot stand up a Better Auth session
 * (wordle-teams-bya), so a mutation body that decides anything is a mutation
 * body no test can reach (wordle-teams-obw). Everything that decides lives
 * here; the mutation is a shell.
 *
 * `resolveAvatar` BELOW IS THE EXCEPTION: it takes a `ctx` and is not pure,
 * because resolving a stored file to a URL is a storage read, not a decision —
 * there is no value to compute without asking storage for it. It belongs here
 * anyway, alongside this feature's other rules, rather than being left to
 * duplicate at each call site.
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
 * WHAT THIS ACTUALLY CHECKS: a CLIENT-SUPPLIED LABEL, not the bytes. `contentType`
 * here is the `Content-Type` header the uploader's POST carried, which Convex
 * stores verbatim and later serves back verbatim — it is not sniffed or
 * re-derived from the file's contents. A client can lie: it can POST SVG or
 * HTML bytes labelled `image/png`, and those bytes WILL land in storage under
 * that label. This allow-list does not keep such bytes OUT of storage.
 *
 * WHAT IT DOES GUARANTEE IS THE SERVED CONTENT-TYPE, and that is what SVG
 * exclusion is actually for. Convex serves a stored file back with exactly the
 * content-type it was stored under, and every avatar in this app is loaded
 * exactly one way: an `<img src>` (Radix's AvatarImage) — there is no `<a
 * href>`, `window.open`, iframe, or direct `fetch` of an avatar URL anywhere in
 * src/. A browser doing content sniffing in an IMAGE context only ever promotes
 * bytes to a raster format; it will not reinterpret a mislabelled response as
 * `text/html` or `image/svg+xml` there. So mislabelled bytes served as
 * `image/png` fail to decode and show a broken image — they never execute.
 *
 * THIS PROTECTION DEPENDS ON THAT LAST FACT, not on this allow-list alone.
 * Anyone who later adds a way to link to, download, or frame an avatar URL —
 * or renders one in a context a browser sniffs differently — must revisit this
 * check, because at that point a served `image/png` label stops being a safe
 * place for a client to have hidden SVG or HTML bytes.
 *
 * The three types below are also, incidentally, what the client's canvas
 * resize can produce anyway — but that is not why they are the allow-list;
 * the reasoning above is.
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
 *
 * TYPE ASYMMETRY: `current` is `string | undefined` because it is an optional
 * Convex field, while `incoming` accepts both `null` and `undefined`. Both mean
 * "no image" — Better Auth omits the `image` field entirely for a user who has
 * none, so absent and explicit-null are the same fact and must behave the same
 * way. Treating bare `undefined` as "unknown, leave it alone" would strand a
 * photo the provider has stopped serving; both must clear a previously mirrored URL.
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

/**
 * THE ONE PRECEDENCE RULE for a player's avatar: an uploaded image wins over
 * the mirrored social one, which wins over nothing.
 *
 * EXTRACTED FROM TWO PLACES THAT HAD INDEPENDENTLY WRITTEN IT — teams.ts's
 * getMyTeamsFor (for a teammate) and players.ts's myName (for the caller's own
 * row). Two copies of a precedence rule is how two surfaces end up disagreeing
 * about which image wins; src/lib/display-names.ts was extracted for the same
 * reason, and its doc comment says so.
 *
 * THE CONDITIONAL IS LOAD-BEARING AND MUST SURVIVE ANY FUTURE EDIT HERE.
 * `getUrl` is a `_storage` system read, and getMyTeamsFor is the hottest query
 * in the app (wordle-teams-dcu) — dashboardBandwidth.test.ts counts `getUrl`
 * calls directly and pins this at exactly zero for a roster with no uploads.
 * Calling `getUrl` unconditionally, even on a value this then discards, would
 * charge that cost on every member of every team on every dashboard load.
 *
 * A STRUCTURAL `ctx` TYPE, NOT `StorageReader`/`StorageWriter`. Both call
 * sites happen to carry a Convex query ctx today, but importing either shared
 * type here would be a needless coupling for what this function actually uses,
 * which is the one method below.
 *
 * THE `fallback` IS FOR THE CALLER'S OWN VIEW ONLY, and it exists because a
 * regression proved the mirror cannot be the caller's source of truth
 * (2026-09-12, beta: a GitHub user's avatar vanished from their own header).
 * `socialImage` is written by one mutation; your own session can read Better
 * Auth's `user.image` directly, which is where that value came from in the
 * first place. So `myName` passes it here and your avatar is right on first
 * paint regardless of whether the mirror has run.
 *
 * A TEAMMATE PASSES NOTHING, because they genuinely cannot read your Better
 * Auth record — for them the mirror IS the only source, which is the whole
 * reason it exists. Absent mirror plus absent fallback is initials, unchanged.
 */
export async function resolveAvatar(
  ctx: { storage: { getUrl: (id: Id<'_storage'>) => Promise<string | null> } },
  player: Pick<Doc<'players'>, 'imageId' | 'socialImage'>,
  fallback: string | null = null,
): Promise<string | null> {
  if (!player.imageId) return player.socialImage ?? fallback
  return await ctx.storage.getUrl(player.imageId)
}

/**
 * Ten upload URLs an hour, per player.
 *
 * WHAT THIS BOUNDS, AND WHAT IT DOES NOT. `generateAvatarUploadUrl` hands out a
 * one-shot URL that accepts whatever is POSTed to it, and MAX_AVATAR_BYTES is
 * only enforced once setAvatar looks at the stored row — so a client that
 * uploads and never calls setAvatar leaves bytes nothing references and nothing
 * revisits. Each such file costs exactly one call of this mutation, which is
 * what makes a limit on CALLS a real bound on deliberate abuse. It bounds the
 * COUNT of files, not their size; an unsubmitted upload is still capped by
 * nothing, so this reduces the ceiling rather than removing it.
 *
 * IT DOES NOTHING ABOUT THE BENIGN CASE, and that was decided rather than
 * missed (wordle-teams-wty4.1.8). An upload interrupted between the POST
 * completing and setAvatar resolving orphans its bytes too, and no rate limit
 * can see the difference. The alternative considered was a scheduled sweep of
 * unreferenced _storage rows — costed at roughly 400 documents a run, ~4.7 MB a
 * month daily, about 0.5% of the free-tier ceiling. It was not taken: that
 * window is one round trip wide, the client has already resized to 8-20 KB by
 * then, and the expected lifetime volume is single digits of files. A recurring
 * job to reclaim a few hundred KB is the wrong trade in a project that has cut a
 * cron once already for this exact budget (wordle-teams-yhii).
 *
 * TEN AN HOUR RATHER THAN CHAT'S TWENTY A MINUTE, because the actions are not
 * alike. Posting is the thing you do in chat, continuously; setting an avatar is
 * something most players do once, ever. A player trying several photos in a row
 * — the only legitimate burst — is comfortably inside ten, and nobody
 * legitimately changes their picture ten times in an hour. The hour-long window
 * is what bounds the SUSTAINED rate: ten a minute would permit six hundred an
 * hour and bound very little.
 */
export const AVATAR_UPLOAD_LIMIT = 10
export const AVATAR_UPLOAD_WINDOW_MS = 60 * 60 * 1000

/** The window fields as they sit on a player row, both absent until the first upload. */
export type AvatarUploadWindow = {
  avatarWindowStartedAt?: number
  avatarUploadsInWindow?: number
}

/**
 * The window to write after allowing one more upload URL, or `null` to refuse.
 *
 * THE SAME FIXED-WINDOW ALGORITHM AS lib/chat.ts's nextPostWindow, over its own
 * field pair and its own limit, and kept as its own small named function for
 * that file's stated reason: a reader should never have to ask which limit a
 * call site uses before trusting the line.
 *
 * IT ONLY RETURNS THE REFUSAL — the caller decides what to throw, exactly as
 * nextPostWindow leaves RATE_LIMITED to sendMessageFor. That is what keeps this
 * function pure, and therefore testable at all: the mutation around it reads an
 * authenticated player and convex-test cannot stand one up (wordle-teams-bya).
 *
 * THE WINDOW LIVES ON THE PLAYER ROW, which `requirePlayer` has ALREADY READ by
 * the time this is called — so enforcing the limit costs one extra write and no
 * extra read. chatReads carries chat's window for the same reason, stated in
 * schema.ts: counting recent activity instead would pay database I/O to protect
 * database I/O.
 */
export function nextAvatarUploadWindow(
  current: AvatarUploadWindow,
  now: number,
): Required<AvatarUploadWindow> | null {
  const startedAt = current.avatarWindowStartedAt
  const count = current.avatarUploadsInWindow ?? 0

  // Checked explicitly rather than defaulting startedAt to 0 — see
  // nextPostWindow, whose comment this repeats because the trap is the same:
  // a 0 default only reads as "expired" while `now` is large.
  if (startedAt === undefined || now - startedAt >= AVATAR_UPLOAD_WINDOW_MS) {
    return { avatarWindowStartedAt: now, avatarUploadsInWindow: 1 }
  }
  if (count >= AVATAR_UPLOAD_LIMIT) return null

  return { avatarWindowStartedAt: startedAt, avatarUploadsInWindow: count + 1 }
}
