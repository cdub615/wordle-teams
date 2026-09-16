#!/usr/bin/env node
// Read-only. For each (player, puzzleDay) collision, ask the data which board
// actually belongs to which day — DO NOT GUESS AND DO NOT DELETE.
//
// WHY THIS EXISTS. prod-duplicate-scores.mjs finds 12 collisions once the day is
// derived the way the v2 copy derives it. Several of those two rows carry
// DIFFERENT ANSWERS, and two different Wordle answers cannot be the same puzzle.
// So they are not double submits at all: they are two genuine boards that the
// timezone derivation collapsed onto one day (wordle-teams-31e), and deleting
// either one destroys a real result.
//
// THE TEST IS CONSENSUS. Everybody plays the same puzzle on the same day, so the
// answer the rest of the player base recorded for a given day is authoritative.
// For each side of a collision this prints which day that answer is the consensus
// for, and how many players agree. A row whose answer matches the consensus for a
// NEIGHBOURING day is a mis-dated board to be moved, not a duplicate to be
// deleted.
//
// Prints answers, dates, row ids and counts. No addresses. This repo is public.
import { createClient } from '@supabase/supabase-js'
import { puzzleDayFor } from '../v2/scripts/lib/supabase-scope.mjs'

const URL = process.env.PROD_URL || process.env.NEXT_PUBLIC_SUPABASE_URL
const KEY = process.env.PROD_KEY || process.env.SUPABASE_SERVICE_ROLE_KEY
if (!URL || !KEY) {
  console.error('Set PROD_URL/PROD_KEY, or pass --env-file=.env.production.local')
  process.exit(1)
}
if (!URL.includes('dcfqzbdusxhrfgvnpwqc')) {
  console.error(`Refusing to run: ${URL} is not the prod project.`)
  process.exit(1)
}

const supabase = createClient(URL, KEY, {
  auth: { autoRefreshToken: false, persistSession: false },
})

async function readAll(table, columns) {
  const out = []
  for (let from = 0; ; from += 1000) {
    const { data, error } = await supabase.from(table).select(columns).range(from, from + 999)
    if (error) throw new Error(error.message)
    out.push(...data)
    if (data.length < 1000) break
  }
  return out
}

const rows = await readAll('daily_scores', 'id, player_id, date, guesses, answer, created_at')
const players = await readAll('players', 'id, time_zone')
const tzByPlayer = new Map(players.map((p) => [p.id, p.time_zone]))
const dayOf = (r) => puzzleDayFor(r.date, tzByPlayer.get(r.player_id))

// answer -> day -> how many DISTINCT players recorded it. Distinct players, not
// rows, so one person's duplicate cannot outvote anybody.
const votes = new Map()
for (const r of rows) {
  if (!r.answer) continue
  const a = r.answer.toUpperCase()
  if (!votes.has(a)) votes.set(a, new Map())
  const days = votes.get(a)
  const d = dayOf(r)
  if (!days.has(d)) days.set(d, new Set())
  days.get(d).add(r.player_id)
}

const consensusFor = (answer) => {
  const days = votes.get((answer || '').toUpperCase())
  if (!days) return null
  const ranked = [...days.entries()]
    .map(([day, players]) => ({ day, players: players.size }))
    .sort((a, b) => b.players - a.players)
  return ranked[0] ?? null
}

const byDay = new Map()
for (const r of rows) {
  const key = `${r.player_id}|${dayOf(r)}`
  if (!byDay.has(key)) byDay.set(key, [])
  byDay.get(key).push(r)
}
const collisions = [...byDay.values()].filter((g) => g.length > 1)

console.log(`collisions on (player, puzzleDay): ${collisions.length}\n`)

let trueDuplicates = 0
let misdated = 0
let unresolved = 0

for (const g of collisions) {
  const sorted = [...g].sort((a, b) => new Date(a.created_at) - new Date(b.created_at))
  const day = dayOf(sorted[0])
  const answers = new Set(sorted.map((r) => (r.answer || '').toUpperCase()))

  if (answers.size === 1) {
    trueDuplicates++
    console.log(`  ${day}  TRUE DUPLICATE — same answer ${[...answers][0]}, ids ${sorted.map((r) => r.id).join(', ')}`)
    continue
  }

  console.log(`  ${day}  CONTENT DIFFERS — resolving by consensus:`)
  let anyMoved = false
  for (const r of sorted) {
    const c = consensusFor(r.answer)
    const verdict =
      c === null
        ? 'no other player recorded this answer — UNRESOLVED'
        : c.day === day
          ? `belongs to ${c.day} (${c.players} players agree) — STAYS`
          : `belongs to ${c.day} (${c.players} players agree) — MIS-DATED, move it`
    if (c && c.day !== day) anyMoved = true
    console.log(`      id=${String(r.id).padStart(6)} answer=${r.answer ?? '-'}  ${verdict}`)
  }
  if (anyMoved) misdated++
  else unresolved++
}

console.log(`\n  true duplicates (same answer, safe to collapse) : ${trueDuplicates}`)
console.log(`  mis-dated boards (move, do NOT delete)          : ${misdated}`)
console.log(`  needs a human                                   : ${unresolved}`)
