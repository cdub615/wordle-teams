#!/usr/bin/env node
/**
 * Checks every social provider's authorize step against a deployed site.
 *
 * Four registrations is four chances to misconfigure a callback, and a working
 * Google says nothing about Discord. This caught exactly that on 2026-08-17:
 * three providers were fine while Google returned redirect_uri_mismatch — the
 * one provider 236 of 530 production users depend on.
 *
 *   node scripts/check-oauth-callbacks.mjs                        # beta
 *   node scripts/check-oauth-callbacks.mjs https://wordleteams.com  # Phase 8, prod
 *
 * WHY A REAL BROWSER: judging what a route renders by curl|grep gives false
 * answers here, because TanStack streams the SSR payload. And reaching the
 * provider's HOST is not proof of anything — a redirect_uri mismatch renders on
 * the provider's own domain too — so this looks for each provider's specific
 * rejection signature.
 *
 * WHAT THIS DOES NOT PROVE: that a sign-in completes. It stops at the consent
 * screen, because going further needs real credentials. Account linking still
 * has to be checked by hand — see wt-ksh.2.7's acceptance criteria.
 */
import { chromium } from '@playwright/test'

const BASE = process.argv[2] ?? 'https://beta.wordleteams.com'

// Button labels as rendered on /login, in SOCIAL_PROVIDERS order.
const PROVIDERS = ['Google', 'Microsoft', 'GitHub', 'Discord']

// Signatures meaning the app registration rejected us — almost always a
// callback URL that does not match, or a client id the provider does not know.
const REJECTIONS = [
  'redirect_uri_mismatch',
  'AADSTS50011', // Entra: redirect URI mismatch
  'AADSTS700016', // Entra: application not found in directory
  'redirect_uri is not associated',
  'The redirect_uri MUST match',
  'Invalid OAuth2 redirect_uri',
  'invalid_client',
  'unauthorized_client',
  'Error 400',
  'Access blocked',
]

const origin = new URL(BASE).host
const browser = await chromium.launch()
const results = []

for (const label of PROVIDERS) {
  const page = await browser.newPage()
  try {
    await page.goto(`${BASE}/login`, { waitUntil: 'networkidle', timeout: 30_000 })

    // The buttons are disabled until hydration by design (wt-ksh.2.2), so wait
    // for that rather than clicking a dead control.
    await page.waitForFunction(
      (l) =>
        !Array.from(document.querySelectorAll('button')).find(
          (b) => b.textContent?.trim() === l,
        )?.disabled,
      label,
      { timeout: 15_000 },
    )
    await page.getByRole('button', { name: label, exact: true }).click()

    // Wait for a real state change, NOT a fixed timeout. A fixed 3s wait
    // produced a false GitHub failure that three repeat runs disproved.
    await page
      .waitForFunction(
        (host) =>
          location.host !== host || !!document.querySelector('[role="alert"]'),
        origin,
        { timeout: 25_000 },
      )
      .catch(() => {})
    await page.waitForLoadState('networkidle', { timeout: 20_000 }).catch(() => {})

    const url = new URL(page.url())
    const body = (await page.locator('body').innerText().catch(() => '')) || ''
    const title = await page.title().catch(() => '')
    const hit = REJECTIONS.find((s) =>
      `${url.href}\n${title}\n${body}`.toLowerCase().includes(s.toLowerCase()),
    )

    if (hit) {
      results.push({
        label,
        ok: false,
        host: url.host,
        why: `rejected — matched "${hit}"`,
        detail: body.replace(/\s+/g, ' ').slice(0, 200),
      })
    } else if (url.host === origin) {
      const alert = await page
        .locator('[role="alert"]')
        .textContent()
        .catch(() => null)
      results.push({
        label,
        ok: false,
        host: url.host,
        why: 'never left the app',
        detail: alert?.trim() ?? '(no alert shown)',
      })
    } else {
      results.push({ label, ok: true, host: url.host, why: 'login/consent screen' })
    }
  } catch (e) {
    results.push({ label, ok: false, host: '-', why: `threw: ${String(e).slice(0, 120)}` })
  }
  await page.close()
}

await browser.close()

console.log(`\nOAuth callback check against ${BASE}\n`)
for (const r of results) {
  console.log(`  ${r.ok ? '✓' : '✗'} ${r.label.padEnd(10)} ${r.why.padEnd(32)} ${r.host}`)
  if (r.detail) console.log(`      ${r.detail}`)
}

const failed = results.filter((r) => !r.ok)
console.log(
  failed.length === 0
    ? '\nAll providers accepted the authorize request.\n'
    : `\n${failed.length} provider(s) failed: ${failed.map((f) => f.label).join(', ')}\n`,
)
process.exit(failed.length === 0 ? 0 : 1)
