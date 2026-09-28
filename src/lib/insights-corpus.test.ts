import { readFileSync, readdirSync, statSync } from 'node:fs'
import { describe, expect, test } from 'vitest'
import { dayDifficulty, openerRank } from './insights-benchmark'

/**
 * THE CHECKED-IN ARTIFACTS THEMSELVES, not the lookups over them.
 *
 * scripts/build-insights-corpus.mjs is deliberately NOT part of `pnpm build` —
 * see its header, and scripts/fetch-wordlists.mjs for the precedent: a build that
 * reaches the network can fail because someone else's site is down. The A2
 * requirement that a missing artifact "fail loudly" is met HERE instead. A corrupt
 * or absent artifact fails the gates rather than shipping quietly, which is what
 * that requirement was for, and it costs no network access to enforce.
 */

const dir = new URL('../../public/insights/', import.meta.url)
const read = (name: string) => readFileSync(new URL(name, dir), 'utf8')
const sizeKb = (name: string) => statSync(new URL(name, dir)).size / 1024

const openers = JSON.parse(read('benchmark-openers.json'))
const difficulty = JSON.parse(read('benchmark-difficulty.json'))

describe('benchmark-openers.json', () => {
  test('holds the 14,855 scored openers the UI names', () => {
    // The number is printed to users ("ranks 4,102nd of 14,855"), so it is pinned
    // rather than derived. A corpus refresh that changes it must change this line
    // and every string that quotes it, together.
    expect(openers.count).toBe(14855)
    expect(openers.words).toHaveLength(14855 * 5)
  })

  test('is packed, in rank order, and lowercase throughout', () => {
    expect(openers.words).toMatch(/^[a-z]+$/)
    // Rank is POSITION in this artifact, so spot-check the encoding end to end
    // against words whose ranks wordle-teams-0cmj measured from the source.
    expect(openerRank(openers, 'slant')).toBe(1)
    expect(openerRank(openers, 'CRANE')).toBe(77)
    expect(openerRank(openers, 'orate')).toBe(448)
    expect(openerRank(openers, 'qajaq')).toBe(14855)
  })

  test('does not hold the openers our players entered that the corpus lacks', () => {
    for (const absent of ['XXXXX', 'ASDFG', 'CTANE']) {
      expect(openerRank(openers, absent)).toBeNull()
    }
  })
})

describe('benchmark-difficulty.json', () => {
  test('covers the dated puzzles from the first Wordle onward', () => {
    expect(difficulty.firstDay).toBe('2021-06-19')
    expect(difficulty.count).toBeGreaterThanOrEqual(1900)
    expect(difficulty.percentiles).toHaveLength(difficulty.count)
  })

  test('every percentile is an integer 0..100', () => {
    const bad = difficulty.percentiles.filter(
      (p: number) => !Number.isInteger(p) || p < 0 || p > 100,
    )
    expect(bad).toEqual([])
  })

  test('carries the snapshot that produced it, because the numbers are revised', () => {
    // Across two releases seven weeks apart, 702 of 1,852 percentiles moved and 78
    // crossed a label boundary (wordle-teams-0cmj). A percentile is only a fact
    // relative to its snapshot, so the snapshot travels with it.
    expect(difficulty.snapshotId).toMatch(/^current-\d{4}-\d{2}-\d{2}-[0-9a-f]+$/)
  })

  test('the first and last days both resolve', () => {
    expect(dayDifficulty(difficulty, '2021-06-19')).not.toBeNull()
    const last = new Date(Date.UTC(2021, 5, 19) + (difficulty.count - 1) * 86_400_000)
    expect(dayDifficulty(difficulty, last.toISOString().slice(0, 10))).not.toBeNull()
  })
})

describe('both artifacts', () => {
  test('carry the CC BY 4.0 credit the licence obliges us to display', () => {
    for (const artifact of [openers, difficulty]) {
      expect(artifact.attribution).toBe('FiveLetterWords.io, research release v2026-09-01')
      expect(artifact.licence).toBe('CC BY 4.0')
      expect(artifact.licenceUrl).toBe('https://creativecommons.org/licenses/by/4.0/')
      expect(artifact.citation).toContain('FiveLetterWords research release v2026-09-01')
    }
  })

  /**
   * A STATED BUDGET, SO GROWTH IS A DECISION. These ship to every player who opens
   * insights. Openers are fixed at 14,855 words and will only move if the corpus
   * redefines the accepted set; difficulty grows about 1.1 KB a year, so the
   * headroom below is roughly five years.
   */
  test.each([
    ['benchmark-openers.json', 90],
    ['benchmark-difficulty.json', 12],
  ])('%s stays within %i KB', (name, budget) => {
    expect(sizeKb(name)).toBeLessThan(budget)
  })
})

describe('the artifacts must not reach the main bundle', () => {
  /**
   * They are served as static files from public/ and fetched at runtime by
   * insights-benchmark.ts, which is what makes them lazy — a player who never
   * opens insights never pays the ~79 KB.
   *
   * `import`ing one instead would inline it into a JS chunk, and the fault would
   * be invisible from the source: every gate would stay green while every visitor
   * downloaded the corpus. CI greps dist/client for the same reason and catches
   * the built form; this catches the cause, without needing a build.
   */
  const sourceDir = new URL('../', import.meta.url)

  const sources = (function walk(at: URL): URL[] {
    return readdirSync(at, { withFileTypes: true }).flatMap((entry) => {
      const child = new URL(entry.name + (entry.isDirectory() ? '/' : ''), at)
      if (entry.isDirectory()) return walk(child)
      return /\.(ts|tsx)$/.test(entry.name) ? [child] : []
    })
  })(sourceDir)

  test('no source file imports them', () => {
    const offenders = sources.filter((file) => {
      const text = readFileSync(file, 'utf8')
      return /^\s*import\b.*benchmark-(openers|difficulty)\.json/m.test(text)
    })
    expect(offenders.map((f) => f.pathname)).toEqual([])
  })

  test('and the walk actually found the source tree', () => {
    // Guards the assertion above from passing because it scanned nothing.
    expect(sources.length).toBeGreaterThan(50)
  })

  /**
   * THE SERVICE WORKER IS THE OTHER WAY LAZINESS DIES, and a quieter one than an
   * import. scripts/build-sw.mjs precaches what its globPatterns match, and
   * anything precached is downloaded by every visitor on first load — so widening
   * that glob to .json would ship the corpus to everyone while leaving the route
   * genuinely code-split and every other check green.
   *
   * Asserted against the patterns rather than a built sw.js because CI runs the
   * unit tests BEFORE it builds the client, so a test needing dist/ would skip in
   * the one place it matters.
   */
  test('the service worker precache glob does not reach public/insights', () => {
    const buildSw = readFileSync(new URL('../../scripts/build-sw.mjs', import.meta.url), 'utf8')
    const declared = /globPatterns:\s*\[([^\]]*)\]/.exec(buildSw)
    expect(declared, 'globPatterns not found in build-sw.mjs — did it move?').not.toBeNull()

    const patterns = [...declared![1].matchAll(/'([^']+)'/g)].map((m) => m[1])
    expect(patterns.length).toBeGreaterThan(0)
    for (const pattern of patterns) {
      expect(pattern).not.toContain('json')
      expect(pattern).not.toContain('insights')
    }
  })
})
