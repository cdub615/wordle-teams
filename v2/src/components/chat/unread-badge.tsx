import { convexQuery } from '@convex-dev/react-query'
import { useQuery } from '@tanstack/react-query'
import { hasUnread } from './use-chat-sync.ts'
import { api } from '../../../convex/_generated/api'
import type { Id } from '../../../convex/_generated/dataModel'

/**
 * A dot, never a number, and that is the design rather than a shortcut.
 *
 * `unreadTeams` is `chatMeta.lastMessageAt > chatReads.lastReadAt` per team —
 * two small documents, NO MESSAGE READS AT ALL (see unreadTeamsFor in
 * convex/chat.ts, and spec section 5). Producing "3" instead would mean reading
 * the messages themselves, on every page load, for every team a player is on,
 * which is exactly the cost the whole pointer architecture exists to avoid. The
 * hourly push sweep is where a count is affordable, because it runs once per
 * team per hour rather than on every render. So: presence-of-unread only.
 *
 * ONE SUBSCRIPTION FOR EVERY BADGE ON THE PAGE. `unreadTeams` takes no
 * arguments, so all instances of this component share a single TanStack query
 * key and therefore a single Convex subscription — a team list with ten badges
 * costs one read, not ten. That is why the query is not parameterised by team
 * and the filtering happens here instead; do not "optimise" it into an
 * `unreadFor(teamId)` query, which would turn one subscription into N.
 *
 * NO LOADING OR ERROR BRANCH, DELIBERATELY. `hasUnread` reads both the
 * unresolved (`undefined`) state and a failure as "no dot", and rendering
 * nothing is the right answer for both: a badge is decoration on someone
 * else's UI, and a spinner or an error message in its place would be louder
 * than the thing it is annotating. The absence of a dot understates unread
 * state for a moment; it never asserts anything false.
 *
 * IMPORTS FROM `use-chat-sync.ts`, NOT FROM `convex/lib/chat.ts`. Nothing under
 * the frontend may reach that module — it pulls in access.ts and auth.ts, whose
 * module scope throws without SITE_URL, and a module-scope throw is a side
 * effect no bundler may tree-shake. See the banner on convex/lib/chatLimits.ts.
 */
export function UnreadBadge({ teamId, className }: { teamId: Id<'teams'>; className?: string }) {
  const { data: unread } = useQuery(convexQuery(api.chat.unreadTeams, {}))

  if (!hasUnread(unread, teamId)) return null

  return (
    <span
      // bg-accent-solid, NOT bg-primary (the same call today-panel.tsx's
      // progress fill made, wordle-teams-5jcn.21): --primary maps to --text,
      // which is near-white in dark, so a "notice me" dot painted with it
      // reads as stark white rather than as the brand. --accent-solid is the
      // green already used for prose links and the focus ring, and clears the
      // 3:1 non-text contrast bar in both themes.
      className={`inline-block size-2 shrink-0 rounded-full bg-accent-solid ${className ?? ''}`}
      // The dot carries meaning and has no text, so it needs a name of its
      // own — but NOT role="status": that is a live region, and a page
      // listing six teams would announce six of them on every page load and
      // again on every incoming message. role="img" names the mark without
      // interrupting whatever the reader is doing.
      role="img"
      aria-label="Unread messages"
      data-testid="chat-unread-badge"
    />
  )
}
