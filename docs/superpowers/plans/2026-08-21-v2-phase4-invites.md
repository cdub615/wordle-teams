# v2 Phase 4 — Invites & Onboarding Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let a person come into existence in v2 and get onto a team — by completing a profile, by being invited, or by leaving one.

**Architecture:** A `players` row is born only when someone submits their name. That one mutation (`completeProfile`) creates the row, claims every invite waiting on their address, and recomputes the months those teams already have winner rows for. Invites live in `convex/teams.ts` beside `removeMember`, because adding and removing people is membership. `players.legacyId` becomes optional and `firstName`/`lastName` become required, which deletes `hasCompleteProfile` and its three must-agree call sites.

**Tech Stack:** Convex (queries/mutations/internal mutations, `convex-test` + vitest), Better Auth via `@convex-dev/better-auth`, `@convex-dev/resend` for email, TanStack Router/Start, React 19, shadcn/Radix, Playwright.

**Spec:** `docs/superpowers/specs/2026-08-21-v2-phase4-invites-design.md` — read it before Task 1.

---

## Ground Rules (read once, apply to every task)

- **Run everything from inside `v2/`.** A build from the repo root builds v1 and dirties the tracked `public/sw.js`.
- **v2's import alias is `#/`, not `@/`.** Convex modules import each other with explicit `.ts` extensions (`./lib/invite.ts`).
- **Never run `convex deploy` or `convex dev`.** `convex-test` is the schema gate. Pushing the branch triggers a GitHub Action that deploys to beta.
- **Never `git push`.** A push deploys. A Phase 3 subagent pushed unprompted and deployed.
- **`pnpm e2e` is not part of `test`/`tsc`/`build`.** Run it after any task touching routes or rendered UI.
- **Never import `convex/fixtures.ts` from a `.test.ts` file's suite** — import it from `./fixtures.ts` only, never from another test file, or that file's whole suite re-runs.
- **This repository is public.** No real email addresses in code, tests, script output or commit messages.
- **Mutation-test your own work.** Before calling a task done, revert your implementation to its previous behaviour and confirm the task's headline test *fails*. Phase 3 shipped a test labelled "the point of the whole feature" that passed against the buggy implementation.
- **If you find a defect in this plan, fix the plan file too**, not just your code. Most Phase 3 defects were in the plan.

**Quality gates** (from `v2/`, after every task):

```bash
pnpm test:once && pnpm exec tsc --noEmit && pnpm build
```

---

## File Structure

**Created:**

| File | Responsibility |
| --- | --- |
| `v2/convex/lib/invite.ts` | Pure: email normalisation, name completeness. No Convex imports |
| `v2/convex/lib/invite.test.ts` | Tests for the above |
| `v2/convex/players.ts` | `completeProfile`, `needsProfile` — the only module that creates a player |
| `v2/convex/players.test.ts` | Tests for the above |
| `v2/convex/inviteEmails.ts` | The invite email's `{subject, text, html}` triple |
| `v2/scripts/cleanup-nameless-players.mjs` | One-off operational runner for `deleteNamelessPlayers` |
| `v2/src/routes/complete-profile.tsx` | The name form and its redirect guards |
| `v2/src/components/teams/invite-player-dialog.tsx` | Ports v1's `InvitePlayer` |
| `v2/e2e/invites.spec.ts` | Invite → sign in → complete profile → land on the team |

**Modified:**

| File | Change |
| --- | --- |
| `v2/convex/schema.ts` | `legacyId` optional; `firstName`/`lastName` required |
| `v2/convex/migrate.ts` | `deleteNamelessPlayers`; `playerInput` requires names |
| `v2/convex/teams.ts` | `invitePlayer`, `cancelInvite`, `getTeamInvites`, `leaveTeam`; `cascadeDeleteTeam` extracted |
| `v2/convex/access.ts` | `INVALID_EMAIL`, `INVALID_NAME`; `NO_PLAYER` doc note |
| `v2/convex/scores.ts`, `v2/convex/winners.ts` | Drop `hasCompleteProfile` |
| `v2/convex/e2eSeed.ts` | Update the stale `legacyId` comment |
| `v2/src/lib/convex-error.ts` | Copy for the two new codes; `NO_PLAYER` message split |
| `v2/src/routes/index.tsx` | `beforeLoad` profile guard |
| `v2/src/components/teams/current-team-card.tsx` | Invite button, Pending section, Leave control |
| `v2/scripts/copy-from-supabase.mjs` | Skip nameless players and emptied teams |

**Deleted:** `v2/convex/lib/player.ts`

---

## Task 0a: `deleteNamelessPlayers` + cleanup script

**Files:**
- Modify: `v2/convex/migrate.ts`
- Create: `v2/convex/migrate.test.ts`
- Create: `v2/scripts/cleanup-nameless-players.mjs`

- [ ] **Step 1: Write the failing test**

Create `v2/convex/migrate.test.ts`:

```ts
import { convexTest } from 'convex-test'
import { describe, expect, test } from 'vitest'
import schema from './schema'
import { aPlayer, aTeam } from './fixtures.ts'
import { internal } from './_generated/api'

const modules = import.meta.glob('./**/*.ts')

describe('deleteNamelessPlayers', () => {
  test('dry run reports counts and writes nothing', async () => {
    const t = convexTest(schema, modules)
    const ada = await t.run(async (ctx) => {
      const nameless = await ctx.db.insert('players', aPlayer({ email: 'x@a.test', firstName: undefined, lastName: undefined }))
      await ctx.db.insert('teams', aTeam({ playerIds: [nameless], creator: nameless }))
      return nameless
    })

    const report = await t.mutation(internal.migrate.deleteNamelessPlayers, { dryRun: true })
    expect(report).toMatchObject({ namelessPlayers: 1, teamsEmptied: 1 })

    await t.run(async (ctx) => {
      expect(await ctx.db.get(ada)).not.toBeNull()
    })
  })

  test('removes the player from rosters, clears creator, and deletes an emptied team', async () => {
    const t = convexTest(schema, modules)
    const { nameless, live, sharedTeam, deadTeam } = await t.run(async (ctx) => {
      const nameless = await ctx.db.insert('players', aPlayer({ email: 'x@a.test', firstName: undefined, lastName: undefined }))
      const live = await ctx.db.insert('players', aPlayer({ email: 'live@a.test' }))
      const sharedTeam = await ctx.db.insert('teams', aTeam({ playerIds: [live, nameless], creator: nameless }))
      const deadTeam = await ctx.db.insert('teams', aTeam({ legacyId: 999, playerIds: [nameless], creator: nameless }))
      return { nameless, live, sharedTeam, deadTeam }
    })

    await t.mutation(internal.migrate.deleteNamelessPlayers, { dryRun: false })

    await t.run(async (ctx) => {
      expect(await ctx.db.get(nameless)).toBeNull()
      expect(await ctx.db.get(deadTeam)).toBeNull()
      const shared = (await ctx.db.get(sharedTeam))!
      expect(shared.playerIds).toEqual([live])
      expect(shared.creator).toBeUndefined()
    })
  })

  test('refuses to run when a nameless player owns a score', async () => {
    const t = convexTest(schema, modules)
    await t.run(async (ctx) => {
      const nameless = await ctx.db.insert('players', aPlayer({ email: 'x@a.test', firstName: undefined, lastName: undefined }))
      await ctx.db.insert('dailyScores', {
        playerId: nameless, puzzleDay: '2026-08-01', date: 0, guesses: [],
      })
    })

    await expect(
      t.mutation(internal.migrate.deleteNamelessPlayers, { dryRun: false }),
    ).rejects.toThrow(/owns dailyScores/)
  })

  test('deletes an emptied team\'s monthlyWinners and scoringSystems but not dailyScores', async () => {
    const t = convexTest(schema, modules)
    const { live, score } = await t.run(async (ctx) => {
      const nameless = await ctx.db.insert('players', aPlayer({ email: 'x@a.test', firstName: undefined, lastName: undefined }))
      const live = await ctx.db.insert('players', aPlayer({ email: 'live@a.test' }))
      const team = await ctx.db.insert('teams', aTeam({ playerIds: [nameless], creator: nameless }))
      await ctx.db.insert('monthlyWinners', { playerId: live, teamId: team, year: 2026, month: 7, hasSeenCelebration: [] })
      await ctx.db.insert('scoringSystems', {
        teamId: team, effectiveFrom: '2026-07',
        oneGuess: 5, twoGuesses: 3, threeGuesses: 2, fourGuesses: 1, fiveGuesses: 0, sixGuesses: -1, failed: -3, nA: 0,
      })
      const score = await ctx.db.insert('dailyScores', {
        playerId: live, puzzleDay: '2026-07-01', date: 0, guesses: [],
      })
      return { live, score }
    })

    await t.mutation(internal.migrate.deleteNamelessPlayers, { dryRun: false })

    await t.run(async (ctx) => {
      expect(await ctx.db.query('monthlyWinners').collect()).toEqual([])
      expect(await ctx.db.query('scoringSystems').collect()).toEqual([])
      expect(await ctx.db.get(score)).not.toBeNull()
    })
  })
})
```

- [ ] **Step 2: Run it to make sure it fails**

```bash
cd v2 && pnpm exec vitest run convex/migrate.test.ts
```

Expected: FAIL — `internal.migrate.deleteNamelessPlayers` is not a function.

- [ ] **Step 3: Implement the mutation**

Append to `v2/convex/migrate.ts` (it already imports `internalMutation` and `v`):

```ts
/**
 * Delete every player with no first or last name, and clean up after them.
 *
 * ONE-OFF, run before players.firstName/lastName are narrowed to required —
 * Convex validates the schema against existing documents on push and rejects a
 * narrowing that any row violates. See the Phase 4 design's "Prerequisite"
 * section for the three-step sequence this is step 1 of.
 *
 * Measured against production 2026-08-20: 151 of 533 players are nameless, and
 * NOT ONE of them owns a dailyScore or a monthlyWinners row. This mutation
 * ASSERTS that rather than trusting it — if the assumption is ever false the
 * right outcome is a refusal, not a silent deletion of somebody's history.
 *
 * Deleting a player doc does NOT touch the Id<'players'> values already sitting
 * in teams.playerIds, so this cleans those explicitly: drop them from every
 * roster, clear `creator` where it pointed at them, and delete a team left with
 * no members at all (cascading its monthlyWinners and scoringSystems the way
 * deleteTeamFor does; dailyScores belong to players and survive).
 */
export const deleteNamelessPlayers = internalMutation({
  args: { dryRun: v.boolean() },
  handler: async (ctx, { dryRun }) => {
    const players = await ctx.db.query('players').collect()
    const nameless = players.filter((p) => !p.firstName || !p.lastName)
    const namelessIds = new Set(nameless.map((p) => p._id))

    for (const player of nameless) {
      const score = await ctx.db
        .query('dailyScores')
        .withIndex('by_player_and_puzzleDay', (q) => q.eq('playerId', player._id))
        .first()
      if (score) throw new Error(`Refusing: a nameless player owns dailyScores`)

      const winner = await ctx.db
        .query('monthlyWinners')
        .withIndex('by_player', (q) => q.eq('playerId', player._id))
        .first()
      if (winner) throw new Error(`Refusing: a nameless player owns monthlyWinners`)
    }

    const teams = await ctx.db.query('teams').collect()
    let teamsEmptied = 0
    let rostersCleaned = 0
    let creatorsCleared = 0

    for (const team of teams) {
      const remaining = team.playerIds.filter((id) => !namelessIds.has(id))
      const creatorGone = team.creator !== undefined && namelessIds.has(team.creator)
      if (remaining.length === team.playerIds.length && !creatorGone) continue

      if (remaining.length === 0) {
        teamsEmptied++
        if (!dryRun) {
          const winners = await ctx.db
            .query('monthlyWinners')
            .withIndex('by_team_year_month', (q) => q.eq('teamId', team._id))
            .collect()
          for (const row of winners) await ctx.db.delete(row._id)

          const systems = await ctx.db
            .query('scoringSystems')
            .withIndex('by_team_and_effectiveFrom', (q) => q.eq('teamId', team._id))
            .collect()
          for (const row of systems) await ctx.db.delete(row._id)

          await ctx.db.delete(team._id)
        }
        continue
      }

      if (remaining.length !== team.playerIds.length) rostersCleaned++
      if (creatorGone) creatorsCleared++
      if (!dryRun) {
        await ctx.db.patch(team._id, {
          playerIds: remaining,
          ...(creatorGone ? { creator: undefined } : {}),
        })
      }
    }

    if (!dryRun) {
      for (const player of nameless) await ctx.db.delete(player._id)
    }

    // Counts only. This output is pasted into design docs and issues, and the
    // repository is public.
    return {
      dryRun,
      namelessPlayers: nameless.length,
      teamsEmptied,
      rostersCleaned,
      creatorsCleared,
    }
  },
})
```

- [ ] **Step 4: Run the tests and make sure they pass**

```bash
cd v2 && pnpm exec vitest run convex/migrate.test.ts
```

Expected: PASS, 4 tests.

- [ ] **Step 5: Write the operational runner**

Create `v2/scripts/cleanup-nameless-players.mjs`:

```js
#!/usr/bin/env node
/**
 * Runs migrate:deleteNamelessPlayers against a deployment. Step 2 of the Phase 4
 * schema sequence — see the design's "Prerequisite" section.
 *
 * Dry run by default. Pass --commit to actually write.
 *
 *   node scripts/cleanup-nameless-players.mjs
 *   node scripts/cleanup-nameless-players.mjs --commit
 *
 * Required environment: CONVEX_URL, CONVEX_MIGRATION_KEY.
 *
 * NOTE: `.env.local` at the repo root holds TWO sets of these under the same
 * names — the prod set commented out and above, the dev set active below. Beta
 * runs on the PROD set, and the cloud dev deployment has no functions deployed
 * at all. Load the prod block with:
 *
 *   set -a; . <(sed -n 's/^#[[:space:]]*\([A-Za-z_][A-Za-z0-9_]*=.*\)/\1/p' ../.env.local); set +a
 *
 * This deliberately does NOT use `npx convex run`, which demands
 * deployment:data:view — a permission no key in this repo carries. The admin
 * HTTP path needs only runInternalMutations, which CONVEX_MIGRATION_KEY has.
 *
 * PRINTS COUNTS, NEVER ADDRESSES. This repository is public.
 */
import { ConvexHttpClient } from 'convex/browser'
import { internal } from '../convex/_generated/api.js'

const commit = process.argv.includes('--commit')
const CONVEX_URL = process.env.CONVEX_URL
const CONVEX_MIGRATION_KEY = process.env.CONVEX_MIGRATION_KEY

if (!CONVEX_URL || !CONVEX_MIGRATION_KEY) {
  console.error('Set CONVEX_URL and CONVEX_MIGRATION_KEY (see the header note).')
  process.exit(1)
}

const client = new ConvexHttpClient(CONVEX_URL)
client.setAdminAuth(CONVEX_MIGRATION_KEY)

console.log(`target   : ${new URL(CONVEX_URL).host}`)
console.log(`mode     : ${commit ? 'COMMIT (writes)' : 'dry run'}`)

const report = await client.mutation(internal.migrate.deleteNamelessPlayers, {
  dryRun: !commit,
})

console.log(report)
if (!commit && report.namelessPlayers > 0) {
  console.log('\nRe-run with --commit to apply.')
}
```

- [ ] **Step 6: Verify the script parses and the gates pass**

```bash
cd v2 && node --check scripts/cleanup-nameless-players.mjs && pnpm test:once && pnpm exec tsc --noEmit
```

Expected: no output from `--check`; tests and typecheck pass.

- [ ] **Step 7: Commit**

```bash
git add v2/convex/migrate.ts v2/convex/migrate.test.ts v2/scripts/cleanup-nameless-players.mjs
git commit -m "feat(v2): deleteNamelessPlayers + cleanup runner (wt-ksh.5.1)"
```

---

## Task 0b: Run the cleanup (OPERATIONAL — controller only)

**This task writes to a live deployment. A subagent must not perform it.** The controller runs it between Task 0a's commit and Task 0c's schema change.

- [ ] **Step 1: Push so the mutation exists on beta**

The GitHub Action deploys on push. This is the sanctioned deploy path.

- [ ] **Step 2: Dry run against beta**

```bash
cd v2 && (set -a; . <(sed -n 's/^#[[:space:]]*\([A-Za-z_][A-Za-z0-9_]*=.*\)/\1/p' ../.env.local); set +a; node scripts/cleanup-nameless-players.mjs)
```

Expected: `namelessPlayers: 0`. Beta holds 18 players / 7 teams, made of the `--scope=mine` copy plus `e2eSeed` rows, and `e2eSeed` always writes both names.

- [ ] **Step 3: If the count is non-zero, stop and report**

A non-zero count is a finding, not a routine step — it means beta holds nameless rows nobody predicted. Report the counts before running `--commit`.

- [ ] **Step 4: If non-zero and understood, apply**

```bash
cd v2 && (set -a; . <(sed -n 's/^#[[:space:]]*\([A-Za-z_][A-Za-z0-9_]*=.*\)/\1/p' ../.env.local); set +a; node scripts/cleanup-nameless-players.mjs --commit)
```

---

## Task 0c: Narrow the schema, widen `legacyId`, filter the copy

**Files:**
- Modify: `v2/convex/schema.ts:29-42`
- Modify: `v2/convex/migrate.ts` (`playerInput`)
- Modify: `v2/scripts/copy-from-supabase.mjs`
- Modify: `v2/convex/schema.test.ts`

- [ ] **Step 1: Write the failing test**

Append to `v2/convex/schema.test.ts`:

```ts
describe('players name requirement', () => {
  test('rejects an insert with no firstName', async () => {
    const t = convexTest(schema, modules)
    await expect(
      t.run(async (ctx) => {
        await ctx.db.insert('players', {
          email: 'x@a.test',
          lastName: 'Lovelace',
          hasPwa: false,
          reminderDeliveryMethods: ['email'],
          reminderDeliveryTime: '10:00:00',
        } as never)
      }),
    ).rejects.toThrow()
  })

  test('accepts an insert with no legacyId', async () => {
    const t = convexTest(schema, modules)
    await t.run(async (ctx) => {
      const id = await ctx.db.insert('players', {
        email: 'x@a.test',
        firstName: 'Ada',
        lastName: 'Lovelace',
        hasPwa: false,
        reminderDeliveryMethods: ['email'],
        reminderDeliveryTime: '10:00:00',
      })
      expect((await ctx.db.get(id))!.legacyId).toBeUndefined()
    })
  })
})
```

If `schema.test.ts` lacks them, add at the top: `import { describe, expect, test } from 'vitest'`, `import { convexTest } from 'convex-test'`, `import schema from './schema'`, and `const modules = import.meta.glob('./**/*.ts')`.

- [ ] **Step 2: Run it to make sure it fails**

```bash
cd v2 && pnpm exec vitest run convex/schema.test.ts
```

Expected: FAIL — the no-`legacyId` insert is rejected, and the no-`firstName` insert is accepted.

- [ ] **Step 3: Change the schema**

In `v2/convex/schema.ts`, replace the `players` table definition's first four fields:

```ts
  players: defineTable({
    // OPTIONAL SINCE PHASE 4, for the reason teams.legacyId is optional since
    // Phase 3 and dailyScores.legacyId since Phase 2: a player who signs up in
    // v2 has no Supabase identity to carry, and inventing a sentinel would fake
    // one. Absence is meaningful — `legacyId === undefined` means "born in v2,
    // not copied", which is what Phase 7's row-count reconciliation needs. The
    // copy is unaffected: it matches on by_legacyId, and native rows correctly
    // never match.
    //
    // Before this, v2 could not create a person AT ALL — the only writers were
    // the Supabase copy and e2eSeed, so both cold signup and the invite flow
    // dead-ended. See wt-ksh.5.1.
    legacyId: v.optional(v.string()),
    email: v.string(), // always lowercase; auth stores it that way

    // REQUIRED SINCE PHASE 4. A player cannot exist unnamed.
    //
    // v1 created the row at signup from a Postgres trigger, nameless, and filled
    // the name in later at /complete-profile — so 151 of production's 533
    // players have no name. Not one of them has ever entered a board or won a
    // month, and all 29 teams they created are dead, so the copy simply skips
    // them (see copy-from-supabase.mjs).
    //
    // This is what deleted lib/player.ts's hasCompleteProfile, whose own doc
    // comment warned that its three call sites — the scoreboard, the team card
    // and the winner computation — had to agree or the three views of "who is on
    // this team" would disagree. They cannot drift if the state cannot exist.
    firstName: v.string(),
    lastName: v.string(),
```

- [ ] **Step 4: Run the test to verify it passes**

```bash
cd v2 && pnpm exec vitest run convex/schema.test.ts
```

Expected: PASS.

- [ ] **Step 5: Require names at the copy's validator**

In `v2/convex/migrate.ts`, change `playerInput`:

```ts
const playerInput = v.object({
  legacyId: v.string(),
  email: v.string(),
  // Required, matching the schema. The script filters nameless players out
  // before they reach here; this is the second gate, so a filter regression
  // fails loudly at the boundary instead of inserting a row the schema will
  // later reject.
  firstName: v.string(),
  lastName: v.string(),
  hasPwa: v.boolean(),
  timeZone: v.optional(v.string()),
  reminderDeliveryMethods: v.array(v.string()),
  reminderDeliveryTime: v.string(),
  lastBoardEntryReminder: v.optional(v.number()),
  createdAt: v.optional(v.number()),
})
```

- [ ] **Step 6: Filter the copy script**

In `v2/scripts/copy-from-supabase.mjs`, find where player rows are mapped for `upsertPlayers` and filter first. Add immediately before that mapping:

```js
// Skip players with no name. v1 created a row at signup and collected the name
// later, so production carries 151 nameless players — none of whom has ever
// entered a board or won a month, and all 29 teams they created are dead.
// players.firstName/lastName are required in v2 (Phase 4), so copying one would
// be rejected by the schema. upsertTeams already drops member uuids with no
// matching player, so rosters clean themselves; a team left with no members at
// all is dropped below.
const namedPlayers = players.filter((p) => p.first_name && p.last_name)
const skippedNameless = players.length - namedPlayers.length
```

Use `namedPlayers` in place of `players` for the `upsertPlayers` call, and add to the run summary:

```js
console.log(`players skipped (no name)  : ${skippedNameless}`)
```

Then, where team rows are built, drop teams whose roster is empty after filtering:

```js
// A team whose every member was skipped has nobody who can see or administer
// it. Copying it would leave an unreachable row that still counts against the
// free tier and still turns up in a parity reconciliation.
const namedIds = new Set(namedPlayers.map((p) => p.id))
const liveTeams = teams.filter((t) => (t.player_ids ?? []).some((id) => namedIds.has(id)))
console.log(`teams skipped (no members) : ${teams.length - liveTeams.length}`)
```

Use `liveTeams` in place of `teams` for the `upsertTeams` call.

- [ ] **Step 7: Verify with a dry run and the gates**

```bash
cd v2 && node --check scripts/copy-from-supabase.mjs && pnpm test:once && pnpm exec tsc --noEmit
```

Expected: `--check` silent. **`pnpm test:once` will now FAIL** in `scores.test.ts`, `winners.test.ts` and `teams.test.ts` — those suites insert nameless players to exercise `hasCompleteProfile`. That is expected and Task 0d fixes it. Record which tests fail; do not delete them yet.

- [ ] **Step 8: Commit**

```bash
git add v2/convex/schema.ts v2/convex/schema.test.ts v2/convex/migrate.ts v2/scripts/copy-from-supabase.mjs
git commit -m "feat(v2)!: players.legacyId optional, firstName/lastName required (wt-ksh.5.1)"
```

---

## Task 0d: Delete `hasCompleteProfile` and its three call sites

**Files:**
- Delete: `v2/convex/lib/player.ts`
- Modify: `v2/convex/scores.ts:5,70-72`
- Modify: `v2/convex/winners.ts:1,96-98`
- Modify: `v2/convex/teams.ts:11,71-74`
- Modify: `v2/convex/e2eSeed.ts`
- Modify: `v2/convex/scores.test.ts`, `v2/convex/winners.test.ts`, `v2/convex/teams.test.ts`

- [ ] **Step 1: Remove the filter from `winners.ts`**

Delete the import on line 1 (`import { hasCompleteProfile } from './lib/player.ts'`) and replace the guard inside `recomputeTeamMonth`:

```ts
    const member = await ctx.db.get(memberId)
    // A member id with no document is still possible — a scoped copy legitimately
    // omits players — and is a DIFFERENT check from the name filter that used to
    // sit here. players.firstName/lastName are required since Phase 4, so a
    // nameless member cannot exist; a missing one still can.
    if (!member) continue
```

- [ ] **Step 2: Remove the filter from `scores.ts`**

Delete the `hasCompleteProfile` import (line 5) and replace the guard around line 70:

```ts
      const member = await ctx.db.get(memberId)
      // See winners.ts: a missing document is still possible in a scoped copy.
      // The name filter that used to sit here is gone — the state cannot exist.
      if (!member) return null
```

- [ ] **Step 3: Remove the filter from `teams.ts`**

Delete the `hasCompleteProfile` import (line 11) and replace the guard in `getMyTeamsFor`:

```ts
          const member = await ctx.db.get(memberId)
          // See winners.ts: a missing document is still possible in a scoped
          // copy. The name filter that used to sit here is gone.
          if (!member) return null
          return { id: member._id, firstName: member.firstName, lastName: member.lastName }
```

- [ ] **Step 4: Delete the module**

```bash
cd v2 && rm convex/lib/player.ts
```

- [ ] **Step 5: Update `e2eSeed.ts`'s stale comment**

Around line 21, replace the paragraph explaining the synthetic legacyId:

```ts
 * legacyId is a synthetic value here on purpose. It is no longer REQUIRED —
 * players.legacyId and teams.legacyId became optional in Phases 4 and 3 — but
 * an `e2e-` prefixed value is a useful marker that a row is test data, and
 * absence now means something specific ("born in v2"), which a seeded row is
 * not. Keep writing it.
```

- [ ] **Step 6: Fix the three test suites**

The failing tests from Task 0c Step 7 assert that a nameless member is excluded. That behaviour is gone, and the state is now unrepresentable. For each failing test:

- If it asserts "a nameless member is excluded from the scoreboard / team card / winner computation", **delete the test** — it pins a filter that no longer exists.
- If it merely *constructs* a nameless player as incidental setup, give it a name.

Replace each deleted test with one asserting the surviving behaviour, e.g. in `v2/convex/teams.test.ts`:

```ts
  test('omits a member whose player document is missing', async () => {
    // The scoped-copy case: an id in playerIds with no corresponding document.
    // This is what survives of the old profile-completeness filter.
    const t = convexTest(schema, modules)
    await t.run(async (ctx) => {
      const ada = await ctx.db.insert('players', aPlayer())
      const ghost = await ctx.db.insert('players', aPlayer({ email: 'ghost@a.test' }))
      await ctx.db.insert('teams', aTeam({ playerIds: [ada, ghost], creator: ada }))
      await ctx.db.delete(ghost)

      const [team] = await getMyTeamsFor(ctx, ada)
      expect(team.members.map((m) => m.id)).toEqual([ada])
    })
  })
```

- [ ] **Step 7: Run the full gates**

```bash
cd v2 && pnpm test:once && pnpm exec tsc --noEmit && pnpm build
```

Expected: all green. `tsc` proves no import of the deleted module survives.

- [ ] **Step 8: Commit**

```bash
git add -A v2/convex
git commit -m "refactor(v2): delete hasCompleteProfile — the state it filtered is now unrepresentable"
```

---

## Task 1: `convex/lib/invite.ts`

**Files:**
- Create: `v2/convex/lib/invite.ts`
- Create: `v2/convex/lib/invite.test.ts`

- [ ] **Step 1: Write the failing test**

Create `v2/convex/lib/invite.test.ts`:

```ts
import { describe, expect, test } from 'vitest'
import { isCompleteName, normaliseInviteEmail } from './invite.ts'

describe('normaliseInviteEmail', () => {
  test('trims and lowercases', () => {
    expect(normaliseInviteEmail('  Ada.Lovelace@Example.TEST ')).toBe('ada.lovelace@example.test')
  })

  test('accepts an already-normal address unchanged', () => {
    expect(normaliseInviteEmail('ada@example.test')).toBe('ada@example.test')
  })

  test('rejects empty, whitespace and malformed input', () => {
    expect(normaliseInviteEmail('')).toBeNull()
    expect(normaliseInviteEmail('   ')).toBeNull()
    expect(normaliseInviteEmail('ada')).toBeNull()
    expect(normaliseInviteEmail('ada@')).toBeNull()
    expect(normaliseInviteEmail('ada@example')).toBeNull()
    expect(normaliseInviteEmail('a b@example.test')).toBeNull()
  })
})

describe('isCompleteName', () => {
  test('accepts ordinary names', () => {
    expect(isCompleteName('Ada', 'Lovelace')).toBe(true)
  })

  test('accepts a ONE-CHARACTER name', () => {
    // v1 saves any non-empty name but guards the redirect on length > 1, so a
    // one-character name saves and then redirects to /complete-profile forever.
    // The guard and the validation share this function precisely so that the
    // loop cannot exist. Do not "tighten" this to length > 1.
    expect(isCompleteName('X', 'Y')).toBe(true)
  })

  test('rejects empty or whitespace-only parts', () => {
    expect(isCompleteName('', 'Lovelace')).toBe(false)
    expect(isCompleteName('Ada', '')).toBe(false)
    expect(isCompleteName('   ', 'Lovelace')).toBe(false)
    expect(isCompleteName('Ada', '   ')).toBe(false)
  })
})
```

- [ ] **Step 2: Run it to make sure it fails**

```bash
cd v2 && pnpm exec vitest run convex/lib/invite.test.ts
```

Expected: FAIL — cannot resolve `./invite.ts`.

- [ ] **Step 3: Implement**

Create `v2/convex/lib/invite.ts`:

```ts
/**
 * Invite-address and profile-name rules.
 *
 * DEPENDENCY-FREE, like everything else in convex/lib/ — no Convex imports, so
 * both the server functions and the route guard can use it.
 */

// Deliberately permissive: one @, no whitespace, and a dot in the domain. This
// is a typo guard, not an RFC 5322 validator — the real proof that an address
// works is that the invite email arrives, and over-strict client-side email
// regexes reject valid addresses far more often than they catch bad ones.
const EMAIL_SHAPE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/

/**
 * An invite address, normalised, or null if it is not usable.
 *
 * LOWERCASING IS THE FIX FOR A REAL BUG, not tidiness. v1 stored teams.invited
 * as typed and matched it case-sensitively, while auth stores emails lowercased
 * — so anyone invited at a mixed-case address silently never joined their team.
 * That is a data-model bug, not a platform one, and a faithful port reproduces
 * it. See amendment A2 and scripts/verify-case-fix-dev.mjs.
 *
 * Normalise on WRITE (here) and compare case-insensitively on READ, so copied
 * rows that predate v1's own fix cannot slip through either.
 */
export function normaliseInviteEmail(raw: string): string | null {
  const trimmed = raw.trim().toLowerCase()
  return EMAIL_SHAPE.test(trimmed) ? trimmed : null
}

/**
 * Whether a submitted profile name is complete.
 *
 * ONE function, used by BOTH completeProfile's validation and the needsProfile
 * route guard. If they ever disagree, a name that saves does not clear the
 * guard and the user is redirected to /complete-profile forever. v1 has exactly
 * that latent bug — it accepts any non-empty name but guards on `length > 1`.
 */
export function isCompleteName(firstName: string, lastName: string): boolean {
  return firstName.trim().length > 0 && lastName.trim().length > 0
}
```

- [ ] **Step 4: Run the test to verify it passes**

```bash
cd v2 && pnpm exec vitest run convex/lib/invite.test.ts
```

Expected: PASS, 7 tests.

- [ ] **Step 5: Commit**

```bash
git add v2/convex/lib/invite.ts v2/convex/lib/invite.test.ts
git commit -m "feat(v2): invite address normalisation and name completeness (A2)"
```

---

## Task 2: `completeProfile` + `needsProfile`

**Files:**
- Create: `v2/convex/players.ts`
- Create: `v2/convex/players.test.ts`
- Modify: `v2/convex/access.ts`
- Modify: `v2/src/lib/convex-error.ts`

**Blocks Tasks 6 and 7.**

- [ ] **Step 1: Add the error codes**

In `v2/convex/access.ts`, extend `AccessCode`:

```ts
export type AccessCode =
  | 'UNAUTHENTICATED'
  | 'NO_PLAYER'
  | 'NOT_A_MEMBER'
  | 'INVALID_BOARD'
  | 'NOT_TEAM_CREATOR'
  | 'INVALID_TEAM'
  | 'INVALID_DATE'
  | 'CREATOR_NOT_REMOVABLE'
  | 'INVALID_SYSTEM'
  | 'INVALID_EMAIL'
  | 'INVALID_NAME'
```

- [ ] **Step 2: Run tsc to watch the exhaustive switch break**

```bash
cd v2 && pnpm exec tsc --noEmit
```

Expected: FAIL in `src/lib/convex-error.ts` — `Type 'AccessCode' is not assignable to type 'never'`. That check is deliberate and is doing its job.

- [ ] **Step 3: Give the new codes copy, and split `NO_PLAYER`**

In `v2/src/lib/convex-error.ts`, add both codes to `convexErrorCode`'s allow-list:

```ts
    code === 'INVALID_SYSTEM' ||
    code === 'INVALID_EMAIL' ||
    code === 'INVALID_NAME'
```

Then in `typedCodeMessage`, separate `NO_PLAYER` from `UNAUTHENTICATED` and add the two new cases:

```ts
    case 'UNAUTHENTICATED':
      return 'Your session expired. Please sign in again.'
    case 'NO_PLAYER':
      // NOT "your session expired". Their session is fine — they simply have no
      // player record yet, and signing in again does not help. Before Phase 4
      // this was a dead end: a cold signup reached the dashboard, pressed the
      // only call to action, and got a message describing the wrong problem.
      return 'Finish setting up your profile to continue.'
    ...
    case 'INVALID_EMAIL':
      return 'That does not look like an email address.'
    case 'INVALID_NAME':
      return 'Enter both a first and a last name.'
```

- [ ] **Step 4: Write the failing test**

Create `v2/convex/players.test.ts`:

```ts
import { convexTest } from 'convex-test'
import { describe, expect, test } from 'vitest'
import schema from './schema'
import { aPlayer, aTeam } from './fixtures.ts'
import { completeProfileFor } from './players.ts'
import { toPuzzleDay } from './lib/puzzleDay.ts'

const modules = import.meta.glob('./**/*.ts')
const today = toPuzzleDay(new Date())

describe('completeProfileFor', () => {
  test('creates a player with no legacyId', async () => {
    const t = convexTest(schema, modules)
    await t.run(async (ctx) => {
      const id = await completeProfileFor(
        ctx, 'ada@example.test', { firstName: 'Ada', lastName: 'Lovelace' }, today,
      )
      const player = (await ctx.db.get(id))!
      expect(player.email).toBe('ada@example.test')
      expect(player.firstName).toBe('Ada')
      expect(player.legacyId).toBeUndefined()
      // v1's Postgres column defaults, which handle_new_user relied on.
      expect(player.hasPwa).toBe(false)
      expect(player.reminderDeliveryMethods).toEqual(['email'])
      expect(player.reminderDeliveryTime).toBe('10:00:00')
    })
  })

  test('is idempotent — a second call patches rather than duplicating', async () => {
    const t = convexTest(schema, modules)
    await t.run(async (ctx) => {
      const first = await completeProfileFor(
        ctx, 'ada@example.test', { firstName: 'Ada', lastName: 'Lovelace' }, today,
      )
      const second = await completeProfileFor(
        ctx, 'ada@example.test', { firstName: 'Ada B', lastName: 'Lovelace' }, today,
      )
      expect(second).toEqual(first)
      expect((await ctx.db.query('players').collect()).length).toBe(1)
      expect((await ctx.db.get(first))!.firstName).toBe('Ada B')
    })
  })

  test('claims an invite stored at a MIXED-CASE address from the lowercase account', async () => {
    // A2's hard acceptance criterion. v1 stored teams.invited as typed and
    // matched case-sensitively while auth lowercased addresses, so a mixed-case
    // invitee silently never joined. A copied row can still carry mixed case.
    const t = convexTest(schema, modules)
    await t.run(async (ctx) => {
      const creator = await ctx.db.insert('players', aPlayer({ email: 'creator@example.test' }))
      const team = await ctx.db.insert(
        'teams',
        aTeam({ playerIds: [creator], creator, invited: ['Ada.Lovelace@Example.TEST'] }),
      )

      const ada = await completeProfileFor(
        ctx, 'ada.lovelace@example.test', { firstName: 'Ada', lastName: 'Lovelace' }, today,
      )

      const updated = (await ctx.db.get(team))!
      expect(updated.playerIds).toContain(ada)
      expect(updated.invited).toEqual([])
    })
  })

  test('claims invites across several teams at once', async () => {
    const t = convexTest(schema, modules)
    await t.run(async (ctx) => {
      const creator = await ctx.db.insert('players', aPlayer({ email: 'creator@example.test' }))
      const one = await ctx.db.insert('teams', aTeam({ playerIds: [creator], creator, invited: ['ada@example.test'] }))
      const two = await ctx.db.insert('teams', aTeam({ legacyId: 207, playerIds: [creator], creator, invited: ['ada@example.test'] }))

      const ada = await completeProfileFor(
        ctx, 'ada@example.test', { firstName: 'Ada', lastName: 'Lovelace' }, today,
      )

      expect((await ctx.db.get(one))!.playerIds).toContain(ada)
      expect((await ctx.db.get(two))!.playerIds).toContain(ada)
    })
  })

  test('recomputes a claimed team\'s existing winner rows', async () => {
    // wt-ksh.5.2. The joiner becomes eligible for months the team already has a
    // winner row for; without this every one of them stays wrong forever.
    const t = convexTest(schema, modules)
    await t.run(async (ctx) => {
      const creator = await ctx.db.insert('players', aPlayer({ email: 'creator@example.test' }))
      const team = await ctx.db.insert(
        'teams',
        aTeam({ playerIds: [creator], creator, invited: ['ada@example.test'] }),
      )
      // The creator has one mediocre board in July; the joiner has a better one.
      await ctx.db.insert('dailyScores', {
        playerId: creator, puzzleDay: '2026-07-02', date: 0, guesses: ['aaaaa', 'aaaaa', 'aaaaa', 'aaaaa', 'crane'], answer: 'crane',
      })
      const stale = await ctx.db.insert('monthlyWinners', {
        playerId: creator, teamId: team, year: 2026, month: 7, hasSeenCelebration: [],
      })

      const adaEmail = 'ada@example.test'
      const ada = await ctx.db.insert('players', aPlayer({ email: adaEmail, firstName: 'Ada', lastName: 'L' }))
      await ctx.db.insert('dailyScores', {
        playerId: ada, puzzleDay: '2026-07-02', date: 0, guesses: ['crane'], answer: 'crane',
      })
      await ctx.db.delete(ada)

      await completeProfileFor(ctx, adaEmail, { firstName: 'Ada', lastName: 'L' }, '2026-07-31')

      const row = (await ctx.db.get(stale))!
      expect(row.playerId).not.toBe(creator)
    })
  })

  test('does not add the player twice if they are already a member', async () => {
    const t = convexTest(schema, modules)
    await t.run(async (ctx) => {
      const ada = await ctx.db.insert('players', aPlayer({ email: 'ada@example.test' }))
      const team = await ctx.db.insert(
        'teams',
        aTeam({ playerIds: [ada], creator: ada, invited: ['ada@example.test'] }),
      )

      await completeProfileFor(ctx, 'ada@example.test', { firstName: 'Ada', lastName: 'L' }, today)

      const updated = (await ctx.db.get(team))!
      expect(updated.playerIds).toEqual([ada])
      expect(updated.invited).toEqual([])
    })
  })
})
```

Note the fifth test builds its scores against a player it then deletes, so the *claim* is what makes those boards count. If that proves awkward in practice, seed the boards after the claim and recompute — but the assertion (`the stale winner row changed`) must not be weakened.

- [ ] **Step 5: Run it to make sure it fails**

```bash
cd v2 && pnpm exec vitest run convex/players.test.ts
```

Expected: FAIL — cannot resolve `./players.ts`.

- [ ] **Step 6: Implement**

Create `v2/convex/players.ts`:

```ts
import { v } from 'convex/values'
import { mutation, query } from './_generated/server'
import { authComponent } from './auth'
import { accessError, playerForEmail, requirePlausibleToday } from './access'
import { isCompleteName } from './lib/invite.ts'
import { monthsWithWinners, recomputeTeamMonths } from './winners.ts'
import type { Id } from './_generated/dataModel'
import type { WriterCtx } from './winners.ts'
import type { PuzzleDay } from './lib/puzzleDay.ts'

/**
 * Player identity and onboarding. Phase 4 (wt-ksh.5).
 *
 * THIS MODULE IS THE ONLY PLACE A PLAYER IS BORN, other than the Supabase copy
 * and e2eSeed. Before it existed, players.legacyId was a required Supabase auth
 * uuid, so v2 could not bring a person into existence at all — which blocked the
 * invite flow, not merely cold signup (wt-ksh.5.1).
 *
 * A row is created only when someone submits their name. That is narrower than
 * v1, which created a nameless row from a Postgres trigger at signup and
 * collected the name later, and it is what lets players.firstName/lastName be
 * required — which in turn deleted hasCompleteProfile and the three-call-site
 * agreement hazard it warned about.
 */

/** v1's Postgres column defaults, which handle_new_user relied on. */
const NEW_PLAYER_DEFAULTS = {
  hasPwa: false,
  reminderDeliveryMethods: ['email'],
  reminderDeliveryTime: '10:00:00',
} as const

/**
 * Create or update the player behind an email, then claim their invites.
 *
 * `email` must already be lowercased by the caller — it comes from the session.
 *
 * ORDER MATTERS. The player must exist before invites are claimed, and the
 * claim must happen before the recompute, because the recompute's answer
 * depends on the roster the claim just changed.
 */
export async function completeProfileFor(
  ctx: WriterCtx,
  email: string,
  names: { firstName: string; lastName: string },
  today: PuzzleDay,
): Promise<Id<'players'>> {
  const existing = await playerForEmail(ctx, email)
  const playerId = existing
    ? (await ctx.db.patch(existing._id, names), existing._id)
    : await ctx.db.insert('players', {
        email,
        ...names,
        ...NEW_PLAYER_DEFAULTS,
        createdAt: Date.now(),
        // No legacyId. Absence means "born in v2, not copied" — see schema.ts.
      })

  // Collect-and-filter is the sanctioned approach for "teams mentioning X":
  // Convex cannot index array membership. See the schema comment on `teams`.
  const allTeams = await ctx.db.query('teams').collect()
  const claimed = []

  for (const team of allTeams) {
    // COMPARED CASE-INSENSITIVELY, even though normaliseInviteEmail lowercases
    // on write: rows copied from v1 predate its own case fix, so the stored
    // value cannot be assumed normal. This is the read half of A2.
    if (!team.invited.some((entry) => entry.toLowerCase() === email)) continue

    await ctx.db.patch(team._id, {
      invited: team.invited.filter((entry) => entry.toLowerCase() !== email),
      // Guarded: a copied row could list the address in `invited` AND the
      // player in `playerIds`, and adding a duplicate id would show them twice
      // on the roster and count them twice in the month.
      playerIds: team.playerIds.includes(playerId)
        ? team.playerIds
        : [...team.playerIds, playerId],
    })
    claimed.push((await ctx.db.get(team._id))!)
  }

  // wt-ksh.5.2: the joiner is now eligible for every month these teams already
  // have a winner row for. Without this, each of those months stays wrong
  // forever — monthsWithWinners does not help on its own, because the joiner was
  // excluded from every computation that produced those rows.
  for (const team of claimed) {
    await recomputeTeamMonths(ctx, team, await monthsWithWinners(ctx, team._id), today)
  }

  return playerId
}

export const completeProfile = mutation({
  args: { firstName: v.string(), lastName: v.string(), today: v.string() },
  handler: async (ctx, args) => {
    // NOT requirePlayer: there is no player yet, which is the entire point.
    const user = await authComponent.getAuthUser(ctx)
    if (!user?.email) throw accessError('UNAUTHENTICATED')

    const today = requirePlausibleToday(args.today)
    const firstName = args.firstName.trim()
    const lastName = args.lastName.trim()
    if (!isCompleteName(firstName, lastName)) throw accessError('INVALID_NAME')

    return await completeProfileFor(
      ctx,
      user.email.toLowerCase(),
      { firstName, lastName },
      today,
    )
  },
})

/**
 * Whether the signed-in user still needs to complete their profile.
 *
 * Drives the redirect guard on both `/` and `/complete-profile`. Returns false
 * when unauthenticated, because that is `/login`'s business, not this guard's —
 * returning true would bounce a signed-out visitor into an onboarding form.
 */
export const needsProfile = query({
  args: {},
  handler: async (ctx) => {
    const user = await authComponent.getAuthUser(ctx)
    if (!user?.email) return false
    return (await playerForEmail(ctx, user.email)) === null
  },
})
```

- [ ] **Step 7: Run the tests to verify they pass**

```bash
cd v2 && pnpm exec vitest run convex/players.test.ts
```

Expected: PASS, 6 tests.

- [ ] **Step 8: Mutation-test the recompute**

Comment out the `for (const team of claimed)` recompute loop. Re-run. The "recomputes a claimed team's existing winner rows" test **must fail**. Restore it.

- [ ] **Step 9: Run the gates and commit**

```bash
cd v2 && pnpm test:once && pnpm exec tsc --noEmit && pnpm build
git add v2/convex/players.ts v2/convex/players.test.ts v2/convex/access.ts v2/src/lib/convex-error.ts
git commit -m "feat(v2): completeProfile creates the player and claims invites (wt-ksh.5.1, wt-ksh.5.2)"
```

---

## Task 3: `invitePlayer` + the invite email

**Files:**
- Create: `v2/convex/inviteEmails.ts`
- Modify: `v2/convex/teams.ts`
- Modify: `v2/convex/teams.test.ts`

- [ ] **Step 1: Write the email module**

Create `v2/convex/inviteEmails.ts`:

```ts
// The team-invite email. Kept out of teams.ts so the copy can be read and
// changed without picking through mutation logic — the same split authEmails.ts
// makes for the sign-in code.
//
// Hand-written HTML rather than react-email, matching authEmails.ts. The design
// named react-email for this phase; it is deferred to Phase 6, where reminders
// add a third and fourth email and actually make the case for a component
// library. Two emails written the same way beats two email systems.

/**
 * @param teamName   the team they are being invited to
 * @param inviterName the inviter's first name — v1's Supabase template was
 *                    anonymous, and "Ada invited you" is far more legible than
 *                    "You have been invited"
 * @param signInUrl  where to go. There is no token: the invite lives in
 *                   teams.invited, and completing a profile at that address is
 *                   what claims it. Same model as v1, minus the Supabase magic
 *                   link whose PKCE round-trip was one of the three causes of
 *                   v1's invite->join failure (amendment A2).
 */
export function teamInviteEmail({
  teamName,
  inviterName,
  signInUrl,
}: {
  teamName: string
  inviterName: string
  signInUrl: string
}) {
  const subject = `${inviterName} invited you to ${teamName} on Wordle Teams`

  // A plain-text part is not optional politeness: some clients render it by
  // preference, and a mail with no text alternative scores worse with spam
  // filters.
  const text = [
    `${inviterName} invited you to join ${teamName} on Wordle Teams.`,
    '',
    `Sign in with this email address to join: ${signInUrl}`,
    '',
    "If you don't know who that is, you can ignore this email.",
    '',
    'Wordle Teams',
    'https://wordleteams.com',
  ].join('\n')

  const html = `<!doctype html>
<html lang="en">
  <body style="margin:0;padding:24px;background:#f6f7f9;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif;color:#1c2024;">
    <table role="presentation" cellpadding="0" cellspacing="0" style="max-width:480px;margin:0 auto;background:#ffffff;border-radius:12px;padding:32px;">
      <tr>
        <td>
          <p style="margin:0 0 8px;font-size:14px;color:#6b7280;">Wordle Teams</p>
          <h1 style="margin:0 0 24px;font-size:20px;font-weight:600;">You&rsquo;ve been invited to ${teamName}</h1>
          <p style="margin:0 0 24px;font-size:15px;line-height:1.6;">${inviterName} invited you to join <strong>${teamName}</strong> on Wordle Teams.</p>
          <p style="margin:0 0 24px;">
            <a href="${signInUrl}" style="display:inline-block;background:#1c2024;color:#ffffff;text-decoration:none;padding:12px 20px;border-radius:8px;font-size:15px;font-weight:600;">Join the team</a>
          </p>
          <p style="margin:0 0 24px;font-size:14px;line-height:1.6;color:#6b7280;">Sign in with this email address and the team will be waiting for you.</p>
          <p style="margin:0;font-size:13px;line-height:1.6;color:#6b7280;">
            If you don&rsquo;t know who that is, you can ignore this email.
          </p>
        </td>
      </tr>
    </table>
  </body>
</html>`

  return { subject, text, html }
}
```

- [ ] **Step 2: Write the failing test**

Append to `v2/convex/teams.test.ts` (add `invitePlayerFor` to the existing `./teams.ts` import):

```ts
describe('invitePlayerFor', () => {
  const setup = async (ctx: any, over: Record<string, unknown> = {}) => {
    const creator = await ctx.db.insert('players', aPlayer({ email: 'creator@example.test', firstName: 'Cara' }))
    const team = await ctx.db.insert('teams', aTeam({ playerIds: [creator], creator, ...over }))
    return { creator, team }
  }

  test('adds an existing player straight to the team', async () => {
    const t = convexTest(schema, modules)
    await t.run(async (ctx) => {
      const { creator, team } = await setup(ctx)
      const ada = await ctx.db.insert('players', aPlayer({ email: 'ada@example.test', firstName: 'Ada' }))

      const outcome = await invitePlayerFor(ctx, creator, {
        teamId: team, email: 'ada@example.test', today,
      })

      expect(outcome).toMatchObject({ status: 'added', firstName: 'Ada' })
      expect((await ctx.db.get(team))!.playerIds).toContain(ada)
      expect((await ctx.db.get(team))!.invited).toEqual([])
    })
  })

  test('matches an existing player case-insensitively', async () => {
    const t = convexTest(schema, modules)
    await t.run(async (ctx) => {
      const { creator, team } = await setup(ctx)
      const ada = await ctx.db.insert('players', aPlayer({ email: 'ada@example.test' }))

      const outcome = await invitePlayerFor(ctx, creator, {
        teamId: team, email: '  Ada@Example.TEST ', today,
      })

      expect(outcome.status).toBe('added')
      expect((await ctx.db.get(team))!.playerIds).toContain(ada)
    })
  })

  test('reports already_member and changes nothing', async () => {
    const t = convexTest(schema, modules)
    await t.run(async (ctx) => {
      const { creator, team } = await setup(ctx)
      const before = (await ctx.db.get(team))!

      const outcome = await invitePlayerFor(ctx, creator, {
        teamId: team, email: 'creator@example.test', today,
      })

      expect(outcome).toEqual({ status: 'already_member' })
      expect((await ctx.db.get(team))!.playerIds).toEqual(before.playerIds)
    })
  })

  test('parks an unknown address in invited, lowercased', async () => {
    const t = convexTest(schema, modules)
    await t.run(async (ctx) => {
      const { creator, team } = await setup(ctx)

      const outcome = await invitePlayerFor(ctx, creator, {
        teamId: team, email: 'New.Person@Example.TEST', today,
      })

      expect(outcome).toMatchObject({ status: 'invited', email: 'new.person@example.test' })
      expect((await ctx.db.get(team))!.invited).toEqual(['new.person@example.test'])
    })
  })

  test('reports resent for an address already invited, without duplicating it', async () => {
    const t = convexTest(schema, modules)
    await t.run(async (ctx) => {
      const { creator, team } = await setup(ctx, { invited: ['new.person@example.test'] })

      const outcome = await invitePlayerFor(ctx, creator, {
        teamId: team, email: 'new.person@example.test', today,
      })

      expect(outcome.status).toBe('resent')
      expect((await ctx.db.get(team))!.invited).toEqual(['new.person@example.test'])
    })
  })

  test('rejects a malformed address', async () => {
    const t = convexTest(schema, modules)
    await t.run(async (ctx) => {
      const { creator, team } = await setup(ctx)
      await expect(
        invitePlayerFor(ctx, creator, { teamId: team, email: 'not-an-email', today }),
      ).rejects.toThrow()
    })
  })

  test('refuses a member who is not the creator', async () => {
    const t = convexTest(schema, modules)
    await t.run(async (ctx) => {
      const creator = await ctx.db.insert('players', aPlayer({ email: 'creator@example.test' }))
      const bob = await ctx.db.insert('players', aPlayer({ email: 'bob@example.test' }))
      const team = await ctx.db.insert('teams', aTeam({ playerIds: [creator, bob], creator }))

      await expect(
        invitePlayerFor(ctx, bob, { teamId: team, email: 'ada@example.test', today }),
      ).rejects.toThrow()
    })
  })

  test('recomputes existing winner rows when an existing player is added', async () => {
    const t = convexTest(schema, modules)
    await t.run(async (ctx) => {
      const { creator, team } = await setup(ctx)
      await ctx.db.insert('dailyScores', {
        playerId: creator, puzzleDay: '2026-07-02', date: 0,
        guesses: ['aaaaa', 'aaaaa', 'aaaaa', 'aaaaa', 'crane'], answer: 'crane',
      })
      const stale = await ctx.db.insert('monthlyWinners', {
        playerId: creator, teamId: team, year: 2026, month: 7, hasSeenCelebration: [],
      })

      const ada = await ctx.db.insert('players', aPlayer({ email: 'ada@example.test' }))
      await ctx.db.insert('dailyScores', {
        playerId: ada, puzzleDay: '2026-07-02', date: 0, guesses: ['crane'], answer: 'crane',
      })

      await invitePlayerFor(ctx, creator, { teamId: team, email: 'ada@example.test', today: '2026-07-31' })

      expect((await ctx.db.get(stale))!.playerId).toBe(ada)
    })
  })
})
```

- [ ] **Step 3: Run it to make sure it fails**

```bash
cd v2 && pnpm exec vitest run convex/teams.test.ts -t invitePlayerFor
```

Expected: FAIL — `invitePlayerFor` is not exported.

- [ ] **Step 4: Implement**

Add to `v2/convex/teams.ts`. Extend the imports:

```ts
import { normaliseInviteEmail } from './lib/invite.ts'
import { playerForEmail } from './access'
import { resend } from './email'
import { teamInviteEmail } from './inviteEmails.ts'
```

Then append:

```ts
/**
 * What an invite actually did. A discriminated result rather than void, because
 * four different things can happen and v1 reports all of them as
 * "Successfully invited player" — including the case where nothing happened at
 * all, which is an outright lie. Divergence 9.
 *
 * `added` carries firstName because it confirms the address matched a real
 * account, which is the most useful thing to learn after inviting by email.
 * `invited`/`resent` carry what the mutation needs to compose the email.
 */
export type InviteOutcome =
  | { status: 'already_member' }
  | { status: 'added'; firstName: string }
  | { status: 'invited'; email: string; teamName: string; inviterName: string }
  | { status: 'resent'; email: string; teamName: string; inviterName: string }

/**
 * Invite someone to a team. Creator-only.
 *
 * Ports v1's invitePlayer, whose three branches are kept and whose reporting is
 * not. The email SEND is left to the mutation wrapper so this helper stays
 * db-only and testable through convex-test's ctx.run — the same split every
 * other `...For` helper in this module uses.
 *
 * NO EMAIL IS SENT when an existing player is added directly. That is v1's
 * behaviour: they are simply on the team next time they look. Recorded in the
 * design as parity, deliberately kept.
 */
export async function invitePlayerFor(
  ctx: WriterCtx,
  playerId: Id<'players'>,
  args: { teamId: Id<'teams'>; email: string; today: PuzzleDay },
): Promise<InviteOutcome> {
  const team = await requireTeamCreatorFor(ctx, playerId, args.teamId)
  const today = requirePlausibleToday(args.today)
  const email = normaliseInviteEmail(args.email)
  if (!email) throw accessError('INVALID_EMAIL')

  const inviter = await ctx.db.get(playerId)
  const inviterName = inviter?.firstName ?? 'Someone'

  const existing = await playerForEmail(ctx, email)
  if (existing) {
    if (team.playerIds.includes(existing._id)) return { status: 'already_member' }

    await ctx.db.patch(team._id, { playerIds: [...team.playerIds, existing._id] })
    // The new member is immediately eligible to have won past months — the
    // mirror of removeMember's recompute, and divergence 5 in the same way.
    const updated = (await ctx.db.get(team._id))!
    await recomputeTeamMonths(ctx, updated, await monthsWithWinners(ctx, team._id), today)
    return { status: 'added', firstName: existing.firstName }
  }

  const alreadyInvited = team.invited.some((entry) => entry.toLowerCase() === email)
  if (!alreadyInvited) {
    await ctx.db.patch(team._id, { invited: [...team.invited, email] })
  }
  return {
    status: alreadyInvited ? 'resent' : 'invited',
    email,
    teamName: team.name,
    inviterName,
  }
}

export const invitePlayer = mutation({
  args: { teamId: v.id('teams'), email: v.string(), today: v.string() },
  handler: async (ctx, args): Promise<InviteOutcome> => {
    const player = await requirePlayer(ctx)
    const outcome = await invitePlayerFor(ctx, player._id, args)

    if (outcome.status === 'invited' || outcome.status === 'resent') {
      const siteUrl = process.env.SITE_URL
      if (!siteUrl) throw new Error('SITE_URL is not set on this deployment')
      const { subject, text, html } = teamInviteEmail({
        teamName: outcome.teamName,
        inviterName: outcome.inviterName,
        signInUrl: `${siteUrl}/login`,
      })
      // resend.sendEmail accepts a MutationCtx, so this enqueues inside the same
      // transaction as the `invited` write above — no action hop, and no way to
      // park an address without mailing it or vice versa.
      await resend.sendEmail(ctx, {
        from: 'Wordle Teams <invites@wordleteams.com>',
        to: outcome.email,
        subject,
        text,
        html,
      })
    }

    return outcome
  },
})
```

- [ ] **Step 5: Run the tests to verify they pass**

```bash
cd v2 && pnpm exec vitest run convex/teams.test.ts
```

Expected: PASS.

- [ ] **Step 6: Mutation-test the case-insensitive match**

Change `normaliseInviteEmail` to skip `.toLowerCase()`. The "matches an existing player case-insensitively" and "parks an unknown address in invited, lowercased" tests **must fail**. Restore it.

- [ ] **Step 7: Run the gates and commit**

```bash
cd v2 && pnpm test:once && pnpm exec tsc --noEmit && pnpm build
git add v2/convex/teams.ts v2/convex/teams.test.ts v2/convex/inviteEmails.ts
git commit -m "feat(v2): invitePlayer with four reported outcomes (A2)"
```

---

## Task 4: `cancelInvite` + `getTeamInvites`

**Files:**
- Modify: `v2/convex/teams.ts`
- Modify: `v2/convex/teams.test.ts`

- [ ] **Step 1: Write the failing test**

Append to `v2/convex/teams.test.ts`:

```ts
describe('cancelInviteFor / getTeamInvitesFor', () => {
  test('the creator sees pending invites', async () => {
    const t = convexTest(schema, modules)
    await t.run(async (ctx) => {
      const creator = await ctx.db.insert('players', aPlayer({ email: 'creator@example.test' }))
      const team = await ctx.db.insert('teams', aTeam({ playerIds: [creator], creator, invited: ['a@example.test'] }))

      expect(await getTeamInvitesFor(ctx, creator, team)).toEqual(['a@example.test'])
    })
  })

  test('a member who is not the creator is refused by the QUERY', async () => {
    // Not merely a hidden button: these are real email addresses.
    const t = convexTest(schema, modules)
    await t.run(async (ctx) => {
      const creator = await ctx.db.insert('players', aPlayer({ email: 'creator@example.test' }))
      const bob = await ctx.db.insert('players', aPlayer({ email: 'bob@example.test' }))
      const team = await ctx.db.insert('teams', aTeam({ playerIds: [creator, bob], creator, invited: ['a@example.test'] }))

      await expect(getTeamInvitesFor(ctx, bob, team)).rejects.toThrow()
    })
  })

  test('cancel removes the address, case-insensitively', async () => {
    const t = convexTest(schema, modules)
    await t.run(async (ctx) => {
      const creator = await ctx.db.insert('players', aPlayer({ email: 'creator@example.test' }))
      const team = await ctx.db.insert('teams', aTeam({
        playerIds: [creator], creator, invited: ['Keep@example.test', 'drop@example.test'],
      }))

      await cancelInviteFor(ctx, creator, { teamId: team, email: 'DROP@Example.TEST' })

      expect((await ctx.db.get(team))!.invited).toEqual(['Keep@example.test'])
    })
  })

  test('a member who is not the creator cannot cancel', async () => {
    const t = convexTest(schema, modules)
    await t.run(async (ctx) => {
      const creator = await ctx.db.insert('players', aPlayer({ email: 'creator@example.test' }))
      const bob = await ctx.db.insert('players', aPlayer({ email: 'bob@example.test' }))
      const team = await ctx.db.insert('teams', aTeam({ playerIds: [creator, bob], creator, invited: ['a@example.test'] }))

      await expect(
        cancelInviteFor(ctx, bob, { teamId: team, email: 'a@example.test' }),
      ).rejects.toThrow()
    })
  })
})
```

Add `cancelInviteFor` and `getTeamInvitesFor` to the `./teams.ts` import.

- [ ] **Step 2: Run it to make sure it fails**

```bash
cd v2 && pnpm exec vitest run convex/teams.test.ts -t cancelInviteFor
```

Expected: FAIL — not exported.

- [ ] **Step 3: Implement**

Append to `v2/convex/teams.ts`:

```ts
/**
 * The addresses invited to a team but not yet joined. CREATOR-ONLY.
 *
 * Deliberately NOT folded into getMyTeams. That query picks its fields
 * explicitly so `invited` cannot reach the wire (see getMyTeamsFor), it is
 * fetched by every connected client, and these are real email addresses. This
 * is a separate, creator-scoped read of one team.
 *
 * v1 exposes this nowhere — a creator cannot see who they invited, tell a typo
 * from a slow responder, or cancel. Divergence 6.
 */
export async function getTeamInvitesFor(
  ctx: ReaderCtx,
  playerId: Id<'players'>,
  teamId: Id<'teams'>,
): Promise<Array<string>> {
  const team = await requireTeamCreatorFor(ctx, playerId, teamId)
  return team.invited
}

export const getTeamInvites = query({
  args: { teamId: v.id('teams') },
  handler: async (ctx, { teamId }) => {
    const player = await requirePlayer(ctx)
    return await getTeamInvitesFor(ctx, player._id, teamId)
  },
})

/**
 * Withdraw a pending invite. Creator-only.
 *
 * Compared case-insensitively for the same reason completeProfileFor is: copied
 * rows predate v1's own case fix, so a stored address cannot be assumed
 * lowercase, and an invite that cannot be cancelled is exactly the trap this
 * surface exists to remove.
 */
export async function cancelInviteFor(
  ctx: WriterCtx,
  playerId: Id<'players'>,
  args: { teamId: Id<'teams'>; email: string },
): Promise<void> {
  const team = await requireTeamCreatorFor(ctx, playerId, args.teamId)
  const email = normaliseInviteEmail(args.email)
  if (!email) throw accessError('INVALID_EMAIL')

  await ctx.db.patch(team._id, {
    invited: team.invited.filter((entry) => entry.toLowerCase() !== email),
  })
}

export const cancelInvite = mutation({
  args: { teamId: v.id('teams'), email: v.string() },
  handler: async (ctx, args) => {
    const player = await requirePlayer(ctx)
    await cancelInviteFor(ctx, player._id, args)
  },
})
```

- [ ] **Step 4: Run the tests to verify they pass**

```bash
cd v2 && pnpm exec vitest run convex/teams.test.ts
```

Expected: PASS.

- [ ] **Step 5: Run the gates and commit**

```bash
cd v2 && pnpm test:once && pnpm exec tsc --noEmit && pnpm build
git add v2/convex/teams.ts v2/convex/teams.test.ts
git commit -m "feat(v2): pending invites are visible and cancellable by the creator (wt-ksh.5.3)"
```

---

## Task 5: `leaveTeam`

**Files:**
- Modify: `v2/convex/teams.ts` (extract `cascadeDeleteTeam`, add `leaveTeamFor`)
- Modify: `v2/convex/teams.test.ts`

- [ ] **Step 1: Write the failing test**

Append to `v2/convex/teams.test.ts` (add `leaveTeamFor` to the import):

```ts
describe('leaveTeamFor', () => {
  test('a member removes themselves', async () => {
    const t = convexTest(schema, modules)
    await t.run(async (ctx) => {
      const creator = await ctx.db.insert('players', aPlayer({ email: 'creator@example.test' }))
      const bob = await ctx.db.insert('players', aPlayer({ email: 'bob@example.test' }))
      const team = await ctx.db.insert('teams', aTeam({ playerIds: [creator, bob], creator }))

      await leaveTeamFor(ctx, bob, { teamId: team, today })

      expect((await ctx.db.get(team))!.playerIds).toEqual([creator])
    })
  })

  test('the creator cannot leave', async () => {
    // Their exit is deleteTeam. This keeps the Phase 3 invariant that a team
    // always has an administrator.
    const t = convexTest(schema, modules)
    await t.run(async (ctx) => {
      const creator = await ctx.db.insert('players', aPlayer({ email: 'creator@example.test' }))
      const bob = await ctx.db.insert('players', aPlayer({ email: 'bob@example.test' }))
      const team = await ctx.db.insert('teams', aTeam({ playerIds: [creator, bob], creator }))

      await expect(leaveTeamFor(ctx, creator, { teamId: team, today })).rejects.toThrow()
      expect((await ctx.db.get(team))!.playerIds).toContain(creator)
    })
  })

  test('a non-member is refused', async () => {
    const t = convexTest(schema, modules)
    await t.run(async (ctx) => {
      const creator = await ctx.db.insert('players', aPlayer({ email: 'creator@example.test' }))
      const stranger = await ctx.db.insert('players', aPlayer({ email: 'stranger@example.test' }))
      const team = await ctx.db.insert('teams', aTeam({ playerIds: [creator], creator }))

      await expect(leaveTeamFor(ctx, stranger, { teamId: team, today })).rejects.toThrow()
    })
  })

  test('recomputes every month with a winner row', async () => {
    const t = convexTest(schema, modules)
    await t.run(async (ctx) => {
      const creator = await ctx.db.insert('players', aPlayer({ email: 'creator@example.test' }))
      const bob = await ctx.db.insert('players', aPlayer({ email: 'bob@example.test' }))
      const team = await ctx.db.insert('teams', aTeam({ playerIds: [creator, bob], creator }))

      await ctx.db.insert('dailyScores', {
        playerId: bob, puzzleDay: '2026-07-02', date: 0, guesses: ['crane'], answer: 'crane',
      })
      await ctx.db.insert('dailyScores', {
        playerId: creator, puzzleDay: '2026-07-02', date: 0,
        guesses: ['aaaaa', 'aaaaa', 'aaaaa', 'aaaaa', 'crane'], answer: 'crane',
      })
      const row = await ctx.db.insert('monthlyWinners', {
        playerId: bob, teamId: team, year: 2026, month: 7, hasSeenCelebration: [],
      })

      await leaveTeamFor(ctx, bob, { teamId: team, today: '2026-07-31' })

      // Bob was the winner and is gone; the row must now name the creator.
      expect((await ctx.db.get(row))!.playerId).toBe(creator)
    })
  })

  test('the last member of a creator-less team deletes it and cascades', async () => {
    // The scoped-copy case: `creator` is undefined, so nobody is refused and the
    // team can be emptied. Leaving an unreachable orphan would be worse.
    const t = convexTest(schema, modules)
    await t.run(async (ctx) => {
      const bob = await ctx.db.insert('players', aPlayer({ email: 'bob@example.test' }))
      const team = await ctx.db.insert('teams', aTeam({ playerIds: [bob], creator: undefined }))
      await ctx.db.insert('monthlyWinners', {
        playerId: bob, teamId: team, year: 2026, month: 7, hasSeenCelebration: [],
      })
      await ctx.db.insert('scoringSystems', {
        teamId: team, effectiveFrom: '2026-07',
        oneGuess: 5, twoGuesses: 3, threeGuesses: 2, fourGuesses: 1, fiveGuesses: 0, sixGuesses: -1, failed: -3, nA: 0,
      })
      const score = await ctx.db.insert('dailyScores', {
        playerId: bob, puzzleDay: '2026-07-02', date: 0, guesses: ['crane'], answer: 'crane',
      })

      await leaveTeamFor(ctx, bob, { teamId: team, today })

      expect(await ctx.db.get(team)).toBeNull()
      expect(await ctx.db.query('monthlyWinners').collect()).toEqual([])
      expect(await ctx.db.query('scoringSystems').collect()).toEqual([])
      // A board belongs to the player and is shared across every team.
      expect(await ctx.db.get(score)).not.toBeNull()
    })
  })
})
```

- [ ] **Step 2: Run it to make sure it fails**

```bash
cd v2 && pnpm exec vitest run convex/teams.test.ts -t leaveTeamFor
```

Expected: FAIL — not exported.

- [ ] **Step 3: Extract the cascade from `deleteTeamFor`**

In `v2/convex/teams.ts`, add above `deleteTeamFor`:

```ts
/**
 * Delete a team and the rows that belong to it.
 *
 * Postgres has ON DELETE CASCADE on monthly_winners.team_id; Convex has no such
 * thing, so the rows have to go explicitly or they become unreachable orphans
 * that still count against the free tier and still turn up in a parity
 * reconciliation.
 *
 * dailyScores are NOT deleted. A board belongs to a player and is shared across
 * every team they are on — daily_scores has no team foreign key in Postgres
 * either — so deleting a team must never destroy anybody's history.
 *
 * Shared by deleteTeamFor and by leaveTeamFor's creator-less last-member case.
 */
async function cascadeDeleteTeam(ctx: WriterCtx, teamId: Id<'teams'>): Promise<void> {
  const winners = await ctx.db
    .query('monthlyWinners')
    .withIndex('by_team_year_month', (q) => q.eq('teamId', teamId))
    .collect()
  for (const row of winners) await ctx.db.delete(row._id)

  const systems = await ctx.db
    .query('scoringSystems')
    .withIndex('by_team_and_effectiveFrom', (q) => q.eq('teamId', teamId))
    .collect()
  for (const row of systems) await ctx.db.delete(row._id)

  await ctx.db.delete(teamId)
}
```

Then replace `deleteTeamFor`'s body below its `requireTeamCreatorFor` call with:

```ts
  await cascadeDeleteTeam(ctx, team._id)
```

and shorten its own doc comment to point at `cascadeDeleteTeam` for the cascade reasoning.

- [ ] **Step 4: Implement `leaveTeamFor`**

Append to `v2/convex/teams.ts`:

```ts
/**
 * Remove yourself from a team.
 *
 * THE ONE TEAM MUTATION THAT IS NOT CREATOR-ONLY, and the mirror of
 * removeMember: that one lets the creator remove anybody but themselves, this
 * one lets anybody remove only themselves.
 *
 * v1 has no such affordance at any layer — its UI hides remove on your own row
 * and the only exit is asking the creator. Owner-sanctioned; divergence 10.
 *
 * THE CREATOR CANNOT LEAVE. Their exit is deleteTeam. That keeps the invariant
 * that a team always has somebody who can administer it, and it means no team
 * can be emptied by leaving — except the creator-less case below.
 */
export async function leaveTeamFor(
  ctx: WriterCtx,
  playerId: Id<'players'>,
  args: { teamId: Id<'teams'>; today: PuzzleDay },
): Promise<void> {
  const team = await requireTeamMemberFor(ctx, playerId, args.teamId)
  const today = requirePlausibleToday(args.today)
  if (team.creator === playerId) throw accessError('CREATOR_NOT_REMOVABLE')

  const remaining = team.playerIds.filter((memberId) => memberId !== playerId)

  // A scoped copy may omit `creator` (schema comment, Phase 1), so a
  // creator-less team refuses nobody and CAN be emptied. Deleting it is better
  // than leaving a row nobody can see, join or administer.
  if (remaining.length === 0) {
    await cascadeDeleteTeam(ctx, team._id)
    return
  }

  await ctx.db.patch(team._id, { playerIds: remaining })

  // The leaver stops being eligible to have won any month — divergence 5, the
  // same reason removeMember recomputes.
  const updated = (await ctx.db.get(team._id))!
  await recomputeTeamMonths(ctx, updated, await monthsWithWinners(ctx, team._id), today)
}

export const leaveTeam = mutation({
  args: { teamId: v.id('teams'), today: v.string() },
  handler: async (ctx, args) => {
    const player = await requirePlayer(ctx)
    await leaveTeamFor(ctx, player._id, args)
  },
})
```

Add `requireTeamMemberFor` to the `./access` import.

- [ ] **Step 5: Run the tests to verify they pass**

```bash
cd v2 && pnpm exec vitest run convex/teams.test.ts
```

Expected: PASS. The pre-existing `deleteTeamFor` tests must still pass — that proves the cascade extraction changed nothing.

- [ ] **Step 6: Mutation-test the creator guard**

Delete the `if (team.creator === playerId) throw` line. The "creator cannot leave" test **must fail**. Restore it.

- [ ] **Step 7: Run the gates and commit**

```bash
cd v2 && pnpm test:once && pnpm exec tsc --noEmit && pnpm build
git add v2/convex/teams.ts v2/convex/teams.test.ts
git commit -m "feat(v2): leaveTeam — a member can remove themselves (divergence 10)"
```

---

## Task 6: `/complete-profile` route + dashboard guard

**Files:**
- Create: `v2/src/routes/complete-profile.tsx`
- Modify: `v2/src/routes/index.tsx:40-42`

- [ ] **Step 1: Create the route**

Create `v2/src/routes/complete-profile.tsx`:

```tsx
import { createFileRoute, redirect, useNavigate } from '@tanstack/react-router'
import { convexQuery, useConvexMutation } from '@convex-dev/react-query'
import { useMutation } from '@tanstack/react-query'
import { useState, type FormEventHandler } from 'react'
import { Loader2 } from 'lucide-react'
import { toast } from 'sonner'
import { api } from '../../convex/_generated/api'
import { pageTitle } from '#/lib/seo'
import { Button } from '#/components/ui/button.tsx'
import { Input } from '#/components/ui/input.tsx'
import { Label } from '#/components/ui/label.tsx'
import { mutationErrorMessage } from '#/lib/convex-error.ts'
import { isCompleteName } from '../../convex/lib/invite.ts'
import { toPuzzleDay } from '../../convex/lib/puzzleDay.ts'

/**
 * The one screen every v2 account passes through, because completeProfile is
 * what CREATES the player row (see convex/players.ts).
 *
 * Ports v1's /complete-profile, which A7 makes a sanctioned parity exception —
 * this is the onboarding surface, and it is the largest measured leak in the
 * product (wordle-teams-456: 87% of prod signups never enter a board).
 */
export const Route = createFileRoute('/complete-profile')({
  head: () => ({ meta: [{ title: pageTitle('Complete Profile') }] }),
  beforeLoad: async ({ context }) => {
    if (!context.isAuthenticated) throw redirect({ to: '/login' })
    const needsProfile = await context.queryClient.ensureQueryData(
      convexQuery(api.players.needsProfile, {}),
    )
    // Already have a player? Nothing to complete.
    if (!needsProfile) throw redirect({ to: '/' })
  },
  component: CompleteProfilePage,
})

function CompleteProfilePage() {
  const navigate = useNavigate()
  const complete = useMutation({ mutationFn: useConvexMutation(api.players.completeProfile) })
  const [firstName, setFirstName] = useState('')
  const [lastName, setLastName] = useState('')
  const [submitting, setSubmitting] = useState(false)

  // The SAME predicate the server validates with and the route guard reads, via
  // one shared function. If they disagreed, a name that saves would not clear
  // the guard and the user would bounce back here forever — which is v1's own
  // latent bug (it saves any non-empty name but guards on length > 1).
  const canSubmit = isCompleteName(firstName, lastName) && !submitting

  const handleSubmit: FormEventHandler<HTMLFormElement> = async (event) => {
    event.preventDefault()
    setSubmitting(true)
    try {
      await complete.mutateAsync({
        firstName,
        lastName,
        today: toPuzzleDay(new Date()),
      })
      await navigate({ to: '/' })
    } catch (error) {
      toast.error(mutationErrorMessage(error, 'Could not save your profile, please try again'))
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <main className="mt-24 flex justify-center px-6">
      <div className="w-full max-w-lg">
        <h1 className="text-center text-3xl leading-loose font-semibold md:text-4xl">
          Complete Your Profile
        </h1>
        <p className="text-muted-foreground text-center">
          Please provide your name to complete your profile
        </p>
        <form onSubmit={handleSubmit}>
          <div className="my-6 flex flex-col space-y-4 md:flex-row md:space-y-0 md:space-x-6">
            <div className="w-full">
              <Label htmlFor="firstName">First Name</Label>
              <Input
                id="firstName"
                name="firstName"
                type="text"
                autoComplete="given-name"
                required
                value={firstName}
                onChange={(event) => setFirstName(event.target.value)}
              />
            </div>
            <div className="w-full">
              <Label htmlFor="lastName">Last Name</Label>
              <Input
                id="lastName"
                name="lastName"
                type="text"
                autoComplete="family-name"
                required
                value={lastName}
                onChange={(event) => setLastName(event.target.value)}
              />
            </div>
          </div>
          <div className="flex justify-end">
            <Button type="submit" variant="secondary" disabled={!canSubmit} aria-disabled={!canSubmit}>
              {submitting && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
              Submit
            </Button>
          </div>
        </form>
      </div>
    </main>
  )
}
```

- [ ] **Step 2: Add the dashboard guard**

In `v2/src/routes/index.tsx`, replace `beforeLoad`:

```ts
  beforeLoad: async ({ context }) => {
    if (!context.isAuthenticated) throw redirect({ to: '/login' })
    // Every dashboard query assumes a player exists. Before Phase 4 a cold
    // signup reached this page anyway — getMyTeams returns [] rather than
    // throwing — pressed the one call to action, and got NO_PLAYER. See
    // wt-ksh.5.1.
    const needsProfile = await context.queryClient.ensureQueryData(
      convexQuery(api.players.needsProfile, {}),
    )
    if (needsProfile) throw redirect({ to: '/complete-profile' })
  },
```

- [ ] **Step 3: Verify the route tree regenerates and the gates pass**

```bash
cd v2 && pnpm exec tsc --noEmit && pnpm build
```

Expected: PASS. `routeTree.gen.ts` picks up the new route via the vite plugin — do not run `tsr generate` by hand (see the note in `package.json`).

- [ ] **Step 4: Drive it in the browser**

```bash
cd v2 && pnpm dev
```

Kill strays first with `lsof -ti :3000 | xargs -r kill` — a second `pnpm dev` silently binds 3001 and you end up testing a stale server.

Sign in as a never-before-seen e2e address with `E2E_TEST_MODE` on. Expected: you land on `/complete-profile`, not the dashboard. Submit a name. Expected: you land on the dashboard with the empty state and **Create a Team works**.

Then test the loop that v1 gets wrong: submit a one-character first and last name. Expected: it saves and you reach the dashboard — no bounce back.

- [ ] **Step 5: Screenshot light and dark on a touch viewport**

Capture `/complete-profile` at 390×844 with touch emulation, in both themes. Wait for any animation to settle before capturing. Check for a horizontal scrollbar — a page-wide one is the exact class of bug Phase 3's gate caught.

- [ ] **Step 6: Commit**

```bash
git add v2/src/routes/complete-profile.tsx v2/src/routes/index.tsx v2/src/routeTree.gen.ts
git commit -m "feat(v2): /complete-profile route and dashboard profile guard (wt-ksh.5.1)"
```

---

## Task 7: Invite dialog, Pending section, Leave control

**Files:**
- Create: `v2/src/components/teams/invite-player-dialog.tsx`
- Modify: `v2/src/components/teams/current-team-card.tsx`
- Modify: `v2/src/routes/index.tsx`

- [ ] **Step 1: Create the invite dialog**

Create `v2/src/components/teams/invite-player-dialog.tsx`:

```tsx
import { useEffect, useState } from 'react'
import { Loader2 } from 'lucide-react'
import { toast } from 'sonner'
import { useConvexMutation } from '@convex-dev/react-query'
import { useMutation } from '@tanstack/react-query'
import type { FormEventHandler } from 'react'
import { api } from '../../../convex/_generated/api'
import { Button } from '#/components/ui/button.tsx'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '#/components/ui/dialog.tsx'
import { Input } from '#/components/ui/input.tsx'
import { Label } from '#/components/ui/label.tsx'
import { mutationErrorMessage } from '#/lib/convex-error.ts'
import { useVisualViewport } from '#/lib/use-visual-viewport.ts'
import { toPuzzleDay } from '../../../convex/lib/puzzleDay.ts'
import type { Id } from '../../../convex/_generated/dataModel'

/**
 * Invite someone by email. Ports v1's invite-player.tsx.
 *
 * FOUR OUTCOMES, FOUR MESSAGES. v1 reports all of them as "Successfully invited
 * player" — including `already_member`, where nothing happened at all.
 * Divergence 9.
 *
 * `already_member` is the one that keeps the dialog OPEN: nothing the user
 * wanted actually happened, and the likeliest next action is correcting the
 * address, so closing would make them reopen it. The field is cleared so the
 * next attempt starts fresh.
 */
export function InvitePlayerDialog({
  open,
  onOpenChange,
  teamId,
  teamName,
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
  teamId: string
  teamName: string
}) {
  const invite = useMutation({ mutationFn: useConvexMutation(api.teams.invitePlayer) })
  const { height, offsetTop } = useVisualViewport()
  const [email, setEmail] = useState('')
  const [submitting, setSubmitting] = useState(false)

  // Reset on the OPEN transition, matching create-team-dialog.tsx: a failed
  // submit leaves `open` true, so this never clobbers what submit deliberately
  // left on screen.
  useEffect(() => {
    if (!open) return
    setEmail('')
  }, [open])

  const handleSubmit: FormEventHandler<HTMLFormElement> = async (event) => {
    event.preventDefault()
    setSubmitting(true)
    try {
      const outcome = await invite.mutateAsync({
        teamId: teamId as Id<'teams'>,
        email,
        today: toPuzzleDay(new Date()),
      })

      if (outcome.status === 'already_member') {
        toast.info(`${email} is already on ${teamName}`)
        setEmail('')
        return // deliberately NOT closing — see the doc comment
      }

      if (outcome.status === 'added') {
        toast.success(`${outcome.firstName} was added to ${teamName}`)
      } else if (outcome.status === 'resent') {
        toast.success(`Invite re-sent to ${outcome.email}`)
      } else {
        toast.success(`Invite sent to ${outcome.email}`)
      }
      onOpenChange(false)
    } catch (error) {
      toast.error(mutationErrorMessage(error, 'Player invite failed'))
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      {/* w-11/12 rounded-lg and the visual-viewport `top` are parity with the
          other team dialogs — see create-team-dialog.tsx for why both are
          load-bearing on a phone. */}
      <DialogContent
        className="w-11/12 overflow-y-auto rounded-lg"
        style={height ? { top: offsetTop + height / 2, maxHeight: height } : undefined}
      >
        <DialogHeader>
          <DialogTitle>Invite Player to {teamName}</DialogTitle>
          <DialogDescription>Enter the player&apos;s email address</DialogDescription>
        </DialogHeader>
        <form onSubmit={handleSubmit} className="w-full space-y-6">
          <div>
            <Label htmlFor="invite-email">Email</Label>
            <Input
              id="invite-email"
              name="email"
              type="email"
              autoComplete="email"
              required
              value={email}
              onChange={(event) => setEmail(event.target.value)}
            />
          </div>
          <DialogFooter>
            <Button type="submit" variant="secondary" disabled={submitting} aria-disabled={submitting}>
              {submitting && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
              Invite
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}
```

- [ ] **Step 2: Add Invite, Pending and Leave to the team card**

In `v2/src/components/teams/current-team-card.tsx`:

Extend the imports:

```tsx
import { LogOut, Mail, Settings, Trash2, UserPlus2 } from 'lucide-react'
import { convexQuery } from '@convex-dev/react-query'
import { useQuery } from '@tanstack/react-query'
import { InvitePlayerDialog } from './invite-player-dialog.tsx'
```

Add props `onInvite` is not needed — the card owns the dialog. Inside the component, add:

```tsx
  const [inviteOpen, setInviteOpen] = useState(false)
  const cancel = useMutation({ mutationFn: useConvexMutation(api.teams.cancelInvite) })
  const leave = useMutation({ mutationFn: useConvexMutation(api.teams.leaveTeam) })
  const [pendingEmail, setPendingEmail] = useState<string | null>(null)
  const [openEmail, setOpenEmail] = useState<string | null>(null)
  const [leaveOpen, setLeaveOpen] = useState(false)
  const [leaving, setLeaving] = useState(false)

  // Creator-only, and only fetched for the creator: these are real email
  // addresses, which is why they are NOT on getMyTeams. useQuery rather than
  // useSuspenseQuery so a member's card renders without waiting on a query that
  // would refuse them anyway.
  const { data: invites } = useQuery({
    ...convexQuery(api.teams.getTeamInvites, { teamId: teamId as Id<'teams'> }),
    enabled: isCreator,
  })

  const handleCancel = async (email: string) => {
    setPendingEmail(email)
    try {
      await cancel.mutateAsync({ teamId: teamId as Id<'teams'>, email })
      toast.success(`Invite to ${email} cancelled`)
      setOpenEmail(null)
    } catch (error) {
      toast.error(mutationErrorMessage(error, 'Could not cancel that invite'))
    } finally {
      setPendingEmail(null)
    }
  }

  const handleLeave = async () => {
    setLeaving(true)
    try {
      await leave.mutateAsync({ teamId: teamId as Id<'teams'>, today: toPuzzleDay(new Date()) })
      toast.success(`You left ${name}`)
      setLeaveOpen(false)
      onLeft()
    } catch (error) {
      toast.error(mutationErrorMessage(error, 'Could not leave that team'))
    } finally {
      setLeaving(false)
    }
  }
```

Add `onLeft: () => void` to the props type.

In the header, put Invite beside Settings:

```tsx
            {isCreator && (
              <div className="flex gap-2">
                <Button size="icon" variant="outline" aria-label="Team settings" onClick={onEditSettings}>
                  <Settings size={22} />
                </Button>
                <Button size="icon" variant="outline" aria-label="Invite player" onClick={() => setInviteOpen(true)}>
                  <UserPlus2 size={22} />
                </Button>
              </div>
            )}
```

In the member `<li>`, add the Leave control as the **complement** of remove:

```tsx
                {isCreator && member.id !== myPlayerId && (
                  /* ...existing remove ConfirmPopover, unchanged... */
                )}
                {/* Leave is the exact complement of remove above: a creator sees
                    remove on everyone else's row and nothing on their own; a
                    member sees Leave on their own row and nothing on anyone
                    else's. They must never both render on one row. The creator
                    cannot leave — leaveTeam refuses it server-side. */}
                {!isCreator && member.id === myPlayerId && (
                  <ConfirmPopover
                    open={leaveOpen}
                    onOpenChange={setLeaveOpen}
                    trigger={
                      <Button variant="ghost" aria-label={`Leave ${name}`}>
                        <LogOut size={16} className="text-danger" />
                      </Button>
                    }
                    message={`Leave ${name}?`}
                    confirmLabel="Leave"
                    pending={leaving}
                    onConfirm={handleLeave}
                  />
                )}
```

After the member list, add the Pending section and the dialog:

```tsx
        {isCreator && invites && invites.length > 0 && (
          <div className="mt-4">
            <Separator className="mb-4" />
            <h3 className="text-muted-foreground mb-2 text-sm font-medium">Pending invites</h3>
            <ul className="flex flex-col space-y-2">
              {invites.map((email) => (
                <li key={email} className="min-w-0">
                  <div className="flex w-full min-w-0 items-center justify-between gap-2">
                    <span className="text-muted-foreground flex min-w-0 items-center gap-2 truncate">
                      <Mail size={14} className="shrink-0" />
                      <span className="truncate">{email}</span>
                    </span>
                    <ConfirmPopover
                      open={openEmail === email}
                      onOpenChange={(next) => setOpenEmail(next ? email : null)}
                      trigger={
                        <Button variant="ghost" aria-label={`Cancel invite to ${email}`}>
                          <Trash2 size={16} className="text-danger" />
                        </Button>
                      }
                      message={`Cancel the invite to ${email}?`}
                      confirmLabel="Cancel invite"
                      pending={pendingEmail === email}
                      onConfirm={() => handleCancel(email)}
                    />
                  </div>
                </li>
              ))}
            </ul>
          </div>
        )}
      </CardContent>
      <InvitePlayerDialog
        open={inviteOpen}
        onOpenChange={setInviteOpen}
        teamId={teamId}
        teamName={name}
      />
    </Card>
```

- [ ] **Step 3: Wire `onLeft` in `index.tsx`**

Leaving the selected team leaves `?team=` pointing at a team you are no longer on — the same broken-param problem deleting one already has, so reuse the same handler:

```tsx
          <CurrentTeamCard
            teamId={selectedTeam.id}
            name={selectedTeam.name}
            members={selectedTeam.members}
            isCreator={selectedTeam.isCreator}
            myPlayerId={myPlayerId}
            onEditSettings={() => setSettingsOpen(true)}
            onLeft={() => {
              localStorage.removeItem(STORAGE_KEY)
              void navigate({ to: '/', search: {}, replace: true })
            }}
          />
```

- [ ] **Step 4: Run the gates**

```bash
cd v2 && pnpm test:once && pnpm exec tsc --noEmit && pnpm build
```

Expected: PASS.

- [ ] **Step 5: Drive every branch in the browser**

With `pnpm dev` and `E2E_TEST_MODE` on, as a team creator:

| Action | Expected |
| --- | --- |
| Invite an address with no account | success toast "Invite sent to …"; dialog closes; address appears under Pending |
| Invite the same address again | "Invite re-sent to …"; Pending shows it **once** |
| Invite a member already on the team | **info** toast "… is already on …"; **dialog stays open**; field cleared |
| Invite an existing player not on the team | "{First} was added to …"; they appear in the member list |
| Invite `not-an-email` | error toast "That does not look like an email address."; dialog stays open |
| Cancel a pending invite | it disappears from Pending |
| As a non-creator member, open the card | no Settings, no Invite, no Pending section; a Leave control on your own row |
| Leave the selected team | you land on another team, not the error boundary |

- [ ] **Step 6: Screenshot light and dark on a touch viewport**

390×844 with touch emulation, both themes, with at least two pending invites and a long team name. Watch specifically for: a page-wide horizontal scrollbar (the Phase 3 bug), and a long email overflowing the Pending row rather than truncating.

Wait for Radix's `animate-in` to settle before capturing, or you will screenshot a half-open popover and think it is broken.

- [ ] **Step 7: Commit**

```bash
git add v2/src/components/teams v2/src/routes/index.tsx
git commit -m "feat(v2): invite dialog, pending invites and leave-team UI (wt-ksh.5.3)"
```

---

## Task 8: e2e, divergence list, beta, phase close

**Files:**
- Create: `v2/e2e/invites.spec.ts`
- Modify: `docs/design-system/V2-ADDENDUM.md` §7a

- [ ] **Step 1: Write the e2e spec**

Create `v2/e2e/invites.spec.ts`, following the two-context pattern already in `v2/e2e/teams.spec.ts`:

```ts
import { expect, test } from '@playwright/test'

/**
 * The real invite path, end to end: a creator invites a fresh address, that
 * address signs in for the first time, completes a profile, and lands on the
 * team. This is what wt-ksh.5.4 asks to be exercised for real on beta.
 *
 * The invited address is generated per run so the account is genuinely new —
 * completeProfile creating the player is the thing under test, and a reused
 * address would already have one.
 */
test('an invited address joins the team after completing a profile', async ({ browser }) => {
  const invitee = `e2e-invite-${Date.now()}@example.test`

  const creatorContext = await browser.newContext()
  const creator = await creatorContext.newPage()
  // Sign in as the seeded creator and open the team — reuse the sign-in helper
  // teams.spec.ts already uses rather than duplicating the OTP dance.
  // ... sign in, land on the dashboard ...

  await creator.getByRole('button', { name: 'Invite player' }).click()
  await creator.getByLabel('Email').fill(invitee)
  await creator.getByRole('button', { name: 'Invite' }).click()
  await expect(creator.getByText(`Invite sent to ${invitee}`)).toBeVisible()
  await expect(creator.getByText(invitee)).toBeVisible() // Pending section

  const inviteeContext = await browser.newContext()
  const joiner = await inviteeContext.newPage()
  // ... sign in as `invitee` via the E2E OTP path ...

  // A brand-new account must land on the profile form, not the dashboard.
  await expect(joiner).toHaveURL(/\/complete-profile/)
  await joiner.getByLabel('First Name').fill('Iva')
  await joiner.getByLabel('Last Name').fill('Tester')
  await joiner.getByRole('button', { name: 'Submit' }).click()

  // They land on the dashboard already on the team they were invited to.
  await expect(joiner).toHaveURL(/\/(\?|$)/)
  await expect(joiner.getByRole('region', { name: 'Current Team' })).toContainText('Iva')

  // And the creator's Pending list clears reactively, with no reload.
  await expect(creator.getByText(invitee)).toBeHidden()

  await creatorContext.close()
  await inviteeContext.close()
})
```

Fill in the two sign-in blocks from `v2/e2e/teams.spec.ts`'s existing helper. Do not invent a second sign-in implementation.

- [ ] **Step 2: Run it**

```bash
cd v2 && pnpm e2e
```

Expected: PASS, including the pre-existing specs. `pnpm e2e` is not part of `test`/`tsc`/`build`, which is why a Phase 2 spec stayed red for three tasks.

- [ ] **Step 3: Update the divergence list**

In `docs/design-system/V2-ADDENDUM.md` §7a, change the heading count from five to ten and append:

```markdown
| 6 | Pending invites are visible to the creator, and cancellable | Phase 4 (`wt-ksh.5.3`) | v1 shows them nowhere, so a typo'd address sits in `invited[]` forever with no remedy and no way to see it. Production carried 44 pending invites across 33 teams when this was written |
| 7 | A player cannot exist without a name | Phase 4 (`wt-ksh.5.1`) | `players.firstName`/`lastName` are required. 151 nameless production players and the 29 dead teams they created are not copied — measured, those players own 0 boards and 0 winner rows. This is what deleted `hasCompleteProfile` and its three must-agree call sites |
| 8 | No 2-team cap on invitees until Phase 5 | Phase 4 | v1 caps a non-pro invitee at two teams in `handle_invited_signup`. v2 is **more permissive than prod** until Polar lands. Note v1's `handle_add_player_to_team` cap branch is broken in production — it references an undeclared `invited_id` — so inviting an existing free player who already has two teams errors out rather than capping |
| 9 | Inviting someone already on the team says so | Phase 4 | v1 returns *"Successfully invited player"* and closes the dialog even when nothing happened. v2 shows an info toast and keeps the dialog open so the address can be corrected |
| 10 | A member can leave a team | Phase 4 | v1 has no self-removal at any layer — the UI hides remove on your own row and the only exit is asking the creator. Owner-sanctioned. The creator still cannot leave, so every team keeps an administrator |
```

Also add to the "not divergences, but recorded" list:

```markdown
- **Inviting an existing player sends no email.** v1 adds them silently too; they
  discover it in the app. Parity, deliberately kept.
- **`NO_PLAYER` says "Finish setting up your profile", not "Your session
  expired".** The code and the condition are unchanged; only the copy, which was
  describing the wrong problem.
```

- [ ] **Step 4: Full gates, then push**

```bash
cd v2 && pnpm test:once && pnpm exec tsc --noEmit && pnpm build && pnpm e2e
```

**Controller only** — pushing deploys to beta:

```bash
git add -A && git commit -m "test(v2): invite path e2e; record divergences 6-10"
git pull --rebase && bd dolt push && git push && git status
```

- [ ] **Step 5: Verify on beta, and close `wt-ksh.5.4`**

On beta, with two real browsers and two real accounts, using the **real invite path**:

1. Invite a second real address to a team.
2. Sign in as both.
3. Enter a board as one; confirm the other's table updates with **no refresh and no interaction**.

That is `wt-ksh.5.4`'s acceptance criterion, deferred from Phase 3 precisely so it could be exercised through invites rather than hand-seeded data.

- [ ] **Step 6: Close the issues**

```bash
bd close wt-ksh.5.1 wt-ksh.5.2 wt-ksh.5.3 wt-ksh.5.4
bd close wt-ksh.5 --reason "Phase 4 complete: invites, onboarding, leave-team"
```

File a Phase 5 issue for the deferred cap before closing:

```bash
bd create --title="Enforce the non-pro 2-team cap on invitees (deferred from Phase 4)" \
  --type=task --priority=1 --body-file=- <<'BODY'
Phase 4 deferred v1's server-side 2-team cap on non-pro INVITEES to Phase 5,
with the rest of pro enforcement. v2 is currently MORE permissive than prod.

THE RETROFIT HAZARD IS THE POINT: enforcing this later means removing people
from teams they have already joined. The longer it waits the more of them there
are.

v1 implements it in handle_invited_signup (works) and handle_add_player_to_team
(BROKEN in prod — references an undeclared invited_id, so inviting an existing
free player who already has two teams raises a Postgres error rather than
capping). Do not port the broken half faithfully.

v1 stores the overflow count in auth.users.raw_app_meta_data.invites_pending_upgrade
and releases it in handle_upgrade_team_invites on upgrade. v2 has no auth
metadata store; the count belongs on the players doc.

Recorded as divergence 8 in docs/design-system/V2-ADDENDUM.md §7a.
BODY
```

---

## Self-Review

**Spec coverage.** Every section of the design maps to a task: schema prerequisite → 0a–0d; `lib/invite.ts` → 1; `players.ts` → 2; `invitePlayer` + `inviteEmails.ts` → 3; `cancelInvite`/`getTeamInvites` → 4; `leaveTeam` → 5; routes → 6; UI → 7; testing, §7a and beta → 8. The design's error table is implemented in Task 2 Step 3 (both new codes plus the `NO_PLAYER` split). All five new divergences are recorded in Task 8 Step 3. The deferred Phase 5 cap is filed in Task 8 Step 6.

**Naming consistency, checked across tasks.** `completeProfileFor`, `invitePlayerFor`, `cancelInviteFor`, `getTeamInvitesFor`, `leaveTeamFor` all follow the module's existing `...For` convention (plain helper taking explicit ids, behind an exported Convex function) and are the names used in both the implementation and the test steps. `InviteOutcome`'s four `status` values — `already_member`, `added`, `invited`, `resent` — are identical in the type (Task 3), the tests (Task 3), and the UI switch (Task 7). `isCompleteName` and `normaliseInviteEmail` are used in Tasks 1, 2, 3, 4 and 6 with one signature each. `cascadeDeleteTeam` is introduced in Task 5 and consumed by both `deleteTeamFor` and `leaveTeamFor`.

**Two things a reviewer should watch.**

1. **Task 2's fifth test** builds boards for a player it then deletes, so that the claim is what makes them count. That construction is fiddly and may need reworking against the real `monthTotal` semantics — but the assertion it exists to make (a stale winner row changes when someone claims an invite) must not be weakened into "the row still exists".
2. **Task 7's `useQuery` for `getTeamInvites`** is `enabled: isCreator`, and the mutation refuses non-creators anyway. If `enabled` is dropped, every member's browser issues a query that throws, which will surface as a console error rather than a broken page — easy to miss and worth checking in review.
