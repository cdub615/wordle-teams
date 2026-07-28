#!/usr/bin/env node
// One-off DEV validation for the invite->join fix. Reproduces exactly what the app's auth callback
// does for an invite link (handleEmailSignin -> verifyOtp({token_hash, type:'invite'}) -> handleInvite
// -> rpc handle_invited_signup) against the DEV Supabase, and asserts the invitee joins the team.
// Writes only test rows to DEV and deletes them at the end. Isolates the fix from Vercel deployment
// protection (which blocks driving the deployed dev URL directly).
//
// Required env: DEV_URL, DEV_ANON, DEV_KEY (service role), APP_URL, TEST_EMAIL
import { createClient } from '@supabase/supabase-js'

const { DEV_URL, DEV_ANON, DEV_KEY, APP_URL, TEST_EMAIL } = process.env
for (const [k, v] of Object.entries({ DEV_URL, DEV_ANON, DEV_KEY, APP_URL, TEST_EMAIL }))
  if (!v) { console.error(`Missing env ${k}`); process.exit(1) }

const admin = createClient(DEV_URL, DEV_KEY, { auth: { autoRefreshToken: false, persistSession: false } })
// Anon client mirrors the app's server client (createClient uses the anon key + default PKCE flow).
const anon = createClient(DEV_URL, DEV_ANON, { auth: { autoRefreshToken: false, persistSession: false, flowType: 'pkce' } })
const step = (m) => console.log(`\n▶ ${m}`)

let testUserId, teamId
try {
  step('Cleanup any prior test data')
  const { data: list } = await admin.auth.admin.listUsers({ perPage: 200 })
  const prior = list.users.find((u) => (u.email || '').toLowerCase() === TEST_EMAIL.toLowerCase())
  if (prior) { await admin.auth.admin.deleteUser(prior.id); console.log(`  deleted prior user ${prior.id}`) }
  await admin.from('teams').delete().eq('name', '__invite_validation__')

  step('generateLink(type=invite) on DEV — mints the token_hash the new email template would embed')
  const { data: gl, error: glErr } = await admin.auth.admin.generateLink({
    type: 'invite', email: TEST_EMAIL,
    options: { data: { invited: true }, redirectTo: `${APP_URL}/api/auth/callback?next=/me` },
  })
  if (glErr) throw new Error('generateLink: ' + glErr.message)
  const tokenHash = gl.properties?.hashed_token
  testUserId = gl.user?.id
  console.log(`  user id: ${testUserId}`)
  console.log(`  token_hash: ${tokenHash?.slice(0, 12)}…`)
  console.log(`  action_link uses: ${(gl.properties?.action_link || '').includes('token=') ? 'token/verify redirect' : gl.properties?.action_link?.slice(0, 60)}`)
  if (!tokenHash || !testUserId) throw new Error('no token_hash/user from generateLink')

  step('Stage a team with TEST_EMAIL pending in invited[]')
  const { data: team, error: tErr } = await admin.from('teams')
    .insert({ name: '__invite_validation__', creator: testUserId, player_ids: [], invited: [TEST_EMAIL] })
    .select('id,player_ids,invited').single()
  if (tErr) throw new Error('team insert: ' + tErr.message)
  teamId = team.id
  console.log(`  team ${teamId}: player_ids=${JSON.stringify(team.player_ids)} invited=${JSON.stringify(team.invited)}`)

  step('CALLBACK STEP 1 — verifyOtp({token_hash, type:"invite"})  [exactly handleEmailSignin]')
  const { data: vo, error: voErr } = await anon.auth.verifyOtp({ type: 'invite', token_hash: tokenHash })
  if (voErr) throw new Error('verifyOtp FAILED: ' + voErr.message)
  console.log(`  session established: ${!!vo.session}  user: ${vo.user?.email}`)

  step('CALLBACK STEP 2 — rpc handle_invited_signup  [exactly handleInvite], via the now-authed client')
  const { error: rpcErr } = await anon.rpc('handle_invited_signup', { invited_email: vo.user.email, invited_id: vo.user.id })
  if (rpcErr) throw new Error('handle_invited_signup: ' + rpcErr.message)

  step('Verify DB state on DEV')
  const { data: t2 } = await admin.from('teams').select('player_ids,invited').eq('id', teamId).single()
  const { data: u2 } = await admin.auth.admin.getUserById(testUserId)
  const joined = (t2.player_ids || []).includes(testUserId)
  const cleared = !(t2.invited || []).includes(TEST_EMAIL)
  const flag = u2.user.user_metadata?.invited
  const signedIn = !!u2.user.last_sign_in_at
  const confirmed = !!u2.user.email_confirmed_at
  console.log(`  verifyOtp succeeded:               true`)
  console.log(`  team.player_ids includes invitee:  ${joined}`)
  console.log(`  team.invited cleared of email:     ${cleared}`)
  console.log(`  user_metadata.invited == false:    ${flag === false} (value=${JSON.stringify(flag)})`)
  console.log(`  user last_sign_in_at set:          ${signedIn}`)
  console.log(`  user email confirmed:              ${confirmed}`)

  const pass = joined && cleared && flag === false && signedIn && confirmed
  console.log(`\n${pass ? '✅ PASS' : '❌ FAIL'} — token_hash invite ${pass ? 'verifies and joins the invitee to the team' : 'did not fully complete'}`)
  process.exitCode = pass ? 0 : 2
} catch (e) {
  console.error('\n❌ ERROR:', e.message)
  process.exitCode = 1
} finally {
  step('Cleanup test data')
  try { if (teamId) await admin.from('teams').delete().eq('id', teamId) } catch {}
  try { if (testUserId) await admin.auth.admin.deleteUser(testUserId) } catch {}
  console.log('  removed test team + test user')
}
