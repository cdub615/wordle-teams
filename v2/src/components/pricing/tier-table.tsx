import { FREE_INCLUDES } from '#/lib/free-includes.ts'
import { MONTHLY_FINE_PRINT, PRO_PRICE_LINE } from '#/lib/plans.ts'
import { PRO_BENEFITS } from '#/lib/pro-benefits.ts'
import { LAUNCH_AT_IS_PLACEHOLDER } from '../../../convex/lib/insightsAccess.ts'

/**
 * FREE AGAINST PRO, ON THE ONE PAGE A VISITOR CAN READ BEFORE SIGNING UP.
 *
 * The Pro column is `PRO_BENEFITS` rendered and nothing else. That file's header
 * names this page and the upgrade dialog among its consumers and says they
 * "describe one tier and must not describe it twice", so there is deliberately no
 * sentence here that summarises, shortens or re-pitches an entry of it — the
 * dialog does the same, and tier-table.hook.test.ts fails if a heading appears in
 * this column that is not a benefit title.
 *
 * THE PRICES COME FROM plans.ts FOR THE SAME REASON, and annual leads by
 * placement as well as by wording: `PRO_PRICE_LINE` is the column's price, and
 * `MONTHLY_FINE_PRINT` is a quieter line after it. plans.ts's header has the
 * arithmetic — Polar Starter's 5% + $0.50 makes twelve charges a year cost $8.99
 * against annual's $3.00 — and its own note that whether monthly READS as the
 * better value "is a question of prominence and layout on the surface that
 * renders it". This is that surface, and that is what the placement test pins.
 *
 * FREE IS A COLUMN OF ITS OWN CONTENT, NOT THE ABSENCE OF THE OTHER ONE. Its
 * entries are `FREE_INCLUDES` rendered, and lib/free-includes.ts's header carries
 * both that argument and the claim behind each one. That inventory lives in lib/
 * rather than here because a list exported from a component is a list no other
 * surface will import, which is how the landing page came to write a second,
 * disagreeing copy of the free story.
 *
 * AND THIS COLUMN IS HELD TO THE SAME OUTLINE ASSERTION AS THE PRO ONE: the whole
 * array, in this order, with no heading in the column that is not an entry title.
 * That is what makes /pricing the surface that cannot leave a free capability
 * unadvertised — the landing shows two curated selections of this list, so an entry
 * missing HERE is an entry a reader never meets.
 */

/**
 * A tier's column. Two of them, stacked on a phone and side by side from `md`.
 *
 * `min-w-0` ON THE GRID CHILDREN IS NOT DECORATION. A grid item's default
 * `min-width: auto` is its content's intrinsic minimum, so one long unbroken
 * string — `$49.99/year` is close, and a benefit body is longer — can push a
 * column past its track and give the whole page a horizontal scrollbar. At 390px
 * that is the classic way a tier table breaks, and it is invisible at any desktop
 * width.
 */
function Tier({
  id,
  name,
  children,
}: {
  id: string
  name: string
  children: React.ReactNode
}) {
  return (
    <div
      data-testid={id}
      className="flex min-w-0 flex-col gap-4 rounded-xl border border-line-subtle p-5 sm:p-6"
    >
      <h2 className="font-display text-2xl font-bold text-foreground">{name}</h2>
      {children}
    </div>
  )
}

/** One entry of either inventory. The same shape on both sides, deliberately. */
function Entry({ title, body }: { title: string; body: string }) {
  return (
    <li className="space-y-1">
      <h3 className="text-sm font-medium text-foreground">{title}</h3>
      <p className="m-0 text-sm text-muted-foreground">{body}</p>
    </li>
  )
}

export function TierTable({
  /**
   * WHETHER THERE IS A TRIAL TO DESCRIBE, AND WHY IT IS FALSE TODAY.
   *
   * convex/lib/insightsAccess.ts's LAUNCH_AT is `Date.UTC(2099, 0, 1)` — an
   * obvious placeholder, and its header says what that means: "No board can be
   * entered after it, so `shouldStartTrial` is false for everyone and NO trial
   * is ever stamped while this value stands."
   *
   * So on the day anyone reads this page, a thirty-day trial is a thing they
   * will not get. A public page that describes one is making a false statement
   * about price on the page whose entire job is being true about price — and
   * the reader has no way to discover that it is false, because a trial that
   * silently never starts looks exactly like a trial that has not started yet.
   *
   * SILENCE RATHER THAN A HEDGE. "At launch, your first board will start a
   * thirty-day trial" is worse than saying nothing: it advertises a feature to
   * someone who cannot have it, and it dates the page the moment launch
   * happens. The section is therefore absent, and setting LAUNCH_AT to the real
   * cutover instant — the single edit that switches the trial on — switches
   * this on with it, so the claim becomes visible at exactly the moment it
   * becomes true.
   *
   * A PROP WITH A DERIVED DEFAULT, NOT A BARE CONSTANT READ INSIDE THE BODY,
   * for the reason shouldStartTrial takes `launchAt = LAUNCH_AT`: the launched
   * branch is unreachable in production today, so without a seam it would ship
   * unrendered and unread, and the one-line edit that enables the trial would
   * be the first thing ever to execute it.
   */
  trialOffered = !LAUNCH_AT_IS_PLACEHOLDER,
}: {
  trialOffered?: boolean
}) {
  return (
    <div data-testid="pricing-tiers" className="flex flex-col gap-6">
      <div className="grid gap-4 md:grid-cols-2 md:gap-6">
        {/*
          FREE IS READ FIRST. A cold visitor's question is "what is this", which
          the free column answers, before "what does it cost", which the Pro
          column answers. It is also the column describing the thing the CTA on
          this page actually hands them.
        */}
        <Tier id="pricing-free" name="Free">
          <p className="m-0 text-base font-medium text-foreground">Sign in and play.</p>
          <ul className="m-0 flex list-none flex-col gap-4 p-0">
            {FREE_INCLUDES.map((inclusion) => (
              <Entry key={inclusion.id} title={inclusion.title} body={inclusion.body} />
            ))}
          </ul>
        </Tier>

        <Tier id="pricing-pro" name="Pro">
          {/*
            THE TWO PRICE LINES, AND THE DIFFERENCE BETWEEN THEM IS THE PRODUCT
            DECISION. Annual is the column's price — first in the document, at
            the body size, in the foreground colour. Monthly follows it, smaller
            and quieter, present and undisparaged and never the pitch.
          */}
          <p data-testid="pricing-annual" className="m-0 text-base font-medium text-foreground">
            {PRO_PRICE_LINE}
          </p>
          <p data-testid="pricing-monthly" className="m-0 -mt-3 text-xs text-muted-foreground">
            {MONTHLY_FINE_PRINT}
          </p>
          <ul className="m-0 flex list-none flex-col gap-4 p-0">
            {PRO_BENEFITS.map((benefit) => (
              <Entry key={benefit.id} title={benefit.title} body={benefit.body} />
            ))}
          </ul>
        </Tier>
      </div>

      {trialOffered && (
        <div
          data-testid="pricing-trial"
          className="flex min-w-0 flex-col gap-2 rounded-xl bg-surface-sunken p-5 sm:p-6"
        >
          <h2 className="text-base font-medium text-foreground">Your first thirty days</h2>
          {/*
            NAMES THE TWO ENTRIES RATHER THAN RESTATING THEM. The trial grants
            Layers 2 and 3 and nothing else — insightsAccess() keys `layer1` and
            `layer4` to `isPro` directly, so a player mid-trial still sees a
            free Layer 1 — which means "thirty days of Pro" is false and is the
            obvious sentence to write. The team cap, custom scoring and
            screenshot import are untouched by a trial.
          */}
          <p className="m-0 text-sm text-muted-foreground">
            Enter your first board after launch and Insights opens for thirty days: the personal
            history and the team month listed under Pro, before you have paid for anything.
          </p>
          <p className="m-0 text-sm text-muted-foreground">
            That board is what starts the clock. It covers those two and nothing else, and there
            is nothing to cancel when it runs out.
          </p>
        </div>
      )}
    </div>
  )
}
