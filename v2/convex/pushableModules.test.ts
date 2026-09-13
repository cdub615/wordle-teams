import { readdirSync, readFileSync, statSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, test } from 'vitest'
import { codeOf } from '../src/test-support/source-ast.ts'

/**
 * NOTHING THE CONVEX CLI PUSHES MAY EVALUATE `import.meta`.
 *
 * The Convex runtime does not implement it. A module under convex/ that reads
 * `import.meta` is accepted by vitest, tsc, eslint and `vite build` — all four
 * gates go green — and then kills the deploy at module analysis with
 * `Failed to analyze <file>.js: Uncaught TypeError: import.meta unsupported`.
 *
 * THIS IS NOT HYPOTHETICAL. convex/fixtures.ts acquired an `import.meta.glob`
 * on 2026-09-13 to register the local betterAuth component for tests. Every
 * local gate passed; CI run 34780544321 failed at the e2e step, which is the
 * only step that performs a real push, and nothing deployed. The fix moved the
 * glob into the callers — see `makeRegisterBetterAuth` in fixtures.ts.
 *
 * `*.test.ts` IS EXEMPT, AND THAT IS THE WHOLE MECHANISM. The CLI does not push
 * test files, which is why a dozen suites under convex/ already open with
 * `const modules = import.meta.glob(...)` and always have. The rule is about
 * which files ship, not about the syntax.
 *
 * Comments are stripped before matching (`codeOf`): this very file, and
 * fixtures.ts's explanation of why the glob moved, both name the thing being
 * banned.
 */
const CONVEX_DIR = new URL('.', import.meta.url).pathname

function pushedModules(dir: string, out: string[] = []): string[] {
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry)
    if (statSync(full).isDirectory()) {
      // _generated is written by the CLI itself and is not ours to police.
      if (entry !== '_generated') pushedModules(full, out)
      continue
    }
    if (!entry.endsWith('.ts')) continue
    if (entry.endsWith('.test.ts')) continue
    out.push(full)
  }
  return out
}

describe('every module the Convex CLI pushes', () => {
  test('is free of import.meta, which the Convex runtime cannot evaluate', () => {
    const offenders = pushedModules(CONVEX_DIR)
      .filter((file) => codeOf(readFileSync(file, 'utf8')).includes('import.meta'))
      .map((file) => file.slice(CONVEX_DIR.length))

    expect(offenders).toEqual([])
  })

  test('and the walk actually looked at the real convex tree', () => {
    // Without this, a bad root or a filter that excluded everything would make
    // the assertion above pass over an empty list forever — the failure mode
    // that let the original bug through in the first place.
    const files = pushedModules(CONVEX_DIR).map((f) => f.slice(CONVEX_DIR.length))

    expect(files).toContain('fixtures.ts')
    expect(files).toContain('auth.ts')
    expect(files).toContain('betterAuth/schema.ts')
    expect(files.some((f) => f.endsWith('.test.ts'))).toBe(false)
  })
})
