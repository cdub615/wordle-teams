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
import { codeOf } from '#/test-support/source-ast.ts'

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

  test('the today tint is wired to the day cell whose day matches today (wordle-teams-5jcn.27)', () => {
    // The one assertion this file's header comment has promised since it was
    // written and never had: scores-table.tsx puts `bg-accent/40` on the day
    // TableCell via `cn(day === today && 'bg-accent/40')`. codeOf() strips
    // comments first — the surrounding prose already narrates "the tint" in
    // English, so a plain `source.toContain` would keep passing even if the
    // real conditional were deleted, as long as that prose survived.
    //
    // Proven to discriminate: deleting `&& 'bg-accent/40'` from that
    // expression in scores-table.tsx turns this assertion red, confirmed
    // then reverted.
    expect(codeOf(source)).toContain("cn(day === today && 'bg-accent/40')")
  })

  test('the collision rule is imported, not restated', () => {
    // The panel and the table must call the same person the same thing. A
    // second inline copy of this rule is how they drift apart.
    expect(source).toContain("from '#/lib/display-names.ts'")
    expect(source).not.toContain('duplicateFirstNames')
  })
})

describe('the footer slot (ScoringLegend, folded in by wordle-teams-ha7u) sits outside the scroll container', () => {
  // A SOURCE-POSITION CHECK, consistent with this file's own convention of
  // reading scores-table.tsx as text rather than rendering it — rendering
  // the real component needs a live Convex/React Query provider this suite
  // does not stand up (see scores-table.hook.test.ts's header comment on why
  // pinnedCellClassName is exported specifically so ITS logic can be tested
  // without one). Positional rather than a plain `toContain`, because
  // `footer` is also mentioned in the prop's own type declaration earlier in
  // the file — a bare substring match would be satisfied by that alone and
  // would not notice the render moving inside the scroll wrapper.
  test('the footer renders after the closing </Table>, not before it', () => {
    const tableClose = source.indexOf('</Table>')
    const footerRender = source.indexOf('{footer && ')
    expect(tableClose).toBeGreaterThan(-1)
    expect(footerRender).toBeGreaterThan(tableClose)
  })

  test('scrollWrapperProps — the object handed to the Table primitive as its scroll container — never mentions footer', () => {
    // Proven to discriminate: moving the footer render INSIDE
    // `wrapperProps`/the Table's children (the exact bug the task warned
    // against — the legend sliding sideways with the day columns) would put
    // `footer` inside this slice too. Bounded to the object literal itself,
    // not the whole file, so a match can only come from that literal.
    const wrapperPropsBlock = source.slice(
      source.indexOf('const scrollWrapperProps'),
      source.indexOf('const lastEvaluatedKeyRef'),
    )
    expect(wrapperPropsBlock).not.toContain('footer')
  })

  test('the footer wrapper carries the hairline and matches the pinned cells’ own horizontal padding', () => {
    const footerDivMatch = source.match(
      /\{footer && <div className="([^"]*)">\{footer\}<\/div>\}/,
    )
    expect(footerDivMatch).not.toBeNull()
    expect(footerDivMatch![1]).toContain('border-t')
    expect(footerDivMatch![1]).toContain('border-line-subtle')
    // px-2 / md:px-4 — the same pair pinnedLeft/pinnedRight's own `rounded-tl-md
    // px-2 md:px-4` header cell uses, so the footer's content lines up with the
    // Player column's left edge rather than the frame's outer edge.
    expect(footerDivMatch![1]).toMatch(/\bpx-2\b/)
    expect(footerDivMatch![1]).toMatch(/\bmd:px-4\b/)
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
