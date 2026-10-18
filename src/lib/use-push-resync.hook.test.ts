// @vitest-environment jsdom
import { renderHook, waitFor } from '@testing-library/react'
import { getFunctionName, type FunctionReference } from 'convex/server'
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'
import { api } from '../../convex/_generated/api'
import type { PushManagerLike, PushSubscriptionLike } from '#/lib/push-subscribe.ts'

const { saveMock } = vi.hoisted(() => ({ saveMock: vi.fn() }))
let methods: Array<string> | undefined

vi.mock('@convex-dev/react-query', () => ({
  convexQuery: (ref: FunctionReference<'query'>) => ({ queryKey: [getFunctionName(ref)] }),
  useConvexMutation: (ref: FunctionReference<'mutation'>) => {
    if (getFunctionName(ref) !== getFunctionName(api.push.savePushSubscription)) throw new Error('unexpected')
    return saveMock
  },
}))
vi.mock('@tanstack/react-query', () => ({
  useQuery: ({ queryKey }: { queryKey: Array<string> }) => {
    if (queryKey[0] !== getFunctionName(api.settings.mySettings)) throw new Error(`unexpected ${queryKey[0]}`)
    return { data: methods === undefined ? undefined : { reminderDeliveryMethods: methods } }
  },
}))

const ENDPOINT = 'https://fcm.googleapis.com/fcm/send/CAPABILITY-URL-abc123'
const subscription = (): PushSubscriptionLike => ({
  endpoint: ENDPOINT,
  getKey: () => new Uint8Array([1, 2, 3, 4]).buffer,
  unsubscribe: vi.fn().mockResolvedValue(true),
})

function stubBrowser(pushManager: PushManagerLike) {
  vi.stubGlobal('Notification', { requestPermission: vi.fn() })
  Object.defineProperty(navigator, 'serviceWorker', {
    configurable: true,
    get: () => ({ ready: Promise.resolve({ pushManager }) }),
  })
}

// A fresh module per test: the once-per-load flag is module state.
async function load() {
  vi.resetModules()
  return (await import('./use-push-resync.ts')).usePushResync
}

beforeEach(() => {
  methods = ['push']
  saveMock.mockReset().mockResolvedValue(null)
})
afterEach(() => {
  vi.unstubAllGlobals()
  Reflect.deleteProperty(navigator, 'serviceWorker')
})

describe('usePushResync', () => {
  test('saves this device subscription once when push is on and the device is subscribed', async () => {
    stubBrowser({ getSubscription: vi.fn().mockResolvedValue(subscription()), subscribe: vi.fn() })
    const usePushResync = await load()
    const { rerender, unmount } = renderHook(() => usePushResync())
    await waitFor(() => expect(saveMock).toHaveBeenCalledTimes(1))
    expect(saveMock).toHaveBeenCalledWith({ endpoint: ENDPOINT, p256dh: 'AQIDBA', auth: 'AQIDBA' })

    rerender()
    unmount()
    renderHook(() => usePushResync())
    await new Promise((resolve) => setTimeout(resolve, 0))
    expect(saveMock).toHaveBeenCalledTimes(1)
  })

  test('waits for the settings, then saves', async () => {
    methods = undefined
    stubBrowser({ getSubscription: vi.fn().mockResolvedValue(subscription()), subscribe: vi.fn() })
    const usePushResync = await load()
    const { rerender } = renderHook(() => usePushResync())
    await new Promise((resolve) => setTimeout(resolve, 0))
    expect(saveMock).not.toHaveBeenCalled()

    methods = ['push']
    rerender()
    await waitFor(() => expect(saveMock).toHaveBeenCalledTimes(1))
  })

  test('saves nothing when push is off for the account', async () => {
    methods = ['email']
    const getSubscription = vi.fn().mockResolvedValue(subscription())
    stubBrowser({ getSubscription, subscribe: vi.fn() })
    const usePushResync = await load()
    renderHook(() => usePushResync())
    await new Promise((resolve) => setTimeout(resolve, 0))
    expect(getSubscription).not.toHaveBeenCalled()
    expect(saveMock).not.toHaveBeenCalled()
  })

  test('saves nothing when this device holds no subscription', async () => {
    const getSubscription = vi.fn().mockResolvedValue(null)
    stubBrowser({ getSubscription, subscribe: vi.fn() })
    const usePushResync = await load()
    renderHook(() => usePushResync())
    await waitFor(() => expect(getSubscription).toHaveBeenCalled())
    await new Promise((resolve) => setTimeout(resolve, 0))
    expect(saveMock).not.toHaveBeenCalled()
  })

  test('a failed save warns with the message only, never the endpoint, and does not throw', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    saveMock.mockRejectedValue(new Error('offline'))
    stubBrowser({ getSubscription: vi.fn().mockResolvedValue(subscription()), subscribe: vi.fn() })
    const usePushResync = await load()
    renderHook(() => usePushResync())
    await waitFor(() => expect(warn).toHaveBeenCalled())
    expect(JSON.stringify(warn.mock.calls)).toContain('offline')
    expect(JSON.stringify(warn.mock.calls)).not.toContain('CAPABILITY-URL')
    warn.mockRestore()
  })
})
