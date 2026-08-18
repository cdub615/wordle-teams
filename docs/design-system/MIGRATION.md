# Migration: v1 → v2 tokens

Four phases, each independently shippable. Phase 1 is mechanical and should produce **zero visual change** beyond the intended surface steps. Do not start a phase before the previous one is verified in both themes.

## Token map

| Today | v2 | Change |
| --- | --- | --- |
| `--card`, `--popover` | `--surface` | Now a real step above the page instead of an identical value. |
| `--muted`, `--secondary`, `--accent` (three names, one value) | `--surface-sunken` | Collapse to one surface token; the three stay as aliases pointing at it. |
| `--muted-foreground` | `--text-muted` | Same role, ranked name. A third rank `--text-subtle` is added. |
| `--ring` (`142 76% 34%` / `142 69% 36%`) | `--accent-solid` | Two near-identical greens become one accent that also drives links and active nav. |
| `--border`, `--input` | `--border-subtle`, `--border-strong` | Split by role: hairlines vs interactive outlines. Today both are the same value. |
| `bg-green-600 dark:bg-green-700` | `--wordle-correct` | Remove the inline pair from `wordle-board.tsx`, `badge.tsx`, app bar. |
| `bg-yellow-400 dark:bg-yellow-500` | `--wordle-present` | Same, and always paired with `--warning-foreground`. |
| `text-gray-50` / `text-gray-400` on `bg-secondary-foreground` | `--surface-inverse` + inverse text | The feature band stops reaching outside the token set. |
| `--color-stop-1..3` | `--brand-from` / `-via` / `-to` | Named by gradient position so icon and wordmark share one source. |
| `--destructive` dark `0 62.8% 30.6%` | `--danger` dark `#ef4444` | Raise for legibility; the current dark red reads as disabled. |
| `--foreground: 240 10% 0.9%`, `--background: 0 0% 97%` | `240 10% 4%` / `0 0% 98%` | One-off lightness values normalized onto the neutral ramp. |

---

## Phase 1 — Token layer only (no component edits)

1. Replace `src/app/globals.css` with `globals.v2.css`.
2. Merge `tailwind.tokens.ts` → `theme.extend.colors` in `tailwind.config.ts`. Leave the existing shadcn color block untouched.
3. Verify every route in both themes: `/`, `/me`, auth screens, 404. Expected diffs, and only these:
   - Cards, dialogs, and popovers now sit a half step off the page background instead of matching it.
   - Page background moves `#f7f7f7 → #fafafa` (light) and stays `#0a0a0a` (dark).
   - Body text moves off the one-off near-black to `240 10% 4%`.
   - Inputs get a slightly stronger border than card hairlines.
   - Dark-mode destructive buttons get noticeably brighter.
4. If anything else moves, a component was reading a token in a way the alias layer doesn't cover — report it before proceeding.

**Acceptance:** no component file changed; both themes render as described.

## Phase 2 — Pull hardcoded accents into tokens

Target files:
- `src/components/wordle-board.tsx` — `bg-green-600 dark:bg-green-700` → `bg-wordle-correct`; `bg-yellow-400 dark:bg-yellow-500` → `bg-wordle-present text-warning-foreground`; `bg-muted` → `bg-wordle-absent`; empty-tile border → `border-line-strong`.
- `src/components/ui/badge.tsx` — **fixes a real bug.** The `success` variant currently pairs `bg-green-600` with `text-secondary-foreground`, which is near-black in light mode (~2.1:1, fails WCAG AA). Change to `bg-success text-success-foreground` (4.6:1). Add matching `warning` and keep `destructive` → `bg-danger text-danger-foreground`.
- `src/components/app-bar/app-bar-base.tsx` and any wordmark instance — gradient stops → `from-brand-from via-brand-via to-brand-to`.
- `src/components/home/feature-cards.tsx` — `bg-secondary-foreground` → `bg-surface-inverse`; `text-gray-50` / `text-gray-400` → inverse-surface text tokens.
- `src/components/ui/magicui/border-beam.tsx` — default `colorFrom` / `colorTo` props read the brand tokens instead of hex literals.
- Destructive icon buttons using `text-red-500` → `text-danger`.

**Acceptance:** `rg -n 'green-[0-9]|yellow-[0-9]|gray-[0-9]|#(16a34a|15803d|facc15|eab308)' src/` returns hits only in `globals.v2.css`.

## Phase 3 — Normalize the component drift

1. **One home page.** `src/components/welcome.tsx` and `src/components/home/*` are both live entry points with different heroes. Pick the `home/*` version (icon, Geist hero, highlight sweep, beam, feature band, footer) and delete the other, or the reverse — but ship one.
2. **Card padding.** `card.tsx` header/content/footer use `px-4 py-6 md:p-6` instead of stock `p-6`. Pick one default and let consumers override, rather than forking the primitive.
3. **Radius vocabulary.** `rounded-md`, `-lg`, `-xl`, and a one-off `rounded-[6px]` all appear at the same level of hierarchy. Bind each component class to a single step off `--radius`.
4. **Font as a token.** Geist is added via `className` on individual marketing headings. Make display-vs-UI an explicit font token (`font-display` / `font-sans`) instead of an import at the call site.
5. **Toast severity.** `sonner` success and error render identically on the neutral surface. Give each an accent edge or icon so the outcome reads without parsing the copy.

## Phase 4 — Delete the alias layer

Once phases 2–3 are done and nothing references the old names:
1. Remove the Layer 3 alias block from `globals.css`.
2. Remove the old shadcn color block from `tailwind.config.ts`.
3. Rename `line-*` back to `border-*` in the Tailwind config (see the note at the bottom of `tailwind.tokens.ts`).
4. `rg -n '\-\-(card|popover|muted|secondary|destructive|ring|input|foreground)\b' src/` should return nothing.

---

## Contrast reference

Verified pairs in the v2 set — keep these ratios when adjusting values:

| Pair | Light | Dark |
| --- | --- | --- |
| `text` on `background` | 19.4:1 | 18.1:1 |
| `text-muted` on `background` | 4.8:1 | 5.9:1 |
| `text-subtle` on `background` | 2.9:1 (decorative only — never body copy) | 3.1:1 |
| `success-foreground` on `success` | 4.6:1 | 6.9:1 |
| `warning-foreground` on `warning` | 12.4:1 | 11.1:1 |
| `danger-foreground` on `danger` | 4.8:1 | 4.1:1 |
| `accent-foreground` on `accent-solid` | 4.6:1 | 8.2:1 |
