// @vitest-environment jsdom
import { readFileSync } from 'node:fs'
import { describe, expect, test } from 'vitest'
import { codeOf } from '#/test-support/source-ast.ts'
import { SYSTEM_FIELDS, SYSTEM_FIELD_LABELS } from '../../convex/lib/scoringSystem.ts'

// A cwd-relative path, NOT `new URL(..., import.meta.url)` — this file
// declares `@vitest-environment jsdom` above, and under jsdom
// `import.meta.url` is not a `file:` URL, so readFileSync answers "The URL
// must be of scheme file". See dashboard-skeletons.hook.test.ts:181-187 for
// the reasoning; today-panel.hook.test.ts and scores-table.hook.test.ts both
// follow this same convention.
const source = readFileSync('src/components/scoring-legend.tsx', 'utf8')

// Comments stripped, per source-ast.ts's own docstring: "Files ... are mostly
// prose explaining why they exist, and that prose quotes the very literals
// being pinned — a match inside it would prove nothing." Used only for the
// two NEGATIVE assertions below. The positive assertions stay on raw
// `source`: removing the import line or an identifier the component actually
// uses (SYSTEM_FIELDS, SYSTEM_FIELD_LABELS, isOwner) would break the
// component and typecheck, so there is no file where those sit ONLY in a
// comment — the risk `codeOf` guards against runs the other way, and a
// negative assertion is exactly where an author explaining a decision in
// prose (naming the very thing being ruled out) can otherwise trip a blunt
// `not.toContain`.
const code = codeOf(source)

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
    // explicitly that it is NOT abbreviated. Comment-stripped so prose that
    // merely discusses "Missed day" cannot satisfy this.
    expect(code).not.toContain("'Missed day'")
    expect(SYSTEM_FIELD_LABELS.nA).toBe('Missed day')
  })

  test('it renders the team system, never DEFAULT_SYSTEM', () => {
    // A legend showing the defaults to a team that scores differently is worse
    // than no legend. Comment-stripped, so the component's own header comment
    // can name DEFAULT_SYSTEM directly to explain why it is not used, without
    // tripping this.
    expect(code).not.toContain('DEFAULT_SYSTEM')
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
