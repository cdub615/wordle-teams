import { readFileSync } from 'node:fs'
import { describe, expect, test } from 'vitest'
import {
  codeOf,
  elementsOf,
  objectLiteralReturnedBy,
  optionsPassedTo,
} from '../../src/test-support/source-ast.ts'
import { originsFor, rpIdFor } from './relyingParty.ts'

/**
 * convex/auth.ts AS TEXT, read twice on purpose.
 *
 * `AUTH_CODE` is comment-stripped and is what the source assertions at the foot
 * of this file parse — auth.ts's prose names both the apex and the beta
 * hostname repeatedly, and a match inside it would prove nothing.
 *
 * `AUTH_TEXT` IS A WORKAROUND FOR wordle-teams-sba2, and exists only to recover
 * a string literal `codeOf` destroys. Its line-comment regex has no string
 * awareness, so it eats from the `//` inside any URL to the end of the line:
 * `const SCHEMA_ONLY_BASE_URL = 'https://schema-generation.invalid'` survives
 * stripping as `const SCHEMA_ONLY_BASE_URL = 'https:`. The AST assertions below
 * are unharmed — TypeScript's scanner ends the unterminated string at the
 * newline and recovers, and if recovery ever degraded `objectLiteralReturnedBy`
 * throws on a declaration count rather than passing vacuously — but the literal
 * itself is unrecoverable from the stripped text. DELETE THIS SECOND READ when
 * sba2 lands: a string-aware `codeOf` makes `AUTH_CODE` sufficient on its own.
 */
const AUTH_TEXT = readFileSync(new URL('../auth.ts', import.meta.url), 'utf8')
const AUTH_CODE = codeOf(AUTH_TEXT)

/**
 * The exact placeholder auth.ts hands these helpers at component init, READ OUT
 * OF auth.ts rather than copied, so this file cannot go on asserting a URL the
 * source has stopped using. Throws by name if the constant is renamed or
 * deleted, which is a real failure: nothing else here would notice.
 */
const SCHEMA_ONLY_BASE_URL = (() => {
  const match = AUTH_TEXT.match(/const SCHEMA_ONLY_BASE_URL = '([^']+)'/)
  if (!match) throw new Error('convex/auth.ts no longer declares SCHEMA_ONLY_BASE_URL')
  return match[1]
})()

/**
 * WHY THIS RUNS INSIDE THE FOUR GATES RATHER THAN IN e2e, WHERE THE FEATURE IS.
 *
 * The passkey ceremony itself can only be exercised by a Playwright virtual
 * authenticator, and e2e sits outside the gates on this project — a spec here
 * has stayed red for three tasks with nothing failing. The rpID is the one part
 * of that flow which can never be repaired afterwards, so it gets a guard that
 * runs on every commit regardless of the e2e suite's health.
 *
 * The argument for the VALUES asserted below — why the apex, why it is legal
 * from a subdomain, why an orphaned credential has no fix — is stated once, in
 * convex/lib/relyingParty.ts's header, and deliberately not repeated here.
 */
describe('the relying-party id', () => {
  test('is the APEX on beta, not the beta hostname', () => {
    // THE WHOLE POINT. WebAuthn allows an rpID that is the origin's effective
    // domain OR any registrable-domain suffix of it, and a credential scoped to
    // the apex works on the apex and every subdomain. Left at the default — the
    // full hostname — every passkey registered on beta would be orphaned by the
    // DNS cutover (wt-ksh.9).
    expect(rpIdFor('https://beta.wordleteams.com')).toBe('wordleteams.com')
  })

  test('and is the same apex in production, so the flip changes nothing', () => {
    expect(rpIdFor('https://wordleteams.com')).toBe('wordleteams.com')
  })

  test('is localhost in development, which the spec special-cases', () => {
    expect(rpIdFor('http://localhost:3000')).toBe('localhost')
  })

  test('trusts beta AND the apex as origins, so one deployment serves both', () => {
    expect(originsFor('https://beta.wordleteams.com')).toEqual([
      'https://beta.wordleteams.com',
      'https://wordleteams.com',
    ])
  })

  test('and in development trusts only the dev origin', () => {
    expect(originsFor('http://localhost:3000')).toEqual(['http://localhost:3000'])
  })

  test('and neither helper throws on the schema-only placeholder', () => {
    // NOT A CURIOSITY — THIS IS THE DEPLOY GATE. `createAuthOptions` is imported
    // by the local Better Auth component, and `createApi` evaluates it at
    // component init where no deployment environment variables exist, so
    // `siteUrl` is `SCHEMA_ONLY_BASE_URL` and these two are called with it. A
    // throw there is not a failed request, it is a push that dies at module
    // analysis — an unpushable deployment (wordle-teams-hrqw). The URL is read
    // out of auth.ts above, so it is that file's placeholder and not a copy.
    expect(() => rpIdFor(SCHEMA_ONLY_BASE_URL)).not.toThrow()
    expect(() => originsFor(SCHEMA_ONLY_BASE_URL)).not.toThrow()
  })

  test('but BOTH throw, by name, on a SITE_URL that parses to no host at all', () => {
    // `beta.wordleteams.com:443` parses: the host is swallowed as the scheme and
    // the hostname comes back empty. PINNED SO THE THROW IS NOT LATER SOFTENED
    // into a `?? ''` by someone reading the placeholder test above as "these
    // must never throw". An empty rpID is not a safe default — the plugin's own
    // fallback derives from the same value and is equally empty, so the browser
    // rejects the ceremony with a message that names nothing.
    expect(() => rpIdFor('beta.wordleteams.com:443')).toThrow(/SITE_URL/)
    expect(() => originsFor('beta.wordleteams.com:443')).toThrow(/SITE_URL/)
  })

  test('and both throw on a SITE_URL with no scheme, which `new URL` refuses', () => {
    // Not caught and not dressed up: this is `new URL`'s own TypeError. It can
    // only fire at REQUEST time, inside createAuth — component init always uses
    // the placeholder above — so the blast radius is a loud 500 on the auth
    // routes of a deployment someone misconfigured by hand, never a push that
    // will not deploy.
    expect(() => rpIdFor('wordleteams.com')).toThrow()
    expect(() => originsFor('wordleteams.com')).toThrow()
  })
})

/**
 * THE SOURCE ASSERTION, BECAUSE THE DERIVATION ABOVE PROVES NOTHING ON ITS OWN.
 *
 * Every test above passes with `rpID: 'beta.wordleteams.com'` written into
 * convex/auth.ts and `rpIdFor` never called — the module would be correct,
 * exported, tested, and dead. That mutation is the exact failure this whole
 * task exists to prevent, and it is invisible to the four gates, to e2e, and to
 * review (a hardcoded apex looks right). So the wiring itself gets pinned.
 *
 * READ THROUGH THE COMPILER, NOT A REGEX, for the reason src/test-support's
 * header gives: a `toMatch(/rpIdFor\(siteUrl\)/)` over the file is satisfied by
 * that text sitting in a `const` nothing passes, or in a comment. `codeOf`
 * strips the comments — auth.ts's own prose names both the apex and the beta
 * hostname repeatedly — and `objectLiteralReturnedBy` reaches the literal that
 * `createAuthOptions` actually returns, so a plugin lifted out of the array is
 * not found at all.
 *
 * NOTHING HERE CAN GO VACUOUS. Each step either finds exactly what it names or
 * throws with that name in the message: `objectLiteralReturnedBy` throws on a
 * renamed `createAuthOptions`, the explicit check throws on a missing `plugins`,
 * the length assertion fails on a renamed or deleted `passkey(`, and the values
 * are compared with `toBe` against exact source text rather than searched for.
 */
describe("the relying party auth.ts actually wires, not the one it's able to derive", () => {
  const passkeyOptions = () => {
    const options = objectLiteralReturnedBy('auth.ts', AUTH_CODE, 'createAuthOptions')
    const plugins = options.get('plugins')
    if (!plugins) throw new Error('createAuthOptions no longer returns a `plugins` property')

    const calls = elementsOf(plugins).filter((element) => element.startsWith('passkey('))
    // A renamed, deleted or duplicated plugin fails HERE, with a count, rather
    // than quietly leaving the assertions below with nothing to check.
    expect(calls).toHaveLength(1)

    // NAMED FOR WHAT IS ACTUALLY PARSED, not for the file it came out of. Only
    // the one array element is handed over, so a failure reporting "in auth.ts"
    // would send the next reader looking for a second `passkey({...})` in a
    // file whose text this call never saw.
    return optionsPassedTo('the passkey() element of auth.ts', calls[0], 'passkey')
  }

  test('passes rpIdFor(siteUrl) to passkey(), never a hardcoded hostname', () => {
    expect(passkeyOptions().get('rpID')?.getText()).toBe('rpIdFor(siteUrl)')
  })

  test('and derives the accepted origins the same way', () => {
    // The other half of surviving the cutover, and the same mutation applies:
    // a literal here refuses every ceremony from whichever name it omits. See
    // originsFor's header for why the list has to hold both.
    expect(passkeyOptions().get('origin')?.getText()).toBe('originsFor(siteUrl)')
  })
})
