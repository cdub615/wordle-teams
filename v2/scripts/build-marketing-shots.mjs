#!/usr/bin/env node
/**
 * THE PRODUCT SHOTS THE MARKETING PAGES USE, CAPTURED RATHER THAN COLLECTED.
 *
 * GENERATE-ON-DEMAND AND COMMITTED, exactly like build-splash-screens.mjs and
 * fetch-fonts.mjs, and NOT part of `pnpm build`: it needs a browser, a dev
 * server and a seeded backend, none of which belong in a build.
 *
 * IT EXISTS BECAUSE THE ALTERNATIVE ROTTED. public/welcome-screenshot.png was
 * hand-captured, and by the time wordle-teams-wty4.1.14 was filed it showed a
 * v1-era dashboard on the page the launch email points at. Re-shooting is now
 * one command, which is the same answer this work gave for the copy.
 *
 * THE ONE FAILURE MODE THIS FILE IS BUILT AROUND IS A GREEN RUN THAT CAPTURED
 * NOTHING. A screenshot of a loading skeleton, of an empty state, or of the
 * login page is a valid PNG of the right size written to the right path, and an
 * exit code cannot see the difference. So every shot below declares a `ready`
 * predicate that is a fact about REAL DATA being on the page — a scoreboard
 * with scores in it, a trend with bars in it, a conversation with this run's
 * messages in it — and the run fails on that predicate rather than on a
 * timeout. `assertMarketingShots` then re-checks the files on disk afterwards,
 * because a predicate that passed and a file that was written are still two
 * different claims.
 *
 * WHAT IT SEEDS, AND WHY IT IS TWO ACCOUNTS. convex/e2eSeed.ts's mutations are
 * the only way to put a real deployment into a known state (isE2eTraffic gates
 * them to e2e+* addresses on a deployment with E2E_TEST_MODE set), and the
 * surfaces this captures are all about a TEAM: a scoreboard needs a second row,
 * the insights head-to-head needs somebody to be head-to-head with, and a chat
 * shot of one person talking to themselves is not a chat shot. `ensureSharedTeamFor`
 * is the seed that puts two accounts on one team, so both sign in.
 *
 * THE NAMES ARE SET THROUGH THE PRODUCT'S OWN SETTINGS DIALOG, NOT BY A SEED,
 * and that is a limitation rather than a preference. `ensureSharedTeamFor`
 * hardcodes 'PlayerA E2E' and 'PlayerB E2E', which is right for a spec and
 * unusable on a landing page — and this script may not edit convex/e2eSeed.ts.
 * Driving Settings -> Profile -> Save name is the app's own supported path to
 * the same row, so it changes no product behaviour and adds no test-only
 * branch. If that seed ever grows `firstName`/`lastName` arguments, delete
 * `renameThrough` below and pass them instead.
 *
 * THE DEV SERVER IS STARTED BY THIS SCRIPT AND KILLED BY IT. A vite that
 * somebody else left on :3000 serves ITS module graph, not the working tree —
 * wordle-teams-9mjm cost a week of false-green e2e runs to that exact thing, and
 * playwright.config.ts turned `reuseExistingServer` off because of it. There is
 * no Playwright harness around this file to inherit that from, so the check is
 * here: an occupied port is refused unless the holder is demonstrably this
 * repo's own `vite dev`, in which case it is killed and replaced. Readiness is
 * polled over HTTP with a sleep between attempts — never `pgrep` (it matches
 * the waiter's own command line and the loop never exits) and never a bare spin
 * (a busy-wait burns a core and contaminates every timing after it).
 *
 * VITE_E2E IS SET ON THAT SERVER FOR A REASON THAT IS VISIBLE IN THE OUTPUT.
 * It suppresses the TanStack Devtools launcher (src/routes/__root.tsx), which
 * is fixed to the bottom-right corner — i.e. it would be IN every one of these
 * images, floating over the chat composer's Send button. playwright.config.ts
 * sets the same flag for the same reason.
 */
import { spawn } from 'node:child_process'
import { existsSync } from 'node:fs'
import { mkdir, mkdtemp, readdir, rm, stat } from 'node:fs/promises'
import net from 'node:net'
import path from 'node:path'
import { setTimeout as sleep } from 'node:timers/promises'
import { fileURLToPath } from 'node:url'
import * as dotenv from 'dotenv'

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')

// VITE_CONVEX_URL, for the seeding client and for sign-in.ts's OTP read.
// playwright.config.ts loads the same file for the same reason.
dotenv.config({ path: path.join(ROOT, '.env.local'), quiet: true })

const PORT = Number(process.env.SHOTS_PORT ?? 3000)
const BASE = `http://localhost:${PORT}`
const OUT_DIR = path.join(ROOT, 'public', 'marketing')

/**
 * ONE FIXED DESKTOP VIEWPORT FOR EVERY SHOT, at deviceScaleFactor 1.
 *
 * 1440x900 is wide enough for the scoreboard to show a full month of day
 * columns without its horizontal scroller eating them, which is the narrowest
 * thing any of these four surfaces depends on. Above `md` the layout stops
 * changing shape, so a wider frame buys pixels rather than product.
 *
 * SCALE 1, NOT 2, IS A SIZE DECISION AND THESE FILES ARE COMMITTED. A 2x
 * capture of the same frame is four times the pixels for images a marketing
 * page renders at roughly half this width anyway — 1440 source into a ~700px
 * slot is already a 2x image where it is shown.
 */
const VIEWPORT = { width: 1440, height: 900 }

/** Both, always. The marketing pages render in whichever the reader is in. */
const SCHEMES = ['light', 'dark']

/**
 * FIRST PAINT ON A COLD VITE DEV SERVER IS SLOW, AND THAT IS NOT A DEFECT.
 * Same figure and same reasoning as e2e/team-insights.spec.ts's FIRST_PAINT:
 * the first navigation to a route compiles several hundred modules on demand,
 * then opens a Convex subscription. This is a ceiling for the "has the real
 * data arrived" predicates, not a budget — nothing waits on it when the page is
 * ready sooner, and a page that never arrives fails HERE, naming the shot.
 */
const READY_TIMEOUT = 30_000

/**
 * The cast. Fictional, and deliberately not anybody's real name: these images
 * go on a public marketing page.
 */
const VIEWER = { firstName: 'Casey', lastName: 'Mercer' }
const TEAMMATE = { firstName: 'Jordan', lastName: 'Hale' }
const TEAM_NAME = 'The Word Nerds'

/**
 * The conversation the chat shot is a picture of.
 *
 * POSTED THROUGH THE REAL COMPOSER BY TWO REAL SESSIONS, because there is no
 * chat seed in convex/e2eSeed.ts and this script may not add one. That is also
 * why it is short: every line costs a round trip through the product.
 */
const CONVERSATION = [
  { from: 'teammate', body: 'Four today. I nearly threw my phone at the second guess.' },
  { from: 'viewer', body: 'Three, but only because ORATE got lucky on the vowels.' },
  { from: 'teammate', body: 'Every time. I do not know why I keep starting with CRANE.' },
  { from: 'viewer', body: 'Insights says ORATE would save you about a guess a day.' },
  { from: 'teammate', body: 'Fine. Switching tomorrow. Under protest.' },
  { from: 'viewer', body: 'Noted for the record.' },
  { from: 'teammate', body: 'That opener is going to win you the month, isn’t it.' },
  { from: 'viewer', body: 'Two points in it with a week to go. Nothing is decided.' },
  { from: 'teammate', body: 'I have a plan. It involves waking up earlier.' },
  { from: 'viewer', body: 'Your plan last month involved waking up earlier.' },
  { from: 'teammate', body: 'And it nearly worked.' },
  { from: 'viewer', body: 'It did not. I have the scoreboard open right now.' },
  { from: 'teammate', body: 'Rematch in October. Bring a better opener.' },
]

/**
 * Every shot this script owns. A missing file here is a failed run.
 *
 * `ready` IS THE POINT OF THIS TABLE. Each one is a predicate evaluated IN THE
 * PAGE that is true only once the real, seeded data has rendered — not "the
 * route responded", which a skeleton and a redirect to /login both satisfy.
 * `prepare` runs after the navigation and before the wait, for the one shot
 * that is a picture of a task in progress rather than of a page at rest.
 *
 * `clip` IS THE SECOND KIND OF SHOT, ADDED BY wordle-teams-wty4.1.14.5, AND IT
 * IS WHAT LET /about STOP CARRYING HAND-CAPTURED PNGs. Three of the surfaces
 * that page walks a newcomer through — entering a board, creating a team,
 * finding the install guide — are DIALOGS, not pages. A full-viewport frame of
 * one is mostly the dashboard behind it, and /about draws these in a column
 * about 500px wide beside their own sentence, so the thing being explained
 * would arrive a few hundred pixels tall. `clip` names a selector and the
 * capture goes through `locator.screenshot()` instead of `page.screenshot()`,
 * which writes the element's own box and nothing else.
 *
 * IT ALSO SIDESTEPS wordle-teams-t40a FOR THOSE THREE, WHICH IS A HAPPY
 * ACCIDENT RATHER THAN A FIX. That issue is that every file here is a 1440x900
 * DESKTOP frame rendered to a phone. A clipped dialog is not: ui/dialog.tsx
 * caps at `max-w-lg` (512px) on a laptop and `w-11/12` (~358px at 390px), so
 * the clipped file is within about 40% of what a phone draws and is the same
 * shape. The four unclipped shots still have t40a's problem in full.
 *
 * THE CLIP IS AN ELEMENT, NEVER A RECTANGLE. Playwright also takes `clip: {x,
 * y, width, height}`, which is a set of numbers that keeps meaning something
 * after the layout under it moves — the failure mode this whole file exists to
 * refuse. A selector either resolves or the run dies naming the shot.
 */
const SHOTS = [
  /**
   * BOARD ENTRY COMES FIRST, AND THE ORDER IS LOAD-BEARING RATHER THAN
   * ARBITRARY. This shot needs today to be UNPLAYED by the viewer — the form
   * opens on today (pick-default-day.ts's fast path) and a day with a board
   * already on it is not a picture of entering one. Every other shot is better
   * with today PLAYED: the dashboard's Team Boards panel says "Visible after
   * today's submission" until the viewer has submitted, so the bottom of that
   * frame is otherwise a blank band where two Wordle grids should be.
   *
   * So this shot is taken first and then `finish` actually submits the board it
   * was a picture of, which is also the one place in this script where the
   * product's own write path runs.
   */
  {
    name: 'board-entry',
    path: () => '/app',
    /**
     * THE ENTRY FORM OPEN AND HALF FILLED, which is what makes it a picture of
     * the thing the product is FOR rather than of a button. The sequence is
     * e2e/board-entry.spec.ts's: the panel opens on a step that asks which day
     * and how, with nothing focusable in it, and choosing to type is what
     * focuses the answer. The answer's fifth letter hands the caret to the
     * board, so the guesses follow with no click in between.
     */
    prepare: async (page) => {
      await page.getByRole('button', { name: 'Board Entry' }).click()
      await page.getByRole('button', { name: 'Enter manually' }).click()
      await page.getByRole('region', { name: 'Wordle Board' }).waitFor({ timeout: READY_TIMEOUT })
      await page.keyboard.type('SPEED')
      await page.keyboard.type('CRANEMOIST')
    },
    /**
     * Three filled rows: the answer's five slots plus two complete guesses.
     * `board-cursor` is on the tile awaiting the next letter, so its presence
     * is "mid-task" rather than "finished" — which is the shot.
     */
    ready: () =>
      document.querySelector('[data-testid="board-cursor"]') !== null &&
      document.querySelectorAll('[data-testid="answer-slot"]').length >= 5,
    describe: 'the board open, two guesses in, the cursor on the next tile',
    /**
     * THE DIALOG, NOT THE DASHBOARD BEHIND IT. This was a full 1440x900 frame
     * until wordle-teams-wty4.1.14.5; /about is its only consumer and draws it
     * beside a sentence about entering a board, where four fifths of that frame
     * was a scoreboard nobody was being told to look at. See `clip` in this
     * table's header.
     */
    clip: '[role="dialog"]',
    /**
     * Finishes the board and submits it, once, after both colour schemes have
     * been captured. The dialog closes ONLY on success, so waiting for the
     * board to go is waiting for the write rather than for the click.
     *
     * It does not pop the monthly-winner celebration over the next shot:
     * that modal asks about LAST month's winner, and nothing in this run ever
     * computes one for August — the seeds write `teamMonthStats`, not
     * `monthlyWinners`.
     */
    finish: async (page, expect) => {
      await page.keyboard.type('SPEED')
      await page.getByRole('button', { name: 'Submit' }).click()
      await expect(page.getByRole('region', { name: 'Wordle Board' })).toBeHidden({
        timeout: READY_TIMEOUT,
      })
    },
  },
  {
    name: 'dashboard',
    path: () => '/app',
    /**
     * THE ONBOARDING CARD IS DISMISSED FIRST, AND THAT IS A CORRECTION RATHER
     * THAN A PREFERENCE (wordle-teams-wty4.1.14.5). wordle-teams-wty4.1.14.6
     * landed AFTER this script did and gave onboarding/next-step-card.tsx a
     * GRADUATION state — "You are all set up", with a See your insights button
     * — which renders for exactly the player this run seeds: every task done,
     * nothing dismissed. So a re-run started photographing a 194px onboarding
     * nudge at the top of the frame, and the landing page's
     * components/home/dashboard-preview.tsx crop (an `object-position`
     * percentage into this file) framed the nudge instead of the scoreboard.
     *
     * Dismissing is the app's own control and is what any established player
     * has already done, so this is a picture of the steady state rather than of
     * a first week. It is a MUTATION — it writes `onboardingDismissedAt` — and
     * therefore runs once in effect: the second colour scheme finds no card and
     * the `.catch` below is that, not a swallowed failure.
     *
     * THE `ready` PREDICATE BELOW ASSERTS THE CARD IS GONE for this file's
     * usual reason: the click dispatching and the write landing are two
     * different claims, and a shot taken between them is the exact frame this
     * step exists to avoid.
     */
    prepare: async (page) => {
      const dismiss = page.getByRole('button', { name: 'Dismiss getting started' })
      // Absent for a player who has already dismissed — which is every pass
      // after the first — so its absence is the success case, not an error.
      await dismiss.click({ timeout: 5_000 }).catch(() => {})
    },
    /**
     * SCORES IN CELLS, NOT A TABLE. scores-table.tsx renders the whole grid —
     * headers, empty day cells, both player rows — before a single board has
     * arrived, so `table` being visible is true of the empty state too.
     * `[data-day]` cells carrying text are boards.
     */
    ready: () =>
      document.querySelector('[aria-label="Dismiss getting started"]') === null &&
      [...document.querySelectorAll('table [data-day]')].filter(
        (cell) => (cell.textContent ?? '').trim() !== '',
      ).length >= 10,
    describe: 'no onboarding card, and at least ten day cells carrying a score',
  },
  {
    name: 'insights',
    path: () => '/insights',
    /**
     * ALL THREE LAYERS AT ONCE, because each can be absent for its own reason
     * and any one of them missing makes a poor shot that still exits 0:
     * `insights-attribution` means the benchmark JSON arrived over HTTP,
     * `insights-trend-bar` means the personal history rendered (Layer 2), and
     * `insights-team` means the team panel resolved its aggregate (Layer 3),
     * which routes/insights.tsx renders as `null` — not a skeleton — until both
     * the team and its month are settled.
     *
     * FIVE BARS, NOT ONE, AND THE NUMBER IS THE ASSERTION. TrendPanel draws one
     * bar PER MONTH, so a run that seeded a fortnight of history would render a
     * two-bar chart — present, correct, and a poor advertisement. This is the
     * guard on the seed's size as much as on the render.
     */
    ready: () =>
      document.querySelector('[data-testid="insights-loading"]') === null &&
      document.querySelector('[data-testid="insights-attribution"]') !== null &&
      document.querySelectorAll('[data-testid="insights-trend-bar"]').length >= 5 &&
      document.querySelector('[data-testid="insights-team"]') !== null,
    describe: 'the benchmark, a personal trend of at least five bars, and the team panel',
    /**
     * THE ONE SHOT THAT IS NOT OF THE TOP OF ITS PAGE. /insights leads with the
     * personal summary and distribution; the trend chart and the team panel —
     * which are what a marketing page is pointing at when it says "insights" —
     * start about 800px down. Scrolling to the trend puts both of them in one
     * 900px frame, which is the shot that was asked for.
     */
    focus: '[data-testid="insights-trend"]',
  },
  {
    name: 'chat',
    path: ({ teamId }) => `/chat?team=${teamId}`,
    /**
     * THE LAST LINE OF THIS RUN'S CONVERSATION, inside the message list.
     * Scoped to `chat-messages` for e2e/chat.spec.ts's reason: an unscoped text
     * match also finds a draft still sitting in the composer.
     */
    ready: (last) => {
      const list = document.querySelector('[data-testid="chat-messages"]')
      return list !== null && (list.textContent ?? '').includes(last)
    },
    readyArg: () => CONVERSATION[CONVERSATION.length - 1].body,
    describe: 'the message list carrying the last line of the seeded conversation',
  },
  /**
   * THE TWO /about SHOTS, LAST BECAUSE NEITHER NEEDS THE WORLD IN ANY
   * PARTICULAR STATE and both open a modal over whatever is behind them.
   *
   * They replace public/create-team.png and public/install-button.png, which
   * were v1 crops and were both WRONG by the time this ran: the create-team
   * dialog has grown a third field since (`Show Letters in Completed Boards`,
   * teams/team-fields.tsx) and its description sentence changed, and the
   * install crop was a picture of a dropdown menu that no longer exists —
   * wordle-teams-lyab rebuilt the bar's menu and wordle-teams-mwu0 folded
   * Profile, Install and Notifications into one `Settings` item.
   */
  {
    name: 'create-team',
    path: () => '/app',
    /**
     * THROUGH THE TEAM PICKER, WHICH IS THE ROUTE A PLAYER WITH A TEAM TAKES.
     * The onboarding card's "Create a team" is the other trigger and is the
     * wrong one here: this run's viewer has a team and 200 boards, so that card
     * has nothing to show.
     *
     * The trigger is matched by a REGEX over its accessible name rather than by
     * the team's name exactly: team-picker.tsx's aria-label is
     * `teamPickerLabel(name, unreadElsewhere)`, which appends an unread clause,
     * and the teammate posted the last line of the conversation above.
     */
    prepare: async (page) => {
      await page.getByRole('button', { name: new RegExp(TEAM_NAME) }).click()
      await page.getByRole('menuitem', { name: 'New Team' }).click()
    },
    /**
     * THE DIALOG'S OWN TITLE, not merely `[role="dialog"]` being present: the
     * team picker's DropdownMenuContent is not a dialog, but a half-open Radix
     * portal during the transition could still put one in the tree, and a shot
     * of the wrong modal is the silent green this file is built to refuse.
     */
    ready: () => {
      const dialog = document.querySelector('[role="dialog"]')
      return dialog !== null && (dialog.textContent ?? '').includes('Create Team')
    },
    describe: 'the Create Team dialog open, with its name field and both switches',
    clip: '[role="dialog"]',
  },
  {
    name: 'install-guide',
    path: () => '/app',
    prepare: async (page) => {
      await openMainMenu(page)
      await page.getByRole('menuitem', { name: 'Settings' }).click()
      await page.getByRole('dialog').waitFor({ timeout: READY_TIMEOUT })
      await page.getByRole('tab', { name: 'Install' }).click()
    },
    /**
     * `[data-state="active"]` IS NOT DECORATION ON THIS SELECTOR, AND A BARE
     * `[role="tabpanel"]` IS WRONG. Radix mounts a panel element for EVERY tab
     * — the three inactive ones are present, `hidden`, and EMPTY (their
     * children are what Presence withholds) — so `querySelector` on the role
     * alone returns Profile's empty box no matter which tab is open, and this
     * predicate could never come true. Measured: it timed out on a dialog that
     * was, by the same dump, correctly showing the Install tab.
     */
    ready: () => {
      const panel = document.querySelector('[role="tabpanel"][data-state="active"]')
      return panel !== null && (panel.textContent ?? '').includes('Add to Home Screen')
    },
    describe: 'the settings dialog on its Install tab, showing the three add-to-home-screen steps',
    /**
     * THE TABS, NOT THE WHOLE DIALOG, AND THE DIFFERENCE IS AN EMAIL ADDRESS.
     * settings-dialog.tsx puts the signed-in player's NAME AND ADDRESS in the
     * dialog header above the tab strip, and the account driving this script is
     * `e2e+shots-<timestamp>a@wordleteams.com`. That is not a real person's
     * address, but it is a throwaway one, and a marketing page explaining how
     * to install the app should not be showing a reader anybody's inbox.
     *
     * Clipping the Tabs root keeps the half that carries the information — the
     * strip that says Profile / Alerts / Security / Install, with Install
     * selected, above its own three steps — so the frame still answers "where
     * is this" and not only "what does it say".
     *
     * `:has(> [role="tablist"])` RATHER THAN A testid ADDED TO THE PRODUCT. The
     * Tabs root is the element whose only distinguishing feature is that the
     * tab strip is its first child; adding an attribute to src/ so a screenshot
     * script can find it would be the product carrying the script's problem.
     */
    clip: '[role="dialog"] div:has(> [role="tablist"])',
  },
]

/**
 * THE GUARD, PURE OVER FACTS ALREADY GATHERED, for build-splash-screens.mjs's
 * reason: every way this can fail is silent, so the assertions have to be
 * exercisable without breaking a real run to watch them fire.
 *
 * Three claims, and they are not the same claim:
 *
 *   1. every expected name was written        -> a partial run is not a run.
 *   2. no file is implausibly small           -> a PNG of a blank page is a
 *                                                valid PNG, and it is tiny.
 *   3. no file in the directory is unclaimed  -> a renamed shot otherwise
 *                                                leaves its predecessor
 *                                                committed and served, so the
 *                                                directory stops describing
 *                                                what this script produces.
 */
export function assertMarketingShots({ expected, produced, strays, minBytes }) {
  const problems = []
  const byName = new Map(produced.map((file) => [file.name, file]))

  for (const name of expected) {
    const file = byName.get(name)
    if (!file) problems.push(`${name} was never written`)
    else if (file.bytes < minBytes)
      problems.push(`${name} is ${file.bytes} bytes, which is too small to be a screenshot`)
  }
  for (const stray of strays) problems.push(`${stray} is in public/marketing/ but no shot claims it`)

  return problems
}

/** Resolves once something is LISTENING on `port`, or immediately if nothing is. */
function isPortOpen(port) {
  return new Promise((resolve) => {
    const socket = net.connect({ port, host: '127.0.0.1' })
    const done = (answer) => {
      socket.destroy()
      resolve(answer)
    }
    socket.setTimeout(1_000)
    socket.once('connect', () => done(true))
    socket.once('timeout', () => done(false))
    socket.once('error', () => done(false))
  })
}

/**
 * The pid listening on `port`, or null.
 *
 * `ss`, NOT `pgrep`. Matching a process by NAME is the trap wordle-teams' notes
 * keep re-learning: the pattern matches the waiter's own command line, so a
 * loop built on it never terminates. The question here is "who holds this
 * socket", which is a question about the socket.
 */
async function listenerPid(port) {
  const output = await run('ss', ['-ltnpH', `sport = :${port}`]).catch(() => '')
  return /pid=(\d+)/.exec(output)?.[1] ?? null
}

function run(command, args) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, { stdio: ['ignore', 'pipe', 'ignore'] })
    let out = ''
    child.stdout.on('data', (chunk) => (out += chunk))
    child.once('error', reject)
    child.once('close', () => resolve(out))
  })
}

/**
 * Starts `pnpm dev` on PORT and resolves when it SERVES `/` — not when the
 * socket opens, which a vite that has not finished its first SSR also does.
 *
 * THE OCCUPIED-PORT BRANCH IS THE STALE-SERVER GUARD. Reusing whatever is there
 * is what made a two-day-old module graph serve a whole e2e run; refusing
 * outright would be safe but useless, because the thing holding :3000 is nearly
 * always this repo's own leftover dev server. So: identify it, and only kill it
 * if it is demonstrably that. Anything else is somebody's work and is refused
 * with its pid on the message.
 */
async function startDevServer() {
  if (await isPortOpen(PORT)) {
    const pid = await listenerPid(PORT)
    const cwd = pid ? await readLink(`/proc/${pid}/cwd`) : null
    const cmdline = pid ? await readCmdline(pid) : ''
    const ours = cwd === ROOT && /vite|pnpm|node/.test(cmdline)
    if (!pid || !ours) {
      throw new Error(
        `port ${PORT} is held by ${pid ? `pid ${pid} (${cmdline || 'unknown'}, cwd ${cwd ?? 'unknown'})` : 'an unidentifiable process'}, ` +
          `which is not this repo's dev server. Stop it and re-run — reusing it would ` +
          `capture whatever module graph it happens to hold (wordle-teams-9mjm).`,
      )
    }
    console.log(`[build-marketing-shots] killing this repo's stale dev server on :${PORT} (pid ${pid})`)
    process.kill(Number(pid), 'SIGTERM')
    await until(async () => !(await isPortOpen(PORT)), 20_000, `port ${PORT} to be released`)
  }

  console.log(`[build-marketing-shots] starting a fresh dev server on :${PORT}`)
  const child = spawn('pnpm', ['dev', '--port', String(PORT)], {
    cwd: ROOT,
    // VITE_E2E keeps the devtools launcher out of the corner of every image.
    env: { ...process.env, VITE_E2E: 'true' },
    stdio: ['ignore', 'ignore', 'inherit'],
    // Its own process group, so the whole tree goes down at the end: `pnpm dev`
    // is a shim around vite, and a SIGTERM to the shim alone orphans the server
    // that is actually holding the port.
    detached: true,
  })

  await until(
    async () => {
      if (child.exitCode !== null) throw new Error(`dev server exited with ${child.exitCode}`)
      const response = await fetch(`${BASE}/`).catch(() => null)
      return response !== null && response.ok
    },
    180_000,
    `the dev server to serve ${BASE}/`,
  )
  console.log('[build-marketing-shots] dev server is serving')
  return child
}

async function stopDevServer(child) {
  if (!child || child.exitCode !== null) return
  try {
    process.kill(-child.pid, 'SIGTERM')
  } catch {
    // Already gone, or never got a group of its own. Nothing to clean up.
  }
}

async function readLink(target) {
  const { readlink } = await import('node:fs/promises')
  return readlink(target).catch(() => null)
}

async function readCmdline(pid) {
  const { readFile } = await import('node:fs/promises')
  const raw = await readFile(`/proc/${pid}/cmdline`, 'utf8').catch(() => '')
  return raw.split('\0').filter(Boolean).join(' ')
}

/**
 * Polls `predicate` until it is true or `timeout` elapses.
 *
 * THE SLEEP IS LOAD-BEARING. A `while (!ok) {}` waiter pins a core, which does
 * not merely waste it — it starves the dev server and the Convex backend this
 * is waiting ON, so the wait it is performing gets longer the longer it waits.
 */
async function until(predicate, timeout, description) {
  const deadline = Date.now() + timeout
  for (;;) {
    if (await predicate()) return
    if (Date.now() > deadline) throw new Error(`timed out after ${timeout}ms waiting for ${description}`)
    await sleep(250)
  }
}

/**
 * Loads e2e/sign-in.ts, bundled.
 *
 * WHY A BUNDLE RATHER THAN AN IMPORT. Node strips types from a .ts file, but it
 * does not resolve TypeScript's extensionless specifiers — and sign-in.ts opens
 * with `import { api } from '../convex/_generated/api'`, which is exactly that.
 * esbuild resolves it the way tsc and vite do. Same mechanism, same reason, as
 * build-splash-screens.mjs's `loadMatrix`, which reaches src/lib/splash-screens.ts.
 *
 * `packages: 'external'` so @playwright/test and convex resolve from
 * node_modules at run time: bundling a second copy of Playwright would give
 * this file a different `expect` from the one driving the browser.
 *
 * AND THAT IS WHY THE BUNDLE IS WRITTEN INSIDE node_modules RATHER THAN IN
 * /tmp, which is where build-splash-screens.mjs puts its own. That one inlines
 * everything it needs; this one deliberately does not, so the emitted file has
 * to sit somewhere whose parent chain contains this project's node_modules or
 * Node cannot resolve `@playwright/test` from it at import time. It does not
 * work from /tmp, which is how this was found.
 */
async function loadSignIn() {
  const esbuild = await import('esbuild')
  const dir = await mkdtemp(path.join(ROOT, 'node_modules', '.wt-shots-'))
  const outfile = path.join(dir, 'sign-in.mjs')
  await esbuild.build({
    entryPoints: [path.join(ROOT, 'e2e', 'sign-in.ts')],
    outfile,
    bundle: true,
    format: 'esm',
    platform: 'node',
    packages: 'external',
    logLevel: 'warning',
  })
  const mod = await import(outfile)
  await rm(dir, { recursive: true, force: true })
  return mod.signIn
}

/**
 * Opens the app bar's one menu, and does not return until it is open.
 *
 * THE HEADER SERVER-RENDERS, so the trigger exists in the document before React
 * has attached a handler to it and a click can land on a dead button —
 * e2e/app-menu.ts's whole reason for existing. Guarded on `data-state` rather
 * than clicked twice, because a Radix menu TOGGLES and a second click on an
 * open one closes it.
 *
 * ON `until` RATHER THAN `expect(...).toPass`, AND THAT IS WHY IT IS A FUNCTION
 * NOW. It was inline in renameThrough, which is handed `expect` by main(); a
 * shot's `prepare` is handed only the page, and threading `expect` through the
 * table so one entry could poll would be a worse trade than the four lines
 * here. `until` already sleeps between attempts for the reason its own comment
 * gives.
 */
async function openMainMenu(page) {
  const trigger = page.getByRole('button', { name: 'Main menu' })
  await trigger.waitFor({ state: 'visible', timeout: READY_TIMEOUT })
  await until(
    async () => {
      if ((await trigger.getAttribute('data-state').catch(() => null)) !== 'open') {
        // Swallowed: a click that races hydration is exactly the case this
        // loop exists for, and the next pass retries it.
        await trigger.click({ timeout: 2_000 }).catch(() => {})
      }
      return page.getByRole('menu').isVisible().catch(() => false)
    },
    15_000,
    'the main menu to open',
  )
}

/**
 * Gives an account a real-looking name through Settings -> Profile.
 *
 * See the header: this exists only because `ensureSharedTeamFor` names its two
 * players 'PlayerA E2E' and 'PlayerB E2E', and those names are ON the
 * scoreboard, in the chat bubbles and in the insights head-to-head. Driving the
 * product's own form is the one way to change them without editing a seed this
 * task may not touch.
 *
 * THE DIALOG IS MODAL, so it is closed before returning: Radix puts an overlay
 * over the page and `pointer-events: none` on the body while it is open, and
 * the next thing this script does is click things on the page behind it.
 */
async function renameThrough(page, expect, { firstName, lastName }) {
  await openMainMenu(page)

  await page.getByRole('menuitem', { name: 'Settings' }).click()
  const dialog = page.getByRole('dialog')
  await expect(dialog).toBeVisible({ timeout: 10_000 })

  await dialog.getByLabel('First name').fill(firstName)
  await dialog.getByLabel('Last name').fill(lastName)
  await dialog.getByRole('button', { name: 'Save name' }).click()

  // THE TOAST, NOT ANYTHING ON THE PAGE BEHIND THE DIALOG. profile-tab.tsx
  // raises 'Name updated' only after `updateName.mutateAsync` resolves, so it
  // is the write landing rather than the click dispatching — and while the
  // modal is open Radix marks the rest of the document aria-hidden, so a
  // locator aimed at the header finds nothing at all. (It found nothing here
  // first, which is how this comment came to exist.)
  await expect(page.getByText('Name updated')).toBeVisible({ timeout: 15_000 })
  await page.keyboard.press('Escape')
  await expect(dialog).toHaveCount(0, { timeout: 10_000 })
}

/** Posts one line as whoever owns `page`, and does not return until it is stored. */
async function say(page, expect, teamId, body) {
  if (!page.url().includes(`/chat?team=${teamId}`)) {
    await page.goto(`${BASE}/chat?team=${teamId}`)
  }
  const composer = page.getByTestId('chat-composer')
  await expect(composer).toBeVisible({ timeout: READY_TIMEOUT })
  await composer.fill(body)
  await page.getByRole('button', { name: 'Send' }).click()
  // Scoped to the list: the composer is cleared ONLY on success, so an
  // unscoped match would find the still-typed draft of a send that failed.
  await expect(page.getByTestId('chat-messages').getByText(body)).toBeVisible({
    timeout: READY_TIMEOUT,
  })
}

/**
 * The puzzle day `offset` days from now, in THIS MACHINE'S ZONE.
 *
 * NOT `new Date().toISOString().slice(0, 10)`, WHICH IS A DIFFERENT DAY FOR A
 * THIRD OF EVERY DAY. A puzzle day is a local-calendar fact — convex/lib/puzzleDay.ts's
 * toPuzzleDay reads local components, and so does the browser this drives — so
 * an evening run west of Greenwich would otherwise seed TOMORROW and the shots
 * would show an empty board on a day that has not happened. Caught at 22:26
 * CDT, where UTC had already rolled over.
 *
 * The local components are reassembled through Date.UTC purely so the
 * arithmetic (and the month/year carry) is done somewhere with no DST in it.
 */
function localDay(offset) {
  const now = new Date()
  return new Date(Date.UTC(now.getFullYear(), now.getMonth(), now.getDate() + offset))
    .toISOString()
    .slice(0, 10)
}

/**
 * How many guesses `email`'s player took on `day` — stable across runs, varied
 * across days, and shaped like a real player's record rather than a uniform
 * one.
 *
 * A HASH RATHER THAN A CYCLE, and the difference is visible in the product. A
 * repeating array of attempt counts gives every month an identical mean, which
 * is precisely the flat seven-bar trend chart this exists to fix; a hash of the
 * date does not line up with a calendar month and so the monthly means differ.
 *
 * The buckets are a plausible distribution for somebody who solves every board:
 * 6% in two, 40% in three, 34% in four, 14% in five, 6% in six. NEVER one and
 * never a failure — seedTeamDayFor builds its guess list as CRANE, filler, then
 * the answer, so an `attempts` of 1 would produce a single wrong guess marked as
 * a solve, and a loss is not expressible through it at all.
 */
function attemptsOn(day, salt) {
  let hash = salt >>> 0
  for (let i = 0; i < day.length; i++) hash = (Math.imul(hash, 31) + day.charCodeAt(i)) >>> 0
  const roll = hash % 100
  if (roll < 6) return 2
  if (roll < 46) return 3
  if (roll < 80) return 4
  if (roll < 94) return 5
  return 6
}

async function main() {
  if (!process.env.VITE_CONVEX_URL) {
    throw new Error('VITE_CONVEX_URL is not set — is .env.local present, and a backend running?')
  }

  const { ConvexHttpClient } = await import('convex/browser')
  const { api } = await import('../convex/_generated/api.js')
  const { chromium, expect } = await import('@playwright/test')
  const signIn = await loadSignIn()

  /**
   * A FRESH PAIR OF ADDRESSES EVERY RUN, rather than the one fixed address the
   * plan's sketch used. The seeds are idempotent, but chat is not seeded — it
   * is POSTED — so a fixed account accumulates every previous run's
   * conversation above this one's, and the shot slowly fills with duplicates of
   * itself. A stamped pair is a clean stage each time, and is what every spec
   * in e2e/ does for the neighbouring reason.
   */
  const stamp = `${Date.now()}-${Math.floor(Math.random() * 1e6)}`
  const viewerEmail = `e2e+shots-${stamp}a@wordleteams.com`
  const teammateEmail = `e2e+shots-${stamp}b@wordleteams.com`

  /**
   * THE MONTH ENDS YESTERDAY, AND BOTH HALVES OF THAT ARE DELIBERATE.
   *
   * Through yesterday, so the scoreboard is a DENSE month rather than a row of
   * empty cells with a few scores at the left — a marketing shot of a half-used
   * product is worse than no shot.
   *
   * Not through today, because the board-entry shot needs today to be UNENTERED:
   * pick-default-day.ts opens the form on the first day the player has no board
   * for, and a form that opens on the 3rd of last month is not the picture.
   */
  const today = localDay(0)
  const lastDay = localDay(-1)

  console.log(`[build-marketing-shots] seeding ${viewerEmail} and a teammate, boards through ${lastDay}`)
  const convex = new ConvexHttpClient(process.env.VITE_CONVEX_URL)
  const teamId = await convex.mutation(api.e2eSeed.ensureSharedTeamFor, {
    emailA: viewerEmail,
    emailB: teammateEmail,
    name: TEAM_NAME,
  })
  // pro: true on both, so the paid surfaces actually render rather than showing
  // the paywall — /insights is a shot of Layers 2 and 3, which a free account
  // never sees.
  /**
   * 200 BOARDS, AND THE FIGURE IS DRIVEN BY THE TREND CHART RATHER THAN BY
   * REALISM. TrendPanel draws ONE BAR PER MONTH (up to TREND_MONTHS = 12), so a
   * month or two of history renders a chart with two bars in it — technically
   * correct, and a poor advertisement for a chart. 200 consecutive boards is
   * about seven months, which fills it. It is also a plausible history for
   * somebody who has played daily since spring, which is who these images are
   * meant to be of.
   */
  for (const email of [viewerEmail, teammateEmail]) {
    await convex.mutation(api.e2eSeed.seedInsightsFor, { email, boards: 200, lastDay, pro: true })
  }
  /**
   * AND THEN MOST OF THOSE BOARDS ARE RESCORED, WHICH IS THE LONGEST STEP HERE
   * AND THE ONE WITHOUT WHICH /insights IS NOT WORTH PHOTOGRAPHING.
   *
   * seedInsightsFor writes ONE OF TWO BOARDS, alternating on a fixed cycle: an
   * ORATE opener solved in two on every third day, a CRANE opener solved in
   * three on the rest. It is exactly right for the specs it was built for and
   * it makes an analytics page that is a picture of nothing — MEASURED, on the
   * first full run of this script:
   *
   *   - the attempt distribution had two bars in it, 2 and 3, and five empty rows
   *   - every month in the seven-month trend had a mean of 2.7, so the chart was
   *     seven bars of exactly equal height
   *   - both players had the SAME score on all 200 days, so the team panel's
   *     head-to-head read "1 vs 0, 17 ties over 18 shared days"
   *
   * seedTeamDayFor can patch one day at a time, so this rescores the CRANE days
   * — leaving the ORATE ones at two guesses, which is what keeps the openers
   * panel's comparison real rather than making every board in the corpus share
   * one opener. `i % 3 !== 0` mirrors seedInsightsFor's own cycle, counting back
   * from `lastDay` exactly as it does.
   *
   * DETERMINISTIC, NOT RANDOM (`attemptsOn`), so re-running this script produces
   * the same images rather than a fresh set of numbers to re-approve. The two
   * players are salted differently, which is the whole of the head-to-head.
   *
   * ABOUT 270 MUTATIONS, measured at ~19 ms each against a local backend. Each
   * one also rolls the month up, which is the OTHER thing this loop is for:
   * seedInsightsFor writes dailyScores and nothing else, so without a
   * seedTeamDayFor somewhere the team aggregate Layer 3 reads stays empty and
   * TeamSection renders `null` — a shot of a missing panel that still exits 0.
   */
  console.log('[build-marketing-shots] rescoring the seeded boards so the charts have shape')
  for (let i = 0; i < 200; i++) {
    if (i % 3 === 0) continue
    const day = localDay(-1 - i)
    await convex.mutation(api.e2eSeed.seedTeamDayFor, {
      email: viewerEmail,
      puzzleDay: day,
      attempts: attemptsOn(day, 1),
    })
    await convex.mutation(api.e2eSeed.seedTeamDayFor, {
      email: teammateEmail,
      puzzleDay: day,
      attempts: attemptsOn(day, 2),
    })
  }

  /**
   * AND BOTH PLAYERS HAVE TODAY, which the board-entry shot then makes false
   * again for the viewer — see the note on ordering at the top of SHOTS. The
   * teammate's board is what the dashboard's Team Boards panel needs a second
   * column for, and the viewer's is entered through the product itself.
   */
  await convex.mutation(api.e2eSeed.seedTeamDayFor, {
    email: teammateEmail,
    puzzleDay: today,
    attempts: 4,
  })

  const server = await startDevServer()
  let browser = null
  const produced = []

  try {
    browser = await chromium.launch()
    const context = await browser.newContext({
      viewport: VIEWPORT,
      deviceScaleFactor: 1,
      locale: 'en-US',
      // A capture taken mid-transition is a blurry capture. This is also a real
      // user setting rather than a test hook.
      reducedMotion: 'reduce',
      baseURL: BASE,
    })
    const page = await context.newPage()
    await signIn(page, viewerEmail)
    await renameThrough(page, expect, VIEWER)

    const mateContext = await browser.newContext({ viewport: VIEWPORT, baseURL: BASE })
    const mate = await mateContext.newPage()
    await signIn(mate, teammateEmail)
    await renameThrough(mate, expect, TEAMMATE)

    console.log('[build-marketing-shots] holding a conversation')
    for (const line of CONVERSATION) {
      await say(line.from === 'viewer' ? page : mate, expect, teamId, line.body)
    }
    await mateContext.close()

    await mkdir(OUT_DIR, { recursive: true })
    for (const shot of SHOTS) {
      for (const colorScheme of SCHEMES) {
        // BEFORE the navigation, not after: __root.tsx resolves the theme in an
        // inline script that reads matchMedia during document load, so a scheme
        // switched afterwards is a scheme the page never saw.
        await page.emulateMedia({ colorScheme })
        await page.goto(`${BASE}${shot.path({ teamId })}`)
        if (shot.prepare) await shot.prepare(page)

        const name = `${shot.name}-${colorScheme}.png`
        try {
          await page.waitForFunction(shot.ready, shot.readyArg?.(), {
            timeout: READY_TIMEOUT,
            polling: 250,
          })
        } catch {
          // The whole reason this script exists rather than a hand-capture:
          // NOTHING is written for a shot whose content never arrived, so a
          // skeleton cannot reach public/marketing/ and be committed.
          //
          // THE testid INVENTORY IS ON THE MESSAGE BECAUSE "it timed out" NAMES
          // NO CAUSE. Every predicate above is a conjunction of several
          // markers, and which of them is missing is the difference between a
          // paywall, a still-loading benchmark and a panel that rendered `null`
          // because its query has not settled. Without this the only way to
          // find out is to re-run the whole thing with a debugger attached.
          const seen = await page
            .evaluate(() => [
              ...new Set([...document.querySelectorAll('[data-testid]')].map((el) => el.dataset.testid)),
            ])
            .catch(() => [])
          throw new Error(
            `${name}: gave up waiting for ${shot.describe}. The page is at ${page.url()} — ` +
              `a shot taken now would be a skeleton, an empty state or a login page.\n` +
              `  testids present: ${seen.length > 0 ? seen.join(', ') : '(none)'}`,
          )
        }

        // AFTER the wait, never before it: the element to scroll to does not
        // exist until the data that renders it has arrived, and a scroll issued
        // against a page that is still growing lands somewhere else by the time
        // the shutter opens.
        if (shot.focus) {
          await page.evaluate((selector) => {
            const element = document.querySelector(selector)
            if (!element) return
            /*
              MINUS THE APP BAR, WHICH IS STICKY AND WOULD OTHERWISE SIT ON TOP
              OF WHAT WAS JUST SCROLLED TO. A flat margin put the card's title
              half under the header — visible in the first insights shot this
              produced. The bar's own height is the right number and it is
              measurable, so it is measured rather than guessed at.
            */
            const bar = document.querySelector('header')?.getBoundingClientRect().height ?? 0
            window.scrollTo({ top: element.getBoundingClientRect().top + window.scrollY - bar - 16 })
          }, shot.focus)
          // One frame, so the scroll has actually been painted. Not a sleep on
          // a guess: requestAnimationFrame resolves when the compositor has.
          await page.evaluate(() => new Promise((resolve) => requestAnimationFrame(() => resolve())))
        }

        const file = path.join(OUT_DIR, name)
        if (shot.clip) {
          // `locator.screenshot()` resolves the selector, scrolls it into view
          // and frames its own box — so there is no `fullPage` to pass, and a
          // selector that matches nothing (or two things) throws here naming
          // the shot rather than writing a picture of the wrong thing.
          await page.locator(shot.clip).screenshot({ path: file })
        } else {
          await page.screenshot({ path: file, fullPage: false })
        }
        produced.push({ name, bytes: (await stat(file)).size })
        console.log(`[build-marketing-shots]   ${name}  ${(produced.at(-1).bytes / 1024).toFixed(0)} kB`)
      }

      // ONCE PER SHOT, NOT PER SCHEME: `finish` changes the WORLD (it submits a
      // board), where everything above only looks at it.
      if (shot.finish) await shot.finish(page, expect)
    }
  } finally {
    if (browser) await browser.close()
    await stopDevServer(server)
  }

  const expected = SHOTS.flatMap((shot) => SCHEMES.map((scheme) => `${shot.name}-${scheme}.png`))
  const claimed = new Set(expected)
  const strays = existsSync(OUT_DIR)
    ? (await readdir(OUT_DIR)).filter((entry) => !claimed.has(entry))
    : []

  const problems = assertMarketingShots({ expected, produced, strays, minBytes: 5_000 })
  if (problems.length > 0) {
    console.error('[build-marketing-shots] MARKETING SHOTS FAILED:')
    for (const problem of problems) console.error(`[build-marketing-shots]   - ${problem}`)
    process.exitCode = 1
    return
  }

  const clipped = SHOTS.filter((shot) => shot.clip).map((shot) => shot.name)
  console.log(
    `[build-marketing-shots] wrote ${produced.length} shots to public/marketing/, light and dark: ` +
      `${SHOTS.length - clipped.length} full frames at ${VIEWPORT.width}x${VIEWPORT.height}, ` +
      // Named rather than counted, because the two kinds of file are read
      // differently downstream: a full frame is cropped by its caller's CSS,
      // a clipped one is drawn whole.
      `and ${clipped.length} clipped to an element (${clipped.join(', ')}).`,
  )
}

// Only when run as a program: importing this module (to exercise
// assertMarketingShots) must not start a browser.
if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch((error) => {
    console.error('[build-marketing-shots] MARKETING SHOTS FAILED:')
    console.error(error instanceof Error ? (error.stack ?? error.message) : String(error))
    process.exitCode = 1
  })
}
