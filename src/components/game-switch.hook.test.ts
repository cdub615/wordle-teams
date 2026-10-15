// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { createElement } from 'react'
import { afterEach, describe, expect, test, vi } from 'vitest'
import { GameSwitch } from './game-switch.tsx'

afterEach(cleanup)

describe('GameSwitch', () => {
  test('marks the shown game as pressed', () => {
    render(createElement(GameSwitch, { value: 'clueLadder', onChange: vi.fn() }))
    expect(screen.getByRole('button', { name: 'Clue ladder' }).getAttribute('aria-pressed')).toBe('true')
    expect(screen.getByRole('button', { name: 'Wordle' }).getAttribute('aria-pressed')).toBe('false')
  })

  test('switches game', () => {
    const onChange = vi.fn()
    render(createElement(GameSwitch, { value: 'wordle', onChange }))
    fireEvent.click(screen.getByRole('button', { name: 'Clue ladder' }))
    expect(onChange).toHaveBeenCalledWith('clueLadder')
  })

  test('switches back to Wordle', () => {
    const onChange = vi.fn()
    render(createElement(GameSwitch, { value: 'clueLadder', onChange }))
    fireEvent.click(screen.getByRole('button', { name: 'Wordle' }))
    expect(onChange).toHaveBeenCalledWith('wordle')
  })

  test('is a labelled group', () => {
    render(createElement(GameSwitch, { value: 'wordle', onChange: vi.fn() }))
    expect(screen.getByRole('group', { name: 'Scores for' })).toBeTruthy()
  })
})
