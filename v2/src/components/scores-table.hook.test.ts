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
// `URL` imported explicitly from node:url, NOT the global: under
// `@vitest-environment jsdom` the global `URL` is jsdom's own implementation,
// and `new URL('./scores-table.tsx', import.meta.url)` silently resolves
// against jsdom's `window.location` (http://localhost:3000/...) instead of
// the `file:` base actually passed in — readFileSync then throws "The URL
// must be of scheme file". Node's own URL class resolves the base correctly.
import { URL as NodeURL } from 'node:url'
import { describe, expect, test } from 'vitest'

const source = readFileSync(new NodeURL('./scores-table.tsx', import.meta.url), 'utf8')

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
