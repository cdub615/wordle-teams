// @vitest-environment jsdom
//
// jsdom rather than the suite's default edge-runtime, because this renders the
// real components; `.hook.test.ts` with `createElement` rather than JSX, because
// the include pattern in vitest.config.ts takes `.test.ts` and not `.test.tsx`.
// tier-table.hook.test.ts is this file's sibling and the harness it copies.
//
// WHAT THIS FILE IS FOR. The landing page is where the launch email points, and
// two of its sections describe what a free account gets. Until this file existed
// the ONLY thing asserting that copy reached the page was e2e/routes.spec.ts,
// which transcribes the h3 outline by hand and sits OUTSIDE the four gates — so
// a wrong heading on the product's front door went green on test, typecheck,
// lint and build, and went red only in a CI e2e run that has sat red for three
// tasks at a stretch. This brings that property inside the gates. The e2e
// assertion stays: only a browser can say the sections reach a served page at
// all, which is a different claim from what these components emit.
//
// AND IT CLOSES THE HOLE free-includes.ts's HEADER NAMES AS THE HONEST STATE OF
// THE RULE. That rule is: a surface may choose which free entries to show and
// may frame them in its own voice, and may not write its own sentence for a free
// capability. marketing-copy.test.ts enforces it over one module's ENUMERATED
// exports, which is everything that module wrote and nothing a component typed
// straight into its JSX. No corpus contains JSX. The third test in each describe
// below is the one that reads the rendered prose instead, and it is the reason
// this file is worth its length.
//
// NO MOCKS, WHICH IS WHY THIS WAS THE EASY ONE OF THE THREE HARNESSES
// wordle-teams-1vbb NAMES. Both components are props-free, reach no Convex
// query and render no router Link; ProductShot emits two plain <img> tags. There
// is nothing here to stand up.
import { cleanup, render, screen, within } from '@testing-library/react'
import { createElement } from 'react'
import { afterEach, describe, expect, test } from 'vitest'
import type { FreeInclusion } from '#/lib/free-includes.ts'
import { AlsoFree } from './also-free.tsx'
import { InsightsPayoff } from './insights-payoff.tsx'
import { ALSO_FREE, PAYOFF, PAYOFF_INCLUDES, SECTION_TITLES } from './marketing-copy.ts'

afterEach(cleanup)

/**
 * Everything the section drew, minus every string it is ALLOWED to draw, with
 * whitespace collapsed. Empty means the section wrote nothing of its own.
 *
 * LONGEST FIRST, DELIBERATELY. Removal is textual, so a short permitted string
 * that happens to be a substring of a longer one would punch a hole in the
 * middle of the longer one and leave its two halves behind as false residue.
 * Sorting by length descending makes each removal the largest that still
 * matches.
 *
 * ALT TEXT IS NOT IN HERE BECAUSE IT IS NOT IN `textContent` — an `alt`
 * attribute is not a text node. It is a claim like any other and it is covered
 * where it lives: marketing-copy.test.ts asserts every shot is described by alt
 * text that describes something, and resolves both PNGs on disk.
 */
const residue = (text: string, permitted: ReadonlyArray<string>) => {
  let rest = text
  for (const allowed of [...permitted].sort((a, b) => b.length - a.length)) {
    rest = rest.split(allowed).join(' ')
  }
  return rest.replace(/\s+/g, ' ').trim()
}

/** The titles and bodies of the entries a section selected from the inventory. */
const inventoryTextOf = (selection: ReadonlyArray<FreeInclusion>) =>
  selection.flatMap((inclusion) => [inclusion.title, inclusion.body])

describe('AlsoFree — "Included, free"', () => {
  const alsoFree = () => render(createElement(AlsoFree)).container

  /**
   * TITLE AND BODY, BOTH, for the reason tier-table.hook.test.ts's Pro column
   * gives: asserting titles alone leaves the gate guarding half the copy, and a
   * section of bare headings with nothing explaining any of them would pass.
   */
  test('renders every entry it selects, title and body', () => {
    alsoFree()
    for (const inclusion of ALSO_FREE) {
      expect(screen.getByText(inclusion.title)).toBeTruthy()
      expect(screen.getByText(inclusion.body)).toBeTruthy()
    }
  })

  /**
   * THE PROPERTY e2e/routes.spec.ts TRANSCRIBES BY HAND, HELD INSIDE THE GATES.
   * `toEqual` over the whole list rather than a per-entry lookup, so a reword, a
   * reorder, a dropped entry AND a heading the inventory never named all fail —
   * the same four-way property that file's free column has on /pricing.
   *
   * DERIVED FROM THE SELECTION, NOT SPELLED OUT. The e2e spec spells the seven
   * landing h3s out on purpose, because ITS job is the page's whole outline and
   * deriving the list would let a reword pass. Here the question is narrower and
   * the opposite choice is right: whether this component renders the selection
   * it was given, in order. The WORDS are pinned one file away, by
   * free-includes.test.ts, in the file the sentences actually live in.
   */
  test('its h3 outline is exactly the selection, in order', () => {
    alsoFree()
    const headings = screen.getAllByRole('heading', { level: 3 }).map((node) => node.textContent)
    expect(headings).toEqual(ALSO_FREE.map((inclusion) => inclusion.title))
  })

  test('writes no prose of its own', () => {
    // THE ONE THAT CLOSES THE JSX HOLE. Everything this section is permitted to
    // say is either its own h2 or a sentence the inventory wrote. A free-tier
    // claim typed straight into the markup — the thing no corpus rule can see —
    // lands here as leftover text.
    const container = alsoFree()
    expect(residue(container.textContent ?? '', [SECTION_TITLES.alsoFree, ...inventoryTextOf(ALSO_FREE)])).toBe('')
  })

  test('its icons are decoration and are hidden from the accessibility tree', () => {
    // This is the thing also-free.tsx's own header used to excuse with "no test
    // renders this component". The icons are keyed by entry id, so each heading
    // is what a screen reader announces and the picture beside it is announced
    // not at all.
    //
    // WHAT THIS PINS IS THE RENDERED OUTCOME, NOT THE PROP, AND THE DIFFERENCE
    // WAS MEASURED RATHER THAN REASONED. Deleting `aria-hidden="true"` from the
    // Icon in also-free.tsx leaves this test GREEN — lucide-react hides an icon
    // it was given no accessible name, so the attribute arrives either way and
    // the explicit prop is belt-and-braces. Adding an `aria-label` DOES fail
    // here, which is the edit that would actually put a decorative picture into
    // the accessibility tree. So: this assertion guards the property a screen
    // reader experiences, and it does not guard the line of source that
    // currently states it. Written down because a test that cannot fail reads as
    // coverage it is not.
    //
    // EVERY svg, NOT "no element has role img". The section also renders a
    // ProductShot, whose two <img> tags carry alt text and ARE role img by
    // design — asserting the accessibility tree holds no image at all fails on
    // the screenshot rather than on the icons, which is what the first draft of
    // this test did. The claim is about the icons specifically: there is one per
    // entry, and every one of them is hidden.
    const container = alsoFree()
    const icons = [...container.querySelectorAll('svg')]
    expect(icons).toHaveLength(ALSO_FREE.length)
    expect(icons.map((icon) => icon.getAttribute('aria-hidden'))).toEqual(
      ALSO_FREE.map(() => 'true'),
    )
  })
})

describe('InsightsPayoff — the free half of Insights', () => {
  const payoff = () => render(createElement(InsightsPayoff)).container

  test('renders every entry it selects, title and body', () => {
    payoff()
    for (const inclusion of PAYOFF_INCLUDES) {
      expect(screen.getByText(inclusion.title)).toBeTruthy()
      expect(screen.getByText(inclusion.body)).toBeTruthy()
    }
  })

  test('its h3 outline is exactly the selection, in order', () => {
    payoff()
    const headings = screen.getAllByRole('heading', { level: 3 }).map((node) => node.textContent)
    expect(headings).toEqual(PAYOFF_INCLUDES.map((inclusion) => inclusion.title))
  })

  /**
   * THE SECTION WITH THE MOST OF ITS OWN VOICE, AND THEREFORE THE MOST TO GET
   * WRONG. insights-payoff.tsx imports NOTHING from lib/free-includes.ts — it
   * renders PAYOFF_INCLUDES, which marketing-copy.ts selected — so
   * free-includes.test.ts's census cannot see this file at all, and a sentence
   * typed into it is invisible to every other gate in the repo. Four permitted
   * strings, and the caption among them: `PAYOFF.shotNote` is what stops the
   * Pro screenshot below the prose from reading as something free includes.
   */
  test('writes no prose of its own', () => {
    const container = payoff()
    const permitted = [
      PAYOFF.kicker,
      PAYOFF.title,
      PAYOFF.lead,
      PAYOFF.shotNote,
      ...inventoryTextOf(PAYOFF_INCLUDES),
    ]
    expect(residue(container.textContent ?? '', permitted)).toBe('')
  })

  test('says which tier the screenshot belongs to, beneath the free prose', () => {
    // The caption is the difference between a screenshot and an implication, and
    // it is the one line here that must sit AFTER the two free entries — a
    // reader who meets "the Pro view" before them reads the whole section as an
    // upsell. Position, not just presence: the words alone survive a reorder.
    const container = payoff()
    const caption = screen.getByText(PAYOFF.shotNote)
    const lastEntry = within(container).getByText(
      PAYOFF_INCLUDES[PAYOFF_INCLUDES.length - 1].body,
    )
    expect(
      Boolean(lastEntry.compareDocumentPosition(caption) & Node.DOCUMENT_POSITION_FOLLOWING),
    ).toBe(true)
  })
})
