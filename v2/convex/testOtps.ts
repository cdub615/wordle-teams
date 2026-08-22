import { internalMutation, mutation } from './_generated/server'
import { v } from 'convex/values'

// Only throwaway e2e accounts may ever flow through the OTP-capture oracle —
// even in test mode, real addresses must never have their codes readable.
//
// RE-EXPORTED, NOT DEFINED HERE. The address shape now lives in lib/e2e.ts with
// the mode check beside it, so the two cannot drift; this re-export keeps
// auth.ts's and e2eSeed.ts's existing imports working. Import from lib/e2e.ts
// in new code.
import { isE2eTraffic } from './lib/e2e.ts'
export { isE2eEmail } from './lib/e2e.ts'

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

// DELETE-ON-READ. Was a plain query, which left every captured code sitting in
// the table indefinitely; now a mutation so the row cannot outlive the single
// read the e2e test needs. Three guards, deepest first:
//   1. E2E_TEST_MODE must be 'true' — never set on the production deployment,
//      so this is inert there no matter what is called.
//   2. the address must match e2e+*@wordleteams.com.
//   3. the row is destroyed as it is handed over, so a leak has a window of one
//      read rather than forever.
// It is a mutation rather than a query purely because queries cannot write;
// the e2e poll calls it the same way. See wt-ksh.1.14.
export const takeFor = mutation({
  args: { email: v.string() },
  handler: async (ctx, { email }) => {
    if (!isE2eTraffic(email, process.env.E2E_TEST_MODE)) {
      throw new Error('testOtps.takeFor is only available in E2E test mode for e2e+* addresses')
    }
    const doc = await ctx.db
      .query('testOtps')
      .withIndex('by_email', (q) => q.eq('email', email))
      .order('desc')
      .first()
    if (!doc) return null
    await ctx.db.delete(doc._id)
    return doc.otp
  },
})

// Housekeeping for rows abandoned by tests that failed before reading — a
// crashed run would otherwise leave its code behind forever. Internal only, so
// it can be scheduled or called from the dashboard but never from a client.
export const purgeAll = internalMutation({
  args: {},
  handler: async (ctx) => {
    const all = await ctx.db.query('testOtps').collect()
    for (const doc of all) await ctx.db.delete(doc._id)
    return all.length
  },
})
