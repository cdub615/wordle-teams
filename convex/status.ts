import { query, mutation } from './_generated/server'
import { v } from 'convex/values'

export const get = query({
  args: {},
  handler: async (ctx) => {
    const doc = await ctx.db.query('statusMessages').first()
    return doc?.message ?? null
  },
})

export const set = mutation({
  args: { message: v.string() },
  handler: async (ctx, { message }) => {
    const existing = await ctx.db.query('statusMessages').first()
    if (existing) {
      await ctx.db.patch(existing._id, { message })
    } else {
      await ctx.db.insert('statusMessages', { message })
    }
  },
})
