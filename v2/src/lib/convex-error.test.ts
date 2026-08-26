import { describe, expect, test } from 'vitest'
import { typedCodeMessage } from './convex-error.ts'
import type { AccessCode } from '../../convex/access'

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
