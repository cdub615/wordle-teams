import { readFileSync } from 'node:fs'
import { describe, expect, test, vi } from 'vitest'

/**
 * WHAT /maintenance SAYS, AND THE UNDEFINED-TOKEN TRAP IT WAS PORTED OUT OF.
 *
 * TWO SENTENCES ARE THE WHOLE PAGE. It is the only thing a visitor sees during
 * an outage, so "Coming Soon" quietly becoming an empty island — a `hidden`
 * utility from a responsive tweak, a deleted line — is the entire feature
 * failing while every gate stays green. .github/workflows/deploy-v2.yml runs
 * lint, typecheck, `vitest run` and build, and no Playwright (wt-ksh.8.49), so
 * this is the layer that can see it.
 *
 * THE ELEMENT TREE, WALKED — the technique src/login-error.test.ts and
 * src/legal-prose.test.ts both use, and for the same reason: JSX whitespace is
 * not something a regex gets right. The walker here is a cut-down copy rather
 * than a shared import, because this page has no links and no interpolation and
 * needs neither half of the bigger one; the part that is NOT dropped is the
 * hidden check, which is the one that catches a sentence disappearing.
 *
 * `createFileRoute` is mocked because it registers against a router that does
 * not exist under vitest. Nothing else is stubbed.
 */

vi.mock('@tanstack/react-router', () => ({
  createFileRoute: () => (options: unknown) => ({ options }),
}))

import { MaintenancePage, Route } from './routes/maintenance'

const BLOCKS = new Set(['h1', 'h2', 'h3', 'p'])

type Element = { type?: unknown; props?: Record<string, unknown> }

/** Every text leaf under a node, concatenated in document order. */
function inlineText(node: unknown, out: string[]): void {
  if (node == null || typeof node === 'boolean') return
  if (typeof node === 'string' || typeof node === 'number') {
    out.push(String(node))
    return
  }
  if (Array.isArray(node)) {
    for (const child of node) inlineText(child, out)
    return
  }
  inlineText((node as Element).props?.children, out)
}

/**
 * Hidden from the rendered page: the `hidden` DOM attribute, or a Tailwind
 * utility that hides at any viewport. Token-wise, so `overflow-hidden` stays
 * visible; `aria-hidden` is a different key and deliberately not matched.
 */
function isHidden(props: Record<string, unknown> | undefined): boolean {
  if (props?.hidden) return true
  const className = props?.className
  if (typeof className !== 'string') return false
  return className.split(/\s+/).some((token) => token === 'hidden' || token.endsWith(':hidden'))
}

function lines(node: unknown, out: string[]): void {
  if (node == null || typeof node === 'boolean') return
  if (typeof node === 'string' || typeof node === 'number') {
    const stray = String(node).trim()
    if (stray) out.push(`text: ${stray}`)
    return
  }
  if (Array.isArray(node)) {
    for (const child of node) lines(child, out)
    return
  }
  const element = node as Element
  if (isHidden(element.props)) return
  if (typeof element.type === 'string' && BLOCKS.has(element.type)) {
    const parts: string[] = []
    inlineText(element, parts)
    out.push(`${element.type}: ${parts.join('')}`)
    return
  }
  lines(element.props?.children, out)
}

/** Depth-first search for the single element of a given tag. */
function findElement(node: unknown, tag: string): Element | undefined {
  if (node == null || typeof node !== 'object') return undefined
  if (Array.isArray(node)) {
    for (const child of node) {
      const found = findElement(child, tag)
      if (found) return found
    }
    return undefined
  }
  const element = node as Element
  if (element.type === tag) return element
  return findElement(element.props?.children, tag)
}

describe('the page a visitor gets during an outage', () => {
  test('says exactly what v1 said, and nothing else', () => {
    // v1's src/components/maintenance.tsx, word for word. Exhaustive with
    // toEqual, so a deleted line, an added one and a reworded one are all red —
    // an empty island during an outage is indistinguishable from the site
    // simply being broken, which is the failure this page exists to prevent.
    const out: string[] = []
    lines(MaintenancePage(), out)
    expect(out).toEqual(['h1: Coming Soon', 'p: Site is under construction'])
  })

  test('inherits the site default title rather than declaring one', () => {
    // v1's src/app/maintenance/ has page.tsx and error.tsx and NO layout.tsx,
    // so the page inherits the root metadata title. Pinned because the obvious
    // "improvement" is to add head: () => pageTitle('Maintenance') — which is
    // the string a browser then autocompletes for months after the outage.
    expect(Object.keys((Route as unknown as { options: object }).options)).toEqual(['component'])
  })

  test('the icon is decorative and takes its colour from the text token', () => {
    // aria-hidden because the h1 already says what the page is; a screen reader
    // announcing a users glyph ahead of "Coming Soon" is noise. `currentColor`
    // is what makes the class below the single source of the colour.
    const svg = findElement(MaintenancePage(), 'svg')
    expect(svg, 'the icon is gone from the page').toBeDefined()
    expect(svg!.props?.['aria-hidden']).toBe('true')
    expect(svg!.props?.fill).toBe('currentColor')
    expect(String(svg!.props?.className).split(/\s+/)).toContain('text-accent-solid')
  })
})

describe('the gradient v1 painted this icon with, which does not exist here', () => {
  /**
   * Comments stripped, so this reads the CODE — the pattern src/routes.test.ts
   * uses for the same reason. The route file's own prose QUOTES
   * `hsl(var(--color-stop-1))` while explaining why it is gone, and a scan that
   * counted that would be red on a correct file.
   */
  const source = readFileSync(new URL('./routes/maintenance.tsx', import.meta.url), 'utf8')
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/\/\/[^\n]*/g, '')
  const css = readFileSync(new URL('./styles.css', import.meta.url), 'utf8')

  const declared = new Set(
    [...css.matchAll(/(--[a-z0-9-]+)\s*:/g)].map((match) => match[1]),
  )

  test("v2 really has no --color-stop-* tokens, which is what makes v1's markup unportable", () => {
    // The premise of the test below, asserted rather than assumed. v1 declares
    // --color-stop-1/-2/-3 in src/app/globals.css and its Maintenance component
    // reads all three as `hsl(var(--color-stop-N))`. Copying that markup across
    // gives three CSS variables with no declaration — and an SVG <stop> with no
    // resolvable stop-color paints BLACK, so the outage page would open with a
    // black blob on it.
    for (const token of ['--color-stop-1', '--color-stop-2', '--color-stop-3'])
      expect(declared.has(token), `${token} is declared in v2 after all`).toBe(false)
  })

  test('every custom property the route names is one styles.css declares', () => {
    // Not "there is no gradient" — the route is allowed to grow a var() the day
    // someone defines the stops properly. What it may never do is reference one
    // that resolves to nothing, which is exactly the defect the port started
    // from. Empty today, and red the moment an undefined token comes back.
    const referenced = [...source.matchAll(/var\(\s*(--[a-z0-9-]+)/g)].map((match) => match[1])
    expect(referenced.filter((token) => !declared.has(token))).toEqual([])
  })
})
