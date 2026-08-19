import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '#/components/ui/select.tsx'

/**
 * Read-only team selection. Creating, renaming and managing teams is Phase 3;
 * this exists because a scoreboard needs to know which team it is showing.
 */
export type TeamOption = { id: string; name: string }

export function TeamPicker({
  teams,
  value,
  onChange,
}: {
  teams: Array<TeamOption>
  value: string
  onChange: (teamId: string) => void
}) {
  if (teams.length === 0) return null

  return (
    <Select value={value} onValueChange={onChange}>
      <SelectTrigger className="w-44" aria-label="Team">
        <SelectValue placeholder="Pick a team" />
      </SelectTrigger>
      <SelectContent>
        {teams.map((team) => (
          <SelectItem key={team.id} value={team.id}>
            {team.name}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  )
}

export default TeamPicker
