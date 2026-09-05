import schema from './schema'
import { components } from './_generated/api'
import type { TestConvex } from 'convex-test'

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
 * Stands up a REAL Better Auth session for `email` and returns a convexTest
 * instance authenticated as it, via `t.withIdentity`. Caller must have
 * already run `betterAuthTest.register(t)` on `t` — this only reproduces
 * production's identity shape, it does not register the component itself.
 *
 * USES THE PACKAGE'S PUBLISHED TEST ENTRY POINT, `@convex-dev/better-auth/test`
 * (`"./test": "./src/test.ts"` in its package.json) — not an unpublished
 * internal. `betterAuthTest.register` wires the SAME schema and functions the
 * real `betterAuth` component in `convex/convex.config.ts` runs into
 * convexTest, and `components.betterAuth.adapter.create` below is the same
 * generated adapter API `createClient` (`convex/auth.ts`'s `authComponent`)
 * uses internally — this reproduces production's own lookup rather than
 * working around it.
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
