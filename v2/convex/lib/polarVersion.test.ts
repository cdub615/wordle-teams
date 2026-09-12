import { SDK_METADATA } from '@polar-sh/sdk/lib/config.js'
import { describe, expect, test } from 'vitest'
import { POLAR_API_VERSION } from './polarVersion.ts'

/**
 * wordle-teams-rpc0.
 *
 * THE MODULE UNDER TEST IS ONE STRING, and the tests are still worth having,
 * because what they assert is not the string — it is the string's AGREEMENT with
 * two things that can move underneath it: the SDK's generated contract, and the
 * calendar. Neither disagreement produces a type error.
 *
 * This file imports `@polar-sh/sdk` and the module it tests does not. That is
 * deliberate and is not a hole in polarVersion.ts's dependency-free claim: the
 * SDK is here as the ORACLE the constant is checked against, in a test that
 * never ships.
 */
describe('POLAR_API_VERSION', () => {
  // THE TEST THAT EARNS ITS KEEP AT UPGRADE TIME, NOT TODAY.
  //
  // The constant has to name the contract the SDK's GENERATED MODELS describe,
  // because those models are the types convex/polar.ts compiles against.
  // `SDK_METADATA.openapiDocVersion` is the installed SDK's own statement of
  // which contract that is.
  //
  // So this fails on exactly one event: a dependency bump that moves the SDK to
  // a new API version while the pin stays put. That combination would otherwise
  // typecheck, build, and ship a request whose header contradicts the types
  // handling the response — and would do it silently, since the mismatch lives
  // between a string and a package, not in any signature. Migrating the pin is
  // wordle-teams-4etd; this is what makes the migration impossible to forget.
  test('names the API version the installed SDK was generated from', () => {
    expect(POLAR_API_VERSION).toBe(SDK_METADATA.openapiDocVersion)
  })

  // Pinned as a literal too, so the assertion above cannot be satisfied by BOTH
  // sides moving together — which is exactly what a careless upgrade would do if
  // someone "fixed" the failure by reading the new value off the SDK. Changing
  // this line is the deliberate act wordle-teams-4etd asks for.
  test('is 2026-04', () => {
    expect(POLAR_API_VERSION).toBe('2026-04')
  })

  // Polar's format, and the reason to pin the SHAPE rather than only the value:
  // a malformed version is not ignored and does not fall back to Current — it is
  // answered 404, which would take down every Polar call this app makes. The
  // literal test above already covers today; this one covers the edit that
  // replaces it.
  test('is a YYYY-MM version of the kind Polar accepts', () => {
    expect(POLAR_API_VERSION).toMatch(/^\d{4}-(0[1-9]|1[0-2])$/)
  })

  // Polar releases in January, April, July and October only, so a quarter that
  // is not one of those four is a typo that would be answered 404 rather than
  // rounded to the nearest real release.
  test('names one of the four quarterly release months', () => {
    expect(['01', '04', '07', '10']).toContain(POLAR_API_VERSION.slice(-2))
  })
})
