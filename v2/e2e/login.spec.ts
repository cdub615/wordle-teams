import { test, expect } from '@playwright/test'
import { ConvexHttpClient } from 'convex/browser'
import { api } from '../convex/_generated/api'

test('signs in with an emailed OTP code', async ({ page }) => {
  const email = `e2e+${Date.now()}@wordleteams.com`
  const convex = new ConvexHttpClient(process.env.VITE_CONVEX_URL!)

  await page.goto('/login')

  // Retry the whole interaction until the UI advances: with SSR the page is
  // visible before React hydrates, so an immediate fill/click can be lost
  // (no handler attached yet, and hydration resets the controlled input).
  await expect(async () => {
    await page.getByLabel('Email').fill(email)
    await page.getByRole('button', { name: /send code/i }).click()
    await expect(page.getByLabel('Code')).toBeVisible({ timeout: 2000 })
  }).toPass({ timeout: 15_000 })

  let otp: string | null = null
  await expect
    .poll(async () => (otp = await convex.query(api.testOtps.latestFor, { email })), {
      timeout: 15_000,
    })
    .not.toBeNull()

  await page.getByLabel('Code').fill(otp!)
  await page.getByRole('button', { name: /verify/i }).click()

  await expect(page.getByTestId('signed-in-email')).toContainText(email)
})
