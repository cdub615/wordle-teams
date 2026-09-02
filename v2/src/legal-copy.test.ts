import { readFileSync } from 'node:fs'
import { describe, expect, test } from 'vitest'
import { codeOf, objectLiteralAssignedTo } from './test-support/source-ast'

/**
 * THE PUBLISHED LEGAL COPY, PINNED AGAINST WHAT THE APP ACTUALLY DOES.
 *
 * WHY THIS FILE EXISTS RATHER THAN A ONE-OFF CORRECTION. Both documents named
 * Apple and Facebook as sign-in providers for the life of the project. Neither
 * was ever one: v1 offered google, twitter, azure, github, slack and discord,
 * and v2 offers google, microsoft, github and discord. The list was wrong in
 * BOTH directions and nobody noticed for two years, because prose in a page
 * nobody reads has nothing checking it (wordle-teams-4yt).
 *
 * Correcting the sentence fixes today. This fixes the next time — adding or
 * dropping a provider now fails a CI gate instead of silently making a
 * published legal document inaccurate.
 *
 * IT READS BOTH SOURCES OF TRUTH. convex/auth.ts's PROVIDER_ENV is the
 * authoritative list and is deliberately not exported, so it is parsed rather
 * than imported — and parsed rather than grepped, because that file's own prose
 * names every provider several times over while explaining which were dropped.
 */
const read = (path: string) => readFileSync(new URL(path, import.meta.url), 'utf8')

const PRIVACY = './routes/privacy.tsx'
const TERMS = './routes/terms.tsx'
const AUTH = './../convex/auth.ts'

/** Better Auth's provider ids -> the name a person would recognise in prose. */
const DISPLAY_NAME: Record<string, string> = {
  google: 'Google',
  microsoft: 'Microsoft',
  github: 'GitHub',
  discord: 'Discord',
}

const providerIds = [...objectLiteralAssignedTo('auth.ts', read(AUTH), 'PROVIDER_ENV').keys()]

/**
 * Comments stripped from the legal pages too. Both route files carry header
 * prose that QUOTES the wrong sentence in order to explain it — privacy.tsx's
 * comment contains the literal string "(e.g., Google, Apple, Facebook, etc.)" —
 * so an assertion against the raw file would match the explanation of the bug
 * and pass while the bug was still shipping.
 */
const copyOf = (path: string) => codeOf(read(path))

describe('the sign-in providers named in the legal copy are the ones that exist', () => {
  test('every provider the app offers has a display name here', () => {
    // Guards the mapping itself: a provider added to PROVIDER_ENV with no entry
    // above would otherwise be skipped by every assertion below.
    expect(providerIds.sort()).toEqual(Object.keys(DISPLAY_NAME).sort())
  })

  for (const path of [PRIVACY, TERMS]) {
    test(`${path} names every provider the app offers`, () => {
      const copy = copyOf(path)
      for (const id of providerIds) {
        expect(copy, `${DISPLAY_NAME[id]} is missing from ${path}`).toContain(DISPLAY_NAME[id])
      }
    })

    test(`${path} names no provider the app does not offer`, () => {
      // THE DIRECTION THIS ISSUE WAS ACTUALLY ABOUT. Naming a company as a
      // recipient of user data when it receives none is the inaccuracy that
      // shipped, and it is invisible to a test that only checks presence.
      //
      // Every provider either codebase has ever offered, plus the two that were
      // never offered at all. v1's list was google, twitter, azure, github,
      // slack, discord; v2 dropped slack (zero users) and X (stopped being
      // free), and renamed azure to microsoft.
      const copy = copyOf(path)
      const offered = new Set(providerIds.map((id) => DISPLAY_NAME[id]))
      for (const name of ['Apple', 'Facebook', 'Twitter', 'Slack', 'Azure']) {
        if (offered.has(name)) continue
        expect(copy, `${path} still names ${name}, which is not a sign-in provider`).not.toContain(
          name,
        )
      }
    })
  }
})

describe('the copy does not claim data the app never collects', () => {
  test('neither document mentions a username', () => {
    // There is no username field in either codebase — v2's players table is
    // firstName/lastName. v1's only other use of the word is landing-page copy
    // saying you do NOT need to manage another username.
    for (const path of [PRIVACY, TERMS]) {
      expect(copyOf(path).toLowerCase(), `${path} still claims a username`).not.toContain('username')
    }
  })
})

describe('a reissued document says when it was reissued', () => {
  test('both documents carry the same date, and it is not the original one', () => {
    // They were corrected together and are published together, so a date that
    // differs between them means one edit landed without the other. May 21 2024
    // is the original issue date; a corrected document still carrying it is the
    // shape that is hard to defend if anyone asks.
    const dateOf = (path: string) =>
      copyOf(path).match(/(?:Effective Date|Last Updated):\s*([^<]+)/)?.[1]?.trim()

    const privacyDate = dateOf(PRIVACY)
    expect(privacyDate, 'no Effective Date found in privacy.tsx').toBeTruthy()
    expect(dateOf(TERMS)).toBe(privacyDate)
    expect(privacyDate).not.toBe('May 21, 2024')
  })
})
