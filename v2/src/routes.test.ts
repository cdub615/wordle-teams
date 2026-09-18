import { execSync } from 'node:child_process'
import { existsSync, readFileSync } from 'node:fs'
import { describe, expect, test } from 'vitest'
import ts from 'typescript'
import {
  callSitesOf,
  codeOf,
  initializerOf,
  orderedIn,
  jsxElementsOf,
  jsxPropsOf,
  objectLiteralReturnedBy,
  optionsPassedTo,
  parseSource,
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

/** The same, for options a function RETURNS rather than a call receives. */
const returned = (path: string, identifier: string) =>
  objectLiteralReturnedBy(path, read(path), identifier)

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

const INSIGHTS = './routes/insights.tsx'

/**
 * THE READER IS NOT THROWN TO THE TOP WHEN THEY CHANGE TEAM OR MONTH
 * (wordle-teams-wty4.1.16).
 *
 * Owner-reported: "changing team or month on the insights page jumps you back
 * up to the top". The router runs with `scrollRestoration: true` (router.tsx),
 * so every navigation resets scroll unless it says otherwise, and these two
 * did not.
 *
 * THE ASYMMETRY WITH /app IS THE POINT, AND IS WHY THIS IS PINNED RATHER THAN
 * LEFT TO READ AS OBVIOUS. routes/app.tsx deliberately does NOT pass this flag
 * on its own TeamPicker and MonthPicker, and says so: those sit at the top of
 * the grid, so resetting scroll costs nothing. InsightsPanel renders its team
 * section below the personal and openers panels — insights-daily measured at
 * 1233px (wordle-teams-m08r) — so the same rule gives the opposite answer here.
 * Someone reconciling the two pages could "fix" the inconsistency in either
 * direction; this is what makes doing it in the wrong one fail.
 *
 * ASSERTED BY CONTENT, NOT AS ONE EXACT STRING, exactly as
 * team-boards.hook.test.ts does for the dashboard's day navigation: the
 * handlers are multi-line object literals and pinning their formatting would
 * make this fail on a prettier run.
 *
 * IT CANNOT SEE THE CONSEQUENCE AND DOES NOT PRETEND TO. jsdom has no scroll
 * restoration and no router here. The comment on `TeamBoards`' own
 * `onMonthChange` in routes/app.tsx records that an e2e for this was
 * written, found not to discriminate, and deleted rather than left looking like
 * coverage — Playwright scrolls a target into view before clicking it and
 * treats anything near the top as obscured by the sticky header, so the
 * before/after positions are the harness's own. The behaviour was verified by
 * intercepting `window.scrollTo`, which is the technique that comment
 * recommends; this pins the flag so it cannot quietly go away afterwards.
 */
describe('/insights keeps the reader where they were', () => {
  test('both the team and the month navigation opt out of scroll reset', () => {
    const props = jsxProps(INSIGHTS, 'TeamSection')

    const onTeamChange = props.get('onTeamChange') ?? ''
    expect(onTeamChange).toContain('navigate(')
    expect(onTeamChange).toContain('search: { team, month: monthParam }')
    expect(onTeamChange).toContain('resetScroll: false')

    const onMonthChange = props.get('onMonthChange') ?? ''
    expect(onMonthChange).toContain('navigate(')
    expect(onMonthChange).toContain('search: { team: teamParam, month }')
    expect(onMonthChange).toContain('resetScroll: false')
  })
})

/**
 * THE LOCKED CARD'S INVITE CTA OPENS THE INVITE DIALOG ON /insights, AND DOES
 * NOT NAVIGATE TO /team.
 *
 * The same defect and the same fix as the "onboarding invite task" block
 * below, on a second call site: a locked card's whole job is showing a solo
 * player what a team would give them, so sending them to /team to act on it
 * takes them off the screen they were converting on, and `navigate({ to:
 * '/team', search: { team: teamParam } })` type-checks, lints, builds and
 * passes every unit test either way. It is the PROP that has to be pinned: a
 * prop repointed at `() => undefined` defeats presence and absence alike —
 * the file would still compile, still build, and still say nothing about
 * `/team`, which is exactly what a passing `toMatch` either way would miss.
 *
 * BOTH ENDS, FOR THE SAME REASON: a prop reading `() => setInviteOpen(true)`
 * with no dialog mounted anywhere is a button that does nothing at all, and
 * that is a worse outcome than the navigation it replaced.
 */
describe('the locked card opens the invite dialog in place', () => {
  test("TeamSection's onInvite opens the dialog rather than leaving the page", () => {
    expect(jsxProps(INSIGHTS, 'TeamSection').get('onInvite')).toBe('() => setInviteOpen(true)')
  })

  test('and /insights actually mounts an InvitePlayerDialog for it to open', () => {
    // `jsxElements` rather than a text match: a bare import left behind by a
    // deleted element keeps the identifier in the file.
    const dialogs = jsxElements(INSIGHTS, 'InvitePlayerDialog')
    expect(dialogs, 'routes/insights.tsx mounts no InvitePlayerDialog').toHaveLength(1)
    const props = dialogs[0]
    expect(props.get('open')).toBe('inviteOpen')
    expect(props.get('onOpenChange')).toBe('setInviteOpen')
    // The team it is addressed to, named rather than defaulted — same reason
    // as routes/app.tsx's own mount: a `?? ''` here would render a dialog
    // titled "Invite Player to " for a team that is not on the payload.
    expect(props.get('teamName')).toBe('selectedTeam.name')
    expect(props.get('teamId')).toBe('selectedTeam.id')
  })

  test('and onUpgrade reaches checkout, not a dead handler or the wrong action', () => {
    // THE SAME MEASUREMENT AS THE "dashboard CTA" BLOCK BELOW, applied to the
    // call site that block does not cover: /insights' locked card is the
    // upsell for every free member of a team with more than one player — the
    // majority case — and until this test existed its `onUpgrade` had no
    // route-level pin at all, unlike /app's identical expression.
    expect(jsxProps(INSIGHTS, 'TeamSection').get('onUpgrade')).toBe('() => void startUpgrade()')
    expect(codeOf(read(INSIGHTS))).toMatch(/const \{ startUpgrade \} = useStartUpgrade\(\)/)
    expect(codeOf(read(INSIGHTS))).not.toMatch(/getCustomerPortalUrl/)
  })
})

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
    // top-level option of the Better Auth config, and `errorURL` is a property
    // of it. ABSOLUTE, via the template — this handler runs on the Convex
    // deployment, where a bare '/login-error' has no origin to resolve against.
    //
    // READ OFF `createAuthOptions` RATHER THAN `betterAuth({...})`, which is
    // where these options lived until the local Better Auth component needed to
    // import them too. `betterAuth(createAuthOptions(ctx))` passes no literal
    // for `optionsPassedTo` to find; the literal is the one this function
    // returns, and `objectLiteralReturnedBy` is `optionsPassedTo`'s counterpart
    // for that shape. The mutation both are written against is unchanged —
    // lifting `onAPIError` out into a detached `const` still fails here.
    const onAPIError = returned('../convex/auth.ts', 'createAuthOptions').get('onAPIError')
    expect(onAPIError, 'onAPIError is no longer an option in createAuthOptions').toBeDefined()
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
    // lib/chat.ts -> access.ts -> auth.ts, so one import drags the whole Better
    // Auth server surface into the client chunk. It used to KILL the route —
    // auth.ts threw at module scope without SITE_URL and a module-scope throw
    // is a side effect no bundler may tree-shake — until a5d5c3f0 moved that
    // check into `createAuth`, which the Convex component required. The import
    // is now silent bundle bloat, and still wrong.
    //
    // THIS IS THE NARROW VERSION: three named files, one direct specifier.
    // src/frontend-import-graph.test.ts is the general one — it walks the graph
    // from every file under src/ and reports the chain — and it took over from
    // the dist/client grep in deploy-v2.yml, which was looking for the throw
    // string a5d5c3f0 deleted. This block stays because these three files are
    // where the mistake is actually tempting to make.
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
 * ONE OPINION ABOUT WHO IS ON THE ROSTER, AND IT IS NOT IN THIS ROUTE.
 *
 * WHAT GOES WRONG IF THERE ARE TWO. Chat resolves an author's NAME and their
 * AVATAR from the same roster. If those two lookups ever disagree, the specific
 * way it surfaces is a FACE beside the words "Former member" — handing back
 * exactly the identity that label exists to withhold.
 *
 * WHY A STATIC CHECK AND NOT A UNIT TEST. src/lib/chat-roster.test.ts pins what
 * `rosterEntryFor` ANSWERS, including that a departed author never comes back
 * with a record. What it structurally cannot pin is a SECOND lookup that agrees
 * with the first today: two finds that return the same member for every input
 * are behaviourally identical, so no assertion over behaviour can see the
 * difference — measured, with a mutant that split the resolution in two and
 * survived all five of that file's tests. The divergence is a source property,
 * so it is asserted against the source.
 *
 * THIS IS THE ASSERTION THAT ACTUALLY FAILS ON THE LIKELY EDIT: a mention, a
 * reaction or a read-receipt needing a member, and the obvious
 * `team.members.find(...)` written inline next to the call that already has the
 * answer. That edit compiles, lints, builds and passes every other test in this
 * repo.
 *
 * `codeOf` STRIPS COMMENTS FIRST, which is not incidental — routes/chat.tsx
 * discusses `members.find` in prose precisely because it must not call it, and
 * a raw-source regex would fail on the sentence explaining the rule.
 */
describe('chat holds exactly one opinion about who is on the roster', () => {
  const CHAT = './routes/chat.tsx'

  test('routes/chat.tsx resolves an author through rosterEntryFor and never finds a member itself', () => {
    const source = codeOf(read(CHAT))

    // Optional chaining and whitespace included: `team?.members .find(` is the
    // same second opinion written differently, and a literal-substring check
    // would wave it through.
    expect(source).not.toMatch(/members\s*\??\s*\.\s*find\b/)
    expect(source).toMatch(/\brosterEntryFor\b/)
  })
})

/**
 * `/join/$token`, THE ROUTE WHOSE URLs LIVE IN OTHER PEOPLE'S CHAT HISTORIES.
 *
 * THE SAME CRITERION AS `/me` AT THE TOP OF THIS FILE, arrived at by a
 * different road. `/me` is pinned because installed PWAs have it burned in;
 * this is pinned because an invite link is pasted into a chat, a group thread
 * or an email and then sits there, outside this repo and outside anyone's
 * ability to reissue it. Rename the path and `routeTree.gen.ts` regenerates
 * happily, all four gates stay green, and every link already shared 404s with
 * no symptom on this side at all. Nothing in `src/` links here either — the
 * URL is produced by a share sheet and consumed by a stranger — so it is dead
 * code to lint, typecheck, `vitest run` and build alike.
 *
 * THE PARAM IS PART OF THE PATH, which is why the generated tree is asserted
 * as `/join/$token` rather than "a route starting /join". This is the app's
 * first NAMED `$param` route (the splat at `/api/auth/$` predates it), and
 * TanStack's generator nests on any shared path prefix — the hazard recorded
 * at routes/team.tsx:30-45 — so a later `join.tsx` beside this file would
 * reparent it and change the URL without touching this source.
 *
 * WHAT ELSE IS PINNED HERE, AND WHAT DELIBERATELY IS NOT. The mechanics of the
 * token itself — sessionStorage over localStorage, the read that clears, the
 * throw-safety — moved to lib/pending-invite.ts and are EXECUTED in
 * lib/pending-invite.test.ts, which is worth more than any assertion this file
 * could make about them. What is left here is the WIRING those functions are
 * useless without, and it is exactly the part no gate can see: that both
 * branches reach `rememberPendingInvite`, that the dashboard reaches
 * `takePendingInvite` before it spends anything, and that neither file went
 * back to writing storage out of a `beforeLoad` that never runs in a browser.
 *
 * SOURCE ASSERTIONS, LIKE EVERY BLOCK ABOVE, AND WITH THE SAME LIMIT. A route
 * module cannot be imported under vitest — createFileRoute registers against a
 * router that does not exist — and `Dashboard` is not exported from
 * routes/app.tsx (the guard below forbids it), so the effect that spends the
 * token cannot be rendered here at any price. Lifting that effect into `lib/`
 * as its own hook, the way useStartUpgrade was, is filed rather than done.
 */
describe('/join/$token, the route shared invite links point at', () => {
  const JOIN = './routes/join.$token.tsx'
  const APP = './routes/app.tsx'
  // Read inside each test rather than at describe scope, so a deleted file is
  // a named assertion failure instead of a bare ENOENT during collection.
  const source = () => codeOf(read(JOIN))
  const app = () => codeOf(read(APP))

  test('exists as a route file, and is still the /join/$token route', () => {
    expect(
      existsSync(new URL(JOIN, import.meta.url)),
      'src/routes/join.$token.tsx is gone. It is not dead code — every invite ' +
        'link ever shared points at it; see the note above.',
    ).toBe(true)
    expect(source()).toMatch(/createFileRoute\(\s*['"]\/join\/\$token['"]\s*\)/)
  })

  test('is in the generated route tree, at /join/$token and not under a /join parent', () => {
    // The generated tree pins the URL independently of the file's name, so a
    // rename or a move still goes red here. Both the `path` and the `id` are
    // checked: the generator writes an `id` of `/join/$token` for a top-level
    // route and a nested one would carry a different id under its parent.
    const tree = read('./routeTree.gen.ts')
    expect(tree).toMatch(/path: '\/join\/\$token'/)
    expect(tree).toMatch(/id: '\/join\/\$token'/)
  })

  test('sends a signed-in holder to /app and a signed-out one to /login, and nowhere else', () => {
    // Every `to:` in the file, in source order, for the reason spelled out in
    // the /me block: a `toContain` goes on passing when the real target moves
    // and the old one is left behind in a branch nothing reaches.
    const targets = [...source().matchAll(/to:\s*['"]([^'"]*)['"]/g)].map((match) => match[1])
    expect(targets).toEqual(['/app', '/login'])
  })

  test('and hands the signed-in one the token in the URL, which is the fast carrier', () => {
    // Without the search param the signed-in branch is a navigation to a
    // dashboard that has nothing to spend — it would fall back to the stash,
    // which works, and would quietly make the faster path dead code.
    expect(source()).toMatch(/\{ to: '\/app', search: \{ join: token \}, replace: true \}/)
  })

  test('NEITHER route writes storage from a beforeLoad, because that never runs in a browser', () => {
    /**
     * THE DEFECT THIS ROUTE SHIPPED WITH FOR ONE AFTERNOON, AND THE ONLY THING
     * STANDING BETWEEN IT AND THE OBVIOUS REWRITE.
     *
     * Stashing the token in `beforeLoad` and throwing `redirect({ to:
     * '/login' })` — guarded on `typeof window !== 'undefined'`, which reads
     * like diligence — is unreachable on the one path this route exists for.
     * A link in a chat message is a FRESH DOCUMENT LOAD, TanStack Start turns
     * a beforeLoad redirect during SSR into a 307 on the wire, and a 307 with
     * `content-length: 0` delivers no document and runs no client code. The
     * `setItem` executed on nobody. Measured; the curl and its response are in
     * routes/join.$token.tsx's own comment.
     *
     * All four gates were green on that version, and so was every assertion in
     * this block except this one — which is why it exists. `beforeLoad` is
     * where an author reaches first, and the symptom is silent: the holder
     * still reaches /login, signs in, and simply never joins the team.
     *
     * THE WHOLE FILE, NOT JUST THE STASH. This route now has no `beforeLoad`
     * at all, exactly as routes/home.tsx has none, and for a comparable
     * reason: there is nothing it could do here that would not be a server-only
     * decision about a client-only fact.
     */
    expect(
      source(),
      'routes/join.$token.tsx has grown a beforeLoad. On a fresh document load ' +
        'that runs only on the server, where there is no sessionStorage to write ' +
        'and no client code to follow a redirect — see the note above.',
    ).not.toMatch(/beforeLoad/)
    // And the dashboard end, where a beforeLoad DOES legitimately exist: the
    // token must not be read from it either, for the identical reason.
    const appBeforeLoad = app().slice(app().indexOf('beforeLoad:'), app().indexOf('loader:'))
    expect(appBeforeLoad).not.toMatch(/PendingInvite/)
  })

  test('both branches stash the token, since /complete-profile drops the search param', () => {
    // THE GAP THIS CLOSED. `/app`'s beforeLoad redirects an account with no
    // players row to /complete-profile, and that redirect drops `?join=` — so
    // anyone who authenticated and abandoned onboarding half way followed a
    // link, was told they were joining a team, and completed their profile into
    // nothing. That population is the reason this epic exists.
    //
    // ONE UNCONDITIONAL CALL, OUTSIDE THE BRANCH, which is the whole claim: a
    // `rememberPendingInvite` inside the `else` reads as correct, keeps the
    // signed-out path working, and restores the bug exactly.
    const code = source()
    expect(code.match(/rememberPendingInvite\(token\)/g) ?? []).toHaveLength(1)
    const remembered = code.indexOf('rememberPendingInvite(token)')
    const branched = code.indexOf('isAuthenticated')
    // Stashed BEFORE the navigation decision is even read, so there is no
    // branch it can be inside.
    expect(remembered).toBeGreaterThan(-1)
    expect(remembered).toBeLessThan(code.indexOf('void navigate('))
    expect(branched).toBeGreaterThan(-1)
  })

  test('the dashboard hands the invite to the hook, and spends what it hands back', () => {
    /**
     * WHAT THIS FILE CAN STILL SEE, AND DELIBERATELY NO MORE (wordle-teams-3jdu).
     *
     * Three source assertions used to live here: that `takePendingInvite()` is
     * called before `.mutateAsync(`, that `?join=` is deleted and replaceState'd
     * before it too, and that the token is read from `window.location` rather
     * than the router. All three compared indexOf positions in this file's TEXT.
     * They pinned the spelling, not the property — rename a local and they fail
     * for nothing; restructure the effect and they pass while the property is
     * gone.
     *
     * Those mechanics now live in lib/use-pending-invite.ts and are EXECUTED by
     * lib/use-pending-invite.hook.test.ts, which drives the real hook through
     * renderHook: which carrier wins, that both are emptied, that the address bar
     * is already stripped at the moment the token is handed over, and that a
     * blocked store does not stop a URL-carried invite.
     *
     * WHAT REMAINS IS WIRING, which is the one thing a hook test cannot see: that
     * this route actually CALLS the hook, and that what the hook hands back is
     * what gets spent. A perfectly-tested hook nobody calls is the failure mode
     * this block exists for — the same argument the startUpgrade block above
     * makes.
     */
    const code = app()
    expect(code, 'routes/app.tsx does not call usePendingInvite').toMatch(
      /usePendingInvite\(joinParam,/,
    )
    // The token the hook hands over is the one consumed, rather than some other
    // value in scope. `joinParam` here would compile and would reinstate the
    // exact double-consume the hook exists to prevent.
    //
    // THE SHORTHAND IS THE ASSERTION. `{ token,` can only be the parameter this
    // callback was handed; `{ token: joinParam,` would not match. The trailing
    // comma rather than a closing brace is because the call now also carries
    // `today` — consumeLink recomputes the joined team's months and bounds the
    // date it does it with (wordle-teams-c5ry).
    expect(code).toMatch(/\.mutateAsync\(\{ token,/)
    expect(code).toMatch(/today: toPuzzleDay\(new Date\(\)\)/)
    // ONE mutateAsync in the file, so the assertion above is about this call and
    // not another that happens to match.
    expect(code.match(/\.mutateAsync\(/g) ?? []).toHaveLength(1)
    // AND THE EFFECT IS REALLY GONE, not merely joined by a hook call. A leftover
    // copy would spend every token twice, and both would look correct in review.
    expect(code).not.toMatch(/takePendingInvite/)
    expect(code).not.toMatch(/searchParams\.delete\('join'\)/)
  })

  test('the key lives in lib/, and neither route file spells it', () => {
    // The write and the read are in different route modules, and a key spelled
    // twice is a key that can be spelled differently once — the write succeeds,
    // the read finds nothing, and the invite is lost with nothing to see. lib/
    // is where every other cross-route constant lives (SIGNIN_PARAM,
    // STORAGE_KEY), and the storage mechanics went with it.
    expect(source()).toMatch(
      /import \{ rememberPendingInvite \} from '#\/lib\/pending-invite\.ts'/,
    )
    // app.tsx reaches the storage helpers only THROUGH the hook now
    // (wordle-teams-3jdu), so it no longer imports pending-invite at all — but
    // the invariant this test is about is unchanged, and now covers the hook too.
    expect(app()).toMatch(/import \{ usePendingInvite \} from '#\/lib\/use-pending-invite\.ts'/)
    for (const code of [source(), app(), codeOf(read('./lib/use-pending-invite.ts'))]) {
      expect(code).not.toMatch(/wt\.pendingInviteToken/)
      // NOR THE STORE ITSELF. A route reaching straight for sessionStorage is
      // how the wrapped, tested helpers get bypassed by something that reads
      // like an obvious inline simplification.
      expect(code).not.toMatch(/sessionStorage|localStorage/)
    }
  })
})

/**
 * THE ONBOARDING CARD'S INVITE TASK OPENS A DIALOG ON /app, AND DOES NOT
 * NAVIGATE TO /team.
 *
 * The task existed before the dialog did, and pointed at `/team` because that
 * is where the only InvitePlayerDialog in the app was mounted
 * (current-team-card.tsx). Repointing it is the whole of the UI half of this
 * epic, and it is INVISIBLE TO EVERY OTHER GATE: `navigate({ to: '/team',
 * search: { team: teamParam } })` type-checks, lints, builds and passes every
 * unit test, because /team is a real route with a real invite control on it.
 * Reverting the prop takes the person off the screen they were converting on
 * and nothing goes red.
 *
 * A `toMatch` OVER THE FILE CANNOT DO THIS JOB. app.tsx legitimately navigates
 * to `/team` from three other places — the "Team settings" <Link>, the chat
 * row's sibling <Link>, and ScoringLegend's onEdit — so "does the file mention
 * /team" is true either way. It is the PROP that has to be pinned, which is
 * what src/test-support/source-ast.ts exists for.
 *
 * BOTH ENDS, LIKE THE startUpgrade BLOCK ABOVE: the prop's text, and the
 * element it hands the state to. A prop reading `() => setInviteOpen(true)`
 * with no dialog mounted anywhere is a button that does nothing at all, and
 * that is a worse outcome than the navigation it replaced.
 */
describe('the onboarding invite task opens the invite dialog in place', () => {
  const APP = './routes/app.tsx'

  test("NextStepCard's onInvite opens the dialog rather than leaving the page", () => {
    expect(jsxProps(APP, 'NextStepCard').get('onInvite')).toBe('() => setInviteOpen(true)')
  })

  test('and the dashboard actually mounts an InvitePlayerDialog for it to open', () => {
    // `jsxElements` rather than a text match: a bare import left behind by a
    // deleted element keeps the identifier in the file.
    const dialogs = jsxElements(APP, 'InvitePlayerDialog')
    expect(dialogs, 'routes/app.tsx mounts no InvitePlayerDialog').toHaveLength(1)
    const props = dialogs[0]
    expect(props.get('open')).toBe('inviteOpen')
    expect(props.get('onOpenChange')).toBe('setInviteOpen')
    // The team it is addressed to, named rather than defaulted. `selectedTeam`
    // guards the mount for the same reason: a `?? ''` here would render a
    // dialog titled "Invite Player to " for a team that is not on the payload.
    expect(props.get('teamName')).toBe('selectedTeam.name')
    expect(props.get('teamId')).toBe("teamParam as Id<'teams'>")
  })

  test('/team keeps its own, so this is a second entry point and not a move', () => {
    // The one CurrentTeamCard hosts is untouched: the epic's rule is that the
    // existing route works exactly as it did. Two mounts of one dialog is safe
    // ONLY because they are on different routes and can never be mounted
    // together — the reason two CreateTeamDialogs were refused earlier.
    expect(codeOf(read('./components/teams/current-team-card.tsx'))).toMatch(
      /<InvitePlayerDialog/,
    )
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

/**
 * THE LAST-USED SIGN-IN BADGE, WHERE IT IS WRITTEN AND WHERE IT IS PROMOTED
 * (wordle-teams-ilej).
 *
 * THE BEHAVIOURAL HALF IS src/lib/last-login.test.ts, which executes the two
 * keys against a fake store. What it cannot see is the part that makes them
 * correct: WHICH MOMENTS the two functions are called at. Both route modules
 * are unrenderable under vitest, so the source is the artefact again.
 *
 * AND THE MOMENTS ARE THE WHOLE DESIGN. `rememberLoginAttempt` moved one line
 * later in signInWith — after the `await`, into the error branch — records an
 * attempt only when the redirect FAILED, which is the exact inversion of the
 * feature; every gate stays green and the badge quietly starts naming whichever
 * provider was broken. `promoteLoginAttempt` moved out of the `?signin=` effect
 * into an unguarded one promotes a stale attempt on any later visit with a live
 * session, which is the bounce case the two keys exist to exclude. Neither is
 * visible as a diff to anything that reads whole-file text.
 */
describe('the last-used sign-in badge is written on attempt and promoted on arrival', () => {
  const LOGIN = './routes/login.tsx'
  const APP = './routes/app.tsx'
  const PROFILE = './routes/complete-profile.tsx'
  const login = () => codeOf(read(LOGIN))

  test('the attempt is recorded at exactly three places, one per sign-in path', () => {
    // Six methods, three code paths: four providers share `signInWith`, the
    // email code has its own, and the passkey button has its own. A fourth site
    // is either a new path that needs its own reasoning or a duplicate that
    // will fight the others.
    //
    // THE NUMBER IS THE TRIPWIRE AND IS DELIBERATELY NOT `toBeGreaterThan`.
    // Loosening it is exactly what would let the NEXT sign-in method ship with
    // no attempt recorded and no badge — a failure with no symptom, since the
    // badge simply goes on naming whatever worked last.
    expect(callSitesOf(LOGIN, read(LOGIN), 'rememberLoginAttempt')).toHaveLength(3)
  })

  test('the provider attempt is recorded BEFORE the handoff, not after it', () => {
    const [site] = callSitesOf(LOGIN, read(LOGIN), 'rememberLoginAttempt').filter((call) =>
      call.within.includes('authClient.signIn.social'),
    )
    expect(site, 'no rememberLoginAttempt in the function that calls signIn.social').toBeDefined()

    // ORDER INSIDE THE ONE FUNCTION BODY, which is what "before the handoff"
    // means. Once signIn.social redirects, nothing in this module runs again —
    // the same reason login_provider_click is emitted there, stated in the file.
    expect(
      orderedIn(site.within, 'rememberLoginAttempt', 'authClient.signIn.social'),
      'the attempt is recorded after the redirect, so a bounce is what gets recorded',
    ).toBe(true)

    // AND IT RECORDS THE PROVIDER, not the funnel's coarse 'oauth'. The whole
    // reason `?signin=` was NOT widened to carry a provider id — that would
    // break login_callback_arrived's historical comparability — is that this
    // key carries the granularity instead. Recording a constant here would
    // badge Google for a Discord sign-in.
    expect(site.args).toEqual(['provider'])
  })

  test('the email attempt is recorded on the verified code, with its own method id', () => {
    const [site] = callSitesOf(LOGIN, read(LOGIN), 'rememberLoginAttempt').filter((call) =>
      call.within.includes('authClient.signIn.emailOtp'),
    )
    expect(site, 'no rememberLoginAttempt in the function that verifies the code').toBeDefined()
    expect(site.args).toEqual(['EMAIL_METHOD'])

    // PAST THE REFUSAL — `if (error) return setError('Invalid code')` — which is
    // what separates a verified code from a wrong one. Hoisted over it, an
    // attempt is recorded for a code that never verified. Harmless TODAY, since
    // an unpromoted attempt is overwritten by the retry, but it records the
    // wrong fact and the provider site's identical mistake is not harmless.
    //
    // SPELLED AS "NOTHING ELSE HAPPENS AFTER IT", which is true here and is the
    // only formulation of this that holds. The two obvious anchors both fail:
    //
    //   - `authClient.signIn.emailOtp` reads best — "recorded after the code
    //     verified" — and kills NOTHING. The order is signIn.emailOtp,
    //     setPending(false), the refusal, then this; a hoist over the refusal
    //     still lands after signIn.emailOtp, so the mutant satisfies it too.
    //   - `setError` does mark the refusal, but it is CALLED TWICE in this body
    //     (`setError(null)` before the await), and `within` holds callee texts
    //     with no identity — so renaming just the refusal's leaves the earlier
    //     one to be found instead, and the assertion silently weakens to a
    //     claim about a line that is not the boundary. Measured: that rename
    //     was green. It is the sharp edge callSitesOf's doc warns about.
    //
    // The body's last CALL is this one; `window.location.href = ...` follows it
    // and is an assignment, not a call. So this says "recorded once the handler
    // has no way left to refuse", robustly, with no anchor to rename.
    expect(
      site.within.at(-1),
      'something runs after the attempt is recorded — is it still past the refusal?',
    ).toBe('rememberLoginAttempt')

    // NOT 'otp', WHICH IS THE FUNNEL'S WORD. `?signin=otp` is charted by
    // login_callback_arrived as one of oauth|otp; this is a method id sitting
    // beside google/microsoft/github/discord in the same store, and the two
    // vocabularies must not be confused for one another.
    expect(login()).toMatch(/const EMAIL_METHOD = 'email'/)
  })

  test('the promotion happens in the arrival effect, beside the funnel event', () => {
    const sites = callSitesOf(APP, read(APP), 'promoteLoginAttempt')
    expect(sites).toHaveLength(1)
    expect(sites[0].args).toEqual([])

    // THE SHARED EFFECT IS THE ASSERTION. `login_callback_arrived` is emitted
    // only past the `?signin=oauth|otp` guard, and that marker is the only
    // thing tying this arrival to the attempt /login stashed. A promotion in an
    // effect of its own would have to re-read the URL — which this effect
    // strips, synchronously, so a later-declared effect finds nothing — or fire
    // unguarded, and promote a bounced attempt on any later visit.
    expect(sites[0].within).toContain('trackFunnel')

    // AND PAST THE GUARD, WHICH IS THE HALF `toContain` CANNOT SEE. Sharing the
    // effect is worth nothing if the call sits ABOVE the `if (method !== ...)
    // return` — the body is still the same body, so membership still holds,
    // and the mutant promotes on EVERY /app mount. That resurrects a stale
    // bounced attempt on any later visit with a live session, which is the one
    // failure the two keys exist to exclude. `trackFunnel` is the marker for
    // the guard's position: it is the first thing the effect does once past it.
    expect(
      orderedIn(sites[0].within, 'trackFunnel', 'promoteLoginAttempt'),
      'the promotion sits above the ?signin= guard, so it fires on every /app mount',
    ).toBe(true)
  })

  test('a brand-new account is promoted too, on complete-profile\'s success path', () => {
    // THE VISIT THIS EXISTS FOR IS THE SECOND ONE, and without this site it is
    // the one that misses. /app's loader redirects an account with no player row
    // to /complete-profile and DROPS the search params, so the sign-in that
    // created the account never reaches the arrival effect above — the badge
    // would first appear on the player's THIRD visit. Deleting this call leaves
    // every other test in this block green and quietly reintroduces that.
    const sites = callSitesOf(PROFILE, read(PROFILE), 'promoteLoginAttempt')
    expect(sites).toHaveLength(1)
    expect(sites[0].args).toEqual([])

    // ON THE SUCCESS PATH, not on render and not before the write. Past
    // `complete.mutateAsync` is what makes it the confirmed-onboarding moment
    // rather than "someone opened this page"; before `navigate` is /login's
    // reason, that the hop is what discards the component.
    expect(
      orderedIn(sites[0].within, 'complete.mutateAsync', 'promoteLoginAttempt'),
      'the promotion happens before the profile is written, not on its success',
    ).toBe(true)
    expect(
      orderedIn(sites[0].within, 'promoteLoginAttempt', 'navigate'),
      'the promotion happens after the hop that discards this component',
    ).toBe(true)

    // AND IT EMITS NOTHING. Carrying `?signin=` through the two redirects was
    // the other candidate fix and is forbidden: the arrival effect emits
    // `login_callback_arrived`, a fresh signup does not emit one today, and
    // making it start would change what the funnel counts. A trackFunnel call
    // appearing in this handler is that mistake wearing a different hat.
    expect(sites[0].within).not.toContain('trackFunnel')
  })

  test('neither route reaches past the helpers into the store itself', () => {
    // The same invariant the pending-invite block above asserts, for the same
    // reason: a route touching localStorage directly is how the wrapped, tested
    // helpers get bypassed by something that reads like an obvious inline
    // simplification — and the wrapping is what keeps Safari private mode from
    // turning a cosmetic hint into a blank sign-in page.
    for (const code of [login(), codeOf(read(APP)), codeOf(read(PROFILE))]) {
      expect(code).not.toMatch(/wt\.login\./)
      expect(code).not.toMatch(/localStorage/)
    }
    expect(login()).toMatch(
      /import \{ lastLoginMethod, rememberLoginAttempt \} from '#\/lib\/last-login\.ts'/,
    )
    for (const code of [codeOf(read(APP)), codeOf(read(PROFILE))]) {
      expect(code).toMatch(/import \{ promoteLoginAttempt \} from '#\/lib\/last-login\.ts'/)
    }
  })

  test('the badge is rendered per method, and only once hydrated', () => {
    // ONE BADGE PER CONTROL, each guarded by a comparison against that
    // control's own method id. `lastUsed && <LastUsedBadge />` — dropping the
    // comparison — marks every button at once and is a one-character edit.
    //
    // THREE, NOT TWO, SINCE THE PASSKEY BUTTON (wordle-teams-wty4.1.7.4), and
    // the count is updated rather than relaxed for the reason the attempt-site
    // tripwire above gives: a method that records an attempt but renders no
    // badge is invisible to every other assertion in this file.
    //
    // `\w+` MATCHES AN IDENTIFIER, NOT A STRING LITERAL, which is why each
    // method id is a named constant. That is not the regex's convenience — a
    // literal `'passkey'` spelled twice is a literal that can be spelled
    // differently in one of them.
    expect(login().match(/lastUsed === \w+ && <LastUsedBadge \/>/g) ?? []).toHaveLength(3)

    // AND THE VALUE IS GATED ON HYDRATION. localStorage does not exist on the
    // server, so a badge in the SSR pass is a hydration mismatch on exactly the
    // returning players this is for. Reading it unconditionally still renders
    // correctly in a browser, which is why nothing else would catch it.
    expect(login()).toMatch(/hydrated \? lastLoginMethod\(\) : undefined/)
  })

  test('the badge is a component of its own, so its accessibility can be executed', () => {
    // WHAT THE MARKER MUST BE — visible text that reaches the control's
    // accessible name — IS NOT ASSERTED HERE ANY MORE. It used to be, by
    // slicing this file with `/function LastUsedBadge\(\)[\s\S]*?\n\}/` and
    // running regexes over the slice, and that slice ends at the first
    // line-initial `}`: wrapping the span in a fragment truncates it and the
    // "not aria-hidden" assertion then passes on the remains. Vacuous exactly
    // where it must not be.
    //
    // components/last-used-badge.hook.test.ts renders the thing and reads the
    // accessible name a browser would compute. WHAT IS LEFT HERE is the half
    // that test cannot see: that /login uses that component rather than
    // reintroducing a local one the executable test would never reach.
    expect(login()).toMatch(
      /import \{ LastUsedBadge \} from '#\/components\/last-used-badge\.tsx'/,
    )
    expect(login()).not.toMatch(/function LastUsedBadge/)
  })
})

/**
 * THE PASSKEY SIGN-IN BUTTON, AND THE METHOD IT RECORDS
 * (wordle-teams-wty4.1.7.4).
 *
 * THE BEHAVIOURAL HALVES ARE ELSEWHERE AND ARE EXECUTABLE:
 * lib/signin-passkey.test.ts classifies every way the ceremony can end and
 * proves which one clears the per-device marker, lib/passkey.test.ts runs the
 * markers against a fake store. What NEITHER can see is what this block pins,
 * because it lives in a route module vitest cannot import:
 *
 *   - WHETHER THE BUTTON IS DRAWN AT ALL, and on what. Dropping the
 *     `passkeyRegisteredHere()` half of its condition leaves a button that
 *     opens a system sheet saying no passkeys were found — the dead-end tap the
 *     design doc rules out — on every WebAuthn-capable device in the world. It
 *     is a one-character edit, it type-checks, it lints, and no rendering test
 *     exists that could reach it.
 *   - WHETHER THE ATTEMPT IS RECORDED, and where in the handler. The same
 *     ordering property the email path has, for the same reason.
 *   - WHETHER THE MARKER /login WRITES ON THE URL IS ONE /app ACCEPTS. This is
 *     the silent one: `?signin=passkey` arriving at a guard that still reads
 *     `oauth | otp` is not an error anywhere. The promotion simply never
 *     happens, and the badge goes on naming whatever method worked last —
 *     forever, correctly-looking, on every gate.
 */
describe('the passkey sign-in button is offered only where it can succeed', () => {
  const LOGIN = './routes/login.tsx'
  const APP = './routes/app.tsx'
  const login = () => codeOf(read(LOGIN))

  test('it is gated on WebAuthn support AND a credential on THIS device', () => {
    const sites = callSitesOf(LOGIN, read(LOGIN), 'passkeyRegisteredHere')
    expect(sites, 'nothing in /login asks whether this device has a passkey').toHaveLength(1)
    expect(sites[0].args).toEqual([])

    // ONE BODY, so the two probes are one decision rather than two that can
    // drift apart — and `orderedIn` would throw by name if either were renamed.
    expect(sites[0].within).toContain('passkeySupported')

    // AND THE CONJUNCTION ITSELF, WHICH `within` CANNOT SEE. Membership is
    // satisfied just as well by `passkeySupported() || passkeyRegisteredHere()`,
    // which is the dead-end button for everyone.
    expect(
      login(),
      'the two probes are not ANDed — an || here is the dead-end button for everyone',
    ).toMatch(/passkeySupported\(\) && passkeyRegisteredHere\(\)/)
  })

  test('the answer is what draws the button, and it is never drawn on the server', () => {
    // THE PROBE EVALUATED AND THROWN AWAY is a green diff that ships a button
    // for every visitor, so the assertion is that its value reaches the flag.
    expect(
      login(),
      'the gate is evaluated but its answer never reaches the flag',
    ).toMatch(/setCanUsePasskey\(passkeySupported\(\) && passkeyRegisteredHere\(\)\)/)
    expect(
      login(),
      'the button is not wrapped in the flag, so it renders for everyone',
    ).toMatch(/\{canUsePasskey && \(/)

    // FALSE UNTIL AN EFFECT RAISES IT, which is this page's existing rule for
    // anything read out of localStorage (`hydrated ? lastLoginMethod() :
    // undefined`, asserted above) wearing a different shape. The server cannot
    // see the marker, so a button in the SSR pass is a hydration mismatch on
    // exactly the returning players it is for. It is `useState` rather than a
    // `useMemo` over `hydrated` because the value CHANGES: a ceremony that
    // proves the marker wrong clears it and the button goes with it.
    expect(
      login(),
      'the flag does not start false, so the button is drawn in the SSR pass',
    ).toMatch(/const \[canUsePasskey, setCanUsePasskey\] = useState\(false\)/)
  })

  test('a ceremony that disproves the marker takes the button away too', () => {
    // lib/signin-passkey.ts clears the STORE on `no-credential`; nothing
    // re-reads it while this page is open, so a button left on screen would go
    // on offering a ceremony that has just been shown to fail.
    const sites = callSitesOf(LOGIN, read(LOGIN), 'setCanUsePasskey')
    expect(sites.map((site) => site.args)).toEqual([
      ['passkeySupported() && passkeyRegisteredHere()'],
      ['false'],
    ])
    expect(sites[1].within).toContain('signInWithPasskey')
  })

  test('the attempt is recorded past the point of refusal, as the email path is', () => {
    const [site] = callSitesOf(LOGIN, read(LOGIN), 'rememberLoginAttempt').filter((call) =>
      call.within.includes('signInWithPasskey'),
    )
    expect(site, 'no rememberLoginAttempt in the handler that runs the ceremony').toBeDefined()
    expect(site.args).toEqual(['PASSKEY_METHOD'])

    // SPELLED AS "NOTHING ELSE HAPPENS AFTER IT", exactly as the email site is
    // and for the reason recorded there at length: the two anchors that read
    // best are both unsound. `signInWithPasskey` is the await, and everything
    // — the refusals included — is after it, so a hoist over them satisfies it
    // too. `setError` is CALLED THREE TIMES in this body and `within` holds
    // callee texts with no identity, so naming it is a positional guess.
    //
    // The body's last CALL is this one; `window.location.href = ...` follows it
    // and is an assignment, not a call.
    expect(
      site.within.at(-1),
      'something runs after the attempt is recorded — is it still past the refusals?',
    ).toBe('rememberLoginAttempt')

    // A NAMED CONSTANT, not a literal, and not only because the badge regex
    // above wants an identifier: this id sits in the same store beside
    // google/microsoft/github/discord and 'email', and a string spelled in two
    // places is one that can be spelled differently in one of them.
    expect(
      login(),
      "the method id is not a named constant spelled 'passkey'",
    ).toMatch(/const PASSKEY_METHOD = 'passkey'/)
  })

  test('the marker /login puts on the URL is one /app\'s arrival guard accepts', () => {
    // THE FAILURE THIS EXISTS FOR HAS NO SYMPTOM. `?signin=passkey` arriving at
    // a guard that still reads `method !== 'oauth' && method !== 'otp'` returns
    // early: no funnel event, no promotion, no offer. Nothing throws, nothing
    // logs, every gate is green, and the badge simply never moves off whatever
    // method the player used before. Both halves are walked so that a change to
    // either side is a failure rather than a drift.
    const sent = [...login().matchAll(/SIGNIN_PARAM\}=(\w+)/g)].map((match) => match[1])
    // THE VACUITY GUARD FOR THE PAIRING BELOW, and it is not optional: two
    // empty walks compare equal, so a renamed `SIGNIN_PARAM` or a rewritten
    // guard would satisfy the pairing while nothing at all was wired.
    expect([...sent].sort()).toEqual(['oauth', 'otp', 'passkey'])

    const accepted = [...codeOf(read(APP)).matchAll(/method !== '(\w+)'/g)].map(
      (match) => match[1],
    )
    expect(
      [...accepted].sort(),
      'a marker /login writes is not one /app promotes on — the badge will never move',
    ).toEqual([...sent].sort())
  })

  test('the route reaches the store only through the wrapped helpers', () => {
    // The same invariant the badge block asserts for `wt.login.`, for the same
    // reason: an inline `localStorage.getItem('wt.passkey.registered')` looks
    // like an obvious simplification and throws in Safari private mode, which
    // turns a convenience button into a blank sign-in page.
    expect(login()).not.toMatch(/localStorage/)
    expect(login()).not.toMatch(/wt\.passkey\./)
    expect(login()).toMatch(
      /import \{ passkeyRegisteredHere, passkeySupported \} from '#\/lib\/passkey\.ts'/,
    )
    // AND THE CEREMONY IS THE SHARED MODULE'S, not a second copy. The decision
    // about WHICH failure clears the per-device marker is the whole of
    // wordle-teams-wty4.1.7.8's residual case, and it is only testable where it
    // is testable — in a module vitest can import.
    expect(login()).toMatch(
      /import \{ signInWithPasskey \} from '#\/lib\/signin-passkey\.ts'/,
    )
    expect(login()).not.toMatch(/authClient\.signIn\.passkey/)
  })
})

/**
 * THE PASSKEY OFFER HANGS ON THE ARRIVAL EFFECT, AND IS MOUNTED ON EVERY BRANCH
 * (wordle-teams-wty4.1.7.3).
 *
 * THE BEHAVIOURAL HALVES ARE ELSEWHERE and are executable:
 * components/passkey-offer.hook.test.ts renders the dialog and drives every way
 * out of it, lib/passkey.test.ts runs `shouldOfferPasskey` against a fake store,
 * lib/register-passkey.test.ts classifies the ceremony. What NONE of them can
 * see is the two facts that live in a route module vitest cannot import: WHICH
 * MOMENT the offer is triggered at, and whether it is rendered at all.
 *
 * AND BOTH ARE SILENT WHEN WRONG. `shouldOfferPasskey()` lifted out of the
 * `?signin=` guard into an unguarded effect offers a passkey to anyone who
 * merely opens the dashboard — including, one navigation later, the player who
 * has just declined, since the decline marker is only consulted at the moment
 * the effect runs. `{passkeyOffer}` dropped from one of the three returns leaves
 * the offer invisible to exactly the players it was written for: a team-less
 * signup, and anyone whose first frame is the params skeleton. Neither is a
 * type error, a lint error or a rendering difference any other suite observes.
 */
describe('the passkey offer is triggered on arrival and mounted on every branch', () => {
  const APP = './routes/app.tsx'
  const app = () => codeOf(read(APP))

  test('the decision is taken once, inside the ?signin= effect, past its guard', () => {
    const sites = callSitesOf(APP, read(APP), 'shouldOfferPasskey')
    expect(sites).toHaveLength(1)
    expect(sites[0].args).toEqual([])

    // THE SHARED EFFECT IS THE ASSERTION, exactly as it is for
    // promoteLoginAttempt above. `trackFunnel` is the marker for the guard's
    // position — it is the first thing the effect does once past
    // `if (method !== 'oauth' && method !== 'otp') return` — so a body
    // containing both, in that order, is a call that runs only on a confirmed
    // sign-in arrival.
    expect(sites[0].within).toContain('trackFunnel')
    expect(
      orderedIn(sites[0].within, 'trackFunnel', 'shouldOfferPasskey'),
      'the offer decision sits above the ?signin= guard, so it fires on every /app mount',
    ).toBe(true)
  })

  test('and it OPENS the offer rather than merely asking', () => {
    // `shouldOfferPasskey()` called and its answer thrown away is a green diff
    // that ships no offer at all. Two sites: the effect opens it, the dialog's
    // own onClose shuts it, and a missing second one is an offer that cannot be
    // dismissed for the rest of the session.
    const sites = callSitesOf(APP, read(APP), 'setOfferPasskey')
    expect(sites.map((site) => site.args)).toEqual([['true'], ['false']])
    expect(sites[0].within).toContain('shouldOfferPasskey')
  })

  test('the dialog is wired to that state, and to nothing else', () => {
    // jsxPropsOf throws unless there is EXACTLY ONE <PasskeyOffer> element, so
    // a second one added in a branch this test does not read is a named
    // failure rather than a silent divergence.
    const props = jsxPropsOf(APP, read(APP), 'PasskeyOffer')
    expect(props.get('open')).toBe('offerPasskey && !celebrationOpen')
    expect(props.get('onClose')).toBe('() => setOfferPasskey(false)')
  })

  test('the celebration holds the offer BACK, and does not decline it for the player', () => {
    /**
     * wordle-teams-wty4.1.7.10. Both dialogs can open on one arrival — the 1st
     * of a month, an unseen winner, a `?signin=` arrival on a device with
     * neither passkey marker — and Radix stacks them. The celebration is the
     * one that arrives off a QUERY RESOLUTION, so it can land DURING the
     * offer's WebAuthn ceremony and take the focus trap out from under an open
     * system sheet.
     *
     * THE TWO HALVES ARE BOTH ASSERTED HERE BECAUSE ONLY ONE OF THEM IS
     * VISIBLE. The `open` expression above already pins the suppression. What
     * this pins is the thing a reasonable-looking alternative fix gets wrong:
     * closing the offer instead of hiding it. `setOfferPasskey(false)` called
     * from a celebration handler would look identical on screen — the dialog is
     * not drawn either way — and would silently forfeit the device's
     * once-per-device chance, because the route's own state is the record that
     * an offer is owed. The two `setOfferPasskey` call sites asserted above are
     * still the only two, and neither knows about the celebration.
     */
    const celebration = jsxPropsOf(APP, read(APP), 'MonthlyWinnerCelebration')
    expect(celebration.get('onOpenChange')).toBe('setCelebrationOpen')
    // REPORTS ONLY. A parent that could also force the celebration open would
    // be a second copy of a decision the component already owns.
    expect(celebration.has('open')).toBe(false)
    // AND THE FLAG IS ONLY EVER WRITTEN BY THAT CALLBACK. A second writer is
    // the second notion of "just signed in" this design exists to avoid.
    expect(callSitesOf(APP, read(APP), 'setCelebrationOpen')).toHaveLength(0)
  })

  test('the offer is rendered on ALL THREE returns, as each one\'s first child', () => {
    const code = app()
    // THE VACUITY GUARD FOR THE NUMBER BELOW. Three is the count of returns
    // this component has; without this, a branch deleted along with its
    // `{passkeyOffer}` would leave a "3" asserted against a file that no longer
    // has three of anything, and the test would have to be edited to stay
    // green for the wrong reason.
    expect(code.match(/<main/g) ?? []).toHaveLength(3)

    // FIRST CHILD IN EACH, which is not cosmetic: React reconciles children by
    // index and these branches swap during an ordinary load, so an offer at a
    // different index in each is unmounted and remounted mid-dialog. Asserted
    // as "nothing between the <main> and the offer", per branch.
    //
    // PER BRANCH AND NAMED, NOT A COUNT. A count fails as "expected 3, received
    // 2" and leaves the reader to find which of three near-identical returns
    // lost it — two of them open with a byte-identical <main> tag, so there is
    // nothing to grep for. Walking them in source order and naming each one
    // turns the failure into a location.
    //
    // `[\s{}]*` RATHER THAN `\s*`, and the braces are not decoration. `codeOf`
    // strips comment BODIES with a text replace, so a JSX comment —
    // `{/* … */}`, which is a brace pair wrapped around one — leaves an empty
    // `{}` behind in the stripped source. `\s*` fails on it, and the failure
    // looks exactly like the offer not being the first child.
    const BRANCHES = ['the team-less branch', 'the params skeleton', 'the dashboard']
    const opened = [...code.matchAll(/<main[^>]*>([\s\S]{0,120})/g)]
    expect(opened, 'the three returns are no longer three <main> elements').toHaveLength(
      BRANCHES.length,
    )
    opened.forEach((branch, index) => {
      expect(
        branch[1],
        `${BRANCHES[index]} does not render {passkeyOffer} as its first child`,
      ).toMatch(/^[\s{}]*\{passkeyOffer\}/)
    })

    // AND NO FOURTH MOUNT, which the per-branch walk cannot see: it only ever
    // looks at what FOLLOWS a <main>, so an extra `{passkeyOffer}` further down
    // any branch — two dialogs bound to one piece of state, one of them at an
    // unstable index — passes every assertion above. This runs LAST because it
    // is the one that fails as a bare number; when the offer has simply been
    // dropped from a branch, the named check above gets there first.
    expect(code.match(/\{passkeyOffer\}/g) ?? []).toHaveLength(3)
  })

  test('the route does not reimplement the offer it delegates', () => {
    // The suppression rules are lib/passkey.ts's and the ceremony is
    // lib/register-passkey.ts's. A route that reached for `addPasskey` itself
    // would bypass both, and the marker writes with them.
    expect(app()).toMatch(/import \{ shouldOfferPasskey \} from '#\/lib\/passkey\.ts'/)
    expect(app()).toMatch(/import \{ PasskeyOffer \} from '#\/components\/passkey-offer\.tsx'/)
    expect(app()).not.toMatch(/addPasskey/)
  })
})

/**
 * THE PRO MONTH WINDOW IS ACTUALLY WIRED INTO THE DASHBOARD (wordle-teams-kusd.6).
 *
 * MEASURED, NOT ASSUMED, AND TWICE. With the feature complete and all four gates
 * green, three mutations of routes/app.tsx survived everything — `earliestMonth`
 * to null, `pro: isPro` to `pro: false`, and an inert correction effect. Each
 * silently restores the regression this epic exists to close. The first draft of
 * this block killed those three; a review then planted nine more and FOUR of them
 * survived it, which is the more useful measurement and the reason this block
 * looks the way it does now:
 *
 *   - the in-flight half of `loadedWindow`'s guard deleted, so the window reads
 *     as ANSWERED the moment hydration flips and the correction bounces a Pro
 *     viewer off their bookmarked month on every load;
 *   - `teams.some(...)` INVERTED, which a `toContain('teams.some')` cannot see;
 *   - `hydrated ?` inverted;
 *   - the teaser's null guard inverted, which removes the only place in the app
 *     that tells a free player what Pro reaches.
 *
 * THE PATTERN IN WHAT SURVIVED IS WORTH MORE THAN THE LIST. Every one of them is
 * a DIRECTION or a CONJUNCT inside an expression, and every assertion that missed
 * them was a `toContain` over a fragment. A fragment cannot see an inverted
 * operator or a dropped operand, because both leave the fragment intact. So the
 * pins below are `initializerOf` — the whole initializer, exactly, normalised for
 * whitespace — rather than a substring of it, and the correction's guard is
 * asserted through the AST rather than as text.
 *
 * None of this is reachable any other way: `Dashboard` is not exported (the guard
 * above forbids it) and a route module cannot be rendered under vitest, so
 * convex/lib/monthWindow.test.ts proves the RULE and src/lib/dashboard-months.
 * test.ts proves the CORRECTION while nothing at all proves the route calls
 * either of them with the right arguments. Same hole team-boards.hook.test.ts's
 * dashboard block was opened for, and the one e2e/onboarding.spec.ts's header
 * describes at length for the onboarding card.
 *
 * ASSERTED AS A CHAIN. The query is read into `earliestMonth`, `earliestMonth`
 * and the viewer's clock build `loadedWindow`, and `loadedWindow` is what
 * `correctedMonth` judges `?month=` against and what both controls fall back
 * from. Each link gets its own line, so a break names itself.
 */
describe('the dashboard builds its month window from the team, not from a literal', () => {
  const APP = './routes/app.tsx'
  const sitesIn = (callee: string) => callSitesOf(APP, read(APP), callee)
  // EVERY `initializer(...)` EXPECTATION BELOW READS AS TOKENS, one space apart
  // — `teams . some ( ( team ) => ... )`. That is `initializerOf`'s normal form
  // and its own header says why: it is what makes these immune to a rewrap, a
  // re-indent and a hand-added trailing comma while staying exact about the
  // operators, the operands and their order, which is where all four of the
  // mutants that survived the first draft of this block lived.
  const initializer = (identifier: string) => initializerOf(APP, read(APP), identifier)

  test('it subscribes to api.scores.monthWindow, once, with the gate it declares', () => {
    // `convexQuery` is called ten times in this file, so the sites are filtered
    // by their FIRST argument — the query reference — rather than indexed, which
    // would make this a positional guess that a reordering breaks for no reason.
    const subscriptions = sitesIn('convexQuery').filter(
      (site) => site.args[0] === 'api.scores.monthWindow',
    )
    expect(subscriptions, 'routes/app.tsx does not query api.scores.monthWindow').toHaveLength(1)

    // THE ARGUMENT IS THE NAMED CONST, which is what makes the test below mean
    // anything. `monthWindowArgs` pinned perfectly while the call passed
    // something else would be the detached-literal mutation src/test-support/
    // source-ast.ts's header exists for.
    expect(subscriptions[0].args[1]).toBe('monthWindowArgs')
  })

  test('and it skips unless the viewer is a MEMBER of the team in `?team=`', () => {
    // PINNED WHOLE, BECAUSE THE DIRECTION IS THE PROPERTY. `!teams.some(...)`
    // type-checks, lints, passes every other test, and inverts the feature: the
    // window never loads for a member, and a guaranteed refusal is fired for a
    // non-member. A substring match on `teams.some` is satisfied by the inverted
    // form, which is how this survived the first version of this block.
    //
    // Truthiness is the other half: a stale `?team=` is a non-empty string, so
    // `teamParam ? … : 'skip'` fires the query and takes a refusal for the render
    // or two before useSearchSync corrects the param.
    expect(initializer('monthWindowArgs')).toBe(
      "teamParam !== undefined && teams . some ( ( team ) => team . id === teamParam ) ? { teamId : teamParam as Id < 'teams' > } : 'skip'",
    )
  })

  test("the query's answer is what `earliestMonth` is bound to", () => {
    // The middle link, and the one the very first surviving mutant cut.
    expect(initializer('earliestMonth')).toBe('monthWindowInputs ?. earliestMonth ?? null')
  })

  test('the clock is the viewer\'s, and only past hydration', () => {
    // INVERTING `hydrated` SURVIVED EVERY GATE. It reads the clock on exactly the
    // renders that have to match the server (SSR, and the client's first render)
    // and undefined afterwards — so the window never loads at all, and the
    // hydration-mismatch class wordle-teams-uc5 was is reintroduced in the same
    // edit. Nothing else in the repo can observe either half.
    expect(initializer('clockMonth')).toBe(
      'hydrated ? monthOf ( toPuzzleDay ( new Date ( ) ) ) : undefined',
    )
  })

  test('the window waits for BOTH inputs, then uses the real team and the real tier', () => {
    // THE WORST SURVIVOR, AND THE REASON IT IS WORTH ITS OWN SENTENCE. Dropping
    // `|| monthWindowInputs === undefined` makes `loadedWindow` an ARRAY the
    // moment hydration flips — before the query has answered — so it is the free
    // window, and `correctedMonth` judges `?month=` against an answer that has
    // not arrived. A Pro viewer opening a bookmark on an old month is navigated
    // off it on every load, and the URL they end up with is the current month, so
    // there is nothing left on screen to suggest anything went wrong.
    //
    // routes/app.tsx's own comment names this invariant — "THE ANSWER OR THE
    // ABSENCE OF ONE, which is exactly what `correctedMonth` has to be able to
    // tell apart" — and src/lib/dashboard-months.test.ts pins the pure function's
    // half of it (`months: undefined` returns null). This is the other half: WHEN
    // the route considers it undefined.
    //
    // The two literal substitutions are pinned by the same line: `earliestMonth:
    // null` collapses every viewer to FREE_MONTHS (see convex/lib/monthWindow.ts's
    // `spanFor`, which ignores `pro` entirely for a null earliestMonth), and
    // `pro: false` does it by the other input.
    expect(initializer('loadedWindow')).toBe(
      'clockMonth === undefined || monthWindowInputs === undefined ? undefined : monthWindowFor ( { currentMonth : clockMonth , earliestMonth , pro : isPro } )',
    )
  })

  test('both controls share one array, and its fallback keeps the month on screen', () => {
    // `monthWindow` cannot be `undefined` — both controls take
    // `Array<PuzzleMonth>` — and what it falls back TO matters: `[currentMonth]`
    // would set the day picker's `minDay` past every day of a past month and
    // disable the whole visible grid for the length of one round trip.
    // `fallbackMonths` is the free window PLUS `?month=`, and its own tests pin
    // that. team-boards.hook.test.ts pins that both controls receive this name.
    expect(initializer('monthWindow')).toBe(
      'loadedWindow ?? fallbackMonths ( currentMonth , monthParam )',
    )
  })

  test('the teaser is computed from the same two inputs, and its null guard is intact', () => {
    // `teaserLabel={teaserLabel}` on the MonthPicker is pinned by
    // team-boards.hook.test.ts's dashboard block; these are the other two halves.
    //
    // FIRST, THAT THE MONTH IS ABOUT THIS TEAM AND THIS VIEWER rather than a
    // constant that happens to type-check.
    expect(initializer('teaserMonth')).toBe(
      'proTeaserMonth ( { currentMonth , earliestMonth , pro : isPro } )',
    )
    expect(sitesIn('proTeaserMonth')).toHaveLength(1)

    // SECOND, THE GUARD'S DIRECTION. `teaserMonth !== undefined ? null : …`
    // type-checks and passes everything, and returns null for every month
    // `proTeaserMonth` ever names — silently deleting the only place in the app
    // that tells a free player how far back Pro reaches. It survived the first
    // version of this block because the assertion here was about the CALL and
    // said nothing about what is done with its answer.
    expect(initializer('teaserLabel')).toBe(
      'teaserMonth === null ? null : formatMonthLabel ( teaserMonth )',
    )
  })

  test('an out-of-window `?month=` is judged against the loaded window, not the fallback', () => {
    // NOT AGAINST `monthWindow`. That falls back to `fallbackMonths`, which
    // always CONTAINS the month on screen — so feeding it here would make the
    // correction unreachable while looking entirely correct.
    // src/lib/dashboard-months.ts's header is the long form.
    expect(initializer('monthCorrection')).toBe(
      'correctedMonth ( { monthParam , months : loadedWindow } )',
    )
  })

  test('and the correction navigates without taking the back button or the scroll', () => {
    const corrective = sitesIn('navigate').filter((site) =>
      site.args.some((arg) => arg.includes('month: monthCorrection')),
    )
    expect(corrective, 'nothing in routes/app.tsx navigates to the corrected month').toHaveLength(1)

    // Both flags, for the reasons useSearchSync's own correction carries them:
    // nobody asked for this navigation, so it must not take over the back button
    // and must not move the reader on the page.
    expect(corrective[0].args[0]).toContain('replace: true')
    expect(corrective[0].args[0]).toContain('resetScroll: false')
  })

  test("the effect's guard is still two conditions, not a defeated one", () => {
    // THE ONE MUTATION EVERY ASSERTION ABOVE IS BLIND TO. `|| true` appended to
    // that early return leaves the call sites, the initializers and the JSX
    // exactly as they are, and the correction simply never fires. It is not a
    // call, a prop, an option or an initializer, so no helper in
    // src/test-support/source-ast.ts can reach it.
    //
    // ASSERTED STRUCTURALLY RATHER THAN AS TEXT, which is the difference between
    // this and the `toContain('if (monthCorrection === null || !teamParam)')` it
    // replaces. That form caught `|| true` and ALSO went red on a rewrap of the
    // line; counting the operands catches the extra one at any layout, and
    // reading them back catches an inverted or swapped condition too.
    const file = parseSource(APP, read(APP))
    let guard: ts.IfStatement | undefined
    const visit = (node: ts.Node): void => {
      if (
        ts.isCallExpression(node) &&
        node.expression.getText() === 'useEffect' &&
        node.arguments.length === 2 &&
        ts.isArrayLiteralExpression(node.arguments[1]) &&
        node.arguments[1].elements.some((element) => element.getText() === 'monthCorrection')
      ) {
        const body = node.arguments[0]
        if (ts.isArrowFunction(body) && ts.isBlock(body.body)) {
          const [first] = body.body.statements
          if (first && ts.isIfStatement(first)) guard = first
        }
      }
      ts.forEachChild(node, visit)
    }
    visit(file)

    expect(guard, 'the correction effect does not open with an `if (...) return`').toBeDefined()
    if (!guard) return

    // `a || b || true` parses left-associatively, so flattening the chain and
    // counting is what makes a third operand visible. A `&&` here would be a
    // different — and wrong — guard, so the operator is asserted too.
    const operandsOf = (expression: ts.Expression): ts.Expression[] =>
      ts.isBinaryExpression(expression) &&
      expression.operatorToken.kind === ts.SyntaxKind.BarBarToken
        ? [...operandsOf(expression.left), expression.right]
        : [expression]

    expect(ts.isBinaryExpression(guard.expression)).toBe(true)
    const operands = operandsOf(guard.expression)
    expect(operands.map((operand) => operand.getText())).toEqual([
      'monthCorrection === null',
      '!teamParam',
    ])

    // AND IT RETURNS. `if (...) {}` satisfies everything above and guards
    // nothing.
    expect(ts.isReturnStatement(guard.thenStatement)).toBe(true)
  })
})

/**
 * initializerOf, ON THE NORMALISATION THE BLOCK ABOVE LEANS ON.
 *
 * Hand-written fixtures, for the reason the callSitesOf block below gives: a
 * helper that quietly reported the wrong thing would make every pin above pass
 * on a file that had drifted, and reading it out of a real route file would
 * couple these to that file's contents.
 *
 * THE DIRECTION OF THE RISK IS WHAT THESE ARE FOR, and it is not the obvious
 * one. A normaliser that does too LITTLE makes the pins brittle, which is red
 * and loud. One that does too MUCH — collapses an operator, swallows a `!` —
 * makes them pass on a mutation, which is silent and is exactly the failure the
 * block above was rewritten to close. So the last two tests assert that two
 * expressions which DIFFER still normalise differently.
 */
describe('initializerOf, the normalisation those pins are built on', () => {
  const of = (source: string, name = 'x') => initializerOf('fixture.tsx', source, name)

  test('layout is invisible to it — three spellings, one answer', () => {
    const tight = of("const x = a !== undefined && b.some((c) => c.id === a) ? { k: a as Id<'t'> } : 'skip'")
    const wrapped = of(`const x =
      a !== undefined && b.some((c) => c.id === a)
        ? { k: a as Id<'t'> }
        : 'skip'`)
    const exploded = of(`const x =
      a !== undefined &&
      b.some(
        (c) => c.id === a,
      )
        ? {
            k: a as Id<'t'>,
          }
        : 'skip'`)

    expect(wrapped).toBe(tight)
    // The exploded form adds the two trailing commas a hand-rewrap adds, which
    // is the token `printNode` reproduces verbatim and a whitespace collapse
    // cannot reach. This is the case that sent the first draft of this helper
    // back.
    expect(exploded).toBe(tight)
  })

  test("a comma inside a STRING is not a trailing comma", () => {
    // THE HAZARD A REGEX WALKS INTO, and the reason this is done with the
    // scanner. `codeOf`'s header documents the same class of failure for the
    // two regexes it replaced.
    expect(of(`const x = cond ? { a: 1 } : 'skip, }'`)).toContain("'skip, }'")
    expect(of(`const x = cond ? { a: 1 } : 'skip, }'`)).toBe(
      of(`const x = cond
        ? {
            a: 1,
          }
        : 'skip, }'`),
    )
  })

  test('an array elision keeps its final comma, so a value cannot change length', () => {
    // `[a, ,]` has two elements and `[a,]` has one. A normaliser that dropped
    // the last comma there would silently rewrite the value it is meant to be
    // reporting. Nothing in this repo has an elision; the guard is here so that
    // stays a fact rather than a coincidence.
    expect(of('const x = [a, ,]')).toBe('[ a , , ]')
    expect(of('const x = [a,]')).toBe('[ a ]')
  })

  test('an inverted operator is a DIFFERENT answer', () => {
    // THE VACUITY GUARD. Every pin in the block above is a `toBe` against one of
    // these strings, and all four mutants that survived the first draft were an
    // inversion. If normalisation ever swallowed one, those pins would go quiet
    // rather than red.
    expect(of('const x = b.some((c) => c.id === a)')).not.toBe(
      of('const x = !b.some((c) => c.id === a)'),
    )
    expect(of('const x = m === null ? null : f(m)')).not.toBe(
      of('const x = m !== null ? null : f(m)'),
    )
    expect(of('const x = p || q ? u : v')).not.toBe(of('const x = p || q || true ? u : v'))
  })

  test('a renamed or duplicated declaration throws rather than answering', () => {
    // Returning undefined would read as "it has no initializer" and pass a
    // `toContain`; two declarations would make the answer a coin toss.
    expect(() => of('const y = 1', 'x')).toThrow(/expected exactly one/)
    expect(() => of('const x = 1; function f() { const x = 2 }', 'x')).toThrow(
      /expected exactly one/,
    )
  })
})

/**
 * callSitesOf, ON THE FORMS THE BLOCK ABOVE LEANS ON.
 *
 * Asserted on hand-written fixtures for the reason about-screenshots.test.ts
 * gives for doing the same to `importedModulesOf`: a helper that quietly
 * reported nothing would make every test above pass on a file with the calls
 * deleted, and reading it out of a real route file would couple these to that
 * file's contents.
 */
describe('callSitesOf, the helper those assertions are built on', () => {
  const sites = (source: string) => callSitesOf('fixture.ts', source, 'remember')

  test('reports one entry per call site, with the arguments as written', () => {
    const found = sites(`
      function a() { remember(provider) }
      function b() { remember('email', 2) }
    `)
    expect(found.map((site) => site.args)).toEqual([['provider'], ["'email'", '2']])
  })

  test('`within` is the ENCLOSING function, in order — not the file', () => {
    // The ordering claim only means "which runs first" while it is bounded to
    // one body; across two functions, `indexOf` over the file text answers the
    // different and useless question of which line is higher up.
    const [first, second] = sites(`
      function a() { track(); remember(x); go() }
      function b() { remember(y); other() }
    `)
    expect(first.within).toEqual(['track', 'remember', 'go'])
    expect(second.within).toEqual(['remember', 'other'])
  })

  test('an arrow body counts, which is what a useEffect is', () => {
    const [site] = sites('useEffect(() => { guard(); remember(x) }, [])')
    // The arrow, not the useEffect call around it.
    expect(site.within).toEqual(['guard', 'remember'])
  })

  test('a call at module scope throws rather than reporting an empty body', () => {
    // Returning `[]` for `within` would read as "it has no neighbours" and pass
    // an ordering assertion vacuously.
    expect(() => sites('remember(x)')).toThrow(/not inside a function/)
  })

  test('orderedIn answers over ALL occurrences, so a repeated anchor is exact', () => {
    // "past the LAST setError" with no index arithmetic at the call site.
    expect(orderedIn(['setError', 'x', 'setError', 'remember'], 'setError', 'remember')).toBe(true)
    expect(orderedIn(['setError', 'remember', 'setError'], 'setError', 'remember')).toBe(false)
  })

  test('orderedIn THROWS on a missing anchor rather than answering vacuously', () => {
    // THE WHOLE REASON IT EXISTS. `indexOf` answers -1 for an absent name, so
    // the hand-written form of this assertion silently stops asserting the day
    // someone renames the anchor — which is how two ordering tests in the block
    // above were vacuity-proof by accident rather than by construction.
    expect(() => orderedIn(['a', 'b'], 'renamed', 'b')).toThrow(/is not called in that body/)
    expect(() => orderedIn(['a', 'b'], 'a', 'renamed')).toThrow(/is not called in that body/)
  })

  test('a callee that is nowhere in the file is no sites, not a throw', () => {
    // Unlike optionsPassedTo, which has an exactly-one contract. The callers
    // above assert their own counts, and "zero" is a failure they can report
    // better than this helper can.
    expect(sites('function a() { other() }')).toEqual([])
  })
})
