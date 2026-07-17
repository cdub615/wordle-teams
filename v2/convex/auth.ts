import { betterAuth } from 'better-auth/minimal'
import { emailOTP } from 'better-auth/plugins'
import { createClient } from '@convex-dev/better-auth'
import { convex } from '@convex-dev/better-auth/plugins'
import { requireActionCtx } from '@convex-dev/better-auth/utils'
import authConfig from './auth.config'
import { components } from './_generated/api'
import { query } from './_generated/server'
import { resend } from './email'
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
        async sendVerificationOTP({ email, otp }) {
          await resend.sendEmail(requireActionCtx(ctx), {
            from: 'Wordle Teams <auth@wordleteams.com>',
            to: email,
            subject: `Your Wordle Teams sign-in code: ${otp}`,
            html: `<p>Your Wordle Teams sign-in code is <strong>${otp}</strong>. It expires in 5 minutes.</p>`,
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
