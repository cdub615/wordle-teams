import { readFileSync, writeFileSync } from 'node:fs'
import { describe, expect, test, vi } from 'vitest'

/**
 * THE ONE FILE IN THIS REPO WHERE AN UNNOTICED CHANGE IS WORSE THAN A BROKEN
 * ONE, AND UNTIL THIS TEST IT WAS THE ONE FILE WITH NO ASSERTION.
 *
 * src/routes/privacy.tsx and src/routes/terms.tsx both open with "THE PROSE IS
 * COPIED VERBATIM AND MUST STAY THAT WAY" in capitals, and nothing enforced it.
 * The Phase 7 Task 5 review ran 17 mutations against those two files. These
 * survived all four gates AND all 49 e2e specs:
 *
 *   - deleting the entire <h2>Termination</h2> section from the Terms — the
 *     clause governing suspension of access and the survival of the warranty
 *     disclaimers, indemnity and limitation of liability;
 *   - `royalty-free` -> `royalty-bearing` in the User Content licence grant;
 *   - "We take reasonable steps to protect your information" -> "We take no
 *     steps to protect your information";
 *   - repointing the privacy contact at a mailbox that does not exist;
 *   - changing the Effective Date;
 *   - deleting a list item from Prohibited Conduct.
 *
 * Every one of those is a change to a published legal document — the versions
 * live at wordleteams.com/privacy and /terms, effective 2024-05-21 — and every
 * one of them shipped green. e2e only ever asserted the h1, the <title> and the
 * cache headers, and CI does not run e2e anyway
 * (.github/workflows/deploy-v2.yml is lint, typecheck, `vitest run`, build).
 *
 * A FIXTURE, NOT A HASH, and both reasons are load-bearing. A hash tells a
 * reviewer that something moved; the fixture diff tells them WHICH CLAUSE
 * moved, which is the only form in which "the Termination section is gone" is
 * legible. And when the owner amends the text — `wordle-teams-4yt` is open on
 * exactly that: the policy names Apple and Facebook as sign-in providers, which
 * have never existed — regenerating the fixture is the deliberate act that
 * records the amendment in the diff, next to the prose change itself.
 *
 * EXTRACTION: THE REAL ELEMENT TREE, NOT A REGEX OVER THE SOURCE.
 *
 * The route module is compiled by the same JSX transform that ships it, its
 * component is called as the plain function it is (no hooks, no props, no
 * router), and the returned React element tree is walked. That matters because
 * JSX whitespace is not something a regex gets right: a newline-plus-indent
 * between two words is ONE space, leading and trailing whitespace that contains
 * a newline is dropped ENTIRELY, and `{' '}` — which both Contact Us sections
 * use — is a real space that no amount of source-stripping will produce. The
 * compiler already knows all three rules; nothing here re-derives them. It also
 * decodes `&quot;` and `&apos;`, so the fixture holds the characters a reader
 * sees rather than the entities the source spells them with.
 *
 * `createFileRoute` is the one thing that cannot run under vitest — it
 * registers against a router that does not exist here, which is why
 * src/routes.test.ts reads its route files as strings — so it is mocked to hand
 * back the options object, and nothing else about either module is stubbed.
 *
 * WHAT A LINE IS: one block-level element (h1, h2, p, li), prefixed with its
 * tag and carrying the concatenated text of everything inline inside it —
 * <strong>, <a>, nested text. So the fixture pins the heading LEVEL of every
 * heading as well as its words, and a paragraph promoted to a heading is a
 * diff. An <a>'s href follows its text in angle brackets, because a mailto
 * repointed at a mailbox nobody reads is exactly the mutation above and the
 * visible text does not have to change for it.
 *
 * Text found outside any block element is emitted as `text:` rather than
 * dropped: an extractor that silently loses prose is the one failure mode that
 * would make this whole file decorative.
 *
 * TO AMEND THE PROSE: edit the route, then run
 *   UPDATE_LEGAL_PROSE=1 pnpm vitest run src/legal-prose.test.ts
 * and commit the regenerated fixture alongside it.
 */

// Hoisted above the imports below by vitest, which is what makes them resolve.
vi.mock('@tanstack/react-router', () => ({
  createFileRoute: () => (options: unknown) => ({ options }),
}))

import { Route as PrivacyRoute } from './routes/privacy'
import { Route as TermsRoute } from './routes/terms'

/** The tags that get a line of their own. Everything else is inline. */
const BLOCKS = new Set(['h1', 'h2', 'h3', 'h4', 'h5', 'h6', 'p', 'li'])

type Element = { type?: unknown; props?: Record<string, unknown> }

/** Concatenates every text leaf under a node, in document order. */
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
  const element = node as Element
  inlineText(element.props?.children, out)
  if (element.type === 'a' && typeof element.props?.href === 'string') {
    out.push(` <${element.props.href}>`)
  }
}

/** One line per block element: `tag: text`. */
function blockLines(node: unknown, out: string[]): void {
  if (node == null || typeof node === 'boolean') return
  if (typeof node === 'string' || typeof node === 'number') {
    const stray = String(node).trim()
    if (stray) out.push(`text: ${stray}`)
    return
  }
  if (Array.isArray(node)) {
    for (const child of node) blockLines(child, out)
    return
  }
  const element = node as Element
  if (typeof element.type === 'string' && BLOCKS.has(element.type)) {
    const parts: string[] = []
    inlineText(element, parts)
    out.push(`${element.type}: ${parts.join('')}`)
    return
  }
  blockLines(element.props?.children, out)
}

function proseOf(route: { options: { component?: unknown } }): string {
  const component = route.options.component as (() => unknown) | undefined
  expect(component, 'the route declares no component').toBeTypeOf('function')
  const lines: string[] = []
  blockLines(component!(), lines)
  return `${lines.join('\n')}\n`
}

function expectProse(fixture: string, route: { options: { component?: unknown } }) {
  const path = new URL(fixture, import.meta.url)
  const prose = proseOf(route)

  if (process.env.UPDATE_LEGAL_PROSE) writeFileSync(path, prose)

  expect(
    prose,
    `The legal prose no longer matches src/${fixture.replace('./', '')}. This is a ` +
      'PUBLISHED legal document, not app copy — see the note at the top of the route ' +
      'file. If the change is a deliberate amendment, regenerate the fixture with ' +
      'UPDATE_LEGAL_PROSE=1 and commit it with the prose.',
  ).toBe(readFileSync(path, 'utf8'))
}

describe('the published legal prose, pinned verbatim', () => {
  test('/privacy is word for word the policy v1 serves', () => {
    expectProse('./legal-prose.privacy.txt', PrivacyRoute)
  })

  test('/terms is word for word the agreement v1 serves', () => {
    expectProse('./legal-prose.terms.txt', TermsRoute)
  })
})
