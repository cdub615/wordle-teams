import { hasUnread, useUnreadTeams } from './use-chat-sync.ts'
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
 * ONE SUBSCRIPTION FOR EVERY BADGE ON THE PAGE. Every instance calls
 * `useUnreadTeams` with the SAME `teamIds`, so they share a single TanStack
 * query key and therefore a single Convex subscription — a team list with ten
 * badges costs one read, not ten. That is why the query is not parameterised by
 * the badge's own team and the filtering happens here instead; do not
 * "optimise" it into an `unreadFor(teamId)` query, which would turn one
 * subscription into N.
 *
 * `teamIds` IS A PROP RATHER THAN SOMETHING THIS DERIVES (wordle-teams-w7g2).
 * The query now takes the caller's teams, and the ids are the query key — so a
 * badge that built its own list, however correctly, would be free to build it
 * in a different order and open a second subscription for the same answer. It
 * is derived ONCE, in routes/app.tsx, and passed down through TeamPicker to
 * here. Pass it through; do not rebuild it.
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
export function UnreadBadge({
  teamId,
  teamIds,
  className,
}: {
  teamId: Id<'teams'>
  teamIds: Array<Id<'teams'>> | undefined
  className?: string
}) {
  const { data: unread } = useUnreadTeams(teamIds)

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
