# Board Import, Part 2 — the parse, the adapter and the confirm step

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development
> (recommended) or superpowers:executing-plans to implement this plan task-by-task.
> Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Turn a screenshot into a filled-in, user-confirmed board.

**Spec:** `docs/superpowers/specs/2026-09-05-pro-tier-and-insights-design.md`, section 2.
**Epic:** `wordle-teams-418`. **Part 1:** `docs/superpowers/plans/2026-09-05-board-import-part1-core.md`.

---

## What Part 1 left, and why the seam is where it is

Part 1 built and merged the correctness core. `resolveBoard` is the whole of
Stage 4 and it already works:

```ts
resolveBoard(rows: RowObservation[], words: string[], suppliedAnswer: string | null): BoardResolution
type RowObservation = { letters: LetterScores[]; marks: Mark[] }
type LetterScores   = Readonly<Record<string, number>>   // sparse, 0..1 per letter
type Mark           = 'absent' | 'present' | 'correct'
```

**So Part 2's entire job is `image → RowObservation[]`.** Everything downstream
exists and is tested.

That seam is worth defending, because it is what keeps the risky half testable.
Stages 1–3 are pure functions over plain pixel data — no DOM, no canvas, no
network — so they run in this repo's existing `edge-runtime` vitest environment
exactly as Part 1's logic does. Only Task 6's adapter touches a browser.

```ts
/** Structurally compatible with the browser's ImageData, deliberately. */
type Bitmap = { width: number; height: number; data: Uint8ClampedArray }  // RGBA
```

---

## What the spike changed, and what it did NOT settle

`wordle-teams-418.1` returned GO at 23/25. Three of its findings bear directly on
this plan and one of them contradicts the spec.

### 1. The spec's central claim about Stage 1 is UNPROVEN, not wrong

Section 2 says partial crops, status bars and screenshots of screenshots are
tolerated because "none of those produce a competing five-wide lattice of equally
sized squares."

**The spike measured a competing lattice: the on-screen keyboard.** A crop
containing only the keyboard, no board at all, scored 380 five-wide scanlines
against a detection threshold of 40.

This does **not** mean the spec is wrong. The spike used a cruder test than the
spec describes — horizontal run-length encoding per scanline, which has no
squareness filter at all. NYT's keys are roughly 43×58, clearly not square, so
the spec's actual algorithm (connected components, near-square, similar size)
very likely rejects them.

**"Very likely" is exactly what the spike existed to eliminate, so Task 2 must
MEASURE it rather than assume it.** The keyboard is visible in six of the
twenty-five corpus images and in most real in-progress screenshots, so a Stage 1
that mistakes it for a board fails on the commonest input there is.

### 2. Empty rows carry MORE signal than filled ones

Measured: an empty tile row yields ~184 qualifying scanlines against ~55 for a
filled one, because a filled tile's letter glyph interrupts the flat colour and
splits the run. A one-guess board scored the highest count in the whole corpus.

Consequence for Stage 1: **an unplayed 6×5 grid is the cleanest lattice in the
image.** Do not rank candidate lattices by how "populated" they look, and do not
assume the strongest bands are the filled rows. The spec's "one to six populated
rows" is about what to ACCEPT, not about what will be easiest to find.

### 3. Severed columns defeat a five-equal-widths test at any threshold

Both of the spike's two misses were crops cutting through the first and last
columns, leaving partial-width outer tiles. Requiring three consecutive
equal-width runs at constant pitch recovered both, but that variant was scored on
the two images it was designed from and is unproven.

Under connected-components-plus-voting this may simply not arise — a severed tile
is a component that fails the near-square test, and the lattice still fits from
the interior three. **Task 2 must include severed-column crops in its acceptance
either way.**

### Two smaller corrections

- The spec says the accepted-guess list holds 14,855 entries. **The shipped
  artifact holds 12,972** (2,315 answers + 10,657 additional). Take the number
  from `src/lib/board-import/data/accepted-guesses.json`, never from the spec.
- A **16-bit PNG is a real input** — one is in the corpus. It cost the spike a
  silent index shift. The browser canvas path in Task 6 normalises everything to
  8-bit RGBA, so this cannot bite here; recorded so nobody rediscovers it.

---

## The synthesised corpus, and the discipline it must not break

The spike refused synthesised screenshots. This plan requires them. **Those are
not in conflict, and the distinction has to stay written down or it will be
re-litigated.**

- The spike was **measuring whether the approach works on real input.** A hit
  rate against images we rendered would have measured our renderer and produced a
  GO with nothing behind it.
- This plan uses synthesis for **regression testing of geometry and colour**,
  where we generate the ground truth and are therefore entitled to assert exact
  round-trips.

**The line is drawn at Stage 3.** Glyph accuracy CANNOT be validated against
synthesised text: templates derived from a font, tested against renders of the
same font, measure nothing. Stage 3's acceptance is measured on the **real
25-image corpus** in `v2/screenshots.local/`, hand-labelled.

Which forces the split in Task 8:

- **CI tests** run against synthesised data only, because the real corpus is
  gitignored and must stay that way — the repo is public and those are real
  phone screenshots.
- **A local validation script** measures against the real corpus and is run by
  hand. It reports numbers. It never reads in CI and never emits an image.

---

## Scope boundaries — explicitly OUT

- Non-NYT Wordle clones with different fonts and geometry.
- Other games' boards; bulk or historical backfill; parsing someone else's board
  to enter on their behalf. All named out of scope by the epic.
- Any server-side or vendor parse. The spec settles this: it runs in the browser,
  no upload, nothing to persist and nothing to disclose. That is also what makes
  the per-parse unit cost zero and the quota question moot.
- Server-side enforcement of the Pro gate. v2's established pattern is Phase 3's
  decision 1 — "read it, gate the UI, enforce nothing" — and a parse that runs
  entirely on the client cannot be meaningfully enforced anyway. Phase 5 owns
  whether that pattern changes; this plan does not revisit it.
- The share-text (emoji grid) import path. Still an interesting cheaper feature,
  still unbuilt, still out of scope here.

## Assumptions

1. **The answer is usually available.** `resolveBoard` derives it from a solved
   board's winning row, and the entry form already asks the player for it. Only a
   failed board resolves on the word list alone, which the spec accepts.
2. **Confirm-before-save makes a wrong parse cheap.** No parse is ever written
   silently, so the shipping bar is "knows when it failed", not "never wrong".
3. **The correction log is the real corpus.** It only starts accruing once real
   users touch the feature, which is the argument for shipping the UI rather than
   stopping at the parse core.

---

## Tasks

### Task 1: `Bitmap`, and the synthesised board renderer

**Files:** `v2/src/lib/board-import/bitmap.ts`, `v2/src/lib/board-import/testing/render.ts` (+ tests)

Pure. Draws a Wordle board into a `Bitmap` with no canvas and no font: solid
tiles only, letters deliberately absent (Task 4 owns glyphs). Parameterised over
theme (light/dark/high-contrast), tile size, gap, origin, crop box, and additive
noise.

**Done when:** a rendered 6×5 board round-trips through a pixel assertion at
three scales and three themes, and a severed-column crop and a status-bar band
are both expressible.

### Task 2: Stage 1 — lattice detection

**Files:** `v2/src/lib/board-import/stages/lattice.ts` (+ tests)

Connected components → near-square + similar-size filter → vote on
(x-pitch, y-pitch, origin) → accept a maximal lattice of exactly five columns and
one to six rows.

**Done when:** it finds the lattice on every Task 1 render including severed
crops; AND — the measurement that matters — **a keyboard-only crop from the real
corpus is REJECTED**, recorded as a number on `wordle-teams-418`. If the
near-square filter does not reject it, that is a design finding and the plan
stops for it.

### Task 3: Stage 2 — colour classification by relation

**Files:** `v2/src/lib/board-import/stages/colour.ts` (+ tests)

Cluster observed tile colours; the unsaturated cluster is `absent`. Try both
mappings for the remaining two and keep whichever Stage 4 finds consistent.

**Done when:** marks are correct on normal AND high-contrast renders, and
`grep -i '#[0-9a-f]\{6\}' stages/colour.ts` returns nothing — no hardcoded
palette anywhere.

### Task 4: Stage 3 — glyph reading

**Files:** `v2/src/lib/board-import/stages/glyphs.ts`, `data/glyph-templates.json` (+ tests)

Size-normalised template matching over 26 classes, returning sparse
`LetterScores`. No model, no training data, no inference dependency.

**Done when:** it returns per-letter confidences for a tile, and the templates
are generated by a committed script rather than hand-edited.

### Task 5: `parseBoard` — orchestration and the failure paths

**Files:** `v2/src/lib/board-import/parse.ts` (+ tests)

`Bitmap → BoardResolution`, wiring Stages 1–3 into the existing `resolveBoard`.

**Done when:** a property test does render → parse → assert exact round-trip over
random answers and random valid guesses; a **share-card** screenshot (no letters)
is detected and reported specifically rather than generically; and anything
unparseable returns whatever was recovered rather than nothing.

### Task 6: The browser adapter

**Files:** `v2/src/lib/board-import/adapter.ts` (+ jsdom test)

Paste event, file input and drag-drop → `Bitmap`, via canvas. The only file in
this plan that touches a browser API.

**Done when:** all three entry points yield a `Bitmap`, oversized images are
downscaled before parsing, and a jsdom test covers the paste path.

### Task 7: Stage 5 — confirm before save, and the correction log

**Files:** `v2/src/components/board-entry/import-*.tsx` (+ tests)

The parse pre-fills the existing entry form. The user confirms or corrects. Every
correction is logged as (tile, read, actual).

**Done when:** no parse is ever written without an explicit confirm; a failed
parse falls back to manual entry pre-filled with what was recovered; and a
correction writes a log row.

### Task 8: The Pro gate, and validation against the real corpus

**Files:** `v2/scripts/validate-board-import.mjs`, gate wiring

UI-only gate per Phase 3's pattern. Plus the local script that measures the real
25-image corpus and reports **numbers only, never an image**.

**Done when:** the gate hides import for a non-Pro account; the script reports
per-image and aggregate accuracy against hand-written labels; and that figure is
recorded on `wordle-teams-418`.

---

## Verification

All four gates separately after every task — `lint`, `typecheck`, `test:once`,
`build` — reading each exit code without a pipe. `pnpm e2e` is NOT part of them;
run it after Tasks 6–8, which touch rendered UI.

`v2/screenshots.local/` stays gitignored. The repo is public and those are real
phone screenshots. Report numbers, never images, and never `git add -f`.
