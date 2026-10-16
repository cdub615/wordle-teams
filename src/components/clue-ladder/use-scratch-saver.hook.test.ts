// @vitest-environment jsdom
import { cleanup, renderHook } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'
import type { Slots } from '#/lib/clue-ladder-board.ts'
import { SCRATCH_SAVE_MS, useScratchSaver } from './use-scratch-saver.ts'

beforeEach(() => vi.useFakeTimers())
afterEach(() => {
  cleanup()
  vi.useRealTimers()
})

const A: Slots = ['star', null, null, null, null]
const B: Slots = ['star', 'circle', null, null, null]
const C: Slots = [null, 'circle', null, null, 'star']

describe('useScratchSaver', () => {
  test('changes inside the window make one save, of the last arrangement', async () => {
    const save = vi.fn().mockResolvedValue(undefined)
    const { result } = renderHook(() => useScratchSaver(save))
    result.current.schedule(A)
    result.current.schedule(B)
    result.current.schedule(C)
    expect(save).not.toHaveBeenCalled()
    await vi.advanceTimersByTimeAsync(SCRATCH_SAVE_MS)
    expect(save).toHaveBeenCalledExactlyOnceWith(C)
  })

  test('the window runs from the first change, so steady moving still saves every few seconds', async () => {
    // A debounce (restart the timer on each change) would pass the test above
    // and never save while the player keeps moving shapes.
    const save = vi.fn().mockResolvedValue(undefined)
    const { result } = renderHook(() => useScratchSaver(save))
    result.current.schedule(A)
    await vi.advanceTimersByTimeAsync(SCRATCH_SAVE_MS - 1000)
    result.current.schedule(B)
    await vi.advanceTimersByTimeAsync(1000)
    expect(save).toHaveBeenCalledExactlyOnceWith(B)
    result.current.schedule(C)
    await vi.advanceTimersByTimeAsync(SCRATCH_SAVE_MS)
    expect(save).toHaveBeenCalledTimes(2)
    expect(save).toHaveBeenLastCalledWith(C)
  })

  test('flush saves now, and the timer then has nothing to save', async () => {
    const save = vi.fn().mockResolvedValue(undefined)
    const { result } = renderHook(() => useScratchSaver(save))
    result.current.schedule(A)
    await result.current.flush()
    expect(save).toHaveBeenCalledExactlyOnceWith(A)
    await vi.advanceTimersByTimeAsync(SCRATCH_SAVE_MS)
    expect(save).toHaveBeenCalledTimes(1)
  })

  test('flush with nothing pending saves nothing', async () => {
    const save = vi.fn().mockResolvedValue(undefined)
    const { result } = renderHook(() => useScratchSaver(save))
    await result.current.flush()
    expect(save).not.toHaveBeenCalled()
  })

  test('leaving the page saves what is pending', () => {
    const save = vi.fn().mockResolvedValue(undefined)
    const { result, unmount } = renderHook(() => useScratchSaver(save))
    result.current.schedule(B)
    unmount()
    expect(save).toHaveBeenCalledExactlyOnceWith(B)
  })

  test('the page going hidden saves what is pending, and the listener goes with the hook', async () => {
    // Closing or backgrounding a mobile tab never unmounts React.
    const setVisibility = (state: 'hidden' | 'visible') => {
      Object.defineProperty(document, 'visibilityState', { configurable: true, value: state })
      document.dispatchEvent(new Event('visibilitychange'))
    }
    try {
      const save = vi.fn().mockResolvedValue(undefined)
      const { result, unmount } = renderHook(() => useScratchSaver(save))
      result.current.schedule(B)
      setVisibility('visible')
      expect(save).not.toHaveBeenCalled()
      setVisibility('hidden')
      expect(save).toHaveBeenCalledExactlyOnceWith(B)
      await vi.advanceTimersByTimeAsync(SCRATCH_SAVE_MS)
      expect(save).toHaveBeenCalledTimes(1)

      result.current.schedule(C)
      unmount()
      expect(save).toHaveBeenCalledTimes(2)
      result.current.schedule(A)
      setVisibility('hidden')
      expect(save).toHaveBeenCalledTimes(2)
    } finally {
      // @ts-expect-error restore jsdom's own prototype getter
      delete document.visibilityState
    }
  })

  test('a failed save is dropped, not thrown', async () => {
    const save = vi.fn().mockRejectedValue(new Error('offline'))
    const { result } = renderHook(() => useScratchSaver(save))
    result.current.schedule(A)
    await vi.advanceTimersByTimeAsync(SCRATCH_SAVE_MS)
    await expect(result.current.flush()).resolves.toBeUndefined()
    expect(save).toHaveBeenCalledTimes(1)
  })
})
