// @vitest-environment jsdom
import { cleanup, render, screen } from '@testing-library/react'
import { createElement } from 'react'
import { afterEach, describe, expect, test } from 'vitest'
import { MiniBoard, WordTiles } from './mini-board.tsx'

afterEach(cleanup)

describe('MiniBoard', () => {
  test('it colours tiles from the real answer', () => {
    render(createElement(MiniBoard, { guesses: ['CRANE'], answer: 'CRAZY', testId: 'board' }))
    const tiles = screen.getByTestId('board').querySelectorAll('span')
    expect(tiles).toHaveLength(5)
    expect(tiles[0].className).toContain('bg-wordle-correct')
    expect(tiles[4].className).toContain('bg-wordle-absent')
  })

  test('the grid is hidden from assistive tech, which reads the score instead', () => {
    render(createElement(MiniBoard, { guesses: ['CRANE'], answer: 'CRAZY', testId: 'board' }))
    expect(screen.getByTestId('board').getAttribute('aria-hidden')).toBe('true')
  })

  test("v1's empty-string sentinel on a failed board renders no row", () => {
    render(
      createElement(MiniBoard, {
        guesses: ['CRANE', 'MOIST', ''],
        answer: 'CRAZY',
        testId: 'board',
      }),
    )
    expect(screen.getByTestId('board').querySelectorAll('span')).toHaveLength(10)
  })

  test('without an answer it renders neutral tiles rather than guessing colours', () => {
    render(createElement(MiniBoard, { guesses: ['CRANE'], testId: 'board' }))
    const tiles = screen.getByTestId('board').querySelectorAll('span')
    expect(tiles[0].className).toContain('border-wordle-tile-border')
    expect(tiles[0].className).toContain('border')
    expect(tiles[0].className).toContain('bg-transparent')
    expect(tiles[0].className).not.toContain('bg-wordle-correct')
    expect(tiles[0].className).not.toContain('bg-wordle-present')
    expect(tiles[0].className).not.toContain('bg-wordle-absent')
  })
})

describe('WordTiles', () => {
  test('it renders the letters uncoloured, because one opener has many results', () => {
    render(createElement(WordTiles, { word: 'CRANE', testId: 'word' }))
    const tiles = screen.getByTestId('word').querySelectorAll('span')
    expect(tiles).toHaveLength(5)
    expect(tiles[0].textContent).toBe('C')
    expect(tiles[0].className).not.toContain('bg-wordle-correct')
    expect(tiles[0].className).not.toContain('bg-wordle-present')
  })

  test('the word is exposed to assistive tech as one string, not five separate letters', () => {
    render(createElement(WordTiles, { word: 'CRANE', testId: 'word' }))
    // getByRole('img', { name: 'CRANE' }) only succeeds if there is a single
    // accessible name for the whole word — if the letter spans leaked through
    // as their own accessible nodes instead, this lookup fails.
    const node = screen.getByRole('img', { name: 'CRANE' })
    expect(node).toBe(screen.getByTestId('word'))
  })
})
