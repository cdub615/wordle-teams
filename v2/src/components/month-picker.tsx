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
 * THAT WINDOW IS STILL THE FREE ONE FOR EVERYONE, RIGHT NOW. app.tsx calls
 * `monthWindowFor` with `earliestMonth: null` because it does not yet query the
 * team's earliest board, so `spanFor` falls back to `FREE_MONTHS` regardless of
 * `pro`. wordle-teams-kusd.6 is what supplies the real query and, with it, a real
 * `teaserLabel` — until it lands, a reader of THIS file should not conclude the
 * Pro window is live from the props alone; app.tsx is where that is still true.
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
   * ALWAYS NULL TODAY. routes/app.tsx hardcodes this rather than calling
   * `proTeaserMonth`, because that function needs the team's earliest board and
   * the route does not query it yet (see `months`' sibling note above).
   * wordle-teams-kusd.6 is what wires the query and starts passing a real value
   * through here.
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

            NO EXPLICIT LEFT INSET ON THE ITEM BELOW, AND ITS "Back to" TEXT
            STILL LANDS FLUSH WITH "Aug 2026" ABOVE IT — checked by rendering
            this component's actual DOM output through the app's own compiled
            Tailwind stylesheet in real Chromium and reading
            getBoundingClientRect() off both text nodes, since jsdom has no
            layout engine and this repo's e2e suite is mutation-measured as
            blind to layout (neither could have caught a regression here).
            The two land on the same pixel because DropdownMenuItem's default
            `px-2` + this Sparkles icon's `h-4` + the item's own `gap-2` sum to
            exactly 2rem — the same 2rem DropdownMenuRadioItem spends on `pl-8`
            for its indicator well. That identity is shadcn's own convention
            for mixing icon rows with checkbox/radio rows in one menu, not a
            coincidence specific to this file, but it is arithmetic a reader
            has to redo by hand, not something the markup states — so it breaks
            silently if the icon stops being `h-4`, if the gap stops being
            `gap-2`, or if `DropdownMenuItem`'s own base padding ever changes.
            Reaching for the `inset` prop here would NOT fix that fragility —
            it would ADD `pl-8` on top of the icon and gap that already supply
            the equivalent indent, pushing the text a further 1.5rem right and
            breaking the alignment this comment just proved holds.

            IT IS THE SIXTH CALLER OF THE UPGRADE PATH. Header.tsx, trial-ended-card.tsx,
            board-entry/import-upsell.tsx, routes/app.tsx (TeamPicker's own
            onUpgrade) and routes/insights.tsx are the others. wordle-teams-iht.1
            puts one shared interstitial behind all of them; when it lands this
            must go through it rather than remaining the one path that still
            reaches checkout directly. That issue's notes carry the count.

            THE "Pro" BADGE IS PART OF THE ACCESSIBLE NAME, not hidden from it —
            "Back to Mar 2023 Pro" — matching the one load-bearing thing
            board-entry/import-upsell.tsx's own "Pro" badge does the same way.
            The markup itself differs: that badge is `text-muted-foreground`,
            carries a `Lock` icon, and is laid out with `flex items-center
            gap-1`; this one has none of those. Only the accessible-name choice
            is asserted to match, not the visual badge. */}
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
