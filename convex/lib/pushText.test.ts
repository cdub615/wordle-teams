import { describe, expect, test } from 'vitest'
import { ELLIPSIS, MAX_NOTIFIED_TEAM_NAME, clampTeamNameForPush } from './pushText.ts'

/**
 * The clamp itself. chatNotify.test.ts keeps its chatNotificationBody tests
 * UNCHANGED, which is what proves extracting this preserved the chat body;
 * these pin the shared rule directly, so a second caller can rely on it.
 */
describe('clampTeamNameForPush', () => {
  test('a name within the budget is returned untouched', () => {
    expect(clampTeamNameForPush('Wordle Wizards')).toBe('Wordle Wizards')
    const exact = 'x'.repeat(MAX_NOTIFIED_TEAM_NAME)
    expect(clampTeamNameForPush(exact)).toBe(exact)
  })

  test('one over the budget is cut to exactly the budget, ending in one ellipsis', () => {
    const clamped = clampTeamNameForPush('y'.repeat(MAX_NOTIFIED_TEAM_NAME + 1))
    expect(clamped).toBe(`${'y'.repeat(MAX_NOTIFIED_TEAM_NAME - 1)}${ELLIPSIS}`)
    expect([...clamped]).toHaveLength(MAX_NOTIFIED_TEAM_NAME)
  })

  test('counts and cuts code points, never splitting a surrogate pair', () => {
    const clamped = clampTeamNameForPush('🎉'.repeat(MAX_NOTIFIED_TEAM_NAME + 10))
    expect(clamped).toBe(`${'🎉'.repeat(MAX_NOTIFIED_TEAM_NAME - 1)}${ELLIPSIS}`)
  })

  test('trims trailing whitespace before the ellipsis', () => {
    const name = `${'a'.repeat(MAX_NOTIFIED_TEAM_NAME - 2)}  bcdef`
    expect(clampTeamNameForPush(name)).toBe(`${'a'.repeat(MAX_NOTIFIED_TEAM_NAME - 2)}${ELLIPSIS}`)
  })

  test('the ellipsis is the single character U+2026', () => {
    expect(ELLIPSIS).toBe('…')
  })
})
