// Shared between copy-from-supabase.mjs and verify-parity.mjs.
//
// These two MUST agree about what "in scope" means. If the verifier resolved
// scope even slightly differently from the copier it would report mismatches
// that are really just two scripts disagreeing — the worst kind of failing
// check, because the instinct is to distrust the data rather than the tooling.
// One implementation, imported twice.

import { createClient } from '@supabase/supabase-js'

const PROD_REF = 'dcfqzbdusxhrfgvnpwqc'

/** Connect to production, refusing anything that is not it. */
export function connect() {
  const url = process.env.PROD_URL || process.env.NEXT_PUBLIC_SUPABASE_URL
  const key = process.env.PROD_KEY || process.env.SUPABASE_SERVICE_ROLE_KEY
  if (!url || !key) {
    console.error('Set PROD_URL/PROD_KEY, or pass --env-file=../.env.production.local')
    process.exit(1)
  }
  // Same guard the other prod scripts carry: a stale env file must not be able
  // to point a migration at some other project.
  if (!url.includes(PROD_REF)) {
    console.error(`Refusing to run: ${url} is not the prod project.`)
    process.exit(1)
  }
  return createClient(url, key, { auth: { autoRefreshToken: false, persistSession: false } })
}

export async function readAll(supabase, table, select = '*') {
  const rows = []
  for (let from = 0; ; from += 1000) {
    const { data, error } = await supabase.from(table).select(select).range(from, from + 999)
    if (error) throw new Error(`${table}: ${error.message}`)
    rows.push(...data)
    if (data.length < 1000) break
  }
  return rows
}

/** Reads every table and narrows to the requested scope. */
export async function readScoped(supabase, scope, meEmail) {
  const [players, teams, scores, winners, memberships, webhooks] = await Promise.all([
    readAll(supabase, 'players'),
    readAll(supabase, 'teams'),
    readAll(supabase, 'daily_scores'),
    readAll(supabase, 'monthly_winners'),
    readAll(supabase, 'player_customer'),
    readAll(supabase, 'webhook_events'),
  ])

  let scopedTeams = teams
  let scopedPlayerIds = new Set(players.map((p) => p.id))

  if (scope === 'mine') {
    const me = players.find((p) => (p.email || '').toLowerCase() === meEmail)
    if (!me) {
      console.error('ME_EMAIL does not match any player in production.')
      process.exit(1)
    }
    scopedTeams = teams.filter((t) => (t.player_ids || []).includes(me.id) || t.creator === me.id)
    // Everyone in those teams, so scoreboards have real opponents rather than a
    // single player talking to themselves.
    scopedPlayerIds = new Set([me.id, ...scopedTeams.flatMap((t) => t.player_ids || [])])
  }

  const scopedTeamIds = new Set(scopedTeams.map((t) => t.id))

  return {
    totals: {
      players: players.length,
      teams: teams.length,
      dailyScores: scores.length,
      monthlyWinners: winners.length,
      playerMembership: memberships.length,
      webhookEvents: webhooks.length,
    },
    players: players.filter((p) => scopedPlayerIds.has(p.id)),
    teams: scopedTeams,
    scores: scores.filter((s) => scopedPlayerIds.has(s.player_id)),
    winners: winners.filter((w) => scopedTeamIds.has(w.team_id)),
    memberships: memberships.filter((m) => scopedPlayerIds.has(m.player_id)),
    webhooks: webhooks.filter((w) => scopedPlayerIds.has(w.player_id)),
  }
}

// --- puzzle day ---------------------------------------------------------------

// The backfill rule, shared so the verifier recomputes exactly what the copier
// wrote. See copy-from-supabase.mjs for why it is the player's own timezone.
export const HOME_TZ = 'America/Chicago'

const formatters = new Map()
function formatterFor(tz) {
  if (!formatters.has(tz)) {
    try {
      formatters.set(
        tz,
        // 'en-CA' formats as YYYY-MM-DD, which is the shape stored.
        new Intl.DateTimeFormat('en-CA', {
          timeZone: tz,
          year: 'numeric',
          month: '2-digit',
          day: '2-digit',
        }),
      )
    } catch {
      formatters.set(tz, null)
    }
  }
  return formatters.get(tz)
}

export function puzzleDayFor(instantIso, timeZone) {
  const fmt = formatterFor(timeZone || HOME_TZ) ?? formatterFor(HOME_TZ)
  return fmt.format(new Date(instantIso))
}
