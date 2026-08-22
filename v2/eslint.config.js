import js from '@eslint/js'
import globals from 'globals'
import reactHooks from 'eslint-plugin-react-hooks'
import tseslint from 'typescript-eslint'

/**
 * v2's lint setup. Added in Phase 4 (wordle-teams-9lh) for ONE substantive rule
 * — nothing but email.ts may import the Resend client — after that guard had to
 * be added after the fact twice, most recently when invitePlayer mailed real
 * invitations from the production sending domain to addresses that had never
 * existed (wordle-teams-96l).
 *
 * DELIBERATELY NOT A STYLE POLICY. The baseline is the recommended sets and
 * nothing more, so this stays a correctness tool that passes clean rather than a
 * backlog of taste. `no-console` in particular is NOT enabled: the four call
 * sites in src/ and convex/ are all deliberate diagnostics, and whether to
 * police them is its own decision (wordle-teams-61x).
 *
 * `pnpm lint` runs it; CI runs the same command just before the unit tests, so
 * an added rule enforces something rather than sitting in a config nobody runs.
 *
 * THE SCRIPT PASSES --max-warnings 0, and that is not belt-and-braces. Without
 * it the severities point the wrong way: an unused disable directive is an
 * error and fails the deploy, while a genuine missing hook dependency is a
 * warning and ships green — so directive hygiene would be policed harder than
 * the bug the directives are about. A warning nothing acts on is a comment.
 */
export default tseslint.config(
  {
    // GENERATED OR VENDORED — never hand-edited, so linting them reports faults
    // nobody can fix here. routeTree.gen.ts and convex/_generated are written by
    // their generators on every build; worker-configuration.d.ts comes from
    // `wrangler types` and is ~14,700 lines of ambient declarations.
    ignores: [
      'convex/_generated/**',
      'src/routeTree.gen.ts',
      'worker-configuration.d.ts',
      'dist/**',
      // ESLint 10 DOES descend into dot-directories — it is not skipping these
      // for us. They hold generated build state that exists only on a
      // developer's machine (a fresh CI checkout has none of it), so without
      // these a `wrangler deploy` or a dev run leaves bundled worker JS lying
      // around that fails lint locally and passes in CI.
      '.convex/**',
      '.wrangler/**',
      '.tanstack/**',
      '.output/**',
      '.nitro/**',
      'playwright-report/**',
      'test-results/**',
    ],
  },

  js.configs.recommended,
  ...tseslint.configs.recommended,

  {
    // A DIRECTIVE THAT NO LONGER SUPPRESSES ANYTHING IS A LIE about the code
    // beneath it. Erroring on unused ones is what stops this config drifting
    // away from the source it governs — a stale `no-console` directive is
    // exactly how the absence of a linter here first showed up.
    linterOptions: { reportUnusedDisableDirectives: 'error' },
  },

  {
    files: ['**/*.ts', '**/*.tsx'],
    rules: {
      // TypeScript already resolves every identifier, and does it better: it
      // knows the lib and DOM globals per tsconfig, which this rule does not.
      // Left on it reports ~130 phantom errors for `console`, `process`,
      // `window`, `document` and the HTML element types. typescript-eslint's own
      // guidance is to switch it off.
      'no-undef': 'off',

      // In CODE an irregular space is a real hazard. In a COMMENT it can be
      // load-bearing: convex/fixtures.ts uses a zero-width space to stop the
      // `*/` inside a glob pattern from closing the block comment early.
      'no-irregular-whitespace': ['error', { skipComments: true }],
    },
  },

  {
    // scripts/ is Node, run by hand against production — `console` and `process`
    // are its whole job. Declaring the real global set beats switching no-undef
    // off here, because these files are the ONLY ones the rule can still help
    // with: they are .mjs, so TypeScript never checks them.
    //
    // BROWSER GLOBALS TOO, and they are not a mistake: the Playwright scripts
    // pass callbacks to page.waitForFunction, whose bodies are serialised and
    // run inside the page. `document` and `location` there are correct, and
    // no-undef has no way to tell those callbacks from their surrounding Node.
    files: ['scripts/**/*.mjs'],
    languageOptions: { globals: { ...globals.node, ...globals.browser } },
  },

  {
    files: ['src/**/*.ts', 'src/**/*.tsx'],
    plugins: { 'react-hooks': reactHooks },
    rules: {
      // The codebase already carries three `react-hooks/exhaustive-deps`
      // directives, written before any linter existed to honour them. Without
      // the plugin those name a rule ESLint cannot resolve, which is an error in
      // its own right — so this is what makes the existing source consistent,
      // not a new policy.
      'react-hooks/exhaustive-deps': 'warn',

      // Conditional or looped hook calls are a runtime crash, not a matter of
      // taste — squarely the correctness half this config is for. The tree
      // already satisfies it, so it costs nothing to hold the line.
      'react-hooks/rules-of-hooks': 'error',
    },
  },

  {
    // THE RULE THIS CONFIG EXISTS FOR.
    //
    // convex/email.ts keeps the Resend client module-private and exports one
    // guarded `sendEmail`, which drops throwaway e2e recipients. That is a
    // convention a comment cannot enforce: the failure mode is a new module
    // importing Resend directly, and it has happened twice.
    //
    // Scoped to the app's own source. e2e/ and scripts/ do not send mail, and
    // scripts/ is operational tooling that runs against production by hand.
    files: ['convex/**/*.{ts,tsx}', 'src/**/*.{ts,tsx}'],
    rules: {
      'no-restricted-imports': [
        'error',
        {
          paths: [
            {
              name: '@convex-dev/resend',
              message:
                'Send mail through convex/email.ts sendEmail, which drops throwaway e2e recipients. Importing Resend directly bypasses that guard — see wordle-teams-96l.',
            },
          ],
        },
      ],

      // `no-restricted-imports` only inspects static ImportDeclarations, so
      // `await import('@convex-dev/resend')` walks straight past it — and Convex
      // bundles a static-specifier dynamic import perfectly well, so that is a
      // live path, not a theoretical one. Same rule, other syntax.
      //
      // Not chased any further than this. `createRequire` and friends are still
      // open, and the threat model here is a well-meaning developer reaching for
      // the obvious thing, not somebody evading the rule.
      'no-restricted-syntax': [
        'error',
        {
          selector: "ImportExpression[source.value='@convex-dev/resend']",
          message:
            'Send mail through convex/email.ts sendEmail, which drops throwaway e2e recipients. Importing Resend directly bypasses that guard — see wordle-teams-96l.',
        },
      ],
    },
  },

  {
    // The two files that legitimately reach the component: email.ts owns the
    // client, and convex.config.ts registers it with the deployment.
    //
    // Only the email.ts half is doing any work today. convex.config.ts imports
    // the DEEP path '@convex-dev/resend/convex.config.js', which `paths` never
    // matches, so it would pass with or without this entry — it is here so that
    // a future edit to a bare specifier does not turn into a puzzling failure.
    files: ['convex/email.ts', 'convex/convex.config.ts'],
    rules: { 'no-restricted-imports': 'off', 'no-restricted-syntax': 'off' },
  },
)
