// Shared Sentry tuning. The client (@sentry/tanstackstart-react, initialised in
// router.tsx) and the worker (@sentry/cloudflare, initialised in server.ts) are
// separate SDKs with separate init calls, but they should sample at the same
// rate — otherwise a single request produces a client trace and no server trace,
// or vice versa, and the waterfall has holes in it. One constant, two callers.
export const TRACES_SAMPLE_RATE = 0.2

/**
 * WHICH HOSTNAMES ARE WHICH SENTRY ENVIRONMENT — AND WHY ONLY THE BROWSER USES
 * THIS.
 *
 * Neither init passed `environment`, so both SDKs fell back to the Sentry
 * default of "production" and beta was indistinguishable from a real incident.
 * Measured, not inferred: a document from beta carried
 * `<meta name="baggage" content="sentry-environment=production,...">`
 * (wordle-teams-9wpd).
 *
 * THE BROWSER CANNOT USE A BUILD-TIME VAR, and this is a hard limit rather than
 * a preference. ONE client bundle is served on EVERY hostname its deployment
 * answers to, and `import.meta.env` is inlined at build time — so a
 * `VITE_ENVIRONMENT` would be the same byte sequence on beta and on the apex.
 * Through cutover this Worker keeps beta.wordleteams.com and gains the apex
 * (runbook §3.4), so for a period one bundle serves both names and a var could
 * only ever be right about one of them. The hostname is a property of the
 * REQUEST, so each name gets the right answer with nothing to remember on the
 * day. This is the same argument lib/robots-policy.ts makes, for the same
 * reason, about the same two names.
 *
 * THE WORKER DELIBERATELY DOES NOT USE THIS, and the reason is not symmetry
 * with the funnel. @sentry/cloudflare's `withSentry(optionsCallback, handler)`
 * hands the callback `env` and NEVER the Request — the options are built before
 * the request is wrapped. That matters because the baggage tag above is built
 * from client OPTIONS, not from events: @sentry/core assembles the Dynamic
 * Sampling Context as `environment: options.environment || DEFAULT_ENVIRONMENT`
 * (tracing/dynamicSamplingContext.js). So a per-request event processor would
 * relabel errors and transactions and still leave the measured symptom in
 * place. server.ts therefore reads `env.ENVIRONMENT`, which is correct the
 * moment dev and prod are separate deployments (wordle-teams-qjh3) and is wrong
 * only for beta during the cutover window. DO NOT "fix" that with an event
 * processor without re-checking the DSC.
 *
 * IT FAILS TOWARDS production, ON PURPOSE, and that is a DENY-list rather than
 * an allow-list. The two mistakes are not equals:
 *
 *   - Beta noise landing in production is NOISY and obvious, and a stale entry
 *     here is fixed by editing one line.
 *   - A real production incident labelled "development" is SILENTLY FILTERED
 *     OUT of every alert and dashboard scoped to production. Nothing looks
 *     wrong while it happens.
 *
 * So an unrecognised host — a typo, a hostname added before this file was — is
 * production. Writing it the other way round ("production only if the host is
 * on the list") reads as more careful and puts the invisible failure one
 * forgotten entry away.
 *
 * beta.wordleteams.com IS TEMPORARY. The standing arrangement is
 * dev.wordleteams.com for dev deploys and the bare apex for production
 * (wordle-teams-qjh3); beta goes away after cutover and its entry goes with it.
 * dev is listed now because listing it later is the forgotten step that labels
 * dev traffic "production".
 */
const HOST_ENVIRONMENTS = new Map([
  ['wordleteams.com', 'production'],
  ['www.wordleteams.com', 'production'],
  ['dev.wordleteams.com', 'development'],
  ['beta.wordleteams.com', 'beta'],
  ['localhost', 'local'],
  ['127.0.0.1', 'local'],
])

/**
 * `.workers.dev` is a name Cloudflare assigns rather than one chosen here, and
 * a Worker stays reachable on it unless workers_dev is explicitly disabled. It
 * is a second public URL for the same deployment, so it is never production.
 */
const NON_PRODUCTION_HOST_SUFFIXES = ['.workers.dev', '.localhost'] as const

export const DEFAULT_SENTRY_ENVIRONMENT = 'production'

/**
 * Hostname comparison is case-insensitive and port-free. `URL.hostname` already
 * lowercases and already drops the port, so the normalising here is defence in
 * depth for a caller that passes `host` (which carries `:3000` locally) or
 * `window.location.host` by mistake — the failure of getting that wrong is that
 * a non-production host silently becomes "production", which is the quiet
 * direction and therefore the one worth spending two lines on.
 */
export function sentryEnvironment(hostname: string): string {
  const host = hostname.trim().toLowerCase().split(':')[0]
  const known = HOST_ENVIRONMENTS.get(host)
  if (known) return known
  if (NON_PRODUCTION_HOST_SUFFIXES.some((suffix) => host.endsWith(suffix))) return 'development'
  return DEFAULT_SENTRY_ENVIRONMENT
}
