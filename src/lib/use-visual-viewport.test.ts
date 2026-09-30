import { describe, expect, test } from 'vitest'
import { readVisualViewport } from './use-visual-viewport'

describe('readVisualViewport', () => {
  test('prefers the visualViewport measurements when the API exists', () => {
    expect(
      readVisualViewport({ visualViewport: { height: 420, offsetTop: 96 }, innerHeight: 800 }),
    ).toEqual({ height: 420, offsetTop: 96 })
  })

  test('falls back to innerHeight when the API is missing', () => {
    // Older browsers. The sheet is still bounded and scrollable — degraded but
    // functional, never clipped-without-scroll.
    expect(readVisualViewport({ innerHeight: 800 })).toEqual({ height: 800, offsetTop: 0 })
  })

  test('is SSR-safe when there is no window at all', () => {
    expect(readVisualViewport(undefined)).toEqual({ height: 0, offsetTop: 0 })
  })
})
