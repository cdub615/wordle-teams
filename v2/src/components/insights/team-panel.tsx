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
 * `teamName` IS A PROP, NOT A QUERY. TeamSection (routes/insights.tsx) already
 * holds the team's name from the same getMyTeams read it uses to resolve
 * `teamId` — adding a second read here to re-fetch what the caller already has
 * would be a database-bandwidth regression on the exact surface wordle-teams-dcu
 * exists to protect. `undefined` is treated the same as an unnamed team (the
 * caller genuinely has no name to give, e.g. between getMyTeams resolving and a
 * name landing) rather than as an error — the same two-state fallback
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

export function TeamPanel({ data, teamName }: { data: TeamPanelData; teamName?: string }) {
  const title = teamName ?? 'Your team'

  const nameOf = (playerId: string) => {
    const member = data.roster.find((m) => m.playerId === playerId)
    if (!member) return 'A teammate'
    return `${member.firstName} ${member.lastName}`.trim() || 'A teammate'
  }

  if (!data.stats || data.stats.days.length === 0) {
    return (
      <Card data-testid="insights-team-empty">
        <CardHeader className="pb-2">
          <CardTitle className="text-lg md:text-xl">{title}</CardTitle>
        </CardHeader>
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
      <CardHeader className="pb-2">
        <CardTitle className="text-lg md:text-xl">{title}</CardTitle>
      </CardHeader>
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
