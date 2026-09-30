import { expect, test } from '@playwright/test'
import { ConvexHttpClient } from 'convex/browser'
import { api } from '../convex/_generated/api'
import { signIn } from './sign-in'
import { addDays, toPuzzleDay } from '../convex/lib/puzzleDay.ts'
import type { Page } from '@playwright/test'

/**
 * LAYER 3 ACROSS THE PAYWALL.
 *
 * The free team fact is the most shareable thing in the product and the ONE Layer
 * 3 surface an unpaid player ever sees, so it sits exactly on the boundary the
 * four gates do not cross. Playwright blocks a deploy (wordle-teams-z6v4), so
 * what is asserted here is a gate.
 *
 * TODAY IS THE REAL TODAY, resolved in the browser's zone the same way the route
 * does. A literal date would drift out of the aggregate's current month and the
 * spec would quietly assert an empty state forever — the failure this file exists
 * to catch, arriving as a pass.
 */

const today = toPuzzleDay(new Date())

/**
 * THE CEILING FOR THE FIRST ASSERTION AFTER `goto`, AND FOR NOTHING ELSE
 * (wordle-teams-usgy).
 *
 * TeamSection renders `null` — not a skeleton, not an empty card — until the
 * team it is scoped to AND that team's aggregate have both arrived. Its three
 * guards are now separate lines (routes/insights.tsx), and only the last two are
 * waits at all:
 *
 *     if (onATeam === false) return <NoTeamCard />
 *     if (!team) return null
 *     if (!data) return null
 *
 * THE FIRST IS A STATE, NOT A WAIT, and it is unreachable for every account
 * these tests seed: `onATeam` is three-valued and is `false` only once getMyTeams
 * has come back EMPTY. The two `null`s are what this ceiling pays for.
 *
 * AND THE WAIT GREW A STEP SINCE THIS WAS WRITTEN. `team` is no longer whatever
 * getMyTeams happened to return first — it is the roster entry matching `?team=`,
 * and the route fills that parameter in from a POST-HYDRATION effect
 * (resolveInsightsSearch, then a `replace: true` navigate). So arriving on a bare
 * /insights now costs: getMyTeams, hydration, that navigate, and only then
 * teamMonth, which is `'skip'` until both a team and a month are settled. Three
 * chained steps where there were two.
 *
 * So between arriving on /insights and all of that resolving, a locator for the
 * fact or the panel matches nothing, and it is indistinguishable from the page
 * being wrong. There is no loading marker to wait on instead: `insights-loading`
 * belongs to the benchmark query, which is a different read entirely.
 *
 * Every seed above is AWAITED over HTTP before sign-in, so the data is
 * demonstrably in the database by the time the browser is pointed at the page.
 * What is being waited on here is therefore page load, auth handshake and that
 * chain — the genuinely unbounded part — which is exactly where
 * wordle-teams-h1rg says the generosity belongs.
 *
 * IT DOES NOT SOFTEN WHAT THESE TESTS CHECK. Only the "is it here at all"
 * assertion carries it; every claim about WHAT IT SAYS keeps the suite's strict
 * 5s default, so a fact that renders the wrong sentence still fails fast.
 */
const FIRST_PAINT = { timeout: 20_000 }

async function seedTeamOfTwo(page: Page, options: { mine: number; theirs?: number; pro: boolean }) {
  const stamp = `${Date.now()}-${Math.floor(Math.random() * 1e6)}`
  const mine = `e2e+${stamp}a@wordleteams.com`
  const theirs = `e2e+${stamp}b@wordleteams.com`
  const convex = new ConvexHttpClient(process.env.VITE_CONVEX_URL!)

  await convex.mutation(api.e2eSeed.ensureSharedTeamFor, { emailA: mine, emailB: theirs })
  await convex.mutation(api.e2eSeed.seedInsightsFor, {
    email: mine,
    boards: 0,
    lastDay: today,
    pro: options.pro,
  })
  await convex.mutation(api.e2eSeed.seedTeamDayFor, {
    email: mine,
    puzzleDay: today,
    attempts: options.mine,
  })
  if (options.theirs !== undefined) {
    await convex.mutation(api.e2eSeed.seedTeamDayFor, {
      email: theirs,
      puzzleDay: today,
      attempts: options.theirs,
    })
  }

  await signIn(page, mine)
  await page.goto('/insights')
  return { mine, theirs }
}

/**
 * THE TWO TEAM NAMES ARE THE ONLY THING THAT TELLS THE TWO PANELS APART IN THE
 * CONTROL, so they are constants shared by the seed and the assertions rather
 * than literals typed twice.
 *
 * DISTINCT NAMES ARE NOT COSMETIC HERE. The team dropdown's menu items and its
 * trigger's `aria-label` are both the team's name and nothing else
 * (components/insights/team-scope-controls.tsx), so two teams sharing the seed's
 * default name would give `getByRole` two matches and force a pick by index —
 * a locator that cannot say which team it landed on, in the one spec whose whole
 * subject is which team it landed on. That is why `ensureSharedTeamFor` takes an
 * optional `name`; see its comment.
 *
 * BOTH UNDER 15 CHARACTERS, which is where TeamDropdown truncates its VISIBLE
 * label. The `aria-label` these locators read carries the full name either way,
 * so this is not load-bearing — it only keeps the rendered page legible to
 * whoever is looking at a trace.
 */
const ALPHA = 'Alpha Analysts'
const BETA = 'Beta Brigade'

/**
 * One pro viewer on TWO teams, each with a teammate who played today and a
 * different result against them.
 *
 * WHY NOT seedTeamOfTwo TWICE: that helper stamps a fresh viewer per call, so
 * two calls make two viewers with one team each, which is the opposite of what
 * this needs. `ensureSharedTeamFor` keys its team on the sorted ADDRESS PAIR, so
 * calling it twice with the same viewer and two different teammates is what
 * produces two distinct teams that both contain them.
 *
 * ONE BOARD FOR THE VIEWER, READ BY BOTH TEAMS. `dailyScores` is keyed on
 * (player, puzzleDay) and carries no team, so the viewer's 3 is the same row in
 * both aggregates — which is what makes the two panels differ ONLY by the
 * teammate they compare it against, rather than by two independent piles of
 * seed data that might have differed for some other reason.
 *
 * THE RESULTS ARE OPPOSITE ON PURPOSE. Fewer attempts wins (headToHead,
 * lib/insights-team.ts), so against Alpha's 5 the viewer is 1-0 and against
 * Beta's 2 they are 0-1. A panel showing the wrong team therefore shows the
 * figures INVERTED rather than merely shifted, which no timing, cache or
 * rounding accident can produce.
 *
 * SEEDED BEFORE SIGN-IN AND AWAITED OVER HTTP, exactly as seedTeamOfTwo does and
 * for the reason FIRST_PAINT's comment gives: the data is demonstrably in the
 * database before the browser is ever pointed at the page.
 */
async function seedProOnTwoTeams(page: Page) {
  const stamp = `${Date.now()}-${Math.floor(Math.random() * 1e6)}`
  const mine = `e2e+${stamp}a@wordleteams.com`
  const alphaMate = `e2e+${stamp}b@wordleteams.com`
  const betaMate = `e2e+${stamp}c@wordleteams.com`
  const convex = new ConvexHttpClient(process.env.VITE_CONVEX_URL!)

  const alphaId = await convex.mutation(api.e2eSeed.ensureSharedTeamFor, {
    emailA: mine,
    emailB: alphaMate,
    name: ALPHA,
  })
  const betaId = await convex.mutation(api.e2eSeed.ensureSharedTeamFor, {
    emailA: mine,
    emailB: betaMate,
    name: BETA,
  })

  await convex.mutation(api.e2eSeed.seedInsightsFor, {
    email: mine,
    boards: 0,
    lastDay: today,
    pro: true,
  })
  // ORDER AMONG THESE THREE DOES NOT MATTER, THOUGH ALL THREE MUST BE AWAITED,
  // and the reason is worth stating because an incomplete aggregate would show
  // up as figures that are merely wrong rather than as an error. seedTeamDayFor
  // rolls up every team its player is on, and rollupTeamMonth RE-READS the whole
  // month from dailyScores rather than accumulating. So for each team, whichever
  // of its two members is seeded LAST rolls that team up with both boards already
  // written — which is true of every ordering of these three calls.
  await convex.mutation(api.e2eSeed.seedTeamDayFor, { email: mine, puzzleDay: today, attempts: 3 })
  await convex.mutation(api.e2eSeed.seedTeamDayFor, {
    email: alphaMate,
    puzzleDay: today,
    attempts: 5,
  })
  await convex.mutation(api.e2eSeed.seedTeamDayFor, {
    email: betaMate,
    puzzleDay: today,
    attempts: 2,
  })

  await signIn(page, mine)
  await page.goto('/insights')
  return { alphaId, betaId }
}

/**
 * The same two teams, a FREE viewer, and — the whole point — NO BOARD OF THEIR
 * OWN TODAY.
 *
 * THE VIEWER HAS PLAYED BEFORE, AND THAT IS NOT DECORATION. A player who has
 * never entered a board at all never reaches Layer 3 on this page: the route
 * answers `!data || data.boards.length === 0` with "Enter a board and we will
 * show you how it compares" and renders no panel, so TeamSection — and the card
 * this test is about — is not on the page for any reason. Measured: the first
 * version of this fixture seeded zero boards and failed here for exactly that.
 * wordle-teams-4b0m's window is "has played before, not TODAY", and the history
 * ending YESTERDAY is what puts the viewer in it.
 *
 * SEEDED BEFORE THE TEAMMATES, because seedTeamDayFor rolls each team's month up
 * from scratch and seedInsightsFor only writes rows. Doing the viewer first
 * means both rollups see their whole month; doing it after would leave the
 * viewer's history out of the aggregates until something else wrote.
 *
 * WHY THE TEAMMATES ARE SEEDED AT ALL. Both aggregates exist and both contain a
 * board for today; the only thing missing from them is the VIEWER's. That is
 * what makes this a test of `dailyTeamFact`'s 'no-board' outcome rather than of
 * an empty month, which would reach the card by a different route and would pass
 * against code that only handled the empty one.
 *
 * Otherwise identical to seedProOnTwoTeams, including why ensureSharedTeamFor is
 * called twice with the same viewer — see that helper's comment.
 */
async function seedFreeOnTwoTeamsUnplayed(page: Page) {
  const stamp = `${Date.now()}-${Math.floor(Math.random() * 1e6)}`
  const mine = `e2e+${stamp}a@wordleteams.com`
  const alphaMate = `e2e+${stamp}b@wordleteams.com`
  const betaMate = `e2e+${stamp}c@wordleteams.com`
  const convex = new ConvexHttpClient(process.env.VITE_CONVEX_URL!)

  const alphaId = await convex.mutation(api.e2eSeed.ensureSharedTeamFor, {
    emailA: mine,
    emailB: alphaMate,
    name: ALPHA,
  })
  const betaId = await convex.mutation(api.e2eSeed.ensureSharedTeamFor, {
    emailA: mine,
    emailB: betaMate,
    name: BETA,
  })

  // A history ending YESTERDAY: enough boards to get past the route's
  // "enter a board" branch, and not one of them dated today.
  await convex.mutation(api.e2eSeed.seedInsightsFor, {
    email: mine,
    boards: 3,
    lastDay: addDays(today, -1),
    pro: false,
  })
  // The teammates play TODAY; the viewer does not. No seedTeamDayFor for `mine`
  // on today's date, and its absence is the fixture.
  await convex.mutation(api.e2eSeed.seedTeamDayFor, {
    email: alphaMate,
    puzzleDay: today,
    attempts: 5,
  })
  await convex.mutation(api.e2eSeed.seedTeamDayFor, {
    email: betaMate,
    puzzleDay: today,
    attempts: 2,
  })

  await signIn(page, mine)
  await page.goto('/insights')
  return { alphaId, betaId }
}

/**
 * Pick a team from the panel's own dropdown, and return once the URL names it.
 *
 * SCOPED TO THE CARD, THOUGH THE ROLE QUERY WOULD PROBABLY RESOLVE WITHOUT IT.
 * `Team: <name>` is also team-picker.tsx's trigger label (its own comment says
 * the two are deliberately worded alike), and that picker lives on /app rather
 * than here — "probably" is not a property worth depending on when scoping it
 * costs one locator.
 *
 * IT WAITS ON THE URL, WHICH IS DELIBERATELY THE WEAKER HALF. `?team=` moves on
 * every click regardless of what the panel below then reads, so reaching this
 * line proves only that the control fired. What the page did with it is the
 * caller's assertion, and that separation is the point: a panel wired to the
 * wrong team still gets past here, and fails on the figures, where the failure
 * message names the thing that is actually wrong.
 *
 * THE CLICKS ARE THE HAZARD IN THIS FILE. playwright.config.ts leaves
 * `actionTimeout` at 0, so a click on a control that is covered or not yet drawn
 * RETRIES FOREVER and the test dies on its own 30s timeout somewhere else
 * entirely. Callers must have asserted the panel visible before the first call.
 */
async function switchTeam(
  page: Page,
  team: { name: string; id: string },
  /**
   * WHICH CARD IS HOSTING THE DROPDOWN, because there are two and they are the
   * two sides of the paywall: the pro panel (`insights-team`) and the free daily
   * fact (`insights-daily-fact`), which carries the same control in its header.
   * The default is the pro one, so the caller that predates the free case reads
   * exactly as it did.
   */
  card: 'insights-team' | 'insights-daily-fact' = 'insights-team',
) {
  await page
    .getByTestId(card)
    .getByRole('button', { name: /^Team: / })
    .click()
  // The menu is portalled out of the card, so this one is NOT scoped to it.
  await page.getByRole('menuitemradio', { name: team.name }).click()
  await page.waitForURL((url) => url.searchParams.get('team') === team.id, { timeout: 5000 })
}

/**
 * What the pro card says when it is scoped to one particular team.
 *
 * TWO FIGURES AND A MEAN, FROM TWO DIFFERENT PANELS. Head to head is the one a
 * reader looks at, but it is derived from `stats.days` and the averages from
 * `stats.members` (lib/insights-team.ts), so a card built from the wrong team's
 * aggregate is wrong in both — asserting both makes "it re-read the aggregate"
 * rather than "one component re-rendered" the only way to pass.
 *
 * THE TRIGGER LABEL IS ASSERTED LAST, AND ONLY AS A COHERENCE CHECK: the control
 * and the card it scopes must not disagree about which team is showing. It is
 * last because the figures are the criterion — a failure should name them first.
 *
 * NO ASSERTION ON A VISIBLE TITLE, AND THERE MUST NOT BE ONE. At two or more
 * teams TeamPanel hides its title (`titleVisuallyHidden={showsTeamDropdown(...)}`
 * in routes/insights.tsx) precisely so the header does not print the team's name
 * twice, leaving an `sr-only` h2 and the trigger. A `toBeVisible` on the name
 * here would fail against correct code.
 *
 * NOR ON THE TEAMMATE'S NAME, WHICH DOES NOT DISCRIMINATE. `ensureSharedTeamFor`
 * names every `emailB` player "PlayerB", so both panels name their opponent
 * PlayerB and only the numbers beneath differ. Do not add a name assertion here
 * expecting it to prove anything about which team is showing.
 */
async function expectTeamFigures(
  page: Page,
  expected: { name: string; wins: string; losses: string; teamMean: string },
) {
  const panel = page.getByTestId('insights-team')
  const figures = panel.getByTestId('insights-head-to-head').getByTestId('insights-versus-figure')

  // Two people on the team, so the versus block rather than the list — the same
  // shape, and the same reason, as the head-to-head test above.
  await expect(figures).toHaveCount(2)
  await expect(figures.nth(0)).toHaveText(expected.wins)
  await expect(figures.nth(1)).toHaveText(expected.losses)
  await expect(panel.getByTestId('insights-team-averages')).toContainText(expected.teamMean)
  await expect(panel.getByRole('button', { name: `Team: ${expected.name}` })).toBeVisible()
}

test.describe('a free member of a team', () => {
  test('sees the daily fact and the locked team card beneath it', async ({ page }) => {
    // They scored 3, their teammate 5, so they beat one of one.
    await seedTeamOfTwo(page, { mine: 3, theirs: 5, pro: false })

    const fact = page.getByTestId('insights-daily-fact-text')
    await expect(fact).toBeVisible(FIRST_PAINT)
    // NOUN AND VERB BOTH SINGULAR (wordle-teams-f441). This used to read "one
    // teammate who HAVE played today" — the component switched the noun on a
    // count of one and left the verb plural, on the single most shareable string
    // in the product.
    await expect(fact).toContainText('You beat one of one teammate who has played today')
    // THE TEASER, wordle-teams-iht.2. It replaces a "see the full month" link
    // that rendered with no handler and did nothing when clicked.
    await expect(page.getByTestId('insights-team-locked')).toBeVisible()
    await expect(page.getByTestId('insights-locked-cta')).toContainText('Unlock')
    // THE RANK ITSELF, FROM A REAL PAYLOAD — not a hand-built prop and not the
    // server test's pinned response. They beat their one teammate, so they are
    // 1st of 2.
    await expect(page.getByTestId('insights-locked-headline')).toHaveText(
      'You’re 1st of 2 this month',
    )
    // AND A REAL TEAMMATE NAME REACHING THE ROW — e2eSeed.ensureSharedTeamFor
    // names the second player 'PlayerB'.
    await expect(page.getByTestId('insights-locked-h2h')).toContainText('PlayerB')

    // And NOT the paid surface.
    await expect(page.getByTestId('insights-team')).toHaveCount(0)
  })

  /**
   * THE STATE MOST LIKELY TO LOOK BROKEN, and the one a unit test is least likely
   * to be written for: on a small team early in the day this is the common case,
   * and "you beat 0 of 0 teammates" reads as a loss and a bug at once.
   */
  test('and when nobody else has entered yet, says so rather than comparing to zero', async ({
    page,
  }) => {
    await seedTeamOfTwo(page, { mine: 3, pro: false })

    const fact = page.getByTestId('insights-daily-fact-text')
    await expect(fact).toBeVisible(FIRST_PAINT)
    // The mirror of the same bug: this phrased a count of one as a plural with a
    // numeral, "none of your 1 teammates have played yet". At one teammate the
    // sentence drops the quantifier rather than trying to inflect it.
    await expect(fact).toContainText('your teammate has not played yet')
    await expect(fact).not.toContainText('none of')
    await expect(fact).not.toContainText('beat')
    // The card is present even here — the owner's rule is that it ALWAYS shows,
    // because a player with too little engagement to be ranked is exactly who
    // needs to see what is possible.
    await expect(page.getByTestId('insights-team-locked')).toBeVisible()
    // THE ONLY PLACE IN THE SUITE WHERE THE SERVER GENUINELY PRODUCES
    // 'nobody-else' END TO END — the exact copy that distinguishes it from
    // 'not-played' is the entire reason the tag exists (see headlineFor).
    await expect(page.getByTestId('insights-locked-headline')).toContainText('only one playing')
  })
})

test.describe('a pro member of a team', () => {
  test('sees the full team surface instead of the single fact', async ({ page }) => {
    await seedTeamOfTwo(page, { mine: 3, theirs: 5, pro: true })

    await expect(page.getByTestId('insights-team')).toBeVisible(FIRST_PAINT)
    await expect(page.getByTestId('insights-head-to-head')).toBeVisible()
    await expect(page.getByTestId('insights-team-averages')).toBeVisible()
    await expect(page.getByTestId('insights-team-days')).toBeVisible()
    await expect(page.getByTestId('insights-team-consistency')).toBeVisible()

    // The free slice is a DIFFERENT component, not a cut-down panel, so it is
    // absent rather than expanded.
    await expect(page.getByTestId('insights-daily-fact')).toHaveCount(0)
  })

  test('and the head-to-head names the teammate and its shared-day denominator', async ({
    page,
  }) => {
    await seedTeamOfTwo(page, { mine: 3, theirs: 5, pro: true })

    const record = page.getByTestId('insights-head-to-head')

    /*
      THE TWO FIGURES SEPARATELY, NOT THE OLD "1-0" STRING. A two-person team
      renders the versus block rather than the list, so wins and losses are two
      elements and the dash-joined form no longer exists in the DOM — the same
      change team-panel.hook.test.ts made for the same reason.

      THIS IS NOT A WEAKENED ASSERTION. It pins an exact element count, which
      the substring never did, and it still checks both halves of what this
      test's name promises: the teammate is named, and the shared-day
      denominator is stated. A record of 1-0 over one shared day is what the
      seed produces.
    */
    await expect(record).toContainText('PlayerB', FIRST_PAINT)
    const figures = record.getByTestId('insights-versus-figure')
    await expect(figures).toHaveCount(2)
    await expect(figures.nth(0)).toHaveText('1')
    await expect(figures.nth(1)).toHaveText('0')
    await expect(record).toContainText('1 shared day')
  })
})

test.describe('a pro member of two teams', () => {
  /**
   * THE ONE ACCEPTANCE CRITERION THE FOUR GATES CANNOT SEE. `pnpm test:once`,
   * `pnpm typecheck`, `pnpm lint` and `pnpm build` never start Playwright, so
   * nothing outside this file can observe that picking a team re-scopes the
   * panel. -insights-team-scope.hook.test.ts renders the route's panel with a
   * `team` prop already chosen; the wiring under test here is the round trip
   * from a real click, through `?team=`, through resolveInsightsSearch, into a
   * fresh `teamMonth` read.
   *
   * IT IS A ROUND TRIP, NOT A SINGLE SWITCH, AND THAT IS THE WHOLE REGRESSION
   * TEST. The defect this guards against is the panel reading `teams[0]` instead
   * of the selected team — the shape it had before `?team=` existed. Under that
   * code the card is frozen on ONE of these two teams whatever the dropdown
   * says, so a spec that only ever switched once could land on the frozen team
   * and pass. Going Alpha → Beta → Alpha cannot: whichever of the two `teams[0]`
   * happens to be, the other one is asserted here as well, and the inverted
   * figures make the mismatch unambiguous. VERIFIED BY REVERTING IT — the route
   * was edited to pass `teams?.[0]` and this test failed on the Beta figures,
   * then passed again when it was restored.
   *
   * THE FIRST LEG PROVES NOTHING, AND MUST NOT BE READ AS IF IT DID. Which team
   * is selected on arrival is not this spec's to decide — routes/insights.tsx
   * falls back through `?team=`, then localStorage's remembered team (which /app
   * wrote on the way through sign-in), then the first of the roster — so a run
   * starts on Alpha or Beta depending on that chain, and NOTHING HERE PINS
   * WHICH. When it starts on Alpha the first `switchTeam` selects the team that
   * is already selected: the assertions still hold, but they hold over a card
   * that never changed.
   *
   * So this test is deterministic in WHAT IT ASSERTS and not in WHAT THE FIRST
   * LEG EXERCISES. A green first leg is not evidence that switching works —
   * THE BETA LEG AND THE RETURN ARE THE TWO THAT ARE ALWAYS REAL SWITCHES, and
   * they are what failed under the `teams[0]` revert. Do not "simplify" this by
   * dropping either of them, and do not move an assertion up here on the theory
   * that the first leg already covered it.
   *
   * IT IS KEPT ANYWAY, because the alternative is asserting whatever the chain
   * above happened to pick, which is a test whose meaning changes with
   * localStorage. Selecting Alpha explicitly makes the sequence identical either
   * way. The no-op case still navigates and still settles: Radix's MenuRadioItem
   * composes `onValueChange` into `onSelect` with NO check against the current
   * value (@radix-ui/react-menu), so an already-checked item fires like any
   * other.
   */
  test('switches team, and the panel switches its figures with it', async ({ page }) => {
    const { alphaId, betaId } = await seedProOnTwoTeams(page)

    // FIRST_PAINT'S ONE ASSERTION, and here it also protects the clicks: the
    // dropdown is inside this card, and a click dispatched before it is drawn
    // retries forever (see switchTeam).
    await expect(page.getByTestId('insights-team')).toBeVisible(FIRST_PAINT)

    // Against Alpha's teammate, who took 5 to the viewer's 3: a win, and a team
    // mean of (3 + 5) / 2. THIS LEG MAY SELECT THE TEAM THAT IS ALREADY
    // SELECTED and prove nothing on its own — see the block comment above.
    await switchTeam(page, { name: ALPHA, id: alphaId })
    await expectTeamFigures(page, { name: ALPHA, wins: '1', losses: '0', teamMean: 'team 4' })

    // Against Beta's, who took 2: the same board, now a loss, and (3 + 2) / 2.
    await switchTeam(page, { name: BETA, id: betaId })
    await expectTeamFigures(page, { name: BETA, wins: '0', losses: '1', teamMean: 'team 2.5' })

    // And back, which is the half a one-way switch cannot cover.
    await switchTeam(page, { name: ALPHA, id: alphaId })
    await expectTeamFigures(page, { name: ALPHA, wins: '1', losses: '0', teamMean: 'team 4' })
  })
})

test.describe('a free member of two teams who has not played today', () => {
  /**
   * wordle-teams-4b0m, AND A GATE THE FOUR LOCAL ONES CANNOT STAND IN FOR. The
   * card used to render nothing at all for 'no-board', and since the team
   * dropdown moved into its header that took the PICKER with it — so a free
   * player on two teams could not change which team /insights was scoped to
   * until they had played. That is the default state every morning, and on the
   * free tier nothing else on the page is team-scoped, so `?team=` and the
   * remembered team were both frozen for the whole window.
   *
   * daily-team-fact.hook.test.ts proves the component renders the empty state
   * when it is handed a control. What it cannot see is that the ROUTE hands it
   * one on this branch, that the control is reachable, and that clicking it
   * actually re-scopes the page — which is this file's subject.
   *
   * THE ASSERTIONS ARE THE TRIGGER LABEL AND THE URL, not figures, because an
   * unplayed free card has no figures by construction: every team says the same
   * sentence. `switchTeam` already waits for `?team=` to name the chosen team,
   * so reaching each assertion is itself the proof the navigation happened; the
   * label is the coherence check that the control agrees with it.
   *
   * BOTH LEGS ARE REAL SWITCHES BECAUSE NEITHER TEAM IS PINNED ON ARRIVAL — the
   * same reasoning as the pro test above, and the same remedy: go to Beta, then
   * back to Alpha, so whichever the fallback chain picked, at least one leg
   * moved.
   */
  test('still gets the card, and can still change which team it is about', async ({ page }) => {
    const { alphaId, betaId } = await seedFreeOnTwoTeamsUnplayed(page)

    const card = page.getByTestId('insights-daily-fact')
    await expect(card).toBeVisible(FIRST_PAINT)
    await expect(page.getByTestId('insights-daily-fact-text')).toHaveText(
      'Enter today’s board to see how you compare.',
    )
    // The card is present even here — the owner's rule is that it ALWAYS shows,
    // because a player with too little engagement to be ranked is exactly who
    // needs to see what is possible.
    await expect(page.getByTestId('insights-team-locked')).toBeVisible()

    await switchTeam(page, { name: BETA, id: betaId }, 'insights-daily-fact')
    await expect(card.getByRole('button', { name: `Team: ${BETA}` })).toBeVisible()

    await switchTeam(page, { name: ALPHA, id: alphaId }, 'insights-daily-fact')
    await expect(card.getByRole('button', { name: `Team: ${ALPHA}` })).toBeVisible()
  })
})
