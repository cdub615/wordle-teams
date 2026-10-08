import { Link } from '@tanstack/react-router'
import { Card, CardContent, CardHeader, CardTitle } from '#/components/ui/card.tsx'
import { GroupPicker, type PickerGroup } from '#/components/leagues/group-picker.tsx'
import { HOME_CARD_MAX_LEAGUES } from '../../../convex/lib/league.ts'

/** PLAIN STRUCTURAL SHAPE of one api.leagues.myLeagues row; the convex result is assignable to it. */
type MyLeague = {
  league: { slug: string; name: string }
  group: { _id: string; name: string }
  rank: number | null
  average: number | null
  boards: number
}

type Props = {
  mine: MyLeague[]
  featured: { slug: string; name: string; groups: PickerGroup[] } | null
  onJoin: (groupId: string) => void
  busy: boolean
  className?: string
}

/**
 * Dashboard card (spec §8.4): the viewer's leagues, or the featured league's
 * picker when they are in none. PRESENTATIONAL: app.tsx owns the queries and
 * the join mutation. Group totals only, never a player (§3.2). Renders NOTHING
 * with no membership and no featured league, so the card is never an empty box.
 */
export function LeaguesCard({ mine, featured, onJoin, busy, className }: Props) {
  if (mine.length === 0) {
    if (!featured) return null
    return (
      <Card className={className} role="region" aria-label="Leagues">
        <CardHeader>
          <CardTitle asChild>
            <h2>Pick your opener</h2>
          </CardTitle>
        </CardHeader>
        <CardContent className="flex flex-col gap-2">
          <p className="text-sm text-muted-foreground">
            Join a {featured.name} group. Every board you play counts for it.
          </p>
          <GroupPicker
            groups={featured.groups}
            currentGroupId={null}
            disabled={busy}
            label="Pick your opener"
            onPick={onJoin}
          />
        </CardContent>
      </Card>
    )
  }

  // At most HOME_CARD_MAX_LEAGUES rows (§8.5): one league today, many later
  // without the card growing past the dashboard's first screen.
  const shown = mine.slice(0, HOME_CARD_MAX_LEAGUES)
  return (
    <Card className={className} role="region" aria-label="Leagues">
      <CardHeader>
        <CardTitle asChild>
          <h2>Leagues</h2>
        </CardTitle>
      </CardHeader>
      <CardContent className="flex flex-col gap-2">
        {shown.map((l) => (
          <Link
            key={l.league.slug}
            to="/leagues/$slug"
            params={{ slug: l.league.slug }}
            className="flex min-w-0 items-center gap-3 rounded-md border p-3 hover:bg-muted"
          >
            <span className="font-mono tracking-widest">{l.group.name}</span>
            <span className="min-w-0 truncate text-sm text-muted-foreground">{l.league.name}</span>
            <span className="ml-auto shrink-0 tabular-nums">
              {l.rank === null || l.average === null ? 'not yet ranked' : `#${l.rank} · ${l.average.toFixed(1)}`}
            </span>
          </Link>
        ))}
        {mine.length > HOME_CARD_MAX_LEAGUES && (
          <Link to="/leagues" className="self-start text-sm underline underline-offset-4">
            See all
          </Link>
        )}
      </CardContent>
    </Card>
  )
}
