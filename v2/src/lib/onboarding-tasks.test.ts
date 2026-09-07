import { describe, expect, test } from 'vitest'
import {
  MODEL_LINE,
  cardHeading,
  incompleteTasks,
  shouldShowCard,
  taskSetKey,
  type OnboardingFacts,
} from './onboarding-tasks.ts'

/** Every fact false — a brand-new self-signup who has done nothing. */
const nothing: OnboardingFacts = {
  enteredBoard: false,
  hasTeam: false,
  hasInvited: false,
  dismissed: false,
}

describe('incompleteTasks', () => {
  test('an invited joiner owes only the board', () => {
    // completeProfileFor auto-joins them to a populated team, so create and
    // invite are both already satisfied on arrival. See convex/players.ts:226.
    const joiner: OnboardingFacts = { ...nothing, hasTeam: true, hasInvited: true }
    expect(incompleteTasks(joiner).map((t) => t.id)).toEqual(['board'])
  })

  test('the 456 shape — played, made a team of one — owes only the invite', () => {
    const soloTeam: OnboardingFacts = { ...nothing, enteredBoard: true, hasTeam: true }
    expect(incompleteTasks(soloTeam).map((t) => t.id)).toEqual(['invite'])
  })

  test('every task carries its copy, attached to the right id', () => {
    // TWO FIXTURES RATHER THAN ONE, because 'team' and 'invite' can no longer
    // appear together: one wants hasTeam false and the other wants it true.
    // All three copies are still asserted, which is what this test is for.
    expect(incompleteTasks(nothing)).toEqual([
      { id: 'board', title: "Enter today's board", hint: 'About 10 seconds' },
      { id: 'team', title: 'Create a team', hint: 'Where scores get compared' },
    ])
    expect(incompleteTasks({ ...nothing, hasTeam: true })).toEqual([
      { id: 'board', title: "Enter today's board", hint: 'About 10 seconds' },
      { id: 'invite', title: 'Invite someone', hint: 'A scoreboard needs someone to score against' },
    ])
  })

  test('the invite task needs a team first, because it has nowhere to point without one', () => {
    // THE DEAD END THIS PREVENTS, and the reason the gate is here rather than
    // in the route. Without `hasTeam &&`, a brand-new signup — the 87%
    // wordle-teams-456 is about — is shown a live "Invite someone" button that
    // fires onboarding_task_click and navigates to /team with no team id, and
    // routes/team.tsx redirects it straight back to /app. Nothing happens, and
    // the funnel gains a click that can never convert.
    //
    // NOT the precedence the header forbids: board and team remain independent
    // of each other and of this. This is "the action is impossible", not "do
    // this one second".
    expect(incompleteTasks(nothing).map((t) => t.id)).toEqual(['board', 'team'])
    expect(incompleteTasks(nothing).map((t) => t.id)).not.toContain('invite')

    // And it appears the moment a team exists — the gate defers the task, it
    // does not delete it.
    expect(incompleteTasks({ ...nothing, hasTeam: true }).map((t) => t.id)).toEqual([
      'board',
      'invite',
    ])
  })

  test('a card never shows more than two tasks, since team and invite are exclusive', () => {
    // Guards the claim incompleteTasks' own comment makes, over every one of
    // the eight fact combinations rather than the two spot-checked above.
    for (const enteredBoard of [false, true]) {
      for (const hasTeam of [false, true]) {
        for (const hasInvited of [false, true]) {
          const ids = incompleteTasks({ enteredBoard, hasTeam, hasInvited, dismissed: false }).map(
            (t) => t.id,
          )
          expect(ids.length).toBeLessThanOrEqual(2)
          expect(ids.includes('team') && ids.includes('invite')).toBe(false)
          // The invite task never reaches a player with no team, in ANY
          // combination — this is the assertion the dead end would trip.
          if (!hasTeam) expect(ids).not.toContain('invite')
        }
      }
    }
  })
})

describe('shouldShowCard', () => {
  test('shows while any task is incomplete', () => {
    expect(shouldShowCard(nothing)).toBe(true)
  })

  test('retires when every task is complete', () => {
    const done: OnboardingFacts = {
      enteredBoard: true,
      hasTeam: true,
      hasInvited: true,
      dismissed: false,
    }
    expect(shouldShowCard(done)).toBe(false)
  })

  test('a dismissal hides it even with work outstanding', () => {
    expect(shouldShowCard({ ...nothing, dismissed: true })).toBe(false)
  })
})

describe('cardHeading', () => {
  test('reads "Get started" while more than one task remains', () => {
    expect(cardHeading(nothing)).toBe('Get started')
  })

  test('reads "One more thing" on the last remaining task', () => {
    const soloTeam: OnboardingFacts = { ...nothing, enteredBoard: true, hasTeam: true }
    expect(cardHeading(soloTeam)).toBe('One more thing')
  })

  test('reads "Get started" when nothing remains at all', () => {
    const done: OnboardingFacts = { enteredBoard: true, hasTeam: true, hasInvited: true, dismissed: false }
    expect(cardHeading(done)).toBe('Get started')
  })
})

describe('MODEL_LINE', () => {
  // The scoring defaults (convex/fixtures.ts:34) run +5 for one guess down to
  // -3 for a failure — that's the illustration. The rule itself lives in
  // convex/lib/scoring.ts:119's winnerOf: a strict `>` while walking the list
  // in order, so the HIGHEST monthly total wins. An earlier draft of this
  // copy said "lowest", which would teach the wrong rule on the one screen
  // built to explain the model. Pinned so it cannot regress.
  test('says highest wins, never lowest', () => {
    expect(MODEL_LINE).toContain('Highest monthly total wins')
    expect(MODEL_LINE.toLowerCase()).not.toContain('lowest')
  })
})

describe('taskSetKey', () => {
  test('is stable for the same set and distinct across sets', () => {
    // 'board,team' rather than the 'board,team,invite' this once read: the
    // invite task now waits for a team. See the prerequisite test above.
    expect(taskSetKey(incompleteTasks(nothing))).toBe('board,team')
    expect(taskSetKey(incompleteTasks({ ...nothing, hasTeam: true }))).toBe('board,invite')
  })
})
