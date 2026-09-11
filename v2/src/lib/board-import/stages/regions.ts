import type { Bitmap } from '../bitmap.ts'

/**
 * A maximal run of near-identical pixels, described by its bounding box.
 *
 * THE BOUNDING BOX IS THE POINT, not the area. A played tile is a solid block
 * whose letter is a hole the colour flows around; an UNPLAYED tile is a hollow
 * ring, because its interior is the same colour as the page behind it and the
 * border is its only edge. Those two have almost nothing in common by area and
 * are indistinguishable by bounding box, which is exactly what Stage 1 needs —
 * the spike measured an unplayed row as the strongest lattice in the image.
 */
export type Region = {
  readonly area: number
  /** Inclusive bounds. */
  readonly minX: number
  readonly minY: number
  readonly maxX: number
  readonly maxY: number
  readonly width: number
  readonly height: number
  readonly centreX: number
  readonly centreY: number
  /** Whether the region runs into an edge of the image, i.e. it may be cut off. */
  readonly clippedLeft: boolean
  readonly clippedRight: boolean
  readonly clippedTop: boolean
  readonly clippedBottom: boolean
}

/**
 * Connected components of flat colour, four-connected.
 *
 * TOLERANCE IS MEASURED AGAINST THE SEED, never against the neighbour. Growing
 * against the neighbour lets a region drift arbitrarily far from where it
 * started — one shallow gradient and the board, the page and the keyboard are
 * one component. Against the seed, a flat area stays flat and a border of a
 * genuinely different colour is a wall.
 *
 * Small regions are reported too. Filtering is the caller's job because what
 * counts as too small depends on the tile size it is hunting for, which is not
 * known yet.
 */
export function flatRegions(bitmap: Bitmap, tolerance: number): Array<Region> {
  const { width, height, data } = bitmap
  const count = width * height
  const labels = new Int32Array(count).fill(-1)
  const stack = new Int32Array(count)
  const regions: Array<Region> = []

  for (let start = 0; start < count; start++) {
    if (labels[start] !== -1) continue

    const id = regions.length
    const seed = start * 4
    const seedR = data[seed]
    const seedG = data[seed + 1]
    const seedB = data[seed + 2]

    let top = 0
    stack[top++] = start
    labels[start] = id

    let area = 0
    let minX = width
    let minY = height
    let maxX = -1
    let maxY = -1

    const push = (neighbour: number): void => {
      if (labels[neighbour] !== -1) return
      const at = neighbour * 4
      if (Math.abs(data[at] - seedR) > tolerance) return
      if (Math.abs(data[at + 1] - seedG) > tolerance) return
      if (Math.abs(data[at + 2] - seedB) > tolerance) return
      labels[neighbour] = id
      stack[top++] = neighbour
    }

    while (top > 0) {
      const pixel = stack[--top]
      const x = pixel % width
      const y = (pixel - x) / width

      area++
      if (x < minX) minX = x
      if (x > maxX) maxX = x
      if (y < minY) minY = y
      if (y > maxY) maxY = y

      // Four-connected. Eight would bridge tiles that touch only at a corner,
      // which is how a one-pixel gap between two rows becomes one component.
      if (x > 0) push(pixel - 1)
      if (x + 1 < width) push(pixel + 1)
      if (y > 0) push(pixel - width)
      if (y + 1 < height) push(pixel + width)
    }

    regions.push({
      area,
      minX,
      minY,
      maxX,
      maxY,
      width: maxX - minX + 1,
      height: maxY - minY + 1,
      centreX: (minX + maxX) / 2,
      centreY: (minY + maxY) / 2,
      clippedLeft: minX === 0,
      clippedRight: maxX === width - 1,
      clippedTop: minY === 0,
      clippedBottom: maxY === height - 1,
    })
  }

  return regions
}
