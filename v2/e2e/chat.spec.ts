import { expect, test } from '@playwright/test'
import { ConvexHttpClient } from 'convex/browser'
import { api } from '../convex/_generated/api'
import { signIn } from './sign-in'

/**
 * Chat's authorization rule, end to end (wordle-teams-qix, Part 2 Task 11).
 *
 * ONE TEST, AND IT IS THE ONE NO QUALITY GATE CAN COVER. `pnpm test:once`,
 * `pnpm lint`, `pnpm typecheck` and `pnpm build` all run against the code
 * rather than against a running app with two real sessions in it, and
 * `convex/chat.test.ts` proves `requireTeamMemberFor` throws for an outsider by
 * calling `chatPointerFor` directly with a playerId the test itself chose.
 * Nothing in any of that proves the rule survives the trip through the browser:
 * a route that stopped calling `api.chat.pointer`, a client that cached one
 * team's messages under another's key, or a refusal that rendered the
 * conversation anyway would leave every gate green. e2e is also outside CI
 * entirely (playwright.config.ts's note on `reuseExistingServer`), so this file
 * only ever means anything when somebody runs it deliberately.
 *
 * THE SECRET IS PER RUN, and that is the whole design of the negative
 * assertion. Asserting "the outsider sees the refusal" alone would pass against
 * a page that showed the refusal AND leaked the conversation underneath it, and
 * asserting on a fixed string would pass against a page that leaked a DIFFERENT
 * run's message. A unique body posted by the member moments earlier is the only
 * thing that can distinguish "did not render this team's history" from "had
 * nothing to render".
 *
 * THE MEMBER HALF IS THE CONTROL, not scaffolding. Without it, a `/chat` that
 * was broken for everybody — the exact failure that reached beta on 2026-09-06,
 * where one bad import threw at module scope in the client chunk — would
 * satisfy every assertion below: the refusal is what a broken route shows too.
 * Posting a message as a member first is what makes the outsider's refusal mean
 * "refused" rather than "unavailable".
 *
 * BOTH ADDRESSES ARE e2e+*@wordleteams.com, for the reason invites.spec.ts
 * records at length: sign-in.ts reads the OTP back through `testOtps.takeFor`,
 * which refuses any address outside that shape, so an account at any other
 * domain can be seeded but can never sign in.
 */

/**
 * The refusal `/chat` renders when the pointer subscription throws — see the
 * `pointer.error` branch in src/routes/chat.tsx. It is deliberately the same
 * copy for every cause, because `requireTeamMemberFor` answers NOT_A_MEMBER for
 * a nonexistent team as well as for someone else's (convex/chat.ts's header
 * says not to "improve" that), and the UI must not undo server-side
 * indistinguishability by being more specific than the error it was handed.
 */
const REFUSAL = 'Could not load chat.'

test("a non-member cannot read a team's chat", async ({ browser }) => {
  // TWO OTP SIGN-INS, and Playwright's 30s default is not a budget for even
  // one: sign-in.ts alone polls for an OTP for up to 15s and then waits up to
  // 20s for the post-verify document load. Same figure and same reasoning as
  // invites.spec.ts's two-session tests.
  test.setTimeout(120_000)

  // One stamp across both accounts and the message body, so a failure's traces
  // are obviously from the same run. The random suffix is sign-in.ts's own
  // defence against two parallel workers colliding in the same millisecond.
  const stamp = `${Date.now()}-${Math.floor(Math.random() * 1e6)}`
  const memberEmail = `e2e+chat-member-${stamp}@wordleteams.com`
  const outsiderEmail = `e2e+chat-outsider-${stamp}@wordleteams.com`

  // `ensureTeamFor` RETURNS THE TEAM ID, which is why this test does not have
  // to scrape one out of a URL: `/chat?team=` takes the id directly, and the
  // outsider needs the member's id without ever having been shown it.
  //
  // THE OUTSIDER GETS A TEAM OF THEIR OWN, and it is not decoration. It makes
  // them profile-complete, so `signIn` lands them on the dashboard rather than
  // /complete-profile, and it gives the control below a second team to prove
  // the refusal is about THIS team rather than about chat.
  const convex = new ConvexHttpClient(process.env.VITE_CONVEX_URL!)
  const memberTeamId = await convex.mutation(api.e2eSeed.ensureTeamFor, { email: memberEmail })
  const outsiderTeamId = await convex.mutation(api.e2eSeed.ensureTeamFor, { email: outsiderEmail })

  const secret = `not-for-outsiders-${stamp}`

  const memberContext = await browser.newContext()
  const outsiderContext = await browser.newContext()

  try {
    const member = await memberContext.newPage()
    await signIn(member, memberEmail)
    await member.goto(`/chat?team=${memberTeamId}`)

    // The composer only renders past the `pointer.isPending` and
    // `pointer.error` branches, so its presence IS "the pointer resolved for a
    // member". 20s rather than the 5s default: this is the first paint of a
    // lazily loaded route on a cold Vite dev server, plus a Convex
    // subscription opening.
    const composer = member.getByTestId('chat-composer')
    await expect(composer).toBeVisible({ timeout: 20_000 })
    await composer.fill(secret)
    await member.getByRole('button', { name: 'Send' }).click()

    // Scoped to the list rather than the page: the textarea is cleared on
    // success, but only on success, so an unscoped `getByText` would match the
    // still-typed draft of a send that failed and report a stored message that
    // does not exist.
    await expect(member.getByTestId('chat-messages').getByText(secret)).toBeVisible({
      timeout: 20_000,
    })

    const outsider = await outsiderContext.newPage()
    await signIn(outsider, outsiderEmail)

    // THE CONTROL. Their own team's chat loads for them, which is what stops
    // every assertion after this from passing against a globally broken route.
    await outsider.goto(`/chat?team=${outsiderTeamId}`)
    await expect(outsider.getByTestId('chat-composer')).toBeVisible({ timeout: 20_000 })
    await expect(outsider.getByText(REFUSAL)).toHaveCount(0)

    // THE RULE. Same session, same page, one search param different — the id
    // of a team this account has never been on.
    await outsider.goto(`/chat?team=${memberTeamId}`)
    await expect(outsider.getByText(REFUSAL)).toBeVisible({ timeout: 20_000 })

    // AND NOTHING LEAKED WITH IT. The refusal being visible does not by itself
    // mean the conversation is absent — a list rendered above or below it would
    // satisfy the assertion above on its own.
    await expect(outsider.getByText(secret)).toHaveCount(0)
    await expect(outsider.getByTestId('chat-messages')).toHaveCount(0)
    // They cannot WRITE to it either. The composer is rendered past the same
    // early return, so its absence is the send path being closed as well as the
    // read path.
    await expect(outsider.getByTestId('chat-composer')).toHaveCount(0)

    // THE SERVED DOCUMENT, not just what the DOM renders. A locator cannot see
    // a message that arrived and was hidden by CSS, or one sitting in the SSR
    // payload the router hydrates from — and `/chat`'s data is fetched through
    // the router, so a membership check that ran only in the component would
    // leave the bodies in that payload for anyone with view-source.
    expect(await outsider.content()).not.toContain(secret)
  } finally {
    await memberContext.close()
    await outsiderContext.close()
  }
})
