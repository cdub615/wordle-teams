import { readFileSync } from 'node:fs'
import { describe, expect, test } from 'vitest'
import {
  SPLASH_DEVICES,
  appleWebAppMetaTags,
  splashLinkTags,
  splashMedia,
  splashPixels,
  splashTargets,
} from './splash-screens.ts'

describe('splashMedia', () => {
  test('a portrait query names the device points, the pixel ratio and the orientation', () => {
    expect(splashMedia({ width: 393, height: 852, ratio: 3 }, 'portrait', 'dark')).toBe(
      '(prefers-color-scheme: dark) and (device-width: 393px) and (device-height: 852px) and ' +
        '(-webkit-device-pixel-ratio: 3) and (orientation: portrait)',
    )
  })

  /*
    THE TRAP THIS PINS. `device-width` and `device-height` describe the SCREEN,
    not the current viewport, so they do NOT swap when the device rotates —
    only `orientation` changes. An implementation that helpfully swaps them for
    landscape produces a query that matches nothing, and matching nothing looks
    exactly like shipping no splash at all: black hold, no error, no warning.
  */
  test('a landscape query keeps the portrait device points and only flips the orientation', () => {
    const device = { width: 1032, height: 1376, ratio: 2 }
    const portrait = splashMedia(device, 'portrait', 'dark')
    const landscape = splashMedia(device, 'landscape', 'dark')

    expect(landscape).toBe(portrait.replace('(orientation: portrait)', '(orientation: landscape)'))
    expect(landscape).toContain('(device-width: 1032px)')
    expect(landscape).toContain('(device-height: 1376px)')
  })

  test('the theme is carried by prefers-color-scheme and nothing else changes', () => {
    const device = { width: 393, height: 852, ratio: 3 }

    expect(splashMedia(device, 'portrait', 'light')).toBe(
      splashMedia(device, 'portrait', 'dark').replace(
        '(prefers-color-scheme: dark)',
        '(prefers-color-scheme: light)',
      ),
    )
  })
})

describe('splashPixels', () => {
  /*
    THE INVERSE OF THE MEDIA-QUERY RULE ABOVE, AND THE PAIRING IS THE POINT.
    The query must NOT swap the device points; the IMAGE must. iOS ignores a
    startup image whose pixel dimensions do not match the rendering surface
    exactly, so a landscape entry needs a landscape-shaped file behind a query
    that still states the portrait points.
  */
  test('portrait multiplies the device points by the ratio', () => {
    expect(splashPixels({ width: 393, height: 852, ratio: 3 }, 'portrait')).toEqual({
      width: 1179,
      height: 2556,
    })
  })

  test('landscape swaps the axes before scaling', () => {
    expect(splashPixels({ width: 1032, height: 1376, ratio: 2 }, 'landscape')).toEqual({
      width: 2752,
      height: 2064,
    })
  })
})

describe('SPLASH_DEVICES', () => {
  /*
    THE ONE WAY THIS FEATURE CAN MAKE THINGS WORSE RATHER THAN MERELY
    NOT-BETTER (acceptance criterion 3 on wordle-teams-c0f).

    `splashMedia` is a pure function of exactly three fields, so the triple
    (width, height, ratio) FULLY DETERMINES the query. Two entries sharing a
    triple therefore emit byte-identical media attributes, and whichever link
    iOS reaches last wins — silently handing a device an image built for a
    different one. That is worse than the blank hold we started from, and
    nothing about it is visible in CI.

    414x896 is the case that actually occurs and the reason `ratio` is part of
    the key at all: iPhone XR/11 are @2 and XS Max/11 Pro Max are @3 at the
    same point size.
  */
  test('no two entries share a device-width/height/ratio triple', () => {
    const keys = SPLASH_DEVICES.map((d) => `${d.width}x${d.height}@${d.ratio}`)
    const duplicated = keys.filter((k, i) => keys.indexOf(k) !== i)

    expect(duplicated).toEqual([])
  })

  test('no tablet entry can match a phone viewport, or the reverse', () => {
    const key = (d: (typeof SPLASH_DEVICES)[number]) => `${d.width}x${d.height}@${d.ratio}`
    const phones = new Set(SPLASH_DEVICES.filter((d) => d.kind === 'phone').map(key))
    const tablets = new Set(SPLASH_DEVICES.filter((d) => d.kind === 'tablet').map(key))

    expect([...tablets].filter((t) => phones.has(t))).toEqual([])
    expect(phones.size).toBeGreaterThan(0)
    expect(tablets.size).toBeGreaterThan(0)
  })

  test('every entry names a file-safe slug, so two entries cannot collide on disk', () => {
    const names = SPLASH_DEVICES.map((d) => d.name)

    for (const name of names) expect(name).toMatch(/^[a-z0-9-]+$/)
    expect(new Set(names).size).toBe(names.length)
  })
})

describe('splashTargets', () => {
  /*
    ONE LIST FEEDS BOTH CONSUMERS, AND THAT IS THE POINT OF THE MODULE.
    routes/__root.tsx emits a <link> per target; scripts/build-splash-screens.mjs
    renders a file per target. Deriving both from the same array is what makes it
    impossible for the link set and the image set to disagree — the failure that
    would otherwise leave iOS matching a query whose file was never generated.
  */
  test('phones get portrait only, tablets get both orientations', () => {
    const targets = splashTargets()
    const phones = SPLASH_DEVICES.filter((d) => d.kind === 'phone').length
    const tablets = SPLASH_DEVICES.filter((d) => d.kind === 'tablet').length

    // 2 themes each; phones x1 orientation, tablets x2.
    expect(targets).toHaveLength(phones * 2 + tablets * 4)
    expect(
      targets.filter((t) => t.kind === 'phone' && t.orientation === 'landscape'),
    ).toEqual([])
    expect(
      targets.filter((t) => t.kind === 'tablet' && t.orientation === 'landscape'),
    ).toHaveLength(tablets * 2)
  })

  test('every target has a distinct file, so none can overwrite another', () => {
    const files = splashTargets().map((t) => t.file)

    expect(new Set(files).size).toBe(files.length)
    for (const file of files) expect(file).toMatch(/^\/splash\/[a-z0-9-]+\.png$/)
  })

  test('each target carries the media query and pixel size of its own entry', () => {
    for (const t of splashTargets()) {
      const device = SPLASH_DEVICES.find((d) => d.name === t.name)
      if (!device) throw new Error(`no device entry named ${t.name}`)

      expect(t.media).toBe(splashMedia(device, t.orientation, t.theme))
      expect(t.pixels).toEqual(splashPixels(device, t.orientation))
    }
  })
})

describe('the tags routes/__root.tsx emits', () => {
  test('declares the app web-app-capable, which is what makes iOS honour the images', () => {
    expect(appleWebAppMetaTags).toContainEqual({
      name: 'apple-mobile-web-app-capable',
      content: 'yes',
    })
  })

  /*
    PINNING A DECISION, NOT A BEHAVIOUR, AND ON PURPOSE.

    routes/__root.tsx records why `apple-mobile-web-app-status-bar-style:
    black-translucent` is deliberately NOT set: it forces light status-bar text
    regardless of theme, and this app has a light mode. The accepted cost is a
    top safe-area inset of 0 in iOS standalone.

    Adding `apple-mobile-web-app-capable` for the splash puts a tag with a very
    similar name right next to that argument, which is exactly the situation in
    which someone "completes the set" in good faith and silently reverses a
    reasoned decision. This test makes that reversal fail loudly instead. If the
    decision is ever revisited deliberately, this test is the thing to delete —
    and deleting it is a visible act.
  */
  test('does NOT set a status-bar style — see the argument in __root.tsx', () => {
    expect(appleWebAppMetaTags.map((t) => t.name)).not.toContain(
      'apple-mobile-web-app-status-bar-style',
    )
  })

  test('emits one startup-image link per target', () => {
    expect(splashLinkTags).toHaveLength(splashTargets().length)
    for (const tag of splashLinkTags) expect(tag.rel).toBe('apple-touch-startup-image')
  })

  /*
    THE LOOP CLOSED IN CI RATHER THAN ONLY AT GENERATE TIME. The generator
    asserts it wrote a file for every target, but nothing stopped someone
    deleting one afterwards, or adding a device entry and committing before
    re-running `pnpm build:splash`. A <link> whose file is missing is a query iOS
    matches and then finds nothing behind — the blank hold, on one device, with
    no error anywhere. readFileSync throwing IS the assertion, the same way
    about-screenshots.test.ts proves its images are in public/.
  */
  test('every link points at a file that is actually in public/', () => {
    for (const tag of splashLinkTags) {
      const file = new URL(`../../public${tag.href}`, import.meta.url)
      expect(() => readFileSync(file), `${tag.href} is not in public/`).not.toThrow()
    }
  })
})
