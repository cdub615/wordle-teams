import ts from 'typescript'

/**
 * READING SOURCE FILES AS ARTEFACTS, WITH THE COMPILER RATHER THAN A REGEX.
 *
 * Several modules in this app cannot be imported by a test. Anything calling
 * createFileRoute registers against a router that does not exist under vitest,
 * and a `redirect()` thrown from beforeLoad is only observable with one
 * running — so for those files the SOURCE TEXT IS the artefact that ships, and
 * reading it is the only assertion available. src/routes.test.ts,
 * src/styles.test.ts and src/lib/sw-push.test.ts all do this.
 *
 * WHERE STRING MATCHING IS THE WRONG TOOL, AND WHY THIS FILE EXISTS.
 * `toMatch(/errorCallbackURL: '\/login-error'/)` on a whole file is satisfied by
 * that text sitting in a `const` nothing reads. Detaching the option from the
 * real `signIn.social` call and leaving the literal behind passed all four
 * gates AND all 54 e2e tests. The same trick worked on `onAPIError` in the
 * betterAuth config.
 *
 * A regex spanning the call would fix that one mutation and pin INDENTATION and
 * property order along with it. The compiler already has an exact answer and
 * `typescript` is already a devDependency, so these ask it: find a call by its
 * callee's source text, take its object-literal argument, and hand back that
 * literal's OWN top-level properties. A detached literal is not one of them at
 * any indentation, and reformatting a file changes nothing here.
 *
 * IT LIVES IN src/ RATHER THAN NEXT TO ONE TEST because two suites now need it
 * — src/routes.test.ts and src/crawler-metadata.test.ts — and a copy in each is
 * how a helper drifts into two behaviours. Nothing in the app imports it, so it
 * reaches no bundle; the vitest include glob matches only `.test.ts`, so
 * it is not collected as a suite of its own either.
 *
 * READING IS LEFT TO THE CALLER. Every existing suite resolves its paths with
 * `new URL(path, import.meta.url)`, which is relative to the file doing the
 * asking — so these take the text and a name for it rather than a path to open.
 */

/**
 * Comments stripped, so an assertion reads the CODE. Files like routes/me.tsx
 * are mostly prose explaining why they exist, and that prose quotes the very
 * literals being pinned — a match inside it would prove nothing.
 *
 * THE PARSER DOES THE STRIPPING, AND IT HAS TO. This was two regexes — one for
 * block comments, one deleting from a `//` to the end of the line — and the
 * second could not tell a comment from the middle of a string. Every absolute
 * URL in source tripped it:
 *
 *     const url = 'https://wordleteams.com/app'; localStorage.setItem('x', y)
 *
 * became `const url = 'https:` and nothing else. That is the opposite of the
 * failure this helper exists to prevent: a forbidden token sitting after a URL
 * on the same line was deleted BEFORE the guard saw it, so
 * `not.toMatch(/localStorage/)` passed on a file that violated it. Stripping
 * LESS than intended shows up as a red test; stripping more is silent, which is
 * why the safe direction is the one taken below and why this is not another
 * regex — `//` lives in URLs, in template literals, in regex character classes
 * and in JSX text, and a regex would have to understand all four.
 *
 * Every comment in a file is leading trivia of exactly one token, so walking
 * the tokens and asking `getLeadingCommentRanges` at each one finds all of them
 * and nothing else. The ranges are cut out rather than blanked, which is what
 * the regexes did: a line comment leaves its newline behind and a block comment
 * closes up, so no caller's idea of the text changes except in the case above.
 *
 * JsxText IS SKIPPED, and the skip is load-bearing. Its token carries its own
 * leading whitespace, so `getLeadingCommentRanges` scanning past that whitespace
 * would report a `//` that opens a line of PROSE as a comment — `<p>  // ...` —
 * and delete rendered copy. Nothing else here can produce a comment range that
 * is not one.
 *
 * PARSED AS TSX regardless of the caller's file, because most callers pass one
 * and the alternative mis-scans JSX text as code. The cost is that `<T>value`
 * assertion syntax in a `.ts` file would be read as a JSX element; none exists
 * in this repo, and the failure would be under-stripping, which is red.
 */
export const codeOf = (source: string) => {
  const file = ts.createSourceFile(
    'codeOf.tsx',
    source,
    ts.ScriptTarget.ESNext,
    /* setParentNodes */ true,
    ts.ScriptKind.TSX,
  )

  const comments: ts.CommentRange[] = []
  const collect = (node: ts.Node): void => {
    const children = node.getChildren(file)
    if (children.length > 0) {
      for (const child of children) collect(child)
      return
    }
    if (node.kind === ts.SyntaxKind.JsxText) return
    // BOTH, because `getLeadingCommentRanges` deliberately ignores a comment
    // sitting on the same line as the position it is given: `const a = 1 // x`
    // is leading trivia of the NEXT line's token, and the leading scan does not
    // start collecting until it has passed a newline. The trailing scan covers
    // exactly that stretch — the position up to the first line break — so the
    // pair of them sees every comment in the file and each one once.
    const start = node.getFullStart()
    for (const range of ts.getTrailingCommentRanges(source, start) ?? []) comments.push(range)
    for (const range of ts.getLeadingCommentRanges(source, start) ?? []) comments.push(range)
  }
  collect(file)

  let out = ''
  let cursor = 0
  for (const range of comments.sort((a, b) => a.pos - b.pos)) {
    if (range.pos < cursor) continue
    out += source.slice(cursor, range.pos)
    cursor = range.end
  }
  return out + source.slice(cursor)
}

/** `name` is used only for diagnostics and to pick the TSX parser. */
export const parseSource = (name: string, source: string) =>
  ts.createSourceFile(
    name,
    source,
    ts.ScriptTarget.ESNext,
    /* setParentNodes */ true,
    name.endsWith('.tsx') ? ts.ScriptKind.TSX : ts.ScriptKind.TS,
  )

/** The top-level properties of an object literal, by name. */
export const propertiesOf = (node: ts.Node): Map<string, ts.Expression> => {
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
 * text — `betterAuth`, `authClient.signIn.social`, `createFileRoute('/me')`.
 * Throws rather than returning an empty map, so a renamed or deleted call is a
 * named failure and not a silent pass on `undefined`.
 */
export const optionsPassedTo = (
  name: string,
  source: string,
  callee: string,
): Map<string, ts.Expression> => {
  const found: ts.ObjectLiteralExpression[] = []
  const visit = (node: ts.Node): void => {
    if (ts.isCallExpression(node) && node.expression.getText() === callee) {
      const literal = node.arguments.find(ts.isObjectLiteralExpression)
      if (literal) found.push(literal)
    }
    ts.forEachChild(node, visit)
  }
  visit(parseSource(name, source))
  if (found.length !== 1)
    throw new Error(`expected exactly one ${callee}({...}) in ${name}, found ${found.length}`)
  return propertiesOf(found[0])
}

/**
 * The attributes of exactly one JSX element, by name, each rendered as the
 * source text of its VALUE — `<TeamPicker onUpgrade={...} />`.
 *
 * THE JSX SIBLING OF `optionsPassedTo`, AND IT EXISTS FOR THE SAME MUTATION.
 * A handler wired to a component is a prop, not an option on a call, so the
 * helper above cannot see one; a `toMatch` over the file is satisfied by the
 * handler's text sitting anywhere, including in a prop nothing renders or a
 * const nothing passes. Making routes/app.tsx's "Upgrade for more" dead —
 * `onUpgrade={() => {}}` — passed lint, typecheck and the whole suite.
 *
 * The braces are unwrapped, so `onUpgrade={() => void startUpgrade()}` reads
 * back as `() => void startUpgrade()`; a string attribute reads back with its
 * quotes, as `getText()` gives them. A valueless attribute (`<X disabled />`)
 * is not reported — nothing here needs one, and a caller that does must say so.
 *
 * Exactly one element, for `optionsPassedTo`'s reason: a second `<TeamPicker>`
 * appearing in a branch this does not read is a change worth failing on.
 */
export const jsxPropsOf = (name: string, source: string, tag: string): Map<string, string> => {
  const found = jsxElementsOf(name, source, tag)
  if (found.length !== 1)
    throw new Error(`expected exactly one <${tag}> in ${name}, found ${found.length}`)
  return found[0]
}

/**
 * The same, for EVERY element with that tag, in source order.
 *
 * `jsxPropsOf`'s one-element rule is the right default and stays the default —
 * a second `<TeamPicker>` in a branch a test does not read is worth failing on.
 * But a tag can also be a generic wrapper that a file legitimately uses more
 * than once: routes/app.tsx now renders TWO `<Link>`s in one row, "Team
 * settings" and "Team chat", and the assertion worth making is "one of these
 * goes to /chat carrying the selected team", which the singular helper cannot
 * express at all. Callers pick the element they mean out of this list rather
 * than being handed whichever one happened to be first.
 */
export const jsxElementsOf = (
  name: string,
  source: string,
  tag: string,
): Array<Map<string, string>> => {
  const found: ts.JsxAttributes[] = []
  const visit = (node: ts.Node): void => {
    if (
      (ts.isJsxSelfClosingElement(node) || ts.isJsxOpeningElement(node)) &&
      node.tagName.getText() === tag
    ) {
      found.push(node.attributes)
    }
    ts.forEachChild(node, visit)
  }
  visit(parseSource(name, source))
  return found.map(
    (attributes) =>
      new Map(
        attributes.properties.flatMap((property) => {
          if (!ts.isJsxAttribute(property) || !property.initializer) return []
          const value = property.initializer
          const inner = ts.isJsxExpression(value) ? value.expression : value
          return inner ? [[property.name.getText(), inner.getText()] as const] : []
        }),
      ),
  )
}

/**
 * The elements of an array-literal expression, each rendered as its own source
 * text. Bounded to that one array: an element is an element, never "a line that
 * happens to sit somewhere in the file".
 */
export const elementsOf = (node: ts.Node): string[] => {
  if (!ts.isArrayLiteralExpression(node))
    throw new Error(`expected an array literal, got ${ts.SyntaxKind[node.kind]}`)
  return node.elements.map((element) => element.getText())
}

/**
 * The object literal an arrow function returns — `() => ({ ... })`, the shape a
 * route's `head` uses. Unwraps the parentheses TypeScript records as a real
 * node, and throws on anything else rather than guessing.
 *
 * BLOCK BODIES TOO, which is the extension the previous version of this comment
 * asked for by name. convex/auth.ts's `createAuthOptions` is
 * `(ctx) => { const siteUrl = ...; return { ... } }` — it has to compute a local
 * before the literal can be written, so a concise body is not available to it.
 * Exactly one top-level `return` of an object literal counts: a body that
 * returns conditionally has no single literal to hand back, and guessing which
 * branch was meant is how a helper starts lying to the suite that trusts it.
 */
export const returnedObjectOf = (node: ts.Node): ts.ObjectLiteralExpression => {
  if (!ts.isArrowFunction(node))
    throw new Error(`expected an arrow function, got ${ts.SyntaxKind[node.kind]}`)
  let body: ts.Node = node.body

  if (ts.isBlock(body)) {
    // TOP-LEVEL STATEMENTS ONLY, deliberately not a recursive walk: a `return`
    // nested inside an `if` or a callback is a different code path, and pinning
    // an option found down one of those would assert something the caller does
    // not necessarily reach.
    const returned = body.statements.filter(ts.isReturnStatement)
    if (returned.length !== 1)
      throw new Error(`expected exactly one top-level return, found ${returned.length}`)
    if (!returned[0].expression) throw new Error('expected a return with a value')
    body = returned[0].expression
  }

  while (ts.isParenthesizedExpression(body)) body = body.expression
  if (!ts.isObjectLiteralExpression(body))
    throw new Error(`expected an object-returning arrow, got a body of ${ts.SyntaxKind[body.kind]}`)
  return body
}

/**
 * Every module specifier the file imports, in source order — the strings after
 * `from`, plus any bare `import 'x'` side-effect import.
 *
 * A BOUNDED LIST, WHICH IS THE WHOLE POINT. "this file does not mention
 * aceternity" is a substring test over a blob: it is satisfied by a file that
 * imports the component under an alias, and it goes red on a comment that
 * merely names the thing being ruled out — which the file whose dependency was
 * ruled out is exactly the file most likely to contain. The import list is a
 * short array a test can assert with `toEqual`, so an ADDED dependency fails as
 * loudly as a removed one.
 *
 * Dynamic `import()` is not an ImportDeclaration and is not reported here.
 * Nothing in src/routes uses it; a caller that needs to care must say so.
 *
 * NOT THE FUNCTION TO WALK A GRAPH WITH — see `runtimeImportsOf` at the foot of
 * this file. This one answers "which modules does the file NAME", type-only
 * declarations included and `export ... from` excluded. Both of those are wrong
 * for "which edges does the bundler follow", and the type-only half fails on a
 * correct file in this repo today. That is stated here because this is the
 * older and more findable of the two, so it is the one a future caller reaches
 * for first.
 */
export const importedModulesOf = (name: string, source: string): string[] => {
  const out: string[] = []
  for (const statement of parseSource(name, source).statements) {
    if (ts.isImportDeclaration(statement) && ts.isStringLiteral(statement.moduleSpecifier)) {
      out.push(statement.moduleSpecifier.text)
    }
  }
  return out
}

/**
 * The object literal a top-level `const NAME = { ... }` is initialised with.
 *
 * Exists because some values worth pinning are deliberately NOT exported —
 * convex/auth.ts's PROVIDER_ENV is the authoritative list of sign-in providers
 * and is module-private, so a test cannot import it and must read the source.
 * Reaching it through the parser rather than a regex matters for the reason
 * codeOf's comment gives: the file's own prose names the providers repeatedly,
 * and a textual match would be satisfied by any of that.
 *
 * Throws rather than returning an empty map, so a renamed or deleted
 * declaration is a named failure and not a silent pass.
 */
export const objectLiteralAssignedTo = (
  name: string,
  source: string,
  identifier: string,
): Map<string, ts.Expression> => {
  const found: ts.ObjectLiteralExpression[] = []
  const visit = (node: ts.Node): void => {
    if (
      ts.isVariableDeclaration(node) &&
      node.name.getText() === identifier &&
      node.initializer
    ) {
      // `{...} as const` and `{...} satisfies T` wrap the literal.
      let init: ts.Node = node.initializer
      while (ts.isAsExpression(init) || ts.isSatisfiesExpression(init)) init = init.expression
      if (ts.isObjectLiteralExpression(init)) found.push(init)
    }
    ts.forEachChild(node, visit)
  }
  visit(parseSource(name, source))

  if (found.length !== 1) {
    throw new Error(`expected exactly one \`const ${identifier} = {...}\` in ${name}, found ${found.length}`)
  }
  return propertiesOf(found[0])
}

/**
 * The object literal returned by a top-level `const NAME = (...) => ...`.
 *
 * THE SIBLING OF `objectLiteralAssignedTo`, for the case where the value worth
 * pinning is built by a function rather than written as a const. convex/auth.ts
 * used to pass its Better Auth options straight to `betterAuth({ ... })`, where
 * `optionsPassedTo` could see them; `createAuthOptions` was split out so the
 * local Better Auth component could import the same options, and the literal
 * stopped being an argument to any call. The protection is unchanged and the
 * mutation is the same one `optionsPassedTo` was written against: an option
 * lifted out of this literal into a detached `const` is not a property of it.
 *
 * Locating is all this does — unwrapping is `returnedObjectOf`'s job, so both
 * arrow shapes are understood here for free. Throws rather than returning an
 * empty map, so a renamed or deleted declaration is a named failure.
 */
export const objectLiteralReturnedBy = (
  name: string,
  source: string,
  identifier: string,
): Map<string, ts.Expression> => {
  const found: ts.ArrowFunction[] = []
  const visit = (node: ts.Node): void => {
    if (
      ts.isVariableDeclaration(node) &&
      node.name.getText() === identifier &&
      node.initializer &&
      ts.isArrowFunction(node.initializer)
    ) {
      found.push(node.initializer)
    }
    ts.forEachChild(node, visit)
  }
  visit(parseSource(name, source))

  if (found.length !== 1) {
    throw new Error(
      `expected exactly one \`const ${identifier} = (...) => ...\` in ${name}, found ${found.length}`,
    )
  }
  return propertiesOf(returnedObjectOf(found[0]))
}

/**
 * Every module specifier that survives into the EMITTED module — the edges a
 * bundler actually walks. `importedModulesOf`'s sibling, and deliberately a
 * second function rather than an option on it.
 *
 * WHY NOT JUST USE `importedModulesOf`. Its contract is "every line naming a
 * module", pinned specifier-for-specifier by a block of `toEqual` tests in
 * src/about-screenshots.test.ts, and that contract is right for what it
 * guards: /about must not NAME the aceternity carousel under any import form,
 * erased or not. A graph walk asks a different question — what ships — and the
 * two answers differ in both directions on files that exist today:
 *
 *   - `import type` IS reported by `importedModulesOf` and must NOT be walked.
 *     src/lib/convex-error.ts:3 carries `import type { AccessCode } from
 *     '../../convex/access'`. `verbatimModuleSyntax` is on, so that declaration
 *     is erased whole and reaches no bundle. Walking it would fail
 *     src/frontend-import-graph.test.ts on a legitimate file today, and the
 *     next reader would delete the guard rather than the import.
 *   - `export ... from` is NOT reported by `importedModulesOf` — its own test
 *     says so, on purpose — and MUST be walked. It is a runtime edge:
 *     convex/lib/chat.ts:29 re-exports `./chatLimits.ts`, and src/lib/wordle.ts
 *     re-exports out of convex/lib/board.ts. A guard blind to it would be
 *     evaded by one `export { x } from '../../convex/lib/chat.ts'`.
 *
 * INLINE `type` SPECIFIERS STAY, and that is not an oversight:
 * `import { type A, b } from './x'` and even `import { type A } from './x'`
 * both still emit a real import of './x' under `verbatimModuleSyntax`. Only a
 * type-only CLAUSE (`import type {...}` / `export type {...}`) is erased, which
 * is exactly the flag read here.
 *
 * DYNAMIC `import()` IS FOLLOWED, and this is where it differs from
 * `importedModulesOf` for the second time (wordle-teams-tgkm). A lazily loaded
 * chunk still ships, so it is a real runtime edge and skipping it was a hole in
 * every guard built on this — `await import('../../convex/auth.ts')` from a
 * src/ module reached the auth surface and reported clean. It was EMPTY rather
 * than exploited: measured twice, every `import(` under src/ sits in a
 * `.test.ts`. Closed before it opened, because the thing that would open it is
 * TanStack Router turning on route-level code splitting, which is a config
 * change nobody would connect to this file.
 *
 * A COMPUTED SPECIFIER STILL CANNOT BE FOLLOWED, and that is the residual gap:
 * `import(path)` has no literal to report and this skips it rather than
 * guessing. It is pinned by its own case in src/frontend-import-graph.test.ts so
 * the exclusion stays deliberate.
 *
 * ONE WALK, IN SOURCE ORDER, and the parent check is why it can be one. An
 * `import ... from` is only a real declaration at module scope, so counting one
 * found deeper — inside a `declare module` block — would report an edge the
 * bundler does not follow. Dynamic `import()` is the opposite: it is an
 * expression and belongs wherever it appears.
 */
export const runtimeImportsOf = (name: string, source: string): string[] => {
  const file = parseSource(name, source)
  const out: string[] = []

  const visit = (node: ts.Node): void => {
    if (
      ts.isImportDeclaration(node) &&
      node.parent === file &&
      !node.importClause?.isTypeOnly &&
      ts.isStringLiteral(node.moduleSpecifier)
    ) {
      out.push(node.moduleSpecifier.text)
    }
    if (
      ts.isExportDeclaration(node) &&
      node.parent === file &&
      !node.isTypeOnly &&
      node.moduleSpecifier &&
      ts.isStringLiteral(node.moduleSpecifier)
    ) {
      out.push(node.moduleSpecifier.text)
    }
    if (ts.isCallExpression(node) && node.expression.kind === ts.SyntaxKind.ImportKeyword) {
      const [specifier] = node.arguments
      if (specifier && ts.isStringLiteral(specifier)) out.push(specifier.text)
    }
    ts.forEachChild(node, visit)
  }
  visit(file)
  return out
}

/**
 * EVERY PLACE `callee(...)` IS CALLED — with what, and among which neighbours.
 *
 * THE MUTATION IT EXISTS FOR is the one the helpers above do not reach: a call
 * that is still in the file, still spelled correctly, and in the WRONG PLACE.
 * `rememberLoginAttempt(provider)` lifted out of `signInWith` into the `if
 * (error)` branch below it still matches every `toMatch` anyone would write,
 * still type-checks and still lints — and records an attempt only when the
 * redirect FAILED, which is the exact inversion of what it is for. Neither
 * `optionsPassedTo` (no object literal) nor `jsxPropsOf` (not JSX) can see a
 * bare statement call at all.
 *
 * `within` IS BOUNDED TO THE INNERMOST ENCLOSING FUNCTION, which is what makes
 * an ordering assertion mean something. Comparing `indexOf` over a whole file's
 * text answers "which line is higher up", and two calls in unrelated functions
 * have an order by that measure too; comparing positions inside one body
 * answers "which runs first", which is the claim. Nested calls are included —
 * a call inside a `.map()` callback inside the body is still something the body
 * does — and the target call itself appears in its own list, so a caller can
 * locate it without a second walk.
 *
 * `within` HOLDS CALLEE TEXTS, SO DUPLICATES COLLAPSE. A body that calls
 * `setError` three times contributes three indistinguishable entries, which
 * makes `indexOf`/`lastIndexOf` on that name a positional guess rather than a
 * reference to the call the caller meant. PREFER A UNIQUE ANCHOR; where the
 * repeated one IS the anchor that expresses the property — "past the last
 * `setError`", meaning past the refusal branch — say so at the call site and
 * reach for `orderedIn` below, which is defined over all occurrences and so has
 * no position to guess at.
 *
 * ONE ENTRY PER CALL SITE, in source order, and deliberately NOT an
 * exactly-one rule like `optionsPassedTo`'s: /login legitimately records an
 * attempt from two different handlers, and a caller that means "exactly one"
 * can assert the length. A call at module scope THROWS rather than being
 * reported with an empty `within`, because "outside any function" is not an
 * ordering a test can usefully assert and silently returning `[]` would read as
 * a pass.
 */
export const callSitesOf = (
  name: string,
  source: string,
  callee: string,
): Array<{ args: string[]; within: string[] }> => {
  const isFunctionLike = (node: ts.Node): node is ts.FunctionLikeDeclaration =>
    ts.isFunctionDeclaration(node) ||
    ts.isFunctionExpression(node) ||
    ts.isArrowFunction(node) ||
    ts.isMethodDeclaration(node)

  const enclosingFunction = (node: ts.Node): ts.FunctionLikeDeclaration | undefined => {
    for (let current: ts.Node | undefined = node.parent; current; current = current.parent) {
      if (isFunctionLike(current)) return current
    }
    return undefined
  }

  const calleesIn = (node: ts.Node): string[] => {
    const out: string[] = []
    const walk = (inner: ts.Node): void => {
      if (ts.isCallExpression(inner)) out.push(inner.expression.getText())
      ts.forEachChild(inner, walk)
    }
    walk(node)
    return out
  }

  const sites: Array<{ args: string[]; within: string[] }> = []
  const visit = (node: ts.Node): void => {
    if (ts.isCallExpression(node) && node.expression.getText() === callee) {
      const enclosing = enclosingFunction(node)
      if (!enclosing)
        throw new Error(`\`${callee}(...)\` in ${name} is not inside a function`)
      sites.push({
        args: node.arguments.map((argument) => argument.getText()),
        within: calleesIn(enclosing.body ?? enclosing),
      })
    }
    ts.forEachChild(node, visit)
  }
  visit(parseSource(name, source))
  return sites
}

/**
 * "EVERY CALL TO `first` HAPPENS BEFORE EVERY CALL TO `then`", over one
 * `callSitesOf` body. THROWS if either name is absent from it.
 *
 * THE THROW IS THE ENTIRE POINT, and it is `optionsPassedTo`'s stance applied
 * to an ordering. The natural spelling of this assertion is
 *
 *     expect(within.indexOf(a)).toBeGreaterThan(within.indexOf(b))
 *
 * and `indexOf` answers -1 for a name that is not there, so ANY value is
 * greater than an absent `b` and the assertion silently stops asserting the
 * moment someone renames the anchor. Two of this repo's ordering tests were
 * written that way and were vacuity-proof only by accident — one had a
 * neighbouring `toContain`, the other a `.filter` that happened to require the
 * anchor. A rename should be a named failure, not a green test.
 *
 * DEFINED OVER ALL OCCURRENCES — `lastIndexOf(first) < indexOf(then)` — which
 * is what makes it safe on the duplicate-collapse edge described above. "Past
 * the last setError" needs no index arithmetic at the call site and cannot
 * drift when a fourth `setError` appears.
 *
 * Returns a boolean rather than asserting, so the caller supplies its own
 * message and the failure reads in that suite's own terms.
 */
export const orderedIn = (within: string[], first: string, then: string): boolean => {
  for (const anchor of [first, then]) {
    if (!within.includes(anchor)) {
      throw new Error(
        `\`${anchor}\` is not called in that body, so no ordering involving it can be ` +
          `asserted — the body calls: ${within.join(', ')}`,
      )
    }
  }
  return within.lastIndexOf(first) < within.indexOf(then)
}
