import { readFileSync } from 'node:fs'
import { describe, expect, test } from 'vitest'
import { readReminder, REMINDER_FALLBACK, resolveNotificationUrl } from './sw-push.ts'

/**
 * The worker's handling of remote input.
 *
 * Nothing imports src/sw.ts and there is no e2e for it — `pnpm dev` never
 * serves dist/client/sw.js — so before this file the only two functions in the
 * app that read a push payload had no coverage at all. One of them decides
 * where to navigate a user's browser.
 */

const ORIGIN = 'https://beta.wordleteams.com'

/** A `PushEvent.data` whose `json()` behaves however the test needs. */
const dataOf = (json: () => unknown) => ({ json })

describe('readReminder', () => {
  test('passes through the payload convex/pushSend.ts actually sends', () => {
    const sent = {
      title: 'Wordle Teams',
      body: "You have not entered today's board yet. Don't miss out on those points!",
      url: '/app',
    }
    expect(readReminder(dataOf(() => sent))).toEqual(sent)
  })

  test('a non-JSON body falls back instead of throwing', () => {
    // v1's `event.data?.json() ?? {}` died here: `??` guards a null `data`, not
    // a parse failure. The handler threw and Chrome showed its own "site
    // updated in the background" notice instead of the reminder.
    const thrower = dataOf(() => {
      throw new SyntaxError('Unexpected token < in JSON at position 0')
    })
    expect(() => readReminder(thrower)).not.toThrow()
    expect(readReminder(thrower)).toEqual(REMINDER_FALLBACK)
  })

  test('absent data falls back', () => {
    expect(readReminder(null)).toEqual(REMINDER_FALLBACK)
    expect(readReminder(undefined)).toEqual(REMINDER_FALLBACK)
  })

  test('a JSON `null` body falls back rather than throwing on property reads', () => {
    // `typeof null === 'object'`, so dropping the `parsed === null` half of the
    // guard leaves the property reads to throw. This is the mutant that check
    // exists for.
    expect(readReminder(dataOf(() => null))).toEqual(REMINDER_FALLBACK)
  })

  test('a non-object JSON body falls back', () => {
    // Flipping `typeof parsed !== 'object'` to `===` makes every one of these
    // take the wrong branch.
    expect(readReminder(dataOf(() => 'a string'))).toEqual(REMINDER_FALLBACK)
    expect(readReminder(dataOf(() => 42))).toEqual(REMINDER_FALLBACK)
    expect(readReminder(dataOf(() => true))).toEqual(REMINDER_FALLBACK)
  })

  test('EMPTY-STRING fields fall back, field by field', () => {
    // The truthiness half of `typeof x === 'string' && x`. An empty title is a
    // string and passes a typeof-only check, then renders as a blank line in
    // the notification shade.
    expect(readReminder(dataOf(() => ({ title: '', body: '', url: '' })))).toEqual(
      REMINDER_FALLBACK,
    )
  })

  test('wrong-typed fields fall back individually, keeping the good ones', () => {
    expect(readReminder(dataOf(() => ({ title: 42, body: 'real body', url: null })))).toEqual({
      title: REMINDER_FALLBACK.title,
      body: 'real body',
      url: REMINDER_FALLBACK.url,
    })
  })

  test('an object with no fields at all falls back on all three', () => {
    expect(readReminder(dataOf(() => ({})))).toEqual(REMINDER_FALLBACK)
  })

  test('ignores extra fields rather than forwarding them to showNotification', () => {
    const result = readReminder(
      dataOf(() => ({ title: 'a', body: 'b', url: '/c', requireInteraction: true })),
    )
    expect(result).toEqual({ title: 'a', body: 'b', url: '/c' })
    expect(Object.keys(result).sort()).toEqual(['body', 'title', 'url'])
  })
})

describe('resolveNotificationUrl', () => {
  const root = `${ORIGIN}/`
  /**
   * Where a REFUSED url lands. Not `${ORIGIN}/` any more: `/` is no longer the
   * dashboard, so the old clamp opened a not-found page and will open the
   * marketing landing once that ships — a sales page for someone who was just
   * reminded to enter a board. What the clamp guarantees is unchanged and is
   * what these tests assert: a refused url never leaves our origin.
   */
  const clamped = `${ORIGIN}${REMINDER_FALLBACK.url}`

  test('the clamp destination is itself on our origin, and navigable', () => {
    // The one thing the change above could have broken: every CLAMPS test
    // below now trusts this value, so it is checked directly rather than only
    // through them. REMINDER_FALLBACK.url is a hardcoded relative path, which
    // is why resolving it against `origin` is as safe as resolving `'/'` was.
    expect(REMINDER_FALLBACK.url.startsWith('/')).toBe(true)
    expect(new URL(clamped).origin).toBe(ORIGIN)
    expect(new URL(clamped).protocol).toBe('https:')
  })

  test('keeps a same-origin path', () => {
    expect(resolveNotificationUrl({ url: '/' }, ORIGIN)).toBe(root)
    expect(resolveNotificationUrl({ url: '/me' }, ORIGIN)).toBe(`${ORIGIN}/me`)
    expect(resolveNotificationUrl({ url: `${ORIGIN}/teams/7` }, ORIGIN)).toBe(`${ORIGIN}/teams/7`)
  })

  test('CLAMPS a cross-origin absolute url to our own origin', () => {
    // Deleting the origin comparison turns the push payload into an open
    // redirect that opens in the app's own window, launched from a
    // notification wearing our icon.
    expect(resolveNotificationUrl({ url: 'https://evil.example/x' }, ORIGIN)).toBe(clamped)
    expect(resolveNotificationUrl({ url: 'http://evil.example/x' }, ORIGIN)).toBe(clamped)
  })

  test('CLAMPS a PROTOCOL-RELATIVE url', () => {
    // The one a scheme blocklist misses: `//evil.example/x` keeps our scheme
    // and changes the host, and reads like a path to anyone skimming.
    expect(resolveNotificationUrl({ url: '//evil.example/x' }, ORIGIN)).toBe(clamped)
  })

  test('CLAMPS a javascript: url', () => {
    // `new URL('javascript:…').origin` is the opaque string "null", so the
    // positive origin comparison rejects it without needing to know the scheme.
    expect(resolveNotificationUrl({ url: 'javascript:alert(document.cookie)' }, ORIGIN)).toBe(clamped)
  })

  test('CLAMPS data: urls', () => {
    expect(resolveNotificationUrl({ url: 'data:text/html,<script>x()</script>' }, ORIGIN)).toBe(clamped)
  })

  test('CLAMPS a blob: url even though its ORIGIN MATCHES OURS', () => {
    // The case the origin comparison alone does not catch, and the reason
    // resolveNotificationUrl also checks the scheme: a blob URL inherits the
    // origin of its inner URL, so this really does satisfy
    // `target.origin === origin`. Found by this test, not by reasoning.
    expect(new URL(`blob:${ORIGIN}/abc`).origin).toBe(ORIGIN)
    expect(resolveNotificationUrl({ url: `blob:${ORIGIN}/abc` }, ORIGIN)).toBe(clamped)
  })

  test('CLAMPS a look-alike host that merely starts with our origin', () => {
    // A `startsWith(origin)` check instead of an origin comparison would let
    // this through.
    expect(resolveNotificationUrl({ url: 'https://beta.wordleteams.com.evil.example/x' }, ORIGIN),
    ).toBe(clamped)
  })

  test("falls back to the reminder's own destination when data carries no usable url", () => {
    // NOT `root`. A payload with no usable url is a malformed copy of the one
    // notification this app sends, so the sensible destination is the one that
    // notification asks for — REMINDER_FALLBACK.url, which Phase 7 Task 1 moved
    // from `/` to `/app` when the dashboard moved.
    //
    // A url that IS present and is refused now lands in the same place, which
    // it did not when this comment was first written. The security decision is
    // the ORIGIN, not the path: a refused url must not navigate off our site,
    // and `/` was never load-bearing for that. Sending both cases to the
    // dashboard just stops a clamped notification tap opening a page with no
    // route on it — see resolveNotificationUrl.
    const fallback = new URL(REMINDER_FALLBACK.url, ORIGIN).href
    expect(resolveNotificationUrl(undefined, ORIGIN)).toBe(fallback)
    expect(resolveNotificationUrl(null, ORIGIN)).toBe(fallback)
    expect(resolveNotificationUrl({}, ORIGIN)).toBe(fallback)
    expect(resolveNotificationUrl({ url: 42 }, ORIGIN)).toBe(fallback)
    expect(resolveNotificationUrl('not an object', ORIGIN)).toBe(fallback)
    expect(fallback).toBe(`${ORIGIN}/app`)
  })

  test('never throws, whatever the payload holds', () => {
    // The NUL is written as an escape, NOT as a literal byte. A literal one
    // makes this whole file `data` to grep, so a recursive source search
    // silently skips it and `git diff` renders it as binary. Phase 7 is a
    // grep-driven audit and that cost it real time (wt-ksh.8.44). The escape
    // is the same one-character string to the test.
    for (const url of ['', ' ', 'http://', '::::', '\u0000', 'https://[', 'x'.repeat(5000)]) {
      expect(() => resolveNotificationUrl({ url }, ORIGIN)).not.toThrow()
      expect(resolveNotificationUrl({ url }, ORIGIN).startsWith(ORIGIN)).toBe(true)
    }
  })

  test('every result is on our origin, for every input tried here', () => {
    const inputs: unknown[] = [
      undefined,
      null,
      {},
      { url: '/' },
      { url: '//evil.example' },
      { url: 'https://evil.example' },
      { url: 'javascript:1' },
      { url: 'data:,x' },
      { url: '\\\\evil.example' },
      { url: '/\\evil.example' },
      { url: `blob:${ORIGIN}/abc` },
    ]
    for (const input of inputs) {
      const resolved = new URL(resolveNotificationUrl(input, ORIGIN))
      expect(resolved.origin).toBe(ORIGIN)
      // And navigable: openWindow/navigate only accept http(s).
      expect(['https:', 'http:']).toContain(resolved.protocol)
    }
  })
})

describe('REMINDER_FALLBACK', () => {
  test('is byte-identical to the payload convex/pushSend.ts sends', () => {
    // The "CHANGE BOTH" comments on each side are a promise; this is what
    // enforces it. Editing the server copy alone desynchronises the
    // notification a user sees on a malformed push from the one they normally
    // see — invisible until it happens, and only to that user.
    const server = readFileSync(
      new URL('../../convex/pushSend.ts', import.meta.url),
      'utf8',
    )

    // BOUNDED AT BOTH ENDS. A one-argument `slice` runs to end of file, so
    // these assertions searched everything after the payload rather than the
    // payload itself: setting the real `url` to '/' and putting a second
    // JSON.stringify with url: '/app' later in `deliverTo` — the shape a
    // second notification type would naturally take — passed. And an
    // unfound anchor made `slice(-1)` yield the file's last character, so a
    // rename of the const produced a baffling `toContain` failure instead of
    // "the anchor is gone", which is what the assertion on `start` is for.
    const start = server.indexOf('const payload = JSON.stringify')
    expect(start, 'payload literal not found in convex/pushSend.ts').toBeGreaterThan(-1)
    const end = server.indexOf('})', start)
    expect(end, 'payload literal is never closed in convex/pushSend.ts').toBeGreaterThan(start)
    const segment = server.slice(start, end + 2)

    // AGREEMENT, NOT TYPOGRAPHY. The previous assertions baked in each field's
    // incidental quote style — `title: '…'` single, `body: "…"` double — so
    // changing the body copy identically in BOTH files to a string with no
    // apostrophe, which anyone would then single-quote, turned the test red on
    // two files that agreed perfectly. Unescaping first lets the same value
    // match whichever quote the source happens to use.
    const unescaped = segment.replace(/\\(['"])/g, '$1')
    const sends = (field: keyof typeof REMINDER_FALLBACK) =>
      new RegExp(
        `${field}:\\s*(['"])${REMINDER_FALLBACK[field].replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\1`,
      )

    expect(unescaped).toMatch(sends('title'))
    expect(unescaped).toMatch(sends('body'))
    expect(unescaped).toMatch(sends('url'))
  })
})
