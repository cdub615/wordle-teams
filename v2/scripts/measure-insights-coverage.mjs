#!/usr/bin/env node
/**
 * ONE-OFF MEASUREMENT for wordle-teams-0cmj (Insights A1). Read-only.
 *
 *   node --env-file=.env.local scripts/measure-insights-coverage.mjs \
 *     --corpus=/path/to/v2026-09-01
 *
 * Answers the spike's fifth acceptance criterion — how much of our own data the
 * FiveLetterWords benchmark can actually speak to — by intersecting the
 * distribution internal.migrate.insightsCoverageProbe returns with the corpus
 * files on disk. The corpus is NOT uploaded to the deployment; see the probe's
 * comment for why that direction is the load-bearing one.
 *
 * PRINTS COUNTS AND GAME WORDS, NEVER PLAYERS. The probe cannot return a player
 * even if this script asked, and nothing here is safe to paste anywhere that
 * counts as publishing — see the file header on copy-from-supabase.mjs.
 */
import { readFileSync } from 'node:fs'
import { ConvexHttpClient } from 'convex/browser'
import { internal } from '../convex/_generated/api.js'

const corpusDir = process.argv.find((a) => a.startsWith('--corpus='))?.slice('--corpus='.length)
if (!corpusDir) throw new Error('--corpus=<dir> is required')

const url = process.env.CONVEX_URL
const key = process.env.CONVEX_MIGRATION_KEY
if (!url || !key) throw new Error('CONVEX_URL and CONVEX_MIGRATION_KEY are required')

const column = (file, name) => {
  const [header, ...rows] = readFileSync(`${corpusDir}/${file}`, 'utf8').trim().split('\n')
  const at = header.split(',').indexOf(name)
  if (at < 0) throw new Error(`${file}: no column ${name}`)
  return rows.map((r) => r.split(',')[at])
}

const openers = new Set(column('opener-rankings.csv', 'word').map((w) => w.toUpperCase()))
const datedDays = new Set(column('puzzle-difficulty.csv', 'date'))
console.log(`corpus: ${openers.size} openers, ${datedDays.size} dated puzzles`)

const client = new ConvexHttpClient(url)
client.setAdminAuth(key)

let cursor = null
let boards = 0
let withoutGuesses = 0
const byPuzzleDay = new Map()
const byOpener = new Map()

for (;;) {
  const page = await client.query(internal.migrate.insightsCoverageProbe, { cursor })
  boards += page.count
  withoutGuesses += page.withoutGuesses
  for (const [day, n] of Object.entries(page.byPuzzleDay))
    byPuzzleDay.set(day, (byPuzzleDay.get(day) ?? 0) + n)
  for (const [word, n] of Object.entries(page.byOpener))
    byOpener.set(word, (byOpener.get(word) ?? 0) + n)
  if (page.isDone) break
  cursor = page.cursor
}

const sum = (entries) => entries.reduce((t, [, n]) => t + n, 0)
const dayEntries = [...byPuzzleDay]
const openerEntries = [...byOpener]

const coveredDays = dayEntries.filter(([d]) => datedDays.has(d))
const missedDays = dayEntries.filter(([d]) => !datedDays.has(d))
const coveredOpeners = openerEntries.filter(([w]) => openers.has(w))
const missedOpeners = openerEntries.filter(([w]) => !openers.has(w))

const pct = (n, d) => (d === 0 ? '—' : `${((n / d) * 100).toFixed(1)}%`)

console.log(`\nboards: ${boards}   (${withoutGuesses} with no guesses at all)`)
console.log(`distinct puzzle days: ${dayEntries.length}, range ${dayEntries.map(([d]) => d).sort()[0]} .. ${dayEntries.map(([d]) => d).sort().at(-1)}`)
console.log(`distinct openers: ${openerEntries.length}`)

console.log(`\nDIFFICULTY (join on puzzleDay -> puzzle-difficulty.date)`)
console.log(`  boards covered: ${sum(coveredDays)}/${boards}  ${pct(sum(coveredDays), boards)}`)
console.log(`  days covered:   ${coveredDays.length}/${dayEntries.length}`)
console.log(`  uncovered days: ${missedDays.map(([d]) => d).sort().join(', ') || 'none'}`)
console.log(`  boards on uncovered days: ${sum(missedDays)}`)

const withOpener = boards - withoutGuesses
console.log(`\nOPENER RANK (join on guesses[0] -> opener-rankings.word)`)
console.log(`  boards covered: ${sum(coveredOpeners)}/${withOpener}  ${pct(sum(coveredOpeners), withOpener)}`)
console.log(`  openers covered: ${coveredOpeners.length}/${openerEntries.length}`)
console.log(`  unknown openers (word x boards): ${missedOpeners.sort((a, b) => b[1] - a[1]).map(([w, n]) => `${w}:${n}`).join(', ') || 'none'}`)

console.log(`\ntop openers: ${openerEntries.sort((a, b) => b[1] - a[1]).slice(0, 10).map(([w, n]) => `${w}:${n}`).join(' ')}`)
