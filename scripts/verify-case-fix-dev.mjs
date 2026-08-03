#!/usr/bin/env node
// Prove the case-sensitivity bug + that lowercasing invited[] fixes it, against dev.
// 1) team with a MIXED-CASE invited entry + a real (lowercase) invited user -> handle_invited_signup does NOT join (bug)
// 2) lowercase the invited entry -> handle_invited_signup joins (fix). Self-cleaning.
import { createClient } from '@supabase/supabase-js'
const { DEV_URL, DEV_KEY } = process.env
const admin = createClient(DEV_URL, DEV_KEY, { auth: { autoRefreshToken: false, persistSession: false } })
const EMAIL = 'case.test@example.com'
const MIXED = 'Case.Test@example.com'
const step = (m) => console.log(`\n▶ ${m}`)
let uid, tid
try {
  // cleanup prior
  const { data: list } = await admin.auth.admin.listUsers({ perPage: 200 })
  const prior = list.users.find((u) => (u.email || '').toLowerCase() === EMAIL)
  if (prior) await admin.auth.admin.deleteUser(prior.id)
  await admin.from('teams').delete().eq('name', '__case_test__')

  step('Create invited user (lowercase auth email) + team with MIXED-CASE invited entry')
  const { data: gl } = await admin.auth.admin.generateLink({ type: 'invite', email: EMAIL, options: { data: { invited: true } } })
  uid = gl.user.id
  console.log(`  user ${uid} email=${gl.user.email}`)
  const { data: team } = await admin.from('teams').insert({ name: '__case_test__', creator: uid, player_ids: [], invited: [MIXED] }).select('id,invited').single()
  tid = team.id
  console.log(`  team ${tid} invited=${JSON.stringify(team.invited)}`)

  step('Run handle_invited_signup with CURRENT (case-sensitive) matching')
  await admin.rpc('handle_invited_signup', { invited_email: gl.user.email, invited_id: uid })
  let { data: t1 } = await admin.from('teams').select('player_ids,invited').eq('id', tid).single()
  const joined1 = t1.player_ids.includes(uid)
  console.log(`  joined=${joined1}  invited=${JSON.stringify(t1.invited)}  => ${joined1 ? 'unexpected' : '❌ BUG REPRODUCED (mixed case not matched)'}`)

  step('Normalize invited[] to lowercase, then run again')
  await admin.from('teams').update({ invited: t1.invited.map((e) => e.toLowerCase()) }).eq('id', tid)
  await admin.rpc('handle_invited_signup', { invited_email: gl.user.email, invited_id: uid })
  let { data: t2 } = await admin.from('teams').select('player_ids,invited').eq('id', tid).single()
  const joined2 = t2.player_ids.includes(uid)
  console.log(`  joined=${joined2}  invited=${JSON.stringify(t2.invited)}  => ${joined2 ? '✅ FIXED by lowercasing' : 'still failing'}`)

  console.log(`\n${!joined1 && joined2 ? '✅ PASS — case bug confirmed; lowercasing invited[] resolves it' : '❌ inconclusive'}`)
} catch (e) {
  console.error('ERROR:', e.message)
} finally {
  if (tid) await admin.from('teams').delete().eq('id', tid)
  if (uid) await admin.auth.admin.deleteUser(uid)
  console.log('cleaned up')
}
