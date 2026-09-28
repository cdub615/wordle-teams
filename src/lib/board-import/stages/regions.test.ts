import { describe, expect, it } from 'vitest'
import { createBitmap, fillRect, strokeRect } from '../bitmap.ts'
import { flatRegions } from './regions.ts'

const WHITE = [255, 255, 255] as const
const GREY = [128, 128, 128] as const

describe('flatRegions', () => {
  it('separates a solid block from its ground and boxes it exactly', () => {
    const bitmap = createBitmap(40, 40, WHITE)
    fillRect(bitmap, { x: 10, y: 12, width: 14, height: 9 }, GREY)
    const regions = flatRegions(bitmap, 20)

    expect(regions).toHaveLength(2)
    const block = regions.find((region) => region.area === 14 * 9)
    expect(block).toMatchObject({ minX: 10, minY: 12, maxX: 23, maxY: 20, width: 14, height: 9 })
  })

  // THE CASE STAGE 1 DEPENDS ON. An unplayed tile is a ring whose interior is
  // the same colour as the page; by area it is nothing like a played tile, and
  // by bounding box the two are identical. That is why Stage 1 boxes rather
  // than measures, and why an empty row is the cleanest lattice in the image.
  it('gives a hollow ring the bounding box of the whole tile', () => {
    const hollow = createBitmap(60, 60, WHITE)
    strokeRect(hollow, { x: 8, y: 8, width: 40, height: 40 }, GREY, 2)
    const ring = flatRegions(hollow, 20).find((region) => region.width === 40 && region.height === 40)

    const solid = createBitmap(60, 60, WHITE)
    fillRect(solid, { x: 8, y: 8, width: 40, height: 40 }, GREY)
    const block = flatRegions(solid, 20).find((region) => region.width === 40 && region.height === 40)

    // Identical boxes. By area they have almost nothing in common — which is
    // the whole reason Stage 1 boxes rather than measures.
    expect(ring).toMatchObject({ minX: 8, minY: 8, maxX: 47, maxY: 47 })
    expect(block).toMatchObject({ minX: 8, minY: 8, maxX: 47, maxY: 47 })
    expect((ring?.area ?? 0) / 1600).toBeLessThan(0.25)
    expect((block?.area ?? 0) / 1600).toBe(1)
  })

  it('keeps the ring and the ground apart, and the interior separate from both', () => {
    const bitmap = createBitmap(40, 40, WHITE)
    strokeRect(bitmap, { x: 8, y: 8, width: 20, height: 20 }, GREY, 2)
    // Ground, ring, interior — three regions, because the ring is a wall.
    expect(flatRegions(bitmap, 20)).toHaveLength(3)
  })

  it('reports which edges a region runs into, which is how a severed tile is known', () => {
    const bitmap = createBitmap(20, 20, WHITE)
    fillRect(bitmap, { x: 0, y: 4, width: 6, height: 8 }, GREY)
    const cut = flatRegions(bitmap, 20).find((region) => region.width === 6)

    expect(cut).toMatchObject({ clippedLeft: true, clippedRight: false, clippedTop: false, clippedBottom: false })
  })

  // TOLERANCE IS AGAINST THE SEED, NOT THE NEIGHBOUR. Growing against the
  // neighbour lets one shallow gradient swallow the whole image, which would
  // make the board, the page and the keyboard a single component.
  it('does not let a gradient carry a region away from where it started', () => {
    const bitmap = createBitmap(60, 4, [0, 0, 0])
    for (let x = 0; x < 60; x++) fillRect(bitmap, { x, y: 0, width: 1, height: 4 }, [x * 4, x * 4, x * 4])
    const regions = flatRegions(bitmap, 20)

    // A neighbour-relative fill would return exactly one region for a ramp
    // whose every step is inside the tolerance.
    expect(regions.length).toBeGreaterThan(5)
    expect(Math.max(...regions.map((region) => region.width))).toBeLessThan(20)
  })

  it('is four-connected, so tiles touching only at a corner stay apart', () => {
    const bitmap = createBitmap(10, 10, WHITE)
    fillRect(bitmap, { x: 1, y: 1, width: 3, height: 3 }, GREY)
    fillRect(bitmap, { x: 4, y: 4, width: 3, height: 3 }, GREY)
    const blocks = flatRegions(bitmap, 20).filter((region) => region.area === 9)
    expect(blocks).toHaveLength(2)
  })

  it('centres a region on its bounding box', () => {
    const bitmap = createBitmap(30, 30, WHITE)
    fillRect(bitmap, { x: 10, y: 10, width: 10, height: 10 }, GREY)
    const block = flatRegions(bitmap, 20).find((region) => region.area === 100)
    expect([block?.centreX, block?.centreY]).toEqual([14.5, 14.5])
  })
})
