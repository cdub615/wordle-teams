import type { GameId } from '../../convex/lib/games.ts'
import { Button } from '#/components/ui/button.tsx'
import { cn } from '#/lib/utils.ts'

const LABELS: Readonly<Record<GameId, string>> = { wordle: 'Wordle', clueLadder: 'Clue ladder' }
const ORDER: ReadonlyArray<GameId> = ['wordle', 'clueLadder']

/** Which game the dashboard's scores table shows. aria-pressed buttons, as leagues/group-picker.tsx uses. */
export function GameSwitch({
  value,
  onChange,
  className,
}: {
  value: GameId
  onChange: (game: GameId) => void
  className?: string
}) {
  return (
    <div role="group" aria-label="Scores for" className={cn('flex gap-2', className)}>
      {ORDER.map((game) => (
        <Button
          key={game}
          type="button"
          size="sm"
          variant={game === value ? 'default' : 'outline'}
          aria-pressed={game === value}
          onClick={() => onChange(game)}
        >
          {LABELS[game]}
        </Button>
      ))}
    </div>
  )
}
