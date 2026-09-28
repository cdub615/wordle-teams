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
 * SO THE CHECK IS TEXTUAL, on the same premise as the thirty-odd other
 * source-reading tests in this repo (frontend-import-graph.test.ts, fonts.test.ts,
 * routes.test.ts): when the property lives in the SHAPE of a file rather than in
 * its types, reading the file is the only mechanism that can see it.
 *
 * THE HARD PART IS NOT THE ASSERTION, IT IS PROVING THE PARSE FOUND EVERYTHING.
 * A source-reading guard that quietly parses half a list still passes, and then
 * guards half a list. Two things stop that here, and the second is the real one:
 *
 * 1. A FLOOR on the count, so a parse that collapses to nothing cannot pass
 *    vacuously. Necessary, and nowhere near sufficient — an earlier version of
 *    this file stopped collecting at the first line that was not a member, so a
 *    single comment inserted mid-union would have truncated the list to whatever
 *    came before it and sailed past a floor of 15.
 *
 * 2. A CROSS-CHECK against `typedCodeMessage`'s `case` labels. Requiring the two
 *    sets to be EQUAL catches both directions of a bad parse: a truncated union
 *    parse leaves labels unmatched, and an over-greedy one that ran on past the
 *    declaration leaves members unmatched.
 *
 *    WHAT MAKES THAT WORK IS THE INDEPENDENCE OF THE TWO PARSERS, NOT tsc. Be
 *    precise about this, because the obvious phrasing is wrong: tsc guarantees
 *    the SWITCH is exhaustive over AccessCode, and guarantees nothing whatever
 *    about whether a regex of mine over that switch's SOURCE TEXT finds every
 *    label it contains. The compiler cannot see this file. What the equality
 *    actually rests on is that two separately written patterns, run over two
 *    different files in two different syntaxes, would have to fail in the same
 *    direction by the same amount to agree wrongly. Hence the deliberately
 *    DISSIMILAR character classes below — see CODE_UNION and CODE_CASE.
 *
 * ONE DIRECTION ONLY on the chain itself. A code in the chain that is NOT in
 * AccessCode is already a compile error: the narrowed `code` is returned as
 * `AccessCode`, so an unknown literal fails assignability. Only the missing
 * direction needs a test.
 */

/**
 * DELIBERATELY DIFFERENT PATTERNS FOR THE SAME NAMES, which is the point rather
 * than an inconsistency. If both parsers shared one class, a future code
 * containing a character neither expects would be dropped by BOTH — the two sets
 * would still be equal, the floor would still hold, and that code would go
 * unguarded with every gate green. The union side takes anything that is not the
 * closing quote; the switch side is the conservative identifier class. They can
 * only disagree in a way that FAILS, never in a way that silently narrows.
 */
const CODE_UNION = "[^']+"
const CODE_CASE = '[A-Za-z0-9_]+'

const ACCESS_CODES_IN_SOURCE = (() => {
  const source = readFileSync(join(here, '../../convex/access.ts'), 'utf8')
  const afterDeclaration = source.split('export type AccessCode =')[1]
  expect(afterDeclaration, 'convex/access.ts no longer declares `export type AccessCode =`').toBeDefined()

  // Walks to the END OF THE DECLARATION rather than stopping at the first line
  // that is not a member. Blank lines and comments are FILLER — skipped, not
  // terminators — because treating them as terminators is exactly how a comment
  // added inside the union would silently truncate this list. The union ends at
  // the first line that is neither a member nor filler, which in practice is the
  // next top-level statement. Over-running that is harmless and detectable: the
  // equality check against the switch labels below fails if this picks up a
  // member that is not an AccessCode.
  const codes: string[] = []
  for (const raw of afterDeclaration.split('\n')) {
    const line = raw.trim()
    const member = new RegExp(`^\\|\\s*'(${CODE_UNION})'$`).exec(line)
    if (member) {
      codes.push(member[1])
      continue
    }
    if (line === '' || line.startsWith('//') || line.startsWith('*') || line.startsWith('/*')) continue
    break
  }
  return codes
})()

/**
 * The `case` labels of `typedCodeMessage`, which tsc guarantees are exactly
 * AccessCode's members — the `default` branch assigns `code` to a `never`, so a
 * missing case does not compile and a surplus one is not assignable.
 */
const SWITCH_CASE_LABELS = (() => {
  const source = readFileSync(join(here, 'convex-error.ts'), 'utf8')
  const body = source.split('export function typedCodeMessage')[1]
  expect(body, 'convex-error.ts no longer declares `export function typedCodeMessage`').toBeDefined()
  return [...body.split('\nexport ')[0].matchAll(new RegExp(`case '(${CODE_CASE})':`, 'g'))].map((m) => m[1])
})()

/**
 * The `||` CHAIN ALONE — from the `if (` that opens it to the `) {` that closes
 * it — and NOT the whole function, which is what this used to slice.
 *
 * Running to the next `\nexport ` swept in `typedCodeMessage`'s entire JSDoc.
 * Nothing in it quotes a real code today, but a future doc comment that wrote
 * `code === 'FOO'` in prose would satisfy the per-code assertion below while the
 * actual chain entry was missing — which is precisely the failure this file
 * exists to catch, reintroduced through its own evidence. The bound is now the
 * chain's own closing `) {`, so only executable membership tests count.
 */
const CONVEX_ERROR_CODE_BODY = (() => {
  const source = readFileSync(join(here, 'convex-error.ts'), 'utf8')
  const afterSignature = source.split('export function convexErrorCode')[1]
  expect(afterSignature, 'convex-error.ts no longer declares `export function convexErrorCode`').toBeDefined()
  const chain = /\n {2}if \(\n([\s\S]*?)\n {2}\) \{/.exec(afterSignature)
  expect(chain, "convexErrorCode's `||` chain is no longer an `if (` ... `) {` block").not.toBeNull()
  return chain![1]
})()

describe('convexErrorCode recognises every AccessCode', () => {
  test('the union parsed out of access.ts is the real one, not a truncated list', () => {
    // The floor catches a parse that collapsed to nothing; the equality catches
    // one that stopped early or ran on. Neither assertion is redundant: the floor
    // still fires if BOTH parsers break the same way, and the equality still
    // fires if the union parse loses members while staying above the floor.
    expect(ACCESS_CODES_IN_SOURCE.length).toBeGreaterThan(15)
    expect(ACCESS_CODES_IN_SOURCE).toContain('UNAUTHENTICATED')
    expect([...ACCESS_CODES_IN_SOURCE].sort()).toEqual([...SWITCH_CASE_LABELS].sort())
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
