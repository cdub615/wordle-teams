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
import { FREE_TEAM_LIMIT } from '../../convex/lib/teamLimits.ts'

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
  value,
  isPro,
  onChange,
  onCreate,
  onUpgrade,
}: {
  teams: Array<TeamOption>
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
          aria-label={`Team: ${name}`}
          className="max-w-[9.5rem] px-2 text-xs md:max-w-none md:px-4 md:text-sm"
        >
          {label}
          <ChevronDown className="ml-1 h-4 w-4 md:ml-2" />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="start">
        <DropdownMenuLabel>Change Team</DropdownMenuLabel>
        <DropdownMenuSeparator />
        <DropdownMenuRadioGroup value={value} onValueChange={onChange}>
          {teams.map((team) => (
            <DropdownMenuRadioItem key={team.id} value={team.id}>
              {team.name}
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
