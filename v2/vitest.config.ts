import { defineConfig } from 'vitest/config'

export default defineConfig({
  test: {
    environment: 'edge-runtime',
    // scripts/ is in here since Phase 4 so the copy's exclusion rules can be
    // pinned. MOST scripts are untestable — copy-from-supabase.mjs and friends
    // do their work at module scope against production — so what is worth
    // asserting is lifted into scripts/lib/*.mjs, which is where the majority
    // of the suites under this glob live.
    //
    // scripts/build-sw.mjs IS IMPORTED DIRECTLY by scripts/build-sw.test.mjs,
    // and that is the deliberate exception rather than a drift from the rule
    // above. Its module scope is inert: everything it does is inside `main()`,
    // which runs only behind a `process.argv[1] === import.meta.url` guard, so
    // importing it builds nothing. Given that, a separate scripts/lib/ module
    // for one pure function would have been indirection for its own sake. The
    // rule is really "a test must not trigger the script's side effects" — the
    // lift is just the usual way of satisfying it.
    include: ['convex/**/*.test.ts', 'src/**/*.test.ts', 'scripts/**/*.test.mjs'],
    server: { deps: { inline: ['convex-test'] } },
    // auth.ts fails fast at module scope when SITE_URL is unset — a deliberate
    // guard against the scheme-less-origin bug. Tests import it transitively
    // through access.ts, so the harness has to supply one. The value is never
    // dereferenced in tests; it only has to exist.
    env: { SITE_URL: 'http://localhost:3000' },
  },
})
