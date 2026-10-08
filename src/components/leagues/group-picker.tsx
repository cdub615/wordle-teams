import { useId, useState } from 'react'
import { Button } from '#/components/ui/button.tsx'
import { Input } from '#/components/ui/input.tsx'
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle, SheetTrigger } from '#/components/ui/sheet.tsx'
import { cn } from '#/lib/utils.ts'
import { PICKER_INLINE_MAX } from '../../../convex/lib/league.ts'

export type PickerGroup = { _id: string; name: string; memberCount: number }

type Props = {
  groups: PickerGroup[]
  currentGroupId: string | null
  onPick: (groupId: string) => void
  disabled?: boolean
  className?: string
  /** Accessible name of the inline group of choices. */
  label?: string
}

/**
 * Choose a league group. INLINE BUTTONS for a small league (Starting Words has
 * five) and a SEARCHABLE SHEET above PICKER_INLINE_MAX, so a 32-group league
 * later is a data change rather than a redesign (spec §8.3, §8.5).
 */
export function GroupPicker({ groups, currentGroupId, onPick, disabled = false, className, label = 'League groups' }: Props) {
  const [open, setOpen] = useState(false)
  const [search, setSearch] = useState('')
  const id = useId()

  const choice = (group: PickerGroup, extra?: string) => (
    <Button
      key={group._id}
      type="button"
      variant={group._id === currentGroupId ? 'default' : 'outline'}
      aria-pressed={group._id === currentGroupId}
      aria-describedby={`${id}-${group._id}-count`}
      disabled={disabled}
      className={cn('font-mono tracking-widest', extra)}
      onClick={() => {
        setOpen(false)
        setSearch('')
        onPick(group._id)
      }}
    >
      {group.name}
      <span aria-hidden="true" className="ml-2 text-xs font-normal tracking-normal tabular-nums opacity-70">
        {group.memberCount}
      </span>
      <span id={`${id}-${group._id}-count`} aria-hidden="true" className="sr-only">
        {group.memberCount === 1 ? '1 member' : `${group.memberCount} members`}
      </span>
    </Button>
  )

  if (groups.length <= PICKER_INLINE_MAX) {
    return <div role="group" aria-label={label} className={cn('grid grid-cols-3 gap-2 sm:flex sm:flex-wrap', className)}>{groups.map((g) => choice(g))}</div>
  }

  const shown = groups.filter((g) => g.name.toLowerCase().includes(search.trim().toLowerCase()))
  return (
    <Sheet
      open={open}
      onOpenChange={(next) => {
        setOpen(next)
        if (!next) setSearch('')
      }}
    >
      <SheetTrigger asChild>
        <Button type="button" variant="outline" disabled={disabled} className={className}>
          Pick a group
        </Button>
      </SheetTrigger>
      <SheetContent side="bottom">
        <SheetHeader>
          <SheetTitle>Pick a group</SheetTitle>
          <SheetDescription>Pick the group your boards count for.</SheetDescription>
        </SheetHeader>
        <Input aria-label="Search groups" value={search} onChange={(e) => setSearch(e.target.value)} className="my-3" />
        <div className="flex max-h-[60vh] flex-col gap-2 overflow-y-auto">
          {shown.length === 0 ? (
            <p className="text-sm text-muted-foreground">No group matches</p>
          ) : (
            shown.map((g) => choice(g, 'justify-between'))
          )}
        </div>
      </SheetContent>
    </Sheet>
  )
}
