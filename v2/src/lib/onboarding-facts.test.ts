import { describe, expect, test } from 'vitest'
import { onboardingFactsFrom } from './onboarding-facts.ts'

const team = (over: Partial<{ members: unknown[]; hasPendingInvite: boolean }> = {}) => ({
  members: [{ id: 'p1' }],
  hasPendingInvite: false,
  ...over,
})

describe('onboardingFactsFrom', () => {
  test('no teams and no status means everything is outstanding', () => {
    expect(onboardingFactsFrom([], null)).toEqual({
      enteredBoard: false,
      hasTeam: false,
      hasInvited: false,
      dismissed: false,
    })
  })

  test('a solo team with no invite satisfies hasTeam only', () => {
    const facts = onboardingFactsFrom([team()], { enteredBoard: false, dismissed: false })
    expect(facts.hasTeam).toBe(true)
    expect(facts.hasInvited).toBe(false)
  })

  test('a second member satisfies hasInvited', () => {
    const facts = onboardingFactsFrom(
      [team({ members: [{ id: 'p1' }, { id: 'p2' }] })],
      { enteredBoard: false, dismissed: false },
    )
    expect(facts.hasInvited).toBe(true)
  })

  test('a pending invite satisfies hasInvited even on a solo team', () => {
    const facts = onboardingFactsFrom([team({ hasPendingInvite: true })], {
      enteredBoard: false,
      dismissed: false,
    })
    expect(facts.hasInvited).toBe(true)
  })

  test('hasInvited is global — any one team satisfying it is enough', () => {
    // Deliberate. The task is "be in a room with someone", and someone already
    // on a populated team should not be nagged after later making a solo one.
    //
    // BOTH ORDERS, AND THE SECOND IS THE ONE THAT DISCRIMINATES. With the
    // populated team first, a per-team check that only ever looked at teams[0]
    // returns true and this test passes while the rule is broken; only the
    // solo-first arrangement kills that mutant. Do not drop either line.
    const status = { enteredBoard: false, dismissed: false }
    const populated = team({ members: [{ id: 'p1' }, { id: 'p2' }] })
    expect(onboardingFactsFrom([populated, team()], status).hasInvited).toBe(true)
    expect(onboardingFactsFrom([team(), populated], status).hasInvited).toBe(true)
  })

  test('status flows straight through', () => {
    const facts = onboardingFactsFrom([], { enteredBoard: true, dismissed: true })
    expect(facts.enteredBoard).toBe(true)
    expect(facts.dismissed).toBe(true)
  })
})
