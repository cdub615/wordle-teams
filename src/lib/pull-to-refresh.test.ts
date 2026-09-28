import { describe, expect, test } from 'vitest'
import {
  PULL_MAX_PX,
  PULL_TRIGGER_PX,
  SCROLL_CONTAINER_SELECTOR,
  canArmPull,
  computePull,
  startedInsideScrollContainer,
} from './pull-to-refresh.ts'

describe('startedInsideScrollContainer', () => {
  test('a touch starting inside a marked scroll container is excluded', () => {
    const target = { closest: (selector: string) => (selector === SCROLL_CONTAINER_SELECTOR ? {} : null) }
    expect(startedInsideScrollContainer(target)).toBe(true)
  })

  test('a touch starting outside any marked container is not excluded', () => {
    const target = { closest: () => null }
    expect(startedInsideScrollContainer(target)).toBe(false)
  })

  // Defensive: event.target is typed as EventTarget | null and touch events
  // can in principle carry a target this module cannot call closest() on.
  // Treated as "not inside a container" rather than throwing.
  test('no target at all does not throw and is not excluded', () => {
    expect(startedInsideScrollContainer(null)).toBe(false)
  })
})

describe('canArmPull', () => {
  const base = { isStandalone: true, scrollTop: 0, startedInExcludedContainer: false }

  test('arms in standalone, at the top, outside every excluded container', () => {
    expect(canArmPull(base)).toBe(true)
  })

  // Kills `if (!isStandalone) return false` -> dropped or inverted. This is
  // constraint 1: a second pull-to-refresh in an ordinary browser tab is a
  // bug, not a feature.
  test('never arms outside standalone, even at the top with nothing excluded', () => {
    expect(canArmPull({ ...base, isStandalone: false })).toBe(false)
  })

  // Kills `if (startedInExcludedContainer) return false` -> dropped or
  // inverted. This is constraint 2: a touch starting inside the scores
  // table's x-axis scroller, the TeamBoards carousel, or the settings
  // dialog must never arm the gesture, however this boolean was computed.
  test('never arms when the touch started inside an excluded scroll container', () => {
    expect(canArmPull({ ...base, startedInExcludedContainer: true })).toBe(false)
  })

  test('arms exactly at scrollTop 0', () => {
    expect(canArmPull({ ...base, scrollTop: 0 })).toBe(true)
  })

  // iOS's own elastic bounce can report a momentarily negative scrollY at
  // the top of the page. Kills `scrollTop <= 0` -> `scrollTop < 0` (which
  // would reject exactly 0, tested above) and also proves small negative
  // readings still count as "at the top".
  test('arms during a momentary negative scrollY from the platform bounce', () => {
    expect(canArmPull({ ...base, scrollTop: -0.5 })).toBe(true)
  })

  // Kills `scrollTop <= 0` -> `scrollTop === 0` (which would also arm here,
  // wrongly) and -> `scrollTop >= 0` (which would arm at any positive
  // scrollTop too).
  test('does not arm once the page is scrolled down even slightly', () => {
    expect(canArmPull({ ...base, scrollTop: 1 })).toBe(false)
  })
})

describe('computePull', () => {
  test('no movement is no distance and not triggered', () => {
    expect(computePull(0)).toEqual({ distance: 0, triggered: false })
  })

  // Kills `Math.max(0, rawDeltaY)` removed: an upward move must clamp to 0,
  // not go negative.
  test('an upward move clamps to zero rather than going negative', () => {
    expect(computePull(-40)).toEqual({ distance: 0, triggered: false })
  })

  // Resistance is 0.5, so a 128px pull reads as exactly 64px of distance,
  // which is PULL_TRIGGER_PX. Pins the resistance multiplier itself: change
  // 0.5 to 1 and this becomes 128, changing it to 0.25 makes it 32.
  test('resistance halves the raw movement', () => {
    const result = computePull(128)
    expect(result.distance).toBe(64)
    expect(result.distance).toBe(PULL_TRIGGER_PX)
  })

  // The exact-boundary case for `triggered`. Kills `>=` -> `>`, which would
  // make landing exactly on the threshold NOT trigger.
  test('landing exactly on the threshold triggers', () => {
    const rawAtThreshold = PULL_TRIGGER_PX / 0.5
    expect(computePull(rawAtThreshold).triggered).toBe(true)
  })

  // One raw px short of the threshold. Kills `>=` -> `<=` (which would
  // trigger on every non-zero pull) and confirms the boundary is not off by
  // a full pixel of distance in either direction.
  test('one pixel short of the threshold does not trigger', () => {
    const rawJustBelow = PULL_TRIGGER_PX / 0.5 - 2 // -2 raw px = -1 distance px
    const result = computePull(rawJustBelow)
    expect(result.distance).toBe(PULL_TRIGGER_PX - 1)
    expect(result.triggered).toBe(false)
  })

  // Kills `Math.min(PULL_MAX_PX, ...)` removed: a long, fast pull must not
  // fling the indicator past its travel cap.
  test('a pull far past the threshold is capped at PULL_MAX_PX, not left to grow', () => {
    const result = computePull(10_000)
    expect(result.distance).toBe(PULL_MAX_PX)
    expect(result.triggered).toBe(true)
  })

  // The cap and the trigger are independent: reaching the cap must not be
  // read as the ONLY way to trigger, and must still be well past the
  // threshold rather than landing suspiciously close to it (which would hint
  // the two constants collapsed into one by a mutation).
  test('the cap sits strictly above the trigger threshold', () => {
    expect(PULL_MAX_PX).toBeGreaterThan(PULL_TRIGGER_PX)
  })
})
