# v2 Phase 4 — Invites & Onboarding: Design

**Date:** 2026-08-21
**Status:** Approved design, not yet built
**Tracks:** `wt-ksh.5` (Phase 4 of epic `wt-ksh`)
**Governed by:** `2026-07-16-replatform-v2-design.md` and its amendments, especially
**A2** (the invite bug that survives the rewrite), **A3** (parity target is `dev` as of
2026-08-03) and **A7** (login/onboarding is a sanctioned exception to strict parity).
**Builds on:** `2026-08-19-v2-phase3-teams-design.md`.
**Read before touching UI:** `docs/design-system/V2-ADDENDUM.md` — §5 and §6 for the
rendering-bug failure modes, §7a for the divergence list this phase extends from five to eleven.

## Summary

Getting people onto a team, and getting a person to exist at all. The phase settles one thing
the design did not anticipate: **v2 has no way to create a player.** `players.legacyId` is a
required Supabase auth uuid, so the only writers are the copy and the e2e seed. That blocks the
invite flow itself, not merely cold signup.

The answer taken here is narrower than v1's and stronger: **a `players` row is born only when
someone submits their name**, and that same mutation claims every invite waiting on their
address and recomputes the months it just changed.

## Context — four measurements taken before any decision

Run against production on 2026-08-20, counts only (this repository is public).

| Measurement | Result |
|---|---|
| Players with no `first_name`/`last_name` | **151 of 533** (28%). None partially named — it is always both or neither. **Re-measured 2026-08-24** (`wt-ksh.13.8`): still **151**, now of **535** — two signups since. The figure the copy filter rests on has not moved |
| Boards ever entered by a nameless player | **0.** Also 0 monthly-winner rows |
| Teams created by a nameless player | **29** — and all 29 have **zero** members who have ever entered a board |
| Live teams holding a nameless member | **3** |
| Pending invites (`teams.invited`) | **44** across 33 teams, **all already lowercase** — the July 2026 normalisation migration did its job |

**Where those rows actually are matters.** The deployment beta runs on holds only
**18 players / 7 teams / 6950 daily scores / 2 pending invites (both lowercase)** — it is the
`--scope=mine` copy plus `e2eSeed` rows, not the full table. `e2eSeed` always writes both names
and a synthetic `e2e-<email>` legacyId, so the beta cleanup is expected to be a **no-op or close
to it**. The 151 figure governs the **full** copy, which runs at the Phase 7 parity audit and
again inside the cutover window. That makes the *copy-script filter* the load-bearing fix and
the one-off cleanup a formality — verified by dry run, not assumed in either direction.

The first three lines are what make the owner's escalation cheap. No board and no winner row
points at a nameless player, so they can be left out of the copy without orphaning anything a
user could see.

**One clause of that has been corrected.** This design originally also claimed "no membership
row points at one", and that nameless players were referenced by nothing except
`teams.player_ids` and `teams.creator`. `wt-ksh.13.8` ran the count against production on
2026-08-24 and it is false. `player_customer` — the Supabase table Convex calls
`playerMembership` — holds **151** rows whose player is nameless, the same count as the
nameless players themselves, out of a total of **535** against `players`' **535**, with **0**
orphaned rows. In aggregate, on that date, the two tables match one for one, which is why the
membership shortfall at a full copy came out equal to the player shortfall, 151.

**Read that as a measurement, not a rule.** Nothing enforces it:
`20240319201543_move_columns_to_playercustomer.sql` gives `player_customer` a foreign key on
`player_id` and a unique index on `id`, and no uniqueness on `player_id` at all. The match is
`handle_new_user` inserting one row per signup, so it can drift exactly as the 533 above did.

**Nothing about the decision moves**, and the copy still needs no membership filter of its own —
`upsertMemberships` counts each unresolvable row into its own `skipped` tally, deliberately.
What the false clause cost is the *verifier*, which has to **predict** the row count rather than
report it, so `wt-ksh.13.7` narrows memberships in `scripts/lib/verify-filters.mjs`. That
file's header is the full account, including what a shortfall that is *not* 151 would mean.
A reader trusting the original sentence would conclude the narrowing is unnecessary.

Two structural findings shaped the rest:

**v1 shows pending invites nowhere.** `current-team-client.tsx` renders `team.players` only.
A creator cannot see who they invited, cannot tell a typo from a slow responder, and cannot
cancel. This is the whole of what `wt-ksh.5.3` is left complaining about once nameless players
cease to exist.

**v1 caps an over-limit free player in TWO places, and both work.** `handle_invited_signup`
covers the no-account path; `handle_add_player_to_team` covers the existing-player path. An
earlier draft of this design claimed the second was broken in production because its
non-pro-over-two-teams branch references `invited_id`, which is not a parameter of that function.
That was true only of `20240429200154_fix_handle_add_player_to_team.sql`, superseded 25 minutes
later by `20240429204119_handle_add_player_add_to_invited.sql`, which changed `WHERE id =
invited_id` to `WHERE id = player_id_input`. The current definition,
`20240501180309_add_player_to_invited_if_not_signedup.sql`, never mentions `invited_id`, and no
later migration redefines the function. Its cap branch parks the address in `invited` and
increments `invites_pending_upgrade` — a correct cap. **Deferring the cap to Phase 5 is unchanged;
only this justification for it was wrong.** Recorded as divergence 8.

## Decisions Made (and alternatives ruled out)

| Decision | Chosen | Ruled out / why |
|---|---|---|
| When a `players` row is born | **On profile completion.** One `completeProfile` mutation creates the row, claims invites and recomputes | Porting `handle_new_user` via Better Auth's `triggers.user.onCreate` — faithful, but reproduces v1's nameless-player state natively, needs `authFunctions` wiring, and splits the recompute across two mutations. An `ensurePlayer` on first dashboard load — a write on a read path, racing the dashboard's own queries, and still leaves a nameless row |
| `firstName` / `lastName` | **Required `v.string()`** | Leaving them optional — keeps `hasCompleteProfile` and its three-sites-must-agree hazard alive forever, for a state that after this phase only copied data can produce |
| The 151 nameless players | **Not copied.** The copy skips them, and skips teams left with zero members | Copying with placeholder names — invents data, and a placeholder is indistinguishable from a real name to every downstream reader. Keeping them — forces `firstName` to stay optional, which is the thing being fixed |
| Non-pro 2-team cap on invitees | **Deferred to Phase 5** with the rest of pro enforcement | Porting it now — pulls pro enforcement into a phase scoped to invites, and Phase 3 deliberately enforced nothing. Porting only the working half — leaves the two invite paths behaving differently for no explicable reason |
| Pending invites | **Visible and cancellable, creator-only** | Read-only — leaves a typo'd address stuck forever, which is most of `wt-ksh.5.3`. Nothing at all — strict parity, but the 44 pending invites stay invisible and uncancellable through cutover |
| Invite email tooling | **Hand-written HTML**, the shape `authEmails.ts` already uses | react-email now — a new dependency and a rendering toolchain to prove on Convex, for one email. Phase 6 adds reminders and actually makes the case |
| Profile step location | **Its own `/complete-profile` route**, as v1 | A blocking dialog on the dashboard — a second rendering path through `index.tsx`, the file Phase 3 flagged as highest-risk. Folding into login — social sign-in returns as a fresh document load, so it needs a route anyway, giving two implementations |
| "Already a member" feedback | **Info toast, dialog stays open** | v1's behaviour — it returns *"Successfully invited player"*, which is an outright lie, and closes the dialog the user most likely wants to reuse |
| Leaving a team | **Any member may remove themselves; the creator may not** | Letting the creator leave — needs either creator reassignment (v1 only does this in its delete-user trigger) or a team that nobody can administer. Deleting the team instead is the creator's existing, honest option. Keeping Phase 3's "no such affordance" — that was a parity argument, and the owner has now sanctioned the feature |

## Prerequisite: the schema, and a three-step deploy

| Field | Now | After | Why |
|---|---|---|---|
| `players.legacyId` | `v.string()` | `v.optional(v.string())` | `wt-ksh.5.1`. The same reasoning the schema already records for `teams`, `dailyScores` and `monthlyWinners`: absence means "born in v2, not copied", which is Phase 7's reconciliation marker. **No synthesised uuid** — the copy matches on `by_legacyId`, so a fake value would silently never match, and it would lie to every future reader |
| `players.firstName`, `players.lastName` | `v.optional(v.string())` | `v.string()` | A player cannot exist unnamed |

The second is a **narrowing** change. Convex validates the schema against existing documents on
push and rejects the deploy if any row violates it, so this cannot land in one step:

1. Add `migrate.ts`'s `deleteNamelessPlayers` internal mutation under the **current** schema. Push.
2. **Dry-run it against beta, then run it if the count is non-zero.** Expected to be zero — see
   the beta measurement above — in which case this step is a confirmed no-op rather than a
   skipped one.
3. Push the narrowed schema.

`deleteNamelessPlayers` must leave **no dangling references**, because deleting a player doc
does not touch the `Id<'players'>` values already sitting in `teams.playerIds`. For each
nameless player it: removes their id from every team's `playerIds`; clears `creator` where it
points at them; deletes teams left with zero members; and only then deletes the player doc.
`dailyScores` and `monthlyWinners` need no handling — measured at 0 for every nameless player,
and the mutation asserts that rather than trusting it.

**Outcome, 2026-08-21: the dry run reported `namelessPlayers: 0`.** Beta held the `--scope=mine`
copy plus `e2eSeed` rows, and `e2eSeed` always writes both names, so step 2 was a confirmed
no-op rather than a skipped one. The deployment was verified to hold real data (18 players, 7
teams, 6950 daily scores) before the zero was trusted — a zero against an empty database would
have been meaningless.

**And the scaffolding is then deleted.** Once the schema narrows, a nameless player is
unrepresentable, so `deleteNamelessPlayers` can never find one again *and can never be tested
again* — its fixtures cannot be constructed. Keeping it would mean permanently untested live
code that cannot do anything. It and `cleanup-nameless-players.mjs` come out in Task 0d; the
copy-script filter is what keeps nameless rows from returning, and it is testable
(`scripts/lib/copy-filters.mjs`) precisely because it is the durable half of this pair.

Step 2 is operational and runs through `v2/scripts/cleanup-nameless-players.mjs`, mirroring
`copy-from-supabase.mjs`: `ConvexHttpClient` + `setAdminAuth`, `--dry-run` by default,
idempotent, **counts only, never addresses**. It is not the CLI path — `npx convex run` demands
`deployment:data:view`, which no key in this repo carries (the same gap `schema.ts` records for
dropping the two dead `dailyScores` indexes), whereas the migration key already carries
`runInternalMutations` and `runInternalQueries`, which is what this needs.

**No task may run `convex deploy` or `convex dev`.** Pushing the branch triggers the GitHub
Action that deploys to beta; that is the only sanctioned deploy path, and steps 1 and 3 are
ordinary pushes.

The copy script gains a permanent filter — skip players with no first/last name, skip teams
left with zero members — because it runs again at the Phase 7 audit and inside the cutover
window.

**The payoff:** `convex/lib/player.ts` and its `hasCompleteProfile` are **deleted**, along with
all three call sites (`getTeamMonthFor` in `scores.ts`, `recomputeTeamMonth` in `winners.ts`,
`getMyTeamsFor` in `teams.ts`). The "these three must agree or the views disagree" hazard its
own doc comment warns about stops existing rather than being maintained.

**The `if (!member) return null` guards stay.** They are a different check — a member id with no
document, which a scoped copy legitimately produces — and deleting the name check must not take
them with it.

`e2eSeed.ts` also needs its comment updated: it explains the synthetic `e2e-` legacyId as a
consequence of `players.legacyId` being *required*, which stops being true. The synthetic value
itself stays; it is a useful marker that a row is test data.

## Architecture

### Layer 1 — pure logic

`convex/lib/invite.ts`, dependency-free like the rest of `convex/lib/`:

| Export | Behaviour |
|---|---|
| `normaliseInviteEmail(raw)` | Trimmed and lowercased, or `null` when empty or not shaped like an address. **A2's fix, at the write boundary** |
| `isCompleteName(first, last)` | Both non-empty after trimming |

**What actually closes the redirect loop, corrected 2026-08-21.** An earlier draft of this
section said `isCompleteName` is shared by `completeProfile`'s validation and the `needsProfile`
route guard, and that the two "must agree". That is not how the guard is built and it would be
a worse guard if it were: `needsProfile` is a **row-existence check** — it asks whether a player
document exists for the session's email, and never reads a name back.

The loop is closed one layer down, by the schema. `players.firstName`/`lastName` are required
(Task 0c), and `completeProfile` validates before it inserts, so **a row cannot exist without a
valid name**. Row-existence is therefore strictly stronger than re-checking stored names: it
puts no names on the wire and is immune to whatever whitespace happens to be stored.

`isCompleteName`'s two real consumers are `completeProfile`'s server-side validation and the
client's `canSubmit` predicate on the profile form, which judges **raw, untrimmed React state**.
That is why padded input must count as complete.

v1's bug is still the reason this function exists at all: v1 saves any non-empty name but guards
its redirect on `length > 1`, so a one-character name saves and then redirects forever. v2 has
no such second opinion to disagree with.

### Layer 2 — Convex functions

#### `convex/players.ts` — new module

`completeProfile({ firstName, lastName, today })`. Authenticated, but deliberately **not**
`requirePlayer` — there is no player yet, which is the whole point.

1. Resolve the session email, lowercased.
2. Player exists → patch the names. Absent → insert with v1's column defaults
   (`hasPwa: false`, `reminderDeliveryMethods: ['email']`, `reminderDeliveryTime: '10:00:00'`,
   `createdAt: Date.now()`) and **no `legacyId`**.
3. **Claim invites.** Every team whose `invited` contains that address: append the player to
   `playerIds`, remove the address from `invited`.
4. For each team joined, `recomputeTeamMonths(ctx, team, await monthsWithWinners(ctx, id), today)`.

Step 4 is `wt-ksh.5.2`. `winners.ts` already exposes the entry point; this is the third caller
its extraction (`wordle-teams-4gj`) was for. Without it, every month that player could have won
stays wrong forever.

`today` is bounded by `requirePlausibleToday`. This and `invitePlayer` below are its **fifth and
sixth** callers, for the identical reason as the other four: the value is not confined to the
caller, so it must not be spoofable.

`needsProfile` is the query behind the route guard: `true` when authenticated with no player.

#### `convex/teams.ts` — invites, where the module header already says they belong

The header states: *"Invites belong HERE when they land: adding and removing people is
membership, and `removeMember` is their nearest sibling."*

`invitePlayer({ teamId, email, today })`, creator-only via `requireTeamCreatorFor`, returns a
**discriminated result** rather than `void`:

| Branch | Condition | Effect | Returns |
|---|---|---|---|
| Already a member | player exists, on the team | nothing | `{ status: 'already_member' }` |
| Add directly | player exists, not on the team | append to `playerIds`, recompute every affected month | `{ status: 'added', firstName }` |
| Resend | no player, address already in `invited` | send the email again, no write | `{ status: 'resent' }` |
| Invite | no player | append to `invited`, send the email | `{ status: 'invited' }` |

The add-directly branch recomputes because the new member is immediately eligible to have won
past months — the same reasoning `removeMember` carries in reverse.

`leaveTeam({ teamId, today })` — the mirror of `removeMember`, and the one mutation on an
**existing** team that is **not** creator-only (`createTeam` is not on an existing team).
`requireTeamMemberFor` with the caller as the target: you may remove yourself and nobody else,
which is the inverse of `removeMember`'s "you may remove anybody but yourself".

- **The creator cannot leave**, reusing `CREATOR_NOT_REMOVABLE`. Their exit is `deleteTeam`.
  This keeps the Phase 3 invariant that a team always has an administrator, and means no team
  **with an administrator** can be emptied by leaving.
- **Except a team with no creator ON ITS ROSTER.** Keyed on the roster, not on
  `creator === undefined`: the scoped-copy case Phase 3 recorded (where `creator` was not
  copied) reaches it, and so does a copy naming a creator who was not copied onto `playerIds` —
  both are equally unadministrable, since `requireTeamCreatorFor` goes through
  `requireTeamMemberFor` first. If the last member leaves one, the team is deleted with the same
  manual cascade `deleteTeamFor` uses (`monthlyWinners` and `scoringSystems` go, `dailyScores`
  stay), rather than being left as an unreachable orphan.
  - **This destroys any invite still parked on that team**, and the invite may be a third
    party's: `completeProfileFor` scans every team for the joiner's address with no creator
    check, so such an entry is genuinely still claimable, and `invited` is copied wholesale from
    production. Accepted deliberately — the alternative is that the invitee later lands alone on
    a team nobody can administer, the same dead end one step further on. Pinned by a test.
- **Recomputes every month with a winner row**, for exactly the reason `removeMember` does
  (divergence 5): the leaver stops being eligible to have won them.
- **Bounds `today` before the creator guard**, matching `removeMember`, so the same wrong device
  clock yields `INVALID_DATE` from either surface — including on the delete path, which does not
  otherwise read `today`.

`cancelInvite({ teamId, email })` — creator-only, removes the address.

`getTeamInvites({ teamId })` — creator-only **query**, the selected team only. Deliberately
**not** folded into `getMyTeams`, which is documented as PII-free (it picks fields explicitly
so `invited` cannot reach the wire) and is fetched by every connected client.

`convex/inviteEmails.ts` mirrors `authEmails.ts` — a `{ subject, text, html }` triple with a
real plain-text part. `resend.sendEmail` accepts a `MutationCtx`, so the send enqueues
transactionally with the `invited` write; no action hop.

#### `convex/access.ts`

`AccessCode` gains `INVALID_EMAIL` and `INVALID_NAME`. The exhaustive switch in
`src/lib/convex-error.ts` stops compiling until each has copy — that check is deliberate and is
doing its job.

**`NO_PLAYER`'s copy changes.** It currently reads *"Your session expired. Please sign in
again."*, which is actively wrong for someone whose session is fine and whose profile does not
exist yet, and signing in again does not help. It becomes an instruction to finish setting up
the profile. The code survives because the race survives: a user can reach a mutation between
signing in and completing the form.

### Layer 3 — UI

| Component | Notes |
|---|---|
| `src/routes/complete-profile.tsx` | First/last name, porting v1's copy. `beforeLoad`: unauthenticated → `/login`; player exists → `/` |
| `src/routes/index.tsx` | `beforeLoad` gains: authenticated with no player → `/complete-profile`. The only change to the highest-risk file in the Phase 2 UI |
| `src/components/teams/invite-player-dialog.tsx` | Ports v1's `InvitePlayer` |
| `src/components/teams/current-team-card.tsx` | Creator-only Invite button beside Settings (`UserPlus2`, as v1), plus a **Pending** section with per-address cancel popovers, plus a **Leave** control on your own row when you are not the creator |

The two per-row controls are **complements, never both**: the card already gates remove on
`isCreator && member.id !== myPlayerId`, and Leave is `!isCreator && member.id === myPlayerId`.
A creator sees remove on everyone else's row and nothing on their own; a member sees Leave on
their own row and nothing on anyone else's.

Leaving the team you are currently viewing leaves `?team=` pointing at a team you are no longer
on — the same broken-param problem deleting a team already has. It reuses `index.tsx`'s existing
`onDeleted` handler, which clears the param and the remembered team so the sync hook falls
through to the first remaining team rather than the error boundary.

Mutation forms follow the `a335ae8` shape Phase 2 ported: `try`/`catch`, `setSubmitting(false)`
in `finally`, and the dialog closes **only on success** — with the deliberate exception below.

## Error handling

| Code | Meaning | UI |
|---|---|---|
| `INVALID_EMAIL` | Empty, or not shaped like an address | Error toast; the dialog stays open |
| `INVALID_NAME` | Empty first or last name after trimming | Error toast; the form stays |
| `NOT_TEAM_CREATOR` | A member tried to invite or cancel | Error toast |
| `CREATOR_NOT_REMOVABLE` | The creator tried to leave their own team | Error toast; the popover stays open |
| `NOT_A_MEMBER` | Unchanged Phase 2 treatment | Route error boundary on reads |

Invite outcomes are **not** errors, and each gets its own toast:

| Result | Toast | Dialog |
|---|---|---|
| `added` | success — "{firstName} was added to {team}" | closes |
| `invited` | success — "Invite sent to {email}" | closes |
| `resent` | success — "Invite re-sent to {email}" | closes |
| `already_member` | **info** — "{email} is already on {team}" | **stays open, field cleared** |

The last row earns its keep: nothing the user wanted actually happened, and the likeliest next
action is correcting the address, so closing would force them to reopen. `added` returns
`firstName` because it confirms the address matched a real account — the single most useful
thing to learn after inviting someone by email.

## Divergences from v1 — the list goes from five to eleven

All six must be added to `V2-ADDENDUM.md` §7a so Phase 7's audit does not treat them as bugs.

| # | Divergence | Why |
|---|---|---|
| 6 | **Pending invites are visible to the creator, and cancellable** | v1 shows them nowhere, so a typo'd address sits in `invited[]` forever with no remedy and no way to see it. Production carries 44 pending invites across 33 teams today |
| 7 | **A player cannot exist without a name** | Schema-enforced. 151 nameless production players and the 29 dead teams they created are not copied. Measured 2026-08-20: those players own 0 boards and 0 winner rows. Re-measured 2026-08-24 (`wt-ksh.13.8`): they **do** carry `player_customer` rows — 151 of them — which is why `verify-parity.mjs` narrows memberships as well as players and teams |
| 8 | **No 2-team cap on invitees until Phase 5** | v1 caps a non-pro invitee at two teams in `handle_invited_signup`. v2 is **more permissive than prod** until Polar lands. The retrofit hazard is real and is filed: enforcing it later means removing people from teams they already joined |
| 9 | **Inviting someone already on the team says so** | v1 returns *"Successfully invited player"* and closes the dialog. v2 tells the truth and keeps the dialog open |
| 10 | **A member can leave a team** | **No such affordance in v1's UI** — `current-team-client.tsx` gates remove on `player.id !== userId`, so the only exit is asking the creator. A UI claim only: v1's `removePlayer` server action checks neither session nor creator, and the live RLS policy admits any member, so self-removal was already reachable through the API. That is divergence 4's hole, and 4 and 10 must not contradict each other. What is new is the affordance, and a server rule permitting exactly this. The creator still cannot leave, so every team keeps an administrator |
| 11 | **Inviting an existing player who is also already in `invited` adds them, rather than re-sending** | **v1 has FOUR branches, not the three this design first counted.** Its middle case — the player exists AND the address is already in `invited` — re-sends the Supabase invite and does **not** add them to the team. That does nothing useful for someone who already has an account: `inviteUserByEmail` cannot get them onto a team, so however many times the creator tries, they stay off it. (v1 does check that call's error, so the creator is told either "Successfully invited player" or "Player invite failed" — but neither adds them.) v2 adds them and clears the `invited` entry in the same write. Found by Task 3's review; the design's own spec table had inherited the mis-count |

Divergences 6, 9, 10 and 11 are on surfaces v1 has; 7 and 8 are invisible in a route-by-route
comparison. Exercising them takes an invite to an existing member, an invite to a third team,
a member leaving a team, and a look at the copied row counts.

Not divergences, but recorded because they look like ones:

- **Inviting an existing player sends no email.** v1 adds them silently too; they discover it in
  the app. Parity, deliberately kept.
- **`NO_PLAYER`'s message changed.** The code and the condition are unchanged; only the copy,
  which was wrong.

## Testing

- **`convex/lib/invite.test.ts`** (vitest, pure) — normalisation trims, lowercases and rejects;
  `isCompleteName` agrees with the guard, including the one-character case v1 loops on.
- **`convex/players.test.ts`** (`convex-test`) — `completeProfile` creates a row with no
  `legacyId`; is idempotent on re-submit; **claims a MIXED-CASE invite from the lowercase
  account** (A2's hard acceptance criterion, and the shape `scripts/verify-case-fix-dev.mjs`
  proves in v1); and **recomputes winners for every claimed team**, asserted against a team
  that already has winner rows for past months.
- **`convex/teams.test.ts`** grows the four `invitePlayer` branches, `cancelInvite`,
  `getTeamInvites` and `leaveTeam`; negatives: a member who is not the creator is refused by the
  **mutation and the query**, not merely by a hidden button; the creator is refused by
  `leaveTeam`; a non-member is refused; and `leaveTeam` recomputes every month with a winner
  row. The creator-less edge case gets its own test: the last member leaving deletes the team
  and cascades, and `dailyScores` survive.
- **`convex/schema.test.ts`** — an insert without `firstName` is rejected.
- **Playwright** — invite an address, sign in as it, complete the profile, land on the team.
  `pnpm e2e` is **not** part of `test`/`tsc`/`build` and runs after every task touching routes
  or rendered UI.
- **Screenshots in light and dark on a touch-emulating viewport** before any UI task is called
  done. V2-ADDENDUM §5 and §6: five rendering bugs here have passed every automated check, and
  Phase 3's gate caught a page-wide horizontal scrollbar and an unusable input mode.
- **Mutation-test the flagship assertions.** Phase 3's Task 8 shipped a test labelled "the point
  of the whole feature" that passed against the reverted, buggy implementation. Every task
  reverts its own write path once and confirms its headline test fails.

## Out of Scope

- **The pro gate and the 2-team invitee cap.** Phase 5, filed with the retrofit hazard.
- **react-email.** Phase 6, where reminders make the case.
- **TeamBoards carousel**, **monthly-winner celebration dialog**, **`CheckoutReturn`** — still
  no owning phase, filed separately.
- **Creator reassignment.** The creator cannot leave and cannot hand the team to someone else;
  they delete it. v1 reassigns a creator only inside its delete-user trigger, and a transfer-
  ownership affordance is a feature in its own right.
- **Reminder preferences.** The new player row takes v1's defaults; editing them is Phase 6.

## Acceptance Criteria

1. A fresh email invited on beta lands on the right team with the right profile. *(Phase
   done-when, inherited.)*
2. **An invite sent to a MIXED-CASE address joins correctly from the lowercase account.** (A2.)
3. A brand-new signup can create a team — `wt-ksh.5.1`'s dead end is gone.
4. Setting a player's name recomputes every month their teams have a winner row for.
   (`wt-ksh.5.2`.)
5. A creator can see and cancel a pending invite. (`wt-ksh.5.3`, in its surviving form.)
6. A member can leave a team and stops appearing on it; the creator is refused by the
   **mutation**, not merely by a hidden button.
7. `wt-ksh.5.4` — two real accounts on one team on beta, reached through the real invite path:
   a board entered by one appears in the other's browser with no refresh.

## Task Breakdown

In dependency order. Task 0 blocks everything that writes a player.

| # | Task | Done when |
|---|---|---|
| 0a | `deleteNamelessPlayers` + `cleanup-nameless-players.mjs` | Proven by `convex-test` against seeded nameless rows — the player goes, `playerIds` and `creator` are cleaned, an emptied team is deleted, and a player with any score or winner row is refused. Dry run against beta reports its count and writes nothing |
| 0b | **Run the cleanup** (operational) | Beta holds no nameless player. Expected to be a no-op; a non-zero dry-run count is a finding, not a routine step |
| 0c | Narrow `firstName`/`lastName`, widen `legacyId`; copy-script filter | The schema deploys; an insert without a name is rejected by test |
| 0d | Delete `lib/player.ts` and its three call sites | `tsc` clean; `scores`, `winners` and `teams` tests still green |
| 1 | `lib/invite.ts` + tests | Normalisation and `isCompleteName` green, including the one-character case |
| 2 | `completeProfile` + `needsProfile` | A row is created with no `legacyId`; invites claimed case-insensitively; winners recomputed. **Blocks 6, 7** |
| 3 | `invitePlayer` (four branches) + `inviteEmails.ts` | Each branch proven; a non-creator is refused by the mutation |
| 4 | `cancelInvite` + `getTeamInvites` | Creator-only on both; a member is refused by the query |
| 5 | `leaveTeam` | A member leaves and the months recompute; the creator is refused; a non-member is refused; the last member of a creator-less team deletes it and cascades |
| 6 | `/complete-profile` route + dashboard guard | A cold signup reaches the form and lands on the dashboard; no redirect loop on a one-character name |
| 7 | Invite dialog + Pending section + Leave control on CurrentTeamCard | Four toasts correct; `already_member` keeps the dialog open; Leave and remove never both render on one row; leaving the selected team lands on another rather than the error boundary; screenshotted light and dark |
| 8 | e2e, screenshots, `§7a` update, beta deploy, `wt-ksh.5.4`, phase close | The real invite path works on beta end to end |

## Gotchas Carried Into This Phase

- Run everything from **inside `v2/`**. A build from the repo root builds v1 and dirties the
  tracked `public/sw.js`.
- v2's import alias is `#/`, not `@/`.
- `pnpm e2e` is not part of `test`/`tsc`/`build`.
- Screenshots on a **touch-emulating** viewport, and wait for Radix's `animate-in` to settle or
  you capture a half-open dialog and think it is broken.
- Do not commit while a subagent is running — its `--amend` swallows the commit.
- **Never push from a subagent.** A push deploys to beta; a Phase 3 subagent did it unprompted.
- Fixtures live in `convex/fixtures.ts` — never import them from a `.test.ts` file.
- `bd create --description` mangles backticks; use `--body-file`.
- **The repository is public.** No addresses in scripts, output, tests or beads issues.
- Most defects found in Phase 3 were **in the plan, not the code**. When a task finds one, fix
  the plan's source so a replay cannot reintroduce it.

## Deferred Past This Phase, Do Not Lose

- **`wt-ksh.13`** (P1) — the copy script's `upsertTeams` overwrites v2's own team writes. **This
  phase makes it worse:** `teams.invited` and `playerIds` become genuinely v2-written state, so
  re-running the copy restores cancelled invites and reverts joins. It is now a cutover blocker,
  not just beta hygiene. Owned by Phase 7/8.
- **`wordle-teams-7az`** (P1) — `E2E_TEST_MODE` must not survive onto the deployment that
  becomes production.
- **`wordle-teams-04r`** (P2) — confirm Convex's backend clock is UTC. `requirePlausibleToday`
  now guards five mutations and is still an inference.
- **The `deployment:data:view` gap.** No key in this repo can run `npx convex run`, which also
  blocks dropping the two dead `dailyScores` indexes recorded in `schema.ts`. Not a blocker for
  this phase — the scripted `ConvexHttpClient` + `setAdminAuth` path needs only
  `runInternalMutations`/`runInternalQueries`, which `CONVEX_MIGRATION_KEY` already carries.

## Operational note: which deployment, which credentials

`.env.local` at the repo root holds **two** sets of Convex variables under the same four names:
the prod set **commented out and above**, the dev set active below. Sourcing the file plainly
gets you **dev**, whose cloud deployment has no functions deployed at all (local development
runs against the `anonymous:anonymous-v2` deployment instead, so the cloud dev one is unused).

Beta runs on the **prod** set. Reach it by de-commenting that block into the environment:

```sh
set -a; . <(sed -n 's/^#[[:space:]]*\(CONVEX_URL=.*\|CONVEX_MIGRATION_KEY=.*\)/\1/p' ../.env.local); set +a
```

**Name the variables you need; do not uncomment the block wholesale.** It is not
only Convex — it also carries Polar, Novu, and three Supabase variables that each
appear **twice**, so sourcing all of it silently retargets Supabase to whichever
duplicate comes last.

`v2/.env.production`'s `VITE_CONVEX_URL` is **not** authoritative for this — CI derives that
value from `secrets.CONVEX_DEPLOY_KEY` at build time (`deploy-v2.yml`), so the checked-in file
can disagree with reality. Verified 2026-08-21 by reading `migrate:counts` off the live
deployment.
