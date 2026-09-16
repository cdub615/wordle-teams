import type { ReactNode } from 'react'
import { Card, CardContent, CardHeader, CardTitle } from '#/components/ui/card.tsx'
import {
  bestAndWorstDays,
  headToHead,
  memberAverages,
  memberConsistency,
  type HeadToHead,
  type TeamMonth,
} from '#/lib/insights-team.ts'
import { formatDayHeaderParts } from '#/lib/format-day'

/**
 * Layer 3 — the team analytics surface, from B1's single aggregate document.
 *
 * PRO OR TRIAL ONLY, gated by the caller on `access.layer3 === 'full'`. The free
 * slice is a different component (B3's one daily fact) rather than a cut-down
 * version of this one — the spec pins the free tier to one thing instead of
 * leaving it open.
 *
 * NO >=30 THRESHOLD HERE, deliberately: that is Layer 4's rule. This summarises
 * data every member can already read board by board on the dashboard.
 *
 * EVERY VIEW HAS A STATED EMPTY STATE. A solo team and a month nobody has played
 * are both ordinary — a solo team is the most common shape in this product, and an
 * unplayed month exists on the first of every one — so `null` from the statistics
 * renders as a sentence rather than as a dash or a zero.
 *
 * `teamName` IS A PROP, NOT A QUERY. routes/insights.tsx resolves `?team=`
 * against the roster it has already read and hands the selected team down to
 * TeamSection, name included — adding a second read here to re-fetch what the
 * caller already holds would be a database-bandwidth regression on the exact
 * surface wordle-teams-dcu exists to protect.
 *
 * `undefined` is treated the same as an unnamed team rather than as an error.
 * NO PRODUCTION CALLER CAN PASS IT TODAY — TeamSection reaches this only past
 * `if (!team) return null`, and `team.name` is non-optional — so the fallback
 * exists for the prop's own contract, which team-panel.hook.test.ts exercises
 * directly, not for a loading window. It is the same two-state fallback
 * routes/chat.tsx's `chatHeading` applies to its own heading, collapsed here to
 * one optional prop because this component, unlike ChatHeader, never itself
 * distinguishes "still loading" from "no name" — that distinction is TeamSection's
 * to make, not this component's.
 */

export type TeamPanelData = {
  viewerId: string
  roster: { playerId: string; firstName: string; lastName: string }[]
  stats: TeamMonth | null
}

export function TeamPanel({
  data,
  teamName,
  controls,
  teamNameInControls = false,
}: {
  data: TeamPanelData
  teamName?: string
  /**
   * The team and month dropdowns (components/insights/team-scope-controls.tsx),
   * as a rendered node rather than as the four props they take.
   *
   * A NODE, SO THIS COMPONENT LEARNS NOTHING NEW. What the dropdowns offer is
   * the roster and the team's month window — two facts this panel has no use
   * for and, per `teamName` above, must not fetch. Taking the rendered control
   * keeps that true: the panel owns WHERE the controls sit in its header, and
   * routes/insights.tsx owns what they say and what they do.
   *
   * IN BOTH RETURNS BELOW, INCLUDING THE EMPTY ONE. An unplayed month is
   * exactly when somebody needs the month dropdown most — a card that said
   * "nobody played this month" with no way to pick another month would be a
   * dead end.
   */
  controls?: ReactNode
  /**
   * Whether `controls` is ALREADY SHOWING THIS TEAM'S NAME — that is, whether
   * the team dropdown renders. When it does, the visible title below is dropped
   * and the name is carried by the trigger alone.
   *
   * WITHOUT THIS THE HEADER PRINTS THE TEAM NAME TWICE, side by side: "Ada's
   * Analysts   [Ada's Analysts v] [Sep 2026 v]". That reads as a bug rather than
   * as a design, and the trigger is not the half that can go — daily-team-fact.tsx
   * has NO title at all, so there the trigger is the only thing saying which team
   * the fact is about, and the two cards must not label the same dropdown
   * differently.
   *
   * A BOOLEAN RATHER THAN SOMETHING THIS COMPONENT COULD WORK OUT. `controls` is
   * an opaque node on purpose (see above): this panel is not allowed to know the
   * roster, so it cannot ask `showsTeamPicker` itself, and inspecting a ReactNode
   * for a testid would be worse than being told. routes/insights.tsx already calls
   * `showsTeamPicker(teamOptions)` for the free branch and passes the same answer
   * here, so the rule still has exactly one spelling.
   *
   * DEFAULTS TO FALSE, so a caller that supplies no controls — every test in
   * team-panel.hook.test.ts, and the `teamName ?? 'Your team'` fallback they
   * exercise — keeps the visible title it has always had. AT ONE TEAM THERE IS NO
   * DROPDOWN AND THE TITLE IS THE ONLY IDENTIFIER: do not hide it whenever
   * `controls` is merely present, since a one-team pro account still gets a
   * controls node for the MONTH dropdown alone.
   */
  teamNameInControls?: boolean
}) {
  const title = teamName ?? 'Your team'

  const nameOf = (playerId: string) => {
    const member = data.roster.find((m) => m.playerId === playerId)
    if (!member) return 'A teammate'
    return `${member.firstName} ${member.lastName}`.trim() || 'A teammate'
  }

  if (!data.stats || data.stats.days.length === 0) {
    return (
      <Card data-testid="insights-team-empty">
        <PanelHeader title={title} controls={controls} nameInControls={teamNameInControls} />
        <CardContent className="text-muted-foreground text-sm">
          Nobody on this team has entered a board this month yet.
        </CardContent>
      </Card>
    )
  }

  const stats = data.stats
  const records = headToHead(stats, data.viewerId)
  const averages = memberAverages(stats)
  const { best, worst } = bestAndWorstDays(stats)
  const consistency = memberConsistency(stats)

  // THE FILTER EXISTS FOR `tsc`, NOT FOR CORRECTNESS: `Math.max` over
  // `(number | null)[]` fails to compile (TS2345, "Argument of type 'number |
  // null' is not assignable to parameter of type 'number'"), so the `null`s
  // have to be stripped before the spread type-checks at all. A member with no
  // boards does have `meanAttempts: null`, and `null` really does coerce to
  // `0` in arithmetic — but that coercion is inert here: attempts are always
  // >= 1, so a coerced `0` can never win a MAXIMUM against any real mean, only
  // ever lose to one. (It would matter for a minimum — `Math.min` would let an
  // absent player's `0` win the scale — which is exactly why this is not one.)
  // Removing the filter and feeding raw values through an `as number[]`
  // produces byte-identical output in every test scenario here, no-boards
  // fixture included; the filter earns its keep purely by satisfying the
  // compiler. The trailing `, 1)` is a separate, genuine guard: it matches
  // trend-panel.tsx's own — a single member at a mean of 0 would otherwise
  // divide by zero and every bar would compute to NaN%.
  const definedMeans = averages.members
    .map((member) => member.meanAttempts)
    .filter((mean): mean is number => mean !== null)
  const worstMean = Math.max(...definedMeans, 1)

  return (
    <Card data-testid="insights-team">
      <PanelHeader title={title} controls={controls} nameInControls={teamNameInControls} />
      <CardContent className="space-y-4 text-sm">
        {/*
          HEAD TO HEAD LEADS THE CARD, and this is a reorder rather than a new
          section — it used to be the first of four equal list rows and is now
          the first thing in the card because it is the most engaging content
          on the page: a live score, not a table of means.
        */}
        <div data-testid="insights-head-to-head">
          <h3 className="mb-1 font-medium">Head to head</h3>
          {records.length === 0 ? (
            <p className="text-muted-foreground">
              You are the only member of this team, so there is nobody to compare with.
            </p>
          ) : records.length === 1 ? (
            <VersusBlock record={records[0]!} opponentName={nameOf(records[0]!.opponentId)} />
          ) : (
            <ul className="space-y-1">
              {records.map((record) => (
                <li key={record.opponentId} className="flex justify-between gap-2">
                  <span>{nameOf(record.opponentId)}</span>
                  <span className="text-muted-foreground">
                    {record.shared === 0
                      ? 'no shared days yet'
                      : `${record.wins}-${record.losses}${record.ties > 0 ? `-${record.ties}` : ''} over ${record.shared} shared ${record.shared === 1 ? 'day' : 'days'}`}
                  </span>
                </li>
              ))}
            </ul>
          )}
        </div>

        <div data-testid="insights-team-averages">
          <h3 className="mb-1 font-medium">
            Averages{averages.teamMean !== null && ` — team ${averages.teamMean}`}
          </h3>
          {/*
            THE DIRECTION STATED OUTRIGHT, matching trend-panel.tsx's own
            caption verbatim (same styling, same wording): a bar chart where a
            shorter bar is the good outcome is ambiguous on its own, and this
            is the one sentence that disambiguates it.
          */}
          <p className="text-muted-foreground text-xs">avg guesses · lower is better</p>
          <ul className="mt-2 space-y-2">
            {averages.members.map((member) => (
              <li key={member.playerId} className="space-y-1">
                <div className="flex justify-between gap-2">
                  <span>{nameOf(member.playerId)}</span>
                  <span className="text-muted-foreground tabular-nums">
                    {member.meanAttempts === null
                      ? 'no boards this month'
                      : `${member.meanAttempts} over ${member.boards} ${member.boards === 1 ? 'board' : 'boards'}`}
                  </span>
                </div>
                {/*
                  NO BAR FOR A MEMBER WITH NO BOARDS. A zero-width bar next to
                  "no boards this month" would visually read as "played and
                  scored 0", the exact NaN-adjacent misreading isThin's sibling
                  states in this module all guard against — the sentence is
                  the whole answer for that member, not a decoration on it.

                  WIDTH, NOT HEIGHT, so there is no percentage-against-`auto`
                  risk here (see trend-panel.tsx's own comment on that bug):
                  this row is a normal block element and resolves its own
                  width in the flow the way every element does; only a
                  PERCENTAGE HEIGHT needs a parent with a resolved height, and
                  nothing here sets one.

                  `aria-hidden`, LIKE TREND-PANEL'S BAR, because the fact it
                  draws is already live text a moment above it (the mean and
                  board count) rather than only inside a decorative shape —
                  unlike that chart's bars, nothing here is screen-reader-only.
                */}
                {member.meanAttempts !== null && (
                  <div
                    className="bg-muted h-1.5 w-full overflow-hidden rounded-full"
                    aria-hidden="true"
                  >
                    <div
                      className="bg-muted-foreground h-full rounded-full"
                      style={{ width: `${(member.meanAttempts / worstMean) * 100}%` }}
                    />
                  </div>
                )}
              </li>
            ))}
          </ul>
        </div>

        <div data-testid="insights-team-days">
          <h3 className="mb-1 font-medium">Best and worst days</h3>
          {best && worst && (
            <ul className="space-y-1">
              <li className="flex justify-between gap-2">
                <span>Best</span>
                <span className="text-muted-foreground">
                  {dayLabel(best.puzzleDay)} — team average {best.meanAttempts}
                </span>
              </li>
              <li className="flex justify-between gap-2">
                <span>Worst</span>
                <span className="text-muted-foreground">
                  {dayLabel(worst.puzzleDay)} — team average {worst.meanAttempts}
                </span>
              </li>
            </ul>
          )}
        </div>

        <div data-testid="insights-team-consistency">
          <h3 className="mb-1 font-medium">Consistency</h3>
          <ul className="space-y-1">
            {consistency.map((member) => (
              <li key={member.playerId} className="flex justify-between gap-2">
                <span>{nameOf(member.playerId)}</span>
                <span className="text-muted-foreground">
                  {member.spread === null
                    ? 'no boards this month'
                    : `${member.meanAttempts} ± ${member.spread}`}
                </span>
              </li>
            ))}
          </ul>
        </div>
      </CardContent>
    </Card>
  )
}

/**
 * The card header both of TeamPanel's returns share — the team's name, and the
 * controls that change what the card is scoped to.
 *
 * TWO SHAPES, AND WHICH ONE IS DECIDED BY `nameInControls` ALONE. When the team
 * dropdown renders it is already showing the team's name, so the visible title
 * goes and the header becomes controls-only; otherwise the title stays and is
 * the card's only identifier. TeamPanel's own `teamNameInControls` prop states
 * why, and routes/insights.tsx is what answers the question.
 *
 * TITLE ABOVE THE CONTROLS BELOW `md`, BESIDE THEM FROM `md` UP, IN THE VISIBLE-
 * TITLE SHAPE. The reason this stack was originally introduced is now
 * UNREACHABLE and must not be re-cited: it was that one row at 390px left the
 * title 109px of the header's 324px and ellipsed a name as ordinary as "Ada's
 * Analysts" WHILE THE TEAM TRIGGER BESIDE IT SHOWED THAT SAME NAME, also
 * truncated — two clipped copies of one string. A visible title and the team
 * trigger can no longer appear together at all, so that pairing is gone by
 * construction rather than by layout.
 *
 * WHAT IS MEASURED TODAY, in headless chromium over the BUILT stylesheet and
 * with only the MONTH trigger beside the title: at 390px "Ada's Analysts" is not
 * clipped in the stacked header, and a 37-character name IS clipped there — the
 * card is 374px wide, so a name that long exceeds the header's 324px of content
 * box whether it is stacked or in a row. The stack is therefore not what saves a
 * long name; nothing at this width does. It is kept for the `md` reason below,
 * which is about the PAGE rather than about this card.
 *
 * MEASURE, NEVER INFER, WHEN YOU CHANGE THESE CLASSES. Tailwind emits nothing
 * for a class no source file contains, so a stale stylesheet renders this header
 * with its rules silently absent and it still looks plausible — the gates cannot
 * see it and neither can a screenshot taken against an old `dist`.
 *
 * `md` RATHER THAN `sm` TO MATCH daily-benchmark.tsx, whose own title-plus-two-
 * controls header one card further down the same page is
 * `flex-col gap-2 md:flex-row md:items-center md:justify-between`. The row does
 * fit at `sm` here — the lone month trigger this shape can hold is far narrower
 * than that card's two selects — but two cards on one page changing shape at
 * different widths is a worse outcome than one line of unused room between 640
 * and 768.
 *
 * `space-y-0` IS NOT TIDYING. CardHeader's own `flex flex-col space-y-1.5` is
 * still there in the `md:flex-row` — tailwind-merge only drops it because this
 * className names the same utility — and `space-y-*` is a MARGIN on every child
 * after the first, which in a row is a vertical offset on the controls rather
 * than the gap between stacked rows it was written to be. `gap-2` is the gap in
 * both directions instead.
 *
 * ONE COMPONENT RATHER THAN THE SAME MARKUP TWICE, because the empty state and
 * the full card must not drift apart: an unplayed month is exactly when
 * somebody reaches for the month dropdown, and a header that got these classes
 * in only one of the two returns would be the emptier card losing them.
 */
function PanelHeader({
  title,
  controls,
  nameInControls,
}: {
  title: string
  controls?: ReactNode
  nameInControls: boolean
}) {
  if (nameInControls) {
    return (
      // `flex-row items-center justify-end space-y-0` — THE SAME FOUR CLASSES
      // daily-team-fact.tsx's HEADER CARRIES, and that is the point rather than
      // a coincidence: in this branch both Layer 3 cards are a header holding
      // nothing but the scope controls, so they must put them in the same
      // place. `pb-2` rather than that card's `pb-3` is the one difference, and
      // it is this card's own existing spacing, unchanged.
      //
      // `justify-end`, NEVER THE `md:justify-between` BELOW. An `sr-only`
      // heading is `position: absolute`, so it is NOT a flex item — this
      // container has exactly ONE in-flow child, and `justify-between` puts a
      // lone item at the START. The controls would sit hard left, on the
      // opposite side from every other width and from the free card.
      //
      // NO RESPONSIVE STACK EITHER, because there is nothing to stack: the
      // column below exists to keep a title off the controls' row, and there is
      // no visible title here at any width.
      <CardHeader className="flex-row items-center justify-end space-y-0 pb-2">
        {/*
          AN INVISIBLE HEADING, NOT A DELETED ONE. The team dropdown beside this
          already shows the name, so a visible CardTitle would print it twice
          side by side — but dropping it outright would leave this card with no
          heading at all in the document, and the team's name reachable only as
          a button's label. `sr-only` keeps the structure and the announcement
          while costing no pixels.

          `h2` BECAUSE THE PAGE'S OWN HEADING IS AN `h1` ("Insights", in
          routes/insights.tsx) AND THIS CARD'S SECTIONS ARE `h3`s — "Head to
          head", "Averages", "Best and worst days", "Consistency", below. This
          is the level between them, so the card's four sections stop hanging
          off the page title directly.

          A REAL `h2` RATHER THAN `CardTitle`: that component renders a plain
          `<div>` (components/ui/card.tsx — `asChild` exists there precisely
          because it does), so `CardTitle` alone would be an announcement
          without a heading, which is the half of this that matters. Its
          typographic classes would be inert under `sr-only` anyway.
        */}
        <h2 className="sr-only">{title}</h2>
        {controls}
      </CardHeader>
    )
  }

  return (
    <CardHeader className="flex-col gap-2 space-y-0 pb-2 md:flex-row md:items-center md:justify-between">
      {/* `min-w-0 truncate` IS WHAT KEEPS THE `md` ROW INSIDE THE CARD. A flex
          item's automatic minimum size is its content, so without `min-w-0` a
          long team name refuses to shrink and pushes the controls out of the
          card instead of ellipsing. The controls carry the matching
          `shrink-0`. */}
      <CardTitle className="min-w-0 truncate text-lg md:text-xl">{title}</CardTitle>
      {controls}
    </CardHeader>
  )
}

/**
 * The two-person team's head-to-head, as a scoreboard rather than a list row.
 *
 * ONLY FOR EXACTLY ONE OPPONENT. A two-person team is the shape this product is
 * most often in (see the module comment), so its one comparison earns the most
 * prominent treatment on the page rather than being one row among several — a
 * list of one is exactly the arithmetic this replaces.
 *
 * THE VIEWER'S SIDE IS LABELLED "You", NEVER THEIR OWN NAME. Every other sentence
 * this feature writes about the viewer uses "you" (daily-team-fact.tsx's
 * `sentenceFor`, onboarding's task hints) rather than their real name, and a
 * scoreboard that suddenly printed "Ada Lovelace" next to their own score would
 * be the one inconsistent voice on the page. It also keeps this block from ever
 * comparing the viewer with themselves by name — the same guarantee the
 * multi-opponent list gives by construction (`headToHead` excludes the viewer
 * from `records`).
 *
 * `text-accent-solid`, NEVER `text-success`, ON THE VIEWER'S FIGURE — the
 * project's one safe green foreground (see trend-panel.tsx's identical rule):
 * `--success` is a background token that measures 3.74:1 as text on a dark
 * card, below WCAG AA's 4.5:1, where `--accent-solid` clears it.
 */
function VersusBlock({ record, opponentName }: { record: HeadToHead; opponentName: string }) {
  return (
    <div data-testid="insights-versus" className="flex flex-col items-center gap-2 py-1">
      <div className="flex items-center justify-center gap-6">
        <div className="flex flex-col items-center gap-0.5">
          <span className="text-muted-foreground text-xs">You</span>
          <span
            className="text-accent-solid text-3xl font-semibold tabular-nums"
            data-testid="insights-versus-figure"
          >
            {record.wins}
          </span>
        </div>
        <span className="text-muted-foreground text-xs" aria-hidden="true">
          vs
        </span>
        <div className="flex flex-col items-center gap-0.5">
          <span className="text-muted-foreground text-xs">{opponentName}</span>
          <span className="text-3xl font-semibold tabular-nums" data-testid="insights-versus-figure">
            {record.losses}
          </span>
        </div>
      </div>
      {/*
        TIES AND SHARED DAYS, BENEATH THE FIGURES — the same "no shared days
        yet" sentence the multi-opponent list uses rather than a bare 0-0,
        since a day the opponent skipped is not a loss any more than it is a
        win (see headToHead's own comment). The denominator matters here for
        the same reason it does in the list: "1 tie" without "over N shared
        days" implies a whole month rather than the days both played.
      */}
      <p className="text-muted-foreground text-xs">
        {record.shared === 0
          ? 'no shared days yet'
          : `${record.ties} ${record.ties === 1 ? 'tie' : 'ties'} over ${record.shared} shared ${record.shared === 1 ? 'day' : 'days'}`}
      </p>
    </div>
  )
}

function dayLabel(puzzleDay: string): string {
  const { weekday, ordinal } = formatDayHeaderParts(puzzleDay)
  return `${weekday} ${ordinal}`
}
