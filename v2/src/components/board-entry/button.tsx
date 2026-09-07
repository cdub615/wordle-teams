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
import type { ReactNode } from 'react'
import type { Id } from '../../../convex/_generated/dataModel'

/**
 * The board-entry panel itself, with no opinion about what opens it.
 *
 * Dialog on desktop, top Sheet on mobile — DESIGN_SYSTEM.md §7, "On mobile the
 * same content renders as a top Sheet instead."
 *
 * The Sheet's height and top are bound to the visual viewport so it sits above
 * the keyboard: iOS Safari does not reflow a fixed panel when the keyboard
 * opens, and Radix locks body scroll, so without this the lower guess rows and
 * Submit are unreachable.
 *
 * SPLIT OUT OF BoardEntryButton so a caller that already has its own control
 * can open this panel without a second button appearing beside the first. Open
 * state is the caller's, not this component's, for the same reason.
 *
 * `trigger` IS A FUNCTION OF `isDesktop`, not a node. The two branches want
 * genuinely different triggers — the desktop one carries its accessible name as
 * visible text, the mobile one is icon-only and carries it as an aria-label —
 * and a Radix trigger has to be a descendant of its own Dialog/Sheet root, so
 * the caller cannot simply wrap this. Passing a function keeps the trigger's
 * markup with the caller that owns it while leaving the media query here, read
 * once. Omit it entirely for a fully controlled panel with no trigger at all.
 *
 * `teamId` is OPTIONAL because boards are player-owned: upsertBoard takes no
 * teamId and dailyScores has no team column, so a player with no team can enter
 * one. BoardEntryForm picks its prefill query from this. See form.tsx.
 */
export function BoardEntrySurface({
  open,
  onOpenChange,
  teamId,
  month,
  trigger,
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
  teamId?: Id<'teams'>
  month: string
  trigger?: (isDesktop: boolean) => ReactNode
}) {
  const isDesktop = useMediaQuery('(min-width: 768px)')
  const { height, offsetTop } = useVisualViewport()

  if (isDesktop) {
    return (
      <Dialog open={open} onOpenChange={onOpenChange}>
        {trigger && <DialogTrigger asChild>{trigger(true)}</DialogTrigger>}
        <DialogContent>
          <DialogHeader className="pb-4">
            <DialogTitle>Add or Update Board</DialogTitle>
            <DialogDescription>Enter the day&apos;s answer and then your guesses</DialogDescription>
          </DialogHeader>
          <BoardEntryForm teamId={teamId} month={month} onSuccess={() => onOpenChange(false)} />
        </DialogContent>
      </Dialog>
    )
  }

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      {trigger && <SheetTrigger asChild>{trigger(false)}</SheetTrigger>}
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
        <BoardEntryForm teamId={teamId} month={month} onSuccess={() => onOpenChange(false)} />
      </SheetContent>
    </Sheet>
  )
}

/**
 * The toolbar's own way in: a button that opens BoardEntrySurface.
 *
 * `label` DEFAULTS TO "Board Entry", the toolbar's own wording, so every call
 * site that predates this prop keeps its accessible name unchanged. It exists
 * because today-panel.tsx (wordle-teams-vgat) renders a SECOND instance of
 * this button on the very same page as app.tsx's toolbar one — both `!iPlayed`
 * conditions can be true together — and two controls sharing one accessible
 * name is a strict-mode hazard for a locator and a screen reader both: a
 * reader tabbing through gets "Board Entry" twice with nothing to tell them
 * apart. The label drives BOTH branches — the desktop button's visible text
 * and the mobile button's aria-label — because the desktop branch has no
 * separate aria-label to override independently; its accessible name IS its
 * visible text.
 */
export function BoardEntryButton({
  teamId,
  month,
  label = 'Board Entry',
}: {
  teamId: Id<'teams'>
  month: string
  label?: string
}) {
  const [open, setOpen] = useState(false)

  return (
    <BoardEntrySurface
      open={open}
      onOpenChange={setOpen}
      teamId={teamId}
      month={month}
      trigger={(isDesktop) =>
        isDesktop ? (
          <Button variant="secondary">
            {label}
            <Plus size={20} className="ml-2" />
          </Button>
        ) : (
          <Button className="text-xs" variant="secondary" aria-label={label}>
            <Plus size={20} />
          </Button>
        )
      }
    />
  )
}

export default BoardEntryButton
