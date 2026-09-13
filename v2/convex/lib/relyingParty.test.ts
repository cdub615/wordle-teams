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
 * hostname repeatedly, and a match inside it would prove nothing. `AUTH_TEXT`
 * is the raw file, used only to recover a string literal that `codeOf` mangles:
 * its line-comment pass eats from the `//` of a URL to the end of the line, so
 * `'https://schema-generation.invalid'` survives stripping as `'https:`.
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
 * THE ONE SETTING THAT CANNOT BE UNDONE.
 *
 * An rpID is chosen once, per credential, at registration. A credential scoped
 * to the wrong id is orphaned — there is no migration and no repair, and the
 * failure is silent until someone tries to sign in.
 *
 * THIS RUNS INSIDE THE FOUR GATES ON PURPOSE. The passkey flow itself can only
 * be exercised by a Playwright virtual authenticator, and e2e sits outside the
 * gates on this project — a spec here has stayed red for three tasks with
 * nothing failing. So the unrecoverable half gets a guard that runs on every
 * commit regardless of the e2e suite's health.
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

    return optionsPassedTo('auth.ts', calls[0], 'passkey')
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
