// @vitest-environment jsdom
//
// jsdom for the same reason dashboard-skeletons.hook.test.ts uses it, and
// `.test.ts` not `.test.tsx` because vitest.config.ts's glob is
// `src/**/*.test.ts` — elements go through createElement by hand.
//
// WHY THIS FILE EXISTS: the four changes in this task are all invisible to the
// other gates. Dropping the self-highlight, the today tint, the name cap or the
// rank all type-check, lint, build and pass every other test — the table just
// silently stops answering the question it was changed to answer.
import { readFileSync } from 'node:fs'
import { describe, expect, test } from 'vitest'

// A cwd-relative path, NOT `new URL(..., import.meta.url)` — see
// dashboard-skeletons.hook.test.ts's comment on the same line for why: this
// file is also jsdom, and jsdom breaks that resolution the same way there.
const source = readFileSync('src/components/scores-table.tsx', 'utf8')

describe('the additive changes are present and are not decorative', () => {
  test('the name column is capped, so one long name cannot steal the day columns', () => {
    // The latent bug this fixes: `md:w-max` with no maximum let a single long
    // name widen the pinned column and squeeze every day column beside it.
    expect(source).toMatch(/max-w-\[/)
    expect(source).not.toMatch(/md:w-max md:pr-px/)
  })

  test('the full name survives as a title attribute when it is ellipsed', () => {
    expect(source).toMatch(/title=/)
  })

  test('the collision rule is imported, not restated', () => {
    // The panel and the table must call the same person the same thing. A
    // second inline copy of this rule is how they drift apart.
    expect(source).toContain("from '#/lib/display-names.ts'")
    expect(source).not.toContain('duplicateFirstNames')
  })

  test('rank comes from rankWithTies, not from a map index', () => {
    expect(source).toContain("from '#/lib/standings.ts'")
    expect(source).toContain('rankWithTies(')
    // An index+1 rank would be dense-ranked and would contradict the decided
    // tie rule without any test noticing.
    expect(source).not.toMatch(/rank[^\n]*index \+ 1/)
  })
})
