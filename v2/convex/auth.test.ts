import { describe, expect, test } from 'vitest'
import { buildSocialProviders } from './auth.ts'

/**
 * THE SOCIAL PROVIDER CONFIG, WHICH NOTHING COVERED UNTIL wordle-teams-wdp1.
 *
 * `createAuth` needs a Convex ctx and convex-test cannot stand up a Better Auth
 * session (wordle-teams-obw), so every behavioural claim in auth.ts has been
 * carried by its doc comments alone. `buildSocialProviders` is the pure part,
 * and the two things pinned below are both things that have gone wrong or
 * silently failed in production rather than hypotheticals:
 *
 *   - the Microsoft SCOPE LIST. Better Auth's default includes `User.Read`, a
 *     Graph permission that becomes an admin-consent gate on tenants which
 *     restrict user consent — sign-in stops at "approval required" and asks for
 *     a business justification. v1 never hit it because Supabase requested only
 *     `email offline_access` against this same app registration, so the scopes
 *     were the only thing that changed for the 15 work/school users.
 *
 *   - `overrideUserInfoOnSignIn`, whose ABSENCE meant a stored profile image
 *     was only ever written when the provider CREATED the account. Any account
 *     created by email OTP — which is the whole migration path, since
 *     migrate.ts creates players rows and no Better Auth users — kept
 *     `image: null` forever, however many providers it later linked.
 *
 * ENV IS PASSED IN RATHER THAN STUBBED ON `process.env`, which is why the
 * function takes it. These tests do not care what the deployment running them
 * has configured, and a test that reads real credentials out of the ambient
 * environment is a test whose result depends on the machine.
 */

/** Every provider wired, with placeholder credentials. */
const ALL_CONFIGURED = {
  GOOGLE_CLIENT_ID: 'g-id',
  GOOGLE_CLIENT_SECRET: 'g-secret',
  MICROSOFT_CLIENT_ID: 'm-id',
  MICROSOFT_CLIENT_SECRET: 'm-secret',
  GITHUB_CLIENT_ID: 'gh-id',
  GITHUB_CLIENT_SECRET: 'gh-secret',
  DISCORD_CLIENT_ID: 'd-id',
  DISCORD_CLIENT_SECRET: 'd-secret',
}

describe('a social sign-in refreshes the stored profile, except where it cannot', () => {
  // THE THREE THAT ACTUALLY RETURN AN AVATAR. Asserted one per provider rather
  // than as a loop over a list, so a failure names which provider lost the flag.
  for (const id of ['google', 'github', 'discord'] as const) {
    test(`${id} refreshes the profile on every sign-in, not just at creation`, () => {
      const providers = buildSocialProviders(ALL_CONFIGURED)

      expect(providers[id]?.overrideUserInfoOnSignIn).toBe(true)
    })
  }

  test('MICROSOFT DOES NOT, because it can never return an image anyway', () => {
    // Not an oversight and not a gap to close later: `disableProfilePhoto` is
    // set for this provider because fetching a photo needs the `User.Read`
    // Graph scope, and that scope is an admin-consent gate. So the refresh has
    // nothing to gain here and would still rewrite name and email from the ID
    // token on every sign-in. The opt-out has to come AFTER the default in the
    // builder's object literal to win, which is the mutation this kills —
    // moving the spread above `overrideUserInfoOnSignIn: true` silently flips
    // this back to true and nothing else in the repo would notice.
    const providers = buildSocialProviders(ALL_CONFIGURED)

    expect(providers.microsoft?.overrideUserInfoOnSignIn).toBe(false)
  })
})

describe('the Microsoft scopes stay narrow, which is what keeps work accounts signing in', () => {
  test('exactly the four OIDC scopes, and NOT User.Read', () => {
    const providers = buildSocialProviders(ALL_CONFIGURED)

    // EXHAUSTIVE, not `not.toContain('User.Read')`. Better Auth's default list
    // is `openid profile email User.Read offline_access`, so the failure mode
    // is a scope being ADDED — and only asserting the absence of the one scope
    // that broke it last time would miss the next Graph permission somebody
    // adds for a reason that seems good at the time.
    expect(providers.microsoft?.scope).toEqual(['openid', 'profile', 'email', 'offline_access'])
    // `disableDefaultScope` is what stops Better Auth's list being merged with
    // ours rather than replaced. Without it the assertion above still passes
    // and the request still carries User.Read.
    expect(providers.microsoft?.disableDefaultScope).toBe(true)
  })

  test('`openid` is present, without which getUserInfo returns null', () => {
    // Called out separately because it is the one scope that looks droppable —
    // it names no data and reads like boilerplate beside `profile` and `email`
    // — and dropping it breaks sign-in completely rather than partially: no ID
    // token means no claims, and mapProfileToUser never runs.
    const providers = buildSocialProviders(ALL_CONFIGURED)

    expect(providers.microsoft?.scope).toContain('openid')
  })
})

describe('a provider with no credentials is omitted, not half-wired', () => {
  test('the missing one is absent and the others are untouched', () => {
    // auth.ts is explicit that this must not throw: createAuth builds the whole
    // auth surface, so a missing Discord secret taking email OTP down with it
    // would be a total outage caused by the least-used button.
    const providers = buildSocialProviders({
      ...ALL_CONFIGURED,
      DISCORD_CLIENT_SECRET: undefined,
    })

    expect(Object.keys(providers).sort()).toEqual(['github', 'google', 'microsoft'])
  })

  test('and BOTH variables are required, not either', () => {
    // The condition is `!clientId || !clientSecret`. Written as `&&` it would
    // wire a provider holding an id and no secret, which fails at the redirect
    // with a provider-side error rather than at startup with our own log line.
    const providers = buildSocialProviders({
      GOOGLE_CLIENT_ID: 'g-id',
      GITHUB_CLIENT_ID: 'gh-id',
      GITHUB_CLIENT_SECRET: 'gh-secret',
    })

    expect(Object.keys(providers)).toEqual(['github'])
  })
})
