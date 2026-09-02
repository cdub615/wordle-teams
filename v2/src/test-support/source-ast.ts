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
 */
export const codeOf = (source: string) =>
  source.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/[^\n]*/g, '')

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
  if (found.length !== 1)
    throw new Error(`expected exactly one <${tag}> in ${name}, found ${found.length}`)
  return new Map(
    found[0].properties.flatMap((property) => {
      if (!ts.isJsxAttribute(property) || !property.initializer) return []
      const value = property.initializer
      const inner = ts.isJsxExpression(value) ? value.expression : value
      return inner ? [[property.name.getText(), inner.getText()] as const] : []
    }),
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
 * node, and throws on anything else rather than guessing, so a `head` rewritten
 * as a block body is a named failure telling you to teach this helper about it.
 */
export const returnedObjectOf = (node: ts.Node): ts.ObjectLiteralExpression => {
  if (!ts.isArrowFunction(node))
    throw new Error(`expected an arrow function, got ${ts.SyntaxKind[node.kind]}`)
  let body: ts.Node = node.body
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
