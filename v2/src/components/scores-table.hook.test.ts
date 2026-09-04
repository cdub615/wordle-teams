// @vitest-environment jsdom
//
// jsdom for the same reason dashboard-skeletons.hook.test.ts uses it, and
// `.test.ts` not `.test.tsx` because vitest.config.ts's glob is
// `src/**/*.test.ts` — elements go through createElement by hand.
//
// WHY THIS FILE EXISTS: the changes in this task are all invisible to the
// other gates. Dropping the self-highlight, the today tint, or the name cap all
// type-check, lint, build and pass every other test — the table just silently
// stops answering the question it was changed to answer.
//
// TWO OF THE ASSERTIONS BELOW USED TO BE THE BUG, NOT THE TEST. The name-width
// test forbade `md:w-max md:pr-px` — the exact class that made desktop names
// visible — so a fix that restored a width could never pass it, and this file
// itself is what shipped wordle-teams-5jcn.19. Both rewritten sections now pin
// BOTH halves of their property (capped AND has a width; opaque AND a single
// bg-* utility) instead of forbidding one string, and both were proven to go
// red when either half is individually broken — see the comments inline.
import { readFileSync } from 'node:fs'
import { describe, expect, test } from 'vitest'
import { pinnedCellClassName } from './scores-table.tsx'

// A cwd-relative path, NOT `new URL(..., import.meta.url)` — see
// dashboard-skeletons.hook.test.ts's comment on the same line for why: this
// file is also jsdom, and jsdom breaks that resolution the same way there.
const source = readFileSync('src/components/scores-table.tsx', 'utf8')
const stylesSource = readFileSync('src/styles.css', 'utf8')

// The name div's actual `className` VALUE, not just "this text appears
// somewhere in the file" — the comment directly above that div in the
// source spells out both `md:max-w-[12ch]` and `md:w-fit` in prose, so an
// unanchored `source.toMatch(...)` would keep passing even if either class
// were deleted from the real attribute, as long as the comment still
// mentioned it. Anchored on the literal, known-unique prefix of that one
// attribute instead.
const nameDivClassMatch = source.match(/className="(invisible h-0 w-0 md:visible[^"]*)"/)

describe('the additive changes are present and are not decorative', () => {
  test('the name column is capped, so one long name cannot steal the day columns', () => {
    // The latent bug the cap fixes: an uncapped `md:w-max` let a single long
    // name widen the pinned column and squeeze every day column beside it.
    expect(nameDivClassMatch).not.toBeNull()
    expect(nameDivClassMatch![1]).toMatch(/md:max-w-\[12ch\]/)
  })

  test('the name column has a width restored at md, so the cap does not zero it out (wordle-teams-5jcn.19)', () => {
    // `max-width` is a ceiling, not a width. The base breakpoint sets `w-0`;
    // without a `width` utility of its own at `md`, that `0` survives
    // unopposed and the name renders at zero width — this is exactly what
    // shipped: rank numbers only, no names, on desktop.
    expect(nameDivClassMatch).not.toBeNull()
    expect(nameDivClassMatch![1]).toMatch(/\bmd:w-fit\b/)
  })

  test('the full name survives as a title attribute when it is ellipsed', () => {
    expect(source).toMatch(/title=/)
  })

  test('the collision rule is imported, not restated', () => {
    // The panel and the table must call the same person the same thing. A
    // second inline copy of this rule is how they drift apart.
    expect(source).toContain("from '#/lib/display-names.ts'")
    expect(source).not.toContain('duplicateFirstNames')
  })
})

describe('the pinned cell keeps a single, opaque background when marking the caller as themself', () => {
  // NOT a source-text assertion, deliberately: `cn(pinned, isMe && 'bg-muted/50')`
  // and `cn(pinned, isMe && 'bg-pinned-self')` are both perfectly fine
  // STRINGS — a source scan cannot tell them apart, and the former shipped
  // once, passed every gate and every test above it, and only failed at
  // runtime: tailwind-merge treats every `bg-*` utility as one conflict
  // group and keeps only the last one, so it silently drops the pinned
  // cell's opaque base. Calling the real, exported `pinnedCellClassName`
  // exercises the actual tailwind-merge composition instead of the text
  // sitting in the file.
  //
  // THIS IS THE MECHANICAL TEST THAT CATCHES TWO CONFLICTING `bg-*` CLASSES
  // — asserting the exact surviving class, not merely that "a" bg-* class
  // survived, because tailwind-merge already always collapses to exactly
  // one: a naive `bg-muted/50` fix collapses to one class too, and that one
  // class is still wrong (translucent). Proven to discriminate: reverting
  // `pinnedCellClassName` to `cn(pinned, isMe && 'bg-muted/50')` turns the
  // isMe-true assertion below red (`['bg-muted/50']` !== `['bg-pinned-self']`).
  test('bg-background is the only background utility when the row is not the caller’s', () => {
    const className = pinnedCellClassName('sticky left-0 z-10 bg-background', false)
    expect(className.split(' ').filter((c) => c.startsWith('bg-'))).toEqual(['bg-background'])
  })

  test('bg-pinned-self replaces bg-background — rather than losing the fight to it, or riding alongside it — when the row is the caller’s', () => {
    const className = pinnedCellClassName('sticky left-0 z-10 bg-background', true)
    expect(className.split(' ').filter((c) => c.startsWith('bg-'))).toEqual(['bg-pinned-self'])
  })

  test('the ring treatment is gone (wordle-teams-5jcn.20 — the owner asked for the row tint instead)', () => {
    expect(source).not.toMatch(/ring-2 ring-inset ring-ring/)
  })

  // Guards the OTHER way a fix here could look right and still be wrong: a
  // `.bg-pinned-self` that passes the two class-name assertions above but is
  // itself defined as some translucent colour (e.g. a bare rgba/opacity
  // shorthand) would still show the day columns through the pinned cell on
  // the caller's own row — the class-name check alone cannot see that,
  // only the CSS rule body can. Proven to discriminate: replacing the
  // `color-mix(...)` value with e.g. `var(--muted)` alone (no `--background`
  // reference — i.e. losing the "opaque composite" property) turns the
  // `var(--background)` assertion red.
  test('bg-pinned-self is an opaque composite of --muted over --background, not a bare translucent colour', () => {
    const rule = stylesSource.match(/\.bg-pinned-self\s*\{([^}]*)\}/)
    expect(rule).not.toBeNull()
    const body = rule![1]
    expect(body).toMatch(/color-mix/)
    expect(body).toMatch(/var\(--muted\)/)
    expect(body).toMatch(/var\(--background\)/)
  })
})
