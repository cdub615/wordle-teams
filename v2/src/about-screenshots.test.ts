import { readFileSync } from 'node:fs'
import { describe, expect, test, vi } from 'vitest'
import { inlineText, isHidden, visibleElements } from './test-support/element-tree'
import { importedModulesOf } from './test-support/source-ast'

/**
 * THE EIGHT PRODUCT SCREENSHOTS ON /about, AND THE THREE WAYS THEY BREAK
 * SILENTLY.
 *
 * WHY THIS IS A UNIT TEST. .github/workflows/deploy-v2.yml runs lint,
 * typecheck, `vitest run` and build, then deploys and smoke-tests /login. IT
 * RUNS NO PLAYWRIGHT (wt-ksh.8.49), so an e2e-only protection is not a gate —
 * it is a thing somebody may run. Everything in this file is reachable from
 * `vitest run`, which is.
 *
 * THE THREE FAILURES, none of which any other gate can see:
 *
 *   1. AN <img> POINTING AT A FILE public/ DOES NOT HOLD. `src` is a string;
 *      tsc has no opinion about it, eslint has no opinion about it, and the
 *      build copies public/ wholesale without checking that anything refers to
 *      what is in it. The page renders, the alt text shows, and the screenshot
 *      is a broken-image icon. Every read below resolves the path THE PAGE
 *      CARRIES against public/ — never an independent literal, which would go
 *      on reading the right file no matter where `src` pointed. This is the
 *      same construction crawler-metadata.test.ts uses for OG_IMAGE_FILE, and
 *      for the same reason.
 *
 *   2. A width/height PAIR THAT IS NOT THE FILE'S. These attributes exist to
 *      give the browser an aspect ratio to reserve space with; a wrong pair
 *      reserves the wrong box and the page still reflows — worse, it reflows
 *      into a shape somebody deliberately wrote down, so it reads as correct.
 *      Copied-from-the-neighbouring-image is the realistic mistake and it is
 *      invisible to review. So the numbers are checked against the PNG's IHDR
 *      chunk, which is the file's own account of its size.
 *
 *   3. THE ALT TEXT QUIETLY CHANGING. It is the accessible description of the
 *      product, it was already written in v1, and nothing renders it for a
 *      sighted reviewer to notice.
 *
 * ASSERTED ON THE RENDERED ELEMENT TREE, NOT ON THE SOURCE. The component is
 * called as the plain function it is and the tree it returns is walked
 * (src/test-support/element-tree.ts). That is what makes the four `.map()`ed
 * community images assertable at all, and it is what makes the walk
 * HIDDEN-AWARE: a `hidden sm:flex` on the community grid would delete four
 * screenshots from the page while leaving them exactly where a source match
 * would find them.
 *
 * `createFileRoute` is the one thing that cannot run under vitest — it
 * registers against a router that does not exist here — so it is mocked to hand
 * back the options object, exactly as src/legal-prose.test.ts does. Reading the
 * component back off `Route.options` rather than exporting it separately also
 * means a component detached from its route is a failure here.
 */

// Hoisted above the imports below by vitest, which is what makes them resolve.
vi.mock('@tanstack/react-router', () => ({
  createFileRoute: () => (options: unknown) => ({ options }),
}))

import { Route } from './routes/about'

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

interface Shot {
  src: string
  alt: string
  width: unknown
  height: unknown
  loading: unknown
}

/** Every visible <img> on the page, in document order, as plain data. */
const shots: Shot[] = rendered
  .filter((element) => element.type === 'img')
  .map((element) => ({
    src: String(element.props?.src),
    alt: String(element.props?.alt),
    width: element.props?.width,
    height: element.props?.height,
    loading: element.props?.loading,
  }))

/** The file on disk for a shot, DERIVED FROM THE `src` THE PAGE CARRIES. */
const fileFor = (shot: Shot) => new URL(`../public${shot.src}`, import.meta.url)

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
 * extractor that reported hidden images as present would make the whole file
 * decorative. src/login-error.test.ts pins the same predicate through its own
 * line walker; these pin the piece THIS file depends on — that a hidden
 * container takes its images with it.
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

  test('a hidden container takes its images with it', () => {
    // THE CASE THIS FILE ACTUALLY RELIES ON. The four community shots are
    // rendered from a `.map()` inside one grid div; hiding that div is one
    // className away and removes four screenshots from the page.
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
    // src/routes uses dynamic import, and /about is a static page with two
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
// The eight screenshots.
// ---------------------------------------------------------------------------

describe('the eight product screenshots v1 annotates its About page with', () => {
  test('all eight are on the page, in v1’s order, with v1’s alt text verbatim', () => {
    // ONE toEqual OVER THE WHOLE LIST rather than eight toContain calls: a
    // reorder, a deletion and a duplicate all have to fail, and only the full
    // ordered list does that. The alt strings are v1's own, character for
    // character — they are the accessible description of the product and they
    // were already written.
    expect(shots.map((shot) => [shot.src, shot.alt])).toEqual([
      ['/board-entry.png', 'board entry screenshot'],
      ['/install-button.png', 'install button screenshot'],
      ['/create-team.png', 'create team screenshot'],
      ['/upgrade-button.png', 'upgrade button screenshot'],
      ['/feedback-page.png', 'feedback screenshot'],
      ['/changelog-page.png', 'changelog screenshot'],
      ['/twitter-acct.png', 'twitter account screenshot'],
      ['/github-repo.png', 'github repo screenshot'],
    ])
  })

  test('every src names a PNG that public/ really holds', () => {
    // readFileSync THROWING IS THE ASSERTION — a byteLength check underneath it
    // would be unreachable, which is how a version of this test in
    // crawler-metadata.test.ts once managed to assert nothing at all. The path
    // is derived from the page's own `src`, so repointing an image at a file
    // that is not there is an ENOENT naming the file.
    for (const shot of shots) {
      expect(() => readFileSync(fileFor(shot)), `${shot.src} is not in public/`).not.toThrow()
    }
    // So that "every one of zero images exists" cannot be the thing that passes.
    expect(shots).toHaveLength(8)
  })

  test('every declared width and height is the pair inside the PNG itself', () => {
    // THE CHECK THE REST OF THE FILE CANNOT MAKE. Nothing else in this repo can
    // tell a correct pair from a plausible one — and a wrong pair is worse than
    // none, because it reserves a box of the wrong shape and the page reflows
    // anyway, into a layout somebody wrote down on purpose.
    const declared = shots.map((shot) => [shot.src, shot.width, shot.height])
    const actual = shots.map((shot) => {
      const { width, height } = pngSize(fileFor(shot))
      return [shot.src, width, height]
    })
    expect(declared).toEqual(actual)
  })

  test('the numbers are spelled out here too, so both sides cannot move together', () => {
    // The test above compares the page against the files. If somebody replaces
    // a screenshot with a differently-sized one and updates the attributes to
    // match, that test stays green — correctly, because the page is still
    // consistent. This one makes swapping an asset a deliberate act with a
    // failing test attached, the way legal-prose.test.ts's fixture does.
    expect(shots.map((shot) => [shot.src, shot.width, shot.height])).toEqual([
      ['/board-entry.png', 518, 708],
      ['/install-button.png', 234, 189],
      ['/create-team.png', 521, 312],
      ['/upgrade-button.png', 234, 189],
      ['/feedback-page.png', 786, 748],
      ['/changelog-page.png', 747, 704],
      ['/twitter-acct.png', 604, 604],
      ['/github-repo.png', 900, 900],
    ])
  })

  test('all eight declare loading="lazy"', () => {
    // 462 KiB across eight files on a marketing page whose whole job is to load
    // fast — wordle-teams-jcj is this project's open wound about exactly that.
    // Seven are below the fold at any viewport and the eighth is at it, so the
    // browser's own lazy threshold decides that one — which is why the name
    // above claims only what the assertion checks, and not that none of these
    // is the page's first paint. Nothing but this notices `loading` being
    // dropped.
    expect(shots.map((shot) => shot.loading)).toEqual(Array(8).fill('lazy'))
  })
})

// ---------------------------------------------------------------------------
// The desktop zig-zag, which is what makes the DOM reorder defensible.
// ---------------------------------------------------------------------------

/**
 * src/routes/about.tsx's header justifies putting the text ahead of the image
 * on every row — where v1 uses `flex-col-reverse` and so leads with the image
 * on two of four — with two claims: reading order matches DOM order, and THE
 * DESKTOP ZIG-ZAG IS UNCHANGED. The first falls out of the ordering itself. The
 * second is the half that makes the divergence a layout-neutral one, and until
 * this block existed nothing asserted it: replacing every `md:flex-row-reverse`
 * with `md:flex-row` stacks all four rows the same way — a layout v1 explicitly
 * does not have — and the whole suite stays green.
 */
describe('the four annotated rows', () => {
  const DIRECTIONS = ['md:flex-row', 'md:flex-row-reverse']

  /** The rows, each as [the alt text it frames, the side its image sits on]. */
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
      const alts = visibleElements(element)
        .filter((node) => node.type === 'img')
        .map((node) => String(node.props?.alt))
      return [alts.join(' + '), direction.join(' + ')]
    })

  test('alternate sides on desktop, as v1’s do', () => {
    // TOKEN-WISE AND PAIRED, not a substring count. `md:flex-row-reverse`
    // CONTAINS `md:flex-row`, so a substring test cannot tell the two apart at
    // all; and a bare count of each would be satisfied by two rows that had
    // swapped sides. Each row is named by the screenshot it frames, off the
    // same rendered tree the rest of this file walks, so the list is exhaustive
    // over the page: a fifth row, a deleted row, and a row that stopped
    // alternating are each red here.
    //
    // The community grid is deliberately absent — it is a `grid`, not a row,
    // and v1 has a carousel there rather than a side.
    expect(rows).toEqual([
      ['board entry screenshot', 'md:flex-row'],
      ['install button screenshot', 'md:flex-row-reverse'],
      ['create team screenshot', 'md:flex-row'],
      ['upgrade button screenshot', 'md:flex-row-reverse'],
    ])
  })
})

// ---------------------------------------------------------------------------
// The carousel that was ruled out.
// ---------------------------------------------------------------------------

describe('the aceternity carousel stays out', () => {
  test('/about imports exactly two modules, and neither is a carousel', () => {
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
      '#/lib/seo',
    ])
  })

  test('package.json has no aceternity or framer-motion dependency', () => {
    // The other end of it. wt-ksh.12.5 ruled the whole family out and Task 4
    // dropped HeroHighlight, BorderBeam and framer-motion; a dependency that is
    // installed but unimported is how it comes back one file at a time.
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
// The annotations, which are what the screenshots are FOR.
// ---------------------------------------------------------------------------

/** One line per visible paragraph, and one per link with its target. */
const paragraphs = rendered
  .filter((element) => element.type === 'p')
  .map((element) => inlineText(element))

const links = rendered
  .filter((element) => element.type === 'a')
  .map((element) => `${inlineText(element)} -> ${String(element.props?.href)}`)

describe('the annotations beside the screenshots', () => {
  test('v1’s prose is on the page, in order, and nothing else is', () => {
    // A screenshot without its sentence is a picture of a button. `toEqual` on
    // the whole list keeps this exhaustive: a deleted paragraph, an added one
    // and a reworded one are all red. Walked from the tree rather than matched
    // in the source, because JSX collapses a newline-plus-indent to one space
    // and `{' '}` is a real space that no source-stripping produces.
    expect(paragraphs).toEqual([
      'About',
      'Wordle Teams is designed as a companion app to the New York Times Wordle game.*',
      "Play Wordle as you normally would in the official app or website, then come here to enter the day's answer and your guesses and see how you stack up against your friends.",
      'For a more app-like experience, you can install Wordle Teams to your home screen or desktop using the instructions from the Install button in your user dropdown at the top right.',
      "To get started, you'll need to either create a team, or ask for an invite to an existing team if you heard about us from a friend. They'll just need the email you used to sign in.",
      "Upgrade to unlock unlimited teams, access to all of your previous months' scores, scoring system customization for your teams, and more.",
      "For any suggestions or issues, please see our Feedback page. You can also follow us on X (Twitter) and check out our Changelog to learn about new features as they're released.",
      'For those interested, this is an open source project on GitHub. Contributions are welcome.',
      '* Wordle Teams is not affiliated with New York Times or the official Wordle game',
    ])
  })

  test('the create-team sentence does not promise a button this page has not got', () => {
    // v1 says "create a team (button below)". v1's /about is behind a session
    // and passes in a "Go to Dashboard" button, so the parenthetical does not
    // describe v1's own control either; v2's /about is public and has no button
    // at all. Its own test rather than a line of the array above, because this
    // is a DELIBERATE divergence from a verbatim port and "restoring" it would
    // otherwise look like fixing a typo.
    expect(paragraphs.some((line) => line.includes('(button below)'))).toBe(false)
    expect(paragraphs.some((line) => line.includes("you'll need to either create a team,"))).toBe(
      true,
    )
  })

  test('the four community links point where v1 points them', () => {
    // THE TARGET IS PART OF THE COPY. "check out our Changelog" pointing at the
    // feedback board is a page that lies about its own link, and the visible
    // text does not have to change for it — the same reason
    // src/legal-prose.test.ts inlines an <a>'s href next to its words.
    expect(links).toEqual([
      'Feedback -> https://feedback.wordleteams.com/feedback',
      'X (Twitter) -> https://x.com/wordleteams',
      'Changelog -> https://feedback.wordleteams.com/changelog',
      'GitHub -> https://github.com/cdub615/wordle-teams',
    ])
  })
})

// ---------------------------------------------------------------------------
// The comment that stopped being true.
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

  test('no comment still claims the screenshots are missing', () => {
    // COMMENT ACCURACY IS TREATED AS A DEFECT IN THIS CODEBASE, and the note
    // this replaces — "this is the SUBSTANCE of v1's About page, not the whole
    // thing ... porting that marketing surface belongs to Phase 7" — was true
    // right up until the commit that added the images, at which point nothing
    // would have flagged it.
    expect(comments()).not.toContain('SUBSTANCE of v1')
    expect(comments()).not.toContain('belongs to Phase 7')
  })

  test('the reason the carousel is out is still written down', () => {
    // ITS OWN TEST, because it is the opposite assertion to the one above and
    // the name up there described only that one. wt-ksh.12.5's decision is why
    // the four community images are a grid, and deleting the reason is how the
    // carousel comes back.
    expect(comments()).toContain('wt-ksh.12.5')
  })
})
