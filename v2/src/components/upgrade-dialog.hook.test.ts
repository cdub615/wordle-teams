// @vitest-environment jsdom
//
// jsdom and `.hook.test.ts` with createElement, matching every other component
// test here — vitest.config.ts's glob is `src/**/*.test.ts`, so .tsx would not run.
//
// useStartUpgrade is mocked because it calls useConvexAction, which needs a
// provider this test has no reason to stand up: what is under test is what the
// dialog SAYS and that the CTA reaches the one checkout path, not the checkout
// itself, which use-start-upgrade.ts already owns.
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { createElement } from 'react'
import { afterEach, describe, expect, test, vi } from 'vitest'
import { PRO_BENEFITS } from '#/lib/pro-benefits.ts'
import { MONTHLY_FINE_PRINT, PRO_PRICE_LINE, UPGRADE_HEADLINES } from '#/lib/plans.ts'
import type { UpgradeOrigin } from '#/lib/plans.ts'

const startUpgrade = vi.fn()
vi.mock('#/lib/use-start-upgrade.ts', () => ({
  useStartUpgrade: () => ({ startUpgrade, pending: false }),
}))

const { UpgradeDialogProvider, useUpgrade } = await import('./upgrade-dialog.tsx')

afterEach(() => {
  cleanup()
  startUpgrade.mockClear()
})

/** A consumer that opens the dialog from a given origin on click. */
function Opener({ origin }: { origin: UpgradeOrigin }) {
  const { openUpgrade } = useUpgrade()
  return createElement('button', { onClick: () => openUpgrade(origin) }, 'open')
}

const open = (origin: UpgradeOrigin) => {
  render(createElement(UpgradeDialogProvider, null, createElement(Opener, { origin })))
  fireEvent.click(screen.getByText('open'))
}

describe('the upgrade dialog', () => {
  test('opens with the headline for the origin it was asked from', () => {
    open('import')
    expect(screen.getByText(UPGRADE_HEADLINES.import)).toBeTruthy()
  })

  test('has a headline for every origin, and renders it', () => {
    for (const origin of Object.keys(UPGRADE_HEADLINES) as UpgradeOrigin[]) {
      open(origin)
      expect(screen.getByText(UPGRADE_HEADLINES[origin])).toBeTruthy()
      cleanup()
    }
  })

  /**
   * THE DRIFT GATE, AND THE REASON THIS WORK EXISTS. A sixth entry added to
   * PRO_BENEFITS fails here until the dialog names it, which is what stops the
   * product growing a feature its own paywall never mentions.
   */
  test('names every benefit in the inventory, whatever the origin', () => {
    open('header')
    for (const benefit of PRO_BENEFITS) {
      expect(screen.getByText(benefit.title)).toBeTruthy()
    }
  })

  test('leads with the annual price and carries monthly as fine print', () => {
    open('header')
    expect(screen.getByText(PRO_PRICE_LINE)).toBeTruthy()
    expect(screen.getByText(MONTHLY_FINE_PRINT)).toBeTruthy()
  })

  /**
   * PROMINENCE, NOT WORDING, IS WHERE "MONTHLY IS NEVER THE BETTER VALUE" LIVES
   * (added after Task 1's review). plans.test.ts can only pin the two strings;
   * whether monthly reads as the pitch is a question of where each one sits.
   * The annual line is the dialog's description — directly under the title —
   * and monthly is muted fine print in the footer.
   */
  test('leads with annual by placement, not only by wording', () => {
    open('header')
    const description = screen.getByText(PRO_PRICE_LINE)
    const finePrint = screen.getByText(MONTHLY_FINE_PRINT)

    expect(description.id).toBe(
      screen.getByRole('dialog').getAttribute('aria-describedby'),
    )
    expect(finePrint.className).toContain('text-muted-foreground')
    expect(finePrint.className).toContain('text-xs')
  })

  test('the CTA reaches the one checkout path', () => {
    open('insights')
    fireEvent.click(screen.getByRole('button', { name: 'Upgrade' }))
    expect(startUpgrade).toHaveBeenCalledTimes(1)
  })

  test('dismissing it starts no checkout', () => {
    open('teams')
    fireEvent.click(screen.getByRole('button', { name: 'Not now' }))
    expect(startUpgrade).not.toHaveBeenCalled()
    expect(screen.queryByText(UPGRADE_HEADLINES.teams)).toBeNull()
  })
})
