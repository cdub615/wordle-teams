import { CatchBoundary } from '@tanstack/react-router'
import type { ReactNode } from 'react'
import { captureError } from '#/lib/sentry-capture.ts'

/**
 * The Challenges card's own error boundary (zic8.2.21 M5).
 *
 * WHY: routes/team.tsx's only boundary was the route's, DashboardError, so a
 * challengesForTeam failure replaced the whole page — member management,
 * scoring and the team list — for a section that is an extra. This stops it at
 * the card and says one line.
 *
 * TANSTACK ROUTER'S CatchBoundary, NOT A NEW DEPENDENCY OR A HAND-ROLLED CLASS.
 * The repo has no local boundary component; this is the one its route
 * boundaries already run on, and it takes a reset key, so a `?team=` switch
 * tries again instead of keeping the last team's error.
 *
 * REPORTED, because the route boundary's defaultOnCatch (router.tsx) used to
 * see these and no longer does.
 */
export function ChallengesBoundary({
  resetKey,
  children,
}: {
  /** The team. A new one clears a caught error and renders the children again. */
  resetKey: string
  children: ReactNode
}) {
  return (
    <CatchBoundary
      getResetKey={() => resetKey}
      onCatch={(error) => captureError(error, { boundary: 'challenges' })}
      errorComponent={ChallengesCardError}
    >
      {children}
    </CatchBoundary>
  )
}

/** ONE MUTED LINE AND NOTHING ELSE: no retry, and no error text to leak. */
function ChallengesCardError() {
  return <p className="text-muted-foreground text-sm">Challenges couldn't load.</p>
}
