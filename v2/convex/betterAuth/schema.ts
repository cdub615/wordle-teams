import { defineSchema } from 'convex/server'
import { tables } from './generatedSchema'

/**
 * EXTENDS THE UPSTREAM TABLES, NEVER REGENERATES THEM.
 *
 * Running `npx auth generate` against this app's options would produce a
 * SMALLER schema than upstream's — upstream generates from a wider plugin set
 * (twoFactor, anonymous, username, phoneNumber, magicLink, genericOAuth ...,
 * see src/auth-options.ts), so regenerating would drop the `twoFactor` table
 * and the twoFactorEnabled / isAnonymous / username / displayUsername /
 * phoneNumber / phoneNumberVerified user fields. Measured 2026-09-13: a schema
 * that drops a field existing rows carry does not corrupt anything, it makes
 * the push FAIL — `SchemaDefinitionError` — which is a deploy that dies at the
 * worst possible moment for no benefit. Spreading cannot hit that case.
 */
const schema = defineSchema({
  ...tables,
})

export default schema
