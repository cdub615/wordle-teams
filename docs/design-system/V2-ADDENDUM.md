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

**Five token values therefore deviate from `tokens.json` on purpose.** They are
documented inline in `v2/src/styles.css`; do not "restore" them:

| Token | Bundle | v2 | Contrast |
| --- | --- | --- | --- |
| `--success` (light) | `#16a34a` | `#15803d` | 3.30 → 5.02 |
| `--accent-solid` (light) | `#16a34a` | `#15803d` | 3.30 → 5.02 |
| `--text-subtle` (light) | `#9f9fa8` | `#767680` | 2.52 → 4.31 |
| `--danger` (dark) | `#ef4444` | `#dc2626` | 3.76 → 4.83 |
| `--text-muted` (light) | `#71717a` | `#6b6b74` | 4.40 → 4.80 **on `--surface-sunken`** |
| `--text-subtle` (dark) | `#737373` | `#848484` | 3.59 → 4.56 **on `--surface-sunken`** |

Six of the seven reference pairs now clear AA in **both** themes.
**`text-subtle` is the exception IN LIGHT ONLY** &mdash; the token is
deliberately asymmetric since 2026-09-04 (`wordle-teams-51zk`); see the end of
this section. In light, treat it as large-text/decorative and use `text-muted`
for anything normal-sized that must be legible, including the N/A cells that
`tokens.json` assigns to it. In dark that caveat does not apply.

**The fifth row was added by the Phase 7 Task 4 review, and it is the only one
that is not about `tokens.json` being wrong — it is about which background the
ratio was measured against.** `#71717a` is 4.63 on `--background` `#fafafa`,
which is what this file and `styles.css` both recorded, and which is a pass. On
`--surface-sunken` `#f4f4f5` the identical grey is **4.40**, which is not — and
layer 3 maps `--muted` → `--surface-sunken` and `--muted-foreground` →
`--text-muted`, so `bg-muted text-muted-foreground` is a pairing shadcn hands
out by default. It was already live in `ui/tabs.tsx` and `ui/sonner.tsx` before
the marketing landing put six paragraphs of body copy on that band. `#6b6b74`
measures 4.80 on `--surface-sunken`, 5.05 on `--background`, 5.28 on
`--surface`. Darkening can only raise contrast here: every consumer sits on a
light-in-light-mode surface, and `--surface-inverse` has no consumer in `v2/src`
at all.

**The consequence for `text-subtle` was stated wrongly here and is now
measured** (`wt-ksh.8.48`). This file previously said that with `text-muted` at
5.05 there **is** room to darken `text-subtle` to AA and keep it a rank below.
**5.05 is the `--background` figure** — the very single-surface mistake the row
above was added to correct. The binding surface is `--surface-sunken`, where
`text-muted` is **4.80**, so the band a third rank would have to occupy is 4.50
to 4.80.

Searched rather than argued: the darkest cool grey that clears 4.5 on all three
light surfaces is `#6f6f79`, and it sits **1.06:1** from `text-muted` — against
the **1.174:1** the shipped pair actually uses. Adopting it would collapse the
two ranks into one. **So the old "three text ranks do not fit above the AA line"
conclusion still holds in light; only its arithmetic needed replacing.**
`v2/src/styles.test.ts` now runs that search on every CI run, so if `text-muted`
ever darkens enough to widen the band the exception is flagged for revisiting
instead of being inherited.

**Dark was different, and the exception was lifted there on 2026-09-04**
(`wordle-teams-51zk`, the owner's call). The band is wide — `text-muted` is 6.76
on `--surface-sunken` — so `--text-subtle` moved `#737373` → `#848484`, which
clears AA on all three dark surfaces (**5.29 / 5.01 / 4.56**) while staying
**1.483:1** from `text-muted`.

**THE TOKEN IS THEREFORE ASYMMETRIC ON PURPOSE: AA in dark, a documented
exception in light.** That is a real cost — a rank in a design system should
ideally mean one thing — and it was taken for three reasons:

- **The old value was worse than this file admitted.** "4.18 dark" is the
  `--background` figure. `#737373` measured **3.59** on `--surface-sunken`, so
  the shortfall was a gap rather than a near-miss — the same single-surface
  mistake the `--text-muted` row above exists to correct, repeated on the token
  whose exception it was describing.
- **The separation argument points the other way from how it was first framed.**
  Dark's rank separation drops from 1.880:1 to 1.483:1, which sounds like losing
  a deliberate visual step — but **light ships 1.174:1 today** and has always
  been treated as adequate. The lifted dark pair is still further apart than the
  light pair nobody objects to.
- **Dark is the theme the app is actually used in**, so the shortfall was
  sitting where it mattered most, on every N/A cell, timestamp and placeholder.

`styles.test.ts` pins the asymmetry **in both directions**, because either half
drifting is a defect: light silently clearing AA would mean the exception is
stale, and dark silently dropping below it would mean this lift was reverted.
Both assertions measure the **worst** of the three surfaces rather than
`--background`, which is what the previous version of that test did.

`v2/src/styles.test.ts` now recomputes these pairs from the shipped hex values,
so the next ratio that is only checked against one background fails a gate
instead of a review.

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

**Sixty-five known differences from production, all deliberate. Anything else
the audit finds is a bug.**

Reconciled by Phase 7 Task 16 on 2026-09-01, and the count is load-bearing
precisely because of the sentence above it: while the header said eighteen and
the table held thirty-nine, twenty-one real divergences were sitting in a list
the next line invited a reader to treat as bugs.

**IT DRIFTED AGAIN, AND THAT IS WORTH MORE THAN THE CORRECTION.** On 2026-09-02
the header still said forty-three while the table held **fifty-two**: rows
44-52, all from the UI/UX polish pass, were appended without touching the count.
Nine deliberate divergences were therefore sitting under a sentence telling the
audit to treat anything beyond forty-three as a bug — the identical failure this
paragraph was written to record, recurring within a day of being written.
Corrected to fifty-three here. **Nothing checks this number**, which is why it
has now gone stale twice; a test that counts the rows and compares would end it,
and is filed rather than done.

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
| 14 | The weekend rule is evaluated in the player's zone, not the server's | Phase 6 (`wt-ksh.7.20`) | v1's live `get_players_for_reminder` asks `EXTRACT(DOW FROM CURRENT_DATE) NOT IN (0, 6)` (`supabase/migrations/20250416172516_limit_daily_reminders.sql:17`). `CURRENT_DATE` is the **database server's** date, so "is it the weekend" is answered once in UTC and then applied to every player wherever they are. In `Australia/Sydney` that is wrong for the first ten or eleven hours of the local day, twice a week and in opposite directions: on their Saturday morning UTC still reads Friday, so a `playWeekends: false` player **is** reminded; on their Monday morning UTC still reads Sunday, so the same player is **suppressed** on a working day. `Pacific/Honolulu` gets the mirror image. v2 asks `needsWeekendOptIn(localDay)` (`v2/convex/lib/reminders.ts:176-178`) against the day resolved in the player's own `timeZone`. **This is the same defect class `puzzleDay` was created to fix.** Measured at planning time, from production, and not re-run for this row: **733 of production's 7468 score rows fall on a different calendar day in UTC than in `America/Chicago`, across 57 distinct player timezones** (581 of them also differ from the player's own zone) — recorded at `v2/convex/schema.ts:176-191`. Pinned by *"on a Saturday, skips a player whose only team does not play weekends"* and *"on a Saturday, reminds a player on a team that does play weekends"* (`v2/convex/reminders.test.ts:155,164`). Note that v1's **"did they enter today"** clause is already correct — lines 7-9 apply `AT TIME ZONE p.time_zone` on both sides — so two of v1's three day-resolutions are wrong here, not all three |
| 15 | The ten-day activity window is evaluated in the player's zone, not the server's | Phase 6 (`wt-ksh.7.20`) | The same function, seven lines down: `ds.date >= CURRENT_DATE - INTERVAL '10 days'` (`supabase/migrations/20250416172516_limit_daily_reminders.sql:24`) builds the floor from the **server's** date and compares it against a raw `timestamptz`, so both sides of the window land in UTC for a player in every zone. v2's `hasRecentActivity` derives the floor with `addDays(localDay, -10)` from the day resolved in the player's own zone and compares `puzzleDay` strings — the day the player was living in when the board was entered — so nothing is re-resolved on either side (`v2/convex/lib/reminders.ts:162-165`). Same planning-time measurement as row 14, and the same caveat: it was taken during planning, not re-run here. The effect is small and one-sided — a player dormant for close to ten days is dropped or reinstated a day early depending on the sign of their offset — but it is the difference between being reminded and not. Both edges are pinned: *"a score exactly ten days old still counts as recent activity"* and *"a score eleven days old is too old to count"* (`v2/convex/reminders.test.ts:277,286`) |
| 16 | `lastBoardEntryReminder` is written **before** delivery, not after | Phase 6 (`wt-ksh.7.26`) | v1 stamps it after the send and only if the send worked: `src/app/api/process-board-entry-reminder/route.ts` triggers Novu at lines 32-49, returns **500 without stamping** if that throws (line 47), and calls `update_last_board_entry_reminder` at line 52. v2's `sweep` patches the claim unconditionally, in the same transaction that decided eligibility, before anything is sent or scheduled. **This is not tidiness — it is the only thing between the majority of players and two emails a day.** Both bounds of the hour window are inclusive in v1 (`...20250416172516_limit_daily_reminders.sql:11-12`) and in the port (`isDueThisHour`, `v2/convex/lib/reminders.ts:130-136`), and the cron ticks at `minuteUTC: 0` (`v2/convex/crons.ts:22`) — so in any whole-hour-offset zone an on-the-hour reminder satisfies the **upper** bound on one tick and the **lower** bound on the next. Measured over 399 days: **7182 double-matches per zone**, which is exactly 18 reminder times × 399 days, in each of `America/Chicago`, `Australia/Sydney`, `Europe/London` and `Pacific/Honolulu` (28,728 across the four — the 7182 is **per zone**, not the total); **zero** in half-hour zones such as `Asia/Kolkata`; and **nobody was ever missed**, including across DST transitions. `alreadyRemindedToday` absorbs every one of those duplicates and can only do so if the stamp is already there. Pinned by *"a player matching twice in one day — the normal case, not an edge case — is reminded only once"* and by *"claims a player even when `sendEmail` reports every recipient was suppressed"* (`v2/convex/reminders.test.ts:329,345`). The one deliberate exception is hoisted **above** the per-player loop rather than being a conditional inside it: a missing `SITE_URL` throws before anybody is claimed, so the whole transaction rolls back and everyone matches again on the next tick (`v2/convex/reminders.ts:100-103`), pinned by *"a due player is not claimed when SITE_URL is unset"* (`reminders.test.ts:518`) |
| 17 | Web push actually delivers | Phase 6 (`wt-ksh.7.27`, `wt-ksh.7.28`, `wt-ksh.7.29`, `wt-ksh.7.30`) | **This is not "v2 fixed a bug" — v1 never built the feature**, and the audit must not go looking for a production behaviour to compare against. All four halves are missing, each verified against the v1 files in this repo: the subscribe route returns `{ message: 'Subscription successful' }` on its **first statement**, with every line that would have done something commented out beneath it (`src/app/api/subscribe/route.ts:5`); the button that posts to it passes the literal string `'YOUR_PUBLIC_VAPID_KEY'` as `applicationServerKey` (`src/components/push-subscribe-button.tsx:15`), which cannot produce a subscription in any browser; the Push switch is commented out of the reminders UI (`src/components/app-bar/board-entry-reminders.tsx:121-134`), so the setting is unreachable; and only the **email** workflow was ever registered with Novu — `serve({ workflows: [BoardEntryReminderEmailWorkflow] })` (`src/app/api/novu/route.ts:5`). So a production player holding `reminder_delivery_methods: ['push']` — and copied rows carry that value — is silently notified by no channel at all. v2 stores real subscriptions (`v2/convex/push.ts`), signs and encrypts through `web-push` under `'use node'` (`v2/convex/pushSend.ts`), schedules one delivery per push-eligible player from the same sweep, and prunes an endpoint on 404/410. Established on beta **before** anything was built on it, by spike S2 (`wt-ksh.7.27`) against `fabulous-goldfish-949`: `{ ok: true, stage: "sent", statusCode: 201, env: { hasBuffer: true, … } }`. `hasBuffer` is `false` on Convex's default runtime, so the `'use node'` directive is load-bearing rather than precautionary |
| 18 | Navigations are never cached, and there is one static offline page | Phase 6 (`wt-ksh.7.30`, `wordle-teams-bpt`) | v1 hands serwist's `defaultCache` straight to `runtimeCaching` (`src/app/sw.ts:20`). That array's HTML rule matches on **`request.headers.get('Content-Type')`** — the *request's* content type, which a navigation `GET` has no body to set — so the rule is dead code and its `pages` cache is permanently empty. Every same-origin document falls through instead to the catch-all (`sameOrigin && !pathname.startsWith('/api/')`), handled by `NetworkFirst` into a cache named `others` with `maxEntries: 32`. The consequence is not theoretical: **one user's rendered `/me` dashboard sits in Cache Storage for up to 24 hours**, and on a shared device an offline load can serve it to the next person after sign-out — v1's sign-out path has no cache teardown. v2 registers a `NavigationRoute` wrapping `NetworkOnly` (`v2/src/sw.ts:172-174`), a strategy with no `cachePut` path at all, so a document cannot reach Cache Storage even in principle; its `handlerDidError` serves a precached, self-contained `v2/public/offline.html` resolved through `matchPrecache`, because the precache key is revisioned and a plain `caches.match('/offline.html')` would miss at exactly the moment nobody is watching. The precache glob is narrowed to `['assets/**/*.{js,css}', 'offline.html']` (`v2/scripts/build-sw.mjs:269`), so a future prerendered document cannot silently start being cached either. Verified in a real Chromium against beta on 2026-08-29: `caches.keys()` returned only `["workbox-precache-v2-https://beta.wordleteams.com/"]`, Cache Storage held no `text/html` entry other than the offline page, and exactly one service worker was registered at scope `https://beta.wordleteams.com/`. **v1 is still affected in production and is not being fixed there** — v2's worker is the kill switch: its `activate` deletes every cache it does not own, including `serwist-precache-v2-*`, `others` and `pages-*`, unit-tested against serwist 9.2.1's real cache names in `v2/src/lib/sw-caches.test.ts` |
| 19 | The app bar wordmark and "Home" link point at `/`, where v1's points at `/home` — and a signed-in user can no longer reach the marketing page from the chrome | Phase 7 Task 4 | v1's app bar links its wordmark to the MARKETING page, `<Link href='/home'>` (`src/components/app-bar/app-bar-base.tsx:73`). v2 keeps that intent and changes the spelling: both the wordmark and the "Home" link point at `/` (`v2/src/components/Header.tsx:204,235`). The reason is canonicalisation — `/` and `/home` render the identical `Landing`, v1's `src/app/sitemap.ts` puts `/` at priority 1 and `/home` at 0.9, and linking internally to the duplicate advertises the non-canonical copy of a page we serve twice. **The behavioural delta the Header's own comment misses, and the reason this row exists:** `welcomePaths` (`src/lib/supabase/middleware.ts:7`) is exactly `['/', '/login']`, so in v1 a signed-in user who clicks the wordmark lands on `/home`, which is **not** in that list, and **sees the marketing page**. In v2 the same click hits `/`, whose `beforeLoad` bounces them to `/app` (`v2/src/routes/index.tsx:54`). Each decision is individually right — `/` is the canonical spelling; `/` must bounce a relaunching iOS PWA — but their interaction removes a surface: **a signed-in v2 user cannot reach the marketing page from the chrome at all.** `/home` still serves it to anyone holding the URL, and nothing in the app links there. Pinned by *"the app bar wordmark and Home link both point at the landing"*, *"a signed-in visitor to / is bounced to /app"* and *"a signed-in visitor to /home stays on /home"* (`v2/e2e/routes.spec.ts`), plus the gate-level twin in `v2/src/components/Header.hook.test.ts` — CI runs no e2e. **That twin was written by `wt-ksh.8.49` on 2026-09-02, and this row previously named `v2/src/routes.test.ts`, which never guarded it:** that file pins `/` and `/home`'s ROUTE behaviour (their `beforeLoad`) and does not read `Header.tsx`'s links at all, so until the twin landed the wordmark could be repointed at `/home` and all four gates would pass. The twin renders the bar and asserts the anchors EXHAUSTIVELY (`['/', '/', '/about']`, so an added link is a change too), and reads the source for the `activeProps` the `Link` mock necessarily drops. Four mutations — repointing either link, deleting `activeProps`, renaming the active class — all fail it |
| 20 | The hero highlight's foreground is theme-invariant, and its contrast differs from v1's in **both** directions | Phase 7 Task 4 | v1 wraps "ultimate app for Wordle enthusiasts" in `text-black dark:text-white` (`src/components/home/title.tsx:23`) over `from-green-600 via-green-600 to-yellow-400 dark:to-yellow-500` (`src/components/ui/aceternity/hero-highlight.tsx:79`). Recomputed for this row: light `#000000` is **6.37:1** on the green end and 13.71:1 on the yellow; dark `#ffffff` is **3.30:1** on green and **1.92:1** on yellow — v1's dark highlight fails AA at both ends and is effectively invisible at one. v2 uses `--warning-foreground` `#111113` in **both** themes over `from-brand-from via-brand-from to-warning` (`v2/src/components/home/title.tsx:81`), where `--warning` is `#facc15` light / `#eab308` dark, i.e. **v1's exact pair of yellows**: **5.72:1** on the green end in both themes, 12.32:1 light / 9.83:1 dark on the yellow. Luminance rises monotonically green → yellow, so those two ends bound the whole band. **Light mode is a small regression, 6.37 → 5.72**, because `#111113` is not `#000000`; dark goes **1.92 → 5.72**. The regression is recorded rather than buried — it is a change to a case that already passed, and the trade is only defensible because of what it buys in dark. The gradient END was itself corrected by this task's review: it shipped as `to-brand-to`, which is `#facc15` in both themes and therefore made v2's dark highlight *brighter* than production's — an undocumented divergence created by the token choice whose stated purpose was avoiding one. Pinned in `v2/src/styles.test.ts` |
| 21 | The feature-card icons are the accent green, not the heading grey | Phase 7 Task 4 | v1 paints all six icons the same `text-gray-50` as the heading, because they sit on a hardcoded near-black slab (`bg-secondary-foreground dark:bg-secondary`) where only two values exist. v2's band is `--surface-sunken`, a neutral one step off `--background`, so `tokens.json`'s third rule applies instead — "one accent per surface. Green earns attention" — and the icons are `--accent-solid` (`v2/src/components/home/feature-cards.tsx:94`; the file calls this out as "A DELIBERATE DEPARTURE FROM v1" in its own header). 4.56:1 light and 7.48:1 dark on that band, against the 3:1 non-text bar. **The band itself also diverges from the bundle**, which is worth the audit knowing: `MIGRATION.md:43` prescribes `--surface-inverse` for this exact file, and v2 does not use it — there is no inverse *text* token, so the quieter paragraph would have no rank to sit at, and `--surface-inverse` flips by theme (`#18181b` light, `#fafafa` dark), so it would replace v1's dark slab with a **white** one in dark mode rather than porting it. `--surface-inverse` consequently has no consumer in `v2/src` at all |
| 22 | The two legal pages open with a `Legal` kicker, which v1 has nothing corresponding to | Phase 7 Task 5 | **It is the one visible string on either page that is not ported prose.** v1's `src/app/privacy/page.tsx` and `src/app/terms/page.tsx` open straight on the title; v2 sets `<p className="island-kicker mb-2" aria-hidden="true">Legal</p>` inside the island above it (`v2/src/routes/privacy.tsx:58`, `v2/src/routes/terms.tsx:50`), which is the kicker treatment the rest of v2's islands already use, so a route-by-route comparison meets one extra line of copy on each page. It is `aria-hidden`, added by this task's review: the kicker sits INSIDE the `<article>`, so without it a screen reader announces "Legal" before the document's own title, and the `h1` directly beneath already names which legal document this is. Hidden rather than hoisted out of the `<article>`, which would have moved it off the island and made the visual divergence larger than the one being recorded here. The line is still in the prose fixtures (`v2/src/legal-prose.privacy.txt:1`), so removing it is a diff rather than a silent deletion |
| 23 | The legal pages' title is an `h1` at 36/48px where v1's is an `h3` at 20px, and every section heading is an `h2` where v1's is an `h4` | Phase 7 Task 5 | **Not only an a11y-tree change — a route-by-route visual comparison WILL hit it**, which is why it is a row rather than an implementation detail. v1 starts at `h3` `text-xl` (20px) for the page title (`src/app/privacy/page.tsx:10`, `src/app/terms/page.tsx:10`), skips to `h4` `text-lg` for the section headings, and has **no page-level `h1` at all** — the only `h1` on a v1 page is the app-bar wordmark (`src/components/app-bar/app-bar-base.tsx:74`). v2's title is an `h1` at `text-4xl sm:text-5xl` (36/48px) (`v2/src/routes/privacy.tsx:61`, `v2/src/routes/terms.tsx:53`) and its sections are `h2`. It is right because it is the consistent completion of a decision **Task 4** already made and documented: v2's `Header.tsx` deliberately makes the wordmark a `Link` and not a heading, on the grounds that v1's `h1` "describes the site rather than the page" (`v2/src/components/Header.tsx:25-26`). With the wordmark's `h1` gone, a legal page that kept v1's levels would have no `h1` on it at all and would start its outline at level 3. Pinned by *"/privacy renders the Privacy Policy as its h1"* and its `/terms` twin (`v2/e2e/routes.spec.ts:284,292`) — and, since CI runs no e2e, by the heading LEVEL recorded against every line of both prose fixtures (`v2/src/legal-prose.test.ts`), so a demotion back to v1's levels is a fixture diff |
| 24 | The footer prints one merged copyright row where v1 prints a bare name | Phase 7 Task 5 | v1's bottom row is `<span>Wordle Teams</span>` opposite the two legal links — no year, no © (`src/components/home/footer.tsx:23`). v2's footer already carried `© {year} Wordle Teams` on a line of its own before Task 5 put the legal links back, so restoring v1's layout (identity left, legal right) meant either printing the name twice or merging the two rows; it merges (`v2/src/components/Footer.tsx:54`). Recorded in that file's own header, but **the audit reads this table**, which is why it is also here. One thing the row makes visible is older than this task and not introduced by it: v1 imports its footer only from `src/components/home/home.tsx:6`, so in v1 the legal pages and the app have **no footer at all**, while v2 renders it under every route from `__root.tsx` |
| 25 | The four community screenshots are a **static two-column grid** where v1 runs them through an auto-scrolling aceternity carousel | Phase 7 Task 9 (`wt-ksh.8.32`) | **The biggest thing a route-by-route visual comparison will hit on this page, and the audit must not read it as a missing feature.** v1 passes its Feedback, Changelog, X and GitHub shots to `InfiniteMovingCards` (`src/components/about.tsx:105`), imported relatively from `./ui/aceternity/infinite-moving-cards`. `wt-ksh.12.5` ruled that whole dependency family out and Phase 7 Task 4 already dropped its siblings — `HeroHighlight`, `BorderBeam` and `framer-motion` — for the same reason, so carrying the carousel would have reinstated exactly what Task 4 removed. v2 renders the same four images, in the same order, with the same alt text, in `grid-cols-1 sm:grid-cols-2` (`v2/src/routes/about.tsx:218`), which is all the four were ever doing: sitting next to each other so a reader can see that those are real places. It is also strictly better on one axis — a marquee moves under a reader trying to look at it, and v1's has no `prefers-reduced-motion` path. Pinned from **both** ends, and deliberately not by a substring search for `aceternity`: the /about import list is asserted as a bounded, ordered array of exactly `['@tanstack/react-router', '#/lib/seo']`, and `package.json` is asserted to carry no `aceternity`, `framer-motion` or `motion` dependency (`v2/src/about-screenshots.test.ts`). The extractor behind the first of those is itself pinned over hand-written source strings — including the relative-specifier case, which is the shape this row's guarantee actually depends on |
| 26 | Every annotated row puts its **text before its image in the DOM**, where v1 leads with the image on two of the four | Phase 7 Task 9 (`wt-ksh.8.32`) | v1 alternates its zig-zag with `flex-col-reverse` (`src/components/about.tsx:43,68`), which reverses the *document* order to move the image, so on rows 2 and 4 a screenshot precedes the sentence that captions it — a **WCAG 1.3.2 meaningful-sequence** problem for a screen reader and for anyone reading with CSS off. v2 alternates with `md:flex-row-reverse` instead (`v2/src/routes/about.tsx:148,160`), which is a purely visual reversal: text is first in the DOM on all four rows and **the rendered desktop layout is identical to v1's**, same shot on the same side. Both halves are asserted, the second because it is what makes the divergence layout-neutral and it is one class edit from being false — replacing every `md:flex-row-reverse` with `md:flex-row` stacks all four rows the same way, a layout v1 does not have, and nothing else in the suite would notice (*“the four annotated rows alternate sides on desktop, as v1's do”*, `v2/src/about-screenshots.test.ts`) |
| 27 | The screenshots are **not tilted**; v1 rotates all four | Phase 7 Task 9 (`wt-ksh.8.32`) | v1 puts a `md:` rotate utility on every annotated shot — three degrees on the odd rows, minus six on the even ones (`src/components/about.tsx:40,48,65,73`). A rotated element still reserves its **unrotated** box, so a tilted screenshot and its outline overhang a column the layout has made no room for; correcting that is per-breakpoint hand-tuning for an effect nothing else in v2 uses. Visible in a side-by-side comparison, which is why it is a row. There is a second-order note worth keeping with it: naming those utilities in a **comment** is enough to ship them, because Tailwind v4 scans source text including comments — `v2/src/routes/about.tsx`'s explanation of why the tilts were dropped put both rotate rules, and v1's raw green outline rule, into `dist/client/assets/styles-*.css` with no element in the app carrying any of them. The comment is now spelled around them |
| 28 | The create-team sentence drops v1's **“(button below)”** parenthetical | Phase 7 Task 9 (`wt-ksh.8.32`) | The one wording change in an otherwise verbatim prose port, and **it is not a loss**, which is the part the audit needs. v1's `/about` is behind a session — `src/app/about/page.tsx:38` redirects an anonymous visitor to `/login` — and the page passes in an `actionButton` that reads **“Go to Dashboard”**, so v1's own parenthetical does not describe a create-team control either; it points at a button that goes somewhere else. v2's `/about` is public and edge-cacheable (`STATIC_DOCUMENTS`, `v2/src/lib/cache-policy.ts`) and has no action button at all, so the phrase would point at nothing. v1's `title` and `actionButton` props are unported for the same reason. Given its own test rather than a line of the prose array, so that “restoring” it cannot look like fixing a typo (*“the create-team sentence does not promise a button this page has not got”*, `v2/src/about-screenshots.test.ts`) |
| 29 | The green screenshot outline is **2px where v1's is 4px** | Phase 7 Task 9 (`wt-ksh.8.32`) | Recorded because it was documented nowhere: `v2/src/routes/about.tsx` explained the *colour* change — `outline-accent-solid` instead of v1's raw `outline-green-` palette utility, since a raw palette colour outside `v2/src/styles.css` is a missing token — and said nothing about the width. **It is not the frame shrinking with the image.** v2 draws these at v1's own rendered widths: v1's board shot is `height={400}`, which at 518×708 is 293px wide, and that is v2's `max-w-[293px]`; v1's other three carry no height and render at their intrinsic widths, which are v2's other three max-widths. At the same drawn size a 4px green rule would be the heaviest border anywhere in v2 — every other framed surface on the page, the four community shots directly beneath included, is a 1px `border-line-subtle`. A deliberate halving, and the only difference on this page that is purely a matter of taste |
| 30 | The footer's **“Source Code” link points at a repository that exists**, where v1's 404s | Phase 7 Task 9 review (`wordle-teams-xmk`) | v1's `src/components/home/footer.tsx` links `github.com/cdub615/wordleteams`, which returns **404**; the repository is `cdub615/wordle-teams`, which returns **200** — both measured 2026-09-01, and the working spelling is the one v1's *own* About page uses (`src/components/about.tsx`). So v1 has shipped a dead Source Code link for the life of the project and v2 ported it faithfully. Fixed in `v2/src/components/Footer.tsx`, which makes it a divergence from production. It mattered more in v2 than in v1 before the fix: v1 imports its footer only from the home component, so the dead link sat on one page, while v2's `__root.tsx` renders it under **every** route (`wt-ksh.8.50`). **The deliverable was the coverage, not the character.** `src/routes.test.ts`'s footer test was exhaustive over `<Link to=` and structurally blind to all five `<a href>` links — the class the defect was in — so a one-character error survived a parity phase inside a file that had a test. It now pins both sets of label/target pairs and asserts the opening-tag counts, so a link the pattern cannot read is a failure rather than an absence |
| 31 | The Team Boards carousel is **native CSS scroll-snap**, not embla | Phase 7 Task 10 (`wordle-teams-ry1`) | v1 wraps the panel in shadcn's `Carousel` (`src/components/app-grid-items/team-boards.tsx:137`), which is a wrapper around `embla-carousel-react`. v2 has neither: `v2/src/components/ui/` holds nineteen components and no `carousel`, and `package.json` carries no `embla`. **The two things v1's carousel actually does are the snap and `opts={{ loop: true }}`**, and both are a handful of lines here — `overflow-x-auto snap-x snap-mandatory` with one `basis-full` slide per member, plus `wrapSlide` in `v2/src/components/teams/team-boards-model.ts`. Adding the dependency would have reinstated exactly the shape Task 4 removed when it dropped aceternity, magicui and framer-motion, and that row 25 above removed from /about on the same argument. Touch and trackpad swiping and their momentum then come from the browser's own overflow scrolling rather than from a library's pointer handling. **Visually near-identical; the differences an audit can see are that the arrows are chevrons in a rounded 32px button rather than embla's circles, and that they are hidden entirely on a one-member team** (v1 renders them and they scroll to the slide already on screen). Pinned at both levels: `wrapSlide` directly, and the wiring by a jsdom test that stubs `offsetLeft` so the slide the arrows TARGET is observable — with real jsdom zeroes a wrap and a step are the same call and neither could fail (`v2/src/components/teams/team-boards.hook.test.ts`) |
| 32 | Day navigation is **bounded to the month being viewed** | Phase 7 Task 10 (`wordle-teams-ry1`) | v1 held every team's every score in a client context, so stepping back off the 1st landed in the previous month with data already loaded. `scores.getTeamMonth` is scoped to one team and one month **on purpose** — see its doc comment, and `wordle-teams-dcu` on database bandwidth being the binding free-tier limit — so a day outside the month would render "no board for player" for every member, which reads as data loss rather than as a boundary. The panel therefore treats the month's playable, non-future days as the whole navigable set: Previous is disabled on the first of them, Next on the last (**in the current month the last IS today, which is precisely where v1 disables Next**, so the two agree wherever v1 was right). The date picker is bounded the same way, through new optional `minDay`/`maxDay` props on `v2/src/components/date-picker.tsx` that default to the old behaviour so board entry is unchanged. **The audit will see this on a PAST month only**: v1 lets you walk forward out of, say, June into July; v2 stops at 30 June |
| 33 | The panel's default day is **weekend-filtered**, where v1's is not | Phase 7 Task 10 (`wordle-teams-ry1`) | v1's `getDate()` returns `new Date()` whenever the viewed month is the current one, with no regard for `playWeekends` — so a team that does not play weekends, opening the dashboard on a Saturday, gets Saturday selected in a date picker that renders Saturdays disabled, and a row of empty boards. It is the same defect the Phase 2 quality review found in board entry and fixed by extracting `pick-default-day.ts` (`wt-ksh.3.10`); this is that fix reaching the second place it applies. v2 lands on the last playable day at or before today — the Friday, in that example. **Only visible to a `playWeekends: false` team at a weekend**, and it is a fix, not a loss |
| 34 | A concealed slide **carries no letters at all**, where v1 hands the answer to a hidden element | Phase 7 Task 10 (`wordle-teams-ry1`) | Both apps withhold today's boards until the viewer has entered their own, and both do it in the browser. v1 keeps the real `answer` and `guesses` on the board object and decides in the JSX (`hide || !b.exists`), so the letters sit one careless edit away from being painted. `teamBoardsView` blanks them instead, so "there is a message" and "there is nothing to draw" cannot drift apart. **This is a render-path guardrail and NOT a confidentiality boundary — it must not be described as one in the audit**: `scores.getTeamMonth` returns the whole month to every member, so the day's answers are already in the browser either way. Withholding them server-side would mean the server resolving the viewer's "today", which is the very thing `puzzleDay` exists to stop it doing, and the same query feeds the scores table, which needs every day |
| 35 | The celebration dialog **names the winner**; v1 names whoever is reading it | Phase 7 Task 11 (`wordle-teams-k7w`) | **A FIXED DEFECT, NOT A PORTED BEHAVIOUR, and the only row in this table that describes v1 telling a user something untrue.** `src/app/me/monthly-winner-celebration.tsx:81,87` reads the winner id off `monthly_winners` and then renders `{user.firstName} {user.lastName}` — where `user` comes from the teams context and is the **current viewer**. So on every team where you did not win, v1's title says *"&lt;your own name&gt; won!"* and the body underneath says *"&lt;your own name&gt; won last month for &lt;team&gt;. Better luck next time!"* — the two halves contradicting each other in one dialog. Nobody decided this; there is no data or UI that depends on it. v2's `winners.getLastMonthWinner` returns the winner's own first and last name, and **the viewer's name is not in scope where the copy is built** — `src/lib/celebration.ts` is handed an id and nothing else, and only to compare — so the substitution v1 makes cannot be written in the module that writes the strings. **Fixed and pinned, not impossible:** one layer down, `convex/winners.ts`'s `ctx.db.get(row.playerId)` → `ctx.db.get(playerId)` reintroduces exactly v1's bug with no type error, which is why the whole strings are pinned in `celebration.test.ts` and `monthly-winner-celebration.hook.test.ts` and the winner's identity is pinned against a non-winning caller in `winners.test.ts` |
| 36 | The confetti is **CSS keyframes**, not `react-confetti-explosion` | Phase 7 Task 11 (`wordle-teams-k7w`) | v1's dependency is not in v2 and was not added, for the reason rows 20, 25 and 31 give three times over — aceternity, magicui, framer-motion and embla all came out of this port on the same reasoning, and this is the smallest of the four: 24 absolutely-positioned rectangles, one `@keyframes confetti-fall` in `styles.css`, and every per-piece value (column, drift, spin, delay, duration) derived from its index in `monthly-winner-celebration.tsx`. **Deterministic rather than random**, so the burst is identical on every run and a test can assert the set rather than only its size |
| 37 | The confetti **respects `prefers-reduced-motion`**; v1 animates regardless | Phase 7 Task 11 (`wordle-teams-k7w`) | `react-confetti-explosion` has no reduced-motion behaviour, so v1 throws paper at a viewer who has asked the operating system for less of it. v2 renders **no pieces at all** — the whole content of the element is motion, so a static pile of paper stuck to the top of the dialog is not the smaller version of it — while the title and the message, which are the actual content, are untouched. Asked in JavaScript via `matchMedia` rather than in a `@media` block, deliberately: **there is no CSSOM under vitest**, so a media query in `styles.css` would be a rule no gate this repo runs could observe (`wt-ksh.8.49`) |
| 38 | Dismissing the dialog **appends to `hasSeenCelebration` inside the mutation**, where v1 writes the whole array from the browser | Phase 7 Task 11 (`wordle-teams-k7w`) | The read half of row 3, and a different failure from it. v1 SELECTs the array, pushes its own id onto the copy it holds, and UPDATEs the whole column back (`src/app/me/monthly-winner-celebration.tsx:53-60`), so two members dismissing at the same time each write an array built from the value they read before the other wrote — the second write silently drops the first, and the dropped member is shown the celebration again. `wordle-teams-069` is the open issue for that pattern elsewhere in this codebase. v2's `markCelebrationSeen` reads and appends in one serializable transaction and the client sends **no array at all**, so it cannot lose a write and cannot forge one either |

| 39 | The header's **Billing entry is shown to every signed-in player**, where v1 shows it only to someone who has ever subscribed | Phase 7 Task 12 review (`wordle-teams-6tp`) | v1's `src/components/app-bar/user-dropdown.tsx:55-59` computes `hasBillingAccount = ['pro', 'cancelled', 'expired'].includes(user.memberStatus)` and renders the Billing entry behind it (`:168`), so a player who has NEVER subscribed — `'new'` or `'free'` — is not offered the customer portal at all. **v2 has no equivalent to that predicate.** `api.teams.amIPro` is a boolean and `convex/access.ts`'s `isProFor` answers `membershipStatus === 'pro'`; "has a Polar customer record" is a different question, and answering it would mean a second Convex query, a second subscription on every page of the app, and a new server-side read, added in a parity phase purely to hide a button. **The alternative that was actually tried is the one this row replaces, and it was worse:** Task 12 first gated Billing on `isPro === true`, which is neither v1's rule nor a widening but a NARROWING — it took the portal away from every lapsed subscriber ('cancelled' and 'expired' are in `convex/schema.ts`, `convex/lib/polarEvents.ts` maps `subscription.revoked` to 'expired', and `convex/migrate.ts` copies both out of Supabase, so real players arrive in those states at cutover) and `src/components/app-menu.tsx` holds the only `getCustomerPortalUrl` call site in v2 (it was `src/components/Header.tsx` until `wordle-teams-lyab` moved Billing into the menu — see row 44). So the widening is deliberate: the never-subscribed player who presses it gets `PortalResult`'s `no-customer` branch, which exists for exactly this reader and answers with an **info** toast — "You do not have a billing account yet." — not an error. **What the audit will see:** a `'new'` or `'free'` account showing a Billing button v1's dropdown does not show, and an Upgrade button beside it rather than instead of it. The second half is v1's own behaviour for a lapsed player (`:168` and `:175` are both true for 'cancelled' and 'expired'), which v1's source comments on directly |
| 40 | The dashboard lives at **`/app`**, where v1's is `/me`, and `/` is now the marketing landing for anonymous visitors | Phase 7 Task 1 | The owner's decision, and the structural change the whole of Phase 7 is arranged around: v1 serves the dashboard from `/me` and the marketing page from `/home`, with `/` redirecting; v2 serves marketing from `/` and `/home` and the dashboard from `/app`. **`/me` did not go away and must not**, because `src/app/manifest.json:30` sets `"start_url": "/me"` and an installed iOS PWA does not adopt a new `start_url` from a re-fetched manifest — every production user who installed the app has that path burned in, and at cutover the domain flips beneath them. `v2/src/routes/me.tsx` therefore redirects `/me` to `/app` **carrying the query string**, because v1's `src/lib/polar/checkout.ts` sets `successUrl: ${appOrigin()}/me?checkout=success` and a checkout in flight across the cutover comes back to `/me` holding the marker `src/lib/checkout-return.ts` reads. Measured against beta 2026-09-01, that hop answers **307**, not a permanent redirect — the route file and this phase's prose both call it permanent, which is `wordle-teams-cog5`, a wording-versus-wire question rather than a defect. **Four consumers moved with it**, all verified 2026-09-01: `v2/public/manifest.json:30` (`start_url`), `v2/convex/polar.ts:432` (`successUrl`) and `:654` (`returnUrl`), `v2/convex/pushSend.ts:95` (the push notification's `url`), and `v2/convex/reminderEmails.ts:139-140,196` (the CTA in both halves of the mail). `v2/src/routes.test.ts` pins the redirect's existence and its target, because all four CI gates stayed green when `me.tsx` was deleted and only e2e noticed |
| 41 | The copy **omits reminder settings until cutover**, so beta differs from production on `reminderDeliveryMethods` and `timeZone` | Phase 7 Task 15 (`wt-ksh.7.32`) | **An expected difference the audit must not report as a defect, and the only row here that describes data rather than behaviour.** The owner's decision is that reminder settings arrive at cutover, not before, so a Phase 7 re-copy cannot switch reminders on for someone who does not know this beta exists and who already receives real reminders from v1. `v2/scripts/lib/copy-reminder-policy.mjs` withholds the two fields that together decide eligibility — `reminderDeliveryMethods`, which is what turns reminders on, and `timeZone`, without which `convex/reminders.ts` skips a player entirely. **The other three of the five still cross, and one of them is the point:** `lastBoardEntryReminder` is copied forward because it *suppresses* a same-day send, so withholding it with the rest would be the single change that makes an unwanted reminder more likely; `reminderDeliveryTime` and `hasPwa` are inert without the first two. `reminderDeliveryMethods` is sent as an explicit empty array rather than an omitted key, because `upsertPlayers` patches and an omitted key would leave whatever an earlier copy already wrote. **The runbook line that restores it:** the cutover copy runs `scripts/copy-from-supabase.mjs --with-reminders`, and that one flag is the whole restoration (`wt-ksh.8.43`). Pinned by ten tests in `copy-reminder-policy.test.mjs`, including the cutover path, so a broken restoration is a failing test rather than a silent no-op |
| 42 | **`/branding` is dropped, with no v2 equivalent** | Phase 7 Task 16 | The owner's decision, 2026-08-31, and recorded here rather than omitted so that a route-by-route comparison meets a written answer instead of a gap. v1's `src/app/branding/page.tsx` is 62 lines of press-kit images. **It was never a public page:** v1's own `src/app/robots.ts:8` disallows it — `['/me/', '/branding', '/complete-profile', '/novu', '/api']` — and measured against production 2026-09-01 it answers **307 to `/login`**, so an anonymous visitor and every crawler that honours robots.txt have always been turned away. `scripts/parity-routes.mjs` carries it in the route list flagged `expectAbsentOnBeta`, which downgrades a *confirmed* absence to `expected` and deliberately does nothing if beta ever starts serving it |
| 43 | `/about` sets its **own title**, where production serves the site-wide one | Phase 7 Task 16 (`wordle-teams-woe0`) | Measured by `scripts/parity-routes.mjs` on 2026-09-01, and it is v2 being **better**, which is why it is a row rather than a bug: production titles `/about` `"Wordle Teams: The ultimate app for Wordle enthusiasts"` — the root title, because the route renders dynamically and never sets one of its own — while beta serves `"About - Wordle Teams"`. The audit will see a title mismatch on that route and must read it in this direction. Worth knowing how it was nearly missed: production streams its metadata into the **body** on dynamically-rendered routes (`/about` closes `</head>` at byte 2960 and emits its `<title>` at 9787), so a head-bounded reader reports prod's `/`, `/about` and `/login` as having no title and no OpenGraph tags at all — which reads as beta having invented twelve tags production never had. The harness bounds on foreign content and serialized text instead |

| 44 | The app bar holds **a wordmark, an Upgrade CTA and one menu**; v1's holds a nav row, a billing entry, a theme control and a ringed avatar | `wordle-teams-lyab` (Phase 7 UI/UX polish) | **The owner's decision, from two phone screenshots, and the largest chrome divergence in this table.** v2's bar had accumulated seven occupants — wordmark, Home/About links, Billing, Upgrade, avatar, hamburger, an "Auto" theme pill — and at 390px the nav wrapped onto a second line beneath the rest. Four of them moved into the account menu: **Home**, **About**, **Billing** and **Theme**, the last as a Light/Dark/System submenu (v1's shape, `user-dropdown.tsx:143-166`) replacing the one-button cycle, whose label showed the current mode and said nothing about what the next click would do. **Upgrade deliberately stayed in the bar** — `wordle-teams-456` measures 87% of production signups never entering a board, and the only always-reachable route to checkout is not something to put behind a hamburger — as did the pending-invite badge, which is not a control. **Two things the audit will see that are NOT regressions.** First, the menu now renders **for a signed-out visitor**, which its predecessor (`settings/user-menu.tsx`, mounted inside Header's `isAuthenticated &&`) never did: the nav and the theme control live inside it, so gating the mount would leave `/login` and `/about` with no navigation in the chrome at all. It holds Home, About, Theme and Log in there, and its three Convex queries are `'skip'`ped rather than `enabled: false` for the reason `Header.tsx` records. Second, **the `nav-link` class and its animated underline are gone from `styles.css`** — a dropdown item has no underline to animate, and nothing else used the class; the two `is-active` e2e assertions that guarded TanStack's fuzzy active-matching went with it, replaced by assertions on the menu's destinations and on its opening without a session. **And one parity GAP closed rather than opened: v2 had no sign-out anywhere in `src/`.** v1's dropdown has always had Log out; nothing in v2 called `signOut` at all. It clears `selectedTeam` and the react-query cache but **deliberately not** `theme`, where v1 ran a blanket `localStorage.clear()` — the two keys are not the same kind of thing, and wiping the second silently resets a device preference on every sign-out |

| 45 | The avatar's **rotating brand ring is back, and is decoration rather than the menu trigger** | `wordle-teams-x3m9` (Phase 7 UI/UX polish) | **Both halves are deliberate, and they pull in opposite directions from v1.** v1's `src/components/app-bar/user-dropdown.tsx:117-123` makes the ringed avatar ITSELF the dropdown trigger, ringed by `animate-spin-super-slow` (`spin 5s linear infinite`, `tailwind.config.ts:100`) to draw the eye at it — and by the owner's own account that failed: an animated halo reads as a badge, not a control, and users were not finding the menu. Phase 6 split the two, demoting the avatar to decoration beside a real hamburger button, and **dropped the ring with it**. This restores the ring WITHOUT restoring the click target: the avatar has no `role`, no handler and no `cursor-pointer`, and `app-menu.hook.test.ts` pins the bar at exactly one button so a future change cannot quietly hand the trigger back. **Two divergences inside the port.** The gradient uses `--brand-from/via/to` rather than v1's hardcoded `from-green-600 via-green-500 to-yellow-400` plus its `dark:` restatement of the same three stops — the tokens already fork by theme, so one definition replaces two, which is rule 1 in `styles.css` ("a raw green-600 in a component is a missing token"). And the ring **does not rotate under `prefers-reduced-motion`**, which v1 animates regardless; the ring itself STAYS, unlike row 37's confetti, because a gradient ring is a visual that happens to turn rather than an element whose whole content is motion. Asked in JS via `lib/use-reduced-motion.ts` rather than a `@media` block, for row 37's reason — no CSSOM under vitest — but as a **hook** rather than `ConfettiBurst`'s bare render-time `matchMedia` call, because the app bar server-renders and `window` does not exist there. **One fix rides along:** `wordle-teams-lyab` made the menu render for signed-out visitors and the avatar came with it, so `/login` and `/about` were showing a stranger an empty grey circle with a generic person icon (`initialsFor` answers null with no name and no email). The avatar is now gated on a session |

| 46 | The calendar's **day cells are 44px on a phone**, where v1's are react-day-picker's default | `wordle-teams-5p9` (Phase 7 UI/UX polish) | **Deliberately bigger than v1, and the fix underneath it was not a sizing change at all.** `ui/calendar.tsx` is stock shadcn written for Tailwind 3, where an arbitrary value holding a bare custom property resolved as `var(...)`; Tailwind 4 (this project is on 4.1.18) does not, so **ten utilities compiled to invalid declarations that every browser dropped** — measured in the shipped CSS, which contained `width:--cell-size` and **zero** occurrences of `var(--cell-size)`. The variable was defined and never read. So the cells were not 32px as `wordle-teams-5p9` originally recorded; they had no size at all and collapsed to their content, `month_caption` lost the horizontal padding that keeps the nav chevrons off the month label (they painted ON TOP of it), and the weekday cells were too narrow for "Mo" and "We", which wrapped onto a second line. With the spelling corrected, `--cell-size` is **2.75rem below `sm`** (44px — WCAG 2.5.5 Enhanced and Apple's HIG minimum) and **2.5rem above** (40px — `DESIGN_SYSTEM.md` section 7's default button height), and the trigger label is `text-sm` at every width rather than `text-xs` on the phone that has least room to read it. **v1 has the identical v3-era markup but is ON Tailwind 3, so its sizing works and its cells are the stock ~32px** — the audit will see v2's calendar as materially larger, and that is this row. **One trap recorded for whoever edits that file next:** Tailwind 4 scans raw file text including comments, so writing the broken utility as a literal in a code comment REGENERATES the dead rule — that happened while fixing this, putting `height:--cell-size` back into the compiled CSS from the comment explaining why it must not be there. `ui/calendar.tsx` and `date-picker.hook.test.ts` both describe the pattern in prose instead of quoting it |

| 47 | The billing portal **creates a Polar customer on demand**, so a comped or never-subscribed player reaches it; v1 offers them no portal at all | `wordle-teams-kzfi` (Phase 7 UI/UX polish) | **The other end of row 39, and the thing that makes that widening honest.** Row 39 records v2 showing Billing to every signed-in player where v1 gates it on `hasBillingAccount`. That was defensible while the never-subscribed reader got `PortalResult`'s `no-customer` branch — an info toast, "You do not have a billing account yet." — but the owner's own account is in exactly that state and it is not a satisfying answer: he is comped (`migrate.ts` carried a `membershipStatus` of 'pro' out of Supabase), so he never went through checkout, so Polar holds no customer with a matching `externalCustomerId`, so the only `getCustomerPortalUrl` call site in v2 was a cul-de-sac by design. Now an exhausted `no-customer` sweep creates the customer keyed to the **Convex id** — the identity `externalIdsFor` puts first, so the next visit resolves on the fast path with no fallback and no repair — and opens the portal against it. **THE GUARD IS THE LOAD-BEARING PART, and it is inside `ensurePortal` rather than at the call site for a measured reason:** only an exhausted `no-customer` sweep may create. A 500 or a rejected credential stops, because `lookupPortal`'s doc comment is explicit that turning an outage into "you have no subscription" is the lie the multi-way result exists to prevent — and creating a customer in response to one would be that lie **plus a write at the vendor**. Written first as an `if` around the call, deleting it left all 50 tests in `polar.test.ts` green, because the action's body is unreachable to convex-test (no Better Auth session — `wordle-teams-obw`); moving it inside the injected-dependency function is what put it under a gate. **One outcome INVERTS**, which the audit should expect: a create that fails and whose speculative retry also misses now reports `error`, not `no-customer`. Before this, `no-customer` meant "you never bought anything" — a true, unalarming fact about a normal person. After it, that state is meant to be unreachable, so arriving there means our attempt to fix it failed, and the placid sentence would hide a real breakage |

| 48 | The month dropdown lists months **newest first**; v1 lists them oldest first | `wordle-teams-l23h` (Phase 7 UI/UX polish) | The owner's call, and a straightforward divergence rather than a fix to anything broken: v1's `getMonthsFromScoreDate` (`src/lib/utils.ts:18-30`) walks FORWARD from the starting month and pushes the current month on last, so v1's dropdown ends with the month the reader is almost always after. v2 returns the same set reversed. **Worth more than the three visible rows suggest, which is why it was done before the list grew.** That three-month window is a free-tier affordance and is temporary — `monthOptions`' own doc comment records that the pro expansion, back to the team's earliest score, ships with the pro gate rather than here. v1 ALREADY has that expansion and wraps its dropdown in a `ScrollArea` whose height is computed from the option count (`src/components/action-buttons/month-dropdown/utils.ts`), which is the evidence that the list really does get long; ascending order in that shape puts the current month off the bottom of a scroll. Ordering it now means the expansion inherits the right order instead of rediscovering the problem later. **Scope is ordering only** — not the pro expansion, not a ScrollArea, not the label format, not the size of the window. `month-picker.test.ts` pins the direction at both ends plus strict monotonicity, which holds when the list lengthens (`PuzzleMonth` is `YYYY-MM`, so lexical comparison is chronological comparison) |

| 49 | **Skeleton loading states on the dashboard**, covering more surfaces than v1's | `wordle-teams-9ahw` (Phase 7 UI/UX polish) | **A parity gap the route-by-route audit missed, because it is only visible mid-transition.** v1 wraps its scores table in `<Suspense fallback={<SkeletonTable/>}>` (`src/app/me/page.tsx:60`) and ships a route-level `src/app/me/loading.tsx` mirroring the whole grid; v2 ported NEITHER. Three v2 panels — `scores-table.tsx:36`, `teams/team-boards.tsx:50`, `scoring-system-card.tsx:53` — all `useSuspenseQuery` the same `api.scores.getTeamMonth` keyed by `(teamId, month)`, so every team or month switch re-keyed and suspended all three at once; with no boundary anywhere on the dashboard and no `defaultPendingComponent` in `router.tsx`, the suspension bubbled past the route and the nearest boundary above it hid the whole grid, pickers included. **Measured: 18 blank animation frames per month switch against a LOCAL backend**, so materially worse against beta. **v2 now covers all three panels where v1 covered one** — v1's Team Boards and Scoring System blanked too, the same defect and simply less noticeable beside the table — plus `pendingComponent: DashboardSkeleton` for the navigation INTO `/app`, which is a different moment: the route loader prefetches `getMyTeams`, `amIPro` and `getMyPlayerId`, none of which depend on team or month, so it does not re-run on a switch. **Three improvements on v1's own skeletons:** the ROW count comes from `selectedTeam.members.length` where v1 draws three rows unconditionally — team membership is `api.teams.getMyTeams`, which does not suspend on a switch, so the count is already known when the fallback renders; the day-column count comes from `daysOfMonth(month)` where v1's `skeleton-rows.tsx` hardcodes THIRTY `<TableCell>`s as literal JSX (wrong in every month that is not 30 days, and 30 is the length that hides the bug in a third of the year), and the scoring-row count comes from `SYSTEM_FIELDS` so it cannot drift from the card it stands in for. All pulsing reuses `ui/skeleton.tsx`'s `animate-pulse bg-muted`, not v1's `dashboard-skeleton.tsx`, which hardcodes `bg-gray-900` — a raw Tailwind colour that `styles.css` rule 1 forbids in a component. **Every dimension was MEASURED in a browser rather than chosen by eye**, after the owner reported the first version looking too small: it rendered a 2009x194px table where the real one is 2782x100, so the grid narrowed by 773px and grew by 94 on every switch and snapped back — a skeleton causing the layout jump it exists to prevent. Retuned to 2788x100, within 0.2% on width and exact on height. The real day columns vary 74-92px with the day name, so a uniform fallback can only match their average |

| 50 | The Team Boards **day picker reaches every month the dropdown offers**, and opens on the day being viewed | `wordle-teams-5vv3` (Phase 7 UI/UX polish) | **Two owner complaints about one control, and the first is a bug v1 shares.** (1) The calendar always opened on the CLOCK'S month: react-day-picker resolves its initial month as `month \|\| defaultMonth \|\| today` and never consults `selected` (`helpers/getInitialMonth.js:14`), and `date-picker.tsx` passed neither — so a viewer looking at a July day had to page back two months to reach the day already on screen behind the popover. Filed as `wordle-teams-p5mw` at the Task 10 review and closed by this. v1 renders the same component with the same props, so it has the identical defect; it is simply reached less often there. (2) The picker was clamped to the LOADED month with `minDay`/`maxDay`, on the sound reasoning that `getTeamMonth` holds one month — but the right conclusion was that reaching another month is a NAVIGATION, not a day with no data. It now bounds on `monthOptions`' own output, passed down from `routes/app.tsx` as the SAME array the MonthPicker is driven by, and a pick outside the loaded month moves `?month=` through an `onMonthChange` callback. **Bounded to the dropdown's window rather than unbounded like board entry's, deliberately:** v2 has no pro month gate yet — `monthOptions` returns three months for everyone — so an unbounded picker would hand every player unlimited history now and the pro expansion would later have to take it away. One source means both controls widen together when it lands and can never disagree about what exists. **`maxDay` was DELETED rather than widened**, restoring `date-picker.tsx`'s own no-future-days default, which its doc comment already states `maxDay` can never widen. The Previous/Next DAY arrows were left stopping at the month boundary here and crossed in `wordle-teams-5nmo` immediately after — see row 51 |

| 51 | The Team Boards **day arrows cross months** too; v1's stop at the month edge | `wordle-teams-5nmo` (Phase 7 UI/UX polish) | The other half of row 50, and the owner asked for it once the picker could cross: the arrows indexed into `navigableDays` for the LOADED month and disabled at its edges, so at the 1st "Previous day" was dead while the picker beside it offered the month before. Stepping off the end is now a month navigation, the same `onMonthChange` the picker uses. **The rules live in a pure `stepDay` in `team-boards-model.ts`**, beside `navigableDays` and `resolveDay` and tested the same way: it lands on the NEAR end of the adjacent month (back from the 1st reaches the 31st, not the 1st), it applies the NEW month's `playWeekends` rather than the old month's day list, and it is bounded by the same `months` window the picker is, so an arrow can never reach a month the dropdown denies. **It SEARCHES rather than taking the neighbour**, which is not defensive coding: `navigableDays` filters `day <= today`, so a month can be in the window and hold nothing — taking it blindly would land the panel on an empty month behind an arrow that looked enabled. **`disabled` and the destination come from ONE call** per direction, computed at render; deriving them separately is how a button ends up enabled with nowhere to go. One behaviour is deliberately NOT gated: inside a month that is outside the window — reachable only by hand-editing `?month=` — the arrows still walk that month's own days and simply cannot leave it |

| 52 | The page has **one max width (1440px) and every region obeys it**, where v1 caps only some | `wordle-teams-rpql` (Phase 7 UI/UX polish) | Only the header, footer and marketing routes carried `page-wrap`, so `/app`'s `<main>` was unbounded. MEASURED at 1920x1080: header nav and footer 1080px wide and centred at 420-1500, the dashboard's content spanning 48-1872 — the chrome in a narrow strip with the page sprawling 744px wider on either side. The cap is raised to **1440** (owner, 2026-09-02) and now lives in one token, `--page-max`, read by both `.page-wrap` (cap plus a 1rem gutter, for regions with no padding of their own) and the new **`.page-max`** (cap only, for regions that already pad themselves). The split matters: giving the dashboard `page-wrap` would have stacked a 1rem inset on top of its deliberately tight `p-2` and changed mobile padding on a page nobody asked to change. **The landing is deliberately NOT capped** — `components/home/feature-cards.tsx` is a full-bleed `bg-surface-sunken` band with `page-wrap` on its inner grid, which is the correct pattern and would break if the `<main>` above it were bounded. **Two related fixes rode along.** `max-w-[96vw]` came off the scores table, the Team Boards card and the table skeleton: it is a fraction of the VIEWPORT where every sibling is bounded by its grid CELL, so above ~2400px the two disagreed — measured right edges against the picker row, 1872 vs 1872 at 1920, 2512 vs 2506 at 2560, 3392 vs 3350 at 3440. Note for the audit: the page cap is what actually repairs that alignment, and removing `96vw` only takes out a latent mismatch that would return if the cap were raised past ~2400; e2e cannot tell them apart, and says so. And the board-entry FOCUS RING now hugs the board (`mx-auto w-fit`) instead of outlining a `w-full` row, where it read as far too large and was clipped at both edges by the entry sheet's `overflow-y-auto` container. **A follow-up pass tightened the spacing itself:** the `px-4` came off both the header and footer ELEMENTS (the band inside each already carried a gutter, so it was a second one stacked on the first), and all three chrome-and-body bands — header nav, `<main>`, footer — now share ONE horizontal rule, `page-max` plus `px-2 md:px-0`, so they line up at every width rather than only above the cap. Measured before that change at 1024: nav 16-1008 against a grid at 0-1024. The dashboard's own spacing is now derived from its `gap` rather than chosen — `mt-2 px-2` under `md` against `gap-2`, `md:mt-6 md:px-0` against `md:gap-6` — replacing a `p-2 md:p-12` whose 48px matched nothing. **Horizontal is padding and vertical is margin, and that is forced rather than preferred:** `.page-max` sets `margin-inline: auto` and is UNLAYERED while Tailwind's utilities sit in `@layer utilities`, so an `mx-*` is beaten whatever its specificity and would simply not appear. **One consequence needed its own fix:** the tighter gutter exposed the spinning avatar ring, whose `getBoundingClientRect` includes the rotation — a 36px square reports up to 36*sqrt(2), measured 342-390.4 at a 390px viewport — which tripped `e2e/billing.spec.ts`'s document-overflow assertion by 1px. `overflow-x-clip` on the header contains it; `clip` and not `hidden`, which would make the bar a scroll container and break its `sticky` |
| 53 | **The signed-in player can see which address their account is under**, in the account menu and in the settings dialog; v1 shows it nowhere at all | `wordle-teams-7jpo` (Phase 7 UI/UX polish) | **An addition, and the issue that filed it had the direction backwards.** It stated that v1 shows the address in its user dropdown, making v2's omission the divergence. It does not: `src/components/app-bar/user-dropdown.tsx:126-131` renders `{firstName} {lastName}` and a Pro/Free badge, and a search across all of v1's `src/components` and `src/app` finds no display of the address anywhere — the sole hit in the whole codebase is a server-side log line in `api/process-board-entry-reminder/route.ts`. So this row records v2 doing something v1 never did, not restoring something it dropped. **WHY IT IS WORTH THE DIVERGENCE:** `convex/access.ts` resolves a session to a player PURELY BY EMAIL (`playerForEmail`, `:111`, called from `:119` and `:126`), so in v2 the address IS the account identity. The product offers four social providers plus OTP against the same address, and a provider that returns a DIFFERENT address silently produces a DIFFERENT account with an empty dashboard — a state the player previously had nothing in the app to diagnose. That is sharpest at cutover, when every migrated player signs in on the new stack for the first time and an empty dashboard is exactly the outcome nobody can distinguish from data loss. **BOTH PLACEMENTS, which was the owner's call between four options.** The account menu carries it as a secondary truncated line under the display name — the near-universal convention (Gmail, GitHub, Slack) and where a confused player looks first, with no navigation. The settings dialog carries it as a read-only "Signed in as" row ABOVE the tabs rather than inside one, because it is true of the dialog and not of a tab; there is no Account tab and adding one for a single line would be a bigger change than the question deserves. **THREE THINGS PINNED BY TEST rather than left to care:** the menu line is suppressed when `displayName` has already fallen back to the address (a nameless account would otherwise see the same string twice, once styled as a name); the dialog renders nothing at all when the address has not loaded, since `Signed in as ` with nothing after it reads as a broken account rather than a loading one; and both use `select-text`, because the entire purpose is reading one address against another. **`text-muted`, NOT `text-subtle`** — `styles.css` reserves the sub-AA exception for large or decorative text and directs anything normal-sized that must be legible to `text-muted`, and an address read character by character is the clearest case of the latter. The first draft of this used `text-subtle` and was caught against that rule. `app-menu.hook.test.ts` and the new `settings-dialog.hook.test.ts` cover it; the latter exists because the former mocks `SettingsDialog` out entirely, so the dialog half would otherwise have had no coverage at all |
| 54 | **Static documents are cached at the edge for a day**, where production sends `no-store` or `must-revalidate` on every one | Phase 7 Task 3, `wt-ksh.8.45`, `wordle-teams-fqeq` | **The audit sees this on eight routes and it is the single largest mechanical difference in the table.** Production serves `/` and `/about` `private, no-cache, no-store, max-age=0, must-revalidate` and `/home`, `/privacy`, `/terms`, `/login-error`, `/maintenance` and `/sitemap.xml` `public, max-age=0, must-revalidate`; v2 sends `public, max-age=0, s-maxage=86400, stale-while-revalidate=604800` to an anonymous visitor on the static routes, and `private, no-store` otherwise. **THE RULE IS TWO-DIMENSIONAL — static route AND no session — and both halves are load-bearing.** `__root.tsx`'s `beforeLoad` puts `{isAuthenticated, token}` into router context and TanStack serialises route context into the document, so a signed-in `/privacy` embeds a bearer JWT; caching that publicly would hand one person's token to the next visitor. Verified empirically rather than assumed (`lib/cache-policy.ts` records the byte-identical match against the request's `better-auth.convex_jwt` cookie). **IT EXISTS TO CLOSE `wordle-teams-jcj`**, where 28–41% of requests to production's marketing pages missed the edge and cold-started a function at ~1.9s. **THE HEADER ALONE REACHED NOTHING**, which `wt-ksh.8.45` measured: a Worker that renders its own response makes no origin subrequest and is not cache-eligible, and Cache Rules run ahead of the Worker. `wordle-teams-fqeq` added the Cache API, keyed on `CF_VERSION_METADATA.id` so a deploy invalidates by missing rather than by purging — `wrangler deploy` purges nothing. `/login` differs trivially in the same row: `private, no-store` against production's longer no-store spelling, which is the same instruction |
| 55 | **Every route declares its own `canonical` and `og:url`**; production declares no canonical anywhere and sets `og:url` to the apex on every page | Phase 7 (`wt-ksh.8.55`) | v1 sets `openGraph.url` in the root layout and no page overrides it, so production announces `/privacy` as the home page and a scraper that dedupes on `og:url` treats the whole site as one document. It emits no `rel=canonical` at all. v2 declares both per route, from one table keyed on the route's own path so a route states what it IS and the table decides what it CLAIMS. **`/home` IS THE ONE THAT IS NOT SELF-REFERENTIAL**: it renders the same component as `/` and both are in the sitemap, which is duplicate content advertised twice with only the sitemap `priority` — which Google ignores — hinting at a winner. `/home` therefore canonicalises to the apex, and `og:url` moves with the canonical rather than with the route, because both answer the same question and two tags disagreeing is worse than either answer alone. `/home` cannot simply be dropped: it exists for inbound links and v1's sitemap, and is deliberately exempt from the signed-in bounce `/` has. **`og:url` WAS REMOVED FROM THE ROOT rather than overridden there**, so the correctness of every page does not depend on TanStack's dedupe rule for `property` — the failure mode of that changing is TWO `og:url` tags rather than one visibly wrong one. `/login-error` has neither tag, deliberately: it is unadvertised and a canonical on a page nobody should index does nothing |
| 56 | **`og:image` is an absolute URL with no cache-busting query**, where production's is root-relative and fingerprinted | Phase 7 Task 8 | Production emits `/opengraph-image.png?826b6e40d0d7ffa6`; v2 emits `https://wordleteams.com/opengraph-image.png`. Two differences in one field. **ABSOLUTE, because the tag names where the site canonically lives** rather than which host served the response — so beta's card points at production, which is what has to be true after cutover and is the same reasoning `SITE_ORIGIN` uses for the sitemap and robots. **THE FINGERPRINT IS DROPPED because there is nothing to derive it from**: it is Next's build hash for a generated asset, and v2 serves the file from the Workers assets layer under a stable name. **THE TRADEOFF THAT QUERY WAS BUYING**: Facebook's and LinkedIn's scrapers cache the card image BY URL, so if this picture is ever redrawn under the same name they will serve the old one indefinitely. **Redrawing it therefore means shipping it under a NEW FILENAME.** That constraint is recorded in `lib/seo.ts` beside the constant, and it is what makes `wordle-teams-82zq`'s immutable one-year cache on that path safe. v1 also ships the image twice — `opengraph-image.png` and an md5-identical `twitter-image.png` — and v2 points both tags at one copy |
| 57 | **`robots.txt` and `/sitemap.xml` carry an explicit `charset=utf-8`**, where production's content types have none | Phase 7 Task 8 | `text/plain; charset=utf-8` against production's `text/plain`, and `application/xml; charset=utf-8` against `application/xml`. The smallest row in this table and it is here only because the parity script reports it and this section's own rule is that anything the audit finds and cannot explain is a bug. Both files are ASCII today, so no client behaves differently; declaring the encoding is the more correct answer and costs nothing. Recorded rather than silenced so a future reader meets an explanation instead of an anomaly |
| 58 | **A footer is rendered under every route**; v1 renders one on the home page and nowhere else | Pre-dates Phase 7 (`wt-ksh.8.50`) | v1 imports its footer only from `src/components/home/home.tsx`, so production's `/privacy`, `/terms`, `/about`, `/login` and `/me` have **no footer at all**. v2's `__root.tsx` renders `Footer` under every route, and has since the root layout was written — this is older than the phase that found it. **IT GETS ITS OWN ROW RATHER THAN THE NOTE IT HAD.** The fact was recorded at the tail of row 24, which is titled for the merged copyright line; an auditor scanning row TITLES for an explanation of a footer appearing on five routes it does not appear on in production would not find it there, and would file five bugs. The acceptance criterion on `wt-ksh.8.50` offered either placement and this is the one that survives a route-by-route walk. Note the two rows describe different things and both are needed: 24 is what the footer SAYS, this is WHERE it appears |
| 59 | **`robots.txt` is served with TWO `User-agent: *` groups** on any Cloudflare-proxied hostname — Cloudflare's managed block first, then ours — where production today serves exactly one | Phase 7 (`wt-ksh.8.57`) | **ACCEPTED DELIBERATELY ON 2026-09-04, NOT OVERLOOKED.** Beta's file opens with Cloudflare's managed content — a `Content-Signal` declaration, `Allow: /` with **no disallows**, and nine AI-crawler blocks — and our own group follows at line 101 with the four disallows the repo ships. **NOTHING IN CI CAN SEE THIS**: our file is correct and tested, and the composition happens at the edge, so it is only observable by fetching the live hostname. **IT IS A CUTOVER-INTRODUCED CHANGE, WHICH IS WHY IT WAS SETTLED BEFORE CUTOVER RATHER THAN AFTER.** Production is NOT Cloudflare-proxied today — measured 2026-09-04, `server: Vercel` with no `cf-ray` — so the managed block cannot reach it and its `robots.txt` is clean. The apex becomes a Worker custom domain at the DNS flip, is proxied from that moment, and inherits this composition. **THE JUSTIFICATION IS THE STANDARD, NOT A GOOGLE CONVENIENCE**: RFC 9309 §2.2.1 requires that groups sharing a user-agent value be merged into one, so a conformant parser honours our disallows. **THE EXPOSURE IF ONE DOES NOT MERGE WAS MEASURED RATHER THAN ASSUMED, and it is near nil**: `/app`, `/me` and `/complete-profile` all answer 307 to `/login` for an anonymous request, and `/login` is itself crawlable in v1 and v2 alike, so a first-match-wins parser reaches nothing it could not already have. `/api/auth` answers JSON. The one genuine finding in that sweep was `GET /api/funnel` returning 200 HTML — a soft 404, filed as `wordle-teams-ao7j` and fixable on its own terms. **AI-CRAWLER BLOCKING IS WANTED, AND THE COST IS LOWER THAN IT LOOKS**: the managed list blocks the TRAINING half of each split pair — `Google-Extended`, `GPTBot`, `ClaudeBot`, `Applebot-Extended` — while `Googlebot`, `OAI-SearchBot`, `Claude-SearchBot`, `Applebot` and `PerplexityBot` are untouched, so the bots that cite and send referral traffic still crawl. The `Content-Signal` line is an express Article 4 reservation under the EU copyright directive, cheap to hold and impossible to claim retroactively. **THE STANDING RISK IS THAT CLOUDFLARE MAINTAINS THAT LIST AND WE DO NOT.** If a search-side bot is ever added to it, this tradeoff changes silently and no test will notice. Re-read the live file before cutover; if that ever becomes unacceptable, the alternative on the record is to disable the managed block and port its rules into our own static file, which buys CI visibility at the price of maintaining the crawler list by hand |
| 60 | **`/manifest.json` is cached for ONE HOUR**, where production serves it `public, immutable, no-transform, max-age=31536000` | `wordle-teams-v917` (Phase 7) | **DELIBERATELY MATCHES NEITHER PRODUCTION NOR THE PLATFORM DEFAULT**, and it is the only rule in `v2/public/_headers` of which that is true. Production is frozen for a year because **Next set that header, not because anyone chose it** — and an immutable manifest freezes the app NAME, THEME COLOUR, ICONS and `start_url` for a year in any browser that fetched it. All four are about to move. `wordle-teams-c0f` (PWA launch screen) is likely to edit manifest fields, and freezing them immediately beforehand is the wrong order. **`start_url` CHANGES AT CUTOVER** — production's manifest says `/me`, v2's says `/app` — so an immutable copy would keep the cutover's own manifest change invisible to a pre-cutover visitor for up to a year, on exactly the population §7a's PWA work is most careful about. **The manifest is also newly load-bearing**: `__root.tsx` only started LINKING it during this phase, so before that nothing fetched it and the app was not installable at all; the blast radius is larger now than the header's age suggests. **The Workers Assets default was the other candidate and buys nothing** — a 304 on a small file is nearly free, but `max-age=0, must-revalidate` is EQUALLY a divergence from production, so leaving it alone would have needed this row regardless. An hour is what the file actually is: it changes rarely, and it must be able to change. `v2/src/asset-headers.test.ts` pins the exact string and separately asserts the absence of `immutable`, because both failure directions are silent — drifting to immutable freezes the fields above, and losing the rule returns it to the default with nothing to say so. **A second, unrelated difference on the same file is NOT addressed here**: production serves `application/manifest+json` and beta serves `application/json`. That needs a non-cache header in `_headers`, and `asset-headers.test.ts` deliberately asserts every rule sets cache-control AND NOTHING ELSE, on the grounds that an unnoticed second header would ship to the apex. Filed separately rather than weakening that guard as a side effect |
| 61 | A **Today panel** sits above the scores table; v1 has no equivalent surface | `wordle-teams-5jcn` (T6) | Answers "did I play today" and "who is waiting", which the month grid otherwise answers only by asking the reader to locate a cell. It joins the same `getTeamMonth` subscription the table and legend already fetch, so it costs no new query, and it renders nothing when the viewed month does not contain today, so the grid closes up on a past month |
| 62 | The scores table states **rank** inside the pinned Player cell and marks the caller's own row with a **ring on its two pinned cells only** (Player, Score); v1 has neither | `wordle-teams-5jcn` (T5) | Rank sits inside the existing pinned cell rather than a second sticky column: the table runs `table-layout: auto` with `w-max`, so a second column would need a pixel-exact `left-` offset that auto-layout is free to change. The self-marker is narrower than the approved spec's "row highlighted" — a row-wide `bg-muted/50` tint was byte-identical to `ui/table.tsx`'s own `hover:bg-muted/50`, so it could not be told apart from hover, and was dropped rather than left colliding. A ring composes on a different CSS channel and is applied to the two cells that stay on screen however far the row scrolls; the wide day-column body of the caller's own row carries no marker. Left open for the owner as `wordle-teams-5jcn.12` |
| 63 | Today's column is **tinted** in the scores table; v1 has no such marker | `wordle-teams-5jcn` (T5) | `bg-accent/40` on the `<TableCell>` whose day matches today, so the current day is findable without counting across the day columns |
| 64 | **Team admin lives in a dialog**, not in cards on the dashboard | `wordle-teams-5jcn` (T8, T9) | `CurrentTeamCard`, `MyTeamsCard` and `ScoringSystemCard` move, unmodified, behind a tabbed `TeamSettingsDialog` opened from a "Team settings" button; they no longer hold two of the dashboard's three grid columns for admin nobody wants done daily |
| 65 | A **read-only scoring legend** replaces the on-page scoring card | `wordle-teams-5jcn` (T7) | `ScoringLegend` states the team's actual scoring values as a chip strip, with an Edit link (owner only) opening the settings dialog on its Scoring tab, rather than the editable card sitting on the dashboard by default |


**Rows 19-21 were appended by the Phase 7 Task 4 review, rows 22-24 by Task 5's,
rows 25-30 by Task 9's, rows 31-34 by Task 10's, rows 35-38 by Task 11's, row
39 by Task 12's, row 44 by `wordle-teams-lyab`, row 45 by
`wordle-teams-x3m9`, row 46 by `wordle-teams-5p9`, row 47 by
`wordle-teams-kzfi`, row 48 by `wordle-teams-l23h`, row 49 by
`wordle-teams-9ahw`, row 50 by `wordle-teams-5vv3`, row 51 by
`wordle-teams-5nmo` and row 52 by `wordle-teams-rpql`.** The header deliberately kept saying eighteen while that was
happening, so that **Task 16** — which owns the parity audit and adds rows of its
own — could reconcile the total in one place rather than the count drifting a
task at a time on the way there.

**Task 16 has now done that (2026-09-01), and it added rows 40-43:** the
dashboard's move to `/app` (Task 1, structural and never previously recorded),
the copy's omission of reminder settings until cutover (`wt-ksh.7.32`), the
`/branding` drop, and `/about`'s title, the last two found by
`scripts/parity-routes.mjs`. Thirty-nine plus four is the forty-three in the
header. Nothing above them was renumbered, and no row was renumbered when 22-24,
25-30, 31-34, 35-38, 39 or 40-43 were added.

Two Task 13 findings are deliberately **not** rows here, because they are defects
rather than decisions and belong in Beads: beta serving the apex as `og:url` on
every route (`wt-ksh.8.55`) and `/opengraph-image.png` losing production's
immutable one-year cache (`wordle-teams-82zq`).

Row 39 is the only row here that describes v2 being **more permissive in the UI
than v1**, and it is recorded that way on purpose: the audit will find a Billing
button where v1's dropdown has none, and the honest reason is that v2 has no
`hasBillingAccount` to gate it with. It is also the row that exists because a
review caught a wrong one — see its entry.

Rows 35-38 are all one DIALOG — the monthly-winner celebration — and they exist
for the reason rows 31-34 do, one task later: Task 11 built the second of the
two dashboard features with no owning phase at all (`wordle-teams-k7w`), so
nothing else was ever going to describe it here. **Row 35 is the one row in this
table where v2 stops v1 saying something false to a user**, which is why it is
recorded as a fixed defect rather than a divergence of taste; row 38 is the read
half of row 3, and rows 36-37 are the dependency-reduction line rows 20, 25 and
31 already draw.

Rows 31-34 are all one PANEL — the dashboard's Team Boards — and they exist for
the reason rows 25-29 do, one step earlier: Task 10 built a screen that had no
owning phase at all (`wordle-teams-ry1`), so nothing else was ever going to
describe it here. Note that row 34 is the one row in this table that records v2
being MORE careful than v1 about something the audit cannot see from the
outside, which is why its entry says at length what it is not.

Rows 25-29 are all one page — `/about` — and they exist because Task 9 landed
eight screenshots and added **no** rows at all, against a phase acceptance
criterion that every difference is either recorded here or filed as a bug. Row
24's closing point is the general one: a divergence explained in the source
file's own header is not thereby recorded, because **the audit reads this
table**.

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

Of the Phase 6 five, **only 18 is visible in a browser**, and only with DevTools
open on Cache Storage. 14, 15 and 16 live entirely inside an hourly cron and
cannot be reached from any UI — exercising them takes a player row in a
non-UTC zone, a reminder time an hour out, and a clock. 17 has no v1 behaviour
to compare against at all, so the audit must check that push *works*, not that
it matches.

**Two more, which diverge from Phase 6's own plan rather than from v1.** Both
were raised by Task 11's code-quality review and approved by the owner on
2026-08-28; both shipped in commit `79bda50`. They are recorded here because
the audit's expectations come from this list, and the plan says something
different:

- **`removePushSubscription` is scoped to the calling player, not merely
  authenticated.** The plan had it run `requirePlayer` and then discard the
  result, so any signed-in player holding somebody else's endpoint could delete
  that row — and, paired with `saveSubscriptionFor`'s **deliberate**
  reassignment of an endpoint to whoever last saved it (`v2/convex/push.ts:55-61`,
  which exists so a shared device migrating between accounts on sign-in works),
  re-point it at themselves: the victim's device would then receive the
  attacker's reminders and stop receiving their own. `removeByEndpointFor` now
  takes the `playerId` and deletes only on a match
  (`v2/convex/push.ts:83-105`). **Absent and "present but not yours" are both
  silent no-ops, not throws, and that symmetry is the point**: a throw on "not
  yours" would let a caller tell a non-existent endpoint apart from someone
  else's, one call at a time, which is a probe. The no-op on absent is
  unchanged — it is what makes the 410 cleanup race with sign-out safe.
- **`savePushSubscription` rejects an endpoint that is not a parseable `https:`
  URL**, through the new `INVALID_PUSH_ENDPOINT` access code
  (`v2/convex/access.ts:51`) and its case in `v2/src/lib/convex-error.ts:129`.
  The plan stored the endpoint unvalidated, and `pushSend.ts` hands it to
  `webpush.sendNotification`, which `https.request`s whatever host it parses
  out — a blind SSRF primitive with an attacker-chosen destination, fired
  from a daily cron. The check lives in `saveSubscriptionFor`
  (`v2/convex/push.ts:44`) rather than at the public mutation, so every writer
  inherits it, and the rejected value is never logged or echoed back.

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
- **The reminder hour window still cannot be satisfied when it spans midnight.**
  v1's `reminder_delivery_time <= (now)::time AND >= (now - 1 hour)::time`
  (`supabase/migrations/20250416172516_limit_daily_reminders.sql:11-12`) is
  unsatisfiable across midnight, because the lower bound wraps to `23:xx` while
  the upper stays at `00:xx`, and `isDueThisHour` ports that arithmetic
  unchanged (`v2/convex/lib/reminders.ts:130-136`). It is **deliberately not
  fixed**: the picker offers exactly eighteen times, `05:00:00` through
  `22:00:00` (`src/components/app-bar/board-entry-reminders.tsx:86-103`, and
  `REMINDER_TIMES` in `v2/convex/lib/reminders.ts:39-42`, which the settings UI
  renders from and the server validates against), so no reachable value spans
  midnight in either version. Leaving it alone keeps the ported rule comparable
  with production; it is pinned in `v2/convex/reminders.test.ts` so that
  widening the picker fails loudly instead of quietly dropping reminders. Fixing
  it is listed as out of scope in the Phase 6 spec.

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
