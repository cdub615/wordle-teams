/**
 * ROUTE-CONDITIONAL SITE CHROME: which routes replace the shared furniture
 * __root.tsx renders around every page.
 *
 * IT LIVES IN src/lib/ RATHER THAN IN components/chat/, WHICH IS WHERE IT WAS
 * BORN AND WHY IT MOVED. `hidesSiteFooter` is consumed by __root.tsx — the
 * entry route, present in every chunk graph — so importing it out of
 * components/chat/use-chat-sync.ts made the ROOT depend on a chat module.
 * Rollup answered that by hoisting use-chat-sync into a 2.9 kB chunk shared
 * between the entry and /chat: every visitor to the marketing pages downloaded
 * chat's pointer sync, its unread queries and their Convex api imports to
 * answer one string comparison about a pathname.
 *
 * A PATHNAME PREDICATE HAS A HOME HERE ALREADY, and this file is placed beside
 * it deliberately: `cachePolicyFor` (lib/cache-policy.ts) and
 * `isMaintenanceGated` (lib/maintenance.ts) are both pure functions of a
 * pathname, tested without a router, importing nothing from a feature. This is
 * the third of them, and the reason the first two are worth matching is that
 * all three normalise the trailing slash the same way — a rule that only stays
 * consistent while they can be read together.
 */

/**
 * Whether a route replaces the site footer with its own full-height layout.
 *
 * ONLY /chat, AND ONLY BECAUSE /chat IS NOT A DOCUMENT. Every other route in
 * the app is prose or cards that scroll under a footer; chat is a viewport-tall
 * column whose composer is pinned to the bottom edge and whose message list
 * scrolls inside it. A footer below that either pushes the composer off screen
 * or, worse, makes the page scroll past it — which is what it did, and what the
 * owner's phone screenshot shows.
 *
 * THE TRAILING SLASH IS NORMALISED for the same reason cachePolicyFor and
 * isMaintenanceGated normalise it: `/chat/` and `/chat` are the same route, and
 * a reader who arrives on the former would otherwise get the footer back and
 * the broken layout with it.
 *
 * AN EXACT MATCH, NOT `startsWith('/chat')`. There is no nested chat route
 * today, and a hypothetical /chatter or /chat-settings would silently lose the
 * footer — which carries the only links to /privacy and /terms.
 */
export function hidesSiteFooter(pathname: string): boolean {
  const normalised = pathname.length > 1 ? pathname.replace(/\/+$/, '') || '/' : pathname
  return normalised === '/chat'
}
