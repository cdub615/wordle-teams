#!/usr/bin/env node
/**
 * ONE-OFF MEASUREMENT for wordle-teams-ef54. Read-only.
 *
 *   node --env-file=.env.local scripts/measure-insights-pairs.mjs \
 *     --corpus=/path/to/v2026-09-01
 *
 * Settles two things the A1 spike left as an upper bound and an assumption: what
 * fraction of boards ACTUALLY carry a rank in the 500-pair frontier, and whether
 * players play fixed opening pairs at all -- because a pair rank describes only a
 * player who does. See internal.migrate.insightsPairProbe for why the second
 * question is the one that decides the feature.
 *
 * PRINTS COUNTS AND GAME WORDS, NEVER PLAYERS. The probe returns a histogram
 * rather than a row per player; nothing here can reconstruct one.
 */
import { readFileSync } from 'node:fs'
import { ConvexHttpClient } from 'convex/browser'
import { internal } from '../convex/_generated/api.js'

const corpusDir = process.argv.find((a) => a.startsWith('--corpus='))?.slice('--corpus='.length)
if (!corpusDir) throw new Error('--corpus=<dir> is required')

const url = process.env.CONVEX_URL
const key = process.env.CONVEX_MIGRATION_KEY
if (!url || !key) throw new Error('CONVEX_URL and CONVEX_MIGRATION_KEY are required')

const rows = readFileSync(`${corpusDir}/opening-pair-frontier.csv`, 'utf8').trim().split('\n')
const head = rows[0].split(',')
const [w1, w2] = [head.indexOf('word_1'), head.indexOf('word_2')]
const frontier = new Set(
  rows.slice(1).map((r) => {
    const c = r.split(',')
    return `${c[w1]}${c[w2]}`.toUpperCase()
  }),
)
console.log(`frontier: ${frontier.size} distinct ordered pairs`)

const client = new ConvexHttpClient(url)
client.setAdminAuth(key)

let cursor = null
let playersWithBoards = 0
let playersBelowMinimum = 0
let boardsWithoutSecondGuess = 0
const share = Array.from({ length: 10 }, () => 0)
const pairs = new Map()

for (;;) {
  const page = await client.query(internal.migrate.insightsPairProbe, { cursor })
  playersWithBoards += page.playersWithBoards
  playersBelowMinimum += page.playersBelowMinimum
  boardsWithoutSecondGuess += page.boardsWithoutSecondGuess
  page.fixedPairShare.forEach((n, i) => (share[i] += n))
  for (const { pair, n } of page.pairs) pairs.set(pair, (pairs.get(pair) ?? 0) + n)
  if (page.isDone) break
  cursor = page.cursor
}

const entries = [...pairs]
const boards = entries.reduce((t, [, n]) => t + n, 0)
const matched = entries.filter(([p]) => frontier.has(p))
const matchedBoards = matched.reduce((t, [, n]) => t + n, 0)
const pct = (n, d) => (d === 0 ? '—' : `${((n / d) * 100).toFixed(1)}%`)

console.log(`\nboards with a first AND second guess: ${boards}   (${boardsWithoutSecondGuess} without)`)
console.log(`distinct opening pairs played: ${entries.length}`)

console.log(`\nTRUE PAIR-RANK COVERAGE (the A1 upper bound was 24.2%)`)
console.log(`  boards carrying a frontier rank: ${matchedBoards}/${boards}  ${pct(matchedBoards, boards)}`)
console.log(`  distinct played pairs on the frontier: ${matched.length}/${entries.length}`)
if (matched.length) console.log(`  which: ${matched.sort((a, b) => b[1] - a[1]).map(([p, n]) => `${p.slice(0, 5)}+${p.slice(5)}:${n}`).join(', ')}`)

console.log(`\nDO PLAYERS PLAY A FIXED PAIR? (players with >=5 boards)`)
const counted = share.reduce((t, n) => t + n, 0)
console.log(`  ${playersWithBoards} players hold boards; ${playersBelowMinimum} below the 5-board minimum; ${counted} measured`)
for (let i = 9; i >= 0; i--) {
  const bar = '#'.repeat(Math.round((share[i] / Math.max(1, Math.max(...share))) * 40))
  console.log(`  top pair covers ${i * 10}-${i * 10 + 10}% of their boards: ${String(share[i]).padStart(3)}  ${bar}`)
}
const devoted = share[8] + share[9]
console.log(`  players whose top pair covers >=80% of their boards: ${devoted}/${counted}  ${pct(devoted, counted)}`)

console.log(`\ntop played pairs: ${entries.sort((a, b) => b[1] - a[1]).slice(0, 8).map(([p, n]) => `${p.slice(0, 5)}+${p.slice(5)}:${n}`).join(' ')}`)
