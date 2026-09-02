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
 *
 * "SOURCE CODE" DOES NOT POINT WHERE v1 POINTS IT, and that is the one link
 * here that is deliberately not a faithful port. v1's own footer links
 * github.com/cdub615/wordleteams, which 404s — the repository is
 * cdub615/wordle-teams, with the hyphen, which is what v1's OWN About page
 * links (src/components/about.tsx) and what this file now links too
 * (wordle-teams-xmk, measured: 404 against the first, 200 against the second).
 * It matters more in v2 than it did in v1: v1 imports its footer only from the
 * home component, so the dead link sat on one page, while __root.tsx renders
 * this under every route. Recorded in §7a of
 * docs/design-system/V2-ADDENDUM.md so the parity audit does not read the
 * difference as a regression.
 *
 * EVERY LABEL/TARGET PAIR BELOW IS PINNED, both the `<Link>`s and the `<a>`s,
 * by *"the footer sends each label to the destination it names"* in
 * src/routes.test.ts. It is worth saying why that test grew: it existed, it was
 * exhaustive, and it read `<Link to=` only — so it was structurally incapable
 * of seeing the class of link the dead URL was in. A one-character error
 * survived a whole parity phase inside a file that had a test.
 */
export default function Footer() {
  const year = new Date().getFullYear()

  return (
    // `px-4` OFF THE FOOTER ELEMENT for the same reason it came off the header:
    // the inner band below carries the gutter, so this was a second one stacked
    // on the first. The element still spans full width for its top border.
    <footer className="mt-20 border-t border-line-subtle pb-14 pt-10 text-sm text-muted-foreground">
      {/*
        `page-max`, THE SAME BAND THE HEADER AND THE DASHBOARD USE. All three
        share one rule — cap, centring and a gutter that tracks the grid's gap,
        all of it in styles.css — so they line up at every width rather than
        only above the cap. See Header.tsx for the measurements that showed
        page-wrap and page-max disagreeing below ~1472.
      */}
      <div className="page-max flex flex-col gap-8">
        <div className="flex flex-wrap gap-x-24 gap-y-6">
          <div className="flex flex-col gap-2">
            <a href="https://feedback.wordleteams.com/feedback">Feedback</a>
            <a href="https://feedback.wordleteams.com/changelog">Changelog</a>
            <a href="mailto:support@wordleteams.com">Support</a>
          </div>
          <div className="flex flex-col gap-2">
            <Link to="/about">About</Link>
            <a href="https://github.com/cdub615/wordle-teams">Source Code</a>
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
