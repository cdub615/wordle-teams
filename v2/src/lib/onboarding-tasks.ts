/**
 * Which onboarding tasks a player still owes, and the copy for each.
 *
 * PURE, AND SEPARATE FROM THE COMPONENT, following lib/celebration.ts: the
 * component's job is a subscription and some callbacks, while this is the set
 * of decisions that are actually worth asserting. Keeping them here means the
 * copy and the predicates are pinned by plain unit tests under the default
 * edge-runtime rather than only by the jsdom suite next door.
 *
 * BOARD AND TEAM ARE INDEPENDENT AND CARRY NO PRECEDENCE. That is a product
 * decision taken 2026-09-07, not an oversight: there is no evidence for
 * whether playing first or making a team first converts better, and the funnel
 * events exist to answer it after launch. Do not "fix" this into a sequence.
 *
 * INVITE IS THE ONE EXCEPTION, AND IT IS A PREREQUISITE RATHER THAN AN
 * ORDERING. You cannot invite someone to nothing: with no team there is no
 * room to invite them into, and /team — where the invite dialog lives —
 * redirects straight back to /app for a player with no teams (routes/team.tsx).
 * So an invite task shown to a team-less player is a CTA that cannot do
 * anything, on the exact screen wordle-teams-456 says signups already stall
 * on, and the onboarding_task_click it fires can never convert — which also
 * poisons the denominator this epic is measured by. See incompleteTasks.
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
 *
 * `hasTeam &&` ON THE INVITE IS THE PREREQUISITE THE HEADER DESCRIBES, and it
 * is the one gate here that is not simply "is this fact false". The other two
 * are independently actionable by a player who has nothing: anyone can enter a
 * board (boards are player-owned — upsertBoard takes no teamId), and anyone can
 * create a team. Inviting is not, because the invite needs somewhere to point.
 *
 * A CONSEQUENCE WORTH KNOWING: 'team' and 'invite' are now mutually exclusive —
 * one needs hasTeam false and the other needs it true — so this returns at most
 * TWO tasks, never three. cardHeading's "One more thing" therefore triggers at
 * one remaining as before, but the largest set a card can show is two.
 */
export function incompleteTasks(facts: OnboardingFacts): OnboardingTask[] {
  const ids: OnboardingTaskId[] = []
  if (!facts.enteredBoard) ids.push('board')
  if (!facts.hasTeam) ids.push('team')
  if (facts.hasTeam && !facts.hasInvited) ids.push('invite')
  return ids.map((id) => ({ id, ...TASK_COPY[id] }))
}

export function shouldShowCard(facts: OnboardingFacts): boolean {
  // TWO STATES NOW, NOT ONE. This used to also require an outstanding task,
  // which is why the card vanished the moment onboarding finished. It renders
  // the checklist while tasks remain and the graduation nudge afterwards, so
  // the only thing that silences it is the dismissal.
  return !facts.dismissed
}

/**
 * Whether the card should show the graduation state — the nudge toward
 * insights that replaces the nothing this card used to render once onboarding
 * finished.
 *
 * IT IS THE SAME CARD AND THE SAME DISMISSAL, deliberately. A second
 * dismissible thing on /app would need its own flag, its own server field and
 * its own migration; reusing `dismissed` means a player who dismisses the
 * checklist never sees the nudge either, which is the correct reading of that
 * gesture — they have told us they do not want this card.
 *
 * WHY INSIGHTS IS THE RIGHT DESTINATION and not, say, an invite nudge: a
 * player who has reached this state HAS a team, HAS invited someone and HAS
 * entered a board. The next thing that makes the app worth reopening is what
 * their boards say about how they play — and on /app nothing points there that
 * this player is sure to see. The app-menu item (app-menu.tsx) is behind
 * opening the dropdown, and today-panel.tsx's header link takes the slot only
 * once the player has entered TODAY'S board, which graduating does not require:
 * `enteredBoard` counts any board ever. Stated as that rule rather than as a
 * count of `to="/insights"` call sites, because the count is what went stale
 * here the first time (wordle-teams-wty4.1.15).
 *
 * FREE PLAYERS GET SOMETHING REAL HERE, which is what makes this honest rather
 * than an upsell: Layer 1's benchmark on their most recent board and one team
 * fact a day are free (convex/lib/insightsAccess.ts). This card does not
 * mention Pro. See GRADUATION_BODY for what those two free slices actually
 * say, which is NOT what the first draft of that sentence promised.
 */
export function shouldShowGraduation(facts: OnboardingFacts): boolean {
  return !facts.dismissed && incompleteTasks(facts).length === 0
}

/**
 * The graduation copy, pinned the way MODEL_LINE is and for the same reason:
 * it is a claim about the product, and the gates cannot read prose.
 *
 * EVERY CLAIM HERE IS TRUE ON THE FREE TIER, WHICH IS THE CONSTRAINT THAT
 * WROTE IT. The card is shown to a player who has just finished setting up and
 * has paid nothing, and LAUNCH_AT is still the 2099 placeholder
 * (convex/lib/insightsAccess.ts), so NO trial is running for anybody — free is
 * what a graduating player gets, not a lesser branch of it. What that tier
 * actually holds is two things:
 *
 *   layer1: 'free'  their MOST RECENT board, benchmarked — the opening word's
 *                   rank among the 14,855 scored openers, plus the day's
 *                   difficulty (components/insights/board-row.tsx).
 *   layer3: 'free'  ONE fact about today: "You beat 3 of 5 teammates who have
 *                   played today" (components/insights/daily-team-fact.tsx).
 *
 * THE PLAN'S DRAFTED BODY OVERSTATED BOTH HALVES AND WAS REWRITTEN. It read
 * "See how your guesses compare with everyone else's, and where you are gaining
 * on your team."
 *
 *   - "compare with everyone else's" is not what Layer 1 is. The opener corpus
 *     is SIMULATED against a fixed answer pool (scripts/build-insights-corpus.mjs
 *     measured two releases seven weeks apart with not one of the 14,855 ranks
 *     moving) — it ranks words, not other players' guesses. Nothing on the page
 *     compares a free player against the wider playerbase.
 *   - "where you are gaining on your team" is a TREND claim, and trends are the
 *     paid surface. Free gets today's standing and nothing historical; the
 *     improvement and averages panels are gated on hasFullTeamMonth. A free
 *     player following that sentence would find the thing it promised behind a
 *     paywall, on a card whose entire justification is that it is not an upsell.
 *
 * What is below claims only the two slices above, and nothing beyond them.
 */
export const GRADUATION_TITLE = 'You are all set up'
export const GRADUATION_BODY =
  'See where your opening word ranks, and how you did against your team today.'
export const GRADUATION_CTA = 'See your insights'

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
 * useRef dedupe would naturally start from. THE CARD NOW RENDERS AT ZERO TASKS
 * — shouldShowCard stopped gating on the task count when the graduation state
 * arrived — so that empty key is reachable from the component for the first
 * time, and it is exactly the key the card must NOT emit an onboarding_view
 * for: every activated player mounts that state on every /app load. The guard
 * is in next-step-card.tsx's view effect and is a `tasks.length > 0` test
 * rather than a comparison against this string, on purpose. A caller that
 * compares against '' to mean "not yet emitted" would silently suppress a
 * genuine all-complete emission. Compare against a separate "seen" flag, not
 * against ''.
 */
export function taskSetKey(tasks: OnboardingTask[]): string {
  return tasks.map((task) => task.id).join(',')
}
