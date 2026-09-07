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
    expect(incompleteTasks(nothing)).toEqual([
      { id: 'board', title: "Enter today's board", hint: 'About 10 seconds' },
      { id: 'team', title: 'Create a team', hint: 'Where scores get compared' },
      { id: 'invite', title: 'Invite someone', hint: 'A scoreboard needs someone to score against' },
    ])
  })
})

describe('shouldShowCard', () => {
  test('shows while any task is incomplete', () => {
    expect(shouldShowCard(nothing)).toBe(true)
  })

  test('retires when all three are complete', () => {
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
    expect(taskSetKey(incompleteTasks(nothing))).toBe('board,team,invite')
    expect(taskSetKey(incompleteTasks({ ...nothing, hasTeam: true }))).toBe('board,invite')
  })
})
