import { createApi } from '@convex-dev/better-auth'
import schema from './schema'
import { createAuthOptions } from '../auth'

/**
 * A SCHEMA-ONLY TABLE IS UNUSED, NOT UNREACHABLE.
 *
 * An earlier version of this comment claimed a table has to exist in both the
 * Convex schema and the Better Auth options to be usable at all. That is
 * wrong, and the difference matters for wordle-teams-wty4.1.7.
 *
 * `createApi` builds every argument validator from the CONVEX SCHEMA ALONE —
 * `v.union(...Object.entries(schema.tables).map(...))`
 * (node_modules/@convex-dev/better-auth/src/client/create-api.ts:69-75). So
 * `adapter.create({ input: { model: 'passkey', ... } })` validates and inserts
 * today; the table is reachable through the raw adapter API. What keeps it
 * inert is that Better Auth only ever CALLS the models its own options
 * declare, and nothing in the auth flow names passkey until the plugin lands.
 *
 * `betterAuthSchema = getAuthTables(createAuthOptions({}))` (create-api.ts:65)
 * gates only `checkUniqueFields`, `listOne` and `paginate` — never
 * construction.
 *
 * THE ASYMMETRY IS THE PART TO REMEMBER: options-only is a hard
 * `ArgumentValidationError` (the model is not in the validator union);
 * schema-only is SILENT.
 *
 * AND THE COROLLARY THAT IS A REAL GAP: a schema-only table gets no uniqueness
 * enforcement, because `isUniqueField` returns `false` for a model it cannot
 * find rather than throwing
 * (node_modules/@convex-dev/better-auth/src/client/adapter-utils.ts:61-74). So
 * `passkey.credentialID` is unprotected by the adapter until wty4.1.7 adds the
 * passkey plugin to `createAuthOptions`.
 *
 * ONE THING TASK 2's SWAP CHANGED WITHOUT RECORDING IT. Passing this app's
 * `createAuthOptions` instead of the package's own `options`
 * (node_modules/@convex-dev/better-auth/src/auth-options.ts) makes
 * `betterAuthSchema` NARROWER AT RUNTIME — two plugins (emailOTP, convex)
 * instead of upstream's twelve — so fewer fields are marked unique and
 * `checkUniqueFields` enforces less than the prebuilt component did. Benign
 * today: the fields this app writes through the adapter (`user.email`,
 * `session.token`) are core Better Auth fields and unique under either options
 * object. But it is a real semantic delta in a task whose premise was "the
 * swap is inert", and it is the reason to re-check uniqueness whenever a
 * plugin is added or removed from `createAuthOptions`.
 */
export const { create, findOne, findMany, updateOne, updateMany, deleteOne, deleteMany } =
  createApi(schema, createAuthOptions)
