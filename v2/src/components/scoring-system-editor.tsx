import { useEffect, useState } from 'react'
import { Loader2 } from 'lucide-react'
import { toast } from 'sonner'
import { useConvexMutation } from '@convex-dev/react-query'
import { useMutation } from '@tanstack/react-query'
import type { FormEventHandler } from 'react'
import { api } from '../../convex/_generated/api'
import { Button } from '#/components/ui/button.tsx'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '#/components/ui/dialog.tsx'
import { Input } from '#/components/ui/input.tsx'
import { Label } from '#/components/ui/label.tsx'
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle } from '#/components/ui/sheet.tsx'
import { useMediaQuery } from '#/lib/use-media-query.ts'
import { useVisualViewport } from '#/lib/use-visual-viewport.ts'
import { mutationErrorMessage } from '#/lib/convex-error.ts'
import { toPuzzleDay } from '../../convex/lib/puzzleDay.ts'
import {
  SYSTEM_FIELD_LABELS,
  SYSTEM_FIELDS,
  SYSTEM_VALUE_MAX,
  SYSTEM_VALUE_MIN,
} from '../../convex/lib/scoringSystem.ts'
import type { Id } from '../../convex/_generated/dataModel'
import type { ScoringSystem } from '../../convex/lib/scoring.ts'

/**
 * Edit the team's scoring system. Dialog on desktop, Sheet on mobile — the same
 * split v1's CustomizeButton uses and Phase 2's board entry ports.
 *
 * THE EDIT APPLIES FROM THIS MONTH FORWARD. The mutation writes a version row
 * rather than overwriting the team, so no past month is rewritten. The copy
 * says so, because an editor that silently changed history is what
 * wordle-teams-1j3 was filed about — and an editor that visibly does not is
 * worth stating.
 *
 * The mobile Sheet is bound to the visual viewport, same as board entry
 * (use-visual-viewport.ts): eight rows of label+input plus the footer can
 * exceed what's left above an open keyboard, and a `position: fixed` sheet
 * with no height cap does not reflow for it — it just grows past the visible
 * area with Save unreachable. Binding maxHeight/top and letting the content
 * scroll is what keeps Save reachable.
 */
const FIELDS = SYSTEM_FIELDS.map((field) => ({ field, label: SYSTEM_FIELD_LABELS[field] }))

const ERROR_ID = 'scoring-system-error'

export function ScoringSystemEditor({
  open,
  onOpenChange,
  teamId,
  system,
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
  teamId: Id<'teams'>
  system: ScoringSystem
}) {
  const isDesktop = useMediaQuery('(min-width: 768px)')
  const { height, offsetTop } = useVisualViewport()
  const save = useMutation({ mutationFn: useConvexMutation(api.scoringSystems.setScoringSystem) })
  // Held as strings so a half-typed '-' or an empty box does not become 0 and
  // silently rewrite a value the user was in the middle of changing.
  const [draft, setDraft] = useState<Record<string, string>>(() => asDraft(system))
  const [submitting, setSubmitting] = useState(false)

  // Re-seed on OPEN, same reason update-team-dialog.tsx does: this component
  // is mounted unconditionally — only Radix's Content toggles — so a cancelled
  // edit would otherwise survive and come back on the next open looking like
  // the team's real values.
  useEffect(() => {
    if (open) setDraft(asDraft(system))
  }, [open, system])

  const parsed = FIELDS.map(({ field }) => Number(draft[field]))
  // Per-row validity, not just a single boolean: aria-invalid needs to mark
  // the SPECIFIC offending inputs (fix wt-ksh.4.29 #4), not merely disable
  // Save with no way for a screen-reader user to tell which of the eight
  // fields is the problem.
  const fieldValid = FIELDS.map(
    (_, index) =>
      draft[FIELDS[index].field].trim() !== '' &&
      Number.isInteger(parsed[index]) &&
      parsed[index] >= SYSTEM_VALUE_MIN &&
      parsed[index] <= SYSTEM_VALUE_MAX,
  )
  const valid = fieldValid.every(Boolean)

  const handleSubmit: FormEventHandler<HTMLFormElement> = async (event) => {
    event.preventDefault()
    if (!valid) return
    setSubmitting(true)
    try {
      // Seeded with `{ ...system }` — already a real ScoringSystem, since
      // `system` is one — and every field overwritten from FIELDS below, so
      // this needs no `as unknown as ScoringSystem` cast: FIELDS is derived
      // from SYSTEM_FIELDS (lib/scoringSystem.ts), which `satisfies` makes
      // exhaustive over ScoringSystem's keys, so every field the type expects
      // really does get overwritten by the loop.
      const values = FIELDS.reduce<ScoringSystem>((acc, { field }, index) => {
        acc[field] = parsed[index]
        return acc
      }, { ...system })
      await save.mutateAsync({ teamId, values, today: toPuzzleDay(new Date()) })
      toast.success('Successfully saved scoring system')
      onOpenChange(false)
    } catch (error) {
      toast.error(mutationErrorMessage(error, 'Failed to save scoring system'))
    } finally {
      setSubmitting(false)
    }
  }

  const body = (
    <form onSubmit={handleSubmit} className="space-y-4">
      <div className="flex flex-col space-y-3">
        {FIELDS.map(({ label, field }, index) => (
          <div key={field} className="flex items-center justify-between gap-4">
            <Label htmlFor={`points-${field}`}>{label}</Label>
            <Input
              id={`points-${field}`}
              // NOT inputMode="numeric". That renders a digits-only keypad on
              // iOS Safari with no minus sign, and negative values are the
              // entire point of this feature (the default system alone has
              // sixGuesses: -1 and failed: -3) — a phone user could not enter
              // one or flip an existing field's sign. v1's PointsInput
              // (src/components/app-grid-items/scoring-system/points-input.tsx)
              // uses plain type="text" with no inputMode for the same reason.
              // inputMode="numeric" looks like an obvious mobile improvement;
              // it is not one here. Do not re-add it.
              type="text"
              className="w-24 text-right tabular-nums aria-invalid:border-destructive aria-invalid:ring-destructive"
              value={draft[field]}
              onChange={(event) => setDraft({ ...draft, [field]: event.target.value })}
              aria-invalid={!fieldValid[index]}
              aria-describedby={fieldValid[index] ? undefined : ERROR_ID}
            />
          </div>
        ))}
      </div>
      {!valid && (
        <p id={ERROR_ID} className="text-sm text-destructive" role="alert">
          Every value must be a whole number from {SYSTEM_VALUE_MIN} to {SYSTEM_VALUE_MAX}.
        </p>
      )}
      {/* text-muted-foreground, not text-subtle: this is content that says the
          edit will not rewrite history, and --text-subtle is only 4.31:1 in
          light (V2-ADDENDUM.md §2) — the same reasoning score-cell.tsx uses
          for its N/A cells. */}
      <p className="text-sm text-muted-foreground">
        Applies from this month onward. Past months keep the points they were played under.
      </p>
      <div className="flex gap-2">
        <Button type="button" variant="outline" className="w-full" onClick={() => onOpenChange(false)}>
          Cancel
        </Button>
        <Button
          type="submit"
          className="w-full"
          disabled={submitting || !valid}
          aria-disabled={submitting || !valid}
        >
          {submitting && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
          Save
        </Button>
      </div>
    </form>
  )

  if (isDesktop) {
    return (
      <Dialog open={open} onOpenChange={onOpenChange}>
        {/* w-11/12 rounded-lg matches v1 and update-team-dialog.tsx: shadcn's
            DialogContent default is `w-full max-w-lg ... sm:rounded-lg`, so
            below 640px it is edge-to-edge AND square-cornered. */}
        <DialogContent className="w-11/12 rounded-lg">
          <DialogHeader className="pb-4">
            <DialogTitle className="text-2xl">Scoring System</DialogTitle>
            <DialogDescription>Points awarded by number of attempts</DialogDescription>
          </DialogHeader>
          {body}
        </DialogContent>
      </Dialog>
    )
  }

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent
        side="top"
        className="overflow-y-auto"
        style={{ maxHeight: height || undefined, top: offsetTop }}
      >
        <SheetHeader>
          <SheetTitle className="text-2xl">Scoring System</SheetTitle>
          <SheetDescription>Points awarded by number of attempts</SheetDescription>
        </SheetHeader>
        <div className="px-4 pb-4">{body}</div>
      </SheetContent>
    </Sheet>
  )
}

function asDraft(system: ScoringSystem): Record<string, string> {
  return Object.fromEntries(FIELDS.map(({ field }) => [field, String(system[field])]))
}
