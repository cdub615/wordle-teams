import { useEffect, useRef } from 'react'
import { Card, CardContent, CardHeader, CardTitle } from '#/components/ui/card.tsx'
import { cn } from '#/lib/utils.ts'
import { Skeleton } from '#/components/ui/skeleton.tsx'
import { Label } from '#/components/ui/label.tsx'
import { Separator } from '#/components/ui/separator.tsx'
import { Switch } from '#/components/ui/switch.tsx'
import { Button } from '#/components/ui/button.tsx'
import { Sparkles, Swords } from 'lucide-react'
import { ChallengeScoreboard } from './challenge-scoreboard.tsx'
import { PendingChallengeRow } from './pending-challenge-row.tsx'
import type { ChallengeId, ChallengesView, HeadToHeadView } from './types.ts'
import { toPuzzleDay } from '../../../convex/lib/puzzleDay.ts'

/**
 * The team page's Challenges section (zic8.2.12, owner decision D8): live
 * scoreboards, pending proposals with their verbs, the head-to-head record,
 * and — for the owner only — the "accept challenges" switch at the bottom.
 *
 * PLAIN PROPS, NO CONVEX. routes/team.tsx owns the query and the mutations and
 * hands this the answer and the callbacks, so every state below renders in a
 * test without a backend.
 *
 * A DARK DEPLOYMENT RENDERS NOTHING AT ALL — no heading, no empty state.
 * challengesForTeam answers `{ enabled: false }` there rather than throwing, and
 * the feature must be invisible until wordle-teams-rac turns it on, not
 * announced as empty.
 */
export function ChallengesCard({
  view,
  isOwner,
  acceptsChallenges,
  now,
  busyId = null,
  onAccept,
  onDecline,
  onWithdraw,
  onCancel,
  onSetAcceptsChallenges,
  onUpgrade,
  onChallenge,
  className,
  acceptsPending = false,
}: {
  view: ChallengesView
  isOwner: boolean
  /** The team's setting. ABSENT MEANS ON, matching the schema's optional field. */
  acceptsChallenges: boolean | undefined
  now: number
  /** The challenge a mutation is in flight for, whose controls are disabled. */
  busyId?: ChallengeId | null
  onAccept: (challengeId: ChallengeId) => void
  onDecline: (challengeId: ChallengeId) => void
  onWithdraw: (challengeId: ChallengeId) => void
  onCancel: (challengeId: ChallengeId) => void
  onSetAcceptsChallenges: (accepts: boolean) => void
  /**
   * REQUIRED: the free viewer's "Challenge a team" control calls it, and an
   * optional prop would let a caller leave it out and ship a dead control (AC2).
   */
  onUpgrade: () => void
  /** Opens the propose dialog. Only a Pro viewer's control calls it. */
  onChallenge: () => void
  className?: string
  /** The switch's mutation is in flight: disabled, so a second click is not lost. */
  acceptsPending?: boolean
}) {
  const headingRef = useRef<HTMLHeadingElement>(null)
  // The challenge the VIEWER last acted on, and which list its control was in.
  const actedOn = useRef<{ challengeId: ChallengeId; list: 'active' | 'pending' } | null>(null)
  const acting =
    (list: 'active' | 'pending', handler: (challengeId: ChallengeId) => void) =>
    (challengeId: ChallengeId) => {
      actedOn.current = { challengeId, list }
      handler(challengeId)
    }

  /**
   * FOCUS AFTER A ROW GOES (zic8.2.21 M9). When the viewer's own action
   * succeeds, the subscription removes the row — and the control they pressed
   * with it — so focus would fall to <body>, the top of the page. It moves to
   * this card's heading instead.
   *
   * ONLY THEIR OWN ACTION, AND ONLY IF FOCUS WAS LOST. A row someone else
   * answered must not pull a reader away from wherever they are, and nor may
   * an action whose row goes after the viewer has already moved on. An accept
   * counts as gone from `pending` even though the same challenge reappears in
   * `active`: the row and its buttons are what unmounted.
   */
  useEffect(() => {
    const acted = actedOn.current
    if (acted === null || !view.enabled) return
    const list = acted.list === 'active' ? view.active : view.pending
    if (list.some((challenge) => challenge.challengeId === acted.challengeId)) return
    actedOn.current = null
    const focused = document.activeElement
    if (focused === null || focused === document.body || !focused.isConnected) {
      headingRef.current?.focus()
    }
  }, [view])

  if (!view.enabled) return null

  const { pro, active, pending, records } = view
  const nothingLive = active.length === 0 && pending.length === 0
  const accepting = acceptsChallenges !== false

  return (
    <Card className={className} role="region" aria-label="Challenges">
      <CardHeader>
        <CardTitle asChild>
          <div className="flex min-w-0 items-center justify-between gap-2">
            {/* tabIndex -1: focusable by the effect above, not a tab stop. */}
            <h2 ref={headingRef} tabIndex={-1}>
              Challenges
            </h2>
            {/* "CHALLENGE A TEAM" (Task 12b), beside the heading the way
                CurrentTeamCard's owner buttons sit. ONE LABEL FOR BOTH TIERS:
                a free viewer gets the same words as an upgrade affordance
                (the Sparkles, as the scoreboard's Pro hint has), never a
                disabled button — a dead control says "not for you" without
                saying what would change that. proposeToTeam refuses a free
                caller with PRO_REQUIRED anyway; this keeps them from finding
                out by being refused. Any member may propose, not only the
                owner, so this is not owner-gated. */}
            {pro ? (
              <Button type="button" variant="outline" size="sm" onClick={onChallenge}>
                <Swords className="h-4 w-4" aria-hidden="true" />
                Challenge a team
              </Button>
            ) : (
              <Button type="button" variant="outline" size="sm" onClick={onUpgrade}>
                <Sparkles className="h-4 w-4" aria-hidden="true" />
                Challenge a team
              </Button>
            )}
          </div>
        </CardTitle>
      </CardHeader>
      <CardContent className="flex flex-col gap-4">
        {nothingLive && (
          <p className="text-muted-foreground text-sm">No challenges in progress.</p>
        )}

        {active.map((challenge) => (
          <ChallengeScoreboard
            key={challenge.challengeId}
            challenge={challenge}
            pro={pro}
            viewerIsOwner={isOwner}
            onCancel={acting('active', onCancel)}
            onUpgrade={onUpgrade}
            cancelPending={busyId === challenge.challengeId}
            today={toPuzzleDay(new Date(now))}
          />
        ))}

        {pending.length > 0 && (
          <div>
            <h3 className="text-muted-foreground mb-2 text-sm font-medium">Proposals</h3>
            <ul className="flex flex-col space-y-2">
              {pending.map((challenge, index) => (
                <li key={challenge.challengeId} className="min-w-0">
                  <PendingChallengeRow
                    challenge={challenge}
                    viewerIsOwner={isOwner}
                    now={now}
                    teamAcceptsChallenges={accepting}
                    busy={busyId === challenge.challengeId}
                    onAccept={acting('pending', onAccept)}
                    onDecline={acting('pending', onDecline)}
                    onWithdraw={acting('pending', onWithdraw)}
                  />
                  {index < pending.length - 1 && <Separator className="mt-2" />}
                </li>
              ))}
            </ul>
          </div>
        )}

        {records.length > 0 && (
          <div>
            <h3 className="text-muted-foreground mb-2 text-sm font-medium">Head to head</h3>
            <ul className="flex flex-col space-y-1 text-sm">
              {records.map((record) => (
                <li key={record.opponentTeamId} className="min-w-0 break-words tabular-nums">
                  {recordLine(record)}
                </li>
              ))}
            </ul>
          </div>
        )}

        {/* OWNER ONLY, AND LAST (D8). setAcceptsChallenges is owner-gated on
            the server too; a member would only ever see it refused. */}
        {isOwner && (
          <div>
            <Separator className="mb-4" />
            <div className="flex items-center justify-between gap-2">
              <Label htmlFor="accepts-challenges">Accept challenges</Label>
              <Switch
                id="accepts-challenges"
                checked={accepting}
                disabled={acceptsPending}
                onCheckedChange={() => onSetAcceptsChallenges(!accepting)}
              />
            </div>
          </div>
        )}
      </CardContent>
    </Card>
  )
}

/**
 * "Rivals — won 2, lost 1, tied 0", plus ", 1 no result" ONLY WHEN NON-ZERO.
 * A void is neither a win nor a loss (headToHeadFor), so it is never folded
 * into the three columns, and "0 no result" on every line would be noise.
 */
function recordLine({ opponentName, record }: HeadToHeadView): string {
  const base = `${opponentName} — won ${record.won}, lost ${record.lost}, tied ${record.tied}`
  return record.noResult > 0 ? `${base}, ${record.noResult} no result` : base
}

/**
 * The Suspense fallback routes/team.tsx shows while challengesForTeam is in
 * flight. SMALL, AND IT DOES NOT SAY "Challenges": on a dark deployment the real
 * card renders nothing, so the placeholder must neither announce the feature
 * nor be a large jump to zero when it resolves.
 */
export function ChallengesCardSkeleton({ className }: { className?: string }) {
  return (
    <Skeleton
      className={cn('h-16 w-full rounded-lg', className)}
      data-slot="challenges-skeleton"
      aria-hidden="true"
    />
  )
}
