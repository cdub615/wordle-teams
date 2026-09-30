import { readFileSync } from 'node:fs'
import { describe, expect, test } from 'vitest'
import UPNG from 'upng-js'

/**
 * WHAT `purpose: "maskable"` ACTUALLY PROMISES, and why it is worth a test.
 *
 * A maskable icon is cropped by the launcher to a shape IT chooses — circle,
 * squircle, rounded square, teardrop — and platforms scale it up so the safe
 * zone fills that mask. Two things follow, and the manifest got the first of
 * them exactly backwards (wordle-teams-c0f.9): the image must FILL ITS CANVAS
 * with no transparency, and its content must sit inside the central 80%.
 *
 * A circle drawn in a square canvas satisfies neither by construction. It has
 * empty corners, so a squircle mask shows the wallpaper through them, and the
 * upscaling crops the disc's own edges. That is what wt-icon-144x144.png and
 * wt-icon.svg were declaring themselves fit for while the two full-bleed PNGs
 * declared plain "any".
 *
 * NOTHING ELSE IN THE REPO WOULD CATCH THIS. The manifest is valid JSON, the
 * files all exist and are the right sizes, and the failure is a rendering
 * judgement made by a launcher we have no device for. It is checkable only by
 * looking at the pixels, which is what this file does.
 */

const manifest = JSON.parse(
  readFileSync(new URL('../public/manifest.json', import.meta.url), 'utf8'),
) as { icons: Array<{ src: string; sizes: string; type?: string; purpose?: string }> }

const isMaskable = (icon: { purpose?: string }) =>
  (icon.purpose ?? '').split(/\s+/).includes('maskable')

const maskableIcons = manifest.icons.filter(isMaskable)

/**
 * A Buffer's bytes as a standalone ArrayBuffer, which is what UPNG.decode takes.
 *
 * NOT `buf.buffer`. A Buffer is a VIEW, and for small reads Node hands back a
 * view into a shared pool — so `.buffer` can carry bytes belonging to entirely
 * different files, and the decode would either fail or, worse, succeed on the
 * wrong pixels. Slicing by the view's own offset and length is correct whether
 * or not this particular read was pooled.
 */
const bytesOf = (buf: Buffer): ArrayBuffer =>
  buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength) as ArrayBuffer

/** RGBA at a pixel, decoded from the PNG on disk. */
function pixelAt(src: string, x: number, y: number) {
  const bytes = readFileSync(new URL(`../public${src}`, import.meta.url))
  const png = UPNG.decode(bytesOf(bytes))
  const rgba = new Uint8Array(UPNG.toRGBA8(png)[0])
  const offset = (y * png.width + x) * 4
  return {
    r: rgba[offset],
    g: rgba[offset + 1],
    b: rgba[offset + 2],
    a: rgba[offset + 3],
    width: png.width,
    height: png.height,
  }
}

describe('manifest icons declared maskable', () => {
  test('there is at least one, or the declaration has been dropped entirely', () => {
    expect(maskableIcons.length).toBeGreaterThan(0)
  })

  /*
    THE RULE IS RASTER-ONLY, AND THAT IS AN ADMISSION RATHER THAN A PREFERENCE.
    A full-bleed SVG could legitimately be maskable; ours is a bare <circle> in
    a 0 0 40 viewBox, so its corners are empty. Verifying an arbitrary SVG's
    raster coverage means rendering it, which is a browser's job and not a unit
    test's — so the rule this suite can actually enforce is that anything
    claiming maskable must be a PNG we can decode. If a full-bleed SVG is ever
    wanted, changing this test is the deliberate act that allows it.
  */
  test('are PNGs, because that is what this suite can verify', () => {
    for (const icon of maskableIcons) {
      expect(icon.src, `${icon.src} claims maskable`).toMatch(/\.png$/)
    }
  })

  test('fill their canvas — all four corners fully opaque', () => {
    for (const icon of maskableIcons) {
      const probe = pixelAt(icon.src, 0, 0)
      const corners = [
        ['top-left', 0, 0],
        ['top-right', probe.width - 1, 0],
        ['bottom-left', 0, probe.height - 1],
        ['bottom-right', probe.width - 1, probe.height - 1],
      ] as const

      for (const [name, x, y] of corners) {
        const { a } = pixelAt(icon.src, x, y)
        expect(a, `${icon.src} is transparent at its ${name} corner`).toBe(255)
      }
    }
  })

  /*
    THE OTHER HALF OF THE PROMISE. Content outside the central 80% is cropped by
    the mask. The current glyph is comfortably inside it, so this passes today —
    it exists to catch the icon being redrawn larger later, which would be
    invisible until someone held an Android phone, and there is no Android phone
    here.
  */
  test('keep their content inside the central 80% safe zone', () => {
    for (const icon of maskableIcons) {
      const bytes = readFileSync(new URL(`../public${icon.src}`, import.meta.url))
      const png = UPNG.decode(bytesOf(bytes))
      const rgba = new Uint8Array(UPNG.toRGBA8(png)[0])
      const ground = { r: rgba[0], g: rgba[1], b: rgba[2] }

      let minX = png.width
      let minY = png.height
      let maxX = -1
      let maxY = -1
      for (let y = 0; y < png.height; y++) {
        for (let x = 0; x < png.width; x++) {
          const o = (y * png.width + x) * 4
          const differs =
            Math.abs(rgba[o] - ground.r) > 12 ||
            Math.abs(rgba[o + 1] - ground.g) > 12 ||
            Math.abs(rgba[o + 2] - ground.b) > 12
          if (!differs) continue
          if (x < minX) minX = x
          if (y < minY) minY = y
          if (x > maxX) maxX = x
          if (y > maxY) maxY = y
        }
      }

      const margin = 0.1 // the safe zone is the central 80%
      const lowX = png.width * margin
      const highX = png.width * (1 - margin)
      const lowY = png.height * margin
      const highY = png.height * (1 - margin)

      expect(minX, `${icon.src} content reaches too far left`).toBeGreaterThanOrEqual(lowX)
      expect(minY, `${icon.src} content reaches too far up`).toBeGreaterThanOrEqual(lowY)
      expect(maxX, `${icon.src} content reaches too far right`).toBeLessThanOrEqual(highX)
      expect(maxY, `${icon.src} content reaches too far down`).toBeLessThanOrEqual(highY)
    }
  })
})
