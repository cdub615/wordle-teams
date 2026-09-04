// @vitest-environment jsdom
import { readFileSync } from 'node:fs'
import { describe, expect, test } from 'vitest'
import { SYSTEM_FIELDS, SYSTEM_FIELD_LABELS } from '../../convex/lib/scoringSystem.ts'

// A cwd-relative path, NOT `new URL(..., import.meta.url)` — this file
// declares `@vitest-environment jsdom` above, and under jsdom
// `import.meta.url` is not a `file:` URL, so readFileSync answers "The URL
// must be of scheme file". See dashboard-skeletons.hook.test.ts:181-187 for
// the reasoning; today-panel.hook.test.ts and scores-table.hook.test.ts both
// follow this same convention.
const source = readFileSync('src/components/scoring-legend.tsx', 'utf8')

describe('the legend is derived, never hand-listed', () => {
  // The reason scoringSystem.ts derives SYSTEM_FIELDS from DEFAULT_SYSTEM in
  // the first place: a hand-written list compiles perfectly after a ninth
  // scoring field is added and simply never surfaces it.
  test('order comes from SYSTEM_FIELDS and labels from SYSTEM_FIELD_LABELS', () => {
    expect(source).toContain("from '../../convex/lib/scoringSystem.ts'")
    expect(source).toContain('SYSTEM_FIELDS')
    expect(source).toContain('SYSTEM_FIELD_LABELS')
  })

  test('no label is spelled out in the component', () => {
    // "Missed day" is the one most likely to get retyped, and the design says
    // explicitly that it is NOT abbreviated.
    expect(source).not.toContain("'Missed day'")
    expect(SYSTEM_FIELD_LABELS.nA).toBe('Missed day')
  })

  test('it renders the team system, never DEFAULT_SYSTEM', () => {
    // A legend showing the defaults to a team that scores differently is worse
    // than no legend.
    expect(source).not.toContain('DEFAULT_SYSTEM')
  })

  test('the Edit affordance is gated on isOwner', () => {
    // Team mutations are creator-only and enforced server-side (7a 4), so
    // showing Edit to a member offers an action the server will refuse.
    expect(source).toContain('isOwner')
  })

  test('all eight fields are covered by the derived list', () => {
    expect(SYSTEM_FIELDS).toHaveLength(8)
  })
})
