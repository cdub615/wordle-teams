#!/usr/bin/env node
/**
 * Fetches the Wordle word lists ONCE and writes a checked-in artifact, so that
 * builds and CI never touch the network for them.
 *
 * SOURCES, both cfreshman's gists of the pre-acquisition source lists:
 *   answers (2315)             a03ef2cba789d8cf00c08f767e0fad7b
 *   additional guesses (10657) cdcdf777450c5b5301e439061d29694c
 * Union = 12972, the original accepted-guess set.
 *
 * THE LIST IS KNOWINGLY INCOMPLETE AND THAT IS RECORDED RATHER THAN HIDDEN.
 * These are the PRE-NYT lists. NYT has edited the accepted set since — the
 * FiveLetterWords benchmark corpus counts 14855 — so a word a player
 * legitimately guessed today can be missing here. repair.ts must therefore
 * treat "no candidate" as an ordinary outcome that falls back to manual entry,
 * never as a bug. Stage 5's correction log is what will surface the gaps.
 *
 * VALIDATES BEFORE WRITING. A gist that has moved or been reformatted must fail
 * loudly here rather than silently produce a shorter list, which would degrade
 * parse accuracy in a way nobody could see.
 */
import { writeFile, mkdir } from 'node:fs/promises'

const GISTS = {
  answers: 'a03ef2cba789d8cf00c08f767e0fad7b',
  additional: 'cdcdf777450c5b5301e439061d29694c',
}

async function fetchList(id) {
  const res = await fetch(`https://gist.githubusercontent.com/cfreshman/${id}/raw`)
  if (!res.ok) throw new Error(`${id}: HTTP ${res.status}`)
  const words = (await res.text())
    .split('\n')
    .map((w) => w.trim().toUpperCase())
    .filter((w) => w.length > 0)

  const bad = words.filter((w) => !/^[A-Z]{5}$/.test(w))
  if (bad.length > 0) throw new Error(`${id}: ${bad.length} malformed, e.g. ${bad[0]}`)
  if (words.length < 2000) throw new Error(`${id}: only ${words.length} words — source changed?`)
  return words
}

const answers = await fetchList(GISTS.answers)
const additional = await fetchList(GISTS.additional)
const accepted = [...new Set([...answers, ...additional])].sort()

if (accepted.length < 12000) {
  throw new Error(`union is only ${accepted.length} — expected ~12972`)
}

const dir = new URL('../src/lib/board-import/data/', import.meta.url)
await mkdir(dir, { recursive: true })
await writeFile(new URL('accepted-guesses.json', dir), JSON.stringify(accepted))
await writeFile(new URL('answers.json', dir), JSON.stringify([...answers].sort()))

console.log(`answers ${answers.length}, additional ${additional.length}, accepted ${accepted.length}`)
