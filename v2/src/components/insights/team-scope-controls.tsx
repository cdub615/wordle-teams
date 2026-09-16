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
 * dashboard, in the same shape, so that one job keeps one appearance.
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
 * Whether the team dropdown has anything to offer.
 *
 * ONE TEAM IS NOT A CHOICE. A dropdown whose only option is the one already
 * selected is furniture, and an account on a single team is the case this page
 * must not change at all. Exported because a caller that renders the
 * controls into a header it would otherwise not draw at all needs to ask the
 * same question, and the rule must have one spelling: daily-team-fact.tsx has no
 * title, so its header exists ONLY when there is a control to put in it.
 */
export function showsTeamPicker(teams: Array<TeamScopeTeam>): boolean {
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
  const showTeams = showsTeamPicker(teams)

  // Nothing to choose on either axis: one team and no month scope. Renders
  // nothing rather than an empty row, so the header it sits in collapses to
  // exactly the title it had before this file existed.
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
      data-testid="insights-scope-controls"
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
          // A CAP, FOR TeamPicker'S REASON: this is the only control in the
          // header whose width is somebody's data rather than a fixed label, so
          // it is the one that has to be bounded, or a long team name decides
          // how wide the header is and the title beside it pays for the room.
          //
          // NO EXTRA SQUEEZE ON A PHONE, UNLIKE TeamPicker, and that is a
          // consequence of the header rather than a disagreement with it. That
          // trigger drops 9.5rem -> 7.5rem below `sm` because it shares ONE ROW
          // with four other controls at 390px (see routes/app.tsx's width
          // table). This one never shares a row that tight: team-panel.tsx
          // stacks its header below `md`, so the controls get the card's full
          // width, and daily-team-fact.tsx has no title to share a row with at
          // all. Measured in headless chromium over the BUILT stylesheet — at
          // 390px the card's header is 324px wide inside its padding, and a
          // name long enough to hold this at its cap makes the pair 263 of it.
          //
          // 12rem FROM `md`, WHERE THE TYPE AND THE PADDING BOTH GROW.
          // `md:text-sm` and `md:px-3` together cost enough of 9.5rem that a
          // name as ordinary as "Ada's Analysts" ellipsed on a 1280px screen
          // with 300px of unused header beside it — measured the same way.
          // Bounded rather than TeamPicker's `md:max-w-none`: uncapping here
          // would let a long name shrink the TITLE, which is showing that same
          // name in full.
          className="max-w-[9.5rem] px-2 text-xs md:max-w-[12rem] md:px-3 md:text-sm"
          data-testid="insights-scope-team"
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
          data-testid="insights-scope-month"
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
