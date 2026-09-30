import type { Bitmap, Rect } from '../bitmap.ts'
import { flatRegions } from './regions.ts'
import type { Region } from './regions.ts'

/**
 * Stage 1: find the board.
 *
 * Connected components -> near-square and similar-size filter -> vote on
 * (pitch, origin) -> accept a MAXIMAL lattice of exactly five columns and one
 * to six rows.
 *
 * THIS FILE CARRIES THE RESIDUAL RISK OF THE WHOLE FEATURE, and the reason is
 * worth stating where it will be read. The spec claims nothing else in a
 * screenshot forms a competing five-wide lattice of equally sized squares. The
 * spike measured otherwise for a CRUDER test than this one — a keyboard-only
 * crop, with no board in it at all, scored 380 five-wide scanlines against a
 * threshold of 40 under horizontal run-length encoding, which has no squareness
 * filter. NYT's keys are roughly 43x58.
 *
 * So the two defences here are deliberate and independent:
 *
 *   1. NEAR-SQUARE. 43x58 is 0.74, well under the threshold, so a key is not a
 *      tile candidate at all.
 *   2. MAXIMALITY. A keyboard row is ten keys wide and the rows are staggered,
 *      so even if squareness let them through, the column span would exceed
 *      five and the lattice would be rejected rather than matched against some
 *      five-wide window inside it. "Maximal" in the spec is doing this work:
 *      accepting a sub-window of a wider regular run is exactly the failure.
 *
 * The measurement that this actually holds is on wordle-teams-gcyx, taken
 * against the real corpus rather than against anything rendered here.
 *
 * AND THE OTHER MEASURED FINDING: do NOT rank candidate lattices by how
 * populated they look. An unplayed row yields a CLEANER lattice than a filled
 * one, because a filled tile's glyph interrupts the flat colour. Everything
 * below works on geometry alone and never looks at a tile's colour.
 */

export type Lattice = {
  readonly rows: number
  /** Always 5. Kept explicit because the tiles array is indexed by it. */
  readonly columns: number
  readonly tileSize: number
  readonly pitch: { readonly x: number; readonly y: number }
  /**
   * Row-major tile rectangles. A tile severed by the crop keeps its TRUE
   * geometry, so its rect can start left of zero or run past the edge — the
   * caller clips when it samples, and Stage 2 needs to know a tile is only
   * half there rather than being handed a half-sized rect.
   */
  readonly tiles: ReadonlyArray<ReadonlyArray<Rect>>
}

export type LatticeFailure =
  /** Nothing in the image was a near-square blob of a plausible size. */
  | 'no-tile-candidates'
  /** Candidates existed but never lined up on a regular pitch. */
  | 'no-repeating-grid'
  /** A grid was found and it was not five columns wide — a keyboard lands here. */
  | 'not-five-columns'
  /** More than six rows, so whatever it is, it is not a Wordle board. */
  | 'too-many-rows'

export type LatticeDiagnostics = {
  /** Flat-colour regions in the image, before any filtering. */
  readonly regions: number
  /** Regions that survived the near-square and size filters. */
  readonly candidates: number
  /** The similar-size cluster that was tried, and how many regions it held. */
  readonly tileSize: number | null
  readonly clustered: number
  /** Columns and rows the grid vote actually spanned, before demanding five. */
  readonly columnSpan: number | null
  readonly rowSpan: number | null
}

export type LatticeDetection =
  | { readonly ok: true; readonly lattice: Lattice; readonly diagnostics: LatticeDiagnostics }
  | { readonly ok: false; readonly reason: LatticeFailure; readonly diagnostics: LatticeDiagnostics }

export type LatticeOptions = {
  /** Flood-fill tolerance per channel. Flat UI colours need very little. */
  readonly tolerance?: number
  /** min(w,h)/max(w,h) a region must reach to be a tile candidate. */
  readonly squareness?: number
  /** Smallest tile worth looking for, in pixels. */
  readonly minTileSize?: number
  /** Largest tile, as a fraction of image width — five of them have to fit across. */
  readonly maxTileFraction?: number
}

const DEFAULTS = {
  tolerance: 20,
  // 43x58 is 0.741 and 62x62 is 1. The gap between a key and a tile is wide
  // enough that this threshold is not a tuned number.
  squareness: 0.82,
  minTileSize: 8,
  maxTileFraction: 0.3,
} as const

const COLUMNS = 5
const MAX_ROWS = 6
/** How far a region's size may sit from a cluster's centre and still belong. */
const SIZE_SPREAD = 0.18
/** Tiles cannot overlap, and Wordle's gap is small, so pitch is nearly the tile. */
const MIN_PITCH_RATIO = 0.95
const MAX_PITCH_RATIO = 1.45

function sizeOf(region: Region): number {
  return Math.max(region.width, region.height)
}

function isClipped(region: Region): boolean {
  return region.clippedLeft || region.clippedRight || region.clippedTop || region.clippedBottom
}

/**
 * Ranked similar-size clusters, most populous first, larger size breaking a tie.
 *
 * Larger wins a tie because of a specific real case: an unplayed tile in light
 * mode contributes BOTH its border ring (the full tile) and the white square
 * inside it (four pixels smaller), in equal numbers. The ring is the tile.
 */
function sizeClusters(candidates: Array<Region>): Array<{ size: number; members: Array<Region> }> {
  const clusters: Array<{ size: number; members: Array<Region> }> = []
  const seen = new Set<number>()

  for (const centre of candidates) {
    const size = sizeOf(centre)
    if (seen.has(size)) continue
    seen.add(size)
    const members = candidates.filter((region) => Math.abs(sizeOf(region) - size) <= SIZE_SPREAD * size)
    clusters.push({ size, members })
  }

  clusters.sort((a, b) => b.members.length - a.members.length || b.size - a.size)
  return clusters
}

/** A position the vote can be taken on, and how many regions agreed on it. */
type Position = { readonly value: number; readonly weight: number }

/** Collapses positions that are within `tolerance` of each other into one. */
function groupPositions(values: Array<number>, tolerance: number): Array<Position> {
  const sorted = [...values].sort((a, b) => a - b)
  const groups: Array<Array<number>> = []
  for (const value of sorted) {
    const last = groups[groups.length - 1]
    if (last !== undefined && value - last[last.length - 1] <= tolerance) last.push(value)
    else groups.push([value])
  }
  return groups.map((group) => ({
    value: group.reduce((sum, value) => sum + value, 0) / group.length,
    weight: group.length,
  }))
}

type Grid = {
  /** Where slot 0 of the accepted run sits. */
  readonly origin: number
  readonly pitch: number
  /** Slots in the run — the lattice's extent along this axis. */
  readonly count: number
  /** Positions anywhere on the grid, run or not. Breaks ties between pitches. */
  readonly explained: number
}

/**
 * VOTES for the (pitch, origin) that the most positions agree on, and returns
 * the longest unbroken run of occupied slots.
 *
 * IT IS A VOTE, NOT A FIT, AND THE DIFFERENCE IS WHAT MAKES IT WORK ON REAL
 * INPUT. An earlier version here required every observed position to land on
 * the grid. Measured against the real corpus that found 14 boards out of 22:
 * a screenshot always carries a stray near-square thing or two — a rounded
 * button in the bottom bar was the one that did it — and demanding that the
 * board's own pitch explain those as well threw the board away. Outliers have
 * to be outvoted, not accommodated.
 *
 * THE LONGEST RUN, AND NOTHING SHORTER, IS WHAT MAKES IT MAXIMAL. Ten staggered
 * keyboard keys must never be matched by some five-wide window cut out of the
 * middle of them, so the run is always reported at its full length and the
 * caller rejects it for being too long. Choosing the pitch with the LONGEST run
 * errs towards rejecting an image, which is the safe direction: every parse is
 * confirmed by the user before it is saved, but a board read off the keyboard
 * would be confidently wrong.
 */
function voteGrid(positions: Array<Position>, tileSize: number): Grid | null {
  // Junk beyond this is not going to be outvoted by anything, and the search is
  // quadratic in the count. The most-agreed positions are the ones to keep.
  const considered = [...positions].sort((a, b) => b.weight - a.weight).slice(0, 32)
  const values = considered.map((position) => position.value).sort((a, b) => a - b)
  if (values.length < 2) return null

  const tolerance = tileSize * 0.15
  const minPitch = tileSize * MIN_PITCH_RATIO
  const maxPitch = tileSize * MAX_PITCH_RATIO

  // Every pairwise gap, and that gap halved and thirded — a severed or simply
  // missing column turns one gap into two or three pitches, and the true pitch
  // is then never an observed gap at all.
  const pitches = new Set<number>()
  for (let i = 0; i < values.length; i++) {
    for (let j = i + 1; j < values.length; j++) {
      for (const divisor of [1, 2, 3]) {
        const pitch = (values[j] - values[i]) / divisor
        if (pitch >= minPitch && pitch <= maxPitch) pitches.add(Math.round(pitch * 4) / 4)
      }
    }
  }

  let best: Grid | null = null
  for (const pitch of pitches) {
    for (const anchor of values) {
      const slots = new Map<number, number>()
      for (const value of values) {
        const slot = Math.round((value - anchor) / pitch)
        if (Math.abs(value - (anchor + slot * pitch)) > tolerance) continue
        if (!slots.has(slot)) slots.set(slot, value)
      }
      if (slots.size < 2) continue

      const occupied = [...slots.keys()].sort((a, b) => a - b)
      let runStart = 0
      let runLength = 1
      let currentStart = 0
      let currentLength = 1
      for (let i = 1; i < occupied.length; i++) {
        if (occupied[i] === occupied[i - 1] + 1) currentLength++
        else {
          currentStart = i
          currentLength = 1
        }
        if (currentLength > runLength) {
          runLength = currentLength
          runStart = currentStart
        }
      }

      const run = occupied.slice(runStart, runStart + runLength)
      // Least squares over the run alone, so the reported pitch and origin are
      // the board's own and not dragged by a far-off position that happened to
      // land on the grid.
      const meanSlot = run.reduce((sum, slot) => sum + slot, 0) / run.length
      const meanValue = run.reduce((sum, slot) => sum + (slots.get(slot) ?? 0), 0) / run.length
      let numerator = 0
      let denominator = 0
      for (const slot of run) {
        numerator += (slot - meanSlot) * ((slots.get(slot) ?? 0) - meanValue)
        denominator += (slot - meanSlot) ** 2
      }
      const fitted = denominator === 0 ? pitch : numerator / denominator

      const candidate: Grid = {
        origin: meanValue + (run[0] - meanSlot) * fitted,
        pitch: fitted,
        count: runLength,
        explained: slots.size,
      }

      if (
        best === null ||
        candidate.count > best.count ||
        (candidate.count === best.count && candidate.explained > best.explained) ||
        (candidate.count === best.count && candidate.explained === best.explained && candidate.pitch > best.pitch)
      ) {
        best = candidate
      }
    }
  }

  return best
}

/**
 * Evidence that a column exists at `x` but was cut off by the edge of the image.
 *
 * Both of the spike's two misses were crops through the first and last columns,
 * and a severed tile is not a tile candidate — it fails near-square, which is
 * the correct call. So the lattice is fitted from the interior columns and
 * extended outward only where this finds a region that is
 *
 *   - the right height to be a tile, but narrower than one,
 *   - running into the image edge that the candidate column runs off, and
 *   - overlapping the part of that column which is actually visible.
 *
 * That is deliberately narrower than "something is there". The page background
 * also touches the edge and also overlaps; it is excluded because it is not
 * tile-height. Without that the margin around a fully visible board would read
 * as a sixth column.
 */
function severedColumnAt(regions: Array<Region>, x: number, tileSize: number, bitmap: Bitmap): boolean {
  const left = x
  const right = x + tileSize
  const offLeft = left < 0
  const offRight = right > bitmap.width
  if (!offLeft && !offRight) return false

  const visibleLeft = Math.max(0, left)
  const visibleRight = Math.min(bitmap.width, right)
  const visible = visibleRight - visibleLeft
  if (visible <= 0) return false

  return regions.some((region) => {
    if (offLeft && !region.clippedLeft) return false
    if (offRight && !region.clippedRight) return false
    if (region.height < tileSize * 0.8 || region.height > tileSize * 1.25) return false
    if (region.width >= tileSize * MIN_PITCH_RATIO) return false
    const overlap = Math.min(region.maxX + 1, visibleRight) - Math.max(region.minX, visibleLeft)
    return overlap >= visible * 0.5
  })
}

type Attempt =
  | { readonly ok: true; readonly lattice: Lattice; readonly columnSpan: number; readonly rowSpan: number }
  | {
      readonly ok: false
      readonly reason: LatticeFailure
      readonly columnSpan: number | null
      readonly rowSpan: number | null
    }

function attempt(members: Array<Region>, tileSize: number, bitmap: Bitmap, clipped: Array<Region>): Attempt {
  const tolerance = tileSize * 0.35
  const columns = voteGrid(groupPositions(members.map((region) => region.centreX), tolerance), tileSize)
  if (columns === null) return { ok: false, reason: 'no-repeating-grid', columnSpan: null, rowSpan: null }

  // MAXIMALITY. A run longer than five is not a board, and must not be matched
  // by a five-wide window cut out of the middle of it. This is the check the
  // on-screen keyboard is meant to fail.
  if (columns.count > COLUMNS) {
    return { ok: false, reason: 'not-five-columns', columnSpan: columns.count, rowSpan: null }
  }

  const rowPositions = groupPositions(members.map((region) => region.centreY), tolerance)
  // A single guess is a one-row board, and there is then no vertical gap to
  // measure. Tiles are square and the gaps match, so the column pitch is right.
  const rows =
    rowPositions.length === 1
      ? { origin: rowPositions[0].value, pitch: columns.pitch, count: 1, explained: 1 }
      : voteGrid(rowPositions, tileSize)
  if (rows === null) return { ok: false, reason: 'no-repeating-grid', columnSpan: columns.count, rowSpan: null }
  if (rows.count > MAX_ROWS) {
    return { ok: false, reason: 'too-many-rows', columnSpan: columns.count, rowSpan: rows.count }
  }

  // Extend outward into columns the crop severed, and pay for every step with
  // evidence. Both of the spike's two misses were exactly this input.
  const half = tileSize / 2
  let first = columns.origin
  let count = columns.count
  while (count < COLUMNS && severedColumnAt(clipped, first - columns.pitch - half, tileSize, bitmap)) {
    first -= columns.pitch
    count++
  }
  while (count < COLUMNS && severedColumnAt(clipped, first + count * columns.pitch - half, tileSize, bitmap)) {
    count++
  }

  if (count !== COLUMNS) {
    return { ok: false, reason: 'not-five-columns', columnSpan: columns.count, rowSpan: rows.count }
  }

  const tiles = Array.from({ length: rows.count }, (_row, row) =>
    Array.from({ length: COLUMNS }, (_column, column) => ({
      x: Math.round(first + column * columns.pitch - half),
      y: Math.round(rows.origin + row * rows.pitch - half),
      width: Math.round(tileSize),
      height: Math.round(tileSize),
    })),
  )

  return {
    ok: true,
    lattice: {
      rows: rows.count,
      columns: COLUMNS,
      tileSize: Math.round(tileSize),
      pitch: { x: columns.pitch, y: rows.pitch },
      tiles,
    },
    columnSpan: columns.count,
    rowSpan: rows.count,
  }
}

export function detectLattice(bitmap: Bitmap, options: LatticeOptions = {}): LatticeDetection {
  const settings = { ...DEFAULTS, ...options }
  const regions = flatRegions(bitmap, settings.tolerance)

  const maxTileSize = Math.min(bitmap.width * settings.maxTileFraction, bitmap.height)
  const candidates = regions.filter((region) => {
    const size = sizeOf(region)
    if (size < settings.minTileSize || size > maxTileSize) return false
    if (Math.min(region.width, region.height) / size < settings.squareness) return false
    // Kills hairlines and diagonals without touching a hollow tile border: a
    // 62px ring two pixels thick still fills an eighth of its box.
    return region.area >= region.width * region.height * 0.04
  })

  // Kept for the severed-column extension only. A tile cut by the crop fails
  // near-square, so it is correctly not a candidate — but it is still evidence.
  const clipped = regions.filter(
    (region) => isClipped(region) && sizeOf(region) >= settings.minTileSize && sizeOf(region) <= maxTileSize,
  )

  const empty: LatticeDiagnostics = {
    regions: regions.length,
    candidates: candidates.length,
    tileSize: null,
    clustered: 0,
    columnSpan: null,
    rowSpan: null,
  }

  if (candidates.length < COLUMNS - 2) return { ok: false, reason: 'no-tile-candidates', diagnostics: empty }

  // Every plausible tile size is tried in turn rather than only the most
  // populous. A board of played rows in light mode produces two near-equal
  // clusters — the tiles and the white squares inside the unplayed ones — and
  // which of them wins on count is an accident of how far the board got.
  let fallback: LatticeDetection | null = null
  for (const cluster of sizeClusters(candidates).slice(0, 6)) {
    const sizes = cluster.members.map(sizeOf).sort((a, b) => a - b)
    const tileSize = sizes[Math.floor(sizes.length / 2)]
    const result = attempt(cluster.members, tileSize, bitmap, clipped)
    const diagnostics: LatticeDiagnostics = {
      regions: regions.length,
      candidates: candidates.length,
      tileSize,
      clustered: cluster.members.length,
      columnSpan: result.columnSpan,
      rowSpan: result.rowSpan,
    }
    if (result.ok) return { ok: true, lattice: result.lattice, diagnostics }
    fallback ??= { ok: false, reason: result.reason, diagnostics }
  }

  return fallback ?? { ok: false, reason: 'no-repeating-grid', diagnostics: empty }
}
