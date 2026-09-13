/**
 * THE RELYING PARTY — THE ONE PASSKEY SETTING THAT CANNOT BE UNDONE.
 *
 * An rpID is chosen ONCE, PER CREDENTIAL, AT REGISTRATION. It is baked into the
 * credential by the authenticator and there is no migration, no re-scoping and
 * no repair: a credential scoped to the wrong id is simply orphaned, and the
 * failure is silent until someone tries to sign in and their key is not
 * offered. That is why this is a module with its own tests rather than two
 * lines inline in convex/auth.ts.
 *
 * WHAT GOES WRONG IF NOBODY SETS IT. The default rpID is the FULL HOSTNAME of
 * the origin. This app is serving from `beta.wordleteams.com` until the DNS
 * cutover (wt-ksh.9) points the apex at it, so every passkey registered on beta
 * would carry `rpID: 'beta.wordleteams.com'` and would be orphaned the moment
 * users arrive at `wordleteams.com` instead.
 *
 * WHY SCOPING TO THE APEX FROM BETA IS LEGAL. WebAuthn permits an rpID that is
 * the origin's effective domain OR ANY REGISTRABLE-DOMAIN SUFFIX of it, so
 * `beta.wordleteams.com` may claim `wordleteams.com`. A credential scoped to
 * the apex is then offered on the apex AND on every subdomain of it, which is
 * what makes the cutover a non-event: the same credentials keep working before
 * and after, on beta and on the apex.
 *
 * DERIVED FROM THE SITE URL, NEVER HARDCODED. A literal here is exactly how the
 * beta hostname sneaks back in — and, worse, how it survives review, because a
 * hardcoded apex looks right. convex/lib/relyingParty.test.ts carries a source
 * assertion that convex/auth.ts passes `rpIdFor(...)` rather than a string.
 *
 * PURE AND DEPENDENCY-FREE ON PURPOSE. convex/auth.ts's `createAuthOptions` is
 * imported by the local Better Auth component, which evaluates it at module
 * init with no deployment environment at all — so these functions are called
 * with the `SCHEMA_ONLY_BASE_URL` placeholder and MUST NOT THROW there. A throw
 * at component init is an unpushable deployment (wordle-teams-hrqw), which is
 * why the placeholder gets a test of its own below the real hosts.
 */

/**
 * The registrable domain of a site URL — the rpID every credential is scoped to.
 *
 * THE RULE IS "LAST TWO LABELS", which is the registrable domain for every
 * single-label public suffix: `beta.wordleteams.com` -> `wordleteams.com`,
 * `wordleteams.com` -> itself. A host with fewer than two labels is returned
 * unchanged, which is what special-cases `localhost` — the one host WebAuthn
 * itself special-cases, since dev has no registrable domain to speak of.
 *
 * IT IS NOT A PUBLIC SUFFIX LIST, and that limit is stated rather than hidden:
 * on a multi-label suffix like `co.uk` this would return the suffix itself and
 * every browser would reject it. That is acceptable because the only hosts this
 * is ever called with are `wordleteams.com`, its subdomains, `localhost`, and
 * the schema-only placeholder — and importing a PSL into convex/lib/ to cover
 * a domain we do not own would be cost with no benefit. Anyone moving this app
 * to a `.co.uk` has to come back here.
 *
 * `new URL` rather than string surgery so a trailing slash, a path or a port on
 * SITE_URL all normalise away instead of ending up inside the rpID.
 */
export function rpIdFor(siteUrl: string): string {
  const labels = new URL(siteUrl).hostname.split('.')
  return labels.length <= 2 ? labels.join('.') : labels.slice(-2).join('.')
}

/**
 * Every origin the passkey plugin will accept a ceremony from.
 *
 * ONE DEPLOYMENT SERVES BOTH NAMES ACROSS THE CUTOVER. The rpID above is the
 * apex, but the ORIGIN the browser reports is whichever host the user actually
 * loaded — `https://beta.wordleteams.com` today, `https://wordleteams.com`
 * after the flip. The plugin verifies the reported origin against this list, so
 * a list holding only the configured site URL would refuse every ceremony from
 * the other name the very day DNS changes.
 *
 * The apex is appended only when it differs from the site URL's own origin, so
 * production returns one entry rather than the same origin twice, and dev
 * returns just `http://localhost:3000` — the port is preserved, because an
 * origin with a different port is a different origin.
 */
export function originsFor(siteUrl: string): string[] {
  const url = new URL(siteUrl)
  const apex = `${url.protocol}//${rpIdFor(siteUrl)}${url.port ? `:${url.port}` : ''}`
  return url.origin === apex ? [url.origin] : [url.origin, apex]
}
