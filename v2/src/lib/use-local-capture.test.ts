import { describe, expect, test } from 'vitest'
import { decideLocalCapture } from './use-local-capture.ts'

describe('decideLocalCapture', () => {
  test('writes the resolved zone when the player has none yet', () => {
    const result = decideLocalCapture({
      storedTimeZone: null,
      storedHasPwa: false,
      resolvedZone: 'America/Denver',
      displayModeStandalone: false,
      navigatorStandalone: false,
    })
    expect(result.writeZone).toBe('America/Denver')
  })

  test('never rewrites a zone the player already has', () => {
    const result = decideLocalCapture({
      storedTimeZone: 'America/Chicago',
      storedHasPwa: false,
      resolvedZone: 'America/Denver',
      displayModeStandalone: false,
      navigatorStandalone: false,
    })
    expect(result.writeZone).toBeNull()
  })

  // v1's guard (app-bar-base.tsx:51) treats an empty string the same as
  // missing. A stored '' read as "already has a zone" would never be filled,
  // and convex/reminders.ts skips a falsy timeZone — that player would be
  // permanently invisible to the sweep with no write ever attempted.
  test('treats a stored empty string the same as no zone at all', () => {
    const result = decideLocalCapture({
      storedTimeZone: '',
      storedHasPwa: false,
      resolvedZone: 'America/Denver',
      displayModeStandalone: false,
      navigatorStandalone: false,
    })
    expect(result.writeZone).toBe('America/Denver')
  })

  // Fixture is deliberately one of timeZoneMapping's five aliased entries
  // (time-zones.ts): 'Asia/Calcutta' maps to 'Asia/Kolkata' on READ. If the
  // write path applied that SAME (v2, read-time) mapping, this assertion
  // would catch it — the resolved zone must come back exactly as the browser
  // reported it.
  test('writes the resolved zone unmapped, even when it has a known alias', () => {
    const result = decideLocalCapture({
      storedTimeZone: null,
      storedHasPwa: false,
      resolvedZone: 'Asia/Calcutta',
      displayModeStandalone: false,
      navigatorStandalone: false,
    })
    expect(result.writeZone).toBe('Asia/Calcutta')
  })

  // The mirror of the case above, and not redundant with it: v1's OWN mapping
  // (app-bar-base.tsx:14-20,53) ran the OPPOSITE direction — IANA to Postgres,
  // `timeZoneMapping[jsTimeZone] || jsTimeZone` — so a browser reporting the
  // IANA spelling 'Asia/Kolkata' would have come out as 'Asia/Calcutta' under
  // v1's rule. Only a fixture that is itself a v2-canonical (IANA) spelling
  // exercises that direction; the case above uses the Postgres spelling and
  // cannot catch a mutation that reintroduces v1's rule instead of v2's.
  test('writes a browser-canonical zone unmapped too, not translated toward the old Postgres spelling', () => {
    const result = decideLocalCapture({
      storedTimeZone: null,
      storedHasPwa: false,
      resolvedZone: 'Asia/Kolkata',
      displayModeStandalone: false,
      navigatorStandalone: false,
    })
    expect(result.writeZone).toBe('Asia/Kolkata')
  })

  test('writes hasPwa when display-mode reports standalone', () => {
    const result = decideLocalCapture({
      storedTimeZone: 'America/Chicago',
      storedHasPwa: false,
      resolvedZone: 'Asia/Calcutta',
      displayModeStandalone: true,
      navigatorStandalone: false,
    })
    expect(result.writePwa).toBe(true)
  })

  // navigator.standalone is iOS Safari's own signal; display-mode does not
  // report standalone there. Pinned separately from the display-mode case
  // above so dropping either disjunct in decideLocalCapture goes red.
  test('writes hasPwa when navigator.standalone reports true, even if display-mode does not', () => {
    const result = decideLocalCapture({
      storedTimeZone: 'America/Chicago',
      storedHasPwa: false,
      resolvedZone: 'Asia/Calcutta',
      displayModeStandalone: false,
      navigatorStandalone: true,
    })
    expect(result.writePwa).toBe(true)
  })

  test('does not write hasPwa again once it is already recorded', () => {
    const result = decideLocalCapture({
      storedTimeZone: 'America/Chicago',
      storedHasPwa: true,
      resolvedZone: 'Asia/Calcutta',
      displayModeStandalone: true,
      navigatorStandalone: true,
    })
    expect(result.writePwa).toBe(false)
  })

  test('does not write hasPwa when neither standalone signal is true', () => {
    const result = decideLocalCapture({
      storedTimeZone: 'America/Chicago',
      storedHasPwa: false,
      resolvedZone: 'Asia/Calcutta',
      displayModeStandalone: false,
      navigatorStandalone: false,
    })
    expect(result.writePwa).toBe(false)
  })

  test('both writes can happen together, for a brand-new install', () => {
    const result = decideLocalCapture({
      storedTimeZone: null,
      storedHasPwa: false,
      resolvedZone: 'Europe/Lisbon',
      displayModeStandalone: true,
      navigatorStandalone: false,
    })
    expect(result.writeZone).toBe('Europe/Lisbon')
    expect(result.writePwa).toBe(true)
  })
})
