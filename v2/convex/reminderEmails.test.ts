import { describe, expect, test, vi } from 'vitest'
import { boardEntryReminderEmail } from './reminderEmails.ts'

const email = () =>
  boardEntryReminderEmail({ firstName: 'Ada', siteUrl: 'https://beta.wordleteams.com' })

describe('boardEntryReminderEmail', () => {
  test('greets by first name', () => {
    expect(email().html).toContain('Hello Ada,')
    expect(email().text).toContain('Hello Ada,')
  })

  test('carries a plain-text part', () => {
    // Not optional politeness: some clients render text by preference, and a
    // mail with no text alternative scores worse with spam filters. Same
    // reasoning as inviteEmails.ts.
    expect(email().text.length).toBeGreaterThan(0)
  })

  test('the text part is multi-line, not one run-on paragraph', () => {
    // join('\n') vs join(' ') both produce non-empty strings, so a length
    // check alone can't tell them apart.
    expect(email().text).toContain('Hello Ada,\n\n')
    expect(email().text.split('\n').length).toBeGreaterThan(5)
  })

  test('states why the reader is receiving this', () => {
    // A template that keeps the greeting and sign-off but drops the actual
    // reason for the email would still pass every other test here.
    expect(email().html).toContain('Reminder to enter your Wordle board into')
    expect(email().html).toContain(
      'It looks like you have not yet entered your Wordle board for today',
    )
    expect(email().text).toContain(
      'It looks like you have not yet entered your Wordle board for today',
    )
  })

  test('images carry the alt text a screen reader needs', () => {
    // The title image is content ("Wordle Teams"); the small round icon next
    // to the sign-off is decorative and must not repeat that name aloud.
    expect(email().html).toContain('alt="Wordle Teams"')
    expect(email().html).toContain('alt=""')
  })

  test('escapes a hostile name in the HTML part only', () => {
    const hostile = boardEntryReminderEmail({
      firstName: '<script>alert(1)</script>',
      siteUrl: 'https://beta.wordleteams.com',
    })
    expect(hostile.html).not.toContain('<script>')
    expect(hostile.html).toContain('&lt;script&gt;')
    // The text part is not markup. Escaping it would show a reader the literal
    // &amp; in a name containing an ampersand.
    expect(hostile.text).toContain('<script>')
  })

  test('escapes quotes as well as angle brackets', () => {
    // A check that only exercises < and > would still pass a version of
    // escapeHtml narrowed to just those two characters.
    const quoted = boardEntryReminderEmail({
      firstName: `Ada "the" O'Hara`,
      siteUrl: 'https://beta.wordleteams.com',
    })
    expect(quoted.html).toContain('&quot;the&quot;')
    expect(quoted.html).toContain('O&#39;Hara')
  })

  test('escapes siteUrl so it cannot break out of the img attribute', () => {
    // siteUrl is server-configured (SITE_URL), not user input, so this is not
    // exploitable today — but it lands in two src="..." attributes exactly
    // the way signInUrl lands in inviteEmails.ts's href="...", and that one
    // is escaped unconditionally rather than on a case-by-case risk judgment.
    const hostile = boardEntryReminderEmail({
      firstName: 'Ada',
      siteUrl: 'https://x.test/" onerror="alert(1)',
    })
    expect(hostile.html).not.toContain('onerror="alert(1)"')
    expect(hostile.html).toContain('&quot;')
  })

  test('every image is served from our own origin', () => {
    // The whole point of this task. Supabase retires in Phase 9.
    expect(email().html).not.toContain('supabase.co')
    expect(email().html).toContain('https://beta.wordleteams.com/wordle-teams-title.png')
    expect(email().html).toContain('https://beta.wordleteams.com/wt-icon-192x192.png')
  })

  test('links to the app itself in both parts, not just images from it', () => {
    // The mail asks the reader to go do something in the app; leaving siteUrl
    // wired only into <img src> gives them nowhere to click or paste.
    //
    // THE LINK IS `/app`, NOT THE BARE ORIGIN. Phase 7 Task 1 moved the
    // dashboard off `/`, which becomes the marketing landing — so the one
    // clickable thing in a board-entry reminder has to name the dashboard
    // explicitly or it sends a reminded player to a sales page. The text
    // part's origin is the signature block under "Wordle Teams", not a call
    // to action, and stays bare.
    expect(email().html).toMatch(/<a\s[^>]*href="https:\/\/beta\.wordleteams\.com\/app"/)
    expect(email().text).toContain('https://beta.wordleteams.com')
  })

  test('both images sit inside a dark panel, not floating on the white card', () => {
    // Both PNGs measure 0% transparent with a dominant colour of #0d0d0d
    // (77% and 85%) — solid near-black rectangles on the white card, and
    // Outlook's Word engine drops border-radius entirely, turning the round
    // icon into a black square. The owner chose an explicit dark panel
    // (2026-08-28) over re-cutting the assets, set via both the `bgcolor`
    // attribute and a CSS background-color so Outlook keeps it even where it
    // drops the style. A future edit that floats either image back onto the
    // white card directly, with no enclosing panel, should fail here.
    const html = email().html
    const titleIdx = html.indexOf('wordle-teams-title.png')
    const iconIdx = html.indexOf('wt-icon-192x192.png')
    expect(titleIdx).toBeGreaterThan(-1)
    expect(iconIdx).toBeGreaterThan(-1)

    // Look at the markup immediately enclosing each <img>, not just anywhere
    // in the document, so this fails if the panel exists but wraps the wrong
    // element.
    const aroundTitle = html.slice(Math.max(0, titleIdx - 400), titleIdx)
    const aroundIcon = html.slice(Math.max(0, iconIdx - 400), iconIdx)
    expect(aroundTitle).toContain('bgcolor="#0d0d0d"')
    expect(aroundTitle).toContain('background-color:#0d0d0d')
    expect(aroundIcon).toContain('bgcolor="#0d0d0d"')
    expect(aroundIcon).toContain('background-color:#0d0d0d')
  })

  test('the subject names the app', () => {
    expect(email().subject).toContain('Wordle Teams')
  })

  test('the subject is stable regardless of when it is generated', () => {
    // v1's subject default (`Board Entry Reminder ${formatDate(new Date(), ...)}`)
    // read the clock once, at Zod-schema-default time, so a long-running
    // server stamped every reminder with the date it booted rather than the
    // date it was sent. Checking for the absence of one date FORMAT doesn't
    // rule out a differently-formatted timestamp doing the same thing;
    // calling twice with the clock moved in between does.
    vi.useFakeTimers()
    try {
      vi.setSystemTime(new Date('2026-01-01T00:00:00Z'))
      const first = email().subject
      vi.setSystemTime(new Date('2026-06-15T00:00:00Z'))
      const second = email().subject
      expect(first).toBe(second)
    } finally {
      vi.useRealTimers()
    }
  })

  test('handles an empty firstName without a stray space', () => {
    // schema.ts:44-66: firstName is required but can still be '' — though
    // that specific case is unreachable in practice; see the whitespace test
    // below for the case that actually matters.
    const noName = boardEntryReminderEmail({ firstName: '', siteUrl: 'https://beta.wordleteams.com' })
    expect(noName.html).toContain('Hello,')
    expect(noName.html).not.toMatch(/Hello +,/)
    expect(noName.text).toContain('Hello,')
    expect(noName.text).not.toMatch(/Hello +,/)
  })

  test('trims a whitespace-only firstName before greeting', () => {
    // '' is unreachable (isCompleteName trims before checking), but a
    // whitespace-only name is not: isNamed (scripts/lib/copy-filters.mjs) is
    // `Boolean(first_name && last_name)`, which a string of spaces satisfies,
    // and upsertPlayers (migrate.ts) inserts the copied row with no trim of
    // its own. A naive `firstName ? ... : 'Hello,'` guard is truthy for '   '
    // and produces the literal "Hello    ," — the exact failure this guards
    // against.
    const blank = boardEntryReminderEmail({ firstName: '   ', siteUrl: 'https://beta.wordleteams.com' })
    expect(blank.html).toContain('Hello,')
    expect(blank.html).not.toMatch(/Hello +,/)
    expect(blank.text).toContain('Hello,')
    expect(blank.text).not.toMatch(/Hello +,/)
  })

  test('does not escape an ampersand in the text part', () => {
    const amp = boardEntryReminderEmail({ firstName: 'A & B', siteUrl: 'https://beta.wordleteams.com' })
    expect(amp.html).toContain('A &amp; B')
    expect(amp.text).toContain('Hello A & B,')
  })

  test('the footer points at the Account menu, not v1\'s user dropdown', () => {
    // v1's copy named a surface ("the Notifications option in the user
    // dropdown at the top right of your screen") that Phase 6 Task 6 replaced
    // with a hamburger "Account menu" button (user-menu.tsx). Sending every
    // recipient v1's stale instructions would point them nowhere.
    expect(email().html).toContain('Account menu')
    expect(email().html).not.toContain('user dropdown')
    expect(email().text).toContain('Account menu')
  })
})
