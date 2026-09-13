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
    // Several modules read SITE_URL inside their functions (auth.ts's
    // createAuth, polar.ts, teams.ts) and reminders.test.ts overrides this
    // default to assert the unset case.
    //
    // IT HAS TO BE A REAL ORIGIN, WHICH IT DID NOT USED TO. This comment said
    // "the value is never dereferenced; it only has to exist" — true until the
    // passkey plugin landed, and false from that commit on:
    // convex/lib/relyingParty.ts calls `new URL(siteUrl)` every time
    // createAuthOptions is built, and throws on a value with no scheme or no
    // host. So a stub of 'set' or 'x' here, or in any test that overrides this,
    // is not ignored — it throws. Every current stub happens to parse, which is
    // exactly why the stale sentence was worth deleting rather than trusting.
    env: { SITE_URL: 'http://localhost:3000' },
  },
})
