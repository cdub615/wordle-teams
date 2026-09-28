import {
  CircleCheck,
  Info,
  LoaderCircle,
  OctagonX,
  TriangleAlert,
} from "lucide-react"
import { Toaster as Sonner } from "sonner"

import { useResolvedTheme } from "#/lib/use-resolved-theme.ts"

type ToasterProps = React.ComponentProps<typeof Sonner>

const Toaster = ({ ...props }: ToasterProps) => {
  const theme = useResolvedTheme()

  return (
    <Sonner
      theme={theme}
      className="toaster group"
      /*
        THE TOAST SITS OFF THE EDGE IT IS ANCHORED TO, AND UNDER
        `viewport-fit=cover` THAT EDGE IS PHYSICAL (wordle-teams-8h2p).
        sonner positions its viewport with `--offset-*`/`--mobile-offset-*`
        custom properties measured from the window edges; its defaults are a
        flat 24px on desktop and 16px below 600px, which on a notched phone
        puts the default bottom-right toast squarely under the home indicator.

        WRITTEN AS `max(<sonner's own default>, env(...))` PER SIDE, so this is
        byte-for-byte sonner's current geometry wherever the inset is 0 — every
        desktop, and every phone without a cutout — and grows only where there
        is something to clear. The two objects have to be given separately
        because sonner keeps two independent sets of variables and picks
        between them at 600px; overriding only `offset` would have left the
        phone, the one case this is for, on the untouched 16px default.

        STRINGS, NOT NUMBERS: sonner assigns a number as `${n}px` and passes a
        string through verbatim into the custom property, which is what lets a
        `max()`/`env()` expression reach the stylesheet at all. It then does
        arithmetic on these (`calc(var(--offset-left) * -1)`, `* 2`), and a
        `max()` is a valid calc operand, so that still resolves.

        BEFORE `{...props}`, so a caller can still override the offsets.
      */
      offset={{
        top: "max(24px, env(safe-area-inset-top))",
        right: "max(24px, env(safe-area-inset-right))",
        bottom: "max(24px, env(safe-area-inset-bottom))",
        left: "max(24px, env(safe-area-inset-left))",
      }}
      mobileOffset={{
        top: "max(16px, env(safe-area-inset-top))",
        right: "max(16px, env(safe-area-inset-right))",
        bottom: "max(16px, env(safe-area-inset-bottom))",
        left: "max(16px, env(safe-area-inset-left))",
      }}
      // DESIGN_SYSTEM.md section 10 drift #9: in v1, success and error toasts
      // render identically and only the copy tells them apart. Distinct icon
      // shapes fix that; success and error also carry their semantic colour,
      // which clears AA on the toast surface (5.02:1 and 4.83:1). warning and
      // info deliberately inherit — --warning is #facc15, only 1.7:1 here, so
      // colouring it would read as broken rather than as emphasis.
      icons={{
        success: <CircleCheck className="h-4 w-4 text-success" />,
        info: <Info className="h-4 w-4" />,
        warning: <TriangleAlert className="h-4 w-4" />,
        error: <OctagonX className="h-4 w-4 text-danger" />,
        loading: <LoaderCircle className="h-4 w-4 animate-spin" />,
      }}
      toastOptions={{
        classNames: {
          toast:
            "group toast group-[.toaster]:bg-background group-[.toaster]:text-foreground group-[.toaster]:border-border group-[.toaster]:shadow-lg",
          description: "group-[.toast]:text-muted-foreground",
          actionButton:
            "group-[.toast]:bg-primary group-[.toast]:text-primary-foreground",
          cancelButton:
            "group-[.toast]:bg-muted group-[.toast]:text-muted-foreground",
        },
      }}
      {...props}
    />
  )
}

export { Toaster }
