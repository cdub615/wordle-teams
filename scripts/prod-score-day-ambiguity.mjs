#!/usr/bin/env node
// Read-only prod analysis for the cross-timezone scoring bug.
//
// v1 stores daily_scores.date as an INSTANT (timestamptz) and decides which
// calendar day a board belongs to with isSameDay(new Date(s.date), day)
// (src/lib/types.ts:179) — which resolves that instant in whatever timezone the
// VIEWER is in. So a board entered while travelling can land on a different day
// for a teammate than it did for the person who entered it.
//
// v2 needs to store the puzzle day explicitly. This measures how ambiguous the
// historical data is, so the backfill rule is chosen with evidence:
//   how many rows land on a different calendar day in UTC vs in the player's
//   own recorded timezone vs in the app's home timezone (US Central)?
//
// Prints counts only. This repo is public.
import { createClient } from '@supabase/supabase-js'

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

async function readAll(table, select) {
  const rows = []
  for (let from = 0; ; from += 1000) {
    const { data, error } = await supabase.from(table).select(select).range(from, from + 999)
    if (error) throw new Error(`${table}: ${error.message}`)
    rows.push(...data)
    if (data.length < 1000) break
  }
  return rows
}

const HOME_TZ = 'America/Chicago'

/** Calendar day for an instant, as seen in a given IANA zone. */
const dayIn = (iso, tz) => {
  try {
    return new Intl.DateTimeFormat('en-CA', {
      timeZone: tz,
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
    }).format(new Date(iso))
  } catch {
    return null
  }
}

const [scores, players] = await Promise.all([
  readAll('daily_scores', 'id, player_id, date'),
  readAll('players', 'id, time_zone'),
])

const tzOf = new Map(players.map((p) => [p.id, p.time_zone]))

let utcVsHome = 0
let utcVsPlayer = 0
let homeVsPlayer = 0
let noTz = 0
const hourHistogram = new Map()

for (const s of scores) {
  const utcDay = dayIn(s.date, 'UTC')
  const homeDay = dayIn(s.date, HOME_TZ)
  const tz = tzOf.get(s.player_id)
  const playerDay = tz ? dayIn(s.date, tz) : null

  if (utcDay !== homeDay) utcVsHome++
  if (playerDay) {
    if (utcDay !== playerDay) utcVsPlayer++
    if (homeDay !== playerDay) homeVsPlayer++
  } else {
    noTz++
  }

  const hour = new Date(s.date).getUTCHours()
  hourHistogram.set(hour, (hourHistogram.get(hour) ?? 0) + 1)
}

console.log(`daily_scores rows                 : ${scores.length}`)
console.log(`rows whose player has no time_zone: ${noTz}`)
console.log('')
console.log('Rows where the calendar day DIFFERS depending on which zone you resolve it in:')
console.log(`  UTC vs ${HOME_TZ}      : ${utcVsHome}`)
console.log(`  UTC vs the player's own zone   : ${utcVsPlayer}`)
console.log(`  ${HOME_TZ} vs player's zone : ${homeVsPlayer}`)

console.log('\nStored time-of-day (UTC hour) — a single spike means one convention, a spread means many:')
const rows = [...hourHistogram.entries()].sort((a, b) => a[0] - b[0])
const max = Math.max(...rows.map(([, n]) => n))
for (const [hour, n] of rows) {
  const bar = '#'.repeat(Math.max(1, Math.round((n / max) * 40)))
  console.log(`  ${String(hour).padStart(2, '0')}:00Z ${String(n).padStart(5)} ${bar}`)
}

const distinctTz = new Set([...tzOf.values()].filter(Boolean))
console.log(`\ndistinct player timezones in production: ${distinctTz.size}`)
console.log([...distinctTz].sort().join(', '))
