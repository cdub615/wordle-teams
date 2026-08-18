import * as React from "react"
import { cva, type VariantProps } from "class-variance-authority"

import { cn } from "#/lib/utils.ts"

const badgeVariants = cva(
  "inline-flex items-center rounded-full border px-2.5 py-0.5 text-xs font-semibold transition-colors focus:outline-none focus:ring-2 focus:ring-ring focus:ring-offset-2",
  {
    variants: {
      variant: {
        default:
          "border-transparent bg-primary text-primary-foreground hover:bg-primary/80",
        secondary:
          "border-transparent bg-secondary text-secondary-foreground hover:bg-secondary/80",
        destructive:
          "border-transparent bg-destructive text-destructive-foreground hover:bg-destructive/80",
        // Non-stock, ported from v1 (DESIGN_SYSTEM.md section 7). v1 hardcoded
        // bg-green-600 here; tokenising it is rule 1 in styles.css — a raw
        // green-600 in a component is a missing token.
        //
        // The bundle's stated reason for this change does not hold: it calls
        // v1's pair a "~2.1:1" AA failure, but near-black on green-600 is
        // actually 5.72:1 and passes. This is a tokenisation change, not a
        // contrast fix. It is safe on contrast because wt-ksh.12.3 darkened
        // --success to #15803d, so white-on-success is 5.02:1 in light.
        success:
          "border-transparent bg-success text-success-foreground hover:bg-success/80",
        warning:
          "border-transparent bg-warning text-warning-foreground hover:bg-warning/80",
        outline: "text-foreground",
      },
    },
    defaultVariants: {
      variant: "default",
    },
  }
)

export interface BadgeProps
  extends React.HTMLAttributes<HTMLDivElement>,
    VariantProps<typeof badgeVariants> {}

function Badge({ className, variant, ...props }: BadgeProps) {
  return (
    <div className={cn(badgeVariants({ variant }), className)} {...props} />
  )
}

export { Badge, badgeVariants }
