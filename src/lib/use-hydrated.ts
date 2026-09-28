import { useEffect, useState } from 'react'

/**
 * False during SSR and on the first client render, true once React has hydrated.
 *
 * The useState/useEffect pair is deliberate rather than a one-liner: the initial
 * value must match what the server rendered or hydration mismatches, and effects
 * do not run on the server, so this flips exactly once, after hydration.
 *
 * Use it to keep a submit button disabled until handlers are actually attached.
 * An SSR form looks fully interactive before hydration but has no onSubmit, so a
 * click fires a native GET — the browser navigates, nothing is sent, and the
 * user concludes the app is broken. Disabling the submit button also blocks
 * implicit submission (pressing Enter in a field), because the HTML spec skips
 * implicit submission when the default button is disabled.
 *
 * Every SSR form ported in later phases needs this. See wt-ksh.2.2.
 */
export function useHydrated() {
  const [hydrated, setHydrated] = useState(false)
  useEffect(() => setHydrated(true), [])
  return hydrated
}
