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
 * THE PWA BLOCK IS NOW PERMANENT (owner's decision, 2026-09-30, recorded in
 * docs/runbooks/launch-email-send.md §0b), so the send-time deletion these tests
 * were first written against no longer happens. The structural assertions stay,
 * for two reasons. The markers are still the boundary that keeps the legal notice
 * identifiably separate from the PWA paragraph, and the decision to ship the block
 * is exactly the kind that gets revisited — if it is ever made conditional again,
 * the delimiters have to already be correct rather than correct-in-a-hurry.
 *
 * NOTHING HERE CHECKS PROSE QUALITY. It checks that the required sentence, both
 * links, the unsubscribe tag and both block markers are present, and that no
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

/**
 * The declarations one selector makes inside the dark-mode block, comments removed.
 *
 * Every assertion about dark mode goes through here rather than searching the block
 * as text, because the block contains prose that names the same hex values the rules
 * use, and several rules legitimately share a value.
 */
function darkRule(html: string, selector: string): string {
  const block = html.match(/@media \(prefers-color-scheme: dark\) \{([\s\S]*?)\n {2}\}/)?.[1]
  expect(block, 'no dark-mode block').toBeTruthy()
  const rules = block!.replace(/\/\*[\s\S]*?\*\//g, '')
  const escaped = selector.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
  const match = rules.match(new RegExp(`${escaped}\\s*\\{([^}]*)\\}`))
  expect(match, `no dark rule for ${selector}`).toBeTruthy()
  return match![1]
}

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

  test('the PWA block is delimited by exactly one marker at each end', () => {
    // EXACTLY ONE, NOT AT LEAST ONE, AND A MUTANT PROVED WHY. The START comment
    // used to spell out "down to PWA-BLOCK:END" as its instruction, which put a
    // second copy of the closing marker INSIDE the opening one. Deleting the real
    // END marker altogether then left both a `toContain` and an index-ordering
    // assertion green, because both found the decoy in the comment above. The
    // opening comment now names no marker at all, and this counts rather than
    // searches.
    const count = (marker: string) => html.split(marker).length - 1
    expect(count('PWA-BLOCK:START'), 'expected exactly one START marker').toBe(1)
    expect(count('PWA-BLOCK:END'), 'expected exactly one END marker').toBe(1)
    // START must come first, or the span the markers describe is inverted.
    expect(html.indexOf('PWA-BLOCK:START')).toBeLessThan(html.indexOf('PWA-BLOCK:END'))
  })

  test('the legal notice sits OUTSIDE the PWA block', () => {
    // If the notice ever falls between the two markers it stops being separable
    // from the PWA paragraph — and if the block is ever made conditional again,
    // removing it would silently remove the notification with it.
    const start = html.indexOf('PWA-BLOCK:START')
    const end = html.lastIndexOf('PWA-BLOCK:END')
    const notice = html.indexOf(NOTICE)
    expect(notice, 'the notice is inside the PWA block').not.toBeGreaterThan(start)
    expect(notice).not.toBeGreaterThan(end)
  })

  test('can actually be sent as a Resend broadcast', () => {
    // Resend rejects a broadcast with no unsubscribe tag, so this is a hard
    // requirement rather than a courtesy.
    expect(html).toContain('{{{RESEND_UNSUBSCRIBE_URL}}}')
    // The pipe fallback matters: some rows have no first name at all.
    expect(html).toContain('{{{FIRST_NAME|there}}}')
  })

  test('every coloured link can be reached by the dark-mode rules', () => {
    // WHY THIS IS A TEST AND NOT A ONE-OFF FIX. An email sets colour inline,
    // because clients strip <style>. A dark-mode override therefore has to win
    // against an inline colour, which means `!important` AND a class on the very
    // element that carries the inline colour. Six links per draft had the inline
    // colour and no class, so dark mode left them at their light value: measured
    // 3.67:1 for #15803d and 3.49:1 for #6b6b74 on the dark card, both failing AA
    // for normal text -- and the pair carrying it were Terms and Privacy, the two
    // links this email legally exists to deliver.
    const coloured = html.match(/<a\b[^>]*style="[^"]*\bcolor:[^"]*"[^>]*>/g) ?? []
    expect(coloured.length, 'no coloured links found at all — selector is stale').toBeGreaterThan(0)
    // THREE DECLARED INTENTS, and a coloured link must pick one:
    //   lk        an accent link on a card ground   -> #22c55e in dark
    //   lk-mute   a quiet text link                 -> #a3a3a3 in dark
    //   lk-solid  white on a solid coloured ground, correct in BOTH themes
    //             (the CTA button, 5.02:1 either way), so deliberately no override
    // An untagged coloured link is the bug this test exists for, not a preference.
    const unreachable = coloured.filter(
      (tag) => !/class="(?:[^"]*\s)?lk(?:-mute|-solid)?(?:\s[^"]*)?"/.test(tag),
    )
    expect(unreachable, `links with an inline colour and no dark class: ${unreachable.join(' | ')}`).toEqual([])
  })

  test('the dark rules restate the card BORDER, not just its background', () => {
    // Overriding only the background left the inline #e4e4e7 border in place,
    // which drew a bright light-mode outline around a dark card. Easy to miss,
    // because every word on the card was already correct.
    expect(darkRule(html, '.card'), '.card dark rule sets no border-color').toContain('border-color')
  })

  test('the dark palette is the product\u2019s own, not an approximation', () => {
    // src/styles.css .dark — surface, sunken and text. An email that drifts from
    // the app's dark palette looks like a different product beside it.
    //
    // PER RULE, NOT PER BLOCK, AND TWO MUTANTS ARE WHY. Searching the whole dark
    // block for a hex proved unfalsifiable twice over: first because the block
    // opens with a comment naming the very tokens it copies, and then because
    // #1c1c1c and #fafafa each appear in three rules, so changing .sunken or
    // .t-head left the hex sitting in .tile-absent and .stepnum and the assertion
    // still passed. Ask each rule what IT declares.
    expect(darkRule(html, '.card'), 'card ground is not the app surface').toContain('#121212')
    expect(darkRule(html, '.sunken'), 'sunken ground is not the app sunken').toContain('#1c1c1c')
    expect(darkRule(html, '.t-head'), 'heading colour is not the app text').toContain('#fafafa')
    expect(darkRule(html, '.t-mute'), 'muted colour is not the app text-muted').toContain('#a3a3a3')
    expect(darkRule(html, '.lk'), 'accent link is not the app dark accent-solid').toContain('#22c55e')
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
