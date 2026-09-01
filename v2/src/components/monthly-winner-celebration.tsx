import { useEffect, useState } from 'react'
import type { CSSProperties } from 'react'
import { convexQuery, useConvexMutation } from '@convex-dev/react-query'
import { useQuery } from '@tanstack/react-query'
import { api } from '../../convex/_generated/api'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '#/components/ui/dialog.tsx'
import { celebrationView } from '#/lib/celebration.ts'
import { captureError } from '#/lib/sentry-capture.ts'
import { useHydrated } from '#/lib/use-hydrated.ts'
import { addMonths, monthOf, toPuzzleDay } from '../../convex/lib/puzzleDay.ts'
import type { Id } from '../../convex/_generated/dataModel'

/**
 * The confetti modal a team's members see once, when a month closes with a
 * winner. Ports v1's src/app/me/monthly-winner-celebration.tsx.
 *
 * `wordle-teams-k7w`. Phase 2 built the whole write side — `monthlyWinners`,
 * the recomputation, and the deliberate rule that `hasSeenCelebration` survives
 * a winner rewrite (V2-ADDENDUM §7a row 3) — and no UI. Phase 3 did not reach
 * it, Phase 7 audits rather than builds, so nothing owned it. This, plus
 * `winners.getLastMonthWinner` and `winners.markCelebrationSeen`, is it.
 *
 * THREE THINGS ARE DELIBERATELY NOT PORTED.
 *
 * 1. v1 NAMES THE WRONG PERSON. Its title and body interpolate the CURRENT
 *    viewer's name into the "somebody else won" copy, so every member of a team
 *    where they did not win is told they won. Fixed here; the reasoning and the
 *    fix live in lib/celebration.ts, and the divergence is §7a row 35.
 * 2. NO react-confetti-explosion. v1's dependency is not in v2 and is not being
 *    added — Phase 7 has taken aceternity, magicui, framer-motion and embla out
 *    on the same reasoning (§7a rows 20, 25, 31), and a burst of falling
 *    rectangles is a keyframe. §7a row 36, and `ConfettiBurst` below.
 * 3. THE SEEN-LIST IS NOT WRITTEN FROM HERE. v1 reads the array over the
 *    network, appends to its copy and writes the whole column back, so two
 *    members dismissing at once lose one of the two writes. The mutation does
 *    the append inside its own transaction and this sends no array at all —
 *    see markCelebrationSeenFor in convex/winners.ts, and `wordle-teams-069`.
 *
 * WHY THE OUTER COMPONENT IS A HYDRATION GATE AND NOTHING ELSE. "Last month"
 * is a question about the VIEWER's calendar; this renders on the server, where
 * `new Date()` is UTC. That is §7a rows 14-15's defect class and the trap Task
 * 10's Team Boards panel was built around — but it arrives here through the
 * QUERY KEY rather than through the markup, and the distinction is worth being
 * precise about, because it is what the test pins. No render of this component
 * ever emits anything on the server: the dialog is closed until an effect opens
 * it, and a closed Radix Dialog is not a DOM node. Ungated, what the server
 * WOULD do is subscribe to `getLastMonthWinner` for UTC's previous month while
 * the client's first render subscribes for the viewer's — two different cache
 * entries, and a dehydrated server cache holding the answer to the wrong
 * question. `useHydrated()` is false on the server and on the client's first
 * render, so the month is resolved exactly once, in the browser, in the
 * viewer's own zone. The split into two components is what keeps that a plain
 * early return rather than a conditional query argument.
 */
export function MonthlyWinnerCelebration({ teamId }: { teamId: Id<'teams'> }) {
  const hydrated = useHydrated()
  if (!hydrated) return null

  const month = addMonths(monthOf(toPuzzleDay(new Date())), -1)
  // KEYED, so the latch below cannot leak across teams. Switching teams asks a
  // different question and must be able to open a second time; without this,
  // `opened` would still be true from the first team and the dialog for the
  // second would be considered already shown. The month is in the key for the
  // same reason at a much rarer boundary — a tab left open across midnight on
  // the 1st.
  return <Celebration key={`${teamId}:${month}`} teamId={teamId} month={month} />
}

function Celebration({ teamId, month }: { teamId: Id<'teams'>; month: string }) {
  // PLAIN useQuery, NOT useSuspenseQuery, and neither is prefetched in the
  // route loader — Header.tsx's reasoning exactly. Suspending would hold the
  // whole dashboard behind a read that decides whether to show a dialog nobody
  // is waiting for; a plain query means the page paints and the dialog arrives
  // when it arrives.
  const { data: myPlayerId } = useQuery(convexQuery(api.scores.getMyPlayerId, {}))
  const { data: row } = useQuery(convexQuery(api.winners.getLastMonthWinner, { teamId, month }))
  const markSeen = useConvexMutation(api.winners.markCelebrationSeen)

  /**
   * LATCHED, AND THAT IS THE WHOLE OF THE OPEN/CLOSE LOGIC.
   *
   * `getLastMonthWinner` is a reactive subscription. The moment the mutation
   * below commits, the row re-pushes with `hasSeen: true` and
   * `view.shouldOpen` goes false — so driving `open` off the query directly
   * would open the dialog and shut it again in the same breath. `opened` is
   * set once and never cleared; `dismissed` is the only thing that closes it.
   */
  const [opened, setOpened] = useState(false)
  const [dismissed, setDismissed] = useState(false)

  const view = celebrationView(row, myPlayerId)
  const shouldOpen = view?.shouldOpen ?? false

  useEffect(() => {
    if (!shouldOpen || opened) return
    setOpened(true)
    // MARKED SEEN ON OPEN, not on dismiss — v1's timing, kept. Closing the tab
    // on an open celebration still counts as having seen it, which is the
    // behaviour that stops it following someone around.
    markSeen({ teamId, month }).catch((error: unknown) => {
      // Reported rather than toasted. Nothing the viewer can do about it, and
      // the failure mode is benign: the dialog simply appears again next visit.
      captureError(error, { where: 'markCelebrationSeen', teamId, month })
    })
  }, [shouldOpen, opened, markSeen, teamId, month])

  if (!view) return null

  return (
    <Dialog open={opened && !dismissed} onOpenChange={(next) => {
        if (!next) setDismissed(true)
      }}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{view.title}</DialogTitle>
          <DialogDescription>{view.message}</DialogDescription>
        </DialogHeader>
        {/* Only for the winner, matching v1: the point is congratulation, and
            firing it at the four people who lost reads as mockery. */}
        {view.viewerWon && <ConfettiBurst />}
      </DialogContent>
    </Dialog>
  )
}

/**
 * The palette, in theme tokens rather than hex, so the burst is legible in both
 * themes without a second set of values.
 */
const CONFETTI_COLORS = [
  'var(--wordle-correct)',
  'var(--wordle-present)',
  'var(--brand-via)',
  'var(--brand-to)',
  'var(--accent-solid)',
]

/**
 * DETERMINISTIC, NOT RANDOM. Every piece's column, drift, spin, delay and
 * duration falls out of its index, so the burst is identical on every run —
 * which is what lets a test assert the set rather than only its size, and what
 * keeps a re-render from re-scattering the pieces mid-flight.
 */
export const CONFETTI_PIECES = Array.from({ length: 24 }, (_, index) => ({
  left: `${(index * 37) % 100}%`,
  drift: `${((index * 53) % 61) - 30}px`,
  spin: `${(((index * 97) % 5) + 2) * 180}deg`,
  delay: `${(index % 6) * 60}ms`,
  duration: `${1100 + ((index * 7) % 5) * 140}ms`,
  color: CONFETTI_COLORS[index % CONFETTI_COLORS.length],
}))

/** The media query the burst asks about before animating anything. */
export const REDUCED_MOTION_QUERY = '(prefers-reduced-motion: reduce)'

/**
 * v1's `<ConfettiExplosion />`, as 24 absolutely-positioned rectangles and one
 * keyframe (`.confetti-piece` / `@keyframes confetti-fall` in styles.css).
 *
 * REDUCED MOTION RENDERS NOTHING, WHICH v1 DOES NOT DO AT ALL.
 * react-confetti-explosion animates unconditionally. Here the whole point of
 * the element is the motion, so a viewer who has asked for less of it gets no
 * pieces rather than a static pile of paper stuck to the top of the dialog —
 * and the copy, which is the actual message, is unaffected either way.
 *
 * ASKED IN JAVASCRIPT, NOT IN A `@media (prefers-reduced-motion)` BLOCK. A
 * media query in styles.css cannot be observed by any gate this repo runs —
 * there is no CSSOM under vitest — so the rule would have been unpinned, which
 * is `wt-ksh.8.49`'s lesson twice over. `matchMedia` is optional-called
 * because jsdom ships none at all (found on wordle-teams-ry1), and this
 * component only mounts inside an open dialog, so there is no server render to
 * disagree with.
 */
function ConfettiBurst() {
  if (window.matchMedia?.(REDUCED_MOTION_QUERY).matches ?? false) return null

  return (
    <div
      aria-hidden="true"
      data-slot="confetti"
      className="pointer-events-none absolute inset-x-0 top-0 h-0 overflow-visible"
    >
      {CONFETTI_PIECES.map((piece, index) => (
        <span
          key={index}
          className="confetti-piece"
          style={{
            left: piece.left,
            backgroundColor: piece.color,
            '--confetti-drift': piece.drift,
            '--confetti-spin': piece.spin,
            '--confetti-delay': piece.delay,
            '--confetti-duration': piece.duration,
          } as CSSProperties}
        />
      ))}
    </div>
  )
}

export default MonthlyWinnerCelebration
