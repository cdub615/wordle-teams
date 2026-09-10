import { describe, expect, test } from 'vitest'
import {
  INSIGHTS_TRIAL_DAYS,
  LAUNCH_AT,
  LAUNCH_AT_IS_PLACEHOLDER,
  insightsAccess,
  shouldStartTrial,
  trialEndsAtFor,
} from './insightsAccess.ts'

const DAY = 86_400_000
const LAUNCH = Date.UTC(2026, 8, 20) // a real-looking launch, for the rule's tests

describe('LAUNCH_AT', () => {
  test('is still the obvious placeholder, and says so', () => {
    // This test is expected to CHANGE when the owner sets the real cutover
    // instant. It exists so that setting it is a deliberate edit with a failing
    // test pointing at it, rather than something that drifts in unnoticed.
    expect(LAUNCH_AT_IS_PLACEHOLDER).toBe(true)
    expect(new Date(LAUNCH_AT).getUTCFullYear()).toBe(2099)
  })

  test('fails safe: while it is the placeholder, no board can start a trial', () => {
    // The whole reason the placeholder is in the future rather than the past.
    // Nobody gets a trial by accident before the owner sets the date.
    for (const enteredAt of [Date.now(), Date.UTC(2026, 11, 25), Date.UTC(2030, 0, 1)]) {
      expect(shouldStartTrial({ trialEndsAt: undefined, enteredAt })).toBe(false)
    }
  })
})

describe('shouldStartTrial', () => {
  test('a board entered after launch starts the clock', () => {
    expect(
      shouldStartTrial({ trialEndsAt: undefined, enteredAt: LAUNCH + DAY, launchAt: LAUNCH }),
    ).toBe(true)
  })

  test('a board entered exactly at launch starts it', () => {
    expect(shouldStartTrial({ trialEndsAt: undefined, enteredAt: LAUNCH, launchAt: LAUNCH })).toBe(
      true,
    )
  })

  // The first of the two opposite directions the rule is entirely about.
  test('a board entered BEFORE launch does not', () => {
    expect(
      shouldStartTrial({ trialEndsAt: undefined, enteredAt: LAUNCH - 1, launchAt: LAUNCH }),
    ).toBe(false)
    expect(
      shouldStartTrial({ trialEndsAt: undefined, enteredAt: LAUNCH - 400 * DAY, launchAt: LAUNCH }),
    ).toBe(false)
  })

  // The second. A player already holding a clock never gets another.
  test('a second board does not re-stamp, so the trial cannot be extended', () => {
    const running = LAUNCH + 10 * DAY
    expect(
      shouldStartTrial({ trialEndsAt: running, enteredAt: LAUNCH + DAY, launchAt: LAUNCH }),
    ).toBe(false)
  })

  test('not even after the trial has already expired', () => {
    // Otherwise a lapsed player entering a board would silently get a second
    // free month, and every month after that.
    const expired = LAUNCH - 100 * DAY
    expect(
      shouldStartTrial({ trialEndsAt: expired, enteredAt: LAUNCH + DAY, launchAt: LAUNCH }),
    ).toBe(false)
  })
})

describe('trialEndsAtFor', () => {
  test('runs one month from the board that started it', () => {
    expect(trialEndsAtFor(LAUNCH)).toBe(LAUNCH + INSIGHTS_TRIAL_DAYS * DAY)
    expect(INSIGHTS_TRIAL_DAYS).toBe(30)
  })
})

describe('insightsAccess', () => {
  const free = { isPro: false, trialEndsAt: undefined, now: LAUNCH }

  test('a free player with no trial still sees Layers 1 and 3', () => {
    // The shape that protects the spec's hard constraint: nothing previously
    // free moves behind the paywall, and a free player always has something.
    const access = insightsAccess(free)
    expect(access.layer1).toBe('free')
    expect(access.layer3).toBe('free')
    expect(access.layer2).toBe('none')
    expect(access.layer4).toBe('none')
    expect(access.trialActive).toBe(false)
    expect(access.trialEndsAt).toBeNull()
  })

  test('pro sees everything in full', () => {
    const access = insightsAccess({ ...free, isPro: true })
    expect(access).toMatchObject({
      layer1: 'full',
      layer2: 'full',
      layer3: 'full',
      layer4: 'full',
      trialActive: false,
    })
  })

  test('a running trial grants Layers 2 and 3, and deliberately not 1 or 4', () => {
    // The spec says "one month of Layers 2 and 3" and this is that read taken
    // literally. If the owner wants the trial to include Layer 1's full history,
    // this expectation is the thing that should change first.
    const access = insightsAccess({ ...free, trialEndsAt: LAUNCH + DAY })
    expect(access.layer2).toBe('full')
    expect(access.layer3).toBe('full')
    expect(access.layer1).toBe('free')
    expect(access.layer4).toBe('none')
    expect(access.trialActive).toBe(true)
    expect(access.trialEndsAt).toBe(LAUNCH + DAY)
  })

  // Both sides of the boundary, because a threshold tested one way is vacuous.
  test('the trial is live one millisecond before it ends', () => {
    const access = insightsAccess({ ...free, trialEndsAt: LAUNCH + 1 })
    expect(access.trialActive).toBe(true)
    expect(access.layer2).toBe('full')
  })

  test('and over at the instant it ends', () => {
    const access = insightsAccess({ ...free, trialEndsAt: LAUNCH })
    expect(access.trialActive).toBe(false)
    expect(access.layer2).toBe('none')
    expect(access.trialEndsAt).toBeNull()
  })

  test('an expired trial takes nothing away from the free tier', () => {
    const access = insightsAccess({ ...free, trialEndsAt: LAUNCH - 400 * DAY })
    expect(access.layer1).toBe('free')
    expect(access.layer3).toBe('free')
  })

  test('pro outranks an expired trial', () => {
    const access = insightsAccess({ isPro: true, trialEndsAt: LAUNCH - DAY, now: LAUNCH })
    expect(access.layer2).toBe('full')
    expect(access.trialActive).toBe(false)
  })
})

describe('trialExpired — the distinction a prompt cannot be written without', () => {
  // THE WHOLE POINT OF THIS FIELD. Before it, a player whose trial ended and a
  // player who never had one were indistinguishable: both got
  // trialActive:false, trialEndsAt:null. A prompt built on that would either
  // stay silent for the person it is for, or nag someone who never had a trial.
  test('a trial that has ended reads as expired', () => {
    const access = insightsAccess({ isPro: false, trialEndsAt: 1_000, now: 2_000 })
    expect(access.trialActive).toBe(false)
    expect(access.trialExpired).toBe(true)
  })

  test('never having had a trial is NOT expired', () => {
    const access = insightsAccess({ isPro: false, trialEndsAt: undefined, now: 2_000 })
    expect(access.trialActive).toBe(false)
    expect(access.trialExpired).toBe(false)
  })

  test('a running trial is neither active-and-expired nor expired', () => {
    const access = insightsAccess({ isPro: false, trialEndsAt: 3_000, now: 2_000 })
    expect(access.trialActive).toBe(true)
    expect(access.trialExpired).toBe(false)
  })

  // Strictly after, matching trialActive's own boundary rule, and tested on both
  // sides because a threshold tested in one direction is vacuous.
  test('the instant it ends, it is expired and not active', () => {
    const access = insightsAccess({ isPro: false, trialEndsAt: 2_000, now: 2_000 })
    expect(access.trialActive).toBe(false)
    expect(access.trialExpired).toBe(true)
  })

  // A PRO PLAYER IS NOT SHOWN AN UPGRADE PROMPT, even though their trial did
  // technically end. This is the field's one non-obvious rule and it is why the
  // prompt can render straight from it without a second condition.
  test('a pro player whose trial ended is not expired, because they upgraded', () => {
    const access = insightsAccess({ isPro: true, trialEndsAt: 1_000, now: 2_000 })
    expect(access.trialExpired).toBe(false)
  })
})
