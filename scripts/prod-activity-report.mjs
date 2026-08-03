#!/usr/bin/env node
// Read-only prod report: who is actually entering boards (daily_scores), and are any of
// them outside the teams Christian is a member of?
//
// Usage: node --env-file=.env.production.local scripts/prod-activity-report.mjs
//    or: PROD_URL=... PROD_KEY=<service_role> node scripts/prod-activity-report.mjs
import { createClient } from '@supabase/supabase-js'

const PROD_URL = process.env.PROD_URL || process.env.NEXT_PUBLIC_SUPABASE_URL
const PROD_KEY = process.env.PROD_KEY || process.env.SUPABASE_SERVICE_ROLE_KEY
if (!PROD_URL || !PROD_KEY) {
  console.error('Set PROD_URL/PROD_KEY, or pass --env-file=.env.production.local')
  process.exit(1)
}
if (!PROD_URL.includes('dcfqzbdusxhrfgvnpwqc')) {
  console.error(`Refusing to run: ${PROD_URL} is not the prod project.`)
  process.exit(1)
}
// Whose teams count as "mine" for the in/out split. Kept out of source on purpose:
// this repo is public, so pass it at runtime rather than hardcoding an address.
const ME = (process.env.ME_EMAIL || '').toLowerCase()
if (!ME) {
  console.error('Set ME_EMAIL to the account whose teams should be treated as "mine".')
  process.exit(1)
}
const admin = createClient(PROD_URL, PROD_KEY, { auth: { autoRefreshToken: false, persistSession: false } })

async function pageAll(table, select) {
  const rows = []
  const size = 1000
  for (let from = 0; ; from += size) {
    const { data, error } = await admin.from(table).select(select).range(from, from + size - 1)
    if (error) throw new Error(`${table}: ${error.message}`)
    rows.push(...data)
    if (data.length < size) break
  }
  return rows
}

const [players, teams, scores] = await Promise.all([
  pageAll('players', 'id,email,first_name,last_name,created_at'),
  pageAll('teams', 'id,name,creator,player_ids,invited,created_at'),
  pageAll('daily_scores', 'id,player_id,date,created_at,guesses,answer'),
])

const byId = new Map(players.map((p) => [p.id, p]))
const me = players.find((p) => (p.email || '').toLowerCase() === ME)
if (!me) {
  console.error(`No player row found for ${ME}. Emails present: ${players.length}`)
  process.exit(1)
}

// All accounts sharing my email's auth identity aren't tracked here; go by player id.
const myTeams = teams.filter((t) => t.creator === me.id || (t.player_ids || []).includes(me.id))
const myTeamIds = new Set(myTeams.map((t) => t.id))
const myOrbit = new Set() // player ids on any team I'm on
for (const t of myTeams) {
  ;(t.player_ids || []).forEach((id) => myOrbit.add(id))
  if (t.creator) myOrbit.add(t.creator)
}

// Aggregate scores per player. A "real" entry = has guesses.
const agg = new Map()
for (const s of scores) {
  const g = (s.guesses || []).filter(Boolean)
  const a = agg.get(s.player_id) || { total: 0, withGuesses: 0, first: null, last: null }
  a.total++
  if (g.length) a.withGuesses++
  const d = s.date?.slice(0, 10)
  if (d && (!a.first || d < a.first)) a.first = d
  if (d && (!a.last || d > a.last)) a.last = d
  agg.set(s.player_id, a)
}

const teamsOf = (pid) =>
  teams.filter((t) => t.creator === pid || (t.player_ids || []).includes(pid)).map((t) => `${t.id}:${t.name}`)

const today = new Date()
const daysAgo = (iso) => (iso ? Math.round((today - new Date(iso + 'T00:00:00Z')) / 86400000) : null)

const rows = [...agg.entries()]
  .map(([pid, a]) => {
    const p = byId.get(pid)
    return {
      pid,
      email: p?.email ?? '(no player row)',
      name: p ? `${p.first_name} ${p.last_name}`.trim() : '(unknown)',
      ...a,
      lastDays: daysAgo(a.last),
      inMyOrbit: myOrbit.has(pid),
      teams: teamsOf(pid),
    }
  })
  .sort((x, y) => (y.last || '').localeCompare(x.last || '') || y.withGuesses - x.withGuesses)

const fmt = (r) =>
  `${(r.last || '?').padEnd(10)}  ${String(r.withGuesses).padStart(5)} entries  ${String(r.lastDays ?? '?').padStart(4)}d ago  ${r.email.padEnd(38)} ${r.name.padEnd(24)} teams[${r.teams.join(', ')}]`

console.log('=== TOTALS ===')
console.log(`players: ${players.length}  teams: ${teams.length}  daily_scores rows: ${scores.length}`)
console.log(`players with >=1 score row: ${rows.length}  with >=1 non-empty entry: ${rows.filter((r) => r.withGuesses).length}`)
console.log(`my player id: ${me.id} (${me.email})`)
console.log(`my teams (${myTeams.length}): ${myTeams.map((t) => `${t.id}:${t.name}`).join(', ')}`)
console.log(`distinct players on my teams: ${myOrbit.size}`)

const outside = rows.filter((r) => !r.inMyOrbit && r.withGuesses > 0)
const inside = rows.filter((r) => r.inMyOrbit && r.withGuesses > 0)

console.log(`\n=== ACTIVE PLAYERS *OUTSIDE* MY TEAMS (${outside.length}) ===`)
outside.forEach((r) => console.log(fmt(r)))

console.log(`\n=== ACTIVE PLAYERS ON MY TEAMS (${inside.length}) ===`)
inside.forEach((r) => console.log(fmt(r)))

for (const win of [7, 30, 90, 365]) {
  const act = rows.filter((r) => r.withGuesses && r.lastDays !== null && r.lastDays <= win)
  console.log(
    `\nlast ${String(win).padStart(3)}d: ${String(act.length).padStart(3)} active players  (${act.filter((r) => !r.inMyOrbit).length} outside my teams, ${act.filter((r) => r.inMyOrbit).length} on my teams)`
  )
}

// Teams with any scoring activity, to spot orgs using the app independently.
console.log('\n=== TEAMS BY ACTIVE MEMBERS (scoring players) ===')
const teamRows = teams
  .map((t) => {
    const members = [...new Set([...(t.player_ids || []), t.creator].filter(Boolean))]
    const active = members.filter((m) => (agg.get(m)?.withGuesses || 0) > 0)
    const last = active.map((m) => agg.get(m).last).sort().pop() || null
    return { id: t.id, name: t.name, members: members.length, active: active.length, last, mine: myTeamIds.has(t.id) }
  })
  .filter((t) => t.active > 0)
  .sort((a, b) => (b.last || '').localeCompare(a.last || ''))
teamRows.forEach((t) =>
  console.log(
    `${(t.last || '?').padEnd(10)}  ${String(t.active).padStart(2)}/${String(t.members).padEnd(2)} active  ${t.mine ? 'MINE ' : '     '} ${t.id}:${t.name}`
  )
)

// Non-empty score rows in the last 30 days, by day, to gauge real daily usage.
console.log('\n=== ENTRIES PER DAY (last 30 days with activity) ===')
const perDay = new Map()
for (const s of scores) {
  if (!(s.guesses || []).filter(Boolean).length) continue
  const d = s.date?.slice(0, 10)
  if (!d) continue
  const e = perDay.get(d) || { n: 0, outside: 0 }
  e.n++
  if (!myOrbit.has(s.player_id)) e.outside++
  perDay.set(d, e)
}
;[...perDay.entries()]
  .sort((a, b) => b[0].localeCompare(a[0]))
  .slice(0, 30)
  .forEach(([d, e]) => console.log(`${d}  ${String(e.n).padStart(3)} entries  (${e.outside} from outside my teams)`))
