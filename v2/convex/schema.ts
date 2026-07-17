import { defineSchema, defineTable } from 'convex/server'
import { v } from 'convex/values'

export default defineSchema({
  statusMessages: defineTable({
    message: v.string(),
  }),
  testOtps: defineTable({
    email: v.string(),
    otp: v.string(),
  }).index('by_email', ['email']),
})
