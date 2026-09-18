import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, test } from 'vitest'
import { typedCodeMessage } from './convex-error.ts'
import type { AccessCode } from '../../convex/access'

const here = dirname(fileURLToPath(import.meta.url))

/**
 * THE ONE HALF OF THE ERROR MAPPING NO COMPILER CHECKS.
 *
 * `typedCodeMessage` is exhaustive over AccessCode — its `default` assigns to a
 * `never`, so adding a member to the union stops the build until a case exists.
 * `convexErrorCode` is NOT, and cannot be by construction: it narrows an
 * arbitrary `string` off the wire, so its membership test is a hand-written
 * chain of `code === '…' ||` ending in `return null`. Add a code to the union,
 * write its copy, forget the chain, and the copy is unreachable: every user sees
 * the generic "Something went wrong" fallback instead, while lint, tsc, build and
 * all 3500-odd other tests stay green. There is no type-level way to notice.
 *
 * SO THE CHECK IS TEXTUAL, on the same premise as the twenty-odd other
 * source-reading tests in this repo (frontend-import-graph.test.ts, fonts.test.ts,
 * routes.test.ts): when the property lives in the SHAPE of a file rather than in
 * its types, reading the file is the only mechanism that can see it. Parsing the
 * union out of access.ts is crude and that is the point — it fails loudly if
 * anyone reformats the union into a shape this cannot read, which is a far better
 * outcome than silently checking nothing.
 *
 * ONE DIRECTION ONLY. A code in the chain that is NOT in AccessCode is already a
 * compile error: the narrowed `code` is returned as `AccessCode`, so an unknown
 * literal fails assignability. Only the missing direction needs a test.
 */
const ACCESS_CODES_IN_SOURCE = (() => {
  const source = readFileSync(join(here, '../../convex/access.ts'), 'utf8')
  const afterDeclaration = source.split('export type AccessCode =')[1]
  expect(afterDeclaration, 'convex/access.ts no longer declares `export type AccessCode =`').toBeDefined()

  // The split leaves the tail of the `=` line itself as element 0 — empty, since
  // the first member sits on the next line — so collection starts at the first
  // line that parses and stops at the first that does not AFTER that.
  const codes: string[] = []
  for (const line of afterDeclaration.split('\n')) {
    const member = /^\s*\|\s*'([A-Z_]+)'\s*$/.exec(line)
    if (member) codes.push(member[1])
    else if (codes.length > 0) break
  }
  return codes
})()

const CONVEX_ERROR_CODE_BODY = (() => {
  const source = readFileSync(join(here, 'convex-error.ts'), 'utf8')
  const afterSignature = source.split('export function convexErrorCode')[1]
  expect(afterSignature, 'convex-error.ts no longer declares `export function convexErrorCode`').toBeDefined()
  return afterSignature.split('\nexport ')[0]
})()

describe('convexErrorCode recognises every AccessCode', () => {
  test('the union parsed out of access.ts is the real one, not an empty list', () => {
    // Without this the loop below would pass vacuously the moment the parse
    // broke — the classic way a source-reading guard stops guarding. The floor is
    // deliberately well under the real count so an ordinary addition or removal
    // does not have to touch it; it only catches a parse that collapsed.
    expect(ACCESS_CODES_IN_SOURCE.length).toBeGreaterThan(15)
    expect(ACCESS_CODES_IN_SOURCE).toContain('UNAUTHENTICATED')
  })

  test.each(ACCESS_CODES_IN_SOURCE)(
    '%s appears in convexErrorCode’s hand-written chain',
    (code) => {
      expect(CONVEX_ERROR_CODE_BODY).toContain(`code === '${code}'`)
    },
  )
})

/**
 * THE ONLY MECHANISM GUARDING THE TWO OWNERSHIP STRINGS.
 *
 * Both of them used to say "the person who created this team", which was true
 * only while every team's owner was also the member who created it. Phase 5's
 * softened downgrade (downgradeTeamRemovalFor, convex/billing.ts) reassigns
 * `owner` to the earliest-joined remaining member, so a team's owner is now
 * routinely somebody who did not create it — and the old copy told that person
 * something false about themselves.
 *
 * WHAT MADE THAT DANGEROUS WAS NOT THE WORDING, IT WAS THE INVISIBILITY. They
 * are string literals in a switch, so lint, tsc, build and every other suite
 * stayed green while the copy lied. Rewording them without adding this file
 * would have fixed the sentence and left the hole, and the next drift would be
 * exactly as unobservable as the one it replaced.
 *
 * ASSERTS THE PROPERTY, NOT THE SENTENCE. An exact-string test would relocate
 * the brittleness rather than remove it: it would fail on any harmless rewrite
 * and would teach the next person to update the expected string reflexively,
 * which is the same as no test at all. What must hold is that the copy speaks
 * of the OWNER and never of who created the team. Reword freely; keep that true.
 */

/** created, creator, creates, creating — every form of the claim that is false. */
const CREATION_WORDING = /creat/i

const OWNERSHIP_CODES: AccessCode[] = ['NOT_TEAM_OWNER', 'OWNER_NOT_REMOVABLE']

describe('typedCodeMessage, the two ownership codes', () => {
  test.each(OWNERSHIP_CODES)('%s never claims the owner created the team', (code) => {
    expect(typedCodeMessage(code)).not.toMatch(CREATION_WORDING)
  })

  test.each(OWNERSHIP_CODES)('%s says whose team it is, in terms of the owner', (code) => {
    expect(typedCodeMessage(code)).toMatch(/\bowner\b/i)
  })

  // Sanity on the two assertions above: they are only meaningful if the copy is
  // real end-user text. An empty string would pass "does not mention creation".
  test.each(OWNERSHIP_CODES)('%s returns a real sentence', (code) => {
    const message = typedCodeMessage(code)
    expect(message.length).toBeGreaterThan(20)
    expect(message.trimEnd()).toMatch(/[.!?]$/)
  })
})
