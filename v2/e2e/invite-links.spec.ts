import { expect, test } from '@playwright/test'
import { ConvexHttpClient } from 'convex/browser'
import { api } from '../convex/_generated/api'
import { FREE_TEAM_LIMIT } from '../convex/lib/teamLimits.ts'
import { signIn } from './sign-in'
import { completeProfile } from './complete-profile'
import { openTeamSettings } from './team-settings'
import type { Browser, BrowserContext, Locator, Page } from '@playwright/test'

/**
 * A REAL TOKEN JOINING A REAL TEAM — the one claim nothing else in this repo
 * makes, at any layer.
 *
 * WHAT WAS ALREADY COVERED, AND WHY IT IS NOT THIS. `convex/inviteLinks.test.ts`
 * drives createLinkFor/revokeLinkFor/consumeLinkFor directly under convex-test,
 * so it proves the roster patch, the idempotence and the cap in isolation —
 * with no browser, no route, no sign-in and no serialisation of the token
 * through a URL. `e2e/join-link.spec.ts` drives the three ARRIVAL states of
 * `/join/$token` in a browser, but with a SYNTHETIC token, and it says so in
 * its own header: the deployment answers every such call with a refusal, so its
 * toast assertions prove the mutation was REACHED, not that anybody joined
 * anything. Put together, the two halves never touch: no test walks
 * mint -> share -> follow -> sign in -> joined, which is the only sequence a
 * real person ever performs.
 *
 * THAT GAP HAD TEETH. An earlier draft of this feature's e2e coverage asserted
 * a refusal toast against a `consumeLink` that did not exist on the deployment
 * under test — every call threw the same TypeError, the same toast appeared,
 * and the assertion passed while proving nothing. An assertion satisfied by
 * something other than the guard it names is worth less than no assertion,
 * because it also stops anyone writing the real one. So every positive claim
 * below is checked against SERVER-RESOLVED DATA (the roster the other party's
 * page renders from `getMyTeams`) and not only against a toast.
 *
 * THE BACKEND UNDER TEST MUST CARRY inviteLinks.*. The local anonymous
 * deployment predates these functions and answers `Could not find public
 * function for 'inviteLinks:createLink'` until they are pushed:
 *
 *     CONVEX_DEPLOY_KEY= CONVEX_URL= mise exec node@22.23.2 -- pnpm exec convex dev
 *
 * The blank-variable prefix is load-bearing — `CONVEX_DEPLOY_KEY` sits
 * uncommented in `.env.local`, so a bare `convex dev` pushes to the live beta
 * deployment instead. If this file fails at `shareLink` with "Could not create
 * an invite link", that push is what is missing.
 *
 * PLAYWRIGHT IS NOT A CI GATE (`wt-ksh.8.49`) — deploy-v2.yml runs lint,
 * typecheck, `vitest run` and build, and none of them reaches any of this. This
 * is a thing somebody runs.
 */

/** The seeded team's name, and its seeded owner's rendered full name. */
const SEEDED_TEAM = 'E2E Team'
const SEEDED_OWNER = 'E2E Tester'

/**
 * A literal, escaped for use as a RegExp — the same helper `invites.spec.ts`
 * carries, for the same reason, and it must not be "simplified" into a plain
 * string. Playwright matches a string `hasText` CASE-INSENSITIVELY and a RegExp
 * as written, and two of the assertions below distinguish copy that differs
 * only in wording, not in case. Kept here rather than shared because each spec
 * in this directory owns its own locator helpers (see the note in
 * `teams.spec.ts`).
 */
const re = (literal: string): RegExp => new RegExp(literal.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'))

/** The Current Team card, by the landmark `current-team-card.tsx` gives it. */
const teamCard = (page: Page): Locator => page.getByRole('region', { name: 'Current Team' })

/** A sonner toast by its copy — substring, and case-SENSITIVE. See `re`. */
const toastWith = (page: Page, text: string): Locator =>
  page.locator('[data-sonner-toast]').filter({ hasText: re(text) })

/**
 * 15s, not the 5s default, and `invites.spec.ts` and `billing.spec.ts` both
 * already use this figure. A toast is TRANSIENT — sonner dismisses it after
 * about four seconds — so an assertion on one is a race between the mutation's
 * round trip and the toast's own lifetime, and the default loses that race
 * under load. It papers over nothing here: every toast assertion below is
 * followed by an assertion on the SERVER outcome.
 */
const TOAST_TIMEOUT = { timeout: 15_000 }

/**
 * A push to a page that has been idle through somebody else's OTP sign-in.
 * 20s for the reason `invites.spec.ts` gives at its own reciprocal assertion: a
 * Convex client that has had to reconnect comes back on a backoff.
 */
const PUSH_TIMEOUT = { timeout: 20_000 }

/**
 * Signs a page in as a brand-new account that already OWNS a team.
 *
 * Fourth copy of this shape in this directory — `board-entry.spec.ts:19`,
 * `teams.spec.ts:28` and `invites.spec.ts:53` each carry their own, and the
 * comment on the last of those records the decision that each spec owns its
 * seeding rather than reaching across files for four lines. Being the team's
 * `owner` is what unlocks the Invite button, and therefore the share control
 * this file mints from.
 */
async function signInWithOwnTeam(page: Page, email: string): Promise<void> {
  const convex = new ConvexHttpClient(process.env.VITE_CONVEX_URL!)
  await convex.mutation(api.e2eSeed.ensureTeamFor, { email })
  await signIn(page, email)
}

/**
 * A browser context that will take `invite-player-dialog.tsx`'s CLIPBOARD
 * branch, deterministically, whatever host the suite runs on.
 *
 * `shareLink` in that component tries `navigator.share` FIRST and falls back to
 * `navigator.clipboard` — deliberately, because the native share sheet is the
 * whole reason a link beats typing an address on a phone. Chromium implements
 * Web Share on Android, Windows and ChromeOS and NOT on Linux, so which branch
 * this spec exercises would otherwise be a property of whoever ran it: green on
 * this workstation, and hanging on an unclosable OS share sheet on a Mac. The
 * init script pins it, in the same spirit as `playwright.config.ts` pinning the
 * locale — that one is load-bearing for the same class of reason.
 *
 * IT IS ALSO THE ONLY BRANCH THAT CAN YIELD THE URL. `navigator.share` consumes
 * it into a sheet no test can read; the clipboard hands it back, which is what
 * makes "mint -> share -> follow" a single unbroken chain rather than a test
 * that mints one token and then asserts against a token it built itself.
 *
 * `clipboard-read` is granted alongside `clipboard-write` because reading it
 * back is a separate permission, and without it `readText()` rejects with a
 * NotAllowedError that surfaces as an empty URL rather than as a permissions
 * problem.
 */
async function shareContext(browser: Browser): Promise<BrowserContext> {
  const context = await browser.newContext({ permissions: ['clipboard-read', 'clipboard-write'] })
  await context.addInitScript(() => {
    // Defined on the instance, not deleted from Navigator.prototype: the
    // component's test is a plain `if (navigator.share)`, and an own property
    // of `undefined` shadows whatever the prototype has without depending on
    // the prototype property being configurable.
    Object.defineProperty(navigator, 'share', { value: undefined, configurable: true })
  })
  return context
}

/**
 * Mints a link through the owner's own UI and returns the URL that was shared.
 *
 * THROUGH THE UI ON PURPOSE, rather than calling `api.inviteLinks.createLink`
 * from the test. That mutation calls `requirePlayer`, so an unauthenticated
 * `ConvexHttpClient` cannot reach it at all — but the deeper reason is that the
 * URL is assembled in the browser (`${window.location.origin}/join/${token}`,
 * `invite-player-dialog.tsx`), so a token fetched over HTTP and pasted into a
 * template by the test would prove the mutation and skip the half of the chain
 * that actually hands a person something to click.
 *
 * Returns the string that reached the clipboard, unparsed, so the caller can
 * assert its SHAPE — a 32-hex-character token under `/join/` — and so a
 * template that silently produced `undefined` cannot pass as a URL.
 */
async function shareLink(page: Page): Promise<string> {
  await openTeamSettings(page)
  await teamCard(page).getByRole('button', { name: 'Invite player' }).click()
  const dialog = page.getByRole('dialog')
  await expect(dialog).toBeVisible()

  await dialog.getByRole('button', { name: 'Share a link' }).click()

  // The lasting confirmation, not the toast: `copied` is the only state the
  // clipboard path leaves behind, and it is set ONLY after writeText resolved.
  // Asserting it before reading the clipboard is what stops the read below
  // racing the write.
  await expect(dialog.getByText('Link copied to your clipboard.')).toBeVisible(TOAST_TIMEOUT)

  const url = await page.evaluate(() => navigator.clipboard.readText())

  // THE DIALOG IS CLOSED BEFORE RETURNING, AND THAT IS NOT TIDINESS. Unlike the
  // email path this one has no success branch that closes it — `shareLink` in
  // the component deliberately leaves the dialog up, because "Link copied" is a
  // state the sharer may want to read and act on twice. A Radix Dialog is
  // MODAL: while it is open it marks the rest of the page `aria-hidden`, so
  // every role-based locator on the page behind it matches nothing. MEASURED —
  // the owner-side witness in the first test below failed on exactly this,
  // reporting `getByRole('region', { name: 'Current Team' })` as "element(s)
  // not found" on a card that was on screen the whole time. `team-settings.ts`
  // records the same trap from the era when team admin was itself a dialog.
  await page.keyboard.press('Escape')
  await expect(dialog).toHaveCount(0)

  return url
}

/**
 * The same token with its first hex digit changed — so, a token no row matches.
 *
 * WHY NOT A HAND-WRITTEN CONSTANT LIKE `deadbeef...`. Because the point of the
 * dead-link test is that a LIVE token and a DEAD one differ in exactly one
 * character and nothing else: same length, same alphabet, same team behind it,
 * same owner, same browser, same sequence of hops. Anything that survives the
 * live path and fails the dead one is then attributable to the token's validity
 * and to nothing about how the two were constructed.
 *
 * Deterministic rather than random, and guaranteed to differ from its input.
 */
const corrupt = (token: string): string => (token.startsWith('0') ? '1' : '0') + token.slice(1)

/** `/join/<token>` -> `<token>`. Asserts the shape on the way through. */
function tokenOf(inviteUrl: string): string {
  const match = /^http:\/\/localhost:3000\/join\/([0-9a-f]{32})$/.exec(inviteUrl)
  expect(match, `not an invite URL: ${inviteUrl}`).not.toBeNull()
  return match![1]
}

test('a signed-out holder joins after signing in', async ({ browser }) => {
  // TWO OTP SIGN-INS, A PROFILE COMPLETION AND A CROSS-CONTEXT REACTIVE WAIT DO
  // NOT FIT IN PLAYWRIGHT'S 30s DEFAULT — see the identical note on
  // `invites.spec.ts`'s first test. `sign-in.ts` alone polls for an OTP for up
  // to 15s, twice.
  test.setTimeout(180_000)

  // One stamp shared by both addresses so a failure's artifacts are obviously
  // from the same run; the random suffix is `sign-in.ts`'s own defence against
  // two parallel workers colliding in the same millisecond, which since Phase 4
  // would mean the second caller finding a players row already there and
  // landing on the dashboard instead of /complete-profile.
  const stamp = `${Date.now()}-${Math.floor(Math.random() * 1e6)}`
  const ownerEmail = `e2e+link-owner-${stamp}@wordleteams.com`
  // e2e+*@wordleteams.com for the HOLDER too, and it is not cosmetic:
  // `sign-in.ts` reads the OTP back through `testOtps.takeFor`, which refuses
  // any address outside that shape — so a holder at any other domain could
  // follow the link and never sign in to accept it.
  const holderEmail = `e2e+link-holder-${stamp}@wordleteams.com`

  const ownerContext = await shareContext(browser)
  // A SEPARATE CONTEXT IS WHAT MAKES THE HOLDER "SIGNED OUT", and it is
  // strictly stronger than clicking Log out in the owner's own browser would
  // be: no cookie, no sessionStorage and no service worker survives into it, so
  // nothing the holder is shown can have come from the owner's session. It is
  // also the situation being modelled — a link arrives in somebody else's chat
  // app, on somebody else's device. `invites.spec.ts` stages its two-party test
  // the same way.
  const holderContext = await browser.newContext()

  try {
    const owner = await ownerContext.newPage()
    await signInWithOwnTeam(owner, ownerEmail)

    const inviteUrl = await shareLink(owner)
    // The URL is real before anything follows it. A `${undefined}` in the
    // template, or a `createLink` that returned nothing, fails HERE — naming
    // the mint — instead of surfacing 40 seconds later as a refusal toast that
    // looks exactly like a genuinely dead link.
    expect(tokenOf(inviteUrl)).toHaveLength(32)

    const holder = await holderContext.newPage()
    await holder.goto(inviteUrl)
    // The signed-out arrival state: `/join/$token` renders (it does not 307 —
    // see `join-link.spec.ts` for why that distinction is the whole reason the
    // route has no beforeLoad) and sends the holder to sign in.
    await holder.waitForURL((url) => url.pathname === '/login', PUSH_TIMEOUT)

    await signIn(holder, holderEmail)
    // A brand-new account has no players row, so `/app`'s beforeLoad bounces it
    // to onboarding — and that redirect DROPS the search params, which is
    // exactly why the token also rides in sessionStorage.
    await expect(holder).toHaveURL('/complete-profile')
    await completeProfile(holder, { firstName: 'Link', lastName: 'Joiner' })

    await expect(toastWith(holder, 'You joined the team')).toBeVisible(TOAST_TIMEOUT)

    // THE TOAST IS NOT THE ASSERTION. Everything below is, and every line of it
    // is rendered from `getMyTeams` — the server resolving this player out of
    // some team's `playerIds`. An account that had no team at all a moment ago
    // now has one, and it is somebody else's.
    //
    // `?team=` is the first proof and the cheapest: with zero teams the
    // dashboard renders its empty state and never writes that parameter.
    await holder.waitForURL((url) => url.searchParams.has('team'), PUSH_TIMEOUT)
    await openTeamSettings(holder)
    const holderCard = teamCard(holder)
    await expect(holderCard.getByRole('heading', { name: SEEDED_TEAM })).toBeVisible()
    // Both members, so this is demonstrably the OWNER'S team and not one of the
    // holder's own: the holder never created anything, and 'E2E Tester' is the
    // seeded owner.
    await expect(holderCard.getByText(SEEDED_OWNER)).toBeVisible()
    await expect(holderCard.getByText('Link Joiner')).toBeVisible()
    // A member, not an owner: Leave rather than Invite (divergence 10). This is
    // what distinguishes "joined a team" from "was given a team".
    await expect(holderCard.getByRole('button', { name: `Leave ${SEEDED_TEAM}` })).toBeVisible()
    await expect(holderCard.getByRole('button', { name: 'Invite player' })).toHaveCount(0)

    // AND THE OTHER PARTY'S PAGE AGREES, with no reload and no interaction.
    // Nothing has touched `owner` since the mint. One roster patch inside
    // `consumeLinkFor` has to reach `getMyTeams` on a second, idle browser —
    // so this is the independent witness that the write landed in the database
    // rather than only in the holder's optimistic view.
    await expect(teamCard(owner).getByText('Link Joiner')).toBeVisible(PUSH_TIMEOUT)
  } finally {
    await ownerContext.close()
    await holderContext.close()
  }
})

test('a dead link reports itself and changes nothing', async ({ browser }) => {
  test.setTimeout(180_000)

  const stamp = `${Date.now()}-${Math.floor(Math.random() * 1e6)}`
  const ownerEmail = `e2e+dead-owner-${stamp}@wordleteams.com`
  const holderEmail = `e2e+dead-holder-${stamp}@wordleteams.com`

  const ownerContext = await shareContext(browser)
  const holderContext = await browser.newContext()

  try {
    const owner = await ownerContext.newPage()
    await signInWithOwnTeam(owner, ownerEmail)

    // A REAL LINK IS MINTED AND THEN DELIBERATELY NOT USED. The token followed
    // below is this one with a single hex digit changed, so the live case and
    // the dead case differ in exactly one character — see `corrupt`. The team
    // whose roster is asserted unchanged at the end is therefore a team that
    // genuinely has a live link out in the world.
    const inviteUrl = await shareLink(owner)
    const deadUrl = `http://localhost:3000/join/${corrupt(tokenOf(inviteUrl))}`
    expect(deadUrl).not.toBe(inviteUrl)

    const holder = await holderContext.newPage()
    await holder.goto(deadUrl)
    await holder.waitForURL((url) => url.pathname === '/login', PUSH_TIMEOUT)

    await signIn(holder, holderEmail)
    await expect(holder).toHaveURL('/complete-profile')
    await completeProfile(holder, { firstName: 'Dead', lastName: 'Holder' })

    // THE TYPED COPY, NOT THE UNTYPED FALLBACK, AND THE DIFFERENCE IS THE WHOLE
    // POINT OF ASSERTING ON IT. `app.tsx` passes 'That invite link is no longer
    // valid' to `mutationErrorMessage` as the message for an error it cannot
    // classify — a network failure, a missing function, a TypeError. Only a
    // ConvexError carrying `INVITE_LINK_INVALID` produces the sentence below.
    // So this string, and only this string, proves the request reached
    // `consumeLinkFor`, was understood, and was REFUSED BY THE GUARD rather
    // than by anything else on the way.
    await expect(
      toastWith(holder, 'That invite link no longer works. Ask whoever shared it for a new one.'),
    ).toBeVisible(TOAST_TIMEOUT)

    // NOBODY JOINED ANYTHING. The holder is still team-less: the dashboard's
    // zero-teams branch, whose onboarding card offers 'Create a team' and which
    // has no Team settings link to press at all, and no `?team=` in the URL
    // because that branch never writes one.
    await expect(holder.getByText('Create a team')).toBeVisible()
    await expect(holder.getByRole('link', { name: 'Team settings' })).toHaveCount(0)
    expect(new URL(holder.url()).searchParams.has('team')).toBe(false)

    // AND THE ROSTER IS UNCHANGED — checked after a RELOAD, deliberately.
    // A refusal is a non-event on the owner's page, so a `toHaveCount(1)`
    // against a live subscription would also be satisfied by a push that simply
    // had not arrived yet: the assertion would pass for the wrong reason on
    // exactly the run where a mutant had added the holder. A reload re-reads
    // `getMyTeams` from the server, so what is asserted is the stored roster
    // and not the age of a websocket message.
    await owner.reload()
    await openTeamSettings(owner)
    const ownerCard = teamCard(owner)
    // One <li>: the owner alone. The pending-invites list is gated on a
    // non-empty array and nothing here invites anybody, so the members list is
    // the only one on this card.
    await expect(ownerCard.getByRole('listitem')).toHaveCount(1)
    await expect(ownerCard.getByText(SEEDED_OWNER)).toBeVisible()
    await expect(ownerCard.getByText('Dead Holder')).toHaveCount(0)
  } finally {
    await ownerContext.close()
    await holderContext.close()
  }
})

test('a joiner already at the free-tier cap is refused, and joins nothing', async ({ browser }) => {
  test.setTimeout(180_000)

  const stamp = `${Date.now()}-${Math.floor(Math.random() * 1e6)}`
  const ownerEmail = `e2e+cap-owner-${stamp}@wordleteams.com`
  const joinerEmail = `e2e+cap-joiner-${stamp}@wordleteams.com`

  const convex = new ConvexHttpClient(process.env.VITE_CONVEX_URL!)

  // EXACTLY `FREE_TEAM_LIMIT` TEAMS, DERIVED FROM THE CONSTANT AND NEVER FROM A
  // LITERAL `2`. `teamLimits.ts` is explicit that a test written against a
  // hardcoded number keeps passing straight through a change to the cap, which
  // is the failure mode that matters here: raise the constant and a literal
  // `2` would leave this test seeding a joiner who is NOT at the cap, so
  // `consumeLinkFor` would let them in and the refusal below would fail for a
  // reason that looks like a broken guard.
  //
  // `ensureSharedTeamFor` rather than `ensureTeamFor` because the latter keys
  // its team on the single address and is therefore idempotent BY DESIGN — it
  // can only ever produce one team for this account. The pair key gives a
  // distinct team per filler address, so this scales with the constant.
  for (let i = 0; i < FREE_TEAM_LIMIT; i++) {
    await convex.mutation(api.e2eSeed.ensureSharedTeamFor, {
      emailA: joinerEmail,
      emailB: `e2e+cap-filler-${i}-${stamp}@wordleteams.com`,
    })
  }

  const ownerContext = await shareContext(browser)
  const joinerContext = await browser.newContext()

  try {
    const owner = await ownerContext.newPage()
    await signInWithOwnTeam(owner, ownerEmail)
    const inviteUrl = await shareLink(owner)

    const joiner = await joinerContext.newPage()
    // Already profile-complete — `ensureSharedTeamFor` wrote the players row —
    // so this one signs straight through to the dashboard and the token is
    // spent from the `?join=` carrier rather than from sessionStorage. That is
    // the other half of `app.tsx`'s two-carrier arrangement, and the live test
    // above exercises the sessionStorage half.
    await signIn(joiner, joinerEmail)
    await joiner.goto(inviteUrl)

    // THE ONE REFUSAL THAT IS NOT FOLDED INTO THE DEAD-LINK MESSAGE, because
    // the link is fine, the holder did nothing wrong, and there is an action
    // that helps. Copy asserted verbatim so a change that quietly reused the
    // dead-link sentence here — throwing away the only actionable refusal in
    // the feature — fails.
    await expect(
      toastWith(joiner, "You're on as many teams as the free plan allows. Upgrade to join another."),
    ).toBeVisible(TOAST_TIMEOUT)

    // Reloaded before the roster is read, for the reason the dead-link test
    // gives at its own reciprocal assertion.
    await owner.reload()
    await openTeamSettings(owner)
    const ownerCard = teamCard(owner)
    await expect(ownerCard.getByRole('listitem')).toHaveCount(1)
    await expect(ownerCard.getByText(SEEDED_OWNER)).toBeVisible()
    await expect(ownerCard.getByText('PlayerA')).toHaveCount(0)
  } finally {
    await ownerContext.close()
    await joinerContext.close()
  }
})
