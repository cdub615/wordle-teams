import { useEffect, useRef, useState } from 'react'
import { RefreshCw } from 'lucide-react'
import { isStandaloneDisplay, readStandaloneSignals } from '#/lib/use-local-capture.ts'
import { useReducedMotion } from '#/lib/use-reduced-motion.ts'
import { PULL_TRIGGER_PX, canArmPull, computePull, startedInsideScrollContainer } from '#/lib/pull-to-refresh.ts'
import { cn } from '#/lib/utils.ts'

/**
 * The pull-to-refresh gesture for the installed PWA (wordle-teams-5jcn.26).
 * In standalone mode there is no browser chrome at all, so without this there
 * is NO way to reload the app.
 *
 * A PLAIN PAGE RELOAD, NOT A DATA REFETCH OR A VERSION CHECK, and no service
 * worker update flow is added here — that is the owner's explicit call, not
 * an oversight. The dashboard's team and month live in the URL's search
 * params, so a reload preserves them; what is lost is only transient UI (an
 * open dialog, a disclosure, a scroll position), and a reload also happens to
 * pick up whatever service worker build is current, which register-sw.ts has
 * no other path to.
 *
 * THIN WIRING OVER TESTED LOGIC, DELIBERATELY. Every decision — whether a
 * touch may arm the gesture, and how a raw finger movement becomes a pull
 * distance and a trigger — lives in lib/pull-to-refresh.ts and is exhaustively
 * unit-tested there. Nothing below is: no test in this suite can render a
 * component (wordle-teams-5jcn.14) and Playwright cannot install a PWA to
 * reach standalone mode at all, so this file's own correctness rests on
 * reading it, not on a gate turning red if it regresses.
 *
 * STANDALONE-ONLY (constraint 1), AND THAT GATES EVERYTHING — not just
 * `canArmPull`'s own check. Outside standalone this component attaches
 * NO listeners at all and renders nothing, so an ordinary browser tab (which
 * already has its own native pull-to-refresh) is completely untouched by
 * this file; there is no second implementation for it to conflict with.
 * Reuses use-local-capture.ts's own standalone detection (`readStandaloneSignals`
 * / `isStandaloneDisplay`) rather than a third copy of the `display-mode`
 * media query and the `navigator.standalone` read.
 */
export function PullToRefresh() {
  // Starts false, matching the server (there is no `window` there) and every
  // client's first render — the same SSR-safe shape useReducedMotion and
  // useHydrated use. Flips at most once, in the effect below, since a tab's
  // display mode does not change over its own lifetime.
  const [standalone, setStandalone] = useState(false)
  useEffect(() => {
    setStandalone(isStandaloneDisplay(readStandaloneSignals()))
  }, [])

  const reducedMotion = useReducedMotion()
  const [distance, setDistance] = useState(0)
  const [releasing, setReleasing] = useState(false)

  // A ref, not state: touchmove fires on every frame of the drag, and this is
  // read-and-written from inside the listeners themselves rather than
  // recreated by a render. `armed` distinguishes "tracking this touch" from
  // "ignoring it" (a touch that started inside an excluded container, or in a
  // regular browser tab where the effect below never even attaches a
  // listener); `triggered` is the last value computePull reported, read at
  // touchend to decide whether releasing now reloads.
  const gesture = useRef<{ startY: number; triggered: boolean } | null>(null)

  useEffect(() => {
    // Not standalone: attach nothing. This is constraint 1 enforced at the
    // listener level, not just inside canArmPull — an ordinary browser tab
    // gets zero touch listeners from this component, so there is nothing
    // here for its own native pull-to-refresh to fight.
    if (!standalone) return

    const reset = () => {
      gesture.current = null
      setDistance(0)
    }

    const onTouchStart = (event: TouchEvent) => {
      // Multi-touch (a pinch, a second finger) is not this gesture's concern
      // — ignore it entirely rather than guess which finger to track.
      if (event.touches.length !== 1) return
      const touch = event.touches[0]
      const armed = canArmPull({
        isStandalone: true,
        scrollTop: window.scrollY,
        startedInExcludedContainer: startedInsideScrollContainer(event.target as { closest(selector: string): unknown } | null),
      })
      gesture.current = armed ? { startY: touch.clientY, triggered: false } : null
    }

    const onTouchMove = (event: TouchEvent) => {
      const state = gesture.current
      if (!state || event.touches.length !== 1) return

      const rawDeltaY = event.touches[0].clientY - state.startY
      const { distance: next, triggered } = computePull(rawDeltaY)

      if (next <= 0) {
        // Not actually pulling down (yet, or any more) — leave native scroll
        // and rubber-banding alone rather than fighting the platform over a
        // gesture that isn't happening.
        setDistance(0)
        state.triggered = false
        return
      }

      // Only steal the touch once there is something to show. This listener
      // is registered `{ passive: false }` specifically so this call takes
      // effect — a passive listener's preventDefault() is silently ignored.
      event.preventDefault()
      state.triggered = triggered
      setDistance(next)
    }

    const onTouchEnd = () => {
      const state = gesture.current
      gesture.current = null
      if (state?.triggered) {
        // A PLAIN RELOAD, PER THE OWNER'S DECIDED BEHAVIOUR. No version
        // check, no data refetch — see the module comment above.
        setReleasing(true)
        window.location.reload()
        return
      }
      setDistance(0)
    }

    // touchstart/touchend/touchcancel stay passive (they never preventDefault);
    // only touchmove needs { passive: false }, and only touchmove is where a
    // naive handler would otherwise fight the platform's own rubber-banding.
    window.addEventListener('touchstart', onTouchStart, { passive: true })
    window.addEventListener('touchmove', onTouchMove, { passive: false })
    window.addEventListener('touchend', onTouchEnd, { passive: true })
    window.addEventListener('touchcancel', reset, { passive: true })
    return () => {
      window.removeEventListener('touchstart', onTouchStart)
      window.removeEventListener('touchmove', onTouchMove)
      window.removeEventListener('touchend', onTouchEnd)
      window.removeEventListener('touchcancel', reset)
    }
  }, [standalone])

  if (!standalone) return null

  const progress = Math.min(1, distance / PULL_TRIGGER_PX)

  return (
    <div
      // Decorative only — nothing here is announced. A completed pull ends in
      // a full page reload, which is its own, unmistakable feedback.
      aria-hidden="true"
      className="pointer-events-none fixed inset-x-0 top-0 z-40 flex justify-center"
      style={{
        transform: `translateY(${distance - 32}px)`,
        opacity: progress,
        // Only the SNAP-BACK (distance returning to 0 on a release that
        // didn't trigger) is an animation in the prefers-reduced-motion
        // sense — the transform above the rest of the time is a 1:1 read of
        // the finger's own position, not something playing on its own.
        // Skipped entirely for a reduced-motion viewer, so the indicator
        // disappears at once instead of easing away.
        transition: !reducedMotion && distance === 0 ? 'transform 150ms ease-out, opacity 150ms ease-out' : undefined,
      }}
    >
      <div className="mt-2 flex h-8 w-8 items-center justify-center rounded-full border border-line-subtle bg-background shadow-sm">
        <RefreshCw
          className={cn(
            'h-4 w-4 text-accent-solid',
            // The spin is the OTHER motion this respects: it only plays while
            // actually releasing (about to reload), and only for a viewer who
            // has not asked for less motion.
            releasing && !reducedMotion && 'animate-spin',
          )}
        />
      </div>
    </div>
  )
}

export default PullToRefresh
