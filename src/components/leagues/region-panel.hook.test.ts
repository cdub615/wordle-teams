// @vitest-environment jsdom
//
// The region page's own panel (v2b): placement is automatic, so it replaces
// the join, switch and leave controls with what the player can see and do.
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react'
import { createElement } from 'react'
import { afterEach, describe, expect, test, vi } from 'vitest'
import { RegionPanel } from './region-panel.tsx'

afterEach(cleanup)

const central = { _id: 'r1', name: 'US Central' }
const placed = { state: 'placed' as const, group: central, countsFrom: '2026-10-01', next: null }

const show = (overrides: Partial<Parameters<typeof RegionPanel>[0]> = {}) => {
  const props = { status: placed, today: '2026-10-09', busy: false, onLeave: vi.fn(), onRejoin: vi.fn(), ...overrides }
  render(createElement(RegionPanel, props))
  return props
}
const panel = () => screen.getByRole('region', { name: 'Your region' })

describe('RegionPanel', () => {
  test('loading: a one-line skeleton under the heading, and no status', () => {
    show({ status: undefined })
    expect(within(panel()).getByRole('heading', { level: 2 }).textContent).toBe('Your region')
    expect(panel().querySelector('[aria-busy="true"]')).toBeTruthy()
    expect(screen.queryByTestId('region-status')).toBeNull()
    expect(screen.queryByRole('button')).toBeNull()
  })

  test('placed: the region, why, when a change applies, and an outlined Leave region', () => {
    const { onLeave } = show()
    expect(screen.getByTestId('region-status').textContent).toBe('You’re in US Central, based on your time zone.')
    expect(within(screen.getByTestId('region-status')).getByText('US Central').tagName).toBe('STRONG')
    expect(screen.getByText('A time-zone change moves you from next month.')).toBeTruthy()
    // Counting since the 1st, and not moving: neither optional line.
    expect(screen.queryByText(/Your boards count from/)).toBeNull()
    expect(screen.queryByText(/Moving to/)).toBeNull()
    const leave = screen.getByRole('button', { name: 'Leave region' }) as HTMLButtonElement
    expect(leave.className).toContain('border-input')
    fireEvent.click(leave)
    expect(onLeave).toHaveBeenCalledTimes(1)
  })

  test('placed, counting from a later day: names it, even in next month', () => {
    show({ status: { ...placed, countsFrom: '2026-10-10' } })
    expect(screen.getByText('Your boards count from October 10.')).toBeTruthy()
    cleanup()
    // A rejoin on the last day counts from the 1st of next month.
    show({ today: '2026-10-31', status: { ...placed, countsFrom: '2026-11-01' } })
    expect(screen.getByText('Your boards count from November 1.')).toBeTruthy()
    cleanup()
    // Counting from TODAY has started.
    show({ status: { ...placed, countsFrom: '2026-10-09' } })
    expect(screen.queryByText(/Your boards count from/)).toBeNull()
  })

  test('placed, sticky in a region the zone no longer maps to: names the move', () => {
    show({ status: { ...placed, next: { _id: 'r2', name: 'US Eastern', from: '2026-11-01' } } })
    expect(screen.getByText('Moving to US Eastern on November 1.')).toBeTruthy()
  })

  test('opted out: says so, with Rejoin and when it counts', () => {
    const { onRejoin } = show({ status: { state: 'opted-out' } })
    expect(screen.getByTestId('region-status').textContent).toBe('You’ve left the region league.')
    expect(screen.getByText('Your boards count from tomorrow.')).toBeTruthy()
    expect(screen.queryByRole('button', { name: 'Leave region' })).toBeNull()
    fireEvent.click(screen.getByRole('button', { name: 'Rejoin' }))
    expect(onRejoin).toHaveBeenCalledTimes(1)
  })

  test('no time zone: says where to set one, as text (Settings has no route)', () => {
    show({ status: { state: 'no-time-zone' } })
    expect(screen.getByTestId('region-status').textContent).toBe('Set your time zone to join your region: Settings → Alerts → Time Zone.')
    expect(screen.queryByRole('link')).toBeNull()
    expect(screen.queryByRole('button')).toBeNull()
  })

  test('unmapped: names the zone', () => {
    show({ status: { state: 'unmapped', timeZone: 'UTC' } })
    expect(screen.getByTestId('region-status').textContent).toBe('Your time zone (UTC) isn’t part of a region yet.')
    expect(screen.queryByRole('button')).toBeNull()
  })

  test('busy disables Leave region and Rejoin', () => {
    show({ busy: true })
    expect((screen.getByRole('button', { name: 'Leave region' }) as HTMLButtonElement).disabled).toBe(true)
    cleanup()
    show({ busy: true, status: { state: 'opted-out' } })
    expect((screen.getByRole('button', { name: 'Rejoin' }) as HTMLButtonElement).disabled).toBe(true)
  })
})
