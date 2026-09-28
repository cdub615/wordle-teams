/**
 * THE RELYING PARTY — THE ONE PASSKEY SETTING THAT CANNOT BE UNDONE.
 *
 * THIS HEADER IS THE SINGLE STATEMENT OF THE ARGUMENT. convex/auth.ts's
 * `passkey()` call and convex/lib/relyingParty.test.ts both point here instead
 * of restating it; it was written out three times, and three copies of a
 * paragraph is three things that have to stay true.
 *
 * An rpID is chosen ONCE, PER CREDENTIAL, AT REGISTRATION. It is baked into the
 * credential by the authenticator and can never be changed, migrated or
 * repaired: a credential scoped to the wrong id is simply orphaned, and nothing
 * says so until someone tries to sign in and their key is not offered. That is
 * why this is a module with its own tests rather than two lines inline.
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
 * hardcoded apex looks right. relyingParty.test.ts carries a source assertion
 * that convex/auth.ts passes `rpIdFor(...)` rather than a string.
 *
 * WHERE THESE THROW, AND WHY THAT IS THE RIGHT COST. Both call `new URL`, so
 * both are PARTIAL over a malformed SITE_URL — a value with no scheme throws
 * from `new URL` itself, and one that parses to an empty host throws by name
 * from the guard below. An earlier draft of this header claimed they "must not
 * throw", flat. That is true only of the placeholder path, and the distinction
 * is worth stating exactly because the two paths cost wildly different things:
 *
 *   - AT COMPONENT INIT the value is ALWAYS `SCHEMA_ONLY_BASE_URL`, because
 *     `createApi` evaluates `createAuthOptions({})` where no deployment
 *     environment variables exist (see convex/betterAuth/adapter.ts). A throw
 *     there is not a failed request, it is a push that dies at module analysis
 *     — an unpushable deployment (wordle-teams-hrqw). These are total over that
 *     placeholder, and a test pins it.
 *
 *   - AT REQUEST TIME the throw happens inside `createAuth`, which is called
 *     per request, so a hand-misconfigured SITE_URL is a loud 500 on the auth
 *     routes naming the offending value. That is the outcome we want, and it is
 *     pinned by a test so that nobody later softens it into a `?? ''`: an empty
 *     rpID is not a safe default, it is a ceremony the browser rejects with a
 *     message that names nothing.
 */

/**
 * The registrable domain of a site URL — the rpID every credential is scoped to.
 *
 * THE RULE IS "LAST TWO LABELS", which is the registrable domain for every
 * single-label public suffix: `beta.wordleteams.com` -> `wordleteams.com`,
 * `wordleteams.com` -> itself. `localhost` needs no branch of its own and does
 * not have one: `slice(-2)` over a single label is that label. (The spec's
 * localhost special case is about it being a trustworthy origin over plain
 * http, which is a different question from what the rpID should say.)
 *
 * IT IS NOT A PUBLIC SUFFIX LIST, and that limit is stated rather than hidden:
 * on a multi-label suffix like `co.uk` this would return the suffix itself and
 * every browser would reject it. That is acceptable because the only hosts this
 * is ever called with are `wordleteams.com`, its subdomains, `localhost`, and
 * the schema-only placeholder — and importing a PSL into convex/lib/ to cover a
 * domain we do not own would be cost with no benefit. Anyone moving this app to
 * a `.co.uk` has to come back here.
 *
 * `new URL` rather than string surgery so a trailing slash, a path or a port on
 * SITE_URL all normalise away instead of ending up inside the rpID.
 */
export function rpIdFor(siteUrl: string): string {
  const { hostname } = new URL(siteUrl)

  /**
   * A SITE_URL MISSING THE SLASHES AFTER ITS SCHEME STILL PARSES.
   * `beta.wordleteams.com:443` is read as scheme `beta.wordleteams.com:` with
   * path `443`, leaving the hostname EMPTY.
   *
   * BE PRECISE ABOUT WHAT THIS PREVENTS, because the obvious guess is wrong and
   * was written down once already. It is NOT a silent fall back to the full
   * hostname. The plugin's own default is
   * `options.rpID || new URL(baseURL).hostname`, and `baseURL` is the SAME
   * `siteUrl` these options set — so when the host is empty, both sides are
   * empty and the browser rejects the ceremony outright. This belongs with the
   * IP-literal and multi-label-suffix cases: loud at first use, not an orphaned
   * credential.
   *
   * It is worth three lines anyway. It turns a confusing client-side failure
   * into a named server-side one that quotes the offending value, which is the
   * stance convex/polar.ts already takes on an unset SITE_URL.
   */
  if (!hostname) throw new Error(`SITE_URL has no host, so no rpID can be derived: ${siteUrl}`)

  return hostname.split('.').slice(-2).join('.')
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
 * ASYMMETRIC ON PURPOSE — A DECISION, NOT AN OVERSIGHT. From beta this returns
 * beta AND the apex; from the apex it returns ONLY the apex, so ceremonies
 * reported from `beta.wordleteams.com` are refused the moment SITE_URL flips.
 * That is intended, because beta is retired at the cutover (wt-ksh.9). Making
 * it symmetric would mean writing `beta.` into this module, which is the single
 * thing it exists not to do. If a beta CNAME outlives the flip and the passkey
 * button breaks on it, this paragraph is the reason and this function is the
 * place to change it.
 *
 * The port is preserved, because an origin on a different port is a different
 * origin — which is also why dev returns one entry rather than two.
 */
export function originsFor(siteUrl: string): string[] {
  const url = new URL(siteUrl)
  const apex = `${url.protocol}//${rpIdFor(siteUrl)}${url.port ? `:${url.port}` : ''}`
  return url.origin === apex ? [url.origin] : [url.origin, apex]
}
