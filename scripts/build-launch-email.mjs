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
 *
 * THE POSTAL ADDRESS IS SUBSTITUTED HERE AND NEVER COMMITTED. A commercial email
 * needs a valid physical mailing address, and THIS REPO IS PUBLIC -- pasting one
 * into the drafts would commit it permanently, which is the wrong outcome if it is
 * a home address. So the tracked files keep the placeholder forever and the real
 * value arrives at build time, from LAUNCH_POSTAL_ADDRESS or from the gitignored
 * .launch-postal-address. Building without one FAILS rather than warns: an email
 * that goes out with a bracketed placeholder in the footer cannot be recalled.
 */
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'

const SEGMENTS = {
  a: { file: 'emails/launch-a-active.html', subject: 'Wordle Teams has been rebuilt', filter: 'days_since_last_board <= 30' },
  b: { file: 'emails/launch-b-lapsed.html', subject: 'Your Wordle Teams scoreboard is still there', filter: 'days_since_last_board > 30' },
  c: { file: 'emails/launch-c-never-played.html', subject: 'It takes about ten seconds to get on the board', filter: 'days_since_last_board is empty' },
}

/** Gmail clips a message past this, hiding everything after it behind "View entire message". */
const GMAIL_CLIP_BYTES = 102 * 1024

const PLACEHOLDER = '[POSTAL ADDRESS &mdash; REQUIRED BEFORE SENDING, see send plan step 6]'
const ADDRESS_FILE = '.launch-postal-address'

/** Escape the four characters that would otherwise break out of the footer markup. */
const escapeHtml = (value) =>
  value.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;')

function postalAddress() {
  const fromEnv = process.env.LAUNCH_POSTAL_ADDRESS?.trim()
  if (fromEnv) return escapeHtml(fromEnv)
  if (existsSync(ADDRESS_FILE)) {
    const fromFile = readFileSync(ADDRESS_FILE, 'utf8').trim()
    if (fromFile) return escapeHtml(fromFile)
  }
  throw new Error(
    'No postal address.\n' +
      '  A commercial email needs a valid physical mailing address, and this build\n' +
      '  refuses to emit one with the placeholder still in the footer.\n\n' +
      `  echo "Your Co, PO Box 123, City ST 00000" > ${ADDRESS_FILE}\n` +
      '  # or:  LAUNCH_POSTAL_ADDRESS="..." node scripts/build-launch-email.mjs --all\n\n' +
      `  ${ADDRESS_FILE} is gitignored. Do not paste an address into emails/ —\n` +
      '  this repo is PUBLIC and the commit would be permanent.',
  )
}

const stripComments = (html) =>
  html
    // Conditional comments are INSTRUCTIONS TO OUTLOOK, not notes, so they stay.
    .replace(/<!--(?!\[if)(?![<]!\[endif)[\s\S]*?-->/g, '')
    // Collapse the blank lines the removals leave behind.
    .replace(/\n{3,}/g, '\n\n')
    .replace(/^[ \t]+$/gm, '')

function build(key, address) {
  const seg = SEGMENTS[key]
  const raw = readFileSync(seg.file, 'utf8')
  if (!raw.includes(PLACEHOLDER)) {
    throw new Error(`${seg.file}: the postal-address placeholder is missing — has the footer been edited?`)
  }
  const clean = stripComments(raw).split(PLACEHOLDER).join(address)
  const bytes = Buffer.byteLength(clean, 'utf8')

  for (const tag of ['{{{FIRST_NAME|there}}}', '{{{RESEND_UNSUBSCRIBE_URL}}}']) {
    if (!clean.includes(tag)) throw new Error(`${seg.file}: merge tag ${tag} did not survive the strip`)
  }
  if (!clean.includes('have been updated to cover it')) {
    throw new Error(`${seg.file}: the terms-change notice did not survive the strip`)
  }
  if (clean.includes('POSTAL ADDRESS')) {
    throw new Error(`${seg.file}: a postal-address placeholder survived substitution`)
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

// A MISSING ADDRESS IS AN OPERATOR ERROR, NOT A CRASH. The message it carries is
// the whole point of the failure, and a Node stack trace buries it.
try {
  main(arg)
} catch (error) {
  process.stderr.write(`\n${error instanceof Error ? error.message : String(error)}\n\n`)
  process.exit(1)
}

function main(arg) {
if (arg === '--all') {
  const out = join('build', 'emails')
  mkdirSync(out, { recursive: true })
  const address = postalAddress()
  process.stderr.write('Building all three:\n')
  for (const key of Object.keys(SEGMENTS)) {
    const dest = join(out, `launch-${key}.html`)
    writeFileSync(dest, build(key, address), 'utf8')
    process.stderr.write(`      -> ${dest}\n`)
  }
  process.stderr.write('\nPaste each into its Resend broadcast. build/ is gitignored.\n')
} else if (arg in SEGMENTS) {
  process.stdout.write(build(arg, postalAddress()))
} else {
  throw new Error('usage: node scripts/build-launch-email.mjs <a|b|c|--all>')
}
}
