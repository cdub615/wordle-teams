import { cn } from '#/lib/utils.ts'
import type { Shot } from './marketing-copy.ts'

/**
 * One of Task 2's screenshots, in the theme the page is actually painted in,
 * cropped by its caller.
 *
 * TWO <img> TAGS AND A CLASS, NOT <picture> WITH prefers-color-scheme, AND THAT
 * IS A DELIBERATE DEPARTURE FROM THE TASK'S OWN WORDING. This app does not take
 * its theme from the OS: lib/theme.ts stores 'light' | 'dark' | 'auto' under the
 * `theme` key and writes a `light`/`dark` CLASS onto <html>, and __root.tsx runs
 * a stringified copy of that logic before first paint so the page never flashes
 * the wrong theme. `prefers-color-scheme` answers the OS question, which is the
 * right answer only on 'auto'. A returning player who chose light while their
 * phone is in dark — and the launch email is aimed squarely at returning
 * players — would get a light page carrying three dark screenshots, and no
 * media query can see the class that decided it. `dark:hidden` reads the same
 * class the rest of the page reads, so the shot cannot disagree with the page
 * around it.
 *
 * ONLY ONE OF THE TWO IS FETCHED, WHICH IS THE OBJECTION THIS ANSWERS. A
 * `display: none` <img> has no layout box, so it never intersects the viewport,
 * so `loading="lazy"` never triggers its fetch — the hidden theme's file costs
 * nothing until the theme changes, at which point it is wanted. Both files are
 * around 60 KB, so the alternative — eager on both — would be a real cost on a
 * phone for the half the reader will never see.
 *
 * `loading="lazy"` ON THE VISIBLE ONE TOO, INCLUDING THE FIRST SHOT ON THE PAGE.
 * The lazy threshold is generous (hundreds of pixels beyond the fold in every
 * engine that implements it), so a near-viewport image still loads immediately;
 * what it buys is the uniform rule that makes the hidden-twin trick above work
 * at all. The hero's LCP candidate is the h1 and the logo, neither of which is
 * this.
 *
 * WIDTH AND HEIGHT ARE THE INTRINSIC SIZE, NOT THE RENDERED ONE, so the box
 * reserves its space before the bytes arrive. The landing page's three files
 * are all 1440x900 full frames, which is why that pair is the default; the crop
 * is the caller's `className` (an aspect ratio) plus `imgClassName` (an
 * object-fit and an object-position), never a second copy of the file.
 *
 * AND THAT IS WHY THE PAIR IS NOW A PROP (wordle-teams-wty4.1.14.5). The
 * capture script grew element-clipped shots for /about — a dialog is 512px
 * wide, not 1440 — and a component that hardcoded 1440x900 would have handed
 * the browser a 1.6:1 box to reserve for a 0.72:1 image, which is the exact
 * reflow these attributes exist to prevent, written down on purpose. The
 * default keeps every existing caller byte-identical; src/about-screenshots.test.ts
 * checks each /about caller's pair against its PNG's own IHDR chunk, so a
 * re-shot file that changes size fails a gate instead of shipping.
 */
export function ProductShot({
  shot,
  className,
  imgClassName,
  width = 1440,
  height = 900,
}: {
  shot: Shot
  /** The frame: a border, a radius, and the aspect ratio that does the cropping. */
  className?: string
  /** How the file sits inside that frame — object-fit and -position. */
  imgClassName?: string
  /** The PNG's own intrinsic width. Both twins must share it. */
  width?: number
  /** The PNG's own intrinsic height. */
  height?: number
}) {
  const common = cn('h-full w-full', imgClassName)

  return (
    <div
      className={cn(
        'overflow-hidden rounded-xl border border-line-subtle bg-surface shadow-sm',
        className,
      )}
    >
      <img
        src={`/marketing/${shot.stem}-light.png`}
        alt={shot.alt}
        width={width}
        height={height}
        loading="lazy"
        decoding="async"
        className={cn(common, 'dark:hidden')}
      />
      {/* The same alt on both: `hidden` takes the other one out of the
          accessibility tree entirely, so exactly one description is ever
          announced, and which one depends on the theme. */}
      <img
        src={`/marketing/${shot.stem}-dark.png`}
        alt={shot.alt}
        width={width}
        height={height}
        loading="lazy"
        decoding="async"
        className={cn(common, 'hidden dark:block')}
      />
    </div>
  )
}
