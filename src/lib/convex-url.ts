/**
 * WHICH CONVEX DEPLOYMENT THIS PROCESS TALKS TO, resolved the same way on both
 * sides of the app instead of two different ways (wordle-teams-3s2g).
 *
 * THE INCIDENT. An authenticated document GET of /app answered 500 on a
 * production build served locally, where `vite dev` answered 200. The cause was
 * that the two readers of VITE_CONVEX_URL disagreed about where it comes from:
 *
 *   auth-server.ts   process.env.VITE_CONVEX_URL ?? import.meta.env....
 *   router.tsx       import.meta.env.VITE_CONVEX_URL           <- only this
 *
 * `import.meta.env` is substituted by vite AT BUILD TIME, and at mode=production
 * .env.production outranks .env.local — so router.tsx's ConvexQueryClient was
 * constructed with a beta URL frozen into the bundle as a literal, while
 * auth-server.ts read dist/server/.dev.vars at runtime and got the LOCAL
 * backend. The session was therefore minted locally and every dashboard query
 * was issued against beta, which answers a token it has never seen with an
 * error. Nothing in the app could have reported this usefully: React redacts
 * server render messages in a production build, so the page showed only the
 * generic boundary.
 *
 * IT COULD NOT HAVE AFFECTED A DEPLOYMENT, and that is worth saying plainly so
 * nobody re-opens it as a production bug: on beta, wrangler.jsonc's `vars` and
 * .env.production name the same deployment and there is no .dev.vars, so the two
 * readers agreed by construction.
 *
 * THE REASON TO FIX IT IN SOURCE ANYWAY IS THE CUTOVER. wrangler.jsonc declares
 * VITE_CONVEX_URL as a runtime var and its own comment says the two mechanisms
 * "must agree, so change together" — but only auth could honour that var, because
 * the query client's URL was a literal. wordle-teams-qjh3 gives prod its own
 * Convex deployment and changes exactly that var; doing so without a matching
 * rebuild would have moved auth to the new deployment and left every query
 * silently on the old one. Routing both readers through one precedence is what
 * makes the wrangler comment true rather than aspirational.
 *
 * WHY THE RUNTIME VAR WINS rather than the build-time literal: on Workers it is
 * the only value that can be correct. The bundle is built once and can be served
 * by more than one Worker; `vars` are per-deployment. auth-server.ts's own
 * comment records the mechanism — nodejs_compat with a compatibility date at or
 * after 2025-04-01 populates process.env from the deployment's vars, and
 * wrangler.jsonc sets 2025-09-02.
 */

/**
 * The Convex deployment URL, preferring the Worker's runtime var and falling
 * back to whatever vite inlined at build time.
 *
 * TAKES THE BUILD-TIME VALUE AS A PARAMETER because it cannot read it: vite
 * substitutes `import.meta.env.VITE_CONVEX_URL` textually, wherever that exact
 * expression is WRITTEN, so it has to be written at the call site in router.tsx.
 * Reading it here would resolve against this module's own import.meta and yield
 * undefined in the built bundle. The parameter is also what lets the test pin
 * both sources and keeps the host's shell out of the assertions.
 *
 * `typeof process` IS LOAD BEARING AND NOT DEFENSIVE PADDING. The caller is
 * universal — router.tsx builds the router in the Worker and again in the
 * browser — and the client bundle contains no `process` of any kind, so a bare
 * `process.env` read there throws `process is not defined` while the router is
 * being constructed, which is before any boundary exists to catch it. The `?.`
 * covers the neighbouring case of a partial shim with no `env` on it. Both are
 * pinned by convex-url.test.ts rather than left to inspection.
 */
export function resolveConvexUrl(buildTimeUrl: string | undefined): string {
  const runtimeUrl = typeof process === 'undefined' ? undefined : process.env?.VITE_CONVEX_URL
  const url = runtimeUrl ?? buildTimeUrl
  if (!url) throw new Error('VITE_CONVEX_URL is not set')
  return url
}
