import type { ErrorEvent } from '@sentry/nextjs'

// React's streaming SSR emits inline bootstrap scripts into the document to move each
// Suspense segment out of a hidden container and into its placeholder:
//
//   $RS=function(a,b){a=document.getElementById(a);b=document.getElementById(b);
//     for(a.parentNode.removeChild(a);a.firstChild;)b.parentNode.insertBefore(a.firstChild,b);…}
//
// The first thing it does is remove its own container. So if those scripts run a second
// time against the same document — which is what a back/forward restore of a slowly
// streamed page does — getElementById returns null and every remaining call throws. /me
// emits ~45 of them per render, so a single occurrence produced 24-45 events and had
// accumulated 1205: enough noise to bury real problems, and it did.
//
// Nothing user-visible breaks. React has already inserted the content by the time the
// duplicate runs, and production session replays show affected users carrying straight
// on into board entry. This is browser behaviour we do not control, so it is dropped
// rather than chased. See wordle-teams-uc5 for the reproduction (back navigation over a
// slow connection) and for the experiment that ruled out the service worker.
const REACT_STREAM_BOOTSTRAP_FNS = new Set(['$RS', '$RC', '$RX', '$RB'])

// Minified frames from the document itself look like 'app:///me:2' — a path with a line
// number and no file extension. Application frames always resolve to a bundle.
const DOCUMENT_FRAME = /^app:\/\/\/[^/]*:\d+$/

/**
 * True for the React streaming-bootstrap TypeError described above.
 *
 * Deliberately narrow: it requires BOTH the React bootstrap frame AND the specific null
 * dereference, so a real TypeError from application code still reports. The message
 * wording is engine-specific — V8 says "Cannot read properties of null (reading
 * 'parentNode')", JavaScriptCore "null is not an object (evaluating 'b.parentNode')",
 * Firefox "b.parentNode is null" — so it matches on 'parentNode' rather than a full
 * string.
 */
export function isReactStreamingBootstrapNoise(event: ErrorEvent): boolean {
  const exception = event.exception?.values?.[0]
  if (exception?.type !== 'TypeError') return false
  if (!exception.value?.includes('parentNode')) return false

  return (exception.stacktrace?.frames ?? []).some(
    (frame) =>
      (frame.function != null && REACT_STREAM_BOOTSTRAP_FNS.has(frame.function)) ||
      (frame.filename != null && DOCUMENT_FRAME.test(frame.filename))
  )
}
