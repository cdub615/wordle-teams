import { ChevronDown, Sparkles } from 'lucide-react'
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
import { formatMonthLabel } from '#/lib/format-day.ts'
import type { PuzzleMonth } from '../../convex/lib/puzzleDay.ts'

/**
 * The month dropdown.
 *
 * IT TAKES A WINDOW RATHER THAN COMPUTING ONE (wordle-teams-kusd). It used to own
 * `monthOptions`, which returned the same three months to everyone — that function
 * is gone rather than left delegating, because its signature took only
 * `currentMonth` and could not express a window that depends on the viewer's
 * membership and the team's age; left as a wrapper it would be a function any
 * future caller could reach that silently answers "three months" for a Pro player.
 * routes/app.tsx builds the window from convex/lib/monthWindow.ts and hands the
 * SAME array to TeamBoards, so the calendar and this control cannot disagree about
 * which months exist.
 *
 * NO SCROLL CONTAINER OF ITS OWN, even though a Pro list runs to dozens of rows.
 * DropdownMenuContent already carries
 * `max-h-[var(--radix-dropdown-menu-content-available-height)] overflow-y-auto`
 * (ui/dropdown-menu.tsx's own class list), which is viewport-aware and therefore
 * better than a computed height on a phone. v1 wraps its own long dropdown in a
 * ScrollArea with a hand-computed height (src/components/action-buttons/month-dropdown/utils.ts);
 * porting that here would nest a second scroll container inside one that already
 * works, and v2 has no ScrollArea primitive to port it with.
 */
export function MonthPicker({
  value,
  months,
  teaserLabel,
  onChange,
  onUpgrade,
}: {
  value: PuzzleMonth
  /** Every month this viewer may select, newest first. `monthWindowFor`'s output. */
  months: Array<PuzzleMonth>
  /**
   * The already-formatted month Pro reaches back to, or null when there is
   * nothing to advertise — a pro viewer, a team with no boards, or a team whose
   * earliest board is already inside the free window. `proTeaserMonth` decides
   * and the route formats; this only renders.
   *
   * A FORMATTED STRING RATHER THAN A PuzzleMonth, so that deleting the guard
   * below renders an empty label instead of throwing: `formatMonthLabel(null)`
   * reaches `Intl.DateTimeFormat.format(Invalid Date)`, which raises a
   * RangeError. A guard whose only mutant is a crash cannot be mutation-tested —
   * the crash proves the component still runs, not that the guard works.
   */
  teaserLabel: string | null
  onChange: (month: PuzzleMonth) => void
  onUpgrade: () => void
}) {
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button variant="outline" className="px-2 text-xs md:px-4 md:text-sm">
          {formatMonthLabel(value)}
          <ChevronDown className="ml-1 h-4 w-4 md:ml-2" />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent>
        <DropdownMenuLabel>Change Month</DropdownMenuLabel>
        <DropdownMenuSeparator />
        <DropdownMenuRadioGroup value={value} onValueChange={onChange}>
          {months.map((option) => (
            <DropdownMenuRadioItem key={option} value={option}>
              {formatMonthLabel(option)}
            </DropdownMenuRadioItem>
          ))}
        </DropdownMenuRadioGroup>
        {/* OUTSIDE THE RADIO GROUP, AND THAT IS NOT A STYLE CHOICE. A
            DropdownMenuRadioItem carries a value, so putting this inside would
            make it selectable as a month the window does not contain — which the
            server would then refuse with MONTH_OUT_OF_WINDOW. It is an upgrade
            affordance that happens to live in a month menu.

            IT IS THE SIXTH CALLER OF THE UPGRADE PATH. Header.tsx, trial-ended-card.tsx,
            board-entry/import-upsell.tsx, routes/app.tsx (TeamPicker's own
            onUpgrade) and routes/insights.tsx are the others. wordle-teams-iht.1
            puts one shared interstitial behind all of them; when it lands this
            must go through it rather than remaining the one path that still
            reaches checkout directly. That issue's notes carry the count.

            THE "Pro" BADGE IS PART OF THE ACCESSIBLE NAME, not hidden from it —
            "Back to Mar 2023 Pro" — matching board-entry/import-upsell.tsx,
            which renders the same badge the same way. */}
        {teaserLabel !== null && (
          <>
            <DropdownMenuSeparator />
            <DropdownMenuItem onSelect={onUpgrade}>
              <Sparkles className="h-4 w-4 text-accent-solid" aria-hidden="true" />
              Back to {teaserLabel}
              <span className="ml-auto rounded-full bg-muted px-2 py-0.5 text-[10px] uppercase tracking-wide">
                Pro
              </span>
            </DropdownMenuItem>
          </>
        )}
      </DropdownMenuContent>
    </DropdownMenu>
  )
}

export default MonthPicker
