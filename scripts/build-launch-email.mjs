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
 *   node scripts/build-launch-email.mjs --all --no-address   # omit the footer address
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

/**
 * Reject an address mail could not actually be delivered to.
 *
 * 16 CFR 316.2 accepts three things and only three: a street address, a PO box
 * registered with USPS, or a private mailbox registered with a CMRA. "Austin TX
 * 78701" is none of them -- it discloses roughly where you live and still does not
 * satisfy the rule, which is the worst of both trades and an easy one to make when
 * you are trying to avoid publishing a home address.
 *
 * The heuristic is deliberately loose: a PO/PMB box token, or any component that
 * STARTS with a number (a street number, here and in most of the world). Set
 * LAUNCH_POSTAL_ADDRESS_UNCHECKED=1 for an address this cannot parse -- some are
 * genuinely unusual, and a build script is the wrong place to be the final word.
 */
function looksDeliverable(address) {
  if (/\b(p\.?\s?o\.?\s*box|post\s+office\s+box|pmb|private\s+mailbox)\b/i.test(address)) return true
  return address.split(',').some((part) => /^\s*\d/.test(part))
}

function postalAddress(omit) {
  // THE ONE OUTCOME THIS SCRIPT EXISTS TO PREVENT is a bracketed placeholder going
  // out to 401 people. Whether to CARRY an address is the operator's call -- the
  // reminders and OTP mail correctly carry none, being transactional -- so this is
  // a real choice rather than a thing to route around. It is just not a silent one.
  if (omit) {
    process.stderr.write(
      '  ! --no-address: the footer will carry NO postal address.\n' +
        '    CAN-SPAM requires one in COMMERCIAL email; the exemption the app\'s\n' +
        '    reminders and OTP rely on is for transactional mail and does not\n' +
        '    extend to a launch announcement. Proceeding as instructed.\n',
    )
    return null
  }
  const raw = process.env.LAUNCH_POSTAL_ADDRESS?.trim() ||
    (existsSync(ADDRESS_FILE) ? readFileSync(ADDRESS_FILE, 'utf8').trim() : '')
  if (raw) {
    if (!looksDeliverable(raw) && process.env.LAUNCH_POSTAL_ADDRESS_UNCHECKED !== '1') {
      throw new Error(
        `That does not look like a deliverable address:\n\n    ${raw}\n\n` +
          '  16 CFR 316.2 accepts a street address, a PO box registered with USPS,\n' +
          '  or a CMRA private mailbox. A city/state/zip with no street line is none\n' +
          '  of those -- it discloses your area WITHOUT satisfying the requirement.\n\n' +
          '  If this address really is deliverable and just formatted unusually:\n' +
          '    LAUNCH_POSTAL_ADDRESS_UNCHECKED=1 node scripts/build-launch-email.mjs --all',
      )
    }
    return escapeHtml(raw)
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
  // `address === null` means the operator chose to omit it. The line is REMOVED,
  // not left blank and not left as the placeholder -- see --no-address below.
  const stripped = stripComments(raw)
  const clean =
    address === null
      ? stripped.replace(new RegExp(`\\s*<p class="t-mute"[^>]*>\\s*${PLACEHOLDER.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\s*</p>`), '')
      : stripped.split(PLACEHOLDER).join(address)
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

// STRIP ONLY KNOWN FLAGS, never "anything starting with --". An earlier version did
// the latter and silently ate `--all` along with `--no-address`, so the one command
// the send plan leads with printed a usage error instead of building.
const FLAGS = new Set(['--no-address'])
const args = process.argv.slice(2).filter((a) => !FLAGS.has(a))
const omitAddress = process.argv.slice(2).includes('--no-address')
const arg = (args[0] ?? '').toLowerCase()
const unknown = args.slice(1).filter((a) => a.startsWith('--'))
if (unknown.length > 0) {
  process.stderr.write(`\nunknown option: ${unknown.join(' ')}\n\n`)
  process.exit(1)
}

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
  const address = postalAddress(omitAddress)
  process.stderr.write('Building all three:\n')
  for (const key of Object.keys(SEGMENTS)) {
    const dest = join(out, `launch-${key}.html`)
    writeFileSync(dest, build(key, address), 'utf8')
    process.stderr.write(`      -> ${dest}\n`)
  }
  process.stderr.write('\nPaste each into its Resend broadcast. build/ is gitignored.\n')
} else if (arg in SEGMENTS) {
  process.stdout.write(build(arg, postalAddress(omitAddress)))
} else {
  throw new Error('usage: node scripts/build-launch-email.mjs <a|b|c|--all>')
}
}
