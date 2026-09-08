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
   * FOUR BECAME TWO ON 2026-09-03, and why the old figure stopped holding is the
   * part worth keeping. Those runs were taken while `reuseExistingServer` was
   * `true`, so they shared ONE long-lived dev server and its already-open Convex
   * connections. `wordle-teams-9mjm` turned reuse off — a two-day-old server had
   * been serving stale code — and the suite has since grown from 60 tests to 66.
   * At four workers it then failed 2 of 3 full runs, always on whichever spec was
   * mid round trip (`wordle-teams-jtvx`):
   *
   *    4 workers   2 failed / 64 passed, 1.8m   (teams.spec:94, invites.spec:140)
   *    2 workers   66/66, 2.0m
   *    2 workers   66/66, 2.1m
   *
   * TWELVE SECONDS is the whole cost, and it buys back a suite whose green means
   * something. Same trade as the 11-to-4 cut and for the same reason: these tests
   * wait on I/O, not CPU, so parallelism past the bottleneck buys nothing and
   * only starves whoever is mid-request.
   *
   * THE BOTTLENECK IS THE CONVEX BACKEND, NOT VITE, and that was measured rather
   * than assumed. A globalSetup that serially warmed all eight route modules
   * before any worker started ran in 643ms and changed nothing — the failures
   * were mutation round trips (Submit clicked, board still visible 5s later), not
   * first-paint compiles. That warmer was written, measured and deleted; it is
   * recorded here so nobody writes it again.
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
  /**
   * TWO ON A WORKSTATION, ONE IN CI, and the CI half was measured rather than
   * assumed. Everything above is reasoning about a 22-core machine where these
   * tests wait on I/O rather than CPU — which is true there and NOT true on a
   * 2-core GitHub runner, where two Chromiums, a Vite dev server and the Convex
   * local backend genuinely contend for two cores.
   *
   * WHAT IT COST TO FIND: settings.spec.ts:183 failed at two workers in CI and
   * only there (runs 34198662379 and 34199276767, 76 of 77 both times), with the
   * time-zone combobox still empty after 43 polls. It was NOT the environment —
   * that same spec run alone on the same runner passes in 59.6s, and the convex
   * log shows settings:updateTimeZone executing normally (run 34199977658). The
   * assertion waits on a write the user never asked for, with no spinner to wait
   * on, so contention shows up there first and silently.
   *
   * `process.env.CI` rather than a hardcoded 1: this is also Playwright's own
   * default shape for the same reason, and it keeps the workstation figure and
   * all the reasoning above intact.
   */
  workers: process.env.CI ? 1 : 2,

  /**
   * THE LOCALE IS PINNED, AND AS OF wordle-teams-8klr IT IS LOAD-BEARING RATHER
   * THAN TIDY. settings/notifications-tab.tsx used to hardcode a US 12-hour
   * clock; it now formats the reminder hour with lib/clock-time.ts, which asks
   * CLDR — so `6:00 PM` is `18:00` to a browser launched in en-GB, and the
   * assertion in e2e/settings.spec.ts would then be a fact about whoever ran it.
   * Chromium inherits the host's locale by default, so without this line the
   * suite is green on an American laptop and red on a British one.
   */
  use: { baseURL: 'http://localhost:3000', locale: 'en-US' },
  webServer: {
    command: 'pnpm dev',

    /**
     * THE DEV SERVER IS TOLD IT IS UNDER TEST, and the only thing that reads
     * this today is the TanStack Devtools launcher in src/routes/__root.tsx,
     * which is suppressed when it is set.
     *
     * WHY A FLAG RATHER THAN A TWEAK AT THE CALL SITE. The launcher is fixed to
     * `bottom-right`, which is where the chat composer's Send button lives, and
     * Chromium reports the launcher's <img> as intercepting pointer events. A
     * click on Send therefore never lands — and because Playwright's default
     * actionTimeout is 0, it RETRIES FOREVER rather than failing, so the spec
     * burns its whole test timeout and reports a stack in whatever ran last.
     * `wordle-teams-zzo7` cost a day reading that as a chat defect.
     *
     * The value is only ever set here, so `pnpm dev` by hand still has devtools
     * — the affordance is not being removed from development, only from the
     * browser Playwright drives.
     */
    env: { VITE_E2E: 'true' },

    /**
     * PLAYWRIGHT'S DEFAULT IS 60s AND IT IS NOT ENOUGH ON A CI RUNNER, which is
     * where this was measured: the first run of the suite under
     * .github/workflows/e2e-v2.yml died on `Timed out waiting 60000ms from
     * config.webServer` having never served `/` (run 34197357303).
     *
     * NOT A HANG, AND NOT THE ROUTE. The probe below is `/`, which is finished
     * and answers 200 — the same probe passes locally in about 8s. The
     * difference is the machine: a cold `vite dev` SSR of `/` compiles several
     * hundred modules on demand, and a 2-core GitHub runner is a long way from
     * the 22-core workstation this suite was tuned on. Nothing is wrong; it is
     * simply slower than the default allows.
     *
     * THREE MINUTES IS A CEILING, NOT A BUDGET. It is not waited on when the
     * server is ready sooner, so it costs nothing locally; it only stops a slow
     * cold start being reported as a dead dev server. That misreporting is the
     * real cost being avoided — the message names config.webServer and reads
     * like the server never came up, which is exactly the confusion the `url`
     * comment below was already written to prevent.
     */
    timeout: 180_000,
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
