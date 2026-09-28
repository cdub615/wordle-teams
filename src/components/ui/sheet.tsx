"use client"

import * as React from "react"
import * as SheetPrimitive from "@radix-ui/react-dialog"
import { cva, type VariantProps } from "class-variance-authority"
import { X } from "lucide-react"

import { cn } from "#/lib/utils.ts"

const Sheet = SheetPrimitive.Root

const SheetTrigger = SheetPrimitive.Trigger

const SheetClose = SheetPrimitive.Close

const SheetPortal = SheetPrimitive.Portal

const SheetOverlay = React.forwardRef<
  React.ElementRef<typeof SheetPrimitive.Overlay>,
  React.ComponentPropsWithoutRef<typeof SheetPrimitive.Overlay>
>(({ className, ...props }, ref) => (
  <SheetPrimitive.Overlay
    className={cn(
      "fixed inset-0 z-50 bg-black/80  data-[state=open]:animate-in data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=open]:fade-in-0",
      className
    )}
    {...props}
    ref={ref}
  />
))
SheetOverlay.displayName = SheetPrimitive.Overlay.displayName

/*
  THE SAFE-AREA PADDING IS PER-SIDE, AND IT HAS TO BE (wordle-teams-8h2p).
  A sheet only touches the edges its variant anchors it to: a `top` sheet's top
  edge is the physical top of the screen under `viewport-fit=cover`, a `bottom`
  sheet's bottom edge is the physical bottom, and `left`/`right` are
  `inset-y-0`, so they touch both. Applying every inset to every side would
  have pushed a bottom sheet's heading 59px down from an edge that is nowhere
  near the notch.

  `max(1.5rem, env(...))` ON EACH, WHICH IS THE IDIOM composer.tsx ESTABLISHED
  AND THE RIGHT ONE HERE: the base `p-6` already puts 1.5rem on that side, so
  these declarations REPLACE an existing value rather than add to one. With
  every inset at 0 they compute to exactly the 1.5rem `p-6` gave, so no sheet
  moves on a flat screen; on a notched one the padded side grows to the inset
  and nothing else changes.

  ORDER MATTERS AND IS NOT AN ACCIDENT. `p-6` is in the base string and these
  are in the variant, so tailwind-merge sees the longhand last and keeps both —
  and Tailwind's own sheet emits `p-*` before `pt-*`/`pb-*`/`pl-*`/`pr-*`, so
  the cascade agrees with the class order.

  THE LEFT/RIGHT INSETS ARE ZERO ON EVERY DEVICE THIS APP CAN CURRENTLY REACH
  — manifest.json locks the installed app to portrait, where the cutout is at
  the top — so `pl`/`pr` here are for a rotated browser tab and cost nothing
  anywhere else.
*/
const sheetVariants = cva(
  "fixed z-50 gap-4 bg-background p-6 shadow-lg transition ease-in-out data-[state=open]:animate-in data-[state=closed]:animate-out data-[state=closed]:duration-300 data-[state=open]:duration-500",
  {
    variants: {
      side: {
        top: "inset-x-0 top-0 border-b pt-[max(1.5rem,env(safe-area-inset-top))] data-[state=closed]:slide-out-to-top data-[state=open]:slide-in-from-top",
        bottom:
          "inset-x-0 bottom-0 border-t pb-[max(1.5rem,env(safe-area-inset-bottom))] data-[state=closed]:slide-out-to-bottom data-[state=open]:slide-in-from-bottom",
        left: "inset-y-0 left-0 h-full w-3/4 border-r pb-[max(1.5rem,env(safe-area-inset-bottom))] pl-[max(1.5rem,env(safe-area-inset-left))] pt-[max(1.5rem,env(safe-area-inset-top))] data-[state=closed]:slide-out-to-left data-[state=open]:slide-in-from-left sm:max-w-sm",
        right:
          "inset-y-0 right-0 h-full w-3/4  border-l pb-[max(1.5rem,env(safe-area-inset-bottom))] pr-[max(1.5rem,env(safe-area-inset-right))] pt-[max(1.5rem,env(safe-area-inset-top))] data-[state=closed]:slide-out-to-right data-[state=open]:slide-in-from-right sm:max-w-sm",
      },
    },
    defaultVariants: {
      side: "right",
    },
  }
)

interface SheetContentProps
  extends React.ComponentPropsWithoutRef<typeof SheetPrimitive.Content>,
    VariantProps<typeof sheetVariants> {}

const SheetContent = React.forwardRef<
  React.ElementRef<typeof SheetPrimitive.Content>,
  SheetContentProps
>(({ side = "right", className, children, ...props }, ref) => (
  <SheetPortal>
    <SheetOverlay />
    <SheetPrimitive.Content
      ref={ref}
      className={cn(sheetVariants({ side }), className)}
      {...props}
    >
      {children}
      {/*
        THE CLOSE BUTTON DOES NOT INHERIT THE PADDING ABOVE, WHICH IS THE
        SUBTLE HALF OF THIS (wordle-teams-8h2p). An absolutely positioned
        child is offset from its container's PADDING BOX — the edge just
        inside the border — so `top-4` is 16px from the sheet's own top edge
        no matter how large `pt-[max(1.5rem,env(...))]` grows. On a `top`
        sheet that edge is the physical top of the screen, so the X would have
        been left sitting behind the notch while the content it belongs to had
        moved safely below it.

        SIDE-AWARE, because the offset is only right where the sheet's top edge
        is the screen's. A `bottom` sheet's top edge is somewhere in the middle
        of the display; adding the inset there would shove the X 59px down into
        its own heading.

        ADDITIVE (`calc(1rem + env(...))`) RATHER THAN `max()`, unlike the
        padding above: 1rem here is the gap between the sheet's edge and the
        button, not a value the inset replaces. Keeping it additive preserves
        that gap — the X stays 16px inside the safe area exactly as it sits
        16px inside the sheet today — where a `max()` would have parked the
        button ON the boundary with the notch touching it.
      */}
      <SheetPrimitive.Close
        className={cn(
          "absolute right-4 rounded-sm opacity-70 ring-offset-background transition-opacity hover:opacity-100 focus:outline-none focus:ring-2 focus:ring-ring focus:ring-offset-2 disabled:pointer-events-none data-[state=open]:bg-secondary",
          side === "bottom" ? "top-4" : "top-[calc(1rem_+_env(safe-area-inset-top))]",
        )}
      >
        <X className="h-4 w-4" />
        <span className="sr-only">Close</span>
      </SheetPrimitive.Close>
    </SheetPrimitive.Content>
  </SheetPortal>
))
SheetContent.displayName = SheetPrimitive.Content.displayName

const SheetHeader = ({
  className,
  ...props
}: React.HTMLAttributes<HTMLDivElement>) => (
  <div
    className={cn(
      "flex flex-col space-y-2 text-center sm:text-left",
      className
    )}
    {...props}
  />
)
SheetHeader.displayName = "SheetHeader"

const SheetFooter = ({
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
SheetFooter.displayName = "SheetFooter"

const SheetTitle = React.forwardRef<
  React.ElementRef<typeof SheetPrimitive.Title>,
  React.ComponentPropsWithoutRef<typeof SheetPrimitive.Title>
>(({ className, ...props }, ref) => (
  <SheetPrimitive.Title
    ref={ref}
    className={cn("text-lg font-semibold text-foreground", className)}
    {...props}
  />
))
SheetTitle.displayName = SheetPrimitive.Title.displayName

const SheetDescription = React.forwardRef<
  React.ElementRef<typeof SheetPrimitive.Description>,
  React.ComponentPropsWithoutRef<typeof SheetPrimitive.Description>
>(({ className, ...props }, ref) => (
  <SheetPrimitive.Description
    ref={ref}
    className={cn("text-sm text-muted-foreground", className)}
    {...props}
  />
))
SheetDescription.displayName = SheetPrimitive.Description.displayName

export {
  Sheet,
  SheetPortal,
  SheetOverlay,
  SheetTrigger,
  SheetClose,
  SheetContent,
  SheetHeader,
  SheetFooter,
  SheetTitle,
  SheetDescription,
}
