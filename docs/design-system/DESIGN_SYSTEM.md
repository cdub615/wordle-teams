# Wordle Teams — Design System

Captured from `cdub615/wordle-teams@main`. Every v1 value below was read out of the source, not measured from a screenshot. Machine-readable equivalents live in `tokens.json`.

---

## 1. Architecture

Tailwind with `cssVariables: true`. Colors are declared in `src/app/globals.css` as **bare HSL triplets** (`142 76% 37%`, no `hsl()` wrapper) and consumed through `tailwind.config.ts` as `hsl(var(--token))`. This is what lets `bg-primary` mean different things per theme without any component branching.

Theming is `next-themes` toggling a `.dark` class on `<html>`; light / dark / system are all supported. shadcn/ui `default` style, `baseColor: neutral`, Radix primitives underneath.

**The contract:** components read tokens, never theme conditionals. Preserve this.

---

## 2. Color

### Neutrals

The palette is greyscale with a very slight cool cast in light mode (`240` hue) and pure neutral in dark (`0` hue). Full table in `tokens.json` → `v1.color`.

Key facts about the current set:
- `--card`, `--popover`, and `--background` are **the same value in both themes**. Every card is visible only by its 1px border. This is consistent, but it means the app has no surface hierarchy.
- `--muted`, `--secondary`, and `--accent` are also all the same value — three names, one color.
- `--border` and `--input` are likewise identical, so there's no visual distinction between a card hairline and an interactive outline.
- `--primary` / `--foreground` invert between themes (near-black ↔ near-white); `--primary` is what fills the main CTA.
- Two values sit off the neutral ramp: `--foreground: 240 10% 0.9%` and `--background: 0 0% 97%`.

### Accent

Green and yellow are the **only** saturated colors in the product, and they carry the game's own meaning: green = correct, yellow = close. Brand reuses those semantics rather than inventing a separate identity.

| Role | Light | Dark |
| --- | --- | --- |
| Correct / success / focus ring | `#16a34a` green-600 | `#15803d` green-700 |
| Present / warning | `#facc15` yellow-400 | `#eab308` yellow-500 |
| Wordmark gradient | `#16a34a → #22c55e → #facc15` | `#16a34a → #86efac → #facc15` |
| Destructive | `#ee3636` | `#7f1d1d` |

These are applied as **inline Tailwind utilities** in components, not as tokens — the main thing v2 fixes. `--color-stop-1..3` exist for the icon gradient but are barely used.

The focus ring (`--ring`, a green) is the only accent in the app chrome. Everything else neutral.

---

## 3. Typography

Two families:
- **Inter** — `next/font`, latin subset, applied to `<body>`. All UI. Weights 400 / 500 / 600 / 700.
- **Geist Sans** — applied per-element via `className` on marketing headings only (home hero h1 and hero paragraph).

Tailwind's default scale, no custom sizes. Steps actually in use, with their real jobs:

| Class | Size / line-height | Usage |
| --- | --- | --- |
| `text-xs` | 12 / 16 | Footer legal, N/A cells, mobile table text |
| `text-sm` | 14 / 20 | Buttons, table body, card descriptions, toasts |
| `text-base` | 16 / 24 | Inputs, list rows, hero subhead on mobile |
| `text-lg` | 18 / 28 | Dialog titles, error headline |
| `text-2xl` | 24 / 32 | Card titles, app bar wordmark, empty-state heading |
| `text-3xl` | 30 / 36 | Wordle tiles (mobile), desktop wordmark, mobile hero |
| `text-4xl` | 36 / 40 | Wordle tiles (desktop), welcome headline |
| `text-6xl` | 60 / 60 | Marketing hero h1 from `md` up (Geist) |

Note: **card titles are `text-2xl font-semibold`** — unusually large for a card, and they typically hold a right-aligned action row on the same line. That's a deliberate characteristic of this app, not a mistake.

---

## 4. Spacing, radius, elevation

**Spacing** — Tailwind's 4px step scale, but the app uses a small vocabulary: `2` (8px), `4` (16px), `6` (24px), `12` (48px), mobile-first with doubling at `md:`.

| Context | Value |
| --- | --- |
| Page padding | `p-2 md:p-12` |
| Grid gap | `gap-2 md:gap-6` |
| Card padding | `px-4 py-6 md:p-6` (forked from stock `p-6`) |
| App bar padding | `px-4 py-2 md:px-12 md:py-6` |
| Wordle tile gap | `gap-1` (4px) |

**Radius** — `--radius: 0.5rem`, giving `sm` 4px / `md` 6px / `lg` 8px / `xl` 12px / `full`. Buttons and inputs `md`, cards `lg`, skeletons and previews `xl`, badges and avatars `full`. **Wordle tiles are square — radius 0.** Don't round them; the sharp corner is the game's visual signature.

**Elevation** — three levels, unchanged between themes:

| Shadow | Value | Usage |
| --- | --- | --- |
| `shadow-sm` | `0 1px 2px 0 rgb(0 0 0 / 0.05)` | Card, active tab |
| `shadow-md` | `0 4px 6px -1px …, 0 2px 4px -2px …` | Select, dropdown |
| `shadow-lg` | `0 10px 15px -3px …, 0 4px 6px -4px …` | Dialog, sheet, toast, switch thumb |

In dark mode shadows are effectively invisible; separation comes entirely from `--border`.

---

## 5. Icons

`lucide-react` throughout, with a few `@radix-ui/react-icons` on the home page. Stroke width 2, `currentColor`. Button variants force `size-4` on any nested `svg`.

Sizes: 16 inline in text, 20 in buttons, 22 for icon buttons, 40–48 for marketing feature icons. Destructive icon actions use `text-red-500` (`#ee3636`).

---

## 6. The Wordle board (signature component)

`src/components/wordle-board.tsx`. A 5-column grid, 6 rows, `gap-1`, fixed 320px width on desktop.

Tiles:

| State | Fill | Notes |
| --- | --- | --- |
| Correct | `bg-green-600 dark:bg-green-700` | White-ish text |
| Present | `bg-yellow-400 dark:bg-yellow-500` | Near-black text |
| Absent | `bg-muted` | Default foreground |
| Empty | no fill, border only | Border is the only affordance |

Letters are uppercase, `text-3xl md:text-4xl`, square corners, and can be **hidden per team** until the viewing player has submitted their own board for the day.

**Scoring display rules:** 7 attempts renders as `X` (failed). A missed day before today scores `0`. Non-play weekends render `N/A` in muted text. Points are awarded by attempt count and are team-configurable (see the Scoring System card).

---

## 7. Components

All from `src/components/ui/*`, stock shadcn unless noted.

**Button** — heights 40 default / 36 `sm` / 44 `lg` / 40 square `icon`. Radius `md`, `text-sm font-medium`, `gap-2` between label and icon, 150ms color transition, ring on keyboard focus, 50% opacity when disabled. Variants: default (`--primary` fill), secondary, outline, ghost, destructive, link.

**Badge** — `rounded-full`, `px-2.5 py-0.5`, `text-xs font-semibold`. Variants default / secondary / destructive / outline, **plus a non-stock `success`**. ⚠️ The `success` variant pairs `bg-green-600` with `text-secondary-foreground`, which is near-black in light mode — roughly 2.1:1, fails WCAG AA. Fixed in v2.

**Card** — radius `lg`, 1px border, `shadow-sm`, background equal to the page. Header/content/footer padding forked to `px-4 py-6 md:p-6`; content drops its top padding. Title `text-2xl font-semibold`, often with a right-aligned action row.

**Input** — `h-10`, `text-base`, `border-input`, `rounded-md`, ring on focus.

**Select** — trigger `h-10`, `bg-transparent`, `text-sm`, chevron at 50% opacity, `shadow-md` content.

**Switch** — 44×24 track, 20px thumb with `shadow-lg`, `bg-primary` when on, `bg-input` when off.

**Tabs** — `h-10` track on `bg-muted` with `p-1`; the active tab lifts to `bg-background` + `shadow-sm`.

**Table** — `h-12` header cells, `p-4` body cells, 1px row borders, rows hover at `bg-muted/50`.

**Dialog** — `max-w-lg`, radius `lg`, `shadow-lg`, overlay `bg-black/80`, 200ms fade + `zoom-95`. **On mobile the same content renders as a top Sheet instead.** Title `text-lg font-semibold`, description `text-sm text-muted-foreground`.

**Skeleton** — `animate-pulse` on `bg-muted`, `rounded-md` overridden to `lg`/`xl` per slot.

**Toast** (`sonner`) — neutral surface, `shadow-lg`, theme follows `next-themes`. Success and error are visually identical; only the copy differentiates them.

**OTP input** — 40×40 cells, `rounded-md`, `border-input`, active cell gets the ring and a `caret-blink` caret (1.25s ease-out infinite).

**Empty state** — centered muted copy, e.g. "Visible after today's submission" over "No board for player on this date."

**Error state** — `text-lg` headline ("Ruh roh, something went wrong!"), muted body pointing at `feedback.wordleteams.com`, single primary retry button.

---

## 8. Patterns

**App bar** (`src/components/app-bar/app-bar-base.tsx`) — gradient wordmark left, user affordance right, full-width separator underneath. `px-4 py-2 md:px-12 md:py-6`. Signed out shows the theme toggle; signed in shows the plan badge + avatar dropdown.

**Dashboard grid** (`src/app/me/page.tsx`) — one column on mobile, three from `md`. Action row and scores table span all three columns. Team Boards spans three rows in column 1; Scoring System spans three rows in column 3. Current Team and My Teams occupy the middle column. Page padding `p-2 md:p-12`, gap `gap-2 md:gap-6`.

**Leaderboard table** (`src/components/app-grid-items/scores-table/*`) — horizontally scrolling month grid inside a `rounded-md border`. The **Player column pins left and the Score column pins right**, both painted `bg-background` so rows slide underneath. Rows sort by month total descending. Header text muted; score bold and right-aligned. Row hover `bg-muted/50`.

**Marketing hero** (`src/components/home/*`) — icon, Geist headline, muted subhead with a green→yellow highlight sweep, single primary CTA, then a bordered product screenshot with an animated `border-beam`. Feature grid below sits on an **inverted band** (`bg-secondary-foreground` in light, `bg-secondary` in dark) with hardcoded `gray-50` / `gray-400` text. Footer is muted text at `xs`/`sm`.

---

## 9. Motion

| Animation | Timing | Where |
| --- | --- | --- |
| `accordion-down` / `-up` | 0.2s ease-out | Radix accordion content height |
| Overlays | 200ms fade + `zoom-95` + slide | Dialog, sheet, select, popover (`tailwindcss-animate`) |
| `animate-pulse` | 2s `cubic-bezier(.4,0,.6,1)` | Skeletons, loading table, route loading |
| `border-beam` | 15s linear, `offset-path` | Dashboard screenshot on home (`size 200`, `borderWidth 1.5`, `#16a34a → #facc15`) |
| `animate-gradient` | 8s linear infinite | Animated gradient text on first-run intro |
| `shimmer` | 8s infinite | Magic UI shimmer button |
| `spin-slow` / `spin-super-slow` | 3s / 5s linear | Decorative spinners |
| `caret-blink` | 1.25s ease-out infinite | OTP input caret |
| `transition-colors` | 150ms | Every button, table row hover, tab |
| Hero entrance | 0.5s `cubic-bezier(.4,0,.2,1)`; highlight sweep 2s at 0.5s delay | Home headline (framer-motion) |

---

## 10. Known drift

Places where today's code disagrees with itself. Documented as-is above; `MIGRATION.md` has the fixes.

**Bugs**
1. **Success badge is unreadable in light mode.** `bg-green-600` + `text-secondary-foreground` ≈ 2.1:1.
2. **Two home pages exist.** `welcome.tsx` and `components/home/*` are both live with different heroes.

**Inconsistencies**
3. **Accents are hardcoded, not tokenized.** `green-600/700`, `yellow-400/500`, `gray-50/400` inline across board, badge, app bar, feature cards.
4. **Card padding is forked** — `px-4 py-6 md:p-6` rather than stock `p-6`.
5. **Two type families applied per-element** rather than via a font token.
6. **Card equals background** in both themes; all separation comes from `--border`.
7. **Odd lightness values** — `--foreground: 240 10% 0.9%`, `--background: 0 0% 97%` sit off the ramp.
8. **Radius vocabulary is loose** — `md`, `lg`, `xl`, and a one-off `rounded-[6px]` at the same hierarchy level.
9. **Toast severity is invisible** — success and error render identically.

---

## 11. Carry forward, unchanged

The neutral-plus-one-accent discipline. The CSS-variable theme contract. The green/yellow game semantics. The pinned-column leaderboard. The dialog-on-desktop / sheet-on-mobile split. The square Wordle tile.

Those are the system's identity — everything else above is implementation.
