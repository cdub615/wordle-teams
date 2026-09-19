import { readFileSync, readdirSync } from 'node:fs'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, test } from 'vitest'
import { runtimeImportsOf } from './test-support/source-ast'

/**
 * ONE CALLER OF useStartUpgrade, WHICH IS THE WHOLE OF wordle-teams-iht.1.
 *
 * That issue was six affordances reaching Polar's checkout with nothing said
 * about what Pro is. The fix routes all six through components/upgrade-dialog.tsx
 * — and the fix is worth only as much as the guarantee that a SEVENTH cannot be
 * added the old way. It could: a new button calling useStartUpgrade() compiles,
 * lints, builds and passes every behavioural test in this repo, because each of
 * those renders one component and none can see the set of callers.
 *
 * ASSERTED OVER THE IMPORT GRAPH, NOT THE TEXT. `runtimeImportsOf` is the same
 * AST helper frontend-import-graph.test.ts walks with: it ignores type-only
 * imports and, more to the point here, ignores prose. Several files DISCUSS
 * this hook in their banners — components/Header.hook.test.ts, routes/app.tsx
 * and components/insights/team-locked-card.tsx all name it while importing
 * nothing of the sort — and a `toMatch(/use-start-upgrade/)` over raw source
 * would fail on every one of them.
 *
 * THE WALKER BELOW IS A COPY, AND THE COUNT IS NOT THE ONE AN EARLIER DRAFT OF
 * THIS COMMENT CLAIMED. It said "a third copy of the one in styles.test.ts and
 * frontend-import-graph.test.ts"; counted rather than assumed, this repo has
 * FIVE directory walkers already — src/frontend-import-graph.test.ts,
 * src/styles.test.ts (`componentFiles`, .tsx only), src/lib/insights-corpus.test.ts
 * (an IIFE over URLs), convex/lib/insightsAccess.test.ts (skipping node_modules
 * and _generated) and convex/pushableModules.test.ts (imperative) — so this is
 * the sixth. Only ONE of the five is this exact body: frontend-import-graph's.
 *
 * Left as a copy anyway, for the reason the count does not change: five lines
 * against a shared helper that would make two suites share a dependency for a
 * directory listing, and the other four have already diverged in what they
 * filter, which is what a shared helper would have had to grow options for.
 * That divergence is the argument, not the tally — so consolidating is worth
 * doing when two of them want the SAME filter, not when a seventh appears.
 */
const SRC = fileURLToPath(new URL('.', import.meta.url))

function sourceFiles(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const path = join(dir, entry.name)
    if (entry.isDirectory()) return sourceFiles(path)
    return entry.name.endsWith('.ts') || entry.name.endsWith('.tsx') ? [path] : []
  })
}

describe('checkout has exactly one entry point', () => {
  /**
   * WHAT IS EXCLUDED, AND WHAT DELIBERATELY IS NOT.
   *
   * `.test.ts` IS EXCLUDED BECAUSE TWO SUITES MUST IMPORT THE HOOK.
   * src/lib/use-start-upgrade.hook.test.ts imports it to test it, and
   * src/components/upgrade-dialog.hook.test.ts names it to mock it. Neither
   * ships anywhere, so neither can be the seventh affordance this guards
   * against, and forbidding them would forbid testing the hook at all.
   *
   * IT EXCLUDES ONLY `.test.ts` — NOT `.test.tsx`, which is not an oversight.
   * vitest.config.ts's include glob reaches `.test.ts` under src/ and nothing
   * else, so a `.test.tsx` is not collected as a suite at all; the repo has
   * none today (verified: zero matches). If one ever appears it lands in the
   * importer list and fails LOUDLY, which is the right direction for a file
   * that would be dead test code importing the checkout hook.
   *
   * THE HOOK'S OWN FILE IS EXCLUDED AND THE EXCLUSION IS INERT TODAY —
   * lib/use-start-upgrade.ts imports six modules and none of them is itself.
   * Kept because the alternative is a reader wondering whether a
   * self-referential export was the thing that broke it.
   *
   * THE RESIDUAL GAP IS A RE-EXPORT. If upgrade-dialog.tsx ever wrote
   * `export { useStartUpgrade } from '#/lib/use-start-upgrade.ts'`, a component
   * could import the hook through the dialog module and this would still see
   * one importer. Nothing does that, and the dialog exports a provider and a
   * `useUpgrade` context hook rather than re-exporting anything; stated so the
   * hole is known rather than discovered.
   */
  test('only the upgrade dialog imports use-start-upgrade', () => {
    const importers = sourceFiles(SRC)
      .filter((path) => !path.endsWith('.test.ts') && !path.endsWith('use-start-upgrade.ts'))
      .filter((path) =>
        runtimeImportsOf(path, readFileSync(path, 'utf8')).some((specifier) =>
          specifier.includes('use-start-upgrade'),
        ),
      )
      // Separators normalised the way frontend-import-graph.test.ts's `show`
      // does it, so the expected string is one spelling rather than the host's.
      .map((path) => path.slice(SRC.length).replaceAll('\\', '/'))

    expect(importers).toEqual(['components/upgrade-dialog.tsx'])
  })

  /**
   * THE LIST ABOVE IS REAL, WHICH `toEqual` ON IT CANNOT TELL YOU.
   *
   * frontend-import-graph.test.ts's argument, one assertion narrower. Regress
   * `sourceFiles` to `[]` and the test above does not go green — it goes red on
   * an empty array, which is the one way this shape of test is luckier than its
   * sibling. But regress the SECOND filter, so that `specifier.includes` never
   * matches, and it fails the same way; the two failures are indistinguishable,
   * and only one of them means what the file says it means.
   *
   * So this pins the walk itself: the root set contains files the filter threw
   * away, and it contains the hook's own module. Containment, never a count —
   * a number here would be wrong the next time a component is added.
   */
  test('and the walk that produced it actually covered src/', () => {
    const roots = sourceFiles(SRC)
    expect(roots).toContain(join(SRC, 'lib/use-start-upgrade.ts'))
    expect(roots).toContain(join(SRC, 'lib/use-start-upgrade.hook.test.ts'))
    expect(roots).toContain(join(SRC, 'components/upgrade-dialog.tsx'))
  })
})
