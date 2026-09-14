// @vitest-environment jsdom
//
// jsdom, not the suite's default edge-runtime (vitest.config.ts): this module is
// Web Storage plus one `window` feature probe, and edge-runtime has neither — so
// every function would throw its way into its own catch block and every test
// here would pass against a module that did nothing. `.test.ts` rather than
// `.test.tsx` because vitest.config.ts's glob is `src/**/*.test.ts`.
//
// BOTH STORES ARE INSTALLED AND THE AMBIENT ONES ARE NEVER TOUCHED, for the
// reason src/lib/last-login.test.ts and src/lib/pending-invite.test.ts both
// measured and wrote down: under this jsdom, `window.sessionStorage` is a real
// `Storage` but `window.localStorage` is a plain object with NO `getItem` at
// all. So the mutation this file most needs to kill — swapping one store for
// the other — would have thrown a TypeError straight into a catch block and
// been reported as "no marker", by accident and for the wrong reason, while the
// assertion that NAMES localStorage could never have run. Same shape of fake,
// same reason.
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'
import {
  PASSKEY_DECLINED_KEY,
  PASSKEY_REGISTERED_KEY,
  passkeyRegisteredHere,
  passkeySupported,
  rememberPasskeyDeclined,
  rememberPasskeyRegistered,
  shouldOfferPasskey,
} from './passkey.ts'

/** A Storage that behaves, or one that throws the way a blocked store does. */
function fakeStorage(throwsOn: ReadonlyArray<'getItem' | 'setItem' | 'removeItem'> = []) {
  const entries = new Map<string, string>()
  const guard = (name: 'getItem' | 'setItem' | 'removeItem') => {
    // A blocked store throws on ACCESS rather than answering null — Safari
    // private mode, and "block all site data". This is the case every function
    // in the module exists to survive.
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

/**
 * WebAuthn present, or absent. jsdom implements no part of it, so `absent` is
 * the ambient state and `present` is the one that has to be built — which is
 * the right way round for a feature probe: the fake is only ever standing in
 * for "this browser has it", never for the thing under test.
 */
const supportWebAuthn = () =>
  Object.defineProperty(window, 'PublicKeyCredential', {
    configurable: true,
    value: function PublicKeyCredential() {},
  })

const unsupportWebAuthn = () => Reflect.deleteProperty(window, 'PublicKeyCredential')

beforeEach(() => {
  local = fakeStorage()
  session = fakeStorage()
  install('localStorage', local)
  install('sessionStorage', session)
  supportWebAuthn()
})

afterEach(() => {
  // UNSTUB FIRST, and the order is load-bearing rather than tidy: the SSR test
  // below stubs `window` itself to `undefined`, and every line after this one
  // dereferences it. Cleaning up in the other order throws here, aborts the
  // rest of the teardown, and leaves `window` undefined for the NEXT test's
  // setup — which is how this file first failed.
  vi.unstubAllGlobals()
  Reflect.deleteProperty(window, 'localStorage')
  Reflect.deleteProperty(window, 'sessionStorage')
  unsupportWebAuthn()
})

describe('whether this browser can do WebAuthn at all', () => {
  test('is false where PublicKeyCredential is absent', () => {
    // Firefox on some platforms, older Safari, and every non-browser runtime.
    // The offer and the /login button both hang off this: a passkey button in
    // a browser with no WebAuthn is a control that cannot do anything.
    unsupportWebAuthn()
    expect(passkeySupported()).toBe(false)
  })

  test('is true where it is present', () => {
    // Paired with the test above deliberately: on its own, the negative case
    // passes for a function that is hardcoded to `false`.
    expect(passkeySupported()).toBe(true)
  })

  test('is false rather than a TypeError when there is no window at all', () => {
    // THE SSR CASE. Every route in this app is server-rendered, so a probe that
    // dereferences `window` unguarded takes the whole document down before the
    // client ever runs. `undefined` rather than deleting the binding, because
    // that is what `typeof window` has to answer either way.
    vi.stubGlobal('window', undefined)
    expect(() => passkeySupported()).not.toThrow()
    expect(passkeySupported()).toBe(false)
  })
})

describe('the per-device markers', () => {
  test('a registration round-trips', () => {
    rememberPasskeyRegistered()
    expect(passkeyRegisteredHere()).toBe(true)
  })

  test('no marker means this device has not registered one', () => {
    expect(passkeyRegisteredHere()).toBe(false)
  })

  test('both markers go in localStorage and NOT sessionStorage', () => {
    // PER-DEVICE, so they have to outlive the tab: the whole point is that the
    // device which already has a passkey stops being asked, on every later
    // visit, for as long as the browser keeps the value. sessionStorage passes
    // every other test in this file — it round-trips, it suppresses, it catches
    // — which is why this one names both stores instead of asserting that a
    // value came back.
    rememberPasskeyRegistered()
    rememberPasskeyDeclined()
    expect(local.peek(PASSKEY_REGISTERED_KEY)).not.toBeNull()
    expect(local.peek(PASSKEY_DECLINED_KEY)).not.toBeNull()
    expect(session.peek(PASSKEY_REGISTERED_KEY)).toBeNull()
    expect(session.peek(PASSKEY_DECLINED_KEY)).toBeNull()
  })

  test('the two keys are distinct, so neither can stand in for the other', () => {
    // A single shared key would pass "false after registering" and "false after
    // declining" both, while making `passkeyRegisteredHere()` true for someone
    // who declined — and /login would then offer a passkey button to a device
    // that has no passkey, which is the dead-end tap the design rules out.
    expect(PASSKEY_REGISTERED_KEY).not.toBe(PASSKEY_DECLINED_KEY)
    rememberPasskeyDeclined()
    expect(passkeyRegisteredHere()).toBe(false)
  })
})

describe('whether to offer a passkey on this device', () => {
  test('yes, on a supported device that has neither registered nor declined', () => {
    expect(shouldOfferPasskey()).toBe(true)
  })

  test('no, once this device has registered one', () => {
    rememberPasskeyRegistered()
    expect(shouldOfferPasskey()).toBe(false)
  })

  test('no, once this device has declined', () => {
    rememberPasskeyDeclined()
    expect(shouldOfferPasskey()).toBe(false)
  })

  test('no, where WebAuthn is unavailable, markers or not', () => {
    // The offer's own precondition, not the caller's to remember. An offer that
    // leads to a ceremony this browser cannot start is worse than silence.
    unsupportWebAuthn()
    expect(shouldOfferPasskey()).toBe(false)
  })

  test('a decline on one device does not speak for another', () => {
    // THE PROPERTY THE WHOLE per-device DESIGN EXISTS FOR, stated the only way
    // a unit test can state it: the marker is in this device's storage, so a
    // store that never saw the write still offers. A server-side "this user has
    // passkeys" flag suppresses the offer on exactly the device that needs one.
    rememberPasskeyDeclined()
    expect(shouldOfferPasskey()).toBe(false)
    install('localStorage', fakeStorage())
    expect(shouldOfferPasskey()).toBe(true)
  })
})

describe('a blocked store is survived rather than propagated', () => {
  test('recording a registration does not throw', () => {
    // This runs inside the settings dialog's add-passkey handler, straight
    // after a ceremony the player has already completed. A throw here turns a
    // successful registration into a crashed tab.
    install('localStorage', fakeStorage(['setItem']))
    expect(() => rememberPasskeyRegistered()).not.toThrow()
  })

  test('recording a decline does not throw', () => {
    // And this one is the dismiss button on the post-login offer. A throw here
    // is a card that cannot be closed.
    install('localStorage', fakeStorage(['setItem']))
    expect(() => rememberPasskeyDeclined()).not.toThrow()
  })

  test('asking whether to offer does not throw, and suppresses', () => {
    // THE READ IS THE DANGEROUS ONE: it sits in a render, so a throw is a blank
    // screen where the app should be, for a browser setting that has nothing to
    // do with passkeys.
    //
    // AND IT ANSWERS `false`, WHICH IS A DECISION RATHER THAN A DEFAULT. When
    // the store is blocked a decline can never be recorded either, so answering
    // `true` would re-offer on every single sign-in, forever, with no way for
    // the player to stop it. Silence is the kinder failure.
    install('localStorage', fakeStorage(['getItem']))
    expect(() => shouldOfferPasskey()).not.toThrow()
    expect(shouldOfferPasskey()).toBe(false)
  })

  test('asking whether this device registered one does not throw, and says no', () => {
    // /login renders its passkey button from this. Unknown has to mean "no
    // button": a button shown on a guess opens a system sheet that says no
    // passkey was found, which is worse than not offering it.
    install('localStorage', fakeStorage(['getItem']))
    expect(() => passkeyRegisteredHere()).not.toThrow()
    expect(passkeyRegisteredHere()).toBe(false)
  })
})
