import { Loader2 } from 'lucide-react'
import { Button, type ButtonProps } from '#/components/ui/button.tsx'
import { Popover, PopoverContent, PopoverTrigger } from '#/components/ui/popover.tsx'
import type { ReactNode } from 'react'

/**
 * The destructive-confirmation shape shared by current-team-card.tsx (remove
 * member) and my-teams-card.tsx (delete team) — extracted after the latter's
 * width bug (wt-ksh.4.28) turned out to be the same bug the former still had.
 *
 * Presentational only: the caller owns the `open`/`pending` state, the
 * mutation, and its own try/catch/finally, toast copy, and success handling.
 * This component owns only the popover markup, the width cap, and the
 * pending-spinner swap on the confirm button.
 *
 * The width cap is load-bearing, not decorative: PopoverContent's default
 * w-auto sizes to its content, and an un-wrappable long team name can push
 * that content past the viewport edge on a phone. max-w caps it to the
 * viewport rather than just the trigger, and break-words on the message lets
 * the name actually wrap instead of overflowing.
 */
export function ConfirmPopover({
  open,
  onOpenChange,
  trigger,
  message,
  confirmLabel,
  confirmSize,
  pending,
  onConfirm,
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
  trigger: ReactNode
  message: ReactNode
  confirmLabel: ReactNode
  confirmSize?: ButtonProps['size']
  pending: boolean
  onConfirm: () => void
}) {
  return (
    <Popover open={open} onOpenChange={onOpenChange}>
      <PopoverTrigger asChild>{trigger}</PopoverTrigger>
      <PopoverContent className="w-auto max-w-[min(20rem,calc(100vw-2rem))]">
        <div className="flex flex-col space-y-4">
          <span className="break-words">{message}</span>
          <Button
            variant="destructive"
            size={confirmSize}
            disabled={pending}
            aria-disabled={pending}
            onClick={onConfirm}
          >
            {pending && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
            {confirmLabel}
          </Button>
        </div>
      </PopoverContent>
    </Popover>
  )
}
