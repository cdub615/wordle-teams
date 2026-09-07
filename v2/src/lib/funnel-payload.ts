/**
 * Turns an untrusted request body into a LogSnag payload, or null (wt-ksh.12.11).
 *
 * Pure and separate from the route so the security-relevant behaviour — the
 * allowlists — is unit tested rather than asserted. /api/funnel is a public,
 * unauthenticated endpoint: without these, anyone could write arbitrary events
 * and arbitrary tags into the project's LogSnag.
 */

import type { FunnelEvent } from './funnel.ts'

// A RECORD FOR COMPLETENESS, A MAP FOR LOOKUP, and both halves matter.
// The Record's key type is FunnelEvent['name'], so adding a variant to that
// union without adding it here is a COMPILE error rather than an event that
// silently vanishes at runtime -- which is the worst failure this module can
// have, given it exists because server logs cannot explain a funnel loss.
// The lookup still goes through a Map because EVENTS['__proto__'] on a literal
// resolves up the prototype chain and passes a truthy check for a name that was
// never allowed; a unit test caught exactly that.
const EVENT_SPECS: Record<FunnelEvent['name'], { event: string; icon: string }> = {
  login_view: { event: 'Login viewed', icon: '👀' },
  login_provider_click: { event: 'Login provider clicked', icon: '🔘' },
  login_code_requested: { event: 'Login code requested', icon: '📧' },
  login_callback_arrived: { event: 'Login completed', icon: '✅' },
  onboarding_view: { event: 'Onboarding viewed', icon: '🧭' },
  onboarding_task_click: { event: 'Onboarding task clicked', icon: '👉' },
  onboarding_complete: { event: 'Onboarding complete', icon: '🎉' },
  onboarding_dismiss: { event: 'Onboarding dismissed', icon: '🙈' },
}
const EVENTS = new Map(Object.entries(EVENT_SPECS))

const PROVIDERS = new Set(['google', 'microsoft', 'github', 'discord'])
const METHODS = new Set(['oauth', 'otp'])

/**
 * The onboarding task ids, allowlisted for the same reason PROVIDERS is:
 * /api/funnel is public and unauthenticated, so tags are BUILT here and never
 * forwarded from the body. Must stay in step with OnboardingTaskId in
 * lib/onboarding-tasks.ts — a Set literal rather than an import because this
 * module is also reached from the Worker route and stays dependency-free.
 */
const TASK_IDS = new Set(['board', 'team', 'invite'])

export type LogSnagPayload = {
  event: string
  icon: string
  tags: Record<string, string>
}

export function toLogSnagPayload(body: unknown, env: string): LogSnagPayload | null {
  if (typeof body !== 'object' || body === null) return null
  const { name, provider, method, task, tasks } = body as Record<string, unknown>

  const spec = typeof name === 'string' ? EVENTS.get(name) : undefined
  if (!spec) return null

  // Tags are BUILT from the allowlists, never passed through. No email and no
  // user id: these events are pre-auth by definition, and the funnel question
  // is "where do people stop", not "who".
  const tags: Record<string, string> = { env }
  if (typeof provider === 'string' && PROVIDERS.has(provider)) tags.provider = provider
  if (typeof method === 'string' && METHODS.has(method)) tags.method = method
  if (typeof task === 'string' && TASK_IDS.has(task)) tags.task = task
  if (typeof tasks === 'string') {
    // Filtered element-wise, not accepted or rejected whole: a set carrying one
    // bad id still has useful known ids in it, and dropping the tag entirely
    // would lose them. An all-unknown set yields no tag rather than an empty one.
    //
    // Deduped, not just filtered. The filter alone bounds the ALPHABET to three
    // known ids but not the COUNT — 'board,'.repeat(100000) passes the filter
    // untouched and forwards a ~600KB tag to a third party from a public,
    // unauthenticated endpoint. That is both CPU cost (the split/filter/join
    // scales with input size) and Sentry-amplification risk (an oversized tag
    // hitting an undocumented LogSnag limit turns into a captureError in
    // logsnag.ts, and sentry-capture.ts has no sampling or dedupe). Dedupe
    // bounds the result at three by construction and is semantically right
    // anyway: a task SET should not contain duplicates, and taskSetKey can
    // never emit one. Set preserves first-seen order, so the canonical
    // board,team,invite ordering survives.
    const known = [...new Set(tasks.split(',').filter((id) => TASK_IDS.has(id)))]
    if (known.length > 0) tags.tasks = known.join(',')
  }

  return { event: spec.event, icon: spec.icon, tags }
}
