import { Link } from '@tanstack/react-router'
import { ArrowRight } from 'lucide-react'
import { Button } from '#/components/ui/button.tsx'

/**
 * The hero. Copy ported verbatim from v1's src/components/home/title.tsx — the
 * logo, "Compete with friends", the bragging-rights line and "Get Started".
 * The MARKUP is rewritten; three of v1's dependencies are deliberately not.
 *
 * NO `Highlight` (@/components/ui/aceternity/hero-highlight). v1 wraps "ultimate
 * app for Wordle enthusiasts" in an aceternity component whose entire job is to
 * wipe a gradient background in over two seconds with framer-motion. wt-ksh.12.5
 * already ruled the aceternity dependency out for the About carousel and the
 * reasoning is identical here: the static end state of that animation is a
 * gradient-backed span, which is one `<span>`. It is rendered as one below.
 *
 * NO framer-motion. v2 does not have the dependency, and the only thing v1 uses
 * it for on this page is the wipe above plus one fade-in on the screenshot.
 *
 * NO GeistSans-per-element. v1 pastes `GeistSans.className` onto the h1 and the
 * paragraph individually (DESIGN_SYSTEM.md section 3, drift #5). v2 has Geist as
 * the `font-display` token in src/styles.css; that is what it is for.
 *
 * THE HIGHLIGHT RUNS `from-brand-from via-brand-from to-warning` UNDER
 * `text-warning-foreground`. Both halves were re-decided by this task's review,
 * and every figure below was recomputed for it rather than quoted.
 *
 * v1's band is `from-green-600 via-green-600 to-yellow-400 dark:to-yellow-500`
 * (src/components/ui/aceternity/hero-highlight.tsx:79) under
 * `text-black dark:text-white` — so its yellow end is #facc15 light and #eab308
 * dark, and its foreground forks by theme. Measured:
 *
 *   light  #000000 on #16a34a   6.37:1     on #facc15  13.71:1
 *   dark   #ffffff on #16a34a   3.30:1     on #eab308   1.92:1
 *
 * v1's dark highlight fails AA at BOTH ends and is essentially invisible at the
 * yellow one. (The gradient's luminance rises monotonically from green to
 * yellow, so the green end is the worst case for dark text and the yellow end
 * for light text. Those two are what decide it.)
 *
 * --warning-foreground is #111113 in both themes and --warning is #facc15 light
 * / #eab308 dark, which is exactly v1's pair of yellows. Measured:
 *
 *   light  #111113 on #16a34a   5.72:1     on #facc15  12.32:1
 *   dark   #111113 on #16a34a   5.72:1     on #eab308   9.83:1
 *
 * Worst case 5.72:1 in both themes. SAY THE REGRESSION OUT LOUD RATHER THAN THE
 * WIN ALONE: light mode gets slightly WORSE, 6.37 -> 5.72, because #111113 is
 * not #000000. It is still the right trade — it buys 1.92 -> 5.72 in dark — but
 * it is a real change to a case that already passed, and it is recorded as such
 * in V2-ADDENDUM.md section 7a alongside the theme-invariant foreground it
 * comes from.
 *
 * `to-warning`, NOT `to-brand-to`, AND THAT IS THE HALF THE REVIEW CHANGED.
 * --brand-to is #facc15 in BOTH themes, so ending the band there made v2's dark
 * highlight brighter than production's — an undocumented divergence introduced
 * by a token choice whose stated purpose was avoiding one. --warning is the
 * token --warning-foreground actually pairs with, so "background and foreground
 * travel together" is now literally true here instead of approximately, and the
 * colours match v1 in both themes. The cost is that in dark mode this yellow
 * (#eab308) differs from the header wordmark's --brand-to (#facc15) — which is
 * also v1's behaviour: its app bar ends at yellow-400 in both themes
 * (src/components/app-bar/app-bar-base.tsx:73) while its highlight ends at
 * yellow-500 in dark.
 */
export function Title() {
  return (
    <section className="flex flex-col items-center gap-4 px-4 py-12 text-center md:py-24">
      <img
        src="/wt-icon-144x144.png"
        alt="Wordle Teams logo"
        width={144}
        height={144}
        className="h-20 w-20 md:h-36 md:w-36"
      />
      <h1 className="font-display text-3xl font-bold text-foreground md:text-6xl">
        Compete with friends
      </h1>
      <p className="font-display m-0 max-w-2xl px-2 text-lg text-muted-foreground md:text-3xl md:leading-10">
        Keep score to establish bragging rights in the{' '}
        <span className="rounded bg-gradient-to-r from-brand-from via-brand-from to-warning px-1 font-bold text-warning-foreground">
          ultimate app for Wordle enthusiasts
        </span>
      </p>
      <Button asChild size="lg" className="mt-4 md:mt-8">
        {/* `no-underline` because src/styles.css's base layer styles every <a>,
            and asChild makes this anchor the button itself. */}
        <Link to="/login" className="group/get-started no-underline">
          Get Started
          <ArrowRight
            aria-hidden="true"
            className="transition-transform duration-300 ease-in-out group-hover/get-started:translate-x-0.5"
          />
        </Link>
      </Button>
    </section>
  )
}
