// @vitest-environment jsdom
//
// jsdom, not the suite's default edge-runtime (vitest.config.ts): this module is
// nothing but Web Storage, and edge-runtime has no localStorage at all — every
// function here would throw its way into its own catch block and every test
// below would pass on a module that did nothing. `.test.ts` rather than
// `.test.tsx` because vitest.config.ts's glob is `src/**/*.test.ts`.
//
// BOTH STORES ARE INSTALLED HERE AND THE AMBIENT ONES ARE NEVER TOUCHED, for
// the reason src/lib/pending-invite.test.ts measured and wrote down: under this
// jsdom, `window.sessionStorage` is a real `Storage` but `window.localStorage`
// is a plain object with no `getItem` at all. So the mutation this file exists
// to kill — swapping one store for the other — would have thrown a TypeError
// straight into a catch block and been reported as "no badge", by accident and
// for the wrong reason, while the assertion that NAMES localStorage could never
// have run. Same shape of fake, same reason.
//
// THE ROUTE HALF IS IN src/routes.test.ts. Neither route module that uses these
// functions can be rendered under vitest — a route file registers against a
// router that does not exist — so where the calls sit is pinned there by
// reading source, and everything mechanical about the two keys is here, where
// it can be executed instead.
import { afterEach, beforeEach, describe, expect, test } from 'vitest'
import {
  LOGIN_LAST_KEY,
  LOGIN_PENDING_KEY,
  lastLoginMethod,
  promoteLoginAttempt,
  rememberLoginAttempt,
} from './last-login.ts'

/** A Storage that behaves, or one that throws the way a blocked store does. */
function fakeStorage(throwsOn: ReadonlyArray<'getItem' | 'setItem' | 'removeItem'> = []) {
  const entries = new Map<string, string>()
  const guard = (name: 'getItem' | 'setItem' | 'removeItem') => {
    // A blocked store throws on ACCESS rather than answering null — private
    // mode, and "block all site data". This is the case all three functions
    // exist to survive.
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
  Reflect.deleteProperty(window, 'localStorage')
  Reflect.deleteProperty(window, 'sessionStorage')
})

describe('the last-used sign-in method', () => {
  test('is remembered across the round trip, which is the whole job', () => {
    rememberLoginAttempt('google')
    promoteLoginAttempt()
    expect(lastLoginMethod()).toBe('google')
  })

  test('is undefined on a device that has never signed in', () => {
    // Not null, not '' — /login branches by comparing this to a method id, and
    // a value that is falsy by luck rather than by contract is the kind that
    // stops being so.
    expect(lastLoginMethod()).toBeUndefined()
  })

  test('goes in localStorage and NOT sessionStorage', () => {
    // A per-DEVICE preference, so it has to outlive the tab: the returning
    // player this exists for is returning tomorrow, not in the same session.
    // sessionStorage passes every other test in this file — it round-trips, it
    // promotes, it catches — which is why this one names both stores instead of
    // asserting that the value came back.
    rememberLoginAttempt('google')
    promoteLoginAttempt()
    expect(local.peek(LOGIN_LAST_KEY)).toBe('google')
    expect(session.peek(LOGIN_LAST_KEY)).toBeNull()
  })

  test('does NOT move on an attempt alone', () => {
    // THE PROPERTY THE TWO KEYS EXIST FOR. Writing one key on click is the
    // obvious simplification and it badges a method that was never completed.
    rememberLoginAttempt('github')
    expect(lastLoginMethod()).toBeUndefined()
    expect(local.peek(LOGIN_PENDING_KEY)).toBe('github')
  })

  test('survives a bounce off a provider, still naming what last WORKED', () => {
    // Signed in with Google; later tapped GitHub and backed out of its consent
    // screen. Nothing reaches /app, so nothing is promoted — and the badge had
    // better still say Google, because GitHub is precisely the button that will
    // fail for this account again ("account not linked").
    rememberLoginAttempt('google')
    promoteLoginAttempt()
    rememberLoginAttempt('github')
    expect(lastLoginMethod()).toBe('google')
  })

  test('promotes nothing when there is no attempt to promote', () => {
    // An already-authenticated visitor arriving with the marker on the URL, or
    // a second arrival carrying it. Neither is evidence about a method, and
    // clearing `last` for want of a claim would take the badge away from a
    // player who did nothing wrong.
    rememberLoginAttempt('discord')
    promoteLoginAttempt()
    promoteLoginAttempt()
    expect(lastLoginMethod()).toBe('discord')
  })

  test('promotes nothing on a device with no history at all', () => {
    promoteLoginAttempt()
    expect(lastLoginMethod()).toBeUndefined()
  })

  test('clears the attempt as it promotes it, so it cannot be promoted twice', () => {
    // An attempt left in place is re-promoted by the NEXT marked arrival,
    // however long afterwards and whatever method that one used. Leaving the
    // clear to the caller reads tidier and restores exactly that.
    rememberLoginAttempt('google')
    promoteLoginAttempt()
    expect(local.peek(LOGIN_PENDING_KEY)).toBeNull()
  })

  test('treats a method it has never heard of as just another id', () => {
    // Passkey (wordle-teams-wty4.1.7) must cost this file nothing when it
    // lands, and a removed method must degrade to "no badge" rather than to a
    // throw. A union type or a validating read here would be a second place
    // that has to be widened in lockstep with the buttons.
    rememberLoginAttempt('passkey')
    promoteLoginAttempt()
    expect(lastLoginMethod()).toBe('passkey')
  })

  test('does not throw when the store is blocked, on the way in', () => {
    // This is /login's click handler. A throw here is a sign-in button that
    // does nothing, for a browser setting that has nothing to do with a badge.
    install('localStorage', fakeStorage(['setItem']))
    expect(() => rememberLoginAttempt('google')).not.toThrow()
  })

  test('does not throw when the store is blocked, on promotion', () => {
    // And here it would take down the whole dashboard, on arrival, for everyone
    // in that browser — the effect it hangs off is the one that mounts /app.
    install('localStorage', fakeStorage(['getItem']))
    expect(() => promoteLoginAttempt()).not.toThrow()
  })

  test('does not throw when the store is blocked, on the read', () => {
    // And here it is /login's RENDER: a blank page where the sign-in form
    // should be. Safari private mode is not a hypothetical on this traffic.
    install('localStorage', fakeStorage(['getItem']))
    expect(() => lastLoginMethod()).not.toThrow()
    expect(lastLoginMethod()).toBeUndefined()
  })
})
