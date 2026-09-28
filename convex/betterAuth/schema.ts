import { defineSchema, defineTable } from 'convex/server'
import { v } from 'convex/values'
import { tables } from './generatedSchema'

/**
 * EXTENDS THE UPSTREAM TABLES, NEVER REGENERATES THEM.
 *
 * Running `npx auth generate` against this app's options would produce a
 * SMALLER schema than upstream's — upstream generates from a wider plugin set
 * (twoFactor, anonymous, username, phoneNumber, magicLink, genericOAuth ...,
 * see node_modules/@convex-dev/better-auth/src/auth-options.ts), so
 * regenerating would drop the `twoFactor` table and the twoFactorEnabled /
 * isAnonymous / username / displayUsername / phoneNumber / phoneNumberVerified
 * user fields. Measured 2026-09-13: a schema that drops a field existing rows
 * carry does not corrupt anything, it makes the push FAIL —
 * `SchemaDefinitionError` — which is a deploy that dies at the worst possible
 * moment for no benefit. Spreading cannot hit that case.
 */
const schema = defineSchema({
  ...tables,

  /**
   * THE WHOLE REASON THIS COMPONENT IS LOCAL (wordle-teams-hrqw).
   *
   * The prebuilt component's schema is fixed at ten tables and has nowhere to
   * put this one. Fields mirror @better-auth/passkey's `Passkey` type;
   * `createdAt` is a number here because the Convex adapter stores dates that
   * way, as every other table in generatedSchema.ts does.
   *
   * UNUSED UNTIL wordle-teams-wty4.1.7 — WHICH IS NOT THE SAME AS UNREACHABLE,
   * and the difference was measured rather than assumed. The adapter's arg
   * validators are built from THIS schema, so `adapter.create({ model:
   * 'passkey', ... })` would validate and insert. What makes the table inert in
   * practice is that Better Auth only ever CALLS the models its own options
   * declare (`getAuthTables`,
   * node_modules/@convex-dev/better-auth/src/client/create-api.ts:65), and
   * nothing in the auth flow names passkey until the plugin lands.
   *
   * ONE CONSEQUENCE WORTH KNOWING: `checkUniqueFields` consults the OPTIONS
   * schema, and `isUniqueField` returns false for a model it cannot find rather
   * than throwing
   * (node_modules/@convex-dev/better-auth/src/client/adapter-utils.ts:61-74).
   * So this table has NO uniqueness enforcement from the plugin's own schema,
   * and adding the plugin in wty4.1.7 did not supply any: it declares
   * credentialID `index: true`, not `unique: true`. adapter.ts marks the field
   * unique on the options it builds `createApi` from, which is what turns
   * `checkUniqueFields` on (wordle-teams-047w) — and THAT CHECK NEEDS THE INDEX
   * BELOW. `.index('credentialID', ['credentialID'])` is load-bearing from here
   * on: without it the check throws `No index found for passkeycredentialID` on
   * every registration rather than failing quietly.
   */
  passkey: defineTable({
    name: v.optional(v.union(v.null(), v.string())),
    publicKey: v.string(),
    userId: v.string(),
    credentialID: v.string(),
    counter: v.number(),
    deviceType: v.string(),
    backedUp: v.boolean(),
    transports: v.optional(v.union(v.null(), v.string())),
    aaguid: v.optional(v.union(v.null(), v.string())),
    createdAt: v.number(),
  })
    .index('userId', ['userId'])
    .index('credentialID', ['credentialID']),
})

export default schema
