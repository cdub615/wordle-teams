#!/usr/bin/env node
// Fails if third-party user data is about to be committed. This repo is public
// and .beads/issues.jsonl is tracked, so every issue body gets published.
//
// Usage:
//   node scripts/check-no-pii.mjs            # scan staged changes (pre-commit)
//   node scripts/check-no-pii.mjs --all      # scan the whole working tree
//
// WHERE IT IS WIRED, AND WHY NOT WHERE YOU WOULD EXPECT. It is called from
// .beads/hooks/pre-commit, NOT .git/hooks/pre-commit, because beads sets
// `core.hooksPath` to .beads/hooks — which OVERRIDES .git/hooks ENTIRELY.
//
// THE COPY IN .git/hooks STOPPED RUNNING THE MOMENT beads INSTALLED ITS HOOKS,
// and nothing announced it. Verified by probe on 2026-09-02: a commit carrying
// a third-party address succeeded with exit 0. (The probe address is not quoted
// here — this file is scanned like any other, and doing so failed the check,
// which is its own small proof that the guard works.) The project's CLAUDE.md said
// "--no-verify chains to the PII guard", which had quietly become false, and
// the note further down this file about Phase 4 being committed with
// --no-verify describes the same guard failing open a second way.
//
// So if this ever needs re-wiring, do NOT reach for .git/hooks. Check:
//   git config --get core.hooksPath
// and add the call to THAT directory's pre-commit, after beads' own END marker
// so `bd hooks install` does not overwrite it.

import { execSync } from 'node:child_process'

// Addresses that are legitimately ours and may appear in the repo.
const ALLOWED_EMAILS = [
  /@wordleteams\.com$/i,
  /^christianbwhite@gmail\.com$/i, // repo owner; beads sets this as the issue `owner`
  /^christian\.white@pinnsg\.com$/i,
  /@redacted\.invalid$/i,
  /@test\.tst$/i,
  /@example\.(com|org|net)$/i,
  // RFC 2606 reserves the `.test` TLD for exactly this, alongside the
  // example.com/org/net names already allowed above — it can never resolve and
  // can never belong to anybody. The v2 suites use it throughout
  // (ada@example.test, owner@example.test).
  //
  // ADDED AFTER THE FACT, and the reason matters: every commit in Phase 4 was
  // made with --no-verify, on the belief that this hook merely staged
  // .beads/issues.jsonl. It does not — it is this check. So the guard was
  // bypassed for a whole phase, and when finally run it failed on 40 addresses
  // that were all reserved test names. A safety check that cries wolf on
  // legitimate content is one people learn to skip.
  /@([a-z0-9-]+\.)*test$/i,
  /noreply@/i,
  /(^|\.)sentry\.io$/i, // Sentry DSNs look like <key>@o<org>.ingest.us.sentry.io
]

// Package scopes and similar false positives that look like addresses.
const NOT_AN_EMAIL = /^@|^[a-z-]+@\d|@(types|babel|next|sentry|supabase|radix-ui|vercel|opentelemetry|playwright|eslint|tailwindcss|hookform|novu|expo|repo|ai-sdk)\b/i

const EMAIL = /[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}/g

const all = process.argv.includes('--all')
const files = execSync(
  all ? 'git ls-files' : 'git diff --cached --name-only --diff-filter=ACM',
  { encoding: 'utf8' }
)
  .split('\n')
  .filter(Boolean)
  .filter((f) => /\.(jsonl|md|mjs|js|ts|tsx|sql|json|txt)$/.test(f))
  .filter((f) => !f.startsWith('node_modules/') && !f.includes('pnpm-lock'))

const findings = []
for (const file of files) {
  let content
  try {
    content = execSync(all ? `cat "${file}"` : `git show ":${file}"`, { encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 })
  } catch {
    continue
  }
  content.split('\n').forEach((line, i) => {
    for (const m of line.match(EMAIL) || []) {
      if (NOT_AN_EMAIL.test(m)) continue
      if (ALLOWED_EMAILS.some((rx) => rx.test(m))) continue
      findings.push(`${file}:${i + 1}  ${m}`)
    }
  })
}

if (findings.length) {
  console.error('Blocked: third-party email addresses found in content bound for a PUBLIC repo.\n')
  for (const f of [...new Set(findings)].slice(0, 40)) console.error(`  ${f}`)
  console.error('\nUse a pseudonym (invitee-N@redacted.invalid), a player id, or a team id instead.')
  console.error('If an address is legitimately ours, add it to ALLOWED_EMAILS in scripts/check-no-pii.mjs.')
  process.exit(1)
}
console.log(`check-no-pii: clean (${files.length} files scanned)`)
