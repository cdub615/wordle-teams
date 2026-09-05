// @vitest-environment jsdom
import { readFileSync } from 'node:fs'
import { describe, expect, test } from 'vitest'
import { codeOf } from '#/test-support/source-ast.ts'

// A cwd-relative path, NOT `new URL(..., import.meta.url)` — this file
// declares `@vitest-environment jsdom` above, and under jsdom
// `import.meta.url` is not a `file:` URL, so readFileSync answers "The URL
// must be of scheme file". See scoring-legend.hook.test.ts and
// dashboard-skeletons.hook.test.ts:181-187 for the reasoning; this file
// follows the same convention.
//
// wordle-teams-5jcn.14: nothing in this repo can render
// scoring-system-editor.tsx (Dialog/Sheet + useMediaQuery + Suspense query
// wiring), so this is source assertions only — it does NOT claim to prove
// the component renders, opens on the right preset, or that a click actually
// leaves Save the only write path. It proves what the SOURCE TEXT commits to.
const source = readFileSync('src/components/scoring-system-editor.tsx', 'utf8')

// Comments stripped, per source-ast.ts's own docstring, and used only for the
// negative assertions below — a header comment explaining "this does NOT
// call the mutation" (which this file's own comments do) must not be able to
// satisfy a check that the REAL code doesn't call it.
const code = codeOf(source)

describe('three options, derived from scoringSystem.ts rather than hand-listed', () => {
  test('imports the presets and the matcher from lib/scoringSystem.ts', () => {
    expect(source).toContain("from '../../convex/lib/scoringSystem.ts'")
    expect(source).toContain('SCORING_PRESETS')
    expect(source).toContain('scoringPresetOf')
  })

  // Custom is the one option with no constant `system` to read a label off,
  // so it is the one place a preset name is spelled out in this file.
  // Forgiving and Competitive are NOT spelled out here — they come from
  // SCORING_PRESETS, so this file cannot drift from scoringSystem.ts's names.
  test("'Custom' is the only preset name hand-written in this file", () => {
    expect(code).not.toContain("'Forgiving'")
    expect(code).not.toContain("'Competitive'")
    expect(source).toContain("label: 'Custom'")
  })

  test('the eight editable fields still come from SYSTEM_FIELDS, not a hand-written list', () => {
    expect(source).toContain('SYSTEM_FIELDS.map')
  })
})

describe('the three-way control is Radix RadioGroup, not hand-rolled', () => {
  test('imports RadioGroup and RadioGroupItem from the ui primitive', () => {
    expect(source).toContain("from '#/components/ui/radio-group.tsx'")
    expect(source).toContain('<RadioGroup')
    expect(source).toContain('<RadioGroupItem')
  })

  // A visible, programmatically-associated label on the GROUP, not just on
  // one option — a screen reader needs to hear what the three options are
  // options FOR before it hears any one of their names.
  test('the group carries a visible label wired in by aria-labelledby', () => {
    expect(source).toContain('PRESET_LABEL_ID')
    expect(source).toMatch(/<Label id=\{PRESET_LABEL_ID\}/)
    expect(source).toContain('aria-labelledby={PRESET_LABEL_ID}')
  })

  // Every RadioGroupItem is paired with its own <Label htmlFor>, the same
  // input/label association the eight point fields already use below.
  test('every preset option has its own associated Label', () => {
    expect(source).toContain('<RadioGroupItem value={id} id={`preset-${id}`}')
    expect(source).toContain('<Label htmlFor={`preset-${id}`}>{label}</Label>')
  })
})

describe('selecting a preset fills the draft and nothing more', () => {
  // Isolates handlePresetChange's own body, so this cannot be satisfied by
  // some other function in the file (e.g. handleSubmit) happening to also
  // avoid the word "mutateAsync" — and codeOf strips comments first so a
  // comment describing what the handler does NOT do cannot trip it either.
  const handlerStart = code.indexOf('const handlePresetChange')
  const handlerEnd = code.indexOf('const parsed', handlerStart)

  test('the handler is found in the file', () => {
    expect(handlerStart).toBeGreaterThan(-1)
    expect(handlerEnd).toBeGreaterThan(handlerStart)
  })

  const handlerBody = code.slice(handlerStart, handlerEnd)

  test('does not call the save mutation', () => {
    expect(handlerBody).not.toContain('mutateAsync')
    expect(handlerBody).not.toContain('save.mutate')
  })

  test('does call setDraft and setPreset', () => {
    expect(handlerBody).toContain('setDraft(')
    expect(handlerBody).toContain('setPreset(')
  })

  // The ONLY place mutateAsync is called anywhere in the file — i.e. Save
  // really is the one write path, not merely unreferenced by this one
  // handler while some other new function also calls it.
  test('mutateAsync is called exactly once in the whole file, inside handleSubmit', () => {
    const matches = code.match(/mutateAsync/g) ?? []
    expect(matches).toHaveLength(1)
    const submitStart = code.indexOf('const handleSubmit')
    const submitEnd = code.indexOf('const body')
    expect(code.indexOf('mutateAsync')).toBeGreaterThan(submitStart)
    expect(code.indexOf('mutateAsync')).toBeLessThan(submitEnd)
  })
})

describe('the initial selection is derived from the team system, not assumed custom', () => {
  test('scoringPresetOf(system) seeds state and re-derives on open', () => {
    const matches = code.match(/scoringPresetOf\(system\)/g) ?? []
    // Once for the lazy useState initializer, once for the re-seed-on-open
    // effect — a component mounted unconditionally (only Radix's Content
    // toggles) means the effect is what re-derives it on every re-open, same
    // reason `asDraft(system)` itself appears twice.
    expect(matches.length).toBeGreaterThanOrEqual(2)
  })
})
