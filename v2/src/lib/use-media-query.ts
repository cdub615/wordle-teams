import { useEffect, useState } from 'react'

/**
 * Ported from v1's src/lib/hooks/use-media-query.ts.
 *
 * Starts false on the server and on the first client render so hydration
 * matches, then flips in an effect. Board entry therefore renders its mobile
 * Sheet first and swaps to the desktop Dialog after mount.
 */
export function useMediaQuery(query: string): boolean {
  const [matches, setMatches] = useState(false)

  useEffect(() => {
    const list = window.matchMedia(query)
    setMatches(list.matches)
    const onChange = (event: MediaQueryListEvent) => setMatches(event.matches)
    list.addEventListener('change', onChange)
    return () => list.removeEventListener('change', onChange)
  }, [query])

  return matches
}
