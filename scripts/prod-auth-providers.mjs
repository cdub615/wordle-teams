#!/usr/bin/env node
// Read-only prod report: which auth providers do real users actually sign in with,
// and how many have ever signed in at all. Informs the v2 Phase 1 decision about
// which social providers to carry over (the design proposes trimming six to four).
//
// Prints counts only — no addresses, no names. This repo is public.
//
// Usage: node --env-file=.env.production.local scripts/prod-auth-providers.mjs
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

const admin = createClient(URL, KEY, {
  auth: { autoRefreshToken: false, persistSession: false },
})

const users = []
for (let page = 1; page <= 20; page++) {
  const { data, error } = await admin.auth.admin.listUsers({ page, perPage: 1000 })
  if (error) throw error
  users.push(...data.users)
  if (data.users.length < 1000) break
}

const byProvider = new Map()
const signedInByProvider = new Map()
let neverSignedIn = 0

const bump = (m, k) => m.set(k, (m.get(k) ?? 0) + 1)

for (const u of users) {
  // identities is the authoritative list; app_metadata.provider is only the most recent.
  const providers = new Set((u.identities ?? []).map((i) => i.provider))
  if (providers.size === 0) providers.add(u.app_metadata?.provider ?? 'unknown')
  for (const p of providers) {
    bump(byProvider, p)
    if (u.last_sign_in_at) bump(signedInByProvider, p)
  }
  if (!u.last_sign_in_at) neverSignedIn++
}

console.log(`total auth users        : ${users.length}`)
console.log(`never signed in         : ${neverSignedIn}`)
console.log(`signed in at least once : ${users.length - neverSignedIn}`)
console.log('\nidentities by provider (users may have more than one):')
const rows = [...byProvider.entries()].sort((a, b) => b[1] - a[1])
for (const [p, n] of rows) {
  console.log(`  ${p.padEnd(10)} linked=${String(n).padStart(4)}   of those, ever signed in=${signedInByProvider.get(p) ?? 0}`)
}

const KEEP = new Set(['email', 'google', 'azure', 'github', 'twitter'])
const dropped = rows.filter(([p]) => !KEEP.has(p))
console.log('\nif the design trims to google/azure/github/twitter (+ email OTP):')
if (dropped.length === 0) {
  console.log('  nothing would be dropped.')
} else {
  for (const [p, n] of dropped) {
    console.log(`  ${p}: ${n} linked identity(ies), ${signedInByProvider.get(p) ?? 0} have ever signed in`)
  }
  console.log('  Each of these users can still get in via email OTP on the same address.')
}
