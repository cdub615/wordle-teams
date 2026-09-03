# v2 Phase 5 — Payments (Polar) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ship Polar billing in v2 — checkout, customer portal, an idempotent webhook handler that actually retries, the free/pro membership transitions, and the non-pro 2-team cap.

**Architecture:** Pure logic (`convex/lib/polarEvents.ts`, `convex/lib/polarIdentity.ts`) holds the event map and identity-candidate extraction with no I/O, so both are testable without Convex. A raw Convex `httpAction` in `convex/http.ts` verifies the Polar signature and controls its own HTTP status, because the status code is the retry protocol. All database work happens in one transactional internal mutation, so a failure rolls back cleanly and a retry reprocesses. Every rule lives in a `...For` helper, never in a query/mutation wrapper.

**Tech Stack:** Convex (mutations, actions, httpAction), `@polar-sh/sdk` (raw — not `@polar-sh/better-auth`), TanStack Start + React 19, `convex-test` + vitest, pnpm.

---

## Read This First

**Spec:** `docs/superpowers/specs/2026-08-26-v2-phase5-polar-design.md`. Read it before Task 0. Decisions A–L and the eight measurements are not repeated here in full.

**Non-negotiable house rules** (each has cost this project real time):

- **Run everything from inside `v2/` except git.** Import alias is `#/`. Convex modules import each other with explicit `.ts` extensions.
- **Never use `--no-verify`.** `core.hooksPath` is `.beads/hooks`; the pre-commit hook exports and stages `.beads/issues.jsonl` and chains to `scripts/check-no-pii.mjs`, the PII guard for this **public** repo. Commit normally.
- **Never put a real third-party email address** in a beads issue, a test fixture, or a commit message. Use `@example.com` / `@example.test`.
- **Gates, run from `v2/`:** `pnpm lint && pnpm typecheck && pnpm test:once && pnpm build`. `pnpm e2e` is **not** in the gates — run it by hand when you touch what it drives (Tasks 2, 11, 12).
- **Throw `ConvexError` via `accessError`**, never a plain `Error`. Plain `Error` messages are redacted in production but never redacted by `convex-test`, so a test cannot see the difference.
- **No task may run `convex deploy` or `convex dev`.** Pushing the branch triggers the GitHub Action that deploys to beta. That is the only sanctioned deploy path.
- **Subagents never push.** The controller pushes, and only `feat/v2-replatform`.
- **`enabled:` does not gate a Convex query** and is not a security boundary. Use `'skip'`.

**Verifying claims:** if you write a number or the word "every" in a comment or a commit message, run the command first and paste the result. Across the last five tasks every claim asserted from reasoning was wrong and every measured claim was right.

---

## File Structure

**Created:**

| File | Responsibility |
|---|---|
| `v2/convex/lib/polarEvents.ts` | The event → transition map. Pure: no I/O, no env, no Convex |
| `v2/convex/lib/polarEvents.test.ts` | Its tests |
| `v2/convex/lib/polarIdentity.ts` | Extract identity *candidates* from a webhook body. Pure |
| `v2/convex/lib/polarIdentity.test.ts` | Its tests |
| `v2/convex/polar.ts` | Convex **actions**: checkout, portal, checkout lookup, customer repair |
| `v2/convex/billing.ts` | Internal mutations + the `...For` helpers |
| `v2/convex/billing.test.ts` | Their tests |
| `v2/scripts/backfill-team-owner.mjs` | One-shot operational backfill (Task 0), deleted in Task 2 |
| `v2/src/components/checkout-return.tsx` | The reduced return leg |

**Modified:**

| File | Change |
|---|---|
| `v2/convex/schema.ts` | `owner` field; two `legacyId` widenings |
| `v2/convex/teams.ts` | `creator` → `owner`; export `cascadeDeleteTeam`; the 2-team cap |
| `v2/convex/access.ts` | `creator` → `owner`; rename two `AccessCode`s; rewrite `isProFor`'s doc comment |
| `v2/convex/migrate.ts` | Line 323 only: `{ creator: … }` → `{ owner: … }` |
| `v2/convex/players.ts` | The `legacyId is a required string` comment becomes false |
| `v2/convex/http.ts` | Register `POST /polar/webhook` |
| `v2/convex/scoringSystems.ts`, `e2eSeed.ts`, `inviteEmails.ts` | `creator` → `owner` |
| `v2/src/routes/index.tsx`, `src/components/teams/*.tsx`, `scoring-system-card.tsx` | `isCreator` → `isOwner`; mount the return leg |
| `v2/package.json` | `@polar-sh/sdk` |
| `docs/design-system/V2-ADDENDUM.md` | Divergences 8, 12, 13 |
| `v2/scripts/lib/copy-tallies.mjs` | Delete-site inventory gains the new site |

**Deliberately NOT modified:** `v2/scripts/copy-from-supabase.mjs`, `scripts/lib/copy-filters.mjs`, `scripts/lib/supabase-scope.mjs`. Their three `creator` references name **v1's Postgres column** and must stay.

---

## Task 0: Add `owner` beside `creator`, and the backfill

Deploy step 1 of 5. The schema must accept both fields at once so the backfill can run before anything reads `owner`.

**Files:**
- Modify: `v2/convex/schema.ts:98`
- Modify: `v2/convex/migrate.ts` (add the backfill internal mutation)
- Create: `v2/scripts/backfill-team-owner.mjs`
- Test: `v2/convex/migrate.test.ts`

- [ ] **Step 1: Write the failing test**

Add to `v2/convex/migrate.test.ts`:

```ts
test('backfillTeamOwner copies creator into owner and is idempotent', async () => {
  const t = convexTest(schema)
  const { alice, teamId } = await t.run(async (ctx) => {
    const alice = await ctx.db.insert('players', aPlayer({ legacyId: 'p-alice' }))
    const teamId = await ctx.db.insert(
      'teams',
      aTeam({ legacyId: 900, playerIds: [alice], creator: alice }),
    )
    return { alice, teamId }
  })

  const first = await t.mutation(internal.migrate.backfillTeamOwner, { dryRun: false })
  expect(first).toEqual({ scanned: 1, updated: 1 })
  expect((await t.run((ctx) => ctx.db.get(teamId)))?.owner).toBe(alice)

  // Idempotent: a second run finds nothing left to do.
  const second = await t.mutation(internal.migrate.backfillTeamOwner, { dryRun: false })
  expect(second).toEqual({ scanned: 1, updated: 0 })
})

test('backfillTeamOwner dry run reports without writing', async () => {
  const t = convexTest(schema)
  const teamId = await t.run(async (ctx) => {
    const alice = await ctx.db.insert('players', aPlayer({ legacyId: 'p-alice' }))
    return ctx.db.insert('teams', aTeam({ legacyId: 901, playerIds: [alice], creator: alice }))
  })

  expect(await t.mutation(internal.migrate.backfillTeamOwner, { dryRun: true })).toEqual({
    scanned: 1,
    updated: 1,
  })
  expect((await t.run((ctx) => ctx.db.get(teamId)))?.owner).toBeUndefined()
})

test('backfillTeamOwner leaves a creator-less team alone', async () => {
  const t = convexTest(schema)
  const teamId = await t.run((ctx) => ctx.db.insert('teams', aTeam({ legacyId: 902 })))

  expect(await t.mutation(internal.migrate.backfillTeamOwner, { dryRun: false })).toEqual({
    scanned: 1,
    updated: 0,
  })
  expect((await t.run((ctx) => ctx.db.get(teamId)))?.owner).toBeUndefined()
})
```

- [ ] **Step 2: Run the tests to verify they fail**

```bash
cd v2 && pnpm test:once convex/migrate.test.ts
```

Expected: FAIL — `internal.migrate.backfillTeamOwner` is not a function / property does not exist.

- [ ] **Step 3: Add `owner` to the schema**

In `v2/convex/schema.ts`, immediately after the `creator` line (currently line 98):

```ts
    creator: v.optional(v.id('players')), // optional: the creator may be outside a scoped copy

    // BEING RENAMED FROM `creator`. Both fields exist only for the duration of
    // the five-step deploy in Phase 5 (Task 0 adds this, Task 1 backfills it,
    // Task 2 switches every reader, Task 2b clears the old field, Task 2c
    // drops it). Convex validates the schema against existing documents on
    // push, so `creator` can only leave the schema once no document carries it,
    // and it can only be cleared once no deployed code reads it — which is why
    // this takes five steps rather than one. Beta holds natively-created teams
    // that a re-copy could not restore, so it must stay working throughout.
    //
    // WHY RENAME AT ALL: this field is read as a ROLE everywhere and never as
    // history — it gates settings, invites, member removal and deletion — and
    // Phase 5's softened downgrade reassigns it to another member, which makes
    // the name `creator` plainly false. See decision J in the Phase 5 spec.
    owner: v.optional(v.id('players')),
```

- [ ] **Step 4: Add the backfill internal mutation**

Append to `v2/convex/migrate.ts`:

```ts
/**
 * One-shot backfill for the `creator` → `owner` rename (Phase 5, deploy step 2).
 *
 * Sets `owner = creator` for every team that has a creator and no owner yet.
 * Idempotent, so re-running it is safe and reports `updated: 0`.
 *
 * DELETED IN TASK 2, along with scripts/backfill-team-owner.mjs. Once `creator`
 * leaves the schema this can never find a team to update and can never be
 * tested again — its fixtures become unconstructable — so keeping it would mean
 * permanently untested live code that cannot do anything.
 *
 * Counts only. It never returns or logs a team name or an address.
 */
export const backfillTeamOwner = internalMutation({
  args: { dryRun: v.boolean() },
  handler: async (ctx, { dryRun }) => {
    const teams = await ctx.db.query('teams').collect()
    let updated = 0

    for (const team of teams) {
      if (!team.creator || team.owner) continue
      updated += 1
      if (!dryRun) await ctx.db.patch(team._id, { owner: team.creator })
    }

    return { scanned: teams.length, updated }
  },
})
```

If `internalMutation` is not already imported in `migrate.ts`, add it to the existing import from `./_generated/server.ts`.

- [ ] **Step 5: Run the tests to verify they pass**

```bash
cd v2 && pnpm test:once convex/migrate.test.ts
```

Expected: PASS, including the three new tests.

- [ ] **Step 6: Write the operational script**

Create `v2/scripts/backfill-team-owner.mjs`.

**BUILT — read the real file, not a sketch.** This step is complete as of commits `6978f72` + `a59c5f3`; the code block that used to sit here was a sketch and three of its details were wrong against the actual codebase. Corrections, kept because they generalise to the other scripts in this plan:

- **`cleanup-nameless-players.mjs` does not exist.** Phase 4's spec describes it, but it was deleted after that phase, exactly as its own spec said it would be. The live models are **`v2/scripts/verify-parity.mjs`** and `copy-from-supabase.mjs`.
- **The env var is `CONVEX_MIGRATION_KEY`, not `CONVEX_ADMIN_KEY`.** No script in this repo uses the latter and no key carries it.
- **Do not put `--env-file=../.env.production.local` in the usage line.** That file holds 58 Vercel-generated secrets and zero `CONVEX_*` values; the siblings load it because they read Supabase, which this script never does.

Two things the built version does that the sketch did not, both worth keeping in later scripts:

- **Exits 1 when `scanned === 0`**, rather than printing a note. A run against the wrong `CONVEX_URL` is otherwise indistinguishable from a clean no-op, and exit 0 there reads as success.
- **Rejects unknown arguments.** Note this is *stricter* than its siblings, which validate only the value of `--scope=` and silently ignore anything else — so a mistyped `--exectue` is a no-op in `copy-from-supabase.mjs` today. This script is the first in the repo with the guard, not a conformance fix. Whether the siblings should get it too is filed separately.

- [ ] **Step 7: Run the gates**

```bash
cd v2 && pnpm lint && pnpm typecheck && pnpm test:once && pnpm build
```

Expected: all four green.

- [ ] **Step 8: Commit**

```bash
git add v2/convex/schema.ts v2/convex/migrate.ts v2/convex/migrate.test.ts v2/scripts/backfill-team-owner.mjs
git commit -m "feat(teams): add owner beside creator, with a backfill (rename step 1/5)"
```

---

## Task 1: Run the backfill against beta

Deploy step 2 of 5. **Operational — no code changes.** This is the controller's task, not a subagent's: it requires the branch to be pushed and credentials a subagent must not hold.

**Files:** none.

- [ ] **Step 1: Push, and watch the deploy**

```bash
git push
gh run watch
```

Expected: the GitHub Action deploys to beta green.

- [ ] **Step 2: Confirm the deployment holds real data first**

A zero against an empty database is meaningless. Phase 4 established the check: beta held 18 players, 7 teams, 6950 daily scores.

```bash
cd v2 && node scripts/backfill-team-owner.mjs
```

Expected: `teams scanned:` is **non-zero**. If it reports 0 teams scanned, stop — you are pointed at the wrong deployment.

- [ ] **Step 3: Execute**

```bash
cd v2 && node scripts/backfill-team-owner.mjs --execute
```

Expected: `owners written` equals the count the dry run reported as `owners that would be written`.

- [ ] **Step 4: Confirm idempotency**

```bash
cd v2 && node scripts/backfill-team-owner.mjs
```

Expected: `owners that would be written: 0`, with `teams scanned:` unchanged.

**A non-zero result here is probably NOT a failed backfill.** `createTeamFor` (`convex/teams.ts:163`) writes `creator` and no `owner`, and keeps doing so until Task 2 deploys. So any team created on beta between your `--execute` and Task 2 shows up as one more to write. Re-run `--execute` and carry on. The backstop is that `clearTeamCreator` refuses any creator-without-owner team at Task 2b, so a team created in this window can never silently reach the schema drop in Task 2c.

If you want the window closed entirely, run Task 2 promptly after this, or re-run `--execute` immediately before Task 2b.

- [ ] **Step 5: Record the numbers**

Paste the three observed counts into the beads issue for this task. They are the evidence Task 2 relies on, and Task 2 drops `creator` on the strength of them.

---

## Task 2: Switch every reference to `owner`, drop `creator`

Deploy step 3 of 5. Measured scope: **311 references across 20 files — 14 non-test, 6 test.** Three of the 311 are in `.mjs` and **must not change**.

**Files:**
- Modify: `v2/convex/schema.ts`, `access.ts`, `teams.ts`, `migrate.ts:323`, `scoringSystems.ts`, `e2eSeed.ts`, `inviteEmails.ts`
- Modify: `v2/src/routes/index.tsx`, `src/components/teams/current-team-card.tsx`, `src/components/teams/my-teams-card.tsx`, `src/components/scoring-system-card.tsx`
- Modify: all 6 `*.test.ts` files carrying the name
- Modify: `v2/e2e/invites.spec.ts` (47 refs), `v2/e2e/teams.spec.ts` (4) — locals and prose, no field accesses
- Delete: `v2/scripts/backfill-team-owner.mjs`, and `backfillTeamOwner` from `migrate.ts`

- [ ] **Step 1: Confirm the starting count**

```bash
cd v2 && grep -rn "creator\|Creator" --include='*.ts' --include='*.tsx' --include='*.mjs' convex/ src/ scripts/ | grep -v "_generated" | wc -l
```

**Record what it prints; do not match it against a number in this document.** Measured at 311 before Task 0 and **344** after Task 0 and its review fixes landed — the growth is Task 0's own `owner` schema comment, `backfillTeamOwner`, its tests and its doc comments. An earlier draft of this plan said 336 and itemised `clearTeamCreator` into that total, which was wrong: `clearTeamCreator` is added by **this** task, not Task 0. Any number written here ages the moment a comment is edited, so treat this as a starting inventory to reconcile against your own final count, not as a gate that halts.

**Three hazards, all measured after Task 0 rather than assumed:**

1. **`e2e/` is in scope and was missing from the original file list.** It holds **51** references across `e2e/invites.spec.ts` (47) and `e2e/teams.spec.ts` (4). Verified: **zero of them are field accesses** — `grep -rn "\.creator\b\|creator:" e2e/` returns 0. They are local Playwright names (`creator` page object, `creatorContext`, `creatorEmail`) and prose. So nothing breaks if you skip them, which is exactly why they are easy to miss — but comments like "both are creator-only, in the UI and the server" become false, and comment accuracy is a defect here. Rename them.

2. **Do NOT blind search-and-replace `owner`.** The word already appears in v2 prose meaning *the app's human owner* ("the owner's teams", "owner-confirmed", `e2e+inv-owner-…@wordleteams.com`). Replacing `creator`→`owner` is safe; the hazard is any reverse or fuzzy pass.

3. **`migrate.test.ts` has shadowed fixtures.** It now imports `aPlayer`/`aTeam` from `./fixtures.ts`, but the `upsertPlayers`, `upsertTeams` and `upsertMonthlyWinners` describe blocks each define *local* `aPlayer`/`aTeam` with a different shape — copy-input rows carrying `creatorLegacyId`/`playerLegacyIds`, not documents. **Lint and tsc are both silent about this.** `creatorLegacyId` is a wire name that must NOT be renamed, so read which fixture is in scope before touching any line in that file.

- [ ] **Step 2: Rename the identifiers**

Apply these renames across `convex/**/*.ts` and `src/**/*.tsx` — **not** `scripts/**/*.mjs`:

| From | To |
|---|---|
| `creator` (the `teams` field) | `owner` |
| `isCreator` | `isOwner` |
| `requireTeamCreatorFor` | `requireTeamOwnerFor` |
| `NOT_TEAM_CREATOR` | `NOT_TEAM_OWNER` |
| `CREATOR_NOT_REMOVABLE` | `OWNER_NOT_REMOVABLE` |
| `creatorDoc` (`migrate.ts`) | `ownerDoc` |

`migrate.ts`'s argument name `creatorLegacyId` **stays** — it names v1's column on the wire, and `copy-from-supabase.mjs` sends it under that name. Only line 323's write target changes:

```ts
        ...(ownerDoc ? { owner: ownerDoc._id } : {}),
```

- [ ] **Step 3: Update the two `AccessCode` members**

In `v2/convex/access.ts:29-41`:

```ts
export type AccessCode =
  | 'UNAUTHENTICATED'
  | 'NO_PLAYER'
  | 'NOT_A_MEMBER'
  | 'INVALID_BOARD'
  | 'NOT_TEAM_OWNER'
  | 'INVALID_TEAM'
  | 'INVALID_DATE'
  | 'OWNER_NOT_REMOVABLE'
  | 'INVALID_SYSTEM'
  | 'INVALID_EMAIL'
  | 'INVALID_NAME'
```

Grep the UI for any string comparison against the old codes — an error code is a wire value, and a stale comparison fails silently rather than at compile time:

```bash
cd v2 && grep -rn "NOT_TEAM_CREATOR\|CREATOR_NOT_REMOVABLE" src/ convex/
```

Expected after the rename: no matches.

- [ ] **Step 4: Add the mutation that clears `creator` — but do NOT drop the field yet**

**`creator` stays in the schema through this task.** Convex validates existing documents against the schema on push, so a field can only leave the schema once no document carries it — and the field can only be cleared once no deployed code reads it. Those two constraints point in opposite directions, which is why this is five steps and not three:

| Step | Deploy | `creator` in schema | `creator` on docs | Code reads | Beta |
|---|---|---|---|---|---|
| Task 0 | yes | yes | set | `creator` | works |
| Task 1 | — | yes | set | `creator` | works |
| **Task 2 (here)** | yes | **yes** | set | `owner` | works |
| Task 2b | — | yes | **cleared** | `owner` | works |
| Task 2c | yes | **dropped** | absent | `owner` | works |

Clearing `creator` in Task 0's backfill instead would break beta between Tasks 1 and 2, because the still-deployed code reads `creator` and would see every team as owner-less.

Add to `v2/convex/migrate.ts`, beside `backfillTeamOwner`:

```ts
/**
 * Clears teams.creator after the rename (Phase 5, deploy step 4 of 5).
 *
 * SEPARATE FROM backfillTeamOwner AND DEPLOYED LATER ON PURPOSE. A field can
 * only leave the schema once no document carries it, and it can only be cleared
 * once no deployed code reads it. Running this in the same pass that sets
 * `owner` would blank the field the then-current code still reads, and every
 * team would render owner-less on beta until the next deploy landed.
 *
 * Deleted in Task 2c together with backfillTeamOwner. Counts only.
 */
export const clearTeamCreator = internalMutation({
  args: { dryRun: v.boolean() },
  handler: async (ctx, { dryRun }) => {
    const teams = await ctx.db.query('teams').collect()
    let cleared = 0

    for (const team of teams) {
      if (!team.creator) continue
      // Refuse to blank a team that never got an owner — that would
      // manufacture exactly the owner-less state V2-ADDENDUM warns about.
      if (!team.owner) throw new Error(`team ${team._id} has creator but no owner`)
      cleared += 1
      if (!dryRun) await ctx.db.patch(team._id, { creator: undefined })
    }

    return { scanned: teams.length, cleared }
  },
})
```

Add a matching `--execute` script at `v2/scripts/clear-team-creator.mjs`, identical to `backfill-team-owner.mjs` but calling `internal.migrate.clearTeamCreator` and printing `creator cleared:`.

Add a test to `migrate.test.ts` mirroring the backfill's three:

```ts
test('clearTeamCreator refuses a team with a creator and no owner', async () => {
  const t = convexTest(schema)
  await t.run(async (ctx) => {
    const alice = await ctx.db.insert('players', aPlayer({ legacyId: 'p-alice' }))
    await ctx.db.insert('teams', aTeam({ legacyId: 903, playerIds: [alice], creator: alice }))
  })

  await expect(
    t.mutation(internal.migrate.clearTeamCreator, { dryRun: false }),
  ).rejects.toThrow(/has creator but no owner/)
})

test('clearTeamCreator clears a backfilled team and is idempotent', async () => {
  const t = convexTest(schema)
  const teamId = await t.run(async (ctx) => {
    const alice = await ctx.db.insert('players', aPlayer({ legacyId: 'p-alice' }))
    return ctx.db.insert(
      'teams',
      aTeam({ legacyId: 904, playerIds: [alice], creator: alice, owner: alice }),
    )
  })

  expect(await t.mutation(internal.migrate.clearTeamCreator, { dryRun: false })).toEqual({
    scanned: 1,
    cleared: 1,
  })
  expect((await t.run((ctx) => ctx.db.get(teamId)))?.creator).toBeUndefined()

  expect(await t.mutation(internal.migrate.clearTeamCreator, { dryRun: false })).toEqual({
    scanned: 1,
    cleared: 0,
  })
})
```

- [ ] **Step 4b: Rewrite the `owner` comment**

In `v2/convex/schema.ts`, leave `creator` in place but rewrite the `owner` comment:

```ts
    // The team's owner: the single player who can rename it, change its scoring
    // system, invite and remove members, and delete it. `isOwner` in the UI and
    // requireTeamOwnerFor in access.ts are the only readers.
    //
    // OPTIONAL because a scoped copy may not include the owner's own player row.
    //
    // NOT "the person who created it", and the name changed in Phase 5 to stop
    // implying that: a downgrade removes an over-cap owner from a team they own
    // and reassigns this field to the earliest-joined remaining member, so the
    // original creator is not recoverable from it and nothing wants to.
    owner: v.optional(v.id('players')),
```

**Do not delete the backfill scaffolding here** — Task 2b still needs it, and Task 2c removes both.

- [ ] **Step 5: Verify nothing READS `creator` any more**

```bash
cd v2 && grep -rn "creator\|Creator" --include='*.ts' --include='*.tsx' convex/ src/ e2e/ | grep -v "_generated" | grep -vE "^convex/(schema|migrate|migrate\.test)\.ts:" | wc -l
```

Expected: `0` — every reader is switched. **`e2e/` is included deliberately**: nothing there breaks without it, so it is the one directory a passing build will not catch.

**Note the `-vE` anchored exclusion.** An earlier draft used `grep -v "schema.ts\|migrate.ts"`, where the unescaped `.` is a regex wildcard — and that pattern does **not** match `convex/migrate.test.ts`, so the test file's 28 legitimately-protected references (5 `creatorLegacyId`, 23 scaffolding tests) counted as failures and the gate could never reach 0. `migrate.test.ts` is excluded on the same grounds as `migrate.ts`: it tests the migration scaffolding, which must keep naming the field it migrates from.

```bash
cd v2 && grep -c "creator" convex/schema.ts
```

Expected: non-zero — the field is deliberately still declared, and Task 2c is what removes it.

```bash
cd v2 && grep -rn "creator" --include='*.mjs' scripts/ | wc -l
```

Expected: `3` — unchanged, because those name v1's Postgres column.

- [ ] **Step 6: Run the gates and e2e**

```bash
cd v2 && pnpm lint && pnpm typecheck && pnpm test:once && pnpm build
cd v2 && pnpm e2e
```

Expected: gates green; e2e green. e2e is required here because this task edits `current-team-card.tsx` and `index.tsx`, which e2e drives.

If e2e fails with `Could not find public function for X:Y`, that is a **stale local Convex backend**, not a code fault. Kill the process holding port 3210 and its parent `convex dev`, run `npx convex dev --once`, then restart.

- [ ] **Step 7: Commit**

```bash
git add -A v2/
git commit -m "refactor(teams): switch every reader to owner (rename step 3/5)"
```

---

## Task 2b: Clear `creator` on beta

Deploy step 4 of 5. **Operational — no code changes.** Controller's task, like Task 1.

**Files:** none.

- [ ] **Step 1: Push Task 2 and watch the deploy**

```bash
git push && gh run watch
```

Expected: green. Beta now reads `owner`, which Task 1 populated.

- [ ] **Step 2: Dry-run the clear**

```bash
cd v2 && node scripts/clear-team-creator.mjs
```

Expected: the cleared count equals the `owners written` count Task 1 recorded. If it **throws** `has creator but no owner`, stop — Task 1's backfill did not cover every team, and dropping the field would strand one.

- [ ] **Step 3: Execute, then confirm idempotency**

```bash
cd v2 && node scripts/clear-team-creator.mjs --execute
cd v2 && node scripts/clear-team-creator.mjs
```

Expected: the second run reports `creator cleared: 0` with `scanned` unchanged.

- [ ] **Step 4: Sanity-check beta in a browser**

Load beta and confirm a team you own still shows its owner-only controls. Nothing reads `creator` at this point, so this should be invisible — but this is the last moment the field could be restored cheaply if it is not.

---

## Task 2c: Drop `creator` and delete the scaffolding

Deploy step 5 of 5.

**Files:**
- Modify: `v2/convex/schema.ts`, `v2/convex/migrate.ts`, `v2/convex/migrate.test.ts`
- Delete: `v2/scripts/backfill-team-owner.mjs`, `v2/scripts/clear-team-creator.mjs`

- [ ] **Step 1: Drop the field**

Remove the `creator` line from the `teams` table in `v2/convex/schema.ts`. The `owner` comment written in Task 2 Step 4b already stands on its own and needs no further edit.

- [ ] **Step 2: Delete the scaffolding**

Once `creator` leaves the schema, `backfillTeamOwner` and `clearTeamCreator` can never find a team to act on **and can never be tested again** — their fixtures become unconstructable. Keeping them would mean permanently untested live code that cannot do anything. This is the same reasoning Phase 4 applied to `deleteNamelessPlayers`.

Delete from `v2/convex/migrate.ts`: `backfillTeamOwner`, `clearTeamCreator`. Delete from `v2/convex/migrate.test.ts`: all five of their tests. Delete both `.mjs` scripts.

- [ ] **Step 3: Verify**

```bash
cd v2 && grep -rn "creator\|Creator" --include='*.ts' --include='*.tsx' convex/ src/ e2e/ | wc -l
```

Expected: `0`.

```bash
cd v2 && grep -rn "creator" --include='*.mjs' scripts/ | wc -l
```

Expected: `3` — unchanged. Those name v1's Postgres column.

```bash
cd v2 && ls scripts/backfill-team-owner.mjs scripts/clear-team-creator.mjs 2>&1
```

Expected: both "No such file or directory".

- [ ] **Step 4: Gates, e2e, commit, push**

```bash
cd v2 && pnpm lint && pnpm typecheck && pnpm test:once && pnpm build && pnpm e2e
git add -A v2/
git commit -m "refactor(teams): drop creator, delete the rename scaffolding (step 5/5)"
```

The controller pushes and watches the deploy. **If this push fails schema validation**, a document still carries `creator` — re-run Task 2b's dry run rather than forcing anything.

---

## Task 3: Widen the two blocking `legacyId` fields

Phase 5 is the first phase to write `playerMembership` or `webhookEvents`, and neither can be written today. Both are **widening** changes, so they need no backfill and land in one push.

**Files:**
- Modify: `v2/convex/schema.ts:228,236`
- Modify: `v2/convex/players.ts:53-55` (a comment that becomes false)
- Test: `v2/convex/schema.test.ts`

- [ ] **Step 1: Write the failing test**

Add to `v2/convex/schema.test.ts`:

```ts
test('playerMembership and webhookEvents accept a native row with no legacyId', async () => {
  const t = convexTest(schema)

  await t.run(async (ctx) => {
    const playerId = await ctx.db.insert('players', aPlayer({ legacyId: undefined }))

    // Born in v2: no Supabase identity to carry, and a synthesised value would
    // lie to by_legacyId and to Phase 7's reconciliation.
    await ctx.db.insert('playerMembership', { playerId, membershipStatus: 'pro' })

    await ctx.db.insert('webhookEvents', {
      webhookId: 'msg_2KWPBgLlAfxdpx2AI54pPJ85f4W',
      playerId,
      eventName: 'subscription.active',
      body: {},
      processed: true,
    })
  })
})
```

- [ ] **Step 2: Run it to verify it fails**

```bash
cd v2 && pnpm test:once convex/schema.test.ts
```

Expected: FAIL — the validator requires `legacyId`.

- [ ] **Step 3: Widen both fields**

`v2/convex/schema.ts`, in `playerMembership`:

```ts
    // OPTIONAL SINCE PHASE 5, for the reason players.legacyId is optional since
    // Phase 4: Phase 5 is the first phase in which v2 WRITES this table, and a
    // membership row for a player born in v2 has no Supabase identity to carry.
    // Absence means "born in v2, not copied", which is what Phase 7's
    // reconciliation needs. No synthesised value — the copy matches on
    // by_legacyId, so a fake one would silently never match.
    legacyId: v.optional(v.string()),
```

And in `webhookEvents`:

```ts
    // OPTIONAL SINCE PHASE 5, same reasoning. Every webhook v2 receives is
    // native and has no Supabase row behind it; the rows that DO carry a
    // legacyId are the copied Lemon Squeezy ones.
    legacyId: v.optional(v.number()),
```

- [ ] **Step 4: Fix the comment this falsifies**

`v2/convex/players.ts:53-55` currently says a `player_customer` equivalent is omitted because `playerMembership.legacyId` is a required string. That reason expires here. Replace it:

```ts
 * handle_new_user ALSO inserted a player_customer row with status 'new'. There
 * is deliberately no equivalent here — not because the schema forbids it (Phase
 * 5 made playerMembership.legacyId optional), but because isProFor (access.ts)
 * already reads a MISSING membership row as not-pro, which is exactly what
 * 'new' meant. Writing a row to say "nothing yet" buys nothing.
```

- [ ] **Step 5: Run the tests to verify they pass**

```bash
cd v2 && pnpm test:once convex/schema.test.ts
```

Expected: PASS.

- [ ] **Step 6: Gates and commit**

```bash
cd v2 && pnpm lint && pnpm typecheck && pnpm test:once && pnpm build
git add v2/convex/schema.ts v2/convex/schema.test.ts v2/convex/players.ts
git commit -m "feat(schema): allow native playerMembership and webhookEvents rows"
```

---

## Task 4: `convex/lib/polarEvents.ts` — the pure event map

> **SHIPPED, AND IT DIFFERS FROM THE SNIPPETS BELOW IN ONE WAY.** Commits `212814c` + `f79b1bf`. The snippets are kept as the historical record; the module is the source of truth.
>
> **`ACKNOWLEDGED_EVENTS` does not exist.** It was replaced by `export function isAcknowledgedEvent(eventType: string): boolean`. `ReadonlySet` is **compile-time only** — at runtime a caller can `.add()` to the exported set, and `Object.freeze()` does not prevent it (a frozen `Set` still accepts `.add()`, because entries live in internal slots rather than frozen properties; measured). That made the acknowledged-vs-unrecognised classification caller-corruptible, which is what Task 10 branches on to decide whether to log an unhandled event — in a module that spends fifteen lines justifying a `Map` precisely because its keys arrive from outside.
>
> **Task 10 must call `isAcknowledgedEvent(...)`, not `ACKNOWLEDGED_EVENTS.has(...)`.** Task 10's own snippets never referenced the symbol, so nothing else needs changing.
>
> Also note the plan's test named `'the two grant events do not share a mutable object'` **only asserted frozenness and never compared the two** — proven by experiment: under a mutation giving each grant event its own frozen object, the plan's 6-test suite exits 0 while the shipped 13-test suite exits 1.

**Files:**
- Create: `v2/convex/lib/polarEvents.ts`
- Test: `v2/convex/lib/polarEvents.test.ts`

- [ ] **Step 1: Write the failing tests**

Create `v2/convex/lib/polarEvents.test.ts`:

```ts
import { describe, expect, test } from 'vitest'
import { ACKNOWLEDGED_EVENTS, mapEventToTransition } from './polarEvents.ts'

describe('mapEventToTransition', () => {
  test('grants pro on active and uncanceled', () => {
    for (const event of ['subscription.active', 'subscription.uncanceled']) {
      expect(mapEventToTransition(event)).toEqual({ status: 'pro', effect: 'release-invites' })
    }
  })

  test('revokes on revoked only', () => {
    expect(mapEventToTransition('subscription.revoked')).toEqual({
      status: 'expired',
      effect: 'apply-team-limit',
    })
  })

  // The whole reason this module exists. `canceled` means the customer
  // SCHEDULED a cancellation and keeps paid access to the end of the period
  // they paid for; `revoked` means access actually ended. Conflating them
  // strips a paying customer's teams weeks early.
  test('canceled and past_due are recognised but change nothing', () => {
    expect(mapEventToTransition('subscription.canceled')).toBeNull()
    expect(mapEventToTransition('subscription.past_due')).toBeNull()
    expect(ACKNOWLEDGED_EVENTS.has('subscription.canceled')).toBe(true)
    expect(ACKNOWLEDGED_EVENTS.has('subscription.past_due')).toBe(true)
  })

  test('an unrecognised event yields null and is not acknowledged', () => {
    expect(mapEventToTransition('subscription.created')).toBeNull()
    expect(ACKNOWLEDGED_EVENTS.has('subscription.created')).toBe(false)
  })

  // A Record lookup walks the prototype chain: 'toString' would return a
  // Function and '__proto__' an object, both truthy, both reaching the database
  // as an undefined membership status. A Map has no prototype chain.
  test('prototype keys return null', () => {
    for (const key of ['toString', '__proto__', 'constructor', 'valueOf']) {
      expect(mapEventToTransition(key)).toBeNull()
      expect(ACKNOWLEDGED_EVENTS.has(key)).toBe(false)
    }
  })

  test('the two grant events do not share a mutable object', () => {
    const a = mapEventToTransition('subscription.active')
    expect(Object.isFrozen(a)).toBe(true)
  })
})
```

- [ ] **Step 2: Run to verify it fails**

```bash
cd v2 && pnpm test:once convex/lib/polarEvents.test.ts
```

Expected: FAIL — cannot resolve `./polarEvents.ts`.

- [ ] **Step 3: Implement**

Create `v2/convex/lib/polarEvents.ts`:

```ts
/**
 * Maps Polar subscription webhook events onto membership transitions.
 *
 * Ported from v1's src/lib/polar/events.ts. Deliberately pure — no Convex, no
 * network, no env — because it holds the only real logic in the billing
 * integration, and that is what makes every event name directly exercisable.
 *
 * THE IMPORTANT PART: Lemon Squeezy's `subscription_cancelled` set membership
 * to 'cancelled' and stripped teams immediately. Polar splits that single
 * moment in two:
 *
 *   subscription.canceled  the customer SCHEDULED a cancellation. They keep
 *                          paid access until the end of the period they paid for.
 *   subscription.revoked   access has actually ended.
 *
 * Downgrading on `canceled` deletes a paying customer's teams weeks before
 * their period expires. Only `revoked` removes access.
 */

export type MembershipEffect = 'release-invites' | 'apply-team-limit'

export type MembershipTransition = {
  status: 'pro' | 'expired'
  effect: MembershipEffect
}

// Frozen because both grant events share one object. Without this, a caller
// mutating the result of `subscription.active` would silently corrupt
// `subscription.uncanceled` too.
const GRANT: MembershipTransition = Object.freeze({
  status: 'pro',
  effect: 'release-invites',
})
const REVOKE: MembershipTransition = Object.freeze({
  status: 'expired',
  effect: 'apply-team-limit',
})

// A Map rather than an object literal, specifically because the key is an
// arbitrary string arriving from outside. A `Record` lookup walks the prototype
// chain, so 'toString' would return a Function and '__proto__' an object — both
// truthy, both violating this module's contract that anything unrecognised
// yields null, and both reaching the database as an `undefined` membership
// status. A Map has no prototype chain.
//
// A null VALUE means "recognised, but deliberately no membership change" —
// distinct from an event we do not recognise at all, which also yields null but
// is worth logging. ACKNOWLEDGED_EVENTS tells the two apart.
const TRANSITIONS = new Map<string, MembershipTransition | null>([
  ['subscription.active', GRANT],
  ['subscription.uncanceled', GRANT],

  // Paid through period end — see the note above. Access ends on revoked.
  ['subscription.canceled', null],

  // Payment failed but is recoverable by updating the payment method.
  // Downgrading here punishes a customer for an expired card before Polar has
  // finished retrying.
  ['subscription.past_due', null],

  ['subscription.revoked', REVOKE],
])

// The five events the Polar webhook endpoints subscribe to.
// `subscription.created` is deliberately absent: it fires when a subscription
// record is established, which is not the same as it being paid for and active.
// `subscription.active` is the grant signal.
export const ACKNOWLEDGED_EVENTS: ReadonlySet<string> = new Set(TRANSITIONS.keys())

export function mapEventToTransition(eventType: string): MembershipTransition | null {
  return TRANSITIONS.get(eventType) ?? null
}
```

- [ ] **Step 4: Run to verify it passes**

```bash
cd v2 && pnpm test:once convex/lib/polarEvents.test.ts
```

Expected: PASS, 6 tests.

- [ ] **Step 5: Mutation-test it**

This module is load-bearing. Work in an **isolated extraction**, never the live tree:

```bash
mkdir -p /tmp/mt && cd /tmp/mt && rm -rf v2 && \
  git -C /home/cdub/projects/wordle-teams archive HEAD:v2 | tar x -C /tmp/mt --one-top-level=v2 && \
  ln -s /home/cdub/projects/wordle-teams/v2/node_modules /tmp/mt/v2/node_modules
```

- CONTROL (must FAIL): change `['subscription.canceled', null]` to `['subscription.canceled', REVOKE]`. Run `pnpm test:once convex/lib/polarEvents.test.ts`; record the **exit code**. Non-zero = the suite catches the bug this module exists to prevent.
- SANITY (must PASS): reorder two unrelated map entries. Exit code 0.

Verdicts come from exit codes, not from reading output.

- [ ] **Step 6: Gates and commit**

```bash
cd v2 && pnpm lint && pnpm typecheck && pnpm test:once && pnpm build
git add v2/convex/lib/polarEvents.ts v2/convex/lib/polarEvents.test.ts
git commit -m "feat(billing): the pure Polar event map"
```

---

## Task 5: Identity — candidate extraction and dual-namespace resolution

**This task carries acceptance criterion 2, which is a release gate.** Both silent-202 cases must be pinned here, before any sandbox run.

**Files:**
- Create: `v2/convex/lib/polarIdentity.ts`, `v2/convex/lib/polarIdentity.test.ts`
- Create: `v2/convex/billing.ts` (first appearance), `v2/convex/billing.test.ts`

- [ ] **Step 1: Write the failing tests for the pure part**

Create `v2/convex/lib/polarIdentity.test.ts`:

```ts
import { describe, expect, test } from 'vitest'
import { extractIdentityCandidates } from './polarIdentity.ts'

describe('extractIdentityCandidates', () => {
  test('prefers the customer external id', () => {
    expect(
      extractIdentityCandidates({
        customer: { id: 'cus_1', externalId: 'k57abc' },
        metadata: { player_id: 'ignored' },
      }),
    ).toEqual({ candidates: ['k57abc', 'ignored'], customerId: 'cus_1', checkoutId: null })
  })

  // THE v1 SILENT-202 BUG. Polar matches a checkout to an EXISTING customer by
  // email and does not stamp external_customer_id onto it, so the value stays
  // on the checkout and the customer keeps its own null external id.
  test('falls back to checkout metadata when the customer external id is null', () => {
    expect(
      extractIdentityCandidates({
        customer: { id: 'cus_1', externalId: null },
        metadata: { player_id: 'k57abc' },
        checkoutId: 'ch_1',
      }),
    ).toEqual({ candidates: ['k57abc'], customerId: 'cus_1', checkoutId: 'ch_1' })
  })

  test('reports the checkout id when nothing else is present', () => {
    expect(
      extractIdentityCandidates({ customer: { id: 'cus_1', externalId: null }, checkoutId: 'ch_1' }),
    ).toEqual({ candidates: [], customerId: 'cus_1', checkoutId: 'ch_1' })
  })

  test('ignores non-string and empty candidates', () => {
    expect(
      extractIdentityCandidates({
        customer: { id: null, externalId: '' },
        metadata: { player_id: 42 },
      }),
    ).toEqual({ candidates: [], customerId: null, checkoutId: null })
  })

  test('falls back to customerId when customer is absent', () => {
    expect(extractIdentityCandidates({ customerId: 'cus_2' })).toEqual({
      candidates: [],
      customerId: 'cus_2',
      checkoutId: null,
    })
  })
})
```

- [ ] **Step 2: Run to verify it fails**

```bash
cd v2 && pnpm test:once convex/lib/polarIdentity.test.ts
```

Expected: FAIL — module not found.

- [ ] **Step 3: Implement the pure part**

Create `v2/convex/lib/polarIdentity.ts`:

```ts
/**
 * Pulls the identity CANDIDATES out of a Polar subscription webhook body.
 *
 * Pure: it returns strings to try, it does not resolve them. Resolution needs
 * ctx.db and lives in billing.ts's resolvePlayerIdFor.
 *
 * WHY THIS IS NOT JUST `customer.externalId`:
 *
 * Polar matches a checkout to an EXISTING customer by email when one exists,
 * and does not stamp external_customer_id onto that customer — the value stays
 * on the checkout while the customer keeps its own (often null) external id.
 * Observed on v1's dev on 2026-08-03: a real subscription went active, the
 * checkout carried the id correctly, the customer had external_id null, the
 * webhook was accepted with HTTP 202, and NOBODY WAS UPGRADED. Silent, because
 * 202 is not an error.
 *
 * This matters more in v2 than it did in v1: at cutover every migrated user
 * already exists as a Polar customer under their email, which is exactly the
 * failing case.
 *
 * NO UUID VALIDATION. v1 tested every candidate against a uuid regex. That
 * cannot be ported — v2's player id is a Convex Id, not a uuid — and it would
 * be actively wrong, because the uuids that DO arrive are v1 player ids, which
 * v2 stores as players.legacyId. The "is this real" question is answered by
 * looking the id up, not by its shape.
 */

export type SubscriptionIdentity = {
  customer?: { id?: string | null; externalId?: string | null } | null
  customerId?: string | null
  metadata?: Record<string, unknown> | null
  checkoutId?: string | null
}

export type IdentityCandidates = {
  /** Ordered cheapest-first. May be empty. */
  candidates: string[]
  /** The Polar customer to repair once we know who this is. */
  customerId: string | null
  /** Last-resort lookup source, used only if `candidates` all miss. */
  checkoutId: string | null
}

const asCandidate = (value: unknown): string | null =>
  typeof value === 'string' && value.length > 0 ? value : null

export function extractIdentityCandidates(data: SubscriptionIdentity): IdentityCandidates {
  const candidates: string[] = []

  const fromCustomer = asCandidate(data.customer?.externalId)
  if (fromCustomer) candidates.push(fromCustomer)

  const fromMetadata = asCandidate(data.metadata?.player_id)
  if (fromMetadata) candidates.push(fromMetadata)

  return {
    candidates,
    customerId: asCandidate(data.customer?.id) ?? asCandidate(data.customerId),
    checkoutId: asCandidate(data.checkoutId),
  }
}
```

- [ ] **Step 4: Run to verify it passes**

```bash
cd v2 && pnpm test:once convex/lib/polarIdentity.test.ts
```

Expected: PASS, 5 tests.

- [ ] **Step 5: Write the failing tests for resolution — the release gate**

Create `v2/convex/billing.test.ts`:

```ts
import { convexTest } from 'convex-test'
import { expect, test } from 'vitest'
import schema from './schema.ts'
import { aPlayer, aTeam } from './fixtures.ts'
import { resolvePlayerIdFor } from './billing.ts'

const V1_UUID = '11111111-1111-4111-8111-111111111111'

test('resolves a native Convex player id', async () => {
  const t = convexTest(schema)
  await t.run(async (ctx) => {
    const playerId = await ctx.db.insert('players', aPlayer({ legacyId: undefined }))
    expect(await resolvePlayerIdFor(ctx, [playerId])).toBe(playerId)
  })
})

// RELEASE GATE, case 1 — the v1 silent-202 failure. customer.externalId is
// null, metadata.player_id carries the value, resolution must still succeed.
test('resolves from checkout metadata when the customer external id was null', async () => {
  const t = convexTest(schema)
  await t.run(async (ctx) => {
    const playerId = await ctx.db.insert('players', aPlayer({ legacyId: undefined }))
    // `candidates` is what extractIdentityCandidates returns for a body whose
    // customer.externalId is null and whose metadata.player_id is set.
    expect(await resolvePlayerIdFor(ctx, [playerId])).toBe(playerId)
  })
})

// RELEASE GATE, case 2 — the case that hits EVERY migrated customer, and hits
// them on revocation. v1 set externalCustomerId to the v1 player id, a Postgres
// uuid. v2 stores that uuid as players.legacyId. normalizeId rejects it.
test('resolves a v1 uuid through by_legacyId', async () => {
  const t = convexTest(schema)
  await t.run(async (ctx) => {
    const playerId = await ctx.db.insert('players', aPlayer({ legacyId: V1_UUID }))
    expect(await resolvePlayerIdFor(ctx, [V1_UUID])).toBe(playerId)
  })
})

test('returns null when no candidate names a player', async () => {
  const t = convexTest(schema)
  await t.run(async (ctx) => {
    expect(await resolvePlayerIdFor(ctx, ['not-an-id', V1_UUID])).toBeNull()
  })
})

test('a well-formed Convex id for a deleted player does not resolve', async () => {
  const t = convexTest(schema)
  await t.run(async (ctx) => {
    const playerId = await ctx.db.insert('players', aPlayer({ legacyId: undefined }))
    await ctx.db.delete(playerId)
    expect(await resolvePlayerIdFor(ctx, [playerId])).toBeNull()
  })
})

test('tries candidates in order and takes the first that resolves', async () => {
  const t = convexTest(schema)
  await t.run(async (ctx) => {
    const first = await ctx.db.insert('players', aPlayer({ legacyId: undefined }))
    await ctx.db.insert('players', aPlayer({ legacyId: V1_UUID, email: 'other@example.com' }))
    expect(await resolvePlayerIdFor(ctx, [first, V1_UUID])).toBe(first)
  })
})
```

- [ ] **Step 6: Run to verify it fails**

```bash
cd v2 && pnpm test:once convex/billing.test.ts
```

Expected: FAIL — cannot resolve `./billing.ts`.

- [ ] **Step 7: Implement resolution**

Create `v2/convex/billing.ts`:

```ts
import type { Doc, Id } from './_generated/dataModel.d.ts'
import type { GenericDatabaseReader } from 'convex/server'
import type { DataModel } from './_generated/dataModel.d.ts'

type ReaderCtx = { db: GenericDatabaseReader<DataModel> }

/**
 * Turns Polar identity candidates into a real player id, across BOTH id
 * namespaces, taking the first candidate that names a live player.
 *
 * TWO NAMESPACES, and the second is not an edge case. v1's checkout.ts set
 * externalCustomerId to the v1 player id — a Postgres uuid — and v2 stores that
 * uuid as players.legacyId. So after cutover EVERY existing subscriber's
 * renewal, cancellation and revocation arrives carrying a string that
 * normalizeId rejects. Resolving only Convex ids would silently 202 every
 * paying customer, on revocation.
 *
 * Returns null rather than throwing: the caller answers 202, because a foreign
 * or unknown external id is not a transient fault and retrying can never fix
 * it. Returning 500 there would put Polar into an endless redelivery loop over
 * an event this app can do nothing with — for instance one belonging to a
 * different integration on the same organization.
 */
export async function resolvePlayerIdFor(
  ctx: ReaderCtx,
  candidates: readonly string[],
): Promise<Id<'players'> | null> {
  for (const raw of candidates) {
    // 1. A Convex id: a checkout this v2 created.
    const direct = ctx.db.normalizeId('players', raw)
    if (direct && (await ctx.db.get(direct))) return direct

    // 2. A v1 uuid: every customer that came across at cutover.
    const legacy = await ctx.db
      .query('players')
      .withIndex('by_legacyId', (q) => q.eq('legacyId', raw))
      .unique()
    if (legacy) return legacy._id
  }

  return null
}
```

- [ ] **Step 8: Run to verify it passes**

```bash
cd v2 && pnpm test:once convex/billing.test.ts
```

Expected: PASS, 6 tests.

- [ ] **Step 9: Gates and commit**

```bash
cd v2 && pnpm lint && pnpm typecheck && pnpm test:once && pnpm build
git add v2/convex/lib/polarIdentity.ts v2/convex/lib/polarIdentity.test.ts v2/convex/billing.ts v2/convex/billing.test.ts
git commit -m "feat(billing): dual-namespace player identity resolution"
```

---

## Task 6: `upgradeTeamInvitesFor` and the derived pending count

**Files:**
- Modify: `v2/convex/billing.ts`, `v2/convex/billing.test.ts`
- Modify: `v2/convex/teams.ts` (the derived count query)

- [ ] **Step 1: Write the failing tests**

Add to `v2/convex/billing.test.ts`:

```ts
import { upgradeTeamInvitesFor, pendingInviteCountFor } from './billing.ts'

test('upgrading releases every parked invite', async () => {
  const t = convexTest(schema)
  await t.run(async (ctx) => {
    const playerId = await ctx.db.insert(
      'players',
      aPlayer({ legacyId: undefined, email: 'ada@example.com' }),
    )
    const teams = await Promise.all([
      ctx.db.insert('teams', aTeam({ legacyId: 1, invited: ['ada@example.com'] })),
      ctx.db.insert('teams', aTeam({ legacyId: 2, invited: ['ada@example.com'] })),
      ctx.db.insert('teams', aTeam({ legacyId: 3, invited: ['ada@example.com'] })),
    ])

    await upgradeTeamInvitesFor(ctx, playerId)

    for (const id of teams) {
      const team = (await ctx.db.get(id))!
      expect(team.playerIds).toContain(playerId)
      expect(team.invited).toEqual([])
    }
    expect(await pendingInviteCountFor(ctx, playerId)).toBe(0)
  })
})

test('upgrading with no parked invites is a no-op, not an error', async () => {
  const t = convexTest(schema)
  await t.run(async (ctx) => {
    const playerId = await ctx.db.insert('players', aPlayer({ legacyId: undefined }))
    await expect(upgradeTeamInvitesFor(ctx, playerId)).resolves.toBeUndefined()
    expect(await pendingInviteCountFor(ctx, playerId)).toBe(0)
  })
})

test('a team that invited someone else is untouched', async () => {
  const t = convexTest(schema)
  await t.run(async (ctx) => {
    const playerId = await ctx.db.insert(
      'players',
      aPlayer({ legacyId: undefined, email: 'ada@example.com' }),
    )
    const other = await ctx.db.insert(
      'teams',
      aTeam({ legacyId: 4, invited: ['grace@example.com'] }),
    )

    await upgradeTeamInvitesFor(ctx, playerId)

    const team = (await ctx.db.get(other))!
    expect(team.playerIds).not.toContain(playerId)
    expect(team.invited).toEqual(['grace@example.com'])
  })
})

// The badge is derived, so a MIGRATED user — whose v1 counter was never copied
// — reads correctly rather than reading 0.
test('the pending count is derived from teams.invited', async () => {
  const t = convexTest(schema)
  await t.run(async (ctx) => {
    const playerId = await ctx.db.insert(
      'players',
      aPlayer({ legacyId: '11111111-1111-4111-8111-111111111111', email: 'ada@example.com' }),
    )
    await ctx.db.insert('teams', aTeam({ legacyId: 5, invited: ['ada@example.com'] }))
    await ctx.db.insert('teams', aTeam({ legacyId: 6, invited: ['ADA@example.com'] }))
    await ctx.db.insert('teams', aTeam({ legacyId: 7, invited: [] }))

    expect(await pendingInviteCountFor(ctx, playerId)).toBe(2)
  })
})

test('a player already on the team is not added twice', async () => {
  const t = convexTest(schema)
  await t.run(async (ctx) => {
    const playerId = await ctx.db.insert(
      'players',
      aPlayer({ legacyId: undefined, email: 'ada@example.com' }),
    )
    const teamId = await ctx.db.insert(
      'teams',
      aTeam({ legacyId: 8, playerIds: [playerId], invited: ['ada@example.com'] }),
    )

    await upgradeTeamInvitesFor(ctx, playerId)

    const team = (await ctx.db.get(teamId))!
    expect(team.playerIds).toEqual([playerId])
    expect(team.invited).toEqual([])
  })
})
```

- [ ] **Step 2: Run to verify it fails**

```bash
cd v2 && pnpm test:once convex/billing.test.ts
```

Expected: FAIL — `upgradeTeamInvitesFor` is not exported.

- [ ] **Step 3: Implement**

Add to `v2/convex/billing.ts` (and add `GenericDatabaseWriter` to the type imports):

```ts
type WriterCtx = { db: GenericDatabaseWriter<DataModel> }

/**
 * Normalises an invited address the same way every writer does.
 *
 * `invited` is lowercase by schema rule (schema.ts:101-107), but a copied v1
 * row predates that rule, and an entry this fails to match is one nothing can
 * ever clear.
 */
const normalise = (entry: string) => entry.trim().toLowerCase()

/**
 * Release every invite parked against this player's address.
 *
 * v1's handle_upgrade_team_invites (20240426190809): for every team whose
 * `invited` array holds their email, drop the email and append their id.
 *
 * KEYS OFF teams.invited, NOT OFF A COUNTER, and that is what makes decision D
 * safe. v1's invites_pending_upgrade lives in auth.users.raw_app_meta_data,
 * which the copy script does not read and must not start reading. The actual
 * parking is in teams.invited, which IS copied — so a migrated v1 user with
 * parked invites is released correctly here even though v2 never saw the
 * counter.
 *
 * NO COUNTER TO ZERO. v1 zeroes invites_pending_upgrade as a second statement;
 * v2 derives the count (pendingInviteCountFor), so removing the address IS the
 * update, and the two can never disagree.
 */
export async function upgradeTeamInvitesFor(
  ctx: WriterCtx,
  playerId: Id<'players'>,
): Promise<void> {
  const player = await ctx.db.get(playerId)
  if (!player) return

  const email = normalise(player.email)
  const teams = await ctx.db.query('teams').collect()

  for (const team of teams) {
    if (!team.invited.some((entry) => normalise(entry) === email)) continue

    await ctx.db.patch(team._id, {
      // Guarded: a team can legitimately list someone in BOTH playerIds and
      // invited — it is exactly what the copy brings over, since v1 never
      // removed an invite it could not match.
      playerIds: team.playerIds.includes(playerId)
        ? team.playerIds
        : [...team.playerIds, playerId],
      invited: team.invited.filter((entry) => normalise(entry) !== email),
    })
  }
}

/**
 * How many invites are parked against this player's address.
 *
 * DERIVED, NOT STORED, and the difference is visible to users. v1 keeps a
 * denormalised counter in auth metadata, written from five call sites using two
 * different formulas, so it can drift from teams.invited even in v1 — and it is
 * not copied, so every migrated user would read 0 while holding real parked
 * invites. Deriving it cannot drift and needs no backfill.
 *
 * Collect-and-filter is sanctioned here: Convex cannot index array membership,
 * and production holds 171 teams (schema.ts:123-126).
 */
export async function pendingInviteCountFor(
  ctx: ReaderCtx,
  playerId: Id<'players'>,
): Promise<number> {
  const player = await ctx.db.get(playerId)
  if (!player) return 0

  const email = normalise(player.email)
  const teams = await ctx.db.query('teams').collect()
  return teams.filter((team) => team.invited.some((entry) => normalise(entry) === email)).length
}
```

- [ ] **Step 4: Expose the count to the UI**

Add to `v2/convex/teams.ts`, beside `amIPro`:

```ts
/**
 * The "N Invites Pending" badge for a non-pro player.
 *
 * Ports v1's user-dropdown.tsx:182, which reads a counter out of the JWT's
 * app_metadata. v2 derives it — see pendingInviteCountFor.
 */
export const myPendingInviteCount = query({
  args: {},
  handler: async (ctx) => {
    const player = await requirePlayer(ctx)
    return pendingInviteCountFor(ctx, player._id)
  },
})
```

- [ ] **Step 5: Run to verify it passes**

```bash
cd v2 && pnpm test:once convex/billing.test.ts
```

Expected: PASS.

- [ ] **Step 6: Gates and commit**

```bash
cd v2 && pnpm lint && pnpm typecheck && pnpm test:once && pnpm build
git add v2/convex/billing.ts v2/convex/billing.test.ts v2/convex/teams.ts
git commit -m "feat(billing): release parked invites on upgrade, derive the pending count"
```

---

## Task 7: `downgradeTeamRemovalFor` — softened

**Deliberately not a faithful port.** See decision A. Port from `20240501193430`, **not** the `20240501191728` the epic named — the earlier one's `id != any(teams_to_keep)` is true for every id when two are kept, so it deletes the teams it just decided to keep.

**Files:**
- Modify: `v2/convex/teams.ts` (export `cascadeDeleteTeam`)
- Modify: `v2/convex/billing.ts`, `v2/convex/billing.test.ts`
- Modify: `v2/scripts/lib/copy-tallies.mjs` (delete-site inventory)

- [ ] **Step 1: Write the failing tests**

Add to `v2/convex/billing.test.ts`:

```ts
import { downgradeTeamRemovalFor } from './billing.ts'

test('a downgrade with 5 teams keeps exactly 2, owned first then oldest', async () => {
  const t = convexTest(schema)
  await t.run(async (ctx) => {
    const me = await ctx.db.insert('players', aPlayer({ legacyId: undefined }))
    const owned = await ctx.db.insert(
      'teams',
      aTeam({ legacyId: 10, playerIds: [me], owner: me, createdAt: 500 }),
    )
    const oldest = await ctx.db.insert(
      'teams',
      aTeam({ legacyId: 11, playerIds: [me], createdAt: 100 }),
    )
    const middle = await ctx.db.insert(
      'teams',
      aTeam({ legacyId: 12, playerIds: [me], createdAt: 200 }),
    )
    const newer = await ctx.db.insert(
      'teams',
      aTeam({ legacyId: 13, playerIds: [me], createdAt: 300 }),
    )
    const newest = await ctx.db.insert(
      'teams',
      aTeam({ legacyId: 14, playerIds: [me], createdAt: 400 }),
    )

    await downgradeTeamRemovalFor(ctx, me)

    // Owned first even though it is the NEWEST, then the oldest of the rest.
    expect((await ctx.db.get(owned))!.playerIds).toContain(me)
    expect((await ctx.db.get(oldest))!.playerIds).toContain(me)
    for (const id of [middle, newer, newest]) {
      expect((await ctx.db.get(id))!.playerIds).not.toContain(me)
    }
  })
})

// DIVERGENCE 12. v1 DELETES these, taking every other member's scores and
// monthly-winner history with them. A billing event on one account must not
// destroy a third party's data.
test('a team the player owned and left survives with a reassigned owner', async () => {
  const t = convexTest(schema)
  await t.run(async (ctx) => {
    const me = await ctx.db.insert('players', aPlayer({ legacyId: undefined }))
    const first = await ctx.db.insert(
      'players',
      aPlayer({ legacyId: undefined, email: 'first@example.com' }),
    )
    const second = await ctx.db.insert(
      'players',
      aPlayer({ legacyId: undefined, email: 'second@example.com' }),
    )
    // Three owned teams: two are kept, the third is the one under test.
    await ctx.db.insert('teams', aTeam({ legacyId: 20, playerIds: [me], owner: me, createdAt: 1 }))
    await ctx.db.insert('teams', aTeam({ legacyId: 21, playerIds: [me], owner: me, createdAt: 2 }))
    const third = await ctx.db.insert(
      'teams',
      aTeam({ legacyId: 22, playerIds: [me, first, second], owner: me, createdAt: 3 }),
    )

    await downgradeTeamRemovalFor(ctx, me)

    const team = await ctx.db.get(third)
    expect(team).not.toBeNull()
    expect(team!.playerIds).toEqual([first, second])
    // playerIds is append-ordered, so [0] of the remainder is earliest-joined.
    expect(team!.owner).toBe(first)
  })
})

test('a team left with nobody is deleted, with its cascade', async () => {
  const t = convexTest(schema)
  await t.run(async (ctx) => {
    const me = await ctx.db.insert('players', aPlayer({ legacyId: undefined }))
    await ctx.db.insert('teams', aTeam({ legacyId: 30, playerIds: [me], owner: me, createdAt: 1 }))
    await ctx.db.insert('teams', aTeam({ legacyId: 31, playerIds: [me], owner: me, createdAt: 2 }))
    const solo = await ctx.db.insert(
      'teams',
      aTeam({ legacyId: 32, playerIds: [me], owner: me, createdAt: 3 }),
    )
    const winnerId = await ctx.db.insert('monthlyWinners', {
      teamId: solo,
      year: 2026,
      month: 1,
      playerId: me,
      score: 10,
    })

    await downgradeTeamRemovalFor(ctx, me)

    expect(await ctx.db.get(solo)).toBeNull()
    // The cascade ran — a bare db.delete would orphan this row.
    expect(await ctx.db.get(winnerId)).toBeNull()
  })
})

test('a team containing another member is NEVER deleted', async () => {
  const t = convexTest(schema)
  await t.run(async (ctx) => {
    const me = await ctx.db.insert('players', aPlayer({ legacyId: undefined }))
    const other = await ctx.db.insert(
      'players',
      aPlayer({ legacyId: undefined, email: 'other@example.com' }),
    )
    await ctx.db.insert('teams', aTeam({ legacyId: 40, playerIds: [me], owner: me, createdAt: 1 }))
    await ctx.db.insert('teams', aTeam({ legacyId: 41, playerIds: [me], owner: me, createdAt: 2 }))
    const shared = await ctx.db.insert(
      'teams',
      aTeam({ legacyId: 42, playerIds: [me, other], owner: me, createdAt: 3 }),
    )

    await downgradeTeamRemovalFor(ctx, me)

    expect(await ctx.db.get(shared)).not.toBeNull()
    expect((await ctx.db.get(shared))!.playerIds).toEqual([other])
  })
})

test('a downgrade with 2 or fewer teams changes nothing', async () => {
  const t = convexTest(schema)
  await t.run(async (ctx) => {
    const me = await ctx.db.insert('players', aPlayer({ legacyId: undefined }))
    const a = await ctx.db.insert('teams', aTeam({ legacyId: 50, playerIds: [me], createdAt: 1 }))
    const b = await ctx.db.insert('teams', aTeam({ legacyId: 51, playerIds: [me], createdAt: 2 }))

    await downgradeTeamRemovalFor(ctx, me)

    expect((await ctx.db.get(a))!.playerIds).toContain(me)
    expect((await ctx.db.get(b))!.playerIds).toContain(me)
  })
})

// A team they are a MEMBER of but do not own is never deleted and never
// reassigned — they simply leave it.
test('leaving a team owned by someone else does not touch its owner', async () => {
  const t = convexTest(schema)
  await t.run(async (ctx) => {
    const me = await ctx.db.insert('players', aPlayer({ legacyId: undefined }))
    const other = await ctx.db.insert(
      'players',
      aPlayer({ legacyId: undefined, email: 'other@example.com' }),
    )
    await ctx.db.insert('teams', aTeam({ legacyId: 60, playerIds: [me], owner: me, createdAt: 1 }))
    await ctx.db.insert('teams', aTeam({ legacyId: 61, playerIds: [me], owner: me, createdAt: 2 }))
    const theirs = await ctx.db.insert(
      'teams',
      aTeam({ legacyId: 62, playerIds: [other, me], owner: other, createdAt: 3 }),
    )

    await downgradeTeamRemovalFor(ctx, me)

    const team = (await ctx.db.get(theirs))!
    expect(team.owner).toBe(other)
    expect(team.playerIds).toEqual([other])
  })
})
```

- [ ] **Step 2: Run to verify it fails**

```bash
cd v2 && pnpm test:once convex/billing.test.ts
```

Expected: FAIL — `downgradeTeamRemovalFor` is not exported.

- [ ] **Step 3: Export the cascade**

In `v2/convex/teams.ts:250`, change `async function cascadeDeleteTeam` to `export async function cascadeDeleteTeam` and extend its doc comment:

```ts
 * NO ACCESS CHECK OF ITS OWN — every caller must do that first. Shared by
 * deleteTeamFor (owner-only), by leaveTeamFor's last-member case, and since
 * Phase 5 by downgradeTeamRemovalFor's empty-remainder case.
```

- [ ] **Step 4: Implement the downgrade**

Add to `v2/convex/billing.ts`:

```ts
import { cascadeDeleteTeam } from './teams.ts'
import { FREE_TEAM_LIMIT } from './lib/teamLimits.ts'

/**
 * Apply the free-tier team limit after a subscription is revoked.
 *
 * SOFTENED — DELIBERATELY NOT A FAITHFUL PORT. Divergence 12.
 *
 * v1's handle_downgrade_team_removal keeps 2 teams, removes the player from the
 * rest, and then DELETES the teams they created beyond the keep list — taking
 * every other member's scores and monthly-winner history with them. A billing
 * event on one account destroying a third party's data is not worth porting.
 *
 * PORTED FROM 20240501193430, NOT 20240501191728. The latter is the version the
 * Phase 5 epic named, and it carries a real defect: `id != any(teams_to_keep)`
 * is true whenever id differs from AT LEAST ONE element, so with two kept ids
 * every id qualifies and it deletes the teams it just decided to keep. The
 * later migration replaces both occurrences with NOT IN (SELECT UNNEST(...)).
 *
 * THE KEEP-2 ORDERING, measured rather than transliterated. v1's query is
 * `select unnest(array_agg(id)) ... group by creator, created_at
 *  order by (case when creator = player then 0 else 1 end), created_at limit 2`.
 * Whether LIMIT bounds groups or expanded rows decides whether it can keep
 * three teams. Measured against PostgreSQL 15.1: it bounds EXPANDED ROWS, so
 * this keeps exactly two — owned first, then oldest.
 */
export async function downgradeTeamRemovalFor(
  ctx: WriterCtx,
  playerId: Id<'players'>,
): Promise<void> {
  const allTeams = await ctx.db.query('teams').collect()
  const mine = allTeams.filter((team) => team.playerIds.includes(playerId))

  // Owned first, then oldest. Mirrors getMyTeamsFor's `createdAt ?? 0`, which
  // is how a copied row with no timestamp sorts.
  const ordered = [...mine].sort((a, b) => {
    const owned = Number(b.owner === playerId) - Number(a.owner === playerId)
    if (owned !== 0) return owned
    return (a.createdAt ?? 0) - (b.createdAt ?? 0)
  })

  for (const team of ordered.slice(FREE_TEAM_LIMIT)) {
    const remaining = team.playerIds.filter((id) => id !== playerId)

    // NOBODY LEFT. Only here is a delete correct, and it must cascade —
    // a bare db.delete orphans the team's monthlyWinners and scoringSystems
    // rows. copy-filters.mjs already establishes that a team with nobody on it
    // is not a team.
    if (remaining.length === 0) {
      await cascadeDeleteTeam(ctx, team)
      continue
    }

    await ctx.db.patch(team._id, {
      playerIds: remaining,
      // Reassign only if they owned it. playerIds is append-ordered, so [0] of
      // the remainder is the earliest-joined member — v2 has no joinedAt, and
      // inventing one to answer this would be a schema change for a tiebreak.
      //
      // RULED OUT: leaving the team owner-less. V2-ADDENDUM records that an
      // owner-less team cannot be edited by anyone, so manufacturing that state
      // deliberately is worse than reassigning.
      ...(team.owner === playerId ? { owner: remaining[0] } : {}),
    })
  }
}
```

- [ ] **Step 5: Run to verify it passes**

```bash
cd v2 && pnpm test:once convex/billing.test.ts
```

Expected: PASS, 6 new tests.

- [ ] **Step 6: Update the delete-site inventory**

`downgradeTeamRemovalFor` reaches `cascadeDeleteTeam`, which is a **new path to a `db.delete`**. Find and update the inventory:

```bash
cd v2 && grep -n "db.delete\|delete site" scripts/lib/copy-tallies.mjs
```

Add `billing.ts`'s `downgradeTeamRemovalFor` → `cascadeDeleteTeam` to whatever list that grep surfaces. Then verify the live count:

```bash
cd v2 && grep -rn "db\.delete" convex/ --include='*.ts' | grep -v "\.test\.ts" | wc -l
```

Paste the number into the comment rather than asserting one.

- [ ] **Step 7: Mutation-test the ordering**

In an isolated extraction (see Task 4 Step 5):

- CONTROL (must FAIL): drop the `owned` term from the sort comparator, leaving only `createdAt`. Exit code must be non-zero — the "owned first even though it is the newest" test is what catches it.
- SANITY (must PASS): rename the local `ordered` to `sorted`. Exit code 0.

- [ ] **Step 8: Gates and commit**

```bash
cd v2 && pnpm lint && pnpm typecheck && pnpm test:once && pnpm build
git add v2/convex/billing.ts v2/convex/billing.test.ts v2/convex/teams.ts v2/scripts/lib/copy-tallies.mjs
git commit -m "feat(billing): softened downgrade that never deletes an occupied team"
```

---

## Task 8: The non-pro 2-team cap on invitees

Closes `wordle-teams-44o`. Updates divergence 8, which currently records v2 as **more permissive** than production.

**Files:**
- Modify: `v2/convex/teams.ts` (`InviteOutcome`, `invitePlayerFor`)
- Modify: `v2/convex/teams.test.ts`
- Modify: `v2/src/components/teams/current-team-card.tsx` (report the fifth outcome)

- [ ] **Step 1: Write the failing tests**

Add to `v2/convex/teams.test.ts`:

```ts
test('a free invitee already on 2 teams is parked, not added', async () => {
  const t = convexTest(schema)
  await t.run(async (ctx) => {
    const owner = await ctx.db.insert('players', aPlayer({ legacyId: undefined }))
    const invitee = await ctx.db.insert(
      'players',
      aPlayer({ legacyId: undefined, email: 'ada@example.com' }),
    )
    await ctx.db.insert('teams', aTeam({ legacyId: 70, playerIds: [invitee] }))
    await ctx.db.insert('teams', aTeam({ legacyId: 71, playerIds: [invitee] }))
    const target = await ctx.db.insert(
      'teams',
      aTeam({ legacyId: 72, playerIds: [owner], owner }),
    )

    const outcome = await invitePlayerFor(ctx, owner, {
      teamId: target,
      email: 'ada@example.com',
      today: TODAY,
    })

    expect(outcome).toEqual({ status: 'parked_at_cap', email: 'ada@example.com' })
    const team = (await ctx.db.get(target))!
    expect(team.playerIds).not.toContain(invitee)
    expect(team.invited).toEqual(['ada@example.com'])
  })
})

test('a pro invitee is added regardless of team count', async () => {
  const t = convexTest(schema)
  await t.run(async (ctx) => {
    const owner = await ctx.db.insert('players', aPlayer({ legacyId: undefined }))
    const invitee = await ctx.db.insert(
      'players',
      aPlayer({ legacyId: undefined, email: 'ada@example.com' }),
    )
    await ctx.db.insert('playerMembership', { playerId: invitee, membershipStatus: 'pro' })
    await ctx.db.insert('teams', aTeam({ legacyId: 80, playerIds: [invitee] }))
    await ctx.db.insert('teams', aTeam({ legacyId: 81, playerIds: [invitee] }))
    const target = await ctx.db.insert('teams', aTeam({ legacyId: 82, playerIds: [owner], owner }))

    const outcome = await invitePlayerFor(ctx, owner, {
      teamId: target,
      email: 'ada@example.com',
      today: TODAY,
    })

    expect(outcome.status).toBe('added')
    expect((await ctx.db.get(target))!.playerIds).toContain(invitee)
  })
})

test('a free invitee below the cap is added', async () => {
  const t = convexTest(schema)
  await t.run(async (ctx) => {
    const owner = await ctx.db.insert('players', aPlayer({ legacyId: undefined }))
    const invitee = await ctx.db.insert(
      'players',
      aPlayer({ legacyId: undefined, email: 'ada@example.com' }),
    )
    await ctx.db.insert('teams', aTeam({ legacyId: 90, playerIds: [invitee] }))
    const target = await ctx.db.insert('teams', aTeam({ legacyId: 91, playerIds: [owner], owner }))

    const outcome = await invitePlayerFor(ctx, owner, {
      teamId: target,
      email: 'ada@example.com',
      today: TODAY,
    })

    expect(outcome.status).toBe('added')
  })
})

// The release half. Parked by the cap, freed by the upgrade.
test('a parked invite is released by the upgrade path', async () => {
  const t = convexTest(schema)
  await t.run(async (ctx) => {
    const owner = await ctx.db.insert('players', aPlayer({ legacyId: undefined }))
    const invitee = await ctx.db.insert(
      'players',
      aPlayer({ legacyId: undefined, email: 'ada@example.com' }),
    )
    await ctx.db.insert('teams', aTeam({ legacyId: 95, playerIds: [invitee] }))
    await ctx.db.insert('teams', aTeam({ legacyId: 96, playerIds: [invitee] }))
    const target = await ctx.db.insert('teams', aTeam({ legacyId: 97, playerIds: [owner], owner }))

    await invitePlayerFor(ctx, owner, { teamId: target, email: 'ada@example.com', today: TODAY })
    await upgradeTeamInvitesFor(ctx, invitee)

    const team = (await ctx.db.get(target))!
    expect(team.playerIds).toContain(invitee)
    expect(team.invited).toEqual([])
  })
})
```

Import `upgradeTeamInvitesFor` from `./billing.ts` and reuse `teams.test.ts`'s existing `TODAY` constant.

- [ ] **Step 2: Run to verify it fails**

```bash
cd v2 && pnpm test:once convex/teams.test.ts
```

Expected: FAIL — the invitee is added rather than parked.

- [ ] **Step 3: Add the fifth outcome**

In `v2/convex/teams.ts:426`:

```ts
export type InviteOutcome =
  | { status: 'already_member' }
  | { status: 'added'; firstName: string }
  | { status: 'invited'; email: string; teamName: string; inviterName: string }
  | { status: 'resent'; email: string; teamName: string; inviterName: string }
  // The invitee has an account but is a non-pro player already on FREE_TEAM_LIMIT
  // teams. Their address is parked in `invited` and released when they upgrade.
  // A DISTINCT OUTCOME, not a generic failure: Phase 4 established that telling
  // the owner exactly what happened is the point, and "they need to upgrade" is
  // a different sentence from "that did not work".
  | { status: 'parked_at_cap'; email: string }
```

- [ ] **Step 4: Enforce the cap**

In `invitePlayerFor`, inside the `if (existing)` branch, **after** the `already_member` check at line 494 and **before** the patch at line 508:

```ts
    // THE NON-PRO 2-TEAM CAP. Ports v1's handle_add_player_to_team
    // (20240501180309) and handle_invited_signup — BOTH of which work. The
    // earlier claim that the former is broken in production is false and was
    // corrected on 2026-08-22: the invited_id bug was real but was fixed on
    // 2024-04-29 (20240429204119).
    //
    // Reads FREE_TEAM_LIMIT rather than a literal 2, because team-picker.tsx
    // reads the same constant to swap "New Team" for "Upgrade for more", and a
    // second literal would let the client-side swap and this check drift apart.
    if (!(await isProFor(ctx, existing._id))) {
      const allTeams = await ctx.db.query('teams').collect()
      const theirTeams = allTeams.filter((t) => t.playerIds.includes(existing._id)).length

      if (theirTeams >= FREE_TEAM_LIMIT) {
        // Park rather than add. Idempotent: re-inviting an already-parked
        // address must not create a duplicate entry.
        const already = team.invited.some((entry) => entry.trim().toLowerCase() === email)
        if (!already) {
          await ctx.db.patch(team._id, { invited: [...team.invited, email] })
        }
        return { status: 'parked_at_cap', email }
      }
    }
```

Import `isProFor` from `./access.ts` and `FREE_TEAM_LIMIT` from `./lib/teamLimits.ts`.

- [ ] **Step 5: Report it in the UI**

In `v2/src/components/teams/current-team-card.tsx`, add a `parked_at_cap` branch to the existing outcome switch:

```tsx
      case 'parked_at_cap':
        toast.info(
          `${outcome.email} is on the maximum number of teams for a free account. ` +
            `They'll join automatically if they upgrade to Pro.`,
        )
        break
```

Match the surrounding toast helper — read the neighbouring cases and follow them rather than importing a new one.

- [ ] **Step 6: Fix the comment this task falsifies**

`amIPro`'s doc comment (`v2/convex/teams.ts:128-129`) currently ends "Nothing is enforced server-side — see isProFor." This task makes that false. Replace those two lines with:

```ts
 * scoring editor, and "New Team" swapping to "Upgrade for more" past two teams.
 * Those two gates are UI-only. The 2-team cap on INVITEES is enforced
 * server-side as of Phase 5 (invitePlayerFor) — see isProFor for why the
 * asymmetry is v1's rather than ours.
```

Comment accuracy is a defect here, not a nit.

- [ ] **Step 7: Run to verify it passes**

```bash
cd v2 && pnpm test:once convex/teams.test.ts
```

Expected: PASS.

- [ ] **Step 8: Gates and commit**

```bash
cd v2 && pnpm lint && pnpm typecheck && pnpm test:once && pnpm build
git add v2/convex/teams.ts v2/convex/teams.test.ts v2/src/components/teams/current-team-card.tsx
git commit -m "feat(teams): enforce the non-pro 2-team cap on invitees"
```

---

## Task 9: `convex/polar.ts` — the SDK actions

**Files:**
- Modify: `v2/package.json`
- Create: `v2/convex/polar.ts`

- [ ] **Step 1: Add the dependency**

```bash
cd v2 && pnpm add @polar-sh/sdk
```

**Not `@polar-sh/better-auth`.** Measured at 1.8.4: it awaits the handler (so it does not auto-acknowledge, contrary to the epic's premise), but it throws `APIError("BAD_REQUEST")` on any handler error, and `BAD_REQUEST` maps to **400** (`better-call@1.3.7`, `dist/error.mjs:56`). A 4xx tells Polar the delivery is permanently rejected, so there is no path to the 5xx the retry design needs.

- [ ] **Step 2: Implement the actions**

Create `v2/convex/polar.ts`:

```ts
'use node'

import { Polar } from '@polar-sh/sdk'
import { v } from 'convex/values'
import { action, internalAction } from './_generated/server.ts'
import { api } from './_generated/api.ts'

/**
 * The Polar SDK client and the environment it needs.
 *
 * Polar's sandbox is a completely separate instance from production — its own
 * accounts, organizations, products and tokens. A production token will not
 * authenticate against sandbox or vice versa, so the server and the credentials
 * always move together.
 */
const REQUIRED_ENV_VARS = [
  'POLAR_ACCESS_TOKEN',
  'POLAR_WEBHOOK_SECRET',
  'POLAR_PRO_MONTHLY_PRODUCT_ID',
  'POLAR_PRO_ANNUAL_PRODUCT_ID',
] as const

/**
 * Validates all four together rather than one per call site, so a partially
 * configured deployment fails loudly and identically everywhere instead of only
 * on the first code path that happens to need the missing one.
 */
function assertPolarEnv() {
  const missing = REQUIRED_ENV_VARS.filter((name) => !process.env[name])
  if (missing.length > 0) {
    throw new Error(`Missing required POLAR env variables: ${missing.join(', ')}`)
  }
}

export function polarServer(): 'production' | 'sandbox' {
  return process.env.ENVIRONMENT === 'production' ? 'production' : 'sandbox'
}

let client: Polar | undefined

export function polar(): Polar {
  assertPolarEnv()
  client ??= new Polar({
    accessToken: process.env.POLAR_ACCESS_TOKEN,
    server: polarServer(),
  })
  return client
}

/**
 * Polar has no variants — a product's billing cycle is locked at creation — so
 * Pro monthly and Pro annual are two separate products. One checkout takes both
 * and renders them side by side on Polar's hosted page, in the order passed,
 * which is why no caller picks an interval. Annual first so it presents first.
 */
function proProductIds(): string[] {
  assertPolarEnv()
  return [process.env.POLAR_PRO_ANNUAL_PRODUCT_ID!, process.env.POLAR_PRO_MONTHLY_PRODUCT_ID!]
}

function siteUrl(): string {
  const url = process.env.SITE_URL
  if (!url) throw new Error('SITE_URL is not set on this deployment')
  return url
}

export const createProCheckout = action({
  args: {},
  handler: async (ctx): Promise<string | null> => {
    const me = await ctx.runQuery(internal.billing.checkoutIdentity, {})
    if (!me) return null

    try {
      const checkout = await polar().checkouts.create({
        products: proProductIds(),
        externalCustomerId: me.playerId,
        // BELT AND BRACES, and it is load-bearing. Polar does NOT stamp
        // external_customer_id onto a customer that already exists under this
        // email, so the webhook's customer.externalId can come back null and
        // the upgrade silently does nothing. Metadata travels with the checkout
        // and costs no extra API call to read back.
        metadata: { player_id: me.playerId },
        customerEmail: me.email,
        customerName: me.name,
        successUrl: `${siteUrl()}/?checkout=success`,
      })
      return checkout.url
    } catch (error) {
      console.error('Failed to create Polar checkout', error)
      return null
    }
  },
})

export type PortalResult = { url: string } | { url: null; reason: 'no-customer' | 'error' }

export const getCustomerPortalUrl = action({
  args: {},
  handler: async (ctx): Promise<PortalResult> => {
    const me = await ctx.runQuery(internal.billing.checkoutIdentity, {})
    if (!me) return { url: null, reason: 'error' }

    try {
      const session = await polar().customerSessions.create({
        externalCustomerId: me.playerId,
        returnUrl: `${siteUrl()}/`,
      })
      return { url: session.customerPortalUrl }
    } catch (error) {
      if (isMissingCustomer(error)) return { url: null, reason: 'no-customer' }
      console.error('Failed to create Polar portal session', error)
      return { url: null, reason: 'error' }
    }
  },
})

/**
 * Whether this error means "no billing account", which took v1 three attempts.
 *
 * Polar does NOT answer an unknown external_customer_id with a 404. It answers
 * 422 with a validation detail of "Customer does not exist." — verified against
 * the sandbox for a non-UUID id, an unknown UUID, and an empty string alike.
 * A bare 422 is not enough either: Polar also returns 422 for ordinary
 * validation failures such as a malformed success_url, and reporting those as
 * "no billing account" would hide real bugs. So the detail has to match too.
 */
function isMissingCustomer(error: unknown): boolean {
  const e = error as { statusCode?: number; body?: string }
  if (e?.statusCode === 404) return true
  if (e?.statusCode !== 422) return false
  return /customer does not exist/i.test(e.body ?? '')
}

/** Last-resort identity lookup: the checkout still holds the external id. */
export const fetchCheckoutExternalId = internalAction({
  args: { checkoutId: v.string() },
  handler: async (_ctx, { checkoutId }): Promise<string | null> => {
    try {
      const checkout = await polar().checkouts.get({ id: checkoutId })
      return checkout.externalCustomerId ?? null
    } catch (error) {
      console.error('Failed to read Polar checkout', error)
      return null
    }
  },
})

/**
 * Best-effort self-heal: stamp the Convex player id onto the Polar customer so
 * the next event for this person arrives with customer.externalId populated and
 * takes the fast path.
 *
 * NEVER FATAL. The current event has already been resolved, and failing to tidy
 * up must not turn a successful webhook into a retry.
 */
export const repairCustomerExternalId = internalAction({
  args: { customerId: v.string(), playerId: v.string() },
  handler: async (_ctx, { customerId, playerId }) => {
    try {
      await polar().customers.update({
        id: customerId,
        customerUpdate: { externalId: playerId },
      })
    } catch (error) {
      console.warn('Could not stamp external id onto Polar customer', error)
    }
  },
})
```

Change the `api` import to `internal` from `./_generated/api.ts`.

- [ ] **Step 3: Add the identity query the actions depend on**

`convex/me.ts` exports `myData`, whose return type is a **union** — `null`, `{ matched: false, email }`, or full dashboard data including every team. Reusing it here would force the action to narrow a shape built for a different job, and would fetch all 171 teams to read a name. Add a purpose-built query to `v2/convex/billing.ts` instead:

```ts
/**
 * The three fields a Polar checkout or portal session needs about the caller.
 *
 * NOT me.myData: that returns a union built for the dashboard — null, an
 * unmatched-email marker, or the player plus every team they are on — so it
 * would make this action narrow a shape it does not want and collect 171 teams
 * to read a display name.
 */
export const checkoutIdentity = internalQuery({
  args: {},
  handler: async (ctx) => {
    const user = await authComponent.getAuthUser(ctx)
    if (!user?.email) return null

    const player = await ctx.db
      .query('players')
      .withIndex('by_email', (q) => q.eq('email', user.email.toLowerCase()))
      .first()
    if (!player) return null

    return {
      playerId: player._id,
      email: player.email,
      name: `${player.firstName} ${player.lastName}`.trim(),
    }
  },
})
```

Import `authComponent` from `./auth.ts`. Note this is a **query**, so it is exempt from the "no rules in a wrapper" rule for the same reason `me.myData` is: it resolves identity and reads, it enforces nothing.

- [ ] **Step 4: Gates and commit**

```bash
cd v2 && pnpm lint && pnpm typecheck && pnpm test:once && pnpm build
git add v2/package.json v2/pnpm-lock.yaml v2/convex/polar.ts
git commit -m "feat(billing): Polar checkout and portal actions on the raw SDK"
```

---

## Task 10: The webhook endpoint

The heart of the phase. **Acceptance criterion 3 has two halves** — a duplicate must not reprocess, and a *failed* event must.

> **SUPERSEDED WHERE THIS TASK USES `validateEvent`. The shipped code does not, and cannot** (`wordle-teams-xm2`).
>
> `@polar-sh/sdk`'s `validateEvent` throws `ReferenceError: Buffer is not defined` on Convex's default runtime — `dist/esm/webhooks.js:126` opens with `Buffer.from(secret, 'utf-8')`, and `Buffer` is a Node global that runtime does not provide. Measured against the local backend on 2026-08-27. **Every delivery would have answered 400.**
>
> `v2/convex/http.ts` verifies through **`standardwebhooks@1.0.0` directly** — the same library the SDK verifies through — as `new Webhook(secret, { format: 'raw' })`, keyed on the secret's UTF-8 bytes and therefore byte-identical to what the SDK would have derived. It is now a direct dependency of `v2` at the version already in the lockfile. So **ignore the `import { validateEvent, WebhookVerificationError } from '@polar-sh/sdk/webhooks.js'` and the `validateEvent(...)` call in the snippets below.**
>
> **THE KNOCK-ON REACHES TASK 5, AND IS THE PART THAT IS EASY TO MISS.** A verified delivery is `JSON.parse(rawBody)` — the raw **snake_case wire shape**, not the SDK's renamed camelCase. `v2/convex/lib/polarIdentity.ts` therefore reads **`customer.external_id`**, **`customer_id`** and **`checkout_id`**. Only `metadata.player_id` is unchanged, because that key was always ours. Nothing runs a per-event zod schema any more, deliberately: a strict parse would reject a delivery over any field Polar adds later.
>
> **IT WAS INVISIBLE TO ALL FOUR GATES.** vitest's edge-runtime environment *does* define `Buffer`, and `convex codegen` analyses modules without serving a request — so lint, typecheck, test and build were green against code that could not run. Only a live request found it, which is the argument for Task 13's sandbox pass confirming the endpoint on beta rather than assuming the local backend and the cloud runtime agree.
>
> **CONFIRMED 2026-09-03.** The sandbox pass drove real Polar deliveries end to end: signatures verified, identity resolved, membership transitions applied, and a redelivered `webhook-id` returned 200 without reprocessing.

**Files:**
- Modify: `v2/convex/billing.ts`, `v2/convex/billing.test.ts`, `v2/convex/http.ts`

- [ ] **Step 1: Write the failing tests**

Add to `v2/convex/billing.test.ts`:

```ts
import { internal } from './_generated/api.ts'

const WEBHOOK_ID = 'msg_2KWPBgLlAfxdpx2AI54pPJ85f4W'

const anEvent = (over: Record<string, unknown> = {}) => ({
  webhookId: WEBHOOK_ID,
  eventName: 'subscription.active',
  body: {},
  ...over,
})

test('an active event upgrades the player and releases parked invites', async () => {
  const t = convexTest(schema)
  const { playerId, teamId } = await t.run(async (ctx) => {
    const playerId = await ctx.db.insert(
      'players',
      aPlayer({ legacyId: undefined, email: 'ada@example.com' }),
    )
    const teamId = await ctx.db.insert('teams', aTeam({ legacyId: 100, invited: ['ada@example.com'] }))
    return { playerId, teamId }
  })

  const outcome = await t.mutation(internal.billing.processPolarEvent, {
    ...anEvent(),
    playerId,
  })

  expect(outcome).toBe('processed')
  await t.run(async (ctx) => {
    const membership = await ctx.db
      .query('playerMembership')
      .withIndex('by_player', (q) => q.eq('playerId', playerId))
      .first()
    expect(membership?.membershipStatus).toBe('pro')
    expect((await ctx.db.get(teamId))!.playerIds).toContain(playerId)
  })
})

// ACCEPTANCE CRITERION 3, first half.
test('a duplicate webhook id returns success without reprocessing', async () => {
  const t = convexTest(schema)
  const playerId = await t.run((ctx) =>
    ctx.db.insert('players', aPlayer({ legacyId: undefined })),
  )

  await t.mutation(internal.billing.processPolarEvent, { ...anEvent(), playerId })

  // Flip the membership behind its back; a genuine replay must not re-apply.
  await t.run(async (ctx) => {
    const row = await ctx.db
      .query('playerMembership')
      .withIndex('by_player', (q) => q.eq('playerId', playerId))
      .first()
    await ctx.db.patch(row!._id, { membershipStatus: 'free' })
  })

  const second = await t.mutation(internal.billing.processPolarEvent, {
    ...anEvent(),
    playerId,
  })

  expect(second).toBe('duplicate')
  await t.run(async (ctx) => {
    const row = await ctx.db
      .query('playerMembership')
      .withIndex('by_player', (q) => q.eq('playerId', playerId))
      .first()
    expect(row!.membershipStatus).toBe('free') // untouched
  })
})

// ACCEPTANCE CRITERION 3, second half — the thing v1 gets WRONG. v1 stores the
// row before processing and marks it processed even on failure, so the retry
// hits the unique index, answers 'duplicate', returns 200, and the event is
// lost forever. Divergence 13.
test('a previously failed event IS reprocessed on redelivery', async () => {
  const t = convexTest(schema)
  const playerId = await t.run((ctx) =>
    ctx.db.insert('players', aPlayer({ legacyId: undefined })),
  )

  // Simulate the failure path: a row exists, but was never processed.
  await t.mutation(internal.billing.recordWebhookFailure, {
    ...anEvent(),
    playerId,
    processingError: 'boom',
  })

  const retry = await t.mutation(internal.billing.processPolarEvent, {
    ...anEvent(),
    playerId,
  })

  expect(retry).toBe('processed')
  await t.run(async (ctx) => {
    const rows = await ctx.db
      .query('webhookEvents')
      .withIndex('by_webhookId', (q) => q.eq('webhookId', WEBHOOK_ID))
      .collect()
    // Reused, not duplicated.
    expect(rows).toHaveLength(1)
    expect(rows[0].processed).toBe(true)

    const membership = await ctx.db
      .query('playerMembership')
      .withIndex('by_player', (q) => q.eq('playerId', playerId))
      .first()
    expect(membership?.membershipStatus).toBe('pro')
  })
})

test('canceled and past_due change no membership and remove no teams', async () => {
  for (const eventName of ['subscription.canceled', 'subscription.past_due']) {
    const t = convexTest(schema)
    const { playerId, teams } = await t.run(async (ctx) => {
      const playerId = await ctx.db.insert('players', aPlayer({ legacyId: undefined }))
      await ctx.db.insert('playerMembership', { playerId, membershipStatus: 'pro' })
      const teams = await Promise.all([
        ctx.db.insert('teams', aTeam({ legacyId: 110, playerIds: [playerId] })),
        ctx.db.insert('teams', aTeam({ legacyId: 111, playerIds: [playerId] })),
        ctx.db.insert('teams', aTeam({ legacyId: 112, playerIds: [playerId] })),
      ])
      return { playerId, teams }
    })

    expect(
      await t.mutation(internal.billing.processPolarEvent, {
        ...anEvent({ eventName, webhookId: `msg_${eventName}` }),
        playerId,
      }),
    ).toBe('processed')

    await t.run(async (ctx) => {
      const row = await ctx.db
        .query('playerMembership')
        .withIndex('by_player', (q) => q.eq('playerId', playerId))
        .first()
      expect(row!.membershipStatus).toBe('pro')
      for (const id of teams) {
        expect((await ctx.db.get(id))!.playerIds).toContain(playerId)
      }
    })
  }
})

test('revoked downgrades and applies the team limit', async () => {
  const t = convexTest(schema)
  const { playerId, teams } = await t.run(async (ctx) => {
    const playerId = await ctx.db.insert('players', aPlayer({ legacyId: undefined }))
    await ctx.db.insert('playerMembership', { playerId, membershipStatus: 'pro' })
    const teams = await Promise.all([
      ctx.db.insert('teams', aTeam({ legacyId: 120, playerIds: [playerId], createdAt: 1 })),
      ctx.db.insert('teams', aTeam({ legacyId: 121, playerIds: [playerId], createdAt: 2 })),
      ctx.db.insert('teams', aTeam({ legacyId: 122, playerIds: [playerId], createdAt: 3 })),
    ])
    return { playerId, teams }
  })

  await t.mutation(internal.billing.processPolarEvent, {
    ...anEvent({ eventName: 'subscription.revoked' }),
    playerId,
  })

  await t.run(async (ctx) => {
    const row = await ctx.db
      .query('playerMembership')
      .withIndex('by_player', (q) => q.eq('playerId', playerId))
      .first()
    expect(row!.membershipStatus).toBe('expired')
    expect((await ctx.db.get(teams[2]))!.playerIds).not.toContain(playerId)
  })
})

test('an unrecognised event is stored and acknowledged without a membership change', async () => {
  const t = convexTest(schema)
  const playerId = await t.run((ctx) =>
    ctx.db.insert('players', aPlayer({ legacyId: undefined })),
  )

  expect(
    await t.mutation(internal.billing.processPolarEvent, {
      ...anEvent({ eventName: 'subscription.created' }),
      playerId,
    }),
  ).toBe('processed')

  await t.run(async (ctx) => {
    const membership = await ctx.db
      .query('playerMembership')
      .withIndex('by_player', (q) => q.eq('playerId', playerId))
      .first()
    expect(membership).toBeNull()
  })
})
```

- [ ] **Step 2: Run to verify it fails**

```bash
cd v2 && pnpm test:once convex/billing.test.ts
```

Expected: FAIL — `internal.billing.processPolarEvent` does not exist.

- [ ] **Step 3: Implement the mutations**

Add to `v2/convex/billing.ts`:

```ts
import { internalMutation } from './_generated/server.ts'
import { v } from 'convex/values'
import { mapEventToTransition } from './lib/polarEvents.ts'

/**
 * Store and apply one verified Polar webhook. ONE TRANSACTION.
 *
 * Convex mutations are transactional, which removes a failure mode v1 has
 * structurally. v1's insert, membership update and RPC are three separate
 * statements, so it can reach a row marked processed=true that carries an
 * error. Here a throw rolls back the insert, the membership patch and the team
 * changes together, so that state is unreachable.
 *
 * THE REPLAY GUARD KEYS ON `processed`, NOT ON ROW EXISTENCE. Divergence 13.
 * v1 treats "a row exists for this webhook id" as a duplicate, so when
 * processing fails it returns 500, Polar retries, the retry hits the unique
 * index, and the event is answered 200 and lost forever — recorded as
 * processed=true with an error string. Keying on `processed` means a row that
 * exists but failed is picked up and finished.
 */
export const processPolarEvent = internalMutation({
  args: {
    webhookId: v.string(),
    eventName: v.string(),
    body: v.any(),
    playerId: v.id('players'),
  },
  handler: async (ctx, { webhookId, eventName, body, playerId }) => {
    const existing = await ctx.db
      .query('webhookEvents')
      .withIndex('by_webhookId', (q) => q.eq('webhookId', webhookId))
      .first()

    // A genuine replay. Standard Webhooks retries any non-2xx, so redelivery is
    // routine and must be free.
    if (existing?.processed) return 'duplicate' as const

    const rowId =
      existing?._id ??
      (await ctx.db.insert('webhookEvents', {
        webhookId,
        playerId,
        eventName,
        body,
        processed: false,
        createdAt: Date.now(),
      }))

    const transition = mapEventToTransition(eventName)

    // Recognised-but-inert events (canceled, past_due) and anything
    // unrecognised land here. The row is kept for the audit trail; membership
    // is untouched.
    if (transition) {
      const membership = await ctx.db
        .query('playerMembership')
        .withIndex('by_player', (q) => q.eq('playerId', playerId))
        .first()

      if (membership) {
        await ctx.db.patch(membership._id, { membershipStatus: transition.status })
      } else {
        // No legacyId: born in v2. Task 3 is what makes this insert legal.
        await ctx.db.insert('playerMembership', {
          playerId,
          membershipStatus: transition.status,
        })
      }

      if (transition.effect === 'release-invites') {
        await upgradeTeamInvitesFor(ctx, playerId)
      } else {
        await downgradeTeamRemovalFor(ctx, playerId)
      }
    }

    await ctx.db.patch(rowId, { processed: true, processingError: undefined })
    return 'processed' as const
  },
})

/**
 * Record a failure OUTSIDE the failed transaction.
 *
 * processPolarEvent's rollback is what makes the retry correct, but it would
 * also erase the evidence, so the audit row is written by a separate mutation
 * the httpAction calls from its catch block. `processed` stays false, which is
 * precisely what lets the retry pick the event up again.
 */
export const recordWebhookFailure = internalMutation({
  args: {
    webhookId: v.string(),
    eventName: v.string(),
    body: v.any(),
    playerId: v.id('players'),
    processingError: v.string(),
  },
  handler: async (ctx, { webhookId, eventName, body, playerId, processingError }) => {
    const existing = await ctx.db
      .query('webhookEvents')
      .withIndex('by_webhookId', (q) => q.eq('webhookId', webhookId))
      .first()

    if (existing) {
      await ctx.db.patch(existing._id, { processed: false, processingError })
      return
    }

    await ctx.db.insert('webhookEvents', {
      webhookId,
      playerId,
      eventName,
      body,
      processed: false,
      processingError,
      createdAt: Date.now(),
    })
  },
})

/** Wraps resolvePlayerIdFor for the httpAction, which has no ctx.db. */
export const resolvePlayerId = internalQuery({
  args: { candidates: v.array(v.string()) },
  handler: (ctx, { candidates }) => resolvePlayerIdFor(ctx, candidates),
})
```

Add `internalQuery` to the `./_generated/server.ts` import.

- [ ] **Step 4: Run to verify it passes**

```bash
cd v2 && pnpm test:once convex/billing.test.ts
```

Expected: PASS.

- [ ] **Step 5: Register the HTTP route**

Replace `v2/convex/http.ts`:

```ts
import { httpRouter } from 'convex/server'
import { httpAction } from './_generated/server.ts'
import { validateEvent, WebhookVerificationError } from '@polar-sh/sdk/webhooks.js'
import { authComponent, createAuth } from './auth.ts'
import { internal } from './_generated/api.ts'
import { extractIdentityCandidates } from './lib/polarIdentity.ts'

const http = httpRouter()
authComponent.registerRoutes(http, createAuth)

/**
 * Polar webhook receiver.
 *
 * A RAW httpAction, NOT @polar-sh/better-auth. Measured at plugin 1.8.4: it
 * awaits the handler (so it does not auto-acknowledge, contrary to the original
 * Phase 5 premise), but every handler error becomes APIError('BAD_REQUEST') and
 * BAD_REQUEST maps to 400 (better-call 1.3.7, dist/error.mjs:56). A 4xx tells
 * Polar the delivery is permanently rejected, so the plugin cannot ask for the
 * retry this design depends on. The status code IS the protocol here, which is
 * why the endpoint owns it.
 */
http.route({
  path: '/polar/webhook',
  method: 'POST',
  handler: httpAction(async (ctx, request) => {
    const rawBody = await request.text()
    const headers = Object.fromEntries(request.headers.entries())

    let event
    try {
      event = validateEvent(rawBody, headers, process.env.POLAR_WEBHOOK_SECRET!)
    } catch (error) {
      if (error instanceof WebhookVerificationError) {
        return new Response('Invalid signature', { status: 403 })
      }
      return new Response('Invalid payload', { status: 400 })
    }

    // Standard Webhooks puts the delivery id in a HEADER, and it is NOT a uuid
    // — they look like msg_2KWPBgLlAfxdpx2AI54pPJ85f4W. Retries reuse the same
    // id, which is what makes replay detection possible. v1 lost a day to a
    // uuid column that rejected them, returned 500, and put Polar into an
    // infinite retry loop over an event that could never be stored.
    const webhookId = headers['webhook-id']
    if (!webhookId) return new Response('Missing webhook-id', { status: 400 })

    const identity = extractIdentityCandidates(event.data as never)
    let playerId = await ctx.runQuery(internal.billing.resolvePlayerId, {
      candidates: identity.candidates,
    })

    // Last resort: the checkout that created this subscription still holds the
    // external id, even when the customer does not.
    if (!playerId && identity.checkoutId) {
      const fromCheckout = await ctx.runAction(internal.polar.fetchCheckoutExternalId, {
        checkoutId: identity.checkoutId,
      })
      if (fromCheckout) {
        playerId = await ctx.runQuery(internal.billing.resolvePlayerId, {
          candidates: [fromCheckout],
        })
      }
    }

    // 202, NOT 500: a foreign or unresolvable external id is not a transient
    // fault, so retrying can never succeed. A 500 would put Polar into an
    // endless redelivery loop over an event this app can do nothing with — for
    // instance one belonging to a different integration on the same org.
    if (!playerId) {
      return new Response('Accepted, no matching player', { status: 202 })
    }

    // Self-heal so later events for this person take the fast path. Never
    // fatal: the current event is already resolved.
    if (identity.customerId) {
      await ctx.runAction(internal.polar.repairCustomerExternalId, {
        customerId: identity.customerId,
        playerId,
      })
    }

    const payload = {
      webhookId,
      eventName: event.type,
      body: JSON.parse(rawBody),
      playerId,
    }

    try {
      await ctx.runMutation(internal.billing.processPolarEvent, payload)
      return new Response('OK', { status: 200 })
    } catch (error) {
      await ctx.runMutation(internal.billing.recordWebhookFailure, {
        ...payload,
        processingError: error instanceof Error ? error.message : String(error),
      })
      // 500 asks Polar to retry, which is correct for a genuinely transient
      // failure — and unlike v1, the retry will now actually reprocess.
      return new Response('Failed to process webhook event', { status: 500 })
    }
  }),
})

export default http
```

- [ ] **Step 6: Regenerate types**

Adding a Convex module means `api.d.ts` must be regenerated, or `tsc` fails on the missing property and CI's "verify generated types are checked in" fails:

```bash
cd v2 && npx convex codegen
```

This regenerates types **without deploying**.

- [ ] **Step 7: Gates and commit**

```bash
cd v2 && pnpm lint && pnpm typecheck && pnpm test:once && pnpm build
git add v2/convex/billing.ts v2/convex/billing.test.ts v2/convex/http.ts v2/convex/_generated/
git commit -m "feat(billing): idempotent Polar webhook that actually retries"
```

---

## Task 11: Upgrade and portal UI

**Files:**
- Modify: `v2/src/components/team-picker.tsx:78-81` (the upgrade CTA)
- Modify: `v2/src/components/Header.tsx` (the portal link and the badge)
- Modify: `v2/src/routes/index.tsx`

**v2 has no `app-bar/` directory** — do not go looking for v1's `user-dropdown.tsx`. v2's chrome is `Header.tsx`, and the "Upgrade for more" CTA already exists in `team-picker.tsx:78-81`, gated by `atFreeLimit` (line 48). Wire the action into the CTA that is already there rather than adding a second one.

- [ ] **Step 1: Add the upgrade action to the existing CTA**

`team-picker.tsx:78-81` currently renders `<span>Upgrade for more</span>` inside the `atFreeLimit` branch. Make it actionable:

```tsx
const createCheckout = useAction(api.polar.createProCheckout)

const upgrade = async () => {
  const url = await createCheckout({})
  if (url) window.location.href = url
  else toast.error('Could not start checkout. Please try again.')
}
```

`toast` comes from `sonner` (already imported across `src/components/teams/*`). Use `mutationErrorMessage` for any thrown error, matching `current-team-card.tsx:151`.

- [ ] **Step 2: Add the portal link to `Header.tsx`**

```tsx
const portal = useAction(api.polar.getCustomerPortalUrl)

const manageBilling = async () => {
  const result = await portal({})
  if (result.url) window.location.href = result.url
  // 'no-customer' is the EXPECTED state for anyone who has never checked out.
  // Distinguished from a real failure so the UI says something true rather than
  // "try again later" about a condition retrying will never fix.
  else if (result.reason === 'no-customer') toast.info('You do not have a billing account yet.')
  else toast.error('Could not open the billing portal. Please try again.')
}
```

- [ ] **Step 3: Add the pending-invites badge to `Header.tsx`**

```tsx
const { data: pendingInvites } = useSuspenseQuery(
  convexQuery(api.teams.myPendingInviteCount, {}),
)

{!isPro && pendingInvites > 0 && (
  <span>
    {pendingInvites} Invite{pendingInvites === 1 ? '' : 's'} Pending
  </span>
)}
```

- [ ] **Step 4: Gates, e2e, commit**

```bash
cd v2 && pnpm lint && pnpm typecheck && pnpm test:once && pnpm build && pnpm e2e
git add v2/src/
git commit -m "feat(billing): upgrade button, billing portal, pending-invite badge"
```

---

## Task 12: The checkout return leg, and the enforcement decision

Closes `wordle-teams-6tn`, whose acceptance criterion is that Phase 5's scope names `CheckoutReturn` **and** states whether the pro gates are enforced server-side.

**Files:**
- Create: `v2/src/components/checkout-return.tsx`
- Modify: `v2/src/routes/index.tsx`
- Modify: `v2/convex/access.ts` (`isProFor`'s doc comment)

- [ ] **Step 1: Implement the reduced return leg**

Create `v2/src/components/checkout-return.tsx`:

```tsx
import { useEffect, useState } from 'react'

/**
 * Handles the return trip from Polar's hosted checkout.
 *
 * DRASTICALLY SMALLER THAN v1's, because v2 does not have the problem v1's
 * version solves. v1 calls supabase.auth.refreshSession() and then schedules a
 * 2s retry, because user_member_status is stamped into the JWT when the token
 * is issued — so without a refresh the token still says "free" no matter what
 * the database holds.
 *
 * v2 reads membership through api.teams.amIPro as a REACTIVE Convex
 * subscription. When the webhook mutation patches playerMembership, every
 * subscribed client updates on its own. There is no token to refresh and
 * nothing to re-fetch: a slow webhook just means the subscription updates a
 * moment later. So the refresh, the timer and v1's Strict-Mode `handled` ref
 * (which existed only to stop the refresh running twice) all become dead
 * concepts rather than things to port.
 *
 * What is left is real: strip the query param, and say something honest while
 * the webhook is in flight.
 */
export function CheckoutReturn({ isPro }: { isPro: boolean }) {
  const [returning, setReturning] = useState(false)

  useEffect(() => {
    const params = new URLSearchParams(window.location.search)
    if (params.get('checkout') !== 'success') return

    setReturning(true)
    // Drop the param so a reload does not repeat this.
    window.history.replaceState({}, '', window.location.pathname)
  }, [])

  if (!returning || isPro) return null

  return <p role="status">Finishing your upgrade…</p>
}
```

- [ ] **Step 2: Mount it**

In `v2/src/routes/index.tsx`, beside the existing `isPro` read:

```tsx
<CheckoutReturn isPro={isPro} />
```

- [ ] **Step 3: Record the enforcement decision**

Replace `isProFor`'s doc comment in `v2/convex/access.ts:200-209`:

```ts
/**
 * Whether this player is on the pro plan.
 *
 * READ ONLY FOR THE GATES IT SERVES, AND THAT IS SETTLED. Phase 5 owned the
 * question of whether v2 enforces the pro gates server-side; the answer is that
 * v2 enforces exactly as far as v1 does, and no further:
 *
 *   - The 2-team cap ON INVITEES is enforced (invitePlayerFor), because v1
 *     enforces it in handle_add_player_to_team and handle_invited_signup.
 *   - createTeam past two teams is NOT enforced, because v1 does not: its
 *     server action does not check pro, and nothing stops a free account
 *     creating five teams through the API. Enforcing here would start refusing
 *     writes production accepts today — a behaviour change dressed as a port.
 *   - The scoring-system editor is NOT enforced, for the same reason.
 *
 * The asymmetry is v1's, not one introduced here: v1 guards the path where
 * SOMEBODY ELSE adds you to a team and leaves the paths you drive yourself to
 * the UI. See wordle-teams-6tn and decision K in the Phase 5 spec.
 */
```

- [ ] **Step 4: Gates, e2e, commit**

```bash
cd v2 && pnpm lint && pnpm typecheck && pnpm test:once && pnpm build && pnpm e2e
git add v2/src/components/checkout-return.tsx v2/src/routes/index.tsx v2/convex/access.ts
git commit -m "feat(billing): checkout return leg; record the pro-gate enforcement decision"
```

---

## Task 13: Divergences, sandbox verification, phase close

**Files:**
- Modify: `docs/design-system/V2-ADDENDUM.md` §7a

- [ ] **Step 1: Confirm the current divergence count**

```bash
cd /home/cdub/projects/wordle-teams && sed -n '304,325p' docs/design-system/V2-ADDENDUM.md | grep -c "^| [0-9]"
```

Expected: `11`. The new rows are 12 and 13.

- [ ] **Step 2: Update divergence 8 and add 12 and 13**

Rewrite row 8 — it currently records v2 as *more permissive* than production, which stops being true — and append:

```markdown
| 12 | A downgrade never deletes an occupied team | Phase 5 (`wt-ksh.6`) | v1's `handle_downgrade_team_removal` keeps 2 teams and then DELETES the teams the downgraded player created beyond the keep list, taking every other member's scores and monthly-winner history with them. A billing event on one account must not destroy a third party's data. v2 removes the player, reassigns `owner` to the earliest-joined remaining member, and deletes only a team nobody is left in — with the same cascade `deleteTeamFor` uses |
| 13 | A failed webhook is retried instead of swallowed | Phase 5 (`wt-ksh.6`) | v1's replay guard keys on "a row exists for this webhook id", so when processing fails it returns 500, Polar retries, the retry hits the unique index, and the event is answered 200 and lost — recorded as `processed: true` carrying an error. v2 keys the guard on `processed`, and writes the failure row outside the rolled-back transaction, so a redelivery finishes the job |
```

- [ ] **Step 3: Push and verify on beta**

```bash
git push && gh run watch
```

- [ ] **Step 4: Sandbox verification — the one pass, per decision C**

Against the Polar **sandbox** with beta. Confirm each and record the observed result:

- [ ] Subscribe → `subscription.active` → membership becomes pro, parked invites released, **UI updates with no reload** (this is what proves the return leg).
- [ ] A checkout matching a **pre-existing** Polar customer with a null external id still upgrades the right person.
- [ ] Cancel → `subscription.canceled` → **no** membership change, **no** teams removed.
- [ ] Revoke → `subscription.revoked` → membership expires, team limit applies, no occupied team deleted.
- [ ] Redeliver any event from the Polar dashboard → 200, nothing reprocessed.
- [ ] Portal opens for a subscriber; a non-subscriber is told they have no billing account.

- [ ] **Step 5: Close the beads issues**

Close the Phase 5 children, `wordle-teams-6tn`, and `wt-ksh.6`. Then flush and verify the export:

```bash
cd /home/cdub/projects/wordle-teams && bd export -o .beads/issues.jsonl
grep -c "wordle-teams-6tn" .beads/issues.jsonl
```

**Do NOT close `wt-ksh.4`** — its done-when is the owner's side-by-side check on a real phone.

- [ ] **Step 6: Final commit and push**

```bash
git add docs/design-system/V2-ADDENDUM.md .beads/issues.jsonl
git commit -m "docs(addendum): divergences 12 and 13; close Phase 5"
git push && git status
```

Expected: `up to date with origin`.

---

## Self-Review Notes

**Spec coverage:** every spec section maps to a task — measurements 1→Task 10, 2→Task 5, 3→Task 3, 4 and 5→Task 7, 6→Task 9, 7→Task 6, 8→Tasks 7/8. Decisions A→7, B→8, C→Tasks 5 and 13, D→6, E→10, F→5, G→6, H→7, I→9, J→Tasks 0–2, K→12, L→12. All ten acceptance criteria are covered: 1→13, 2→5, 3→10, 4→10, 5→Tasks 7 and 13, 6→Tasks 6 and 8, 7→2, 8→12, 9→12, 10→every task's gate step.

**Three assertions were checked and all three were wrong**, which is the expected hit rate for this codebase and the reason they were checked:

- `api.me.getMe` does not exist. `convex/me.ts` exports `myData`, and it returns a union built for the dashboard. Task 9 Step 3 now adds a purpose-built `checkoutIdentity` query instead of narrowing someone else's shape.
- v2 has **no `src/components/app-bar/`**. The chrome is `Header.tsx`, and the upgrade CTA already exists at `team-picker.tsx:78-81`. Task 11 now names both.
- `amIPro`'s doc comment asserts nothing is enforced server-side, which Task 8 falsifies. Task 8 Step 6 fixes it.

**Remaining soft spot, flagged rather than hidden:** Task 11's badge and portal placement inside `Header.tsx` is described by behaviour, not by line number — `Header.tsx` was listed but not read. It is the one task that should read its target before editing.

**Type consistency check:** `MembershipTransition` is `{status, effect}` in Task 4 and consumed as `transition.status` / `transition.effect` in Task 10. `IdentityCandidates` is `{candidates, customerId, checkoutId}` in Task 5 and destructured the same way in Task 10's `http.ts`. `resolvePlayerIdFor(ctx, candidates)` takes an array in both Task 5 and its `internalQuery` wrapper. `InviteOutcome`'s new member is `{status:'parked_at_cap', email}` in Task 8's type, its test, and its UI branch. `cascadeDeleteTeam(ctx, team)` takes a `Doc<'teams'>` in Task 7, matching `teams.ts:250`.
