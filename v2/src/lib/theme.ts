import { useCallback, useEffect, useState } from 'react'

/**
 * The light/dark/auto mode, lifted out of the old ThemeToggle component when
 * the toggle moved into the account menu (wordle-teams-lyab).
 *
 * NOTHING ABOUT THE STATE MODEL CHANGED IN THAT MOVE, and that is deliberate:
 * the storage key is still 'theme', the values are still the same three
 * strings, and the DOM effects are still the same four writes. This file is
 * the toggle's old body with a hook wrapped round it — see `applyThemeMode`,
 * which is character-for-character what ThemeToggle applied.
 *
 * THIS IS THE SECOND OF TWO COPIES OF THAT LOGIC AND THE OTHER ONE CANNOT BE
 * DELETED. `THEME_INIT_SCRIPT` in routes/__root.tsx is a stringified inline
 * script that runs BEFORE first paint to stop the page flashing the wrong
 * theme; it cannot import from here, because at that point no bundle has
 * executed. The two must agree. If you change the key, the accepted values or
 * the class/attribute writes below, change them there too — theme.test.ts
 * pins the pair against each other so a one-sided edit fails a gate rather
 * than shipping a flash.
 */
export type ThemeMode = 'light' | 'dark' | 'auto'

export const THEME_STORAGE_KEY = 'theme'

export const THEME_MODES: ReadonlyArray<ThemeMode> = ['light', 'dark', 'auto']

function isThemeMode(value: unknown): value is ThemeMode {
  return value === 'light' || value === 'dark' || value === 'auto'
}

/**
 * The stored mode, or 'auto' when there is nothing usable stored.
 *
 * WRAPPED IN try/catch BECAUSE localStorage THROWS RATHER THAN RETURNING NULL
 * in a Safari private window and under a "block all cookies" setting. An
 * exception here would take the whole header down, which is a steep price for
 * a colour preference.
 */
export function getStoredMode(): ThemeMode {
  if (typeof window === 'undefined') return 'auto'

  try {
    const stored = window.localStorage.getItem(THEME_STORAGE_KEY)
    return isThemeMode(stored) ? stored : 'auto'
  } catch {
    return 'auto'
  }
}

/**
 * Resolves 'auto' against the OS preference and writes the result to <html>.
 *
 * FOUR WRITES, and each one is load-bearing:
 *   - the `light`/`dark` CLASS is what styles.css's `.dark` block keys off,
 *     and what use-resolved-theme.ts observes for the toast theme
 *   - `data-theme` records the EXPLICIT choice, absent for 'auto', so that
 *     "follow the system" is distinguishable from "the system happens to be
 *     dark" on the next load
 *   - `color-scheme` is what makes form controls and scrollbars match
 */
export function applyThemeMode(mode: ThemeMode) {
  const prefersDark = window.matchMedia('(prefers-color-scheme: dark)').matches
  const resolved = mode === 'auto' ? (prefersDark ? 'dark' : 'light') : mode

  document.documentElement.classList.remove('light', 'dark')
  document.documentElement.classList.add(resolved)

  if (mode === 'auto') {
    document.documentElement.removeAttribute('data-theme')
  } else {
    document.documentElement.setAttribute('data-theme', mode)
  }

  document.documentElement.style.colorScheme = resolved
}

/**
 * The mode, plus a setter that persists it.
 *
 * STARTS AT 'auto' AND CORRECTS IN AN EFFECT rather than reading storage
 * during render, which is what the old ThemeToggle did and is not incidental:
 * this component server-renders, and reading localStorage in the render body
 * would produce a server/client mismatch on every explicitly-themed account.
 * The visible theme is already correct before this hook runs — the inline
 * script in __root.tsx saw to that — so the brief 'auto' is a fact about this
 * hook's state, not about the painted page.
 *
 * THE 'auto' LISTENER IS NOT OPTIONAL. Without it, a user on 'auto' whose OS
 * flips to dark at sunset keeps the light theme until they reload.
 */
export function useThemeMode() {
  const [mode, setMode] = useState<ThemeMode>('auto')

  useEffect(() => {
    const initial = getStoredMode()
    setMode(initial)
    applyThemeMode(initial)
  }, [])

  useEffect(() => {
    if (mode !== 'auto') return

    const media = window.matchMedia('(prefers-color-scheme: dark)')
    const onChange = () => applyThemeMode('auto')

    media.addEventListener('change', onChange)
    return () => media.removeEventListener('change', onChange)
  }, [mode])

  const selectMode = useCallback((next: ThemeMode) => {
    setMode(next)
    applyThemeMode(next)
    // Same try/catch reasoning as getStoredMode. A refused write means the
    // choice does not survive the reload, which beats an unhandled exception
    // escaping a click handler.
    try {
      window.localStorage.setItem(THEME_STORAGE_KEY, next)
    } catch {
      /* preference is not persistable in this browser; the live page is still correct */
    }
  }, [])

  return { mode, selectMode }
}
