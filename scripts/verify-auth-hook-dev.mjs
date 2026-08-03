#!/usr/bin/env node
// DEV verification that the Polar migration did not break login (wordle-teams-8sg, j8c).
//
// Migration 20260731120000 rewrote custom_access_token_hook and then dropped the two columns it
// used to select. If that ordering were wrong, or the deployed hook still referenced them, the
// hook would throw on every token issuance and NOBODY could sign in. This project has already
// had one login-lockout incident (wordle-teams-jvt), so this is the check that matters most.
//
// Signs a real throwaway user in against DEV Supabase and inspects the JWT the hook produced.
// dev.wordleteams.com sits behind Vercel deployment protection, so driving the deployed URL is
// not an option — this goes at the database the way scripts/validate-invite-dev.mjs does.
//
// Creates one user and deletes it again, whatever happens.
//
// Required env: DEV_URL, DEV_ANON, DEV_KEY (service role)
import { createClient } from '@supabase/supabase-js'

const { DEV_URL, DEV_ANON, DEV_KEY } = process.env
for (const [k, v] of Object.entries({ DEV_URL, DEV_ANON, DEV_KEY })) {
  if (!v) {
    console.error(`Missing env ${k}`)
    process.exit(1)
  }
}

const admin = createClient(DEV_URL, DEV_KEY, { auth: { autoRefreshToken: false, persistSession: false } })
const anon = createClient(DEV_URL, DEV_ANON, { auth: { autoRefreshToken: false, persistSession: false } })

const results = []
const check = (m, ok, d = '') => results.push(ok ? `PASS  ${m}` : `FAIL  ${m}${d ? ' — ' + d : ''}`)
const step = (m) => console.log(`\n▶ ${m}`)

const EMAIL = `authhook-probe-${Date.now()}@example.com`
const PASSWORD = `Probe!${Math.floor(Date.now() / 1000)}aA`
let userId

try {
  step(`Create a throwaway confirmed user (${EMAIL})`)
  const { data: created, error: createErr } = await admin.auth.admin.createUser({
    email: EMAIL,
    password: PASSWORD,
    email_confirm: true,
    user_metadata: { firstName: 'Authhook', lastName: 'Probe' },
  })
  if (createErr) throw new Error(`createUser failed: ${createErr.message}`)
  userId = created.user.id
  console.log(`  created ${userId}`)

  step('Sign in — this is where custom_access_token_hook runs')
  const { data: signIn, error: signInErr } = await anon.auth.signInWithPassword({
    email: EMAIL,
    password: PASSWORD,
  })

  // A throwing hook surfaces here as a 500 from the token endpoint.
  check('sign-in succeeds (the hook did not throw)', !signInErr, signInErr?.message ?? '')
  if (signInErr) throw new Error(`sign-in failed: ${signInErr.message}`)

  const token = signIn.session?.access_token
  check('an access token was issued', !!token)

  step('Inspect the claims the hook wrote')
  const claims = JSON.parse(Buffer.from(token.split('.')[1], 'base64url').toString('utf8'))
  const shown = Object.fromEntries(Object.entries(claims).filter(([k]) => k.startsWith('user_')))
  console.log(`  user_* claims: ${JSON.stringify(shown)}`)

  check('user_member_status is present', 'user_member_status' in claims, JSON.stringify(shown))
  check('user_first_name survived', claims.user_first_name === 'Authhook', String(claims.user_first_name))
  check('user_last_name survived', claims.user_last_name === 'Probe', String(claims.user_last_name))

  // The point of the migration: these two are gone from the hook.
  check('user_customer_id is GONE', !('user_customer_id' in claims), JSON.stringify(shown))
  check('user_member_variant is GONE', !('user_member_variant' in claims), JSON.stringify(shown))

  step('Confirm the schema behind it')
  const { data: pc, error: pcErr } = await admin
    .from('player_customer')
    .select('*')
    .eq('player_id', userId)
    .maybeSingle()
  if (pcErr) throw new Error(`player_customer read failed: ${pcErr.message}`)
  check('handle_new_user still creates a player_customer row', !!pc, JSON.stringify(pc))
  if (pc) {
    const cols = Object.keys(pc).sort()
    console.log(`  player_customer columns: ${cols.join(', ')}`)
    check('customer_id column is gone', !cols.includes('customer_id'), cols.join(', '))
    check('membership_variant column is gone', !cols.includes('membership_variant'), cols.join(', '))
    check('membership_status defaults to new', pc.membership_status === 'new', String(pc.membership_status))
  }

  step('Confirm the webhook replay guard exists and webhook_id is text')
  const nonUuid = `msg_verify_${Date.now()}`
  const row = { event_name: 'verify.probe', body: {}, player_id: userId, webhook_id: nonUuid }
  const { error: firstErr } = await admin.from('webhook_events').insert(row)
  check('a non-UUID Standard Webhooks id inserts (column is text)', !firstErr, firstErr?.message ?? '')

  const { error: dupErr } = await admin.from('webhook_events').insert(row)
  check('a duplicate webhook_id is rejected by the unique index', !!dupErr, dupErr?.message ?? 'no error raised')
  check(
    'the rejection is a unique violation, not something else',
    dupErr?.code === '23505',
    `code=${dupErr?.code}`
  )
} catch (error) {
  results.push(`FAIL  script aborted — ${error.message}`)
  console.error(error)
} finally {
  if (userId) {
    step('Cleanup')
    await admin.from('webhook_events').delete().eq('player_id', userId)
    const { error } = await admin.auth.admin.deleteUser(userId)
    console.log(error ? `  cleanup warning: ${error.message}` : `  deleted ${userId}`)
  }
}

console.log('\n' + results.join('\n'))
const failures = results.filter((r) => r.startsWith('FAIL'))
console.log(failures.length ? `\nRESULT: ${failures.length} FAILURE(S)` : '\nRESULT: all passed')
process.exit(failures.length ? 1 : 0)
