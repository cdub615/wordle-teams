// The suite's default edge-runtime is right here: `describeDevice` is a pure
// function over two strings and a small array, and every interesting input is a
// user-agent string from a browser this machine does not have. Feeding them
// directly is both stronger and simpler than stubbing a global — the same
// reason lib/celebration.ts is a pure function with the component around it.
//
// WHAT THIS FILE IS REALLY FOR. The label is a DISPLAY STRING for the account
// holder's own benefit, so the failures worth catching are not crashes. They
// are labels that are WRONG in a way nobody notices: every Chromium browser
// named "Chromium", every Android phone named "Linux", every Chrome-on-iOS
// named "Safari", and — the one that ships on a timer — a passkey called "Not A
// Brand" the next time Chrome changes its GREASE punctuation.
import { describe, expect, test } from 'vitest'
import { describeDevice, deviceName } from './device-name.ts'

/**
 * REAL USER-AGENT STRINGS, COPIED RATHER THAN COMPOSED. A fixture written to
 * match the regexes below proves only that the regexes match themselves; these
 * carry the impersonation that makes the ordering in `browserFromUserAgent`
 * load-bearing — every Chromium browser claims `Chrome`, Chrome claims
 * `Safari`, and on iOS everything claims both.
 */
const UA = {
  chromeMac:
    'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/129.0.0.0 Safari/537.36',
  chromeWindows:
    'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/129.0.0.0 Safari/537.36',
  chromeLinux:
    'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/129.0.0.0 Safari/537.36',
  chromeAndroid:
    'Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/129.0.0.0 Mobile Safari/537.36',
  chromeOS:
    'Mozilla/5.0 (X11; CrOS x86_64 14541.0.0) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/129.0.0.0 Safari/537.36',
  safariMac:
    'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.4 Safari/605.1.15',
  safariIPhone:
    'Mozilla/5.0 (iPhone; CPU iPhone OS 17_4 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.4 Mobile/15E148 Safari/604.1',
  safariIPad:
    'Mozilla/5.0 (iPad; CPU OS 17_4 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.4 Mobile/15E148 Safari/604.1',
  chromeIPhone:
    'Mozilla/5.0 (iPhone; CPU iPhone OS 17_4 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) CriOS/129.0.6668.69 Mobile/15E148 Safari/604.1',
  firefoxIPhone:
    'Mozilla/5.0 (iPhone; CPU iPhone OS 17_4 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) FxiOS/127.0 Mobile/15E148 Safari/605.1.15',
  firefoxWindows:
    'Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:128.0) Gecko/20100101 Firefox/128.0',
  firefoxLinux: 'Mozilla/5.0 (X11; Linux x86_64; rv:128.0) Gecko/20100101 Firefox/128.0',
  edgeWindows:
    'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/129.0.0.0 Safari/537.36 Edg/129.0.2792.52',
  edgeAndroid:
    'Mozilla/5.0 (Linux; Android 14) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/129.0.0.0 Mobile Safari/537.36 EdgA/129.0.2792.50',
  operaWindows:
    'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36 OPR/112.0.0.0',
  samsungAndroid:
    'Mozilla/5.0 (Linux; Android 14; SAMSUNG SM-S911B) AppleWebKit/537.36 (KHTML, like Gecko) SamsungBrowser/25.0 Chrome/121.0.0.0 Mobile Safari/537.36',
  /**
   * PLAYWRIGHT'S OWN BROWSER, COPIED OFF THIS MACHINE rather than imagined.
   * `HeadlessChrome/` is a real token that a `\b` before `Chrome` does not
   * match, so the naive spelling falls through to the `Safari` test and names
   * the entire e2e suite's browser "Safari on Linux" — a wrong answer that
   * looks perfectly plausible in a screenshot.
   */
  headlessChromium:
    'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) HeadlessChrome/149.0.7827.55 Safari/537.36',
}

/** What Chrome 129 on macOS actually puts in `navigator.userAgentData`. */
const CHROME_BRANDS = [
  { brand: 'Google Chrome', version: '129' },
  { brand: 'Not=A?Brand', version: '8' },
  { brand: 'Chromium', version: '129' },
]

describe('reading a user-agent string, which is the ONLY path on Safari and Firefox', () => {
  // `navigator.userAgentData` is Chromium-only: WebKit and Gecko ship none of
  // it at all. So this is a first-class path carrying most of this app's iOS
  // traffic, not a defensive fallback.
  test.each([
    ['chromeMac', UA.chromeMac, 'Chrome on macOS'],
    ['chromeWindows', UA.chromeWindows, 'Chrome on Windows'],
    ['chromeLinux', UA.chromeLinux, 'Chrome on Linux'],
    // ANDROID BEFORE LINUX. Android's string says "Linux; Android 14", so a
    // Linux test placed first names every phone in the world a Linux box.
    ['chromeAndroid', UA.chromeAndroid, 'Chrome on Android'],
    ['chromeOS', UA.chromeOS, 'Chrome on ChromeOS'],
    ['safariMac', UA.safariMac, 'Safari on macOS'],
    ['safariIPhone', UA.safariIPhone, 'Safari on iOS'],
    ['safariIPad', UA.safariIPad, 'Safari on iPadOS'],
    // iOS OBLIGES EVERY BROWSER TO BE WEBKIT, so both of these say "Safari"
    // too. Reading Safari before CriOS/FxiOS names every iPhone browser Safari.
    ['chromeIPhone', UA.chromeIPhone, 'Chrome on iOS'],
    ['firefoxIPhone', UA.firefoxIPhone, 'Firefox on iOS'],
    ['firefoxWindows', UA.firefoxWindows, 'Firefox on Windows'],
    ['firefoxLinux', UA.firefoxLinux, 'Firefox on Linux'],
    // EVERY CHROMIUM BROWSER CLAIMS `Chrome/`, so each of the three below is
    // only correct because its own marker is read BEFORE the Chrome test.
    ['edgeWindows', UA.edgeWindows, 'Edge on Windows'],
    ['edgeAndroid', UA.edgeAndroid, 'Edge on Android'],
    ['operaWindows', UA.operaWindows, 'Opera on Windows'],
    ['samsungAndroid', UA.samsungAndroid, 'Samsung Internet on Android'],
    ['headlessChromium', UA.headlessChromium, 'Chrome on Linux'],
  ])('%s reads as "%s"', (_name, userAgent, expected) => {
    expect(describeDevice({ userAgent })).toBe(expected)
  })

  test('the strings above do not all produce the same answer', () => {
    // THE VACUITY GUARD FOR THE TABLE. Each row on its own would pass against a
    // function hard-coded to that row's answer; the table as a whole would pass
    // against nothing at all if it were empty. This states the property the
    // feature is actually for: two devices are told apart.
    const all = Object.values(UA).map((userAgent) => describeDevice({ userAgent }))
    expect(all).toHaveLength(17)
    expect(all.every((label) => typeof label === 'string' && label.length > 0)).toBe(true)
    expect(new Set(all).size).toBeGreaterThan(10)
  })
})

describe('reading userAgentData, which Chromium offers and is better', () => {
  test('the vendor brand wins over the engine, and loses its vendor prefix', () => {
    /**
     * THE MUTATION THIS KILLS, AND IT AFFECTS MOST OF THE WORLD'S BROWSERS.
     * Chrome's `brands` holds BOTH "Google Chrome" and "Chromium", and Edge's
     * holds both "Microsoft Edge" and "Chromium". Taking the first non-GREASE
     * entry — the obvious implementation — names nearly every passkey
     * "Chromium", which is true, useless, and identical across the two devices
     * this feature exists to tell apart.
     */
    expect(describeDevice({ brands: CHROME_BRANDS, platform: 'macOS' })).toBe('Chrome on macOS')
    expect(
      describeDevice({
        brands: [
          { brand: 'Chromium', version: '129' },
          { brand: 'Not_A Brand', version: '24' },
          { brand: 'Microsoft Edge', version: '129' },
        ],
        platform: 'Windows',
      }),
    ).toBe('Edge on Windows')
  })

  test.each([
    ['Not_A Brand'],
    ['Not)A;Brand'],
    ['Not;A=Brand'],
    [' Not A;Brand'],
    ['Not.A/Brand'],
    ['Not=A?Brand'],
  ])('the GREASE entry %s is never the name of anybody\'s passkey', (grease) => {
    /**
     * GREASE IS DELIBERATE AND ITS PUNCTUATION CHANGES BY RELEASE. Chromium
     * salts `brands` with a nonsense vendor precisely so that servers cannot
     * come to depend on the list's shape, and it has shipped at least the six
     * spellings above. Matching one literal is a bug with a delivery date:
     * green today, and a passkey called "Not A Brand" at the next release.
     */
    expect(describeDevice({ brands: [{ brand: grease }], platform: 'Windows' })).toBe('Windows')
  })

  test("Playwright's own browser names itself, which is what e2e/passkey.spec.ts sees", () => {
    /**
     * MEASURED ON THIS MACHINE, on a secure origin, because `userAgentData` is
     * secure-context-only and comes back `null` on `about:blank`. e2e runs
     * against `http://localhost:3000`, which IS a secure context, so this — not
     * the user-agent string — is the path the suite actually takes, and
     * "HeadlessChrome on Linux" is the label a passkey registered by
     * e2e/passkey.spec.ts carries. That spec's remove-button locator is written
     * against the SHAPE of this rather than the literal, so it does not break
     * when the runner's browser or platform changes.
     */
    expect(
      describeDevice({
        brands: [
          { brand: 'HeadlessChrome', version: '149' },
          { brand: 'Chromium', version: '149' },
          { brand: 'Not)A;Brand', version: '24' },
        ],
        platform: 'Linux',
        userAgent: UA.headlessChromium,
      }),
    ).toBe('HeadlessChrome on Linux')
  })

  test('a Chromium derivative that lists only the engine still gets named', () => {
    // The paired case for the preference above: "Chromium" is the LAST resort,
    // not a banned word. Dropping it would leave these players with the bare
    // "Passkey" the whole feature exists to replace.
    expect(describeDevice({ brands: [{ brand: 'Chromium' }], platform: 'Linux' })).toBe(
      'Chromium on Linux',
    )
  })

  test('userAgentData beats the user-agent string when both are there', () => {
    // Not a tie-break for its own sake: the string is where the impersonation
    // lives, and the structured answer is the one the browser means.
    expect(
      describeDevice({
        brands: [{ brand: 'Microsoft Edge' }, { brand: 'Chromium' }],
        platform: 'Windows',
        userAgent: UA.chromeMac,
      }),
    ).toBe('Edge on Windows')
  })
})

describe('the two sources are combined per FIELD, not per source', () => {
  test("Chromium's own 'Unknown' platform falls through to the user-agent string", () => {
    /**
     * 'Unknown' IS A VALUE CHROMIUM RETURNS, not a defensive branch — it is the
     * spec's answer for a platform outside the known list. Preferring
     * `userAgentData` wholesale would throw away an answer the user-agent
     * string still has and leave the label at the bare brand.
     */
    expect(
      describeDevice({ brands: CHROME_BRANDS, platform: 'Unknown', userAgent: UA.chromeLinux }),
    ).toBe('Chrome on Linux')
    // And the paired direction: a platform with no readable brand.
    expect(describeDevice({ platform: 'macOS', userAgent: UA.safariMac })).toBe('Safari on macOS')
  })

  test('"Chrome OS" and "Mac OS" are spelled the way the platforms spell them', () => {
    // userAgentData answers "Chrome OS" (and older builds "Chromium OS"); the
    // user-agent path answers "ChromeOS". Two rows in one list spelling the
    // same platform two ways reads as two platforms.
    expect(describeDevice({ brands: CHROME_BRANDS, platform: 'Chrome OS' })).toBe(
      'Chrome on ChromeOS',
    )
    expect(describeDevice({ brands: CHROME_BRANDS, platform: 'Chromium OS' })).toBe(
      'Chrome on ChromeOS',
    )
    expect(describeDevice({ brands: CHROME_BRANDS, platform: 'Mac OS' })).toBe('Chrome on macOS')
    expect(describeDevice({ userAgent: UA.chromeOS })).toBe('Chrome on ChromeOS')
  })

  test('an unrecognised platform is passed through rather than dropped', () => {
    // A value this file has not heard of is far more likely to be a real
    // platform than garbage, and "Chrome on Fuchsia" beats "Chrome".
    expect(describeDevice({ brands: CHROME_BRANDS, platform: 'Fuchsia' })).toBe(
      'Chrome on Fuchsia',
    )
  })

  test('half a label is still a label', () => {
    // A browser that answers one question and not the other is still worth
    // naming as far as it goes: "Firefox" tells a row apart from
    // "Chrome on macOS" perfectly well.
    expect(describeDevice({ brands: [{ brand: 'Firefox' }] })).toBe('Firefox')
    expect(describeDevice({ platform: 'Windows' })).toBe('Windows')
    expect(describeDevice({ userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64)' })).toBe(
      'Windows',
    )
  })
})

describe('when nothing can be read, it says nothing', () => {
  test.each([
    ['no hints at all', {}],
    ['an empty user-agent', { userAgent: '' }],
    ['whitespace', { userAgent: '   ' }],
    ['an unrecognisable agent', { userAgent: 'curl/8.9.1' }],
    ['empty brands', { brands: [] }],
    ['a nameless brand entry', { brands: [{ brand: '  ' }] }],
    ['an empty platform', { platform: '' }],
    ['only GREASE', { brands: [{ brand: 'Not_A Brand' }] }],
  ])('%s produces undefined, never a made-up label', (_case, hints) => {
    /**
     * `undefined` RATHER THAN A GUESS. An absent name leaves the plugin storing
     * none, and `passkeyLabel` in components/settings/security-tab.tsx falls
     * back to "Passkey" — the pre-existing behaviour, kept intact for the
     * browsers this cannot read. "Unknown device" would be strictly worse,
     * because it looks like a fact.
     */
    expect(describeDevice(hints)).toBeUndefined()
  })
})

describe('what a label may NOT contain', () => {
  test('no version numbers, no device models, no digits at all', () => {
    /**
     * THE LABEL IS A DISPLAY STRING FOR THE ACCOUNT HOLDER, NOT A SECURITY
     * CONTROL and not a device inventory. Nothing reads it back and nothing
     * decides anything from it, so every character beyond "which of my two
     * devices is this" is fingerprinting surface bought for nobody. The Samsung
     * string below is the sharpest case: it carries a retail model number
     * (SM-S911B) that must not reach a settings row.
     */
    for (const userAgent of Object.values(UA)) {
      const label = describeDevice({ userAgent })
      expect(label).toBeDefined()
      expect(label).not.toMatch(/\d/)
      expect(label).not.toMatch(/SM-S911B/)
    }
    expect(describeDevice({ brands: CHROME_BRANDS, platform: 'macOS' })).not.toMatch(/\d/)
  })

  test('and it stays short enough to read in a settings row', () => {
    // Rows are `truncate`d, so a long label is a label nobody can tell from the
    // one above it. The longest this file can produce is
    // "Samsung Internet on Android".
    for (const userAgent of Object.values(UA)) {
      expect(describeDevice({ userAgent })!.length).toBeLessThanOrEqual(32)
    }
  })
})

describe('deviceName, the one that reads the real navigator', () => {
  test('it answers something or nothing, and never throws', () => {
    /**
     * WHAT THIS CAN HONESTLY ASSERT AND NO MORE. The value depends entirely on
     * the runtime the suite happens to be in — edge-runtime here, a browser in
     * production — so pinning a string would pin the test runner. What is worth
     * pinning is the CONTRACT the caller depends on: a non-empty string or
     * `undefined`, and no throw. `lib/register-passkey.ts` hands the result
     * straight to `addPasskey({ name })`, where an empty string would be
     * trimmed away by the server anyway but a throw would take the whole
     * ceremony down before it started.
     */
    const name = deviceName()
    expect(name === undefined || (typeof name === 'string' && name.trim().length > 0)).toBe(true)
  })
})
