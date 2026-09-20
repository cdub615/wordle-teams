import { MONTHLY_FINE_PRINT, PRO_PRICE_LINE } from '#/lib/plans.ts'
import { PRO_BENEFITS } from '#/lib/pro-benefits.ts'
import { LAUNCH_AT_IS_PLACEHOLDER } from '../../../convex/lib/insightsAccess.ts'

/**
 * FREE AGAINST PRO, ON THE ONE PAGE A VISITOR CAN READ BEFORE SIGNING UP.
 *
 * The Pro column is `PRO_BENEFITS` rendered and nothing else. That file's header
 * names this page and the upgrade dialog as its only two consumers and says they
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
 * FREE IS A COLUMN OF ITS OWN CONTENT, NOT THE ABSENCE OF THE OTHER ONE. See
 * FREE_INCLUDES below.
 */

/**
 * WHAT A FREE ACCOUNT ACTUALLY GETS — the inventory the product has never had.
 *
 * WHY THIS EXISTS AT ALL. A tier table's default shape is a column of ticks
 * beside a column of crosses, and the cross column is written as the tick column
 * negated: "two teams max", "no custom scoring", "today only". That is a
 * perfectly accurate description of free and a disastrous pitch, because the
 * reader of this page has never heard of the product — the thing they are being
 * asked to sign up for IS the free tier, and a column of refusals tells them it
 * does nothing. Every free account here gets two teams, three months of scores, a
 * benchmark on its most recent board, a team fact every day, team chat and push
 * notifications. That is the product; Pro is what it grows into.
 *
 * `checkedAgainst` IS pro-benefits.ts's `gatedAt` FROM THE OTHER SIDE, and it is
 * here for a sharper reason than symmetry. A Pro claim that goes stale is noticed
 * the first time somebody pays and does not get it. A FREE claim that goes stale
 * has no such moment: nobody complains that a thing they were not charged for is
 * missing, so the sentence just stays wrong. The field names the file that makes
 * each claim true and the test asserts the path resolves, exactly as
 * pro-benefits.test.ts does for its own.
 *
 * THE NUMBERS ARE WORDS AND THE CONSTANTS ARE PINNED BY THE TEST. FREE_TEAM_LIMIT
 * and FREE_MONTHS are not imported here, because prose cannot embed a template
 * literal — the same problem pro-benefits.ts and plans.ts both have, solved the
 * same way, with a test that fails if either constant moves away from the word
 * above it.
 *
 * CHAT AND NOTIFICATIONS BELONG HERE AND NOWHERE ELSE. pro-benefits.ts's header
 * records their absence from the Pro list as a decision rather than an omission:
 * there is no `isProFor` anywhere in convex/chat.ts or convex/chatNotify.ts, so
 * they are part of the free product. Selling something already free is the same
 * defect as selling something that does not exist.
 */
export type FreeInclusion = {
  id: 'teams' | 'months' | 'benchmark' | 'team-fact' | 'chat'
  /** A few words, headline case. */
  title: string
  /** One sentence, second person, stated as what arrives. */
  body: string
  /**
   * Path to the file that makes this claim true, resolved against this package's
   * root (`v2/`, not the outer repo) by the disk test.
   */
  checkedAgainst: string
}

export const FREE_INCLUDES: ReadonlyArray<FreeInclusion> = [
  {
    id: 'teams',
    // FREE_TEAM_LIMIT is 2. Says JOIN rather than create, which is the same
    // distinction pro-benefits.ts's `teams` entry is careful about: nothing
    // stops a free account calling createTeam a sixth time, and the enforced
    // path — invitePlayerFor, completeProfileFor, inviteLinks — is the join.
    title: 'Two teams',
    body: 'Join two teams and play with both — your own, and the one a friend invites you to.',
    checkedAgainst: 'convex/lib/teamLimits.ts',
  },
  {
    id: 'months',
    // FREE_MONTHS is 3, and that constant's own comment spells the window out:
    // "this month and the two before it". Deliberately silent about WHOSE rules
    // score it — a custom scoring system is Pro, and "your team's own rules"
    // would sell it from the free column by accident.
    title: 'Three months of scores',
    body: 'This month and the two before it, board by board, scored and settled.',
    checkedAgainst: 'convex/lib/monthWindow.ts',
  },
  {
    id: 'benchmark',
    // Layer 1 is 'free' for everyone (insightsAccess.ts), and boardsForLayer1
    // trims that to the most recent board. What the row then shows is
    // board-row.tsx's two sentences: the opener's rank in the corpus and the
    // day's difficulty percentile. NOT "against everyone who played that day" —
    // the corpus is a static artifact of past puzzles, not a live field.
    title: 'How your last board measured up',
    body: 'Your most recent board, set against every past Wordle: how hard that day was, and where your opener ranks.',
    checkedAgainst: 'src/lib/insights-panel.ts',
  },
  {
    id: 'team-fact',
    // Layer 3 is 'free' for everyone, and daily-team-fact.tsx is the sentence it
    // buys: "You beat two of three teammates who have played today." It renders
    // only once the viewer has entered, which is why the body says to enter
    // first rather than promising a fact that is not there yet.
    title: 'A team fact every day',
    body: 'Enter today’s board and see how many of your teammates you beat.',
    checkedAgainst: 'src/components/insights/daily-team-fact.tsx',
  },
  {
    id: 'chat',
    // Ungated in both directions: convex/chat.ts has no isProFor, and
    // convex/chatNotify.ts sends to whoever subscribed. The notification carries
    // the team's NAME and no message text, which is a privacy decision recorded
    // in routes/privacy.tsx — so this says "hear about it", never "read it".
    title: 'Team chat, and a push when it moves',
    body: 'Talk to your team inside the app, and hear about it when someone posts.',
    checkedAgainst: 'convex/chat.ts',
  },
]

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
