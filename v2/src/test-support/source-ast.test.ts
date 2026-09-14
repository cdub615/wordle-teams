import { describe, expect, test } from 'vitest'
import { codeOf } from './source-ast'

/**
 * WHY THIS SUITE EXISTS AT ALL, when the rest of source-ast.ts has none.
 *
 * Every other helper here throws on a shape it does not recognise, so a caller
 * that breaks finds out. `codeOf` cannot throw — it hands back a string, and a
 * string that is MISSING text is exactly what a `not.toMatch` guard wants to
 * see. That is the one failure mode in this file that is silent by
 * construction, so it is the one with a suite of its own.
 *
 * The original implementation stripped comments with a pair of regexes -- one
 * for block comments, one that deleted from a `//` to the end of the line --
 * which have no idea what a string literal is. The `//` in an absolute URL read
 * as the start of a line comment and everything after it on that line was
 * deleted — so a forbidden call sitting after a URL was erased before the guard
 * could see it, and the guard passed on a file that violated it.
 */
describe('codeOf strips comments without eating string literals', () => {
  test('a forbidden token after a URL on the same line still reaches the guard', () => {
    // THE VECTOR, and the assertion that matters. Not "the URL survives" — a
    // fix that kept the URL and still ate the rest of the line would pass that.
    const source = `const url = 'https://wordleteams.com/app'; localStorage.setItem('x', y)`

    expect(codeOf(source)).toMatch(/localStorage/)
  })

  test('a URL in a single-quoted string is left whole', () => {
    expect(codeOf(`const u = 'https://example.com/x'`)).toContain('https://example.com/x')
  })

  test('a URL in a double-quoted string is left whole', () => {
    expect(codeOf(`const u = "https://example.com/x"`)).toContain('https://example.com/x')
  })

  test('a URL in a template literal is left whole', () => {
    expect(codeOf('const u = `https://example.com/${id}`')).toContain('https://example.com/')
  })

  test('a URL inside JSX text is left whole', () => {
    const source = `export const A = () => <p>see https://example.com/help for more</p>`

    expect(codeOf(source)).toContain('https://example.com/help for more')
  })

  test('`//` inside a regex character class is left whole', () => {
    expect(codeOf('const re = /[//]/; const after = 1')).toContain('const after = 1')
  })

  // The other half of the contract: it is still a comment stripper. A "fix"
  // that returned the source unchanged would pass every assertion above.
  test('a line comment is still stripped', () => {
    expect(codeOf('const a = 1 // localStorage.setItem\nconst b = 2')).not.toMatch(/localStorage/)
  })

  test('a line comment following a string on the same line is still stripped', () => {
    const source = `const u = 'https://example.com' // localStorage.setItem`

    expect(codeOf(source)).not.toMatch(/localStorage/)
  })

  test('a block comment is still stripped', () => {
    expect(codeOf('/* localStorage.setItem */ const a = 1')).not.toMatch(/localStorage/)
  })

  test('a multi-line JSDoc block is still stripped', () => {
    const source = ['/**', ' * localStorage.setItem is forbidden here.', ' */', 'const a = 1'].join(
      '\n',
    )

    expect(codeOf(source)).not.toMatch(/localStorage/)
    expect(codeOf(source)).toContain('const a = 1')
  })

  test('a JSX comment expression is still stripped', () => {
    const source = `export const A = () => <p>{/* localStorage.setItem */}ok</p>`

    expect(codeOf(source)).not.toMatch(/localStorage/)
  })

  test('the line a comment sat on keeps its code', () => {
    // Comment removal must not join the lines around it, or a caller matching
    // across a line boundary starts seeing pairs that are not adjacent.
    const source = ['const a = 1 // one', 'const b = 2'].join('\n')

    expect(codeOf(source).split('\n').map((line) => line.trim())).toEqual(['const a = 1', 'const b = 2'])
  })
})
