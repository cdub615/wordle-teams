import { Link } from '@tanstack/react-router'
import { useId } from 'react'
import { Card, CardContent, CardHeader, CardTitle } from '#/components/ui/card.tsx'

/** PLAIN STRUCTURAL SHAPE of one api.leagues.leagues row; `disclaimer` arrives with v2c. */
type DirectoryLeague = { slug: string; name: string; disclaimer?: string | null }
/** PLAIN STRUCTURAL SHAPE of one api.leagues.myLeagues row. */
type MyLeague = {
  league: { slug: string; name: string }
  group: { _id: string; name: string }
  rank: number | null
  average: number | null
}

type Props = {
  leagues: DirectoryLeague[]
  mine: MyLeague[]
}

/**
 * The /leagues directory (spec v2 §5) for two or more leagues: "Your leagues"
 * (one row per membership) and "Join a league" (every league the viewer is not
 * in). A section with nothing in it is omitted. PRESENTATIONAL.
 */
export function LeagueDirectory({ leagues, mine }: Props) {
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
            <Link
              key={m.league.slug}
              to="/leagues/$slug"
              params={{ slug: m.league.slug }}
              className="flex min-w-0 items-center gap-3 rounded-md border p-3 hover:bg-muted"
            >
              <span className="font-mono tracking-widest">{m.group.name}</span>
              <span className="min-w-0 truncate text-sm text-muted-foreground">{m.league.name}</span>
              <span className="ml-auto shrink-0 tabular-nums">
                {m.rank === null || m.average === null ? 'not yet ranked' : `#${m.rank} · ${m.average.toFixed(1)}`}
              </span>
            </Link>
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
