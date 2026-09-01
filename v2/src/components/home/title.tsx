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
 * THE HIGHLIGHT'S FOREGROUND IS `text-warning-foreground`, WHICH IS NOT AN
 * ARBITRARY PICK. The band runs green (--brand-from #16a34a) to yellow
 * (--brand-to #facc15) and BOTH of those tokens hold the same value in light and
 * dark, so the text on top must not fork by theme either — v1's
 * `text-black dark:text-white` puts white on #facc15 in dark mode, which is
 * about 1.1:1 and unreadable. --warning-foreground is #111113 in both themes:
 * 5.72:1 on the green end (the figure src/styles.css records for that exact
 * pair) and far more on the yellow. It is also the token that already pairs with
 * --warning/--brand-to, so this obeys the "background and foreground travel
 * together" rule rather than hand-picking a neutral.
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
        <span className="rounded bg-gradient-to-r from-brand-from via-brand-from to-brand-to px-1 font-bold text-warning-foreground">
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
