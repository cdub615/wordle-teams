import { describe, expect, test, vi } from 'vitest'

/**
 * WHAT /login-error ACTUALLY SAYS, AND WHAT IT WILL ACCEPT FROM A QUERY STRING.
 *
 * THE COPY IS THE PRODUCT HERE. This page has no function beyond four sentences
 * and a link: a user reaches it only after a sign-in has failed, and the two
 * asterisked notes are the only thing on the site that tells them WHICH failure
 * they are looking at and whether waiting or retrying is the answer. A silently
 * deleted note is the same class of defect as the deleted Termination clause
 * that src/legal-prose.test.ts exists because of — and it is reached by exactly
 * the same road, since .github/workflows/deploy-v2.yml runs lint, typecheck,
 * `vitest run` and build, and never Playwright.
 *
 * SAME EXTRACTION TECHNIQUE AS src/legal-prose.test.ts, DELIBERATELY: the real
 * element tree, walked, rather than a regex over the source. JSX whitespace is
 * not something a regex gets right — a newline-plus-indent between two words is
 * ONE space and leading/trailing whitespace containing a newline is dropped
 * ENTIRELY — and this page additionally INTERPOLATES a number, so the sentence
 * a user reads exists nowhere in the source at all. The compiler already knows
 * all of that; nothing here re-derives it.
 *
 * AN INLINE EXPECTATION, NOT A SIDECAR FIXTURE, which is the one place this
 * departs from legal-prose.test.ts. That file pins two published legal
 * documents of ~60 lines each, where the diff of a regenerated fixture is the
 * only legible form of "which clause moved". Six lines are more legible in the
 * assertion than in a file next door, and there is no amendment ceremony to
 * host: this is app copy, and changing it is a code review, not a policy
 * change. `toEqual` on the whole array keeps it exhaustive either way — a
 * deleted note, an added line and a reworded sentence are all red.
 *
 * `createFileRoute` is the one thing that cannot run under vitest — it
 * registers against a router that does not exist here — so it is mocked to hand
 * back the options object, exactly as legal-prose.test.ts does. `Link` is
 * mocked to a plain 'a' so the walker below can read its target; nothing else
 * about the module is stubbed, and Button is the real one.
 */

// Hoisted above the imports below by vitest, which is what makes them resolve.
vi.mock('@tanstack/react-router', () => ({
  createFileRoute: () => (options: unknown) => ({ options }),
  Link: 'a',
}))

import { LoginErrorPage, Route } from './routes/login-error'
import { OTP_EXPIRY_LABEL } from '../convex/lib/otpExpiry.ts'

/** The tags that get a line of their own. Everything else is inline. */
const BLOCKS = new Set(['h1', 'h2', 'h3', 'p', 'li'])

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
  inlineText((node as Element).props?.children, out)
}

/**
 * One line per block element (`tag: text`), plus one per link
 * (`link: text -> target`).
 *
 * THE LINK'S TARGET IS PART OF THE COPY, not separate from it. "Head to Sign
 * In" pointing at /app is a page that lies about where its only control goes,
 * and the visible text does not have to change for it — which is the same
 * reason src/legal-prose.test.ts inlines an <a>'s href next to its words.
 *
 * Text found outside any block or link is emitted as `text:` rather than
 * dropped: an extractor that silently loses prose would make this whole file
 * decorative.
 *
 * A HIDDEN SUBTREE CONTRIBUTES NOTHING, which is the difference between pinning
 * the element tree and pinning the PAGE. `hidden` or a `hidden` Tailwind
 * utility on either asterisked note deletes it from what a user reads while
 * leaving it exactly where this walker would find it — and the realistic way
 * that happens is not malice but a responsive tweak, `hidden sm:flex`, written
 * by someone who did not know these two sentences are the product. The e2e
 * `toBeVisible()` assertions do catch it; e2e is not one of the four gates
 * (wt-ksh.8.49), which is the premise this entire file is written on.
 */

/**
 * Whether an element is hidden from the rendered page — the `hidden` DOM
 * attribute, or a Tailwind utility that hides it at any viewport.
 *
 * TOKEN-WISE, not a substring test: `overflow-hidden` and `sm:overflow-hidden`
 * are visible elements and must not be dropped, while `hidden`, `sm:hidden` and
 * the `hidden` in `hidden sm:flex` must be. `aria-hidden` is a DIFFERENT KEY
 * and deliberately not matched — the kicker carries it, the sentence is still
 * on the page, and GENERIC below still expects it.
 */
function isHidden(props: Record<string, unknown> | undefined): boolean {
  if (props?.hidden) return true
  const className = props?.className
  if (typeof className !== 'string') return false
  return className
    .split(/\s+/)
    .some((token) => token === 'hidden' || token.endsWith(':hidden'))
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
  if (element.type === 'a') {
    const parts: string[] = []
    inlineText(element, parts)
    out.push(`link: ${parts.join('')} -> ${String(element.props?.to)}`)
    return
  }
  if (typeof element.type === 'string' && BLOCKS.has(element.type)) {
    const parts: string[] = []
    inlineText(element, parts)
    out.push(`${element.type}: ${parts.join('')}`)
    return
  }
  lines(element.props?.children, out)
}

const linesFor = (error?: string) => {
  const out: string[] = []
  lines(LoginErrorPage({ error }), out)
  return out
}

/**
 * v1's src/app/login-error/page.tsx, word for word, EXCEPT that v1 promises the
 * passcode lasts "1 hour" and this deployment expires it in five — see the note
 * at the top of the route. The five is written out here rather than computed
 * from OTP_EXPIRY_SEC on purpose: this array is the sentence a user reads, and
 * a test that recomputes the number cannot tell a page that moved with the
 * constant from a page that lies. Moving the constant SHOULD turn this red, so
 * that whoever moves it reads the sentence.
 */
const GENERIC = [
  'p: Sign in',
  'h1: Sign In Failed',
  'p: Please try again',
  'p: * sometimes the first login with a sign in provider fails when redirecting to Wordle Teams.',
  'p: * a One Time Passcode (OTP) will expire after 5 minutes. If your email has been delayed you may need to try again.',
  'link: Head to Sign In -> /login',
]

/**
 * THE WALKER'S OWN CONTRACT, asserted on a hand-built tree rather than on the
 * page.
 *
 * Everything below this block is only as good as the extractor, and an
 * extractor that quietly kept hidden prose would make the whole file
 * decorative — which is the failure `isHidden` was added for. These cases are
 * the boundary: what counts as hidden, and just as importantly what does not.
 */
describe('the extractor, on what a user can and cannot see', () => {
  const walk = (node: unknown) => {
    const out: string[] = []
    lines(node, out)
    return out
  }
  const p = (props: Record<string, unknown>) => ({ type: 'p', props })

  test('a visible paragraph is a line', () => {
    expect(walk(p({ children: 'shown' }))).toEqual(['p: shown'])
  })

  test('the hidden attribute removes it', () => {
    expect(walk(p({ hidden: true, children: 'gone' }))).toEqual([])
  })

  test('a hidden utility class removes it, at any breakpoint', () => {
    // `hidden sm:flex` is the realistic one: hidden on phones, visible above.
    expect(walk(p({ className: 'hidden sm:flex', children: 'gone' }))).toEqual([])
    expect(walk(p({ className: 'sm:hidden', children: 'gone' }))).toEqual([])
    expect(walk(p({ className: 'mt-4 hidden', children: 'gone' }))).toEqual([])
  })

  test('a hidden container takes its children with it', () => {
    const container = { type: 'div', props: { className: 'hidden', children: p({ children: 'x' }) } }
    expect(walk(container)).toEqual([])
  })

  test('overflow-hidden is not hidden, and neither is aria-hidden', () => {
    // The two false positives that would silently delete real copy: a utility
    // that merely ENDS in the word, and the attribute the kicker carries.
    expect(walk(p({ className: 'overflow-hidden', children: 'shown' }))).toEqual(['p: shown'])
    expect(walk(p({ className: 'sm:overflow-hidden', children: 'shown' }))).toEqual(['p: shown'])
    expect(walk(p({ 'aria-hidden': 'true', children: 'shown' }))).toEqual(['p: shown'])
  })
})

describe('the sign-in failure copy, pinned line for line', () => {
  test('an arrival with no provider error shows exactly v1\'s page', () => {
    expect(linesFor()).toEqual(GENERIC)
  })

  test('the promised expiry is the one the plugin and the email use', () => {
    // The other end of the interpolation. GENERIC above says five minutes; this
    // says WHY it may say that, by reading the single phrase that the emailOTP
    // plugin's expiry and the code email's own sentence are both built from
    // (convex/lib/otpExpiry.ts). If these two disagree the page is promising a
    // window the deployment does not honour.
    expect(OTP_EXPIRY_LABEL).toBe('5 minutes')
  })

  test('the page title is the one v1 gives this page, fully interpolated', () => {
    // src/routes.test.ts pins the pageTitle() ARGUMENT as a literal; this is the
    // string that actually reaches the <title>, which is what e2e reads and what
    // a user sees in their tab.
    // `as unknown as` because the mocked createFileRoute returns a plain
    // `{ options }` at RUNTIME while tsc still sees the real Route type — the
    // two do not overlap, and the cast is the seam between them.
    const head = (Route as unknown as { options: { head: () => { meta: { title: string }[] } } })
      .options.head
    expect(head().meta).toEqual([{ title: 'Login / Signup - Wordle Teams' }])
  })
})

/**
 * THE `wordle-teams-vjh` DECISION, ASSERTED. The provider's error code is
 * carried through and turned into ONE MORE SENTENCE — so a user who declined
 * consent at Google no longer sees the identical screen to one whose passcode
 * expired, which is the whole complaint on that issue.
 *
 * ONE CASE PER CODE, each naming the failure it stands for. A single test
 * looping the map would pass while every code produced the same sentence, which
 * is precisely the state vjh was filed about.
 */
describe('the provider error, when there is one', () => {
  const extraLine = (error: string) => {
    const rendered = linesFor(error)
    // The generic copy is still all there, in order, with exactly ONE line
    // added — asserted as a set difference rather than by index, so a sentence
    // inserted somewhere unexpected is still a failure and not a silent pass.
    expect(rendered.filter((line) => GENERIC.includes(line))).toEqual(GENERIC)
    const added = rendered.filter((line) => !GENERIC.includes(line))
    expect(added).toHaveLength(1)
    return added[0]
  }

  test('access_denied says the user cancelled or declined — the production case on vjh', () => {
    expect(extraLine('access_denied')).toBe(
      'p: You cancelled at your sign in provider, or declined the permissions it asked for. You can try again, choose a different provider, or use a one time passcode instead.',
    )
  })

  test('consent_required tells the user the permission was never granted', () => {
    // The OAuth2-spec cousin of access_denied, and the one Microsoft sends: the
    // provider has no consent on record and could not ask for it, which is not
    // the same event as a user declining even though the way out is the same.
    expect(extraLine('consent_required')).toBe(
      'p: Your sign in provider needs your permission before it can sign you in, and it did not get it. Try again and accept the permissions it asks for, or use a one time passcode instead.',
    )
  })

  test('state_mismatch says the attempt expired or moved browsers', () => {
    // The first asterisked note's failure mode, finally named. Better Auth
    // raises this from parseState when the callback's state does not match the
    // cookie it stored, or when the attempt aged out.
    expect(extraLine('state_mismatch')).toBe(
      'p: This sign in attempt expired, or it was started in a different browser or tab. Starting again from the sign in page usually works.',
    )
  })

  test('state_invalid says the same thing as state_mismatch, deliberately', () => {
    // Its direct sibling in dist/state.mjs — thrown when the state cookie IS
    // there but will not decrypt or parse, a few lines after the branch that
    // raises state_mismatch for a missing one. Two causes, one situation for
    // the user, so the sentence is shared rather than reworded. Asserted as its
    // own case anyway: a code that quietly stopped being in the map would show
    // the generic page and nothing else here would notice.
    expect(extraLine('state_invalid')).toBe(extraLine('state_mismatch'))
    expect(extraLine('state_invalid')).toBe(
      'p: This sign in attempt expired, or it was started in a different browser or tab. Starting again from the sign in page usually works.',
    )
  })

  test('state_not_found says the response came back incomplete', () => {
    // The paramless callback hit also recorded on vjh — a prefetch or a
    // double-fire, where no state came back at all.
    expect(extraLine('state_not_found')).toBe(
      'p: The response from your sign in provider came back incomplete. Starting again from the sign in page usually works.',
    )
  })

  test('account_not_linked sends the user to the passcode, which will work', () => {
    // Better Auth REFUSES to link rather than creating a duplicate when the
    // provider will not vouch for the email; see the accountLinking note in
    // convex/auth.ts. The advice is the actionable part: a one time passcode
    // verifies the address directly and gets them in.
    expect(extraLine('account_not_linked')).toBe(
      'p: Your sign in provider did not confirm your email address, so we could not match it to your account. Signing in with a one time passcode will work.',
    )
  })

  test('an unrecognised code is not rendered even if it reaches the component', () => {
    // TWO CLAIMS, ONE CASE. Better Auth has a dozen codes and only the six
    // above have anything true to tell a user — `unable_to_get_user_info` is a
    // real one, and inventing an explanation for it would be worse than saying
    // nothing — so an unmapped code has to fall back to the generic page.
    //
    // THE ADVERSARIAL STRING RATHER THAN A REAL UNMAPPED CODE, because it makes
    // the stronger claim through the identical path: this calls the component
    // directly with something `validateSearch` would never have passed, which
    // is the only way to show that what renders is the MAP'S OWN LITERAL and
    // never the input. (A separate `unable_to_get_user_info` case used to sit
    // beside this one; it is the same `REASONS.get` miss, and the two died
    // together on every mutation.)
    expect(linesFor('<script>alert(1)</script>')).toEqual(GENERIC)
  })
})

/**
 * THE ALLOWLIST ITSELF. `validateSearch` is the boundary between a query string
 * anyone can write and something the page will draw, so it is asserted directly
 * rather than only through what it lets past.
 */
describe('validateSearch, the boundary the query string has to cross', () => {
  const validate = (
    Route as unknown as {
      options: { validateSearch: (search: Record<string, unknown>) => { error?: string } }
    }
  ).options.validateSearch

  test('a known code is kept, exactly as spelled', () => {
    expect(validate({ error: 'access_denied' })).toEqual({ error: 'access_denied' })
  })

  test('an unknown code is dropped rather than passed through', () => {
    expect(validate({ error: 'not_a_real_code' })).toEqual({ error: undefined })
  })

  test('an Object.prototype key is not mistaken for a known code', () => {
    // The reason the codes live in a Map and not an object literal: `REASONS
    // ['constructor']` on a plain object is truthy, and a lookup written with
    // `in` or bare bracket access would have let this through to the page.
    expect(validate({ error: 'constructor' })).toEqual({ error: undefined })
    expect(validate({ error: 'toString' })).toEqual({ error: undefined })
  })

  test('a non-string error is dropped', () => {
    // `?error=a&error=b` parses to an array, which is not a code.
    expect(validate({ error: ['access_denied'] })).toEqual({ error: undefined })
    expect(validate({ error: 1 })).toEqual({ error: undefined })
  })

  test('error_description does not survive validation at all', () => {
    // Free text written by the provider — an AADSTS sentence in the hit
    // recorded on vjh. The whole search object is asserted, not just that
    // `error` is undefined: the point is that no second key comes out the other
    // side for anything downstream to reach for.
    // `toStrictEqual`, not `toEqual`: `toEqual` treats `{ error: 'x' }` and
    // `{ error: 'x', error_description: undefined }` as the same object, which
    // is exactly the outcome this test is supposed to be able to tell apart.
    expect(
      validate({ error: 'access_denied', error_description: '<img src=x onerror=alert(1)>' }),
    ).toStrictEqual({ error: 'access_denied' })
  })

  test('an empty query string is fine', () => {
    expect(validate({})).toEqual({ error: undefined })
  })
})
