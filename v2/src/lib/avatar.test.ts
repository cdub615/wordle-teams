import { describe, expect, test } from 'vitest'
import { cropRectFor } from './avatar.ts'

describe('cropRectFor', () => {
  test('a square image is taken whole', () => {
    expect(cropRectFor(400, 400)).toEqual({ sx: 0, sy: 0, side: 400 })
  })

  test('a landscape image is cropped to its centre column', () => {
    expect(cropRectFor(800, 400)).toEqual({ sx: 200, sy: 0, side: 400 })
  })

  test('a portrait image is cropped to its centre row', () => {
    expect(cropRectFor(400, 800)).toEqual({ sx: 0, sy: 200, side: 400 })
  })

  // An odd remainder must not produce a fractional source rect: drawImage
  // accepts one, but the half-pixel shows as a soft edge at 256px.
  test('an odd offset is floored rather than left fractional', () => {
    expect(cropRectFor(401, 400)).toEqual({ sx: 0, sy: 0, side: 400 })
    expect(cropRectFor(403, 400)).toEqual({ sx: 1, sy: 0, side: 400 })
  })
})
