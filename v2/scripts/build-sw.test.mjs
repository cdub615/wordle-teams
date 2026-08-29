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
import { assertSwBuild, EXPECTED_SW_DEST, INJECTION_POINT } from './build-sw.mjs'

/** The facts a sound build produces. Each test spoils exactly one of them. */
const soundBuild = () => ({
  swDest: EXPECTED_SW_DEST,
  written: true,
  contents: 'self.addEventListener("install",()=>{});const m=[{"url":"assets/a.js","revision":"1"}];',
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
      expect(problems).toHaveLength(1)
      expect(problems[0]).toContain(INJECTION_POINT)
      expect(problems[0]).toContain('never injected')
    })

    test('is NOT reported for a file that merely mentions precaching', () => {
      // The check is a literal substring match on the injection point, not a
      // guess at what an injected file looks like. A false positive here would
      // fail every build.
      expect(
        assertSwBuild({ ...soundBuild(), contents: 'precacheAndRoute([{"url":"a.js"}])' }),
      ).toEqual([])
    })

    test('is not reported when nothing was written, because there is nothing to read', () => {
      // `contents` is '' when the file is absent. Only the `written` problem
      // should fire — two messages for one cause is noise at the moment
      // somebody is trying to read a build log.
      const problems = assertSwBuild({ ...soundBuild(), written: false, contents: '' })
      expect(problems).toHaveLength(1)
      expect(problems[0]).toContain('does not exist')
    })
  })

  describe('3. the injected manifest has zero entries', () => {
    test('is reported for an empty manifest', () => {
      const problems = assertSwBuild({ ...soundBuild(), count: 0 })
      expect(problems).toHaveLength(1)
      expect(problems[0]).toContain('ZERO entries')
      // The message has to name offline.html, because a manifest that lost it
      // is the one case where everything still works until the network dies.
      expect(problems[0]).toContain('offline.html')
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
      // `filePaths` comes back from workbox via upath. Comparing resolved paths
      // rather than raw strings is what stops a green build being reported as a
      // stray write.
      const wobbly = path.join(path.dirname(EXPECTED_SW_DEST), '.', 'assets', '..', 'sw.js')
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
