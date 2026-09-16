import { ChevronDown } from 'lucide-react'
import { Button } from '#/components/ui/button.tsx'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuLabel,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '#/components/ui/dropdown-menu.tsx'
import { formatMonthLabel } from '#/lib/format-day.ts'
import type { PuzzleMonth } from '../../../convex/lib/puzzleDay.ts'

/**
 * What the Layer 3 card is scoped to — which team, and which month — as the two
 * controls that CHANGE it, sitting in that card's own header beside its title.
 *
 * A SIMPLER SIBLING OF team-picker.tsx, NOT A REUSE OF IT, and the difference is
 * affordances rather than styling. TeamPicker's menu ends in "New Team" or
 * "Upgrade for more"; neither belongs inside a card about last month's guessing
 * averages. It also takes `isPro` and `unread` props, and routes/insights.tsx
 * reads NEITHER today — wiring them up would mean adding `teams.amIPro` and the
 * chat unread subscription to a page whose whole design note is that it reads
 * the roster once and nothing else (see that route's comment on
 * wordle-teams-dcu). What this file DOES take from TeamPicker is its
 * conventions: the truncation, the responsive width cap, and the `aria-label`
 * rule below. Read that file before changing any of the three.
 *
 * DropdownMenu, NOT THE NATIVE `<select>` daily-benchmark.tsx USES — and that
 * card's two filters sit in a header beside a title exactly like these, so the
 * difference is not where they are but what they do. Those two FILTER a list
 * this page already holds, in local state, and never touch the URL. These two
 * change WHICH MONTH AND WHICH TEAM the page reads, through `?team=` and
 * `?month=` — the same job month-picker.tsx and team-picker.tsx do on the
 * dashboard, in the same IDIOM: an outline Button trigger with a chevron, over a
 * DropdownMenuRadioGroup.
 *
 * THE IDIOM, NOT THE METRICS, AND THE DIFFERENCE IS DELIBERATE. MonthPicker's
 * trigger takes the Button's default size — `h-10 px-4 py-2` — plus `md:px-4`;
 * these take `size="sm"`, so `h-9 px-3` plus `md:px-3`. The product therefore has
 * two month dropdowns of different heights, and that is the right trade here
 * rather than an oversight: 36px is the target height daily-benchmark.tsx states
 * for its own controls, and that card sits ON THIS PAGE one card below these. A
 * control matching the dashboard's height while mismatching its own page's would
 * be the worse inconsistency. Do not "fix" this by dropping `size="sm"` without
 * moving daily-benchmark.tsx too.
 *
 * MonthPicker WAS THE NEAR-MISS, and it deserves the note this file's long
 * argument about TeamPicker does not give it: MonthDropdown below is close to a
 * clone of it. What stops the reuse is one thing — `monthOptions(currentMonth)`
 * is computed INSIDE that component and hardcodes a three-month window, while
 * this dropdown's list is the team's own (`teamMonthOptions`, from its
 * `createdAt`). An `options` prop on MonthPicker would have closed the gap, and
 * is the obvious move if a third caller ever wants a month dropdown.
 *
 * NO QUERY OF ITS OWN, AND NEITHER FOR THE CARDS THAT HOST IT. Everything here
 * arrives as a prop from routes/insights.tsx, which already holds the roster and
 * `navigate`. team-panel.tsx's header states the same rule for its `teamName`
 * prop and gives the bandwidth reason; this follows it rather than reopening it.
 */

/** One option in the team dropdown — the id it navigates to, and its label. */
export type TeamScopeTeam = { id: string; name: string }

/**
 * The month dropdown's whole existence, as one optional prop.
 *
 * GROUPED SO THE THREE CANNOT BE SUPPLIED SEPARATELY. A month dropdown needs a
 * selection, a list, and somewhere to send a change; three independent optional
 * props would make "options but no handler" a shape the types allow and a dead
 * control the reader can click. One object makes it all-or-nothing.
 *
 * ABSENT IS THE FREE BRANCH. daily-team-fact.tsx states a fact about TODAY, and
 * today has no month to choose — see routes/insights.tsx's note on `today` for
 * why that component reads the clock and not `?month=`.
 */
export type MonthScope = {
  value: PuzzleMonth
  /** Newest first, from `teamMonthOptions` — see lib/insights-months.ts. */
  options: Array<PuzzleMonth>
  onChange: (month: PuzzleMonth) => void
}

/**
 * The header a Layer 3 card wears when it holds NOTHING BUT these controls —
 * team-panel.tsx with its title hidden, and daily-team-fact.tsx, which never had
 * a title at all. A CONSTANT RATHER THAN A CLAIM IN PROSE: the two headers used
 * to assert in comments that they matched, with nothing holding them to it.
 *
 * ONE WHOLE LITERAL, NEVER ASSEMBLED FROM FRAGMENTS. Tailwind scans source text
 * for candidate class names, so a class name built by concatenation is one it
 * never sees and never emits — this project has already shipped an invisible
 * component and a zero-height one that way, with every gate green. Each card
 * appends its own `pb-*`, also as a literal token, for the same reason.
 *
 * `justify-end` IS THE LOAD-BEARING MEMBER, AND THIS IS THE CANONICAL STATEMENT
 * OF WHY. An `sr-only` title is `position: absolute` and therefore NOT a flex
 * item, so a header in this shape has exactly ONE in-flow child — and
 * `justify-between` puts a lone item at the START. Without this the controls
 * would sit hard left, on the opposite side from every other shape on the page.
 * Anywhere else that reasoning is needed, cite this rather than restating it.
 */
export const CONTROLS_ONLY_HEADER = 'flex-row items-center justify-end space-y-0'

/**
 * Whether the team dropdown has anything to offer.
 *
 * ONE TEAM IS NOT A CHOICE. A dropdown whose only option is the one already
 * selected is furniture, and an account on a single team is the case this page
 * must not change at all. Exported because a caller that renders the
 * controls into a header it would otherwise not draw at all needs to ask the
 * same question, and the rule must have one spelling: daily-team-fact.tsx has no
 * title, so its header exists ONLY when there is a control to put in it.
 */
export function showsTeamDropdown(teams: Array<TeamScopeTeam>): boolean {
  return teams.length > 1
}

export function TeamScopeControls({
  teams,
  teamId,
  onTeamChange,
  month,
}: {
  teams: Array<TeamScopeTeam>
  /** The selected team's id — `?team=`, already resolved against the roster. */
  teamId: string
  onTeamChange: (teamId: string) => void
  month?: MonthScope
}) {
  const showTeams = showsTeamDropdown(teams)

  // Nothing to choose on either axis: one team and no month scope.
  //
  // A SAFETY NET, NOT A LIVE PATH, and it was once described as one. No caller
  // can reach it today: routes/insights.tsx's free branch asks
  // `showsTeamDropdown` BEFORE it builds this at all, and its pro branch always
  // passes a month scope. Nor would reaching it collapse a header — TeamPanel
  // draws its own either way. It stays because a component that can render an
  // empty padded row is worse than one that cannot, and the next caller need not
  // know the rule to be safe.
  if (!showTeams && !month) return null

  return (
    // `shrink-0` SO THE TITLE YIELDS AND THE CONTROLS DO NOT. Where this sits
    // beside a title in one flex row, without it the browser is free to squeeze
    // a button instead of the text next to it, and a squeezed button clips its
    // own chevron. The title carries the matching `min-w-0 truncate` — see
    // team-panel.tsx.
    //
    // `justify-end` IS FOR THE STACKED CASE, AND ONLY THAT ONE. In a flex ROW
    // the parent's own `justify-*` decides where a shrink-wrapped child sits,
    // so this is inert in team-panel.tsx's `md` row and in daily-team-fact.tsx,
    // both of which right-align it themselves. It earns its keep below `md`,
    // where team-panel.tsx stacks its header into a COLUMN: a flex container
    // with no `align-items` of its own stretches its children, so this row then
    // spans the card and would otherwise leave the dropdowns hard left, on the
    // opposite side from where every other width puts them.
    <div
      className="flex shrink-0 items-center justify-end gap-1.5"
      data-testid="insights-team-scope-controls"
    >
      {showTeams && <TeamDropdown teams={teams} teamId={teamId} onChange={onTeamChange} />}
      {month && <MonthDropdown month={month} />}
    </div>
  )
}

function TeamDropdown({
  teams,
  teamId,
  onChange,
}: {
  teams: Array<TeamScopeTeam>
  teamId: string
  onChange: (teamId: string) => void
}) {
  const name = teams.find((team) => team.id === teamId)?.name ?? 'No team selected'
  const label = name.length > 15 ? `${name.slice(0, 15)}...` : name

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button
          variant="outline"
          size="sm"
          // A static aria-label OVERRIDES the button's text content for the
          // accessibility tree, so a bare "Team" here would hide which team is
          // selected. The FULL name, never the truncated `label`: truncation is
          // a visual affordance for a narrow trigger, not something a screen
          // reader user should have to sit through. Same wording as
          // teamPickerLabel's unread-free form (components/chat/use-chat-sync.ts).
          aria-label={`Team: ${name}`}
          // CAPPED BECAUSE THIS IS THE ONE CONTROL WHOSE WIDTH IS SOMEBODY'S
          // DATA rather than a fixed label — uncapped, a long team name decides
          // how wide the header is. No `sm` step, unlike TeamPicker's
          // 9.5rem -> 7.5rem: that trigger shares one 390px row with four other
          // controls (routes/app.tsx's width table) and this one never shares a
          // row that tight. The `md` step up to 12rem pays for `md:text-sm` and
          // `md:px-3`, which without it ellipsed a name as ordinary as "Ada's
          // Analysts" on a 1280px screen. Both measured in headless chromium
          // over the BUILT stylesheet, which is the only thing that can see it.
          className="max-w-[9.5rem] px-2 text-xs md:max-w-[12rem] md:px-3 md:text-sm"
          data-testid="insights-team-scope-team"
        >
          {/* `truncate` BECAUSE `label` SHORTENS BY CHARACTERS, WHICH IS NOT A
              WIDTH. Fifteen wide characters still exceed the cap above, and
              with nothing to clip them the text simply paints over the chevron.
              It is also what lets this shrink at all: a flex item with
              `overflow: hidden` gets an automatic minimum size of zero. */}
          <span className="truncate">{label}</span>
          <ChevronDown className="ml-1 h-4 w-4" aria-hidden="true" />
        </Button>
      </DropdownMenuTrigger>
      {/* `align="end"` BECAUSE THIS TRIGGER IS AT THE CARD'S RIGHT EDGE. Radix
          CENTRES a menu on its trigger by default (`align = "center"` in
          @radix-ui/react-popper; components/ui/dropdown-menu.tsx overrides only
          `sideOffset`), so a menu wider than this trigger would hang off the
          card on the side there is no room on. TeamPicker uses `align="start"`
          for the mirror reason — it sits at the LEFT end of the dashboard's
          control row. */}
      <DropdownMenuContent align="end">
        <DropdownMenuLabel>Change Team</DropdownMenuLabel>
        <DropdownMenuSeparator />
        <DropdownMenuRadioGroup value={teamId} onValueChange={onChange}>
          {teams.map((team) => (
            <DropdownMenuRadioItem key={team.id} value={team.id}>
              {team.name}
            </DropdownMenuRadioItem>
          ))}
        </DropdownMenuRadioGroup>
      </DropdownMenuContent>
    </DropdownMenu>
  )
}

function MonthDropdown({ month }: { month: MonthScope }) {
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button
          variant="outline"
          size="sm"
          // Carries the selection for the same reason the team trigger does —
          // the label above it is the override, not the addition.
          aria-label={`Month: ${formatMonthLabel(month.value)}`}
          className="px-2 text-xs md:px-3 md:text-sm"
          data-testid="insights-team-scope-month"
        >
          {/* 'Aug 2026' — formatMonthLabel's short form (lib/format-day.ts), so
              this needs no cap of its own: every label it can produce is the
              same handful of characters wide. */}
          {formatMonthLabel(month.value)}
          <ChevronDown className="ml-1 h-4 w-4" aria-hidden="true" />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end">
        <DropdownMenuLabel>Change Month</DropdownMenuLabel>
        <DropdownMenuSeparator />
        <DropdownMenuRadioGroup value={month.value} onValueChange={month.onChange}>
          {month.options.map((option) => (
            <DropdownMenuRadioItem key={option} value={option}>
              {formatMonthLabel(option)}
            </DropdownMenuRadioItem>
          ))}
        </DropdownMenuRadioGroup>
      </DropdownMenuContent>
    </DropdownMenu>
  )
}
