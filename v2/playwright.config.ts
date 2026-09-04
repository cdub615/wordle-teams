import { defineConfig } from '@playwright/test'
import * as dotenv from 'dotenv'
dotenv.config({ path: '.env.local' }) // VITE_CONVEX_URL for the OTP-capture client

export default defineConfig({
  testDir: './e2e',

  /**
   * PINNED, AND IT IS THE LAST HALF OF THE `wt-ksh.8.51` FLAKE FIX.
   *
   * Playwright's default is `cpus/2`, which on this box is ELEVEN browsers
   * against ONE Vite dev server. The product is not slow; the harness was
   * oversubscribed, and every worker's few-hundred module requests queued behind
   * the others'. Whole-test durations ran 3-4x their isolated figures —
   * complete-profile.spec.ts:25 takes 5.8s alone and was measured at 15.9s and
   * 23.2s under eleven — so assertions carrying Playwright's 5s default failed
   * intermittently, always on whichever spec happened to be landing a navigation
   * while the others were, never on a faulty spec.
   *
   * MEASURED BOTH WAYS on 2026-09-02, four full-suite runs each:
   *   11 workers, 5s expect ceiling   2-3 failures of 60, different specs each run
   *   11 workers, 20s expect ceiling  60/60, but the ceiling now hides a real stall
   *    4 workers, 5s expect ceiling   60/60, and the SAME 1.1-1.2m wall clock
   *
   * The wall clock is the part that decides it. The extra parallelism was buying
   * nothing — these tests are waiting on the dev server, not on CPU — so cutting
   * workers costs no time and removes the CAUSE, where raising the ceiling would
   * only have accommodated it. `wt-ksh.8.51` is explicit that `wordle-teams-1cd`'s
   * fix was the helper's contract rather than the timeout, and the same rule
   * applies here: 5s stays meaningful, so a genuine stall still fails fast.
   *
   * A LITERAL, NOT A FRACTION, so the suite behaves the same on a 4-core CI
   * runner as on a 22-core workstation. `cpus/2` made the flake rate a property
   * of the machine, which is why this was so hard to pin down.
   */
  workers: 4,

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

    /**
     * REUSE IS OFF, AND IT COST A WEEK OF TRUSTWORTHY RESULTS TO LEARN WHY.
     *
     * This was `true`. On 2026-09-02 a `vite dev` process started on **Aug 31**
     * was still holding port 3000, and every run since had attached to it —
     * exercising that process's two-day-old module graph rather than the
     * working tree. Measured side by side: port 3000 served `/about` with the
     * pre-change `og:url` and no canonical, while a server started seconds
     * earlier from the same files served both correctly. Vite's HMR had not
     * propagated into the long-lived SSR graph. (`wordle-teams-9mjm`)
     *
     * THE FAILURE IS SILENT AND BIASED TOWARD FALSE GREEN, which is the worst
     * combination available: a stale server passes tests for code that has
     * since been broken. It surfaced only because a new test asserted a COUNT
     * and got a number impossible from either version of the code; an assertion
     * on a value would have read as an ordinary failure and sent the author to
     * doubt their change.
     *
     * WITH REUSE OFF, AN OCCUPIED PORT IS AN ERROR RATHER THAN A REUSE.
     * Playwright refuses to start and says so, naming this setting. That is the
     * whole point — the previous behaviour's defect was not that it reused, it
     * was that reusing was indistinguishable from starting fresh.
     *
     * THE COST IS ABOUT 25 SECONDS OF STARTUP PER RUN, and that is the trade
     * being made deliberately. It buys the property that a green run means the
     * code on disk is green. `wt-ksh.8.49` records that CI runs no Playwright
     * at all, so this suite is only ever a thing somebody runs by hand — which
     * makes "did it test what I just wrote" the only question it answers.
     *
     * IF IT IS EVER TURNED BACK ON, the reuse has to become verifiable rather
     * than assumed: the probe below would need to carry a build identity the
     * config can compare against the working tree. Nothing serves one today.
     */
    reuseExistingServer: false,
  },
})
