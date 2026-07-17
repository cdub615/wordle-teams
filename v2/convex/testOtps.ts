import { internalMutation, query } from './_generated/server'
import { v } from 'convex/values'

// Only throwaway e2e accounts may ever flow through the OTP-capture oracle —
// even in test mode, real addresses must never have their codes readable.
export const isE2eEmail = (email: string) => /^e2e\+[^@]+@wordleteams\.com$/i.test(email)

export const store = internalMutation({
  args: { email: v.string(), otp: v.string() },
  handler: async (ctx, args) => {
    const existing = await ctx.db
      .query('testOtps')
      .withIndex('by_email', (q) => q.eq('email', args.email))
      .collect()
    for (const doc of existing) await ctx.db.delete(doc._id)
    await ctx.db.insert('testOtps', args)
  },
})

export const latestFor = query({
  args: { email: v.string() },
  handler: async (ctx, { email }) => {
    if (process.env.E2E_TEST_MODE !== 'true' || !isE2eEmail(email)) {
      throw new Error('testOtps.latestFor is only available in E2E test mode for e2e+* addresses')
    }
    const doc = await ctx.db
      .query('testOtps')
      .withIndex('by_email', (q) => q.eq('email', email))
      .order('desc')
      .first()
    return doc?.otp ?? null
  },
})
