import { existsSync, readFileSync } from 'node:fs'
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
