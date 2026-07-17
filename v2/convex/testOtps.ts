import { internalMutation, query } from './_generated/server'
import { v } from 'convex/values'

export const store = internalMutation({
  args: { email: v.string(), otp: v.string() },
  handler: async (ctx, args) => {
    await ctx.db.insert('testOtps', args)
  },
})

export const latestFor = query({
  args: { email: v.string() },
  handler: async (ctx, { email }) => {
    if (process.env.E2E_TEST_MODE !== 'true') {
      throw new Error('testOtps.latestFor is only available in E2E test mode')
    }
    const doc = await ctx.db
      .query('testOtps')
      .withIndex('by_email', (q) => q.eq('email', email))
      .order('desc')
      .first()
    return doc?.otp ?? null
  },
})
