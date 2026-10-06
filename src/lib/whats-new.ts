/**
 * WHAT'S NEW: THE RELEASE MARKER AND WHETHER THIS BROWSER HAS SEEN IT
 * (wordle-teams-ued7).
 *
 * Players had no in-app way to learn what changed. The main menu links to the
 * Feedbase changelog as "What's new", with an unread dot that WE light at
 * release time. There is deliberately no Feedbase integration: the owner wants
 * the dot to be something we control, so "is there something new" is a date
 * compiled into this file, not a question asked of a third party.
 *
 * THE RELEASE STEP lives on LATEST_RELEASE below, because that constant is the
 * one thing the person releasing has to touch.
 *
 * SEEN-STATE IS PER BROWSER, in localStorage. Opening What's new writes
 * LATEST_RELEASE as seen; the dot shows while what is stored is older. Syncing
 * it to the account (a Convex field and a mutation, for a dot) was ruled out in
 * the epic, and the owner accepted that a second device shows the dot once more.
 *
 * FIRST VISIT (nothing stored): a signed-in player SEES the dot, so existing
 * players learn of the current release once; a signed-out visitor never gets
 * one. A silent first visit was ruled out — existing players would never have
 * seen the dot for the release that introduced it.
 *
 * NOTHING HERE MAY THROW. Private mode and "block all site data" make a bare
 * `window.localStorage` access throw rather than answer null, and the server
 * render has no `window` at all. These are called from the menu, on every page;
 * a throw is a broken menu for a browser setting unrelated to a cosmetic dot.
 * Every failure degrades to "no dot, link still works" (AC6). The read is also
 * only meaningful AFTER HYDRATION — the server cannot see localStorage, so the
 * menu computes the dot after mount rather than risk a hydration mismatch.
 *
 * THE KEY LIVES HERE, beside the functions that use it, for the reason
 * lib/last-login.ts gives: a key spelled in two places is a key that can be
 * spelled differently in one of them, and the failure is silent.
 */

/**
 * THE DATE (YYYY-MM-DD) OF THE NEWEST ENTRY ON THE FEEDBASE CHANGELOG.
 *
 * THE RELEASE STEP (AC7) — do these in this order:
 *   1. Post the entry on https://feedback.wordleteams.com/changelog.
 *   2. Set this constant to that entry's date, and ship.
 * Bumping it re-lights the dot for every signed-in player who had seen the
 * previous one. Posting without bumping lights nothing; bumping without posting
 * lights a dot that leads to nothing new — hence the order.
 *
 * It MUST stay zero-padded YYYY-MM-DD: hasUnreadRelease compares it as a
 * string, which is date order only in that form (a test pins the shape).
 */
export const LATEST_RELEASE = '2026-10-06'

/**
 * Where What's new goes. Footer.tsx and routes/about.tsx spell the same URL
 * inline under the label "Changelog"; this is the one spelling the menu uses.
 */
export const WHATS_NEW_URL = 'https://feedback.wordleteams.com/changelog'

/** The localStorage key holding the last release this browser opened. */
export const WHATS_NEW_SEEN_KEY = 'wt.whatsNew.seen'

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/

/**
 * The release this browser last opened What's new for, or null — for nothing
 * stored, a blocked store, no window (SSR), or a MALFORMED value.
 *
 * MALFORMED READS AS NEVER-SEEN, deliberately. A value that is not YYYY-MM-DD
 * cannot be ordered against the marker, and compared raw anything beginning
 * with a letter or a '9' sorts after every real date — the dot would be
 * silenced for every future release. As null, the dot shows once (to a
 * signed-in player) and opening What's new overwrites the value with a good
 * one. The validation sits here rather than in hasUnreadRelease so that the
 * pure rule stays exactly the one the epic states.
 */
export function readSeenRelease(): string | null {
  try {
    const seen = window.localStorage.getItem(WHATS_NEW_SEEN_KEY)
    return seen !== null && ISO_DATE.test(seen) ? seen : null
  } catch {
    // Blocked store, or no window at all on the server: "nothing seen". That
    // is NOT a dot on its own — the menu asks canRememberRelease first, and a
    // store it cannot read gets no dot at all (AC6).
    return null
  }
}

/**
 * Whether this browser can remember a release at all. The menu asks this BEFORE
 * readSeenRelease, because that answers null for "blocked" and "never seen"
 * alike, and null is a dot for a signed-in player.
 *
 * A BLOCKED STORE IS NO DOT (AC6). markReleaseSeen cannot write to a store that
 * refuses reads, so a dot there could never be cleared — it would be lit on
 * every visit, for a browser setting. No dot, and the link still works.
 */
export function canRememberRelease(): boolean {
  try {
    window.localStorage.getItem(WHATS_NEW_SEEN_KEY)
    return true
  } catch {
    return false
  }
}

/** Record that this browser has opened What's new for `release`. */
export function markReleaseSeen(release: string = LATEST_RELEASE): void {
  try {
    window.localStorage.setItem(WHATS_NEW_SEEN_KEY, release)
  } catch {
    // The link still opens; the dot may simply come back next visit.
  }
}

/**
 * Whether to show the unread dot. Pure: the menu supplies `seen` from
 * readSeenRelease() after mount, `latest` as LATEST_RELEASE, and `signedIn`.
 *
 * Signed out: never (AC4). Signed in: when nothing is stored (the first-visit
 * rule) or what is stored is older than the latest (AC2, AC5). A stored date
 * NEWER than `latest` — a tab still running an older deploy — counts as read.
 */
export function hasUnreadRelease({
  seen,
  latest,
  signedIn,
}: {
  seen: string | null
  latest: string
  signedIn: boolean
}): boolean {
  return signedIn && (seen === null || seen < latest)
}
