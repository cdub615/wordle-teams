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
  a `div.relative.w-full.overflow-auto` that callers cannot reach. Because that
  div is `w-full` and bounded by its parent, *it* — not any wrapper a caller
  adds — is the element the table actually overflows, so it is the real scroll
  region. A horizontally scrolling data table has to make that region a
  keyboard focus target, which was impossible from outside. v2 added a
  `wrapperProps` pass-through (Phase 2, `wt-ksh.3.9`); the scores table uses it
  for `tabIndex` and an `aria-label`.

  Related, and worth knowing before writing another table: the primitive also
  hardcodes `w-full` on the `<table>` itself. Under `table-layout: auto` that
  acts as a **cap**, not a minimum, so a wide table compresses its columns
  instead of overflowing — with 31 day columns the headers wrapped to one
  character per line. `scores-table.tsx` overrides it with `w-max min-w-full`.
  `vite build`, `tsc --noEmit` and all 115 tests were green with that bug
  present; it was caught only by looking at a screenshot, which is the same
  lesson as §5.

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

**Three known differences from production, all deliberate. Anything else the
audit finds is a bug.**

| # | Divergence | Added | Why |
| --- | --- | --- | --- |
| 1 | Duplicate-letter tile colouring | Phase 1.5 (`wt-ksh.12.10`) | §7 above. v1 loses a legitimate yellow; v2 uses the standard algorithm |
| 2 | A double submit cannot create a duplicate score row | Phase 2 (`wt-ksh.3.6`) | v1 keys the upsert on a client-held score id and inserts when the client lacks one, so a double submit makes two rows — it has already done so 5 times in production (`wordle-teams-rac`). v2 keys on `(playerId, puzzleDay)`, which makes it structurally impossible. **The 5 existing copied pairs are left untouched** and read first-wins, exactly as v1 renders them |
| 3 | `hasSeenCelebration` survives a winner rewrite | Phase 2 (`wt-ksh.3.7`) | v1's `update_monthly_winners` deletes the row and re-inserts it, wiping the seen-list every time anyone enters a board dated in that month — which can re-fire the celebration at someone who already dismissed it. v2 preserves the array when the winner is unchanged and resets it only when the winner actually changes |

Both Phase 2 divergences are on the **write** path, so they are invisible in a
static route-by-route comparison. Exercising them takes a deliberate double
submit and a winner rewrite within one month.

Not divergences from v1, but recorded because they look like ones:

- **`NOT_A_MEMBER` renders a full error screen, not a toast.** That differs from
  the Phase 2 *design doc's* original error table, not from v1 — v1 has no
  equivalent state at all. The design doc carries the amendment explaining why.
- **The month picker offers a fixed three-month window to everyone.** v1 widens
  it for pro accounts. Phase 2 deliberately deferred the pro gate, so v2
  currently shows a pro user *less* history than prod. Nobody sees more than v1
  would allow, which is the safe direction, but the audit will notice it.

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
