/**
 * WHICH HOSTNAMES ASK NOT TO BE INDEXED.
 *
 * Vercel gave v1 this for free: every preview deployment got an automatic
 * `X-Robots-Tag: noindex`. Cloudflare Workers supply no equivalent and
 * wrangler.jsonc sets no headers, so beta.wordleteams.com was fully crawlable —
 * on a real hostname, serving the same landing page, /home, /about, /privacy
 * and /terms as production, with no canonical link between them (wt-ksh.8.54).
 *
 * THE GATE IS THE HOSTNAME, NOT THE `ENVIRONMENT` VAR, AND THAT IS THE WHOLE
 * DECISION. The runbook's §3.4 is what forces it: **beta and production are the
 * same deployment**. At cutover this Worker keeps its beta custom domain and
 * gains the apex, so for a period one deployment answers on both names. A var
 * is a property of the deployment and cannot tell them apart — it would
 * noindex both or neither, and "both" is the catastrophic one. The hostname is
 * a property of the REQUEST, so each name gets the right answer with no flag to
 * flip and no step to remember on the day.
 *
 * IT FAILS IN THE ONLY ACCEPTABLE DIRECTION. The two mistakes here are not
 * equals:
 *
 *   - Indexing beta is bad and RECOVERABLE — duplicate content, removable
 *     through Search Console.
 *   - Noindexing production is CATASTROPHIC and slow to undo. It silently
 *     removes the whole site from search, and nothing in the app looks wrong
 *     while it happens.
 *
 * So this is an explicit DENY-list and never an allow-list. An unrecognised
 * host — a typo, a new domain, a hostname this fails to parse — is indexable.
 * Writing it the other way round ("index only if host is wordleteams.com")
 * reads as more careful and puts the catastrophic outcome one mistake away.
 *
 * `.workers.dev` IS COVERED BY SUFFIX because that name is assigned by
 * Cloudflare rather than chosen here, and a Worker remains reachable on it
 * unless workers_dev is explicitly disabled. It is exactly the kind of second
 * public URL for the same content that this header exists to stop.
 */
const NOINDEX_HOSTS = new Set(['beta.wordleteams.com'])
const NOINDEX_HOST_SUFFIXES = ['.workers.dev'] as const

/**
 * `nofollow` AS WELL AS `noindex`, deliberately. Beta's pages link to each
 * other with production-relative hrefs and carry a production canonical, so a
 * crawler that honoured `noindex` alone would still walk the staging copy and
 * spend budget discovering nothing new. Vercel's automatic preview header is
 * `noindex` only; this is a small, safe divergence from the thing being
 * replaced, in the direction of asking for less crawling of a copy.
 */
export const NOINDEX_VALUE = 'noindex, nofollow'

/**
 * Hostname comparison is case-insensitive and port-free. `URL.hostname` already
 * lowercases and already excludes the port, so this is defence in depth for a
 * caller that passes `host` (which carries `:8788` locally) by mistake — the
 * failure of getting that wrong is that beta silently becomes indexable, which
 * is the quiet direction and therefore the one worth spending three lines on.
 */
export function shouldNoindex(hostname: string): boolean {
  const host = hostname.trim().toLowerCase().split(':')[0]
  if (NOINDEX_HOSTS.has(host)) return true
  return NOINDEX_HOST_SUFFIXES.some((suffix) => host.endsWith(suffix))
}
