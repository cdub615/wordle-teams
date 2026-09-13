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
 * READ THE PASSKEY EXAMPLES BELOW IN THE PAST TENSE. wty4.1.7 has since added
 * `passkey()` to `createAuthOptions`, so that table is no longer schema-only
 * and no longer inert. The example is kept because the RULE it illustrates is
 * general and still true, and because the thing it got wrong when the plugin
 * actually landed (see the corollary) is worth more than the thing it got
 * right.
 *
 * `createApi` builds every argument validator from the CONVEX SCHEMA ALONE —
 * `v.union(...Object.entries(schema.tables).map(...))`
 * (node_modules/@convex-dev/better-auth/src/client/create-api.ts:69-75). So
 * `adapter.create({ input: { model: 'passkey', ... } })` validated and inserted
 * even while nothing in the auth flow named that model: the table was reachable
 * through the raw adapter API the entire time it was called inert. What kept it
 * inert was only that Better Auth CALLS the models its own OPTIONS declare —
 * and that half stopped being true the moment wty4.1.7 added the plugin.
 *
 * `betterAuthSchema = getAuthTables(createAuthOptions({}))` (create-api.ts:65)
 * gates only `checkUniqueFields`, `listOne` and `paginate` — never
 * construction.
 *
 * THE ASYMMETRY IS THE PART TO REMEMBER: options-only is a hard
 * `ArgumentValidationError` (the model is not in the validator union);
 * schema-only is SILENT.
 *
 * AND THE COROLLARY THAT IS A REAL GAP — STILL OPEN, AND NOT FOR THE REASON
 * THIS PARAGRAPH USED TO GIVE (wordle-teams-047w).
 *
 * It said `passkey.credentialID` was unprotected by the adapter "until
 * wty4.1.7 adds the passkey plugin to createAuthOptions". wty4.1.7 has now
 * added it. THE PROTECTION DID NOT ARRIVE, which is the opposite of what that
 * sentence promised, so it is corrected here rather than left for the next
 * person to discover. Measured against @better-auth/passkey 1.6.23:
 *
 *   getAuthTables({ plugins: [emailOTP(...), passkey()] })
 *     passkey.credentialID = { type: 'string', required: true, index: true }
 *     unique fields on the passkey model = []      (control: user.email = true)
 *
 * `isUniqueField` filters on `value.unique`
 * (node_modules/@convex-dev/better-auth/src/client/adapter-utils.ts:61-74) and
 * the plugin declares `index: true`, NOT `unique: true`
 * (node_modules/@better-auth/passkey/dist/index.mjs:648-651). So the model went
 * from "not found, answer false" to "found, answer false": what changed is the
 * REASON, not the outcome.
 *
 * Nor does any other layer close it. Registration calls `adapter.create` with
 * no prior lookup on the field, and authentication resolves a credential with a
 * plain `findOne` on it (dist/index.mjs:368-380, 424-430), so two rows sharing
 * a credentialID would simply resolve to whichever came back first. A Convex
 * index does not constrain. 047w carries the measurement and the options; it is
 * probably not reachable in a normal flow, since an authenticator mints a fresh
 * credential id per registration.
 *
 * ONE THING TASK 2's SWAP CHANGED WITHOUT RECORDING IT. Passing this app's
 * `createAuthOptions` instead of the package's own `options`
 * (node_modules/@convex-dev/better-auth/src/auth-options.ts) makes
 * `betterAuthSchema` NARROWER AT RUNTIME — three plugins (emailOTP, passkey,
 * convex; two until wty4.1.7) instead of upstream's twelve — so fewer fields
 * are marked unique and `checkUniqueFields` enforces less than the prebuilt
 * component did. Benign today: the fields this app writes through the adapter
 * (`user.email`, `session.token`) are core Better Auth fields and unique under
 * either options object — re-measured with the probe above, not assumed. But it
 * is a real semantic delta in a task whose premise was "the swap is inert",
 * and it is the reason to re-check uniqueness whenever a
 * plugin is added or removed from `createAuthOptions`.
 *
 * THAT RE-CHECK IS WHAT FOUND 047w. It is the instruction that earns this
 * paragraph its place, so it stays — and it stays worded as a standing rule
 * rather than as a note about the passkey plugin, because the next plugin will
 * need it too.
 */
export const { create, findOne, findMany, updateOne, updateMany, deleteOne, deleteMany } =
  createApi(schema, createAuthOptions)
