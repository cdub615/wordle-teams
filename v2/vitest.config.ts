import { defineConfig } from 'vitest/config'

export default defineConfig({
  test: {
    environment: 'edge-runtime',
    // scripts/ is in here since Phase 4 so the copy's exclusion rules can be
    // pinned. The scripts themselves are untestable — they do their work at
    // module scope against production — so anything worth asserting is lifted
    // into scripts/lib/*.mjs, and only those get a suite.
    include: ['convex/**/*.test.ts', 'src/**/*.test.ts', 'scripts/**/*.test.mjs'],
    server: { deps: { inline: ['convex-test'] } },
    // auth.ts fails fast at module scope when SITE_URL is unset — a deliberate
    // guard against the scheme-less-origin bug. Tests import it transitively
    // through access.ts, so the harness has to supply one. The value is never
    // dereferenced in tests; it only has to exist.
    env: { SITE_URL: 'http://localhost:3000' },
  },
})
