import { Sparkles } from 'lucide-react'
import { Button } from '#/components/ui/button.tsx'

type Contribution = { mine: number | null; group: number | null; shift: number | null }
type View = { locked: true } | { locked: false; contribution: Contribution | null }

/**
 * The Pro layer (spec §3): free members get the button, never a number. Only
 * the viewer's own average and their group's total ever appear here (§3.2).
 *
 * ONE DECIMAL, like the standings table, so "4.0" here matches "4.0" there.
 */
export function ContributionRow({ view, groupName, onUpgrade }: { view: View; groupName: string; onUpgrade: () => void }) {
  if (view.locked) {
    return (
      <Button type="button" variant="outline" className="self-start" onClick={onUpgrade}>
        <Sparkles className="mr-2 h-4 w-4" aria-hidden="true" />
        See how much you move {groupName}
      </Button>
    )
  }
  const c = view.contribution
  const one = (n: number) => n.toFixed(1)
  let text: string
  if (!c || c.mine === null) text = `Play a board to see what you add to ${groupName}.`
  else if (c.group === null || c.shift === null) text = `Your ${one(c.mine)} — ${groupName} needs more boards to compare.`
  else if (c.shift < 0)
    text = `Your ${one(c.mine)} vs ${groupName}'s ${one(c.group)} — you pull ${groupName} down by ${one(-c.shift)} guesses`
  else if (c.shift > 0)
    text = `Your ${one(c.mine)} vs ${groupName}'s ${one(c.group)} — you push ${groupName} up by ${one(c.shift)} guesses`
  else text = `Your ${one(c.mine)} vs ${groupName}'s ${one(c.group)} — right on ${groupName}'s average`
  return (
    <p data-testid="league-contribution" className="text-sm">
      {text}
    </p>
  )
}
