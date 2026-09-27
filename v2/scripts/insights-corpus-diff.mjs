#!/usr/bin/env node
/**
 * Quantifies what a corpus refresh did to history, and decides whether it is
 * worth a pull request.
 *
 *   node scripts/insights-corpus-diff.mjs <baseline-dir> <current-dir> [--body <path>]
 *
 * WHY THIS EXISTS. Refreshing public/insights/benchmark-difficulty.json REVISES
 * ALREADY-PUBLISHED NUMBERS. The 2026-09-27 refresh (wordle-teams-qnde.1) moved
 * the corpus from 1,907 days through 2026-09-07 to 1,926 through 2026-09-26 and,
 * in doing so, changed 305 percentiles that were already shipped, with a largest
 * single swing of 41 points, and moved 37 past boards across a difficulty LABEL
 * boundary — a board that read "Tricky" yesterday reads "Hard" today, with no
 * code change and nothing in the suite noticing. (Those three figures were
 * measured by diffing the two committed revisions of the artifact; this script
 * reproduces them when pointed at them.) The build script's own header records
 * the same effect at a different scale: 702 of 1,852 percentiles and 78 label
 * crossings across two releases seven weeks apart.
 *
 * That revision is BY DESIGN and is why the snapshot id travels inside the
 * artifact. What it is not is reviewable from a diff: the artifact is a single
 * 6 KB line of JSON, so `git diff` renders any change to it as one rewritten
 * line. A weekly automated refresh that arrives as "1 file changed" is a
 * rubber stamp. This script is what makes the review real — it turns the diff
 * into "305 of 1,907 revised, max swing 41, 37 label crossings".
 *
 * IT DOES NOT ENFORCE A BOUND, deliberately. Failing a refresh whose revision is
 * too large is wordle-teams-xgkz, which is a test and not a workflow. This
 * script's whole job is to make the magnitude visible to a human.
 *
 * EXIT CODES, following scripts/check-polar-prices.mjs and the job that runs it:
 *
 *   0   nothing worth a pull request — identical, or metadata-only (see below)
 *   10  a PR-worthy difference; the caller should open/refresh the PR
 *   2   CANNOT TELL, and the caller must fail. An artifact that will not parse,
 *       or a `firstDay` that moved — which invalidates the whole comparison,
 *       because the artifact indexes percentiles by offset from firstDay, so a
 *       shifted start means position i in the two files is not the same day.
 *
 * 10 rather than 1 for the interesting case is not arbitrary: an uncaught throw
 * exits 1, and "the script crashed" must never be indistinguishable from "there
 * is a change, go open the PR". The caller treats anything that is not 0 or 10
 * as a hard failure.
 *
 * METADATA-ONLY IS NOT A PULL REQUEST. snapshotId embeds the feed's date, so it
 * moves on every refresh even when not one percentile does. A PR whose entire
 * content is a new provenance string for numbers that did not change asks a human
 * to read a diff that says nothing, weekly — and the surest way to make this
 * mechanism ignored is to make most of its output empty. The old snapshot id
 * remains a truthful record of where the committed numbers came from, so keeping
 * it costs nothing. Percentiles, count, firstDay and the openers artifact are
 * what count as a change.
 */
import { readFile, writeFile } from 'node:fs/promises'

const MS_PER_DAY = 86_400_000
const DIFFICULTY = 'benchmark-difficulty.json'
const OPENERS = 'benchmark-openers.json'
const LABEL_SOURCE = new URL('../src/lib/insights-benchmark.ts', import.meta.url)

const EXIT_NO_PR = 0
const EXIT_CANNOT_TELL = 2
const EXIT_PR = 10

class CannotTell extends Error {}

/**
 * Reads the difficulty thresholds OUT OF difficultyLabel rather than repeating
 * them here. A copy would be a second definition of the product's labels that
 * nothing keeps in step, and the number this script reports that most depends on
 * them — label crossings — would then drift silently the first time a boundary
 * moves. Extraction that finds anything other than three ascending thresholds
 * throws, so an edit to difficultyLabel fails this loudly instead.
 */
async function labelBoundaries() {
  let source
  try {
    source = await readFile(LABEL_SOURCE, 'utf8')
  } catch (error) {
    throw new CannotTell(`cannot read ${LABEL_SOURCE.pathname}: ${error.message}`)
  }
  const start = source.indexOf('export function difficultyLabel')
  if (start < 0) {
    throw new CannotTell(
      'difficultyLabel is no longer exported from src/lib/insights-benchmark.ts — ' +
        'label crossings cannot be counted against thresholds that cannot be found',
    )
  }
  const end = source.indexOf('\n}', start)
  const body = source.slice(start, end < 0 ? undefined : end)
  const bounds = [...body.matchAll(/percentile\s*<=\s*(\d+)/g)].map((m) => Number(m[1]))
  if (bounds.length !== 3 || bounds.some((b, i) => i > 0 && b <= bounds[i - 1])) {
    throw new CannotTell(
      `difficultyLabel yielded thresholds [${bounds}] — expected three ascending ones. ` +
        'Its shape changed; this script must be updated with it rather than ' +
        'reporting crossings against thresholds the product no longer uses',
    )
  }
  return bounds
}

/**
 * Ordinal 0..3, ascending in difficulty — the index of the bucket a percentile
 * falls in, where anything above the last threshold is the last bucket.
 */
const labeller = (bounds) => (percentile) => {
  const found = bounds.findIndex((b) => percentile <= b)
  return found < 0 ? bounds.length : found
}

const n = (value) => value.toLocaleString('en-US')

async function readArtifact(dir, name) {
  const path = `${dir}/${name}`
  let text
  try {
    text = await readFile(path, 'utf8')
  } catch (error) {
    throw new CannotTell(`cannot read ${path}: ${error.message}`)
  }
  try {
    return { text, value: JSON.parse(text) }
  } catch (error) {
    throw new CannotTell(`${path} is not valid JSON: ${error.message}`)
  }
}

const dayIndex = (day) => {
  const [year, month, date] = day.split('-').map(Number)
  return Date.UTC(year, month - 1, date) / MS_PER_DAY
}

const dayAt = (firstDay, offset) =>
  new Date((dayIndex(firstDay) + offset) * MS_PER_DAY).toISOString().slice(0, 10)

function compareDifficulty(baseline, current, bounds) {
  if (baseline.firstDay !== current.firstDay) {
    throw new CannotTell(
      `firstDay moved from ${baseline.firstDay} to ${current.firstDay}. The artifact ` +
        'indexes percentiles by offset from firstDay, so the two files no longer line ' +
        'up day-for-day and NOTHING below can be computed — not the revision count, not ' +
        'the swing, not the label crossings. Every stored offset in the committed ' +
        'artifact now means a different date. A human has to look at this one.',
    )
  }
  const label = labeller(bounds)
  const overlap = Math.min(baseline.percentiles.length, current.percentiles.length)
  const changes = []
  let crossings = 0
  for (let i = 0; i < overlap; i += 1) {
    const from = baseline.percentiles[i]
    const to = current.percentiles[i]
    if (from === to) continue
    const crossed = label(from) !== label(to)
    if (crossed) crossings += 1
    changes.push({ day: dayAt(current.firstDay, i), from, to, swing: Math.abs(to - from), crossed })
  }
  return {
    overlap,
    revised: changes.length,
    maxSwing: changes.reduce((max, c) => Math.max(max, c.swing), 0),
    crossings,
    changes,
    baselineCount: baseline.percentiles.length,
    currentCount: current.percentiles.length,
    daysAdded: current.percentiles.length - baseline.percentiles.length,
    firstDay: current.firstDay,
    lastDay: dayAt(current.firstDay, current.percentiles.length - 1),
    baselineLastDay: dayAt(baseline.firstDay, baseline.percentiles.length - 1),
    snapshotFrom: baseline.snapshotId,
    snapshotTo: current.snapshotId,
  }
}

function labelName(bounds, percentile) {
  const names = ['Easier for the solver', 'Middle of the pack', 'Tricky', 'Hard for the solver']
  return names[labeller(bounds)(percentile)] ?? `(unlabelled ${percentile})`
}

function body(diff, openersChanged, bounds) {
  const pct = diff.overlap === 0 ? 0 : ((diff.revised / diff.overlap) * 100).toFixed(1)
  const crossed = diff.changes.filter((c) => c.crossed)
  const biggest = [...diff.changes].sort((a, b) => b.swing - a.swing).slice(0, 5)
  const lines = []

  lines.push(
    'Weekly regeneration of the checked-in insights corpus by',
    '`.github/workflows/refresh-insights-corpus.yml`. Nothing in this repository changed;',
    "the FiveLetterWords rolling feed did. The numbers below are this PR's whole point —",
    'both artifacts are single-line JSON, so `git diff` shows any change to either as',
    'one rewritten line and tells a reviewer nothing.',
    '',
    '## Coverage',
    '',
    `| | committed | this refresh |`,
    `| --- | --- | --- |`,
    `| days | ${n(diff.baselineCount)} | ${n(diff.currentCount)} |`,
    `| through | ${diff.baselineLastDay} | ${diff.lastDay} |`,
    `| snapshot | \`${diff.snapshotFrom}\` | \`${diff.snapshotTo}\` |`,
    '',
    `First day is unchanged at ${diff.firstDay}, which is what makes the comparison below`,
    'legal at all: the artifact indexes percentiles by offset from `firstDay`.',
    '',
  )

  if (diff.daysAdded < 0) {
    lines.push(
      `> **THE FEED GOT SHORTER.** It lost ${-diff.daysAdded} day(s) relative to the`,
      '> committed artifact. The dated set is supposed to only grow. Do not merge this',
      '> without understanding why, and check upstream before assuming the new file is',
      '> the better one.',
      '',
    )
  }

  lines.push(
    '## What it did to already-published history',
    '',
    `- **${n(diff.revised)} of ${n(diff.overlap)}** percentiles that were already shipped changed (${pct}%)`,
    `- **largest single swing: ${diff.maxSwing}** percentile points`,
    `- **${diff.crossings}** past boards crossed a difficulty label boundary`,
    '',
    'A label crossing is user-visible with no code change: a board that read one label',
    'yesterday reads another today. Revision is by design — it is why the snapshot id',
    'travels inside the artifact, and a percentile is only a fact relative to the',
    'snapshot that produced it — but nothing in the test suite notices it, and nothing',
    'bounds it (wordle-teams-xgkz). Judging whether this much movement is ordinary is',
    'the review this PR is asking for.',
    '',
  )

  if (biggest.length > 0) {
    lines.push('### Largest swings', '', '| day | was | now | label |', '| --- | --- | --- | --- |')
    for (const c of biggest) {
      const move = c.crossed
        ? `${labelName(bounds, c.from)} → ${labelName(bounds, c.to)}`
        : 'unchanged'
      lines.push(`| ${c.day} | ${c.from} | ${c.to} | ${move} |`)
    }
    lines.push('')
  }

  if (crossed.length > 0) {
    const shown = crossed.slice(0, 40)
    lines.push(
      '<details>',
      `<summary>All ${crossed.length} label crossings</summary>`,
      '',
      '| day | was | now |',
      '| --- | --- | --- |',
    )
    for (const c of shown) {
      lines.push(
        `| ${c.day} | ${c.from} — ${labelName(bounds, c.from)} | ${c.to} — ${labelName(bounds, c.to)} |`,
      )
    }
    if (crossed.length > shown.length) {
      lines.push('', `…and ${crossed.length - shown.length} more.`)
    }
    lines.push('', '</details>', '')
  }

  if (openersChanged) {
    lines.push(
      '## benchmark-openers.json ALSO CHANGED, WHICH IT SHOULD NOT',
      '',
      'The openers artifact is built from a PINNED immutable research release, and the',
      "build script's header records that across two releases seven weeks apart not one",
      'of its 14,855 ranks moved. If this file is in the diff then either the pinned',
      'release was edited upstream — which would make it not immutable and undermine the',
      'reason it is pinned — or the `RELEASE` constant in',
      '`scripts/build-insights-corpus.mjs` was changed. Find out which before merging.',
      '',
      'Note that `src/lib/insights-corpus.test.ts` pins `openers.count` to exactly 14,855',
      'and spot-checks four ranks by position, so if the word set itself moved, the suite',
      'will fail on this PR once someone runs it — and the strings that quote 14,855 to',
      'users have to change with it.',
      '',
    )
  }

  lines.push(
    '## Before merging',
    '',
    '- These are revisions to numbers users have already seen. Sanity-check the swings',
    '  above against the upstream feed if any look implausible.',
    `- Confirm the day count moved by the ${diff.daysAdded >= 0 ? `+${diff.daysAdded}` : diff.daysAdded} above for a calendar reason and not a`,
    '  source change.',
    '- **No CI ran on this PR, and that is expected, not a fault.** GitHub creates no',
    '  workflow runs for events authored by `GITHUB_TOKEN`, so neither `ci.yaml` (every',
    '  pull request) nor `deploy-v2.yml`’s pull-request run (a PR into `main` touching',
    '  `v2/**`, which runs the gates and deploys nothing) will appear here. The artifact',
    '  assertions in `v2/src/lib/insights-corpus.test.ts` have therefore not been run',
    '  against these files — including the 12 KB size budget on the difficulty artifact.',
    '  Push an empty commit as yourself, or run the gates locally, if you want them.',
    '',
    '🤖 Opened by `.github/workflows/refresh-insights-corpus.yml`.',
  )

  return lines.join('\n')
}

const args = process.argv.slice(2)
const dirs = []
let bodyPath = null
for (let i = 0; i < args.length; i += 1) {
  if (args[i] === '--body') {
    bodyPath = args[i + 1]
    i += 1
  } else {
    dirs.push(args[i])
  }
}

// `--body` with nothing after it must be a usage error, not a silent skip: the
// caller opens a pull request off that file, and an empty body is the failure
// this whole script exists to prevent.
if (dirs.length !== 2 || (args.includes('--body') && !bodyPath)) {
  console.error(
    'usage: node scripts/insights-corpus-diff.mjs <baseline-dir> <current-dir> [--body <path>]',
  )
  process.exit(EXIT_CANNOT_TELL)
}

const [baselineDir, currentDir] = dirs

try {
  const bounds = await labelBoundaries()
  const baselineOpeners = await readArtifact(baselineDir, OPENERS)
  const currentOpeners = await readArtifact(currentDir, OPENERS)
  const baseline = await readArtifact(baselineDir, DIFFICULTY)
  const current = await readArtifact(currentDir, DIFFICULTY)

  const openersChanged = baselineOpeners.text !== currentOpeners.text
  const diff = compareDifficulty(baseline.value, current.value, bounds)

  console.log(
    `[insights-diff] ${diff.overlap} overlapping days: ${diff.revised} percentiles revised, ` +
      `max swing ${diff.maxSwing}, ${diff.crossings} label crossings; ` +
      `${diff.daysAdded >= 0 ? '+' : ''}${diff.daysAdded} days; ` +
      `snapshot ${diff.snapshotFrom} -> ${diff.snapshotTo}` +
      (openersChanged ? '; OPENERS ARTIFACT ALSO CHANGED' : ''),
  )

  const substantive = diff.revised > 0 || diff.daysAdded !== 0 || openersChanged
  if (!substantive) {
    const metadataOnly = baseline.text !== current.text
    console.log(
      metadataOnly
        ? '[insights-diff] METADATA ONLY — every percentile is identical and only the ' +
            'snapshot id moved. Not worth a pull request; the committed snapshot id is ' +
            'still a truthful record of where these numbers came from.'
        : '[insights-diff] IDENTICAL — the regenerated artifacts match what is committed.',
    )
    process.exit(EXIT_NO_PR)
  }

  if (bodyPath) {
    await writeFile(bodyPath, `${body(diff, openersChanged, bounds)}\n`)
    console.log(`[insights-diff] wrote PR body to ${bodyPath}`)
  }
  process.exit(EXIT_PR)
} catch (error) {
  if (error instanceof CannotTell) {
    console.error(`[insights-diff] CANNOT TELL: ${error.message}`)
  } else {
    console.error(`[insights-diff] CANNOT TELL: unexpected failure — ${error.stack ?? error}`)
  }
  process.exit(EXIT_CANNOT_TELL)
}
