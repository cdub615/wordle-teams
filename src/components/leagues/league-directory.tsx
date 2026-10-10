import { Link } from '@tanstack/react-router'
import { useId } from 'react'
import { MyLeagueRow, type MyLeagueRowData } from '#/components/leagues/my-league-row.tsx'
import type { RegionPanelStatus } from '#/components/leagues/region-panel.tsx'
import { Card, CardContent, CardHeader, CardTitle } from '#/components/ui/card.tsx'

/** PLAIN STRUCTURAL SHAPE of one api.leagues.leagues row; `disclaimer` arrives with v2c. */
type DirectoryLeague = { slug: string; name: string; disclaimer?: string | null }
type Props = {
  leagues: DirectoryLeague[]
  mine: MyLeagueRowData[]
  /**
   * The viewer's region status (the structural RegionPanelStatus plus the
   * league it belongs to). Null when there is none to show: not seeded, dark,
   * or myRegion failed.
   */
  region: (RegionPanelStatus & { league: { slug: string } }) | null
}

/** One line under the region card's title, per unplaced state. PLACED has none: it is in "Your leagues". */
const REGION_LINE: Record<Exclude<RegionPanelStatus['state'], 'placed'>, string> = {
  'opted-out': 'You left — rejoin from its page.',
  'no-time-zone': 'Set your time zone to join your region.',
  unmapped: 'Your time zone isn’t part of a region yet.',
}

/**
 * The /leagues directory (spec v2 §5) for two or more leagues: "Your leagues"
 * (one row per membership) and "Join a league" (every league the viewer is not
 * in). A section with nothing in it is omitted. PRESENTATIONAL.
 */
export function LeagueDirectory({ leagues, mine, region }: Props) {
  const yoursId = useId()
  const joinId = useId()
  const joined = new Set(mine.map((m) => m.league.slug))
  const rest = leagues.filter((l) => !joined.has(l.slug))
  return (
    <>
      {mine.length > 0 && (
        <section aria-labelledby={yoursId} className="flex flex-col gap-2">
          <h2 id={yoursId} className="text-lg font-semibold">
            Your leagues
          </h2>
          {mine.map((m) => (
            <MyLeagueRow key={m.league.slug} row={m} />
          ))}
        </section>
      )}
      {rest.length > 0 && (
        <section aria-labelledby={joinId} className="flex flex-col gap-2">
          <h2 id={joinId} className="text-lg font-semibold">
            Join a league
          </h2>
          {rest.map((l) => (
            <Link key={l.slug} to="/leagues/$slug" params={{ slug: l.slug }}>
              <Card>
                <CardHeader>
                  <CardTitle asChild>
                    <h3>{l.name}</h3>
                  </CardTitle>
                </CardHeader>
                {region && region.state !== 'placed' && region.league.slug === l.slug && (
                  <CardContent>
                    <p className="text-sm text-muted-foreground">{REGION_LINE[region.state]}</p>
                  </CardContent>
                )}
                {l.disclaimer && (
                  <CardContent>
                    <p className="text-sm text-muted-foreground">{l.disclaimer}</p>
                  </CardContent>
                )}
              </Card>
            </Link>
          ))}
        </section>
      )}
    </>
  )
}
