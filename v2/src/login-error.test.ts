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
import { OTP_EXPIRY_SEC } from '../convex/authEmails'

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
 */
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

describe('the sign-in failure copy, pinned line for line', () => {
  test('an arrival with no provider error shows exactly v1\'s page', () => {
    expect(linesFor()).toEqual(GENERIC)
  })

  test('the promised expiry is the one the plugin and the email use', () => {
    // The other end of the interpolation. GENERIC above says five minutes; this
    // says WHY it may say that, by reading the single constant that configures
    // the emailOTP plugin and writes the code email's own sentence
    // (convex/authEmails.ts). If these two disagree the page is promising a
    // window the deployment does not honour.
    expect(Math.round(OTP_EXPIRY_SEC / 60)).toBe(5)
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

  test('state_mismatch says the attempt expired or moved browsers', () => {
    // The first asterisked note's failure mode, finally named. Better Auth
    // raises this from parseState when the callback's state does not match the
    // cookie it stored, or when the attempt aged out.
    expect(extraLine('state_mismatch')).toBe(
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

  test('a code with no sentence of its own falls back to the generic page', () => {
    // Better Auth has a dozen codes and only four of them have anything useful
    // to say to a user. `unable_to_get_user_info` is a real one; inventing an
    // explanation for it would be worse than saying nothing.
    expect(linesFor('unable_to_get_user_info')).toEqual(GENERIC)
  })

  test('an unrecognised code is not rendered even if it reaches the component', () => {
    // DEFENCE IN DEPTH, not a duplicate of validateSearch below. This calls the
    // component directly with a string the validator would never have passed,
    // which is the only way to show that the component renders the MAP'S OWN
    // LITERAL and never its input.
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

  test('a Object.prototype key is not mistaken for a known code', () => {
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
    expect(
      validate({ error: 'access_denied', error_description: '<img src=x onerror=alert(1)>' }),
    ).toEqual({ error: 'access_denied' })
  })

  test('an empty query string is fine', () => {
    expect(validate({})).toEqual({ error: undefined })
  })
})
