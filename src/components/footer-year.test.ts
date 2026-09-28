import { describe, expect, test, vi } from 'vitest'

/**
 * THE FOOTER'S COPYRIGHT YEAR IS A BUILD CONSTANT, NOT A CLOCK READ
 * (wordle-teams-56ag).
 *
 * WHY THIS NEEDS A TEST AT ALL. Footer.tsx used to call
 * `new Date().getFullYear()` during render, and __root.tsx renders the footer on
 * every path `hidesSiteFooter` does not exclude — which is every document in
 * cache-policy.ts's STATIC_DOCUMENTS. The clock was read during SSR and again
 * during hydration, so a load straddling midnight on 31 December gets a
 * different year on each side: a React #418 in production, on every static page
 * at once, for an annual window nobody is awake for.
 *
 * SO THE ASSERTION IS THE ABSENCE OF A CLOCK, AND IT IS SPIED RATHER THAN
 * GREPPED. `not.toMatch(/new Date/)` over the source could only see a clock
 * written in THIS file, where a spy sees one wherever the call ends up —
 * including inside a helper the footer imports later. That choice is not mine:
 * components/pricing/tier-table.hook.test.ts made it first, after a render-level
 * probe disproved an earlier claim that the source was the only way to see it,
 * and this file follows it deliberately.
 *
 * HOW A CLOCK READ ACTUALLY FAILS HERE, because it is not the assertion you
 * would expect and the next reader deserves the real message. `vi.spyOn(globalThis,
 * 'Date')` replaces the constructor with a mock returning `undefined`, so a
 * component that calls `new Date().getFullYear()` throws before any expectation
 * runs. Mutation-verified by putting the clock back: the failure is
 *
 *   TypeError: (intermediate value).getFullYear is not a function
 *     ❯ Footer src/components/Footer.tsx
 *
 * and NOT `expected "Date" not to be called`. The mutant dies either way, which
 * is what the test is for; the `not.toHaveBeenCalled()` pair below still earns
 * its place by catching a clock read whose result is never dereferenced.
 *
 * MEASURED RESIDUE, stated because the spies are not total: they catch
 * `Date.now()` and `new Date()`, and they do NOT catch `performance.now()` or
 * `Intl.DateTimeFormat().format()`, which reach a clock without touching `Date`.
 * A future footer could therefore read a clock these two cannot see. The same
 * gap is named at tier-table's assertion; it is the known edge of this technique
 * rather than an oversight here.
 *
 * THE COMPONENT IS CALLED DIRECTLY, and no DOM is involved. Footer takes no
 * props and uses no hooks, so it is just a function returning an element tree,
 * and `Footer()` is that tree. `createElement(Footer)` would NOT do — it only
 * describes an element whose type is the function and never invokes it, so the
 * walker below sees no children and every assertion passes vacuously. That is
 * not hypothetical; it is what the first version of this file did, and the
 * empty-string failure is how it was caught.
 *
 * Related but separate: vitest.config.ts's `include` takes `.test.ts` and not
 * `.test.tsx`, which is why render tests in this repo build trees in code rather
 * than in JSX. Nothing here needs a browser to answer it.
 */

// `Link: 'a'` — the house stub, from src/login-error.test.ts. The real Link
// resolves against the generated route tree and needs a router in context; an
// anchor renders the same text and this file asserts on text and on the clock.
vi.mock('@tanstack/react-router', () => ({ Link: 'a' }))

const { default: Footer } = await import('./Footer')

/** Every string in a rendered tree, flattened, in order. */
function text(node: unknown): string {
  if (node === null || node === undefined || node === false || node === true) return ''
  if (typeof node === 'string' || typeof node === 'number') return String(node)
  if (Array.isArray(node)) return node.map(text).join('')
  const children = (node as { props?: { children?: unknown } }).props?.children
  return children === undefined ? '' : text(children)
}

describe("the footer's copyright year", () => {
  test('renders the build year and reads no clock to do it', () => {
    // THE EXPECTED YEAR IS TAKEN BEFORE THE SPIES GO IN, and that ordering is
    // load-bearing rather than tidy: this line constructs a Date, so computing it
    // after `vi.spyOn(globalThis, 'Date')` would trip the very spy the assertion
    // below claims was never called, and the test would fail on its own clock
    // read. Caught while writing it.
    const expectedYear = new Date().getFullYear()

    // Both arms, because either alone leaves the hole open: a component that
    // renders the right year by CALLING the clock passes the first assertion,
    // and one that renders no year at all passes the second.
    const now = vi.spyOn(Date, 'now')
    const ctor = vi.spyOn(globalThis, 'Date')

    const rendered = text(Footer())

    // vitest.config.ts computes __BUILD_YEAR__ the same way vite.config.ts does,
    // so this comparison does not go stale next January.
    expect(rendered).toContain(`© ${expectedYear} Wordle Teams`)
    expect(ctor).not.toHaveBeenCalled()
    expect(now).not.toHaveBeenCalled()
  })
})
