import { defineConfig } from 'vitest/config'

export default defineConfig({
  test: {
    environment: 'edge-runtime',
    include: ['convex/**/*.test.ts', 'src/**/*.test.ts'],
    server: { deps: { inline: ['convex-test'] } },
    // auth.ts fails fast at module scope when SITE_URL is unset — a deliberate
    // guard against the scheme-less-origin bug. Tests import it transitively
    // through access.ts, so the harness has to supply one. The value is never
    // dereferenced in tests; it only has to exist.
    env: { SITE_URL: 'http://localhost:3000' },
  },
})
