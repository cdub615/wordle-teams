import { describe, expect, test } from 'vitest'
import { NOINDEX_VALUE, shouldNoindex } from './robots-policy'
import { SITE_ORIGIN } from './seo'

/**
 * THE ASYMMETRY IS THE POINT OF EVERY TEST HERE. Indexing beta is recoverable;
 * noindexing production removes the site from search silently. So the
 * production cases are asserted first and hardest, and the "unknown host"
 * cases exist to prove the default is indexable rather than merely to fill in
 * a table.
 */
describe('production is never noindexed', () => {
  test('the canonical origin is indexable', () => {
    // Read off SITE_ORIGIN rather than retyped, so renaming the site cannot
    // leave this test asserting a hostname the app no longer serves.
    expect(shouldNoindex(new URL(SITE_ORIGIN).hostname)).toBe(false)
  })

  test('www and the apex are both indexable', () => {
    expect(shouldNoindex('wordleteams.com')).toBe(false)
    expect(shouldNoindex('www.wordleteams.com')).toBe(false)
  })

  test('an unrecognised host is indexable, because the list is a deny-list', () => {
    // The load-bearing case. If this ever flips to `true`, the module has been
    // rewritten as an allow-list and production is one typo from disappearing.
    for (const host of ['example.com', '', 'localhost', 'wordleteams.com.evil.net']) {
      expect(shouldNoindex(host), `${host} was noindexed`).toBe(false)
    }
  })
})

describe('the staging copies are noindexed', () => {
  test('beta is noindexed', () => {
    expect(shouldNoindex('beta.wordleteams.com')).toBe(true)
  })

  test('case and a stray port do not let beta through', () => {
    // URL.hostname gives neither, so this pins the defence in depth: the
    // failure of dropping it is silent, and silently indexable.
    expect(shouldNoindex('BETA.WordleTeams.com')).toBe(true)
    expect(shouldNoindex('beta.wordleteams.com:8788')).toBe(true)
    expect(shouldNoindex('  beta.wordleteams.com  ')).toBe(true)
  })

  test('workers.dev is covered by suffix, since that name is assigned not chosen', () => {
    expect(shouldNoindex('wordle-teams-v2.someaccount.workers.dev')).toBe(true)
  })

  test('the suffix must ANCHOR at the end, not merely appear', () => {
    // `foo.workers.dev.evil.com` is the case that separates endsWith from
    // includes, and the first version of this test did not contain it:
    // 'workers.dev.example.com' has no leading dot, so both operators answer
    // false for it and the assertion pinned nothing. Caught by mutating
    // endsWith to includes and watching the test survive.
    expect(shouldNoindex('foo.workers.dev.evil.com')).toBe(false)
    expect(shouldNoindex('workers.dev.example.com')).toBe(false)
    expect(shouldNoindex('notworkersdev.com')).toBe(false)
  })
})

test('the header asks for no crawling of a copy, not just no indexing', () => {
  expect(NOINDEX_VALUE).toBe('noindex, nofollow')
})
