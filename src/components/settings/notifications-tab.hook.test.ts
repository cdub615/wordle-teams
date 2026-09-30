// @vitest-environment jsdom
//
// jsdom, not the suite's default edge-runtime (vitest.config.ts), because this
// file renders the real component through @testing-library/react. Named
// `.hook.test.ts` to match the sibling precedent, src/lib/use-local-capture.
// hook.test.ts — and `.test.ts` rather than `.test.tsx` because
// vitest.config.ts:20's glob is `src/**/*.test.ts`. The JSX below therefore
// goes through `createElement` by hand; there is exactly one element.
//
// THIS FILE EXISTS BECAUSE THE SEAM IS WHERE THE BUG LIVED, TWICE.
// notifications-tab.test.ts imports only `label` and `pushFailureMessage`;
// nothing executed the handler or the JSX. Measured on 159eab4: an exact
// revert of the fix — putting `if (!browser) return` back at the top of
// handlePushToggle — left 869/869 green, and after moving the decision into
// applyPushToggle it STILL left 874/874 green, because no test ran the
// component. The lib tests pin the policy; these pin that the component
// actually delegates to it. Both are needed.
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { getFunctionName, type FunctionReference } from 'convex/server'
import { createElement } from 'react'
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'
import { api } from '../../../convex/_generated/api'
import NotificationsTab from './notifications-tab.tsx'
import type { PushManagerLike, PushSubscriptionLike } from '#/lib/push-subscribe.ts'

const { setMethodMock, savePushMock, removePushMock, toastSuccess, toastError } = vi.hoisted(
  () => ({
    setMethodMock: vi.fn().mockResolvedValue(null),
    savePushMock: vi.fn().mockResolvedValue(null),
    removePushMock: vi.fn().mockResolvedValue(null),
    toastSuccess: vi.fn(),
    toastError: vi.fn(),
  }),
)

/** Set per test, read by the mocked `useQuery`. */
let settings: {
  timeZone: string | null
  reminderDeliveryTime: string
  reminderDeliveryMethods: Array<string>
  hasPwa: boolean
}
let publicKey: string | null

vi.mock('@convex-dev/react-query', () => ({
  convexQuery: (ref: FunctionReference<'query'>) => ({ queryKey: [getFunctionName(ref)] }),
  useConvexMutation: (ref: FunctionReference<'mutation'>) => {
    const name = getFunctionName(ref)
    if (name === getFunctionName(api.settings.setReminderMethod)) return setMethodMock
    if (name === getFunctionName(api.push.savePushSubscription)) return savePushMock
    if (name === getFunctionName(api.push.removePushSubscription)) return removePushMock
    // The time-zone and reminder-time mutations are not exercised here.
    return vi.fn().mockResolvedValue(null)
  },
}))

vi.mock('@tanstack/react-query', () => ({
  useQuery: ({ queryKey }: { queryKey: Array<string> }) =>
    queryKey[0] === getFunctionName(api.push.publicKey)
      ? { data: publicKey, error: null }
      : { data: settings, error: null },
  // `mutateAsync` IS the injected function, so a rejection propagates exactly
  // as react-query's does. `isPending` stays false: the pending flag this file
  // cares about is the component's own `pushPending`, which is React state.
  useMutation: ({ mutationFn }: { mutationFn: (args: unknown) => Promise<unknown> }) => ({
    mutateAsync: mutationFn,
    isPending: false,
  }),
}))

vi.mock('sonner', () => ({ toast: { success: toastSuccess, error: toastError } }))

// window.matchMedia does not exist in jsdom (the same gap use-local-capture.
// hook.test.ts documents), and useMediaQuery only decides a label's width.
vi.mock('#/lib/use-media-query.ts', () => ({ useMediaQuery: () => false }))

const ENDPOINT = 'https://fcm.googleapis.com/fcm/send/CAPABILITY-URL-abc123'

function fakeSubscription(unsubscribe = vi.fn().mockResolvedValue(true)): PushSubscriptionLike {
  return {
    endpoint: ENDPOINT,
    getKey: () => new Uint8Array([1, 2, 3, 4]).buffer,
    unsubscribe,
  }
}

/**
 * Installs the two globals `browserPush()` reads. Called ONLY by the tests
 * that need a working browser — jsdom implements neither, so the default state
 * of this file is "a browser that cannot do push", which is exactly the case
 * the C1 regression below needs.
 */
function stubBrowser(pushManager: PushManagerLike | null, permission = 'granted') {
  vi.stubGlobal('Notification', { requestPermission: vi.fn().mockResolvedValue(permission) })
  Object.defineProperty(navigator, 'serviceWorker', {
    configurable: true,
    get: () => ({ ready: Promise.resolve(pushManager ? { pushManager } : {}) }),
  })
}

beforeEach(() => {
  settings = {
    timeZone: 'America/New_York',
    reminderDeliveryTime: '18:00:00',
    reminderDeliveryMethods: [],
    hasPwa: false,
  }
  publicKey = 'BEl6dxjbRhIu1yTPy0iBk7-5eXVc4RRTVEnJcO3vBBUvSHhVJfKvXFB0Q0Mv8G7lQ0d5r6ThPNmQ0lYqTmFRPjA'
})

afterEach(() => {
  cleanup()
  vi.unstubAllGlobals()
  Reflect.deleteProperty(navigator, 'serviceWorker')
  vi.clearAllMocks()
})

const pushSwitch = () => screen.getByRole('switch', { name: 'Push' })

// @testing-library/jest-dom is NOT a dependency here, so `toBeChecked` and
// friends do not exist. Reading the attributes directly is what Radix's Switch
// actually renders, and is what a screen reader sees.
const isChecked = () => pushSwitch().getAttribute('aria-checked')
const isDisabled = () => pushSwitch().hasAttribute('disabled')

describe('the Push switch — rule 1, whether it renders at all', () => {
  test('is absent where the deployment has no VAPID key', () => {
    publicKey = null
    render(createElement(NotificationsTab))

    expect(screen.queryByRole('switch', { name: 'Push' })).toBeNull()
    // The tab really rendered — without this the absence above would also
    // pass on a crashed or loading tab.
    expect(screen.getByRole('switch', { name: 'Email' })).toBeTruthy()
  })

  test('is absent while the key query is still loading', () => {
    publicKey = null
    render(createElement(NotificationsTab))
    expect(screen.queryByRole('switch', { name: 'Push' })).toBeNull()
  })

  test('renders where a key is configured', () => {
    render(createElement(NotificationsTab))
    expect(pushSwitch()).toBeTruthy()
  })
})

describe('the Push switch — rule 3, turning it OFF', () => {
  test('THE REVERTED BUG: off is honoured on a browser that cannot subscribe', async () => {
    // NO stubBrowser() — jsdom has neither `Notification` nor
    // `navigator.serviceWorker`, so `browserPush()` returns null. That is a
    // real browser: an older iOS Safari, or any origin with site data blocked.
    //
    // The player subscribed on another device, so the server's array holds
    // 'push' and the switch reads CHECKED. Clicking it must clear the method.
    // 58f0edf refused here and left the switch unclearable from this device;
    // an exact revert of the 159eab4 fix reintroduced that with the whole
    // suite green, twice, because nothing executed this path. This is that
    // test.
    settings.reminderDeliveryMethods = ['email', 'push']
    render(createElement(NotificationsTab))

    expect(isChecked()).toBe('true')
    fireEvent.click(pushSwitch())

    await waitFor(() => expect(setMethodMock).toHaveBeenCalled())
    expect(setMethodMock).toHaveBeenCalledWith({ method: 'push', enabled: false })
    // Nothing to remove server-side: this device never held the subscription.
    expect(removePushMock).not.toHaveBeenCalled()
    expect(toastSuccess).toHaveBeenCalledWith('Delivery methods updated')
    expect(toastError).not.toHaveBeenCalled()
  })

  test('off on a subscribed browser removes the stored row and the method', async () => {
    settings.reminderDeliveryMethods = ['email', 'push']
    stubBrowser({
      getSubscription: vi.fn().mockResolvedValue(fakeSubscription()),
      subscribe: vi.fn(),
    })
    render(createElement(NotificationsTab))

    fireEvent.click(pushSwitch())

    await waitFor(() => expect(setMethodMock).toHaveBeenCalled())
    expect(removePushMock).toHaveBeenCalledWith({ endpoint: ENDPOINT })
    expect(setMethodMock).toHaveBeenCalledWith({ method: 'push', enabled: false })
  })

  test('a failed browser-side unsubscribe warns WITHOUT logging the endpoint', async () => {
    // A push endpoint is a CAPABILITY URL: anyone holding it can send this
    // player notifications until it expires. The console is copied into bug
    // reports and read over shoulders, so the endpoint must never reach it.
    // Nothing else in the suite would notice if it were added.
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    settings.reminderDeliveryMethods = ['push']
    stubBrowser({
      getSubscription: vi
        .fn()
        .mockResolvedValue(
          fakeSubscription(vi.fn().mockRejectedValue(new Error('not permitted'))),
        ),
      subscribe: vi.fn(),
    })
    render(createElement(NotificationsTab))

    fireEvent.click(pushSwitch())

    await waitFor(() => expect(warn).toHaveBeenCalled())
    expect(JSON.stringify(warn.mock.calls)).toContain('not permitted')
    expect(JSON.stringify(warn.mock.calls)).not.toContain(ENDPOINT)
    expect(JSON.stringify(warn.mock.calls)).not.toContain('CAPABILITY-URL')
    // And the switch still went off, which is what the player asked for.
    expect(setMethodMock).toHaveBeenCalledWith({ method: 'push', enabled: false })
    expect(toastSuccess).toHaveBeenCalledWith('Delivery methods updated')
  })
})

describe('the Push switch — rule 2, a permission it will not get', () => {
  test('a DENIED permission leaves the switch off and writes no method', async () => {
    // THE RULE THE TASK IS NAMED FOR, and the mutant that motivated this test:
    // adding local optimistic state that flips on click leaves every other
    // test green while the switch shows ON and the server says off.
    stubBrowser({ getSubscription: vi.fn(), subscribe: vi.fn() }, 'denied')
    render(createElement(NotificationsTab))

    expect(isChecked()).toBe('false')
    fireEvent.click(pushSwitch())

    await waitFor(() => expect(toastError).toHaveBeenCalled())
    // The specific copy, so the routing of `outcome.reason` is pinned too —
    // 'unavailable' and 'no-keys' carry different, unhelpful-here advice.
    expect(toastError).toHaveBeenCalledWith(
      'Notifications are blocked for this site. Allow them in your browser settings to turn this on.',
    )
    expect(isChecked()).toBe('false')
    expect(savePushMock).not.toHaveBeenCalled()
    expect(setMethodMock).not.toHaveBeenCalled()
    expect(toastSuccess).not.toHaveBeenCalled()
  })

  test("a DISMISSED prompt ('default') is treated the same", async () => {
    stubBrowser({ getSubscription: vi.fn(), subscribe: vi.fn() }, 'default')
    render(createElement(NotificationsTab))

    fireEvent.click(pushSwitch())

    await waitFor(() => expect(toastError).toHaveBeenCalled())
    expect(isChecked()).toBe('false')
    expect(setMethodMock).not.toHaveBeenCalled()
  })

  test('turning ON with no browser reports it rather than writing the method', async () => {
    // The mirror of the C1 test: `browser: null` blocks ON, and only ON.
    render(createElement(NotificationsTab))

    fireEvent.click(pushSwitch())

    await waitFor(() => expect(toastError).toHaveBeenCalled())
    expect(toastError).toHaveBeenCalledWith(
      "This browser can't deliver push notifications. Email reminders still work.",
    )
    expect(setMethodMock).not.toHaveBeenCalled()
  })
})

describe('the Push switch — turning it ON', () => {
  test('stores the subscription, then writes the method, then reports success', async () => {
    settings.reminderDeliveryMethods = ['email']
    stubBrowser({
      getSubscription: vi.fn().mockResolvedValue(null),
      subscribe: vi.fn().mockResolvedValue(fakeSubscription()),
    })
    render(createElement(NotificationsTab))

    fireEvent.click(pushSwitch())

    await waitFor(() => expect(setMethodMock).toHaveBeenCalled())
    expect(savePushMock).toHaveBeenCalledWith({
      endpoint: ENDPOINT,
      p256dh: 'AQIDBA',
      auth: 'AQIDBA',
    })
    // INTENT ONLY. 'email' surviving is no longer this component's promise to
    // keep: the array is composed server-side against the current row
    // (setReminderMethodFor), and convex/settings.test.ts pins that it leaves
    // the other method alone. What is asserted here is that the switch asks
    // for the right thing.
    expect(setMethodMock).toHaveBeenCalledWith({ method: 'push', enabled: true })
    expect(savePushMock.mock.invocationCallOrder[0]).toBeLessThan(
      setMethodMock.mock.invocationCallOrder[0],
    )
    expect(toastSuccess).toHaveBeenCalledWith('Delivery methods updated')
  })

  test('a rejected save surfaces as an error and writes no method', async () => {
    savePushMock.mockRejectedValueOnce(new Error('boom'))
    stubBrowser({
      getSubscription: vi.fn().mockResolvedValue(null),
      subscribe: vi.fn().mockResolvedValue(fakeSubscription()),
    })
    render(createElement(NotificationsTab))

    fireEvent.click(pushSwitch())

    await waitFor(() => expect(toastError).toHaveBeenCalled())
    expect(setMethodMock).not.toHaveBeenCalled()
  })

  test('the switch is disabled while a toggle is in flight, so a second click cannot start one', async () => {
    // The permission prompt is modal and slow. Without `pushPending` a second
    // click runs the whole flow again against a stale `reminderDeliveryMethods`.
    let release: (value: unknown) => void = () => {}
    const requestPermission = vi.fn(() => new Promise((resolve) => (release = resolve)))
    vi.stubGlobal('Notification', { requestPermission })
    Object.defineProperty(navigator, 'serviceWorker', {
      configurable: true,
      get: () => ({
        ready: Promise.resolve({
          pushManager: {
            getSubscription: vi.fn().mockResolvedValue(null),
            subscribe: vi.fn().mockResolvedValue(fakeSubscription()),
          },
        }),
      }),
    })
    render(createElement(NotificationsTab))

    fireEvent.click(pushSwitch())
    await waitFor(() => expect(isDisabled()).toBe(true))

    fireEvent.click(pushSwitch())
    expect(requestPermission).toHaveBeenCalledTimes(1)

    release('granted')
    await waitFor(() => expect(setMethodMock).toHaveBeenCalled())
  })
})

describe('the Email switch is unaffected by any of it', () => {
  test('toggling Email preserves a stored push method', async () => {
    // THE HAZARD THIS TEST WAS WRITTEN FOR IS NOW UNREPRESENTABLE. It used to
    // guard against a from-scratch ['email'] dropping 'push' — silently stopping
    // every notification while the subscription stayed stored and the switch
    // kept showing on. The client no longer builds an array at all
    // (wordle-teams-069), so there is nothing to get wrong here; the preserving
    // half is asserted in convex/settings.test.ts. Kept because the SWITCH still
    // has to send the right intent, and because a regression to array-sending
    // would fail here first.
    settings.reminderDeliveryMethods = ['push']
    render(createElement(NotificationsTab))

    fireEvent.click(screen.getByRole('switch', { name: 'Email' }))

    await waitFor(() => expect(setMethodMock).toHaveBeenCalled())
    expect(setMethodMock).toHaveBeenCalledWith({ method: 'email', enabled: true })
  })
})
