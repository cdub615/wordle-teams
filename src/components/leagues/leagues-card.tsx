import { Link } from '@tanstack/react-router'
import { useId } from 'react'
import { Button } from '#/components/ui/button.tsx'
import { Card, CardContent, CardHeader, CardTitle } from '#/components/ui/card.tsx'
import { GroupPicker } from '#/components/leagues/group-picker.tsx'
import { WordPicker, type PopularWord } from '#/components/leagues/word-picker.tsx'
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
  featured: FeaturedLeague | null
  /** A FIXED featured league joins by group id (leagues.joinGroup). */
  onJoin: (groupId: string) => void
  /** A WORD featured league joins by word (leagues.joinWord), which takes the league id. */
  onJoinWord: (leagueId: string, word: string) => void
  /** "Not now" on the picker: the caller records the dismissal (leagues.dismissLeagueOffer). */
  onDismiss: () => void
  busy: boolean
  className?: string
}

/**
 * PLAIN STRUCTURAL SHAPE of one api.leagues.leagues row. `groups` is a fixed
 * league's every group, or a word league's POPULAR_GROUPS (spec v2 §5);
 * `slug` on a word league's group is its word.
 */
type FeaturedLeague = {
  leagueId: string
  slug: string
  name: string
  groupSource: 'fixed' | 'answer-words'
  groups: PopularWord[]
}
type MyLeaguesResult<M extends MyLeague> = { enabled: false } | { enabled: true; leagues: M[] }
type LeaguesResult<L extends FeaturedLeague & { featured: boolean }> = { enabled: false } | { enabled: true; leagues: L[] }

/**
 * COULD THE PICKER SHOW? The ONE predicate for it, shared by leaguesCardInput
 * (whether to render the offer) and app.tsx (whether to subscribe to the
 * `leagues` list at all, which is read only while this is true: it carries
 * every group's memberCount, so an unconditional subscription would fan every
 * join anywhere out to every dashboard).
 *
 * True only for a player whom myLeagues has answered with NO current rows, who
 * has NEVER joined a league (`everJoined` is getStatus.inLeague, which counts
 * a left membership: a leaver chose to leave and is not re-offered it), who
 * has NOT DISMISSED the offer ("Not now": getStatus.leagueOfferDismissed), and
 * only where the caller says it may be (`offerPicker`: the team dashboard, not
 * the teamless branch, whose onboarding step makes the offer instead). Spec
 * §8.4, owner decisions 2026-10-08.
 */
export function pickerCouldShow({
  myLeagues,
  everJoined,
  dismissed,
  offerPicker,
}: {
  myLeagues: { enabled: false } | { enabled: true; leagues: readonly unknown[] } | undefined
  everJoined: boolean
  dismissed: boolean
  offerPicker: boolean
}): boolean {
  return !!myLeagues?.enabled && myLeagues.leagues.length === 0 && !everJoined && !dismissed && offerPicker
}

/**
 * THE CARD'S GATING, as a pure function of the two query results (each
 * `undefined` while loading, skipped or failed) and two facts about the viewer.
 * Null means "render nothing".
 *
 * - A MEMBER always gets their current rows, and never the picker.
 * - THE PICKER only where pickerCouldShow says so, and only with a featured
 *   league to offer.
 * - Otherwise nothing: leagues dark, myLeagues not answered, or no featured
 *   league to offer.
 */
export function leaguesCardInput<M extends MyLeague, L extends FeaturedLeague & { featured: boolean }>(
  myLeagues: MyLeaguesResult<M> | undefined,
  allLeagues: LeaguesResult<L> | undefined,
  viewer: { everJoined: boolean; offerPicker: boolean; dismissed: boolean },
): { mine: M[]; featured: L | null } | null {
  if (!myLeagues?.enabled) return null
  if (myLeagues.leagues.length > 0) return { mine: myLeagues.leagues, featured: null }
  if (!pickerCouldShow({ myLeagues, ...viewer })) return null
  const featured = allLeagues?.enabled ? (allLeagues.leagues.find((l) => l.featured) ?? null) : null
  return featured ? { mine: [], featured } : null
}

/**
 * Dashboard card (spec §8.4): the viewer's leagues, or the featured league's
 * picker when they are in none. PRESENTATIONAL: app.tsx owns the queries and
 * the join mutation. Group totals only, never a player (§3.2). Renders NOTHING
 * with no membership and no featured league, so the card is never an empty box.
 */
export function LeaguesCard({ mine, featured, onJoin, onJoinWord, onDismiss, busy, className }: Props) {
  // Ties "Not now" to the offer it dismisses, keeping its accessible NAME the
  // visible text (label-in-name) while a screen reader hears what it hides.
  const headingId = useId()
  if (mine.length === 0) {
    if (!featured) return null
    return (
      <Card className={className} role="region" aria-label="Leagues">
        <CardHeader>
          <CardTitle asChild>
            <h2 id={headingId}>Join the opener wars</h2>
          </CardTitle>
        </CardHeader>
        <CardContent className="flex flex-col gap-2">
          {/* Groups are SIDES to play for, not a claim about the player's own opener (§8.4). */}
          <p className="text-sm text-muted-foreground">Pick a side — your boards count whatever word you start with.</p>
          {/* BY groupSource, as league-page-view's pickerModeOf: a word league is
              joined by word (popular quick picks + any answer word; the answer
              list is lazy-loaded inside WordPicker, never in this chunk), a
              fixed league by group id. */}
          {featured.groupSource === 'answer-words' ? (
            <WordPicker
              popular={featured.groups}
              currentWord={null}
              disabled={busy}
              label="Choose a group"
              onPick={(word) => onJoinWord(featured.leagueId, word)}
            />
          ) : (
            <GroupPicker
              groups={featured.groups}
              currentGroupId={null}
              disabled={busy}
              label="Choose a group"
              onPick={onJoin}
            />
          )}
          {/* DISMISSIBLE (owner decision 2026-10-08): joining must not be the only way to clear the card. */}
          <Button type="button" variant="ghost" size="sm" className="self-start"
            aria-describedby={headingId}
            disabled={busy}
            onClick={onDismiss}
          >
            Not now
          </Button>
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
