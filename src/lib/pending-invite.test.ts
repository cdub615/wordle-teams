// @vitest-environment jsdom
//
// jsdom, not the suite's default edge-runtime (vitest.config.ts): this module
// is nothing but Web Storage, and edge-runtime has no sessionStorage at all —
// every function here would throw its way into its own catch block and every
// test below would pass on a module that did nothing. `.test.ts` rather than
// `.test.tsx` because vitest.config.ts's glob is `src/**/*.test.ts`.
//
// THIS IS THE BEHAVIOURAL HALF, AND src/routes.test.ts SAYS OUTRIGHT THAT IT
// ONLY HAS THE OTHER ONE. Neither route file that uses these functions can be
// rendered under vitest — a route module registers against a router that does
// not exist, and routes/app.tsx's `Dashboard` is not exported — so what those
// files can be held to is the SHAPE they ship. Everything mechanical about the
// token's life is here, where it can be executed instead.
//
// BOTH STORES ARE THIS FILE'S OWN, AND THAT IS NOT TIDINESS. Measured while
// writing it: under this jsdom, `window.sessionStorage` is a real `Storage`
// but `window.localStorage` is a plain object with no `getItem` at all. So the
// mutation this file exists to kill — swapping one store for the other — would
// have thrown a TypeError straight into `rememberPendingInvite`'s catch and
// been reported as "the token did not survive", by accident and for the wrong
// reason, while the assertion that NAMES localStorage could never have run.
// That is the shape of green this suite is supposed to be immune to, so the
// stores are installed here and the ambient ones are never touched.
import { afterEach, beforeEach, describe, expect, test } from 'vitest'
import { PENDING_INVITE_KEY, rememberPendingInvite, takePendingInvite } from './pending-invite.ts'

/** A Storage that behaves, or one that throws the way a blocked store does. */
function fakeStorage(throwsOn: ReadonlyArray<'getItem' | 'setItem' | 'removeItem'> = []) {
  const entries = new Map<string, string>()
  const guard = (name: 'getItem' | 'setItem' | 'removeItem') => {
    // A blocked store throws on ACCESS rather than answering null — private
    // mode, and "block all site data". This is the case both functions exist
    // to survive.
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

describe('the pending invite token', () => {
  test('survives a round trip, which is the whole job', () => {
    rememberPendingInvite('abc123')
    expect(takePendingInvite()).toBe('abc123')
  })

  test('is undefined before anything stashes one', () => {
    // Not null, not '' — both callers branch on `if (!token)`, and a value that
    // is falsy by luck rather than by contract is the kind that stops being so.
    expect(takePendingInvite()).toBeUndefined()
  })

  test('goes in sessionStorage and NOT localStorage', () => {
    // THE CAPABILITY MUST NOT OUTLIVE THE TAB IT WAS OPENED IN. localStorage
    // passes every other test in this file — it round-trips, it clears, it
    // catches — which is exactly why this one names both stores instead of
    // asserting that the value came back.
    rememberPendingInvite('abc123')
    expect(session.peek(PENDING_INVITE_KEY)).toBe('abc123')
    expect(local.peek(PENDING_INVITE_KEY)).toBeNull()
  })

  test('is CLEARED by the read, so a refusal cannot retry for ever', () => {
    // THE PROPERTY THIS MODULE EXISTS TO MAKE STRUCTURAL. consumeLink refuses
    // an expired, revoked or unknown token, and refuses a free-tier joiner
    // already at the team cap — and a refused token still in storage is read
    // again on the next dashboard render, and the next: an error toast that
    // cannot be dismissed for good, and a mutation call per render. Clearing
    // in the caller's `.finally` reads as tidier and restores exactly that
    // loop, which is why the clear lives inside the read.
    rememberPendingInvite('abc123')
    expect(takePendingInvite()).toBe('abc123')
    expect(takePendingInvite()).toBeUndefined()
    expect(session.peek(PENDING_INVITE_KEY)).toBeNull()
  })

  test('is cleared even when the caller throws away what it got back', () => {
    // routes/app.tsx prefers `?join=` when the URL carries it and drops the
    // stashed copy on the floor. That copy still has to go: BOTH carriers are
    // filled on the signed-in path, so leaving the storage one behind would
    // spend it a second time on the next dashboard visit.
    rememberPendingInvite('abc123')
    void takePendingInvite()
    expect(session.peek(PENDING_INVITE_KEY)).toBeNull()
  })

  test('does not throw when the store is blocked, on the way in', () => {
    // This is the path of someone trying to join a team. A throw here is a
    // blank page where a sign-in form should be — for a browser setting that
    // has nothing to do with invites.
    install('sessionStorage', fakeStorage(['setItem']))
    expect(() => rememberPendingInvite('abc123')).not.toThrow()
  })

  test('does not throw when the store is blocked, on the way out', () => {
    // And here it would take down the whole dashboard, on arrival, for
    // everyone in that browser — not just link holders.
    install('sessionStorage', fakeStorage(['getItem']))
    expect(() => takePendingInvite()).not.toThrow()
    expect(takePendingInvite()).toBeUndefined()
  })

  test('refuses to hand back a token it could not mark as spent', () => {
    // If the REMOVAL is what fails, returning the value anyway puts the caller
    // in the retry loop this whole design is built to avoid. Refusing loses one
    // invite in a browser that does not exist in practice — a store whose
    // getItem works and whose removeItem does not; returning it burns a
    // mutation and a toast on every render in one that might.
    const blocked = fakeStorage(['removeItem'])
    blocked.setItem(PENDING_INVITE_KEY, 'abc123')
    install('sessionStorage', blocked)
    expect(takePendingInvite()).toBeUndefined()
  })
})
