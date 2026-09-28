/**
 * A wall-clock time in whatever shape the READER'S locale writes one, and the
 * cache of Intl formatters that keeps it cheap.
 *
 * LIVES IN lib/ RATHER THAN IN THE CHAT MODULE BECAUSE TWO FEATURES NEED IT
 * (wordle-teams-8klr). It was written for the chat separator; the notification
 * settings tab was independently hand-rolling `'13:00:00' -> '1 PM'` with
 * string arithmetic and a fixed AM/PM suffix, which shows every reader on earth
 * a US 12-hour clock. A settings component must not import out of
 * components/chat/ to fix that — the same argument that moved `hidesSiteFooter`
 * to lib/site-chrome.ts — so the shared half moved here instead.
 *
 * `chatDayIndex` DELIBERATELY DID NOT COME WITH IT. It is not a formatter: it
 * reads formatted parts back out as NUMBERS, so it pins its own locale and
 * takes no `locale` parameter (see its comment in use-chat-sync.ts). Nothing
 * about it is shareable, and "fixing" it to take one would make every day index
 * `NaN` under a non-`latn` numbering system.
 */
/**
 * Intl formatters are expensive to construct and this file formats one per
 * separator on every render of the list, so they are built once per (shape,
 * zone, locale) triple and kept.
 *
 * KEYED BY THE ZONE AND THE LOCALE AS WELL AS THE SHAPE. Both are parameters
 * rather than constants precisely so the tests can pin them (see below), and a
 * cache keyed on the shape alone would hand the second test the first test's
 * zone — or, now, the first test's locale.
 *
 * EXPORTED BECAUSE use-chat-sync.ts STILL BUILDS THREE OTHER SHAPES FROM IT —
 * the weekday and the date halves of a chat separator, and the parts
 * `chatDayIndex` counts days with. One cache for all four is the point: a
 * second Map over there would rebuild the same formatters under a different
 * roof.
 */
const formatters = new Map<string, Intl.DateTimeFormat>()

export function formatterFor(
  shape: string,
  options: Intl.DateTimeFormatOptions,
  timeZone: string | undefined,
  locale: string | undefined,
): Intl.DateTimeFormat {
  const key = `${shape}|${timeZone ?? ''}|${locale ?? ''}`
  const held = formatters.get(key)
  if (held) return held
  const made = new Intl.DateTimeFormat(locale, { ...options, timeZone })
  formatters.set(key, made)
  return made
}

/**
 * A wall-clock time in whatever shape the READER'S locale writes one: `2:05 PM`
 * in en-US, `14:05` in en-GB and de-DE.
 *
 * THE POINT IS THAT NOTHING HERE DECIDES 12- VERSUS 24-HOUR. This used to pass
 * `hourCycle: 'h23'` and stamp `Today 14:00` on an American owner's phone,
 * which is not a clock anybody in that locale reads. Passing `hour12: true`
 * instead would have been the identical bug pointed the other way — it would
 * have printed `2:05 PM` in Berlin. Neither option is passed at all; CLDR
 * already knows, per locale, which one is customary, and this asks it.
 *
 * `timeStyle: 'short'` RATHER THAN `hour`/`minute` FIELDS, AND THE DIFFERENCE
 * IS THE LEADING ZERO. `{ hour: 'numeric', minute: '2-digit' }` renders
 * midnight as `0:05` in every 24-hour locale, which is not how a 24-hour clock
 * is written and is a visible regression from the `00:05` this replaces;
 * `{ hour: '2-digit' }` fixes that and breaks the other side instead, giving
 * en-US `02:05 PM`. `timeStyle: 'short'` is the locale's OWN short-time
 * pattern, so en-GB keeps `00:05` and en-US gets `2:05 PM` without this file
 * choosing a field width for either.
 *
 * THE NARROW NO-BREAK SPACE IS FLATTENED TO AN ORDINARY ONE. ICU 72 changed the
 * separator before `AM`/`PM` from U+0020 to U+202F, so the exact bytes of
 * `2:05 PM` depend on which ICU the host was built against — the same class of
 * trap as reading the host's time zone, and one that would make these
 * assertions pass on a developer's Node and fail on CI's. Normalising here
 * makes the output a function of the arguments alone.
 *
 * `locale` UNDEFINED MEANS THE RUNTIME'S OWN, exactly as `timeZone` undefined
 * means the host's zone: the reader's conventions are the only ones a clock in
 * their own chat can honestly use. Tests pass an explicit locale so that "2:05
 * PM" is a fact about the fixture rather than about the machine running it.
 */
export function clockTime(timestamp: number, timeZone?: string, locale?: string): string {
  return formatterFor('time', { timeStyle: 'short' }, timeZone, locale)
    .format(new Date(timestamp))
    .replace(/[\u202f\u00a0]/g, ' ')
}
