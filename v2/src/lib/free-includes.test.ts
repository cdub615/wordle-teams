// @vitest-environment node
//
// node rather than the suite's default edge-runtime, because the two disk tests
// below read the filesystem. That is the whole point of them, in
// pro-benefits.test.ts's words: a path that does not resolve is a claim nobody
// checked.
import { existsSync, readFileSync, statSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, test } from 'vitest'
import { FREE_TEAM_LIMIT } from '../../convex/lib/teamLimits.ts'
import { FREE_MONTHS } from '../../convex/lib/monthWindow.ts'
import { FREE_INCLUDES } from './free-includes.ts'

describe('FREE_INCLUDES', () => {
  test('lists exactly the six things a free account gets today', () => {
    // A COUNT AND ORDER ASSERTION, deliberately, and toEqual on the whole list
    // rather than toHaveLength: a reorder, a deletion and a reworded id all have
    // to fail, and only the full list does that. This file is copy, and copy is
    // the one thing typecheck, lint and build cannot check — pro-benefits.test.ts
    // carries the same assertion over the other column for the same reason.
    //
    // THE ORDER IS WHAT /pricing RENDERS, top to bottom, so this is a claim about
    // the page as well as about the list.
    expect(FREE_INCLUDES.map((inclusion) => inclusion.id)).toEqual([
      'teams',
      'months',
      'benchmark',
      'team-fact',
      'chat',
      'reminders',
    ])
  })

  test('every checkedAgainst path exists on disk, as a file', () => {
    // THE PROPERTY THAT KEEPS THIS HONEST, and it has to touch the filesystem to
    // have it. A suffix check (`/\.tsx?$/`) would pass for 'nonsense.ts' while the
    // comment claimed the entry named real code.
    //
    // `.isFile()`, NOT JUST `existsSync`. A directory resolves too —
    // `checkedAgainst: 'convex'` would pass existsSync and say nothing at all
    // about which file makes the claim true.
    for (const inclusion of FREE_INCLUDES) {
      const path = resolve(__dirname, '../..', inclusion.checkedAgainst)
      expect(existsSync(path), inclusion.checkedAgainst).toBe(true)
      expect(statSync(path).isFile(), inclusion.checkedAgainst).toBe(true)
    }
  })

  test('no file behind a free claim gates anything on isPro', () => {
    // THE ASSERTION THAT WOULD CATCH THE DEFECT THIS LIST IS MOST EXPOSED TO.
    // A free claim that goes stale has no moment of discovery — nobody complains
    // that a thing they were not charged for is missing — so the way this column
    // goes wrong is by describing a GATED capability as part of the free product.
    //
    // A GREP FOR THE PREDICATE, NOT A COMPARISON AGAINST A LIST OF IDS. Ids are a
    // closed union, so `id !== 'chat'` is something TypeScript already knows and
    // a test of it proves nothing. `isPro` is the actual shape of every gate in
    // this codebase — `isProFor` on the server, the `amIPro` query's `isPro` in
    // the client — so this fails on the day somebody gates team chat, reminders
    // or the free benchmark, which is the event that would silently make this
    // list false.
    //
    // WIDER THAN THE TEST IT IS MODELLED ON. marketing-copy.test.ts runs this
    // grep over ALSO_FREE's two paths; every entry here is a free claim, so every
    // entry here is in scope. That file keeps its own copy of the grep while the
    // landing still writes its own copies of these sentences.
    for (const inclusion of FREE_INCLUDES) {
      const source = readFileSync(resolve(__dirname, '../..', inclusion.checkedAgainst), 'utf8')
      expect(
        source,
        `${inclusion.id}: ${inclusion.checkedAgainst} gates on isPro`,
      ).not.toMatch(/isPro/)
    }
  })

  test('pins the free-tier numbers this copy spells out in words', () => {
    // The idiom pro-benefits.test.ts and plans.test.ts both use, and the
    // inventory's header states the reason: the `teams` body says "two teams" and
    // the `months` entry says "Three months" and "the two before it" as WORDS,
    // because prose cannot embed a template literal. So the constants are pinned
    // here instead, one to each spelled-out number. Change
    // FREE_TEAM_LIMIT or FREE_MONTHS without rewriting the copy and this fails
    // rather than shipping a stale number behind four green gates.
    expect(FREE_TEAM_LIMIT).toBe(2)
    expect(FREE_MONTHS).toBe(3)
  })
})
