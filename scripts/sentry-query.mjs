#!/usr/bin/env node
// Read-only Sentry query helper, same shape as scripts/axiom-query.mjs.
//
// Setup (one-time): add to .env.local
//   SENTRY_READ_TOKEN=sntryu_...   # User Auth Token with event:read, project:read, org:read
//
// Usage:
//   node scripts/sentry-query.mjs issues [period] [query]   # issues ranked by events
//   node scripts/sentry-query.mjs users  [period]           # issues ranked by users affected
//   node scripts/sentry-query.mjs issue <id>                # one issue: detail + latest event
//   node scripts/sentry-query.mjs tags <id> [key]           # tag distribution for an issue
//   node scripts/sentry-query.mjs raw <api path>            # arbitrary /api/0/ path
//
// period: 24h | 14d | 90d (default 90d). Sentry caps statsPeriod at 90d.

import { readFileSync } from 'node:fs'

function loadEnv() {
  const env = { ...process.env }
  for (const f of ['../.env.local', '../.env.production.local']) {
    try {
      const raw = readFileSync(new URL(f, import.meta.url), 'utf8')
      for (const line of raw.split('\n')) {
        const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/)
        if (m && !line.trimStart().startsWith('#')) {
          const v = m[2].trim().replace(/^["']|["']$/g, '')
          if (env[m[1]] === undefined) env[m[1]] = v
        }
      }
    } catch {}
  }
  return env
}

const env = loadEnv()
const TOKEN = env.SENTRY_READ_TOKEN || env.SENTRY_API_TOKEN
const ORG = env.SENTRY_ORG || 'christian-white'
const PROJECT = env.SENTRY_PROJECT || 'wordle-teams'
if (!TOKEN) {
  console.error('Missing SENTRY_READ_TOKEN in .env.local. See header of this file.')
  process.exit(1)
}

const api = async (path) => {
  const url = path.startsWith('http') ? path : `https://sentry.io/api/0/${path.replace(/^\//, '')}`
  const res = await fetch(url, { headers: { Authorization: `Bearer ${TOKEN}` } })
  const body = await res.text()
  if (!res.ok) throw new Error(`${res.status} ${body.slice(0, 400)}`)
  return JSON.parse(body)
}

const [, , cmd = 'issues', a1, ...rest] = process.argv
const period = /^\d+[hd]$/.test(a1 || '') ? a1 : '90d'
const extraQuery = (/^\d+[hd]$/.test(a1 || '') ? rest : [a1, ...rest]).filter(Boolean).join(' ')

const line = (s = '') => console.log(s)
const pad = (s, n) => String(s ?? '').padEnd(n)

async function listIssues(sort) {
  // The issues endpoint only accepts statsPeriod of '', '24h', or '14d'.
  // Anything longer has to be expressed as an explicit start/end range.
  const q = new URLSearchParams({
    sort, // 'freq' = events, 'user' = users affected
    limit: '25',
    query: extraQuery || 'is:unresolved',
  })
  if (period === '24h' || period === '14d') {
    q.set('statsPeriod', period)
  } else {
    const days = Number((period.match(/^(\d+)d$/) || [, 90])[1])
    const end = new Date()
    q.set('start', new Date(end.getTime() - days * 86400e3).toISOString().slice(0, 19))
    q.set('end', end.toISOString().slice(0, 19))
  }
  const issues = await api(`projects/${ORG}/${PROJECT}/issues/?${q}`)
  line(`=== ${issues.length} issues | period=${period} | sort=${sort} | query="${extraQuery || 'is:unresolved'}" ===`)
  line(`${pad('EVENTS', 8)}${pad('USERS', 7)}${pad('LAST SEEN', 22)}${pad('ID', 12)}TITLE`)
  for (const i of issues) {
    line(
      `${pad(i.count, 8)}${pad(i.userCount, 7)}${pad((i.lastSeen || '').slice(0, 19), 22)}${pad(i.id, 12)}${(i.title || '').slice(0, 90)}`
    )
    const culprit = i.culprit || i.metadata?.filename
    if (culprit) line(`${' '.repeat(49)}↳ ${String(culprit).slice(0, 100)}`)
  }
  if (!issues.length) line('(none)')
}

async function showIssue(id) {
  const issue = await api(`issues/${id}/`)
  line(`=== ${issue.title} ===`)
  line(`id=${issue.id}  events=${issue.count}  users=${issue.userCount}  level=${issue.level}`)
  line(`first=${issue.firstSeen}  last=${issue.lastSeen}`)
  line(`culprit=${issue.culprit || '(none)'}`)
  line(`permalink=${issue.permalink}`)
  const ev = await api(`issues/${id}/events/latest/`)
  line('\n--- latest event ---')
  line(`time=${ev.dateCreated}  eventID=${ev.eventID}`)
  for (const t of ev.tags || []) line(`  ${pad(t.key, 22)}${t.value}`)
  const exc = (ev.entries || []).find((e) => e.type === 'exception')
  const frames = exc?.data?.values?.[0]?.stacktrace?.frames || []
  if (frames.length) {
    line('\n--- stack (innermost last) ---')
    for (const f of frames.slice(-12)) line(`  ${f.filename}:${f.lineNo}  in ${f.function || '?'}`)
  }
  const crumbs = (ev.entries || []).find((e) => e.type === 'breadcrumbs')?.data?.values || []
  if (crumbs.length) {
    line('\n--- last breadcrumbs ---')
    for (const c of crumbs.slice(-12)) line(`  [${c.category}] ${String(c.message || c.type).slice(0, 110)}`)
  }
}

async function showTags(id, key) {
  if (key) {
    const t = await api(`issues/${id}/tags/${key}/`)
    line(`=== ${key} (${t.uniqueValues} unique, ${t.totalValues} events) ===`)
    for (const v of t.topValues || []) line(`  ${pad(v.count, 8)}${v.value}`)
    return
  }
  const tags = await api(`issues/${id}/tags/`)
  for (const t of tags) {
    line(`=== ${t.key} (${t.uniqueValues} unique) ===`)
    for (const v of (t.topValues || []).slice(0, 6)) line(`  ${pad(v.count, 8)}${v.value}`)
  }
}

try {
  if (cmd === 'issues') await listIssues('freq')
  else if (cmd === 'users') await listIssues('user')
  else if (cmd === 'issue') await showIssue(a1)
  else if (cmd === 'tags') await showTags(a1, rest[0])
  else if (cmd === 'raw') console.log(JSON.stringify(await api(a1), null, 2))
  else console.error(`Unknown command "${cmd}". See header of this file.`)
} catch (e) {
  console.error('Query failed:', e.message)
  process.exit(1)
}
