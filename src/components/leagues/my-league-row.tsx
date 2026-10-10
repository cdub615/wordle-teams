import { Link } from '@tanstack/react-router'

/** PLAIN STRUCTURAL SHAPE of one api.leagues.myLeagues row. */
export type MyLeagueRowData = {
  /** 'region' is the automatic region row (v2b), always last; 'picked' is a joined league. */
  kind: 'picked' | 'region'
  league: { slug: string; name: string }
  group: { _id: string; name: string }
  rank: number | null
  average: number | null
}

/**
 * One membership as a link row: group, league, and "#rank · avg" (or "not yet
 * ranked"). Shared by the home card and the /leagues directory so the two
 * can't drift apart. NO aria-label: the visible text (group, league,
 * "#rank · avg" or "not yet ranked") already names the link in full, and a label that
 * differs from it fails WCAG 2.5.3 (Label in Name).
 */
export function MyLeagueRow({ row }: { row: MyLeagueRowData }) {
  const ranked = row.rank !== null && row.average !== null
  const average = row.average === null ? '' : row.average.toFixed(1)
  return (
    <Link
      to="/leagues/$slug"
      params={{ slug: row.league.slug }}
      className="flex min-w-0 items-center gap-3 rounded-md border p-3 hover:bg-muted"
    >
      {/* A REGION NAME IS WORDS, NOT A WORDLE WORD ("Latin America &
          Caribbean"): in the mono tile style beside the shrink-0 rank it
          overflows a 320px phone, which must never scroll sideways. So a
          region is plain text, and both truncate; the full name is still
          the link's visible text, so the WCAG 2.5.3 note above holds. */}
      <span className={row.kind === 'region' ? 'min-w-0 truncate font-medium' : 'min-w-0 truncate font-mono tracking-widest'}>
        {row.group.name}
      </span>
      <span className="min-w-0 truncate text-sm text-muted-foreground">{row.league.name}</span>
      <span className="ml-auto shrink-0 tabular-nums">{ranked ? `#${row.rank} · ${average}` : 'not yet ranked'}</span>
    </Link>
  )
}
