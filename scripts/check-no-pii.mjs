#!/usr/bin/env node
// Fails if third-party user data is about to be committed. This repo is public
// and .beads/issues.jsonl is tracked, so every issue body gets published.
//
// Usage:
//   node scripts/check-no-pii.mjs            # scan staged changes (pre-commit)
//   node scripts/check-no-pii.mjs --all      # scan the whole working tree
//
// Wire it up as a pre-commit hook:
//   echo 'node scripts/check-no-pii.mjs || exit 1' >> .git/hooks/pre-commit
//   chmod +x .git/hooks/pre-commit

import { execSync } from 'node:child_process'

// Addresses that are legitimately ours and may appear in the repo.
const ALLOWED_EMAILS = [
  /@wordleteams\.com$/i,
  /^christianbwhite@gmail\.com$/i, // repo owner; beads sets this as the issue `owner`
  /^christian\.white@pinnsg\.com$/i,
  /@redacted\.invalid$/i,
  /@test\.tst$/i,
  /@example\.(com|org|net)$/i,
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
