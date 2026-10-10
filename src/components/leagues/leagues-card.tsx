import { Link } from '@tanstack/react-router'
import { useId } from 'react'
import { Button } from '#/components/ui/button.tsx'
import { Card, CardContent, CardHeader, CardTitle } from '#/components/ui/card.tsx'
import { MyLeagueRow } from '#/components/leagues/my-league-row.tsx'
import { GroupPicker } from '#/components/leagues/group-picker.tsx'
import { WordPicker, type PopularWord } from '#/components/leagues/word-picker.tsx'
import { HOME_CARD_MAX_LEAGUES, pickerModeFor, type LeagueKind } from '../../../convex/lib/league.ts'

/** PLAIN STRUCTURAL SHAPE of one api.leagues.myLeagues row; the convex result is assignable to it. */
type MyLeague = {
  /** 'region' is the automatic region row, which myLeagues sends LAST (v2b). */
  kind: LeagueKind
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
  kind?: LeagueKind
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
 * True only for a player whom myLeagues has answered with NO current PICKED
 * rows (a REGION row does not count: the region league is automatic, not a
 * join, so it says nothing about wanting the opener wars; owner decision
 * 2026-10-09), who
 * has NEVER joined a league (`everJoined` is getStatus.inLeague, which counts
 * a left membership: a leaver chose to leave and is not re-offered it), who
 * has NOT DISMISSED the offer ("Not now": getStatus.leagueOfferDismissed), and
 * only where the caller says it may be (`offerPicker`: the team dashboard, not
 * the teamless branch, whose onboarding step makes the offer instead). Spec
 * §8.4, owner decisions 2026-10-08.
 *
 * `everJoined` is unaffected by regions: placement writes no membership row
 * and never stamps leagueJoinedAt, so a region-only player still reads false.
 */
export function pickerCouldShow({
  myLeagues,
  everJoined,
  dismissed,
  offerPicker,
}: {
  myLeagues: { enabled: false } | { enabled: true; leagues: readonly { kind: LeagueKind }[] } | undefined
  everJoined: boolean
  dismissed: boolean
  offerPicker: boolean
}): boolean {
  return !!myLeagues?.enabled && myLeagues.leagues.every((l) => l.kind === 'region') && !everJoined && !dismissed && offerPicker
}

/**
 * THE CARD'S GATING, as a pure function of the two query results (each
 * `undefined` while loading, skipped or failed) and two facts about the viewer.
 * Null means "render nothing".
 *
 * - EVERY CURRENT ROW, picked or region, is always shown.
 * - THE OFFER only where pickerCouldShow says so, and only with a featured
 *   league to offer. A region-only player gets both, in one card (owner
 *   decision 2026-10-09); a member of a picked league never gets the offer.
 * - Otherwise nothing: leagues dark, myLeagues not answered, or no rows and
 *   no offer.
 */
export function leaguesCardInput<M extends MyLeague, L extends FeaturedLeague & { featured: boolean }>(
  myLeagues: MyLeaguesResult<M> | undefined,
  allLeagues: LeaguesResult<L> | undefined,
  viewer: { everJoined: boolean; offerPicker: boolean; dismissed: boolean },
): { mine: M[]; featured: L | null } | null {
  if (!myLeagues?.enabled) return null
  const offer =
    pickerCouldShow({ myLeagues, ...viewer }) && allLeagues?.enabled
      ? (allLeagues.leagues.find((l) => l.featured) ?? null)
      : null
  if (myLeagues.leagues.length === 0 && !offer) return null
  return { mine: myLeagues.leagues, featured: offer }
}

/**
 * THE OFFER'S BODY: the sentence, the picker and "Not now", as a FRAGMENT so
 * both the offer-only card and the combined card lay it out in their own
 * flex column. `headingId` is the heading that names the offer (the card's h2
 * alone, the sub-section's h3 beside rows).
 */
function OfferBody({ featured, onJoin, onJoinWord, onDismiss, busy, headingId }: Pick<Props, 'onJoin' | 'onJoinWord' | 'onDismiss' | 'busy'> & { featured: FeaturedLeague; headingId: string }) {
  const mode = pickerModeFor(featured)
  return (
    <>
      {/* Groups are SIDES to play for, not a claim about the player's own opener (§8.4). */}
      <p className="text-sm text-muted-foreground">Pick a side — your boards count whatever word you start with.</p>
      {/* BY pickerModeFor, as league-page-view's pickerModeOf: a word league is
          joined by word (popular quick picks + any answer word; the answer
          list is lazy-loaded inside WordPicker, never in this chunk), a
          fixed league by group id. */}
      {mode === 'words' ? (
        <WordPicker
          popular={featured.groups}
          currentWord={null}
          disabled={busy}
          label="Choose a group"
          onPick={(word) => onJoinWord(featured.leagueId, word)}
        />
      ) : mode === 'groups' ? (
        <GroupPicker
          groups={featured.groups}
          currentGroupId={null}
          disabled={busy}
          label="Choose a group"
          onPick={onJoin}
        />
      ) : // 'none' IS A REGION LEAGUE, which is never the featured one (the
        // seed features Starting Words only), so this cannot render. Nothing
        // rather than a picker that would be refused AUTOMATIC_LEAGUE.
      null}
      {/* DISMISSIBLE (owner decision 2026-10-08): joining must not be the only way to clear the card. */}
      <Button type="button" variant="ghost" size="sm" className="self-start"
        aria-describedby={headingId}
        disabled={busy}
        onClick={onDismiss}
      >
        Not now
      </Button>
    </>
  )
}

/**
 * Dashboard card (spec §8.4): the viewer's leagues, the featured league's
 * picker when they are in no PICKED league, or both (v2b: a region row and
 * the offer, owner decision 2026-10-09). PRESENTATIONAL: app.tsx owns the
 * queries and the join mutation. Group totals only, never a player (§3.2).
 * Renders NOTHING with no rows and no featured league, so the card is never
 * an empty box.
 */
export function LeaguesCard({ mine, featured, onJoin, onJoinWord, onDismiss, busy, className }: Props) {
  // Ties "Not now" to the offer it dismisses, keeping its accessible NAME the
  // visible text (label-in-name) while a screen reader hears what it hides.
  const headingId = useId()
  const offer = { onJoin, onJoinWord, onDismiss, busy, headingId }
  if (mine.length === 0) {
    if (!featured) return null
    // UNCHANGED BY REGIONS, BYTE FOR BYTE (leagues-card.hook.test.ts pins it):
    // with no rows the offer IS the card, so its title is the card's h2.
    return (
      <Card className={className} role="region" aria-label="Leagues">
        <CardHeader>
          <CardTitle asChild>
            <h2 id={headingId}>Join the opener wars</h2>
          </CardTitle>
        </CardHeader>
        <CardContent className="flex flex-col gap-2">
          <OfferBody featured={featured} {...offer} />
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
          <MyLeagueRow key={l.league.slug} row={l} />
        ))}
        {mine.length > HOME_CARD_MAX_LEAGUES && (
          <Link to="/leagues" className="self-start text-sm underline underline-offset-4">
            See all
          </Link>
        )}
        {/* ROWS AND THE OFFER, ONE CARD (owner decision 2026-10-09): a region
            row never hides the opener offer. The offer is a SUB-SECTION under
            the card's "Leagues" h2, so its title steps down to an h3. A
            PICKED row never shows it, whatever the caller passes: the same
            rule as pickerCouldShow, held here too so a member is never
            offered a second join. */}
        {featured && mine.every((l) => l.kind === 'region') && (
          <div className="mt-2 flex flex-col gap-2">
            <h3 id={headingId} className="font-semibold">
              Join the opener wars
            </h3>
            <OfferBody featured={featured} {...offer} />
          </div>
        )}
      </CardContent>
    </Card>
  )
}
