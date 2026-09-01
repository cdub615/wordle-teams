import { defineConfig } from '@playwright/test'
import * as dotenv from 'dotenv'
dotenv.config({ path: '.env.local' }) // VITE_CONVEX_URL for the OTP-capture client

export default defineConfig({
  testDir: './e2e',
  use: { baseURL: 'http://localhost:3000' },
  webServer: {
    command: 'pnpm dev',
    // BACK ON `/` AS OF PHASE 7 TASK 4, which built the marketing landing there.
    //
    // WHAT THIS HAS TO SATISFY: Playwright treats a 404 as "not ready yet", so
    // it retries a missing route until the 60s timeout and then fails the WHOLE
    // run with `Timed out waiting for config.webServer` — a message that names
    // the dev server rather than the route and reads like the server never came
    // up. The probe target must therefore be a real page that answers 200 with
    // no session (which also makes this prove the app SERVES, not merely that
    // the port is open), and it must be one that stays.
    //
    // Task 1 moved this to /about only because it had deleted the dashboard off
    // `/` and left the path with no route at all. That reason is gone. `/` is
    // the apex, it is the route whose failure means the product is down, and it
    // is finished; /about was the one this phase was still editing at the time
    // (Task 9 has since added v1's eight product screenshots to it). Probing a
    // page under active construction is the arrangement more likely to produce
    // that confusing failure, so the workaround goes back where it came from
    // rather than outliving its cause. See the reciprocal note in
    // src/routes/about.tsx.
    url: 'http://localhost:3000/',
    reuseExistingServer: true,
  },
})
