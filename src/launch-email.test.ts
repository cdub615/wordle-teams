import { readFileSync } from 'node:fs'
import { describe, expect, test } from 'vitest'

/**
 * THE LAUNCH EMAIL DRAFTS, PINNED ON THE TWO THINGS THAT CANNOT BE GOT WRONG.
 *
 * WHY THIS FILE EXISTS. `wordle-teams-7e3c` makes one sentence a launch blocker:
 * the 2026-09-06 amendment added chat messages as a category of User Content,
 * named teammates as a disclosure recipient, and added a retention rule, and the
 * Terms promise notification of a material revision. The owner chose to make
 * materiality moot by notifying, and these three drafts ARE that notification.
 * A draft that ships without the line does not merely read worse — it leaves the
 * clause unsatisfied.
 *
 * AND THE HAZARD IS SPECIFICALLY A DELETION, WHICH IS WHY A REVIEW WOULD NOT
 * CATCH IT. Each draft carries a `PWA-BLOCK` that is meant to be deleted at send
 * time (see docs/runbooks/launch-email-send.md §4) sitting a few lines below a
 * legal block that must never be. The deletion happens after a DNS cutover, on
 * the one artefact that cannot be recalled, by someone working from a checklist.
 * Deleting one block instead of the other is an ordinary slip with a
 * disproportionate cost, so it fails a gate instead.
 *
 * NOTHING HERE CHECKS PROSE QUALITY. It checks that the required sentence, both
 * links, the unsubscribe tag and both delete-markers are present, and that no
 * real email address ever lands in a file this public repo tracks.
 */
const EMAILS = [
  './../emails/launch-a-active.html',
  './../emails/launch-b-lapsed.html',
  './../emails/launch-c-never-played.html',
] as const

const read = (path: string) => readFileSync(new URL(path, import.meta.url), 'utf8')

/** The sentence `wordle-teams-7e3c` requires, in the wording the issue settled on. */
const NOTICE = 'have been updated to cover it'

describe.each(EMAILS)('%s', (path) => {
  const html = read(path)

  test('carries the terms-change notice', () => {
    expect(html, 'the notification sentence is missing').toContain(NOTICE)
    expect(html, 'the notice does not name team chat').toContain('Team chat is new')
  })

  test('links both documents the notice refers to', () => {
    expect(html).toContain('https://wordleteams.com/terms')
    expect(html).toContain('https://wordleteams.com/privacy')
  })

  test('the deletable PWA block is delimited by exactly one marker at each end', () => {
    // EXACTLY ONE, NOT AT LEAST ONE, AND A MUTANT PROVED WHY. The START comment
    // used to spell out "down to PWA-BLOCK:END" as its instruction, which put a
    // second copy of the closing marker INSIDE the opening one. Deleting the real
    // END marker altogether then left both a `toContain` and an index-ordering
    // assertion green, because both found the decoy in the comment above. The
    // send-time instruction now says "the matching END marker below" instead, and
    // this counts rather than searches.
    const count = (marker: string) => html.split(marker).length - 1
    expect(count('PWA-BLOCK:START'), 'expected exactly one START marker').toBe(1)
    expect(count('PWA-BLOCK:END'), 'expected exactly one END marker').toBe(1)
    // START must come first, or a deletion down to END removes the wrong span.
    expect(html.indexOf('PWA-BLOCK:START')).toBeLessThan(html.indexOf('PWA-BLOCK:END'))
  })

  test('the legal block sits OUTSIDE the deletable one', () => {
    // The whole hazard in one assertion: if the notice ever falls between the
    // two markers, deleting the PWA block at send time silently deletes the
    // notification as well.
    const start = html.indexOf('PWA-BLOCK:START')
    const end = html.lastIndexOf('PWA-BLOCK:END')
    const notice = html.indexOf(NOTICE)
    expect(notice, 'the notice is inside the delete-me block').not.toBeGreaterThan(start)
    expect(notice).not.toBeGreaterThan(end)
  })

  test('can actually be sent as a Resend broadcast', () => {
    // Resend rejects a broadcast with no unsubscribe tag, so this is a hard
    // requirement rather than a courtesy.
    expect(html).toContain('{{{RESEND_UNSUBSCRIBE_URL}}}')
    // The pipe fallback matters: some rows have no first name at all.
    expect(html).toContain('{{{FIRST_NAME|there}}}')
  })

  test('contains no real email address', () => {
    // scripts/check-no-pii.mjs guards staged files; this guards the drafts even
    // when somebody commits with the hook bypassed. The repo is PUBLIC.
    const addresses = html.match(/[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/g) ?? []
    expect(addresses, `found ${addresses.join(', ')}`).toHaveLength(0)
  })
})

describe('the three drafts are three different emails', () => {
  test('no two share a subject line', () => {
    const titles = EMAILS.map((p) => read(p).match(/<title>([^<]+)<\/title>/)?.[1]?.trim())
    expect(titles.every(Boolean), 'a draft has no <title>').toBe(true)
    expect(new Set(titles).size, 'two drafts share a title').toBe(EMAILS.length)
  })

  test('only the never-played draft omits the Pro line', () => {
    // wordle-teams-puw4: production holds exactly one `pro` subscriber, and the
    // 331 who never entered a board are the wrong audience for an upsell. If a
    // future edit adds one there, this fails rather than shipping it.
    const [a, b, c] = EMAILS.map(read)
    expect(a, 'segment A lost its Pro line').toContain('/pricing')
    expect(b, 'segment B lost its Pro line').toContain('/pricing')
    expect(c, 'segment C gained a Pro pitch').not.toContain('/pricing')
  })
})
