/** A deterministic PRNG (mulberry32). Not cryptographic; see plan 3 for seed secrecy. */
export type Rng = {
  /** Uniform in [0, 1). */
  next(): number
  /** Uniform integer in [0, n). */
  int(n: number): number
  pick<T>(items: readonly T[]): T
  /** A shuffled copy (Fisher–Yates). */
  shuffle<T>(items: readonly T[]): T[]
  /** A key chosen with probability proportional to its weight. */
  weighted<K>(entries: ReadonlyArray<readonly [K, number]>): K
}

export function createRng(seed: number): Rng {
  let state = seed >>> 0
  const next = () => {
    state = (state + 0x6d2b79f5) >>> 0
    let t = state
    t = Math.imul(t ^ (t >>> 15), t | 1)
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
  const int = (n: number) => Math.floor(next() * n)
  return {
    next,
    int,
    pick(items) {
      if (items.length === 0) throw new Error('pick from an empty list')
      return items[int(items.length)]
    },
    shuffle(items) {
      const out = items.slice()
      for (let i = out.length - 1; i > 0; i--) {
        const j = int(i + 1)
        ;[out[i], out[j]] = [out[j], out[i]]
      }
      return out
    },
    weighted(entries) {
      const total = entries.reduce((sum, [, w]) => sum + Math.max(0, w), 0)
      if (total <= 0) throw new Error('weighted needs a positive total weight')
      let roll = next() * total
      for (const [key, w] of entries) {
        if (w <= 0) continue
        roll -= w
        if (roll < 0) return key
      }
      // Floating-point edge: return the last positive-weight key.
      return [...entries].reverse().find(([, w]) => w > 0)![0]
    },
  }
}
