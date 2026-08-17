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
import { resend } from './email'
import { OTP_EXPIRY_SEC, signInCodeEmail } from './authEmails'
import { isE2eEmail } from './testOtps'
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
const socialProviders = Object.fromEntries(
  Object.entries(PROVIDER_ENV)
    .map(([id, [idVar, secretVar]]) => {
      const clientId = process.env[idVar]
      const clientSecret = process.env[secretVar]
      if (!clientId || !clientSecret) {
        console.warn(
          `[auth] social provider '${id}' is not configured; ${idVar}/${secretVar} missing on this deployment`,
        )
        return null
      }
      return [id, { clientId, clientSecret }] as const
    })
    .filter((entry): entry is NonNullable<typeof entry> => entry !== null),
)

export const authComponent = createClient<DataModel>(components.betterAuth)

export const createAuth = (ctx: GenericCtx<DataModel>) =>
  betterAuth({
    baseURL: siteUrl,
    database: authComponent.adapter(ctx),
    socialProviders,

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
          if (process.env.E2E_TEST_MODE === 'true' && isE2eEmail(email)) {
            await requireActionCtx(ctx).runMutation(internal.testOtps.store, { email, otp })
            return // no real email in test mode
          }
          const { subject, text, html } = signInCodeEmail(otp)
          await resend.sendEmail(requireActionCtx(ctx), {
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
