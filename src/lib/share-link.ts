/**
 * Hand a URL to the platform: the native share sheet where there is one, the
 * clipboard where there is not.
 *
 * EXTRACTED FROM invite-player-dialog.tsx (zic8.2.19) when the challenge dialog
 * became the second surface that shares a link. Two copies of this rule is how
 * the two surfaces would come to disagree about it, so both call this, and
 * `navigator.share` / `navigator.clipboard.writeText` appear nowhere else in
 * src/. (lib/board-import/adapter.ts reads `navigator.clipboard.read` for a
 * pasted screenshot; that is the other direction and not this rule.)
 *
 * navigator.share FIRST, WHERE IT EXISTS, AND THAT ORDER IS THE POINT. A shared
 * link is a phone-first action and the native sheet — Messages, WhatsApp, the
 * group chat the team already lives in — is the whole reason a link beats
 * typing an address. The clipboard is the FALLBACK, for the desktop browsers
 * that have no share sheet at all. Reversing them would technically work and
 * would throw away the feature's reason for existing.
 *
 * AN AbortError IS NOT A FAILURE. It is what both APIs throw when the user
 * dismisses the share sheet, which is a decision they made on purpose. It comes
 * back as `'dismissed'`, so no caller can turn it into an error toast that tells
 * somebody who just changed their mind that the app is broken. Every OTHER
 * rejection is rethrown: swallowing those too would leave a genuine failure
 * silent.
 *
 * THE CLIPBOARD IS FEATURE-DETECTED TOO, not merely called. Both APIs are
 * `undefined` outside a secure context — an http:// LAN address is how this app
 * gets opened on a real phone during development — and the bare call would be a
 * TypeError that the caller's catch reports as the wrong failure (the mint,
 * which succeeded). `'unavailable'` lets the caller say the true thing.
 *
 * THE OUTCOME IS RETURNED, NOT TOASTED. The copy differs per surface (the
 * invite dialog points back at its email field, which the challenge dialog does
 * not have), so the helper owns the ORDER and the caller owns the WORDS.
 */
export type ShareOutcome = 'shared' | 'copied' | 'dismissed' | 'unavailable'

export async function shareLink({ url, title }: { url: string; title: string }): Promise<ShareOutcome> {
  try {
    if (navigator.share) {
      await navigator.share({ title, url })
      return 'shared'
    }
    if (!navigator.clipboard) return 'unavailable'
    await navigator.clipboard.writeText(url)
    return 'copied'
  } catch (error) {
    if (error instanceof Error && error.name === 'AbortError') return 'dismissed'
    throw error
  }
}
