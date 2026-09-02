import { expect, test } from '@playwright/test'
import { ConvexHttpClient } from 'convex/browser'
import { api } from '../convex/_generated/api'
import { signIn } from './sign-in'
import { completeProfile } from './complete-profile'
import type { Locator, Page } from '@playwright/test'

/**
 * The invite surface, end to end (wt-ksh.5.20).
 *
 * THIS FILE EXISTS BECAUSE NOTHING ELSE COVERS THE INVITE UI AT ANY LAYER.
 * Task 7's review measured it: swapping the `resent` and `invited` toast copy,
 * or deleting the `return` that keeps the dialog open on `already_member`, left
 * all 294 unit tests, `tsc`, `build` and all 12 pre-existing e2e tests green.
 * `convex/teams.test.ts` proves invitePlayerFor returns the right InviteOutcome;
 * nothing proved the dialog does the right thing WITH one, and the outcome →
 * message mapping is the entire deliverable of divergence 9 — v1 reports all
 * four outcomes as "Successfully invited player", including the one where
 * nothing happened.
 *
 * So the three tests below pin all four outcomes and their exact copy:
 *
 *   invited        — 'Invite sent to {email}'        (test 1, plus the join)
 *   resent         — 'Invite re-sent to {email}'     (test 1)
 *   already_member — info toast, dialog STAYS OPEN   (test 2)
 *   added          — '{First} was added to {team}'   (test 3)
 *
 * `already_member` is the cheapest to reach and the highest value: "nothing
 * happened" and "it worked" are indistinguishable from the outside, which is
 * exactly the confusion v1 shipped.
 *
 * EVERY ADDRESS HERE IS e2e+*@wordleteams.com, INCLUDING THE INVITEE, and that
 * is not cosmetic. sign-in.ts reads the OTP back through testOtps.takeFor, which
 * refuses any address outside that shape (convex/testOtps.ts, guard 2) — so an
 * invitee at any other domain can be invited but can never sign in to accept,
 * and the half of this file that matters would be unreachable. The plan's draft
 * of this spec used `@example.test`; that was a defect and the plan is fixed.
 */

/**
 * Signs a page in as a brand-new account that already owns a team it CREATED.
 *
 * Same shape as the identically-named helper in teams.spec.ts, and deliberately
 * not shared with it — each spec owns its seeding rather than reaching across
 * files — but it takes the address, because every test here needs to know the
 * owner's own email to invite it back at itself (`already_member`).
 *
 * ensureTeamFor makes this account the team's `owner`, which is what unlocks
 * the Invite button and the Pending list; both are owner-only, in the UI and
 * in the mutations (divergence 4).
 */
async function signInWithOwnTeam(page: Page, email: string): Promise<void> {
  const convex = new ConvexHttpClient(process.env.VITE_CONVEX_URL!)
  await convex.mutation(api.e2eSeed.ensureTeamFor, { email })
  await signIn(page, email)
}

/** The seeded team's name and the seeded player's first name — see e2eSeed.ts. */
const SEEDED_TEAM = 'E2E Team'

/**
 * A literal, escaped for use as a RegExp.
 *
 * EVERY TEXT LOCATOR BELOW GOES THROUGH THIS, AND NONE OF THEM MAY BE
 * "SIMPLIFIED" BACK TO A PLAIN STRING. Playwright matches a string `hasText`,
 * `getByText` and `getByRole`'s `name` CASE-INSENSITIVELY, and a RegExp as
 * written. Two tests here type a MIXED-CASE address and assert a lowercase one
 * came back, which is the only thing pinning `normaliseInviteEmail`'s
 * `toLowerCase()` through the UI — v1's real bug (amendment A2: v1 stored
 * `teams.invited` as typed and matched it case-sensitively, so anyone invited at
 * a mixed-case address silently never joined).
 *
 * MEASURED, not assumed. Against markup of this exact shape, an all-uppercase
 * expectation matched a lowercase element 1, 2 and 1 times through `getByRole`'s
 * `name`, `getByText` and `filter({hasText})` respectively — and 0 times through
 * the RegExp form of each. So with string locators the positive assertions below
 * are vacuous: a lowercase expectation matches a mixed-case actual, and a mutant
 * storing the raw typed address into `teams.invited` survives all three tests.
 *
 * The `toHaveCount(0)` on `pendingRow(owner, inviteeTyped)` in the first test
 * is the guard against this helper being quietly downgraded. Measured: make `re`
 * return its argument and that assertion receives 1 instead of 0 and fails, so
 * the case-sensitivity of this file cannot be removed silently.
 */
const re = (literal: string): RegExp => new RegExp(literal.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'))

/** The Current Team card, by the landmark current-team-card.tsx gives it. */
const teamCard = (page: Page): Locator => page.getByRole('region', { name: 'Current Team' })

/**
 * A pending-invite row for one address, located by the cancel control's
 * aria-label — which is exactly one element per row, so it counts rows. Being
 * case-sensitive, it also pins the address AS STORED, since getTeamInvitesFor
 * returns `team.invited` verbatim.
 *
 * NOT `getByText(email)`: the toast that announces the invite contains the
 * address too, and it is rendered by the root Toaster, outside this card. Every
 * pending assertion below is scoped to the card for that reason.
 */
const pendingRow = (page: Page, email: string): Locator =>
  teamCard(page).getByRole('button', { name: re(`Cancel invite to ${email}`) })

/** A sonner toast by its copy — substring, and case-SENSITIVE. See `re`. */
const toastWith = (page: Page, text: string): Locator =>
  page.locator('[data-sonner-toast]').filter({ hasText: re(text) })

/**
 * Opens the invite dialog and submits one address. Returns the dialog, because
 * two of the three tests then assert on whether it is still there.
 */
async function invite(page: Page, email: string): Promise<Locator> {
  await teamCard(page).getByRole('button', { name: 'Invite player' }).click()
  const dialog = page.getByRole('dialog')
  await expect(dialog).toBeVisible()
  await dialog.getByLabel('Email').fill(email)
  await dialog.getByRole('button', { name: 'Invite' }).click()
  return dialog
}

test('an invited address joins the team after completing a profile', async ({ browser }) => {
  // TWO OTP SIGN-INS AND A CROSS-CONTEXT REACTIVE WAIT DO NOT FIT IN
  // PLAYWRIGHT'S 30s DEFAULT, and a 20s assertion timeout inside a 30s test is
  // not a timeout at all — it is a lie that reports as "Test timeout of 30000ms
  // exceeded" pointing at the `finally`, naming neither the assertion nor the
  // cause. This test runs in ~10s idle; sign-in.ts alone polls for an OTP for up
  // to 15s, twice, and a mutation-testing run on a loaded machine hit the
  // ceiling for real. Raised rather than trimming the assertion timeouts: the
  // 20s ones below are the flake defence, not padding.
  test.setTimeout(120_000)

  // One stamp shared by both addresses so a failure's artifacts are obviously
  // from the same run; the random suffix is sign-in.ts's own defence against
  // two parallel workers colliding in the same millisecond, and it matters more
  // here than anywhere else — since Phase 4 a colliding address already owns a
  // players row, so the second caller would land on the dashboard instead of
  // /complete-profile and this test would fail for a reason nobody would guess.
  const stamp = `${Date.now()}-${Math.floor(Math.random() * 1e6)}`
  const ownerEmail = `e2e+inv-owner-${stamp}@wordleteams.com`
  const inviteeLocal = `e2e+inv-joiner-${stamp}`
  const inviteeEmail = `${inviteeLocal}@wordleteams.com`
  // THE SAME ADDRESS, TYPED THE WAY A PERSON TYPES ONE. Derived rather than
  // written out so the two cannot drift: the stamp is digits and hyphens, so
  // `inviteeTyped.toLowerCase() === inviteeEmail` holds by construction.
  //
  // This is what makes normalisation observable from the browser. The owner
  // types this; every assertion below expects the LOWERCASE form back — in the
  // toast (which echoes `outcome.email`, the server-normalised value), in the
  // stored pending row, and in the resend matching the first invite instead of
  // parking a second row. Then the invitee signs in at the lowercase address and
  // claims it, which is amendment A2's acceptance criterion driven end to end:
  // v1 matched `teams.invited` case-sensitively while auth lowercased every
  // address, so a mixed-case invite silently never joined anyone.
  const inviteeTyped = `${inviteeLocal.toUpperCase()}@WordleTeams.com`

  const ownerContext = await browser.newContext()
  const inviteeContext = await browser.newContext()

  try {
    const owner = await ownerContext.newPage()
    await signInWithOwnTeam(owner, ownerEmail)
    await expect(teamCard(owner)).toBeVisible()

    // OUTCOME 1 of 4 — `invited`. The address has no account, so it is parked
    // in teams.invited and the invite email goes out. Typed mixed-case,
    // expected back lowercase everywhere below.
    await invite(owner, inviteeTyped)
    await expect(toastWith(owner, `Invite sent to ${inviteeEmail}`)).toBeVisible()
    // The dialog closes on every outcome except already_member.
    await expect(owner.getByRole('dialog')).toHaveCount(0)

    // Divergence 6: v1 shows an owner nowhere who they invited. The row is
    // asserted twice on purpose — once by its cancel control, which counts rows
    // unambiguously, and once by the address being RENDERED, which is the thing
    // the divergence is actually for. Task 7 gave that span `break-all`; that is
    // CSS line-breaking and does not split the text node, so a plain substring
    // locator still matches. `.first()` because the address is the entire text
    // content of both the inner span and its wrapper, so an unqualified
    // getByText resolves to two nested elements.
    await expect(owner.getByRole('heading', { name: 'Pending invites' })).toBeVisible()
    await expect(pendingRow(owner, inviteeEmail)).toHaveCount(1)
    await expect(teamCard(owner).getByText(re(inviteeEmail)).first()).toBeVisible()
    // And the mixed-case string the owner typed was NOT what got stored.
    await expect(pendingRow(owner, inviteeTyped)).toHaveCount(0)

    // OUTCOME 2 of 4 — `resent`. Same address, second attempt, before anyone
    // has accepted. v1 said "Successfully invited player" here as well.
    await invite(owner, inviteeTyped)
    await expect(toastWith(owner, `Invite re-sent to ${inviteeEmail}`)).toBeVisible()
    await expect(owner.getByRole('dialog')).toHaveCount(0)
    // A resend writes NOTHING (teams.ts), so the list must not grow a second
    // row for the same address — and the dedupe in current-team-card.tsx must
    // not be what is hiding one. This also pins the case-insensitive
    // `alreadyInvited` scan: matching the stored lowercase entry against a
    // freshly typed mixed-case address is the only reason this stays at one.
    await expect(pendingRow(owner, inviteeEmail)).toHaveCount(1)

    // The invitee's first ever sign-in. A brand-new account has no players row,
    // so `/app`'s beforeLoad guard bounces it to the onboarding form — the
    // invite itself creates nothing.
    const joiner = await inviteeContext.newPage()
    await signIn(joiner, inviteeEmail)
    await expect(joiner).toHaveURL('/complete-profile')

    await completeProfile(joiner, { firstName: 'Iva', lastName: 'Joiner' })

    // THE POINT OF THE WHOLE FEATURE. completeProfile is the only thing in v2
    // that creates a player, and claiming every invite waiting on that address
    // is part of the same mutation — so this account, which had no team a
    // moment ago, arrives on the dashboard already on one. `?team=` proves it:
    // with zero teams the dashboard renders the empty state and never writes
    // that parameter (see app.tsx / dashboard-search.ts).
    await expect(joiner).toHaveURL(/\?team=/)
    const joinerCard = teamCard(joiner)
    await expect(joinerCard.getByRole('heading', { name: SEEDED_TEAM })).toBeVisible()
    // Both members, so this is demonstrably the OWNER'S team and not some
    // team of their own: 'E2E Tester' is the seeded owner, and the joiner
    // never created anything.
    await expect(joinerCard.getByText('E2E Tester')).toBeVisible()
    await expect(joinerCard.getByText('Iva Joiner')).toBeVisible()
    // A member, not the owner, so they get Leave (divergence 10) and no
    // Invite button.
    await expect(joinerCard.getByRole('button', { name: `Leave ${SEEDED_TEAM}` })).toBeVisible()
    await expect(joinerCard.getByRole('button', { name: 'Invite player' })).toHaveCount(0)

    // AND THE OWNER'S PAGE UPDATES WITH NO RELOAD AND NO INTERACTION. Nothing
    // has touched `owner` since the resend above. One Convex write —
    // completeProfileFor's patch of playerIds and invited — has to reach two
    // separate subscriptions on this page: getTeamInvites, which drops the
    // pending row, and getMyTeams, which grows the member list.
    //
    // toHaveCount(0), not toBeHidden(): the section is gated on
    // `pendingInvites.length > 0`, so it unmounts entirely rather than hiding,
    // and toBeHidden would also pass against a locator that had silently
    // stopped matching anything at all — which is precisely the failure mode a
    // clearing assertion must not be blind to. The row is asserted PRESENT
    // above, so this pair really does measure a transition.
    //
    // 20s, not the 5s default, and it is not padding. This is the one assertion
    // in the file waiting on a push to a page that has been idle for the whole
    // of the invitee's sign-in — a minute or so of OTP polling — and a Convex
    // client that has had to reconnect comes back on a backoff. Phase 4 already
    // lost a run in three to exactly that in complete-profile.spec.ts.
    await expect(pendingRow(owner, inviteeEmail)).toHaveCount(0, { timeout: 20_000 })
    await expect(teamCard(owner).getByText(re(inviteeEmail))).toHaveCount(0)
    await expect(owner.getByRole('heading', { name: 'Pending invites' })).toHaveCount(0)
    await expect(teamCard(owner).getByText('Iva Joiner')).toBeVisible({ timeout: 20_000 })
  } finally {
    await ownerContext.close()
    await inviteeContext.close()
  }
})

test('inviting someone already on the team says so and leaves the dialog open', async ({
  page,
}) => {
  // One OTP sign-in plus two invites — see the note on the first test for why
  // the default 30s is not a safe budget for anything that signs in at all.
  test.setTimeout(90_000)

  // OUTCOME 3 of 4 — `already_member`, reached the cheapest way there is: the
  // owner invites their own address, which playerForEmail resolves to a
  // player already in playerIds.
  //
  // THIS IS THE HIGHEST-VALUE TEST IN THE FILE. v1 answers this case with
  // "Successfully invited player" and closes the dialog, so an owner who
  // fat-fingers an address they have already added is told it worked. Nothing
  // visible distinguishes that from success — which is why nothing caught it
  // for the life of v1, and why divergence 9 exists.
  const stamp = `${Date.now()}-${Math.floor(Math.random() * 1e6)}`
  const memberLocal = `e2e+inv-member-${stamp}`
  const email = `${memberLocal}@wordleteams.com`
  // Typed mixed-case again, for a second reason: reaching `already_member` at
  // all requires playerForEmail to normalise before it looks the account up, so
  // this pins normalisation on the COMPARE path, where the first test pins it on
  // the write path.
  const typedEmail = `${memberLocal.toUpperCase()}@WordleTeams.com`
  // The address the owner "meant" to type. Seeded so it already has a players
  // row, which makes the corrected attempt take the `added` branch — the one
  // outcome that sends no email. The correction has to actually go through for
  // this test to mean anything, and an `invited` correction would put a real
  // Resend delivery on every local run of the suite for no extra coverage.
  const correctedEmail = `e2e+inv-meant-${stamp}@wordleteams.com`
  const convex = new ConvexHttpClient(process.env.VITE_CONVEX_URL!)
  await convex.mutation(api.e2eSeed.ensureTeamFor, { email: correctedEmail })

  await signInWithOwnTeam(page, email)
  await expect(teamCard(page)).toBeVisible()
  await expect(teamCard(page).getByRole('listitem')).toHaveCount(1)

  const dialog = await invite(page, typedEmail)

  // INFO, not success. Asserted through sonner's own data-type rather than the
  // icon or the copy alone, because the copy is the half that already differs
  // from v1 and the SEVERITY is the half that would silently drift back:
  // toast.success here would read as "done" and still match the text.
  //
  // AND IT ECHOES WHAT WAS TYPED, not a normalised address — the one outcome
  // that does, deliberately, because it carries no server payload to echo
  // instead (the server wrote nothing on this path). The case-sensitive locator
  // is what makes that assertable at all.
  const toast = toastWith(page, `${typedEmail} is already on ${SEEDED_TEAM}`)
  await expect(toast).toBeVisible()
  await expect(toast).toHaveAttribute('data-type', 'info')

  // THE ASSERTIONS THAT DIE IF SOMEBODY DROPS THE `return`. Nothing the user
  // wanted happened and the likeliest next action is correcting the address, so
  // the dialog stays put — with the field cleared, so the next attempt starts
  // fresh rather than making them select-all first.
  //
  // data-state, NOT toBeVisible, and that is measured rather than stylistic.
  // Radix keeps DialogContent mounted through its exit animation (dialog.tsx
  // carries `duration-200`), so a dialog that has already been told to close
  // stays visible for a fifth of a second and passes toBeVisible outright. The
  // first draft of this test asserted toBeVisible and SURVIVED the mutation
  // that replaces this branch's `return` with a `break` — all three tests green
  // against a dialog that closes. data-state flips to "closed" on the same
  // React flush that paints the toast, so it cannot be raced.
  await expect(dialog).toHaveAttribute('data-state', 'open')
  await expect(dialog.getByLabel('Email')).toHaveValue('')

  // AND THE SERVER WROTE NOTHING. invitePlayerFor returns on this branch before
  // any patch, deliberately — repairing a row here would cost a getMyTeams
  // broadcast to every connected client on the one path whose whole point is
  // that nothing happened. A pending row appearing would mean the address had
  // been parked as well as reported.
  await expect(page.getByRole('heading', { name: 'Pending invites' })).toHaveCount(0)

  // THE DIALOG IS STILL USABLE, which is the whole reason the branch returns
  // early — "keeps the dialog open so the address can be corrected" is the
  // claim divergence 9 makes, and a still-mounted-but-closing dialog does not
  // honour it. This is the behavioural half of the assertion above: if the
  // dialog had closed, there is nothing to type into and this fill cannot
  // resolve. No reopening anywhere between here and the invite() above.
  await dialog.getByLabel('Email').fill(correctedEmail)
  await dialog.getByRole('button', { name: 'Invite' }).click()
  await expect(page.getByRole('dialog')).toHaveCount(0)
  await expect(teamCard(page).getByRole('listitem')).toHaveCount(2)
})

test('inviting someone who already has an account adds them to the team directly', async ({
  browser,
}) => {
  // Two OTP sign-ins — see the note on the first test.
  test.setTimeout(120_000)

  // OUTCOME 4 of 4 — `added`. No email is sent and no invite is parked: they
  // simply find themselves on the team, which is v1's behaviour and is kept as
  // parity on purpose.
  const stamp = `${Date.now()}-${Math.floor(Math.random() * 1e6)}`
  const ownerEmail = `e2e+add-owner-${stamp}@wordleteams.com`
  const existingEmail = `e2e+add-player-${stamp}@wordleteams.com`

  // The existing player is made through the REAL onboarding flow rather than
  // e2eSeed, for one reason that matters: ensureTeamFor names every player it
  // creates 'E2E Tester', so the owner and the added member would be
  // character-for-character identical in the member list and "they appear in the
  // list" could not be asserted at all. A distinct name also makes the toast's
  // `{firstName}` — the single most useful thing the outcome carries, since it
  // confirms the address matched a real account — checkable rather than
  // tautological. They finish with NO team, so the add below is the only thing
  // that can put them on one.
  const newcomerContext = await browser.newContext()
  try {
    const newcomer = await newcomerContext.newPage()
    await signIn(newcomer, existingEmail)
    await expect(newcomer).toHaveURL('/complete-profile')
    await completeProfile(newcomer, { firstName: 'Ada', lastName: 'Lovelace' })
    await expect(newcomer).toHaveURL('/app')
    await expect(newcomer.getByRole('heading', { name: /not on a team yet/i })).toBeVisible()
  } finally {
    await newcomerContext.close()
  }

  const ownerContext = await browser.newContext()
  try {
    const owner = await ownerContext.newPage()
    await signInWithOwnTeam(owner, ownerEmail)
    const card = teamCard(owner)
    await expect(card).toBeVisible()
    // One member — the owner — before the add, so the count below measures a
    // change rather than a state. The card's only <li>s are member rows and
    // pending rows, and there are no pending rows on this path.
    await expect(card.getByRole('listitem')).toHaveCount(1)

    await invite(owner, existingEmail)

    // The firstName the server read back off the matched account, not anything
    // the client typed.
    await expect(toastWith(owner, `Ada was added to ${SEEDED_TEAM}`)).toBeVisible()
    await expect(owner.getByRole('dialog')).toHaveCount(0)

    // AND THEY ARE ACTUALLY ON THE TEAM, which the toast alone does not prove.
    await expect(card.getByText('Ada Lovelace')).toBeVisible()
    await expect(card.getByRole('listitem')).toHaveCount(2)
    // The owner's remove control appears on the new member's row and on no
    // other — their own row never carries one, because removeMember refuses it
    // server-side.
    await expect(card.getByRole('button', { name: 'Remove Ada' })).toHaveCount(1)
    // NOTHING WAS PARKED. An existing player is added, never invited, so a
    // pending row here would mean the address had been written into
    // teams.invited where nothing would ever claim it — they already have a
    // players row, so completeProfile, the only other place an invite is
    // retired, can never run for them again.
    await expect(owner.getByRole('heading', { name: 'Pending invites' })).toHaveCount(0)
  } finally {
    await ownerContext.close()
  }
})
