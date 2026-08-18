# Handoff: Wordle Teams Design System (v1 capture → v2 tokens)

## Overview
This bundle documents the design system of the **live Wordle Teams app** (`cdub615/wordle-teams`, branch `main`) and proposes a normalized token set for the v2 replatform. It exists so Claude Code can (a) understand the current system without re-deriving it from the codebase, and (b) execute the v1 → v2 token migration.

## About the design files
`Wordle Teams Design System.dc.html` in this bundle is a **design reference created in HTML** — a living style guide that renders the tokens and components. It is not production code to copy. The target codebase is already React + Tailwind + shadcn/ui, so implementation means **editing the real token files**, not porting this HTML.

## Fidelity
**High-fidelity, and source-derived.** Every v1 value in this bundle was read out of the repo (`src/app/globals.css`, `tailwind.config.ts`, `src/components/ui/*`, `src/components/**`), not eyeballed from screenshots. Treat v1 values as ground truth. Treat everything under "v2" as a **proposal to review**, not a spec to apply silently.

## What to read, in order
1. `DESIGN_SYSTEM.md` — the full written spec: v1 tokens, type scale, spacing, components, patterns, motion, and the catalogued drift.
2. `tokens.json` — machine-readable v1 + v2 tokens. Use this as the source when generating CSS or config.
3. `globals.v2.css` — a drop-in replacement for `src/app/globals.css` implementing the v2 set with backward-compatible shadcn aliases.
4. `tailwind.tokens.ts` — the `theme.extend.colors` additions the v2 CSS needs.
5. `MIGRATION.md` — ordered, file-by-file task list.

## Stack context
- Next.js App Router, React, TypeScript
- Tailwind CSS with `cssVariables: true`, shadcn/ui `default` style, `baseColor: neutral`
- Radix primitives, `tailwindcss-animate`, `lucide-react` icons, `sonner` toasts, `next-themes` (light / dark / system, `.dark` class on `<html>`)
- Fonts: Inter (body, all UI) + Geist Sans (marketing display only)

## Non-goals
- No rebrand. Name, logo, and the green→yellow accent stay.
- No component library swap. shadcn/ui stays; the v2 aliases exist specifically so `src/components/ui/*` compiles unchanged on day one.
- No new saturated colors. Green and yellow remain the only accents.

## Design principles to preserve
1. **Neutral plus one accent.** The chrome is greyscale; green is the only color that earns attention, yellow means "close." These are the game's own semantics reused as brand.
2. **CSS variables are the theme contract.** Components never branch on theme; they read tokens.
3. **Background and foreground travel together.** Never set one without the other from the same pair. (This rule is what fixes the success-badge contrast bug.)
4. **Dialog on desktop, sheet on mobile.** One content component, two presentations.
5. **The board is the signature.** Square-cornered tiles, uppercase, green/yellow/muted. Don't round them.

## Assets
`assets/` holds the icon and product screenshots copied from the repo's `public/`. They are the real production assets — reference the repo copies rather than these when implementing.

## Files in this bundle
| File | What it is |
| --- | --- |
| `README.md` | This file |
| `DESIGN_SYSTEM.md` | Full v1 spec + v2 proposal in prose |
| `tokens.json` | Machine-readable tokens, v1 and v2 |
| `globals.v2.css` | Drop-in v2 stylesheet with compat aliases |
| `tailwind.tokens.ts` | Tailwind color config for the v2 tokens |
| `MIGRATION.md` | Ordered task list, by file |
| `Wordle Teams Design System.dc.html` | The rendered style guide (open in a browser) |
| `assets/` | Icon + product screenshots from the repo |

## Suggested prompt for Claude Code
> Read `design_handoff_wordle_teams/DESIGN_SYSTEM.md` and `MIGRATION.md`. Then execute Phase 1 only: replace `src/app/globals.css` with `globals.v2.css`, merge `tailwind.tokens.ts` into `tailwind.config.ts`, and verify every existing screen still renders identically in both themes. Do not touch component files in this phase. Report anything in the migration map that conflicts with what you find in the code.
