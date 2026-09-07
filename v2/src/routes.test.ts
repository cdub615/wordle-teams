import { execSync } from 'node:child_process'
import { existsSync, readFileSync } from 'node:fs'
import { describe, expect, test } from 'vitest'
import {
  codeOf,
  jsxElementsOf,
  jsxPropsOf,
  optionsPassedTo,
  propertiesOf,
} from './test-support/source-ast'

/**
 * THE ROUTES THAT EXIST BECAUSE SOMETHING OUTSIDE THIS REPO POINTS AT THEM.
 *
 * A route the app itself never links to is invisible to every gate we run: the
 * four in .github/workflows/deploy-v2.yml are lint, typecheck, `vitest run` and
 * build, and none of them can tell a deliberately unreferenced route from dead
 * code. `/me` was exactly that. Deleting src/routes/me.tsx left all four green
 * — routeTree.gen.ts simply regenerated without it — and only e2e/routes.spec.ts
 * noticed, which CI does not run. So the one route whose entire justification
 * is "production PWA installs have /me burned in and cannot be updated" could
 * be tidied away and shipped to beta on a green build.
 *
 * BOTH HALVES ARE ASSERTED, DELIBERATELY.
 *
 * The SOURCE file pins the redirect's target, which is the part that matters
 * to a user and the part no generated artefact records: routeTree.gen.ts knows
 * `/me` exists, not where it sends anyone. Retargeting it at `/login` was green
 * on all four gates too.
 *
 * The GENERATED tree pins existence independently of the file's name, so a
 * rename or a move of the source still goes red here rather than silently
 * dropping the path. It is checked in (`git ls-files src/routeTree.gen.ts`), so
 * it is a real artefact of the commit and not a build-time coincidence.
 *
 * Reading files as strings rather than importing them is the pattern
 * src/lib/sw-push.test.ts already uses to pin the push payload against its
 * server copy; the reason is the same here. The route module cannot be
 * imported in this environment — createFileRoute registers against a router
 * that does not exist under vitest — and a `redirect()` thrown from beforeLoad
 * is only observable with a running router. The string IS the artefact that
 * ships.
 */

const read = (path: string) => readFileSync(new URL(path, import.meta.url), 'utf8')

/**
 * codeOf, propertiesOf and optionsPassedTo MOVED to src/test-support/source-ast
 * when src/crawler-metadata.test.ts needed the same three. The reasoning that
 * used to sit here — why a `toMatch` over a whole file is the wrong tool for
 * "this option is passed to this call", and the mutation that proved it —
 * moved with them and is unchanged.
 *
 * They take source TEXT rather than a path, because each suite resolves its
 * own paths relative to its own file. Hence `parsed(path)` below.
 */
const parsed = (path: string, callee: string) => optionsPassedTo(path, read(path), callee)

/**
 * The same, for a JSX element's props. The RAW source, not `codeOf`'s stripped
 * copy: the compiler wants a parseable file, and an expression's `getText()`
 * starts after its leading trivia, so comments cannot reach an assertion here
 * the way they can reach a `toMatch`.
 */
const jsxProps = (path: string, tag: string) => jsxPropsOf(path, read(path), tag)

/** All of them, for a tag a file legitimately uses more than once. */
const jsxElements = (path: string, tag: string) => jsxElementsOf(path, read(path), tag)

const ME = './routes/me.tsx'

describe('/me, the route v1 PWA installs open on', () => {
  // Read inside each test rather than at describe scope, so a deleted file is
  // a named assertion failure instead of a bare ENOENT during collection.
  const source = () => codeOf(read(ME))

  test('exists as a route file, and is still the /me route', () => {
    expect(
      existsSync(new URL(ME, import.meta.url)),
      'src/routes/me.tsx is gone. It is not dead code — see the note at the top of this file.',
    ).toBe(true)
    expect(source()).toMatch(/createFileRoute\(\s*['"]\/me['"]\s*\)/)
  })

  test('redirects to /app — not /login, not anywhere else', () => {
    // v1's src/app/manifest.json sets "start_url": "/me". An installed iOS PWA
    // does not adopt a new start_url from a re-fetched manifest, so at cutover
    // this is the path every existing installation opens on, and it has to
    // reach the dashboard. Quote-insensitive on purpose: this checks where the
    // route goes, not how the file spells a string.
    expect(source()).toMatch(/redirect\(/)
    // Every `to:` in the file, not merely "an /app is in here somewhere" — a
    // `toContain` would go on passing if the real target were changed and an
    // /app left behind in a second, unreached branch.
    const targets = [...source().matchAll(/to:\s*['"]([^'"]*)['"]/g)].map((match) => match[1])
    expect(targets).toEqual(['/app'])
  })

  test('is in the generated route tree, whatever the source file is called', () => {
    const tree = read('./routeTree.gen.ts')
    expect(tree).toMatch(/path:\s*['"]\/me['"]/)
  })
})

/**
 * THE ASYMMETRY BETWEEN `/` AND `/home`, WHICH IS THE MOST-ARGUED DECISION IN
 * PHASE 7 TASK 4 AND HAD NO TEST AT ALL.
 *
 * v1's `welcomePaths` (src/lib/supabase/middleware.ts:7) is exactly
 * `['/', '/login']`. `/home` is deliberately absent, so a signed-in visitor who
 * follows a link there gets the marketing page rather than a bounce — the
 * bounce exists to keep a relaunching iOS PWA off the welcome screen, and no
 * PWA relaunches onto /home. Both route files carry paragraphs about this.
 *
 * MUTATION FOUND THE HOLE: adding a `beforeLoad` to src/routes/home.tsx left
 * all 39 e2e specs green, because the only /home test navigated anonymously and
 * a signed-in-only redirect is invisible to an anonymous visit. e2e/routes.spec
 * .ts now signs in and walks the redirect chain, which is the BEHAVIOURAL half.
 * This is the half CI can see — .github/workflows/deploy-v2.yml runs lint,
 * typecheck, `vitest run` and build, and no e2e.
 *
 * Same string-reading rationale as the /me block above: createFileRoute cannot
 * be imported under vitest, and a thrown `redirect()` needs a running router to
 * be observable.
 */
describe('/ bounces a signed-in visitor and /home deliberately does not', () => {
  const home = () => codeOf(read('./routes/home.tsx'))
  const index = () => codeOf(read('./routes/index.tsx'))

  test('/home declares no beforeLoad, so nothing can redirect off it', () => {
    expect(
      home(),
      'src/routes/home.tsx has grown a beforeLoad. That is not a hardening — it ' +
        'is v1 welcomePaths parity being dropped; see the note at the top of that file.',
    ).not.toMatch(/beforeLoad/)
  })

  test('/ declares one, and /app is the only place it sends anyone', () => {
    expect(index()).toMatch(/beforeLoad/)
    // Every `to:` in the file, for the reason spelled out in the /me block: a
    // `toContain` keeps passing when the real target moves and an /app is left
    // behind in a branch nothing reaches.
    const targets = [...index().matchAll(/to:\s*['"]([^'"]*)['"]/g)].map((match) => match[1])
    expect(targets).toEqual(['/app'])
  })

  test('both paths are in the generated route tree', () => {
    // `/home` is here for inbound links and v1's sitemap, so — exactly like
    // /me — nothing in the app linking to it makes it look like dead code.
    const tree = read('./routeTree.gen.ts')
    expect(tree).toMatch(/path:\s*['"]\/home['"]/)
    expect(tree).toMatch(/path:\s*['"]\/['"]/)
  })
})

/**
 * THE TWO LEGAL PAGES' TITLES, AND THE FOOTER LINKS THAT ARE THE ONLY WAY TO
 * THEM — the half of Phase 7 Task 5 that CI could not see.
 *
 * Task 5's behavioural coverage is entirely in e2e/routes.spec.ts, and
 * .github/workflows/deploy-v2.yml runs no e2e: it is lint, typecheck,
 * `vitest run` and build, then a deploy and a smoke test of /login. The Task 5
 * review measured the consequence rather than assuming it — SWAPPING THE TWO
 * PAGES' <title>s AND POINTING THE FOOTER'S "Privacy Policy" LINK AT /terms
 * PASSED ALL FOUR GATES AND DEPLOYED TO BETA GREEN. A user following the
 * footer to read the privacy policy would have been handed the terms of
 * service, under a tab reading "Terms of Service - Wordle Teams", and nothing
 * in CI would have said a word.
 *
 * ROUTE EXISTENCE IS ALREADY PROTECTED and is deliberately not re-asserted
 * here: Footer.tsx's `<Link to>` is typed against the generated route tree, so
 * deleting either route file fails typecheck at the link, and
 * src/legal-prose.test.ts imports both modules by path. What neither of those
 * can see is which title sits on which page and which label points where —
 * both are plain strings, and both are what a reader actually navigates by.
 *
 * Same string-reading rationale as every block above.
 */
describe('/privacy and /terms, and the footer links that reach them', () => {
  const privacy = () => codeOf(read('./routes/privacy.tsx'))
  const terms = () => codeOf(read('./routes/terms.tsx'))
  /**
   * NOT `codeOf`, AND THE REASON IS THE WHOLE POINT OF THIS TEST. `codeOf`
   * strips `//` to end of line, and every external href in the footer contains
   * `//` — so read through it, `href="https://feedback…"` becomes `href="https:`
   * and four of the five `<a>`s simply are not there. That is the same shape of
   * blindness the test below grew to close, one layer down, and it is why the
   * `<a>` half could not have been added by pointing the old pattern at the old
   * reader.
   *
   * Comments still have to go — a source assertion must not be satisfied by the
   * file's own prose about itself, and Footer.tsx's header now quotes both the
   * live URL and the dead one. So: block comments, plus line comments whose
   * `//` starts a token rather than sitting inside `https://`.
   */
  const footer = () =>
    read('./components/Footer.tsx')
      .replace(/\/\*[\s\S]*?\*\//g, '')
      .replace(/(^|\s)\/\/[^\n]*/g, '$1')

  /** Every pageTitle('...') argument in a file, in source order. */
  // BOTH CALL SHAPES, since wt-ksh.8.55. A public route now states its title as
  // the second argument to publicRouteHead(path, title) rather than calling
  // pageTitle() itself, and matching only the old shape would return [] for
  // those files — which reads as "the title is missing" when it is merely
  // spelled differently, and would have been satisfied by deleting it.
  const titlesIn = (source: string) =>
    [
      ...source.matchAll(
        /pageTitle\(\s*['"]([^'"]*)['"]\s*\)|publicRouteHead\(\s*['"][^'"]*['"]\s*,\s*['"]([^'"]*)['"]\s*\)/g,
      ),
    ].map((match) => match[1] ?? match[2])

  test('each legal page carries its own v1 title, and not the other one', () => {
    // v1's src/app/privacy/layout.tsx and src/app/terms/layout.tsx set these as
    // `metadata.title`; src/lib/seo.ts interpolates the '%s - Wordle Teams'
    // template Next applied automatically. THE LITERALS, not pageTitle()
    // imported — importing the helper would make this pass whatever the helper
    // became, which is the same reason e2e/routes.spec.ts spells the full
    // strings out.
    //
    // Every occurrence in each file, not "the right title is in here
    // somewhere": the mutation this is written against SWAPS them, and a
    // `toContain` on each file separately would still be satisfied by a second,
    // unreached head().
    expect(titlesIn(privacy())).toEqual(['Privacy Policy'])
    expect(titlesIn(terms())).toEqual(['Terms of Service'])
  })

  test('the footer sends each label to the destination it names', () => {
    // LABEL AND TARGET AS A PAIR. Asserting that /privacy and /terms both
    // appear somewhere in the footer is satisfied by two links that have been
    // swapped with each other, which is precisely the mutation that shipped
    // green. v1's src/components/home/footer.tsx:25-28 pairs them the same way.
    //
    // BOTH KINDS OF LINK, WHICH IS THE POINT OF THIS VERSION. Until Task 9's
    // review this test read `<Link to=` only. It was genuinely exhaustive over
    // the three router links — and structurally blind to the five `<a href>`s
    // beside them, which is the class the footer's one real defect was in:
    // "Source Code" pointed at github.com/cdub615/wordleteams, which 404s, on
    // every page of the site (wordle-teams-xmk). A test can be bounded, parsed
    // AND exhaustive and still be exhaustive over a set the bug cannot appear
    // in. Its old name, "sends each label to the page it names", read as
    // covering the whole footer.
    const pairs = (pattern: RegExp) =>
      [...footer().matchAll(pattern)].map((match) => [match[2], match[1]])

    expect(pairs(/<Link to=["']([^"']+)["']>\s*([^<]+?)\s*<\/Link>/g)).toEqual([
      ['About', '/about'],
      ['Privacy Policy', '/privacy'],
      ['Terms', '/terms'],
    ])
    expect(pairs(/<a href=["']([^"']+)["']>\s*([^<]+?)\s*<\/a>/g)).toEqual([
      ['Feedback', 'https://feedback.wordleteams.com/feedback'],
      ['Changelog', 'https://feedback.wordleteams.com/changelog'],
      ['Support', 'mailto:support@wordleteams.com'],
      ['Source Code', 'https://github.com/cdub615/wordle-teams'],
      ['X', 'https://twitter.com/wordleteams'],
    ])

    // AND THAT THE TWO LISTS ABOVE ARE THE WHOLE FOOTER. Both patterns require
    // the tag, the attribute and the text on one parseable shape; a link
    // wrapped across lines by a formatter, or one carrying a className, matches
    // NEITHER and would vanish from both lists without failing either
    // assertion — the same blindness in a new place. Counting the opening tags
    // is what makes "exhaustive" mean exhaustive rather than "exhaustive over
    // whatever the regex could read".
    expect(footer().match(/<Link\b/g) ?? [], 'a <Link> the pattern above cannot read').toHaveLength(
      3,
    )
    expect(footer().match(/<a\b/g) ?? [], 'an <a> the pattern above cannot read').toHaveLength(5)
  })
})

/**
 * `/login-error`, THE PAGE NOBODY ARRIVES AT ON PURPOSE — Phase 7 Task 6.
 *
 * NOTHING IN THE APP LINKS HERE. It is reached only by a redirect issued from
 * inside Better Auth, configured in two places that are both a single option:
 * `errorCallbackURL` on signIn.social (src/routes/login.tsx) and
 * `onAPIError.errorURL` (convex/auth.ts). So this route is invisible to
 * typecheck the way /me and /home are — there is no `<Link to>` anywhere whose
 * type would break if it vanished — and it is worse than those two, because the
 * things pointing at it are STRINGS IN CONFIG rather than route-typed links.
 * The pairing between them is what this block pins.
 *
 * Same string-reading rationale as every block above: createFileRoute cannot be
 * imported under a router-less vitest. src/login-error.test.ts covers what the
 * page RENDERS, by walking the real element tree; this covers what the SOURCE
 * commits to, which is the half CI can see — .github/workflows/deploy-v2.yml is
 * lint, typecheck, `vitest run` and build, and no e2e.
 */
describe('/login-error, and the two config strings that are the only way to it', () => {
  const loginError = () => codeOf(read('./routes/login-error.tsx'))
  const login = () => codeOf(read('./routes/login.tsx'))

  /** Every pageTitle('...') argument in a file, in source order. */
  // BOTH CALL SHAPES, since wt-ksh.8.55. A public route now states its title as
  // the second argument to publicRouteHead(path, title) rather than calling
  // pageTitle() itself, and matching only the old shape would return [] for
  // those files — which reads as "the title is missing" when it is merely
  // spelled differently, and would have been satisfied by deleting it.
  const titlesIn = (source: string) =>
    [
      ...source.matchAll(
        /pageTitle\(\s*['"]([^'"]*)['"]\s*\)|publicRouteHead\(\s*['"][^'"]*['"]\s*,\s*['"]([^'"]*)['"]\s*\)/g,
      ),
    ].map((match) => match[1] ?? match[2])

  test('carries v1\'s own title, which is /login\'s title and not a new one', () => {
    // v1's src/app/login-error/layout.tsx sets `metadata.title` to
    // 'Login / Signup' — the SAME string as src/app/login/layout.tsx, because
    // this page is a step in the sign-in flow rather than a destination.
    // THE LITERAL, not pageTitle() imported: importing the helper would make
    // this pass whatever the helper became.
    //
    // Every occurrence in the file, not "the right title is in here somewhere":
    // a `toContain` stays satisfied by a second, unreached head().
    expect(titlesIn(loginError())).toEqual(['Login / Signup'])
    // Asserted as a PAIR with /login's, because "same as /login" is the actual
    // claim and it is only true while /login still says it.
    expect(titlesIn(login())).toEqual(['Login / Signup'])
  })

  test('the only place it sends anyone is /login', () => {
    // v1's page renders one control, a "Head to Sign In" button wrapping
    // `<Link href='/login'>`. Exhaustive over every `to:` and `to=` in the
    // file for the reason spelled out in the /me block: a `toContain` keeps
    // passing when the real target moves to /app and a /login is left behind in
    // a branch nothing reaches.
    const targets = [...loginError().matchAll(/\bto[:=]\s*['"]([^'"]*)['"]/g)].map(
      (match) => match[1],
    )
    expect(targets).toEqual(['/login'])
  })

  test('is in the generated route tree, whatever the source file is called', () => {
    const tree = read('./routeTree.gen.ts')
    expect(tree).toMatch(/path:\s*['"]\/login-error['"]/)
  })

  test('both redirects that reach it are options ON their call, naming this path', () => {
    // THE PAIRING, and the reason this whole block exists. Neither string is
    // route-typed, so either can be misspelled or repointed with all four gates
    // green and the page simply never appearing again.
    //
    // They are NOT redundant with each other and both are required:
    // `errorCallbackURL` travels in the OAuth state, so it is only available
    // once that state has parsed; `onAPIError.errorURL` is the default used
    // when parsing the state is itself what failed. See the note in
    // src/routes/login-error.tsx.
    //
    // PARSED, NOT MATCHED — see test-support/source-ast.ts. This used to be two
    // `toMatch` calls over the whole file, and both mutations that lift the
    // option out of its call into a dead `const` survived every gate and every
    // e2e test: the literal was still in the file, and nothing asserted it was
    // still wired to anything.
    const social = parsed('./routes/login.tsx', 'authClient.signIn.social')
    expect(social.get('errorCallbackURL')?.getText()).toBe("'/login-error'")

    // Two levels, because the claim is about a nested option: `onAPIError` is a
    // top-level option of the betterAuth config, and `errorURL` is a property
    // of it. ABSOLUTE, via the template — this handler runs on the Convex
    // deployment, where a bare '/login-error' has no origin to resolve against.
    const onAPIError = parsed('../convex/auth.ts', 'betterAuth').get('onAPIError')
    expect(onAPIError, 'onAPIError is no longer an option on betterAuth({...})').toBeDefined()
    expect(propertiesOf(onAPIError!).get('errorURL')?.getText()).toBe('`${siteUrl}/login-error`')
  })

  test('the passcode expiry is interpolated from OTP_EXPIRY_LABEL, never written out', () => {
    // v1's copy says "1 hour". THIS DEPLOYMENT EXPIRES A CODE IN FIVE MINUTES —
    // convex/lib/otpExpiry.ts sets OTP_EXPIRY_SEC to 300, and that one module
    // both configures the emailOTP plugin and writes "It expires in 5 minutes"
    // in the code email. A number typed into this page instead would pass
    // src/login-error.test.ts today and start lying to users the day the
    // constant moves, telling someone with a forty-minute-old code that it
    // should still work.
    //
    // The SENTENCE, not "the label appears somewhere in the file": the import
    // surviving while the sentence hardcodes a digit is exactly the mutation
    // this is written against.
    //
    // THE IMPORT IS PINNED TO convex/lib/ AND NOT TO authEmails.ts. convex/lib/
    // is the directory that marks isomorphic code, and it is where every other
    // cross-boundary import in src/ comes from; reaching into a module that
    // also builds email HTML is how a server-only dependency ends up on a
    // browser route without anyone deciding to put it there.
    expect(loginError()).toMatch(/expire after \{OTP_EXPIRY_LABEL\}\./)
    expect(loginError()).toMatch(
      /import \{ OTP_EXPIRY_LABEL \} from '\.\.\/\.\.\/convex\/lib\/otpExpiry\.ts'/,
    )
  })

  test('nothing reads error_description, the one provider-supplied string here', () => {
    // Better Auth attaches BOTH `error` and `error_description` to the redirect
    // (dist/oauth2/errors.mjs). The code is machine-readable and matched
    // against an allowlist; the description is free text written by the
    // provider — in the production hit recorded on wordle-teams-vjh it was a
    // full AADSTS sentence. Reading it at all is the first step toward
    // rendering it, so the assertion is that the identifier does not appear in
    // the code at all. Comments are stripped by codeOf, and this file's prose
    // names it repeatedly, so a match here would be a real read.
    expect(loginError()).not.toMatch(/error_description/)
  })
})

/**
 * THE OTHER UPGRADE ENTRY POINT, WHICH HAD NO GATE AT ALL.
 *
 * Phase 7 Task 12 (`wordle-teams-6tp`) put an Upgrade button in the header and
 * wrote a jsdom suite for it, on the stated rule that "an entry point protected
 * only by e2e/billing.spec.ts can be deleted by a green pipeline"
 * (src/components/Header.hook.test.ts). team-picker.tsx's "Upgrade for more" —
 * the OLDER of the two, and still the only one a player at the free team limit
 * is looking at — was left in exactly that position.
 *
 * MEASURED, NOT ASSUMED. Two mutations of routes/app.tsx passed lint, typecheck
 * AND the full unit suite: replacing the handler with `() => {}`, which makes
 * the CTA a button that does nothing; and repointing it at
 * `api.polar.getCustomerPortalUrl`, which type-checks (both polar actions take
 * no arguments and answer a url-or-reason) and, on a deployment with no POLAR_*
 * set, produces an almost identical failure toast.
 *
 * THE PROP, NOT A `toMatch` OVER THE FILE — see test-support/source-ast.ts.
 * The dead-handler mutation leaves `startUpgrade` in the file, called from
 * nowhere, so a file-wide match keeps passing. Route modules cannot be imported
 * under vitest either (createFileRoute registers against a router that does not
 * exist), which is the constraint every block above works within.
 */
describe('the dashboard CTA reaches the CHECKOUT, and app.tsx is where that is decided', () => {
  const APP = './routes/app.tsx'
  const source = () => codeOf(read(APP))

  test("TeamPicker's onUpgrade is useStartUpgrade's startUpgrade", () => {
    // The prop as it is actually passed. `void` because the handler is sync and
    // startUpgrade returns a promise; that is app.tsx's spelling and it is
    // pinned here whole rather than matched loosely.
    expect(jsxProps(APP, 'TeamPicker').get('onUpgrade')).toBe('() => void startUpgrade()')
  })

  test('and `startUpgrade` is the shared hook, not a local pointed somewhere else', () => {
    // WITHOUT THIS, THE PROP ASSERTION ABOVE IS DEFEATED BY A RENAME: a local
    // `const startUpgrade = useConvexAction(api.polar.getCustomerPortalUrl)`
    // leaves the prop's text untouched. Both halves are needed, and neither is
    // the other's duplicate.
    expect(source()).toMatch(/const \{ startUpgrade \} = useStartUpgrade\(\)/)
    // The action this must never be. Header.tsx is the only place in v2 that
    // legitimately names it, and it is not this file.
    expect(source()).not.toMatch(/getCustomerPortalUrl/)
  })
})
/**
 * /chat WAS THE EXACT ROUTE THIS FILE'S OPENING COMMENT WARNS ABOUT.
 *
 * Part 2 built the whole surface — the route, the message list, the composer,
 * scrollback, the `unreadTeams` query and `UnreadBadge` itself — and linked to
 * none of it. Nothing under `src/` navigated to `/chat`, so typing the URL was
 * the only way in and the badge component rendered nowhere at all. All four
 * gates were green throughout, for the reason recorded at the top of this file:
 * lint, typecheck, `vitest run` and build cannot tell a route nothing links to
 * from dead code. `wordle-teams-qix.25` is that gap; this block is what keeps
 * it closed.
 *
 * ASSERTED ON THE SOURCE, LIKE EVERY BLOCK ABOVE, and for the same two reasons:
 * a route module cannot be imported under vitest, and this suite runs on
 * edge-runtime with NO DOM (`vitest.config.ts` includes only `*.test.ts`), so
 * rendering either component is not available here at any price.
 *
 * THE UNREAD DOT'S OWN LOGIC IS NOT TESTED HERE. `hasUnread` and
 * `chatEntryLabel` are pure and live in components/chat/use-chat-sync.ts, which
 * is where their tests are. What this block pins is the WIRING those functions
 * are useless without.
 */
describe('/chat is reachable from the app, which is the whole of wordle-teams-qix.25', () => {
  const APP = './routes/app.tsx'
  const PICKER = './components/team-picker.tsx'
  const CHAT = './routes/chat.tsx'
  // The badge component and the hook module behind it — not routes, but the
  // other two halves of the unread wiring asserted below.
  const BADGE = './components/chat/unread-badge.tsx'
  const SYNC = './components/chat/use-chat-sync.ts'

  // The two `<Link>`s in app.tsx's controls row: "Team settings" and this. A
  // `find` rather than an index, so reordering the row is not a failure.
  // `'"/chat"'` — a string attribute reads back with the quotes the source
  // wrote, which is `jsxElementsOf`'s documented behaviour.
  const chatLink = () => jsxElements(APP, 'Link').find((props) => props.get('to') === '"/chat"')

  test('the dashboard links to /chat, carrying the team being viewed', () => {
    // WITHOUT THE SEARCH PARAM THE LINK IS USELESS AND STILL LOOKS RIGHT:
    // routes/chat.tsx renders "No team selected." when `?team=` is absent, so a
    // `<Link to="/chat">` with no search prop is a working navigation to a dead
    // end. Pinned as the exact expression, not merely "some search prop".
    const link = chatLink()
    // Named, so a deleted or retargeted link fails as "there is no /chat link"
    // rather than as "undefined is not the search prop".
    expect(link, 'no <Link to="/chat"> in routes/app.tsx').toBeDefined()
    expect(link?.get('search')).toBe('{ team: teamParam }')
  })

  test('and it says which team has unread, since aria-label hides the dot inside it', () => {
    // `aria-label` REPLACES an element's content in the accessibility tree, so
    // the UnreadBadge rendered inside this button is decoration to a screen
    // reader whatever it says about itself — the button's own name is the only
    // place the unread state can be announced. A static "Team chat" here would
    // look correct, pass every gate, and silently take the badge away from
    // anyone not looking at the screen.
    //
    // BOTH ROW BUTTONS' NAMES, AS AN EXACT LIST, rather than "one of them is
    // the chat one": every Button in this file is icon-only below `sm`, so an
    // aria-label going missing from EITHER leaves an unnamed control, and a
    // `toContain` would not notice the other one changing. A string attribute
    // reads back with the quotes the source wrote.
    expect(jsxElements(APP, 'Button').map((props) => props.get('aria-label'))).toEqual([
      '"Team settings"',
      "chatEntryLabel(hasUnread(unreadTeams, teamParam as Id<'teams'>))",
    ])
  })

  test('the dashboard renders the dot for the team on screen', () => {
    expect(jsxProps(APP, 'UnreadBadge').get('teamId')).toBe("teamParam as Id<'teams'>")
  })

  test('and the team picker dots EVERY team, which is the placement that answers about the others', () => {
    // THE ONE THAT MATTERS MOST. The dashboard's badge can only ever speak
    // about the team already selected; this row is the only thing in the app
    // that can say another team has traffic. `team.id` — the row's own team,
    // not the selected one — is the whole of that difference, and pointing it
    // at `value` would type-check and render a plausible-looking menu.
    expect(jsxProps(PICKER, 'UnreadBadge').get('teamId')).toBe("team.id as Id<'teams'>")
  })

  test('and the CLOSED picker says another team has traffic, which is what makes those rows reachable', () => {
    // WITHOUT THIS THE ROW DOTS ARE UNREACHABLE AT REST. Radix unmounts
    // DropdownMenuContent when the menu is shut, so every per-team dot renders
    // nowhere until someone has already opened the menu — which is precisely
    // when they no longer need a signal telling them to open it. The trigger is
    // the only surface that can carry it, and the trigger has an `aria-label`,
    // which replaces its content in the accessibility tree and silences the dot
    // inside it. So the name is computed, exactly as the dashboard button's is.
    expect(jsxProps(PICKER, 'Button').get('aria-label')).toBe(
      'teamPickerLabel(name, unreadElsewhere)',
    )
    // NOT `hasUnread`, WHICH WOULD BE THE WRONG QUESTION and a plausible
    // "simplification": the selected team's unread is already shown by the
    // Team chat button beside the picker, so a trigger dot counting it would
    // draw two dots for one fact and sit lit while the reader is inside that
    // very conversation.
    expect(codeOf(read(PICKER))).toMatch(
      /const unreadElsewhere = hasUnreadElsewhere\(unread, selected\?\.id as Id<'teams'> \| undefined\)/,
    )
  })

  test("the trigger's dot is out of flow, so the picker's width cap is untouched", () => {
    // MEASURED, AND THE MEASUREMENT IS WHY THIS IS PINNED. The dashboard
    // controls row had exactly zero spare pixels at 390px before "Team chat"
    // joined it (see the flex-wrap note in routes/app.tsx). This trigger is
    // also capped at `max-w-[9.5rem]`, so an in-flow dot would not widen it —
    // it would eat into the width the team name is truncated to fit and clip
    // the label instead. `absolute` costs the row and the cap nothing.
    expect(jsxProps(PICKER, 'UnreadDot').get('className')).toBe('"absolute right-1 top-1"')
  })

  test('the controls row FITS a phone rather than wrapping on one, which no gate can see', () => {
    // THE ONE ASSERTION HERE THAT IS A PROXY FOR A MEASUREMENT, and it is
    // worth having because the measurement has no gate at all. e2e's
    // billing.spec.ts checks `scrollWidth - clientWidth <= 0` at 390x844 —
    // which a WRAPPED row satisfies perfectly. That is exactly how the row
    // reached the owner's phone with four controls on one line and the primary
    // "+" stranded on a second: green everywhere, broken on the device.
    //
    // Measured against the built stylesheet at 390x844 with the team name at
    // TeamPicker's cap: 401px of content into 374px before, 361px after. The
    // two trims are the cap below `sm` and this gap; both are restored at `sm`,
    // and neither touches BoardEntryButton. If you are changing either,
    // re-measure rather than deleting the test — routes/app.tsx carries the
    // table and the method.
    const row = codeOf(read(APP))
    expect(row).toMatch(/className="flex flex-wrap items-center gap-1\.5 sm:gap-2 md:col-span-3"/)
    expect(codeOf(read(PICKER))).toMatch(
      /className="relative max-w-\[7\.5rem\] px-2 text-xs sm:max-w-\[9\.5rem\] md:max-w-none md:px-4 md:text-sm"/,
    )
  })

  test('and it fits LANDSCAPE too, which is a different and wider problem', () => {
    // `lg`, NOT `sm`, AND THAT IS THE WHOLE FIX FOR wordle-teams-mkix. The
    // measurement above was taken at 390x844 portrait — the one orientation
    // this row is not widest in. Rotated, the viewport more than doubles, but
    // BoardEntryButton's own `useMediaQuery('(min-width: 768px)')` swaps the
    // icon-only trigger for the labelled one (48px -> 141px), TeamPicker and
    // MonthPicker take their `md` type scale, and `.page-max`'s gutter grows
    // 0.5rem -> 1.5rem a side. Re-measured the same way at every width rather
    // than one: 777px of content into 720px usable at 768, and into 750px at
    // 844 once landscape safe-area insets are accounted for. Two lines both
    // times, with the primary "+" alone on the second.
    //
    // Phone landscape IS the `md` band — 844 and 926 both live in it — so the
    // labels must not come back until `lg`, where the narrowest device is a
    // tablet. After the move: 565px into 720px at 768, 565px into 750px at 844
    // with insets, 777px into 976px at 1024. If you are moving these back to
    // `sm`, measure 768 and 844-with-insets first; `sm` is not the boundary
    // that binds.
    // `codeOf` strips comments, so app.tsx's own note — which quotes these
    // class strings while explaining them — cannot satisfy these assertions.
    const app = codeOf(read(APP))
    for (const label of ['Team settings', 'Team chat'])
      expect(app).toContain(`<span className="hidden lg:inline">${label}</span>`)
    // The padding travels with the label — an icon-only button that still took
    // `px-4` at `sm` would pay 32px a side for a label that is not there.
    expect(app).toContain('className="px-2 text-foreground lg:px-4"')
    expect(app).toContain('className="relative px-2 text-foreground lg:px-4"')
    // AND NOTHING TOOK IT OUT OF THE PRIMARY ACTION. BoardEntryButton keeps its
    // own end of the row; the two controls that yielded are the secondary ones.
    expect(app).toContain('<div className="ml-auto">')
  })

  test('and /chat is not a dead end: it goes back to the dashboard for the SAME team', () => {
    // THE RETURN LEG, WHICH IS THE OTHER HALF OF REACHABILITY. The route had
    // exactly one exit — the browser's own back button — and the app's other
    // team-scoped page (routes/team.tsx) has had a Link back to /app since it
    // was written. `search` is what makes it the same team: a bare `to="/app"`
    // lands on whatever the dashboard defaults to, which for someone who
    // followed a push notification into their SECOND team is the wrong one.
    const back = jsxElements(CHAT, 'Link').find((props) => props.get('to') === '"/app"')
    expect(back, 'no <Link to="/app"> in routes/chat.tsx').toBeDefined()
    expect(back?.get('search')).toBe('{ team: teamId }')
  })

  test('and it names the conversation from chatHeading, which has a not-loaded state', () => {
    // NOT `team?.name`, WHICH IS THE PLAUSIBLE WRONG VERSION: `teams` is
    // undefined until getMyTeams resolves and lacks the team entirely for an
    // outsider, and those two want different headings — a placeholder and a
    // generic title. Reading the name straight off the find would render an
    // empty heading for both and leak nothing about which case it was in.
    expect(jsxProps(CHAT, 'ChatHeader').get('heading')).toBe('chatHeading(teams, teamId)')
  })

  test('neither placement reaches convex/lib/chat.ts, which would ship auth.ts to the browser', () => {
    // THE BUG THIS COST AN AFTERNOON OF, recorded on convex/lib/chatLimits.ts:
    // lib/chat.ts -> access.ts -> auth.ts, which THROWS AT MODULE SCOPE without
    // SITE_URL. A module-scope throw is a side effect no bundler may
    // tree-shake, so one import drags the auth module into the client chunk and
    // kills the route. The CI grep for the throw string catches it in the
    // built bundle; this catches it in the file, where the fix is.
    for (const path of [APP, PICKER, CHAT]) {
      expect(read(path)).not.toMatch(/from '.*convex\/lib\/chat\.ts'/)
    }
  })

  /**
   * THE SHELL WIRING, WHICH IS PURE FUNCTIONS ATTACHED TO NOTHING WITHOUT IT.
   *
   * `hidesSiteFooter` and `shouldShowLoadOlder` are tested where they live
   * (lib/site-chrome.ts and components/chat/use-chat-sync.ts), and both would
   * stay green if __root.tsx rendered the footer unconditionally and
   * routes/chat.tsx handed the list the wrong number. Neither miswiring is visible to lint, typecheck
   * or build, and neither can be caught by rendering: this suite runs on
   * edge-runtime with no DOM. Same string-reading rationale as every block
   * above.
   */
  const ROOT = './routes/__root.tsx'

  test('the site footer is suppressed on /chat, and rendered from exactly one place', () => {
    const root = codeOf(read(ROOT))
    // WITHOUT THIS THE WHOLE LAYOUT IS UNDONE. /chat bounds itself to the
    // viewport so the message list scrolls and the composer stays on the
    // bottom edge; a footer under that makes the PAGE scroll instead and
    // pushes the composer off screen, which is the phone screenshot this task
    // started from.
    expect(root).toMatch(/\{hidesSiteFooter\(pathname\) \? null : <Footer \/>\}/)
    // ONCE. The Footer moved out of RootDocument — the root route's
    // `shellComponent`, rendered outside the match context — to become
    // conditional at all. A copy left behind would render it on /chat anyway
    // and look, in the diff, like the gate had been added.
    expect(root.match(/<Footer \/>/g)).toHaveLength(1)
  })

  test('and the root reaches lib/ for that rule, never into the chat module', () => {
    /**
     * A BUNDLING ASSERTION WEARING A TEST'S CLOTHES (wordle-teams-qix.26).
     * `hidesSiteFooter` shipped inside components/chat/use-chat-sync.ts, so
     * __root.tsx — the one route present in every chunk graph there is —
     * imported a chat module. Rollup hoisted use-chat-sync into a chunk shared
     * between the entry and /chat, and every visitor to the marketing pages
     * downloaded chat's pointer sync and its Convex api imports to answer one
     * string comparison about a pathname.
     *
     * NEITHER HALF IS SUFFICIENT ALONE. Asserting only the lib import would be
     * satisfied by an __root.tsx that imported BOTH; asserting only the absence
     * would be satisfied by deleting the gate, which restores the broken
     * layout the test above pins.
     */
    const root = read(ROOT)
    expect(root).toMatch(/import \{ hidesSiteFooter \} from '#\/lib\/site-chrome\.ts'/)
    expect(root).not.toMatch(/from '#?\/?.*components\/chat\//)
  })

  test("and the load-older gate reads the LIVE window's length, not the merged list", () => {
    // `shown` HAS SCROLLBACK MERGED INTO IT and crosses RECENT_WINDOW the
    // moment anyone loads one page, so it answers "have we got 30 messages on
    // screen" rather than "did recentMessages come back full" — which is the
    // only question that proves there is no history behind the window. Passing
    // it would type-check, render, and quietly restore the always-on button.
    expect(jsxProps(CHAT, 'MessageList').get('windowLength')).toBe('messages.length')
  })

  /**
   * ONE SUBSCRIPTION FOR EVERY DOT ON THE PAGE, AND SINCE wordle-teams-pnhe,
   * ONE OBSERVER OF IT.
   *
   * wordle-teams-w7g2 made the team ids the query key, so a caller that derived
   * its own list — or the same list in a different order — opened a SECOND
   * Convex subscription and ran the query twice for one answer, with nothing
   * about it visible in lint, typecheck, tests or the built bundle.
   *
   * pnhe raised the stakes from cost to correctness. `useUnreadTeams` now SHEDS
   * that subscription while chat is degraded, and shedding means
   * `queryClient.removeQueries` — @convex-dev/react-query closes its websocket
   * watch on the cache's `removed` event and deliberately not on
   * `observerRemoved`. Remove a query a second component is still observing and
   * TanStack rebuilds it and refetches on the spot, so the socket the valve just
   * closed comes straight back. Sharing a key was enough to share a
   * subscription; it is not enough to remove one. ONE CALLER IS THE
   * PRECONDITION, and routes/chat.tsx gave up its own `useChatPointer` call for
   * the identical reason.
   *
   * So the wiring is pinned in four parts: the query is named in exactly one
   * module, CALLED from exactly one component, the ids are derived exactly once,
   * and both consumers are handed the ANSWER rather than reading it themselves.
   */
  test('every unread dot shares ONE subscription, and exactly one component observes it', () => {
    // PART ONE: one module names the query. `useUnreadTeams` is the only place
    // the args expression is written, so there is no second spelling of it to
    // drift.
    for (const path of [APP, PICKER, BADGE]) {
      expect(codeOf(read(path))).not.toMatch(/api\.chat\.unreadTeams/)
    }
    expect(codeOf(read(SYNC))).toMatch(/convexQuery\(api\.chat\.unreadTeams,/)

    // PART TWO: one component CALLS it. This is the part that stopped being
    // optional in pnhe — a second `useUnreadTeams` anywhere in src/ is a second
    // observer, and a second observer silently defeats the shed.
    expect(codeOf(read(APP))).toMatch(/useUnreadTeams\(teamIds\)/)
    for (const path of [PICKER, BADGE]) {
      expect(codeOf(read(path))).not.toMatch(/useUnreadTeams/)
    }

    // PART THREE: derived once, in the one component that already holds the
    // teams. `unreadTeamIds` sorts, which is what makes the key a function of
    // the SET rather than of render order — see its own tests.
    expect(codeOf(read(APP))).toMatch(/const teamIds = unreadTeamIds\(teams\)/)

    // PART FOUR: the ANSWER, not a second read of it, reaches both consumers.
    // `'unreadTeams'` bare — the local name app.tsx binds it to — because a
    // `useUnreadTeams(...)` inline here would type-check and render an
    // identical page.
    expect(jsxProps(APP, 'TeamPicker').get('unread')).toBe('unreadTeams')
    expect(jsxProps(APP, 'UnreadBadge').get('unread')).toBe('unreadTeams')
    expect(jsxProps(PICKER, 'UnreadBadge').get('unread')).toBe('unread')
  })
})

/**
 * NO ROUTE FILE MAY EXPORT THE COMPONENT IT ROUTES TO (wordle-teams-xsrv).
 *
 * @tanstack/router-plugin rewrites `component:` into a lazy reference so the
 * page's markup ships in a chunk of its own. It cannot do that to a declaration
 * the module also exports — and on the version pinned here it does not warn
 * about the conflict, it simply declines to split the file at all. The symptom
 * is entirely invisible from the source: src/routes/maintenance.tsx read
 * perfectly well while its markup sat inside dist/client/assets/index-*.js, the
 * 468 kB entry chunk every visitor downloads, and /maintenance was the only
 * route in the app with no chunk of its own. Every gate was green.
 *
 * WHY THAT IS WORTH A GUARD RATHER THAN A CODE REVIEW. Splitting is what
 * contained a real production fault: a module-scope throw rode into the client
 * behind one imported constant, and because /chat is a lazily loaded chunk it
 * broke /chat and nothing else. The same throw in a chunk shared by every route
 * is the whole site down. A route that opts out of splitting is a route whose
 * next such bug is everyone's.
 *
 * IT IS THE ROUTED IDENTIFIER, NOT ALL EXPORTS, and the distinction is real
 * rather than pedantic. login-error.tsx exports `LoginErrorPage` and is FINE:
 * its `component:` names a small non-exported wrapper, so the compiler has
 * something it is allowed to move, and the markup is measurably inside
 * login-error-*.js rather than the entry. Banning every named export would have
 * been red on a file with no defect, and a guard that cries wolf gets deleted.
 */
describe('a route file does not export the component it routes to', () => {
  // THE DIRECTORY AS THE PATHSPEC, NOT A `**` GLOB. git's default matching is
  // fnmatch without FNM_PATHNAME, so `*` already crosses slashes and
  // `src/routes/**/*.tsx` therefore REQUIRES a subdirectory — it silently
  // matches none of the fourteen route files that sit directly in src/routes/,
  // and the vacuity check below is what caught that.
  const routeFiles = execSync('git ls-files src/routes', { encoding: 'utf8' })
    .split('\n')
    .filter((file) => file.endsWith('.tsx'))

  test('there are route files to check, so this cannot pass vacuously', () => {
    expect(routeFiles.length).toBeGreaterThan(5)
  })

  for (const file of routeFiles) {
    test(file, () => {
      const code = codeOf(read(`./${file.replace(/^src\//, '')}`))
      // A REGEX RATHER THAN optionsPassedTo, because that helper THROWS on a
      // file with no createFileRoute call at all and this loop has to survive
      // __root.tsx and the api/ routes. Comments are already stripped, so the
      // prose above cannot match itself.
      //
      // A route with no `component:` — /me is a beforeLoad redirect and nothing
      // else — has nothing to split and nothing to get wrong.
      const routed = code.match(/\bcomponent:\s*([A-Za-z_$][\w$]*)\s*[,}\n]/)
      if (!routed) return
      const component = routed[1]

      expect(
        new RegExp(
          `export\\s+(?:default\\s+)?(?:async\\s+)?(?:function|const|let|class)\\s+${component}\\b`,
        ).test(code),
        `${file} exports ${component}, which is what it routes to — the router plugin then cannot code-split the file, and the page ships in the entry chunk every visitor downloads. Move it to a component file and import it.`,
      ).toBe(false)

      // The other spelling, `export { X }`, which the pattern above cannot see.
      expect(
        new RegExp(`export\\s*\\{[^}]*\\b${component}\\b[^}]*\\}`).test(code),
        `${file} re-exports ${component} in an export list — the same defect as declaring it exported`,
      ).toBe(false)
    })
  }
})
