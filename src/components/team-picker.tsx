import { ChevronDown, Plus, Sparkles } from 'lucide-react'
import { Button } from '#/components/ui/button.tsx'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '#/components/ui/dropdown-menu.tsx'
import { UnreadBadge, UnreadDot } from '#/components/chat/unread-badge.tsx'
import { hasUnreadElsewhere, teamPickerLabel } from '#/components/chat/use-chat-sync.ts'
import { FREE_TEAM_LIMIT } from '../../convex/lib/teamLimits.ts'
import type { Id } from '../../convex/_generated/dataModel'

/**
 * Team selection, and the entry point for creating one.
 *
 * A DropdownMenu rather than a Select because that is where "New Team" and
 * "Upgrade for more" live in v1 — a Select would need a second button beside
 * it, which is a shape prod does not have.
 *
 * THE UPGRADE SWAP IS UI-ONLY, exactly as in v1: past two teams a free account
 * is shown "Upgrade for more" instead of "New Team", but createTeam does not
 * enforce a cap and neither does v1's server action.
 */
export type TeamOption = { id: string; name: string }

export function TeamPicker({
  teams,
  unread,
  value,
  isPro,
  onChange,
  onCreate,
  onUpgrade,
}: {
  teams: Array<TeamOption>
  /**
   * The SAME cross-team answer routes/app.tsx passes to its own UnreadBadge —
   * not read here, deliberately. See the comment below.
   */
  unread: Array<Id<'teams'>> | undefined
  value: string
  isPro: boolean
  onChange: (teamId: string) => void
  onCreate: () => void
  onUpgrade: () => void
}) {
  if (teams.length === 0) return null

  const selected = teams.find((team) => team.id === value)
  const name = selected?.name ?? 'No team selected'
  const label = name.length > 15 ? `${name.slice(0, 15)}...` : name
  const atFreeLimit = !isPro && teams.length >= FREE_TEAM_LIMIT
  // `selected?.id`, NOT `value`: with a stale or not-yet-filled `?team=` there
  // is genuinely no selection, and hasUnreadElsewhere is documented to treat
  // that as "every unread team is an other one" rather than silently excluding
  // an id no team has.
  const unreadElsewhere = hasUnreadElsewhere(unread, selected?.id as Id<'teams'> | undefined)

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button
          variant="outline"
          // A static aria-label overrides the button's text content for the
          // accessibility tree, so a plain "Team" would hide which team is
          // actually selected. Use the FULL name here, not the truncated
          // `label` below — truncation is a visual affordance for the trigger,
          // not something a screen-reader user should have to sit through.
          //
          // AND IT CARRIES THE ROLL-UP CLAUSE, because that same override
          // silences the dot below: see teamPickerLabel. The unread-free name
          // is unchanged, which is what keeps two e2e specs' exact-name
          // locators working.
          aria-label={teamPickerLabel(name, unreadElsewhere)}
          // `relative` FOR THE DOT, AND THE DOT IS OUT OF FLOW ON PURPOSE.
          // This trigger is capped, so an in-flow dot would not widen it — it
          // would eat into the width the team name is truncated to fit,
          // clipping the label instead.
          //
          // 7.5rem BELOW `sm`, 9.5rem FROM `sm` UP, AND THAT IS WHAT MAKES THE
          // DASHBOARD ROW FIT A PHONE. This trigger is the widest control in
          // routes/app.tsx's controls row and the only one whose width is
          // someone's data rather than a fixed label or icon; at the old
          // 9.5rem (152px) cap the five controls measured 401px against 374px
          // of usable width at 390px, so the row wrapped and dropped the
          // primary "+" onto a line of its own. 120px here is 32px of the 27px
          // needed — see routes/app.tsx's own note for the whole table. The cap
          // only ever binds a LONG name: anything shorter is unaffected at
          // every width, which is why this is the right control to take it
          // from.
          className="relative max-w-[7.5rem] px-2 text-xs sm:max-w-[9.5rem] md:max-w-none md:px-4 md:text-sm"
        >
          {/* `truncate`, WHICH THE BARE TEXT NODE HERE USED TO BE WITHOUT. The
              `label` above shortens by CHARACTER COUNT, which is not a width:
              15 wide characters can still exceed a 120px cap, and with nothing
              to clip them the text simply painted over the chevron beside it.
              Overflow-hidden with an ellipsis makes the cap graceful instead of
              sharp — and, because a flex item with `overflow: hidden` gets an
              automatic minimum size of zero, it is also what lets this shrink
              at all rather than forcing the button past its own max-width. The
              accessible name is unaffected: it is the FULL name, on the button
              (see teamPickerLabel). */}
          <span className="truncate">{label}</span>
          <ChevronDown className="ml-1 h-4 w-4 md:ml-2" />
          {/* THE SIGNAL THAT MAKES THE MENU WORTH OPENING (wordle-teams-qix.25
              follow-up). Radix unmounts DropdownMenuContent when the menu is
              closed, so the per-team dots inside it do not exist at rest —
              they appear only once someone has already opened the menu, which
              is exactly when they no longer need telling. This dot is the only
              thing in the app that says "another team has traffic" while the
              menu is shut.

              UNNAMED, DELIBERATELY: the button's own aria-label already says
              it, and an element inside an aria-labelled button cannot be heard
              anyway. `UnreadDot` reads a missing `label` as `aria-hidden`
              rather than leaving an unnamed graphic in the tree. */}
          {unreadElsewhere && <UnreadDot className="absolute right-1 top-1" />}
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="start">
        <DropdownMenuLabel>Change Team</DropdownMenuLabel>
        <DropdownMenuSeparator />
        <DropdownMenuRadioGroup value={value} onValueChange={onChange}>
          {teams.map((team) => (
            <DropdownMenuRadioItem key={team.id} value={team.id}>
              {team.name}
              {/* THE PLACEMENT THAT MAKES THE BADGE WORTH HAVING
                  (wordle-teams-qix.25). The dashboard's own "Team chat" dot can
                  only ever answer about the team already on screen; this row is
                  the only thing in the app that says ANOTHER team has traffic —
                  which is the question someone on two or three teams actually
                  has.

                  ONE SUBSCRIPTION FOR THE WHOLE MENU, not one per row — and
                  since wordle-teams-pnhe, ONE OBSERVER for the whole page.
                  Every badge here is handed the SAME `unread` answer, read once
                  in routes/app.tsx, so a menu of ten teams costs one read and
                  the dashboard can drop that subscription outright while chat
                  is degraded. A row that called the hook for itself would open
                  a second observer and defeat the drop; a per-team query would
                  turn one subscription into N.

                  NO ARIA WORK NEEDED HERE, unlike the dashboard button: a
                  menuitemradio takes its accessible name FROM its content, so
                  the badge's own `role="img"` / "Unread messages" is read out
                  after the team's name rather than being replaced by an
                  `aria-label` on the row.

                  IT SITS IN FLOW HERE, unlike the dashboard button's: a menu
                  row is a flex line the item is free to grow, not a control in
                  a row that is already tight on a phone. The `ml-auto` pushes
                  it to the trailing edge; the wrapper carries the gap because
                  a `pl-*` on the badge itself would eat into its `size-2`
                  under the global `box-sizing: border-box` and draw a smaller
                  dot rather than a spaced one. */}
              <span className="ml-auto pl-3">
                <UnreadBadge teamId={team.id as Id<'teams'>} unread={unread} />
              </span>
            </DropdownMenuRadioItem>
          ))}
        </DropdownMenuRadioGroup>
        <DropdownMenuSeparator />
        {atFreeLimit ? (
          <DropdownMenuItem onSelect={onUpgrade}>
            <Sparkles size={18} />
            <span>Upgrade for more</span>
          </DropdownMenuItem>
        ) : (
          <DropdownMenuItem onSelect={onCreate}>
            <Plus size={18} />
            <span>New Team</span>
          </DropdownMenuItem>
        )}
      </DropdownMenuContent>
    </DropdownMenu>
  )
}

export default TeamPicker
