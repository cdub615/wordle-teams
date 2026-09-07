# Invite Links Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let a team owner share a link that puts the holder on their team, so inviting somebody no longer requires knowing and typing their email address on a phone.

**Architecture:** A new `inviteLinks` table keyed by an opaque token, a `/join/$token` route that consumes it when signed in and stashes it through auth when not, and the free-tier cap re-enforced on this new join path because `completeProfileFor`'s invited-scan does not run here.

**Tech Stack:** Convex (`convex-test`), TanStack Start file routes, Playwright.

---

## Design source

`docs/superpowers/specs/2026-09-07-onboarding-activation-design.md`, section "Invite links". Read it first.

**Sequencing.** This plan depends on `2026-09-07-onboarding-next-step-card.md` only for where the button lives. Until Task 5 here, the card's invite task navigates to `/team`. That plan can ship without this one; this one should not ship without it.

**Why this is separate.** The spec calls invite links "the largest single piece of this epic, and separable", so they get their own plan and their own issues and can be cut without taking the card down.

---

## Error codes: verified, and there are THREE places to touch

An earlier revision of this plan used `NO_TEAM`, `NOT_OWNER`, `NO_INVITE`, `TEAM_LIMIT`
and `INVITE_LINK_DEAD` as placeholders and said to check them. Checked on 2026-09-07 —
**none of those five exists.** The real union is at `convex/access.ts:43-61`, and the
codes to reuse are:

| need | real code |
|---|---|
| no such team | `INVALID_TEAM` |
| caller is not the owner | `NOT_TEAM_OWNER` |
| no player row | `NO_PLAYER` |

**Two genuinely new codes are required**, because nothing existing fits:

- `INVITE_LINK_INVALID` — one code for expired, revoked and unknown together. Do not
  split them: distinguishing them tells a stranger which tokens once existed, and none
  of the three gives the holder anything different to do.
- `TEAM_LIMIT_REACHED` — the cap refusal. **There is no existing code for this and that
  is not an oversight:** the email path never refuses, it *parks* the address and
  `continue`s (`teams.ts:614`, `players.ts:228`). A link cannot park, so refusal is a
  genuinely new outcome for this codebase.

**Adding a code means editing three files, and missing one degrades silently:**

1. `convex/access.ts:43-61` — the `AccessCode` union.
2. `src/lib/convex-error.ts:17-36` — a hand-maintained `code === '…' ||` allowlist inside
   `convexErrorCode`. A code in the union but absent here returns `null`, and the UI shows
   the generic recovery message instead. Nothing catches that; it is the same drift hazard
   the funnel `EVENTS` map had before `qt4.5` typed it against its union.
3. `src/lib/convex-error.ts:~142` — the `switch` that maps a code to user-facing copy.

Write the copy deliberately. `INVITE_LINK_INVALID` is read by someone who was handed a
link by a friend and has done nothing wrong, so it should say the link is expired or
withdrawn and suggest asking for a new one — not imply they did something illegitimate.
`TEAM_LIMIT_REACHED` is read by a non-Pro player already on `FREE_TEAM_LIMIT` teams and
should name the upgrade, since that is the only thing that resolves it.

## The three things this must get right

Repeated from the spec because each one is a place where a plausible implementation is wrong.

**The free-tier cap must be re-enforced here.** `completeProfileFor` enforces `FREE_TEAM_LIMIT` during its invited-scan (`convex/players.ts:179-197`) and `invitePlayerFor` enforces it when parking an address. A link join runs neither, so without an explicit check the link is a hole the size of the whole cap. Behavioural difference worth stating in code: an email invite over the cap **parks** the address for a later upgrade, and a link **cannot park** — it must refuse.

**A link is a capability; an email invite is an addressee.** Anyone holding the link joins. That is a deliberate, accepted change to the trust model, mitigated by expiry and revocation, not an oversight.

**Token generation must be proven, not assumed.** There is no randomness anywhere in `convex/` today, so nothing in this repo demonstrates what Convex permits inside a mutation. Task 2 proves it with a test rather than asserting it in a comment.

---

## File structure

**Create**
- `v2/convex/inviteLinks.ts` — create, consume, revoke, list.
- `v2/convex/inviteLinks.test.ts`
- `v2/src/routes/join.$token.tsx`
- `v2/e2e/invite-links.spec.ts`

**Modify**
- `v2/convex/schema.ts` — the `inviteLinks` table.
- `v2/src/components/teams/invite-player-dialog.tsx` — the share-a-link half.
- `v2/src/routes/app.tsx` — consume a stashed token after auth.

---

## Task 1: The `inviteLinks` table

**Files:**
- Modify: `v2/convex/schema.ts`

- [ ] **Step 1: Add the table**

In `v2/convex/schema.ts`, alongside the other tables:

```ts
  /**
   * SHAREABLE TEAM INVITES. wordle-teams-qt4.
   *
   * WHY A TABLE RATHER THAN A FIELD ON `teams`. Revoking and rotating are the
   * operations that matter here — a link is a capability that anyone holding
   * it can use, so being able to kill one without disturbing the team document
   * is the point. A single token column on `teams` makes "revoke" mean
   * "overwrite", which silently breaks any link already shared.
   *
   * THE TOKEN IS THE SECRET AND THE KEY. It is looked up by `by_token` on the
   * unauthenticated join path, so it must be unguessable; see createLink.
   *
   * NOT NULLABLE-BY-OMISSION: `revokedAt` absent means live, exactly as
   * players.onboardingDismissedAt does.
   */
  inviteLinks: defineTable({
    teamId: v.id('teams'),
    token: v.string(),
    createdBy: v.id('players'),
    expiresAt: v.number(),
    revokedAt: v.optional(v.number()),
  })
    .index('by_token', ['token'])
    .index('by_team', ['teamId']),
```

- [ ] **Step 2: Codegen and typecheck**

Run from `v2/`:

```bash
CONVEX_DEPLOY_KEY= CONVEX_URL= pnpm exec convex codegen; echo "codegen=$?"
pnpm typecheck; echo "typecheck=$?"
```

Expected: both `=0`. **Never run a bare `pnpm exec convex dev`** — `CONVEX_DEPLOY_KEY` is uncommented in `v2/.env.local` and a bare run pushes to beta.

- [ ] **Step 3: Commit**

```bash
git add v2/convex/schema.ts
git commit -m "feat(invites): inviteLinks table"
```

---

## Task 2: Creating a link — and proving the token is random

**Files:**
- Create: `v2/convex/inviteLinks.ts`
- Test: `v2/convex/inviteLinks.test.ts`

> **REWRITTEN 2026-09-07 against the real codebase.** The earlier version routed
> everything through `authenticatedAs` and invented error codes. This repo's actual
> pattern is exported `*For` helpers taking an explicit `playerId`, thin `mutation`
> wrappers around them (`teams.ts`'s `updateTeam` is the model), and tests calling the
> helpers **directly inside `t.run`** with no auth setup at all — which is how
> `teams.test.ts` and `chat.test.ts` do it. Follow that.
>
> Ownership is `requireTeamOwnerFor(ctx, playerId, teamId)` (`access.ts:176`). It returns
> the team and throws `NOT_TEAM_OWNER`; the member check beneath it throws `NOT_A_MEMBER`
> for a missing team **and** a non-member alike, deliberately not distinguishing them. So
> you need no `INVALID_TEAM` here.

- [ ] **Step 1: Write the failing test**

Create `v2/convex/inviteLinks.test.ts`:

```ts
import { convexTest } from 'convex-test'
import { describe, expect, test } from 'vitest'
import schema from './schema'
import { aPlayer, aTeam } from './fixtures.ts'
import { createLinkFor, revokeLinkFor } from './inviteLinks.ts'

const modules = import.meta.glob('./**/*.ts')

describe('createLinkFor', () => {
  test('stores a live row and returns its token', async () => {
    const t = convexTest(schema, modules)
    await t.run(async (ctx) => {
      const ada = await ctx.db.insert('players', aPlayer())
      const teamId = await ctx.db.insert('teams', aTeam({ playerIds: [ada], owner: ada }))

      const token = await createLinkFor(ctx, ada, teamId)
      expect(typeof token).toBe('string')
      expect(token.length).toBeGreaterThanOrEqual(32)

      const rows = await ctx.db.query('inviteLinks').collect()
      expect(rows).toHaveLength(1)
      expect(rows[0]).toMatchObject({ teamId, token, createdBy: ada })
      expect(rows[0].revokedAt).toBeUndefined()
      expect(rows[0].expiresAt).toBeGreaterThan(Date.now())
    })
  })

  test('two links never collide', async () => {
    // THIS TEST IS THE POINT OF THE TASK. Nothing else in convex/ uses randomness,
    // so nothing in this repo demonstrates what the runtime permits inside a
    // mutation. If the generator is not actually random, this fails loudly here
    // rather than shipping guessable capability URLs.
    const t = convexTest(schema, modules)
    await t.run(async (ctx) => {
      const ada = await ctx.db.insert('players', aPlayer())
      const teamId = await ctx.db.insert('teams', aTeam({ playerIds: [ada], owner: ada }))

      const tokens = new Set<string>()
      for (let i = 0; i < 25; i++) tokens.add(await createLinkFor(ctx, ada, teamId))
      expect(tokens.size).toBe(25)
    })
  })

  test('a member who does not own the team cannot create one', async () => {
    const t = convexTest(schema, modules)
    await t.run(async (ctx) => {
      const ada = await ctx.db.insert('players', aPlayer())
      const bob = await ctx.db.insert('players', aPlayer({ email: 'bob@example.com' }))
      const teamId = await ctx.db.insert('teams', aTeam({ playerIds: [ada, bob], owner: ada }))

      await expect(createLinkFor(ctx, bob, teamId)).rejects.toMatchObject({
        data: { code: 'NOT_TEAM_OWNER' },
      })
    })
  })

  test('a stranger to the team cannot create one', async () => {
    const t = convexTest(schema, modules)
    await t.run(async (ctx) => {
      const ada = await ctx.db.insert('players', aPlayer())
      const outsider = await ctx.db.insert('players', aPlayer({ email: 'out@example.com' }))
      const teamId = await ctx.db.insert('teams', aTeam({ playerIds: [ada], owner: ada }))

      await expect(createLinkFor(ctx, outsider, teamId)).rejects.toMatchObject({
        data: { code: 'NOT_A_MEMBER' },
      })
    })
  })
})

describe('revokeLinkFor', () => {
  test('stamps revokedAt', async () => {
    const t = convexTest(schema, modules)
    await t.run(async (ctx) => {
      const ada = await ctx.db.insert('players', aPlayer())
      const teamId = await ctx.db.insert('teams', aTeam({ playerIds: [ada], owner: ada }))
      const token = await createLinkFor(ctx, ada, teamId)

      await revokeLinkFor(ctx, ada, token)
      const [row] = await ctx.db.query('inviteLinks').collect()
      expect(row.revokedAt).toBeGreaterThan(0)
    })
  })

  test('a non-owner cannot revoke', async () => {
    const t = convexTest(schema, modules)
    await t.run(async (ctx) => {
      const ada = await ctx.db.insert('players', aPlayer())
      const bob = await ctx.db.insert('players', aPlayer({ email: 'bob@example.com' }))
      const teamId = await ctx.db.insert('teams', aTeam({ playerIds: [ada, bob], owner: ada }))
      const token = await createLinkFor(ctx, ada, teamId)

      await expect(revokeLinkFor(ctx, bob, token)).rejects.toMatchObject({
        data: { code: 'NOT_TEAM_OWNER' },
      })
    })
  })

  test('an unknown token is refused as INVITE_LINK_INVALID', async () => {
    const t = convexTest(schema, modules)
    await t.run(async (ctx) => {
      const ada = await ctx.db.insert('players', aPlayer())
      await expect(revokeLinkFor(ctx, ada, 'nosuchtoken')).rejects.toMatchObject({
        data: { code: 'INVITE_LINK_INVALID' },
      })
    })
  })
})
```

- [ ] **Step 2: Run it and watch it fail**

`pnpm vitest run convex/inviteLinks.test.ts` → FAIL, cannot resolve `./inviteLinks.ts`.

- [ ] **Step 3: Write the implementation**

Add `INVITE_LINK_INVALID` to the `AccessCode` union (`convex/access.ts:43-61`) — and remember it must also reach `src/lib/convex-error.ts` in two places; see the error-codes section above. Then create `v2/convex/inviteLinks.ts`:

```ts
import { v } from 'convex/values'
import { mutation } from './_generated/server'
import { accessError, requirePlayer, requireTeamOwnerFor } from './access'
import type { Id } from './_generated/dataModel'
import type { WriterCtx } from './winners.ts'

/** Seven days. Long enough to sit unread in a chat, short enough to expire. */
const LINK_TTL_MS = 7 * 24 * 60 * 60 * 1000

/**
 * An opaque, unguessable token.
 *
 * THIS IS A CAPABILITY, NOT AN IDENTIFIER: anyone holding it joins the team, which
 * is the whole difference between a link and an email invite. It is looked up on a
 * path reachable before sign-in, so guessability is the only thing standing between
 * a stranger and somebody's team.
 *
 * crypto.getRandomValues, NOT Math.random, which is seeded and predictable. Nothing
 * else in convex/ uses randomness, so there was no precedent to copy — the test
 * "two links never collide" is what actually proves this runs in this runtime rather
 * than a comment asserting it does.
 */
function newToken(): string {
  const bytes = new Uint8Array(16)
  crypto.getRandomValues(bytes)
  return Array.from(bytes, (byte) => byte.toString(16).padStart(2, '0')).join('')
}

export async function createLinkFor(
  ctx: WriterCtx,
  playerId: Id<'players'>,
  teamId: Id<'teams'>,
): Promise<string> {
  await requireTeamOwnerFor(ctx, playerId, teamId)
  const token = newToken()
  await ctx.db.insert('inviteLinks', {
    teamId,
    token,
    createdBy: playerId,
    expiresAt: Date.now() + LINK_TTL_MS,
  })
  return token
}

export async function revokeLinkFor(
  ctx: WriterCtx,
  playerId: Id<'players'>,
  token: string,
): Promise<void> {
  const link = await ctx.db
    .query('inviteLinks')
    .withIndex('by_token', (q) => q.eq('token', token))
    .unique()
  // Ownership is checked AFTER existence, but both answer with a refusal the
  // caller cannot tell apart from the other — see the consume path, where that
  // property matters more.
  if (!link) throw accessError('INVITE_LINK_INVALID')
  await requireTeamOwnerFor(ctx, playerId, link.teamId)
  await ctx.db.patch(link._id, { revokedAt: Date.now() })
}

export const createLink = mutation({
  args: { teamId: v.id('teams') },
  handler: async (ctx, { teamId }) => {
    const player = await requirePlayer(ctx)
    return await createLinkFor(ctx, player._id, teamId)
  },
})

export const revokeLink = mutation({
  args: { token: v.string() },
  handler: async (ctx, { token }) => {
    const player = await requirePlayer(ctx)
    await revokeLinkFor(ctx, player._id, token)
  },
})
```

Check `WriterCtx`'s real export site before importing it — `winners.ts` is where `players.ts` gets it from, but confirm rather than assume.

- [ ] **Step 4: Run it and watch it pass**

`pnpm vitest run convex/inviteLinks.test.ts` → PASS, 7 tests.

**If "two links never collide" fails**, `crypto.getRandomValues` is unavailable in this runtime. **STOP and report it — do not improvise a fallback, and above all do not reach for `Math.random`.** These are capability URLs on a pre-auth path. The fallback is generating the token in an `action` (full Node) that calls an internal mutation to insert, and that is a large enough shape change to be worth a decision rather than a guess.

- [ ] **Step 5: Commit**

```bash
git add v2/convex/inviteLinks.ts v2/convex/inviteLinks.test.ts
git commit -m "feat(invites): create and revoke shareable invite links"
```

---

## Task 3: Consuming a link, with the cap enforced

**Files:**
- Modify: `v2/convex/inviteLinks.ts`
- Test: `v2/convex/inviteLinks.test.ts`

- [ ] **Step 1: Write the failing test**

Append to `v2/convex/inviteLinks.test.ts`:

```ts
describe('inviteLinks.consumeLink', () => {
  test('puts the holder on the team', async () => {
    const t = convexTest(schema, modules)
    betterAuthTest.register(t)
    const { teamId, as } = await withOwnedTeam(t, 'o1@example.com')
    const token = await as.mutation(api.inviteLinks.createLink, { teamId })

    await t.run(async (ctx) => {
      await ctx.db.insert('players', aPlayer({ email: 'joiner@example.com' }))
    })
    const joiner = await authenticatedAs(t, 'joiner@example.com')
    await joiner.mutation(api.inviteLinks.consumeLink, { token })

    const team = await t.run(async (ctx) => await ctx.db.get(teamId))
    expect(team?.playerIds).toHaveLength(2)
  })

  test('is idempotent for someone already on the team', async () => {
    const t = convexTest(schema, modules)
    betterAuthTest.register(t)
    const { teamId, as } = await withOwnedTeam(t, 'o2@example.com')
    const token = await as.mutation(api.inviteLinks.createLink, { teamId })

    // The owner following their own link must not be added twice — a duplicate
    // id shows the person twice on the team card and enters them twice in the
    // month recompute. teams.ts:266 records the same hazard on the email path.
    await as.mutation(api.inviteLinks.consumeLink, { token })
    const team = await t.run(async (ctx) => await ctx.db.get(teamId))
    expect(team?.playerIds).toHaveLength(1)
  })

  test('refuses an expired link', async () => {
    const t = convexTest(schema, modules)
    betterAuthTest.register(t)
    const { teamId, as } = await withOwnedTeam(t, 'o3@example.com')
    const token = await as.mutation(api.inviteLinks.createLink, { teamId })
    await t.run(async (ctx) => {
      const link = await ctx.db.query('inviteLinks').first()
      await ctx.db.patch(link!._id, { expiresAt: Date.now() - 1 })
    })
    await t.run(async (ctx) => {
      await ctx.db.insert('players', aPlayer({ email: 'late@example.com' }))
    })
    const late = await authenticatedAs(t, 'late@example.com')
    await expect(late.mutation(api.inviteLinks.consumeLink, { token })).rejects.toThrow()
  })

  test('refuses a revoked link', async () => {
    const t = convexTest(schema, modules)
    betterAuthTest.register(t)
    const { teamId, as } = await withOwnedTeam(t, 'o4@example.com')
    const token = await as.mutation(api.inviteLinks.createLink, { teamId })
    await as.mutation(api.inviteLinks.revokeLink, { token })
    await t.run(async (ctx) => {
      await ctx.db.insert('players', aPlayer({ email: 'revoked@example.com' }))
    })
    const who = await authenticatedAs(t, 'revoked@example.com')
    await expect(who.mutation(api.inviteLinks.consumeLink, { token })).rejects.toThrow()
  })

  test('refuses an unknown token', async () => {
    const t = convexTest(schema, modules)
    betterAuthTest.register(t)
    await t.run(async (ctx) => {
      await ctx.db.insert('players', aPlayer({ email: 'nobody@example.com' }))
    })
    const who = await authenticatedAs(t, 'nobody@example.com')
    await expect(
      who.mutation(api.inviteLinks.consumeLink, { token: 'deadbeef' }),
    ).rejects.toThrow()
  })

  test('REFUSES a non-pro joiner already at the free team cap', async () => {
    // THE HOLE THIS CLOSES. completeProfileFor enforces FREE_TEAM_LIMIT during
    // its invited-scan (players.ts:179-197) and invitePlayerFor enforces it
    // when parking an address. A link join runs NEITHER, so without this check
    // the link bypasses the cap entirely.
    //
    // And note the behavioural difference from the email path, which is
    // deliberate: an email invite over the cap PARKS the address for a later
    // upgrade. A link cannot park, so it must refuse.
    const t = convexTest(schema, modules)
    betterAuthTest.register(t)
    const { teamId, as } = await withOwnedTeam(t, 'o5@example.com')
    const token = await as.mutation(api.inviteLinks.createLink, { teamId })

    await t.run(async (ctx) => {
      const capped = await ctx.db.insert('players', aPlayer({ email: 'capped@example.com' }))
      for (let i = 0; i < FREE_TEAM_LIMIT; i++) {
        await ctx.db.insert('teams', aTeam({ name: `existing ${i}`, playerIds: [capped] }))
      }
    })
    const capped = await authenticatedAs(t, 'capped@example.com')
    await expect(capped.mutation(api.inviteLinks.consumeLink, { token })).rejects.toThrow()

    const team = await t.run(async (ctx) => await ctx.db.get(teamId))
    expect(team?.playerIds).toHaveLength(1)
  })
})
```

Add `import { FREE_TEAM_LIMIT } from './lib/teamLimits.ts'` at the top of the test file. **Derive the loop bound from the constant, never a literal `2`** — a test written against a literal keeps passing straight through a change to the cap, which `convex/lib/teamLimits.ts` calls out explicitly.

- [ ] **Step 2: Run it and watch it fail**

Run from `v2/`: `pnpm vitest run convex/inviteLinks.test.ts -t consumeLink`
Expected: FAIL — `api.inviteLinks.consumeLink` undefined.

- [ ] **Step 3: Write the implementation**

Append to `v2/convex/inviteLinks.ts`:

```ts
import { isProFor } from './access'
import { resetChatCursorFor } from './chat.ts'
import { getMyTeamsFor } from './teams.ts'
import { FREE_TEAM_LIMIT } from './lib/teamLimits.ts'

export const consumeLink = mutation({
  args: { token: v.string() },
  handler: async (ctx, { token }) => {
    const player = await requirePlayer(ctx)
    const link = await ctx.db
      .query('inviteLinks')
      .withIndex('by_token', (q) => q.eq('token', token))
      .unique()

    // One message for all three dead-link states. Distinguishing "revoked"
    // from "expired" from "never existed" to an unauthenticated-ish caller
    // tells a stranger which tokens once existed, and none of the three gives
    // the holder anything different to do.
    if (!link || link.revokedAt !== undefined || link.expiresAt < Date.now()) {
      throw accessError('INVITE_LINK_INVALID')
    }

    const team = await ctx.db.get(link.teamId)
    if (!team) throw accessError('INVALID_TEAM')

    // Idempotent. Appending unconditionally would put the same id in the
    // roster twice, which shows the person twice on the team card and enters
    // them twice in recomputeTeamMonth's candidate list — the exact hazard
    // teams.ts:266 records on the email path.
    if (team.playerIds.includes(player._id)) return

    // THE CAP, re-enforced. See the test of the same name for why this cannot
    // be inherited from the email path.
    if (!(await isProFor(ctx, player._id))) {
      const mine = await getMyTeamsFor(ctx, player._id)
      if (mine.length >= FREE_TEAM_LIMIT) throw accessError('TEAM_LIMIT_REACHED')
    }

    // BEFORE the roster patch, so no window exists in which they are a member
    // holding a stale cursor — chat.ts's resetChatCursorFor documents the
    // ordering rule and players.ts:262 follows it on the email path.
    await resetChatCursorFor(ctx, player._id, team._id)
    await ctx.db.patch(team._id, { playerIds: [...team.playerIds, player._id] })
  },
})
```

Move the added imports up to the existing import block rather than leaving them mid-file. Reuse `access.ts`'s real error codes.

- [ ] **Step 4: Run it and watch it pass**

Run from `v2/`: `pnpm vitest run convex/inviteLinks.test.ts`
Expected: PASS, 10 tests.

- [ ] **Step 5: Commit**

```bash
git add v2/convex/inviteLinks.ts v2/convex/inviteLinks.test.ts
git commit -m "feat(invites): consume an invite link, with the free-tier cap enforced"
```

---

## Task 4: The `/join/$token` route

**Files:**
- Create: `v2/src/routes/join.$token.tsx`
- Modify: `v2/src/routes/app.tsx`

- [ ] **Step 1: Write the route**

Create `v2/src/routes/join.$token.tsx`:

```tsx
import { createFileRoute, redirect } from '@tanstack/react-router'
import { pageTitle } from '#/lib/seo'

/** Where a token waits while its holder signs in. */
export const PENDING_INVITE_KEY = 'wt.pendingInviteToken'

/**
 * Follow a shared invite link.
 *
 * TWO PATHS, and the signed-out one is why this route exists at all rather
 * than a mutation call from a dialog. Someone receiving a link in a chat is
 * usually not signed in, and there is no token in the EMAIL invite flow to
 * copy from — that one works by matching an address at profile completion
 * (players.ts:226), which a link holder has no way to trigger.
 *
 * Signed in  — consume immediately and land on the dashboard.
 * Signed out — stash the token, send them through /login, and let /app consume
 *              it once a player row exists. It cannot be consumed before then:
 *              consumeLink requires a player, and a brand-new account does not
 *              have one until /complete-profile.
 *
 * sessionStorage, not localStorage: a token that outlives the tab it was
 * opened in is a capability lying around on a shared computer.
 */
export const Route = createFileRoute('/join/$token')({
  head: () => ({ meta: [{ title: pageTitle('Join a team') }] }),
  beforeLoad: ({ context, params }) => {
    if (!context.isAuthenticated) {
      // Guarded: beforeLoad also runs during SSR, where there is no window.
      if (typeof window !== 'undefined') {
        try {
          window.sessionStorage.setItem(PENDING_INVITE_KEY, params.token)
        } catch {
          // Private mode, or storage disabled. The link simply will not
          // survive the round trip; nothing here may throw at someone who is
          // trying to join a team.
        }
      }
      throw redirect({ to: '/login' })
    }
    throw redirect({ to: '/app', search: { join: params.token } })
  },
})
```

- [ ] **Step 2: Consume on arrival**

In `v2/src/routes/app.tsx`, add `join` to `DashboardSearch` and `validateSearch`, then add an effect beside the existing `login_callback_arrived` one (which is the established hook point for "something happened during auth", `app.tsx:199-207`):

```tsx
  const consumeInvite = useMutation({ mutationFn: useConvexMutation(api.inviteLinks.consumeLink) })
  useEffect(() => {
    let token = joinParam
    if (!token) {
      try {
        token = window.sessionStorage.getItem(PENDING_INVITE_KEY) ?? undefined
      } catch {
        token = undefined
      }
    }
    if (!token) return
    // Cleared BEFORE the call, not after: a refusal (cap, expired, revoked)
    // must not leave a token that retries on every dashboard render.
    try {
      window.sessionStorage.removeItem(PENDING_INVITE_KEY)
    } catch {
      // ignored, as above
    }
    void consumeInvite
      .mutateAsync({ token })
      .then(() => toast.success('You joined the team'))
      .catch((error) => toast.error(mutationErrorMessage(error, 'That invite link is no longer valid')))
    void navigate({ to: Route.fullPath, search: (prev) => ({ ...prev, join: undefined }), replace: true })
  }, [joinParam])
```

Import `toast` from `sonner` and `mutationErrorMessage` from `#/lib/convex-error.ts` if they are not already imported in this file, matching `create-team-dialog.tsx:3` and `:20`.

- [ ] **Step 3: Verify the route registered**

Run from `v2/`:

```bash
pnpm typecheck; echo "typecheck=$?"
pnpm vitest run src/routes.test.ts; echo "routes=$?"
```

Expected: both `=0`. `src/routes.test.ts` asserts the route table — **if it enumerates routes, add `/join/$token` to it** rather than letting the assertion fail.

- [ ] **Step 4: Commit**

```bash
git add v2/src/routes/join.\$token.tsx v2/src/routes/app.tsx v2/src/routes.test.ts
git commit -m "feat(invites): /join/\$token, consumed after sign-in"
```

---

## Task 5: Sharing a link from the UI

**Files:**
- Modify: `v2/src/components/teams/invite-player-dialog.tsx`

- [ ] **Step 1: Add the link half to the dialog**

The dialog keeps its email field unchanged — that path still works and is still the right one when you know the address. Add below it a "Share a link" section that calls `createLink` and copies the resulting URL:

```tsx
  const createLink = useMutation({ mutationFn: useConvexMutation(api.inviteLinks.createLink) })
  const [copied, setCopied] = useState(false)

  const shareLink = async () => {
    try {
      const token = await createLink.mutateAsync({ teamId })
      const url = `${window.location.origin}/join/${token}`
      // navigator.share where it exists — this is a phone-first action and the
      // native sheet is the whole reason a link beats typing an address. The
      // clipboard is the fallback, not the primary.
      if (navigator.share) {
        await navigator.share({ title: `Join ${teamName} on Wordle Teams`, url })
        return
      }
      await navigator.clipboard.writeText(url)
      setCopied(true)
      toast.success('Invite link copied')
    } catch (error) {
      // An AbortError is the user dismissing the share sheet, which is not a
      // failure and must not raise a toast.
      if (error instanceof Error && error.name === 'AbortError') return
      toast.error(mutationErrorMessage(error, 'Could not create an invite link'))
    }
  }
```

Render a button wired to `shareLink`, with visible text (not an icon alone) — the tooltip-only labels in v1 are the cautionary tale `wordle-teams-390` is still open about, and this surface is phone-first.

- [ ] **Step 2: Point the onboarding card at it**

In `v2/src/routes/app.tsx`, replace the Task 7 placeholder from the card plan — `onInvite` navigating to `/team` — with opening this dialog directly.

- [ ] **Step 3: Run all four gates**

```bash
pnpm test:once; echo "test=$?"
pnpm lint;      echo "lint=$?"
pnpm typecheck; echo "typecheck=$?"
pnpm build;     echo "build=$?"
```

Expected: all four `=0`.

- [ ] **Step 4: Commit**

```bash
git add v2/src/components/teams/invite-player-dialog.tsx v2/src/routes/app.tsx
git commit -m "feat(invites): share an invite link from the invite dialog"
```

---

## Task 6: End to end, and close out

**Files:**
- Create: `v2/e2e/invite-links.spec.ts`

- [ ] **Step 1: Check the port before anything else**

```bash
lsof -i :3000
```

Playwright attaches to whatever already holds 3000. A stale dev server means the whole run tests old code. **e2e is outside the four gates** — nothing else will catch a red spec here.

- [ ] **Step 2: Write the spec**

Create `v2/e2e/invite-links.spec.ts`, reusing the sign-in and seeding helpers in `e2e/invites.spec.ts`:

```ts
import { expect, test } from '@playwright/test'

test.describe('invite links', () => {
  test('a signed-out holder joins after signing in', async ({ page }) => {
    // ...seed an owner with a team, create a link, capture the URL...
    // ...sign out, then:...
    await page.goto(inviteUrl)
    await expect(page).toHaveURL(/\/login/)
    // ...complete sign-in as a new account...
    await expect(page).toHaveURL(/\/app/)
    await expect(page.getByText('You joined the team')).toBeVisible()
  })

  test('a dead link reports itself and changes nothing', async ({ page }) => {
    await page.goto('/join/deadbeefdeadbeefdeadbeefdeadbeef')
    // ...sign in...
    await expect(page.getByText(/no longer valid/)).toBeVisible()
  })
})
```

Fill the elided steps from the neighbouring spec rather than inventing selectors.

- [ ] **Step 3: Run it**

```bash
pnpm exec playwright test e2e/invite-links.spec.ts
```

Expected: 2 passed.

- [ ] **Step 4: Gates, including CI's timezone**

```bash
pnpm test:once;        echo "test=$?"
TZ=UTC pnpm test:once; echo "tz=$?"
pnpm lint;             echo "lint=$?"
pnpm typecheck;        echo "typecheck=$?"
pnpm build;            echo "build=$?"
grep -rn "SITE_URL" dist/client/ | head
```

Expected: all `=0`, and **no `SITE_URL` hits** — `convex/auth.ts` throws at module scope without it, which is always true in a browser, and that throw cannot be tree-shaken. Nothing here should reach `convex/access.ts`, but `inviteLinks.ts` imports it, so this check matters more in this plan than in the card one.

- [ ] **Step 5: Commit and close the issues**

```bash
git add v2/e2e/invite-links.spec.ts
git commit -m "test(e2e): joining by invite link, signed out and dead"
```

---

## Self-review

**Spec coverage.** `inviteLinks` table with `teamId`, `token`, `createdBy`, `expiresAt`, `revokedAt` and a `by_token` index — Task 1. Separate table rather than a field on `teams`, for revoke and rotate — Task 1's comment. `/join/$token` with both the signed-in and signed-out paths — Task 4. Cap re-enforced with an explicit refusal rather than parking — Task 3, with a test named for it. Link-as-capability accepted and mitigated by expiry and revoke — Tasks 1, 2, 3. Token generation proven rather than assumed — Task 2, with the fallback named if the test fails.

**Placeholder scan.** The two e2e specs carry elided steps marked `...`, pointing at the neighbouring spec to copy from. That is deliberate: inventing selectors for a suite this plan has not read would be worse than naming the source. Everything else carries real code. The error codes are no longer placeholders: checked against `convex/access.ts:43-61` on 2026-09-07, three are reused (`INVALID_TEAM`, `NOT_TEAM_OWNER`, `NO_PLAYER`) and two are genuinely new (`INVITE_LINK_INVALID`, `TEAM_LIMIT_REACHED`) — see the error-codes section, including the three files each new code must be added to.

**Type consistency.** `token` is a `string` in the schema, in `createLink`'s return, in `revokeLink` and `consumeLink`'s args, in `PENDING_INVITE_KEY`'s stored value and in the `join` search param throughout. `teamId` is `v.id('teams')` in both mutations and `Id<'teams'>` in the dialog, matching `InvitePlayerDialog`'s existing prop.

**Known soft spot.** Task 3 calls `getMyTeamsFor` inside a mutation to count the joiner's teams, which is the full-team-scan function. That is acceptable *here* — a mutation runs once, unlike the reactive query the card plan deliberately kept off it — but if a cheaper membership count appears later, this is a caller worth revisiting.
