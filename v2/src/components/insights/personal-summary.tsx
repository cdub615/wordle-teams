import { Card, CardContent } from '#/components/ui/card.tsx'
import {
  TRAILING_FORM_MIN_BOARDS,
  TRAILING_FORM_WINDOW,
  attemptDistribution,
  consistency,
  solvedRate,
  streaks,
  trailingForm,
  type PersonalBoard,
} from '#/lib/insights-personal.ts'
import { AttemptDistribution } from './attempt-distribution.tsx'
import { UnlockPrompt } from './unlock-prompt.tsx'

/**
 * The hero, and the page's answer to "what am I looking at".
 *
 * IT OPENS WITH A NUMBER RATHER THAN A PARAGRAPH. What shipped before was six
 * equally weighted cells in a two-column dl at text-sm — every figure on a
 * statistics page rendered at the same size as the label beside it, which is
 * why the page did not read as a statistics product.
 *
 * THE COMPARISON IS THE POINT, NOT THE FIGURE. A mean of 4.32 means nothing on
 * its own. It compares against the player's OWN record because the corpus holds
 * no attempt averages to compare against — see trailingForm's comment.
 *
 * `data-testid="insights-summary"`, DELIBERATELY NOT "insights-personal". That
 * id already names PersonalHistory's own Card, and PersonalHistory (below this
 * one on the route) still uses it — src/routes/-insights.hook.test.ts asserts a
 * SINGLE element at that id in several places (a compareDocumentPosition check,
 * a plain getByTestId). Reusing it here would put two Cards on one id the
 * moment both render, and getByTestId throws on a duplicate rather than picking
 * one. The route wires this component in ABOVE PersonalHistory, not instead of
 * it, so the ids have to stay distinct.
 */
export function PersonalSummary({ boards }: { boards: PersonalBoard[] }) {
  const spread = consistency(boards)
  const runs = streaks(boards)
  const form = trailingForm(boards)
  const distribution = attemptDistribution(boards)

  return (
    <Card data-testid="insights-summary">
      <CardContent className="space-y-4 pt-6">
        <div className="flex flex-col gap-4 md:flex-row md:items-start md:gap-6">
          <div className="md:shrink-0">
            <h3 className="text-muted-foreground text-xs font-semibold tracking-wide uppercase">
              Average guesses
            </h3>
            <p
              className="text-4xl leading-none font-bold tracking-tight tabular-nums md:text-5xl"
              data-testid="insights-lead-figure"
            >
              {spread.meanAttempts}
            </p>
          </div>

          <div className="md:flex-1">
            {form ? (
              /* NEVER text-destructive ON A WORSE STRETCH. A page someone pays
                 for should not scold them for a bad fortnight; the neutral
                 treatment states the fact without the judgement.

                 text-accent-solid, NOT text-success, FOR THE IMPROVING CASE.
                 --success is a BACKGROUND token — it is paired with
                 --success-foreground and travels with it (see badge.tsx's
                 `bg-success text-success-foreground`), per this design
                 system's rule that a background/foreground pair is set
                 together or not at all. Using it as a TEXT colour on the
                 dark surface put 14px semibold text at 3.74:1, below AA's
                 4.5:1 (WCAG-9F). --accent-solid is the established green
                 FOREGROUND token instead (maintenance.tsx,
                 feature-cards.tsx, pull-to-refresh.tsx already use it this
                 way) — identical to --success in light mode (5.02:1,
                 unchanged) and 8.22:1 in dark. Do not "fix" this by giving
                 --success a dark-mode value; that changes the badge instead
                 of this text. */
              <p className="text-sm" data-testid="insights-trailing-form">
                <span className={form.delta > 0 ? 'text-accent-solid font-semibold' : 'font-semibold'}>
                  {/* THE GLYPH IS DECORATION, NOT THE MESSAGE. A screen reader
                      announces a bare ▲/▼/— as its Unicode name ("black
                      up-pointing triangle"), which says nothing, and colour
                      is never the only carrier in this codebase (see
                      AttemptDistribution's own comment) — so it is the sole
                      OTHER signal here too. aria-hidden the glyph and say the
                      same thing in words via sr-only instead. */}
                  <span aria-hidden="true">{form.delta > 0 ? '▲' : form.delta < 0 ? '▼' : '—'}</span>
                  <span className="sr-only">
                    {form.delta > 0 ? 'Improved' : form.delta < 0 ? 'Worsened' : 'No change'}
                  </span>{' '}
                  {Math.abs(form.delta).toFixed(1)}
                </span>{' '}
                <span className="text-muted-foreground">
                  over your last {TRAILING_FORM_WINDOW} boards ({form.recent})
                  {form.isBest && ' — your best stretch yet'}
                </span>
              </p>
            ) : (
              <UnlockPrompt
                what="Your form trend"
                need={TRAILING_FORM_MIN_BOARDS}
                have={boards.length}
                unit="boards"
                value={`how your last ${TRAILING_FORM_WINDOW} boards compare with your all-time average`}
                testId="insights-unlock-form"
              />
            )}
          </div>
        </div>

        <AttemptDistribution rows={distribution} />

        {/* `insights-consistency` KEPT, AND ITS MEANING WITH IT: the four
            statistics that sit beside the mean. Solved and Missed are now one
            rate — two counts stated the same fact twice and neither at a
            glance. */}
        <dl
          className="grid grid-cols-2 gap-3 border-t pt-4 md:grid-cols-4"
          data-testid="insights-consistency"
        >
          <Stat label="Streak" value={String(runs.current)} />
          <Stat label="Best ever" value={String(runs.longest)} />
          <Stat label="Solved" value={`${solvedRate(spread)}%`} />
          <Stat label="Spread" value={`±${spread.spread}`} />
        </dl>
      </CardContent>
    </Card>
  )
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <dt className="text-muted-foreground text-xs tracking-wide uppercase">{label}</dt>
      <dd className="text-lg font-semibold tabular-nums">{value}</dd>
    </div>
  )
}
