import { afterEach, describe, expect, it, vi } from 'vitest'
import { resolveConvexUrl } from './convex-url.ts'

/**
 * EVERY CASE PINS `process` ITSELF RATHER THAN SETTING AN ENV VAR, and that is
 * the same argument clock-time.test.ts makes for passing the zone and the
 * locale: the host must not be able to reach the thing under test. `pnpm test`
 * runs under vitest's edge-runtime environment, which DOES provide a `process`
 * with the real shell's variables on it — so a test that only set
 * VITE_CONVEX_URL would be asserting against whatever .env.local last put in
 * the developer's shell, and the browser case could not be written at all.
 *
 * THE BROWSER CASE IS THE WHOLE REASON THIS FUNCTION EXISTS RATHER THAN BEING
 * TWO LINES IN router.tsx. router.tsx is UNIVERSAL — the same module builds the
 * router in the Worker and in the browser — and `dist/client` today contains
 * ZERO occurrences of `process.env`, because nothing on the client path has ever
 * read one and vite.config.ts defines no `process.env` shim. So a bare
 * `process.env.VITE_CONVEX_URL` there is a free identifier in the browser and
 * throws `process is not defined` while the router is being constructed, which
 * is before any error boundary exists to catch it. `typeof process` is load
 * bearing, and case 3 is what holds it there.
 */
describe('resolveConvexUrl', () => {
  afterEach(() => {
    vi.unstubAllGlobals()
  })

  const BETA = 'https://fabulous-goldfish-949.convex.cloud'
  const LOCAL = 'http://127.0.0.1:3210'

  /**
   * THE BUG THIS PINS (wordle-teams-3s2g). auth-server.ts reads
   * `process.env.VITE_CONVEX_URL ?? import.meta.env.VITE_CONVEX_URL`; router.tsx
   * read only the second half, so vite inlined a literal and no runtime var
   * could move it. A production build served locally therefore signed the
   * session in against the LOCAL backend and issued every dashboard query
   * against BETA, which answers a locally minted token with an error — a 500 on
   * an authenticated GET /app where `vite dev` returned 200.
   */
  it('prefers the Worker runtime var over the build-time literal', () => {
    vi.stubGlobal('process', { env: { VITE_CONVEX_URL: LOCAL } })
    expect(resolveConvexUrl(BETA)).toBe(LOCAL)
  })

  // The deployed shape: wrangler.jsonc's `vars` and .env.production name the
  // same deployment, so the fallback is what answers and agreement is trivial.
  it('falls back to the build-time literal when the runtime var is unset', () => {
    vi.stubGlobal('process', { env: {} })
    expect(resolveConvexUrl(BETA)).toBe(BETA)
  })

  // Case 3. Delete the `typeof process` guard and this is a TypeError.
  it('reads nothing at all in a browser, where there is no process', () => {
    vi.stubGlobal('process', undefined)
    expect(resolveConvexUrl(BETA)).toBe(BETA)
  })

  // A bundler-injected `process` shim with no `env` on it. Same failure mode as
  // case 3 one property deeper, and what the `?.` is for.
  it('survives a process with no env on it', () => {
    vi.stubGlobal('process', {})
    expect(resolveConvexUrl(BETA)).toBe(BETA)
  })

  // The message is the one router.tsx and auth-server.ts already throw; a build
  // with neither source set is a misconfiguration that must be loud.
  it('throws when neither source carries a URL', () => {
    vi.stubGlobal('process', { env: {} })
    expect(() => resolveConvexUrl(undefined)).toThrow('VITE_CONVEX_URL is not set')
  })
})
