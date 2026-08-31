import { defineConfig } from '@playwright/test'
import * as dotenv from 'dotenv'
dotenv.config({ path: '.env.local' }) // VITE_CONVEX_URL for the OTP-capture client

export default defineConfig({
  testDir: './e2e',
  use: { baseURL: 'http://localhost:3000' },
  webServer: {
    command: 'pnpm dev',
    // /about, NOT `/`. This is a readiness probe, and Playwright treats a 404
    // as "not ready yet" — it retries until the 60s timeout and then fails the
    // whole run with `Timed out waiting for config.webServer`, which names the
    // server rather than the route and reads like the dev server never came up.
    // Phase 7 Task 1 moved the dashboard to /app and left `/` with no route at
    // all until the marketing landing lands, so probing `/` did exactly that.
    // /about is chosen because it is a real rendered page that needs no session
    // — so this still proves the app SERVES, not merely that the port is open —
    // and because it is not the route this phase is busy moving around.
    url: 'http://localhost:3000/about',
    reuseExistingServer: true,
  },
})
