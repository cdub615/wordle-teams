# V2 Addendum — read this before following anything else in this folder

**Date:** 2026-08-18 · **Applies to:** Phase 1.5 (`wt-ksh.12`) of the v2 re-platform

The rest of this bundle is the export from Claude Design, left byte-for-byte as
it arrived so future revisions can be diffed against it. **Do not edit those
files.** This addendum records what was actually done, and the places where
following the bundle literally would have made things worse.

---

## 1. The bundle targets v1, not v2

Its README says it proposes a token set "for the v2 replatform." That is
misleading. `v1 → v2` in this bundle means *token-set version 1 → version 2*,
applied in place to the existing Next.js app on `main`. Every concrete artifact
points at v1:

| Artifact | Why it is v1-targeted |
| --- | --- |
| `globals.v2.css` | Described as a drop-in for `src/app/globals.css`; Tailwind **3** syntax (`@tailwind base`, `@layer base`, `@apply border-border`) |
| `tailwind.tokens.ts` | Expects a `tailwind.config.ts` with `theme.extend.colors` consuming `hsl(var(--token))`. v2 has no such file — it is Tailwind **4** via `@tailwindcss/vite` |
| The Layer 3 alias block | Exists so v1's `src/components/ui/*` compiles unchanged |
| `MIGRATION.md` phases 2–4 | Name only v1 files: `wordle-board.tsx`, `ui/badge.tsx`, `app-bar-base.tsx`, `home/feature-cards.tsx`, `magicui/border-beam.tsx` |
| `tokens.json` → `meta` | `stack: "Next.js + Tailwind + shadcn/ui"`, `themeMechanism: ".dark class via next-themes"`, `branch: main` |

**`MIGRATION.md` was not run and must not be run against v2.** What was used:
`DESIGN_SYSTEM.md` §1–11 as the spec, and `tokens.json` → `v2` as the value
source, translated by hand to Tailwind 4.

This is not a criticism of the capture. `DESIGN_SYSTEM.md` is source-derived and
accurate about v1, which makes it an unusually good input for a parity port —
adopting it *encodes* parity rather than violating it.

---

## 2. Its contrast numbers are wrong. Recompute before trusting any of them.

`MIGRATION.md`'s reference table does not match the bundle's own hex values.
Measured with a checker validated against six published WCAG reference pairs
(`#000/#fff = 21.00`, `#767676/#fff = 4.54`, `#595959/#fff = 7.00`, …):
**5 of 7 pairs disagree in light, 6 of 7 in dark.**

The most consequential error inverts a prescribed fix. `DESIGN_SYSTEM.md` §10
calls v1's success badge unreadable at "~2.1:1":

- v1's actual pair — near-black `#111113` on green-600 `#16a34a` — is **5.72:1
  and passes AA**.
- The bundle's prescribed replacement — white on `#16a34a` — is **3.30:1 and
  fails**.

Applying `MIGRATION.md` phase 2 verbatim would have made the badge *worse*.
v1's badge was never broken.

**Four token values therefore deviate from `tokens.json` on purpose.** They are
documented inline in `v2/src/styles.css`; do not "restore" them:

| Token | Bundle | v2 | Contrast |
| --- | --- | --- | --- |
| `--success` (light) | `#16a34a` | `#15803d` | 3.30 → 5.02 |
| `--accent-solid` (light) | `#16a34a` | `#15803d` | 3.30 → 5.02 |
| `--text-subtle` (light) | `#9f9fa8` | `#767680` | 2.52 → 4.31 |
| `--danger` (dark) | `#ef4444` | `#dc2626` | 3.76 → 4.83 |

Six of the seven reference pairs now clear AA in **both** themes. `text-subtle`
is the exception (4.31 light / 4.18 dark) and cannot reach 4.5 while remaining a
rank below `text-muted`, which is itself only 4.63 — three text ranks do not fit
above the AA line. Treat it as large-text/decorative and use `text-muted` for
anything normal-sized that must be legible, including the N/A cells that
`tokens.json` assigns to it.

`#16a34a` deliberately survives as `--brand-from`, the wordmark gradient and
`--wordle-correct` (light). Those carry only large text, where 3.30 clears the
3:1 bar, and it is the game's green.

---

## 3. One token was renamed to fix a latent bug

`globals.v2.css` declares `--accent-foreground` **twice inside the same
`:root`** — once in Layer 2 as the brand pair (white on green) and again in
Layer 3 as the shadcn name (text on the hover surface). Last declaration wins,
so the brand pair silently resolves to near-black on green, ~2.2:1 — the very
failure the bundle exists to fix. `tailwind.tokens.ts` sidesteps the same
collision by omitting the brand accent from the utility set entirely.

In v2 the brand pair is **`--accent-solid` / `--accent-solid-foreground`**, so
both survive.

---

## 4. How the token set is actually structured in v2

All of it lives in `v2/src/styles.css`, generated from `tokens.json` → `v2`
rather than hand-transcribed.

- **Layer 2 — semantics.** The 24 design-system names, light and dark.
- **Layer 3 — the shadcn contract**, repointed at Layer 2.

**Layer 3 is permanent in v2.** `MIGRATION.md` phase 4 says to delete the alias
layer once nothing references the old names. That is correct for v1, where those
names were being retired. In v2 it is backwards: shadcn components *are* the
consumers of `--background`, `--primary`, `--ring` and friends, so Layer 3 is
the contract, not scaffolding.

An `@theme inline` block maps both layers onto Tailwind 4 utilities. Names with
no shadcn equivalent are exposed directly (`bg-surface`, `bg-accent-solid`,
`bg-wordle-correct`, `border-line-strong`, …); the bundle's `line-*` naming is
kept to avoid colliding with shadcn's `border`.

Theming is the `.dark` class, which `ThemeToggle` sets in all three modes
(light / dark / auto). No CSS keys off `data-theme` any more; that attribute is
now informational only.

---

## 5. Decisions taken

- **The design system supersedes v2's teal palette.** v2 shipped with an
  unrelated sea/lagoon/palm set from the TanStack starter. It is gone. Removing
  it also fixed a live bug: the teal block redefined `--surface` *after* the
  design-system `:root`, so `--surface` resolved to a translucent `#ffffffbd` in
  light, and in dark `:root[data-theme="dark"]` beat `.dark` on specificity. The
  surface token was never actually in effect, which is why cards had no step off
  the page.
- **v2 adopts shadcn/ui**, `style: "default"` — the same style v1 uses.
- **Fonts are Inter (UI) + Geist (display)** per §3, with `--font-display` as a
  real token rather than v1's per-element `className` (drift #5).

### The style choice has a trap in it

v2 initially used `style: "radix-nova"`, on the reasoning that Radix matches
v1's component vocabulary. **That registry variant is broken upstream:** it
imports Radix primitives but styles on Base UI data attributes. Radix emits
`data-state="checked"` and `data-orientation="horizontal"`; the components style
on `data-checked:` and `data-horizontal:`. Roughly 80 dead selectors across
dialog, dropdown-menu, select, separator, sheet, switch, tabs and table.

`vite build`, `tsc --noEmit` and the full test suite were **all green** while
this was broken — Tailwind simply never emits a rule for a selector that cannot
match. It was caught only in a screenshot, as an invisible Switch (transparent
track under a white thumb on a near-white page) and a zero-height Separator.

`default` is Radix-native, internally consistent, and matches `DESIGN_SYSTEM.md`
§7 metrics out of the box: badge `rounded-full px-2.5 py-0.5 text-xs
font-semibold`, switch 44×24 with a 20px thumb, solid destructive. Do not move
to a `radix-*` preset style without re-checking this.

**Screenshot UI work before calling it done.** The toolchain cannot see this
class of bug.

---

## 6. Things the bundle does not cover

- **The login/onboarding surface.** `DESIGN_SYSTEM.md` documents the OTP input
  and nothing else about it. Amendment A7 made login a sanctioned exception to
  strict parity, and that work (labelled provider buttons, funnel events) is
  additive. Note v2 never inherited v1's icon-only tooltip grid in the first
  place.
- **`CardTitle` renders a plain `<div>`.** A page using Card as its main region
  silently has no `<h1>`. v2 added Slot-based `asChild` to it.
- **`sonner` imports `useTheme` from `next-themes`,** which v2 does not use.
  Replaced with `lib/use-resolved-theme.ts`, reading the authoritative `.dark`
  class.
- **`Table` hides its own scroll container.** The primitive wraps `<table>` in
  a `div.relative.w-full.overflow-x-auto` that callers cannot reach. Because
  that div is `w-full` and bounded by its parent, *it* — not any wrapper a
  caller adds — is the element the table actually overflows, so it is the real
  scroll region. A horizontally scrolling data table has to make that region a
  keyboard focus target, which was impossible from outside. v2 added a
  `wrapperProps` pass-through (Phase 2, `wt-ksh.3.9`); the scores table uses it
  for `tabIndex` and an `aria-label`.

  **Phase 2 also fixed the axis (`wt-ksh.3.13`).** The wrapper originally
  defaulted to `overflow-auto` (both axes). `scores-table.tsx` additionally
  wrapped the whole `Table` in its *own* `overflow-x-auto` div, which was
  bounded by — and therefore never smaller than — the primitive's own
  wrapper, so it never engaged; the primitive's div was always the real (and
  only live) scroller, and because it was `overflow-auto` the table could
  scroll vertically inside its own box instead of the page scrolling. Fixed
  by changing the primitive's default to `overflow-x-auto` and deleting the
  scores table's redundant outer scroller — one scroll container, x-axis
  only. If a future caller needs the wrapper to scroll vertically too, add
  that explicitly via `wrapperProps.className`; don't restore a bare
  `overflow-auto` default here, and don't wrap `<Table>` in another
  `overflow-*` div — that's exactly the nested-container shape this fixed.

  Related, and worth knowing before writing another table: the primitive also
  hardcodes `w-full` on the `<table>` itself. Under `table-layout: auto` that
  acts as a **cap**, not a minimum, so a wide table compresses its columns
  instead of overflowing — with 31 day columns the headers wrapped to one
  character per line. `scores-table.tsx` overrides it with `w-max min-w-full`.

  **Phase 2 also had to revisit this twice more (`wt-ksh.3.15` / `wt-ksh.3.16`),
  and both times the earlier fix's own reasoning was the trap:**

  - `overflow-x-auto` on the wrapper forces its *computed* `overflow-y` from
    `visible` to `auto` — CSS refuses to pair a non-visible axis with a
    visible one. The `wt-ksh.3.13` comment argued that was inert because
    nothing constrains the wrapper's height, which is true for layout but not
    for touch: a real mobile drag inside the table still scrolled the table,
    not the page, because a computed `overflow-y: auto` is still a touch
    scroll target regardless of whether it ever has anything to scroll.
    Fixed by setting `overflow-y-hidden` explicitly instead of leaving the
    coercion to land wherever it lands. Verified with an actual CDP-dispatched
    touch drag against a touch-emulating context, not by reading the computed
    style — that computed value is exactly what misled the first fix.
  - The table was still Tailwind preflight's default `border-collapse`, and
    `position: sticky` on a `<td>`/`<th>` under `border-collapse: collapse` is
    long-broken across browsers: a collapsed border belongs to the table's
    grid rather than to the cell, so a sticky cell repaints outside the
    normal flow and its border escapes the collapsed model. That produced
    both the pinned Player/Score columns drifting into place after a
    horizontal scroll gesture ended (rather than staying put throughout it)
    and a row border doubled on top of the collapsed grid line. Fixed by
    switching the table to `border-separate border-spacing-0`, which also
    means every border that used to live on `<tr>`/`<thead>`/`<tbody>` had to
    move onto the actual cells (`TableHead`/`TableCell`) — a border on a row
    or section element is simply never painted once the table stops being
    `border-collapse`, so it would otherwise vanish silently rather than
    error. The pinned cells also picked up an explicit `z-10` in
    `scores-table.tsx`, since a sticky cell with `z-index: auto` has no
    guaranteed paint order over the scrolling cells beside it.

    Verified by sampling the pinned columns' bounding boxes on every
    `touchmove` step of a real CDP touch drag (not just before/after — "lands
    in the right place eventually" was the bug), and by decoding screenshot
    pixels through an in-page `<canvas>` to compare the row-boundary line's
    device-pixel thickness against the frame's own outer border at DPR 1/2/3
    in both themes, rather than trusting computed border widths — the same
    lesson wt-ksh.3.12 already put in this document once.
  `vite build`, `tsc --noEmit` and all 115 tests were green with that bug
  present; it was caught only by looking at a screenshot, which is the same
  lesson as §5.

  **`wt-ksh.3.17`, the corner radius:** `border-separate` (above) means every
  cell paints its own `border-b`, and the original fix put `rounded-bl-md` /
  `rounded-br-md` on the pinned cells *inside* `rows.map`, so every row's
  bottom border curved, not just the last row's. Fixed by moving the radius
  off the per-row cells and onto `TableBody`'s `className` in
  `scores-table.tsx`, targeted the same way `ui/table.tsx` already cancels
  the last row's border (`[&_tr:last-child>td]:border-b-0`):
  `[&_tr:last-child>td:first-child]:rounded-bl-md` /
  `[&_tr:last-child>td:last-child]:rounded-br-md`. Kept local to
  `scores-table.tsx` rather than folded into the shared primitive — nothing
  else using `Table` wants rounded row corners.

  **`wt-ksh.3.18`, `wrapperProps` also carries a ref now:** the primitive's
  `wrapperProps` was typed `React.HTMLAttributes<HTMLDivElement>`, which does
  not include `ref` (TypeScript's excess-property check on the object
  literal rejects it). Widened to `React.ComponentPropsWithRef<"div">` so a
  caller can reach the actual scroll container with a ref, not just
  `tabIndex`/`aria-label` — `scores-table.tsx` uses it to measure and set
  `scrollLeft` for the auto-centre-on-landing feature below. `{...wrapperProps}`
  spread onto the div still forwards `ref` correctly regardless of typing;
  the type only needed widening for `tsc`, not for the ref to actually work.

  Centring itself lives entirely in `scores-table.tsx`, in a
  `useLayoutEffect` keyed on `[hydrated, teamId, month]` — deliberately NOT
  on the live score data, so a teammate's board submission (which re-renders
  this component through the Convex subscription) never re-triggers it.
  Guarded by: only after `hydrated`; only when the viewed month's `monthOf`
  matches today's; only when the wrapper's `scrollLeft` is still `0` (nothing
  has scrolled it yet); and clamped to `[0, scrollWidth - clientWidth]`. The
  target `data-day` cell (added in `wt-ksh.3.11`) is queried directly rather
  than computed positionally.

---

## 7. A v1 bug found while porting the board — fixed in v2, still live in v1

`wt-ksh.12.10`. v1's `getLetterColorsForWord` runs two passes; pass 2 demotes
the **earlier** duplicate `present` tile rather than the later surplus one, so a
legitimate yellow is lost. Answer `SPEED`, guess `GEESE`: real Wordle shows
`- Y G Y -` (two E's, matching the answer), v1 shows `- - G Y -` (one). The
player is told a correct letter is wrong, on the signature component.

**v2 no longer does this.** `tileStates` was rewritten to the standard
two-phase algorithm — exact matches claim their letters, the remaining answer
letters form a pool, and non-exact columns consume it left to right — which
makes the invariant structural rather than something a corrective pass has to
restore. Patching v1's pass 2 would have kept a shape that is hard to reason
about.

**This is a deliberate, known divergence from v1 during the parallel run.**
It is a correctness fix on the signature component, not a redesign, and it is
the only place *the board* differs from prod.

**Phase 2 added two more, so the audit should now expect three in total.** See
§7a below — the "and only there" that used to end this section is no longer
true, and the audit must not treat the other two as bugs.

**v1 is still affected in production.** It was not fixed here because this
branch treats `src/` as untouched until cutover (design doc, Repo Layout) — a
v1 fix would need its own branch off `dev` and its own release, and v1 retires
at cutover. That call is the owner's.

Covered by `v2/src/lib/wordle.test.ts`, including a per-letter invariant test
asserting that no letter is ever lit more times than it appears in the answer.

---

## 7a. The full divergence list for Phase 7's parity audit

**Thirteen known differences from production, all deliberate. Anything else the
audit finds is a bug.**

| # | Divergence | Added | Why |
| --- | --- | --- | --- |
| 1 | Duplicate-letter tile colouring | Phase 1.5 (`wt-ksh.12.10`) | §7 above. v1 loses a legitimate yellow; v2 uses the standard algorithm |
| 2 | A double submit cannot create a duplicate score row | Phase 2 (`wt-ksh.3.6`) | v1 keys the upsert on a client-held score id and inserts when the client lacks one, so a double submit makes two rows — it has already done so 5 times in production (`wordle-teams-rac`). v2 keys on `(playerId, puzzleDay)`, which makes it structurally impossible. **The 5 existing copied pairs are left untouched** and read first-wins, exactly as v1 renders them |
| 3 | `hasSeenCelebration` survives a winner rewrite | Phase 2 (`wt-ksh.3.7`) | v1's `update_monthly_winners` deletes the row and re-inserts it, wiping the seen-list every time anyone enters a board dated in that month — which can re-fire the celebration at someone who already dismissed it. v2 preserves the array when the winner is unchanged and resets it only when the winner actually changes |
| 4 | Team mutations are creator-only, enforced server-side | Phase 3 (`wt-ksh.4.21`) | v1's UI offers Settings and Delete only to the creator, but its RLS policy permits `UPDATE` to the creator **or any member** — including writes to `player_ids`, so any member can remove any other member through the API. v2 makes the UI's rule the real one via `requireTeamCreator`. No user sees a behaviour change; the rule stops being cosmetic |
| 5 | Membership and scoring changes recompute past winner rows | Phase 3 (`wt-ksh.4.24`, `wt-ksh.4.25`) | v1's `update_monthly_winners` is a trigger on `daily_scores`, so removing a player never fires it and they stay named as the winner of months they are no longer in. **Production is carrying stale rows today.** v2 recomputes every month the team has a winner row for |
| 6 | Pending invites are visible to the creator, and cancellable | Phase 4 (`wt-ksh.5.3`) | v1 shows them nowhere, so a typo'd address sits in `invited[]` forever with no remedy and no way to see it. Production carried 44 pending invites across 33 teams when this was written |
| 7 | A player cannot exist without a name | Phase 4 (`wt-ksh.5.1`) | `players.firstName`/`lastName` are required. 151 nameless production players and the 29 dead teams they created are not copied — measured 2026-08-20, those players own 0 boards and 0 winner rows. Re-measured 2026-08-24 (`wt-ksh.13.8`): they **do** carry `player_customer` rows — 151 of them, `player_customer` matching `players` row for row **on that date**, nothing in the schema enforcing it — which is why `verify-parity.mjs` narrows memberships as well as players and teams. v1 tolerates a nameless row because `handle_new_user` creates one at signup and the name arrives later, if ever |
| 8 | ~~No 2-team cap on invitees until Phase 5~~ **RESOLVED in Phase 5 — the cap now matches v1** | Phase 4, closed Phase 5 (`wordle-teams-qyd`) | v1 caps a non-pro invitee at two teams, in `handle_invited_signup` **and** in `handle_add_player_to_team`. Phase 4 enforced neither, so v2 was **more permissive than prod**; Phase 5 built both halves and **this is no longer a divergence** — it is kept in the table because Phase 7's audit should expect a correct cap and because the retrofit hazard is worth remembering: enforcing later means removing people from teams they have already joined. Both of v1's cap branches work: `handle_add_player_to_team`'s `invited_id` typo was real but was fixed on 2024-04-29 (`20240429204119`, 25 minutes after `20240429200154` introduced it), and the current definition, `20240501180309`, parks the address in `invited` correctly. v2 parks in `invitePlayerFor` and claims at most `FREE_TEAM_LIMIT` in `completeProfileFor`. **Two deliberate differences remain inside the port**: v2 derives the pending-invite count from `teams.invited` rather than storing v1's `invites_pending_upgrade` counter, which v1 writes from five call sites using two different formulas and which the copy does not carry; and v2's signup half counts **teams already held** where v1 counts **pending invites**, because v1's formula hands out a third team on a second profile submit (proven by planting it: the test fails with `length 2 → got 3`) |
| 9 | Inviting someone already on the team says so | Phase 4 | v1 returns *"Successfully invited player"* and closes the dialog even when nothing happened. v2 shows an info toast and keeps the dialog open so the address can be corrected |
| 10 | A member can leave a team | Phase 4 | **v1 offers no self-removal in the UI** — `current-team-client.tsx` gates the remove control on `player.id !== userId`, so the only exit is asking the creator. Owner-sanctioned. Note this is a UI claim only, and deliberately narrower than it first read: v1's `removePlayer` server action performs no session or creator check and the live RLS policy admits any member, so leaving was *already* reachable through the API — that is the hole **row 4** documents, and rows 4 and 10 must not contradict each other. What is new in v2 is an affordance for it, and a server rule that permits exactly this and nothing else. The creator still cannot leave, so every team keeps an administrator |
| 11 | Inviting an existing player who is *also* already in `invited` adds them, rather than re-sending | Phase 4 | **v1's invite has FOUR branches, not the three the Phase 4 design first counted.** Its middle case — the player has an account AND the address is already parked in `invited` — re-sends the Supabase invite and does **not** add them to the team. `inviteUserByEmail` cannot get an address that already has an account onto a team, so however often the creator tries, the invitee stays off it. (The creator is told either "Successfully invited player" or "Player invite failed" depending on what GoTrue returns — v1 does check that call's error — but neither outcome adds them.) v2 adds them and clears the `invited` entry in one write. Found by Task 3's review |

| 12 | A downgrade never deletes an occupied team | Phase 5 (`wordle-teams-stf`) | v1's `handle_downgrade_team_removal` keeps 2 teams and then **DELETES the teams the downgraded player created** beyond the keep list — taking every other member's scores and monthly-winner history with them. A billing event on one account destroying a third party's data is not behaviour worth porting. v2 keeps 2 (owner-held first, then oldest), removes the player from the rest, **reassigns `owner` to the earliest-joined remaining member** on a team they owned and left, and deletes only a team nobody is left in — through `cascadeDeleteTeam`, so its `monthlyWinners` and `scoringSystems` go with it rather than being orphaned. Ported from `20240501193430`, **not** the `20240501191728` the plan first named: that earlier version's `id != any(teams_to_keep)` is true whenever id differs from *at least one* element, so with two kept ids **every** id qualifies and it deletes the teams it just decided to keep. Only bites a player owning 3+ teams. This is also why `teams.creator` was renamed to `teams.owner` — reassignment makes "creator" plainly false |
| 13 | A failed webhook is retried instead of swallowed | Phase 5 (`wordle-teams-p8m`) | v1's replay guard keys on **"a row exists for this webhook id"**. It inserts before processing, and `markProcessed` sets `processed: true` *along with* the error — so a failure returns 500, Polar retries, the retry hits the unique index, is mapped to `duplicate`, and is answered **200**. The event is lost permanently, recorded as processed with an error string. v2 keys the guard on **`processed`**, and writes the failure row from a **separate** mutation outside the rolled-back transaction — Convex mutations are transactional, so the rollback that makes v2 correct would otherwise erase the evidence too. A row that exists but failed is picked up and finished. Pinned by a control that reproduces v1's exact bug: guarding on row existence fails precisely one test, *"a previously FAILED event IS reprocessed on redelivery"*, while the duplicate test correctly stays green |

Two Phase 5 notes that are **not** divergences, recorded because they look like
ones. Identity resolution accepts **both** id namespaces — a Convex `Id` and a
v1 uuid via `by_legacyId` — because v1 set Polar's `external_customer_id` to the
Postgres uuid, so after cutover every existing subscriber's webhook carries a
string `normalizeId` rejects. That is a port requirement, not a behaviour change.
And webhook signatures are verified through `standardwebhooks` directly rather
than `@polar-sh/sdk`'s `validateEvent`, which calls `Buffer.from` and **cannot
run on Convex's default runtime** — byte-identical key derivation, proven by
signing under the SDK-derived key and verifying under the shipped one.

Both Phase 2 divergences are on the **write** path, so they are invisible in a
static route-by-route comparison. Exercising them takes a deliberate double
submit and a winner rewrite within one month.

Of the Phase 4 six, 6, 9, 10 and 11 are on surfaces v1 also has, so a
route-by-route comparison will meet them; 7 and 8 will not show up that way at
all, and take a look at the copied row counts and an invite to a third team
respectively. All four invite outcomes are pinned by `v2/e2e/invites.spec.ts`,
which is the only automated coverage the invite UI has at any layer.

Not divergences from v1, but recorded because they look like ones:

- **`NOT_A_MEMBER` renders a full error screen, not a toast.** That differs from
  the Phase 2 *design doc's* original error table, not from v1 — v1 has no
  equivalent state at all. The design doc carries the amendment explaining why.
- **The month picker offers a fixed three-month window to everyone.** v1 widens
  it for pro accounts. Phase 2 deliberately deferred the pro gate, so v2
  currently shows a pro user *less* history than prod. Nobody sees more than v1
  would allow, which is the safe direction, but the audit will notice it.
- **The scoring system is versioned by effective-from month.** Not a divergence:
  v2 had no reachable editor before Phase 3, so no v2 user has ever had a system
  rewritten in place. See `2026-08-19-v2-phase3-teams-design.md`.
- **The missed-day row is labelled "Missed day", not `0`.** `n_a` is a misnomer —
  v1's own card files it under "0 attempts" and it has nothing to do with the
  `N/A` shown for weekends. The schema field name is unchanged.
- **A team whose creator was not copied cannot be edited by anyone.**
  `teams.creator` is optional because a scoped copy may omit it. A property of
  the copy, not of the permission rule.
- **Beta team and player state does not survive cutover.** The final copy run is
  meant to overwrite it — beta is permanently testing data, including rows other
  testers create. Deliberate, and it reads like data loss. Epic `wt-ksh`,
  *Data Model & Migration*, has which rows a re-run can actually revert and what
  the overwrite report cannot see.
- **The zero-teams empty state is a focused create-team card, not v1's
  marketing `Intro`.** Sanctioned by amendment A7.
- **Inviting an existing player sends no email.** v1 adds them silently too; they
  discover it in the app. Parity, deliberately kept.
- **`NO_PLAYER` says "Finish setting up your profile", not "Your session
  expired".** The code and the condition are unchanged; only the copy, which was
  describing the wrong problem.

---

## 8. Where things live

| What | Where |
| --- | --- |
| Tokens, base layer, helper classes | `v2/src/styles.css` |
| shadcn config | `v2/components.json` (`style: "default"`, aliases on `#/`) |
| Components | `v2/src/components/ui/` |
| Board + score cell | `v2/src/components/wordle-board.tsx`, `score-cell.tsx` |
| Board logic + tests | `v2/src/lib/wordle.ts`, `wordle.test.ts` |
| Funnel events | `v2/src/lib/funnel.ts` (no destination yet — `wt-ksh.12.11`) |
| Theme hook | `v2/src/lib/use-resolved-theme.ts` |

Note v2's import alias is `#/`, not shadcn's default `@/`, and the shadcn CLI
must be run from inside `v2/` — from the repo root it misdetects the project as
v1 and resolves the Tailwind CSS file to `docs/design-system/globals.v2.css`.
