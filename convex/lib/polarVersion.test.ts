import { readFileSync } from 'node:fs'
import { createPolarCore } from '@polar-sh/sdk/2026-10'
import { describe, expect, test } from 'vitest'
import { POLAR_API_VERSION } from './polarVersion.ts'

/**
 * wordle-teams-rpc0, re-anchored for the prerelease SDK by wordle-teams-y8to.
 *
 * THE MODULE UNDER TEST IS ONE STRING, and the tests are still worth having,
 * because what they assert is not the string — it is the string's AGREEMENT
 * with things that can move underneath it without producing a type error: the
 * version the SDK actually puts on the wire, the import path that selects it,
 * and the calendar.
 *
 * THE OLD ORACLE IS GONE, AND THE NEW ONE IS BETTER. Against
 * `@polar-sh/sdk@0.49.0` this file compared the constant to
 * `SDK_METADATA.openapiDocVersion`, the SDK's own statement of which contract
 * it was generated from. `1.0.0-alpha.21` publishes no such metadata. What it
 * publishes instead is one entry point per version whose client sends the
 * header itself — so the replacement asserts the HEADER, which is the thing
 * that was only ever inferred before. A regression that silently changed the
 * version now fails on the wire value, not on a description of it.
 *
 * This file imports `@polar-sh/sdk` and the module it tests does not. That is
 * deliberate and is not a hole in polarVersion.ts's dependency-free claim: the
 * SDK is here as the ORACLE, in a test that never ships.
 */
describe('POLAR_API_VERSION', () => {
  // THE CENTRAL TEST: the constant describes what Polar is actually told.
  //
  // `buildRequest` is the one place the alpha assembles headers
  // (`dist/base-*.mjs`), and it reads the version off the client's own options
  // — the same options `createPolar` bakes in from the import path. So this
  // drives the real code path for every request the app makes, without a
  // network and without stubbing anything.
  test('is the version the SDK client actually sends', () => {
    const core = createPolarCore({ accessToken: 'polar_oat_test', environment: 'sandbox' })

    const [, init] = core.buildRequest('GET', '/v1/checkouts/')

    expect(new Headers(init.headers).get('Polar-Version')).toBe(POLAR_API_VERSION)
  })

  // THE TEST THAT EARNS ITS KEEP AT UPGRADE TIME, NOT TODAY.
  //
  // The version is selected by convex/polar.ts's IMPORT PATH — nothing passes
  // POLAR_API_VERSION to the client, so the two could drift apart with both
  // halves compiling and the test above still passing, since it would be
  // checking a 2026-10 client against a constant nobody had updated.
  //
  // Reading the source is the only way to see the subpath: an import
  // specifier is erased by the time anything is running. polar.test.ts reads
  // its own source for the same reason.
  test('matches the SDK subpath convex/polar.ts imports', () => {
    const source = readFileSync(new URL('../polar.ts', import.meta.url), 'utf8')

    // Anchored to a real import STATEMENT at the start of a line: the same
    // subpath appears in this module's prose, and a doc comment describing the
    // version is not a second client.
    const imports = [
      ...source.matchAll(/^import .* from '@polar-sh\/sdk\/(\d{4}-\d{2})'$/gm),
    ].map((match) => match[1])

    // Exactly one, so a second versioned import cannot be added without this
    // failing — two clients on different contracts is the bug this guards.
    expect(imports).toEqual([POLAR_API_VERSION])
  })

  // Pinned as a literal too, so the two assertions above cannot be satisfied by
  // EVERYTHING moving together — which is what a careless upgrade would do if
  // someone "fixed" a failure by reading the new value off the SDK. Changing
  // this line is the deliberate act wordle-teams-shdx asks for.
  test('is 2026-10', () => {
    expect(POLAR_API_VERSION).toBe('2026-10')
  })

  // Polar's format, and the reason to pin the SHAPE rather than only the value:
  // a malformed version is not ignored and does not fall back to Current — it is
  // answered 404, which would take down every Polar call this app makes.
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
