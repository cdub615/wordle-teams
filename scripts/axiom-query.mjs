#!/usr/bin/env node
// Read-only Axiom log query helper for verifying app activity (e.g. the invite -> /api/auth/callback flow).
//
// Setup (one-time): add to .env.local
//   AXIOM_TOKEN=xaat-...            # Axiom API token with query permission
//   AXIOM_DATASET=<dataset>         # optional; the Vercel<->Axiom integration's dataset
//   AXIOM_ORG_ID=<org id>           # optional; required for some personal tokens
//
// Usage:
//   node scripts/axiom-query.mjs datasets                 # list datasets (find the right name)
//   node scripts/axiom-query.mjs invite                   # canned: recent auth-callback / invite activity
//   node scripts/axiom-query.mjs "<APL query>"            # run an arbitrary APL query
//   node scripts/axiom-query.mjs "<APL>" 6h               # with a lookback window (default 24h)

import { readFileSync } from 'node:fs'

function loadEnv() {
  const env = { ...process.env }
  try {
    const raw = readFileSync(new URL('../.env.local', import.meta.url), 'utf8')
    for (const line of raw.split('\n')) {
      const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/)
      if (m && !line.trimStart().startsWith('#')) {
        let v = m[2].trim().replace(/^["']|["']$/g, '')
        if (env[m[1]] === undefined) env[m[1]] = v
      }
    }
  } catch {}
  return env
}

const env = loadEnv()
const TOKEN = env.AXIOM_TOKEN
const ORG = env.AXIOM_ORG_ID
const BASE = env.AXIOM_URL || 'https://api.axiom.co'
if (!TOKEN) {
  console.error('Missing AXIOM_TOKEN in env/.env.local. See header of this file for setup.')
  process.exit(1)
}
const headers = { Authorization: `Bearer ${TOKEN}`, 'Content-Type': 'application/json' }
if (ORG) headers['X-Axiom-Org-Id'] = ORG

const [, , cmd = 'invite', windowArg = '24h'] = process.argv

async function listDatasets() {
  const res = await fetch(`${BASE}/v1/datasets`, { headers })
  const body = await res.text()
  if (!res.ok) throw new Error(`${res.status} ${body}`)
  const ds = JSON.parse(body)
  console.log('Datasets:')
  for (const d of ds) console.log(`  - ${d.name}${d.description ? '  (' + d.description + ')' : ''}`)
}

function parseWindowMs(w) {
  const m = String(w).match(/^(\d+)([mhd])$/)
  if (!m) return 24 * 3600e3
  const n = +m[1]
  return n * ({ m: 60e3, h: 3600e3, d: 86400e3 }[m[2]])
}

async function runApl(apl) {
  const end = new Date()
  const start = new Date(end.getTime() - parseWindowMs(windowArg))
  const res = await fetch(`${BASE}/v1/datasets/_apl?format=tabular`, {
    method: 'POST',
    headers,
    body: JSON.stringify({ apl, startTime: start.toISOString(), endTime: end.toISOString() }),
  })
  const body = await res.text()
  if (!res.ok) throw new Error(`${res.status} ${body}`)
  const data = JSON.parse(body)
  const rows = data?.matches ?? data?.tables?.[0]?.columns ?? data
  console.log(JSON.stringify(rows, null, 2))
}

const DATASET = env.AXIOM_DATASET
const CANNED = {
  // Auth-callback + invite activity: callback hits, verifyOtp/code-exchange failures, invited-signup RPC errors.
  invite: DATASET
    ? `['${DATASET}']\n| where tostring(message) contains '/api/auth/callback' or tostring(message) contains 'invited' or tostring(message) contains 'OTP' or tostring(message) contains 'exchange code'\n| project _time, level, message\n| sort by _time desc\n| limit 100`
    : null,
}

try {
  if (cmd === 'datasets') await listDatasets()
  else if (CANNED[cmd] !== undefined) {
    if (!CANNED[cmd]) {
      console.error('Set AXIOM_DATASET in .env.local first, or run: node scripts/axiom-query.mjs datasets')
      process.exit(1)
    }
    await runApl(CANNED[cmd])
  } else await runApl(cmd)
} catch (e) {
  console.error('Query failed:', e.message)
  process.exit(1)
}
