#!/usr/bin/env node
// Read-only prod check: are there multiple daily_scores rows for the same
// (player_id, date)? The v2 copy upserts on that pair — it is the pair the app
// treats as one board — so any duplicate collapses and shows up as a row-count
// difference between Supabase and Convex.
//
// Prints counts and dates only, never addresses. This repo is public.
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

const rows = []
for (let from = 0; ; from += 1000) {
  const { data, error } = await supabase
    .from('daily_scores')
    .select('id, player_id, date, guesses, answer, created_at')
    .range(from, from + 999)
  if (error) throw new Error(error.message)
  rows.push(...data)
  if (data.length < 1000) break
}

const byPair = new Map()
for (const r of rows) {
  const key = `${r.player_id}|${r.date}`
  if (!byPair.has(key)) byPair.set(key, [])
  byPair.get(key).push(r)
}

const dupes = [...byPair.values()].filter((g) => g.length > 1)

console.log(`daily_scores rows        : ${rows.length}`)
console.log(`distinct (player, date)  : ${byPair.size}`)
console.log(`pairs with >1 row        : ${dupes.length}`)
console.log(`excess rows              : ${rows.length - byPair.size}`)

if (dupes.length) {
  console.log('\nEach duplicate group (player anonymised):')
  for (const g of dupes) {
    const sorted = [...g].sort((a, b) => new Date(a.created_at) - new Date(b.created_at))
    console.log(`\n  date ${sorted[0].date} — ${g.length} rows`)
    for (const r of sorted) {
      const identical =
        JSON.stringify(r.guesses) === JSON.stringify(sorted[0].guesses) &&
        r.answer === sorted[0].answer
      console.log(
        `    id=${String(r.id).padStart(6)} created=${r.created_at} guesses=${(r.guesses || []).length} answer=${r.answer ?? '-'}${identical ? '' : '  <-- DIFFERS from the first'}`,
      )
    }
  }
  console.log(
    '\nThe v2 copy keeps the LAST row written for each pair, so a differing duplicate means the copy picks one and drops the other.',
  )
}
