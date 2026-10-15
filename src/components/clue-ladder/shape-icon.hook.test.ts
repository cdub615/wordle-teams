// @vitest-environment jsdom
import { cleanup, render, screen } from '@testing-library/react'
import { createElement } from 'react'
import { afterEach, describe, expect, test } from 'vitest'
import { SHAPES } from '../../../convex/lib/clueLadder/orders.ts'
import { SHAPE_NAMES, ShapeIcon, ShapeRow } from './shape-icon.tsx'

afterEach(cleanup)

describe('ShapeIcon', () => {
  test.each(SHAPES)('%s has a text label for screen readers', (shape) => {
    render(createElement(ShapeIcon, { shape }))
    expect(screen.getByRole('img', { name: SHAPE_NAMES[shape] })).toBeTruthy()
  })

  test('every shape has a distinct name', () => {
    expect(new Set(SHAPES.map((s) => SHAPE_NAMES[s])).size).toBe(SHAPES.length)
  })

  test('a decorative icon is hidden from screen readers', () => {
    const { container } = render(createElement(ShapeIcon, { shape: 'star', decorative: true }))
    expect(screen.queryByRole('img')).toBeNull()
    expect(container.querySelector('svg')?.getAttribute('aria-hidden')).toBe('true')
  })

  test('every shape has its own outline', () => {
    const outlines = SHAPES.map((shape) => {
      const { container } = render(createElement(ShapeIcon, { shape }))
      const html = container.querySelector('svg')?.innerHTML
      cleanup()
      return html
    })
    expect(new Set(outlines).size).toBe(SHAPES.length)
  })

  test.each(SHAPES)('%s is an outline, not a fill', (shape) => {
    const { container } = render(createElement(ShapeIcon, { shape }))
    const svg = container.querySelector('svg')
    expect(svg?.getAttribute('fill')).toBe('none')
    expect(svg?.getAttribute('stroke')).toBe('currentColor')
    for (const el of Array.from(svg?.querySelectorAll('[fill]') ?? [])) {
      expect(el.getAttribute('fill')).toBe('none')
    }
  })
})

describe('ShapeRow', () => {
  test('reads as one labelled image, in order', () => {
    render(createElement(ShapeRow, { order: ['star', 'circle', 'square', 'triangle', 'diamond'], label: 'Answer' }))
    expect(screen.getByRole('img', { name: 'Answer: star, circle, square, triangle, diamond' })).toBeTruthy()
    // The five icons inside are decorative; only the row is announced.
    expect(screen.getAllByRole('img')).toHaveLength(1)
  })
})
