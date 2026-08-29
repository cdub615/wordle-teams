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
 * non-zero, with a message naming the specific problem, if any of these is
 * true:
 *   1. dist/client/sw.js was not written;
 *   2. the output still contains the literal `self.__WB_MANIFEST`;
 *   3. the injected manifest has zero entries;
 *   4. the output landed anywhere other than dist/client/sw.js.
 * `assertSwBuild` below is a pure function over already-gathered facts so each
 * of those four can be exercised on its own, without having to break a real
 * build to see the guard fire.
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
 * Every problem, not just the first, so one run tells you everything that is
 * wrong. Pure on purpose: it takes facts, not a filesystem.
 *
 * @param {{ swDest: string, written: boolean, contents: string, count: number,
 *           filePaths: string[] }} facts
 * @returns {string[]} human-readable problems; empty means the build is sound
 */
export function assertSwBuild({ swDest, written, contents, count, filePaths }) {
  const problems = []

  // 4. Wrong destination. Checked first because every other fact below is about
  //    a file at `swDest`, and if that is the wrong path they are all moot.
  if (path.resolve(swDest) !== EXPECTED_SW_DEST) {
    problems.push(
      `the service worker was written to ${path.resolve(swDest)}, but it must be ` +
        `${EXPECTED_SW_DEST}. A worker served from anywhere but the root controls only ` +
        `its own subtree, so it would install and then control nothing.`,
    )
  }

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
        `${CLIENT_DIR} actually contains — offline.html in particular, without which the ` +
        `offline fallback silently does not exist.`,
    )
  }

  return problems
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
  // shippable worker that precaches nothing.
  const stagingDir = await mkdtemp(path.join(tmpdir(), 'wt-sw-'))
  const staged = path.join(stagingDir, 'sw.js')

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
      // NOT OPTIONAL. 58 files across workbox-core/-precaching/-routing/
      // -strategies branch on `process.env.NODE_ENV`, and `process` does not
      // exist in a service worker. Without this define the worker throws
      // ReferenceError on its first line and never installs.
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
      console.error('[build-sw] SERVICE WORKER BUILD FAILED:')
      for (const problem of problems) console.error(`[build-sw]   - ${problem}`)
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
  main().catch((error) => {
    console.error('[build-sw] SERVICE WORKER BUILD FAILED:')
    console.error(error instanceof Error ? (error.stack ?? error.message) : String(error))
    process.exitCode = 1
  })
}
