import { execFileSync } from 'node:child_process'
import { defineConfig } from 'vite'
import { devtools } from '@tanstack/devtools-vite'

import { tanstackStart } from '@tanstack/react-start/plugin/vite'

import viteReact from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'
import { cloudflare } from '@cloudflare/vite-plugin'
import { sentryTanstackStart } from '@sentry/tanstackstart-react/vite'

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

const RELEASE = sentryRelease()

const config = defineConfig({
  // JSON.stringify, not template interpolation: `define` performs a raw TEXT
  // substitution, so an unquoted SHA would be spliced in as a bare identifier
  // and fail to parse.
  define: { __SENTRY_RELEASE__: JSON.stringify(RELEASE) },
  /**
   * SOURCE MAPS EXIST AT ALL NOW, WHICH THEY DID NOT (wordle-teams-p1as).
   * `find dist -name "*.map"` returned nothing, so every Sentry stack trace on
   * both sides pointed into minified rolldown output, and wrangler.jsonc's
   * `upload_source_maps: true` had nothing to find and uploaded nothing.
   *
   * SETTING THIS EXPLICITLY DISABLES A SAFETY DEFAULT, so the sentry plugin
   * below MUST pass `filesToDeleteAfterUpload` by hand. Its wrapper only
   * auto-fills that when BOTH the option is unset AND `build.sourcemap` is
   * undefined (sourceMaps.js: `typeof config.build?.sourcemap === "undefined"`).
   * Turning maps on the obvious way therefore switches the deletion OFF, and
   * the maps would be emitted into dist/client and served publicly. Read from
   * the installed source, not assumed.
   *
   * `true` RATHER THAN 'hidden', accepting one known cost: the client chunks
   * keep a `sourceMappingURL` comment pointing at a file that has been deleted,
   * so devtools asks for it and gets a 404. 'hidden' would omit that comment
   * and is the tidier answer for an upload-then-delete flow — but it would omit
   * it for the SERVER build too, whose maps are KEPT for Cloudflare, and
   * whether wrangler's uploader still associates them without the comment is
   * unverified. A devtools 404 is harmless; silently un-associating the worker
   * maps would undo half of this change.
   */
  build: { sourcemap: true },
  resolve: { tsconfigPaths: true },
  ssr: { noExternal: ['@convex-dev/better-auth'] },
  plugins: [
    devtools(),
    cloudflare({ viteEnvironment: { name: 'ssr' } }),
    tailwindcss(),
    tanstackStart(),
    viteReact(),
    /**
     * UPLOADS THE SOURCE MAPS AND THEN DELETES THE PUBLIC ONES.
     *
     * Not a new dependency: @sentry/vite-plugin and @sentry/cli are already
     * here through @sentry/tanstackstart-react, which also exports this
     * first-party wrapper.
     *
     * `release.name` IS PASSED RATHER THAN DETECTED, even though the plugin
     * would default to the same git HEAD SHA. Sentry files uploaded artifacts
     * under a RELEASE and applies them to events carrying that release — so if
     * the plugin's detection and __SENTRY_RELEASE__ above ever diverge, the
     * upload silently applies to nothing and every trace stays minified with
     * every gate green. One value, passed twice, cannot drift.
     *
     * ONLY THE CLIENT MAPS ARE DELETED, and the asymmetry is deliberate:
     *   dist/client  IS the public asset directory (the generated
     *                dist/server/wrangler.json sets assets.directory to
     *                "../client"), so a .map left there is the whole source
     *                tree on a public URL.
     *   dist/server  is worker code and is served to nobody. Keeping its maps
     *                is what finally makes wrangler.jsonc's
     *                `upload_source_maps: true` do something — Cloudflare
     *                uploads them and the CF dashboard unminifies too. That
     *                line was decorative until this change.
     *
     * THE GLOB IS SCOPED TO dist/client ON PURPOSE. The wrapper's own default
     * is a bare recursive map glob rooted at the working directory, which would
     * sweep node_modules as well. (Written out rather than quoted here because
     * a recursive glob contains the characters that end a block comment, which
     * is worth knowing before someone pastes one back in.)
     *
     * NO authToken HERE — the plugin reads SENTRY_AUTH_TOKEN from the
     * environment, and it is a real secret (unlike the DSN), so it lives in
     * GitHub Actions secrets. A local build has none: the plugin warns, skips
     * the upload, and the build still succeeds.
     */
    sentryTanstackStart({
      org: 'christian-white',
      project: 'wordle-teams-v2',
      release: { name: RELEASE ?? undefined },
      sourcemaps: { filesToDeleteAfterUpload: ['./dist/client/**/*.map'] },
      // Opt out of the plugin's build-usage telemetry to Sentry. On by default,
      // and nothing here needs it.
      telemetry: false,
    }),
  ],
})

export default config
