import { Input } from '#/components/ui/input.tsx'
import { Label } from '#/components/ui/label.tsx'
import { Switch } from '#/components/ui/switch.tsx'

/**
 * The name + Play Weekends + Show Letters block shared by CreateTeamDialog
 * and UpdateTeamDialog. Presentational only — no submit handling, no reset
 * effects, no mutation: those genuinely differ between create and update
 * (create resets only on `open`; update also re-seeds when the team's own
 * fields change underneath an open dialog), so they stay in each dialog
 * rather than folding in here.
 *
 * `idPrefix` keeps each dialog's ids/labels distinct in the DOM so two
 * copies of this block never collide if they were ever mounted together.
 */
export function TeamFields({
  idPrefix,
  name,
  onNameChange,
  playWeekends,
  onPlayWeekendsChange,
  showLetters,
  onShowLettersChange,
}: {
  idPrefix: string
  name: string
  onNameChange: (name: string) => void
  playWeekends: boolean
  onPlayWeekendsChange: (playWeekends: boolean) => void
  showLetters: boolean
  onShowLettersChange: (showLetters: boolean) => void
}) {
  return (
    <div className="flex flex-col space-y-4 py-4">
      <div className="flex items-center justify-between">
        <Label htmlFor={`${idPrefix}-team-name`}>Team Name</Label>
        <Input
          id={`${idPrefix}-team-name`}
          required
          className="w-48 md:w-80"
          value={name}
          onChange={(event) => onNameChange(event.target.value)}
        />
      </div>
      <div className="flex items-center justify-between">
        <Label htmlFor={`${idPrefix}-play-weekends`}>Play Weekends</Label>
        <Switch
          id={`${idPrefix}-play-weekends`}
          checked={playWeekends}
          onCheckedChange={onPlayWeekendsChange}
        />
      </div>
      <div className="flex items-center justify-between">
        <Label htmlFor={`${idPrefix}-show-letters`}>Show Letters in Completed Boards</Label>
        <Switch
          id={`${idPrefix}-show-letters`}
          checked={showLetters}
          onCheckedChange={onShowLettersChange}
        />
      </div>
    </div>
  )
}
