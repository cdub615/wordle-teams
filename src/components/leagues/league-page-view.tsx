import { Link } from '@tanstack/react-router'
import { ArrowLeft } from 'lucide-react'
import type { ReactNode } from 'react'
import { Button } from '#/components/ui/button.tsx'
import { GroupPicker, type PickerGroup } from '#/components/leagues/group-picker.tsx'
import { LeagueStandings, monthName } from '#/components/leagues/league-standings.tsx'
import { ContributionRow } from '#/components/leagues/contribution-row.tsx'
import { addMonths, fromPuzzleDay, monthOf, type PuzzleDay, type PuzzleMonth } from '../../../convex/lib/puzzleDay.ts'

/*
 * PLAIN STRUCTURAL SHAPES of api.leagues.standings / myLeagues / myContribution,
 * with ids as strings so a test can build them by hand. The convex results are
 * assignable to these (an Id is a branded string).
 */
type StandingsResult =
  | { enabled: false }
  | {
      enabled: true
      view: null | {
        league: { slug: string; name: string }
        month: PuzzleMonth
        groups: PickerGroup[]
        standings: { groupId: string; rank: number | null; average: number | null; boards: number; contributors: number }[]
        lastMonth: { month: PuzzleMonth; winnerGroupId: string | null } | null
        monthsWon: { groupId: string; count: number }[]
      }
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
  onJoin: (groupId: string) => void
  onSwitch: (groupId: string) => void
  onLeave: (membership: LeagueMembership) => void
  onUpgrade: () => void
}

/**
 * /leagues/$slug once its two required queries have answered (spec §8.2).
 * PRESENTATIONAL: the route owns the queries, mutations and toasts. Group
 * totals only, never a player (§3.2).
 */
export function LeaguePageView({ slug, today, standings, mine, contribution, busy, onJoin, onSwitch, onLeave, onUpgrade }: Props) {
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
          <GroupPicker groups={view.groups} currentGroupId={null} disabled={busy} label="Choose a group" onPick={onJoin} />
          {/* planJoin: tomorrow, or the 1st if a DIFFERENT group already counted this month. */}
          <p className="text-xs text-muted-foreground">
            Your boards count from tomorrow, or from the 1st if you were in another group this month.
          </p>
        </section>
      )}
      <LeagueStandings
        month={view.month}
        groups={view.groups}
        standings={view.standings}
        myGroupId={membership?.group._id ?? null}
        lastMonth={view.lastMonth}
        monthsWon={view.monthsWon}
      />
      {membership && contribution?.enabled && (
        <ContributionRow
          view={contribution.locked ? { locked: true } : { locked: false, contribution: contribution.contribution }}
          groupName={membership.group.name}
          onUpgrade={onUpgrade}
        />
      )}
      {membership && (
        <section aria-labelledby="league-switch-heading" className="flex flex-col gap-2">
          <h2 id="league-switch-heading" className="font-medium">
            Switch group
          </h2>
          <GroupPicker
            groups={view.groups}
            currentGroupId={membership.pending?.group._id ?? membership.group._id}
            disabled={busy}
            label="Switch group"
            onPick={onSwitch}
          />
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
