import { execFileSync } from 'node:child_process'
import { defineConfig } from 'vite'
import { devtools } from '@tanstack/devtools-vite'

import { tanstackStart } from '@tanstack/react-start/plugin/vite'

import viteReact from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'
import { cloudflare } from '@cloudflare/vite-plugin'

/**
 * THE SENTRY RELEASE, RESOLVED AT BUILD TIME AND SHARED BY BOTH SDKS.
 *
 * Neither init passed `release`, so client errors and pageload traces could not
 * be tied to a deploy -- the next question after "which environment", and the
 * one wordle-teams-9wpd's environment tag exists to make askable
 * (wordle-teams-b7av). The worker was NOT missing one: @sentry/cloudflare fills
 * it from CF_VERSION_METADATA.id by itself.
 *
 * A COMMIT SHA RATHER THAN THAT CLOUDFLARE VERSION ID, and the reason is that
 * only one of them can be shared. CF_VERSION_METADATA.id is assigned by
 * Cloudflare at DEPLOY time, after the client bundle has already been built, so
 * the browser can never see it -- and a trace whose server span and client span
 * carry different releases is the untidiness b7av lists as a cost. The SHA is
 * available at BUILD time to both halves, and unlike the environment tag a
 * build-time value is CORRECT here: a bundle genuinely does belong to one
 * commit, so the argument that ruled out VITE_ENVIRONMENT does not apply.
 * server.ts keeps the Cloudflare id as a tag so that correlation is not lost.
 *
 * PREFERS GITHUB_SHA over asking git. In CI they agree, but GITHUB_SHA is exact
 * on a shallow or detached checkout, which is what actions/checkout produces.
 *
 * NO `-dirty` SUFFIX, deliberately. It would be unreliable rather than
 * informative: wordle-teams-d9g records that public/sw.js is a tracked build
 * artifact which dirties the tree on every build, so the flag would be set
 * almost always and mean nothing.
 *
 * null WHEN THERE IS NO GIT, not a throw and not a fake value. A build from a
 * tarball still succeeds and Sentry simply gets no release, which is exactly the
 * behaviour that existed before this.
 */
function sentryRelease(): string | null {
  if (process.env.GITHUB_SHA) return process.env.GITHUB_SHA
  try {
    return execFileSync('git', ['rev-parse', 'HEAD'], { encoding: 'utf8' }).trim() || null
  } catch {
    return null
  }
}

const config = defineConfig({
  // JSON.stringify, not template interpolation: `define` performs a raw TEXT
  // substitution, so an unquoted SHA would be spliced in as a bare identifier
  // and fail to parse.
  define: { __SENTRY_RELEASE__: JSON.stringify(sentryRelease()) },
  resolve: { tsconfigPaths: true },
  ssr: { noExternal: ['@convex-dev/better-auth'] },
  plugins: [
    devtools(),
    cloudflare({ viteEnvironment: { name: 'ssr' } }),
    tailwindcss(),
    tanstackStart(),
    viteReact(),
  ],
})

export default config
