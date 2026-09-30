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
/**
 * EXPORTED so src/wrangler-environments.test.ts can require an EXPLICIT entry
 * rather than settling for whatever `sentryEnvironment` falls back to. That
 * distinction is not academic: DEFAULT_SENTRY_ENVIRONMENT is "production", so a
 * hostname absent from this map AGREES with a production Worker by accident, and
 * the check that is supposed to keep the two in step stops checking. Measured
 * 2026-09-30, when a route pattern slipped through it unnoticed.
 */
export const HOST_ENVIRONMENTS = new Map([
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

/**
 * THE RELEASE, ONE VALUE FOR BOTH SDKS. Substituted by Vite's `define` from the
 * commit SHA at build time — see the argument in vite.config.ts for why a SHA
 * rather than the Cloudflare version id the worker was already getting for free.
 *
 * `undefined` RATHER THAN null WHEN ABSENT, because that is what Sentry's option
 * expects: passing null would set a release literally named "null" on every
 * event, which is worse than having none. A build with no git available gets no
 * release, exactly as before wordle-teams-b7av.
 *
 * THE `typeof` GUARD IS NOT DEFENSIVE PADDING — without it this module cannot be
 * IMPORTED under vitest. vitest.config.ts is a separate config and does not carry
 * vite.config.ts's `define`, so the bare identifier throws ReferenceError at
 * module scope and takes every suite that imports this file down with it
 * (measured: sentry-config.test.ts and server.test.ts both died).
 *
 * `typeof` ALSO SURVIVES THE SUBSTITUTION, which is what makes this work in both
 * places rather than only one: `define` is a raw text replacement, so in a real
 * build this reads `typeof "<sha>"`, which is "string". Under vitest the
 * identifier stays undeclared, and `typeof` on an undeclared name is legal
 * JavaScript rather than a throw.
 *
 * IT DOES MEAN A DELETED `define` WOULD FAIL QUIETLY — release simply absent,
 * which is the bug b7av was filed for. sentry-config.test.ts asserts against
 * vite.config.ts's source for exactly that reason; that assertion is the only
 * thing standing between this and a silent regression.
 */
export const SENTRY_RELEASE: string | undefined =
  typeof __SENTRY_RELEASE__ === 'undefined' ? undefined : (__SENTRY_RELEASE__ ?? undefined)

/**
 * WHETHER THE WORKER SHOULD REPORT AT ALL — the local-development cut-off.
 *
 * Measured, not inferred: of 1844 events in the Sentry project, 1835 came from
 * a developer's own machine and 9 came from a real deployed host. A search for
 * `url:*wordleteams.com*` on the largest issue ("Network connection lost.",
 * 1816 events) returned ZERO. The signal-to-noise ratio was 0.5%.
 *
 * THE CAUSE IS THAT THE DSN IS A `vars` ENTRY, and wrangler.jsonc declares it at
 * the TOP LEVEL. That is right for the deployed worker and was argued for on its
 * merits (wt-3yb: a DSN is public, so a var is reproducible where a secret is a
 * manual step). What the argument did not cover is that `wrangler dev` — and the
 * @cloudflare/vite-plugin dev server that `pnpm dev` and the whole Playwright
 * suite run behind — inherit those same top-level vars. Every local run has been
 * reporting to the live project since the DSN was added.
 *
 * FILTERING BY ENVIRONMENT COULD NOT HAVE RECOVERED IT. `ENVIRONMENT` is a
 * top-level var too, so local runs arrive tagged `beta` — the same tag the real
 * beta deployment carries. There is no query that separates them after the fact,
 * which is why this has to be decided before the event is sent.
 *
 * `import.meta.env.DEV` RATHER THAN A HOSTNAME, and the reason is the same one
 * sentryEnvironment's doc comment gives for why the WORKER cannot key on the
 * hostname at all: `withSentry(optionsCallback, handler)` hands the callback
 * `env` and never the Request. A build-time boolean is the only thing available
 * at the point the decision has to be made. register-sw.ts:118 already reads
 * `import.meta.env.PROD` for a related build-time question, so this is the
 * established shape in this codebase rather than a new mechanism.
 *
 * IT FAILS TOWARDS REPORTING, which is the same direction every other default in
 * this file leans. `DEV` is true only under `vite dev` and under vitest; a real
 * `vite build` inlines it to `false`, so a deployed worker reports exactly as it
 * did before. The mistake this cannot make is silencing production.
 *
 * KNOWN GAP, STATED RATHER THAN DISCOVERED: `vite preview` serves the BUILT
 * worker, so `DEV` is false there and a local preview still reports. That is the
 * 9-event tail (issue WORDLE-TEAMS-V2-A, all on localhost:4173 via curl) and it
 * is deliberately left alone — closing it needs a hostname the callback cannot
 * see, and preview is a deliberate act rather than something that runs all day.
 */
export function workerSentryDsn(dsn: string | undefined, isDev: boolean): string | undefined {
  return isDev ? undefined : dsn
}
