// @vitest-environment jsdom
//
// MIRRORS pending-invite.test.ts, test for test, and for the same reasons that
// file states at its top: jsdom because this module is nothing but Web
// Storage, and BOTH stores installed by hand because jsdom's ambient
// localStorage has no getItem — a session/local swap would otherwise throw into
// the catch and pass by accident.
//
// ONE ADDITION: `forgetPendingChallenge`. A challenge token is not spent where
// it is taken (the dashboard forwards it to the challenge page), so the page
// needs a plain clear for the three moments the stash's job ends — a player
// arriving, an accept, and a dead link.
import { afterEach, beforeEach, describe, expect, test } from 'vitest'
import { PENDING_INVITE_KEY } from './pending-invite.ts'
import {
  PENDING_CHALLENGE_KEY,
  forgetPendingChallenge,
  rememberPendingChallenge,
  takePendingChallenge,
} from './pending-challenge.ts'

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

let session: Fake
let local: Fake

const install = (name: 'sessionStorage' | 'localStorage', value: Fake) =>
  Object.defineProperty(window, name, { configurable: true, value })

beforeEach(() => {
  session = fakeStorage()
  local = fakeStorage()
  install('sessionStorage', session)
  install('localStorage', local)
})

afterEach(() => {
  Reflect.deleteProperty(window, 'sessionStorage')
  Reflect.deleteProperty(window, 'localStorage')
})

describe('the pending challenge token', () => {
  test('survives a round trip, which is the whole job', () => {
    rememberPendingChallenge('abc123')
    expect(takePendingChallenge()).toBe('abc123')
  })

  test('is undefined before anything stashes one', () => {
    expect(takePendingChallenge()).toBeUndefined()
  })

  test('has its own key, so it can never be read as an invite or vice versa', () => {
    // The dashboard reads both. One shared key would spend a challenge token
    // through consumeLink, or forward an invite token to /challenge.
    expect(PENDING_CHALLENGE_KEY).toBe('wt.pendingChallengeToken')
    expect(PENDING_CHALLENGE_KEY).not.toBe(PENDING_INVITE_KEY)
  })

  test('goes in sessionStorage and NOT localStorage', () => {
    // A capability must not outlive the tab it was opened in.
    rememberPendingChallenge('abc123')
    expect(session.peek(PENDING_CHALLENGE_KEY)).toBe('abc123')
    expect(local.peek(PENDING_CHALLENGE_KEY)).toBeNull()
  })

  test('is CLEARED by the read, so the resume cannot loop', () => {
    // The dashboard's resume navigates to /challenge on finding a token. A
    // token still in storage afterwards is found again on the next dashboard
    // render, and the one after that: the dashboard becomes unreachable.
    rememberPendingChallenge('abc123')
    expect(takePendingChallenge()).toBe('abc123')
    expect(takePendingChallenge()).toBeUndefined()
    expect(session.peek(PENDING_CHALLENGE_KEY)).toBeNull()
  })

  test('is cleared even when the caller throws away what it got back', () => {
    rememberPendingChallenge('abc123')
    void takePendingChallenge()
    expect(session.peek(PENDING_CHALLENGE_KEY)).toBeNull()
  })

  test('forget clears it without reading it, and leaves an invite alone', () => {
    rememberPendingChallenge('abc123')
    session.setItem(PENDING_INVITE_KEY, 'invite-token')
    forgetPendingChallenge()
    expect(session.peek(PENDING_CHALLENGE_KEY)).toBeNull()
    expect(session.peek(PENDING_INVITE_KEY)).toBe('invite-token')
  })

  test('does not throw when the store is blocked, on the way in', () => {
    install('sessionStorage', fakeStorage(['setItem']))
    expect(() => rememberPendingChallenge('abc123')).not.toThrow()
  })

  test('does not throw when the store is blocked, on the way out', () => {
    install('sessionStorage', fakeStorage(['getItem']))
    expect(() => takePendingChallenge()).not.toThrow()
    expect(takePendingChallenge()).toBeUndefined()
  })

  test('forget does not throw when the store is blocked', () => {
    // It runs on the challenge page's arrival for every signed-in player: a
    // throw there is a blank page for a private-mode visitor.
    install('sessionStorage', fakeStorage(['removeItem']))
    expect(() => forgetPendingChallenge()).not.toThrow()
  })

  test('refuses to hand back a token it could not mark as spent', () => {
    const blocked = fakeStorage(['removeItem'])
    blocked.setItem(PENDING_CHALLENGE_KEY, 'abc123')
    install('sessionStorage', blocked)
    expect(takePendingChallenge()).toBeUndefined()
  })
})
