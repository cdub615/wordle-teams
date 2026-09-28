import { readFileSync } from 'node:fs'
import { describe, expect, test } from 'vitest'

/**
 * THE FONTS MUST BE OURS, AND THE CRITICAL PATH MUST NOT LEAVE OUR ORIGIN.
 *
 * src/styles.css used to open with
 *   @import url("https://fonts.googleapis.com/css2?family=Inter...&family=Geist...")
 * and that one line cost more than anything else measured in wordle-teams-c0f.6:
 *
 *   - AN @import IS SERIAL. It cannot begin until the stylesheet containing it
 *     has been fetched AND parsed, so first paint waited on
 *     document -> styles.css -> fonts.googleapis.com.
 *   - THE THIRD HOP IS A NEW ORIGIN, needing its own DNS, TCP and TLS. 70-90ms
 *     on broadband; several hundred on cellular, paid on EVERY cold launch.
 *   - IT CANNOT BE CACHED BY THE SERVICE WORKER. src/sw.ts globs
 *     assets/**\/*.{js,css} plus offline.html, all same-origin, so a
 *     cross-origin stylesheet is unreachable to it by construction.
 *
 * These tests are the regression guard. Re-adding a Google Fonts URL anywhere in
 * the stylesheets fails them, which is the point: it is a one-line change that
 * looks harmless and costs the launch.
 */

const read = (path: string) => readFileSync(new URL(path, import.meta.url), 'utf8')

/**
 * CSS with its comments removed.
 *
 * The host check below looks for REFERENCES, not mentions. Both stylesheets
 * document why the Google import was removed, and naming the host is the whole
 * point of that comment — a guard that forbade writing the history down would
 * push the next person to delete the explanation rather than keep the fix.
 */
const withoutComments = (css: string) => css.replace(/\/\*[\s\S]*?\*\//g, '')

const THIRD_PARTY_FONT_HOSTS = ['fonts.googleapis.com', 'fonts.gstatic.com']

describe('font loading', () => {
  test('no stylesheet reaches a third-party font host', () => {
    for (const sheet of ['./styles.css', './fonts.css']) {
      const css = withoutComments(read(sheet))
      for (const host of THIRD_PARTY_FONT_HOSTS) {
        expect(css, `${sheet} still references ${host}`).not.toContain(host)
      }
    }
  })

  test('every @font-face src is origin-relative and points at a file we ship', () => {
    const css = read('./fonts.css')
    const urls = [...css.matchAll(/url\(([^)]+)\)/g)].map((m) => m[1].replace(/['"]/g, ''))

    expect(urls.length, 'fonts.css declares no font files at all').toBeGreaterThan(0)

    for (const url of urls) {
      expect(url, `${url} is not origin-relative`).toMatch(/^\/fonts\/[A-Za-z0-9_-]+\.woff2$/)
      // readFileSync throwing IS the assertion, as in about-screenshots.test.ts.
      expect(
        () => readFileSync(new URL(`../public${url}`, import.meta.url)),
        `${url} is declared but not in public/fonts/`,
      ).not.toThrow()
    }
  })

  /*
    THE SUBSET RANGES ARE WHY THE DECLARATIONS ARE COPIED FROM GOOGLE RATHER
    THAN HAND-WRITTEN. unicode-range is what lets a browser skip downloading
    Cyrillic when it is rendering English, and it is also what stops a player
    whose name is not latin from rendering as tofu. Dropping it would look
    harmless and be invisible until someone with an accented name joined a team.
  */
  test('keeps the unicode-range declarations that make subsetting work', () => {
    const css = read('./fonts.css')
    // The at-rule, not the word: fonts.css's generated header explains what
    // @font-face is, and a bare string count reads that prose as a 54th block.
    const faces = [...css.matchAll(/@font-face\s*\{/g)].length
    const ranges = [...css.matchAll(/unicode-range:/g)].length

    expect(faces).toBeGreaterThan(0)
    expect(ranges, 'every @font-face needs its unicode-range').toBe(faces)
  })
})
