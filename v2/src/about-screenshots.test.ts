import { readFileSync } from 'node:fs'
import { describe, expect, test, vi } from 'vitest'
import { inlineText, isHidden, visibleElements, type Element } from './test-support/element-tree'
import { codeOf, importedModulesOf } from './test-support/source-ast'
import { PRO_BENEFITS } from './lib/pro-benefits'
import { FREE_TEAM_LIMIT } from '../convex/lib/teamLimits'

/**
 * THE PRODUCT SCREENSHOTS AND THE PROSE ON /about, AND THE WAYS EACH BREAKS
 * SILENTLY.
 *
 * WHY THIS IS A UNIT TEST. .github/workflows/deploy-v2.yml runs lint,
 * typecheck, `vitest run` and build, then deploys and smoke-tests /login. IT
 * RUNS NO PLAYWRIGHT (wt-ksh.8.49), so an e2e-only protection is not a gate —
 * it is a thing somebody may run. Everything in this file is reachable from
 * `vitest run`, which is.
 *
 * THE FAILURES, none of which any other gate can see:
 *
 *   1. AN <img> POINTING AT A FILE public/ DOES NOT HOLD. `src` is a string;
 *      tsc has no opinion about it, eslint has no opinion about it, and the
 *      build copies public/ wholesale without checking that anything refers to
 *      what is in it. The page renders, the alt text shows, and the screenshot
 *      is a broken-image icon. Every read below resolves the path THE PAGE
 *      CARRIES — never an independent literal, which would go on reading the
 *      right file no matter where `src` pointed.
 *
 *   2. A width/height PAIR THAT IS NOT THE FILE'S. These attributes exist to
 *      give the browser an aspect ratio to reserve space with; a wrong pair
 *      reserves the wrong box and the page still reflows — worse, it reflows
 *      into a shape somebody deliberately wrote down, so it reads as correct.
 *      THIS IS NEWLY LIVE RATHER THAN THEORETICAL: the shots are now captured
 *      by scripts/build-marketing-shots.mjs, and a re-shoot after a dialog
 *      grows a field writes a taller PNG behind an unchanged number. So the
 *      pair is checked against the PNG's IHDR chunk, which is the file's own
 *      account of its size, for BOTH theme twins.
 *
 *   3. ONE THEME'S FILE MISSING. components/home/product-shot.tsx composes
 *      `-light.png` and `-dark.png` onto a stem, so a stem whose dark twin was
 *      never captured is a page that is perfect in one theme and broken in the
 *      other — and whoever is looking is in one of them.
 *
 *   4. THE PROSE DRIFTING BACK AWAY FROM THE APP. wordle-teams-wty4.1.14.5
 *      found six false claims on this page, all of them shipped, all of them
 *      green. The exhaustive paragraph list below is what makes a reworded
 *      sentence a failing test rather than a silent edit, and the Pro section
 *      is asserted to be lib/pro-benefits.ts's own list rather than a retyped
 *      one, because a retyped one is exactly what was wrong.
 *
 * ASSERTED ON THE RENDERED ELEMENT TREE, NOT ON THE SOURCE. The component is
 * called as the plain function it is and the tree it returns is walked
 * (src/test-support/element-tree.ts). That walk is HIDDEN-AWARE: a
 * `hidden sm:flex` on a step would delete it from the page while leaving it
 * exactly where a source match would find it.
 *
 * AND IT GOES ONE LEVEL FURTHER THAN IT USED TO, BECAUSE THE IMAGES MOVED
 * INSIDE A COMPONENT. element-tree.ts's walker deliberately does not render
 * component elements — its own header says so, and says "the caller's own count
 * assertion is what turns that into a failure". /about's <img> tags now live in
 * ProductShot, so the page's tree carries three ProductShot ELEMENTS and no
 * images at all. The fix is not to teach the walker to render: it is to assert
 * the page's three elements AND to call ProductShot with each one's own props
 * and assert the tree THAT returns. Both halves are needed — the first is what
 * a step being deleted fails, the second is what a broken src fails.
 *
 * `createFileRoute` is the one thing that cannot run under vitest — it
 * registers against a router that does not exist here — so it is mocked to hand
 * back the options object, exactly as src/legal-prose.test.ts does. `Link` is
 * mocked alongside it because the page links to /pricing and a real TanStack
 * Link needs a router context. Reading the component back off `Route.options`
 * rather than exporting it separately also means a component detached from its
 * route is a failure here.
 */

/**
 * The stand-in for TanStack's `Link`. A named function so a failure message
 * says `Link` rather than `Object`, and so the links assertion can match on its
 * identity rather than on a string.
 *
 * THROUGH `vi.hoisted` BECAUSE `vi.mock` IS HOISTED ABOVE EVERY `const` IN THE
 * FILE. A plain top-level binding referenced from the factory is a
 * ReferenceError at mock time, not at use time — measured, on the first run of
 * this file. `vi.hoisted` moves the definition up with the mock.
 */
const { Link } = vi.hoisted(() => ({
  Link: function Link(props: unknown) {
    return props
  },
}))

// Hoisted above the imports below by vitest, which is what makes them resolve.
vi.mock('@tanstack/react-router', () => ({
  createFileRoute: () => (options: unknown) => ({ options }),
  Link,
}))

import { Route } from './routes/about'
import { ProductShot } from './components/home/product-shot'

const ABOUT_SOURCE = './routes/about.tsx'
const read = (path: string) => readFileSync(new URL(path, import.meta.url), 'utf8')

const component = (Route as unknown as { options: { component?: unknown } }).options.component as
  | (() => unknown)
  | undefined

// Thrown rather than expect()ed, because this runs at module scope: a route
// that declares no component has to be a named collection failure, not a
// TypeError from calling undefined.
if (typeof component !== 'function') throw new Error('the /about route declares no component')

const rendered = visibleElements(component())

interface ShotProps {
  shot: { stem: string; alt: string }
  width: number
  height: number
}

/** Every ProductShot the page renders, in document order, as plain data. */
const shots: ShotProps[] = rendered
  .filter((element) => element.type === ProductShot)
  .map((element) => element.props as unknown as ShotProps)

/** The file on disk for one twin of a shot, DERIVED FROM THE STEM THE PAGE CARRIES. */
const fileFor = (stem: string, scheme: 'light' | 'dark') =>
  new URL(`../public/marketing/${stem}-${scheme}.png`, import.meta.url)

/**
 * A PNG's declared dimensions, read out of its IHDR chunk — the first chunk of
 * the file, at a fixed offset after the 8-byte signature. Uint8Array rather
 * than Buffer: the vitest environment is edge-runtime.
 */
function pngSize(file: URL): { width: number; height: number } {
  const bytes = new Uint8Array(readFileSync(file))
  expect([...bytes.subarray(0, 8)], `${file.pathname} is not a PNG`).toEqual([
    0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a,
  ])
  expect(String.fromCharCode(...bytes.subarray(12, 16)), `${file.pathname} has no IHDR`).toBe(
    'IHDR',
  )
  const header = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength)
  return { width: header.getUint32(16), height: header.getUint32(20) }
}

// ---------------------------------------------------------------------------
// The walker's own contract, on a hand-built tree rather than on the page.
// ---------------------------------------------------------------------------

/**
 * Everything below this block is only as good as the extractor, and an
 * extractor that reported hidden elements as present would make the whole file
 * decorative. src/login-error.test.ts pins the same predicate through its own
 * line walker; these pin the piece THIS file depends on — that a hidden
 * container takes its contents with it.
 */
describe('visibleElements, on what a user can and cannot see', () => {
  const img = (props: Record<string, unknown>) => ({ type: 'img', props })
  const div = (props: Record<string, unknown>) => ({ type: 'div', props })
  const types = (node: unknown) => visibleElements(node).map((element) => element.type)

  test('a visible image is reported', () => {
    expect(types(img({ src: '/a.png' }))).toEqual(['img'])
  })

  test('the hidden attribute removes it', () => {
    expect(types(img({ src: '/a.png', hidden: true }))).toEqual([])
  })

  test('a hidden utility class removes it, at any breakpoint', () => {
    expect(types(img({ src: '/a.png', className: 'hidden sm:flex' }))).toEqual([])
    expect(types(img({ src: '/a.png', className: 'sm:hidden' }))).toEqual([])
    expect(types(img({ src: '/a.png', className: 'mt-4 hidden' }))).toEqual([])
  })

  test('a hidden container takes its contents with it', () => {
    // THE CASE THIS FILE RELIES ON. The three steps are rendered from one
    // `.map()`; hiding the flex column around them is one className away and
    // removes the whole walkthrough from the page.
    const grid = div({ className: 'hidden', children: [img({ src: '/a.png' })] })
    expect(types(grid)).toEqual([])
    expect(types(div({ className: 'grid', children: [img({ src: '/a.png' })] }))).toEqual([
      'div',
      'img',
    ])
  })

  test('overflow-hidden is not hidden, and neither is aria-hidden', () => {
    // The two false positives that would silently delete real content.
    expect(types(img({ src: '/a.png', className: 'overflow-hidden' }))).toEqual(['img'])
    expect(types(img({ src: '/a.png', className: 'sm:overflow-hidden' }))).toEqual(['img'])
    expect(types(img({ src: '/a.png', 'aria-hidden': 'true' }))).toEqual(['img'])
  })

  test('isHidden is the predicate both of those cases go through', () => {
    // Named directly as well as exercised through the walker, so that a walker
    // rewritten to stop consulting it cannot leave these green.
    expect(isHidden({ hidden: true })).toBe(true)
    expect(isHidden({ className: 'hidden sm:flex' })).toBe(true)
    expect(isHidden({ className: 'overflow-hidden' })).toBe(false)
    expect(isHidden(undefined)).toBe(false)
  })

  test('an array and a fragment are flattened, not counted', () => {
    expect(types([img({ src: '/a.png' }), img({ src: '/b.png' })])).toEqual(['img', 'img'])
  })
})

/**
 * THE SECOND EXTRACTOR, PINNED TO THE SAME STANDARD AS THE FIRST.
 *
 * The block above exists because everything under it is only as good as
 * `visibleElements`. Exactly the same is true of `importedModulesOf`: the one
 * guarantee wt-ksh.12.5 actually asks this file for — that the aceternity
 * carousel stays out — is a single `toEqual` over whatever that helper returns,
 * and until this block existed the helper had one call site and no contract
 * anywhere in the repo.
 *
 * THE EXPLOIT THAT MOTIVATES IT, which is not a straw man but the most
 * plausible refinement anyone would make to it: skip module specifiers starting
 * with `.`, on the grounds that only package imports are interesting. That
 * turns the carousel guarantee off completely and leaves the whole suite green,
 * because RELATIVE IS THE SHAPE THAT MATTERS HERE — v1 imports it as
 * `'./ui/aceternity/infinite-moving-cards'` (src/components/about.tsx:14), not
 * from a package at all.
 *
 * Hand-written source strings rather than files on disk, so each import FORM is
 * named and isolated. `importedModulesOf` takes the text and a name for it,
 * which is what makes that possible.
 */
describe('importedModulesOf, on every import form a file can carry', () => {
  const modules = (source: string) => importedModulesOf('fixture.tsx', source)

  test('a relative specifier is reported — the case the carousel guarantee rests on', () => {
    // THE MUTATION THIS BLOCK WAS WRITTEN AGAINST. A helper that reported only
    // package imports would make `'./ui/aceternity/infinite-moving-cards'`
    // invisible, and the one test wt-ksh.12.5 asks for would pass on a page
    // that renders the carousel.
    expect(modules("import { InfiniteMovingCards } from './ui/aceternity/infinite-moving-cards'")).toEqual([
      './ui/aceternity/infinite-moving-cards',
    ])
    expect(modules("import x from '../lib/x'")).toEqual(['../lib/x'])
  })

  test('an aliased import is reported under its MODULE, not its local name', () => {
    // The other half of why this is not `not.toContain('aceternity')`: renaming
    // the binding changes nothing about what the file depends on.
    expect(modules("import { InfiniteMovingCards as Cards } from '#/carousel'")).toEqual([
      '#/carousel',
    ])
  })

  test('a namespace import is reported', () => {
    expect(modules("import * as carousel from 'aceternity-ui'")).toEqual(['aceternity-ui'])
  })

  test('a side-effect import with no bindings at all is reported', () => {
    // `import 'x'` has no clause to look at, and a helper reading the import
    // clause rather than the specifier would drop it silently.
    expect(modules("import 'aceternity-ui/styles.css'")).toEqual(['aceternity-ui/styles.css'])
  })

  test('a type-only import is reported, because it is still a line naming a module', () => {
    expect(modules("import type { Props } from './ui/aceternity/infinite-moving-cards'")).toEqual([
      './ui/aceternity/infinite-moving-cards',
    ])
  })

  test('every specifier in the file, in source order, and nothing else', () => {
    // The property the carousel test relies on: a BOUNDED, ORDERED list, so an
    // added dependency fails as loudly as a removed one. `export ... from` is
    // deliberately not an import and must not appear.
    const source = [
      "import a from 'zeta'",
      "import 'alpha'",
      "export { b } from './re-exported'",
      "const c = 'not-an-import'",
      "import d from './local'",
    ].join('\n')
    expect(modules(source)).toEqual(['zeta', 'alpha', './local'])
  })

  test('a dynamic import() is NOT reported — a documented gap, not an oversight', () => {
    // OUT OF SCOPE ON PURPOSE, and stated here so the gap is a decision rather
    // than a surprise. `import('x')` is a CallExpression, not an
    // ImportDeclaration, and reporting it would mean deciding what to do with a
    // non-literal specifier — `import(name)` has no module to name. Nothing in
    // src/routes uses dynamic import, and /about is a static page with four
    // imports; a caller that needs to care must extend the helper and say so
    // here. THE COST IF THAT CHANGES: a carousel loaded through `import()`
    // would not appear in the list, so this test is also the note telling the
    // next reader that the /about guarantee assumes static imports.
    expect(modules("const Cards = await import('./ui/aceternity/infinite-moving-cards')")).toEqual(
      [],
    )
  })

  test('a file with no imports is an empty list, not a throw', () => {
    expect(modules('export const x = 1')).toEqual([])
  })
})

// ---------------------------------------------------------------------------
// The three product shots.
// ---------------------------------------------------------------------------

describe('the product shots the walkthrough is illustrated with', () => {
  test('all three are on the page, in order, each with its own alt text', () => {
    // ONE toEqual OVER THE WHOLE LIST rather than three toContain calls: a
    // reorder, a deletion and a duplicate all have to fail, and only the full
    // ordered list does that.
    expect(shots.map((shot) => shot.shot.stem)).toEqual([
      'board-entry',
      'create-team',
      'install-guide',
    ])
    // The alt text is the accessible description of the product and nothing
    // renders it for a sighted reviewer to notice. Each one describes what is
    // IN THE FRAME, never what the product can do — the rule
    // components/home/marketing-copy.ts states for its own.
    expect(shots.map((shot) => shot.shot.alt)).toEqual([
      'The board entry dialog: the day at the top, the day’s answer spelled out above a Wordle grid with two guesses filled in and the cursor waiting on the next tile.',
      'The Create Team dialog: a team name field, and switches for playing weekends and for showing letters in completed boards.',
      'The settings dialog on its Install tab, listing three steps: tap the three-dot or share icon, choose Add to Home Screen or Install app, then confirm.',
    ])
  })

  test('every shot resolves to BOTH theme twins in public/marketing/', () => {
    // readFileSync THROWING IS THE ASSERTION — a byteLength check underneath it
    // would be unreachable, which is how a version of this test in
    // crawler-metadata.test.ts once managed to assert nothing at all. The path
    // is derived from the page's own stem, so repointing a shot at a file that
    // is not there is an ENOENT naming the file.
    //
    // BOTH TWINS, because product-shot.tsx renders both and a reader sees
    // exactly one of them. A missing dark twin is a page that is correct for
    // whoever reviewed it and broken for everyone in the other theme.
    for (const shot of shots) {
      for (const scheme of ['light', 'dark'] as const) {
        expect(
          () => readFileSync(fileFor(shot.shot.stem, scheme)),
          `${shot.shot.stem}-${scheme}.png is not in public/marketing/`,
        ).not.toThrow()
      }
    }
    // So that "every one of zero shots exists" cannot be the thing that passes.
    expect(shots).toHaveLength(3)
  })

  test('every declared width and height is the pair inside BOTH PNGs', () => {
    // THE CHECK THE REST OF THE FILE CANNOT MAKE. Nothing else in this repo can
    // tell a correct pair from a plausible one — and a wrong pair is worse than
    // none, because it reserves a box of the wrong shape and the page reflows
    // anyway, into a layout somebody wrote down on purpose.
    //
    // THE TWINS ARE CHECKED AGAINST THE SAME NUMBERS rather than against each
    // other, which also proves they agree. scripts/build-marketing-shots.mjs
    // clips these to an element, so light and dark are the same DOM at the same
    // viewport and MUST come out the same size; if a theme ever changes a
    // dialog's metrics, one declared pair cannot be right for both and this is
    // where that surfaces.
    const declared = shots.map((shot) => [shot.shot.stem, shot.width, shot.height])
    for (const scheme of ['light', 'dark'] as const) {
      const actual = shots.map((shot) => {
        const { width, height } = pngSize(fileFor(shot.shot.stem, scheme))
        return [shot.shot.stem, width, height]
      })
      expect(actual, `the ${scheme} twins`).toEqual(declared)
    }
  })

  test('the numbers are spelled out here too, so both sides cannot move together', () => {
    // The test above compares the page against the files. If somebody re-shoots
    // a dialog that has grown a field and updates the attributes to match, that
    // test stays green — correctly, because the page is still consistent. This
    // one makes a re-shoot a deliberate act with a failing test attached, the
    // way legal-prose.test.ts's fixture does, and it is the only thing that
    // would make anyone LOOK at the new picture.
    expect(shots.map((shot) => [shot.shot.stem, shot.width, shot.height])).toEqual([
      ['board-entry', 512, 714],
      ['create-team', 512, 326],
      ['install-guide', 462, 236],
    ])
  })

  test('nothing on the page still points at a hand-captured v1 PNG', () => {
    // THE DEFECT THIS TASK REMOVED, PINNED SO IT CANNOT COME BACK ONE FILE AT A
    // TIME. public/install-button.png and public/upgrade-button.png were crops
    // of a dropdown menu that wordle-teams-lyab deleted; public/github-repo.png
    // photographs a README describing a Next.js and Supabase app. None of them
    // can be re-shot by scripts/build-marketing-shots.mjs, which is the whole
    // reason they rotted, so the rule is that this page's images come from
    // public/marketing/ and from nowhere else.
    // `codeOf`, NEVER THE RAW SOURCE. This route's header explains, by name,
    // which stale PNGs were removed and why — so a substring test over the
    // whole file goes red on the comment that records the fix. Same trap the
    // carousel test below documents, and the same answer: strip the comments
    // and assert on what actually compiles.
    const code = codeOf(read(ABOUT_SOURCE))
    for (const dead of [
      'install-button',
      'upgrade-button',
      'feedback-page',
      'changelog-page',
      'twitter-acct',
      'github-repo',
      'welcome-screenshot',
    ]) {
      expect(code, `${dead}.png is referenced again`).not.toContain(dead)
    }
    // And positively, not only by absence: every image the page draws is
    // composed by ProductShot out of a stem, which is what confines it.
    expect(rendered.filter((element) => element.type === 'img')).toEqual([])
  })
})

/**
 * THE OTHER HALF OF THE SCREENSHOT GUARANTEE.
 *
 * element-tree.ts does not render component elements, so the block above proves
 * the page ASKS for three shots and says nothing about what those shots emit.
 * ProductShot is called here with each of the page's own prop objects, and the
 * tree it returns is walked — which is where the actual <img> src, the actual
 * width/height attributes and the actual `loading` live.
 */
describe('what ProductShot emits for each of those', () => {
  /**
   * NOT `visibleElements`, AND THE REASON IS A REAL PROPERTY OF THIS COMPONENT
   * RATHER THAN A CONVENIENCE. Both twins carry a `hidden` variant — the light
   * one is `dark:hidden` and the dark one `hidden dark:block` — and
   * element-tree.ts's `isHidden` matches any token ENDING in `:hidden`, which
   * is exactly right for the page (one twin is painted, the other is not) and
   * useless here, where the whole question is what BOTH of them declare. A
   * walker that filtered would report zero images and every assertion below
   * would be an empty array compared against an empty array.
   */
  const allElements = (node: unknown): Element[] => {
    const out: Element[] = []
    const visit = (current: unknown): void => {
      if (current == null || typeof current === 'boolean') return
      if (typeof current === 'string' || typeof current === 'number') return
      if (Array.isArray(current)) {
        for (const child of current) visit(child)
        return
      }
      const element = current as Element
      if (element.type !== undefined) out.push(element)
      visit(element.props?.children)
    }
    visit(node)
    return out
  }

  const imagesFor = (props: ShotProps) => {
    const tree = ProductShot(props as Parameters<typeof ProductShot>[0]) as unknown
    return allElements(tree).filter((element) => element.type === 'img')
  }

  test('two images per shot, one per theme, composed from that stem', () => {
    // THE PAIRING IS THE ASSERTION, not merely the paths. product-shot.tsx's
    // whole argument is that this app's theme is a CLASS on <html> written by
    // lib/theme.ts and not the OS preference, so a media query would show the
    // wrong twin to anyone whose choice differs from their OS. Two elements
    // keyed on that class is what makes the shot unable to disagree with the
    // page around it, and one element here would mean it had gone back to a
    // single file for both themes.
    expect(shots.flatMap((props) => imagesFor(props).map((img) => img.props?.src))).toEqual([
      '/marketing/board-entry-light.png',
      '/marketing/board-entry-dark.png',
      '/marketing/create-team-light.png',
      '/marketing/create-team-dark.png',
      '/marketing/install-guide-light.png',
      '/marketing/install-guide-dark.png',
    ])
  })

  test('exactly one of each pair is painted, and which one is the theme class', () => {
    // The other half of the mechanism, and the half a path assertion cannot
    // see: two images both visible would double every shot on the page.
    expect(
      shots.flatMap((props) =>
        imagesFor(props).map((img) =>
          String(img.props?.className)
            .split(/\s+/)
            .filter((token) => token.endsWith(':hidden') || token === 'hidden' || token === 'dark:block')
            .join(' '),
        ),
      ),
    ).toEqual(['dark:hidden', 'hidden dark:block', 'dark:hidden', 'hidden dark:block', 'dark:hidden', 'hidden dark:block'])
  })

  test('each carries the page’s declared width and height, not ProductShot’s default', () => {
    // THE REGRESSION THIS EXISTS FOR. ProductShot hardcoded 1440x900 until
    // wordle-teams-wty4.1.14.5 made the pair a prop with that default, so a
    // caller that forgets to pass one gets a number that is right for the
    // landing page and wrong here — silently, and in exactly the direction
    // these attributes exist to prevent.
    expect(
      shots.flatMap((props) =>
        imagesFor(props).map((img) => [img.props?.width, img.props?.height]),
      ),
    ).toEqual([
      [512, 714],
      [512, 714],
      [512, 326],
      [512, 326],
      [462, 236],
      [462, 236],
    ])
  })

  test('all of them declare loading="lazy"', () => {
    // A marketing page whose whole job is to load fast — wordle-teams-jcj is
    // this project's open wound about exactly that. Nothing but this notices
    // `loading` being dropped, and product-shot.tsx's hidden-twin trick depends
    // on it: a `display: none` image never intersects the viewport, so a lazy
    // one never fetches and the unseen theme costs nothing.
    expect(shots.flatMap((props) => imagesFor(props).map((img) => img.props?.loading))).toEqual(
      Array(6).fill('lazy'),
    )
  })
})

// ---------------------------------------------------------------------------
// The desktop zig-zag, which is what makes the DOM reorder defensible.
// ---------------------------------------------------------------------------

/**
 * This file's route justifies putting the text ahead of the image on every row
 * — where v1 leads with the image on half of them — with two claims: reading
 * order matches DOM order, and THE DESKTOP ZIG-ZAG IS UNCHANGED. The first
 * falls out of the ordering itself. The second is the half that makes the
 * divergence layout-neutral, and it is one edit from being false: dropping the
 * `index % 2` branch stacks every row the same way and the whole suite stays
 * green.
 */
describe('the annotated rows', () => {
  const DIRECTIONS = ['md:flex-row', 'md:flex-row-reverse']

  /** The rows, each as [the shot it frames, the side that shot sits on]. */
  const rows = rendered
    .filter((element) =>
      String(element.props?.className ?? '')
        .split(/\s+/)
        .some((token) => DIRECTIONS.includes(token)),
    )
    .map((element) => {
      const direction = String(element.props?.className)
        .split(/\s+/)
        .filter((token) => DIRECTIONS.includes(token))
      const stems = visibleElements(element)
        .filter((node) => node.type === ProductShot)
        .map((node) => String((node.props as unknown as ShotProps).shot.stem))
      return [stems.join(' + '), direction.join(' + ')]
    })

  test('alternate sides on desktop, as v1’s do', () => {
    // TOKEN-WISE AND PAIRED, not a substring count. `md:flex-row-reverse`
    // CONTAINS `md:flex-row`, so a substring test cannot tell the two apart at
    // all; and a bare count of each would be satisfied by two rows that had
    // swapped sides. Each row is named by the screenshot it frames, off the
    // same rendered tree the rest of this file walks, so the list is exhaustive
    // over the page: a fourth row, a deleted row, and a row that stopped
    // alternating are each red here.
    expect(rows).toEqual([
      ['board-entry', 'md:flex-row'],
      ['create-team', 'md:flex-row-reverse'],
      ['install-guide', 'md:flex-row'],
    ])
  })
})

// ---------------------------------------------------------------------------
// The carousel that was ruled out.
// ---------------------------------------------------------------------------

describe('the aceternity carousel stays out', () => {
  test('/about imports exactly four modules, and none is a carousel', () => {
    // NOT `expect(source).not.toContain('aceternity')`. That is a substring test
    // over a blob: it passes on a component imported under an alias, and it
    // goes RED on the file's own comment explaining why the dependency was
    // ruled out — which this file, of all files, contains. The import list is a
    // bounded array, so an ADDED dependency fails as loudly as a removed one,
    // and the reason `framer-motion` (the carousel's own dependency) is not
    // named here is that it does not need to be: nothing may appear in this
    // list without this test being edited.
    expect(importedModulesOf(ABOUT_SOURCE, read(ABOUT_SOURCE))).toEqual([
      '@tanstack/react-router',
      '#/components/home/product-shot.tsx',
      '#/lib/pro-benefits.ts',
      '#/lib/seo',
    ])
  })

  test('package.json has no aceternity or framer-motion dependency', () => {
    // The other end of it. wt-ksh.12.5 ruled the whole family out and Phase 7
    // Task 4 dropped HeroHighlight, BorderBeam and framer-motion; a dependency
    // that is installed but unimported is how it comes back one file at a time.
    const manifest = JSON.parse(read('../package.json')) as {
      dependencies: Record<string, string>
      devDependencies: Record<string, string>
    }
    const names = [
      ...Object.keys(manifest.dependencies),
      ...Object.keys(manifest.devDependencies),
    ]
    expect(names.filter((name) => /aceternity|framer-motion|^motion$/.test(name))).toEqual([])
  })
})

// ---------------------------------------------------------------------------
// The prose, which is what the screenshots are FOR.
// ---------------------------------------------------------------------------

/** One line per visible paragraph and heading, and one per link with its target. */
const paragraphs = rendered
  .filter((element) => element.type === 'p' || element.type === 'h1' || element.type === 'h2')
  .map((element) => inlineText(element))

const links = [
  ...rendered
    .filter((element) => element.type === 'a')
    .map((element) => `${inlineText(element)} -> ${String(element.props?.href)}`),
  ...rendered
    .filter((element) => element.type === Link)
    .map((element) => `${inlineText(element)} -> ${String(element.props?.to)}`),
]

describe('the walkthrough’s prose', () => {
  test('every line on the page, in order, and nothing else', () => {
    // A screenshot without its sentence is a picture of a dialog. `toEqual` on
    // the whole list keeps this exhaustive: a deleted paragraph, an added one
    // and a reworded one are all red. Walked from the tree rather than matched
    // in the source, because JSX collapses a newline-plus-indent to one space
    // and `{' '}` is a real space that no source-stripping produces.
    //
    // EVERY LINE BELOW IS SOURCED, and routes/about.tsx names the file each one
    // comes from in a comment beside it. That is the discipline this task
    // exists to install: six claims on this page were false, and the one thing
    // they had in common is that nobody could tell by reading them.
    expect(paragraphs).toEqual([
      'About',
      'Wordle Teams',
      'Wordle Teams is designed as a companion app to the New York Times Wordle game.*',
      "Play Wordle as you normally would in the official app or website, then come here to enter the day's answer and your guesses and see how you stack up against your friends.",
      'Enter the day’s board',
      'Pick the day, then type in the answer and the guesses you made. The board fills as you type and backspace goes back a letter, so it is about ten seconds and you never leave the keyboard.',
      'Get a team around you',
      'A scoreboard needs somebody to score against. Create a team and invite the people you already send your score to — by their email address, or by sharing a join link. If a friend invited you, they need the address you sign in with, or they can just send you the link. A free account can be on two teams.',
      'Put it on your home screen',
      'For a more app-like experience, install Wordle Teams to your home screen or desktop. Tap your browser’s three-dot menu or its Share icon, choose “Add to Home Screen” or “Install app”, then confirm. The same three steps live in the app under Settings, on the Install tab — open the menu at the top right.',
      'What Pro adds',
      'Everything above is free. Pro adds:',
      'See the full free and Pro comparison',
      "For any suggestions or issues, please see our Feedback page. You can also follow us on X (Twitter) and check out our Changelog to learn about new features as they're released.",
      'For those interested, this is an open source project on GitHub. Contributions are welcome.',
      '* Wordle Teams is not affiliated with New York Times or the official Wordle game',
    ])
  })

  test('the install step names the route that actually reaches the guide', () => {
    // THE CLAIM THIS PAGE SHIPPED FALSE. It read "the Install button in your
    // user dropdown at the top right"; wordle-teams-lyab replaced the user
    // dropdown with one Main menu and wordle-teams-mwu0 folded Install into the
    // settings dialog as a TAB, so both nouns in that sentence were wrong. Its
    // own test rather than a line of the array above, because the array is
    // exhaustive over WORDING and this is a claim about the PRODUCT: the two
    // fail for different reasons and a reader needs to know which.
    const install = paragraphs.find((line) => line.startsWith('For a more app-like experience'))
    expect(install).toBeDefined()
    expect(install).toContain('Settings')
    expect(install).toContain('Install tab')
    expect(install, 'the dropdown it named has not existed since wordle-teams-lyab').not.toContain(
      'dropdown',
    )
  })

  test('the three install steps are the ones the app’s own guide gives', () => {
    // settings/install-guide-tab.tsx is what the reader will see when they get
    // there, and a page that describes a different sequence sends them looking
    // for a control that is not in the menu they opened. Read from that file
    // rather than restated, so the day it changes this fails.
    const guide = read('./components/settings/install-guide-tab.tsx')
    for (const step of ['Add to Home Screen', 'Install app']) {
      expect(guide, `install-guide-tab.tsx no longer says "${step}"`).toContain(step)
      expect(paragraphs.join(' ')).toContain(step)
    }
  })

  test('“two teams” is pinned to FREE_TEAM_LIMIT, which no template literal can do', () => {
    // A NUMBER SPELLED AS A WORD — the problem lib/pro-benefits.ts, lib/plans.ts
    // and components/home/marketing-copy.ts all have, solved the same way. The
    // word says JOIN ("can be on"), not create, because the cap is enforced on
    // the join path and not on createTeam.
    expect(FREE_TEAM_LIMIT).toBe(2)
    expect(paragraphs.join(' ')).toContain('A free account can be on two teams')
  })
})

describe('the Pro section', () => {
  /** The list items the page renders under "What Pro adds". */
  const proItems = rendered
    .filter((element) => element.type === 'li')
    .map((element) => inlineText(element))

  test('is lib/pro-benefits.ts’s own list, in its order, not a retyped one', () => {
    // THE DEFECT THIS REPLACES, AND IT WAS THREE DEFECTS IN ONE SENTENCE. The
    // page said Pro unlocks "unlimited teams, access to all of your previous
    // months' scores, scoring system customization for your teams, and more".
    // The month window is TEAM-scoped and roster-derived, not the reader's own
    // history; custom scoring is the CURRENT month on a team you OWN; and "and
    // more" stood in for the two benefits a reader would most want named.
    // Rendering PRO_BENEFITS makes all three impossible rather than merely
    // corrected.
    expect(proItems).toEqual(PRO_BENEFITS.map((benefit) => benefit.title))
    expect(proItems.length).toBeGreaterThan(0)
  })

  test('no Pro claim is written by hand anywhere on the page', () => {
    // The positive test above passes on a page that ALSO carries a stale
    // hand-written sentence beside the generated list. "Unlimited" is the exact
    // word that was wrong here and on the landing page's feature cards before
    // it, and nothing in PRO_BENEFITS uses it.
    const source = read(ABOUT_SOURCE)
    const prose = source.slice(source.indexOf('function About()'))
    expect(prose.toLowerCase()).not.toContain('unlimited')
  })

  test('the tier question is handed to /pricing rather than answered twice', () => {
    // pro-benefits.ts's header says its consumers "describe one tier and must
    // not describe it twice"; components/home/marketing-copy.ts hands the same
    // question over with one link for the same reason. This page prints the
    // titles and sends the reader to the page whose whole job is the rest.
    expect(links).toContain('See the full free and Pro comparison -> /pricing')
  })
})

describe('the community section', () => {
  test('the four links point where they have always pointed', () => {
    // THE TARGET IS PART OF THE COPY. "check out our Changelog" pointing at the
    // feedback board is a page that lies about its own link, and the visible
    // text does not have to change for it — the same reason
    // src/legal-prose.test.ts inlines an <a>'s href next to its words.
    //
    // THE FOUR SCREENSHOTS THAT USED TO SIT UNDER THESE ARE GONE and the links
    // are not: they were hand-captured pictures of other people's websites that
    // no script here can re-shoot, and two of them had gone actively false —
    // the feedback board photographed as "No feedback yet", the README
    // photographed describing a Next.js and Supabase app.
    expect(links.filter((line) => line.includes('https://'))).toEqual([
      'Feedback -> https://feedback.wordleteams.com/feedback',
      'X (Twitter) -> https://x.com/wordleteams',
      'Changelog -> https://feedback.wordleteams.com/changelog',
      'GitHub -> https://github.com/cdub615/wordle-teams',
    ])
  })
})

// ---------------------------------------------------------------------------
// The comments that have to stay true.
// ---------------------------------------------------------------------------

describe('the route file’s own notes', () => {
  /**
   * The COMMENT TEXT, extracted, not the whole file: an assertion over the blob
   * would be satisfied — or broken — by the code underneath it. `codeOf` does
   * the opposite job and is no use here.
   */
  const comments = () => {
    const source = read(ABOUT_SOURCE)
    const text = [...source.matchAll(/\/\*[\s\S]*?\*\/|\/\/[^\n]*/g)]
      .map((match) => match[0])
      .join('\n')
    expect(text.length, 'no comments parsed out of the route file').toBeGreaterThan(500)
    return text
  }

  test('the reason the carousel is out is still written down', () => {
    // COMMENT ACCURACY IS TREATED AS A DEFECT IN THIS CODEBASE. wt-ksh.12.5's
    // decision is why this page has no marquee, and deleting the reason is how
    // the carousel comes back.
    expect(comments()).toContain('wt-ksh.12.5')
  })

  test('the phone-width limitation of these captures is still stated', () => {
    // wordle-teams-t40a: every file scripts/build-marketing-shots.mjs writes is
    // taken at a 1440x900 desktop viewport, and this page is read on a phone.
    // Clipping to a dialog shrinks that gap and does not close it, and a
    // comment that quietly stopped saying so would leave the next reader
    // believing it was fixed.
    expect(comments()).toContain('wordle-teams-t40a')
  })
})
