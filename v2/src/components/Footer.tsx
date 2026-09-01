import { Link } from '@tanstack/react-router'

/**
 * Ported from v1's src/components/home/footer.tsx.
 *
 * THE LEGAL LINKS ARE BACK. They were omitted from Phase 0 through Phase 7
 * Task 4 because /privacy and /terms had no route in v2 and a footer full of
 * 404s is worse than a shorter footer; Task 5 landed both routes, so the
 * omission — and the comment recording it — are gone.
 *
 * ONE COPYRIGHT ROW, NOT TWO. v1's bottom row is a bare "Wordle Teams" span
 * opposite the two links; v2's already carried `© {year} Wordle Teams` on its
 * own line. Merging them keeps v1's layout (identity left, legal right) without
 * printing the name twice.
 */
export default function Footer() {
  const year = new Date().getFullYear()

  return (
    <footer className="mt-20 border-t border-line-subtle px-4 pb-14 pt-10 text-sm text-muted-foreground">
      <div className="page-wrap flex flex-col gap-8">
        <div className="flex flex-wrap gap-x-24 gap-y-6">
          <div className="flex flex-col gap-2">
            <a href="https://feedback.wordleteams.com/feedback">Feedback</a>
            <a href="https://feedback.wordleteams.com/changelog">Changelog</a>
            <a href="mailto:support@wordleteams.com">Support</a>
          </div>
          <div className="flex flex-col gap-2">
            <Link to="/about">About</Link>
            <a href="https://github.com/cdub615/wordleteams">Source Code</a>
            <a href="https://twitter.com/wordleteams">X</a>
          </div>
        </div>
        <div className="flex flex-wrap items-center justify-between gap-x-6 gap-y-2 text-xs">
          <p className="m-0">&copy; {year} Wordle Teams</p>
          <div className="flex gap-6">
            <Link to="/privacy">Privacy Policy</Link>
            <Link to="/terms">Terms</Link>
          </div>
        </div>
      </div>
    </footer>
  )
}
