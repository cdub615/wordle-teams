import { Card, CardContent, CardHeader, CardTitle } from '#/components/ui/card.tsx'
import {
  bestAndWorstDays,
  headToHead,
  memberAverages,
  memberConsistency,
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
 */

export type TeamPanelData = {
  viewerId: string
  roster: { playerId: string; firstName: string; lastName: string }[]
  stats: TeamMonth | null
}

export function TeamPanel({ data }: { data: TeamPanelData }) {
  const nameOf = (playerId: string) => {
    const member = data.roster.find((m) => m.playerId === playerId)
    if (!member) return 'A teammate'
    return `${member.firstName} ${member.lastName}`.trim() || 'A teammate'
  }

  if (!data.stats || data.stats.days.length === 0) {
    return (
      <Card data-testid="insights-team-empty">
        <CardHeader className="pb-2">
          <CardTitle className="text-base">Your team</CardTitle>
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

  return (
    <Card data-testid="insights-team">
      <CardHeader className="pb-2">
        <CardTitle className="text-base">Your team</CardTitle>
      </CardHeader>
      <CardContent className="space-y-4 text-sm">
        <div data-testid="insights-head-to-head">
          <h3 className="mb-1 font-medium">Head to head</h3>
          {records.length === 0 ? (
            <p className="text-muted-foreground">
              You are the only member of this team, so there is nobody to compare with.
            </p>
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
          <ul className="space-y-1">
            {averages.members.map((member) => (
              <li key={member.playerId} className="flex justify-between gap-2">
                <span>{nameOf(member.playerId)}</span>
                <span className="text-muted-foreground">
                  {member.meanAttempts === null
                    ? 'no boards this month'
                    : `${member.meanAttempts} over ${member.boards} ${member.boards === 1 ? 'board' : 'boards'}`}
                </span>
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

function dayLabel(puzzleDay: string): string {
  const { weekday, ordinal } = formatDayHeaderParts(puzzleDay)
  return `${weekday} ${ordinal}`
}
