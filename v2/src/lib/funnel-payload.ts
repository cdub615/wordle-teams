/**
 * Turns an untrusted request body into a LogSnag payload, or null (wt-ksh.12.11).
 *
 * Pure and separate from the route so the security-relevant behaviour — the
 * allowlists — is unit tested rather than asserted. /api/funnel is a public,
 * unauthenticated endpoint: without these, anyone could write arbitrary events
 * and arbitrary tags into the project's LogSnag.
 */

/**
 * A Map, not an object literal, on purpose. With a literal, EVENTS['__proto__']
 * resolves up the prototype chain to Object.prototype — truthy — and the
 * allowlist check passes for a name that was never allowed, emitting an event
 * with an undefined name. A unit test caught exactly that. Map has no
 * prototype-chain lookup.
 */
const EVENTS = new Map<string, { event: string; icon: string }>([
  ['login_view', { event: 'Login viewed', icon: '👀' }],
  ['login_provider_click', { event: 'Login provider clicked', icon: '🔘' }],
  ['login_code_requested', { event: 'Login code requested', icon: '📧' }],
  ['login_callback_arrived', { event: 'Login completed', icon: '✅' }],
])

const PROVIDERS = new Set(['google', 'microsoft', 'github', 'discord'])
const METHODS = new Set(['oauth', 'otp'])

export type LogSnagPayload = {
  event: string
  icon: string
  tags: Record<string, string>
}

export function toLogSnagPayload(body: unknown, env: string): LogSnagPayload | null {
  if (typeof body !== 'object' || body === null) return null
  const { name, provider, method } = body as Record<string, unknown>

  const spec = typeof name === 'string' ? EVENTS.get(name) : undefined
  if (!spec) return null

  // Tags are BUILT from the allowlists, never passed through. No email and no
  // user id: these events are pre-auth by definition, and the funnel question
  // is "where do people stop", not "who".
  const tags: Record<string, string> = { env }
  if (typeof provider === 'string' && PROVIDERS.has(provider)) tags.provider = provider
  if (typeof method === 'string' && METHODS.has(method)) tags.method = method

  return { event: spec.event, icon: spec.icon, tags }
}
