// @vitest-environment jsdom
//
// jsdom, and localStorage installed by hand, for the reasons
// src/lib/last-login.test.ts states at its top: the suite's default
// edge-runtime has no localStorage at all, and under this jsdom the ambient
// `window.localStorage` is a plain object with no `getItem` — so a module that
// did nothing would throw into its own catch and these tests would pass for the
// wrong reason. Same fake, same reason.
//
// THE MENU HALF IS wordle-teams-ued7.3 (app-menu.tsx). Everything mechanical
// about the release marker and the seen-state is here, where it can be
// executed; the menu only has to call it.
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'
import {
  LATEST_RELEASE,
  WHATS_NEW_PROBE_KEY,
  WHATS_NEW_SEEN_KEY,
  WHATS_NEW_URL,
  canRememberRelease,
  hasUnreadRelease,
  markReleaseSeen,
  readSeenRelease,
} from './whats-new.ts'

/** A Storage that behaves, or one that throws the way a blocked store does. */
function fakeStorage(throwsOn: ReadonlyArray<'getItem' | 'setItem' | 'removeItem'> = []) {
  const entries = new Map<string, string>()
  const guard = (name: 'getItem' | 'setItem' | 'removeItem') => {
    if (throwsOn.includes(name)) throw new DOMException('blocked', 'SecurityError')
  }
  return {
    getItem: (key: string) => (guard('getItem'), entries.get(key) ?? null),
    setItem: (key: string, value: string) => (guard('setItem'), void entries.set(key, value)),
    removeItem: (key: string) => (guard('removeItem'), void entries.delete(key)),
    /** Read straight out, bypassing the guards, so a test can see the truth. */
    peek: (key: string) => entries.get(key) ?? null,
  }
}

type Fake = ReturnType<typeof fakeStorage>

let local: Fake
let session: Fake

const install = (name: 'sessionStorage' | 'localStorage', value: Fake) =>
  Object.defineProperty(window, name, { configurable: true, value })

beforeEach(() => {
  local = fakeStorage()
  session = fakeStorage()
  install('localStorage', local)
  install('sessionStorage', session)
})

afterEach(() => {
  vi.unstubAllGlobals()
  Reflect.deleteProperty(window, 'localStorage')
  Reflect.deleteProperty(window, 'sessionStorage')
})

describe('the release marker', () => {
  test('is an ISO calendar date, so string order IS date order', () => {
    // hasUnreadRelease compares with `<` on strings. That is only date order
    // for zero-padded YYYY-MM-DD; '2026-9-30' sorts AFTER '2026-10-06'.
    expect(LATEST_RELEASE).toMatch(/^\d{4}-\d{2}-\d{2}$/)
    const [y, m, d] = LATEST_RELEASE.split('-').map(Number)
    const parsed = new Date(Date.UTC(y, m - 1, d))
    // Round-trips, so it is a real day and not '2026-13-45'.
    expect(parsed.toISOString().slice(0, 10)).toBe(LATEST_RELEASE)
  })

  test('the link is the Feedbase changelog, over https', () => {
    const url = new URL(WHATS_NEW_URL)
    expect(url.protocol).toBe('https:')
    expect(url.hostname).toBe('feedback.wordleteams.com')
    expect(url.pathname).toBe('/changelog')
  })

  test('the seen key follows the house wt.<area>.<name> spelling', () => {
    expect(WHATS_NEW_SEEN_KEY).toBe('wt.whatsNew.seen')
  })
})

describe('hasUnreadRelease', () => {
  const latest = '2026-10-06'

  test('a signed-out visitor never has an unread release (AC4)', () => {
    expect(hasUnreadRelease({ seen: null, latest, signedIn: false })).toBe(false)
    expect(hasUnreadRelease({ seen: '2026-01-01', latest, signedIn: false })).toBe(false)
  })

  test('a signed-in player with nothing stored DOES (the first-visit rule, AC2)', () => {
    // Existing players must learn of this release once; a silent first visit
    // was ruled out in the epic.
    expect(hasUnreadRelease({ seen: null, latest, signedIn: true })).toBe(true)
  })

  test('having seen exactly the latest release is read', () => {
    expect(hasUnreadRelease({ seen: latest, latest, signedIn: true })).toBe(false)
  })

  test('having seen an OLDER release is unread, so a bump re-lights the dot (AC5)', () => {
    expect(hasUnreadRelease({ seen: '2026-10-05', latest, signedIn: true })).toBe(true)
    expect(hasUnreadRelease({ seen: '2025-12-31', latest, signedIn: true })).toBe(true)
  })

  test('having seen a NEWER release than this build knows is read', () => {
    // A tab running an older deploy than one the player already saw.
    expect(hasUnreadRelease({ seen: '2026-10-07', latest, signedIn: true })).toBe(false)
  })
})

describe('the seen-state in storage', () => {
  test('is null before anything has been seen', () => {
    expect(readSeenRelease()).toBeNull()
  })

  test('marking then reading round-trips LATEST_RELEASE by default (AC3)', () => {
    markReleaseSeen()
    expect(readSeenRelease()).toBe(LATEST_RELEASE)
    expect(hasUnreadRelease({ seen: readSeenRelease(), latest: LATEST_RELEASE, signedIn: true })).toBe(
      false,
    )
  })

  test('marking an explicit release stores that release', () => {
    markReleaseSeen('2026-01-02')
    expect(readSeenRelease()).toBe('2026-01-02')
  })

  test('goes in localStorage, under its key, and NOT sessionStorage', () => {
    // Per-browser and lasting: a dot that came back every new tab would be
    // noise, and sessionStorage would pass every round-trip test above.
    markReleaseSeen()
    expect(local.peek(WHATS_NEW_SEEN_KEY)).toBe(LATEST_RELEASE)
    expect(session.peek(WHATS_NEW_SEEN_KEY)).toBeNull()
  })

  test('a malformed stored value reads as never-seen, and marking repairs it', () => {
    // A value that is not YYYY-MM-DD cannot be ordered against the marker.
    // Compared raw, anything starting with a letter or '9' sorts after every
    // real date and would silence the dot FOREVER; treated as unseen, the dot
    // shows once and the click overwrites it with a good value.
    for (const bad of ['zzz', '9999', '2026-9-30', '', 'true', '2026-10-06T00:00:00Z']) {
      local.setItem(WHATS_NEW_SEEN_KEY, bad)
      expect(readSeenRelease()).toBeNull()
    }
    markReleaseSeen()
    expect(readSeenRelease()).toBe(LATEST_RELEASE)
  })

  test('a blocked store reads as null and does not throw (AC6)', () => {
    install('localStorage', fakeStorage(['getItem']))
    expect(() => readSeenRelease()).not.toThrow()
    expect(readSeenRelease()).toBeNull()
  })

  test('marking against a blocked store does not throw (AC6)', () => {
    // This is the What's new click handler: a throw there is a link that does
    // nothing, for a browser setting unrelated to a dot.
    install('localStorage', fakeStorage(['setItem']))
    expect(() => markReleaseSeen()).not.toThrow()
  })

  // A BLOCKED STORE IS NO DOT (AC6). readSeenRelease answers null for "blocked"
  // and "never seen" alike, and null is a dot for a signed-in player — one that
  // markReleaseSeen could never clear. The menu asks this first.
  test('canRememberRelease is true for a working store, false for a blocked one or none', () => {
    expect(canRememberRelease()).toBe(true)
    install('localStorage', fakeStorage(['getItem']))
    expect(() => canRememberRelease()).not.toThrow()
    expect(canRememberRelease()).toBe(false)
    vi.stubGlobal('window', undefined)
    expect(canRememberRelease()).toBe(false)
  })

  // A store that reads but refuses writes (quota exceeded; old Safari private
  // mode) would otherwise light a dot markReleaseSeen can never clear.
  test('canRememberRelease is false for a store that reads but cannot write', () => {
    install('localStorage', fakeStorage(['setItem']))
    expect(() => canRememberRelease()).not.toThrow()
    expect(canRememberRelease()).toBe(false)
  })

  test('canRememberRelease leaves nothing behind and does not touch the seen value', () => {
    local.setItem(WHATS_NEW_SEEN_KEY, '2026-01-01')
    expect(canRememberRelease()).toBe(true)
    expect(local.peek(WHATS_NEW_SEEN_KEY)).toBe('2026-01-01')
    expect(local.peek(WHATS_NEW_PROBE_KEY)).toBeNull()
  })

  test('with no window at all (SSR) reads null and marking is a no-op', () => {
    vi.stubGlobal('window', undefined)
    expect(() => readSeenRelease()).not.toThrow()
    expect(readSeenRelease()).toBeNull()
    expect(() => markReleaseSeen()).not.toThrow()
  })
})
