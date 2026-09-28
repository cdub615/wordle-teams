/**
 * Measures the THREE SSR STAGES of an authenticated cold start, by differential
 * timing against a deployed environment. wordle-teams-xizw.
 *
 * WHAT c0f COULD NOT SEE. wordle-teams-c0f attributed the cold-start hold as
 * roughly 0.4s device and 1.5s network-and-server, but only stage 1 was ever
 * measured, because the other two run for an AUTHENTICATED request only:
 *
 *     stage 1   __root beforeLoad -> fetchAuth() -> getToken()
 *     stage 2   the route beforeLoad -> needsProfile, awaited ALONE by design
 *     stage 3   /app's loader -> four Convex queries in Promise.all
 *
 * NO INSTRUMENTATION, AND THAT IS THE POINT. xizw was filed expecting a
 * Server-Timing header, which is awkward here: the stages run inside the
 * TanStack SSR pipeline and the response is STREAMED, so a header cannot be
 * written after the fact. It turns out not to be needed, because three routes
 * already isolate the three stages between them:
 *
 *     /about    no beforeLoad of its own, no loader        -> stage 1
 *     /chat     beforeLoad with needsProfile, NO loader    -> stages 1 + 2
 *     /app      beforeLoad with needsProfile, + the loader -> stages 1 + 2 + 3
 *
 * So  /chat - /about  is stage 2 ALONE -- the serial needsProfile round trip,
 * which is the number xizw exists to decide about -- and  /app - /chat  is
 * stage 3 alone. /insights has the same shape as /chat and is measured too, as
 * a control: it and /chat should agree, and if they do not, the difference is
 * render weight rather than a stage and every number here is suspect.
 *
 * WHY TTFB AND NOT TOTAL TIME. All three stages are AWAITED before the document
 * can render, so they all complete before the first byte. The heavy component
 * render streams AFTER it. Timing to first byte therefore keeps the stages in
 * and leaves most of the render-weight confound out; the script reports the
 * body time separately so the confound can be seen rather than assumed.
 *
 * INTERLEAVED, NOT BATCHED. The routes are sampled round-robin rather than
 * twenty of one and then twenty of the next, because Cloudflare isolate warmth
 * and Convex load both drift over a minute and a batched run would attribute
 * that drift to whichever route it happened to land on.
 *
 * p25 AS WELL AS THE MEDIAN, and it is the more sensitive of the two here.
 * Worker TTFB has a long right tail from isolate cold starts -- measured on beta
 * 2026-09-09, anonymous /login, n=30: p50 146ms but p90 356ms and max 579ms.
 * Bootstrapping the real samples, a 20-per-side differential resolves to about
 * +/-16ms on the median and +/-13ms on p25, against stages expected in the
 * hundreds. Both are printed; if they disagree, believe neither and raise n.
 *
 * SERVICE WORKERS ARE BLOCKED. src/sw.ts registers a NavigationRoute over every
 * document request. Its strategy is NetworkOnly, so it would not have served a
 * cached document and corrupted a sample -- but blocking removes the dispatch
 * from the numbers entirely, which is one less thing to argue about. That the
 * strategy is NetworkOnly is WHY blocking is safe: there is no cache hit being
 * skipped.
 *
 * THE SESSION NEVER ENTERS THE REPOSITORY. --login opens a real browser, the
 * owner signs in by hand, and the cookies are written to a path this script
 * REFUSES to write unless `git check-ignore` says it is ignored. This repository
 * is public; that guard is not decoration.
 *
 * Usage — run with an ABSOLUTE path from anywhere; do NOT prefix with `cd v2 &&`,
 * which a zoxide-aliased `cd` can short-circuit so that nothing runs at all:
 *
 *   node <repo>/v2/scripts/measure-stages.mjs --login    # sign in once, by hand
 *   node <repo>/v2/scripts/measure-stages.mjs [--runs 20] [--origin https://...]
 */
import { execFileSync } from 'node:child_process'
import { existsSync, readdirSync } from 'node:fs'
import { chromium } from '@playwright/test'

const SESSION_FILE = new URL('../.beta-session.local', import.meta.url).pathname
/**
 * Printed in every hint, as an ABSOLUTE path, because `cd v2 && node ...` is not
 * safe to suggest: a zoxide-aliased `cd` that finds no new match exits non-zero
 * and the `&&` silently swallows the rest of the line. Nothing runs and nothing
 * says why. The script itself is cwd-independent — it resolves both this file
 * and node_modules from import.meta.url — so the absolute form always works.
 */
const SELF = new URL(import.meta.url).pathname
const ORIGIN = argValue('--origin') ?? 'https://beta.wordleteams.com'
const RUNS = Number(argValue('--runs') ?? 20)
const WARMUP = 3

/**
 * /about is stage 1; /chat and /insights add stage 2; /app adds stage 3.
 * `stages` is what each path is EXPECTED to exercise, and it is printed with the
 * results so a reader can check the claim rather than take it.
 */
const TARGETS = [
  { path: '/about', stages: '1' },
  { path: '/chat', stages: '1+2' },
  { path: '/insights', stages: '1+2 (control)' },
  { path: '/app', stages: '1+2+3' },
]

function argValue(flag) {
  const i = process.argv.indexOf(flag)
  return i === -1 ? undefined : process.argv[i + 1]
}

/** Refuses to hand a session cookie to a public repository. */
function assertIgnored(file) {
  try {
    execFileSync('git', ['check-ignore', '-q', file], { stdio: 'ignore' })
  } catch {
    throw new Error(
      `${file} is NOT gitignored, and this repository is PUBLIC. Refusing to write a session there.`,
    )
  }
}

/**
 * FINDS A DISPLAY FOR THE HEADED SIGN-IN, because the shell this is run from
 * usually has none. A terminal started from a TTY under Hyprland reports
 * XDG_SESSION_TYPE=tty and exports neither DISPLAY nor WAYLAND_DISPLAY, so a
 * headed Chromium dies with "Missing X server or $DISPLAY" even though a
 * perfectly good Xwayland is running on :0. Rather than make the caller know
 * that, look for the socket Xwayland actually left behind.
 *
 * X11 RATHER THAN THE WAYLAND SOCKET on purpose: Xwayland needs only DISPLAY,
 * where Wayland also needs --ozone-platform=wayland passed through to Chromium.
 * One environment variable is the smaller dependency.
 *
 * Silent no-op anywhere that already has a display, and on macOS, where
 * /tmp/.X11-unix does not exist and headed launch needs none of this.
 */
function ensureDisplay() {
  if (process.env.DISPLAY || process.env.WAYLAND_DISPLAY) return
  let sockets
  try {
    sockets = readdirSync('/tmp/.X11-unix')
      .filter((name) => /^X\d+$/.test(name))
      .sort()
  } catch {
    return // No X11 socket directory at all; let Playwright report it.
  }
  if (!sockets.length) return
  process.env.DISPLAY = `:${sockets[0].slice(1)}`
  console.log(`[measure-stages] No DISPLAY set; using ${process.env.DISPLAY} (found an X socket).`)
}

/**
 * Duplicated from lib/cache-policy.ts, which cannot be imported here: that is
 * TypeScript inside the app's bundle and this is a plain script run by node.
 * `__Secure-` is optional for the same reason it is optional there — Better Auth
 * adds the prefix over https and not over local http.
 */
const SESSION_COOKIE_NAMES = ['better-auth.session_token', 'better-auth.convex_jwt']
const isSessionCookie = (name) =>
  SESSION_COOKIE_NAMES.includes(name.replace(/^__Secure-/, ''))

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms))

/**
 * WAITS ON THE COOKIE, NOT ON THE PAGE URL, and the difference is why the first
 * attempt at this failed after ten minutes of a real person signing in.
 *
 * Watching `page.waitForURL` watches ONE TAB. Sign-in here can leave that tab
 * behind entirely — an OAuth provider may open its consent in a new window, and
 * an emailed link opens wherever the mail client sends it. The original page
 * then sits on /login forever while the context is perfectly well authenticated.
 * Cookies are a property of the CONTEXT, so polling them covers every tab, every
 * provider, and every landing page without enumerating any of them.
 *
 * It is also the thing actually being collected. A URL was only ever a proxy for
 * "is there a session yet", and a proxy that can be right when the answer is
 * wrong is worse than reading the answer.
 */
async function login() {
  assertIgnored(SESSION_FILE)
  ensureDisplay()
  const browser = await chromium.launch({ headless: false })
  // EVERY EXIT PATH CLOSES THE BROWSER, including the throwing ones. Without
  // this the first attempt's timeout left an orphaned Chromium holding node's
  // event loop open: the script had already given up and printed its error, but
  // the process never exited and the window sat there looking live. A person
  // signing in at that point is signing into a browser nothing is watching.
  try {
    await loginIn(browser)
  } finally {
    await browser.close().catch(() => {})
  }
}

async function loginIn(browser) {
  const context = await browser.newContext()

  // If the window is closed by hand, say so immediately rather than sitting out
  // the full timeout — which is exactly how the first attempt wasted 10 minutes.
  let closed = false
  browser.on('disconnected', () => {
    closed = true
  })

  const page = await context.newPage()
  await page.goto(`${ORIGIN}/login`)
  console.log(`\n[measure-stages] Sign in in the browser window that just opened.`)
  console.log(`[measure-stages] Any tab, any provider — this watches the session cookie,`)
  console.log(`[measure-stages] not the page. Waiting up to 30 minutes.\n`)

  const deadline = Date.now() + 30 * 60_000
  let waited = 0
  while (Date.now() < deadline) {
    if (closed) {
      throw new Error('The browser was closed before a session appeared. Nothing was saved.')
    }
    const cookies = await context.cookies().catch(() => [])
    if (cookies.some((c) => isSessionCookie(c.name))) {
      // The session token can land a beat before the Convex JWT. Let the rest
      // settle rather than saving half a session.
      await sleep(3000)
      await context.storageState({ path: SESSION_FILE })
      const saved = (await context.cookies()).filter((c) => isSessionCookie(c.name))
      console.log(
        `\n[measure-stages] Signed in — saved ${saved.length} session cookie(s) to`,
      )
      console.log(`[measure-stages] ${SESSION_FILE} (gitignored).`)
      await verifySession()
      return
    }
    await sleep(2000)
    waited += 2
    if (waited % 30 === 0) {
      process.stdout.write(`\r  still waiting… ${waited}s (sign in at your own pace)`)
    }
  }
  throw new Error('Timed out after 30 minutes with no session cookie. Nothing was saved.')
}

/**
 * Proves the saved session actually renders an authenticated route, HERE, rather
 * than letting it be discovered as a wall of near-zero differentials later. The
 * measure run has the same guard, but finding out at sign-in time is the
 * difference between re-running one command and re-running the whole thing.
 */
async function verifySession() {
  const browser = await chromium.launch()
  try {
    const context = await browser.newContext({
      storageState: SESSION_FILE,
      serviceWorkers: 'block',
    })
    const page = await context.newPage()
    await page.goto(`${ORIGIN}/app`, { waitUntil: 'domcontentloaded' })
    const landed = new URL(page.url()).pathname
    if (landed === '/app') {
      console.log(`[measure-stages] Verified: /app renders itself with this session.`)
      console.log(`[measure-stages] Now run:  node ${SELF} --runs ${RUNS}\n`)
    } else {
      console.log(`[measure-stages] !! /app landed on ${landed} — the session is not usable.`)
      console.log(`[measure-stages] !! Re-run --login and complete sign-in fully.\n`)
      process.exitCode = 1
    }
  } finally {
    await browser.close()
  }
}

/** One document request in a fresh page, timed from the Navigation Timing API. */
async function sample(context, path) {
  const page = await context.newPage()
  try {
    const response = await page.goto(`${ORIGIN}${path}`, { waitUntil: 'domcontentloaded' })
    const timing = await page.evaluate(() => {
      const nav = performance.getEntriesByType('navigation')[0]
      return { ttfb: nav.responseStart, bodyEnd: nav.responseEnd }
    })
    return {
      ...timing,
      status: response?.status() ?? 0,
      // A redirect means the route did not exercise the stages it is listed for
      // — an expired session sends every path to /login and would otherwise
      // produce a beautifully consistent set of meaningless numbers.
      landed: new URL(page.url()).pathname,
    }
  } finally {
    await page.close()
  }
}

const median = (v) => [...v].sort((a, b) => a - b)[Math.floor(v.length / 2)]
const p25 = (v) => [...v].sort((a, b) => a - b)[Math.max(0, Math.ceil(0.25 * v.length) - 1)]

async function measure() {
  if (!existsSync(SESSION_FILE)) {
    throw new Error(`No session at ${SESSION_FILE}.\n  Run:  node ${SELF} --login`)
  }
  const browser = await chromium.launch()
  const context = await browser.newContext({
    storageState: SESSION_FILE,
    // See the header comment: safe because the SW's NavigationRoute is
    // NetworkOnly, so nothing cached is being skipped.
    serviceWorkers: 'block',
    viewport: { width: 393, height: 852 },
    deviceScaleFactor: 3,
    isMobile: true,
    hasTouch: true,
  })

  const samples = new Map(TARGETS.map((t) => [t.path, []]))
  const landings = new Map(TARGETS.map((t) => [t.path, new Set()]))

  console.log(`\n[measure-stages] ${ORIGIN} — ${WARMUP} warm-up + ${RUNS} interleaved rounds\n`)
  // Same reason as the sign-in path: a throw part-way through must not leave a
  // Chromium holding the event loop open with no one watching it.
  try {
    for (let round = 0; round < WARMUP + RUNS; round++) {
      for (const target of TARGETS) {
        const s = await sample(context, target.path)
        landings.get(target.path).add(`${s.status} ${s.landed}`)
        if (round >= WARMUP) samples.get(target.path).push(s)
      }
      if (round === WARMUP - 1) console.log('  (warm-up discarded)')
      else if (round >= WARMUP) process.stdout.write(`\r  round ${round - WARMUP + 1}/${RUNS}`)
    }
  } finally {
    await browser.close().catch(() => {})
  }
  console.log('\n')

  // THE SESSION CHECK COMES FIRST. If /app served /login, everything below is a
  // measurement of the login page and the differentials are all zero-ish.
  let bad = false
  for (const target of TARGETS) {
    const seen = [...landings.get(target.path)]
    const wrong = seen.filter((s) => !s.startsWith('200') || !s.endsWith(target.path))
    if (wrong.length) {
      console.log(`  !! ${target.path} did not render itself: ${wrong.join(', ')}`)
      bad = true
    }
  }
  if (bad) {
    console.log('\n  The session is expired or incomplete. Re-run with --login.')
    console.log('  Every number below is meaningless until that line is gone.\n')
  }

  const at = (path, key, stat) => Math.round(stat(samples.get(path).map((s) => s[key])))
  console.log(`  ${'route'.padEnd(12)} ${'stages'.padEnd(15)} ${'TTFB p25'.padStart(9)} ${'TTFB p50'.padStart(9)} ${'body p50'.padStart(9)}`)
  for (const t of TARGETS) {
    console.log(
      `  ${t.path.padEnd(12)} ${t.stages.padEnd(15)} ` +
        `${String(at(t.path, 'ttfb', p25)).padStart(9)} ${String(at(t.path, 'ttfb', median)).padStart(9)} ` +
        `${String(at(t.path, 'bodyEnd', median)).padStart(9)}`,
    )
  }

  console.log('\n  DIFFERENTIALS (ms, TTFB) — what each stage actually costs:')
  const diff = (a, b, stat) => at(a, 'ttfb', stat) - at(b, 'ttfb', stat)
  const show = (label, a, b) =>
    console.log(`    ${label.padEnd(34)} p25 ${String(diff(a, b, p25)).padStart(6)}   p50 ${String(diff(a, b, median)).padStart(6)}`)
  show('stage 2  (needsProfile, serial)', '/chat', '/about')
  show('stage 3  (four queries, parallel)', '/app', '/chat')
  show('stages 2+3 together', '/app', '/about')
  show('control: /insights - /chat  (~0)', '/insights', '/chat')
  console.log('\n  A control far from zero means the differentials are measuring render')
  console.log('  weight rather than stages. p25 and p50 should broadly agree; if they')
  console.log('  do not, the tail is eating the run — raise --runs.\n')
}

const main = process.argv.includes('--login') ? login : measure
main().catch((error) => {
  console.error('[measure-stages] failed:', error instanceof Error ? error.message : error)
  process.exitCode = 1
})
