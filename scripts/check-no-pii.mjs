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

import { execFileSync, execSync } from 'node:child_process'
import { readFileSync } from 'node:fs'

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
const unreadable = []
for (const file of files) {
  let content
  try {
    // NO SHELL, AND THAT IS THE WHOLE FIX (wordle-teams-czvl). This was
    // `execSync(`git show ":${file}"`)`, which runs through /bin/sh with the
    // filename inside DOUBLE quotes — so a `$` in the name is expanded by the
    // shell before git ever sees it. `join.$token.tsx`, this repo's first named
    // param route, became `join..tsx`; git said `fatal: path ... does not
    // exist`, the catch below swallowed it, and the file was NOT SCANNED.
    //
    // THE GUARD REPORTED `clean` AND EXITED 0. Measured, not inferred: a staged
    // `probe.$param.tsx` containing a third-party gmail address passed this
    // check outright. On a PUBLIC repo, with `.beads/issues.jsonl` tracked, that
    // is the guard failing open in exactly the direction it exists to prevent —
    // the third time this file has managed that (see the two notes above).
    //
    // execFileSync takes an ARGUMENT ARRAY and spawns git directly, so there is
    // no shell to interpolate anything and nothing to quote. Double quotes were
    // never sufficient here; single quotes would have broken on a `'` instead.
    // The rule is not "quote better", it is "do not build a command string".
    content = all
      ? readFileSync(file, 'utf8')
      : execFileSync('git', ['show', `:${file}`], {
          encoding: 'utf8',
          maxBuffer: 64 * 1024 * 1024,
        })
  } catch (error) {
    // LOUD, NOT `continue`. The old silent skip is the other half of the same
    // defect: it turned every read failure into a file that quietly went
    // unscanned. A staged blob must be readable from the index, so in
    // pre-commit mode this is a hard failure — a guard that cannot read a file
    // must not report `clean` for it.
    //
    // `--all` is a manual sweep of the working tree, where a tracked file may
    // legitimately be absent (deleted but not yet staged), so there it is
    // reported and counted rather than fatal.
    unreadable.push(`${file}  ${(error?.message ?? String(error)).split('\n')[0]}`)
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

if (unreadable.length) {
  const fatal = !all
  console.error(
    `${fatal ? 'Blocked' : 'Warning'}: ${unreadable.length} file(s) could not be read, so they were NOT scanned.\n`,
  )
  for (const f of unreadable.slice(0, 40)) console.error(`  ${f}`)
  if (fatal) {
    console.error('\nA staged file must be readable from the index. This guard does not skip files.')
    process.exit(1)
  }
  console.error('')
}

if (findings.length) {
  console.error('Blocked: third-party email addresses found in content bound for a PUBLIC repo.\n')
  for (const f of [...new Set(findings)].slice(0, 40)) console.error(`  ${f}`)
  console.error('\nUse a pseudonym (invitee-N@redacted.invalid), a player id, or a team id instead.')
  console.error('If an address is legitimately ours, add it to ALLOWED_EMAILS in scripts/check-no-pii.mjs.')
  process.exit(1)
}
// COUNTS WHAT WAS ACTUALLY READ, not what was listed. `files.length` was the
// old figure and it is the same mistake in miniature: it reported 703 files
// scanned on a run where one of them could not be opened. A guard's success line
// must not claim coverage it did not have.
const skipped = unreadable.length
console.log(
  `check-no-pii: clean (${files.length - skipped} files scanned` +
    (skipped ? `, ${skipped} UNREAD` : '') +
    ')',
)
