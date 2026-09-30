#!/usr/bin/env node
// Prints the build-time VITE_ values for one wrangler environment, as shell
// assignments, for a deploy step to eval (wordle-teams-qjh3.5).
//
//   eval "$(node scripts/print-build-env.mjs)"        # the top level: production
//   eval "$(node scripts/print-build-env.mjs dev)"    # env.dev
//
// WHY THE DEPLOY STEP READS THEM FROM wrangler.jsonc rather than from a second
// committed file: the worker's vars and the client bundle's inlined values must
// name the same Convex deployment per environment, and the failure when they do
// not is SILENT -- the app half-works. Sourcing both from one file is the only
// form of "they must agree" that cannot drift. The argument is in
// scripts/lib/build-env.mjs and in the header of src/lib/convex-url.ts.
//
// THE WORK IS IN scripts/lib/build-env.mjs, which is where its tests are. This
// file is the shell around it: read the config, print, fail loudly. Same division
// as the rest of scripts/ -- see the note in vitest.config.ts about why scripts
// themselves are not imported by tests.
//
// IT PRINTS ONLY VITE_ VARS ON PURPOSE. The others (ENVIRONMENT, MAINTENANCE,
// SENTRY_DSN) are worker RUNTIME vars; wrangler delivers them from this same file
// at deploy time and they have no business in a build environment.
import { fileURLToPath } from 'node:url'
import { experimental_readRawConfig } from 'wrangler'
import { varsForEnvironment, viteAssignments } from './lib/build-env.mjs'

const envName = process.argv[2]

try {
  const config = fileURLToPath(new URL('../wrangler.jsonc', import.meta.url))
  const { rawConfig } = experimental_readRawConfig({ config })
  const lines = viteAssignments(varsForEnvironment(rawConfig, envName))

  if (lines.length === 0) {
    throw new Error(
      `wrangler.jsonc environment "${envName ?? '(top level)'}" declares no VITE_ vars, ` +
        `so the build would fall back to .env.production for every value.`,
    )
  }
  process.stdout.write(`${lines.join('\n')}\n`)
} catch (error) {
  // To stderr, so a shell doing `eval "$(...)"` cannot evaluate the error text.
  process.stderr.write(`print-build-env: ${error instanceof Error ? error.message : error}\n`)
  process.exit(1)
}
