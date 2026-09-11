import { contains, insetRect, medianColour, pixelAt } from '../bitmap.ts'
import type { Bitmap, Rgb } from '../bitmap.ts'
import type { Mark } from '../types.ts'
import type { Lattice } from './lattice.ts'

/**
 * Stage 2: what each tile's colour MEANS.
 *
 * NOT ONE COLOUR VALUE APPEARS IN THIS FILE, and that is the whole design.
 * Matching known hexes would be a silent wrong answer rather than a crash on
 * two inputs that are already in the corpus:
 *
 *   - HIGH CONTRAST MODE, where NYT paints 'correct' orange and 'present'
 *     blue. A palette keyed on green and yellow mislabels every tile on such a
 *     board and the parse comes back confidently wrong.
 *   - ANY FUTURE RE-TINT. The shades have moved before.
 *
 * So everything here is relational. The page's own background says what
 * "unplayed" looks like. Chroma against that background says which cluster is
 * the unsaturated one, which is 'absent'. And the remaining two clusters are
 * NOT told apart by hue at all: both mappings are returned, and Stage 4 keeps
 * whichever one colours a real word consistently. That is why no hue heuristic
 * is needed, and why there is nothing here to break when a shade changes.
 */

/** One reading of the whole board: a mark per tile, for the played rows only. */
export type MarkGrid = ReadonlyArray<ReadonlyArray<Mark>>

export type ColourReading = {
  readonly ok: true
  /** Lattice row indices carrying a submitted guess, top to bottom. */
  readonly rows: ReadonlyArray<number>
  /**
   * One or two readings, best first. Two when the chromatic clusters cannot be
   * told apart without knowing the word — which is most of the time, and is
   * Stage 4's job rather than a thing to guess at here.
   */
  readonly readings: ReadonlyArray<MarkGrid>
  /** Rows that look played but could not be sampled, e.g. cropped clean away. */
  readonly unreadable: ReadonlyArray<number>
}

export type ColourFailure = {
  readonly ok: false
  /** Every row is unplayed: an empty board, or a board mid-typing. */
  readonly reason: 'no-played-rows' | 'too-many-colours'
}

export type ColourClassification = ColourReading | ColourFailure

export type ColourOptions = {
  /**
   * How far apart two tile colours must be to be different marks. Wordle's
   * tiles are flat fills, so the real separations are several times this; the
   * slack is for JPEG ringing and a rescaled screenshot-of-a-screenshot.
   */
  readonly clusterDistance?: number
  /**
   * How much more colourful than the page a tile must be to count as coloured
   * rather than grey. A statement about what "unsaturated" means, NOT a
   * palette: it names no colour and survives any re-tint.
   */
  readonly neutralMargin?: number
  /** Fraction of the tile trimmed off each edge before sampling. */
  readonly inset?: number
}

const DEFAULTS = { clusterDistance: 45, neutralMargin: 24, inset: 0.18 } as const

function chromaOf(colour: Rgb): number {
  return Math.max(colour[0], colour[1], colour[2]) - Math.min(colour[0], colour[1], colour[2])
}

function distance(a: Rgb, b: Rgb): number {
  return Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2])
}

/**
 * The page behind the board, read from the gaps between the tiles.
 *
 * THE GAPS RATHER THAN THE MARGIN, because a tight crop has no margin and every
 * board has gaps. This is the anchor the whole stage hangs off: an unplayed
 * tile is filled with exactly this colour, which is the only thing that
 * separates it from a played 'absent' one in dark mode, where the page is
 * near-black and 'absent' is a slightly lighter near-black.
 */
function backgroundColour(bitmap: Bitmap, lattice: Lattice): Rgb | null {
  const gapX = lattice.pitch.x - lattice.tileSize
  const gapY = lattice.pitch.y - lattice.tileSize
  const samples: Array<Rgb> = []

  for (let row = 0; row < lattice.rows; row++) {
    for (let column = 0; column + 1 < lattice.columns; column++) {
      const tile = lattice.tiles[row][column]
      if (gapX < 1) continue
      const x = Math.round(tile.x + tile.width + gapX / 2)
      const y = Math.round(tile.y + tile.height / 2)
      if (contains(bitmap, x, y)) {
        const [r, g, b] = pixelAt(bitmap, x, y)
        samples.push([r, g, b])
      }
    }
  }

  for (let row = 0; row + 1 < lattice.rows; row++) {
    if (gapY < 1) continue
    for (let column = 0; column < lattice.columns; column++) {
      const tile = lattice.tiles[row][column]
      const x = Math.round(tile.x + tile.width / 2)
      const y = Math.round(tile.y + tile.height + gapY / 2)
      if (contains(bitmap, x, y)) {
        const [r, g, b] = pixelAt(bitmap, x, y)
        samples.push([r, g, b])
      }
    }
  }

  if (samples.length === 0) return null
  const channel = (index: 0 | 1 | 2) => {
    const values = samples.map((sample) => sample[index]).sort((a, b) => a - b)
    return values[Math.floor(values.length / 2)]
  }
  return [channel(0), channel(1), channel(2)]
}

type Cluster = { centre: Rgb; members: Array<number>; firstSeen: number }

/** Single-link agglomeration. Flat UI fills need nothing cleverer. */
function cluster(colours: Array<Rgb>, threshold: number): Array<Cluster> {
  const clusters: Array<Cluster> = []
  colours.forEach((colour, index) => {
    const found = clusters.find((candidate) => distance(candidate.centre, colour) <= threshold)
    if (found === undefined) {
      clusters.push({ centre: colour, members: [index], firstSeen: index })
      return
    }
    // Re-centre on the running mean so a cluster tracks a gradient of JPEG
    // noise instead of being anchored to whichever tile happened to be first.
    const n = found.members.length
    found.centre = [
      (found.centre[0] * n + colour[0]) / (n + 1),
      (found.centre[1] * n + colour[1]) / (n + 1),
      (found.centre[2] * n + colour[2]) / (n + 1),
    ]
    found.members.push(index)
  })
  return clusters
}

export function classifyColours(
  bitmap: Bitmap,
  lattice: Lattice,
  options: ColourOptions = {},
): ColourClassification {
  const settings = { ...DEFAULTS, ...options }
  const background = backgroundColour(bitmap, lattice)

  const sampled = lattice.tiles.map((row) =>
    row.map((tile) => medianColour(bitmap, insetRect(tile, settings.inset))),
  )

  // A row is played when every tile in it has been filled in. A row the player
  // is still typing into is unplayed: the letters are there but the tiles are
  // still the page colour, which is exactly what this test sees.
  const rows: Array<number> = []
  const unreadable: Array<number> = []
  const playedColours: Array<Rgb> = []
  for (let row = 0; row < sampled.length; row++) {
    const filled = sampled[row].filter(
      (colour): colour is Rgb =>
        colour !== null && (background === null || distance(colour, background) > settings.clusterDistance),
    )
    if (filled.length === 0) continue
    if (filled.length < lattice.columns) {
      unreadable.push(row)
      continue
    }
    rows.push(row)
    playedColours.push(...filled)
  }

  if (rows.length === 0) return { ok: false, reason: 'no-played-rows' }

  const clusters = cluster(playedColours, settings.clusterDistance)
  const backgroundChroma = background === null ? 0 : chromaOf(background)
  const isNeutral = (entry: Cluster) => chromaOf(entry.centre) <= backgroundChroma + settings.neutralMargin

  // The LARGEST unsaturated cluster is 'absent'. A second one is not a third
  // mark — Wordle has only three — it is something the image did that we do not
  // understand, and the corpus has one: a tile that came out 60% white on a
  // dark board. Rows carrying such a tile are reported unreadable rather than
  // guessed at, and rather than costing the other five rows their parse.
  const neutrals = clusters.filter(isNeutral).sort((a, b) => b.members.length - a.members.length)
  const chromatic = clusters.filter((entry) => !isNeutral(entry))
  if (chromatic.length > 2) return { ok: false, reason: 'too-many-colours' }

  const absent = neutrals[0]
  const strange = neutrals.slice(1)
  const nearby = (entry: Cluster, colour: Rgb) => distance(entry.centre, colour) <= settings.clusterDistance

  /** -1 is 'absent', 0 and 1 index the chromatic clusters, null is unreadable. */
  const kindOf = (colour: Rgb | null): number | null => {
    if (colour === null) return null
    if (absent !== undefined && nearby(absent, colour)) return -1
    if (strange.some((entry) => nearby(entry, colour))) return null
    if (chromatic.length === 0) return null
    const nearest = chromatic.reduce((best, entry) =>
      distance(entry.centre, colour) < distance(best.centre, colour) ? entry : best,
    )
    return chromatic.indexOf(nearest)
  }

  const kinds = new Map<number, Array<number>>()
  const readable: Array<number> = []
  for (const row of rows) {
    const found = lattice.tiles[row].map((_tile, column) => kindOf(sampled[row][column]))
    if (found.some((kind) => kind === null)) {
      unreadable.push(row)
      continue
    }
    kinds.set(row, found as Array<number>)
    readable.push(row)
  }
  unreadable.sort((a, b) => a - b)

  if (readable.length === 0) return { ok: false, reason: 'no-played-rows' }

  const build = (first: Mark, second: Mark): MarkGrid =>
    readable.map((row) =>
      (kinds.get(row) ?? []).map((kind) => (kind === -1 ? 'absent' : kind === 0 ? first : second)),
    )

  if (chromatic.length === 0) return { ok: true, rows: readable, readings: [build('absent', 'absent')], unreadable }

  // THE ORDER IS A HINT, NOT A DECISION. A solved board's last played row is
  // all one chromatic colour, and that colour can only be 'correct' — so the
  // reading that says so goes first and Stage 4 confirms it on the first pass.
  // A failed board has no such row, both readings are then equally plausible,
  // and Stage 4 settles it. Which is the whole reason both are returned, and
  // why no hue heuristic is needed anywhere in this file.
  const last = kinds.get(readable[readable.length - 1]) ?? []
  const wonWith = last.every((kind) => kind === last[0]) && last[0] !== -1 ? last[0] : null

  return {
    ok: true,
    rows: readable,
    readings:
      wonWith === 0
        ? [build('correct', 'present'), build('present', 'correct')]
        : [build('present', 'correct'), build('correct', 'present')],
    unreadable,
  }
}
