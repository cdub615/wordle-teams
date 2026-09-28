// THE PER-ENVIRONMENT BUILD-TIME VALUES, READ BACK OUT OF wrangler.jsonc
// (wordle-teams-qjh3.5).
//
// v2 has two mechanisms for "which Convex deployment is this", and they reach the
// two halves of the app by different routes. wrangler `vars` reach the WORKER at
// runtime; `import.meta.env` values are inlined into the CLIENT bundle at build
// time and never see a wrangler var. wrangler.jsonc's own comment has said for
// months that the two "must agree, so change together" -- and with one deployment
// that was a request. With two it is a correctness requirement, because the
// failure is silent: SSR mints a session against one backend while every browser
// query goes to another, and the app HALF-WORKS rather than erroring. The full
// account is in the header of src/lib/convex-url.ts.
//
// SO THE BUILD VALUES ARE NOT WRITTEN DOWN A SECOND TIME. The deploy step asks
// this module for them, and it reads wrangler.jsonc -- the same bytes the Worker
// will be configured from. There is no second file to keep in sync, which is the
// only version of "they must agree" that cannot rot.
//
// WHY NOT A SECOND .env FILE SELECTED BY `vite build --mode dev`, which is the
// obvious alternative: vite computes `isProduction` from NODE_ENV or the mode, so
// a mode that is not "production" flips `import.meta.env.PROD` -- which
// src/lib/register-sw.ts:118 and src/lib/funnel.ts:100 both read. Service worker
// registration and the funnel would change behaviour as a side effect of choosing
// an environment. Both builds stay mode=production; only process.env differs, and
// vite's loadEnv gives a process.env VITE_ value the final word over .env.production
// (verified in vite/dist/node/chunks/node.js, loadEnv's last loop).
//
// PURE FUNCTIONS OVER A CONFIG OBJECT, so the caller does the file reading. That
// is what lets build-env.test.mjs drive the cases wrangler.jsonc cannot currently
// exhibit -- an environment with no vars, an unknown name, a hostile value.

/** VITE_ is vite's own prefix; only these reach the client bundle. */
const VITE_PREFIX = 'VITE_'

/** The two vars that name a Convex deployment, and must never disagree. */
const CONVEX_URL_VARS = ['VITE_CONVEX_URL', 'VITE_CONVEX_SITE_URL']

/**
 * The vars an environment DECLARES. Never merged with the top level, because
 * wrangler does not merge them either: `vars` is notInheritable, so an omitted key
 * is ABSENT on the deployed Worker. Falling back here would print a value the
 * Worker will not have, which is worse than failing.
 */
export function varsForEnvironment(rawConfig, envName) {
  const block = envName === undefined || envName === '' ? rawConfig : rawConfig.env?.[envName]

  if (!block) {
    const known = Object.keys(rawConfig.env ?? {}).join(', ') || '(none)'
    throw new Error(`wrangler.jsonc declares no environment "${envName}". Declared: ${known}`)
  }

  const vars = block.vars
  if (!vars || Object.keys(vars).length === 0) {
    // Empty is what `vars` DEFAULTS to for a named environment, so this is the
    // notInheritable trap arriving as an exception instead of as an empty export.
    throw new Error(
      `wrangler.jsonc environment "${envName ?? '(top level)'}" declares no vars. ` +
        `They are not inherited from the top level — every key has to be repeated.`,
    )
  }
  return vars
}

/**
 * Shell assignments for the VITE_ vars, for a deploy step to eval.
 *
 * SINGLE-QUOTED WITH THE POSIX ESCAPE, and that is not paranoia about the current
 * contents of wrangler.jsonc — it is that these lines are eval'd. A value is data
 * that happens to be trusted today; the quoting is what keeps that from being a
 * property anyone has to re-verify when somebody adds a var.
 */
export function viteAssignments(vars) {
  return Object.keys(vars)
    .filter((key) => key.startsWith(VITE_PREFIX))
    .sort()
    .map((key) => `${key}='${String(vars[key]).replaceAll("'", String.raw`'\''`)}'`)
}

/**
 * Whether the values a build actually resolved disagree with the environment it
 * says it is building. Returns a message, or null when there is nothing wrong.
 *
 * THIS IS THE GUARD FOR "BUILT WITH THE WRONG DEPLOY KEY". `convex deploy
 * --cmd-url-env-var-name VITE_CONVEX_URL` injects the URL of whatever deployment
 * its key points at, so a workflow that selects CLOUDFLARE_ENV=dev while holding
 * production's key produces a perfectly good bundle aimed at production. Nothing
 * downstream can notice: both URLs are real, both deployments answer.
 *
 * A LOOPBACK VALUE IS NOT A MISMATCH. Building against a local anonymous backend
 * is an ordinary thing to do and is not a deploy; the failure worth catching is
 * naming the wrong CLOUD deployment, which loopback cannot be. Without this, every
 * local `pnpm build` with a .env.local present would fail.
 *
 * AN ABSENT VALUE IS NOT A MISMATCH EITHER — nothing has been resolved, so there
 * is nothing to disagree with.
 */
export function convexMismatch(declaredVars, resolvedEnv) {
  for (const name of CONVEX_URL_VARS) {
    const resolved = resolvedEnv[name]
    if (!resolved || isLoopback(resolved)) continue

    const declared = declaredVars[name]
    if (declared && resolved !== declared) {
      return (
        `${name} disagrees with the wrangler environment being built.\n` +
        `  wrangler.jsonc declares: ${declared}\n` +
        `  the build resolved:      ${resolved}\n` +
        `A bundle built this way would serve one deployment from the Worker and ` +
        `query another from the browser, and would LOOK fine. See src/lib/convex-url.ts.`
      )
    }
  }
  return null
}

function isLoopback(url) {
  try {
    const { hostname } = new URL(url)
    return hostname === 'localhost' || hostname === '127.0.0.1' || hostname === '[::1]'
  } catch {
    return false
  }
}
