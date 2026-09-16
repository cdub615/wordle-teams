import { Card, CardContent, CardFooter, CardHeader, CardTitle } from '#/components/ui/card.tsx'
import { formatMonthLabel } from '#/lib/format-day.ts'
import { TREND_MONTHS, attemptsByMonth, trendWindow, type PersonalBoard } from '#/lib/insights-personal.ts'

/**
 * Twelve months, as a shape rather than a table.
 *
 * "August 2026 — 28 boards · avg 4.2" repeated twelve times is not a trend
 * anybody reads; the SHAPE of the bars is the information a table cannot give
 * at a glance. This is the reason the panel exists at all, on a page pitched
 * at $49.99/yr.
 *
 * BARS SCALE FROM ZERO, NEVER FROM THE WORST-CASE MINIMUM. A scale that starts
 * at the best month in the window turns ordinary month-to-month noise into a
 * dramatic slope — that is a false impression on a surface someone pays for,
 * not a chart style. So every bar's height is `meanAttempts / worst * 100`,
 * where `worst` is the largest (i.e. WORST, since fewer guesses is better)
 * mean in the window — never the smallest. A bar chart that instead computed
 * `(value - min) / (max - min)` would flatten the best month to a height of
 * zero and is exactly the bug this comment exists to rule out.
 *
 * `trendWindow` (insights-personal.ts) ALREADY CAPS THE MONTHS SHOWN, so this
 * component does not re-slice — but it is worth restating why the cap matters
 * here specifically: a two-year player has 24 months of history, and 24 bars
 * at a phone's width are illegible slivers with no floor on how thin they can
 * get. TREND_MONTHS is the one cap on that growth.
 *
 * THE LATEST BAR IS ACCENTED ONLY WHEN IT IS ALSO THE BEST MONTH
 * (`trend.latestIsBest`), never merely because it is the most recent. Green in
 * this design system marks an ACHIEVEMENT (see personal-summary.tsx's own
 * comment on the same rule), and "most recent" is not an achievement — a
 * worse month than last month must not get the same colour as a genuinely
 * best one just for being newest.
 *
 * `text-accent-solid`, NEVER `text-success`, FOR THE SAME REASON EVERY OTHER
 * GREEN TEXT IN THIS FEATURE USES IT. `--success` is a background token paired
 * with `--success-foreground` (see badge.tsx) and measures 3.74:1 as text on a
 * dark card, below WCAG AA's 4.5:1. `--accent-solid` is this codebase's
 * established green foreground and has a dark-mode value that clears AA.
 * (Here the accent lands on a `bg-accent-solid` FILL, not text, but the same
 * token is used because it is the one green this design system has decided is
 * safe to reach for — see openers-panel.tsx and personal-summary.tsx.)
 *
 * `insights-months` LIVES ON THIS COMPONENT'S CardContent NOW, NOT ON
 * PersonalHistory's — routes/insights.tsx's own comment on that deletion
 * records the handover. Do not rename it: -insights.hook.test.ts asserts a
 * SINGLE element at that id, and this is now the only place it can resolve.
 */
export function TrendPanel({ boards }: { boards: PersonalBoard[] }) {
  const trend = trendWindow(attemptsByMonth(boards), TREND_MONTHS)
  if (trend.months.length === 0) return null

  // NEVER ZERO: a lone month at meanAttempts 0 would divide by zero and every
  // bar would compute to NaN%. No real board ever means 0 guesses, but the
  // guard costs nothing and matches the same defensive `Math.max(..., 1)` in
  // openers-panel.tsx's RepertoireRow scaling.
  const worst = Math.max(...trend.months.map((row) => row.meanAttempts), 1)
  const latestMonth = trend.months[trend.months.length - 1]!.month

  return (
    <Card data-testid="insights-trend">
      <CardHeader className="pb-2">
        <CardTitle className="text-lg md:text-xl">Your trend</CardTitle>
        {/*
          THE DIRECTION STATED OUTRIGHT, IN WORDS. A bar chart where a shorter
          bar is the good outcome is ambiguous on its own — no axis, tick or
          colour disambiguates "shorter is better" from "shorter is worse" —
          so the sentence carries the one piece of context no amount of visual
          design can substitute for.
        */}
        <p className="text-muted-foreground text-xs">avg guesses · lower is better</p>
      </CardHeader>
      <CardContent data-testid="insights-months">
        {/*
          STRETCH, NOT items-end, ON THIS ROW. It used to be `items-end`, which
          reads as "bottom-align the short columns inside the tall row" but
          actually means every column keeps its own content-driven (`auto`)
          height instead of the row's fixed h-28 — and a CSS percentage height
          resolves against an `auto`-height containing block by falling back to
          `auto` itself (CSS2.1 §10.5). That is not a styling nitpick: it made
          the bar below collapse to 0px in every real browser, silently,
          regardless of `meanAttempts` — verified with headless Chromium against
          this exact markup (wordle-teams-16l9). `flex-1 min-h-0` on the bar
          wrapper below is the other half of the fix: with the column now
          actually stretched to 112px, the wrapper's flex-grow gives it a
          layout-resolved (not percentage-of-auto) height that `height: X%` on
          the fill div can size against.
        */}
        <div className="flex h-28 gap-1.5 md:gap-3">
          {trend.months.map((row) => {
            const emphasise = row.month === latestMonth && trend.latestIsBest
            const label = formatMonthLabel(row.month)
            // `formatMonthLabel` already gives 'Aug 2026'; its first word is
            // the short month name, and that word's first character is the
            // mobile initial. Deriving both from it, rather than adding a
            // second Intl formatter, keeps the month-label decision in one
            // place (format-day.ts) instead of two.
            const shortName = label.split(' ')[0]!
            const initial = shortName[0]!
            const boardsWord = row.boards === 1 ? 'board' : 'boards'

            return (
              <div key={row.month} className="flex min-w-0 flex-1 flex-col items-center gap-1">
                {/*
                  THE MEAN, VISIBLE — NOT ONLY INSIDE THE sr-only SENTENCE
                  BELOW. Before this label existed, bar height was a sighted
                  user's ONLY route to this number, and for a consistent
                  player — whose monthly means cluster inside a few tenths of
                  a guess, which is exactly what "consistent" looks like —
                  every bar lands within a handful of percentage points of the
                  tallest. That reads as a nearly flat, uninformative row for
                  precisely the player the chart is supposed to flatter, while
                  a screen-reader user got the exact figure every time from the
                  sentence below. This label closes that parity gap; see
                  attempt-distribution.tsx's "COLOUR IS NEVER THE ONLY CARRIER"
                  comment for the sibling component that already lives by this
                  rule. Always `text-muted-foreground`, NEVER the accent, even
                  on the emphasised month — green marks an achievement in this
                  design system (see `emphasise` below), and if every month's
                  number turned green the colour would stop meaning anything.
                  `tabular-nums` keeps the digit width steady as the value
                  moves between, say, 4.0 and 4.4, so bars don't visibly
                  jitter sideways as the numbers above them change width.
                */}
                <span
                  className="text-muted-foreground text-[10px] tabular-nums"
                  aria-hidden="true"
                >
                  {row.meanAttempts}
                </span>
                {/* aria-hidden: the visible rectangle carries no accessible
                    shape of its own — the sr-only sentence just below is the
                    one route to this bar's data for assistive tech. */}
                <div className="flex min-h-0 w-full flex-1 items-end" aria-hidden="true">
                  <div
                    className={`w-full rounded-t-sm ${emphasise ? 'bg-accent-solid' : 'bg-muted'}`}
                    style={{ height: `${(row.meanAttempts / worst) * 100}%` }}
                    data-testid="insights-trend-bar"
                  />
                </div>
                {/*
                  THE CHART MUST REACH A SCREEN READER AS NUMBERS, NOT AS A
                  SHRUG. The bar itself is `aria-hidden` (it is a decorative
                  rectangle with no accessible shape), so this sentence is the
                  only route to the month's data for assistive tech. Its
                  PIECES now each also appear visibly elsewhere — the mean
                  above the bar, the month name below it — but this sentence
                  is still the only place a screen-reader user gets the board
                  COUNT, and the only place any of the three arrive joined as
                  one fact ("August 2026, 28 boards, average 4.2") rather than
                  three separate visual fragments a sighted reader has to
                  assemble themselves.
                */}
                <span className="sr-only">
                  {`${label}: ${row.boards} ${boardsWord}, average ${row.meanAttempts} guesses.`}
                </span>
                {/* AN INITIAL ON MOBILE, A SHORT NAME FROM md: UP. Twelve short
                    month names ("Sep", "Oct", …) do not fit at a 358px phone
                    width; twelve initials do. */}
                <span className="text-muted-foreground text-[10px] md:hidden" aria-hidden="true">
                  {initial}
                </span>
                <span className="text-muted-foreground hidden text-[10px] md:inline" aria-hidden="true">
                  {shortName}
                </span>
              </div>
            )
          })}
        </div>
      </CardContent>
      {trend.best && (
        <CardFooter className="text-muted-foreground border-t pt-3 text-xs">
          {trend.latestIsBest ? 'Your best month yet' : 'Your best month'}:{' '}
          {formatMonthLabel(trend.best.month)} — {trend.best.boards}{' '}
          {trend.best.boards === 1 ? 'board' : 'boards'} · avg {trend.best.meanAttempts}
        </CardFooter>
      )}
    </Card>
  )
}
