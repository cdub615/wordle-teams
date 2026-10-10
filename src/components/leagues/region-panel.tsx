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

type Props = {
  /** Undefined while myRegion loads. */
  status: RegionPanelStatus | undefined
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
      </div>
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
        <p data-testid="region-status" className="text-sm">
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
