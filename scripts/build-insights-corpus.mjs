#!/usr/bin/env node
/**
 * Reduces the FiveLetterWords research corpus to the two artifacts Layer 1 needs,
 * and writes them into public/insights/ as CHECKED-IN files.
 *
 *   node scripts/build-insights-corpus.mjs
 *
 * NOT PART OF `pnpm build`, AND THAT IS DELIBERATE. The plan's A2 said the build
 * should emit these, but scripts/fetch-wordlists.mjs already settled this question
 * for the word lists and the same answer applies: a build that reaches the network
 * can fail because someone else's site is down, and CI would then be unable to
 * deploy a fix for an unrelated outage. Run this by hand when refreshing the
 * corpus, review the diff, commit it. `pnpm build` copies public/ into
 * dist/client on its own.
 *
 * The loud-failure requirement is met by insights-corpus.test.ts, which asserts
 * both artifacts exist, parse, hold the counts and shapes below, and stay inside
 * their size budget. A missing or corrupt artifact fails the gates rather than
 * shipping quietly, which is what the requirement was for.
 *
 * TWO SOURCES, ON PURPOSE (wordle-teams-0cmj):
 *
 *   openers     the IMMUTABLE release. Measured across two releases seven weeks
 *               apart, not one of the 14,855 ranks moved -- they are simulated
 *               against a fixed answer pool. Pinning is free and makes the
 *               headline number reproducible.
 *   difficulty  the ROLLING /data/current/ feed, because the immutable release
 *               stops at its cutoff. Coverage of all history is 99.6% either way,
 *               but coverage of the CURRENT WEEK from a release is zero -- and the
 *               free user's default view is the most recent board they entered.
 *               The feed runs through yesterday and carries identical columns.
 *               Its snapshot_id is recorded in the artifact.
 *
 * THE DATED DATA IS REVISED, THE OPENERS ARE NOT. Across those same two releases
 * 702 of 1,852 difficulty percentiles changed, max swing 59 points, and 78 crossed
 * a label boundary. That is why the release/snapshot id travels INSIDE the
 * difficulty artifact: a percentile is only a fact relative to the snapshot that
 * produced it.
 *
 * NO RANK IS STORED ANYWHERE. Both sources are already in rank order and the
 * difficulty label is a pure function of the percentile, so rank is position and
 * label is arithmetic. Storing either would be storing a derivation -- and it is
 * not a small saving: openers as [{word, rank}] objects measured 424 KB against
 * 73 KB for the packed string.
 *
 * VALIDATES BEFORE WRITING, for the reason fetch-wordlists.mjs states: a source
 * that has moved or been reformatted must fail here, loudly, rather than silently
 * produce a shorter list that degrades the product where nobody is looking.
 */
import { writeFile, mkdir } from 'node:fs/promises'

const SITE = 'https://www.fiveletterwords.io'
const RELEASE = 'v2026-09-01'
const ATTRIBUTION = 'FiveLetterWords.io, research release v2026-09-01'
const LICENCE = 'CC BY 4.0'
const LICENCE_URL = 'https://creativecommons.org/licenses/by/4.0/'
const CITATION =
  'FiveLetterWords.io (2026-09-01). FiveLetterWords research release v2026-09-01 ' +
  `[Data set]. ${SITE}/data/releases/${RELEASE}/`

// Confirmed against the real files by wordle-teams-0cmj. Asserted rather than
// trusted: these are the numbers Layer 1 shows a user ("ranks 4,102nd of
// 14,855"), and a figure nobody checks is a figure that goes wrong quietly.
const EXPECTED_OPENERS = 14855
// The dated set only grows, so this is a floor rather than an equality.
const MIN_DIFFICULTY_ROWS = 1900

async function fetchCsv(url) {
  const res = await fetch(url)
  if (!res.ok) throw new Error(`${url}: HTTP ${res.status}`)
  const text = await res.text()
  if (text.includes('"')) {
    throw new Error(`${url}: contains quoted fields — the naive split is no longer safe`)
  }
  const [header, ...rows] = text.trim().split('\n')
  const columns = header.split(',')
  return rows.map((row, i) => {
    const cells = row.split(',')
    if (cells.length !== columns.length) {
      throw new Error(`${url}: row ${i + 2} has ${cells.length} cells, expected ${columns.length}`)
    }
    return Object.fromEntries(columns.map((c, j) => [c, cells[j]]))
  })
}

async function fetchJson(url) {
  const res = await fetch(url)
  if (!res.ok) throw new Error(`${url}: HTTP ${res.status}`)
  return res.json()
}

function buildOpeners(rows) {
  if (rows.length !== EXPECTED_OPENERS) {
    throw new Error(`openers: ${rows.length} rows, expected ${EXPECTED_OPENERS} — source changed?`)
  }
  const words = rows.map((r) => r.word)

  const bad = words.filter((w) => !/^[a-z]{5}$/.test(w))
  if (bad.length > 0) throw new Error(`openers: ${bad.length} malformed, e.g. ${bad[0]}`)
  if (new Set(words).size !== words.length) throw new Error('openers: duplicate words')

  // The artifact stores position instead of rank, so the file being in rank order
  // is not a convenience -- it is the whole encoding. If this ever stops holding,
  // every rank the UI prints is silently wrong.
  const misordered = rows.findIndex((r, i) => Number(r.rank) !== i + 1)
  if (misordered >= 0) {
    throw new Error(
      `openers: row ${misordered + 1} has rank ${rows[misordered].rank}, not in rank order — ` +
        'the artifact encodes rank as position and cannot be built from this',
    )
  }

  return { release: RELEASE, attribution: ATTRIBUTION, licence: LICENCE, licenceUrl: LICENCE_URL, citation: CITATION, count: words.length, words: words.join('') }
}

const dayIndex = (day) => Date.UTC(...day.split('-').map(Number).map((n, i) => (i === 1 ? n - 1 : n))) / 86400000

function buildDifficulty(rows, snapshotId) {
  if (rows.length < MIN_DIFFICULTY_ROWS) {
    throw new Error(`difficulty: ${rows.length} rows, expected at least ${MIN_DIFFICULTY_ROWS}`)
  }
  const firstDay = rows[0].date

  // CONTIGUITY IS THE ENCODING, exactly as rank order is for openers: the artifact
  // is a flat array indexed by days-since-firstDay. A single missing day would
  // shift every day after it by one and mis-attribute every later percentile,
  // which is the silent failure wordle-teams-0cmj was told to watch for. Verified
  // contiguous over 1,900 days when written; asserted so a future release cannot
  // quietly break it.
  const base = dayIndex(firstDay)
  const percentiles = rows.map((row, i) => {
    if (dayIndex(row.date) !== base + i) {
      throw new Error(
        `difficulty: expected day ${i} after ${firstDay}, got ${row.date} — the dated set has a ` +
          'gap or is out of order, and the artifact indexes by date offset',
      )
    }
    const percentile = Number(row.solver_pressure_percentile)
    if (!Number.isInteger(percentile) || percentile < 0 || percentile > 100) {
      throw new Error(`difficulty: ${row.date} has percentile ${row.solver_pressure_percentile}`)
    }
    return percentile
  })

  return { release: 'current', snapshotId, attribution: ATTRIBUTION, licence: LICENCE, licenceUrl: LICENCE_URL, citation: CITATION, firstDay, count: percentiles.length, percentiles }
}

const dir = new URL('../public/insights/', import.meta.url)
await mkdir(dir, { recursive: true })

const openers = buildOpeners(await fetchCsv(`${SITE}/data/releases/${RELEASE}/opener-rankings.csv`))
const manifest = await fetchJson(`${SITE}/data/current/manifest.json`)
const difficulty = buildDifficulty(
  await fetchCsv(`${SITE}/data/current/puzzle-difficulty.csv`),
  manifest.snapshot_id,
)

const write = async (name, value) => {
  const json = JSON.stringify(value)
  await writeFile(new URL(name, dir), json)
  return `${name} ${(json.length / 1024).toFixed(1)} KB`
}

console.log(`[insights] ${await write('benchmark-openers.json', openers)} — ${openers.count} openers, ${RELEASE}`)
console.log(
  `[insights] ${await write('benchmark-difficulty.json', difficulty)} — ${difficulty.count} days ` +
    `from ${difficulty.firstDay} through ${manifest.answer_history_data_through}, ${difficulty.snapshotId}`,
)
