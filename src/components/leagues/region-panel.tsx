import { Button } from '#/components/ui/button.tsx'
import { Skeleton } from '#/components/ui/skeleton.tsx'
import { dayName } from '#/components/leagues/league-standings.tsx'
import type { PuzzleDay } from '../../../convex/lib/puzzleDay.ts'

/**
 * PLAIN STRUCTURAL SHAPE of api.leagues.myRegion's RegionStatus, with ids as
 * strings so a test can build it by hand. The convex result is assignable to it.
 */
export type RegionPanelStatus =
  | { state: 'no-time-zone' }
  | { state: 'unmapped'; timeZone: string }
  | { state: 'opted-out' }
  | {
      state: 'placed'
      group: { _id: string; name: string }
      /** Can be after today, even in next month (a rejoin on the last day). */
      countsFrom: PuzzleDay
      next: { _id: string; name: string; from: PuzzleDay } | null
    }

/** PLAIN STRUCTURAL SHAPE of api.leagues.myRegion's result. */
type MyRegionResult = { enabled: false } | { enabled: true; region: RegionPanelStatus | null }

/**
 * WHAT THE PANEL SHOWS for the route's myRegion query: undefined only while it
 * loads, so a failure is never a skeleton forever. The data wins over an
 * error (the route keeps the last data through one, useLastData). Dark, or a
 * region league not seeded yet (region: null), has nothing to show either.
 */
export function regionPanelStatus(result: MyRegionResult | undefined, error: unknown): RegionPanelStatus | 'unavailable' | undefined {
  if (!result) return error ? 'unavailable' : undefined
  if (!result.enabled || !result.region) return 'unavailable'
  return result.region
}

type Props = {
  /** Undefined while myRegion loads; 'unavailable' when it failed or has no region to give. */
  status: RegionPanelStatus | 'unavailable' | undefined
  /** The viewer's local day: a `countsFrom` after it has not started. */
  today: PuzzleDay
  busy: boolean
  onLeave: () => void
  onRejoin: () => void
}

/**
 * The region league's stand-in for the join, switch and leave controls (v2b).
 * PLACEMENT IS AUTOMATIC, by time zone, so there is nothing to pick: the
 * player sees where they are and why, and can only opt out or back in.
 *
 * "SET YOUR TIME ZONE" IS TEXT, NOT A LINK (decision 6): Settings is a dialog
 * with no route, so the copy says where to go instead.
 */
export function RegionPanel({ status, today, busy, onLeave, onRejoin }: Props) {
  return (
    <section aria-labelledby="league-region-heading" className="flex flex-col gap-2">
      <h2 id="league-region-heading" className="font-medium">
        Your region
      </h2>
      <RegionBody status={status} today={today} busy={busy} onLeave={onLeave} onRejoin={onRejoin} />
    </section>
  )
}

function RegionBody({ status, today, busy, onLeave, onRejoin }: Props) {
  if (!status) {
    return (
      <div aria-busy="true">
        <Skeleton className="h-5 w-full" />
        <span className="sr-only">Loading your region</span>
      </div>
    )
  }
  if (status === 'unavailable') {
    return (
      <p role="status" className="text-sm text-muted-foreground">
        Couldn’t load your region.
      </p>
    )
  }
  switch (status.state) {
    case 'no-time-zone':
      return (
        <p data-testid="region-status" className="text-sm">
          Set your time zone to join your region: Settings → Alerts → Time Zone.
        </p>
      )
    case 'unmapped':
      return (
        <p data-testid="region-status" className="text-sm break-words">
          Your time zone ({status.timeZone}) isn’t part of a region yet.
        </p>
      )
    case 'opted-out':
      return (
        <>
          <p data-testid="region-status" className="text-sm">
            You’ve left the region league.
          </p>
          <Button type="button" className="self-start" disabled={busy} onClick={onRejoin}>
            Rejoin
          </Button>
          <p className="text-xs text-muted-foreground">Your boards count from tomorrow.</p>
        </>
      )
    case 'placed':
      return (
        <>
          <p data-testid="region-status" className="text-sm">
            You’re in <strong>{status.group.name}</strong>, based on your time zone.
          </p>
          <p className="text-xs text-muted-foreground">A time-zone change moves you from next month.</p>
          {/* After a launch or a rejoin, counting starts tomorrow, or on the 1st after a rejoin on the last day. */}
          {status.countsFrom > today && <p className="text-sm">Your boards count from {dayName(status.countsFrom)}.</p>}
          {status.next && (
            <p className="text-sm">
              Moving to {status.next.name} on {dayName(status.next.from)}.
            </p>
          )}
          <Button type="button" variant="outline" className="self-start" disabled={busy} onClick={onLeave}>
            Leave region
          </Button>
        </>
      )
  }
}
