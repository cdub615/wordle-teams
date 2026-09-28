/**
 * Builds the service worker, AFTER `vite build`, to dist/client/sw.js.
 *
 * WHY THIS SCRIPT EXISTS INSTEAD OF vite-plugin-pwa.
 * Spike S3 proved the plugin cannot work in this repo, and the reason is in the
 * plugin's own source rather than in configuration. Its `configResolved` hook
 * does `ctx.viteConfig = config` unconditionally, and its `closeBundle` hook
 * guards on `if (!ctx.viteConfig.build.ssr)`. `vite build` here is a
 * multi-environment Environment API build driven by @cloudflare/vite-plugin,
 * which resolves root -> client -> ssr, ssr LAST — so the last assignment pins
 * `build.ssr = true` forever and the guard never passes. Nothing is emitted: no
 * sw.js, no warning, no banner, exit code 0. 1.3.0 is the latest published
 * version and scoping with `applyToEnvironment` does not help. The plugin is
 * removed and must not come back.
 *
 * WHAT REPLACES IT: esbuild bundles src/sw.ts (workbox's runtime modules are
 * ESM and have to be bundled to run in a classic worker), then workbox-build's
 * `injectManifest` — which does no bundling of its own, only a string
 * replacement — swaps the `self.__WB_MANIFEST` placeholder for the hashed
 * precache manifest and writes dist/client/sw.js.
 *
 * ROOT SCOPE IS A CORRECTNESS REQUIREMENT. A service worker controls only the
 * paths at or below the path it is served from. dist/client is the Worker's
 * asset directory (dist/server/wrangler.json, `assets.directory: "../client"`),
 * so dist/client/sw.js is served at /sw.js and gets scope `/`. Anything under
 * assets/ would get scope /assets/ and control nothing a user visits.
 *
 * THE LOUD-FAILURE ASSERTIONS ARE THE POINT OF THIS FILE.
 * S3's lesson is that the previous approach failed SILENTLY. This one exits
 * non-zero, with a message naming the specific problem. Each condition is
 * listed with the check that actually enforces it — the mapping is not
 * one-to-one — and with whether it is a LIVE risk or defence in depth, because
 * treating them as equally likely misdirects whoever reads this next:
 *
 *   1. dist/client/sw.js was not written        -> the `written` check. LIVE:
 *      this is S3's exact failure mode, and the reason the whole file exists.
 *   2. the output still contains the literal
 *      `self.__WB_MANIFEST`                     -> the `contents` check.
 *      DEFENCE IN DEPTH. injectManifest asserts exactly one injection point and
 *      String.replace()s it, and a MISSING placeholder throws
 *      'injection-point-not-found', which main().catch already turns into a
 *      non-zero exit. This check only catches a future where injection becomes
 *      partial or conditional.
 *   3. the injected manifest has zero entries   -> the `count` check. LIVE: a
 *      globPatterns edit or a change to vite's output layout produces this
 *      silently.
 *   3b. offline.html is missing from the manifest -> the `offlineEntry` check.
 *      LIVE, and the reason (3) is not enough: dropping just this one file
 *      leaves count at 24 and the build green, while matchPrecache returns
 *      undefined and users get the five-line inline stub instead of the
 *      designed page — visible only when offline.
 *   4. the output landed anywhere other than
 *      dist/client/sw.js                        -> the `stray` check over
 *      injectManifest's OWN report of what it wrote, backed by the `written`
 *      check. LIVE if anyone edits swDest. Writing to the wrong path shows up
 *      as both: a file reported at a path we did not ask for, and nothing at
 *      the path we did.
 * The `swDest` comparison at the top of `assertSwBuild` is a separate,
 * defensive invariant rather than the enforcement of (4) — see its comment.
 *
 * `assertSwBuild` is a pure function over already-gathered facts so each of
 * those can be exercised on its own, without breaking a real build to see the
 * guard fire. scripts/build-sw.test.mjs does exactly that.
 *
 * A FAILED RUN LEAVES NO dist/client/sw.js BEHIND. See `removeArtifacts`.
 */
import { mkdtemp, readFile, rm } from 'node:fs/promises'
import { existsSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import esbuild from 'esbuild'
import { injectManifest } from 'workbox-build'

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const SW_SRC = path.join(ROOT, 'src', 'sw.ts')
const CLIENT_DIR = path.join(ROOT, 'dist', 'client')

/** The one path a service worker for this app may be written to. */
export const EXPECTED_SW_DEST = path.join(CLIENT_DIR, 'sw.js')

/** workbox-build's default `injectionPoint`, spelled out so the check below reads. */
export const INJECTION_POINT = 'self.__WB_MANIFEST'

/**
 * The one precached file whose ABSENCE is invisible until the network dies.
 *
 * src/sw.ts's navigation fallback calls `matchPrecache(OFFLINE_URL)`; if this
 * entry is not in the manifest that returns undefined and the user gets the
 * terse inline stub instead of public/offline.html. A `count === 0` check does
 * not catch it — losing one file of twenty-five still leaves twenty-four.
 */
export const REQUIRED_PRECACHE_URL = 'offline.html'

/**
 * Every problem, not just the first, so one run tells you everything that is
 * wrong. Pure on purpose: it takes facts, not a filesystem.
 *
 * @param {{ swDest: string, written: boolean, contents: string, count: number,
 *           filePaths: string[] }} facts
 * @returns {string[]} human-readable problems; empty means the build is sound
 */
export function assertSwBuild({ swDest, written, contents, count, filePaths }) {
  const problems = []

  // A DEFENSIVE INVARIANT, NOT THE ENFORCEMENT OF REQUIREMENT 4.
  // `main()` passes this same constant, so in the real script this can never
  // fire; it exists so that an edit which points the injectManifest call and
  // this call at different paths is caught rather than half-applied. What
  // actually enforces "the output must land at dist/client/sw.js" is the
  // `stray` check immediately below (injectManifest reporting a path we did not
  // ask for) together with the `written` check (nothing at the path we did).
  // Checked first because every other fact below is about a file at `swDest`,
  // and if that is the wrong path they are all moot.
  if (path.resolve(swDest) !== EXPECTED_SW_DEST) {
    problems.push(
      `the service worker was written to ${path.resolve(swDest)}, but it must be ` +
        `${EXPECTED_SW_DEST}. A worker served from anywhere but the root controls only ` +
        `its own subtree, so it would install and then control nothing.`,
    )
  }

  // 4. Wrong destination — the real check. injectManifest returns the absolute
  //    path of every file it wrote, so this compares its own account of what it
  //    did against the one path a worker for this app may occupy.
  const stray = filePaths.map((f) => path.resolve(f)).filter((f) => f !== EXPECTED_SW_DEST)
  if (stray.length > 0) {
    problems.push(
      `injectManifest also wrote ${stray.join(', ')}. Only ${EXPECTED_SW_DEST} was expected.`,
    )
  }

  // 1. Nothing emitted. This is S3's exact failure mode, and the whole reason
  //    this function exists.
  if (!written) {
    problems.push(
      `${EXPECTED_SW_DEST} does not exist after the build. Nothing was emitted — this is ` +
        `precisely the silent failure vite-plugin-pwa produced (exit 0, no file, no warning).`,
    )
  }

  // 2. The placeholder survived, so the worker would call precacheAndRoute on
  //    an undefined global and precache nothing.
  if (written && contents.includes(INJECTION_POINT)) {
    problems.push(
      `the output still contains the literal ${INJECTION_POINT}, so the precache manifest was ` +
        `never injected. The worker would install and precache nothing.`,
    )
  }

  // 3. Injected, but empty. Green, installable, and useless offline.
  if (count === 0) {
    problems.push(
      `the injected precache manifest has ZERO entries. Check the globPatterns against what ` +
        `${CLIENT_DIR} actually contains.`,
    )
  }

  // 3b. Injected, non-empty, and MISSING THE ONE FILE THAT MATTERS OFFLINE.
  //     The message on (3) used to name offline.html, which made this look
  //     checked when it was not: dropping just that file leaves count at 24 and
  //     the build green. The manifest is already in `contents`, so this is one
  //     substring away.
  if (written && !contents.includes(`"${REQUIRED_PRECACHE_URL}"`)) {
    problems.push(
      `the injected manifest does not contain ${REQUIRED_PRECACHE_URL}. src/sw.ts's offline ` +
        `fallback calls matchPrecache('/${REQUIRED_PRECACHE_URL}'), which will return undefined, ` +
        `so users offline get the terse inline stub instead of public/offline.html — a failure ` +
        `that is invisible until someone loses connectivity. Check that public/offline.html ` +
        `exists and that globPatterns still matches it.`,
    )
  }

  return problems
}

/**
 * Removes everything a run wrote, so a failed build cannot leave a shippable
 * worker behind. Called BEFORE the build too: a stale sw.js from a previous
 * successful run is just as dangerous as a broken one from this run, because
 * neither matches the bundle sitting next to it.
 *
 * `pnpm build` exits 1 and short-circuits `&& wrangler deploy`, but a
 * hand-run `wrangler deploy` after a failed build would otherwise ship
 * whatever was left here — an un-injected worker that precaches nothing, or
 * one whose manifest points at assets from a different build.
 */
async function removeArtifacts(extraPaths = []) {
  const targets = new Set([EXPECTED_SW_DEST, ...extraPaths.map((f) => path.resolve(f))])
  for (const target of targets) {
    await rm(target, { force: true })
  }
}

async function main() {
  if (!existsSync(CLIENT_DIR)) {
    throw new Error(
      `${CLIENT_DIR} does not exist. Run \`vite build\` before this script — the precache ` +
        `manifest is built by globbing the client build output.`,
    )
  }

  // esbuild writes OUTSIDE dist/, then injectManifest reads it and writes the
  // real destination. Two reasons: injectManifest refuses swSrc === swDest, and
  // an un-injected bundle must never exist at dist/client/sw.js even for an
  // instant — a build that died between the two steps would otherwise leave a
  // shippable worker that precaches nothing. `removeArtifacts` is the other
  // half of that promise: staging keeps the bad file from being written, and
  // removal handles every path where one gets written anyway.
  const stagingDir = await mkdtemp(path.join(tmpdir(), 'wt-sw-'))
  const staged = path.join(stagingDir, 'sw.js')

  // Nothing from a previous run survives into this one, whether it succeeds or
  // not. Without this, a run that dies before injectManifest — a syntax error
  // in sw.ts, say — would leave the LAST build's worker in place and report
  // failure, which is the worst of both.
  await removeArtifacts()

  try {
    await esbuild.build({
      entryPoints: [SW_SRC],
      outfile: staged,
      bundle: true,
      // A classic service worker, which is what navigator.serviceWorker
      // .register('/sw.js') requests without `{ type: 'module' }`. ESM output
      // would fail to install in every browser we care about.
      format: 'iife',
      platform: 'browser',
      target: 'es2020',
      minify: true,
      sourcemap: false,
      charset: 'utf8',
      // `process.env.NODE_ENV` MUST NOT SURVIVE INTO THE OUTPUT. 25 of the
      // .js files across workbox-core/-precaching/-routing/-strategies branch
      // on it, 72 times in total, and `process` does not exist in a service
      // worker — a single surviving reference is a ReferenceError on install.
      //
      // THE LINE THAT ACTUALLY GUARANTEES THAT IS `platform: 'browser'` ABOVE,
      // NOT THIS ONE. esbuild substitutes process.env.NODE_ENV automatically
      // for the browser platform. Measured by bundling this entry point four
      // ways and counting `process.env` in the output:
      //     platform=browser define=yes -> 0
      //     platform=browser define=no  -> 0
      //     platform=neutral define=yes -> 0
      //     platform=neutral define=no  -> 49
      // So changing `platform` to 'neutral' and deleting this define is the
      // combination that breaks, and an earlier version of this comment would
      // have reassured whoever did it that they were covered.
      //
      // The define stays because it is explicit and free, and because it keeps
      // the guarantee true independently of the platform setting.
      define: { 'process.env.NODE_ENV': '"production"' },
      logLevel: 'warning',
    })

    const { count, size, warnings, filePaths } = await injectManifest({
      swSrc: staged,
      swDest: EXPECTED_SW_DEST,
      globDirectory: CLIENT_DIR,
      // DELIBERATELY NARROW, AND THE NARROWNESS IS LOAD-BEARING.
      // workbox's default is `**/*.{js,wasm,css,html}` against the whole client
      // directory. That would precache any HTML document sitting at the root of
      // dist/client — and if TanStack Start is ever asked to prerender a page,
      // that is a rendered application document going into Cache Storage, which
      // is exactly the class of bug wordle-teams-bpt measured in v1 and which
      // the NetworkOnly navigation route in src/sw.ts exists to prevent.
      // assets/ is content-hashed immutable build output; offline.html is the
      // one document that is genuinely static and genuinely must be cached.
      globPatterns: ['assets/**/*.{js,css}', 'offline.html'],
      injectionPoint: INJECTION_POINT,
    })

    const written = existsSync(EXPECTED_SW_DEST)
    const contents = written ? await readFile(EXPECTED_SW_DEST, 'utf8') : ''

    const problems = assertSwBuild({
      swDest: EXPECTED_SW_DEST,
      written,
      contents,
      count,
      filePaths,
    })

    for (const warning of warnings) console.warn(`[build-sw] workbox warning: ${warning}`)

    if (problems.length > 0) {
      // The file this run wrote is not shippable, so it does not stay on disk.
      // `filePaths` is included so a write to the WRONG path is cleaned up too.
      await removeArtifacts(filePaths)
      console.error('[build-sw] SERVICE WORKER BUILD FAILED:')
      for (const problem of problems) console.error(`[build-sw]   - ${problem}`)
      console.error('[build-sw]   (dist/client/sw.js has been removed — nothing shippable remains)')
      process.exitCode = 1
      return
    }

    const kb = (size / 1024).toFixed(1)
    console.log(
      `[build-sw] wrote ${path.relative(ROOT, EXPECTED_SW_DEST)} — precaching ${count} ` +
        `file${count === 1 ? '' : 's'}, ${kb} kB. Scope: / (served at /sw.js).`,
    )
  } finally {
    await rm(stagingDir, { recursive: true, force: true })
  }
}

// Only when run as a program. Importing this module (the assertion tests do)
// must not build anything.
if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch(async (error) => {
    // Same rule on the throwing path. injectManifest writes swDest before it
    // can throw on a sourcemap, and esbuild can die mid-write, so "we threw"
    // is not evidence that nothing was left behind.
    await removeArtifacts().catch(() => {})
    console.error('[build-sw] SERVICE WORKER BUILD FAILED:')
    console.error(error instanceof Error ? (error.stack ?? error.message) : String(error))
    process.exitCode = 1
  })
}
