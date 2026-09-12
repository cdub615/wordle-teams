# Avatar Image Upload Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A player can show a face beside their name — seeded from their social sign-in where one exists, uploadable by anyone, visible in team chat and in their own header menu.

**Architecture:** Two optional fields on `players` — `socialImage` (a provider URL, mirrored from Better Auth) and `imageId` (an uploaded file in Convex storage, which always wins). Chat reads them through `api.teams.getMyTeams`, the query it already uses for author names, so no new subscription is added. A new Profile tab in the settings dialog carries the upload control and — closing a real gap — the first ever way to edit your name after onboarding.

**Tech Stack:** Convex (schema, file storage, `convex-test`), Better Auth via `@convex-dev/better-auth`, TanStack Router + Start, React 19, Tailwind v4, shadcn/Radix UI, Vitest (`edge-runtime` default, `jsdom` for `*.hook.test.ts`).

**Spec:** `docs/superpowers/specs/2026-09-12-avatar-image-upload-design.md`
**Issue:** `wordle-teams-wty4.1.1`

---

## Before you start

Everything below runs from `v2/`, not the repository root.

The four quality gates, all of which must pass before the final commit:

```bash
pnpm run test:once && pnpm run lint && pnpm run typecheck && pnpm run build
```

Run them separately, not piped — `zsh` leaves `PIPESTATUS` empty and a piped gate check can report a false green.

Three conventions this codebase enforces that are easy to get wrong:

1. **Component tests are `*.hook.test.ts`, never `.tsx`.** `vitest.config.ts`'s glob is `src/**/*.test.ts`, so elements are built with `createElement` by hand. The file must open with `// @vitest-environment jsdom`.
2. **`ctx.db.system.get('_storage', id)` for file metadata.** `ctx.storage.getMetadata` is deprecated in `convex@1.42`.
3. **This repo comments the *why*.** Match the density of the file you are editing. A bare implementation with no explanation will not look like the surrounding code.

---

## File Structure

**Created**

| File | Responsibility |
|---|---|
| `v2/convex/lib/avatar.ts` | Pure avatar rules: which source wins, whether a sync should run, the size and type limits. No Convex imports beyond types. |
| `v2/convex/lib/avatar.test.ts` | Tests for the above. |
| `v2/src/lib/avatar.ts` | Client-side image handling: centre-crop geometry (pure) and the canvas resize that uses it. |
| `v2/src/lib/avatar.test.ts` | Tests for the geometry. The canvas call is not unit-tested — jsdom has no canvas. |
| `v2/src/components/settings/profile-tab.tsx` | The Profile tab: avatar upload/remove and name editing. |
| `v2/src/components/settings/profile-tab.hook.test.ts` | jsdom tests for the tab. |

**Modified**

| File | Change |
|---|---|
| `v2/convex/schema.ts` | Two optional fields on `players`. |
| `v2/convex/players.ts` | `syncSocialImage`, `generateAvatarUploadUrl`, `setAvatar`, `removeAvatar`, `updateName`; `myName` gains `image`. |
| `v2/convex/teams.ts` | `getMyTeamsFor` resolves and returns `image` per member; its ctx type widens to include `storage`. |
| `v2/convex/teams.test.ts` | Coverage for the new member field. |
| `v2/convex/dashboardBandwidth.test.ts` | Proves the hot query's read count is unchanged for players with no uploaded image. |
| `v2/convex/players.test.ts` | Coverage for the new mutations. |
| `v2/src/components/settings/settings-dialog.tsx` | `SettingsTab` gains `'profile'`; third tab rendered. |
| `v2/src/components/app-menu.tsx` | Menu item opening the Profile tab; own avatar sourced from `myName` rather than Better Auth. |
| `v2/src/components/app-menu.hook.test.ts` | The new menu item. |
| `v2/src/components/chat/message-list.tsx` | Avatar beside the author name on the first message of each run. |
| `v2/src/components/chat/message-list.hook.test.ts` | Created if absent; chat avatar rendering rules. |
| `v2/src/routes/app.tsx` | Triggers `syncSocialImage` on load. |

### One deliberate divergence from the spec

The spec §5 describes the chat avatar as sitting "in a left gutter". **Implement it inline with the author name instead**, on the same line as the existing `row.showsName` label.

Why: `message-list.tsx` renders each row as `flex flex-col` with the separator, the name, the bubble and the delete affordance stacked inside it, and the file carries dense comments about how that alignment works. A gutter means restructuring every row into a two-column layout and re-reasoning all of it. The name label already renders exactly once per run and never over your own messages — which is precisely the rule the avatar needs — so hanging the avatar off it gets the same behaviour for a fraction of the layout risk. Update the spec's §5 wording as part of Task 10.

---

## Task 1: Pure avatar rules (server side)

**Files:**
- Create: `v2/convex/lib/avatar.ts`
- Test: `v2/convex/lib/avatar.test.ts`

- [x] **Step 1: Write the failing test**

```ts
import { describe, expect, test } from 'vitest'
import { MAX_AVATAR_BYTES, isAllowedAvatarType, shouldSyncSocialImage } from './avatar.ts'

describe('shouldSyncSocialImage', () => {
  test('syncs when the provider has an image and the player row has none', () => {
    expect(shouldSyncSocialImage(undefined, 'https://lh3.googleusercontent.com/a')).toEqual({
      action: 'set',
      value: 'https://lh3.googleusercontent.com/a',
    })
  })

  test('syncs when the provider image has changed', () => {
    expect(shouldSyncSocialImage('https://old', 'https://new')).toEqual({
      action: 'set',
      value: 'https://new',
    })
  })

  test('does nothing when they already agree, so the common load writes nothing', () => {
    expect(shouldSyncSocialImage('https://same', 'https://same')).toEqual({ action: 'none' })
  })

  // A revoked provider or an unlinked account. An image the provider no longer
  // serves must not persist on the player row.
  test('CLEARS when the provider no longer has one', () => {
    expect(shouldSyncSocialImage('https://old', null)).toEqual({ action: 'clear' })
  })

  test('does nothing when neither side has one', () => {
    expect(shouldSyncSocialImage(undefined, null)).toEqual({ action: 'none' })
  })
})

describe('isAllowedAvatarType', () => {
  test.each(['image/webp', 'image/png', 'image/jpeg'])('accepts %s', (type) => {
    expect(isAllowedAvatarType(type)).toBe(true)
  })

  test.each(['text/html', 'application/pdf', 'image/svg+xml', null, undefined])(
    'refuses %s',
    (type) => {
      expect(isAllowedAvatarType(type)).toBe(false)
    },
  )
})

test('the byte cap is well clear of a 256px WebP and well under a phone photo', () => {
  expect(MAX_AVATAR_BYTES).toBe(100_000)
})
```

- [x] **Step 2: Run it and watch it fail**

Run: `cd v2 && pnpm exec vitest run convex/lib/avatar.test.ts`
Expected: FAIL — `Failed to resolve import "./avatar.ts"`.

- [x] **Step 3: Implement**

```ts
/**
 * The avatar rules that are pure, kept out of the mutations so they can be
 * tested at all.
 *
 * WHY THIS MODULE EXISTS RATHER THAN INLINE LOGIC: syncSocialImage reads the
 * authenticated Better Auth user, and convex-test cannot stand up a Better Auth
 * session (wordle-teams-bya), so a mutation body that decides anything is a
 * mutation body no test can reach (wordle-teams-obw). Everything that decides
 * lives here; the mutation is a shell.
 */

/**
 * The hard ceiling setAvatar enforces server-side, in bytes.
 *
 * THE CLIENT ALREADY RESIZES TO 256px WebP, which lands at 8-20 KB — so this is
 * not the normal path's constraint, it is the guard against a client that did
 * not resize. A Convex upload URL accepts whatever is POSTed to it, so without
 * this a broken or hostile client puts a 12MP original in storage and every
 * byte of it back on the wire.
 */
export const MAX_AVATAR_BYTES = 100_000

/** The square edge the client crops and scales to. */
export const AVATAR_SIZE = 256

/**
 * SVG IS EXCLUDED DELIBERATELY and is the reason this is an allow-list rather
 * than a `startsWith('image/')` check. An SVG is a document: it can carry
 * script, and these files are served from a URL that Convex's own docs say
 * anyone holding it can fetch without authentication. The three raster types
 * below are what the client's canvas resize can produce anyway.
 */
const ALLOWED_AVATAR_TYPES = ['image/webp', 'image/png', 'image/jpeg']

export function isAllowedAvatarType(contentType: string | null | undefined): boolean {
  return contentType !== null && contentType !== undefined && ALLOWED_AVATAR_TYPES.includes(contentType)
}

/** What a sync should do to `players.socialImage`, given both sides. */
export type SocialImageSync = { action: 'none' } | { action: 'clear' } | { action: 'set'; value: string }

/**
 * Whether the player row's mirrored social image needs updating.
 *
 * `action: 'none'` IS THE COMMON CASE AND IT MATTERS. This runs on app load, so
 * anything other than "usually writes nothing" would put a mutation on every
 * page view.
 */
export function shouldSyncSocialImage(
  current: string | undefined,
  incoming: string | null | undefined,
): SocialImageSync {
  const next = incoming ?? null
  if (next === null) return current === undefined ? { action: 'none' } : { action: 'clear' }
  if (current === next) return { action: 'none' }
  return { action: 'set', value: next }
}
```

- [x] **Step 4: Run it and watch it pass**

Run: `cd v2 && pnpm exec vitest run convex/lib/avatar.test.ts`
Expected: PASS, 11 tests.

- [x] **Step 5: Commit**

```bash
cd v2 && git add convex/lib/avatar.ts convex/lib/avatar.test.ts
git commit -m "feat(avatar): the pure avatar rules — source precedence, sync and limits"
```

---

## Task 2: Schema fields

**Files:**
- Modify: `v2/convex/schema.ts` (the `players` table)

- [x] **Step 1: Add the fields**

Add immediately after `email` in the `players` table:

```ts
    /**
     * THE PROVIDER'S OWN URL, mirrored from Better Auth's `user.image` by
     * players.syncSocialImage. Never bytes we host: this is
     * lh3.googleusercontent.com, and the browser fetches it from Google, which
     * is why the social path costs this deployment nothing at all.
     *
     * MIRRORED RATHER THAN JOINED because chat has to show OTHER players'
     * avatars, and another player's Better Auth user record is reachable only
     * from their own session. The mirror is what makes it readable here.
     */
    socialImage: v.optional(v.string()),

    /**
     * AN UPLOADED AVATAR, AND IT ALWAYS WINS OVER socialImage.
     *
     * TWO FIELDS RATHER THAN ONE, AND THIS IS LOAD-BEARING.
     * `overrideUserInfoOnSignIn: true` (auth.ts, wordle-teams-wdp1) rewrites
     * `user.image` on EVERY social sign-in. Collapsing these into a single URL
     * column would mean the next Google sign-in silently overwrites an avatar
     * the player deliberately uploaded. Do not "simplify" this pair.
     */
    imageId: v.optional(v.id('_storage')),
```

- [x] **Step 2: Verify the schema still typechecks**

Run: `cd v2 && pnpm run typecheck`
Expected: PASS. Both fields are optional, so the push validates against every existing document — the narrowing hazard `schema.ts` documents for `firstName` does not apply here.

- [x] **Step 3: Commit**

```bash
cd v2 && git add convex/schema.ts
git commit -m "feat(avatar): socialImage and imageId on players"
```

---

## Task 3: Resolve an avatar onto the team roster

**Files:**
- Modify: `v2/convex/teams.ts` (`ReaderCtx`, `getMyTeamsFor`)
- Test: `v2/convex/teams.test.ts`

- [x] **Step 1: Write the failing tests**

Append to `v2/convex/teams.test.ts`:

```ts
describe('getMyTeamsFor avatars', () => {
  test('a member with neither image resolves to null', async () => {
    const t = convexTest(schema, modules)
    await t.run(async (ctx) => {
      const ada = await ctx.db.insert('players', aPlayer())
      await ctx.db.insert('teams', aTeam({ playerIds: [ada] }))
      const [team] = await getMyTeamsFor(ctx, ada)
      expect(team.members[0].image).toBeNull()
    })
  })

  test('a member with only a social image resolves to that URL', async () => {
    const t = convexTest(schema, modules)
    await t.run(async (ctx) => {
      const ada = await ctx.db.insert('players', aPlayer({ socialImage: 'https://lh3/a' }))
      await ctx.db.insert('teams', aTeam({ playerIds: [ada] }))
      const [team] = await getMyTeamsFor(ctx, ada)
      expect(team.members[0].image).toBe('https://lh3/a')
    })
  })

  // The precedence that makes the two-field design worth having.
  test('an uploaded image WINS over a social image', async () => {
    const t = convexTest(schema, modules)
    await t.run(async (ctx) => {
      const imageId = await ctx.storage.store(new Blob(['x'], { type: 'image/webp' }))
      const ada = await ctx.db.insert('players', aPlayer({ socialImage: 'https://lh3/a', imageId }))
      await ctx.db.insert('teams', aTeam({ playerIds: [ada] }))
      const [team] = await getMyTeamsFor(ctx, ada)
      expect(team.members[0].image).not.toBe('https://lh3/a')
      expect(typeof team.members[0].image).toBe('string')
    })
  })
})
```

Do not assert the resolved URL *contains* the storage id — its shape is Convex's to
change, and a test that pins it is testing their URL format rather than this
precedence rule.

- [x] **Step 2: Run them and watch them fail**

Run: `cd v2 && pnpm exec vitest run convex/teams.test.ts -t avatars`
Expected: FAIL — `image` is not a property of the member objects, and `ctx` has no `storage` on the `getMyTeamsFor` signature.

- [x] **Step 3: Widen the ctx type**

In `v2/convex/teams.ts`, replace:

```ts
type ReaderCtx = { db: GenericDatabaseReader<DataModel> }
```

with:

```ts
/**
 * `storage` JOINED `db` HERE FOR THE AVATARS (wordle-teams-wty4.1.1). Resolving
 * an uploaded image to a URL is a storage read, so the roster cannot be built
 * from `db` alone any more. Every caller is a Convex query or mutation ctx,
 * both of which carry it.
 */
type ReaderCtx = { db: GenericDatabaseReader<DataModel>; storage: StorageReader }
```

Add `StorageReader` to the existing `convex/server` type import.

- [x] **Step 4: Resolve the image per member**

In `getMyTeamsFor`, replace the member mapping's return with:

```ts
          if (!member) return null
          return {
            id: member._id,
            firstName: member.firstName,
            lastName: member.lastName,
            /**
             * ONLY A STORAGE READ WHEN THERE IS SOMETHING TO READ, and that
             * conditional is the whole bandwidth story of this feature.
             *
             * This function is the hot one — dashboardBandwidth.test.ts pins it
             * at 54 documents at the six-by-eight ceiling, and wordle-teams-dcu
             * is about exactly this query. An unconditional getUrl would add up
             * to 54 system reads to every dashboard load. `socialImage` is a
             * plain string already on the document we just read, so the common
             * case — and every case for a player who has never uploaded —
             * costs nothing at all.
             */
            image: member.imageId
              ? await ctx.storage.getUrl(member.imageId)
              : (member.socialImage ?? null),
          }
```

- [x] **Step 5: Run the tests and watch them pass**

Run: `cd v2 && pnpm exec vitest run convex/teams.test.ts`
Expected: PASS, including the three new tests and all pre-existing ones.

- [x] **Step 6: Pin the bandwidth guarantee**

Append to `v2/convex/dashboardBandwidth.test.ts`, inside the existing
`describe('getMyTeamsFor — the enumeration every authenticated session holds', ...)`:

```ts
  /**
   * AVATARS ADD NOTHING FOR A PLAYER WHO HAS NOT UPLOADED ONE, which is the
   * guarantee wordle-teams-wty4.1.1 was allowed to ship on. `socialImage` rides
   * along on a player document this query already reads; only `imageId` costs a
   * storage read, and the resolution in teams.ts is conditional on it.
   *
   * If this number ever moves, the conditional has been removed and every
   * dashboard load is paying up to 54 extra reads.
   */
  test(`still costs exactly ${ENUMERATION_READS} documents once avatars resolve`, async () => {
    await withReadLimit(ENUMERATION_READS).run(async (ctx) => {
      const { me } = await seedTeams(ctx, CEILING_TEAMS, CEILING_MEMBERS)
      const teams = await getMyTeamsFor(ctx, me)
      expect(teams[0].members[0]).toHaveProperty('image', null)
    })
  })
```

- [x] **Step 7: Run the bandwidth suite**

Run: `cd v2 && pnpm exec vitest run convex/dashboardBandwidth.test.ts`
Expected: PASS. If the new test fails at 54, the conditional in Step 4 is wrong — fix the conditional, do not raise the constant.

- [x] **Step 8: Commit**

```bash
cd v2 && git add convex/teams.ts convex/teams.test.ts convex/dashboardBandwidth.test.ts
git commit -m "feat(avatar): resolve a member's avatar onto the team roster"
```

---

## Task 4: The social image sync

**Files:**
- Modify: `v2/convex/players.ts`
- Test: `v2/convex/players.test.ts`

- [x] **Step 1: Write the failing test**

Append to `v2/convex/players.test.ts`:

```ts
describe('applySocialImageSync', () => {
  test('sets the mirrored URL on the player row', async () => {
    const t = convexTest(schema, modules)
    await t.run(async (ctx) => {
      const ada = await ctx.db.insert('players', aPlayer())
      await applySocialImageSync(ctx, ada, 'https://lh3/a')
      expect((await ctx.db.get(ada))?.socialImage).toBe('https://lh3/a')
    })
  })

  test('clears it when the provider no longer has one', async () => {
    const t = convexTest(schema, modules)
    await t.run(async (ctx) => {
      const ada = await ctx.db.insert('players', aPlayer({ socialImage: 'https://lh3/a' }))
      await applySocialImageSync(ctx, ada, null)
      expect((await ctx.db.get(ada))?.socialImage).toBeUndefined()
    })
  })

  // An uploaded avatar is the player's own decision and a provider must never
  // undo it. This is the assertion that makes the two-field design necessary.
  test('LEAVES AN UPLOADED AVATAR ALONE', async () => {
    const t = convexTest(schema, modules)
    await t.run(async (ctx) => {
      const imageId = await ctx.storage.store(new Blob(['x'], { type: 'image/webp' }))
      const ada = await ctx.db.insert('players', aPlayer({ imageId }))
      await applySocialImageSync(ctx, ada, 'https://lh3/a')
      const row = await ctx.db.get(ada)
      expect(row?.imageId).toBe(imageId)
      expect(row?.socialImage).toBe('https://lh3/a')
    })
  })
})
```

- [x] **Step 2: Run it and watch it fail**

Run: `cd v2 && pnpm exec vitest run convex/players.test.ts -t applySocialImageSync`
Expected: FAIL — `applySocialImageSync` is not exported.

- [x] **Step 3: Implement the helper and its mutation**

Add to `v2/convex/players.ts`, importing `shouldSyncSocialImage` from `./lib/avatar.ts`:

```ts
/**
 * Applies the mirror decision to one player row. Exported for its tests: the
 * mutation below reads the Better Auth user, which convex-test cannot stand up
 * (wordle-teams-bya), so the wrapper's body is unreachable there and everything
 * worth asserting has to live in a function that is not the wrapper.
 */
export async function applySocialImageSync(
  ctx: WriterCtx,
  playerId: Id<'players'>,
  incoming: string | null | undefined,
) {
  const player = await ctx.db.get(playerId)
  if (!player) return
  const decision = shouldSyncSocialImage(player.socialImage, incoming)
  if (decision.action === 'none') return
  await ctx.db.patch(playerId, {
    socialImage: decision.action === 'clear' ? undefined : decision.value,
  })
}

/**
 * Mirrors the caller's OWN Better Auth profile image onto their player row.
 *
 * TAKES NO ARGUMENTS, AND THAT IS THE SECURITY PROPERTY RATHER THAN A STYLE
 * CHOICE. The value comes from the authenticated user server-side. A
 * client-supplied URL here would let anybody point their teammate-visible
 * avatar at any URL on the internet.
 *
 * ONLY EVER YOUR OWN. Another player's Better Auth record is reachable only
 * from their own session, so a teammate's Google photo appears in chat when
 * THEY next open the app, not when you do. Chat therefore fills in with faces
 * over the days after launch rather than all at once. Accepted, not overlooked.
 *
 * SILENT ON FAILURE at the call site: this is a convenience, and a failed sync
 * costs initials until the next load.
 */
export const syncSocialImage = mutation({
  args: {},
  handler: async (ctx) => {
    const player = await currentPlayer(ctx)
    if (!player) return
    const user = await authComponent.getAuthUser(ctx)
    await applySocialImageSync(ctx, player._id, user?.image ?? null)
  },
})
```

- [x] **Step 4: Run the tests and watch them pass**

Run: `cd v2 && pnpm exec vitest run convex/players.test.ts`
Expected: PASS, including the three new tests.

- [x] **Step 5: Commit**

```bash
cd v2 && git add convex/players.ts convex/players.test.ts
git commit -m "feat(avatar): mirror the social profile image onto the player row"
```

---

## Task 5: Upload, replace and remove

**Files:**
- Modify: `v2/convex/players.ts`
- Test: `v2/convex/players.test.ts`

- [x] **Step 1: Write the failing tests**

Append to `v2/convex/players.test.ts`, adding `MAX_AVATAR_BYTES` to its imports from
`./lib/avatar.ts` and `setAvatarFor`/`removeAvatarFor` to its imports from `./players.ts`:

```ts
describe('setAvatarFor', () => {
  test('stores the image on the player row', async () => {
    const t = convexTest(schema, modules)
    await t.run(async (ctx) => {
      const ada = await ctx.db.insert('players', aPlayer())
      const imageId = await ctx.storage.store(new Blob(['tiny'], { type: 'image/webp' }))
      await setAvatarFor(ctx, ada, imageId)
      expect((await ctx.db.get(ada))?.imageId).toBe(imageId)
    })
  })

  // Orphans are the reason this is a mutation and not a patch:
  // wordle-teams-31a is already about storage that grows without bound.
  test('DELETES THE SUPERSEDED IMAGE when replacing one', async () => {
    const t = convexTest(schema, modules)
    await t.run(async (ctx) => {
      const ada = await ctx.db.insert('players', aPlayer())
      const first = await ctx.storage.store(new Blob(['one'], { type: 'image/webp' }))
      const second = await ctx.storage.store(new Blob(['two'], { type: 'image/webp' }))
      await setAvatarFor(ctx, ada, first)
      await setAvatarFor(ctx, ada, second)
      expect((await ctx.db.get(ada))?.imageId).toBe(second)
      expect(await ctx.db.system.get('_storage', first)).toBeNull()
    })
  })

  // The client resizes, but a Convex upload URL accepts whatever is POSTed.
  test('REFUSES an image over the byte cap, and leaves no orphan behind', async () => {
    const t = convexTest(schema, modules)
    await t.run(async (ctx) => {
      const ada = await ctx.db.insert('players', aPlayer())
      const huge = await ctx.storage.store(
        new Blob([new Uint8Array(MAX_AVATAR_BYTES + 1)], { type: 'image/webp' }),
      )
      await expect(setAvatarFor(ctx, ada, huge)).rejects.toThrow()
      expect((await ctx.db.get(ada))?.imageId).toBeUndefined()
      expect(await ctx.db.system.get('_storage', huge)).toBeNull()
    })
  })

  test('REFUSES a non-image type, and leaves no orphan behind', async () => {
    const t = convexTest(schema, modules)
    await t.run(async (ctx) => {
      const ada = await ctx.db.insert('players', aPlayer())
      const html = await ctx.storage.store(new Blob(['<script>'], { type: 'text/html' }))
      await expect(setAvatarFor(ctx, ada, html)).rejects.toThrow()
      expect((await ctx.db.get(ada))?.imageId).toBeUndefined()
      expect(await ctx.db.system.get('_storage', html)).toBeNull()
    })
  })
})

describe('removeAvatarFor', () => {
  test('deletes the file and falls back to the social image', async () => {
    const t = convexTest(schema, modules)
    await t.run(async (ctx) => {
      const imageId = await ctx.storage.store(new Blob(['x'], { type: 'image/webp' }))
      const ada = await ctx.db.insert('players', aPlayer({ socialImage: 'https://lh3/a', imageId }))
      await removeAvatarFor(ctx, ada)
      const row = await ctx.db.get(ada)
      expect(row?.imageId).toBeUndefined()
      expect(row?.socialImage).toBe('https://lh3/a')
      expect(await ctx.db.system.get('_storage', imageId)).toBeNull()
    })
  })

  test('is a no-op for a player who never uploaded one', async () => {
    const t = convexTest(schema, modules)
    await t.run(async (ctx) => {
      const ada = await ctx.db.insert('players', aPlayer())
      await expect(removeAvatarFor(ctx, ada)).resolves.toBeUndefined()
    })
  })
})
```

- [x] **Step 2: Run them and watch them fail**

Run: `cd v2 && pnpm exec vitest run convex/players.test.ts -t Avatar`
Expected: FAIL — `setAvatarFor` and `removeAvatarFor` are not exported.

- [x] **Step 3: Implement**

Add to `v2/convex/players.ts`, importing `MAX_AVATAR_BYTES` and `isAllowedAvatarType` from `./lib/avatar.ts`:

```ts
/**
 * Attaches an uploaded file to a player as their avatar.
 *
 * VALIDATES SERVER-SIDE, WHICH IS THE POINT OF THIS FUNCTION. The client
 * resizes to a 256px WebP before it uploads, but `generateAvatarUploadUrl`
 * hands out a URL that accepts whatever is POSTed to it — so the resize is a
 * courtesy to the player's connection, not a constraint on what lands in
 * storage. Without the two checks below, one broken client puts a 12MP original
 * in the bucket and on every teammate's wire.
 *
 * REJECTION DELETES THE FILE. A refused upload that stayed in storage would be
 * an orphan nothing references and nothing will ever clean up — and a free way
 * for anybody with an account to fill the bucket.
 *
 * `ctx.db.system.get('_storage', id)` rather than `ctx.storage.getMetadata`,
 * which is deprecated in convex@1.42.
 */
export async function setAvatarFor(ctx: WriterCtx, playerId: Id<'players'>, storageId: Id<'_storage'>) {
  const metadata = await ctx.db.system.get('_storage', storageId)
  if (!metadata || !isAllowedAvatarType(metadata.contentType) || metadata.size > MAX_AVATAR_BYTES) {
    await ctx.storage.delete(storageId)
    throw accessError('INVALID_AVATAR')
  }

  const player = await ctx.db.get(playerId)
  if (!player) throw accessError('NO_PLAYER')

  await ctx.db.patch(playerId, { imageId: storageId })
  // AFTER the patch, so a failure here cannot leave the row pointing at a file
  // that no longer exists.
  if (player.imageId) await ctx.storage.delete(player.imageId)
}

/**
 * Drops the uploaded avatar. `socialImage` is deliberately untouched, so
 * removing an upload reveals the provider's image again rather than falling all
 * the way to initials — which is what "remove" means to someone who never chose
 * the social one in the first place.
 */
export async function removeAvatarFor(ctx: WriterCtx, playerId: Id<'players'>) {
  const player = await ctx.db.get(playerId)
  if (!player?.imageId) return
  await ctx.db.patch(playerId, { imageId: undefined })
  await ctx.storage.delete(player.imageId)
}

/**
 * A one-shot URL the client POSTs the resized blob to. Authenticated, so an
 * anonymous visitor cannot obtain one and use this deployment's storage.
 */
export const generateAvatarUploadUrl = mutation({
  args: {},
  handler: async (ctx) => {
    await requirePlayer(ctx)
    return await ctx.storage.generateUploadUrl()
  },
})

export const setAvatar = mutation({
  args: { storageId: v.id('_storage') },
  handler: async (ctx, args) => {
    const player = await requirePlayer(ctx)
    await setAvatarFor(ctx, player._id, args.storageId)
  },
})

export const removeAvatar = mutation({
  args: {},
  handler: async (ctx) => {
    const player = await requirePlayer(ctx)
    await removeAvatarFor(ctx, player._id)
  },
})
```

Add `requirePlayer` to the existing `./access` import. Add `'INVALID_AVATAR'` to whatever union `accessError` accepts — follow the existing codes in `convex/access.ts`, and give it a user-facing message in the same place the other codes get theirs.

- [x] **Step 4: Run the tests and watch them pass**

Run: `cd v2 && pnpm exec vitest run convex/players.test.ts`
Expected: PASS, including the six new tests.

- [x] **Step 5: Commit**

```bash
cd v2 && git add convex/players.ts convex/players.test.ts convex/access.ts
git commit -m "feat(avatar): upload, replace and remove, validated server-side"
```

---

## Task 6: Name editing, and the caller's own avatar

**Files:**
- Modify: `v2/convex/players.ts`
- Test: `v2/convex/players.test.ts`

- [x] **Step 1: Write the failing tests**

Append to `v2/convex/players.test.ts`:

```ts
describe('updateNameFor', () => {
  test('renames the player', async () => {
    const t = convexTest(schema, modules)
    await t.run(async (ctx) => {
      const ada = await ctx.db.insert('players', aPlayer())
      await updateNameFor(ctx, ada, 'Grace', 'Hopper')
      const row = await ctx.db.get(ada)
      expect(row?.firstName).toBe('Grace')
      expect(row?.lastName).toBe('Hopper')
    })
  })

  test('trims', async () => {
    const t = convexTest(schema, modules)
    await t.run(async (ctx) => {
      const ada = await ctx.db.insert('players', aPlayer())
      await updateNameFor(ctx, ada, '  Grace  ', '  Hopper  ')
      expect((await ctx.db.get(ada))?.firstName).toBe('Grace')
    })
  })

  /**
   * THE GUARD THAT MATTERS. schema.ts is emphatic: an empty name pair reaches
   * the scoreboard, the team card AND the winner computation, where it can win
   * a month. completeProfile refuses one at players.ts:146 and so must this —
   * one opinion about what a good name is, not two.
   */
  test.each([
    ['', 'Hopper'],
    ['Grace', ''],
    ['   ', 'Hopper'],
  ])('REFUSES the pair (%s, %s) and leaves the old name', async (first, last) => {
    const t = convexTest(schema, modules)
    await t.run(async (ctx) => {
      const ada = await ctx.db.insert('players', aPlayer())
      await expect(updateNameFor(ctx, ada, first, last)).rejects.toThrow()
      expect((await ctx.db.get(ada))?.firstName).toBe('Ada')
    })
  })
})
```

- [x] **Step 2: Run them and watch them fail**

Run: `cd v2 && pnpm exec vitest run convex/players.test.ts -t updateNameFor`
Expected: FAIL — `updateNameFor` is not exported.

- [x] **Step 3: Implement**

```ts
/**
 * Renames a player. THE FIRST WAY TO CHANGE A NAME AFTER ONBOARDING — before
 * this, completeProfile was the only writer outside the migration and it runs
 * once, gated by needsProfile, so a name typed wrong at signup was permanent
 * and visible on the scoreboard forever.
 *
 * SHARES completeProfile's GUARD RATHER THAN RESTATING IT. isCompleteName
 * (lib/invite.ts) is the single opinion about what a good name is; a second
 * opinion here is how v1 ended up saving names its own redirect guard then
 * refused to accept.
 */
export async function updateNameFor(
  ctx: WriterCtx,
  playerId: Id<'players'>,
  firstName: string,
  lastName: string,
) {
  if (!isCompleteName(firstName, lastName)) throw accessError('INCOMPLETE_NAME')
  await ctx.db.patch(playerId, { firstName: firstName.trim(), lastName: lastName.trim() })
}

export const updateName = mutation({
  args: { firstName: v.string(), lastName: v.string() },
  handler: async (ctx, args) => {
    const player = await requirePlayer(ctx)
    await updateNameFor(ctx, player._id, args.firstName, args.lastName)
  },
})
```

Reuse the existing error code `completeProfileFor` throws for an incomplete name rather than inventing `INCOMPLETE_NAME` if one already exists — check `convex/players.ts:146` and match it.

- [x] **Step 4: Extend `myName` with the caller's own avatar**

Replace the `myName` handler's return:

```ts
    return {
      firstName: player.firstName,
      lastName: player.lastName,
      /**
       * THE HEADER'S AVATAR CAME FROM BETTER AUTH'S `user.image` UNTIL NOW, and
       * that is why an OTP account could never have one — nothing in v2 ever
       * wrote that field. It resolves from the player row here instead, by the
       * same precedence every other surface uses.
       *
       * ADDED TO THIS QUERY RATHER THAN A NEW ONE: the header already subscribes
       * to it for the initials and the label, and a second query on every
       * authenticated page load to paint one more thing in the same corner would
       * cost more than the field does. The doc comment above about "deliberately
       * just these two fields" is superseded by this.
       */
      image: player.imageId
        ? await ctx.storage.getUrl(player.imageId)
        : (player.socialImage ?? null),
      /**
       * WHETHER THERE IS AN UPLOAD TO REMOVE, which is NOT the same question as
       * whether there is an image. The Profile tab's "Remove picture" must not
       * appear for a Google user who has never uploaded anything — removing
       * their provider's photo is not something this app can do.
       */
      hasUpload: player.imageId !== undefined,
    }
```

- [x] **Step 5: Run the full convex suite**

Run: `cd v2 && pnpm exec vitest run convex/`
Expected: PASS.

- [x] **Step 6: Commit**

```bash
cd v2 && git add convex/players.ts convex/players.test.ts
git commit -m "feat(avatar): name editing, and the caller's own resolved avatar"
```

---

## Task 7: Client-side resize

**Files:**
- Create: `v2/src/lib/avatar.ts`, `v2/src/lib/avatar.test.ts`

- [x] **Step 1: Write the failing test**

```ts
import { describe, expect, test } from 'vitest'
import { cropRectFor } from './avatar.ts'

describe('cropRectFor', () => {
  test('a square image is taken whole', () => {
    expect(cropRectFor(400, 400)).toEqual({ sx: 0, sy: 0, side: 400 })
  })

  test('a landscape image is cropped to its centre column', () => {
    expect(cropRectFor(800, 400)).toEqual({ sx: 200, sy: 0, side: 400 })
  })

  test('a portrait image is cropped to its centre row', () => {
    expect(cropRectFor(400, 800)).toEqual({ sx: 0, sy: 200, side: 400 })
  })

  // An odd remainder must not produce a fractional source rect: drawImage
  // accepts one, but the half-pixel shows as a soft edge at 256px.
  test('an odd offset is floored rather than left fractional', () => {
    expect(cropRectFor(401, 400)).toEqual({ sx: 0, sy: 0, side: 400 })
    expect(cropRectFor(403, 400)).toEqual({ sx: 1, sy: 0, side: 400 })
  })
})
```

- [x] **Step 2: Run it and watch it fail**

Run: `cd v2 && pnpm exec vitest run src/lib/avatar.test.ts`
Expected: FAIL — cannot resolve `./avatar.ts`.

- [x] **Step 3: Implement**

```ts
import { AVATAR_SIZE } from '../../convex/lib/avatar.ts'

/**
 * The square source rectangle to take from an image of these dimensions —
 * the largest centred square that fits.
 *
 * SPLIT OUT FROM THE CANVAS CALL DELIBERATELY. jsdom has no canvas, so
 * resizeToSquare below cannot be unit-tested at all; the arithmetic that can
 * actually be wrong lives here, where it runs in the suite's default
 * edge-runtime.
 */
export function cropRectFor(width: number, height: number): { sx: number; sy: number; side: number } {
  const side = Math.min(width, height)
  return {
    sx: Math.floor((width - side) / 2),
    sy: Math.floor((height - side) / 2),
    side,
  }
}

/**
 * A centre-cropped, AVATAR_SIZE-square WebP of the chosen file.
 *
 * NO CROP UI, WHICH IS A DECISION AND NOT AN OMISSION (spec §"No cropper"): the
 * result is shown at 32px in the header and ~24px in chat, where nobody can see
 * where the crop landed.
 *
 * THE SERVER DOES NOT TRUST ANY OF THIS. players.setAvatar re-checks the type
 * and the byte count, because this function runs on the player's machine and
 * the upload URL accepts whatever is sent to it.
 */
export async function resizeToSquare(file: File | Blob): Promise<Blob> {
  const bitmap = await createImageBitmap(file)
  try {
    const { sx, sy, side } = cropRectFor(bitmap.width, bitmap.height)
    const canvas = document.createElement('canvas')
    canvas.width = AVATAR_SIZE
    canvas.height = AVATAR_SIZE
    const context = canvas.getContext('2d')
    if (!context) throw new Error('Could not read this image.')
    context.drawImage(bitmap, sx, sy, side, side, 0, 0, AVATAR_SIZE, AVATAR_SIZE)
    const blob = await new Promise<Blob | null>((resolve) =>
      canvas.toBlob(resolve, 'image/webp', 0.85),
    )
    if (!blob) throw new Error('Could not read this image.')
    return blob
  } finally {
    // Frees the decoded bitmap rather than waiting for GC — a 12MP source is
    // tens of megabytes of memory on a phone.
    bitmap.close()
  }
}
```

- [x] **Step 4: Run it and watch it pass**

Run: `cd v2 && pnpm exec vitest run src/lib/avatar.test.ts`
Expected: PASS, 4 tests.

- [x] **Step 5: Commit**

```bash
cd v2 && git add src/lib/avatar.ts src/lib/avatar.test.ts
git commit -m "feat(avatar): client-side centre-crop and resize"
```

---

## Task 8: The Profile tab

**Files:**
- Create: `v2/src/components/settings/profile-tab.tsx`, `v2/src/components/settings/profile-tab.hook.test.ts`

- [x] **Step 1: Write the component**

```tsx
import { convexQuery, useConvexMutation } from '@convex-dev/react-query'
import { useMutation, useQuery } from '@tanstack/react-query'
import { Loader2 } from 'lucide-react'
import { useRef, useState } from 'react'
import { toast } from 'sonner'
import { api } from '../../../convex/_generated/api'
import { isCompleteName } from '../../../convex/lib/invite.ts'
import { Avatar, AvatarFallback, AvatarImage } from '#/components/ui/avatar.tsx'
import { Button } from '#/components/ui/button.tsx'
import { Input } from '#/components/ui/input.tsx'
import { Label } from '#/components/ui/label.tsx'
import { Separator } from '#/components/ui/separator.tsx'
import { resizeToSquare } from '#/lib/avatar.ts'
import { mutationErrorMessage } from '#/lib/convex-error.ts'
import { initialsFor } from '#/lib/initials.ts'

/**
 * Identity: the picture and the name, the two things that appear side by side
 * everywhere this app shows a person.
 *
 * THE NAME EDITOR IS NOT PADDING FOR THE TAB. completeProfile is the only other
 * writer of firstName/lastName and it runs exactly once, gated by needsProfile —
 * so before this there was NO way to fix a name typed wrong at signup, and it
 * shows on the scoreboard forever.
 *
 * NO BRAND RING HERE. The rotating gradient in app-menu.tsx is that avatar's
 * decoration; this is a form control and a spinning halo around a file picker
 * would read as a status indicator.
 */
export default function ProfileTab() {
  const { data: me } = useQuery(convexQuery(api.players.myName, {}))
  const fileRef = useRef<HTMLInputElement>(null)
  const [uploading, setUploading] = useState(false)

  const generateUploadUrl = useConvexMutation(api.players.generateAvatarUploadUrl)
  const setAvatar = useMutation({ mutationFn: useConvexMutation(api.players.setAvatar) })
  const removeAvatar = useMutation({ mutationFn: useConvexMutation(api.players.removeAvatar) })
  const updateName = useMutation({ mutationFn: useConvexMutation(api.players.updateName) })

  const [firstName, setFirstName] = useState<string | null>(null)
  const [lastName, setLastName] = useState<string | null>(null)
  // `?? me` rather than seeding state in an effect: the query resolves after
  // first paint, and an effect-seeded field flickers empty on a cold load.
  const first = firstName ?? me?.firstName ?? ''
  const last = lastName ?? me?.lastName ?? ''

  /**
   * Resize, upload, attach. THREE STEPS AND THE MIDDLE ONE IS A PLAIN `fetch` —
   * Convex hands out a one-shot URL and the bytes go straight to it rather than
   * through a mutation argument.
   */
  const onPick = async (file: File) => {
    setUploading(true)
    try {
      const blob = await resizeToSquare(file)
      const url = await generateUploadUrl({})
      const response = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': blob.type },
        body: blob,
      })
      if (!response.ok) throw new Error('Upload failed')
      const { storageId } = (await response.json()) as { storageId: string }
      await setAvatar.mutateAsync({ storageId })
      toast.success('Picture updated')
    } catch (error) {
      toast.error(mutationErrorMessage(error, 'Could not update your picture.'))
    } finally {
      setUploading(false)
      // So picking the SAME file twice fires `change` the second time.
      if (fileRef.current) fileRef.current.value = ''
    }
  }

  const onRemove = async () => {
    try {
      await removeAvatar.mutateAsync({})
      toast.success('Picture removed')
    } catch (error) {
      toast.error(mutationErrorMessage(error, 'Could not remove your picture.'))
    }
  }

  const onSaveName = async () => {
    try {
      await updateName.mutateAsync({ firstName: first, lastName: last })
      toast.success('Name updated')
    } catch (error) {
      toast.error(mutationErrorMessage(error, 'Could not update your name.'))
    }
  }

  return (
    <div className="flex flex-col gap-4 pt-2">
      <h3 className="text-sm font-medium">Picture</h3>
      <div className="flex items-center gap-4">
        <Avatar className="h-16 w-16">
          {me?.image ? <AvatarImage src={me.image} alt="" aria-hidden="true" /> : null}
          <AvatarFallback className="text-lg font-medium">
            {initialsFor(me?.firstName ?? '', me?.lastName ?? '')}
          </AvatarFallback>
        </Avatar>
        <div className="flex flex-col gap-2">
          <input
            ref={fileRef}
            type="file"
            accept="image/png,image/jpeg,image/webp"
            className="hidden"
            data-testid="avatar-file"
            onChange={(event) => {
              const file = event.target.files?.[0]
              if (file) void onPick(file)
            }}
          />
          <Button
            type="button"
            variant="outline"
            disabled={uploading}
            onClick={() => fileRef.current?.click()}
          >
            {uploading ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : null}
            Change picture
          </Button>
          {/* Only offered when there is an upload to drop. Removing a social
              image is not a thing this app can do — it belongs to the provider. */}
          {me?.image ? (
            <Button
              type="button"
              variant="ghost"
              disabled={removeAvatar.isPending}
              onClick={() => void onRemove()}
            >
              Remove picture
            </Button>
          ) : null}
        </div>
      </div>

      <Separator />

      <h3 className="text-sm font-medium">Name</h3>
      <div className="flex flex-col gap-2">
        <Label htmlFor="profile-first-name">First name</Label>
        <Input
          id="profile-first-name"
          value={first}
          onChange={(event) => setFirstName(event.target.value)}
        />
        <Label htmlFor="profile-last-name">Last name</Label>
        <Input
          id="profile-last-name"
          value={last}
          onChange={(event) => setLastName(event.target.value)}
        />
        {/*
          DISABLED BY THE SERVER'S OWN PREDICATE, imported rather than restated.
          updateName refuses an empty pair (schema.ts: an empty name reaches the
          scoreboard, the team card and the winner computation), and a form that
          let you press Save into a guaranteed rejection would be a worse way of
          saying the same thing.
        */}
        <Button
          type="button"
          className="self-start"
          disabled={!isCompleteName(first, last) || updateName.isPending}
          onClick={() => void onSaveName()}
        >
          Save name
        </Button>
      </div>
    </div>
  )
}
```

**One correction to make while writing this:** `me?.image` is true for a *social*
image too, so gating Remove on it offers "Remove picture" to a Google user who has
never uploaded anything, where pressing it does nothing. Gate on `me?.hasUpload`
instead — Task 6 Step 4 adds that field. Replace both `me?.image ?` guards around
the Remove button with `me?.hasUpload ?`; the `AvatarImage` guard stays on
`me?.image`, which is the right question for *that* one.

- [x] **Step 2: Write the jsdom test**

`v2/src/components/settings/profile-tab.hook.test.ts`, opening with `// @vitest-environment jsdom` and a comment explaining why, exactly like `app-menu.hook.test.ts`. Build elements with `createElement`, not JSX. Assert:

```
- renders the current name in the inputs
- the save button is disabled when either name field is emptied
- the remove button is absent when the player has no image
- the remove button is present when the player has one
```

Mock the Convex hooks the way `notifications-tab.hook.test.ts` already does — follow that file rather than inventing a mocking style.

- [x] **Step 3: Run it**

Run: `cd v2 && pnpm exec vitest run src/components/settings/profile-tab.hook.test.ts`
Expected: PASS, 4 tests.

- [x] **Step 4: Commit**

```bash
cd v2 && git add src/components/settings/profile-tab.tsx src/components/settings/profile-tab.hook.test.ts
git commit -m "feat(avatar): the Profile tab — picture and name"
```

---

## Task 9: Wire the tab into the dialog and the menu

**Files:**
- Modify: `v2/src/components/settings/settings-dialog.tsx`, `v2/src/components/app-menu.tsx`
- Test: `v2/src/components/app-menu.hook.test.ts`

- [ ] **Step 1: Add the tab**

In `settings-dialog.tsx`: widen the type to `export type SettingsTab = 'profile' | 'notifications' | 'install'`, import `ProfileTab`, and add `<TabsTrigger value="profile">Profile</TabsTrigger>` **first** in the `TabsList` with a matching `TabsContent`. First because it is the identity tab and the dialog already opens with an identity line above the strip.

- [ ] **Step 2: Add the menu item**

In `app-menu.tsx`, beside the existing `openTab('install')` item, add one calling `openTab('profile')` with the `UserIcon` already imported, labelled "Profile". Keep it inside the `isAuthenticated` block.

- [ ] **Step 3: Source the header avatar from the player row**

Replace `user?.image` in the `RingedAvatar` call with `name?.image` — `myName` now resolves it by the same precedence as everywhere else. Update the surrounding comment to say so.

- [ ] **Step 4: Write the failing menu test**

Add to `app-menu.hook.test.ts`, matching the file's existing assertions style:

```ts
test('offers Profile, which opens the settings dialog on that tab', async () => {
  // follow the file's existing open-the-menu helper, then:
  expect(screen.getByText('Profile')).toBeTruthy()
})
```

- [ ] **Step 5: Run the suite**

Run: `cd v2 && pnpm exec vitest run src/components/app-menu.hook.test.ts src/components/settings/`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
cd v2 && git add src/components/settings/settings-dialog.tsx src/components/app-menu.tsx src/components/app-menu.hook.test.ts
git commit -m "feat(avatar): Profile tab in the settings dialog and the menu"
```

---

## Task 10: Avatars in chat

**Files:**
- Modify: `v2/src/components/chat/message-list.tsx`, `v2/docs/../docs/superpowers/specs/2026-09-12-avatar-image-upload-design.md`
- Test: `v2/src/components/chat/message-list.hook.test.ts`

- [ ] **Step 1: Thread the image through**

`message-list.tsx` already resolves author names via a `nameFor(playerId)` helper built
from `team.members` (`chat.tsx:312` finds the member; a `playerId` absent from that list
is the "Former member" case). Add two helpers beside it, both built the same way and
both returning `null` for a departed author:

```tsx
  /**
   * The author's avatar, or null. NULL FOR A DEPARTED AUTHOR, which falls out of
   * the same `team.members` lookup nameFor uses — their row is gone from the
   * roster, so there is nothing to resolve and nothing to show.
   */
  const imageFor = (playerId: string): string | null =>
    team.members.find((member) => member.id === playerId)?.image ?? null

  /**
   * The fallback letters for that avatar. Deliberately null for a departed
   * author too: nameFor renders them "Former member", and initials would put
   * the identity back that the label withholds.
   */
  const initialsForAuthor = (playerId: string): string | null => {
    const member = team.members.find((candidate) => candidate.id === playerId)
    return member ? initialsFor(member.firstName, member.lastName) : null
  }
```

Import `initialsFor` from `#/lib/initials.ts`, and `Avatar`, `AvatarFallback`,
`AvatarImage` from `#/components/ui/avatar.tsx`.

- [ ] **Step 2: Render it beside the author name**

Replace the `row.showsName` block:

```tsx
              {row.showsName ? (
                <span className="flex items-center gap-1.5 px-3 pb-0.5 text-xs text-muted-foreground">
                  {/*
                    ON THE NAME ROW RATHER THAN IN A GUTTER. `showsName` is
                    already "first of a run, and never over your own" — exactly
                    the rule an avatar wants — so hanging it here gets the
                    behaviour without restructuring every row into two columns
                    and re-reasoning the alignment comments below.

                    A DEPARTED AUTHOR GETS NO AVATAR AT ALL — not an empty circle.
                    nameFor renders them as "Former member", and both a face and a
                    pair of initials would put back the identity that label
                    deliberately withholds. `initialsForAuthor` returning null is
                    precisely the "not on this roster" signal, so it gates the
                    whole element rather than just its contents.
                  */}
                  {initialsForAuthor(row.message.playerId) !== null ? (
                    <Avatar className="h-5 w-5">
                      {imageFor(row.message.playerId) !== null ? (
                        <AvatarImage
                          src={imageFor(row.message.playerId)!}
                          alt=""
                          aria-hidden="true"
                        />
                      ) : null}
                      <AvatarFallback className="text-[9px] font-medium">
                        {initialsForAuthor(row.message.playerId)}
                      </AvatarFallback>
                    </Avatar>
                  ) : null}
                  {nameFor(row.message.playerId)}
                </span>
              ) : null}
```

`alt=""` and `aria-hidden` because the name is right beside it — an alt text here would make a screen reader announce the author twice.

- [ ] **Step 3: Write the failing test**

`v2/src/components/chat/message-list.hook.test.ts` (create it if it does not exist, with the `// @vitest-environment jsdom` header and its rationale). Assert:

```
- an author with an image renders an <img> on the first message of their run
- the SECOND message of the same run renders no avatar
- your own messages render no avatar, ever
- a message whose author is not in team.members ("Former member") renders no <img>
- an author with no image renders their initials and no <img>
```

- [ ] **Step 4: Run it**

Run: `cd v2 && pnpm exec vitest run src/components/chat/`
Expected: PASS.

- [ ] **Step 5: Correct the spec**

Edit `docs/superpowers/specs/2026-09-12-avatar-image-upload-design.md` §5: replace "A 24px avatar in a left gutter, on the first message of each author's group only" with the name-row placement and the reason, so the spec matches what shipped.

- [ ] **Step 6: Commit**

```bash
cd v2 && git add src/components/chat/
cd .. && git add docs/superpowers/specs/2026-09-12-avatar-image-upload-design.md
git commit -m "feat(avatar): faces in team chat, once per run and never your own"
```

---

## Task 11: Trigger the social sync

**Files:**
- Modify: `v2/src/routes/app.tsx`

- [ ] **Step 1: Call it once per load**

In the dashboard route's component, add:

```tsx
  /**
   * MIRRORS THE PROVIDER'S PROFILE IMAGE ONTO THE PLAYER ROW so teammates can
   * see it — their session cannot read your Better Auth record, only yours can.
   *
   * FIRE AND FORGET, AND NOT AWAITED ANYWHERE. The mutation decides for itself
   * whether anything needs writing (shouldSyncSocialImage), so the steady state
   * is a no-op; a failure costs initials until the next load and must never
   * block or toast over a dashboard.
   */
  const syncSocialImage = useConvexMutation(api.players.syncSocialImage)
  useEffect(() => {
    void syncSocialImage({}).catch(() => {})
  }, [syncSocialImage])
```

- [ ] **Step 2: Typecheck**

Run: `cd v2 && pnpm run typecheck`
Expected: PASS.

- [ ] **Step 3: Commit**

```bash
cd v2 && git add src/routes/app.tsx
git commit -m "feat(avatar): mirror the social image on dashboard load"
```

---

## Task 12: Gates, deploy, close

- [ ] **Step 1: Run all four gates, separately**

```bash
cd v2
pnpm run test:once
pnpm run lint
pnpm run typecheck
pnpm run build
```

Expected: four passes. All four, not just the one that looks relevant — `lint` reaches `public/*.js` and the test suite asserts counts that docs-only changes have broken before.

- [ ] **Step 2: Verify the cache headers, which the spec flagged as unknown**

Deploy to beta, upload an avatar, and read the response headers on the resolved storage URL:

```bash
curl -sI '<the storage URL from the rendered page>' | grep -i 'cache-control\|etag\|expires'
```

Expected: a `Cache-Control` permitting browser caching. **If there is none**, file a bead for putting the Worker's Cache API in front of it (`src/server.ts`, the `wordle-teams-fqeq` pattern) — do not build that here, and do not leave the finding unrecorded either way.

- [ ] **Step 3: Verify by hand on beta**

- an OTP account can upload, see the picture in the header and in chat, and remove it
- a Google account sees its photo in chat without doing anything
- uploading over a Google photo wins; removing the upload reveals the Google photo again
- a name change appears on the scoreboard
- chat shows no avatar on your own messages, none on a run's second message, and none for "Former member"

- [ ] **Step 4: Push**

```bash
cd /home/cdub/projects/wordle-teams
git pull --rebase
git push
git status   # must show up to date with origin
```

- [ ] **Step 5: Close the issue**

```bash
bd close wordle-teams-wty4.1.1
```

Record on the issue: the cache-header finding from Step 2, and the measured size of a real uploaded avatar, so the spec's 8–20 KB estimate becomes a measurement.

---

## Spec coverage

| Spec requirement | Task |
|---|---|
| `socialImage` + `imageId`, precedence | 2, 3 |
| Two fields so a social sign-in cannot clobber an upload | 2, 4 |
| Chat reads via `getMyTeams`, no new query | 3, 10 |
| `getUrl` only when `imageId` is set; bandwidth test updated | 3 |
| Sync takes no arguments, reads the user server-side | 4 |
| Sync can clear | 1, 4 |
| Teammate's photo appears only after their own next load | 4 (documented) |
| Upload flow, server-side type and size validation, orphan deletion | 5 |
| Remove falls back to social then initials | 5 |
| Chat: others only, once per run, none for "Former member", no ring | 10 |
| Profile tab with avatar and name editing | 8, 9 |
| `updateName` reuses `isCompleteName` | 6 |
| Own header avatar from the player row | 6, 9 |
| Testing plan, e2e not relied on | throughout |
| Cache headers verified rather than assumed | 12 |
