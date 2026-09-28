import { readFile } from 'node:fs/promises'
import { describe, expect, test } from 'vitest'
import { SWEEPS_DISABLED, sweepsEnabled } from './sweeps.ts'

/**
 * THE POLARITY IS THE WHOLE DESIGN, so every case here is about which way an
 * ambiguous value falls rather than about parsing. See the header on sweeps.ts.
 */
describe('sweepsEnabled', () => {
  test('the exact string "false" turns the sweeps off', () => {
    expect(sweepsEnabled('false')).toBe(false)
  })

  test('an UNSET variable leaves the sweeps running', () => {
    expect(sweepsEnabled(undefined)).toBe(true)
  })

  test('an EMPTY variable leaves the sweeps running', () => {
    expect(sweepsEnabled('')).toBe(true)
  })

  test('"true" leaves the sweeps running', () => {
    expect(sweepsEnabled('true')).toBe(true)
  })

  // The near-misses. Each of these is a value somebody plausibly types meaning
  // "off", and each one MUST leave the sweeps running: a deployment whose
  // sweeps stopped because of a typo is the silent failure this polarity exists
  // to prevent, and there is no symmetric harm in the other direction.
  test.each(['False', 'FALSE', ' false', 'false ', '0', 'no', 'off', 'disabled'])(
    'the near-miss %o does NOT turn the sweeps off',
    (value) => {
      expect(sweepsEnabled(value)).toBe(true)
    },
  )

  test('the disabling value is exported so call sites and docs cannot drift from it', () => {
    expect(SWEEPS_DISABLED).toBe('false')
    expect(sweepsEnabled(SWEEPS_DISABLED)).toBe(false)
  })
})

/**
 * THE GATE MUST BE THE FIRST STATEMENT OF EVERY SWEEP THAT HAS ONE, and this is
 * a SOURCE assertion because the property is invisible at runtime.
 *
 * WHY IT EXISTS: measured, not guessed. A mutant that moved the gate to just
 * AFTER `ctx.db.query('teams').collect()` in teamStats.sweep SURVIVED the whole
 * suite — every behavioural assertion still passed, because a sweep that scans
 * the table and then returns writes exactly as little as one that returns first.
 * The scan IS the cost the switch exists to remove (wordle-teams-yhii found this
 * sweep to be the dominant consumer of the free-tier database-I/O allowance), so
 * the surviving mutant was a switch that had stopped saving anything while
 * looking correct from the outside.
 *
 * chatNotify.sweep's ordering is ALSO covered behaviourally, by the
 * disabled-then-enabled pair in chatNotify.test.ts, because its first read is
 * inside `pendingChatNotificationsFor` and its loop CONSUMES state. teamStats has
 * no equivalent tell — its scan is a pure read — which is exactly why the weaker
 * one needs this and the stronger one gets it for free.
 *
 * IT ASSERTS THE FIRST STATEMENT rather than "before the first ctx.db", which
 * would be the obvious rule and is the weaker one: chatNotify reads through a
 * helper, so no literal `ctx.db` appears in its handler until well after the
 * point that matters.
 */
describe('every gated sweep checks the switch before it does anything', () => {
  const GATED = [
    ['../chatNotify.ts', 'chatNotify.sweep'],
    ['../teamStats.ts', 'teamStats.sweep'],
  ] as const

  /** The handler body of `export const sweep`, comments and blank lines removed. */
  function handlerStatements(source: string): string[] {
    const start = source.indexOf('export const sweep = internalMutation({')
    expect(start, 'no `export const sweep = internalMutation({` in this file').toBeGreaterThan(-1)
    const body = source.slice(start).split('handler: async (ctx) => {')[1]
    expect(body, 'no `handler: async (ctx) => {` in the sweep').toBeDefined()
    return body!
      .split('\n')
      .map((line) => line.trim())
      .filter((line) => line !== '' && !line.startsWith('//') && !line.startsWith('*') && !line.startsWith('/*'))
  }

  test.each(GATED)('%s checks SWEEPS_ENABLED first', async (file, name) => {
    const source = await readFile(new URL(file, import.meta.url), 'utf8')
    const [first] = handlerStatements(source)
    expect(first, `${name}'s handler has no statements`).toBeDefined()
    expect(first).toContain('sweepsEnabled(process.env.SWEEPS_ENABLED)')
  })
})
