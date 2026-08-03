#!/usr/bin/env node
// Distinguish "dev SMTP broken" vs "invite template broken" by exercising email sends that use
// DIFFERENT templates. If magic-link/recovery also fail -> SMTP/global. If only invite fails ->
// the edited invite template. Cleans up users it creates.
import { createClient } from '@supabase/supabase-js'
const { DEV_URL, DEV_ANON, DEV_KEY } = process.env
const admin = createClient(DEV_URL, DEV_KEY, { auth: { autoRefreshToken: false, persistSession: false } })
const anon = createClient(DEV_URL, DEV_ANON, { auth: { autoRefreshToken: false, persistSession: false } })
const email = 'wt-email-probe@example.com'

async function findUser() {
  const { data } = await admin.auth.admin.listUsers({ perPage: 200 })
  return data.users.find((x) => (x.email || '').toLowerCase() === email)
}
async function cleanup() { const u = await findUser(); if (u) await admin.auth.admin.deleteUser(u.id) }

// 1. INVITE template (the one that was edited)
await cleanup()
{
  const { error } = await admin.auth.admin.inviteUserByEmail(email, { data: { invited: true } })
  console.log(`INVITE template  : ${error ? '❌ ' + error.status + ' ' + error.message : '✅ sent'}`)
}

// 2. SIGNUP/MAGICLINK template (untouched) — signInWithOtp with shouldCreateUser sends via a different template
await cleanup()
{
  const { error } = await anon.auth.signInWithOtp({ email, options: { shouldCreateUser: true } })
  console.log(`SIGNUP/OTP email : ${error ? '❌ ' + (error.status ?? '') + ' ' + error.message : '✅ sent'}`)
}

// 3. RECOVERY template (untouched) — needs an existing user
await cleanup()
{
  await admin.auth.admin.createUser({ email, email_confirm: true })
  const { error } = await anon.auth.resetPasswordForEmail(email)
  console.log(`RECOVERY email   : ${error ? '❌ ' + (error.status ?? '') + ' ' + error.message : '✅ sent'}`)
}

await cleanup()
console.log('cleaned up test users')
