import { describe, expect, it } from 'vitest'
import { mergeDeleted, purgeLoop } from './purge-loop.mjs'

describe('mergeDeleted', () => {
  it('sums per-table counts across calls', () => {
    const totals = {}
    mergeDeleted(totals, { dailyScores: 800 })
    mergeDeleted(totals, { dailyScores: 412, monthlyWinners: 81 })
    expect(totals).toEqual({ dailyScores: 1212, monthlyWinners: 81 })
  })

  it('treats a missing table as zero rather than NaN', () => {
    const totals = { teams: 3 }
    mergeDeleted(totals, { players: 1 })
    expect(totals).toEqual({ teams: 3, players: 1 })
  })
})

describe('purgeLoop', () => {
  it('stops after one call when nothing remains', async () => {
    const calls = []
    const result = await purgeLoop(async () => {
      calls.push(1)
      return { deleted: { players: 5 }, remaining: false }
    })
    expect(calls).toHaveLength(1)
    expect(result).toEqual({ totals: { players: 5 }, calls: 1 })
  })

  // THE FAILURE GATE A NAMES. purgeCopiedData deletes ~800 per call and returns
  // remaining:true; an operator who runs it once leaves most of the data in
  // place and then reads the insert report as a resurrection.
  it('keeps calling while the server reports rows remaining', async () => {
    const pages = [
      { deleted: { dailyScores: 800 }, remaining: true },
      { deleted: { dailyScores: 800 }, remaining: true },
      { deleted: { dailyScores: 143, teams: 152 }, remaining: false },
    ]
    let i = 0
    const result = await purgeLoop(async () => pages[i++])
    expect(result.calls).toBe(3)
    expect(result.totals).toEqual({ dailyScores: 1743, teams: 152 })
  })

  it('is a no-op on an already-empty deployment', async () => {
    const result = await purgeLoop(async () => ({ deleted: {}, remaining: false }))
    expect(result).toEqual({ totals: {}, calls: 1 })
  })

  // A server-side bug that never clears `remaining` would otherwise spin
  // forever against production, at 6am, deleting nothing.
  it('throws rather than looping forever when the cap is reached', async () => {
    await expect(
      purgeLoop(async () => ({ deleted: { dailyScores: 800 }, remaining: true }), { maxCalls: 4 }),
    ).rejects.toThrow(/did not finish within 4 calls/)
  })

  it('reports how much it deleted before giving up, so the operator can resume', async () => {
    await expect(
      purgeLoop(async () => ({ deleted: { dailyScores: 800 }, remaining: true }), { maxCalls: 2 }),
    ).rejects.toThrow(/dailyScores=1600/)
  })
})
