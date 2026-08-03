#!/usr/bin/env node
// Verifies that the URLs this app asks Supabase to redirect email links to are actually
// allowlisted, and that the ones it must never send are not (wordle-teams-ev8).
//
// WHY THIS EXISTS
// Supabase does not reject an unrecognised redirectTo. It silently substitutes the project's
// Site URL. So a wrong redirectTo produces no error anywhere — not in the app, not in the logs,
// not in the email — and the only symptom is that users who click an emailed link land somewhere
// that never exchanges their code and are simply never signed in.
//
// That is exactly what happened: src/lib/auth-urls.ts built the URL from VERCEL_URL, which is
// the bare scheme-less deployment hostname on every deployment, so production discarded it and
// fell back to the homepage. It broke every emailed login and every team invite, silently, and
// was only noticed because the same VERCEL_URL mistake broke Polar checkout loudly.
//
// HOW IT WORKS
// Supabase resolves redirect_to against the allowlist BEFORE it validates the token, so a
// deliberately bogus token is enough to reveal where a real link would land. Strictly read-only:
// no user is created, no email is sent, the token is garbage by construction.
//
// USAGE
//   node scripts/verify-auth-redirect-allowlist.mjs                  # production, from .env.production.local
//   SUPABASE_URL=... SUPABASE_ANON_KEY=... EXPECT_ORIGIN=https://dev.wordleteams.com \
//     node scripts/verify-auth-redirect-allowlist.mjs                # any other project
import { readFileSync } from 'node:fs'

function fromEnvFile(name, file) {
  try {
    const m = readFileSync(file, 'utf8').match(new RegExp('^' + name + '=(.*)$', 'm'))
    return m ? m[1].trim().replace(/^["']|["']$/g, '') : null
  } catch {
    return null
  }
}

const SUPABASE_URL = process.env.SUPABASE_URL ?? fromEnvFile('SUPABASE_URL', '.env.production.local')
const ANON = process.env.SUPABASE_ANON_KEY ?? fromEnvFile('SUPABASE_ANON_KEY', '.env.production.local')
// The origin the app should be sending for the project under test. Defaults to production.
const EXPECT_ORIGIN = process.env.EXPECT_ORIGIN ?? 'https://wordleteams.com'

if (!SUPABASE_URL || !ANON) {
  console.error('Missing SUPABASE_URL / SUPABASE_ANON_KEY (env, or .env.production.local)')
  process.exit(1)
}

const CALLBACK = `${EXPECT_ORIGIN}/api/auth/callback`

// mustSurvive: the app depends on this arriving intact.
// mustNotSurvive: if one of these IS allowlisted, that is a genuine open-redirect finding.
const CASES = [
  { label: 'canonical callback', url: CALLBACK, mustSurvive: true },
  { label: 'canonical callback + next param', url: `${CALLBACK}?next=/me`, mustSurvive: true },
  { label: 'scheme-less canonical host (the ev8 bug shape)', url: CALLBACK.replace(/^https?:\/\//, ''), mustSurvive: false },
  { label: 'scheme-less vercel deployment host', url: 'wordle-teams-abc123-someteam.vercel.app/api/auth/callback', mustSurvive: false },
  { label: 'unrelated origin (open-redirect control)', url: 'https://evil.example.com/steal', mustSurvive: false },
]

async function landingFor(redirectTo) {
  const url = `${SUPABASE_URL}/auth/v1/verify?token=bogus-probe-token&type=magiclink&redirect_to=${encodeURIComponent(redirectTo)}`
  const res = await fetch(url, { headers: { apikey: ANON }, redirect: 'manual' })
  // The bogus token always errors; only where it was sent matters, so drop the error fragment.
  return (res.headers.get('location') ?? '').split('#')[0]
}

console.log(`Supabase:       ${SUPABASE_URL}`)
console.log(`Expected origin: ${EXPECT_ORIGIN}\n`)

const results = []
for (const { label, url, mustSurvive } of CASES) {
  const landed = await landingFor(url)
  // Survived == Supabase honoured it rather than substituting the Site URL.
  const survived = landed.startsWith(url)
  const ok = survived === mustSurvive
  results.push(ok)
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${label}`)
  console.log(`        sent:   ${url}`)
  console.log(`        landed: ${landed || '(no Location header)'}`)
  if (!ok) {
    console.log(
      mustSurvive
        ? '        ^ NOT allowlisted. Emailed links using this will silently fall back to the Site URL and never sign anyone in.'
        : '        ^ UNEXPECTEDLY allowlisted. Investigate — an over-broad allowlist entry is an open-redirect risk.'
    )
  }
  console.log()
}

const failed = results.filter((r) => !r).length
console.log(`${results.length - failed} passed, ${failed} failed`)
process.exit(failed ? 1 : 0)
