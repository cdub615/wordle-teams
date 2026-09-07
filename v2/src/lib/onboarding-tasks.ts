/**
 * Which onboarding tasks a player still owes, and the copy for each.
 *
 * PURE, AND SEPARATE FROM THE COMPONENT, following lib/celebration.ts: the
 * component's job is a subscription and some callbacks, while this is the set
 * of decisions that are actually worth asserting. Keeping them here means the
 * copy and the predicates are pinned by plain unit tests under the default
 * edge-runtime rather than only by the jsdom suite next door.
 *
 * THE THREE TASKS ARE INDEPENDENT AND CARRY NO PRECEDENCE. That is a product
 * decision taken 2026-09-07, not an oversight: there is no evidence for
 * whether playing first or inviting first converts better, and the funnel
 * events exist to answer it after launch. Do not "fix" this into a sequence.
 */

export type OnboardingTaskId = 'board' | 'team' | 'invite'

/**
 * The four booleans the card renders from.
 *
 * Deliberately primitives rather than Convex documents, so this module — and
 * its test — stay independent of codegen, matching lib/celebration.ts's
 * WinnerRow. Where each is sourced is the component's problem, not this one's.
 */
export type OnboardingFacts = {
  /** Has >=1 dailyScores row with NON-EMPTY guesses. See convex/onboarding.ts. */
  enteredBoard: boolean
  hasTeam: boolean
  /** On a team with another member, OR holding a pending invite. */
  hasInvited: boolean
  dismissed: boolean
}

export type OnboardingTask = {
  id: OnboardingTaskId
  title: string
  hint: string
}

/**
 * The model, stated in one line, because it is stated NOWHERE ELSE inside the
 * app. The Phase 7 landing page makes this pitch pre-signup; someone who
 * arrived by an invite link never saw it.
 *
 * "Highest", not "lowest". convex/fixtures.ts:34 gives +5 for a one-guess
 * solve down to -3 for a failure, so fewer guesses earns MORE — that's the
 * illustration, not the rule. The rule lives in convex/lib/scoring.ts:119's
 * winnerOf, whose doc comment states a strict `>` while walking the list in
 * order, so the BIGGEST monthly total wins. Cite scoring.ts, not the fixture,
 * if the scoring numbers ever change — the fixture only supplies concrete
 * values.
 * Pinned by test.
 */
export const MODEL_LINE =
  'Everyone plays their own Wordle. Fewer guesses scores more points. Highest monthly total wins.'

const TASK_COPY: Record<OnboardingTaskId, { title: string; hint: string }> = {
  board: { title: "Enter today's board", hint: 'About 10 seconds' },
  team: { title: 'Create a team', hint: 'Where scores get compared' },
  invite: { title: 'Invite someone', hint: 'A scoreboard needs someone to score against' },
}

/**
 * The tasks still outstanding, in a FIXED order.
 *
 * Fixed order is presentation, not precedence — the list must not reshuffle
 * under the reader's finger as tasks complete, and a stable order is also what
 * makes taskSetKey below a usable dedupe key.
 */
export function incompleteTasks(facts: OnboardingFacts): OnboardingTask[] {
  const ids: OnboardingTaskId[] = []
  if (!facts.enteredBoard) ids.push('board')
  if (!facts.hasTeam) ids.push('team')
  if (!facts.hasInvited) ids.push('invite')
  return ids.map((id) => ({ id, ...TASK_COPY[id] }))
}

export function shouldShowCard(facts: OnboardingFacts): boolean {
  return !facts.dismissed && incompleteTasks(facts).length > 0
}

export function cardHeading(facts: OnboardingFacts): string {
  return incompleteTasks(facts).length === 1 ? 'One more thing' : 'Get started'
}

/**
 * A stable key for one task set, for funnel dedupe.
 *
 * The card renders from a reactive query, so without a key onboarding_view
 * would emit on every invalidation and drown the channel. See
 * src/components/onboarding/next-step-card.tsx.
 *
 * RETURNS '' FOR AN EMPTY SET, which collides with the empty-string sentinel a
 * useRef dedupe would naturally start from. Not reachable through the card
 * today — shouldShowCard is false at zero tasks, so it never renders — but a
 * caller that compares against '' to mean "not yet emitted" would silently
 * suppress a genuine all-complete emission. Compare against a separate "seen"
 * flag, not against ''.
 */
export function taskSetKey(tasks: OnboardingTask[]): string {
  return tasks.map((task) => task.id).join(',')
}
