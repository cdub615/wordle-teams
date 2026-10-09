import { Link } from '@tanstack/react-router'
import { ArrowLeft } from 'lucide-react'
import type { ReactNode } from 'react'
import { Button } from '#/components/ui/button.tsx'
import { GroupPicker, type PickerGroup } from '#/components/leagues/group-picker.tsx'
import { WordPicker, type PopularWord } from '#/components/leagues/word-picker.tsx'
import { LeagueStandings, monthName, type FindResult } from '#/components/leagues/league-standings.tsx'
import { ContributionRow } from '#/components/leagues/contribution-row.tsx'
import { leaguePageNudge } from '#/lib/league-nudges.ts'
import type { UpgradeOrigin } from '#/lib/plans.ts'
import { addMonths, fromPuzzleDay, monthOf, type PuzzleDay, type PuzzleMonth } from '../../../convex/lib/puzzleDay.ts'

/*
 * PLAIN STRUCTURAL SHAPES of api.leagues.standings / myLeagues / myContribution,
 * with ids as strings so a test can build them by hand. The convex results are
 * assignable to these (an Id is a branded string).
 */
type Row = { groupId: string; rank: number | null; average: number | null; boards: number; contributors: number }

type SmallView = {
  large: false
  league: { slug: string; name: string }
  month: PuzzleMonth
  groups: PickerGroup[]
  standings: Row[]
  lastMonth: { month: PuzzleMonth; winnerGroupId: string | null } | null
  monthsWon: { groupId: string; count: number }[]
}

/** Spec v2 §4.5: the slice. `standings` is shown + viewer; `groups` names only what it references. */
type LargeView = Omit<SmallView, 'large' | 'lastMonth'> & {
  large: true
  groupSource: 'fixed' | 'answer-words'
  leagueId: string
  popular: PopularWord[]
  /** A fixed league's every group, for its picker; null for a word league. */
  pickable: PickerGroup[] | null
  shown: Row[]
  viewer: Row | null
  unrankedCount: number
  lastMonth: { month: PuzzleMonth; winnerGroupId: string | null; viewerRank: number | null } | null
}

type StandingsResult = { enabled: false } | { enabled: true; view: null | SmallView | LargeView }

/**
 * HOW THIS LEAGUE IS JOINED, by its group source, not its size: a word league
 * by word (WordPicker), a fixed league by group id over every group
 * (GroupPicker, whose searchable sheet takes over above PICKER_INLINE_MAX).
 * v2b: a region league will be `{ kind: 'region' }`, with no picker at all
 * (placement is automatic) — add it here and to the switch in pickerFor.
 */
type PickerMode = { kind: 'words'; leagueId: string; popular: PopularWord[] } | { kind: 'groups'; groups: PickerGroup[] }

function pickerModeOf(view: SmallView | LargeView): PickerMode {
  if (!view.large) return { kind: 'groups', groups: view.groups }
  if (view.groupSource === 'answer-words') return { kind: 'words', leagueId: view.leagueId, popular: view.popular }
  return { kind: 'groups', groups: view.pickable ?? [] }
}

export type LeagueMembership = {
  league: { slug: string; name: string }
  leagueId: string
  group: { _id: string; name: string }
  since: PuzzleDay
  pending: null | { group: { _id: string; name: string }; from: PuzzleDay }
}

type MyLeaguesResult = { enabled: false } | { enabled: true; leagues: LeagueMembership[] }

type ContributionResult =
  | { enabled: false }
  | { enabled: true; locked: true }
  | { enabled: true; locked: false; contribution: { mine: number | null; group: number | null; shift: number | null } | null }

/** The viewer's membership of THIS league, or null. Shared with the route, which skips myContribution without one. */
export function membershipIn<M extends LeagueMembership>(mine: { enabled: false } | { enabled: true; leagues: M[] } | undefined, slug: string): M | null {
  if (!mine?.enabled) return null
  return mine.leagues.find((l) => l.league.slug === slug) ?? null
}

/**
 * The toast after a successful Leave, naming the consequence (planJoin in
 * convex/lib/league.ts): one group per league per month, so a member whose
 * boards already counted this month can rejoin THE SAME group tomorrow but any
 * other only from the 1st. A membership that had not started yet (`since` after
 * today) never counted a board, so there is no month to protect.
 */
export function leaveMessage(groupName: string, since: PuzzleDay, today: PuzzleDay): string {
  if (since > today) return `You left ${groupName} before any of your boards counted for it.`
  return `You left ${groupName}. Rejoin ${groupName} from tomorrow, or join another group from ${monthName(addMonths(monthOf(today), 1))} 1.`
}

/** The page frame every state shares, so a loading → loaded swap does not jump. */
export function LeagueFrame({ title, children }: { title: ReactNode; children?: ReactNode }) {
  return (
    <main className="page-max mt-2 md:mt-6">
      <div className="mx-auto flex w-full max-w-3xl flex-col gap-4">
        <div className="flex items-center gap-2">
          <Button variant="ghost" size="icon" aria-label="Back to dashboard" asChild>
            <Link to="/app">
              <ArrowLeft className="h-4 w-4" aria-hidden="true" />
            </Link>
          </Button>
          <h1 className="text-2xl font-bold">{title}</h1>
        </div>
        {children}
      </div>
    </main>
  )
}

/** 'October 8': a day as the membership line names it. */
function dayName(day: PuzzleDay): string {
  return `${monthName(monthOf(day))} ${fromPuzzleDay(day).getDate()}`
}

type Props = {
  slug: string
  /** The viewer's local day: a membership whose `since` is after it has not started. */
  today: PuzzleDay
  standings: StandingsResult
  mine: MyLeaguesResult
  /** Undefined while loading, or when the viewer is not a member (the route skips it). */
  contribution: ContributionResult | undefined
  busy: boolean
  /** A fixed league joins and switches by group id. */
  onJoin: (groupId: string) => void
  onSwitch: (groupId: string) => void
  /** A word league joins and switches by word (joinWord/switchWord), which take the league id. */
  onJoinWord: (leagueId: string, word: string) => void
  onSwitchWord: (leagueId: string, word: string) => void
  onLeave: (membership: LeagueMembership) => void
  /** A large league's "Find a group": the route owns the groupStanding query. */
  find: { onFind: (word: string) => void; result: FindResult | null }
  onUpgrade: (origin: UpgradeOrigin) => void
  /** The route is showing the last standings or memberships it had, through a query error. */
  stale?: boolean
}

/**
 * /leagues/$slug once its two required queries have answered (spec §8.2).
 * PRESENTATIONAL: the route owns the queries, mutations and toasts. Group
 * totals only, never a player (§3.2).
 */
export function LeaguePageView({
  slug,
  today,
  standings,
  mine,
  contribution,
  busy,
  onJoin,
  onSwitch,
  onJoinWord,
  onSwitchWord,
  onLeave,
  find,
  onUpgrade,
  stale = false,
}: Props) {
  if (!standings.enabled || !mine.enabled) {
    return (
      <LeagueFrame title="Leagues">
        <p>Leagues aren’t available yet.</p>
      </LeagueFrame>
    )
  }
  const view = standings.view
  if (!view) {
    return (
      <LeagueFrame title="Leagues">
        <p>That league doesn’t exist.</p>
        <Link to="/leagues" className="self-start text-sm underline underline-offset-4">
          See all leagues
        </Link>
      </LeagueFrame>
    )
  }

  const membership = membershipIn(mine, slug)
  const myGroupId = membership?.group._id ?? null

  // Spec v2 §4.6, on any league page (leaguePageNudge is null when nothing
  // applies). Computed only once the contribution has answered: until then a
  // Pro or trial viewer would flash an upsell. A non-member has no
  // contribution, so no nudge. Rows come ranked first, so the leader is row 0;
  // only the large shape knows last month's viewer rank.
  const myRow = view.standings.find((s) => s.groupId === myGroupId)
  const leader = (view.large ? view.shown : view.standings)[0]
  const nudge =
    membership && contribution?.enabled
      ? leaguePageNudge({
          unlocked: !contribution.locked,
          groupName: membership.group.name,
          rank: myRow?.rank ?? null,
          average: myRow?.average ?? null,
          leaderAverage: leader?.average ?? null,
          lastMonth: view.lastMonth
            ? { monthName: monthName(view.lastMonth.month), viewerRank: view.large ? view.lastMonth.viewerRank : null }
            : null,
        })
      : null

  const mode = pickerModeOf(view)
  const pickerFor = (label: string, submitLabel: string, current: { _id: string; name: string } | null, onGroup: (groupId: string) => void, onWord: (leagueId: string, word: string) => void) => {
    switch (mode.kind) {
      case 'words':
        return (
          <WordPicker
            popular={mode.popular}
            currentWord={current?.name ?? null}
            disabled={busy}
            label={label}
            submitLabel={submitLabel}
            onPick={(word) => onWord(mode.leagueId, word)}
          />
        )
      case 'groups':
        return <GroupPicker groups={mode.groups} currentGroupId={current?._id ?? null} disabled={busy} label={label} onPick={onGroup} />
    }
  }

  return (
    <LeagueFrame title={view.league.name}>
      {membership ? (
        <p data-testid="league-membership" className="text-sm">
          You play for <span className="font-mono tracking-widest">{membership.group.name}</span>
          {membership.since > today && ` from ${dayName(membership.since)}`}
          {membership.pending &&
            ` · switching to ${membership.pending.group.name} on ${monthName(monthOf(membership.pending.from))} 1`}
        </p>
      ) : (
        <section aria-labelledby="league-join-heading" className="flex flex-col gap-2">
          <h2 id="league-join-heading" className="font-medium">
            Join the opener wars
          </h2>
          <p className="text-sm text-muted-foreground">Pick a side — your boards count whatever word you start with.</p>
          {pickerFor('Choose a group', 'Join', null, onJoin, onJoinWord)}
          {/* planJoin: tomorrow, or the 1st if a DIFFERENT group already counted this month. */}
          <p className="text-xs text-muted-foreground">
            Your boards count from tomorrow, or from the 1st if you were in another group this month.
          </p>
        </section>
      )}
      {stale && (
        <p role="status" className="text-sm text-muted-foreground">
          Couldn’t refresh the standings — showing the last ones we had.
        </p>
      )}
      {view.large ? (
        <LeagueStandings
          month={view.month}
          groups={view.groups}
          standings={view.shown}
          viewer={view.viewer}
          unrankedCount={view.unrankedCount}
          find={find}
          myGroupId={myGroupId}
          lastMonth={view.lastMonth}
          monthsWon={view.monthsWon}
        />
      ) : (
        <LeagueStandings
          month={view.month}
          groups={view.groups}
          standings={view.standings}
          myGroupId={myGroupId}
          lastMonth={view.lastMonth}
          monthsWon={view.monthsWon}
        />
      )}
      {nudge && (
        <p data-testid="league-nudge" className="text-sm text-muted-foreground">
          {nudge.text}{' '}
          <Button type="button" variant="link" size="sm" className="h-auto p-0" onClick={() => onUpgrade(nudge.origin)}>
            Upgrade
          </Button>
        </p>
      )}
      {membership && contribution?.enabled && (
        <ContributionRow
          view={contribution.locked ? { locked: true } : { locked: false, contribution: contribution.contribution }}
          groupName={membership.group.name}
          onUpgrade={() => onUpgrade('leagues')}
        />
      )}
      {membership && (
        <section aria-labelledby="league-switch-heading" className="flex flex-col gap-2">
          <h2 id="league-switch-heading" className="font-medium">
            Switch group
          </h2>
          {pickerFor('Switch group', 'Switch', membership.pending?.group ?? membership.group, onSwitch, onSwitchWord)}
          {/* STATE-TRUE (owner hand test 2026-10-08): a membership that has not
              started yet is retargeted IN PLACE by a switch (planSwitch), so the
              change is immediate until its start day; only a started one waits
              for the 1st. */}
          <p className="text-xs text-muted-foreground">
            {membership.since > today
              ? `Changes apply at once until it starts on ${dayName(membership.since)}.`
              : 'A switch takes effect on the 1st.'}
          </p>
          <Button type="button" variant="outline" className="self-start" disabled={busy} onClick={() => onLeave(membership)}>
            Leave league
          </Button>
        </section>
      )}
    </LeagueFrame>
  )
}
