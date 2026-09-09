/**
 * The iOS launch-screen matrix, and the media queries that select from it.
 *
 * WHY THIS IS DATA IN src/ RATHER THAN A TABLE INSIDE THE GENERATOR SCRIPT.
 * Two consumers need the same matrix and must never disagree: routes/__root.tsx
 * emits one <link rel="apple-touch-startup-image"> per entry, and
 * scripts/build-splash-screens.mjs renders one image per entry. If the link set
 * and the image set drift, iOS matches a query whose file does not exist and
 * shows the blank hold — silently, and only on the affected device.
 *
 * A WRONG MEDIA QUERY FAILS SILENTLY, WHICH IS WHY THE STRINGS ARE PINNED BY
 * TESTS. There is no error, no console warning and no visual difference from
 * "we shipped nothing": the device simply falls back to the black screen this
 * whole epic exists to remove. Same reasoning as lib/seo.ts holding its tag
 * list as a data structure — the output is the thing worth asserting.
 */

/** A device's screen in CSS PIXELS (points), always as measured in portrait. */
export interface SplashDevice {
  readonly width: number
  readonly height: number
  readonly ratio: number
}

export type SplashOrientation = 'portrait' | 'landscape'
export type SplashTheme = 'light' | 'dark'

/**
 * One screen in the matrix.
 *
 * `kind` is not decoration: it decides which ORIENTATIONS an entry generates
 * (see `splashLinks`) and it is what the phone/tablet disjointness test keys
 * on. `name` is a slug and appears in the filename, so it must stay file-safe
 * and unique — both pinned by tests.
 */
export interface SplashDeviceEntry extends SplashDevice {
  readonly name: string
  readonly kind: 'phone' | 'tablet'
}

/**
 * Every screen we ship a launch image for, in CSS POINTS as measured in
 * PORTRAIT, with the pixel ratio that disambiguates same-size devices.
 *
 * THE TRIPLE (width, height, ratio) IS THE PRIMARY KEY. `splashMedia` is a
 * pure function of those three fields and nothing else, so two entries sharing
 * a triple would emit identical media attributes and one would silently shadow
 * the other. 414x896 is why `ratio` is in the key: XR and 11 are @2, XS Max and
 * 11 Pro Max are @3 at the same point size.
 *
 * A DEVICE THAT IS NOT LISTED IS NOT BROKEN, it just keeps today's behaviour —
 * the blank hold. That is what makes it safe to ship a matrix that cannot be
 * exhaustive, and it is why absence is never urgent.
 */
export const SPLASH_DEVICES: readonly SplashDeviceEntry[] = [
  // --- phones. Portrait only: this is a portrait word game, and an iPhone
  //     landscape launch degrades to today's behaviour by design.
  { name: 'iphone-se1', kind: 'phone', width: 320, height: 568, ratio: 2 },
  { name: 'iphone-8', kind: 'phone', width: 375, height: 667, ratio: 2 },
  { name: 'iphone-8-plus', kind: 'phone', width: 414, height: 736, ratio: 3 },
  { name: 'iphone-x', kind: 'phone', width: 375, height: 812, ratio: 3 },
  { name: 'iphone-xr', kind: 'phone', width: 414, height: 896, ratio: 2 },
  { name: 'iphone-xs-max', kind: 'phone', width: 414, height: 896, ratio: 3 },
  { name: 'iphone-12', kind: 'phone', width: 390, height: 844, ratio: 3 },
  { name: 'iphone-12-pro-max', kind: 'phone', width: 428, height: 926, ratio: 3 },
  { name: 'iphone-15', kind: 'phone', width: 393, height: 852, ratio: 3 },
  { name: 'iphone-15-plus', kind: 'phone', width: 430, height: 932, ratio: 3 },
  { name: 'iphone-16-pro', kind: 'phone', width: 402, height: 874, ratio: 3 },
  { name: 'iphone-16-pro-max', kind: 'phone', width: 440, height: 956, ratio: 3 },

  // --- tablets. Portrait AND landscape, because iPads are used in landscape
  //     constantly; portrait-only here would leave the orientation that device
  //     class most needs still showing the black hold.
  { name: 'ipad-9-7', kind: 'tablet', width: 768, height: 1024, ratio: 2 },
  { name: 'ipad-mini-6', kind: 'tablet', width: 744, height: 1133, ratio: 2 },
  { name: 'ipad-10-2', kind: 'tablet', width: 810, height: 1080, ratio: 2 },
  { name: 'ipad-air-11', kind: 'tablet', width: 820, height: 1180, ratio: 2 },
  { name: 'ipad-pro-10-5', kind: 'tablet', width: 834, height: 1112, ratio: 2 },
  { name: 'ipad-pro-11', kind: 'tablet', width: 834, height: 1194, ratio: 2 },
  { name: 'ipad-pro-11-m4', kind: 'tablet', width: 834, height: 1210, ratio: 2 },
  { name: 'ipad-pro-12-9', kind: 'tablet', width: 1024, height: 1366, ratio: 2 },
  { name: 'ipad-pro-13-m4', kind: 'tablet', width: 1032, height: 1376, ratio: 2 },
]

/**
 * The pixel dimensions the image for this entry must have.
 *
 * THE AXES SWAP HERE AND DELIBERATELY NOT IN `splashMedia`. iOS ignores a
 * startup image whose pixels do not match the rendering surface exactly, so a
 * landscape entry needs a landscape-shaped FILE behind a query that still
 * states the portrait device points. Getting either half backwards produces the
 * same symptom as shipping nothing.
 */
export function splashPixels(
  device: SplashDevice,
  orientation: SplashOrientation,
): { width: number; height: number } {
  const [w, h] =
    orientation === 'landscape' ? [device.height, device.width] : [device.width, device.height]
  return { width: w * device.ratio, height: h * device.ratio }
}

export function splashMedia(
  device: SplashDevice,
  orientation: SplashOrientation,
  theme: SplashTheme,
): string {
  return [
    `(prefers-color-scheme: ${theme})`,
    `(device-width: ${device.width}px)`,
    `(device-height: ${device.height}px)`,
    `(-webkit-device-pixel-ratio: ${device.ratio})`,
    `(orientation: ${orientation})`,
  ].join(' and ')
}

/** Where the generated images live, relative to the served origin. */
const SPLASH_DIR = '/splash'

/** Phones are portrait only; tablets get both. See the matrix comments. */
const ORIENTATIONS: Record<SplashDeviceEntry['kind'], readonly SplashOrientation[]> = {
  phone: ['portrait'],
  tablet: ['portrait', 'landscape'],
}

const THEMES: readonly SplashTheme[] = ['light', 'dark']

/** One image to render and one <link> to emit — the same record serves both. */
export interface SplashTarget {
  readonly name: string
  readonly kind: SplashDeviceEntry['kind']
  readonly orientation: SplashOrientation
  readonly theme: SplashTheme
  /** Origin-relative path, used verbatim as the link href and the output file. */
  readonly file: string
  readonly media: string
  readonly pixels: { width: number; height: number }
}

/**
 * The full matrix, expanded.
 *
 * DERIVED RATHER THAN LISTED, so the <link> set in routes/__root.tsx and the
 * files written by scripts/build-splash-screens.mjs cannot drift apart: both
 * read this. A link whose file was never generated is a query iOS matches and
 * then finds nothing behind — the blank hold again, on one device, silently.
 */
export function splashTargets(): readonly SplashTarget[] {
  return SPLASH_DEVICES.flatMap((device) =>
    ORIENTATIONS[device.kind].flatMap((orientation) =>
      THEMES.map((theme) => ({
        name: device.name,
        kind: device.kind,
        orientation,
        theme,
        file: `${SPLASH_DIR}/${device.name}-${orientation}-${theme}.png`,
        media: splashMedia(device, orientation, theme),
        pixels: splashPixels(device, orientation),
      })),
    ),
  )
}
