import type { FunctionReturnType } from 'convex/server'
import type { api } from '../../../convex/_generated/api'
import type { ClueLadderCardPlay } from './card.tsx'

/**
 * Today's game as `api.clueLadder.today` returns it when the game is on. Taken
 * from the function's own return type, so the screens cannot drift from the
 * server, and without importing convex/clueLadder.ts, which reaches auth.ts.
 */
export type ClueLadderTodayView = Extract<FunctionReturnType<typeof api.clueLadder.today>, { enabled: true }>['play']

/** The dashboard card's four states (plan 2's ClueLadderCard). */
export function cardPlayOf(play: ClueLadderTodayView): ClueLadderCardPlay {
  switch (play.status) {
    case 'not-started':
      return { status: 'not-started' }
    case 'playing':
      return { status: 'playing', cluesRevealed: play.cluesRevealed }
    case 'solved':
      return { status: 'solved', lockedAtClue: play.lockedAtClue }
    case 'failed':
      return { status: 'failed' }
  }
}
