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
# Five files, not two: the new code touches access.ts and convex-error.ts, and a
# new Convex module regenerates api.d.ts. Committing only the first two leaves a
# broken tree.
git add v2/convex/inviteLinks.ts v2/convex/inviteLinks.test.ts \
        v2/convex/access.ts v2/src/lib/convex-error.ts v2/convex/_generated/api.d.ts
git commit -m "feat(invites): create and revoke shareable invite links"
```

---

## Task 3: Consuming a link, with the cap enforced

**Files:**
- Modify: `v2/convex/inviteLinks.ts`
- Test: `v2/convex/inviteLinks.test.ts`

- [ ] **Step 1: Write the failing test**

> **Synced 2026-09-07 to what shipped.** The original block here was written
> mutation-style, against `api.inviteLinks.consumeLink` with a `withOwnedTeam` helper
> that **does not exist anywhere in this repo** — it could not have run. It also
> contradicted the shape requirements added further down this same task. The block
> below is the real one.

Append to `v2/convex/inviteLinks.test.ts`:

```ts
describe('consumeLinkFor', () => {
  test('puts the holder on the team', async () => {
    const t = convexTest(schema, modules)
    await t.run(async (ctx) => {
      const ada = await ctx.db.insert('players', aPlayer())
      const teamId = await ctx.db.insert('teams', aTeam({ playerIds: [ada], owner: ada }))
      const token = await createLinkFor(ctx, ada, teamId)
      const joiner = await ctx.db.insert('players', aPlayer({ email: 'joiner@example.com' }))

      await consumeLinkFor(ctx, joiner, token)

      const team = await ctx.db.get(teamId)
      expect(team?.playerIds).toEqual([ada, joiner])
    })
  })

  test('is idempotent for someone already on the team', async () => {
    const t = convexTest(schema, modules)
    await t.run(async (ctx) => {
      const ada = await ctx.db.insert('players', aPlayer())
      const teamId = await ctx.db.insert('teams', aTeam({ playerIds: [ada], owner: ada }))
      const token = await createLinkFor(ctx, ada, teamId)

      // The owner following their own link must not be added twice — a duplicate
      // id shows the person twice on the team card and enters them twice in the
      // month recompute. teams.ts:266 records the same hazard on the email path.
      await consumeLinkFor(ctx, ada, token)
      await consumeLinkFor(ctx, ada, token)

      const team = await ctx.db.get(teamId)
      expect(team?.playerIds).toEqual([ada])
    })
  })

  test('an already-member pass leaves a live chat cursor alone', async () => {
    // The other half of idempotence, and the one no roster assertion can see.
    // resetChatCursorFor DELETES the row, so running it on a current member
    // would mark a conversation they have been reading all along unread —
    // exactly the line players.ts draws with its `if (!alreadyMember)`.
    const t = convexTest(schema, modules)
    await t.run(async (ctx) => {
      const ada = await ctx.db.insert('players', aPlayer())
      const teamId = await ctx.db.insert('teams', aTeam({ playerIds: [ada], owner: ada }))
      const token = await createLinkFor(ctx, ada, teamId)
      await ctx.db.insert('chatReads', { playerId: ada, teamId, lastReadAt: 1234 })

      await consumeLinkFor(ctx, ada, token)

      const cursors = await ctx.db.query('chatReads').collect()
      expect(cursors).toHaveLength(1)
      expect(cursors[0].lastReadAt).toBe(1234)
    })
  })

  test('clears a returning member stale chat cursor', async () => {
    // A previous stint on this team leaves a chatReads row behind — removal
    // never cleans one up, deliberately — and it says they have read everything
    // up to the day they left. Rejoining on top of it means no unread badge for
    // anything said while they were gone. players.ts:262 does the same on the
    // email path; this is the fourth add path and owes the same.
    const t = convexTest(schema, modules)
    await t.run(async (ctx) => {
      const ada = await ctx.db.insert('players', aPlayer())
      const teamId = await ctx.db.insert('teams', aTeam({ playerIds: [ada], owner: ada }))
      const token = await createLinkFor(ctx, ada, teamId)
      const returner = await ctx.db.insert('players', aPlayer({ email: 'back@example.com' }))
      await ctx.db.insert('chatReads', { playerId: returner, teamId, lastReadAt: 1234 })

      await consumeLinkFor(ctx, returner, token)

      expect(await ctx.db.query('chatReads').collect()).toHaveLength(0)
    })
  })

  test('refuses an expired link', async () => {
    const t = convexTest(schema, modules)
    await t.run(async (ctx) => {
      const ada = await ctx.db.insert('players', aPlayer())
      const teamId = await ctx.db.insert('teams', aTeam({ playerIds: [ada], owner: ada }))
      const token = await createLinkFor(ctx, ada, teamId)
      const [link] = await ctx.db.query('inviteLinks').collect()
      await ctx.db.patch(link._id, { expiresAt: Date.now() - 1 })
      const late = await ctx.db.insert('players', aPlayer({ email: 'late@example.com' }))

      await expect(consumeLinkFor(ctx, late, token)).rejects.toMatchObject({
        data: { code: 'INVITE_LINK_INVALID' },
      })
      expect((await ctx.db.get(teamId))?.playerIds).toEqual([ada])
    })
  })

  test('refuses a revoked link', async () => {
    const t = convexTest(schema, modules)
    await t.run(async (ctx) => {
      const ada = await ctx.db.insert('players', aPlayer())
      const teamId = await ctx.db.insert('teams', aTeam({ playerIds: [ada], owner: ada }))
      const token = await createLinkFor(ctx, ada, teamId)
      await revokeLinkFor(ctx, ada, token)
      const who = await ctx.db.insert('players', aPlayer({ email: 'revoked@example.com' }))

      await expect(consumeLinkFor(ctx, who, token)).rejects.toMatchObject({
        data: { code: 'INVITE_LINK_INVALID' },
      })
      expect((await ctx.db.get(teamId))?.playerIds).toEqual([ada])
    })
  })

  test('refuses an unknown token', async () => {
    const t = convexTest(schema, modules)
    await t.run(async (ctx) => {
      const nobody = await ctx.db.insert('players', aPlayer({ email: 'nobody@example.com' }))
      await expect(consumeLinkFor(ctx, nobody, 'deadbeef')).rejects.toMatchObject({
        data: { code: 'INVITE_LINK_INVALID' },
      })
    })
  })

  test('refuses a link whose team is gone', async () => {
    // A FOURTH DEAD STATE, and it is reachable: cascadeDeleteTeam (teams.ts)
    // does not collect inviteLinks rows, so deleting a team leaves every link
    // it issued dangling. Folded into the same refusal as the other three — it
    // gives the holder nothing different to do, and answering differently
    // would tell a stranger that this team once existed.
    const t = convexTest(schema, modules)
    await t.run(async (ctx) => {
      const ada = await ctx.db.insert('players', aPlayer())
      const teamId = await ctx.db.insert('teams', aTeam({ playerIds: [ada], owner: ada }))
      const token = await createLinkFor(ctx, ada, teamId)
      await ctx.db.delete(teamId)
      const who = await ctx.db.insert('players', aPlayer({ email: 'ghost@example.com' }))

      await expect(consumeLinkFor(ctx, who, token)).rejects.toMatchObject({
        data: { code: 'INVITE_LINK_INVALID' },
      })
    })
  })

  test('answers every dead-link state with one indistinguishable refusal', async () => {
    // THE PROPERTY ITSELF, asserted as an equality rather than as four separate
    // literals, because the literals are what a future edit changes one of.
    // This path is reachable BEFORE sign-in, so distinguishing "revoked" from
    // "expired" from "the team is gone" from "never existed" tells a stranger
    // which tokens once existed. It does NOT inherit this from revokeLinkFor,
    // whose two refusals ARE distinguishable — see the comment there.
    //
    // The cap refusal is deliberately NOT in this set: a legitimate holder
    // blocked by the free-tier cap can act on it, and telling them to upgrade
    // is the point.
    const t = convexTest(schema, modules)
    await t.run(async (ctx) => {
      const ada = await ctx.db.insert('players', aPlayer())
      const stranger = await ctx.db.insert('players', aPlayer({ email: 's@example.com' }))
      const mkTeam = async () =>
        await ctx.db.insert('teams', aTeam({ playerIds: [ada], owner: ada }))

      const expiredTeam = await mkTeam()
      const expired = await createLinkFor(ctx, ada, expiredTeam)
      const expiredRow = await ctx.db
        .query('inviteLinks')
        .withIndex('by_token', (q) => q.eq('token', expired))
        .unique()
      await ctx.db.patch(expiredRow!._id, { expiresAt: Date.now() - 1 })

      const revokedTeam = await mkTeam()
      const revoked = await createLinkFor(ctx, ada, revokedTeam)
      await revokeLinkFor(ctx, ada, revoked)

      const goneTeam = await mkTeam()
      const gone = await createLinkFor(ctx, ada, goneTeam)
      await ctx.db.delete(goneTeam)

      const refusalFor = async (token: string) => {
        try {
          await consumeLinkFor(ctx, stranger, token)
        } catch (error) {
          return (error as { data: unknown }).data
        }
        throw new Error(`consumeLinkFor unexpectedly accepted ${token}`)
      }

      // ANCHORED FIRST. Without this line the three equalities below are
      // satisfied by four IDENTICAL non-refusals — `undefined === undefined`
      // passes just as well, and did: this test was green against a
      // consumeLinkFor that did not exist yet, because every call threw the
      // same TypeError. Pinning the baseline to the real code is what makes
      // the equalities mean what they say.
      const unknown = await refusalFor('nosuchtokenatall')
      expect(unknown).toEqual({ code: 'INVITE_LINK_INVALID' })
      expect(await refusalFor(expired)).toEqual(unknown)
      expect(await refusalFor(revoked)).toEqual(unknown)
      expect(await refusalFor(gone)).toEqual(unknown)
    })
  })

  test('REFUSES a non-pro joiner already at the free team cap', async () => {
    // THE HOLE THIS CLOSES. completeProfileFor enforces FREE_TEAM_LIMIT during
    // its invited-scan and invitePlayerFor enforces it when parking an address.
    // A link join runs NEITHER, so without this check the link bypasses the cap
    // entirely.
    //
    // And note the behavioural difference from the email path, which is
    // deliberate: an email invite over the cap PARKS the address for a later
    // upgrade. A link cannot park, so it must refuse.
    const t = convexTest(schema, modules)
    await t.run(async (ctx) => {
      const ada = await ctx.db.insert('players', aPlayer())
      const teamId = await ctx.db.insert('teams', aTeam({ playerIds: [ada], owner: ada }))
      const token = await createLinkFor(ctx, ada, teamId)

      const capped = await ctx.db.insert('players', aPlayer({ email: 'capped@example.com' }))
      // DERIVED FROM THE CONSTANT, never a literal 2: a test written against a
      // literal keeps passing straight through a change to the cap, which
      // lib/teamLimits.ts calls out explicitly.
      for (let i = 0; i < FREE_TEAM_LIMIT; i++) {
        await ctx.db.insert('teams', aTeam({ name: `existing ${i}`, playerIds: [capped] }))
      }

      await expect(consumeLinkFor(ctx, capped, token)).rejects.toMatchObject({
        data: { code: 'TEAM_LIMIT_REACHED' },
      })
      expect((await ctx.db.get(teamId))?.playerIds).toEqual([ada])
    })
  })

  test('lets a non-pro joiner one team below the cap in', async () => {
    // THE OTHER SIDE OF THE SAME BOUNDARY. Without this, `mine >= 0` would pass
    // the refusal test above just as well and lock everybody out.
    const t = convexTest(schema, modules)
    await t.run(async (ctx) => {
      const ada = await ctx.db.insert('players', aPlayer())
      const teamId = await ctx.db.insert('teams', aTeam({ playerIds: [ada], owner: ada }))
      const token = await createLinkFor(ctx, ada, teamId)

      const joiner = await ctx.db.insert('players', aPlayer({ email: 'nearly@example.com' }))
      for (let i = 0; i < FREE_TEAM_LIMIT - 1; i++) {
        await ctx.db.insert('teams', aTeam({ name: `existing ${i}`, playerIds: [joiner] }))
      }

      await consumeLinkFor(ctx, joiner, token)
      expect((await ctx.db.get(teamId))?.playerIds).toEqual([ada, joiner])
    })
  })

  test('lets a PRO joiner past the free cap in', async () => {
    const t = convexTest(schema, modules)
    await t.run(async (ctx) => {
      const ada = await ctx.db.insert('players', aPlayer())
      const teamId = await ctx.db.insert('teams', aTeam({ playerIds: [ada], owner: ada }))
      const token = await createLinkFor(ctx, ada, teamId)

      const pro = await ctx.db.insert('players', aPlayer({ email: 'pro@example.com' }))
      await ctx.db.insert('playerMembership', { playerId: pro, membershipStatus: 'pro' })
      for (let i = 0; i < FREE_TEAM_LIMIT + 1; i++) {
        await ctx.db.insert('teams', aTeam({ name: `existing ${i}`, playerIds: [pro] }))
      }

      await consumeLinkFor(ctx, pro, token)
      expect((await ctx.db.get(teamId))?.playerIds).toEqual([ada, pro])
    })
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
export async function consumeLinkFor(
  ctx: WriterCtx,
  playerId: Id<'players'>,
  token: string,
): Promise<void> {
  const link = await ctx.db
    .query('inviteLinks')
    .withIndex('by_token', (q) => q.eq('token', token))
    .unique()

  if (!link || link.revokedAt !== undefined || link.expiresAt < Date.now()) {
    throw accessError('INVITE_LINK_INVALID')
  }

  // THE FOURTH DEAD STATE, ANSWERED WITH THE SAME CODE rather than the
  // INVALID_TEAM the plan named. Two reasons, and it is a deliberate departure.
  // First, INVALID_TEAM's copy is "A team needs a name." — written for a
  // rejected rename, and simply false here. Second, this state is REACHABLE:
  // cascadeDeleteTeam (teams.ts) collects monthlyWinners, scoringSystems, chat
  // history, chatMeta and chatReads, but NOT inviteLinks, so deleting a
  // team leaves every link it ever issued dangling. Answering differently would
  // tell a stranger holding an old link that the team once existed.
  const team = await ctx.db.get(link.teamId)
  if (!team) throw accessError('INVITE_LINK_INVALID')

  // IDEMPOTENT, AND BEFORE THE CAP CHECK. Appending unconditionally would put
  // the same id in the roster twice, which shows the person twice on the team
  // card and enters them twice in recomputeTeamMonth's candidate list — the
  // exact hazard teams.ts:266 records on the email path. Returning here also
  // means a current member is never refused by the cap for a team they are
  // already counted on, and never has a live chat cursor wiped: the same line
  // players.ts draws with its `if (!alreadyMember)`.
  if (team.playerIds.includes(playerId)) return

  // THE CAP, RE-ENFORCED. FREE_TEAM_LIMIT is enforced in exactly two places
  // today and a link join runs NEITHER: completeProfileFor applies it during
  // its invited-scan, and invitePlayerFor applies it when parking an address.
  // Without this the link is a hole the size of the whole cap.
  //
  // REFUSING IS NEW BEHAVIOUR, DELIBERATELY. The email path never refuses — it
  // PARKS the address in teams.invited and continues, and billing.ts's
  // upgradeTeamInvitesFor releases it on upgrade. A link has nowhere to park,
  // so TEAM_LIMIT_REACHED is a new code rather than a reused one.
  if (!(await isProFor(ctx, playerId))) {
    // COUNTED THE WAY completeProfileFor COUNTS IT, not via getMyTeamsFor. That
    // helper resolves every member of every team to build a display payload;
    // this needs a number. Same collect-and-filter scan — Convex cannot index
    // array membership — with none of the fan-out.
    const allTeams = await ctx.db.query('teams').collect()
    const mine = allTeams.filter((t) => t.playerIds.includes(playerId)).length
    if (mine >= FREE_TEAM_LIMIT) throw accessError('TEAM_LIMIT_REACHED')
  }

  // BEFORE THE ROSTER PATCH, so no window exists in which they are a member
  // holding a stale cursor. chat.ts's resetChatCursorFor documents the ordering
  // rule and players.ts:262 follows it on the email path. A previous stint on
  // this team leaves a chatReads row behind — removal never cleans one up,
  // deliberately — saying they have read everything up to the day they left.
  //
  // THAT THE RESET HAPPENS IS COVERED; THAT IT HAPPENS FIRST IS NOT. Swapping
  // these two lines moves no test — planted and confirmed — because both run
  // inside one Convex transaction and nothing in the harness can observe the
  // interleaving. Keeping the order is a code-review obligation, the same kind
  // revokeLinkFor's comment records about its own unobservable check order.
  await resetChatCursorFor(ctx, playerId, team._id)
  await ctx.db.patch(team._id, { playerIds: [...team.playerIds, playerId] })
}
```

Move the added imports up to the existing import block rather than leaving them mid-file. Reuse `access.ts`'s real error codes.


**Two shape requirements this task inherits, both verified:**

1. **Write it as `consumeLinkFor(ctx, playerId, token)` with a thin `consumeLink`
   mutation wrapper**, matching `createLinkFor` / `revokeLinkFor` from the previous
   task and the rest of this codebase. The tests then call the helper directly inside
   `t.run` with no auth setup.
2. **`TEAM_LIMIT_REACHED` is a new code and must reach three files** — the `AccessCode`
   union (`convex/access.ts:43-61`), the hand-maintained `code === '…' ||` allowlist in
   `convexErrorCode` (`src/lib/convex-error.ts:17-36`), and the copy `switch` below it.
   Typecheck catches an omission from the switch, via its exhaustive `never`; it does
   **not** catch an omission from the allowlist, which silently degrades the message to
   the generic recovery text. Verified during the previous task.

- [ ] **Step 4: Run it and watch it pass**

Run from `v2/`: `pnpm vitest run convex/inviteLinks.test.ts`
Expected: PASS, 19 tests in this file.

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

Expected: both `=0`. `src/routes.test.ts` does **not** enumerate every route, so nothing there breaks by default — but **add a block for `/join/$token` anyway**, because that file exists for exactly this case. Its header states its criterion outright: *"THE ROUTES THAT EXIST BECAUSE SOMETHING OUTSIDE THIS REPO POINTS AT THEM."* `/me` is in there because v1 PWA installs open on it.

An invite link is a URL that lives in somebody's chat history, outside this repo and outside our control. If the path is ever renamed, `routeTree.gen.ts` regenerates happily and every link already shared dies silently — the precise failure that file was written to prevent. Follow the `/me` block's shape: assert the route file exists at the expected path, and assert the path appears in the checked-in `routeTree.gen.ts`.

**This will be the first `$param` route in the app** — nothing under `src/routes/` uses the `$` convention yet. Read TanStack's file-naming rules rather than assuming, and confirm the generated tree registers it as `/join/$token` rather than nesting it somewhere unexpected. Note the same nesting hazard that bit `/team`, recorded at `src/routes/team.tsx:30-45`: the generator nests on **any** shared path prefix, so a file named `join.$token.tsx` and a file named `join.tsx` would make one a child of the other.

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

> **Specified 2026-09-07** — an earlier revision said only "opening this dialog directly",
> which does not say where the dialog comes from.

`InvitePlayerDialog` is currently rendered in exactly one place: `CurrentTeamCard:333`, which
lives on `/team`. The onboarding card is on `/app`. So "open it directly" means **mounting a
second instance in `app.tsx`**, and `onInvite` setting its open state instead of navigating.

That is safe here, and it is worth saying why, because this plan already rejected the same
move once: two `CreateTeamDialog`s were refused in the card plan because both would have been
mounted on the **same page**. These two are on **different routes** and can never be mounted
together.

Its props are `{ open, onOpenChange, teamId, teamName }` (`invite-player-dialog.tsx:38-49`),
and `app.tsx` has both — `teamParam` for the id, and the name from the `teams` array it
already holds. Note the invite task only renders when `hasTeam` is true (the prerequisite added
in `qt4.7`), so `teamParam` is guaranteed defined at that callback; state the invariant rather
than casting past it.

Keep the `/team` route working exactly as it does — this adds a second entry point, it does not
move the first.

**This is the app's first use of `navigator.share` and `navigator.clipboard`.** Neither appears
anywhere in `src/` today. Both need feature detection rather than assumption, both require a
secure context, and both can reject — clipboard on a permissions refusal, share on anything
including the user simply dismissing the sheet. The `AbortError` branch in the snippet above is
that last case and must NOT raise an error toast: dismissing a share sheet is a decision, not a
failure.

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

> **PREREQUISITE FOUND IN TASK 4, and this spec cannot pass without it.** The local
> anonymous Convex backend predates `qt4.12`–`qt4.14`, so it answers
> `Could not find public function for 'inviteLinks:createLink'`. The spec must mint a
> real token, so the functions have to reach that deployment first:
>
> ```bash
> CONVEX_DEPLOY_KEY= CONVEX_URL= mise exec node@22.23.2 -- pnpm exec convex dev
> ```
>
> The blank-variable prefix is what targets `anonymous:anonymous-v2` instead of beta —
> `CONVEX_DEPLOY_KEY` sits uncommented in `v2/.env.local`, so a **bare** `convex dev`
> pushes to the live beta deployment. Task 7 of the card plan ran exactly this
> successfully; Task 4's implementer stopped short of it and correctly said so rather
> than claiming the join worked.

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

- [ ] **Step 5: One copy fix, then commit**

`InvitePlayerDialog`'s `DialogDescription` still reads "Enter the player's email address",
which described the whole dialog before `qt4.16` added the share half and now describes
only its top half. One line, and it is the first thing a reader of that dialog sees.

- [ ] **Step 6: Commit and close the issues**

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
