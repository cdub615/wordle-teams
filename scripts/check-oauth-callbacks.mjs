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
 *
 * AND A SHARPER LIMIT, learned on 2026-08-17 when this script was wrong:
 * providers differ in WHEN they validate redirect_uri.
 *
 *   - Google validates BEFORE authenticating. A bad callback shows up here as
 *     "Error 400: redirect_uri_mismatch", and this script caught it.
 *   - Microsoft and GitHub authenticate FIRST and only then check the callback.
 *     This script reported both as passing; a human then signed in and both
 *     rejected the redirect_uri. A pass for those two means only "the app
 *     exists and the client id is known" — it says NOTHING about the callback.
 *
 * So a PASS is conclusive only for pre-login validators. Everything else needs
 * a real sign-in. The verdicts below say which is which rather than implying a
 * confidence the check cannot deliver.
 */
import { chromium } from '@playwright/test'

const BASE = process.argv[2] ?? 'https://beta.wordleteams.com'

/**
 * Button labels as rendered on /login, with when each provider validates the
 * redirect_uri. `preLogin: true` means a clean run here actually proves the
 * callback is registered; `false` means validation happens after the user
 * authenticates, so this script cannot see it either way.
 *
 * All observed directly against beta on 2026-08-17, not taken from docs.
 */
const PROVIDERS = [
  { label: 'Google', preLogin: true },
  { label: 'Microsoft', preLogin: false },
  { label: 'GitHub', preLogin: false },
  // Never observed either way — no completed Discord sign-in yet. Treated as
  // unproven, which is the safe default.
  { label: 'Discord', preLogin: false },
]

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

for (const { label, preLogin } of PROVIDERS) {
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
    } else if (preLogin) {
      results.push({
        label,
        ok: true,
        conclusive: true,
        host: url.host,
        why: 'callback accepted (validated pre-login)',
      })
    } else {
      results.push({
        label,
        ok: true,
        conclusive: false,
        host: url.host,
        why: 'reached provider — callback UNVERIFIED',
      })
    }
  } catch (e) {
    results.push({ label, ok: false, host: '-', why: `threw: ${String(e).slice(0, 120)}` })
  }
  await page.close()
}

await browser.close()

console.log(`\nOAuth callback check against ${BASE}\n`)
for (const r of results) {
  const mark = !r.ok ? '✗' : r.conclusive ? '✓' : '?'
  console.log(`  ${mark} ${r.label.padEnd(10)} ${r.why.padEnd(40)} ${r.host}`)
  if (r.detail) console.log(`      ${r.detail}`)
}

const failed = results.filter((r) => !r.ok)
const unverified = results.filter((r) => r.ok && !r.conclusive)

if (failed.length) {
  console.log(`\n✗ ${failed.length} provider(s) FAILED: ${failed.map((f) => f.label).join(', ')}`)
}
if (unverified.length) {
  console.log(
    `\n? ${unverified.length} provider(s) UNVERIFIED: ${unverified.map((u) => u.label).join(', ')}` +
      '\n  These authenticate before checking redirect_uri, so a clean run here does' +
      '\n  NOT mean the callback is registered. Only a real sign-in settles it.',
  )
}
if (!failed.length && !unverified.length) {
  console.log('\n✓ Every provider validated its callback before login, and all passed.')
}
console.log('')

// Unverified is not failure — it is absence of evidence, and the caller should
// not treat it as a green light. Only outright rejection exits non-zero.
process.exit(failed.length === 0 ? 0 : 1)
