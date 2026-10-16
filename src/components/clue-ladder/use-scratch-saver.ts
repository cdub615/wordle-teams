import { useCallback, useEffect, useLayoutEffect, useRef } from 'react'
import type { Slots } from '#/lib/clue-ladder-board.ts'

/** At most one saveScratch call per this many ms (spec section 4: "one per few seconds at most"). */
export const SCRATCH_SAVE_MS = 3000

/**
 * Batches the play's scratch saves. The first change starts a timer; changes
 * inside the window only replace what is waiting; when the timer fires, the
 * latest arrangement is saved once. `flush` saves now, for lockIn to call
 * first, and leaving the page flushes, so the last move survives.
 *
 * A FAILED SAVE IS DROPPED. Scratch exists so a game resumes on another device.
 * lockIn sends the full order itself, so nothing scored depends on it, and an
 * error toast for a background save would interrupt the game for nothing.
 */
export function useScratchSaver(save: (slots: Slots) => Promise<unknown>, delay = SCRATCH_SAVE_MS) {
  const saveRef = useRef(save)
  useLayoutEffect(() => {
    saveRef.current = save
  })
  const pending = useRef<Slots | null>(null)
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null)

  const flush = useCallback(async () => {
    if (timer.current !== null) {
      clearTimeout(timer.current)
      timer.current = null
    }
    const slots = pending.current
    pending.current = null
    if (slots === null) return
    try {
      await saveRef.current(slots)
    } catch {
      // Dropped on purpose; see above.
    }
  }, [])

  const schedule = useCallback(
    (slots: Slots) => {
      pending.current = slots
      if (timer.current === null) timer.current = setTimeout(() => void flush(), delay)
    },
    [delay, flush],
  )

  useEffect(() => () => void flush(), [flush])

  // Closing, reloading or backgrounding a mobile tab never unmounts React, so
  // the unmount flush above misses it; the page going hidden is the last
  // moment a save can still be sent.
  useEffect(() => {
    const onVisibility = () => {
      if (document.visibilityState === 'hidden') void flush()
    }
    document.addEventListener('visibilitychange', onVisibility)
    return () => document.removeEventListener('visibilitychange', onVisibility)
  }, [flush])

  return { schedule, flush }
}
