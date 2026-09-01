import { existsSync, readFileSync } from 'node:fs'
import ts from 'typescript'
import { describe, expect, test } from 'vitest'

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
 * Comments stripped, so the assertions below read the CODE. me.tsx is mostly
 * prose explaining why it exists, and that prose quotes the very literals being
 * pinned — a match inside it would prove nothing.
 */
const codeOf = (source: string) =>
  source.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/[^\n]*/g, '')

/**
 * THE OPTIONS A NAMED CALL IS ACTUALLY GIVEN — parsed, not matched.
 *
 * Everything else in this file reads a file as a string, which is the right
 * tool when the claim is "this literal is in this file". It is the WRONG tool
 * for "this option is passed to this call": a `toMatch` for
 * `errorCallbackURL: '/login-error'` is satisfied by that text sitting in a
 * `const` nothing reads, so deleting the real option from the `signIn.social`
 * call survived all four gates AND all 54 e2e tests. The same trick worked on
 * `onAPIError` in the betterAuth config.
 *
 * A regex that spans the call would fix the specific mutation and pin
 * INDENTATION and property order along with it. The compiler already has an
 * exact answer, and `typescript` is already a devDependency, so this asks it:
 * find the call by its callee, take its object-literal argument, and return
 * that literal's OWN top-level properties. A detached literal is not one of
 * them at any indentation, and reformatting the file changes nothing here.
 */
const parse = (path: string) =>
  ts.createSourceFile(
    path,
    read(path),
    ts.ScriptTarget.ESNext,
    /* setParentNodes */ true,
    path.endsWith('.tsx') ? ts.ScriptKind.TSX : ts.ScriptKind.TS,
  )

/** The top-level properties of an object literal, by name. */
const propertiesOf = (node: ts.Node): Map<string, ts.Expression> => {
  if (!ts.isObjectLiteralExpression(node))
    throw new Error(`expected an object literal, got ${ts.SyntaxKind[node.kind]}`)
  return new Map(
    node.properties.flatMap((property) =>
      ts.isPropertyAssignment(property) && property.name
        ? [[property.name.getText(), property.initializer] as const]
        : [],
    ),
  )
}

/**
 * The object literal passed to `callee(...)`, by the callee's exact source
 * text — `betterAuth`, `authClient.signIn.social`. Throws rather than returning
 * an empty map, so a renamed or deleted call is a named failure and not a
 * silent pass on `undefined`.
 */
const optionsPassedTo = (path: string, callee: string): Map<string, ts.Expression> => {
  const found: ts.ObjectLiteralExpression[] = []
  const visit = (node: ts.Node): void => {
    if (ts.isCallExpression(node) && node.expression.getText() === callee) {
      const literal = node.arguments.find(ts.isObjectLiteralExpression)
      if (literal) found.push(literal)
    }
    ts.forEachChild(node, visit)
  }
  visit(parse(path))
  if (found.length !== 1)
    throw new Error(`expected exactly one ${callee}({...}) in ${path}, found ${found.length}`)
  return propertiesOf(found[0])
}

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
  const footer = () => codeOf(read('./components/Footer.tsx'))

  /** Every pageTitle('...') argument in a file, in source order. */
  const titlesIn = (source: string) =>
    [...source.matchAll(/pageTitle\(\s*['"]([^'"]*)['"]\s*\)/g)].map((match) => match[1])

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

  test('the footer sends each label to the page it names', () => {
    // LABEL AND TARGET AS A PAIR. Asserting that /privacy and /terms both
    // appear somewhere in the footer is satisfied by two links that have been
    // swapped with each other, which is precisely the mutation that shipped
    // green. v1's src/components/home/footer.tsx:25-28 pairs them the same way.
    //
    // Exhaustive over the internal links, so deleting one is a failure here and
    // not merely a shorter list — the footer's <Link>s are the only navigation
    // to either legal page in the whole app.
    const pairs = [...footer().matchAll(/<Link to=["']([^"']+)["']>\s*([^<]+?)\s*<\/Link>/g)].map(
      (match) => [match[2], match[1]],
    )
    expect(pairs).toEqual([
      ['About', '/about'],
      ['Privacy Policy', '/privacy'],
      ['Terms', '/terms'],
    ])
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
  const titlesIn = (source: string) =>
    [...source.matchAll(/pageTitle\(\s*['"]([^'"]*)['"]\s*\)/g)].map((match) => match[1])

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
    // PARSED, NOT MATCHED — see optionsPassedTo above. This used to be two
    // `toMatch` calls over the whole file, and both mutations that lift the
    // option out of its call into a dead `const` survived every gate and every
    // e2e test: the literal was still in the file, and nothing asserted it was
    // still wired to anything.
    const social = optionsPassedTo('./routes/login.tsx', 'authClient.signIn.social')
    expect(social.get('errorCallbackURL')?.getText()).toBe("'/login-error'")

    // Two levels, because the claim is about a nested option: `onAPIError` is a
    // top-level option of the betterAuth config, and `errorURL` is a property
    // of it. ABSOLUTE, via the template — this handler runs on the Convex
    // deployment, where a bare '/login-error' has no origin to resolve against.
    const onAPIError = optionsPassedTo('../convex/auth.ts', 'betterAuth').get('onAPIError')
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
