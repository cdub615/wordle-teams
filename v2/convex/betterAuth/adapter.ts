import { createApi } from '@convex-dev/better-auth'
import schema from './schema'
import { createAuthOptions } from '../auth'

/**
 * A TABLE HAS TO EXIST IN BOTH PLACES TO BE USABLE.
 *
 * `createApi` builds the adapter from the Convex schema AND from
 * `getAuthTables(createAuthOptions(...))` (src/client/create-api.ts:61-65).
 * Adding a table to ./schema.ts alone is inert — which is exactly what lets
 * this migration ship the passkey table with no behaviour change, and exactly
 * what wordle-teams-wty4.1.7 has to do the other half of.
 */
export const { create, findOne, findMany, updateOne, updateMany, deleteOne, deleteMany } =
  createApi(schema, createAuthOptions)
