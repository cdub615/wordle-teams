import { Link } from '@tanstack/react-router'
import ThemeToggle from './ThemeToggle'

/**
 * Interim app bar. DESIGN_SYSTEM.md section 8 describes the real one — gradient
 * wordmark left, user affordance right, separator underneath — but the right
 * side needs auth and team state (plan badge, avatar dropdown), so that arrives
 * with Phase 2/3. Until then: wordmark, nav, theme toggle.
 *
 * The wordmark is a Link, not a heading. v1 makes it an <h1> in the app bar,
 * which means every page has an h1 that describes the site rather than the
 * page — and on /login it would now collide with the page's own h1.
 */
export default function Header() {
  return (
    <header className="sticky top-0 z-50 border-b border-line-subtle bg-background/80 px-4 backdrop-blur-lg">
      <nav className="page-wrap flex flex-wrap items-center gap-x-4 gap-y-2 py-3 sm:py-4">
        <Link to="/" className="flex-shrink-0 no-underline">
          {/*
            v1 hardcodes this pair of gradients:
              from-green-600 via-green-500  to-yellow-400
              dark:from-green-600 dark:via-green-300 dark:to-yellow-400
            The brand tokens already fork by theme (--brand-via is #22c55e light,
            #86efac dark), so the dark: variants disappear and the gradient has
            one definition instead of two. This is the tokenisation the design
            system is for — DESIGN_SYSTEM.md section 10, drift #3.
          */}
          <span className="bg-gradient-to-r from-brand-from via-brand-via to-brand-to bg-clip-text text-2xl font-bold text-transparent md:text-3xl">
            Wordle Teams
          </span>
        </Link>

        <div className="order-3 flex w-full flex-wrap items-center gap-x-4 gap-y-1 pb-1 text-sm font-semibold sm:order-none sm:w-auto sm:flex-nowrap sm:pb-0">
          <Link to="/" className="nav-link" activeProps={{ className: 'nav-link is-active' }}>
            Home
          </Link>
          <Link to="/about" className="nav-link" activeProps={{ className: 'nav-link is-active' }}>
            About
          </Link>
        </div>

        <div className="ml-auto flex items-center gap-1.5 sm:gap-2">
          <ThemeToggle />
        </div>
      </nav>
    </header>
  )
}
