#!/usr/bin/env node
// Read-only prod report: are the azure users PERSONAL Microsoft accounts or
// work/school accounts?
//
// This decides whether v2 can pin the Microsoft provider to the 'organizations'
// tenant. 'common' routes personal accounts through login.live.com, which is
// where v2's sign-in is currently failing. 'organizations' never touches MSA —
// but it also locks out anyone whose account IS personal, so the split has to
// be measured rather than assumed.
//
// Personal accounts carry a fixed tid claim; work/school accounts carry their
// own tenant's id.
//
// Prints counts and claim KEYS only — never addresses, names, or tenant ids
// belonging to real organizations. This repo is public.
//
// Usage: node --env-file=.env.production.local scripts/prod-azure-account-types.mjs
import { createClient } from '@supabase/supabase-js'

const CONSUMER_TENANT = '9188040d-6c67-4c5b-b112-36a304b66dad'

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

// The identities array is NOT reliable here. Some accounts carry no identities
// row at all and expose their provider only via app_metadata.provider — a naive
// identities-only filter reports zero azure users when there are 15.
const providersOf = (u) => {
  const s = new Set((u.identities ?? []).map((i) => i.provider))
  if (s.size === 0) s.add(u.app_metadata?.provider ?? 'unknown')
  for (const p of u.app_metadata?.providers ?? []) s.add(p)
  return s
}

const azureUsers = users.filter((u) => providersOf(u).has('azure'))

// Prefer the identity row when there is one, else fall back to the user's own
// metadata, which is where the OIDC claims land for identity-less accounts.
const azureIdentities = azureUsers.map((u) => {
  const row = (u.identities ?? []).find((i) => i.provider === 'azure')
  return {
    identity_data: row?.identity_data ?? u.user_metadata ?? {},
    source: row ? 'identities' : 'user_metadata',
  }
})

const bySource = azureIdentities.reduce((acc, i) => {
  acc[i.source] = (acc[i.source] ?? 0) + 1
  return acc
}, {})
console.log(`azure users found           : ${azureUsers.length}`)
console.log(`  claim source              : ${JSON.stringify(bySource)}`)

let personal = 0
let work = 0
let unknown = 0
const claimKeys = new Set()
// How many DISTINCT work/school tenants are represented. This decides whether
// one admin's consent covers everyone: consent granted in a directory applies
// only to that directory, so a multi-tenant spread means each org's admin (or
// each user, where the tenant permits self-consent) has to consent separately.
// Counted, never printed — a tenant id identifies a real organisation.
const workTenants = new Set()

for (const id of azureIdentities) {
  const d = id.identity_data ?? {}
  for (const k of Object.keys(d)) claimKeys.add(k)

  // tid is the authoritative signal. Fall back to iss, which embeds the tenant
  // — but iss is not always a URL here, so match the guid anywhere in the
  // string rather than assuming a path shape.
  const iss = typeof d.iss === 'string' ? d.iss : ''
  const guid = iss.match(/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/i)?.[0]
  const tid = d.tid ?? guid

  if (!tid) {
    unknown++
    // Report WHY it could not be resolved, so an indeterminate result can be
    // acted on rather than just noted. Keys and the issuer HOST only — never
    // the tenant id itself, which belongs to a real organisation.
    const issHost =
      typeof d.iss === 'string' ? (() => { try { return new URL(d.iss).host } catch { return '(unparseable)' } })() : '(no iss)'
    console.log(`  [indeterminate] iss host=${issHost} keys=${Object.keys(d).sort().join(',') || '(empty)'}`)
  } else if (tid === CONSUMER_TENANT) personal++
  else {
    work++
    workTenants.add(tid)
  }
}

console.log(`azure identities            : ${azureIdentities.length}`)
console.log(`  personal Microsoft account: ${personal}`)
console.log(`  work/school account       : ${work}  (across ${workTenants.size} distinct tenant(s))`)
console.log(`  indeterminate             : ${unknown}`)
console.log(`\nclaim keys present on azure identities (names only):`)
console.log(`  ${[...claimKeys].sort().join(', ') || '(none)'}`)

console.log('')
if (personal === 0 && unknown === 0) {
  console.log("=> SAFE to pin tenantId:'organizations' — no personal accounts in use.")
} else if (personal > 0) {
  console.log(
    `=> NOT safe to pin 'organizations': ${personal} user(s) sign in with a personal account.`,
  )
} else {
  console.log(
    `=> INCONCLUSIVE: ${unknown} identity(ies) carry no tenant claim. Do not pin without resolving these.`,
  )
}
