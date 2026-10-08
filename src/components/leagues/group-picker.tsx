import { useState } from 'react'
import { Button } from '#/components/ui/button.tsx'
import { Input } from '#/components/ui/input.tsx'
import { Sheet, SheetContent, SheetHeader, SheetTitle, SheetTrigger } from '#/components/ui/sheet.tsx'
import { cn } from '#/lib/utils.ts'
import { PICKER_INLINE_MAX } from '../../../convex/lib/league.ts'

export type PickerGroup = { _id: string; name: string; memberCount: number }

type Props = {
  groups: PickerGroup[]
  currentGroupId: string | null
  onPick: (groupId: string) => void
  disabled?: boolean
  className?: string
}

/**
 * Choose a league group. INLINE BUTTONS for a small league (Starting Words has
 * five) and a SEARCHABLE SHEET above PICKER_INLINE_MAX, so a 32-group league
 * later is a data change rather than a redesign (spec §8.3, §8.5).
 */
export function GroupPicker({ groups, currentGroupId, onPick, disabled = false, className }: Props) {
  const [open, setOpen] = useState(false)
  const [search, setSearch] = useState('')

  const choice = (group: PickerGroup, extra?: string) => (
    <Button
      key={group._id}
      type="button"
      variant={group._id === currentGroupId ? 'default' : 'outline'}
      aria-pressed={group._id === currentGroupId}
      disabled={disabled}
      className={cn('font-mono tracking-widest', extra)}
      onClick={() => {
        setOpen(false)
        onPick(group._id)
      }}
    >
      {group.name}
    </Button>
  )

  if (groups.length <= PICKER_INLINE_MAX) {
    return <div className={cn('flex flex-wrap gap-2', className)}>{groups.map((g) => choice(g))}</div>
  }

  const shown = groups.filter((g) => g.name.toLowerCase().includes(search.trim().toLowerCase()))
  return (
    <Sheet open={open} onOpenChange={setOpen}>
      <SheetTrigger asChild>
        <Button type="button" variant="outline" disabled={disabled} className={className}>
          Pick a group
        </Button>
      </SheetTrigger>
      <SheetContent side="bottom">
        <SheetHeader>
          <SheetTitle>Pick a group</SheetTitle>
        </SheetHeader>
        <Input aria-label="Search groups" value={search} onChange={(e) => setSearch(e.target.value)} className="my-3" />
        <div className="flex max-h-[60vh] flex-col gap-2 overflow-y-auto">{shown.map((g) => choice(g, 'justify-start'))}</div>
      </SheetContent>
    </Sheet>
  )
}
