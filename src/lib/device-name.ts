/**
 * WHAT TO CALL THE PASSKEY THIS DEVICE IS ABOUT TO CREATE
 * (wordle-teams-wty4.1.7.9).
 *
 * THE PROBLEM THIS EXISTS FOR. `addPasskey()` was called with no `name`, and
 * the plugin only stores a name the CLIENT sends — `resolvedName` starts as
 * `ctx.body.name || undefined` and is otherwise filled in only by an
 * `afterVerification` hook, which `convex/auth.ts` does not configure. So every
 * row in the Security tab read the bare word "Passkey", and a player with a
 * phone and a laptop saw two identical rows with two identical Remove buttons.
 *
 * IT IS A DISPLAY STRING, NOT A SECURITY CONTROL, and that bounds the whole
 * file. Nothing reads it back; nothing decides anything from it. It exists so
 * that a person looking at a list of their own credentials can tell which is
 * which before pressing Remove. That is why there are no version numbers, no
 * device models and no architecture here: the useful half of a user-agent
 * string for this purpose is two words, and the rest is only fingerprinting
 * surface for a label nobody but the account holder ever sees.
 *
 * WHY NOT `getAuthenticatorName`. The plugin ships one, and it resolves an
 * AAGUID to a genuinely better name ("iCloud Keychain", "Windows Hello"). It is
 * exported from `@better-auth/passkey` — the SERVER entry — so importing it
 * here would pull `@simplewebauthn/server` into the browser bundle, which this
 * repo guards deliberately (the source-map and insights-corpus checks in
 * deploy-v2.yml, and wordle-teams-dt6t). `@better-auth/passkey/client` does not
 * re-export it. Resolving the AAGUID server-side is the better long-term answer
 * and is written up on the issue; this is the one that needs no server change.
 *
 * `userAgentData` FIRST, BUT THE USER-AGENT FALLBACK IS NOT AN EDGE CASE. Only
 * Chromium browsers implement `navigator.userAgentData` at all — Safari and
 * Firefox ship none of it, and between them that is most of this app's iOS
 * traffic — so the string-parsing path below is a FIRST-CLASS path that has to
 * produce something decent, not a defensive shrug. The two are combined per
 * FIELD rather than per source: Chromium can answer `platform: 'Unknown'`, and
 * the user-agent string still knows the answer in that case.
 *
 * `undefined` RATHER THAN A GUESS WHEN NOTHING IS KNOWN. An empty or absent
 * name leaves the plugin storing none, and `passkeyLabel` in
 * components/settings/security-tab.tsx falls back to "Passkey" — the behaviour
 * this file improves on, kept intact for the browsers it cannot read. A made-up
 * label like "Unknown device" would be strictly worse: it looks like a fact.
 *
 * THE LABEL IS SET ONCE, AT REGISTRATION, AND IS NEVER RIGHT FOREVER. A player
 * who registers from Chrome and later thinks of that machine as "the work
 * laptop" has a row that disagrees with them. The honest complement is a rename
 * UI — the plugin already exposes `/passkey/update-passkey` — and it is
 * deliberately not built here; the issue carries the reasoning.
 */

/**
 * The slice of `NavigatorUAData` this file reads.
 *
 * DECLARED LOCALLY BECAUSE TYPESCRIPT'S `lib.dom` DOES NOT SHIP IT. The API is
 * Chromium-only and unratified, so `navigator.userAgentData` is not a property
 * of `Navigator` as far as the compiler is concerned. The alternative is a
 * global augmentation, which would assert to every other file in the tree that
 * the property is always there — and on Safari it is not.
 */
type UserAgentData = {
  brands?: ReadonlyArray<Brand>
  platform?: string
}

/**
 * One entry of `navigator.userAgentData.brands`.
 *
 * `version` IS DECLARED AND DELIBERATELY NEVER READ. The real entries carry
 * one, the fixtures in the test file are copied WITH it, and leaving it off the
 * type would reject those fixtures as excess properties — which would mean
 * rewriting real data to suit this file, the exact move that produces tests
 * green on inputs the platform does not make. Its absence from every function
 * below is the point: see "what a label may NOT contain".
 */
type Brand = { brand?: string; version?: string }

/** What `describeDevice` reads. Separated from the navigator so it is testable. */
export type DeviceHints = {
  brands?: ReadonlyArray<Brand>
  platform?: string
  userAgent?: string
}

/**
 * GREASE brands, which every Chromium browser puts in `brands` ON PURPOSE.
 *
 * The list is deliberately salted with a nonsense vendor — "Not_A Brand",
 * "Not)A;Brand", " Not;A Brand", and the punctuation varies BY RELEASE — so
 * that servers cannot come to depend on the list's exact shape. Matching on any
 * one literal spelling is therefore a bug with a delivery date: it works until
 * Chrome ships the next separator, and then the passkey is named "Not A Brand".
 * Stripping everything that is not a letter first is what makes this survive
 * the punctuation churn, which is the entire point of the exercise.
 */
function isGreaseBrand(brand: string): boolean {
  return brand.replace(/[^a-z]/gi, '').toLowerCase() === 'notabrand'
}

/**
 * Chrome's `brands` contains BOTH "Chromium" and "Google Chrome"; Edge's
 * contains "Chromium" and "Microsoft Edge". Taking the first non-GREASE entry
 * would therefore name most of the world's browsers "Chromium", which is true
 * and useless — the player is looking for the icon they clicked. So the
 * engine's own name is the LAST resort rather than the first, and is still
 * better than nothing for a Chromium derivative that lists only itself.
 */
function pickBrand(brands: ReadonlyArray<Brand> | undefined): string | undefined {
  const named = (brands ?? [])
    .map((entry) => entry?.brand?.trim() ?? '')
    .filter((brand) => brand.length > 0 && !isGreaseBrand(brand))
  return named.find((brand) => !/^chromium$/i.test(brand)) ?? named[0]
}

/**
 * "Google Chrome" is called Chrome, and "Microsoft Edge" is called Edge.
 *
 * The vendor prefix is the half a player does not read, and dropping it is what
 * keeps "Microsoft Edge on Windows" — already the longest label this file can
 * produce — from being longer still in a `truncate`d settings row.
 */
function tidyBrand(brand: string): string {
  return brand.replace(/^(?:Google|Microsoft|Apple)\s+/i, '')
}

/**
 * `userAgentData.platform`'s vocabulary, normalised to what the platforms call
 * themselves.
 *
 * 'Unknown' IS A REAL VALUE THAT CHROMIUM RETURNS, not a defensive branch — it
 * is the spec's answer for a platform outside the known list — and folding it to
 * `undefined` here is what lets the user-agent string answer instead. Anything
 * unrecognised is passed through rather than dropped: a future value is far
 * more likely to be a platform name this file has not heard of than to be
 * garbage.
 */
function tidyPlatform(platform: string): string | undefined {
  const trimmed = platform.trim()
  if (!trimmed || /^unknown$/i.test(trimmed)) return undefined
  if (/^chrom(?:e|ium)\s*os$/i.test(trimmed)) return 'ChromeOS'
  if (/^mac\s*os$/i.test(trimmed)) return 'macOS'
  return trimmed
}

/**
 * The browser, read out of a user-agent string.
 *
 * ORDER IS THE WHOLE ALGORITHM AND IT IS NOT ALPHABETICAL. Every Chromium
 * browser impersonates Chrome in this string and Chrome impersonates Safari, so
 * each test below is only correct once the more specific ones above it have
 * already failed:
 *
 *   - Edge says `Chrome/… Safari/… Edg/…`, so `Edg` must be read first.
 *   - Opera says `Chrome/… Safari/… OPR/…`.
 *   - Samsung Internet says `SamsungBrowser/… Chrome/… Safari/…`.
 *   - Chrome on iOS is `CriOS`, and Firefox on iOS is `FxiOS`, because iOS
 *     obliges every browser to be WebKit underneath — both of those strings
 *     also contain the bare word `Safari`.
 *   - Safari is therefore LAST, and is the only one that has to be read as an
 *     absence: `Safari/` with no `Chrome/` beside it.
 *
 * `Edg` WITHOUT A SLASH ON PURPOSE. Edge on Android is `EdgA/` and on iOS is
 * `EdgiOS/`; all three share the prefix, and the platform is named separately
 * anyway.
 *
 * AND `Chrome\/` WITHOUT A LEADING `\b`, WHICH IS NOT AN OVERSIGHT. Headless
 * Chromium — Playwright's browser, and therefore this repo's whole e2e suite —
 * says `HeadlessChrome/149.0.7827.55 Safari/537.36`, measured. A word boundary
 * before `Chrome` does not match inside `HeadlessChrome`, so the test would
 * fall through to the `Safari` line below and name it Safari: a wrong answer
 * that would look right in every screenshot. Nothing else in the wild embeds
 * `Chrome/` inside a longer token.
 */
function browserFromUserAgent(userAgent: string): string | undefined {
  if (/\bEdg/i.test(userAgent)) return 'Edge'
  if (/\bOPR\/|\bOpera\b/i.test(userAgent)) return 'Opera'
  if (/\bSamsungBrowser\//i.test(userAgent)) return 'Samsung Internet'
  if (/\bFirefox\/|\bFxiOS\//i.test(userAgent)) return 'Firefox'
  if (/\bCriOS\/|Chrome\//i.test(userAgent)) return 'Chrome'
  if (/\bSafari\//i.test(userAgent)) return 'Safari'
  return undefined
}

/**
 * The platform, read out of a user-agent string.
 *
 * ORDER MATTERS HERE TOO, FOR ONE PAIR IN PARTICULAR: Android's string contains
 * the word `Linux` ("Linux; Android 14; …"), so a `Linux` test placed above the
 * `Android` one names every phone in the world a Linux box. iOS is checked
 * before macOS because an iPad in desktop mode is `Macintosh` — there is
 * nothing to be done about that one and it is the reason `iPad` is tested on
 * its own rather than folded into a single `iOS`.
 */
function platformFromUserAgent(userAgent: string): string | undefined {
  if (/\biPad\b/i.test(userAgent)) return 'iPadOS'
  if (/\biPhone\b|\biPod\b/i.test(userAgent)) return 'iOS'
  if (/\bAndroid\b/i.test(userAgent)) return 'Android'
  if (/\bCrOS\b/i.test(userAgent)) return 'ChromeOS'
  if (/\bWindows\b/i.test(userAgent)) return 'Windows'
  if (/\bMac OS X\b|\bMacintosh\b/i.test(userAgent)) return 'macOS'
  if (/\bLinux\b/i.test(userAgent)) return 'Linux'
  return undefined
}

/**
 * 'Chrome on macOS', or one half of it, or `undefined` when neither half is
 * known.
 *
 * PURE, AND EXPORTED FOR ITS OWN SAKE. Every interesting case here is a
 * user-agent string from a browser this machine does not have, so the tests
 * feed real ones directly rather than stubbing a global — the same reason
 * lib/celebration.ts is a pure function with the component around it.
 *
 * HALF A LABEL IS STILL A LABEL. "Firefox" alone distinguishes a row from
 * "Chrome on macOS" perfectly well, and a browser that answers one question and
 * not the other is a browser this app should still name as far as it can.
 */
export function describeDevice({ brands, platform, userAgent }: DeviceHints): string | undefined {
  const ua = userAgent?.trim() || undefined
  // PER FIELD, NOT PER SOURCE. Chromium answers `platform: 'Unknown'` often
  // enough that preferring `userAgentData` wholesale would throw away an answer
  // the user-agent string still has.
  const brand = pickBrand(brands)
  const browser = (brand && tidyBrand(brand)) || (ua && browserFromUserAgent(ua)) || undefined
  const os =
    (platform && tidyPlatform(platform)) || (ua && platformFromUserAgent(ua)) || undefined
  if (browser && os) return `${browser} on ${os}`
  return browser ?? os
}

/**
 * The device in front of us, or `undefined` where the browser will not say.
 *
 * GUARDS `navigator` ITSELF, for the reason `passkeySupported()` in
 * lib/passkey.ts gives: every route in this app is server-rendered, and this
 * module is imported by lib/register-passkey.ts, which is in the module graph
 * of two client routes. Nothing CALLS this on the server — a registration
 * starts from a click — but a module-scope dereference would not need a call.
 */
export function deviceName(): string | undefined {
  if (typeof navigator === 'undefined') return undefined
  const uaData = (navigator as Navigator & { userAgentData?: UserAgentData }).userAgentData
  return describeDevice({
    brands: uaData?.brands,
    platform: uaData?.platform,
    userAgent: navigator.userAgent,
  })
}
