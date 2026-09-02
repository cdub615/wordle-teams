import { betterAuth } from 'better-auth/minimal'
// Subpath import rather than the 'better-auth/plugins' barrel: the barrel pulls
// every plugin into the module graph, and only this one is used.
import { emailOTP } from 'better-auth/plugins/email-otp'
import { createClient } from '@convex-dev/better-auth'
import { convex } from '@convex-dev/better-auth/plugins'
import { requireActionCtx } from '@convex-dev/better-auth/utils'
import authConfig from './auth.config'
import { components, internal } from './_generated/api'
import { query } from './_generated/server'
import { sendEmail } from './email.ts'
import { signInCodeEmail } from './authEmails'
import { OTP_EXPIRY_SEC } from './lib/otpExpiry.ts'
import { isE2eTraffic } from './lib/e2e.ts'
import type { GenericCtx } from '@convex-dev/better-auth'
import type { DataModel } from './_generated/dataModel'

const siteUrl = process.env.SITE_URL
if (!siteUrl) throw new Error('SITE_URL is not set on this deployment')

/**
 * The four social providers, chosen from measured production usage rather than
 * from the design's list. See the plan's §2.1 and its 2026-08-17 amendment:
 * slack had zero users, and X/Twitter was dropped once it stopped being free
 * (its two users both hold confirmed emails and sign in by OTP instead).
 *
 * The config key is Better Auth's provider id, which is also the last segment
 * of the callback URL — `https://beta.wordleteams.com/api/auth/callback/<id>`.
 * Note `microsoft`: the implementation is Entra ID but the id is not 'azure',
 * which is what v1/Supabase called it.
 */
const PROVIDER_ENV = {
  google: ['GOOGLE_CLIENT_ID', 'GOOGLE_CLIENT_SECRET'],
  microsoft: ['MICROSOFT_CLIENT_ID', 'MICROSOFT_CLIENT_SECRET'],
  github: ['GITHUB_CLIENT_ID', 'GITHUB_CLIENT_SECRET'],
  discord: ['DISCORD_CLIENT_ID', 'DISCORD_CLIENT_SECRET'],
} as const

/**
 * Extra per-provider options merged over the credentials.
 *
 * MICROSOFT: ask for less than Better Auth's default.
 *
 * The default scope list is `openid profile email User.Read offline_access`.
 * `User.Read` is a Microsoft GRAPH permission, and tenants that restrict user
 * consent to Graph make it an admin-approval gate — sign-in stops at "approval
 * required" and asks for a business justification. v1 never hit that because
 * Supabase requested only `email offline_access` against this very same app
 * registration, so the scopes are the only thing that changed for the 15
 * work/school users.
 *
 * Nothing here needs Graph. Every claim Better Auth reads — email,
 * email_verified, name, sub — is decoded from the ID token, which the plain
 * OIDC scopes already provide. `User.Read` buys exactly one thing: the profile
 * photo. That is not worth an admin-consent prompt standing between a returning
 * user and their teams.
 *
 * `openid` is not optional: getUserInfo returns null without an ID token.
 */
const PROVIDER_OPTIONS: Record<string, Record<string, unknown>> = {
  microsoft: {
    disableDefaultScope: true,
    scope: ['openid', 'profile', 'email', 'offline_access'],
    disableProfilePhoto: true,

    /**
     * THE ONE PROVIDER THAT OPTS OUT OF THE REFRESH (wordle-teams-wdp1). The
     * builder below turns `overrideUserInfoOnSignIn` on by default so a social
     * sign-in updates the stored profile image; this switches it back off here,
     * and the reason is three lines up — `disableProfilePhoto: true`.
     *
     * Microsoft NEVER returns an image for this app, deliberately: fetching one
     * needs the `User.Read` Graph scope, which is an admin-consent gate on
     * tenants that restrict user consent to Graph, and the note above this
     * object records that as unacceptable for the 15 work/school users. So the
     * refresh has nothing to gain here and would still rewrite `name` and
     * `email` from the ID token on every single sign-in. Cost with no benefit.
     */
    overrideUserInfoOnSignIn: false,

    /**
     * Decide `emailVerified` ourselves, because Better Auth's default says
     * false whenever Microsoft omits the claim — and a false here does NOT
     * produce a duplicate account, it REFUSES the sign-in with
     * `account_not_linked`. A personal Microsoft account hit exactly that.
     *
     * Better Auth checks `email_verified`, then the
     * verified_primary_email/verified_secondary_email arrays. Microsoft does
     * not reliably emit any of those: `email_verified` is not a standard v2.0
     * claim, and the verified_* arrays are optional claims that Microsoft's own
     * guidance says "are not always set" even once enabled.
     *
     * Two additions, in decreasing order of authority:
     *
     * `xms_edov` — "email domain owner verified". This is Microsoft's OWN
     * recommended signal for exactly this decision: it asserts the token issuer
     * owns the email's domain, which is what stops a tenant admin stamping an
     * arbitrary address on a user and having it linked into someone else's
     * account.
     *
     * The consumer tenant — every personal Microsoft account carries this fixed
     * tid. For consumer accounts Microsoft owns the namespace and verifies
     * ownership when the address is added, so the address is as verified as
     * Microsoft can make it. Narrow and deliberate: it applies ONLY to that one
     * fixed tenant id, never to a work/school tenant, where an admin could set
     * an address the user does not control.
     *
     * Everything still falls through to false. This widens what counts as
     * proof; it does not remove the requirement for proof.
     */
    mapProfileToUser: (profile: Record<string, unknown>) => {
      const CONSUMER_TENANT = '9188040d-6c67-4c5b-b112-36a304b66dad'
      const email = typeof profile.email === 'string' ? profile.email : undefined

      // Keys only, never values: this lands in deployment logs and the claims
      // carry real addresses and names.
      console.log(
        `[auth] microsoft id_token claims: ${Object.keys(profile).sort().join(',')}` +
          ` | email_verified=${String(profile.email_verified)}` +
          ` | xms_edov=${String(profile.xms_edov)}` +
          ` | consumer=${profile.tid === CONSUMER_TENANT}`,
      )

      const verifiedArrays =
        !!email &&
        ((profile.verified_primary_email as string[] | undefined)?.includes(email) ||
          (profile.verified_secondary_email as string[] | undefined)?.includes(email))

      const emailVerified =
        typeof profile.email_verified === 'boolean'
          ? profile.email_verified
          : verifiedArrays || profile.xms_edov === true || profile.tid === CONSUMER_TENANT

      return { emailVerified }
    },
  },
}

/**
 * A provider is wired only when BOTH of its variables are present.
 *
 * Deliberately not fail-fast, which is the opposite of the SITE_URL check above.
 * `createAuth` builds the whole auth surface, so throwing here over a missing
 * Discord secret would take email OTP down with it — a total outage caused by
 * the least-used button. Omitting the provider instead keeps every other route
 * working. The omission is not silent: it is logged at startup, and the button
 * still renders, so clicking it fails loudly during the per-provider check that
 * wt-ksh.2.7 requires.
 */
/**
 * EXPORTED, AND TAKING ITS ENV AS AN ARGUMENT, PURELY SO A TEST CAN REACH IT.
 *
 * Nothing in this module was covered before wordle-teams-wdp1 — `createAuth`
 * needs a Convex ctx and convex-test cannot stand up a Better Auth session
 * (wordle-teams-obw), so the whole auth surface was unpinned. This assembly
 * step is pure, which makes it the part that CAN be pinned, and it is worth
 * pinning: the Microsoft scope list below has already broken sign-in once for
 * the 15 work/school users, and `overrideUserInfoOnSignIn` is a single flag
 * whose absence is invisible until somebody notices a blank avatar weeks later.
 *
 * Reading `process.env` through a parameter rather than directly is the only
 * concession to testability, and it costs one default.
 */
export function buildSocialProviders(
  env: Record<string, string | undefined> = process.env,
): Record<string, Record<string, unknown>> {
  return Object.fromEntries(
  Object.entries(PROVIDER_ENV)
    .map(([id, [idVar, secretVar]]) => {
      const clientId = env[idVar]
      const clientSecret = env[secretVar]
      if (!clientId || !clientSecret) {
        console.warn(
          `[auth] social provider '${id}' is not configured; ${idVar}/${secretVar} missing on this deployment`,
        )
        return null
      }
      return [
        id,
        {
          clientId,
          clientSecret,
          /**
           * THE STORED PROFILE IMAGE IS ONLY EVER WRITTEN AT USER CREATION
           * WITHOUT THIS (wordle-teams-wdp1).
           *
           * better-auth sets `image` in `createOAuthUser` — the brand-new-user
           * path — and on any LATER sign-in updates it only when
           * `overrideUserInfo` is true (`oauth2/link-account.mjs:67-77`), which
           * comes from precisely this option (`api/routes/callback.mjs:151`).
           * It was unset, so it was undefined, so the update never ran.
           *
           * WHICH BROKE THE COMMON CASE RATHER THAN AN EDGE ONE. `migrate.ts`
           * creates `players` rows keyed by email and no Better Auth users at
           * all, so a migrated player's account is CREATED by whatever they
           * sign in with first — and for the OTP path that is a user with
           * `image: null`. Linking Google, GitHub or Discord afterwards
           * attached the account and left the image null permanently. The
           * header fell back to initials forever.
           *
           * IT IS WIDER THAN THE IMAGE, WHICH IS WORTH KNOWING RATHER THAN
           * DISCOVERING. The same branch rewrites `name` and `email` from the
           * provider on every social sign-in. Both are acceptable here and
           * neither is incidental: the header's initials come from the
           * `players` row and not from Better Auth's `name` (see
           * lib/initials.ts), so a refreshed `name` changes nothing anyone
           * reads; and account linking already requires a verified email
           * matching on both sides, so the rewritten address is the one that
           * was matched on.
           *
           * BEFORE THE SPREAD, SO A PROVIDER CAN SAY NO. Microsoft does — see
           * `PROVIDER_OPTIONS.microsoft`, which cannot return an image at all.
           *
           * IT TAKES EFFECT ON THE NEXT SOCIAL SIGN-IN AND BACKFILLS NOTHING.
           * Accounts already holding a null image keep it until their owner
           * signs in socially again, which is accepted rather than overlooked.
           */
          overrideUserInfoOnSignIn: true,
          ...(PROVIDER_OPTIONS[id] ?? {}),
        },
      ] as const
    })
    .filter((entry): entry is NonNullable<typeof entry> => entry !== null),
  )
}

const socialProviders = buildSocialProviders()

export const authComponent = createClient<DataModel>(components.betterAuth)

export const createAuth = (ctx: GenericCtx<DataModel>) =>
  betterAuth({
    baseURL: siteUrl,
    database: authComponent.adapter(ctx),
    socialProviders,

    /**
     * WHERE A FAILED SIGN-IN LANDS (wordle-teams-vjh).
     *
     * Better Auth's default is its own /api/auth/error page — and in production
     * that page does not render: dist/api/routes/error.mjs 302s onward to `/`
     * with the code in the query string and no message anywhere. So a user who
     * declined consent at their provider ended up silently on the marketing
     * landing. This points the same redirect at the page whose entire job is to
     * explain a failed sign-in, with the machine-readable code still attached.
     *
     * NOT REDUNDANT with the `errorCallbackURL` src/routes/login.tsx passes to
     * signIn.social, which is the same destination reached by a different
     * route: THAT one is read out of the OAuth state, so it is only available
     * once the state has been parsed. This one is the default used when parsing
     * the state is itself what failed — a mismatched or missing state cookie,
     * which is exactly the failure the first asterisked note on /login-error
     * describes ("sometimes the first login with a sign in provider fails when
     * redirecting"). Neither covers the other's case.
     *
     * ABSOLUTE, not '/login-error': this handler runs on the Convex deployment,
     * and only `siteUrl` knows the browser-facing origin.
     *
     * Blast radius is error paths only. `onAPIError.errorURL` is read in
     * callback.mjs, oauth2/state.mjs, oauth2/link-account.mjs and the error
     * route; it does not change the shape of any API response, which is
     * `onAPIError.throw` / `.onError` and is left unset.
     */
    onAPIError: { errorURL: `${siteUrl}/login-error` },

    /**
     * Account linking is what makes the migration survivable. Copied players are
     * keyed by email (`players.by_email`), so a user who signed in with OTP and
     * later uses Google must land on the SAME Better Auth user — otherwise they
     * get a second, empty account and none of their teams or scores.
     *
     * `enabled: true` is the default; it is stated because it is load-bearing.
     *
     * NO `trustedProviders`. That list means "link even when the provider does
     * not vouch for the email", which is precisely the account-takeover hole:
     * anyone who can get a provider to assert an unverified address could be
     * linked into someone else's account. Linking here has to be earned by a
     * verified email on both sides. `requireLocalEmailVerified` is left at its
     * default of true for the same reason.
     *
     * Consequence worth knowing before testing: Better Auth REFUSES to link
     * (error "account not linked") when the provider reports the email as
     * unverified — it does not fall back to creating a duplicate. So a provider
     * that fails to assert verification locks the user out rather than
     * splitting them in two. See the Entra note in `docs/`-linked wt-ksh.2.7.
     */
    account: {
      accountLinking: {
        enabled: true,
      },
    },

    plugins: [
      emailOTP({
        // Codes are stored hashed rather than the plugin's default of plain.
        // A sign-in code is a bearer credential for the few minutes it lives,
        // and there is no reason for the database to be able to read one.
        // Costs nothing in UX, and does not affect the e2e capture below, which
        // hooks sendVerificationOTP and therefore sees the code BEFORE storage.
        storeOTP: 'hashed',

        // Same constant the email sentence is written from, so the promise and
        // the enforcement cannot drift apart.
        expiresIn: OTP_EXPIRY_SEC,

        async sendVerificationOTP({ email, otp }) {
          // NOT THE MAIL GUARD. That lives once, in email.ts's sendEmail
          // (wordle-teams-sga), and teams.ts's copy of it was deleted for being
          // a second statement of the same rule — so this looks like the
          // leftover third. It is not.
          //
          // This branch is a ROUTE, not a suppression: an e2e code has to reach
          // the capture oracle, because that is the only way the suite can read
          // it and sign in. Deleting these lines does not merely re-enable mail
          // — it breaks every e2e sign-in. The `return` is what stops both paths
          // firing; the suppression underneath it is incidental.
          if (isE2eTraffic(email, process.env.E2E_TEST_MODE)) {
            await requireActionCtx(ctx).runMutation(internal.testOtps.store, { email, otp })
            return
          }
          const { subject, text, html } = signInCodeEmail(otp)
          await sendEmail(requireActionCtx(ctx), {
            from: 'Wordle Teams <auth@wordleteams.com>',
            to: email,
            subject,
            text,
            html,
          })
        },
      }),
      convex({ authConfig }),
    ],
  })

export const getCurrentUser = query({
  args: {},
  handler: async (ctx) => authComponent.getAuthUser(ctx),
})
