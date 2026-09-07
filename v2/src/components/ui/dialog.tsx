import * as React from "react"
import * as DialogPrimitive from "@radix-ui/react-dialog"
import { X } from "lucide-react"

import { cn } from "#/lib/utils.ts"

const Dialog = DialogPrimitive.Root

const DialogTrigger = DialogPrimitive.Trigger

const DialogPortal = DialogPrimitive.Portal

const DialogClose = DialogPrimitive.Close

const DialogOverlay = React.forwardRef<
  React.ElementRef<typeof DialogPrimitive.Overlay>,
  React.ComponentPropsWithoutRef<typeof DialogPrimitive.Overlay>
>(({ className, ...props }, ref) => (
  <DialogPrimitive.Overlay
    ref={ref}
    className={cn(
      "fixed inset-0 z-50 bg-black/80 data-[state=open]:animate-in data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=open]:fade-in-0",
      className
    )}
    {...props}
  />
))
DialogOverlay.displayName = DialogPrimitive.Overlay.displayName

const DialogContent = React.forwardRef<
  React.ElementRef<typeof DialogPrimitive.Content>,
  React.ComponentPropsWithoutRef<typeof DialogPrimitive.Content>
>(({ className, children, ...props }, ref) => (
  <DialogPortal>
    <DialogOverlay />
    <DialogPrimitive.Content
      ref={ref}
      /*
        THE OVERLAY ABOVE STAYS `fixed inset-0` AND COVERS THE INSETS ON
        PURPOSE (wordle-teams-8h2p). A scrim that stopped at the safe area
        would leave an unscrimmed strip under the notch and over the home
        indicator, which reads as the dialog failing to cover the page. It is
        the CONTENT that has to stay inside the safe area, and this is it.

        `max-h-[calc(100dvh - 2*max(1rem, env(top), env(bottom)))]` PLUS
        `overflow-y-auto`. This box is CENTRED (`top-50%` with a -50%
        translate), so padding it would not move it off an edge — the only way
        a centred box reaches one is by being taller than the space available.
        Bounding its height is therefore the whole fix, and centring does the
        rest: a box of height `H - 2m` sits with exactly `m` above and below it,
        so choosing `m = max(1rem, top-inset, bottom-inset)` clears BOTH insets
        even when they differ (59 above and 34 below on a notched iPhone), which
        subtracting their sum would not have done.

        BARE `env()`s, AND HERE THAT IS CORRECT RATHER THAN THE TRAP: they are
        arguments to a `max()` whose first term is the 1rem this already wants,
        so with every inset at 0 the expression is `100dvh - 2rem` — a dialog
        that was previously unbounded and is now merely kept a sane margin off
        the top and bottom of the screen.

        `overflow-y-auto` IS NOT A NEW SCROLL CONTAINER SO MUCH AS A REACHABLE
        ONE. There was no `max-height` here at all, so a dialog taller than the
        viewport already overflowed it — and Radix locks body scroll while it
        is open, so the overflowing part could not be scrolled to by any means.
        Bounding it without this would have kept that, only clipped. Nothing
        inside is clipped by it: ui/popover.tsx and ui/select.tsx both render
        through a Radix Portal, so no menu opened from a dialog lives in this
        box.
      */
      className={cn(
        "fixed left-[50%] top-[50%] z-50 grid max-h-[calc(100dvh_-_2*max(1rem,env(safe-area-inset-top),env(safe-area-inset-bottom)))] w-full max-w-lg translate-x-[-50%] translate-y-[-50%] gap-4 overflow-y-auto border bg-background p-6 shadow-lg duration-200 data-[state=open]:animate-in data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=open]:fade-in-0 data-[state=closed]:zoom-out-95 data-[state=open]:zoom-in-95 data-[state=closed]:slide-out-to-left-1/2 data-[state=closed]:slide-out-to-top-[48%] data-[state=open]:slide-in-from-left-1/2 data-[state=open]:slide-in-from-top-[48%] sm:rounded-lg",
        className
      )}
      {...props}
    >
      {children}
      <DialogPrimitive.Close className="absolute right-4 top-4 rounded-sm opacity-70 ring-offset-background transition-opacity hover:opacity-100 focus:outline-none focus:ring-2 focus:ring-ring focus:ring-offset-2 disabled:pointer-events-none data-[state=open]:bg-accent data-[state=open]:text-muted-foreground">
        <X className="h-4 w-4" />
        <span className="sr-only">Close</span>
      </DialogPrimitive.Close>
    </DialogPrimitive.Content>
  </DialogPortal>
))
DialogContent.displayName = DialogPrimitive.Content.displayName

const DialogHeader = ({
  className,
  ...props
}: React.HTMLAttributes<HTMLDivElement>) => (
  <div
    className={cn(
      "flex flex-col space-y-1.5 text-center sm:text-left",
      className
    )}
    {...props}
  />
)
DialogHeader.displayName = "DialogHeader"

const DialogFooter = ({
  className,
  ...props
}: React.HTMLAttributes<HTMLDivElement>) => (
  <div
    className={cn(
      "flex flex-col-reverse sm:flex-row sm:justify-end sm:space-x-2",
      className
    )}
    {...props}
  />
)
DialogFooter.displayName = "DialogFooter"

const DialogTitle = React.forwardRef<
  React.ElementRef<typeof DialogPrimitive.Title>,
  React.ComponentPropsWithoutRef<typeof DialogPrimitive.Title>
>(({ className, ...props }, ref) => (
  <DialogPrimitive.Title
    ref={ref}
    className={cn(
      "text-lg font-semibold leading-none tracking-tight",
      className
    )}
    {...props}
  />
))
DialogTitle.displayName = DialogPrimitive.Title.displayName

const DialogDescription = React.forwardRef<
  React.ElementRef<typeof DialogPrimitive.Description>,
  React.ComponentPropsWithoutRef<typeof DialogPrimitive.Description>
>(({ className, ...props }, ref) => (
  <DialogPrimitive.Description
    ref={ref}
    className={cn("text-sm text-muted-foreground", className)}
    {...props}
  />
))
DialogDescription.displayName = DialogPrimitive.Description.displayName

export {
  Dialog,
  DialogPortal,
  DialogOverlay,
  DialogClose,
  DialogTrigger,
  DialogContent,
  DialogHeader,
  DialogFooter,
  DialogTitle,
  DialogDescription,
}
