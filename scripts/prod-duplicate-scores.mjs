#!/usr/bin/env node
// Read-only prod check: how many daily_scores rows collide on the pair the app
// treats as ONE board?
//
// TWO GROUPINGS, AND THE SECOND IS THE ONE THAT MATTERS. An earlier version of
// this script only grouped on the RAW (player_id, date) timestamptz and reported
// 5 pairs. That number is real but it is not the number that reaches v2, because
// v1 stores `date` as an instant with an inconsistent time-of-day — some rows are
// midnight-normalised, others carry the moment of entry. Two boards entered for
// the same calendar day at different times are two DIFFERENT raw values and so
// look like different days to a naive grouping. wordle-teams-rac says exactly
// this about a unique index; it applies just as much to measuring the problem as
// to constraining it.
//
// What v2 stores is `puzzleDay`, derived by copy-from-supabase.mjs as
// puzzleDayFor(date, player.time_zone). Rows that differ in the raw column can
// land on the SAME puzzleDay and become a visible duplicate on the insights page.
// So this script derives the day with the copy's own function — imported, not
// reimplemented, so the two cannot drift — and reports both counts.
//
// Prints counts, dates and row ids only, never addresses. This repo is public.
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
// The copy resolves each instant in the PLAYER's own recorded zone, so the day a
// board belongs to is a per-player question. Same source, same rule.
const players = await readAll('players', 'id, time_zone')
const tzByPlayer = new Map(players.map((p) => [p.id, p.time_zone]))

const group = (keyOf) => {
  const by = new Map()
  for (const r of rows) {
    const key = keyOf(r)
    if (!by.has(key)) by.set(key, [])
    by.get(key).push(r)
  }
  return by
}

const byRaw = group((r) => `${r.player_id}|${r.date}`)
const byPuzzleDay = group((r) => `${r.player_id}|${puzzleDayFor(r.date, tzByPlayer.get(r.player_id))}`)

const dupesRaw = [...byRaw.values()].filter((g) => g.length > 1)
const dupesDay = [...byPuzzleDay.values()].filter((g) => g.length > 1)

console.log(`daily_scores rows            : ${rows.length}`)
console.log(`distinct (player, raw date)  : ${byRaw.size}   -> ${dupesRaw.length} pairs, ${rows.length - byRaw.size} excess`)
console.log(`distinct (player, puzzleDay) : ${byPuzzleDay.size}   -> ${dupesDay.length} pairs, ${rows.length - byPuzzleDay.size} excess`)
console.log('\nThe second line is what reaches v2 and what a player sees on /insights.')

if (dupesDay.length) {
  console.log('\nEach duplicate puzzle day (player anonymised):')
  for (const g of dupesDay) {
    const sorted = [...g].sort((a, b) => new Date(a.created_at) - new Date(b.created_at))
    const day = puzzleDayFor(sorted[0].date, tzByPlayer.get(sorted[0].player_id))
    const rawDiffers = new Set(g.map((r) => r.date)).size > 1
    console.log(
      `\n  puzzleDay ${day} — ${g.length} rows${rawDiffers ? '  (raw dates DIFFER — invisible to the old grouping)' : ''}`,
    )
    for (const r of sorted) {
      const identical =
        JSON.stringify(r.guesses) === JSON.stringify(sorted[0].guesses) &&
        r.answer === sorted[0].answer
      const gap = (new Date(r.created_at) - new Date(sorted[0].created_at)) / 1000
      console.log(
        `    id=${String(r.id).padStart(6)} raw=${r.date} created=+${gap}s guesses=${(r.guesses || []).length} answer=${r.answer ?? '-'}${identical ? '' : '  <-- CONTENT DIFFERS from the first'}`,
      )
    }
  }
  console.log(
    '\nThe v2 copy keys on legacyId and copies EVERY row (see v2/convex/migrate.ts),',
  )
  console.log(
    'so each of these becomes two rows in Convex and two entries in the insights list.',
  )
}
