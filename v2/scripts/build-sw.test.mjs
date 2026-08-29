// @vitest-environment node
//
// node, not the suite's default edge-runtime (vitest.config.ts): importing
// build-sw.mjs pulls in esbuild and workbox-build, which reach for node:fs and
// a native binary at module scope. Same per-file override, same reason, as
// src/lib/use-local-capture.hook.test.ts uses for jsdom.
//
// WHAT THIS FILE PINS. Spike S3's whole lesson is that the previous service
// worker build failed SILENTLY — exit 0, no sw.js, no warning, no banner — so
// the replacement's only real requirement is that it cannot do that. Each of
// the four conditions in build-sw.mjs's header is asserted here in isolation,
// plus a control that a sound build reports nothing. Deleting any guard, or
// inverting any comparison, must fail here.
//
// `assertSwBuild` was extracted as a pure function over already-gathered facts
// precisely so these can be exercised without breaking a real build; this file
// is what makes that claim in the script's header true.
import path from 'node:path'
import { describe, expect, test } from 'vitest'
import {
  assertSwBuild,
  EXPECTED_SW_DEST,
  INJECTION_POINT,
  REQUIRED_PRECACHE_URL,
} from './build-sw.mjs'

/** The facts a sound build produces. Each test spoils exactly one of them. */
const soundBuild = () => ({
  swDest: EXPECTED_SW_DEST,
  written: true,
  // A realistic injected manifest: hashed assets plus offline.html, which the
  // offline fallback depends on and guard 3b requires by name.
  contents:
    'self.addEventListener("install",()=>{});const m=[' +
    '{"revision":null,"url":"assets/a-1234abcd.js"},' +
    `{"revision":"c45b981f","url":"${REQUIRED_PRECACHE_URL}"}];`,
  count: 25,
  filePaths: [EXPECTED_SW_DEST],
})

/** Every problem message joined, for substring assertions. */
const report = (facts) => assertSwBuild(facts).join('\n')

describe('EXPECTED_SW_DEST', () => {
  test('is dist/client/sw.js — the ROOT of the served asset directory', () => {
    // Not a preference. dist/client is the Worker's asset directory
    // (dist/server/wrangler.json, assets.directory: "../client"), so this path
    // serves at /sw.js and gets scope `/`. Under assets/ it would get scope
    // /assets/ and control nothing anyone visits.
    expect(path.basename(EXPECTED_SW_DEST)).toBe('sw.js')
    expect(path.basename(path.dirname(EXPECTED_SW_DEST))).toBe('client')
    expect(path.basename(path.dirname(path.dirname(EXPECTED_SW_DEST)))).toBe('dist')
  })
})

describe('assertSwBuild', () => {
  test('CONTROL: a sound build reports no problems', () => {
    // Without this, every test below would pass against a function that
    // returned a problem unconditionally.
    expect(assertSwBuild(soundBuild())).toEqual([])
  })

  describe('1. dist/client/sw.js was not written', () => {
    test('is reported, and named as S3’s failure mode', () => {
      const problems = assertSwBuild({ ...soundBuild(), written: false })
      expect(problems).toHaveLength(1)
      expect(problems[0]).toContain('does not exist after the build')
      expect(problems[0]).toContain(EXPECTED_SW_DEST)
    })
  })

  describe('2. the output still contains the literal self.__WB_MANIFEST', () => {
    test('is reported when the placeholder survived injection', () => {
      const problems = assertSwBuild({
        ...soundBuild(),
        contents: `precacheAndRoute(${INJECTION_POINT})`,
      })
      // TWO problems, and both are correct: a file that still holds the
      // placeholder has no manifest at all, so guard 3b legitimately fires too.
      // Asserted by content rather than by count, so this test stays about
      // guard 2.
      expect(problems.some((p) => p.includes(INJECTION_POINT) && p.includes('never injected'))).toBe(
        true,
      )
      expect(problems.some((p) => p.includes(REQUIRED_PRECACHE_URL))).toBe(true)
    })

    test('is NOT reported for a file that merely mentions precaching', () => {
      // The check is a literal substring match on the injection point, not a
      // guess at what an injected file looks like. A false positive here would
      // fail every build.
      expect(
        assertSwBuild({
          ...soundBuild(),
          contents: `precacheAndRoute([{"url":"a.js"},{"url":"${REQUIRED_PRECACHE_URL}"}])`,
        }),
      ).toEqual([])
    })

    test('is not reported when nothing was written, even if contents LOOK broken', () => {
      // PINS THE `written &&` SHORT-CIRCUIT. The previous version of this test
      // passed `contents: ''`, which never contains the injection point — so
      // deleting `written &&` still passed and the test asserted nothing. The
      // contents here DO contain the placeholder, so the only thing keeping
      // this to one problem is the short-circuit itself.
      const problems = assertSwBuild({
        ...soundBuild(),
        written: false,
        contents: `precacheAndRoute(${INJECTION_POINT})`,
      })
      expect(problems).toHaveLength(1)
      expect(problems[0]).toContain('does not exist')
    })
  })

  describe('3. the injected manifest has zero entries', () => {
    test('is reported for an empty manifest', () => {
      const problems = assertSwBuild({ ...soundBuild(), count: 0 })
      expect(problems).toHaveLength(1)
      expect(problems[0]).toContain('ZERO entries')
      // It no longer names offline.html: that read as though the file were
      // checked when only emptiness was. Guard 3b checks it for real now, and
      // the two messages are kept distinct on purpose.
      expect(problems[0]).not.toContain(REQUIRED_PRECACHE_URL)
    })

    test('a single entry is not zero', () => {
      // Guards against a `count <= 1` or truthiness slip.
      expect(assertSwBuild({ ...soundBuild(), count: 1 })).toEqual([])
    })
  })

  describe('4. the output landed anywhere other than dist/client/sw.js', () => {
    test('is reported when injectManifest wrote under assets/ instead', () => {
      // The realistic form of this failure: swDest edited to somewhere inside
      // the hashed asset directory, where the worker would install and then
      // control only /assets/.
      const wrong = path.join(path.dirname(EXPECTED_SW_DEST), 'assets', 'sw.js')
      const problems = assertSwBuild({ ...soundBuild(), written: false, filePaths: [wrong] })

      expect(report({ ...soundBuild(), written: false, filePaths: [wrong] })).toContain(wrong)
      // Both halves fire: a path we did not ask for, and nothing at the path we
      // did. Either alone would catch it; the pair is what makes the log read
      // unambiguously.
      expect(problems).toHaveLength(2)
      expect(report({ ...soundBuild(), written: false, filePaths: [wrong] })).toContain(
        'does not exist after the build',
      )
    })

    test('is reported for an EXTRA file alongside the right one', () => {
      // A sourcemap, most likely. Not fatal in itself, but it means the script
      // is emitting something its caller does not know about and has not
      // audited for secrets — dist/client ships to the public internet.
      const extra = `${EXPECTED_SW_DEST}.map`
      const problems = assertSwBuild({
        ...soundBuild(),
        filePaths: [EXPECTED_SW_DEST, extra],
      })
      expect(problems).toHaveLength(1)
      expect(problems[0]).toContain(extra)
    })

    test('accepts a non-normalised path for the same file', () => {
      // PINS `path.resolve` IN THE `stray` MAP. The previous version built the
      // fixture with path.join, which normalises eagerly — so the string was
      // already clean by the time it reached assertSwBuild and removing
      // path.resolve still passed.
      //
      // Concatenated instead, so the '..' segment genuinely survives into the
      // function. This is also closer to what workbox actually hands back:
      // injectManifest returns upath-resolved, forward-slash paths, which on
      // Windows do not match path.sep and are exactly where a raw string
      // comparison reports a stray write on a perfectly good build.
      const wobbly = `${path.dirname(EXPECTED_SW_DEST)}/assets/../sw.js`
      expect(wobbly).toContain('..')
      expect(wobbly).not.toBe(EXPECTED_SW_DEST)
      expect(assertSwBuild({ ...soundBuild(), filePaths: [wobbly] })).toEqual([])
    })

    test('the defensive swDest invariant fires if the two call sites diverge', () => {
      // This one cannot happen in main() — it passes the same constant — but it
      // is what catches an edit that repoints injectManifest without repointing
      // the assertion. See the comment on the check.
      const problems = assertSwBuild({ ...soundBuild(), swDest: '/tmp/somewhere/sw.js' })
      expect(problems).toHaveLength(1)
      expect(problems[0]).toContain('but it must be')
    })
  })

  describe('3b. offline.html is missing from the manifest', () => {
    test('is reported even though the manifest is otherwise healthy', () => {
      // The gap this guard closes: 24 entries instead of 25, count non-zero,
      // build green, and matchPrecache returns undefined the first time
      // somebody loses signal.
      const problems = assertSwBuild({
        ...soundBuild(),
        contents: 'const m=[{"revision":null,"url":"assets/a-1234abcd.js"}];',
        count: 24,
      })
      expect(problems).toHaveLength(1)
      expect(problems[0]).toContain(REQUIRED_PRECACHE_URL)
      expect(problems[0]).toContain('matchPrecache')
    })

    test('requires it as a QUOTED manifest url, not merely a mention', () => {
      // The name appears in src/sw.ts as a string constant and in comments, so
      // a bare `contents.includes('offline.html')` would pass on a manifest
      // that does not list it. The check looks for the quoted JSON value.
      const problems = assertSwBuild({
        ...soundBuild(),
        contents: 'const OFFLINE_URL="/offline.html";const m=[{"url":"assets/a.js"}];',
        count: 24,
      })
      expect(problems).toHaveLength(1)
      expect(problems[0]).toContain(REQUIRED_PRECACHE_URL)
    })

    test('is not reported when nothing was written', () => {
      // Same short-circuit as guard 2: one cause, one message.
      const problems = assertSwBuild({ ...soundBuild(), written: false, contents: '' })
      expect(problems).toHaveLength(1)
      expect(problems[0]).toContain('does not exist')
    })
  })

  test('reports EVERY problem at once, not just the first', () => {
    // One run has to tell you everything that is wrong. A guard that returns
    // early would hide the second cause behind the first.
    const problems = assertSwBuild({
      swDest: '/tmp/elsewhere/sw.js',
      written: false,
      contents: '',
      count: 0,
      filePaths: ['/tmp/elsewhere/sw.js'],
    })
    expect(problems).toHaveLength(4)
  })
})
