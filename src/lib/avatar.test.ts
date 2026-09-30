import { describe, expect, test } from 'vitest'
import { avatarEncodingFault, cropRectFor } from './avatar.ts'
import { MAX_AVATAR_BYTES } from '../../convex/lib/avatar.ts'

describe('cropRectFor', () => {
  test('a square image is taken whole', () => {
    expect(cropRectFor(400, 400)).toEqual({ sx: 0, sy: 0, side: 400 })
  })

  test('a landscape image is cropped to its centre column', () => {
    expect(cropRectFor(800, 400)).toEqual({ sx: 200, sy: 0, side: 400 })
  })

  test('a portrait image is cropped to its centre row', () => {
    expect(cropRectFor(400, 800)).toEqual({ sx: 0, sy: 200, side: 400 })
  })

  // An odd remainder must not produce a fractional source rect: drawImage
  // accepts one, but the half-pixel shows as a soft edge at 256px.
  test('an odd offset is floored rather than left fractional', () => {
    expect(cropRectFor(401, 400)).toEqual({ sx: 0, sy: 0, side: 400 })
    expect(cropRectFor(403, 400)).toEqual({ sx: 1, sy: 0, side: 400 })
  })
})

/**
 * WHY THIS EXISTS: `canvas.toBlob` SILENTLY GIVES YOU SOMETHING ELSE when it
 * cannot encode what you asked for. The HTML spec says an unsupported type
 * falls back to `image/png`, and iOS Safari has historically not encoded WebP
 * from a canvas — so an iPhone upload produced a 256px PNG of a photograph,
 * which is lossless, routinely 80-180 KB, and therefore over the server's
 * 100,000-byte cap. The server refused it with an opaque "try another one" and
 * the player had no way to know why (2026-09-12, beta).
 *
 * THE PREDICATE IS THE SERVER'S OWN, imported rather than restated, so the
 * client cannot drift from the rule it is trying to satisfy.
 */
describe('avatarEncodingFault', () => {
  test('accepts a small WebP, which is what every capable browser produces', () => {
    expect(avatarEncodingFault({ type: 'image/webp', size: 14_000 })).toBeNull()
  })

  // The iPhone case. PNG is an ALLOWED type, so the type check passes and only
  // the size betrays it — which is exactly why the failure was so confusing.
  test('rejects the oversized PNG that a WebP fallback produces', () => {
    expect(avatarEncodingFault({ type: 'image/png', size: 140_000 })).toBe('too-large')
  })

  // A small PNG is fine. A flat-coloured avatar compresses well, and there is no
  // reason to refuse a file that satisfies the server.
  test('ACCEPTS a small PNG, because the fallback is not itself the problem', () => {
    expect(avatarEncodingFault({ type: 'image/png', size: 9_000 })).toBeNull()
  })

  test('rejects a type the server will not take', () => {
    expect(avatarEncodingFault({ type: 'image/svg+xml', size: 2_000 })).toBe('wrong-type')
  })

  // toBlob can yield a blob with no type at all; the server would read that as
  // a missing content type and refuse it.
  test('rejects an untyped blob', () => {
    expect(avatarEncodingFault({ type: '', size: 2_000 })).toBe('wrong-type')
  })

  // Type is checked first: an untyped blob that is ALSO too large should report
  // the type, because re-encoding smaller would not help it.
  test('reports the type first when both are wrong', () => {
    expect(avatarEncodingFault({ type: '', size: 500_000 })).toBe('wrong-type')
  })

  test('the boundary is inclusive, matching the server', () => {
    expect(avatarEncodingFault({ type: 'image/jpeg', size: MAX_AVATAR_BYTES })).toBeNull()
    expect(avatarEncodingFault({ type: 'image/jpeg', size: MAX_AVATAR_BYTES + 1 })).toBe('too-large')
  })
})
