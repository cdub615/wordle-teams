/**
 * Measures the CLIENT half of a cold start against a deployed environment.
 *
 * WHY THIS EXISTS AS A SCRIPT rather than as a one-off. wordle-teams-c0f needs a
 * before and an after, and a number taken by a slightly different method is not
 * comparable with the one it is meant to be compared against. Same shape as
 * scripts/measure-insights-coverage.mjs: a measurement kept so it can be
 * repeated, not a test.
 *
 * WHAT IT CANNOT SEE, AND THIS IS THE IMPORTANT PART. Everything here is
 * relative to `navigationStart`, which fires only AFTER the OS has launched the
 * process and initialised the web view. The unbranded hold that c0f is about
 * happens largely BEFORE that clock starts, so this script structurally cannot
 * measure it. The outer number comes from an iOS screen recording marked up with
 * ffmpeg signalstats; see the baseline note on wordle-teams-c0f. Do not quote a
 * figure from here as "cold start".
 *
 * IT ALSO SEES NO AUTHENTICATED PAGE. /app requires a session, so the routes
 * this can reach exercise the root beforeLoad only — stage 1 of three. The two
 * Convex round trips are absent from every number it prints.
 *
 * Usage:  node scripts/measure-startup.mjs [url] [runs]
 */
import { chromium } from '@playwright/test'

const URL_ = process.argv[2] ?? 'https://beta.wordleteams.com/login'
const RUNS = Number(process.argv[3] ?? 5)

/** An iPhone-shaped viewport. Not a throttle — see the CPU note below. */
const IPHONE = {
  viewport: { width: 393, height: 852 },
  deviceScaleFactor: 3,
  isMobile: true,
  hasTouch: true,
}

async function once(cpuThrottle) {
  const browser = await chromium.launch()
  const context = await browser.newContext(IPHONE)
  const page = await context.newPage()
  const cdp = await context.newCDPSession(page)
  await cdp.send('Performance.enable')
  if (cpuThrottle > 1) await cdp.send('Emulation.setCPUThrottlingRate', { rate: cpuThrottle })

  await page.goto(URL_, { waitUntil: 'load' })

  const timing = await page.evaluate(() => {
    const nav = performance.getEntriesByType('navigation')[0]
    const fcp = performance.getEntriesByType('paint').find((p) => p.name === 'first-contentful-paint')
    const scripts = performance.getEntriesByType('resource').filter((r) => r.name.endsWith('.js'))
    const blocking = performance
      .getEntriesByType('resource')
      .filter((r) => r.renderBlockingStatus === 'blocking')
      .map((r) => ({ name: r.name.replace(/^https:\/\/[^/]+/, ''), ms: Math.round(r.responseEnd - r.startTime) }))
    return {
      ttfb: nav.responseStart,
      responseEnd: nav.responseEnd,
      fcp: fcp ? fcp.startTime : 0,
      domContentLoaded: nav.domContentLoadedEventEnd,
      loadEvent: nav.loadEventEnd,
      jsFiles: scripts.length,
      jsBytes: scripts.reduce((total, r) => total + (r.encodedBodySize || 0), 0),
      blocking,
    }
  })

  const metrics = Object.fromEntries(
    (await cdp.send('Performance.getMetrics')).metrics.map((m) => [m.name, m.value]),
  )
  await browser.close()
  return { ...timing, scriptMs: (metrics.ScriptDuration ?? 0) * 1000 }
}

const median = (values) => {
  const sorted = [...values].sort((a, b) => a - b)
  return sorted[Math.floor(sorted.length / 2)]
}

async function main() {
  console.log(`[measure-startup] ${URL_} — ${RUNS} runs per setting, medians in ms\n`)
  for (const cpu of [1, 4]) {
    const runs = []
    for (let i = 0; i < RUNS; i++) runs.push(await once(cpu))
    const at = (key) => Math.round(median(runs.map((r) => r[key])))
    // 1x is honest for a current iPhone, which is not CPU-starved. 4x stands in
    // for the mid-range Android this project has no access to.
    console.log(`  CPU ${cpu}x`)
    console.log(`    TTFB                    ${at('ttfb')}`)
    console.log(`    document received       ${at('responseEnd')}`)
    console.log(`    first contentful paint  ${at('fcp')}`)
    console.log(`    DOMContentLoaded        ${at('domContentLoaded')}`)
    console.log(`    load event              ${at('loadEvent')}`)
    console.log(`    script evaluation       ${at('scriptMs')}`)
    console.log(`    JS: ${runs[0].jsFiles} files, ${Math.round(at('jsBytes') / 1024)} kB encoded`)
    for (const b of runs[0].blocking) console.log(`    render-blocking: ${b.name} (${b.ms} ms)`)
    console.log('')
  }
}

main().catch((error) => {
  console.error('[measure-startup] failed:', error instanceof Error ? error.message : error)
  process.exitCode = 1
})
