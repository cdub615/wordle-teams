import { readdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, test } from 'vitest'

/**
 * WCAG CONTRAST, MEASURED OUT OF styles.css ITSELF.
 *
 * THIS FILE EXISTS BECAUSE A COMMENT IS NOT A MEASUREMENT. The contrast figures
 * in this repo have gone wrong the same way three times now: a ratio is
 * computed once, against one background, and then quoted somewhere the pairing
 * is different. V2-ADDENDUM.md section 2 is a whole section about the bundle
 * doing it (5 of 7 pairs wrong in light, 6 of 7 in dark). Phase 7 Task 4 then
 * did it again in miniature — components/home/feature-cards.tsx asserted "both
 * greys clear AA" on --surface-sunken while the 4.63 it was leaning on had been
 * measured on --background, and the real figure on the sunken band was 4.40.
 *
 * A prose ratio cannot fail a gate. These can. Every number in this file is
 * recomputed from the hex values that ship, so changing a token changes the
 * verdict rather than the documentation.
 *
 * IT PARSES THE CSS RATHER THAN IMPORTING IT, which is the pattern
 * src/routes.test.ts uses on the route files and src/lib/sw-push.test.ts uses
 * on the push payload: there is no CSSOM under `environment: 'edge-runtime'`,
 * and the text is the artefact that ships anyway.
 *
 * IT IS DELIBERATELY NOT EXHAUSTIVE, and the omission is named rather than
 * implied. --text-subtle is a KNOWN, DOCUMENTED failure at 4.31 light / 4.18
 * dark — see the note in styles.css — so asserting every text token against
 * every surface would encode a lie or a skip. What is pinned below is the set
 * of pairs the app actually renders normal-sized copy at.
 */

const css = readFileSync(new URL('./styles.css', import.meta.url), 'utf8')

/** The declarations inside one top-level block, as a token -> hex map. */
function tokensIn(selector: string): Record<string, string> {
  const opened = css.indexOf(`\n${selector} {`)
  expect(opened, `no top-level \`${selector} {\` block in styles.css`).toBeGreaterThan(-1)
  const body = css.slice(opened, css.indexOf('\n}', opened))

  const declarations: Record<string, string> = {}
  for (const [, name, value] of body.matchAll(/(--[a-z-]+):\s*(#[0-9a-fA-F]{6})\s*;/g)) {
    declarations[name] = value.toLowerCase()
  }
  return declarations
}

const LIGHT = tokensIn(':root')
// Layer 2 only forks by theme; `.dark` restates the semantics and inherits
// layer 3 through var(), which is why every value read here is a literal hex.
const DARK = { ...LIGHT, ...tokensIn('.dark') }

/** WCAG 2.1 relative luminance of an sRGB channel. */
const channel = (byte: number) => {
  const c = byte / 255
  return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4
}

const luminance = (hex: string) =>
  0.2126 * channel(parseInt(hex.slice(1, 3), 16)) +
  0.7152 * channel(parseInt(hex.slice(3, 5), 16)) +
  0.0722 * channel(parseInt(hex.slice(5, 7), 16))

const ratio = (a: string, b: string) => {
  const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x)
  return (hi + 0.05) / (lo + 0.05)
}

function expectRatio(
  theme: 'light' | 'dark',
  fg: string,
  bg: string,
  minimum: number,
) {
  const tokens = theme === 'light' ? LIGHT : DARK
  const [fgHex, bgHex] = [tokens[fg], tokens[bg]]
  expect(fgHex, `${fg} is not a literal hex in the ${theme} block`).toBeDefined()
  expect(bgHex, `${bg} is not a literal hex in the ${theme} block`).toBeDefined()

  // The COMPARISON is on the unrounded value; the two places are only so the
  // message reads the way every recorded ratio in this repo is written.
  const measured = ratio(fgHex, bgHex)
  expect(
    measured,
    `${theme}: ${fg} ${fgHex} on ${bg} ${bgHex} is ${measured.toFixed(2)}:1, below ${minimum}:1`,
  ).toBeGreaterThanOrEqual(minimum)
}

// Every surface normal-sized body copy is actually set on. --surface-inverse is
// absent on purpose: it has no consumer in src/, and it is the one surface
// where darkening a text token would HURT — which is the fact that made the
// --text-muted change safe to make globally.
const TEXT_SURFACES = ['--background', '--surface', '--surface-sunken'] as const

describe('AA contrast for the text tokens, in both themes', () => {
  // 4.5:1 is AA for normal-sized text. Both of these carry it: --text is body
  // and headings, --text-muted is descriptions, table headers, the footer and
  // the six feature-card paragraphs.
  for (const theme of ['light', 'dark'] as const) {
    for (const surface of TEXT_SURFACES) {
      test(`${theme}: --text on ${surface}`, () => {
        expectRatio(theme, '--text', surface, 4.5)
      })

      test(`${theme}: --text-muted on ${surface}`, () => {
        // THE REGRESSION THIS FILE WAS WRITTEN FOR. --text-muted #71717a passes
        // on --background (4.63) and fails on --surface-sunken (4.40); it was
        // shipped and reviewed as a pass because only the first was measured.
        expectRatio(theme, '--text-muted', surface, 4.5)
      })
    }
  }

  test('--text-subtle is still the documented exception, and still only that', () => {
    // Pinned as a FAILURE so the exception cannot quietly widen. If someone
    // darkens --text-subtle to clear AA this test goes red, and the right
    // response is to delete it and add --text-subtle to TEXT_SURFACES above —
    // there is room to now that --text-muted sits at 5.05 on --background.
    expect(ratio(LIGHT['--text-subtle'], LIGHT['--background'])).toBeLessThan(4.5)
    expect(ratio(DARK['--text-subtle'], DARK['--background'])).toBeLessThan(4.5)
  })
})

describe('AA contrast for the two coloured pairs the marketing landing renders', () => {
  test('the hero highlight clears AA at both ends of its gradient, in both themes', () => {
    // components/home/title.tsx: `from-brand-from via-brand-from to-warning`
    // under `text-warning-foreground`. Luminance rises monotonically from the
    // green end to the yellow one, so checking the two ends bounds the whole
    // band. v1's equivalent is 3.30 and 1.92 in dark — see that file's note.
    for (const theme of ['light', 'dark'] as const) {
      expectRatio(theme, '--warning-foreground', '--brand-from', 4.5)
      expectRatio(theme, '--warning-foreground', '--warning', 4.5)
    }
  })

  test('the feature-card icons clear the 3:1 graphics bar on the sunken band', () => {
    // 3:1, not 4.5: components/home/feature-cards.tsx renders --accent-solid as
    // an aria-hidden icon, which is a non-text contrast case. It measures 4.56
    // light and 7.48 dark, so this is headroom rather than a margin — but the
    // bar it has to clear is the graphics one, and asserting 4.5 here would be
    // asserting a rule that does not apply.
    expectRatio('light', '--accent-solid', '--surface-sunken', 3)
    expectRatio('dark', '--accent-solid', '--surface-sunken', 3)
  })
})

describe('AA contrast for --accent-solid, which every PROSE link in the app is', () => {
  // 4.5, NOT the 3 the block above asserts for the SAME TOKEN. styles.css's
  // base layer paints prose anchors --accent-solid, so such a link is that
  // token rendered at normal body size — a TEXT contrast case, not a graphics
  // one, and a different bar from the same token used as an icon.
  //
  // "PROSE" IS EXACT SINCE wordle-teams-3hch: the rule is scoped to anchors
  // with no widget role, so a link used as a CONTROL is not this token at all.
  // The block at the bottom of this file pins that scoping.
  //
  // ADDED WITH PHASE 7 TASK 5, which is the first time that pairing carries
  // real reading. src/routes/privacy.tsx and src/routes/terms.tsx each set a
  // mailto inside island-shell body copy — island-shell's background is
  // `var(--surface)` — and the footer's newly restored Privacy Policy / Terms
  // links sit on the page's --background. Measured 5.02 and 4.81 in light,
  // 8.22 and 8.69 in dark. --surface-sunken is deliberately absent: no link is
  // rendered on that band, and quoting a figure for a pairing that does not
  // ship is the exact mistake the header of this file is about.
  //
  // One test per theme and surface, like the --text/--text-muted block above:
  // four assertions in one test() report only the first failure.
  for (const theme of ['light', 'dark'] as const) {
    for (const surface of ['--surface', '--background'] as const) {
      test(`${theme}: --accent-solid as an inline link on ${surface}`, () => {
        expectRatio(theme, '--accent-solid', surface, 4.5)
      })
    }
  }
})

/**
 * THE BASE ANCHOR RULE IS SCOPED TO PROSE, AND ONLY THIS NOTICES (wordle-teams-3hch).
 *
 * WHAT WENT WRONG. `a { color: var(--accent-solid) }` painted EVERY anchor,
 * and Radix's `asChild` makes a menu item a real <a> — it merges its props
 * onto the child rather than wrapping it. So four of the nine items in the app
 * bar menu rendered green (Dashboard, Home, About, Feedback) while the five
 * built as divs did not, lucide's `currentColor` icons going green with them.
 * That shipped through lint, tsc, the build and 1272 unit tests, and was found
 * by a human looking at beta.
 *
 * WHY THIS IS ASSERTED ON THE SOURCE TEXT rather than on a rendered component:
 * there is no CSSOM under `environment: 'edge-runtime'`, and jsdom does not
 * load this stylesheet either, so no test in this repo can ask what colour an
 * element actually computes to. The selector is the artefact that ships, and it
 * is the thing that was wrong.
 *
 * BOTH HALVES ARE REQUIRED. Asserting only the exclusion would be satisfied by
 * deleting the rule outright, which would take the green off every prose link
 * in the app; asserting only that the rule exists is what let this through.
 */
describe('the base anchor colour reaches prose links and not controls', () => {
  /** The selector that opens the base layer's anchor rule. */
  const anchorRule = (() => {
    const match = css.match(/\n\s*(a[^{\n]*)\{\s*\n\s*color: var\(--accent-solid\);/)
    expect(match, 'no base-layer anchor rule setting color: var(--accent-solid)').not.toBeNull()
    return match![1].trim()
  })()

  test('it still paints anchors --accent-solid, so prose links stay green', () => {
    expect(anchorRule.startsWith('a')).toBe(true)
  })

  test('it EXCLUDES anchors carrying a widget role, which is what a control is', () => {
    // `role="menuitem"` is the case that broke; `[role]` covers every control
    // anchor rather than that one spelling, which is why the rule is written
    // against the attribute's presence.
    expect(anchorRule).toContain(':not([role])')
  })

  test('and the exclusion is wrapped in :where(), so it adds NO specificity', () => {
    // THE MUTATION THIS KILLS, AND IT IS THE SUBTLE HALF. A bare
    // `a:not([role])` is (0,1,1) — STRONGER than a single-class Tailwind
    // utility at (0,1,0) — so narrowing the rule this way would silently make
    // it beat every `text-*` utility applied to an anchor, and the fix for four
    // green menu items would have broken colour on links all over the app.
    // `:where()` contributes zero, holding the selector at (0,0,1), exactly as
    // strong as the unscoped rule it replaced.
    expect(anchorRule).toMatch(/:where\(\s*:not\(\[role\]\)\s*\)/)
  })
})

/**
 * NO COMPONENT USES TAILWIND 3'S DEAD CSS-VARIABLE SPELLING (wordle-teams-krhp).
 *
 * THE DEFECT. In Tailwind 3, an arbitrary value holding a BARE custom property
 * — square brackets around a `--name` with no `var()` around it — resolved to
 * `var(--name)`. Tailwind 4 does not: it emits the literal token, producing a
 * declaration like `height:--cell-size` that is invalid CSS and that every
 * browser silently discards. The class is still generated, the element still
 * carries it, tsc and eslint and the build are all perfectly happy, and the
 * style simply does not exist.
 *
 * FIFTEEN OF THESE SHIPPED IN v2 AND ALL FOUR GATES STAYED GREEN. Ten in
 * ui/calendar.tsx, which is why the date picker was unusable — `--cell-size` was
 * defined and never read, so the day cells had no size at all
 * (wordle-teams-5p9). Five more across ui/select.tsx, ui/dropdown-menu.tsx and
 * ui/popover.tsx: three open-animation transform origins, and a select whose
 * max-height did not apply, so a long one ran off the bottom of the viewport
 * instead of scrolling inside itself. Both were found by a person looking at a
 * screen, which is the thing this replaces.
 *
 * THE FILES WERE INCONSISTENT WITH THEMSELVES, which is the tell that it was an
 * oversight rather than a decision: ui/dropdown-menu.tsx carried the CORRECT
 * `[var(...)]` spelling in the same className string as a broken one.
 *
 * SCANS SOURCE, NOT THE COMPILED BUNDLE. Reading dist/ would be the more direct
 * measurement — an invalid declaration is visible as itself there — but it
 * would make this test pass or fail depending on whether someone had run a
 * build, and `pnpm test` does not. The source spelling is the defect and is
 * always present.
 */
describe('no component carries a Tailwind 3 bare-custom-property utility', () => {
  /** Every .tsx under src/, recursively. */
  function componentFiles(dir: string): Array<string> {
    return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
      const path = join(dir, entry.name)
      if (entry.isDirectory()) return componentFiles(path)
      return entry.name.endsWith('.tsx') ? [path] : []
    })
  }

  test('src/**/*.tsx is clean', () => {
    // BUILT FROM PIECES SO THIS FILE CONTAINS NO LITERAL BROKEN CANDIDATE.
    // Tailwind 4 scans raw file text and does not skip comments or string
    // literals, so spelling one out here would generate the very rule this
    // forbids — measured during wordle-teams-5p9, where a doc comment
    // describing the bug put `height:--cell-size` back into the compiled CSS.
    // The same reason ui/calendar.tsx describes the pattern in prose.
    const deadSpelling = new RegExp('-\\[' + '--[a-z][a-z0-9-]*\\]', 'g')

    const offenders = componentFiles('src').flatMap((file) => {
      const matches = readFileSync(file, 'utf8').match(deadSpelling) ?? []
      return matches.map((match) => `${file}: ${match}`)
    })

    // Listed rather than counted, so a failure names the file and the utility
    // instead of a number that has to be chased.
    expect(offenders).toEqual([])
  })
})
