/**
 * WALKING A RENDERED ELEMENT TREE, FOR SUITES THAT PIN WHAT A PAGE ACTUALLY
 * SHOWS.
 *
 * vitest.config.ts sets `environment: 'edge-runtime'`, so nothing in this repo
 * can mount a component — there is no DOM. What a test CAN do is mock
 * `createFileRoute`, call the page component as the plain function it is, and
 * walk the React element tree it returns. src/legal-prose.test.ts introduced
 * that technique, src/login-error.test.ts extended it, and this module holds
 * the two pieces those suites and src/about-screenshots.test.ts share.
 *
 * WHY THE TREE AND NOT A REGEX OVER THE SOURCE. JSX whitespace is not something
 * a regex gets right: a newline-plus-indent between two words is ONE space,
 * leading and trailing whitespace containing a newline is dropped ENTIRELY, and
 * `{' '}` is a real space that no amount of source-stripping produces. The
 * compiler already knows all three rules. A tree walk also sees interpolated
 * values and `.map()`ed children, which a source match cannot.
 *
 * SAME RULE AS test-support/source-ast.ts: THESE ARE QUERIES, NEVER PROJECT
 * ASSERTIONS. Nothing here knows what any page says or which images it carries.
 * Each suite states its own expectations; this file only answers "what is in
 * this tree, and what of it can a user see".
 *
 * Nothing in the app imports this module, so it reaches no bundle, and the
 * vitest include glob matches only `.test.ts`, so it is not collected as a
 * suite of its own.
 */

export type Element = { type?: unknown; props?: Record<string, unknown> }

/**
 * Whether an element is hidden from the rendered page — the `hidden` DOM
 * attribute, or a Tailwind utility that hides it at any viewport.
 *
 * THE DIFFERENCE BETWEEN PINNING THE ELEMENT TREE AND PINNING THE PAGE. A
 * `hidden sm:flex` written by someone doing a responsive tweak deletes content
 * from what a user reads while leaving it exactly where a naive walker would
 * find it, and every gate stays green. That is not hypothetical: it is why
 * src/login-error.test.ts grew this predicate.
 *
 * TOKEN-WISE, not a substring test: `overflow-hidden` and `sm:overflow-hidden`
 * are visible elements and must not be dropped, while `hidden`, `sm:hidden` and
 * the `hidden` in `hidden sm:flex` must be. `aria-hidden` is a DIFFERENT KEY
 * and deliberately not matched — an element carrying it is still on the page
 * and still read by a sighted user.
 */
export function isHidden(props: Record<string, unknown> | undefined): boolean {
  if (props?.hidden) return true
  const className = props?.className
  if (typeof className !== 'string') return false
  return className.split(/\s+/).some((token) => token === 'hidden' || token.endsWith(':hidden'))
}

/** Concatenates every text leaf under a node, in document order. */
export function inlineText(node: unknown): string {
  const out: string[] = []
  const visit = (current: unknown): void => {
    if (current == null || typeof current === 'boolean') return
    if (typeof current === 'string' || typeof current === 'number') {
      out.push(String(current))
      return
    }
    if (Array.isArray(current)) {
      for (const child of current) visit(child)
      return
    }
    visit((current as Element).props?.children)
  }
  visit(node)
  return out.join('')
}

/**
 * Every element in the tree that a user can see, in document order.
 *
 * A HIDDEN ELEMENT TAKES ITS WHOLE SUBTREE WITH IT, which is the only reason
 * this is not four lines of `.filter()` at each call site: hiding a container
 * is how the images inside it stop being rendered, and a walker that recursed
 * past it would report them as present.
 *
 * COMPONENT ELEMENTS ARE NOT RENDERED. `type` is whatever JSX put there — a
 * string for a host element, a function or a symbol otherwise — and this walker
 * descends into `props.children` without calling anything. So a page that hides
 * its content behind a component this module cannot see reports nothing for it,
 * rather than reporting something wrong; the caller's own count assertion is
 * what turns that into a failure.
 */
export function visibleElements(node: unknown): Element[] {
  const out: Element[] = []
  const visit = (current: unknown): void => {
    if (current == null || typeof current === 'boolean') return
    if (typeof current === 'string' || typeof current === 'number') return
    if (Array.isArray(current)) {
      for (const child of current) visit(child)
      return
    }
    const element = current as Element
    if (isHidden(element.props)) return
    if (element.type !== undefined) out.push(element)
    visit(element.props?.children)
  }
  visit(node)
  return out
}
