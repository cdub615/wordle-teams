import { hasUnread } from './use-chat-sync.ts'
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
 * ONE SUBSCRIPTION FOR EVERY BADGE ON THE PAGE, AND THIS COMPONENT DOES NOT
 * OPEN IT. `unread` is the whole cross-team answer, read once in routes/app.tsx
 * and handed down — through TeamPicker to the row badges, and directly to the
 * dashboard's own. The filtering happens here rather than server-side for the
 * same reason it always did: a query parameterised by the badge's own team
 * would turn one subscription into N.
 *
 * IT USED TO CALL `useUnreadTeams` ITSELF, WITH A `teamIds` PROP, and sharing
 * a query key was enough to share a subscription (wordle-teams-w7g2). It is not
 * enough to REMOVE one: the hook now sheds that subscription outright while
 * chat is degraded (wordle-teams-pnhe), and `removeQueries` on a key another
 * component is still observing gets it rebuilt and refetched immediately. One
 * observer is the precondition, so there is now exactly one caller of the hook
 * and everything else takes the answer as a prop. Pass it through; do not call
 * the hook here.
 *
 * NO LOADING OR ERROR BRANCH, DELIBERATELY. `hasUnread` reads both the
 * unresolved (`undefined`) state and a failure as "no dot" — and, since the
 * valve, the same `undefined` covers a caller who has not yet heard anything at
 * all. Rendering nothing is the right answer for all of them: a badge is decoration on someone
 * else's UI, and a spinner or an error message in its place would be louder
 * than the thing it is annotating. The absence of a dot understates unread
 * state for a moment; it never asserts anything false.
 *
 * IMPORTS FROM `use-chat-sync.ts`, NOT FROM `convex/lib/chat.ts`. Nothing under
 * the frontend may reach that module — it pulls in access.ts and auth.ts, whose
 * module scope throws without SITE_URL, and a module-scope throw is a side
 * effect no bundler may tree-shake. See the banner on convex/lib/chatLimits.ts.
 */
export function UnreadBadge({
  teamId,
  unread,
  className,
}: {
  teamId: Id<'teams'>
  /** The whole cross-team answer, from routes/app.tsx. See above. */
  unread: Array<Id<'teams'>> | undefined
  className?: string
}) {
  if (!hasUnread(unread, teamId)) return null

  return <UnreadDot className={className} label="Unread messages" />
}

/**
 * THE MARK ITSELF, WITH NO OPINION ABOUT WHOSE UNREAD IT IS.
 *
 * Split out of `UnreadBadge` for TeamPicker's TRIGGER dot (wordle-teams-qix.25
 * follow-up), which answers a question `UnreadBadge` cannot be asked: not "is
 * THIS team unread" but "is any team OTHER than the selected one" — see
 * `hasUnreadElsewhere`. Sharing the element rather than copying six Tailwind
 * classes is the point: the `bg-accent-solid` decision below is the kind that
 * gets quietly re-litigated as `bg-primary` in a second copy, which is exactly
 * the bug it exists to prevent.
 *
 * `label` OPTIONAL, AND ITS ABSENCE MEANS `aria-hidden`, NOT "unnamed". A dot
 * with no accessible name and no `aria-hidden` is debris in the accessibility
 * tree. The trigger dot passes no label deliberately: it sits inside a button
 * whose own `aria-label` replaces its content anyway, and that label already
 * says what the dot means (`teamPickerLabel`). Naming it there would be dead
 * text at best and a contradiction at worst.
 */
export function UnreadDot({ className, label }: { className?: string; label?: string }) {
  return (
    <span
      // bg-accent-solid, NOT bg-primary (the same call today-panel.tsx's
      // progress fill made, wordle-teams-5jcn.21): --primary maps to --text,
      // which is near-white in dark, so a "notice me" dot painted with it
      // reads as stark white rather than as the brand. --accent-solid is the
      // green already used for prose links and the focus ring, and clears the
      // 3:1 non-text contrast bar in both themes.
      className={`inline-block size-2 shrink-0 rounded-full bg-accent-solid ${className ?? ''}`}
      // The dot carries meaning and has no text, so where it is named at all it
      // needs a name of its own — but NOT role="status": that is a live region,
      // and a page listing six teams would announce six of them on every page
      // load and again on every incoming message. role="img" names the mark
      // without interrupting whatever the reader is doing.
      {...(label === undefined
        ? { 'aria-hidden': true }
        : { role: 'img' as const, 'aria-label': label })}
      data-testid="chat-unread-badge"
    />
  )
}
