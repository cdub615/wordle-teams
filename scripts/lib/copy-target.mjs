// WHICH DEPLOYMENT copy-from-supabase.mjs IS ABOUT TO WRITE TO
// (wordle-teams-qjh3.12).
//
// The copy is aimed by CONVEX_URL and CONVEX_MIGRATION_KEY, which is fine and
// needs no change — the script was always explicit about its target. What changed
// is that there are now THREE deployments in play (local, dev, and the one that
// becomes production) instead of one, so "which am I pointed at" stopped being
// rhetorical.
//
// docs/runbooks/2026-cutover.md's section 0 already makes reading a sentinel first
// a rule for every shell, because there are two silent ways to address the wrong
// machine. A rule is a thing an operator follows at 6am with DNS waiting; this
// moves it into the tool, which is the version that cannot be skipped.
//
// IT RESOLVES AGAINST wrangler.jsonc rather than a list written here, so the
// deployment-to-environment mapping has exactly one home — the same file the
// Worker's vars and the build's values come from (wordle-teams-qjh3.5). A second
// list would be a second thing to update, and the one nobody would.
//
// PURE, AND TAKES THE ENVIRONMENTS AS A PARAMETER, so copy-target.test.mjs can
// drive the cases that matter — an unknown deployment, a malformed URL, and the
// "wrangler.jsonc could not be read" path, which arrives here as an empty list.

/** `successful-canary-135` out of either of that deployment's two URLs. */
function slugOf(url) {
  try {
    const { hostname } = new URL(String(url))
    if (hostname === 'localhost' || hostname === '127.0.0.1' || hostname === '[::1]') return 'local'
    const match = /^([a-z0-9-]+)\.convex\.(cloud|site)$/.exec(hostname)
    return match ? match[1] : null
  } catch {
    return null
  }
}

/**
 * Describe the deployment `convexUrl` names.
 *
 * `environments` is [{ name, host, convexUrl }] read from wrangler.jsonc.
 *
 * Returns { kind, label, environment?, host?, slug? } where kind is:
 *   'environment' — a deployment wrangler.jsonc declares. Safe to proceed.
 *   'local'       — a loopback backend. Ordinary while developing.
 *   'unknown'     — anything else, INCLUDING the case where the environments
 *                   could not be read. The caller treats this as needing an
 *                   explicit acknowledgement before a real write.
 */
export function describeCopyTarget(convexUrl, environments) {
  const slug = slugOf(convexUrl)

  if (slug === 'local') {
    return { kind: 'local', label: 'a LOCAL backend', slug: 'local' }
  }

  if (slug) {
    for (const environment of environments ?? []) {
      if (slugOf(environment.convexUrl) === slug) {
        return {
          kind: 'environment',
          environment: environment.name,
          host: environment.host,
          slug,
          label: `${environment.name} — ${environment.host} (${slug})`,
        }
      }
    }
  }

  return {
    kind: 'unknown',
    slug: slug ?? undefined,
    label: slug
      ? `an UNRECOGNISED deployment (${slug}) — not declared in wrangler.jsonc`
      : `an UNRECOGNISED target (${convexUrl ? String(convexUrl) : 'no CONVEX_URL set'})`,
  }
}

/**
 * The environments wrangler.jsonc declares, as describeCopyTarget wants them.
 *
 * LIFTED OUT OF copy-from-supabase.mjs rather than left inline, because a mistake
 * here is SILENT IN THE SAFE-LOOKING DIRECTION: a wrong path into the config
 * yields undefined URLs, every target then resolves to 'unknown', and the guard
 * starts demanding an acknowledgement for the two deployments it was written to
 * recognise. That reads as the guard working.
 *
 * The top level counts as an environment and is named as such, because it is the
 * one that becomes production and is therefore the most consequential thing to
 * identify correctly.
 */
export function environmentsFromWranglerConfig(rawConfig) {
  const blocks = [['(top level)', rawConfig ?? {}], ...Object.entries(rawConfig?.env ?? {})]
  return blocks.map(([name, block]) => ({
    name,
    // THE HOSTNAME, WITH ANY PATH PATTERN STRIPPED. A `custom_domain` entry's
    // pattern is a bare hostname; a route's is `host/path` — `wordleteams.com/*`
    // since the apex moved to a route on 2026-09-30. This value is what the copy
    // script prints in its "WRITING TO:" banner, which §4.2 of the cutover runbook
    // tells the operator to READ before a purge empties a deployment. A banner
    // reading `wordleteams.com/*` is still legible, but the same value is matched
    // against a hostname elsewhere, so it is normalised here rather than at the
    // two call sites.
    host: (block?.routes?.[0]?.pattern ?? '(no route)').split('/')[0],
    convexUrl: block?.vars?.VITE_CONVEX_URL,
  }))
}
