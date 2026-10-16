import { generatePuzzle, type Puzzle } from './generate.ts'

/**
 * The clue ladder's daily seed (wordle-teams-9j7o.2.3, spec section 3).
 *
 * HMAC-SHA256 of the date under CLUE_LADDER_SEED: a date always yields the same
 * puzzle, and nobody without the secret can compute tomorrow's. The generator's
 * RNG (rng.ts) is not cryptographic, so the secrecy has to live here.
 *
 * Web Crypto only. It is global in Convex's runtime, in Node and in Vitest's
 * edge-runtime, so this file stays Convex-free like the rest of lib/clueLadder.
 */

/**
 * Stored on every puzzle and part of the HMAC message. Bump it when
 * generatePuzzle's output for a seed changes, and seed.test.ts's golden
 * snapshot with it.
 */
export const GENERATOR_VERSION = 1

/** A shorter secret is treated as unset: a guessable secret is no secret. */
export const MIN_SECRET_LENGTH = 16

export function seedSecretUsable(secret: string | undefined): secret is string {
  return secret !== undefined && secret.length >= MIN_SECRET_LENGTH
}

export function puzzleMessage(date: string): string {
  return `clue-ladder:${GENERATOR_VERSION}:${date}`
}

/**
 * The first four bytes of HMAC-SHA256(secret, message), read BIG-ENDIAN as an
 * unsigned 32-bit integer. The byte order is part of every puzzle: the same
 * bytes read little-endian would give every date a different one. So it is
 * spelled out (`getUint32(0, false)`) and pinned by RFC 4231's vectors.
 */
export async function hmacSeed(secret: string, message: string): Promise<number> {
  const encoder = new TextEncoder()
  const key = await crypto.subtle.importKey(
    'raw',
    encoder.encode(secret),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign'],
  )
  const mac = await crypto.subtle.sign('HMAC', key, encoder.encode(message))
  return new DataView(mac).getUint32(0, false)
}

export async function puzzleForDate(secret: string, date: string): Promise<Puzzle> {
  return generatePuzzle(await hmacSeed(secret, puzzleMessage(date)))
}
