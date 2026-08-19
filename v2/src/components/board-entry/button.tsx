import { useState } from 'react'
import { Plus } from 'lucide-react'
import { VisuallyHidden } from 'radix-ui'
import { Button } from '#/components/ui/button.tsx'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from '#/components/ui/dialog.tsx'
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
  SheetTrigger,
} from '#/components/ui/sheet.tsx'
import { useMediaQuery } from '#/lib/use-media-query.ts'
import { useVisualViewport } from '#/lib/use-visual-viewport.ts'
import { BoardEntryForm } from './form.tsx'
import type { Id } from '../../../convex/_generated/dataModel'

/**
 * Dialog on desktop, top Sheet on mobile — DESIGN_SYSTEM.md §7, "On mobile the
 * same content renders as a top Sheet instead."
 *
 * The Sheet's height and top are bound to the visual viewport so it sits above
 * the keyboard: iOS Safari does not reflow a fixed panel when the keyboard
 * opens, and Radix locks body scroll, so without this the lower guess rows and
 * Submit are unreachable.
 */
export function BoardEntryButton({ teamId, month }: { teamId: Id<'teams'>; month: string }) {
  const [open, setOpen] = useState(false)
  const isDesktop = useMediaQuery('(min-width: 768px)')
  const { height, offsetTop } = useVisualViewport()

  if (isDesktop) {
    return (
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogTrigger asChild>
          <Button variant="secondary">
            Board Entry
            <Plus size={20} className="ml-2" />
          </Button>
        </DialogTrigger>
        <DialogContent>
          <DialogHeader className="pb-4">
            <DialogTitle>Add or Update Board</DialogTitle>
            <DialogDescription>Enter the day&apos;s answer and then your guesses</DialogDescription>
          </DialogHeader>
          <BoardEntryForm teamId={teamId} month={month} onSuccess={() => setOpen(false)} />
        </DialogContent>
      </Dialog>
    )
  }

  return (
    <Sheet open={open} onOpenChange={setOpen}>
      <SheetTrigger asChild>
        <Button className="text-xs" variant="secondary" aria-label="Board Entry">
          <Plus size={20} />
        </Button>
      </SheetTrigger>
      <SheetContent
        side="top"
        className="flex flex-col gap-0 overflow-hidden"
        style={{ maxHeight: height || undefined, top: offsetTop }}
      >
        <SheetHeader className="-ml-4 mb-4 mt-4">
          {/*
            Radix requires a Title descendant of Content — without one it logs
            a console warning and the sheet has no accessible name at all for
            screen-reader users, on the primary mobile entry point for the
            feature. Kept out of the painted layout (VisuallyHidden, already a
            dependency via the `radix-ui` umbrella package — see ui/card.tsx
            for the same import pattern) rather than shown like the desktop
            Dialog's title: the mobile sheet is compact and every pixel of
            vertical space here is contested with the keyboard, which is the
            whole reason this component binds to the visual viewport at all.
          */}
          <VisuallyHidden.Root>
            <SheetTitle>Add or Update Board</SheetTitle>
          </VisuallyHidden.Root>
          <SheetDescription>Enter the day&apos;s answer and then your guesses</SheetDescription>
        </SheetHeader>
        <BoardEntryForm teamId={teamId} month={month} onSuccess={() => setOpen(false)} />
      </SheetContent>
    </Sheet>
  )
}

export default BoardEntryButton
