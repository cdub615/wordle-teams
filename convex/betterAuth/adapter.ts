import { createApi } from '@convex-dev/better-auth'
import type { BetterAuthOptions } from 'better-auth'
import schema from './schema'
import { createAuthOptions } from '../auth'

/**
 * THE OPTIONS `createApi` IS BUILT FROM, WITH `passkey.credentialID` MARKED
 * UNIQUE — the fix for wordle-teams-047w, chosen over accepting the gap.
 *
 * WHY PATCH THE OPTIONS RATHER THAN WRAP `create`. `createApi` derives its
 * enforcement from `getAuthTables(createAuthOptions({}))` and then does the
 * work itself: `checkUniqueFields` looks up an index on every unique field of
 * the incoming row and throws if a document already holds that value
 * (node_modules/@convex-dev/better-auth/src/client/adapter-utils.ts:239-275).
 * That machinery is already correct; the only thing missing was the field being
 * marked. Declaring it here reuses the library's own check on all three write
 * paths it guards — `create`, `updateOne` and `updateMany` — where a hand-rolled
 * `findOne` before `create` would have covered one of them and duplicated logic
 * that upstream may change.
 *
 * IT IS A COPY, NOT A MUTATION OF THE PLUGIN. `createAuthOptions` is also what
 * builds the real Better Auth instance (convex/auth.ts) and what
 * betterAuthSchema.test.ts probes; reaching into the imported plugin object
 * would change both of those at a distance. Nothing outside this module sees
 * the patched options.
 *
 * THE INDEX IS WHAT MAKES IT WORK, and its absence is a loud failure rather
 * than a silent one: `checkUniqueFields` throws `No index found for
 * passkeycredentialID` if `./schema.ts` ever loses `.index('credentialID',
 * ['credentialID'])`.
 *
 * ONE SIDE EFFECT, RECORDED BECAUSE IT TOUCHES A READ PATH AND NOT JUST WRITES.
 * `paginate` takes a fast path for an `eq` on a unique field: an indexed lookup
 * ending in `.unique()` (adapter-utils.ts:507-535). So a `findOne` on
 * credentialID — which is how authentication resolves a credential
 * (@better-auth/passkey dist/index.mjs:424-430) — now THROWS if two rows share
 * an id, where before it paginated and returned whichever came back first.
 *
 * That is the better failure and it is the one 047w describes as the bug, but
 * it is a change in behaviour on a live path and only for data that already
 * exists: rows written from here on cannot collide. A deployment that somehow
 * carries a duplicate today would start refusing that credential instead of
 * silently picking a row, which for a passkey means falling back to the OTP
 * sign-in rather than being locked out.
 *
 * DELETE THIS WHEN UPSTREAM FIXES IT. @better-auth/passkey declares the field
 * `index: true`, not `unique: true` (dist/index.mjs:648-651), which reads as a
 * plugin bug rather than a decision. betterAuthSchema.test.ts's tripwire watches
 * for the version that changes it; when that test goes red, this patch is
 * redundant and should go with it.
 */
const withUniqueCredentialId = (ctx: Parameters<typeof createAuthOptions>[0]) => {
  const options = createAuthOptions(ctx)
  return {
    ...options,
    plugins: options.plugins?.map((plugin) => {
      const fields = (plugin as { schema?: { passkey?: { fields?: Record<string, unknown> } } })
        .schema?.passkey?.fields
      // Identified by the field it declares rather than by `plugin.id`: this has
      // to stop being applied if the shape it patches ever moves, and a name
      // match on a plugin whose schema has changed would silently patch nothing
      // while still looking like it had.
      if (!fields?.credentialID) return plugin
      return {
        ...plugin,
        schema: {
          ...(plugin as { schema?: Record<string, unknown> }).schema,
          passkey: {
            ...(plugin as { schema: { passkey: Record<string, unknown> } }).schema.passkey,
            fields: {
              ...fields,
              credentialID: { ...(fields.credentialID as object), unique: true },
            },
          },
        },
      }
    }),
  } as BetterAuthOptions
}

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
 * AND THE COROLLARY THAT WAS A REAL GAP — NOW CLOSED LOCALLY, AND NOT FOR THE
 * REASON THIS PARAGRAPH ORIGINALLY GAVE (wordle-teams-047w). The measurement
 * below is still exactly true of the PLUGIN; what changed is that this module
 * no longer takes the plugin's word for it — see `withUniqueCredentialId` at
 * the top of this file.
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
 * index does not constrain — which is why the fix had to be the options patch
 * and not the `.index('credentialID', ...)` that was already there.
 *
 * 047w WAS CLOSED BY CHOOSING TO ENFORCE RATHER THAN TO DOCUMENT, and the
 * severity is recorded here because it argues the other way and was not what
 * decided it. A duplicate is not something a normal flow produces: an
 * authenticator mints a fresh credential id per registration. Nor is one cheap
 * to arrange, which is worth stating precisely because the obvious worry does
 * not survive reading the plugin — `/passkey/generate-authenticate-options`
 * populates `allowCredentials` only when a SESSION already exists
 * (dist/index.mjs:261-278), so an anonymous caller learns no credential id for
 * any account. What decided it was that the invariant is cheap to make true
 * (one indexed read, on a path that runs at registration only) and that the
 * plan had already believed it was true once.
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
  createApi(schema, withUniqueCredentialId)
