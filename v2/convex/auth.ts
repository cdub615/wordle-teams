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

export const authComponent = createClient<DataModel>(components.betterAuth)

export const createAuth = (ctx: GenericCtx<DataModel>) =>
  betterAuth({
    baseURL: siteUrl,
    database: authComponent.adapter(ctx),
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
