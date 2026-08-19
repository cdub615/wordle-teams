import * as React from "react"

import { cn } from "#/lib/utils.ts"

const Table = React.forwardRef<
  HTMLTableElement,
  React.HTMLAttributes<HTMLTableElement> & {
    // This div, not any wrapper a caller adds around <Table>, is what
    // actually scrolls: it's the innermost overflow ancestor of <table>. A
    // caller that needs the scroll region to be a keyboard focus target
    // (e.g. tabIndex, aria-label) has to reach it through here.
    //
    // x-axis only (wt-ksh.3.13): this used to be `overflow-auto`, which
    // scrolls both axes. A caller wrapping <Table> in its own overflow-x-auto
    // div gets a NESTED scroll container out of that — this div is bounded
    // by the caller's and so is always first to overflow, making it the real
    // (and only live) scroller, while also letting the table scroll
    // vertically inside its own box instead of the page scrolling. Don't
    // reintroduce a second overflow wrapper around <Table>; if a future
    // caller needs vertical scrolling too, add it explicitly via
    // wrapperProps.className rather than restoring `overflow-auto` here.
    //
    // CORRECTED (wt-ksh.3.15): the comment that used to sit here argued the
    // coercion below was inert because nothing constrains this div's height,
    // which is true for LAYOUT but not for TOUCH — a real mobile device still
    // treats a computed overflow-y: auto as a vertical scroll target and
    // swallows a vertical drag instead of chaining it to the page. Verified
    // by an actual touch-emulating swipe, not by reading computed styles;
    // that reasoning is exactly what shipped the bug. overflow-y is now set
    // explicitly to `hidden` — a legal pairing with overflow-x: auto — rather
    // than leaving the browser's forced coercion (non-visible overflow-x
    // forces overflow-y to auto if left `visible`) to land wherever it lands.
    // Nothing is clipped: this div's height is auto and matches the table's,
    // so there is no vertical overflow for `hidden` to hide. Put a Table
    // inside a Sheet, a modal, or anything with max-h-*/overflow-y-auto and
    // an ancestor WILL constrain this div's height — hidden then clips
    // instead of scrolling, which is still correct here (nothing should
    // scroll vertically) but means a tall table would need its own vertical
    // scroller above this one, added explicitly via wrapperProps.className.
    wrapperProps?: React.HTMLAttributes<HTMLDivElement>
  }
>(({ className, wrapperProps, ...props }, ref) => (
  <div
    {...wrapperProps}
    className={cn(
      "relative w-full overflow-x-auto overflow-y-hidden",
      wrapperProps?.className
    )}
  >
    <table
      ref={ref}
      className={cn(
        "w-full caption-bottom border-separate border-spacing-0 text-sm",
        className
      )}
      {...props}
    />
  </div>
))
Table.displayName = "Table"

// wt-ksh.3.16: the table is now `border-separate` (see Table above), not
// Tailwind preflight's default `border-collapse`. Collapsed and separated
// borders are two different rendering models — under `separate`, borders on
// <tr>/<thead>/<tbody>/<tfoot> are never painted at all; only `<table>` and
// cell elements (`<th>`/`<td>`) can carry a visible border. This used to be
// `[&_tr]:border-b`, targeting the row, which would have silently stopped
// rendering anything the moment the table left `collapse`. The header's
// bottom rule now lives directly on TableHead below instead — nothing to add
// here.
const TableHeader = React.forwardRef<
  HTMLTableSectionElement,
  React.HTMLAttributes<HTMLTableSectionElement>
>(({ className, ...props }, ref) => (
  <thead ref={ref} className={cn(className)} {...props} />
))
TableHeader.displayName = "TableHeader"

// Same border-separate consequence as TableHeader above: this used to be
// `[&_tr:last-child]:border-0`, targeting the row, which is a no-op under
// `separate`. Retargeted at the cells the last row actually contains — see
// TableCell's own border-b below, which this exists to cancel.
const TableBody = React.forwardRef<
  HTMLTableSectionElement,
  React.HTMLAttributes<HTMLTableSectionElement>
>(({ className, ...props }, ref) => (
  <tbody
    ref={ref}
    className={cn("[&_tr:last-child>td]:border-b-0", className)}
    {...props}
  />
))
TableBody.displayName = "TableBody"

// No current caller (grep the repo before assuming otherwise), but left
// consistent with the border-separate model above rather than left with the
// same dead `border-t`/tr-targeted selectors this issue exists to fix
// elsewhere in this file — both were no-ops the moment Table stopped being
// `border-collapse`.
const TableFooter = React.forwardRef<
  HTMLTableSectionElement,
  React.HTMLAttributes<HTMLTableSectionElement>
>(({ className, ...props }, ref) => (
  <tfoot
    ref={ref}
    className={cn(
      "bg-muted/50 font-medium [&_tr:first-child>*]:border-t [&_tr:last-child>*]:border-b-0",
      className
    )}
    {...props}
  />
))
TableFooter.displayName = "TableFooter"

// wt-ksh.3.16: NOT `border-b` any more. `border-collapse: collapse` +
// `position: sticky` on a cell is long-broken across browsers — a collapsed
// border belongs to the table's grid rather than to the cell, so a sticky
// cell repaints outside the normal flow and its border escapes the collapsed
// model, producing both a late/jittery reposition of the sticky cell AND a
// border painted IN ADDITION to the collapsed grid line (the "doubled" row
// line). The table is now `border-separate` (see Table above) specifically so
// sticky cells behave, but a border on <tr> is simply never rendered under
// `separate` — it would silently vanish here if left in place. It now lives
// on TableHead/TableCell below instead, which is the trap this fix has to not
// fall into.
const TableRow = React.forwardRef<
  HTMLTableRowElement,
  React.HTMLAttributes<HTMLTableRowElement>
>(({ className, ...props }, ref) => (
  <tr
    ref={ref}
    className={cn(
      "transition-colors hover:bg-muted/50 data-[state=selected]:bg-muted",
      className
    )}
    {...props}
  />
))
TableRow.displayName = "TableRow"

const TableHead = React.forwardRef<
  HTMLTableCellElement,
  React.ThHTMLAttributes<HTMLTableCellElement>
>(({ className, ...props }, ref) => (
  <th
    ref={ref}
    className={cn(
      "h-12 border-b px-4 text-left align-middle font-medium text-muted-foreground [&:has([role=checkbox])]:pr-0",
      className
    )}
    {...props}
  />
))
TableHead.displayName = "TableHead"

const TableCell = React.forwardRef<
  HTMLTableCellElement,
  React.TdHTMLAttributes<HTMLTableCellElement>
>(({ className, ...props }, ref) => (
  <td
    ref={ref}
    className={cn(
      "border-b p-4 align-middle [&:has([role=checkbox])]:pr-0",
      className
    )}
    {...props}
  />
))
TableCell.displayName = "TableCell"

const TableCaption = React.forwardRef<
  HTMLTableCaptionElement,
  React.HTMLAttributes<HTMLTableCaptionElement>
>(({ className, ...props }, ref) => (
  <caption
    ref={ref}
    className={cn("mt-4 text-sm text-muted-foreground", className)}
    {...props}
  />
))
TableCaption.displayName = "TableCaption"

export {
  Table,
  TableHeader,
  TableBody,
  TableFooter,
  TableHead,
  TableRow,
  TableCell,
  TableCaption,
}
