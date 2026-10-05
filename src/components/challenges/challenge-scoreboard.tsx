import { useState } from 'react'
import { Sparkles } from 'lucide-react'
import { Button } from '#/components/ui/button.tsx'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '#/components/ui/table.tsx'
import { ConfirmPopover } from '#/components/confirm-popover.tsx'
import { fromPuzzleDay, type PuzzleDay } from '../../../convex/lib/puzzleDay.ts'
import type { ActiveChallenge, ChallengeSideView } from './types.ts'

/**
 * 'since 5 Oct' — the window's first day, short. en-GB because day-first is
 * what "5 Oct" is; fromPuzzleDay is local noon, so no zone can move the day.
 */
const shortDay = new Intl.DateTimeFormat('en-GB', { day: 'numeric', month: 'short' })

/** ONE DECIMAL, ALWAYS — "4.0", not "4" — so two averages line up and compare. */
function formatAverage(average: number | null): string {
  return average === null ? '—' : average.toFixed(1)
}

function boardsLabel(boards: number): string {
  return `${boards} ${boards === 1 ? 'board' : 'boards'}`
}

/**
 * Who is ahead, said FROM THE VIEWER'S SIDE.
 *
 * `outcome` is stated in challenger/opponent terms and the viewer can be either,
 * so the mapping runs through `viewerIsChallenger` — the one line here that is
 * easy to get backwards, and the reason both directions are tested.
 *
 * 'void' NAMES NOBODY. It means one side has too few boards for the average to
 * mean anything, so any winner wording would be inventing a result.
 */
function verdictFor(challenge: ActiveChallenge): string {
  const { outcome, viewerIsChallenger } = challenge
  if (outcome === 'void') return 'Not enough boards yet'
  if (outcome === 'tie') return 'Level'
  const viewerLeads = (outcome === 'challenger') === viewerIsChallenger
  if (viewerLeads) return "You're ahead"
  const other = viewerIsChallenger ? challenge.opponent : challenge.challenger
  return `${other.teamName} is ahead`
}

/**
 * One live challenge: both teams' pooled averages and board counts, who leads,
 * and — for Pro viewers — each team's per-player rows.
 *
 * THE COMPONENT DOES NOT GATE. challengesForTeamFor strips the member rows for
 * free viewers on the server; `pro` here only chooses between the table and a
 * one-line upgrade hint, so a free viewer sees the hint even when the stripped
 * arrays would happen to be empty anyway.
 *
 * THE VIEWER'S TEAM IS ALWAYS THE LEFT COLUMN, whichever side proposed. Two
 * columns fit at 360px because each holds one name, one number and one count;
 * the member tables, which do not, stack below `sm`.
 */
export function ChallengeScoreboard({
  challenge,
  pro,
  viewerIsOwner,
  onCancel,
  onUpgrade,
  cancelPending = false,
  today,
}: {
  challenge: ActiveChallenge
  pro: boolean
  viewerIsOwner: boolean
  onCancel: (challengeId: ActiveChallenge['challengeId']) => void
  onUpgrade?: () => void
  cancelPending?: boolean
  /**
   * The viewer's day. A window starts the day AFTER acceptance, so on
   * acceptance day "since 6 Oct" would name tomorrow; it reads "starts" until
   * the window opens. Omitted, the label is "since".
   */
  today?: PuzzleDay
}) {
  const [confirmOpen, setConfirmOpen] = useState(false)
  const mine = challenge.viewerIsChallenger ? challenge.challenger : challenge.opponent
  const theirs = challenge.viewerIsChallenger ? challenge.opponent : challenge.challenger
  const sides = [mine, theirs]

  return (
    <section
      aria-label={`${mine.teamName} vs ${theirs.teamName}`}
      className="rounded-md border p-4"
    >
      <div className="flex min-w-0 items-start justify-between gap-2">
        <div className="min-w-0">
          {/* break-words: team names have no length limit at any layer
              (lib/pushText.ts), and "<Other> is ahead" sits beside Cancel. */}
          <h3 className="text-sm font-semibold break-words md:text-base">{verdictFor(challenge)}</h3>
          <p className="text-muted-foreground text-xs md:text-sm">
            {today !== undefined && challenge.startDay > today ? 'starts' : 'since'}{' '}
            {shortDay.format(fromPuzzleDay(challenge.startDay))}
          </p>
        </div>
        {/* EITHER TEAM'S OWNER MAY END IT (D1); this card only ever knows about
            the viewer's own team, so "owner" here means that one. CONFIRMED,
            like every other destructive control on this page: cancelling
            freezes the contest as it stands for both rosters. */}
        {viewerIsOwner && (
          <ConfirmPopover
            open={confirmOpen}
            onOpenChange={setConfirmOpen}
            trigger={
              <Button variant="outline" size="sm" className="shrink-0">
                Cancel
              </Button>
            }
            message={`End the challenge with ${theirs.teamName} now?`}
            confirmLabel="End challenge"
            pending={cancelPending}
            onConfirm={() => onCancel(challenge.challengeId)}
          />
        )}
      </div>

      <div className="mt-4 grid grid-cols-2 gap-4">
        {sides.map((side) => (
          <SideSummary key={side.teamId} side={side} />
        ))}
      </div>

      {pro ? (
        // `sm:grid-cols-2`: two member tables side by side need ~2 x 140px of
        // name + figures, which a 360px phone does not have once the card's
        // padding is paid. Below `sm` they stack, each under its team's name.
        <div className="mt-4 grid grid-cols-1 gap-4 sm:grid-cols-2">
          {sides.map((side) =>
            side.members.length > 0 ? <MemberTable key={side.teamId} side={side} /> : null,
          )}
        </div>
      ) : (
        <div className="text-muted-foreground mt-4 flex flex-wrap items-center justify-between gap-2 text-sm">
          <span>Each player’s average is part of Pro.</span>
          {onUpgrade && (
            <Button variant="ghost" size="sm" onClick={onUpgrade}>
              <Sparkles className="h-4 w-4" aria-hidden="true" />
              Upgrade
            </Button>
          )}
        </div>
      )}
    </section>
  )
}

function SideSummary({ side }: { side: ChallengeSideView }) {
  return (
    <div className="min-w-0">
      <p className="truncate text-sm font-medium">{side.teamName}</p>
      <p className="text-2xl font-semibold tabular-nums">{formatAverage(side.average)}</p>
      {/* Each half stays whole: at 360px the line breaks at the dot, never
          inside "13 boards". */}
      <p className="text-muted-foreground text-xs tabular-nums md:text-sm">
        <span className="whitespace-nowrap">avg guesses</span>
        {' · '}
        <span className="whitespace-nowrap">{boardsLabel(side.boards)}</span>
      </p>
    </div>
  )
}

function MemberTable({ side }: { side: ChallengeSideView }) {
  return (
    <div className="min-w-0">
      <Table aria-label={`${side.teamName} players`}>
        <TableHeader>
          <TableRow>
            <TableHead>{side.teamName}</TableHead>
            <TableHead className="text-right">Avg</TableHead>
            <TableHead className="text-right">Boards</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {side.members.map((member) => (
            <TableRow key={member.playerId}>
              <TableCell>{member.name}</TableCell>
              <TableCell className="text-right tabular-nums">{formatAverage(member.average)}</TableCell>
              <TableCell className="text-right tabular-nums">{member.boards}</TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>
    </div>
  )
}
