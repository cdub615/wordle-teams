import * as React from 'react'

export type VisualViewportState = {
  height: number
  offsetTop: number
}

function readViewport(): VisualViewportState {
  if (typeof window === 'undefined') return { height: 0, offsetTop: 0 }
  const vv = window.visualViewport
  if (vv) return { height: vv.height, offsetTop: vv.offsetTop }
  return { height: window.innerHeight, offsetTop: 0 }
}

/**
 * Tracks the visual viewport (the area above the on-screen keyboard).
 * iOS Safari does not shrink the layout viewport when the keyboard opens,
 * but it does update `window.visualViewport`, so this is the reliable source
 * of truth for bounding fixed overlays above the keyboard.
 *
 * Returns { height: 0, offsetTop: 0 } during SSR and { innerHeight, 0 } when
 * the visualViewport API is unavailable.
 */
export function useVisualViewport(): VisualViewportState {
  const [state, setState] = React.useState<VisualViewportState>(readViewport)

  React.useEffect(() => {
    const vv = window.visualViewport
    const update = () => setState(readViewport())
    update()

    if (vv) {
      vv.addEventListener('resize', update)
      vv.addEventListener('scroll', update)
      return () => {
        vv.removeEventListener('resize', update)
        vv.removeEventListener('scroll', update)
      }
    }

    window.addEventListener('resize', update)
    return () => window.removeEventListener('resize', update)
  }, [])

  return state
}
