#!/usr/bin/env node
// Regression check for the /login lockout (beads wordle-teams-jvt).
//
// Before the fix, an unguarded window.createLemonSqueezy() in the app bar threw
// whenever app.lemonsqueezy.com was blocked. Because the app bar sits in the
// /login LAYOUT, the throw escaped login/error.tsx and hit global-error.tsx —
// which itself rendered the app bar, so the fallback re-threw forever. Measured
// against production: 998 errors in 500ms and a main thread too busy to answer
// document.body.innerText().
//
// Ad blockers, Brave shields, Pi-hole/NextDNS and corporate/school DNS filters
// all routinely block that domain, so this was a hard sign-in lockout for them.
//
// Requires playwright (not a project dependency — install ad hoc):
//   npm i playwright --no-save
//
// Usage:
//   node scripts/repro-login-lockout.mjs                       # localhost:3000
//   TARGET=https://wordleteams.com/login node scripts/repro-login-lockout.mjs
//   CHROME=/usr/bin/chromium node scripts/repro-login-lockout.mjs
//
// Exits non-zero if the blocked case regresses.

import { chromium } from 'playwright'

const TARGET = process.env.TARGET || 'http://localhost:3000/login'
const executablePath = process.env.CHROME || undefined

async function check(blockLemon) {
  const browser = await chromium.launch({ executablePath })
  const page = await (await browser.newContext()).newPage() // fresh profile = cold cache
  let lemonErrors = 0
  page.on('pageerror', (e) => String(e.message).includes('createLemonSqueezy') && lemonErrors++)
  if (blockLemon) await page.route('**://*.lemonsqueezy.com/**', (r) => r.abort())

  await page.goto(TARGET, { waitUntil: 'commit', timeout: 45000 })
  await page.waitForTimeout(3500)

  let body
  try {
    body = (await page.locator('body').innerText({ timeout: 5000 })).replace(/\s+/g, ' ')
  } catch {
    body = null // main thread wedged — the original failure mode
  }
  await browser.close().catch(() => {})

  return {
    lemonErrors,
    responsive: body !== null,
    signIn: !!body?.includes('Please sign in to continue'),
    fallback: !!body?.includes('Ruh roh'),
  }
}

let failed = false
for (const blockLemon of [false, true]) {
  const r = await check(blockLemon)
  const ok = r.lemonErrors === 0 && r.responsive && r.signIn && !r.fallback
  if (!ok) failed = true
  console.log(
    `lemon.js ${blockLemon ? 'BLOCKED' : 'allowed'}: ${ok ? 'PASS' : 'FAIL'}  ` +
      `errors=${r.lemonErrors} responsive=${r.responsive} signIn=${r.signIn} fallback=${r.fallback}`
  )
}
if (failed) {
  console.error('\nREGRESSION: /login must render the sign-in UI with zero errors even when lemon.js is blocked.')
  process.exit(1)
}
console.log('\nOK — sign-in survives a blocked lemon.js.')
