#!/usr/bin/env node
// Read-only prod report answering ONE question: if v2 drops the X/Twitter
// provider, can every user who signs in with X still get in?
//
// The fallback is email OTP, so it only works if the X-identity user actually
// has a usable email address on their auth record. Supabase's legacy Twitter
// provider is OAuth 1.0a, which does not reliably return an email — so this
// cannot be assumed, it has to be measured.
//
// Prints counts only — no addresses, no names, no ids. This repo is public.
//
// Usage: node --env-file=.env.production.local scripts/prod-twitter-users-fallback.mjs
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

// Mirror prod-auth-providers.mjs exactly: identities is authoritative, but when
// it is empty app_metadata.provider is the only signal. Filtering on identities
// alone finds ZERO twitter users here while the provider report finds 2 — these
// accounts carry no identities row at all.
const providersOf = (u) => {
  const s = new Set((u.identities ?? []).map((i) => i.provider))
  if (s.size === 0) s.add(u.app_metadata?.provider ?? 'unknown')
  return s
}

const twitterUsers = users.filter((u) => providersOf(u).has('twitter'))

let withEmail = 0
let withConfirmedEmail = 0
let alsoHasAnotherProvider = 0
let strandedIfDropped = 0

for (const u of twitterUsers) {
  const hasEmail = Boolean(u.email)
  const confirmed = Boolean(u.email_confirmed_at || u.confirmed_at)
  const others = new Set([...providersOf(u)].filter((p) => p !== 'twitter' && p !== 'unknown'))

  if (hasEmail) withEmail++
  if (confirmed) withConfirmedEmail++
  if (others.size > 0) alsoHasAnotherProvider++

  // Stranded = no email to OTP AND no other social identity to fall back to.
  if (!hasEmail && others.size === 0) strandedIfDropped++
}

console.log(`users with a twitter identity : ${twitterUsers.length}`)
console.log(`  ...with an email address    : ${withEmail}`)
console.log(`  ...with a CONFIRMED email   : ${withConfirmedEmail}`)
console.log(`  ...also linked to another   : ${alsoHasAnotherProvider}`)
console.log('')
console.log(`STRANDED if X is dropped      : ${strandedIfDropped}`)
console.log(
  strandedIfDropped === 0
    ? '\n=> Safe to drop X: every X user has another way in.'
    : '\n=> NOT safe to drop X outright: some users have no email and no other provider.',
)
