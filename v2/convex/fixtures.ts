import schema from './schema'
import betterAuthComponentSchema from './betterAuth/schema'
import { components } from './_generated/api'
import type { TestConvex } from 'convex-test'
import type { GenericSchema, SchemaDefinition } from 'convex/server'

/**
 * Shared convex-test document factories.
 *
 * Lives outside any `*.test.ts` file deliberately: vitest.config.ts's
 * `include` only collects `convex/**​/*.test.ts` as suites, so this plain
 * module can be imported by multiple test files without re-executing anyone
 * else's `describe` blocks. (convex/lib/*.ts already proves the "plain
 * non-Convex module in this directory" pattern; this is the same thing for
 * test fixtures.) Before this module existed, winners.test.ts imported
 * aPlayer/aTeam straight from scores.test.ts, which re-ran scores.test.ts's
 * entire suite a second time as a side effect of the import.
 */

export const aPlayer = (over: Record<string, unknown> = {}) => ({
  legacyId: '11111111-1111-4111-8111-111111111111',
  email: 'member@example.com',
  firstName: 'Ada',
  lastName: 'Lovelace',
  hasPwa: false,
  reminderDeliveryMethods: ['email'],
  reminderDeliveryTime: '18:00:00',
  ...over,
})

export const aTeam = (over: Record<string, unknown> = {}) => ({
  legacyId: 206,
  name: 'team 206',
  playerIds: [],
  invited: [],
  oneGuess: 5,
  twoGuesses: 3,
  threeGuesses: 2,
  fourGuesses: 1,
  fiveGuesses: 0,
  sixGuesses: -1,
  failed: -3,
  nA: 0,
  playWeekends: true,
  showLetters: true,
  ...over,
})

/**
 * Registers THIS REPO'S betterAuth component into a convexTest instance — the
 * same `convex/betterAuth/` sources `convex/convex.config.ts` mounts, under
 * the same mount name, so `components.betterAuth.*` resolves in tests to the
 * code production actually runs.
 *
 * THIS USED TO BE `betterAuthTest.register(t)` FROM THE PACKAGE, AND THAT WAS
 * TESTING A DIFFERENT COMPONENT (found in review of wordle-teams-hrqw Task 2).
 * `@convex-dev/better-auth/test` registers the PACKAGE'S `./component/schema.js`
 * and `import.meta.glob("./component/**​/*.ts")`
 * (node_modules/@convex-dev/better-auth/src/test.ts — the whole file is eight
 * lines). Nothing in the suite imported `convex/betterAuth/adapter.ts` at all —
 * the review's demonstration was that our adapter could be DELETED and all 2845
 * tests still passed. Re-measured here from the other direction on 2026-09-13:
 * put `betterAuthTest.register(t)` back into this function and
 * betterAuthSchema.test.ts's adapter test fails with `Validator error: Expected
 * one of object ×10` — ten tables, i.e. the package's schema, not our eleven.
 *
 * That was tolerable only while the local copy and the package copy were
 * byte-identical. Adding the `passkey` table made them differ, at which point
 * the suite would have been blind to the one thing this component exists for.
 *
 * The shape is copied from the package's `register` on purpose — same
 * `registerComponent(name, schema, glob)` call, same default name — so the
 * only thing that changed is WHICH sources get wired. The glob has to reach
 * `convex/betterAuth/_generated/`: convex-test derives the module-path prefix
 * by locating a `_generated` entry in the glob keys and would throw
 * "Could not find the \"_generated\" directory" without one
 * (node_modules/convex-test/dist/index.js, `findModulesRoot`).
 *
 * The name argument is not optional here the way it is upstream. Renaming the
 * component orphans every row — see `convex/betterAuth/convex.config.ts`.
 */
const betterAuthModules = import.meta.glob('./betterAuth/**/*.ts')

export function registerBetterAuth(t: TestConvex<SchemaDefinition<GenericSchema, boolean>>) {
  t.registerComponent('betterAuth', betterAuthComponentSchema, betterAuthModules)
}

/**
 * Stands up a REAL Better Auth session for `email` and returns a convexTest
 * instance authenticated as it, via `t.withIdentity`. Caller must have
 * already run `registerBetterAuth(t)` on `t` — this only reproduces
 * production's identity shape, it does not register the component itself.
 *
 * `components.betterAuth.adapter.create` below is the same generated adapter
 * API `createClient` (`convex/auth.ts`'s `authComponent`) uses internally, and
 * — since `registerBetterAuth` above wires `convex/betterAuth/` rather than the
 * package's copy — it is now literally our `adapter.ts` running. This
 * reproduces production's own lookup rather than working around it.
 *
 * THE LOOKUP THIS REPRODUCES: `requirePlayer` (access.ts) →
 * `authComponent.getAuthUser` resolves a caller by finding a `session` row
 * whose `_id` equals `identity.sessionId`, then a `user` row whose `_id`
 * equals `identity.subject` (see `@convex-dev/better-auth`'s
 * `create-client.js`, `safeGetAuthUser`). So a real identity needs only those
 * two ids threaded into `t.withIdentity`, which is all this does.
 *
 * THAT `_id`-EQUALITY LOOKUP IS AN IMPLEMENTATION DETAIL OF `create-client.js`,
 * NOT A DOCUMENTED CONTRACT of `@convex-dev/better-auth`. It is safe to rely
 * on today because `package.json` pins the dependency to an exact `0.12.5`
 * with no caret — a version bump is a deliberate, visible act, not something
 * that happens under this suite's feet. If that pin ever moves, re-check this
 * helper against the new `create-client.js`'s `safeGetAuthUser`: nothing else
 * in the suite would catch a semantically-compatible but differently-keyed
 * lookup (e.g. a future version matching on a `sessionToken` field instead of
 * `_id`), because every test that calls this treats it as a black box that
 * either produces a working identity or throws.
 *
 * Nothing here touches this app's own `players` table — whether the email in
 * play matches one is left entirely to the caller, which is the whole point
 * of chat.test.ts's NOT_A_MEMBER/NO_PLAYER pair.
 */
export async function authenticatedAs(t: TestConvex<typeof schema>, email: string) {
  const now = Date.now()
  const user = (await t.run((ctx) =>
    ctx.runMutation(components.betterAuth.adapter.create, {
      input: {
        model: 'user',
        data: { name: email, email, emailVerified: true, createdAt: now, updatedAt: now },
      },
    }),
  )) as { _id: string }

  const session = (await t.run((ctx) =>
    ctx.runMutation(components.betterAuth.adapter.create, {
      input: {
        model: 'session',
        data: {
          token: `test-token-${email}`,
          expiresAt: now + 1000 * 60 * 60,
          createdAt: now,
          updatedAt: now,
          userId: user._id,
        },
      },
    }),
  )) as { _id: string }

  return t.withIdentity({ subject: user._id, sessionId: session._id })
}
