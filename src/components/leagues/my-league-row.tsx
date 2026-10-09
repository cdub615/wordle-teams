import { Link } from '@tanstack/react-router'

/** PLAIN STRUCTURAL SHAPE of one api.leagues.myLeagues row. */
export type MyLeagueRowData = {
  league: { slug: string; name: string }
  group: { _id: string; name: string }
  rank: number | null
  average: number | null
}

/**
 * One membership as a link row: group, league, and "#rank · avg" (or "not yet
 * ranked"). Shared by the home card and the /leagues directory so the two
 * can't drift apart. The aria-label spells the row out for a screen reader.
 */
export function MyLeagueRow({ row }: { row: MyLeagueRowData }) {
  const ranked = row.rank !== null && row.average !== null
  const average = row.average === null ? '' : row.average.toFixed(1)
  const label = ranked
    ? `${row.group.name} in ${row.league.name}, rank ${row.rank}, average ${average}`
    : `${row.group.name} in ${row.league.name}, not yet ranked`
  return (
    <Link
      to="/leagues/$slug"
      params={{ slug: row.league.slug }}
      aria-label={label}
      className="flex min-w-0 items-center gap-3 rounded-md border p-3 hover:bg-muted"
    >
      <span className="font-mono tracking-widest">{row.group.name}</span>
      <span className="min-w-0 truncate text-sm text-muted-foreground">{row.league.name}</span>
      <span className="ml-auto shrink-0 tabular-nums">{ranked ? `#${row.rank} · ${average}` : 'not yet ranked'}</span>
    </Link>
  )
}
