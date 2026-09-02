import { useEffect, useState } from 'react'

/** The media query anything animated in this app asks about before moving. */
export const REDUCED_MOTION_QUERY = '(prefers-reduced-motion: reduce)'

/**
 * Whether the viewer has asked their operating system for less motion.
 *
 * ASKED IN JAVASCRIPT, NOT IN A `@media (prefers-reduced-motion)` BLOCK, which
 * is this repo's established shape — see ConfettiBurst in
 * components/monthly-winner-celebration.tsx and the note above it. A media
 * query in styles.css cannot be observed by any gate this repo runs, because
 * there is no CSSOM under vitest, so the rule would be unpinned. That is
 * `wt-ksh.8.49`'s lesson, and it is why this is a hook returning a boolean a
 * test can read rather than a stylesheet rule nothing can.
 *
 * A HOOK RATHER THAN ConfettiBurst'S BARE `window.matchMedia?.(...)` CALL, AND
 * THE DIFFERENCE IS SERVER RENDERING. That component only ever mounts inside an
 * already-open dialog, so it has no server render to disagree with and can read
 * the query during render. The avatar ring is in the app bar, which
 * server-renders on every route — `window` does not exist there, and reading it
 * in a render body would throw before the page ever reached a browser.
 *
 * IT STARTS AT `true`, WHICH IS THE CAUTIOUS DIRECTION AND IS DELIBERATE.
 * `true` means "reduce motion", so the first paint — the server's, and the
 * client's hydrating render that must match it — animates NOTHING. The effect
 * then relaxes it for the majority who have expressed no preference. Starting
 * at `false` would have been the same number of lines and would have flashed
 * movement at exactly the person who asked not to see any, in the window before
 * the effect ran.
 *
 * `matchMedia` IS OPTIONAL-CALLED because jsdom ships none at all — found on
 * wordle-teams-ry1, and the reason ConfettiBurst spells it the same way.
 */
export function useReducedMotion(): boolean {
  const [reduced, setReduced] = useState(true)

  useEffect(() => {
    const media = window.matchMedia?.(REDUCED_MOTION_QUERY)
    if (!media) {
      // No matchMedia at all: nothing has expressed a preference, so honour the
      // default rather than leaving every animation in the app switched off.
      setReduced(false)
      return
    }

    setReduced(media.matches)

    // The preference can change while the tab is open — a system-wide toggle,
    // or macOS's Reduce Motion switch — and this bar never unmounts.
    const onChange = (event: MediaQueryListEvent) => setReduced(event.matches)
    media.addEventListener('change', onChange)
    return () => media.removeEventListener('change', onChange)
  }, [])

  return reduced
}
