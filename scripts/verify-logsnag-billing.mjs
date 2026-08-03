#!/usr/bin/env node
// Verification for the Polar -> LogSnag billing feed (wordle-teams-sv2).
//
// WHY THIS EXISTS
// src/lib/polar/notify.ts publishes four Polar billing events to LogSnag's 'billing' channel.
// Two of its three acceptance criteria were verifiable by inspection — the LS webhook is deleted,
// and a LogSnag failure provably cannot fail the webhook (notifyBilling swallows every error, and
// it is additionally wrapped by handlePolarEvent's outer try/catch). The third — that events
// actually REACH LogSnag — cannot be checked by reading code, and cannot wait for a real billing
// event, because there are no Polar subscribers yet.
//
// So this script exercises the half that does not need a subscriber: the LogSnag call itself,
// against the real service, with the real production token. It catches the failure modes that
// are actually plausible — a wrong or rotated token, a project name that does not match, a
// rejected payload shape — none of which would be noticed until the first real customer event,
// which is exactly the moment you least want to discover them.
//
// WHAT IT DOES NOT PROVE
// The Polar -> webhook -> notifyBilling wiring. That needs a real Polar event. The mapping table
// is asserted statically below, but nothing here confirms a Polar delivery invokes it.
//
// The published event is deliberately named as a wiring check rather than reusing one of the four
// real event names, so it can never be mistaken for a genuine subscription in the billing channel.
// Identified by a placeholder id, never a real player id or email — same reasoning as notify.ts.
//
// Required env: LOGSNAG_TOKEN (loaded from .env.production.local, or the environment)
import { readFileSync } from 'node:fs'
import { LogSnag } from 'logsnag'

// The four mappings notify.ts declares. Asserted against the source so this script and the app
// cannot silently drift apart.
const EXPECTED = {
  'subscription.active': 'Subscription Started',
  'subscription.canceled': 'Cancellation Scheduled',
  'subscription.revoked': 'Subscription Ended',
  'subscription.past_due': 'Payment Failed',
}

const results = []
const check = (msg, ok, detail = '') => results.push(`${ok ? 'PASS' : 'FAIL'}  ${msg}${detail ? ' — ' + detail : ''}`)

function loadToken() {
  if (process.env.LOGSNAG_TOKEN) return process.env.LOGSNAG_TOKEN
  for (const file of ['.env.production.local', '.env.local']) {
    try {
      const match = readFileSync(file, 'utf8').match(/^LOGSNAG_TOKEN=(.*)$/m)
      if (match) return match[1].trim().replace(/^["']|["']$/g, '')
    } catch {
      // try the next file
    }
  }
  return null
}

// 1. Static check: the source still declares exactly the four agreed mappings.
const source = readFileSync('src/lib/polar/notify.ts', 'utf8')
for (const [polarEvent, logsnagEvent] of Object.entries(EXPECTED)) {
  const declared = source.includes(`'${polarEvent}'`) && source.includes(`'${logsnagEvent}'`)
  check(`notify.ts maps ${polarEvent} -> "${logsnagEvent}"`, declared)
}
check("notify.ts publishes to the 'billing' channel", source.includes("channel: 'billing'"))
// Comments are stripped first: notify.ts's prose explains WHY email is not sent, so a naive
// search for "email" matches the very comment documenting its absence.
const code = source.replace(/^\s*\/\/.*$/gm, '')
check(
  'notify.ts identifies by player id, not email',
  code.includes('user_id: playerId') && !/email/i.test(code)
)

// 2. Live check: a real publish to the real billing channel with the production token.
const token = loadToken()
if (!token) {
  check('LOGSNAG_TOKEN available', false, 'not in env or .env.production.local / .env.local')
} else {
  const logsnag = new LogSnag({ token, project: 'wordle-teams' })
  try {
    await logsnag.track({
      channel: 'billing',
      event: 'LogSnag Wiring Check',
      user_id: 'verification-not-a-real-player',
      icon: '🔧',
      notify: true,
      tags: {
        env: process.env.ENVIRONMENT ?? 'verification',
        polar_event: 'none-synthetic',
      },
    })
    check("publish to the 'billing' channel accepted by LogSnag", true)
  } catch (error) {
    check("publish to the 'billing' channel accepted by LogSnag", false, String(error?.message ?? error))
  }
}

console.log('\n' + results.join('\n'))
const failed = results.filter((r) => r.startsWith('FAIL')).length
console.log(`\n${results.length - failed} passed, ${failed} failed`)
process.exit(failed ? 1 : 0)
