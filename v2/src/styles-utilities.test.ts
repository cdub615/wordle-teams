import { readFileSync } from 'node:fs'
import { execSync } from 'node:child_process'
import { describe, expect, test } from 'vitest'
import { codeOf } from './test-support/source-ast'

/**
 * TEXT UTILITIES THAT NAME A BACKGROUND TOKEN.
 *
 * WHY THIS EXISTS. The account menu's email line shipped as `text-muted` and
 * was invisible in BOTH themes. `text-muted` is a real, valid Tailwind utility
 * here — styles.css defines `--color-muted: var(--muted)` — but `--muted` is
 * `--surface-sunken`, a BACKGROUND token. So it paints text in the muted
 * background colour: #1c1c1c on a dark popover, #f4f4f5 on a light one.
 *
 * IT COMPILES, IT LINTS, IT TYPECHECKS, AND IT PASSES EVERY CONTRAST TEST IN
 * styles.test.ts, because that file measures TOKENS against surfaces and has no
 * idea which utility a component actually reached for. The only signal was a
 * human looking at the screen and saying they could not read it.
 *
 * THE TRAP IS THE NAMING, and it will catch the next person too: the TOKEN is
 * `--text-muted`, so `text-muted` is the utility you reach for. The utility
 * that resolves to that token is `text-muted-foreground`, via
 * `--muted-foreground`. One character of difference in the mental model, and
 * the wrong one is not an error anywhere.
 */
const css = readFileSync(new URL('./styles.css', import.meta.url), 'utf8')

/**
 * The `--color-*` names that resolve to a SURFACE, and are therefore wrong as a
 * text colour.
 *
 * LISTED, NOT PATTERN-MATCHED, and the first version of this test proves why.
 * It matched any target starting with `accent`, which caught `accent-solid` —
 * the brand green, a legitimate TEXT colour that V2-ADDENDUM §7a row 4 records
 * being darkened to 5.02:1 specifically so it could be read. A guard that cries
 * wolf on correct code gets deleted, so the set is enumerated.
 *
 * DELIBERATELY EXCLUDED, because `text-<name>` is legitimate for each:
 * `primary`, `secondary`, `destructive`, `success`, `warning`, `danger`,
 * `accent-solid`, `brand-*`, `wordle-*`, `ring`, and every `*-foreground`.
 * Those are solid colours meant to be painted WITH; the ones below are the
 * colours meant to be painted ON.
 */
const backgroundColorUtilities = [
  'background',
  'card',
  'popover',
  'muted',
  'accent',
  'surface',
  'surface-sunken',
  'surface-inverse',
  'border',
  'input',
]

/** Every className string in the component and route source. */
const sources = execSync('git ls-files "src/**/*.tsx"', { encoding: 'utf8' })
  .split('\n')
  .filter(Boolean)

test('every name guarded here is really a --color-* utility that styles.css defines', () => {
  // Otherwise the list silently rots into guarding nothing: a renamed token
  // leaves an entry that can never match, and the file goes on passing.
  for (const name of backgroundColorUtilities) {
    expect(css, `--color-${name} is not defined; this guard is dead`).toContain(`--color-${name}:`)
  }
})

describe('no component paints TEXT with a BACKGROUND token', () => {
  for (const file of sources) {
    test(file, () => {
      /**
       * COMMENTS STRIPPED, the pattern routes.test.ts uses so that an
       * assertion reads the CODE. It is load-bearing here: this very file's
       * header, feature-cards.tsx and maintenance.tsx all DISCUSS these
       * utilities in prose, and the first version of this test failed on all
       * three — flagging the explanations of the bug rather than the bug.
       *
       * Note the separate, opposite trap recorded in ui/calendar.tsx: Tailwind
       * 4 scans raw file text INCLUDING comments, so a utility named in prose
       * is still GENERATED into the stylesheet. That costs an unused rule and
       * nothing else; it is not what this test is about.
       */
      const source = codeOf(readFileSync(new URL(`../${file}`, import.meta.url), 'utf8'))
      const offenders: string[] = []
      for (const name of backgroundColorUtilities) {
        // `text-muted` but not `text-muted-foreground`; word-bounded so
        // `text-mutedish` cannot match either.
        const used = new RegExp(`\\btext-${name}(?![\\w-])`, 'g')
        for (const [match] of source.matchAll(used)) {
          offenders.push(`${match} (did you mean text-${name}-foreground?)`)
        }
      }
      expect(offenders, `${file} paints text with a background token`).toEqual([])
    })
  }
})


/**
 * AN INSET DIALOG MUST ROUND ITS OWN CORNERS.
 *
 * THE RULE MOVED INTO THE COMPONENT (wordle-teams-2uet) AND THIS GUARD STAYED.
 * ui/dialog.tsx used to round at `sm:` and above only — stock shadcn, and right
 * for a panel left full width on a phone — so every caller that narrowed the
 * panel had to remember to round it too. Five of seven did; settings-dialog.tsx
 * shipped with the `w-11/12` and not the `rounded-lg` and was the only surface
 * in the app with square corners. The default now carries both, so no caller
 * has to.
 *
 * WHAT IS LEFT TO CHECK IS THE NEXT CALLER. A call site can still narrow the
 * panel further, or opt back into full bleed, and the pairing is exactly as
 * easy to get half right as it was before. The first case below is what stops
 * the loop from passing vacuously now that no caller narrows anything: it reads
 * the component's own default and fails if the pair comes apart THERE, which is
 * the single place it would now go wrong for everybody at once.
 *
 * NOTHING ELSE CAN SEE THIS. It type-checks, lints and builds identically
 * either way, and styles.test.ts measures colour tokens.
 * ui/dialog.hook.test.ts asserts the rendered element; this asserts the source,
 * for every file that never renders under vitest.
 */
describe('a dialog that narrows itself also rounds itself', () => {
  const dialogs = sources.filter((file) => readFileSync(new URL(`../${file}`, import.meta.url), 'utf8').includes('<DialogContent'))

  test('the shared default narrows and rounds, so no caller has to', () => {
    // The pair, in ui/dialog.tsx's own class string. Red if either half is
    // dropped, and red if `rounded-lg` retreats behind `sm:` again — which is
    // the specific regression that would put square corners back on every
    // phone-width dialog in the app at once.
    const component = codeOf(
      readFileSync(new URL('./components/ui/dialog.tsx', import.meta.url), 'utf8'),
    )
    const [defaults] = component.match(/"fixed left-\[50%\][^"]*"/) ?? []
    expect(defaults, "ui/dialog.tsx's DialogContent class string moved").toBeDefined()
    expect(defaults).toMatch(/\bw-\d+\/\d+\b/)
    expect(defaults).toMatch(/(?<![\w:-])rounded-lg\b/)
  })

  test('there are dialogs to check, so this cannot pass vacuously', () => {
    expect(dialogs.length).toBeGreaterThan(3)
  })

  for (const file of dialogs) {
    test(file, () => {
      const source = codeOf(readFileSync(new URL(`../${file}`, import.meta.url), 'utf8'))
      // Each <DialogContent ...> opening tag, attributes and all, up to the
      // first `>` that is not inside a brace expression.
      for (const [tag] of source.matchAll(/<DialogContent[^>]*>/g)) {
        if (!/\bw-\d+\/\d+\b/.test(tag)) continue
        expect(
          tag,
          `${file} narrows a DialogContent without rounding it — pair w-N/M with rounded-lg`,
        ).toMatch(/\brounded-/)
      }
    })
  }
})
