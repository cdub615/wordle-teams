import { describe, expect, test } from 'vitest'
import { assertSplashBuild, bareMark, readToken } from './build-splash-screens.mjs'

/**
 * Facts for a build where everything went right. Each test below spoils exactly
 * one of them, so a failure names the condition that broke rather than "the
 * assertion returned something".
 */
const sound = () => ({
  targets: [
    { file: '/splash/iphone-15-portrait-dark.png', pixels: { width: 1179, height: 2556 } },
    { file: '/splash/ipad-pro-13-m4-landscape-light.png', pixels: { width: 2752, height: 2064 } },
  ],
  produced: [
    {
      file: '/splash/iphone-15-portrait-dark.png',
      width: 1179,
      height: 2556,
      distinctColours: 42,
    },
    {
      file: '/splash/ipad-pro-13-m4-landscape-light.png',
      width: 2752,
      height: 2064,
      distinctColours: 51,
    },
  ],
  strays: [],
  fontsLoaded: true,
})

describe('assertSplashBuild', () => {
  test('a sound build has no problems', () => {
    expect(assertSplashBuild(sound())).toEqual([])
  })

  test('a target with no file on disk is a problem, and is named', () => {
    const facts = sound()
    facts.produced = facts.produced.slice(1)

    const problems = assertSplashBuild(facts)

    expect(problems).toHaveLength(1)
    expect(problems[0]).toContain('/splash/iphone-15-portrait-dark.png')
  })

  /*
    iOS IGNORES A STARTUP IMAGE WHOSE PIXELS DO NOT MATCH THE SCREEN EXACTLY,
    and it does so silently — the device falls back to the blank hold. A
    one-pixel error is therefore indistinguishable, in the field, from shipping
    nothing, which is why this is checked rather than trusted.
  */
  test('a file whose dimensions do not match its target is a problem', () => {
    const facts = sound()
    facts.produced[0].height = 2555

    const problems = assertSplashBuild(facts)

    expect(problems).toHaveLength(1)
    expect(problems[0]).toContain('1179x2555')
    expect(problems[0]).toContain('1179x2556')
  })

  /*
    THE SILENT FAILURE THIS WHOLE FUNCTION EXISTS FOR, and the direct analogue
    of build-sw.mjs's non-uniformity reasoning. If the template fails to render
    — a font that never loaded, a CSS error, an SVG that did not inline — the
    screenshot is a perfectly valid PNG of a solid colour, at exactly the right
    dimensions, and every other check here passes. What ships is a branded
    launch screen with no branding on it, and nobody finds out until they look
    at a phone.
  */
  test('a solid-colour file is a problem even though its dimensions are right', () => {
    const facts = sound()
    facts.produced[1].distinctColours = 1

    const problems = assertSplashBuild(facts)

    expect(problems).toHaveLength(1)
    expect(problems[0]).toContain('ipad-pro-13-m4-landscape-light.png')
    expect(problems[0]).toMatch(/solid|uniform|blank/i)
  })

  /*
    DRIFT IN THE OTHER DIRECTION. Renaming or removing a device entry leaves the
    old file behind, still committed and still served. Harmless on its own, but
    it makes the directory stop being a description of the matrix, which is the
    property that lets anyone trust the link set.
  */
  test('a file on disk that no target claims is a problem', () => {
    const facts = sound()
    facts.strays = ['/splash/iphone-14-portrait-dark.png']

    const problems = assertSplashBuild(facts)

    expect(problems).toHaveLength(1)
    expect(problems[0]).toContain('iphone-14-portrait-dark.png')
  })

  /*
    THE FIDELITY HOLE THAT NO OTHER CHECK HERE CAN SEE. Inter arrives from
    Google Fonts via the @import in src/styles.css, so rendering the wordmark
    needs the network. If that fetch fails, Chromium falls back to system-ui and
    produces a splash that is the right size, richly coloured, and subtly the
    WRONG TYPEFACE from the header it is meant to precede. Dimensions pass,
    non-uniformity passes, and the defect is only visible by holding the splash
    next to the app.

    Network in the generator is legitimate — it is run on demand and its output
    is committed, exactly like scripts/fetch-wordlists.mjs. Network that fails
    QUIETLY is not.
  */
  test('a build where the webfont never loaded is a problem', () => {
    const facts = sound()
    facts.fontsLoaded = false

    const problems = assertSplashBuild(facts)

    expect(problems).toHaveLength(1)
    expect(problems[0]).toMatch(/font/i)
  })

  test('every problem is reported, not just the first', () => {
    const facts = sound()
    facts.produced[0].height = 1
    facts.produced[1].distinctColours = 1
    facts.strays = ['/splash/gone.png']
    facts.fontsLoaded = false

    expect(assertSplashBuild(facts)).toHaveLength(4)
  })
})

describe('readToken', () => {
  /*
    A REAL BUG, CAUGHT BY RUNNING THE SCRIPT AND PINNED HERE SO IT CANNOT COME
    BACK. The first version scoped the light theme with `css.split('.dark')[0]`,
    which looks right until you notice src/styles.css line 7 is

        @custom-variant dark (&:is(.dark *));

    — a `.dark` OUTSIDE any block, 160 lines above `:root`. The split truncated
    the stylesheet before the tokens existed, so every light colour went
    missing. It failed loudly only because readToken throws instead of
    defaulting; with a fallback colour it would have shipped the wrong palette.
  */
  const css = `
@custom-variant dark (&:is(.dark *));

:root {
  --background: #fafafa;
  --brand-via: #22c55e;
}

.dark {
  --background: #0a0a0a;
  --brand-via: #86efac;
}
`

  test('reads a light token from the :root block, past an earlier .dark mention', () => {
    expect(readToken(css, 'background', 'light')).toBe('#fafafa')
    expect(readToken(css, 'brand-via', 'light')).toBe('#22c55e')
  })

  test('reads a dark token from the .dark block', () => {
    expect(readToken(css, 'background', 'dark')).toBe('#0a0a0a')
    expect(readToken(css, 'brand-via', 'dark')).toBe('#86efac')
  })

  test('throws rather than defaulting when a token is absent', () => {
    expect(() => readToken(css, 'nonexistent', 'light')).toThrow(/--nonexistent/)
  })
})

describe('bareMark', () => {
  /*
    public/wt-icon.svg IS THE APP ICON, and an app icon carries its own
    container: a #0a0a0a disc behind the gradient mark. That is right on a home
    screen and wrong on a full-screen splash, where it reads as an icon pasted
    onto a page.

    It was also inconsistent BY COINCIDENCE rather than by design. On the dark
    splash the disc is invisible because it happens to equal --background; on
    the light splash it rendered as a black badge on #fafafa. Had the dark
    --background ever moved off #0a0a0a, a disc would have faded into view on
    every dark launch screen with nothing to catch it.

    Stripping the container makes both themes show the same bare mark by
    construction, and removes the coupling to one palette value.
  */
  const icon = `<svg viewBox='0 0 40 40'>
  <defs>
    <linearGradient id='svg-gradient'><stop offset='0%' stop-color='#17a64b' /></linearGradient>
    <path id="wt-logo" fill='url(#svg-gradient)' d='M4.5 6.375a4.125 4.125 0 118.25 0z' />
  </defs>
  <circle cx="20" cy="20" r="17" fill="#0a0a0a" />

  <use xlink:href="#wt-logo" transform="translate(8.5, 8.5)" />
</svg>`

  test('removes the icon container disc', () => {
    expect(bareMark(icon)).not.toContain('<circle')
  })

  test('keeps the gradient, the path and the use that draws them', () => {
    const bare = bareMark(icon)

    expect(bare).toContain('linearGradient')
    expect(bare).toContain('id="wt-logo"')
    expect(bare).toContain('<use')
    expect(bare).toContain('<svg')
  })

  test('leaves an svg with no disc untouched', () => {
    const noDisc = '<svg><use xlink:href="#wt-logo" /></svg>'

    expect(bareMark(noDisc)).toBe(noDisc)
  })
})
