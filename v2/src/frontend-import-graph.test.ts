import { readFileSync, readdirSync, statSync } from 'node:fs'
import { dirname, join, relative, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, test } from 'vitest'
import { runtimeImportsOf } from './test-support/source-ast'

/**
 * NOTHING THE BROWSER LOADS MAY REACH convex/auth.ts.
 *
 * THE INCIDENT. src/components/chat/composer.tsx imported ONE INTEGER,
 * MAX_BODY_LENGTH, from convex/lib/chat.ts (56d4b88). lib/chat.ts imports
 * `accessError` from ../access.ts, access.ts imports ./auth.ts, and auth.ts
 * pulls in the whole Better Auth server surface. /chat was dead on beta for an
 * afternoon while every other route stayed perfectly healthy, because /chat is
 * a lazily loaded chunk and the fault was confined to it.
 *
 * WHAT USED TO CATCH IT, AND WHY IT NO LONGER CAN. auth.ts used to throw at
 * MODULE SCOPE when process.env.SITE_URL was falsy — which in a browser it
 * always is. That ONE throw did two jobs: it made the fault FATAL (the chunk
 * died on load) and it left a FINGERPRINT a CI step in
 * .github/workflows/deploy-v2.yml could grep dist/client for. a5d5c3f0 moved it
 * into `createAuth`, and had to — the Better Auth Convex component imports
 * `createAuthOptions` from auth.ts and component code receives no deployment
 * environment variables — so both jobs went with it. Measured 2026-09-13 with a
 * control: the fingerprint is gone from dist/client, and so is
 * SCHEMA_ONLY_BASE_URL's 'schema-generation.invalid', meaning auth.ts is
 * tree-shaken out of the client graph entirely rather than merely shipping
 * unmarked. convex/lib/chatLimits.ts's banner holds that measurement in full,
 * including the probe and both arms; this file deliberately does not restate
 * it, because one fact kept in three places is three things to keep true.
 *
 * SO THE SEVERITY DROPPED AND THE DETECTION DISAPPEARED. Shipping auth.ts to
 * the browser is now bundle bloat — every visitor to that route downloads
 * better-auth for nothing — rather than a dead route. It is still a bug, and it
 * is now a SILENT one, which is why the check moved here from CI: a bundle grep
 * can only see a fault that leaves a mark, and this one stopped leaving marks.
 *
 * THIS IS THE CHECK deploy-v2.yml's comment SAID WAS IMPOSSIBLE — "Lint
 * inspects specifiers, not the graph behind them". Lint cannot, but a graph
 * walk can: every file under src/ is a root, every runtime edge is followed to
 * a real file on disk, and the failure names the CHAIN. It is strictly stronger
 * than the grep it replaces, which needed a build and could only ever report a
 * boolean, and strictly stronger than src/routes.test.ts's narrow version,
 * which checks three named files for one direct import.
 *
 * IT READS SOURCE, NOT dist/. Same rationale as src/styles.test.ts: reading the
 * bundle would make the result depend on whether someone had run a build, and
 * `pnpm test` does not. The import edge IS the defect and is always present.
 */

/** v2/, the root every path in a failure message is printed relative to. */
const V2 = fileURLToPath(new URL('../', import.meta.url))
const SRC = join(V2, 'src')

const AUTH = join(V2, 'convex/auth.ts')
const ACCESS = join(V2, 'convex/access.ts')

const show = (file: string) => relative(V2, file).replaceAll('\\', '/')

/**
 * Extensions whose contents are not modules. A resolved file outside this set
 * is parsed; one inside it is a leaf with no edges — `./data/glyph-templates.json`
 * imports nothing and never will.
 */
const CODE = ['.ts', '.tsx', '.js', '.jsx', '.mjs', '.cjs']

/**
 * A specifier as written, turned into an absolute path on disk.
 *
 * BUNDLER RESOLUTION, NOT NODE'S. This repo sets moduleResolution "bundler" and
 * allowImportingTsExtensions, and convex/ is inconsistent about it on purpose —
 * access.ts writes `./auth` while lib/chat.ts writes `./chatLimits.ts` — so
 * both spellings have to land on the same file. An extensionless specifier can
 * also land on a `.js`: convex/_generated/api has no `.ts` at all, only api.js
 * beside api.d.ts. A specifier written as `./x.js` is additionally tried as
 * `./x.ts`, which is the NodeNext spelling nothing here uses yet.
 *
 * `#/` IS RESOLVED TOO, even though the rule only talks about relative
 * specifiers. Most of src/ reaches the rest of src/ through the alias, not
 * relatively; stopping at an alias boundary would still catch a violation
 * (every src file is a root, so the far side is walked anyway) but would report
 * a chain starting in the middle, and the chain is the entire value of this
 * test.
 *
 * Returns null for a package import — 'react', '@convex-dev/better-auth' —
 * which is somebody else's graph and not walkable from here.
 *
 * IT ALSO RETURNS NULL, SILENTLY, FOR A LOCAL SPECIFIER THAT IS NEITHER
 * RELATIVE NOR `#/`: a Vite root-relative `/src/lib/x.ts`, or a second `paths`
 * entry added to tsconfig.json. That is the second known gap beside dynamic
 * `import()`, and the more insidious of the two, because such a specifier is
 * indistinguishable here from a package name and is walked past without a word
 * rather than throwing. Neither spelling exists in this repo today. A new alias
 * belongs in the `base` expression below at the same moment it is added to
 * tsconfig.json.
 */
function resolveSpecifier(importer: string, specifier: string): string | null {
  // Vite's asset queries — `../styles.css?url` in routes/__root.tsx,
  // `?raw`, `?inline` — name a real file with an instruction appended. The
  // instruction changes what the bundler DOES with the file, never which file
  // it is, so it is dropped before resolution and the asset resolves as itself.
  const path = specifier.split('?')[0]
  const base = path.startsWith('#/')
    ? resolve(SRC, path.slice(2))
    : path.startsWith('.')
      ? resolve(dirname(importer), path)
      : null
  if (base === null) return null

  const candidates = [
    base,
    ...(base.endsWith('.js') ? [`${base.slice(0, -3)}.ts`, `${base.slice(0, -3)}.tsx`] : []),
    ...CODE.map((extension) => `${base}${extension}`),
    // LAST, and only so an unresolvable specifier means what it says.
    // convex/_generated/dataModel exists ONLY as dataModel.d.ts. Nothing
    // imports it for a value today — every reference is `import type` and so
    // is not an edge at all — but if one ever did, the throw below would
    // report "cannot resolve" for a file that plainly exists, and the next
    // reader would go looking for the wrong bug. Resolving it is ALL this
    // does: `edgesFrom` treats the result as a leaf, for the reason set out
    // there. Landing on a .d.ts must never produce an edge.
    `${base}.d.ts`,
    ...CODE.map((extension) => join(base, `index${extension}`)),
  ]
  for (const candidate of candidates) {
    try {
      if (statSync(candidate).isFile()) return candidate
    } catch {
      // Does not exist; try the next spelling.
    }
  }

  // LOUD, NOT SILENT. A specifier this cannot resolve is a hole in the graph,
  // and a graph with holes is exactly the "check that cannot fail" this file
  // exists to replace. Better a named failure than a quiet green.
  throw new Error(`cannot resolve '${specifier}' from ${show(importer)}`)
}

/**
 * Every runtime edge out of one file, already resolved to real files.
 *
 * A DECLARATION FILE IS A LEAF, exactly like a .json, and this is a rule rather
 * than a heuristic: a .d.ts describes types and emits nothing, so no import
 * written in one is an edge any bundler will ever walk. It needs saying because
 * `.d.ts` ends in `.ts` and would otherwise be parsed as a module — and the
 * live case is not hypothetical. convex/_generated/dataModel.d.ts:18 is
 * `import schema from "../schema.js"`, a NON-type import that
 * `runtimeImportsOf` reports, so one value import of `./_generated/dataModel`
 * from anywhere under src/ would manufacture an edge to convex/schema.ts that
 * exists in no bundle. It is harmless only because schema.ts imports nothing
 * but packages.
 *
 * A FABRICATED EDGE IS WORSE THAN A MISSING ONE, which is the opposite of this
 * file's usual bias and worth being explicit about. A false red on a correct
 * import teaches the next reader that the guard is wrong, and the thing they
 * delete is the guard. Nothing in the repo trips this today — nothing
 * value-imports a .d.ts — so the rule costs no real edge; it removes a latent
 * wrong one. src/build-globals.d.ts is in the graph as a ROOT for the same
 * `.ts` suffix, and is likewise a leaf.
 */
function edgesFrom(file: string): string[] {
  if (file.endsWith('.d.ts')) return []
  if (!CODE.some((extension) => file.endsWith(extension))) return []
  return runtimeImportsOf(file, readFileSync(file, 'utf8')).flatMap((specifier) => {
    const resolved = resolveSpecifier(file, specifier)
    return resolved === null ? [] : [resolved]
  })
}

/**
 * Every .ts/.tsx under src/, recursively — the roots.
 *
 * GENERATED AND TEST FILES INCLUDED, DELIBERATELY. routeTree.gen.ts is the
 * router's actual entry point and is exactly the file a bad edge propagates
 * through, so excluding it would hide the most-connected node in the graph.
 * `.test.ts` files ship nowhere and could be excluded; they are not, because
 * none of them violates the rule today and the day one does is the day someone
 * has imported the server surface into src/ and is one refactor from wiring it
 * to a component.
 */
function sourceFiles(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const path = join(dir, entry.name)
    if (entry.isDirectory()) return sourceFiles(path)
    return entry.name.endsWith('.ts') || entry.name.endsWith('.tsx') ? [path] : []
  })
}

/**
 * The whole reachable graph, as forward edges, memoised so a file is read once.
 * Cycles are fine: a file already in the map is not re-walked.
 */
function graphFrom(roots: string[]): Map<string, string[]> {
  const graph = new Map<string, string[]>()
  const queue = [...roots]
  while (queue.length > 0) {
    const file = queue.pop() as string
    if (graph.has(file)) continue
    const edges = edgesFrom(file)
    graph.set(file, edges)
    queue.push(...edges)
  }
  return graph
}

/**
 * For every file that reaches `target`, the SHORTEST chain to it.
 *
 * A breadth-first walk of the REVERSED graph, seeded at the target, rather than
 * a search per root: one pass answers it for every root at once, the first time
 * a file is seen is by definition its shortest route, and a cycle cannot hang
 * it. The per-dequeue rescan of every node is quadratic in principle and
 * irrelevant at this size; if this graph ever spans a package, build a reverse
 * index once instead of rescanning. (No count is written here on purpose. The first draft said "all 266
 * roots", which was already wrong by one the moment this file was saved — it
 * had counted src/ before adding itself to it — and nothing asserts the number,
 * so it could only ever rot.) The recorded next hop is what turns a boolean into
 * `composer.tsx -> lib/chat.ts -> access.ts -> auth.ts`.
 */
function chainsTo(graph: Map<string, string[]>, target: string): Map<string, string[]> {
  const hop = new Map<string, string>()
  const queue = [target]
  const seen = new Set([target])
  while (queue.length > 0) {
    const to = queue.shift() as string
    for (const [from, edges] of graph) {
      if (seen.has(from) || !edges.includes(to)) continue
      seen.add(from)
      hop.set(from, to)
      queue.push(from)
    }
  }

  const chains = new Map<string, string[]>()
  for (const from of hop.keys()) {
    const chain = [from]
    for (let at = from; at !== target; ) {
      at = hop.get(at) as string
      chain.push(at)
    }
    chains.set(from, chain)
  }
  return chains
}

describe('no frontend module reaches the auth surface', () => {
  const roots = sourceFiles(SRC)
  const graph = graphFrom(roots)
  const toAuth = chainsTo(graph, AUTH)
  const toAccess = chainsTo(graph, ACCESS)

  /**
   * access.ts is guarded BESIDE auth.ts, not instead of it. It is the usual
   * intermediate — it is the file convex/lib/chatLimits.ts's banner names, and
   * the one the real incident went through — and an access.ts that stopped
   * importing auth.ts would still be the wrong side of the server boundary.
   * The auth.ts chain is preferred when both exist, because it is the longer
   * and more explanatory of the two.
   */
  const chainOf = (file: string) => toAuth.get(file) ?? toAccess.get(file)

  test('no file under src/ has a runtime import path to convex/auth.ts', () => {
    const offenders = roots
      .map((root) => chainOf(root))
      .filter((chain): chain is string[] => chain !== undefined)
      .map((chain) => chain.map(show).join(' -> '))

    // THE MESSAGE IS THE POINT. A bare `toBe(0)` tells the next person that
    // something is wrong and nothing about where; the chain tells them which
    // edge to delete. Sorted and de-duplicated so several routes sharing one
    // bad edge read as one problem.
    expect([...new Set(offenders)].sort()).toEqual([])
  })

  /**
   * THE GRAPH IS REAL, WHICH THE ASSERTION ABOVE CANNOT TELL YOU.
   *
   * `toEqual([])` over an empty offender list reads identically whether the
   * walk found nothing wrong or found nothing at all — the grep's exact failure
   * mode, one layer up, and reachable from here by accident. Regress
   * `sourceFiles` to `[]` and the test above goes green; the positive control
   * below goes green beside it, because it builds its own graph from an
   * explicit root and never touches `sourceFiles` or the alias. The `#/` branch
   * is breakable the same way and more quietly still: delete it and those
   * specifiers fall through to `base === null`, which RETURNS NULL rather than
   * throwing.
   *
   * So this pins the SHAPE of the walk instead: a known src file is a root, one
   * of its `#/` edges resolved, one of its relative edges crossed into convex/,
   * and the graph is strictly larger than the root set — which it can only be
   * by following edges out of src/. Every one of those is a containment or a
   * comparison, never a count.
   */
  test('and the walk that produced it covered src/, the alias and the convex boundary', () => {
    const sync = join(SRC, 'components/chat/use-chat-sync.ts')
    expect(roots).toContain(sync)
    // Its two interesting edges, `#/lib/clock-time.ts` and
    // `../../../convex/lib/chatLimits.ts`. Both are explained at length in that
    // file's own header, so neither moves without someone reading about it.
    expect(graph.get(sync)).toContain(join(SRC, 'lib/clock-time.ts'))
    expect(graph.get(sync)).toContain(join(V2, 'convex/lib/chatLimits.ts'))
    expect(graph.size).toBeGreaterThan(roots.length)
  })

  /**
   * THE HALF THAT KEEPS THIS FROM ROTTING THE WAY THE GREP DID.
   *
   * The step this replaces spent an unknown number of deploys printing "clean"
   * while grepping for a string that no longer existed anywhere in the repo. So
   * the walker is also pointed at a chain that IS there: convex/lib/chat.ts
   * reaches auth.ts today, through exactly the hops the incident went through.
   *
   * WHAT THIS ONE COVERS, STATED EXACTLY, because a coverage claim that is not
   * true is the same defect this file exists to fix. It exercises extensionless
   * resolution — convex/access.ts:2 is `from './auth'`, so a resolver that
   * understood only explicit `.ts` would lose the last hop — and it exercises
   * the reverse walk and the chain rendering end to end. It does NOT cover the
   * `#/` alias or the `export ... from` edge: no specifier on this chain is
   * either one. The test above covers the alias; `export ... from` is covered
   * where it is actually decided, in the runtimeImportsOf block below.
   */
  test('and the walker finds the chain that caused the outage, from lib/chat.ts down', () => {
    const chain = chainsTo(graphFrom([join(V2, 'convex/lib/chat.ts')]), AUTH)
    expect(chain.get(join(V2, 'convex/lib/chat.ts'))?.map(show).join(' -> ')).toBe(
      'convex/lib/chat.ts -> convex/access.ts -> convex/auth.ts',
    )
  })
})

/**
 * `runtimeImportsOf` DECIDES WHICH EDGES EXIST, so the guarantee above is only
 * as good as it is — the same argument src/about-screenshots.test.ts makes for
 * pinning `importedModulesOf` before relying on it. Hand-written sources rather
 * than files on disk, so each import FORM is named and isolated.
 */
describe('runtimeImportsOf, on the forms that decide whether an edge ships', () => {
  const modules = (source: string) => runtimeImportsOf('fixture.tsx', source)

  test('a type-only import clause is NOT an edge', () => {
    // THE FALSE POSITIVE THIS PREVENTS, which exists in the repo right now:
    // src/lib/convex-error.ts imports `type AccessCode` from convex/access.ts.
    // verbatimModuleSyntax erases the whole declaration, nothing ships, and a
    // walker that followed it would fail the test above on a correct file.
    expect(modules("import type { AccessCode } from '../../convex/access'")).toEqual([])
    expect(modules("export type { AccessCode } from '../../convex/access'")).toEqual([])
  })

  test('an INLINE type specifier still is, because the declaration survives', () => {
    // `import { type A } from './x'` emits `import {} from './x'` under
    // verbatimModuleSyntax — a real module load. Treating the two spellings
    // alike is how a real edge gets written off as "only a type".
    expect(modules("import { type A } from './x'")).toEqual(['./x'])
    expect(modules("import { type A, b } from './x'")).toEqual(['./x'])
  })

  test('`export ... from` IS an edge, which is where importedModulesOf stops', () => {
    // convex/lib/chat.ts:29 is `export * from './chatLimits.ts'` and
    // src/lib/wordle.ts re-exports out of convex/lib/board.ts, so this form is
    // load-bearing in both graphs. importedModulesOf reports neither, by its
    // own documented contract — hence two functions.
    expect(modules("export * from './chatLimits.ts'")).toEqual(['./chatLimits.ts'])
    expect(modules("export { toRows } from '../../convex/lib/board.ts'")).toEqual([
      '../../convex/lib/board.ts',
    ])
  })

  test('an INLINE type specifier in an EXPORT clause is still an edge', () => {
    // A SEPARATE DECISION FROM THE IMPORT CASE ABOVE, not a spelling of it:
    // the flag read here is `isTypeOnly` on the ExportDeclaration, while the
    // import case reads it on the ImportClause. `export type { A }` erases;
    // `export { type A }` emits a module load. Getting one right says nothing
    // about the other, which is why both are pinned.
    expect(modules("export { type A } from './x'")).toEqual(['./x'])
    expect(modules("export * as ns from './x'")).toEqual(['./x'])
  })

  test('a side-effect import with no clause at all is an edge', () => {
    // `import 'x'` has no importClause, so the type-only test above optional-
    // chains to undefined. The plausible wrong version — reading the clause
    // first and skipping when it is absent — drops the one import form whose
    // entire purpose IS the side effect.
    expect(modules("import './register.ts'")).toEqual(['./register.ts'])
  })

  test('a dynamic import() IS reported — a lazy chunk still ships', () => {
    // This used to be the known gap, and closing it (wordle-teams-tgkm) is what
    // makes the guarantee at the top of this file true of a lazily loaded
    // route. It was empty rather than exploited — every `import(` under src/ is
    // in a .test.ts — which is exactly why it was worth closing before the
    // thing that opens it (route-level code splitting) arrives.
    expect(modules("const x = await import('./x.ts')")).toEqual(['./x.ts'])
  })

  test('a dynamic import() nested in a function is reported too', () => {
    // The whole point of following it: a lazy edge is not at module scope, so a
    // walk that only reads top-level statements sees none of them.
    expect(modules('const f = async () => { await import("./deep.ts") }')).toEqual(['./deep.ts'])
  })

  test('a computed dynamic import() is not reported — the residual gap', () => {
    // There is no literal to report and guessing would be worse than silence.
    // Pinned so the exclusion stays deliberate rather than becoming something
    // the next reader has to rediscover.
    expect(modules('const x = await import(path)')).toEqual([])
  })

  test('a type-only dynamic import type is not an edge', () => {
    // `import('./x.ts')` in TYPE position is erased, so it ships nothing. It is
    // an ImportType node rather than a CallExpression, which is what keeps it
    // out without a special case — asserted so that stays true by test rather
    // than by luck.
    expect(modules("type T = import('./x.ts').Thing")).toEqual([])
  })
})
