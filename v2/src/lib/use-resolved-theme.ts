import { useEffect, useState } from 'react'

export type ResolvedTheme = 'light' | 'dark'

function read(): ResolvedTheme {
  if (typeof document === 'undefined') return 'light'
  return document.documentElement.classList.contains('dark') ? 'dark' : 'light'
}

/**
 * The resolved (light|dark) theme, read from the `dark` class on <html>.
 *
 * v2 does NOT use next-themes — ThemeToggle owns the light/dark/auto mode and
 * the inline script in __root.tsx applies the class before first paint. shadcn's
 * stock sonner.tsx imports useTheme from next-themes, which would be a second
 * source of truth that disagrees whenever the user picks a mode explicitly.
 * This hook reads the one that is actually authoritative.
 *
 * Returns 'light' on the server and for the first client render, then corrects
 * in an effect. Toasts only ever appear after hydration, so that is not visible.
 */
export function useResolvedTheme(): ResolvedTheme {
  const [theme, setTheme] = useState<ResolvedTheme>('light')

  useEffect(() => {
    setTheme(read())
    const observer = new MutationObserver(() => setTheme(read()))
    observer.observe(document.documentElement, {
      attributes: true,
      attributeFilter: ['class'],
    })
    return () => observer.disconnect()
  }, [])

  return theme
}
