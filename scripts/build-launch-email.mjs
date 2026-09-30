#!/usr/bin/env node
/**
 * Turn an annotated draft in emails/ into the HTML you paste into a Resend Broadcast.
 *
 * WHY THIS EXISTS RATHER THAN "JUST PASTE THE FILE". The drafts carry long HTML
 * comments -- issue ids, runbook references, why a sentence is worded the way it is.
 * That is deliberate and it is how the rest of this repo documents itself, but an
 * HTML comment is part of the message body: it is delivered to all 401 recipients,
 * it is visible to anyone who views source, and it is dead weight against Gmail's
 * clipping threshold. So the annotated file is the SOURCE and this prints the ARTEFACT.
 *
 * Clean HTML goes to stdout and every diagnostic to stderr, so stdout stays pasteable:
 *
 *   node scripts/build-launch-email.mjs a            # print segment A
 *   node scripts/build-launch-email.mjs a | wl-copy  # straight to the clipboard
 *   node scripts/build-launch-email.mjs --all        # write all three to ./build/emails
 *
 * IT DOES NOT TOUCH THE MERGE TAGS. {{{FIRST_NAME|there}}} and
 * {{{RESEND_UNSUBSCRIBE_URL}}} must reach Resend intact or the broadcast either
 * greets nobody by name or is rejected outright.
 */
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'

const SEGMENTS = {
  a: { file: 'emails/launch-a-active.html', subject: 'Wordle Teams has been rebuilt', filter: 'days_since_last_board <= 30' },
  b: { file: 'emails/launch-b-lapsed.html', subject: 'Your Wordle Teams scoreboard is still there', filter: 'days_since_last_board > 30' },
  c: { file: 'emails/launch-c-never-played.html', subject: 'It takes about ten seconds to get on the board', filter: 'days_since_last_board is empty' },
}

/** Gmail clips a message past this, hiding everything after it behind "View entire message". */
const GMAIL_CLIP_BYTES = 102 * 1024

const stripComments = (html) =>
  html
    // Conditional comments are INSTRUCTIONS TO OUTLOOK, not notes, so they stay.
    .replace(/<!--(?!\[if)(?![<]!\[endif)[\s\S]*?-->/g, '')
    // Collapse the blank lines the removals leave behind.
    .replace(/\n{3,}/g, '\n\n')
    .replace(/^[ \t]+$/gm, '')

function build(key) {
  const seg = SEGMENTS[key]
  const raw = readFileSync(seg.file, 'utf8')
  const clean = stripComments(raw)
  const bytes = Buffer.byteLength(clean, 'utf8')

  for (const tag of ['{{{FIRST_NAME|there}}}', '{{{RESEND_UNSUBSCRIBE_URL}}}']) {
    if (!clean.includes(tag)) throw new Error(`${seg.file}: merge tag ${tag} did not survive the strip`)
  }
  if (!clean.includes('have been updated to cover it')) {
    throw new Error(`${seg.file}: the terms-change notice did not survive the strip`)
  }
  if (clean.includes('POSTAL ADDRESS')) {
    process.stderr.write(`  ! ${seg.file}: postal-address placeholder is still in the footer\n`)
  }

  const saved = Buffer.byteLength(raw, 'utf8') - bytes
  process.stderr.write(
    `  ${key.toUpperCase()}  ${bytes.toLocaleString()} bytes (${saved.toLocaleString()} stripped)` +
      `  ${bytes > GMAIL_CLIP_BYTES ? '!! OVER GMAIL CLIP THRESHOLD' : 'well under Gmail clipping'}\n` +
      `      subject: ${seg.subject}\n      filter:  ${seg.filter}\n`,
  )
  return clean
}

const arg = (process.argv[2] ?? '').toLowerCase()

if (arg === '--all') {
  const out = join('build', 'emails')
  mkdirSync(out, { recursive: true })
  process.stderr.write('Building all three:\n')
  for (const key of Object.keys(SEGMENTS)) {
    const dest = join(out, `launch-${key}.html`)
    writeFileSync(dest, build(key), 'utf8')
    process.stderr.write(`      -> ${dest}\n`)
  }
  process.stderr.write('\nPaste each into its Resend broadcast. build/ is gitignored.\n')
} else if (arg in SEGMENTS) {
  process.stdout.write(build(arg))
} else {
  process.stderr.write('usage: node scripts/build-launch-email.mjs <a|b|c|--all>\n')
  process.exit(1)
}
