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
- **Throw `ConvexError`, never a plain `Error`, from anything whose message a human is meant to read.** Convex delivers `ConvexError.data` to clients verbatim but replaces a plain `Error`'s message with a generic `[Request ID: …] Server Error`, keeping the real text only in deployment logs. **`convex-test` runs in-process and never redacts**, so a test asserting on the message passes either way — the divergence is invisible to the suite and only appears in production, at the moment the error was supposed to explain itself. `access.ts`'s `accessError` is the established shape for UI-facing codes; for operator-facing messages, `new ConvexError('...')` keeps `.message` identical to the plain-`Error` form, so it is a drop-in.
- **Never date a "past month" fixture in the current month.** Task 2's `wt-ksh.5.2` test dated its scores and stale winner rows in the then-current month, so a mutant that ignored `monthsWithWinners` entirely and recomputed only the current month passed every test — which is precisely the bug that issue exists to prevent. Worse, the test would have *become* a real past-month test on its own after the month rolled over, so its strength changed silently with the wall clock. Use a fixed month in the past (`2025-06`), never one derived from `new Date()`.
- **Put every rule in the `...For` helper, never in the `query`/`mutation` wrapper.** `convex-test` cannot stand up a Better Auth session, so `authComponent.getAuthUser` never resolves under test and **the body of every authed wrapper is unreachable by the unit suite**. Task 2's draft in this plan put validation, trimming and the `today` bound in the wrapper; a rule placed there is not merely untested, it is *untestable*, and the mutation testing that would have caught it silently has nothing to bite on. Leave only `getAuthUser`, the `!user?.email` guard, and argument forwarding above the helper. This is the same reasoning `access.ts` already encodes by giving its checks an explicit-playerId shape. Tracked as `wordle-teams-obw`.
- **Every mutation-testing run needs a CONTROL and a SANITY case, and verdicts must come from exit codes.** A Task 1 reviewer's first harness reported all five required mutations as SURVIVED — a false result: it passed `vitest --reporter=basic`, which does not exist in vitest 4, so the run crashed and its grep found no failures. "No failures detected" and "the tests did not run" look identical to a grep. Two guards, and you need both: a **SANITY** mutant you know must die (catches "the runner never fails"), and a **CONTROL** run with no mutation at all that must pass (catches the opposite — a runner that always fails, which is otherwise indistinguishable from every mutant being killed). A mutation report you cannot trust is worse than none, because it manufactures confidence.
- **Mutation-test each guard separately, not just the headline behaviour.** Task 0a's review found that a test asserting "the dry run wrote nothing" pinned only one of three write sites — the other two could be unguarded with every test still green, and one of them deletes a team and cascades away its whole scoring history. If a function has N conditional write paths, break N of them, one at a time.
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
    // ASSERT ALL THREE WRITE SITES, not just the player deletion. The handler
    // writes in three places — the emptied-team cascade, the roster/creator
    // patch, and the player delete — and an earlier version of this test looked
    // only at the last one. Mutation testing proved the gap real: unguarding the
    // emptied-team branch left every test green, and that branch deletes a team
    // AND cascades away all its monthlyWinners and scoringSystems. Task 0b runs
    // this against the live beta deployment, so "the dry run really is dry" is
    // the single most safety-critical property in the file.
    const t = convexTest(schema, modules)
    const { ada, team } = await t.run(async (ctx) => {
      const nameless = await ctx.db.insert('players', aPlayer({ email: 'x@a.test', firstName: undefined, lastName: undefined }))
      const team = await ctx.db.insert('teams', aTeam({ playerIds: [nameless], creator: nameless }))
      return { ada: nameless, team }
    })

    const report = await t.mutation(internal.migrate.deleteNamelessPlayers, { dryRun: true })
    expect(report).toMatchObject({ namelessPlayers: 1, teamsEmptied: 1 })

    await t.run(async (ctx) => {
      expect(await ctx.db.get(ada)).not.toBeNull()
      const untouched = await ctx.db.get(team)
      expect(untouched).not.toBeNull()
      expect(untouched!.creator).toBe(ada)
      expect(untouched!.playerIds).toEqual([ada])
    })
  })

  test('refuses to run when a nameless player owns a monthlyWinners row', async () => {
    // The spec names BOTH tables. Without this the refusal's second half is
    // invisible to the suite — deleting the throw left every test green — and it
    // is the half that protects somebody's recorded win history.
    const t = convexTest(schema, modules)
    await t.run(async (ctx) => {
      const nameless = await ctx.db.insert('players', aPlayer({ email: 'x@a.test', firstName: undefined, lastName: undefined }))
      const team = await ctx.db.insert('teams', aTeam({ playerIds: [nameless], creator: nameless }))
      await ctx.db.insert('monthlyWinners', {
        playerId: nameless, teamId: team, year: 2025, month: 6, hasSeenCelebration: [],
      })
    })

    await expect(
      t.mutation(internal.migrate.deleteNamelessPlayers, { dryRun: false }),
    ).rejects.toThrow(/owns monthlyWinners/)
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
    // THE ROSTERED PLAYER IS THE POINT. An earlier fixture hung the surviving
    // score on a player who was NOT on the team, so the likeliest wrong cascade
    // — "delete the dailyScores of every member of the emptied team" — passed.
    // `rostered` is on the team and their board must survive: a board belongs to
    // a player and is shared across every team they are on.
    const t = convexTest(schema, modules)
    const { score } = await t.run(async (ctx) => {
      const nameless = await ctx.db.insert('players', aPlayer({ email: 'x@a.test', firstName: undefined, lastName: undefined }))
      const rostered = await ctx.db.insert('players', aPlayer({ email: 'rostered@a.test' }))
      // The nameless player is the only one whose absence empties the roster,
      // so `rostered` leaves via the team's deletion, not via the filter.
      // EVERY FIELD THAT NAMES A PLAYER MUST BE NON-EMPTY IN THIS FIXTURE, or the
      // route it represents is unpinned and a cascade that reached through it
      // would pass unnoticed. The schema has five: teams.creator, teams.playerIds,
      // teams.invited, monthlyWinners.playerId, monthlyWinners.hasSeenCelebration.
      // `invited` counts even though it holds an address rather than an id —
      // players is indexed by_email, so it resolves to a player as easily as
      // creator does. aTeam defaults both `invited` and `hasSeenCelebration` to
      // [], which is exactly how both routes went unpinned the first time.
      const team = await ctx.db.insert('teams', aTeam({
        playerIds: [nameless], creator: nameless, invited: ['rostered@a.test'],
      }))
      await ctx.db.insert('monthlyWinners', { playerId: rostered, teamId: team, year: 2025, month: 6, hasSeenCelebration: [rostered] })
      await ctx.db.insert('scoringSystems', {
        teamId: team, effectiveFrom: '2026-07',
        oneGuess: 5, twoGuesses: 3, threeGuesses: 2, fourGuesses: 1, fiveGuesses: 0, sixGuesses: -1, failed: -3, nA: 0,
      })
      const score = await ctx.db.insert('dailyScores', {
        playerId: rostered, puzzleDay: '2026-07-01', date: 0, guesses: [],
      })
      return { score }
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

Expected: PASS, 5 tests.

Then mutation-test **each write guard separately**, not just the headline behaviour. Change `if (!dryRun)` to `if (true)` at the emptied-team cascade, then at the roster/creator patch, then at the player delete — each one on its own must turn the dry-run test red. Then delete the `monthlyWinners` refusal `throw`; the fifth test must go red. Restore after each.

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

**This task writes to a live deployment. A subagent must not perform it.**

**The three-step sequence is a DEPLOY ordering constraint, not a development one.** Convex only validates the narrowed schema against existing rows when the schema is *pushed*; `convex-test` validates against its own fixtures, in-process. So Tasks 0c, 0d and everything after them can be written, tested and committed locally with 0b outstanding — what must never happen is **pushing** the narrowed schema before this task has run. Treat 0b as a gate on the first push, not a gate on writing code.

- [ ] **Step 1: Push so the mutation exists on beta**

The GitHub Action deploys on push. This is the sanctioned deploy path.

- [ ] **Step 2: Dry run against beta**

```bash
cd v2 && (set -a; . <(sed -n 's/^#[[:space:]]*\(CONVEX_URL=.*\|CONVEX_MIGRATION_KEY=.*\)/\1/p' ../.env.local); set +a; node scripts/cleanup-nameless-players.mjs)
```

Expected: `namelessPlayers: 0`. Beta holds 18 players / 7 teams, made of the `--scope=mine` copy plus `e2eSeed` rows, and `e2eSeed` always writes both names.

**The `sed` names the two variables explicitly, and must keep doing so.** An earlier version uncommented every commented `KEY=value` line in `.env.local`. That block is not only Convex — it also carries Polar, Novu, and three Supabase variables that each appear **twice**, so sourcing it wholesale silently retargets Supabase to whichever duplicate happens to come last. Harmless for this script, which reads only the two Convex values, but the recipe gets copied. Name what you need.

- [ ] **Step 3: If the count is non-zero, stop and report**

A non-zero count is a finding, not a routine step — it means beta holds nameless rows nobody predicted. Report the counts before running `--commit`.

- [ ] **Step 4: If non-zero and understood, apply**

```bash
cd v2 && (set -a; . <(sed -n 's/^#[[:space:]]*\(CONVEX_URL=.*\|CONVEX_MIGRATION_KEY=.*\)/\1/p' ../.env.local); set +a; node scripts/cleanup-nameless-players.mjs --commit)
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

## Task 0d: Delete `hasCompleteProfile` and its three call sites — and retire the cleanup

**Also delete the Task 0a scaffolding.** This was not in the original plan; Task 0c's
implementer surfaced it. `deleteNamelessPlayers` **can never be tested again**, because its
only input — a nameless player — is unrepresentable once the schema narrows, so all six of
`migrate.test.ts`'s tests for it fail to construct their fixtures. Leaving it would mean
permanently untested live code.

It is also permanently unnecessary. It was a one-shot pre-narrowing migration: it ran against
beta on 2026-08-21 and reported `namelessPlayers: 0`, and the copy-script filter added in Task
0c stops nameless rows coming back that way. It can never find anything again.

So delete `deleteNamelessPlayers` from `migrate.ts`, delete `v2/convex/migrate.test.ts`'s
`deleteNamelessPlayers` suite, and delete `v2/scripts/cleanup-nameless-players.mjs`. Git history
and the design doc are the record of what it did. **Keep** `migrate.test.ts` itself if it has
other suites; delete the file only if that suite was all of it.

**Files:**
- Delete: `v2/convex/lib/player.ts`
- Delete: `v2/scripts/cleanup-nameless-players.mjs`
- Modify: `v2/convex/migrate.ts` (remove `deleteNamelessPlayers`)
- Modify or delete: `v2/convex/migrate.test.ts`
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
    // v2 cannot have that bug at all: needsProfile checks whether a player ROW
    // exists and never re-reads the name, so there is no second opinion to
    // disagree with the save.
    //
    // Do not "tighten" this to length > 1. completeProfile's validation and the
    // form's canSubmit predicate both call this, so tightening locks the same
    // people out of both at once.
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
 * TWO consumers, neither of which exists yet: completeProfile's server-side
 * validation (Task 2), and the profile form's canSubmit predicate (Task 6).
 * The form judges RAW, UNTRIMMED React state, which is why padded input has to
 * count as complete rather than being rejected.
 *
 * NOT the route guard. needsProfile is a row-existence check and never reads a
 * name back — the redirect loop is closed by the schema instead, since
 * firstName/lastName are required and completeProfile validates before it
 * inserts, so a row cannot exist without a valid name. That is strictly
 * stronger than re-checking stored names: no names on the wire, and no
 * sensitivity to stored whitespace.
 *
 * RETURNS A VERDICT, NOT A VALUE. A caller that persists must trim for itself —
 * see completeProfile, whose outer .trim() is load-bearing for what gets STORED
 * even though this function trims internally to judge. The two are
 * complementary, not redundant; deleting the outer one stores ' Ada ' and no
 * test here would notice.
 *
 * v1 saves any non-empty name but guards its redirect on `length > 1`, so a
 * one-character name saves and then redirects forever. v2 has no second opinion
 * to disagree with.
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
        playerId: creator, puzzleDay: '2025-06-02', date: 0, guesses: ['aaaaa', 'aaaaa', 'aaaaa', 'aaaaa', 'crane'], answer: 'crane',
      })
      const stale = await ctx.db.insert('monthlyWinners', {
        playerId: creator, teamId: team, year: 2025, month: 6, hasSeenCelebration: [],
      })

      const adaEmail = 'ada@example.test'
      const ada = await ctx.db.insert('players', aPlayer({ email: adaEmail, firstName: 'Ada', lastName: 'L' }))
      await ctx.db.insert('dailyScores', {
        playerId: ada, puzzleDay: '2025-06-02', date: 0, guesses: ['crane'], answer: 'crane',
      })
      await ctx.db.delete(ada)

      await completeProfileFor(ctx, adaEmail, { firstName: 'Ada', lastName: 'L' }, today)

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
  rawEmail: string,
  names: { firstName: string; lastName: string },
  rawToday: PuzzleDay,
): Promise<Id<'players'>> {
  // Every rule lives HERE, not in the mutation wrapper, because the wrapper is
  // unreachable by convex-test. Lowercasing here too, so the module has one rule
  // rather than a precondition on its callers.
  const email = rawEmail.toLowerCase()
  const today = requirePlausibleToday(rawToday)
  const firstName = names.firstName.trim()
  const lastName = names.lastName.trim()
  if (!isCompleteName(firstName, lastName)) throw accessError('INVALID_NAME')

  const existing = await playerForEmail(ctx, email)
  const playerId = existing
    ? (await ctx.db.patch(existing._id, { firstName, lastName }), existing._id)
    : await ctx.db.insert('players', {
        email,
        firstName,
        lastName,
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
    //
    // NOTHING ELSE BELONGS HERE. An earlier draft of this plan validated,
    // trimmed and bounded `today` in this wrapper — where convex-test can never
    // reach it, because it cannot stand up a Better Auth session. Every one of
    // those rules lives in completeProfileFor instead. See the ground rules.
    const user = await authComponent.getAuthUser(ctx)
    if (!user?.email) throw accessError('UNAUTHENTICATED')
    return await completeProfileFor(
      ctx,
      user.email,
      { firstName: args.firstName, lastName: args.lastName },
      args.today,
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
        playerId: creator, puzzleDay: '2025-06-02', date: 0,
        guesses: ['aaaaa', 'aaaaa', 'aaaaa', 'aaaaa', 'crane'], answer: 'crane',
      })
      const stale = await ctx.db.insert('monthlyWinners', {
        playerId: creator, teamId: team, year: 2025, month: 6, hasSeenCelebration: [],
      })

      const ada = await ctx.db.insert('players', aPlayer({ email: 'ada@example.test' }))
      await ctx.db.insert('dailyScores', {
        playerId: ada, puzzleDay: '2025-06-02', date: 0, guesses: ['crane'], answer: 'crane',
      })

      await invitePlayerFor(ctx, creator, { teamId: team, email: 'ada@example.test', today })

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
- Modify: `v2/convex/access.ts` (comment only — INVALID_EMAIL gains a second thrower)
- Modify: `v2/src/lib/convex-error.ts` (comment only — the twin of the above)

- [ ] **Step 1: Write the failing test**

Append to `v2/convex/teams.test.ts`:

```ts
/**
 * A ctx whose `db.patch` calls are recorded, for the assertions that a helper
 * wrote NOTHING.
 *
 * Needed because "no write happened" is otherwise unobservable: a patch that
 * rewrites a field to an identical value leaves the document equal to what it
 * was, and Convex documents carry no update timestamp to tell the two apart.
 *
 * Works because WriterCtx is the structural type `{ db }` — the same choice
 * that lets convex-test's callback ctx satisfy these helpers with no cast lets
 * a wrapper stand in for it. Methods are bound to the real db so `this` inside
 * convex-test is never the proxy.
 */
const spyOnPatch = (ctx: TestCtx) => {
  const patches: Array<unknown> = []
  const db = new Proxy(ctx.db, {
    get: (target, prop) => {
      const value = Reflect.get(target, prop) as unknown
      if (typeof value !== 'function') return value
      const bound = (value as (...args: Array<unknown>) => unknown).bind(target)
      if (prop !== 'patch') return bound
      return (...args: Array<unknown>) => {
        patches.push(args[0])
        return bound(...args)
      }
    },
  })
  return { ctx: { db }, patches }
}

describe('cancelInviteFor / getTeamInvitesFor', () => {
  test('the creator sees pending invites EXACTLY as they are stored', async () => {
    // STRANGER_AS_TYPED is padded, and it comes back padded. Task 7 renders
    // these strings verbatim, and recognising a bad entry — telling a typo from
    // a slow responder, which is the whole point of divergence 6 — means seeing
    // the odd shape rather than a tidied copy of it. Seeded with one normal
    // entry and one odd one so a `.map(normalise)` on the way out is visible.
    const t = convexTest(schema, modules)
    await t.run(async (ctx) => {
      const { creator, teamId } = await aTeamOwnedByCara(ctx, {
        invited: [ADA, STRANGER_AS_TYPED],
      })

      expect(await getTeamInvitesFor(ctx, creator, teamId)).toEqual([ADA, STRANGER_AS_TYPED])
    })
  })

  test('a member who is not the creator is refused by the QUERY', async () => {
    // NOT MERELY A HIDDEN BUTTON. These are real email addresses, so the refusal
    // has to be the read itself — divergence 6 exists to give the creator a
    // surface v1 lacks, not to give every member a roster of who else was asked.
    const t = convexTest(schema, modules)
    await t.run(async (ctx) => {
      const { creator, teamId } = await aTeamOwnedByCara(ctx, { invited: [ADA] })
      const bob = await ctx.db.insert('players', aPlayer({ email: 'bob@example.test' }))
      await ctx.db.patch(teamId, { playerIds: [creator, bob] })

      await expect(getTeamInvitesFor(ctx, bob, teamId)).rejects.toMatchObject({
        data: { code: 'NOT_TEAM_CREATOR' },
      })
    })
  })

  test('cancel removes the address, case-insensitively', async () => {
    const t = convexTest(schema, modules)
    await t.run(async (ctx) => {
      const { creator, teamId } = await aTeamOwnedByCara(ctx, { invited: [ADA, STRANGER] })

      await cancelInviteFor(ctx, creator, { teamId, email: STRANGER_AS_TYPED })

      expect((await ctx.db.get(teamId))!.invited).toEqual([ADA])
    })
  })

  test('cancels an entry parked in a shape no write gate would strip', async () => {
    // THE TRIM HALF OF THE READ-SIDE NORMALISE, which is the half nothing else
    // guards. Both copy gates lowercase and neither trims — they map
    // `e.toLowerCase()` and nothing more — so a padded v1 address survives the
    // copy intact and reaches this filter as ' New.Person@Example.TEST '.
    // Compare the raw stored string and that invite can never be cancelled.
    //
    // The lowercase half is defence in depth rather than a live hazard, for the
    // reasons completeProfileFor sets out for this same field; the fixture is
    // mixed-case as well because it costs nothing and pins both.
    //
    // Note what the previous test does NOT prove: there the SUBMITTED address is
    // the odd one and normaliseInviteEmail has already flattened it before the
    // comparison, so a filter written `entry !== email` passes it. This fixture
    // puts the oddness on the STORED side, where only the read-side normalise
    // can reach it.
    const t = convexTest(schema, modules)
    await t.run(async (ctx) => {
      const { creator, teamId } = await aTeamOwnedByCara(ctx, {
        invited: [ADA, STRANGER_AS_TYPED],
      })

      await cancelInviteFor(ctx, creator, { teamId, email: STRANGER })

      expect((await ctx.db.get(teamId))!.invited).toEqual([ADA])
    })
  })

  test('cancels EVERY entry for the address, not just the first', async () => {
    // A team can carry one address twice in two shapes: parked once before v1's
    // wordle-teams-5no fix and once after. Cancelling the first and leaving the
    // second makes the button look broken.
    const t = convexTest(schema, modules)
    await t.run(async (ctx) => {
      const { creator, teamId } = await aTeamOwnedByCara(ctx, {
        invited: [STRANGER_AS_TYPED, ADA, STRANGER],
      })
      const spy = spyOnPatch(ctx)

      await cancelInviteFor(spy.ctx, creator, { teamId, email: STRANGER })

      expect((await ctx.db.get(teamId))!.invited).toEqual([ADA])
      // Doing the work in ONE patch, and — read with the next test — proof that
      // the spy sees a write when there is one to see. A spy that recorded
      // nothing either way would make the next test pass against any code at
      // all, so the two assertions are a matched pair.
      expect(spy.patches).toEqual([teamId])
    })
  })

  test('writes NOTHING when the address is not parked', async () => {
    // The mirror of removeMemberFor's early return, and for the reason that one
    // gives: any team write invalidates getMyTeams for EVERY connected client,
    // so paying that broadcast for a change that never happened is pure waste.
    // Reachable without a UI bug — cancelInvite is a public mutation and a
    // creator can submit any string — and by a double-click on a row the
    // reactive update has already removed.
    //
    // COUNTS PATCHES RATHER THAN COMPARING THE DOCUMENT, because comparing it
    // proves nothing here: the unguarded version rewrites `invited` to an
    // identical array, and Convex has no update timestamp, so the before and
    // after documents are equal whether or not a write happened. The call is
    // the only observable difference. The test above is what proves the spy is
    // not simply blind.
    const t = convexTest(schema, modules)
    await t.run(async (ctx) => {
      const { creator, teamId } = await aTeamOwnedByCara(ctx, { invited: [ADA] })
      const spy = spyOnPatch(ctx)

      await cancelInviteFor(spy.ctx, creator, { teamId, email: STRANGER })

      expect(spy.patches).toEqual([])
      expect((await ctx.db.get(teamId))!.invited).toEqual([ADA])
    })
  })

  test('refuses an address that is not a usable one, and cancels nothing', async () => {
    // normaliseInviteEmail returns null rather than throwing, so without this
    // guard the filter would compare every entry against null and match
    // nothing. The early return then swallows it completely: no write, no
    // error, and a caller told its cancel succeeded when nothing happened.
    // The two guards have to be read together — the early return is what turns
    // a missing INVALID_EMAIL from a wasted write into a silent lie.
    const t = convexTest(schema, modules)
    await t.run(async (ctx) => {
      const { creator, teamId } = await aTeamOwnedByCara(ctx, { invited: [ADA] })

      await expect(
        cancelInviteFor(ctx, creator, { teamId, email: '   ' }),
      ).rejects.toMatchObject({ data: { code: 'INVALID_EMAIL' } })

      expect((await ctx.db.get(teamId))!.invited).toEqual([ADA])
    })
  })

  test('a member who is not the creator cannot cancel', async () => {
    const t = convexTest(schema, modules)
    await t.run(async (ctx) => {
      const { creator, teamId } = await aTeamOwnedByCara(ctx, { invited: [ADA] })
      const bob = await ctx.db.insert('players', aPlayer({ email: 'bob@example.test' }))
      await ctx.db.patch(teamId, { playerIds: [creator, bob] })

      await expect(cancelInviteFor(ctx, bob, { teamId, email: ADA })).rejects.toMatchObject({
        data: { code: 'NOT_TEAM_CREATOR' },
      })

      expect((await ctx.db.get(teamId))!.invited).toEqual([ADA])
    })
  })
})
```

Add `cancelInviteFor` and `getTeamInvitesFor` to the `./teams.ts` import. The block
reuses the invite fixtures Task 3 already added above it — `ADA`, `STRANGER`,
`STRANGER_AS_TYPED` and `aTeamOwnedByCara` — rather than re-inserting documents inline,
and asserts the ConvexError `code` (`.rejects.toMatchObject({ data: { code: ... } })`)
like every other negative test in the file, so `NOT_TEAM_CREATOR` is distinguishable
from `NOT_A_MEMBER` and a bare `toThrow()` cannot pass on the wrong refusal.

**Three of these tests are load-bearing against mutants the obvious pair misses.**

- A filter written `entry !== email` is killed by the two tests that put an oddly-shaped
  address on the STORED side — `cancels an entry parked in a shape no write gate would
  strip` and `cancels EVERY entry for the address, not just the first`, whose fixture
  carries one too. It is NOT killed by `cancel removes the address, case-insensitively`:
  there the odd address is the SUBMITTED one, and `normaliseInviteEmail` has already
  flattened it before the comparison, so a raw compare passes. (Measured by running that
  mutant and reading which tests failed, not reasoned about.)
- The EVERY-entry test is the only one that kills a first-match-only removal.
- `writes NOTHING when the address is not parked` is the only one that kills a deleted
  early-return guard, and it can only do so by COUNTING `db.patch` CALLS. Comparing the
  document before and after proves nothing: the unguarded version rewrites `invited` to
  an identical array, and Convex documents carry no update timestamp, so the two
  documents are equal either way. `spyOnPatch` above the block does the counting, and the
  EVERY-entry test asserts `spy.patches` too so that a blind spy cannot make the
  write-nothing test vacuous.

- [ ] **Step 2: Run it to make sure it fails**

```bash
cd v2 && pnpm exec vitest run convex/teams.test.ts -t cancelInviteFor
```

Expected: FAIL — not exported.

- [ ] **Step 3: Implement**

Append to `v2/convex/teams.ts` — which puts it directly after `invitePlayer`, where
invites belong, beside `removeMember`. Also widen the TWO twinned comments that name
`invitePlayerFor` as INVALID_EMAIL's only thrower in `teams.ts` — `access.ts`'s
`AccessCode` block and its counterpart in `src/lib/convex-error.ts`, which `access.ts`
explicitly points at as the file that must stay in sync — and retire the four now-stale
forward references to "Task 4" inside `invitePlayerFor` and its tests.

```ts
/**
 * The addresses invited to a team but not yet joined. CREATOR-ONLY.
 *
 * Deliberately NOT folded into getMyTeams. That query picks its fields
 * explicitly so `invited` cannot reach the wire (see getMyTeamsFor), it is
 * fetched by every connected client, and these are real email addresses. This
 * is a separate, creator-scoped read of ONE team.
 *
 * RETURNS THE STORED ENTRIES AS THEY ARE STORED, unnormalised, and Task 7
 * renders these strings verbatim. The creator is being shown what is actually
 * parked on their team: a copied row can carry padding no gate ever stripped
 * (see cancelInviteFor), and telling a typo from a slow responder — the whole
 * point of divergence 6 — means being able to SEE the odd entry rather than
 * being handed a tidied copy of it.
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
 * NORMALISED ON READ — trim().toLowerCase(), mirroring normaliseInviteEmail on
 * write — exactly as invitePlayerFor's two scans and completeProfileFor's do.
 * THE TWO HALVES ARE NOT THE SAME STRENGTH, and it is worth being precise:
 *
 * - toLowerCase() is DEFENCE IN DEPTH, not a claim that abnormal rows exist —
 *   the framing completeProfileFor uses at length for this same field. Both
 *   copy gates lowercase (scripts/copy-from-supabase.mjs and again migrate.ts,
 *   "the last gate before the data lands"), all 44 pending production invites
 *   were measured lowercase, and schema.ts says the table cannot hold a
 *   mixed-case invite. It stays for the reason players.ts gives: the cost of
 *   one future writer forgetting is silent and asymmetric.
 * - trim() is NOT covered by any of that. Neither copy gate trims — both map
 *   `e.toLowerCase()` and nothing more — so a padded v1 address survives the
 *   copy intact.
 *
 * Either way the failure this prevents is the same: an entry the filter cannot
 * match is an invite that cannot be cancelled, which is precisely the trap this
 * surface exists to remove.
 *
 * REMOVES EVERY MATCHING ENTRY, not the first. One address can be parked twice
 * in two shapes, so leaving the duplicate behind would make cancelling look
 * broken.
 *
 * EARLY-RETURNS WHEN NOTHING MATCHED, like removeMemberFor, and for the reason
 * that one gives: any team write invalidates getMyTeams for EVERY connected
 * client (see this file's module comment), and paying that broadcast for a
 * change that never happened is pure waste. This is a public mutation — an
 * authenticated creator can submit any string, so it is not reachable only by
 * pressing a button for a row they can see — and a double-click on a row that
 * is already gone is the same trigger removeMemberFor cites.
 */
export async function cancelInviteFor(
  ctx: WriterCtx,
  playerId: Id<'players'>,
  args: { teamId: Id<'teams'>; email: string },
): Promise<void> {
  const team = await requireTeamCreatorFor(ctx, playerId, args.teamId)
  const email = normaliseInviteEmail(args.email)
  if (!email) throw accessError('INVALID_EMAIL')

  // One filter does both jobs: it computes the new array AND, by its length,
  // decides whether anything actually changed. completeProfileFor pairs a
  // `some` guard with the same filter; here the filter's own result is the
  // cheaper answer to the identical question.
  const remaining = team.invited.filter((entry) => entry.trim().toLowerCase() !== email)
  if (remaining.length === team.invited.length) return

  await ctx.db.patch(team._id, { invited: remaining })
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
git add v2/convex/teams.ts v2/convex/teams.test.ts v2/convex/access.ts \
  v2/src/lib/convex-error.ts
git commit -m "feat(v2): pending invites are visible and cancellable by the creator (wt-ksh.5.16)"
```

---

## Task 5: `leaveTeam`

**Files:**
- Modify: `v2/convex/teams.ts` (extract `cascadeDeleteTeam`, add `leaveTeamFor`)
- Modify: `v2/convex/teams.test.ts`
- Modify: `v2/convex/scoringSystems.ts`, `v2/convex/access.ts`, `v2/convex/scores.ts` (comments only)

**Corrected 2026-08-21 during implementation and again after review.** The draft of
this section shipped four defects, all in Step 1; independent review then found
five more, three of them in the corrections themselves. All are fixed in the
blocks below.

*From implementation:*

1. All five drafted tests asserted with a bare `.rejects.toThrow()`. Every other
   negative test in `teams.test.ts` pins the code, and all of these now do too.
   **The reason is narrower than the first correction claimed.** Under the
   creator test's own fixture the creator is on the roster and `today` is valid,
   so nothing upstream can throw and the bare assertion *did* kill a
   guard-deleted mutant — measured. What it does not kill is a guard throwing the
   WRONG code (`NOT_A_MEMBER` instead of `CREATOR_NOT_REMOVABLE`), which is
   mutant M1b below. That matters because the design mandates reusing
   `CREATOR_NOT_REMOVABLE`, and the code pin is the only thing tying the
   implementation to that decision.
2. "recomputes every month with a winner row" set up ONE month, so it could not
   tell "recomputed every month in `monthsWithWinners`" from "recomputed one of
   them" — the same headline-test weakness Task 4 found. It now uses TWO fixed
   past months (2025-06 and 2025-07) and asserts the celebration flag resets,
   mirroring `removeMemberFor`'s twin test. Mutant M12 survived the one-month
   version.
3. NOTHING pinned `requirePlausibleToday`; a mutant deleting it survived all five
   drafted tests (M13). Tests were added on the recompute path AND on the delete
   path — the second because the bound is deliberately checked BEFORE the branch,
   and only a test on the path that never reads `today` makes that a tested claim
   (M14).
4. The cascade comment claimed the empty-roster branch is reachable only when
   `creator` is undefined. It is also reachable for a team naming a creator who is
   not on its roster. The branch keys on the ROSTER, and a test pins it.

*From review:*

5. **The cascade's justification was false on one of its three verbs.** It said
   deleting beats "leaving a row nobody can see, join or administer". The
   administer half is right; **join is not** — `completeProfileFor` scans every
   team for the joiner's address with NO creator check, so an entry parked in
   `invited` on a creator-less team is genuinely still claimable. Since `invited`
   is copied wholesale from production, the branch therefore destroys a THIRD
   PARTY'S live invite. Deleting is still right (the alternative is the invitee
   landing alone on a team nobody can administer — the same dead end one step
   later), but the comment now says that, and a test pins the loss so it is a
   recorded choice rather than a side effect.
6. **The ordering promise was untested on both surfaces.** The comment promises
   the date bound sits before the creator guard "so a device with a wrong clock
   gets the same `INVALID_DATE` from either surface" — but both clock tests used a
   NON-creator leaver, so moving the bound below the guard left every test green.
   Pinned now with a creator + `today: '1999-01-01'` assertion in `leaveTeamFor`
   AND in `removeMemberFor`, which had no `INVALID_DATE` test of its own at all
   (M15, M16, M16b).
7. **`cascadeDeleteTeam` takes `Doc<'teams'>`, not `Id<'teams'>`.** It cannot
   enforce authorization, but taking the document makes an unauthorized call
   visually anomalous — a caller holding only a client-supplied `v.id('teams')`
   cannot reach it without an intervening fetch — and matches the neighbouring
   team-scoped writers (`recomputeTeamMonths`, `loadTeamMonthSystem`), where only
   the authorization-free read `monthsWithWinners` takes a bare id.
8. **`access.ts` and `scores.ts` enumerate every `requirePlausibleToday` caller,
   and both lists were left stale.** There are now SEVEN. That block in `access.ts`
   was rewritten in `b16cbb3` for exactly this reason; `wordle-teams-04r`'s
   pre-cutover check is "every clock-bounded surface" and this is where a reader
   enumerates them. Both lists updated, and each now points at the other.
9. **"THE ONE TEAM MUTATION THAT IS NOT CREATOR-ONLY" has a counterexample in the
   same file** — `createTeam`. Reworded to "the one mutation on an EXISTING team".
   The design spec carried the same wording and was corrected too.

Also corrected: `removeMemberFor`'s doc comment ended "v1 has no leave-team
affordance and neither does this", which this task makes false; and the
cross-team cascade test claimed to catch a mutant that `deleteTeamFor`'s
pre-existing "does not touch another team's winner rows" already kills. Its real
unique kill is the two call paths' cascades DIVERGING.

- [ ] **Step 1: Write the failing test**

Append to `v2/convex/teams.test.ts` after the `removeMemberFor` block — it is the
mirror of that helper and reads best beside it — and add `leaveTeamFor` to the
`./teams.ts` import. Eleven tests:

```ts
describe('leaveTeamFor', () => {
  test('a member removes themselves', async () => {
    const t = convexTest(schema, modules)
    await t.run(async (ctx) => {
      const creator = await ctx.db.insert('players', aPlayer({ email: 'creator@example.test' }))
      const bob = await ctx.db.insert('players', aPlayer({ email: 'bob@example.test' }))
      const teamId = await ctx.db.insert('teams', aTeam({ playerIds: [creator, bob], creator }))

      await leaveTeamFor(ctx, bob, { teamId, today })

      expect((await ctx.db.get(teamId))!.playerIds).toEqual([creator])
    })
  })

  test('refuses the creator, who reaches the creator guard rather than the membership one', async () => {
    // Their exit is deleteTeam. This keeps the Phase 3 invariant that a team
    // always has an administrator.
    //
    // THE CODE IS PINNED, not merely "it threw", and the reason is narrower than
    // it first looks. Under this fixture the creator IS on the roster and
    // `today` is valid, so nothing upstream can throw and even a bare
    // .rejects.toThrow() would kill a guard-deleted mutant — measured, not
    // assumed. What a bare toThrow() would NOT kill is a guard that throws the
    // wrong code: NOT_A_MEMBER instead of CREATOR_NOT_REMOVABLE. That is the
    // mutant this pin exists for, and it matters because the design mandates
    // reusing CREATOR_NOT_REMOVABLE here — this assertion is the only thing
    // tying the implementation to that decision.
    const t = convexTest(schema, modules)
    await t.run(async (ctx) => {
      const creator = await ctx.db.insert('players', aPlayer({ email: 'creator@example.test' }))
      const bob = await ctx.db.insert('players', aPlayer({ email: 'bob@example.test' }))
      const teamId = await ctx.db.insert('teams', aTeam({ playerIds: [creator, bob], creator }))

      await expect(leaveTeamFor(ctx, creator, { teamId, today })).rejects.toMatchObject({
        data: { code: 'CREATOR_NOT_REMOVABLE' },
      })
      expect((await ctx.db.get(teamId))!.playerIds).toEqual([creator, bob])
    })
  })

  test('a non-member is refused, and the roster is untouched', async () => {
    const t = convexTest(schema, modules)
    await t.run(async (ctx) => {
      const creator = await ctx.db.insert('players', aPlayer({ email: 'creator@example.test' }))
      const stranger = await ctx.db.insert('players', aPlayer({ email: 'stranger@example.test' }))
      const teamId = await ctx.db.insert('teams', aTeam({ playerIds: [creator], creator }))

      await expect(leaveTeamFor(ctx, stranger, { teamId, today })).rejects.toMatchObject({
        data: { code: 'NOT_A_MEMBER' },
      })
      expect((await ctx.db.get(teamId))!.playerIds).toEqual([creator])
    })
  })

  test('recomputes EVERY month the team has a winner row for', async () => {
    // TWO months, for the reason removeMemberFor's twin test gives: with a
    // single winner row this could not tell "recomputed every month in
    // monthsWithWinners" from "recomputed one of them". Both are fixed months
    // in 2025 — never the wall-clock month, or a mutant that ignored
    // monthsWithWinners and recomputed only `today`'s month would survive.
    const t = convexTest(schema, modules)
    await t.run(async (ctx) => {
      const creator = await ctx.db.insert('players', aPlayer({ email: 'creator@example.test' }))
      const bob = await ctx.db.insert(
        'players',
        aPlayer({ email: 'bob@example.test', firstName: 'Bob' }),
      )
      const teamId = await ctx.db.insert('teams', aTeam({ playerIds: [creator, bob], creator }))
      // Bob won both June and July 2025 outright.
      for (const puzzleDay of ['2025-06-02', '2025-07-02']) {
        await ctx.db.insert('dailyScores', {
          playerId: bob,
          puzzleDay,
          date: 1_755_500_000_000,
          answer: 'SPEED',
          guesses: ['SPEED'],
        })
      }
      for (const [year, month] of [
        [2025, 6],
        [2025, 7],
      ] as const) {
        await ctx.db.insert('monthlyWinners', {
          playerId: bob,
          teamId,
          year,
          month,
          hasSeenCelebration: [bob],
        })
      }

      await leaveTeamFor(ctx, bob, { teamId, today })

      // The creator has no scores at all, so a fresh compute gives her 0 for
      // both months — but winnerOf returns null only when the CANDIDATE LIST is
      // empty, not when every candidate scored zero, so with Bob gone she wins
      // both outright. If only one month had been recomputed the other would
      // still name Bob.
      const rows = await ctx.db.query('monthlyWinners').collect()
      expect(rows.map((row) => ({ month: row.month, playerId: row.playerId }))).toEqual([
        { month: 6, playerId: creator },
        { month: 7, playerId: creator },
      ])
      // The winner changed on both rows, so the celebration flag resets — proof
      // this is a genuine recompute, not the old rows left untouched.
      expect(rows.every((row) => row.hasSeenCelebration.length === 0)).toBe(true)
    })
  })

  test('the last member of a creator-less team deletes it and cascades', async () => {
    // The scoped-copy case: `creator` is undefined, so nobody is refused and the
    // team can be emptied. Leaving an unreachable orphan would be worse.
    const t = convexTest(schema, modules)
    await t.run(async (ctx) => {
      const bob = await ctx.db.insert('players', aPlayer({ email: 'bob@example.test' }))
      const teamId = await ctx.db.insert('teams', aTeam({ playerIds: [bob], creator: undefined }))
      await ctx.db.insert('monthlyWinners', {
        playerId: bob,
        teamId,
        year: 2025,
        month: 6,
        hasSeenCelebration: [],
      })
      await ctx.db.insert('scoringSystems', {
        teamId,
        effectiveFrom: '2025-06',
        oneGuess: 5,
        twoGuesses: 3,
        threeGuesses: 2,
        fourGuesses: 1,
        fiveGuesses: 0,
        sixGuesses: -1,
        failed: -3,
        nA: 0,
      })
      const scoreId = await ctx.db.insert('dailyScores', {
        playerId: bob,
        puzzleDay: '2025-06-02',
        date: 1_755_500_000_000,
        answer: 'SPEED',
        guesses: ['SPEED'],
      })

      await leaveTeamFor(ctx, bob, { teamId, today })

      expect(await ctx.db.get(teamId)).toBeNull()
      expect(await ctx.db.query('monthlyWinners').collect()).toEqual([])
      expect(await ctx.db.query('scoringSystems').collect()).toEqual([])
      // A board belongs to the player and is shared across every team.
      expect(await ctx.db.get(scoreId)).not.toBeNull()
    })
  })

  test('a pending invite is destroyed with the team, and that is the intended trade', async () => {
    // THE INVITE IS A THIRD PARTY'S, and it was live: completeProfileFor scans
    // every team for the joiner's address with NO creator check, so an entry
    // parked on a creator-less team really could still be claimed. `invited` is
    // copied wholesale from production, so this state is reachable with real
    // data rather than only by construction.
    //
    // Pinned so the choice is recorded rather than incidental. The alternative
    // is worse: the invitee claims it later and lands alone on a team nobody can
    // administer, which is the same dead end one step further on.
    const t = convexTest(schema, modules)
    await t.run(async (ctx) => {
      const bob = await ctx.db.insert('players', aPlayer({ email: 'bob@example.test' }))
      const teamId = await ctx.db.insert(
        'teams',
        aTeam({ playerIds: [bob], creator: undefined, invited: ['pending@example.test'] }),
      )

      await leaveTeamFor(ctx, bob, { teamId, today })

      expect(await ctx.db.get(teamId)).toBeNull()
      // Nowhere left to claim: no team parks that address any more.
      const teams = await ctx.db.query('teams').collect()
      expect(teams.flatMap((team) => team.invited)).toEqual([])
    })
  })

  test('deletes a team whose creator is not on its roster, when its last member leaves', async () => {
    // The branch is keyed on the ROSTER being empty afterwards, not on
    // `creator === undefined`. A team naming a creator who is not a member is
    // representable — the schema enforces no referential integrity between
    // `creator` and `playerIds` — and it is just as unadministrable, because
    // requireTeamCreatorFor goes through requireTeamMemberFor first. Pinned so
    // the cascade comment's claim about what reaches it is a tested one.
    const t = convexTest(schema, modules)
    await t.run(async (ctx) => {
      const ghost = await ctx.db.insert('players', aPlayer({ email: 'ghost@example.test' }))
      const bob = await ctx.db.insert('players', aPlayer({ email: 'bob@example.test' }))
      const teamId = await ctx.db.insert('teams', aTeam({ playerIds: [bob], creator: ghost }))
      await ctx.db.insert('monthlyWinners', {
        playerId: bob,
        teamId,
        year: 2025,
        month: 6,
        hasSeenCelebration: [],
      })

      await leaveTeamFor(ctx, bob, { teamId, today })

      expect(await ctx.db.get(teamId)).toBeNull()
      expect(await ctx.db.query('monthlyWinners').collect()).toEqual([])
    })
  })

  test('refuses a today the server clock cannot believe, and the roster survives', async () => {
    // `today` decides which missed days are already due and is written into a
    // monthlyWinners row the whole team reads — the same reason every other
    // mutation that feeds one into recomputation bounds it. Added because a
    // mutant that dropped requirePlausibleToday from leaveTeamFor survived every
    // one of the five tests this block was originally drafted with.
    const t = convexTest(schema, modules)
    await t.run(async (ctx) => {
      const creator = await ctx.db.insert('players', aPlayer({ email: 'creator@example.test' }))
      const bob = await ctx.db.insert('players', aPlayer({ email: 'bob@example.test' }))
      const teamId = await ctx.db.insert('teams', aTeam({ playerIds: [creator, bob], creator }))

      await expect(leaveTeamFor(ctx, bob, { teamId, today: '1999-01-01' })).rejects.toMatchObject({
        data: { code: 'INVALID_DATE' },
      })
      expect((await ctx.db.get(teamId))!.playerIds).toEqual([creator, bob])
    })
  })

  test('bounds today BEFORE the creator guard, so a creator with a wrong clock gets INVALID_DATE', async () => {
    // The ordering promise in leaveTeamFor's comment, made testable. Both of the
    // other clock tests use a non-CREATOR leaver, so neither can see the bound
    // move below the creator guard — measured: that reorder left every other
    // test in this file green. The twin assertion for the other surface is in
    // removeMemberFor's block, since the claim is cross-surface parity.
    const t = convexTest(schema, modules)
    await t.run(async (ctx) => {
      const creator = await ctx.db.insert('players', aPlayer({ email: 'creator@example.test' }))
      const bob = await ctx.db.insert('players', aPlayer({ email: 'bob@example.test' }))
      const teamId = await ctx.db.insert('teams', aTeam({ playerIds: [creator, bob], creator }))

      await expect(
        leaveTeamFor(ctx, creator, { teamId, today: '1999-01-01' }),
      ).rejects.toMatchObject({ data: { code: 'INVALID_DATE' } })
    })
  })

  test('refuses an implausible today on the CASCADE path too, and the team survives', async () => {
    // The bound is checked before the branch, so the same call cannot be
    // accepted or refused depending on how many other people happen to be on the
    // team — and the path this pins is the one that DELETES a team. Separate
    // from the test above because only that ordering makes both true.
    const t = convexTest(schema, modules)
    await t.run(async (ctx) => {
      const bob = await ctx.db.insert('players', aPlayer({ email: 'bob@example.test' }))
      const teamId = await ctx.db.insert('teams', aTeam({ playerIds: [bob], creator: undefined }))

      await expect(leaveTeamFor(ctx, bob, { teamId, today: '1999-01-01' })).rejects.toMatchObject({
        data: { code: 'INVALID_DATE' },
      })
      expect(await ctx.db.get(teamId)).not.toBeNull()
    })
  })

  test('does not touch another team when one is cascaded away', async () => {
    // cascadeDeleteTeam is now called from two places and both index-scan by
    // teamId. Un-scoping the scan outright is ALREADY caught, by deleteTeamFor's
    // "does not touch another team's winner rows" — this is not that. What only
    // this test can see is the two call paths DIVERGING: a cascade that keeps
    // its scoping on the delete path and loses it on the leave path.
    const t = convexTest(schema, modules)
    await t.run(async (ctx) => {
      const bob = await ctx.db.insert('players', aPlayer({ email: 'bob@example.test' }))
      const doomed = await ctx.db.insert('teams', aTeam({ playerIds: [bob], creator: undefined }))
      const kept = await ctx.db.insert(
        'teams',
        aTeam({ legacyId: 207, playerIds: [bob], creator: bob }),
      )
      for (const teamId of [doomed, kept]) {
        await ctx.db.insert('monthlyWinners', {
          playerId: bob,
          teamId,
          year: 2025,
          month: 6,
          hasSeenCelebration: [],
        })
      }

      await leaveTeamFor(ctx, bob, { teamId: doomed, today })

      expect(await ctx.db.get(kept)).not.toBeNull()
      const remaining = await ctx.db.query('monthlyWinners').collect()
      expect(remaining.map((row) => row.teamId)).toEqual([kept])
    })
  })
})
```

One more goes INSIDE the existing `removeMemberFor` block, because the parity
claim above has two halves and this is the other one:

```ts
  test('bounds today BEFORE the creator guard, so a wrong clock gets INVALID_DATE here too', async () => {
    // The other half of leaveTeamFor's cross-surface parity claim: both helpers
    // check the clock before refusing a creator, so the same wrong clock gets
    // the same code from either. This surface had NO clock test at all before —
    // the bound could have been dropped from removeMemberFor entirely and
    // nothing would have noticed.
    const t = convexTest(schema, modules)
    await t.run(async (ctx) => {
      const ada = await ctx.db.insert('players', aPlayer())
      const bob = await ctx.db.insert('players', aPlayer({ email: 'bob@example.com' }))
      const teamId = await ctx.db.insert('teams', aTeam({ playerIds: [ada, bob], creator: ada }))

      // Removing the CREATOR, which is what would otherwise throw
      // CREATOR_NOT_REMOVABLE.
      await expect(
        removeMemberFor(ctx, ada, { teamId, playerId: ada, today: '1999-01-01' }),
      ).rejects.toMatchObject({ data: { code: 'INVALID_DATE' } })
      expect((await ctx.db.get(teamId))!.playerIds).toEqual([ada, bob])
    })
  })
```

- [ ] **Step 2: Run it to make sure it fails**

```bash
cd v2 && pnpm exec vitest run convex/teams.test.ts -t leaveTeamFor
```

Expected: FAIL — not exported.

- [ ] **Step 3: Extract the cascade from `deleteTeamFor`**

In `v2/convex/teams.ts`, replace `deleteTeamFor` and its doc comment with:

```ts
/**
 * Delete a team and the rows that belong to it, CASCADING BY HAND.
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
 * NO ACCESS CHECK OF ITS OWN — every caller must do that first. Shared by
 * deleteTeamFor (creator-only) and by leaveTeamFor's last-member case.
 *
 * TAKES THE DOCUMENT, NOT AN ID, and that is the whole of the protection: it
 * cannot enforce authorization, but a caller holding only a client-supplied
 * `v.id('teams')` cannot reach it without an intervening fetch, which makes an
 * unauthorized call visually anomalous rather than indistinguishable from a
 * correct one. It also matches the neighbouring team-scoped writers —
 * recomputeTeamMonths and loadTeamMonthSystem both take a Doc<'teams'>, and only
 * the authorization-free read monthsWithWinners takes a bare id.
 */
async function cascadeDeleteTeam(ctx: WriterCtx, team: Doc<'teams'>): Promise<void> {
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

  // The team doc carries `invited`, so this is also what retires any invite
  // still parked on the team — see leaveTeamFor's empty-roster branch.
  await ctx.db.delete(team._id)
}

/**
 * Delete a team. Creator-only.
 *
 * The cascade, and why it is written out by hand, is cascadeDeleteTeam above.
 */
export async function deleteTeamFor(
  ctx: WriterCtx,
  playerId: Id<'players'>,
  teamId: Id<'teams'>,
): Promise<void> {
  const team = await requireTeamCreatorFor(ctx, playerId, teamId)
  await cascadeDeleteTeam(ctx, team)
}
```

**Comment corrections belong in this step.** `scoringSystems.ts`'s header claims
that module "owns the `scoringSystems` table exclusively", and `teams.ts`
restates it from the other side. That was already inaccurate — `deleteTeamFor`
writes it too. The carve-out goes in both headers: the scoring-system *editor* is
exclusive to `scoringSystems.ts`; deletion cascades are not, and after this task
there are **two** call paths (`deleteTeamFor` and `leaveTeamFor`, both via
`cascadeDeleteTeam`). `access.ts`'s and `scores.ts`'s `requirePlausibleToday`
caller lists both need `leaveTeam` adding — see correction 8.

**Corrected 2026-08-21.** An earlier version of this step said `deleteNamelessPlayers` was a third writer and told you to make its hand-rolled cascade call `cascadeDeleteTeam`. That mutation, its tests and its runner were all deleted in Task 0d — its input became unconstructible once the schema narrowed, so it could never be tested again. There is nothing there to rewire; do not go looking for it.

- [ ] **Step 4: Implement `leaveTeamFor`**

Add to `v2/convex/teams.ts`, directly after the `removeMember` mutation:

```ts
/**
 * Remove yourself from a team.
 *
 * THE ONE MUTATION ON AN EXISTING TEAM THAT IS NOT CREATOR-ONLY (createTeam is
 * not on an existing team), and the mirror of removeMember: that one lets the
 * creator remove anybody but themselves, this one lets anybody remove only
 * themselves.
 *
 * v1 has no such affordance at any layer — its UI hides remove on your own row
 * and the only exit is asking the creator. Owner-sanctioned; divergence 10.
 *
 * THE CREATOR CANNOT LEAVE. Their exit is deleteTeam. That keeps the invariant
 * that a team always has somebody who can administer it, and it means a team
 * with an administrator can never be emptied by leaving.
 */
export async function leaveTeamFor(
  ctx: WriterCtx,
  playerId: Id<'players'>,
  args: { teamId: Id<'teams'>; today: PuzzleDay },
): Promise<void> {
  const team = await requireTeamMemberFor(ctx, playerId, args.teamId)
  // BOUNDED ON BOTH PATHS, though only the recompute below reads it. The same
  // call must not be accepted or refused depending on how many other people
  // happen to be on the team, and the branch this does not feed is the one that
  // deletes a team. Ordered before the creator guard exactly as removeMemberFor
  // orders it, so a device with a wrong clock gets the same INVALID_DATE from
  // either surface.
  const today = requirePlausibleToday(args.today)
  if (team.creator === playerId) throw accessError('CREATOR_NOT_REMOVABLE')

  const remaining = team.playerIds.filter((memberId) => memberId !== playerId)

  // NOBODY LEFT. Reachable only when the team has no creator ON ITS ROSTER: the
  // guard above already refused a creator who is a member, and a scoped copy may
  // omit `creator` entirely (schema comment, Phase 1) or name somebody who was
  // not copied onto playerIds. Either way NOBODY CAN EVER ADMINISTER IT —
  // requireTeamCreatorFor goes through requireTeamMemberFor first — so it cannot
  // be renamed, invited to, or deleted by anyone, now or later.
  //
  // IT CAN STILL BE JOINED, and the invite it is deleted with is a THIRD
  // PARTY'S. completeProfileFor scans every team for the joiner's address with
  // no creator check at all, so an entry parked in `invited` here is live, and
  // `invited` is copied wholesale from production — a creator-less scoped copy
  // with one member and a pending invite is precisely the state this branch
  // exists for. Deleting is still the better of two bad outcomes: the alternative
  // is that the invitee eventually lands alone on a team nobody can administer,
  // which is the same dead end one step later. The invite goes with the team
  // because it IS a field on the team doc; this is a deliberate loss, not a
  // side effect nobody noticed, and a test pins it.
  if (remaining.length === 0) {
    await cascadeDeleteTeam(ctx, team)
    return
  }

  await ctx.db.patch(team._id, { playerIds: remaining })

  // The leaver stops being eligible to have won any month — divergence 5, the
  // same reason removeMember recomputes. Against the POST-PATCH document:
  // recomputeTeamMonth reads playerIds off the doc it is handed, and `team` is
  // the pre-patch snapshot, which still has the leaver on it.
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

Add `requireTeamMemberFor` to the `./access` import and `Doc` to the
`./_generated/dataModel` type import.

- [ ] **Step 5: Run the tests to verify they pass**

```bash
cd v2 && pnpm exec vitest run convex/teams.test.ts
```

Expected: PASS. The pre-existing `deleteTeamFor` tests must still pass — that
proves the cascade extraction changed nothing. Confirmed adequate: run against
each of the five `cascadeDeleteTeam` mutants below with `-t deleteTeamFor` and
those four tests alone kill all five.

- [ ] **Step 6: Mutation-test EVERY guard, one at a time**

Mutating only the creator guard is not enough. Break each of these separately,
with a CONTROL (unmutated, must pass) and a SANITY mutant, and judge every
verdict from vitest's EXIT CODE rather than by reading its output. Run the
battery against an isolated `git archive` copy with `node_modules` symlinked, not
against the live tree — concurrent reviewers have mutated a shared tree mid-read.

| # | mutant | outcome |
| --- | --- | --- |
| SANITY | `leaveTeamFor` never patches | KILLED (2) |
| M1 | creator guard deleted | KILLED (1) |
| M1b | creator guard throws `NOT_A_MEMBER` instead | KILLED (1) |
| M2 | `requireTeamMemberFor` → bare `ctx.db.get` | KILLED (1) |
| M3 | empty-roster branch deleted | KILLED (3) |
| M4 | empty-roster branch inverted (`!== 0`) | KILLED (5) |
| M5 | recompute call deleted | KILLED (1) |
| M6 | `cascadeDeleteTeam` skips `monthlyWinners` | KILLED (5) |
| M7 | `cascadeDeleteTeam` skips `scoringSystems` | KILLED (2) |
| M8 | `cascadeDeleteTeam` skips the team doc | KILLED (5) |
| M9 | `cascadeDeleteTeam` ALSO deletes `dailyScores` | KILLED (2) |
| M10 | cascade drops the `teamId` index scoping | KILLED (2) |
| M11 | recomputes only `monthOf(today)` | KILLED (1) |
| M12 | recomputes only the first month with a winner | KILLED (1) |
| M13 | `requirePlausibleToday` dropped | KILLED (3) |
| M14 | `today` bounded on the recompute path only | KILLED (3) |
| M15 | `leaveTeamFor`: bound moved BELOW the creator guard | KILLED (1) |
| M16 | `removeMemberFor`: bound moved BELOW the creator guard | KILLED (1) |
| M16b | `removeMemberFor`: bound dropped entirely | KILLED (1) |
| M17 | empty roster keeps the team, and its pending invite, alive | KILLED (4) |
| M18 | cascade preserves `invited` by re-parking it | KILLED (1) |

Assert each mutation's anchor matches EXACTLY once before applying it — a
substring anchor for M14 silently matched four functions on the first attempt.

- [ ] **Step 7: Run the gates and commit**

```bash
cd v2 && pnpm test:once && pnpm exec tsc --noEmit && pnpm build
git add v2/convex/teams.ts v2/convex/teams.test.ts v2/convex/scoringSystems.ts \
        v2/convex/access.ts v2/convex/scores.ts
git commit -m "feat(v2): leaveTeam — a member can remove themselves (wt-ksh.5.17)"
```

---

## Task 6: `/complete-profile` route + dashboard guard

**Files:**
- Create: `v2/src/routes/complete-profile.tsx`
- Create: `v2/e2e/complete-profile.spec.ts`
- Modify: `v2/src/routes/index.tsx` (`beforeLoad`)
- Modify: `v2/convex/players.ts` (the clock bound — Step 3b)
- Modify: `v2/convex/players.test.ts`
- Modify: `v2/convex/access.ts`, `v2/convex/scores.ts` (the requirePlausibleToday call-site lists)
- Modify: `v2/src/lib/convex-error.ts` (export `typedCodeMessage`)
- Modify: `v2/e2e/login.spec.ts` (its cold signup now lands somewhere else)
- Modify: `v2/e2e/sign-in.ts` (parallel-worker-safe default address)

- [ ] **Step 1: Create the route**

Create `v2/src/routes/complete-profile.tsx`. As shipped:

```tsx
import { createFileRoute, redirect, useNavigate } from '@tanstack/react-router'
import { convexQuery, useConvexMutation } from '@convex-dev/react-query'
import { useMutation } from '@tanstack/react-query'
import { useState, type FormEvent } from 'react'
import { api } from '../../convex/_generated/api'
import { pageTitle } from '#/lib/seo'
import { useHydrated } from '#/lib/use-hydrated'
import { Button } from '#/components/ui/button.tsx'
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '#/components/ui/card.tsx'
import { Input } from '#/components/ui/input.tsx'
import { Label } from '#/components/ui/label.tsx'
import { dashboardErrorMessage, mutationErrorMessage, typedCodeMessage } from '#/lib/convex-error.ts'
import { isCompleteName } from '../../convex/lib/invite.ts'
import { toPuzzleDay } from '../../convex/lib/puzzleDay.ts'
import type { ErrorComponentProps } from '@tanstack/react-router'

/**
 * The one screen every v2 account passes through, because completeProfile is
 * what CREATES the player row (see convex/players.ts).
 *
 * Ports v1's /complete-profile, which A7 makes a sanctioned parity exception —
 * this is the onboarding surface, and it is the largest measured leak in the
 * product (wordle-teams-456: 87% of prod signups never enter a board;
 * wordle-teams-390: ~93% abandon at login). The COPY is v1's, verbatim. The
 * SHELL and the FORM MECHANICS are /login's — page-wrap, one Card, uncontrolled
 * inputs, a hydration-gated submit and one role="alert" — rather than v1's bare
 * `mt-24` block, because these two screens are consecutive steps of the same
 * funnel and A7 is the reason /login was restyled in the first place.
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
  // THE FIRST ROUTE TO AWAIT A CONVEX QUERY IN beforeLoad, so it is also the
  // first that needs its own boundary: without one, a throw from needsProfile
  // renders TanStack's raw default — "Something went wrong!", a Hide Error
  // toggle and the error string, with no Header, no Footer and no way out — on
  // the screen where the account is created. See CompleteProfileError below.
  errorComponent: CompleteProfileError,
  component: CompleteProfilePage,
})

/**
 * This route's error boundary. NOT DashboardError, which is not a drop-in: it
 * clears `STORAGE_KEY` and navigates to `/` with empty search, both of which are
 * dashboard-specific repairs for a stale `?team=`. Nothing here has a bad
 * parameter to escape — the only thing that can throw is the needsProfile read
 * — so plain `reset()` is the right retry: it re-runs beforeLoad, which is
 * exactly the operation that failed.
 *
 * DESIGN_SYSTEM.md §7 "Error state": `text-lg` headline, muted body, single
 * primary retry button, same as DashboardError.
 */
function CompleteProfileError({ error, reset }: ErrorComponentProps) {
  return (
    <main className="flex w-full justify-center p-2 md:p-12">
      <div className="flex max-w-lg flex-col items-center gap-4 pt-10 text-center">
        <p className="text-lg">Ruh roh, something went wrong!</p>
        <p className="text-muted-foreground">{dashboardErrorMessage(error)}</p>
        <Button onClick={reset}>Try again</Button>
      </div>
    </main>
  )
}

function CompleteProfilePage() {
  const navigate = useNavigate()
  const hydrated = useHydrated()
  const complete = useMutation({ mutationFn: useConvexMutation(api.players.completeProfile) })
  const [error, setError] = useState<string | null>(null)
  const [submitting, setSubmitting] = useState(false)

  /**
   * THE INPUTS ARE UNCONTROLLED AND SUBMIT IS GATED ON HYDRATION ALONE, exactly
   * as login.tsx does it, and for the same reason (wt-ksh.2.2): this form is
   * server-rendered, so it looks interactive before any JavaScript has run. A
   * controlled input bound to empty state wipes whatever was typed the moment
   * React attaches, and a click before then fires a native GET that carries
   * nothing and reads as "the button does nothing" — on the screen where the
   * account is created. `!hydrated` is now the ONLY thing disabling this button,
   * which makes it load-bearing; e2e/complete-profile.spec.ts asserts it with
   * JavaScript switched off.
   *
   * IT IS DELIBERATELY *NOT* GATED ON THE NAME BEING COMPLETE, though it was in
   * this task's first draft. A content-gated `disabled` strands the user: it
   * removes the button from the focus order, so tabbing out of Last Name lands
   * in the footer; Enter does nothing; `disabled:pointer-events-none` kills
   * hover and title; `required` never fires, because native validation only runs
   * on a submit attempt the gate makes unreachable — and none of that explains
   * itself. An error message tells the user strictly more than a dead button
   * does. Owner's ruling after Task 6's review.
   *
   * isCompleteName IS STILL THE SHARED PREDICATE — the same function
   * completeProfileFor validates with — so the message below and the server's
   * INVALID_NAME cannot disagree about what a complete name is, and they read
   * identically because both resolve through typedCodeMessage. What the client
   * check buys is a local, instant answer; the server validates regardless
   * (convex/players.ts), so deleting it would be a UX regression, not a hole.
   * It is stricter than `required`, deliberately: `required` is satisfied by a
   * single space, and isCompleteName trims before judging.
   *
   * THE ROUTE GUARD IS A THIRD THING and does NOT go through isCompleteName —
   * needsProfile is a row-existence check that never reads a name back. It is
   * closed against a bounce anyway, and more strongly: completeProfileFor
   * validates BEFORE it writes and always leaves a row behind, so a name that
   * saves clears the guard whatever the guard's opinion of names would be. v1's
   * bug was having a second opinion at all — it saved any non-empty name and
   * guarded its redirect on `length > 1`, so a one-character name saved and then
   * redirected forever.
   */
  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    // Read from the DOM, synchronously, before any await: the inputs are
    // uncontrolled precisely so the DOM is the source of truth for what was
    // entered, and `currentTarget` is null once the handler yields.
    const data = new FormData(event.currentTarget)
    const firstName = String(data.get('firstName') ?? '')
    const lastName = String(data.get('lastName') ?? '')

    setError(null)
    if (!isCompleteName(firstName, lastName)) {
      // The server's own copy for this code, not a second wording of it.
      setError(typedCodeMessage('INVALID_NAME'))
      return
    }

    setSubmitting(true)
    try {
      await complete.mutateAsync({ firstName, lastName, today: toPuzzleDay(new Date()) })
      // NOTHING PRIMES THE CACHE BEFORE THIS HOP, AND NOTHING HAS TO — but the
      // reason is subtle enough to be worth stating, because getting it wrong
      // is the redirect loop wordle-teams-obw warns about. `/`'s beforeLoad
      // asks ensureQueryData for this same needsProfile key, and ensureQueryData
      // returns cached data WITHOUT revalidating; a stale `true` left by this
      // route's own guard would bounce the user straight back here. It cannot
      // be stale by the time this line runs: @convex-dev/react-query subscribes
      // to every convex query the moment its cache entry is created (the query
      // cache's 'added' event — an observer is not required), and Convex holds
      // a mutation's promise until the client's query set has advanced past
      // that mutation's timestamp. So `false` is already in the cache here.
      // Verified in the browser as well as reasoned about, and the round trip
      // is pinned by e2e/complete-profile.spec.ts so a regression cannot land
      // silently.
      await navigate({ to: '/' })
    } catch (err) {
      // Inline rather than a toast, unlike the team dialogs: this page has one
      // action and one error surface, the alert is announced by a screen reader
      // and stays put while the user fixes the field, and it does not depend on
      // the root Toaster being mounted.
      setError(mutationErrorMessage(err, 'Could not save your profile, please try again'))
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <main className="page-wrap flex justify-center px-4 py-10 sm:py-16">
      <Card className="w-full max-w-sm">
        <CardHeader>
          <CardTitle className="text-2xl" asChild>
            <h1>Complete Your Profile</h1>
          </CardTitle>
          <CardDescription>Please provide your name to complete your profile</CardDescription>
        </CardHeader>
        <CardContent>
          {/* EACH LABEL IS GROUPED WITH ITS OWN FIELD (gap-2) and the groups are
              separated (gap-6). A uniform gap measured identically between
              label→input, input→next label and input→Submit, which reads as
              "Last Name" belonging to the First Name input as much as to its
              own, and glues Submit to the last field — a mis-tap hazard at
              390x844 with the keyboard up. v1 grouped each pair in a wrapper
              div too; /login has a single pair, so the ambiguity cannot arise
              there and its flat gap-3 does not transfer. */}
          <form onSubmit={handleSubmit} className="flex flex-col gap-6">
            <div className="grid gap-2">
              <Label htmlFor="firstName">First Name</Label>
              <Input
                id="firstName"
                name="firstName"
                type="text"
                autoComplete="given-name"
                required
              />
            </div>
            <div className="grid gap-2">
              <Label htmlFor="lastName">Last Name</Label>
              <Input
                id="lastName"
                name="lastName"
                type="text"
                autoComplete="family-name"
                required
              />
            </div>
            <Button type="submit" disabled={!hydrated || submitting}>
              {submitting ? 'Saving…' : 'Submit'}
            </Button>
            {error && (
              <p role="alert" className="text-sm text-danger">
                {error}
              </p>
            )}
          </form>
        </CardContent>
      </Card>
    </main>
  )
}
```

WHAT THE DRAFT GOT WRONG, and what review changed afterwards:

1. **The draft's inputs were controlled and its submit button had no hydration
   gate**, which reintroduces wt-ksh.2.2 on the one screen that creates the
   account: this form is server-rendered, so before React attaches, a click is a
   native GET that carries nothing and hydration wipes whatever was typed into a
   `value`-bound input. login.tsx fixed exactly this; the fix is copied here.
   Confirmed independently by a reviewer who delayed the client entry by 6s.
2. **The draft ALSO gated Submit on the name being complete, and that was wrong
   too** — the owner ruled it out after Task 6's review. A content-gated
   `disabled` strands the user: it takes the button out of the focus order (tab
   from Last Name landed in the footer), Enter does nothing,
   `disabled:pointer-events-none` kills hover and title, `required` never fires
   because native validation only runs on a submit attempt the gate makes
   unreachable, and nothing on the page explains any of it. Submit is now gated
   on `!hydrated || submitting` ALONE, exactly as login.tsx does it, and an
   invalid name produces a `role="alert"` carrying the server's own INVALID_NAME
   copy via the newly-exported `typedCodeMessage`. The property given up is
   "never enabled for a name the server would reject"; the server validates
   regardless, and a message tells the user strictly more than a dead button.
   That also deleted `names`, `readNames`, `formRef`, the mount effect, both
   `onChange` handlers, `canSubmit` and `aria-disabled` — the fields are read
   from `event.currentTarget` as login.tsx:108 does.
3. **The draft's comment claimed the form predicate, the server validation and
   the route guard "all go through `isCompleteName`". They do not** — the guard
   reads `needsProfile`, a row-existence check that never sees a name. The loop
   is closed more strongly than the draft claimed, by completeProfileFor
   validating before it writes and always leaving a row behind.
4. **The shell is /login's, not v1's bare `mt-24` block.** The copy is still
   v1's, verbatim. These two screens are consecutive steps of one funnel and A7
   is why /login was restyled; a v1-styled page between two restyled ones is a
   visible seam on the surface A7 exists to protect. Each label/field pair is
   grouped (`grid gap-2`) with the groups separated (`gap-6`): a uniform gap
   measured 12px between label→input, input→next label AND input→Submit at
   390x844, which reads as "Last Name" belonging to the First Name input as much
   as its own and glues Submit to the last field. /login has a single pair, so
   its flat gap does not transfer.
5. **This is the first route to `await` a Convex query in `beforeLoad`, so it is
   the first that needs its own `errorComponent`.** Without one a throw renders
   TanStack's raw default — "Something went wrong!", a Hide Error toggle, the
   error string, no Header, no Footer, no recovery — on the account-creation
   screen. `DashboardError` is NOT a drop-in: it clears `STORAGE_KEY` and
   navigates to `/`, both repairs for a stale `?team=` that cannot exist here.
   A local `CompleteProfileError` uses `dashboardErrorMessage` and plain
   `reset()`, which re-runs the beforeLoad that failed.

- [ ] **Step 2: Add the dashboard guard**

In `v2/src/routes/index.tsx`, replace `beforeLoad`:

```ts
  beforeLoad: async ({ context }) => {
    if (!context.isAuthenticated) throw redirect({ to: '/login' })
    // Every dashboard query assumes a player exists. Before Phase 4 a cold
    // signup reached this page anyway — getMyTeams returns [] rather than
    // throwing — pressed the one call to action, and got NO_PLAYER, which until
    // Task 4 rendered as "Your session expired": the wrong cause, and one
    // signing in again could not fix. See wt-ksh.5.1.
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

Expected: `tsc` FAILS first (`'/complete-profile'` is not in `FileRoutesByPath`) and passes after `pnpm build` regenerates `routeTree.gen.ts` via the vite plugin — do not run `tsr generate` by hand (see the note in `package.json`). Commit the regenerated `routeTree.gen.ts`.

- [ ] **Step 3b: What a wrong device clock does here — DECIDED, lenient**

`completeProfile` inherited `requirePlausibleToday`, so a device clock more than
a day off blocked **account creation** rather than merely an action. THE OWNER
RULED: create the player regardless of clock skew, and fall back to the server's
own date for the winner recompute. Everywhere else the bound blocks one action
and the user retries; here it would block the player row itself, and every route
guard bounces a playerless account back to this form — so the bound would lock
them out of the product entirely, at the single worst moment given signup is
already the largest measured leak (wordle-teams-456).

In `completeProfileFor` (`v2/convex/players.ts`), replacing
`const today = requirePlausibleToday(rawToday)`:

```ts
  const serverToday = toPuzzleDay(new Date())
  const today = isPlausibleToday(rawToday, serverToday) ? rawToday : serverToday
```

`isPlausibleToday` comes from `convex/lib/puzzleDay.ts` — the same predicate
`requirePlausibleToday` applies, so the strict and lenient sites cannot drift on
what "plausible" means. ONE clock read, reused for the test and the fallback:
two `new Date()` calls either side of midnight could judge against one day and
fall back to the next.

Consequences, both mandatory:

- `access.ts` and `scores.ts` each enumerate the `requirePlausibleToday` call
  sites, and Task 5 had just corrected both to say SEVEN and to name
  `completeProfile`. Both now say **six**, with `completeProfile` recorded as a
  documented exception and the reason. This is the comment-drift defect Task 5's
  review caught, one task later.
- `players.test.ts`'s "refuses a today the server clock cannot believe" is
  INVERTED into "CREATES THE PLAYER ANYWAY when the device clock is
  implausible", plus two recompute tests that pin which date is actually used:
  an implausible client date must recompute with the SERVER's, and a plausible
  one must be used AS SENT. The second needs a current-month fixture — the two
  dates differ by one day, so the only day they disagree about is today's — and
  is the only fixture in the file allowed to be dated in the current month.

- [ ] **Step 3c: Close `wordle-teams-obw` with e2e coverage**

`convex-test` cannot stand up a Better Auth session, so the body of every authed
wrapper — `needsProfile` included — is unreachable by the unit suite. Its most
valuable uncovered mutation is `needsProfile` inverted: either an infinite
redirect to the profile form, or an onboarding form nobody ever sees. Driving a
brand-new address through this route exercises it in both directions for real.

Create `v2/e2e/complete-profile.spec.ts`, reusing `./sign-in`, with four tests:

1. a cold signup lands on `/complete-profile`, submits a name, reaches the
   dashboard and STAYS there across a reload; `/complete-profile` then redirects
   an account that already has a player;
2. **a whitespace-only name shows the alert and does not navigate — asserted
   WITH THE CONTEXT OFFLINE.** This is the only thing that gives the test teeth:
   whitespace satisfies `required` but not `isCompleteName`, and the SERVER
   rejects the same input with the SAME copy, so an online run cannot tell a
   local rejection from a round trip and deleting the client-side check leaves
   the test green. With no network only the local check can produce the message.
   Same test asserts Submit is ENABLED with empty fields, pinning that the
   content gate is gone;
3. a one-character first and last name saves without bouncing back;
4. **with JavaScript disabled, Submit is disabled** — `!hydrated` is now the
   only gate, so it is load-bearing. The session must be minted with JS on (the
   OTP flow is a React form), so hand `storageState` to a second
   `javaScriptEnabled: false` context; a hand-built context needs `baseURL`
   passed explicitly.

Do NOT close obw by extracting a `needsProfileFor` helper for a single
row-existence check — the issue rules that out; it breaks the `...For`
convention.

**`v2/e2e/login.spec.ts` must be updated in the same commit.** Its account is
minted by `signIn()` and never seeded, so it has no `players` row — the guard in
Step 2 redirects exactly that account, and the spec's `toHaveURL('/')` plus
"not on a team yet" assertions go red. The new landing spot is
`/complete-profile`; what happens after submit belongs to the new spec. Do not
attribute either redirect to `__root`'s `beforeLoad` — it contains none; it
resolves the session and returns `isAuthenticated`, and each route guards
itself.

**`v2/e2e/sign-in.ts`'s default address needs a random suffix.** `e2e+${Date.now()}@…`
is unique across runs but not across parallel workers, and `playwright.config.ts`
pins no `workers`. As of this commit that address owns a `players` row, so a
same-millisecond collision makes the second caller land on the dashboard instead
of the form — a failure nobody would guess from the message.

- [ ] **Step 4: Drive it in the browser**

```bash
cd v2 && pnpm dev
```

Kill strays first with `lsof -ti :3000 | xargs -r kill` — a second `pnpm dev` silently binds 3001 and you end up testing a stale server.

Sign in as a never-before-seen e2e address with `E2E_TEST_MODE` on. Expected: you land on `/complete-profile`, not the dashboard. Submit a name. Expected: you land on the dashboard with the empty state and **Create a Team works**.

Then test the loop that v1 gets wrong: submit a one-character first and last name. Expected: it saves and you reach the dashboard — no bounce back.

PROBE THE REDIRECT HOP SPECIFICALLY. `/`'s `beforeLoad` calls `ensureQueryData`,
which returns cached data WITHOUT revalidating, so a stale `needsProfile: true`
left by this route's own guard would bounce the user back to the form they just
completed — the loop obw warns about. Measured: it does not happen, and not by
luck. `@convex-dev/react-query` subscribes to a convex query the moment its
cache entry is created (the query cache's `added` event; an observer is not
required), and Convex holds a mutation's promise until the client's query set
has advanced past that mutation's timestamp — `requestManager.removeCompleted(remoteQuerySet.timestamp())`.
So `false` is in the cache before `navigate` runs. Verified by deleting a
defensive `setQueryData` and re-driving the flow; no bounce either way, so the
defensive line was dropped rather than shipped with a comment that overstated
the risk. The e2e spec's post-submit reload assertion is what keeps it honest.

- [ ] **Step 5: Screenshot light and dark on a touch viewport**

Capture `/complete-profile` at 390×844 with touch emulation, in both themes. Wait for any animation to settle before capturing. Check for a horizontal scrollbar — a page-wide one is the exact class of bug Phase 3's gate caught.

- [ ] **Step 6: Run the gates and commit**

`pnpm e2e` is NOT in `test`/`tsc`/`build` and this task is the first to touch
routes and rendered UI — run it separately and report the result.

```bash
cd v2 && pnpm test:once && pnpm exec tsc --noEmit && pnpm build && pnpm e2e
git add v2/src/routes/complete-profile.tsx v2/src/routes/index.tsx v2/src/routeTree.gen.ts \
        v2/src/lib/convex-error.ts \
        v2/convex/players.ts v2/convex/players.test.ts v2/convex/access.ts v2/convex/scores.ts \
        v2/e2e/complete-profile.spec.ts v2/e2e/login.spec.ts v2/e2e/sign-in.ts
git commit -m "feat(v2): /complete-profile route and dashboard profile guard (wt-ksh.5.18)"
```

`wt-ksh.5.18` is this task. `wt-ksh.5.1` is an acceptance-criterion issue the
controller closes separately — do not reference it in the commit.

**Mutation results for Step 3b** (isolated extraction, verdicts from vitest exit
codes only):

| Mutant | Exit | Verdict | Killed by |
| --- | --- | --- | --- |
| CONTROL (unmutated) | 0 | PASSED, as required | — |
| SANITY (name validation removed) | 1 | KILLED | refuses an empty first or last name |
| M1 client date trusted unconditionally | 1 | KILLED | recomputes with the SERVER date when the client's is implausible |
| M2 server date used even when the client's is plausible | 1 | KILLED | recomputes with the CLIENT'S date when it is plausible |
| M3 condition inverted | 1 | KILLED | both recompute tests |
| M4 pre-Task-6 `requirePlausibleToday` restored | 1 | KILLED | CREATES THE PLAYER ANYWAY when the device clock is implausible |

**Mutation results for the route** (Playwright exit codes; e2e mutants cannot use
an isolated extraction, since the specs hit the vite dev server serving the
working tree — back up, mutate, restore, then verify `git diff`):

| Mutant | Exit | Verdict | Killed by |
| --- | --- | --- | --- |
| CONTROL (unmutated) | 0 | PASSED, as required | — |
| SANITY (post-save `navigate` removed) | 1 | KILLED | 3 of 4 tests |
| E1 `handleSubmit`'s isCompleteName check gutted | 1 | KILLED | the offline whitespace test, and only that one |
| E2 hydration gate removed from Submit | 1 | KILLED | all four — a pre-hydration click submits natively, which is wt-ksh.2.2 itself |
| E3 this route's own `!needsProfile` redirect removed | 1 | KILLED | the cold-signup test's reverse-direction assertion |

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
  // Id<'teams'>, for the reason CurrentTeamCard's own prop gives.
  teamId: Id<'teams'>
  teamName: string
}) {
  const invite = useMutation({ mutationFn: useConvexMutation(api.teams.invitePlayer) })
  const { height, offsetTop } = useVisualViewport()
  // CONTROLLED, unlike /login's and /complete-profile's inputs, and the
  // difference is not an oversight. Those two are rendered into the SSR HTML,
  // so a fast typist can type before hydration and React's first controlled
  // render wipes it (wt-ksh.2.2, and again in Phase 4). Radix unmounts
  // DialogContent while `open` is false, so nothing here exists until the user
  // clicks Invite — which is itself an onClick, and therefore already
  // post-hydration. There is no pre-hydration window to lose input in. Do not
  // "fix" this into an uncontrolled input: submit deliberately CLEARS the field
  // on already_member and deliberately LEAVES it on failure, and neither is
  // expressible without owning the value.
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
        teamId,
        email,
        today: toPuzzleDay(new Date()),
      })

      // EXHAUSTIVE, not a chain ending in `else`. Three of the four outcomes
      // carry an `email`, so a fifth InviteOutcome variant that also carried one
      // would fall into a bare else and be announced as "Invite sent to …" —
      // compiling cleanly, and in the one place whose entire purpose is one
      // message per outcome (divergence 9). The `never` assignment below turns
      // that into a compile error instead.
      switch (outcome.status) {
        case 'already_member':
          // The typed address, not a server-normalised one: `already_member`
          // carries no payload, because the server wrote nothing on that path.
          toast.info(`${email} is already on ${teamName}`)
          setEmail('')
          return // deliberately NOT closing — see the doc comment
        case 'added':
          toast.success(`${outcome.firstName} was added to ${teamName}`)
          break
        case 'resent':
          toast.success(`Invite re-sent to ${outcome.email}`)
          break
        case 'invited':
          toast.success(`Invite sent to ${outcome.email}`)
          break
        default: {
          const _exhaustive: never = outcome
          return _exhaustive
        }
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
        className="w-11/12 rounded-lg overflow-y-auto"
        style={height ? { top: offsetTop + height / 2, maxHeight: height } : undefined}
      >
        {/* NO WRAPPING OR TRUNCATING CLASSES HERE, DELIBERATELY, even though
            this is the only dialog title that embeds the team name.
            __root.tsx's <body> carries `[overflow-wrap:anywhere]`; it inherits,
            and unlike `break-words` it also shrinks min-content, so the grid
            column never widens and a 48-character unbreakable name already
            wraps inside the `w-11/12` box. Measured at 390px: bare title →
            overflow-wrap `anywhere`, dialog scrollWidth 356 == clientWidth 356.
            Adding `min-w-0 break-words` → `break-word`, byte-identical geometry
            and strictly weaker than what is inherited. Only neutralising the
            body rule too → scrollWidth 451 > clientWidth 356, real overflow.

            A `truncate` here is the one thing that genuinely breaks it, because
            its `white-space: nowrap` beats the inherited rule: the grid column
            takes min-content from the whole unwrapped string, DialogHeader is
            `text-center` inside it, and the description, the input and the
            Invite button all land off a 390px screen. An earlier draft of this
            file did exactly that.

            The lasting trap is the measurement, not the CSS: `document.
            scrollWidth` reports no horizontal overflow for anything inside
            DialogContent, because it is `fixed` and Radix locks body scroll
            while a dialog is open. Check the dialog's own scrollWidth. */}
        <DialogHeader>
          <DialogTitle>Invite Player to {teamName}</DialogTitle>
          <DialogDescription>Enter the player&apos;s email address</DialogDescription>
        </DialogHeader>
        <form onSubmit={handleSubmit} className="w-full space-y-6">
          <div className="space-y-2">
            {/* type="email" + required is v1's markup, kept: it gets the @ key
                on a phone keyboard and catches the obvious typo without a round
                trip. It is NOT the same rule as the server's — the HTML5
                validator accepts a dotless domain ('a@b') that
                normaliseInviteEmail rejects — so INVALID_EMAIL is still
                reachable from this form, not merely defence in depth. */}
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

  // Creator-only, and not even SUBSCRIBED TO for anyone else: these are real
  // email addresses, which is why they are not on getMyTeams.
  //
  // `'skip'` RATHER THAN `enabled: isCreator`, and the difference is not
  // stylistic. TanStack Query still adds a disabled query to its cache when the
  // hook mounts, and ConvexQueryClient opens its websocket watch from that
  // cache's `added` event (node_modules/@convex-dev/react-query, subscribeInner)
  // without consulting `enabled` at all — so every non-creator member's browser
  // would subscribe to a query that throws NOT_TEAM_CREATOR server-side, and log
  // it. `convexQuery(..., 'skip')` marks the query key skipped, which that same
  // subscriber checks before it watches anything, and sets `enabled: false` for
  // itself.
  //
  // useQuery, not useSuspenseQuery, so a member's card renders without waiting
  // on a read they are never going to make.
  const { data: invites } = useQuery(
    convexQuery(
      api.teams.getTeamInvites,
      isCreator ? { teamId } : 'skip',
    ),
  )

  // EXACT DUPLICATES ARE REACHABLE, so this cannot render `invited` raw. v1's
  // no-account branch appends the address without checking whether it is
  // already parked (`invited.includes(email)` is nested inside its
  // player-exists branch), so re-inviting somebody who never signed up parks the
  // same lowercase string twice; scripts/copy-from-supabase.mjs maps
  // `e.toLowerCase()` over the array and neither trims nor dedupes, so the pair
  // arrives intact. Two identical strings would mean duplicate React keys AND
  // `openEmail === email` matching both rows, so one click would open two
  // popovers.
  //
  // Deduplicating hides nothing the creator could act on: the rows are
  // character-for-character identical, and cancelInvite removes EVERY matching
  // entry anyway, so one row really is one cancellable address.
  //
  // WHAT THIS DOES NOT FIX, stated because it is easy to assume otherwise:
  // entries that merely NORMALISE to each other still render as two rows, and
  // those two rows are indistinguishable. Neither copy gate trims, so ' a@b.c'
  // and 'a@b.c' both survive as distinct strings — but HTML collapses the
  // leading space, so measured in this exact markup both spans have innerText
  // 'a@b.c' and width 48px, and both aria-labels read the same. Then
  // cancelInviteFor normalises before it filters, so cancelling either one
  // deletes BOTH: the list drops by two for a single click, with a toast naming
  // one address. Rare (it needs a padded row copied from v1) and it errs
  // towards clearing junk rather than leaving it, so it is recorded rather than
  // worked around — a fix belongs in the copy gate, not here.
  const pendingInvites = invites ? Array.from(new Set(invites)) : []

  const handleCancel = async (email: string) => {
    setPendingEmail(email)
    try {
      await cancel.mutateAsync({ teamId, email })
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
      await leave.mutateAsync({ teamId, today: toPuzzleDay(new Date()) })
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

Add `onLeft: () => void` to the props type, and NARROW `teamId` from `string` to
`Id<'teams'>` on both this component and `InvitePlayerDialog`. `getMyTeamsFor`
returns `id: team._id`, so the `index.tsx` call site already holds an
`Id<'teams'>`; widening it in the prop type was the only reason every
`mutateAsync` in either file had to cast it straight back, `handleRemove`'s
pre-existing cast included. `ScoresTable`'s `teamParam as Id<'teams'>` stays —
that one really does come from a URL string.

In the header, put Invite beside Settings:

```tsx
            {isCreator && (
              <div className="flex shrink-0 gap-2">
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
                    else's. getMyTeamsFor computes `isCreator` as
                    `team.creator === playerId`, the same comparison leaveTeamFor
                    makes before it throws CREATOR_NOT_REMOVABLE, so that error
                    is unreachable from this control while the server still
                    refuses a creator who asks for it directly.

                    THE TWO GATES DEGRADE IN OPPOSITE DIRECTIONS when
                    myPlayerId is null. `member.id === myPlayerId` matches
                    nothing, so a member gets no Leave control at all — nothing
                    offered, nothing broken. Remove's `member.id !== myPlayerId`
                    matches EVERYTHING, so a creator gets an extra Remove on
                    their own row that removeMemberFor always refuses with
                    CREATOR_NOT_REMOVABLE. That is Phase 3 behaviour and is left
                    alone here; it is recorded only so nobody reads these two
                    lines as symmetric. */}
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
        {isCreator && pendingInvites.length > 0 && (
          <div className="mt-4">
            <Separator className="mb-4" />
            <h3 className="text-muted-foreground mb-2 text-sm font-medium">Pending invites</h3>
            <ul className="flex flex-col space-y-2">
              {pendingInvites.map((email) => (
                <li key={email} className="min-w-0">
                  <div className="flex w-full min-w-0 items-center justify-between gap-2">
                    {/* WRAPS, where the member rows above truncate, and the
                        difference is the whole point of this section. A member
                        row shows a short name; a pending row shows an address,
                        and divergence 6 exists so a creator can "tell a typo
                        from a slow responder". Typos live in the TAIL —
                        @gmial.com, exampl3.com — which is exactly what an
                        ellipsis eats: at 390px the truncated box fit 31
                        characters, so three addresses differing only in domain
                        rendered pixel-identical. break-all rather than plain
                        wrapping because an address has no spaces to break at. */}
                    <span className="text-muted-foreground flex min-w-0 items-start gap-2">
                      {/* items-start + mt-[5px], not items-center: once an
                          address wraps, centring puts the envelope on line 2 of
                          3 — measured 24px, exactly one line box, below the
                          first line's midpoint (and 12px on a 2-line row). It is
                          the only row-start marker in a section that exists to
                          be SCANNED, so a marker pointing at the middle works
                          against the wrap beside it. 5px is (24 - 14) / 2, the
                          icon's optical centre on a 24px line box. The trash
                          button stays centred on the outer flex — that reads as
                          a row-level action. */}
                      <Mail size={14} className="mt-[5px] shrink-0" />
                      <span className="min-w-0 break-all">{email}</span>
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
      {/* The only thing that can set `inviteOpen` is the creator-only button
          above, so for everyone else this would mount a dialog with no trigger —
          and with it useVisualViewport's resize/scroll listeners — that can
          never open. */}
      {isCreator && (
        <InvitePlayerDialog
          open={inviteOpen}
          onOpenChange={setInviteOpen}
          teamId={teamId}
          teamName={name}
        />
      )}
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
| Invite `not-an-email` | the BROWSER refuses it — `type="email"` + `required` — with "Please include an '@'…"; nothing is submitted, no toast, dialog stays open |
| Invite `foo@bar` | passes HTML5 validation (which does not require a dot in the domain) but fails `normaliseInviteEmail`: error toast "That does not look like an email address."; dialog stays open, field keeps `foo@bar` |
| Cancel a pending invite | it disappears from Pending |
| As a non-creator member, open the card | no Settings, no Invite, no Pending section; a Leave control on your own row |
| Leave the selected team | you land on another team, not the error boundary |

- [ ] **Step 6: Screenshot light and dark on a touch viewport**

390×844 with touch emulation, both themes, with at least two pending invites and a long team name. Watch specifically for: a page-wide horizontal scrollbar (the Phase 3 bug), and a long email overflowing the Pending row rather than truncating.

Wait for Radix's `animate-in` to settle before capturing, or you will screenshot a half-open popover and think it is broken.

- [ ] **Step 7: Commit**

```bash
git add v2/src/components/teams v2/src/routes/index.tsx
git commit -m "feat(v2): invite dialog, pending invites and leave-team UI (wt-ksh.5.19)"
```

---

## Task 8: e2e, divergence list, beta, phase close

**Files:**
- Create: `v2/e2e/invites.spec.ts`
- Modify: `docs/design-system/V2-ADDENDUM.md` §7a

- [ ] **Step 1: Write the e2e spec**

Create `v2/e2e/invites.spec.ts`, following the two-context pattern already in `v2/e2e/teams.spec.ts`.

**THE HAPPY PATH BELOW IS NOT ENOUGH ON ITS OWN — PIN ALL FOUR `InviteOutcome`s AND THEIR EXACT COPY.** Task 7's review measured the hole: swapping the `resent` and `invited` toast strings, or deleting the `return` that keeps the dialog open on `already_member`, left all 294 unit tests, `tsc`, `build` and all 12 pre-existing e2e specs green. The outcome → message mapping *is* divergence 9's deliverable, and `already_member` is both the cheapest to reach (invite the creator's own address) and the highest value, because "nothing happened" and "it worked" are otherwise indistinguishable.

Four traps found while writing the real thing, all of which the draft below falls into:

1. **`@example.test` CANNOT SIGN IN.** `convex/testOtps.ts`'s `isE2eEmail` is `/^e2e\+[^@]+@wordleteams\.com$/i`, and `takeFor` throws for anything else — so an invitee at any other domain can be invited but can never accept, which is the half of this test that matters. Generate the invitee as `e2e+…@wordleteams.com`, unique per run.
2. **`await expect(dialog).toBeVisible()` DOES NOT PROVE THE DIALOG STAYED OPEN.** Radix keeps `DialogContent` mounted through its exit animation (`duration-200` in `ui/dialog.tsx`), so a dialog that has already been closed passes `toBeVisible` for a fifth of a second. Measured: the `already_member` `return` → `break` mutation SURVIVED against that assertion. Assert `toHaveAttribute('data-state', 'open')`, and then actually type into the field and submit — the branch exists so the address can be corrected, so prove it can be.
3. **`getByText(invitee)` MATCHES THE TOAST TOO**, because the toast copy embeds the address. Scope every pending-list assertion to the Current Team card, and count rows by the cancel control's `aria-label`, which is exactly one element per row.
4. **PLAYWRIGHT'S 30s DEFAULT TEST TIMEOUT IS NOT A BUDGET THIS FITS IN.** `sign-in.ts` polls for an OTP for up to 15s, and this test signs in twice; an assertion timeout larger than the test's own budget is not a timeout at all, and blowing the budget reports as "Test timeout exceeded" pointing at the `finally`, naming neither the assertion nor the cause. Call `test.setTimeout()` in every test here that signs in.

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
  test.setTimeout(120_000) // see trap 4 above
  // e2e+*@wordleteams.com, NOT @example.test — see trap 1 above.
  const invitee = `e2e+inv-joiner-${Date.now()}-${Math.floor(Math.random() * 1e6)}@wordleteams.com`

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
  // `?team=` is the real proof: with zero teams the dashboard renders the empty
  // state and never writes that parameter. /\/(\?|$)/ matches almost anything.
  await expect(joiner).toHaveURL(/\?team=/)
  await expect(joiner.getByRole('region', { name: 'Current Team' })).toContainText('Iva')

  // And the creator's Pending list clears reactively, with no reload. Scoped to
  // the card (trap 3), counted by the cancel control, and toHaveCount(0) rather
  // than toBeHidden: the section is gated on `pendingInvites.length > 0` so it
  // unmounts outright, and toBeHidden also passes for a locator that has
  // silently stopped matching anything — which a clearing assertion must not be
  // blind to. Generous timeout: this page has sat idle through the invitee's
  // whole sign-in, and a Convex client that reconnected comes back on a backoff.
  const card = creator.getByRole('region', { name: 'Current Team' })
  await expect(card.getByRole('button', { name: `Cancel invite to ${invitee}` }))
    .toHaveCount(0, { timeout: 20_000 })

  await creatorContext.close()
  await inviteeContext.close()
})
```

Fill in the two sign-in blocks from `v2/e2e/teams.spec.ts`'s existing helper. Do not invent a second sign-in implementation.

Then add tests for the other three outcomes:

- **`resent`** — invite the same fresh address a second time, before anyone accepts. Assert `Invite re-sent to {email}`, and that the pending list does **not** grow a second row (a resend writes nothing).
- **`already_member`** — the creator invites their own address. Assert an **info** toast (via sonner's `data-type`, not just the copy — the severity is the half that would silently drift back), the dialog still `data-state="open"` with the field empty, that no pending row was created, and that the still-open dialog is genuinely usable by correcting the address and submitting again. Correct it to a **seeded existing player**, so the correction takes the `added` branch: that is the one outcome that sends no email, and an `invited` correction puts a real Resend delivery on every local run.
- **`added`** — invite someone who already has a player row. Assert `{First} was added to {team}` and that they appear in the member list. Create that player through the real `/complete-profile` flow rather than `e2eSeed.ensureTeamFor`: the seed names every player it creates `E2E Tester`, so the creator and the added member would be character-for-character identical in the member list and "they appear in the list" could not be asserted at all.

**Then mutation-test the mapping.** Swap the `invited`/`resent`/`added` copy strings one at a time, and replace `already_member`'s `return` with a `break`; each must kill exactly one test. Run a CONTROL with no mutation, take verdicts from **exit codes only**, and prove with `git diff` that the component was restored.

- [ ] **Step 2: Run it**

```bash
cd v2 && pnpm e2e
```

Expected: PASS, including the pre-existing specs. `pnpm e2e` is not part of `test`/`tsc`/`build`, which is why a Phase 2 spec stayed red for three tasks.

**ONE PRE-EXISTING SPEC IS FLAKY AND THIS TASK DOES NOT FIX IT.** `e2e/complete-profile.spec.ts:61` ("a name of only whitespace is refused locally") fails roughly one full-suite run in six. Measured across 30 runs, including six with `e2e/invites.spec.ts` removed from the directory, so it is not this task's doing. Three hypotheses are already ruled out by the captured artifact: it is **not** slowness (the `590d653` comment's diagnosis — the promise settles, it does not hang), **not** repaired by retrying the submit (a `toPass` loop pressed Submit four times over 45s and every attempt failed the same way), and **not** an auth failure surfacing as `UNAUTHENTICATED` (that renders "Your session expired"; the artifact shows the page's generic fallback, *"Could not save your profile, please try again"*). It looks like the Convex client staying persistently broken for tens of seconds after `context.setOffline(false)`. Needs its own issue; do not paper over it with a bigger timeout, which has now been tried twice.

- [ ] **Step 3: Update the divergence list**

In `docs/design-system/V2-ADDENDUM.md` §7a, change the heading count from five to **eleven** — not ten. This step was written before Task 3's review found that v1's invite has FOUR branches rather than three; that became divergence 11, and the design doc (`…-phase4-invites-design.md`, "the list goes from five to eleven") was updated at `dede432` while this plan file was not. Append all six:

```markdown
| 6 | Pending invites are visible to the creator, and cancellable | Phase 4 (`wt-ksh.5.3`) | v1 shows them nowhere, so a typo'd address sits in `invited[]` forever with no remedy and no way to see it. Production carried 44 pending invites across 33 teams when this was written |
| 7 | A player cannot exist without a name | Phase 4 (`wt-ksh.5.1`) | `players.firstName`/`lastName` are required. 151 nameless production players and the 29 dead teams they created are not copied — measured, those players own 0 boards and 0 winner rows. This is what deleted `hasCompleteProfile` and its three must-agree call sites |
| 8 | No 2-team cap on invitees until Phase 5 | Phase 4 | v1 caps a non-pro invitee at two teams in `handle_invited_signup`. v2 is **more permissive than prod** until Polar lands. Note v1's `handle_add_player_to_team` cap branch is broken in production — it references an undeclared `invited_id` — so inviting an existing free player who already has two teams errors out rather than capping |
| 9 | Inviting someone already on the team says so | Phase 4 | v1 returns *"Successfully invited player"* and closes the dialog even when nothing happened. v2 shows an info toast and keeps the dialog open so the address can be corrected |
| 10 | A member can leave a team | Phase 4 | v1 has no self-removal at any layer — the UI hides remove on your own row and the only exit is asking the creator. Owner-sanctioned. The creator still cannot leave, so every team keeps an administrator |
| 11 | Inviting an existing player who is *also* already in `invited` adds them, rather than re-sending | Phase 4 | **v1's invite has FOUR branches, not the three this design first counted.** Its middle case — the player has an account AND the address is already parked in `invited` — re-sends the Supabase invite and does **not** add them to the team. `inviteUserByEmail` does nothing for an address that already has an account, so v1 mailed nobody, added nobody, and reported success; the invitee stayed off the team indefinitely however often the creator tried. v2 adds them and clears the `invited` entry in one write. Found by Task 3's review |
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

**NOT `git add -A`.** A pre-commit hook stages `.beads/issues.jsonl`, which the controller owns; `-A` sweeps it into whatever commit happens to run next. Commit by pathspec:

```bash
git commit --no-verify -m "test(v2): invite path e2e; record divergences 6-11" -- \
  v2/e2e/invites.spec.ts docs/design-system/V2-ADDENDUM.md \
  docs/superpowers/plans/2026-08-21-v2-phase4-invites.md
```

**Controller only** — pushing deploys to beta:

```bash
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
2. **Task 7's `useQuery` for `getTeamInvites`** must use `convexQuery(..., 'skip')`, not `enabled: isCreator`. This draft said `enabled` and predicted that dropping it would show up as a console error; BOTH halves were wrong, and Task 7 measured it. `enabled: isCreator` does not stop the subscription at all — ConvexQueryClient watches on the query cache's `added` event, which TanStack fires for a disabled query too — so a non-creator's browser really did execute `Q(teams:getTeamInvites)` (4 executions observed, versus 0 with `'skip'`). And it is SILENT: the adapter catches the refusal and writes it into the query's state, so nothing reaches the console. A reviewer looking for a red console line would have concluded it was fine.
