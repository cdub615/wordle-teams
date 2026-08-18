import { Link } from '@tanstack/react-router'

/**
 * Ported from v1's src/components/home/footer.tsx.
 *
 * DELIBERATELY OMITTED: v1's Privacy Policy and Terms links. Those routes do
 * not exist in v2 yet, and a footer full of 404s is worse than a shorter
 * footer. Porting v1's static pages is Phase 7's route-by-route walk.
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
        <p className="m-0 text-xs">&copy; {year} Wordle Teams</p>
      </div>
    </footer>
  )
}
