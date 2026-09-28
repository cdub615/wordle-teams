import { useEffect, useState } from 'react'

/**
 * The visible area above the mobile keyboard.
 *
 * iOS Safari does not shrink the layout viewport when the keyboard opens — not
 * `100vh`, not `100dvh` — so a `position: fixed` sheet does not reflow and the
 * bottom guess rows and the Submit button end up behind the keyboard, with body
 * scroll locked by Radix so the user cannot reach them. It DOES update
 * window.visualViewport, which is what this reads.
 *
 * See docs/superpowers/specs/2026-07-15-mobile-board-entry-keyboard-aware-sheet-design.md.
 */
export type ViewportBounds = { height: number; offsetTop: number }

type ViewportSource = {
  visualViewport?: { height: number; offsetTop: number } | null
  innerHeight?: number
}

/** Extracted so the fallback chain is testable without a browser. */
export function readVisualViewport(source: ViewportSource | undefined): ViewportBounds {
  if (!source) return { height: 0, offsetTop: 0 }
  const viewport = source.visualViewport
  if (viewport) return { height: viewport.height, offsetTop: viewport.offsetTop }
  return { height: source.innerHeight ?? 0, offsetTop: 0 }
}

export function useVisualViewport(): ViewportBounds {
  // Zero on the server and on first render, which the consumer treats as
  // "unbounded" — matching what the server rendered, so hydration is clean.
  const [bounds, setBounds] = useState<ViewportBounds>({ height: 0, offsetTop: 0 })

  useEffect(() => {
    const update = () => setBounds(readVisualViewport(window))
    update()

    const viewport = window.visualViewport
    if (!viewport) {
      window.addEventListener('resize', update)
      return () => window.removeEventListener('resize', update)
    }
    viewport.addEventListener('resize', update)
    viewport.addEventListener('scroll', update)
    return () => {
      viewport.removeEventListener('resize', update)
      viewport.removeEventListener('scroll', update)
    }
  }, [])

  return bounds
}
