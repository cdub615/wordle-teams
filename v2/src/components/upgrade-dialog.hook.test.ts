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
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'
import { PRO_BENEFITS } from '#/lib/pro-benefits.ts'
import { MONTHLY_FINE_PRINT, PRO_PRICE_LINE, UPGRADE_HEADLINES } from '#/lib/plans.ts'
import type { UpgradeOrigin } from '#/lib/plans.ts'

const startUpgrade = vi.fn()
/**
 * Set per test, read by the mocked hook below — the `let` reset in `beforeEach`
 * that Header.hook.test.ts uses for `isPro` and friends.
 *
 * IT IS A BINDING RATHER THAN A CONSTANT `false` BECAUSE THE PENDING BRANCH IS
 * NOT DECORATION. This CTA owns the checkout round trip Header.tsx's Upgrade
 * button used to own, spinner and disabled window included, so the state it is
 * in while Polar is being asked for a URL is the only progress signal the
 * player gets. Hard-coding `false` here leaves that branch unrendered by any
 * test in the repo.
 */
let pending: boolean

vi.mock('#/lib/use-start-upgrade.ts', () => ({
  useStartUpgrade: () => ({ startUpgrade, pending }),
}))

const { UpgradeDialogProvider, useUpgrade } = await import('./upgrade-dialog.tsx')

beforeEach(() => {
  pending = false
})

afterEach(() => {
  cleanup()
  startUpgrade.mockClear()
})

/** A consumer that opens the dialog from a given origin on click. */
function Opener({ origin }: { origin: UpgradeOrigin }) {
  const { openUpgrade } = useUpgrade()
  return createElement('button', { onClick: () => openUpgrade(origin) }, 'open')
}

/**
 * Several origins, each its own button, against ONE provider mount — the shape
 * production actually has. See the re-open test below for why that matters.
 */
function Openers({ origins }: { origins: ReadonlyArray<UpgradeOrigin> }) {
  const { openUpgrade } = useUpgrade()
  return createElement(
    'div',
    null,
    ...origins.map((origin) =>
      createElement('button', { key: origin, onClick: () => openUpgrade(origin) }, `open ${origin}`),
    ),
  )
}

const open = (origin: UpgradeOrigin) => {
  render(createElement(UpgradeDialogProvider, null, createElement(Opener, { origin })))
  fireEvent.click(screen.getByText('open'))
}

const cta = () => screen.getByRole('button', { name: 'Upgrade' }) as HTMLButtonElement

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
   * THE SECOND OPEN, WHICH IS THE ONLY SHAPE PRODUCTION HAS. routes/__root.tsx
   * mounts this provider once for the whole session, so every open after a
   * player's first is a re-open against state that already holds an origin —
   * and every other test in this file renders a fresh provider, opens once and
   * tears down, which is the one arrangement that cannot see a stale origin.
   *
   * THE MUTANT THIS KILLS: making the origin sticky after the first open (an
   * `openUpgrade` that only sets it when the state is null, say, which is an
   * easy thing to write while adding a guard). Everything else in this file
   * still passed. A player who opened from the header, dismissed, then tapped
   * the import upsell would be shown the header's headline — six headlines
   * silently collapsed into whichever one was asked for first.
   */
  test('re-opens with the new origin on a provider that is already mounted', () => {
    render(
      createElement(
        UpgradeDialogProvider,
        null,
        createElement(Openers, { origins: ['header', 'import'] }),
      ),
    )

    fireEvent.click(screen.getByText('open header'))
    expect(screen.getByText(UPGRADE_HEADLINES.header)).toBeTruthy()

    fireEvent.click(screen.getByRole('button', { name: 'Not now' }))
    fireEvent.click(screen.getByText('open import'))
    expect(screen.getByText(UPGRADE_HEADLINES.import)).toBeTruthy()
    expect(screen.queryByText(UPGRADE_HEADLINES.header)).toBeNull()
  })

  /**
   * THE DRIFT GATE, AND THE REASON THIS WORK EXISTS. A sixth entry added to
   * PRO_BENEFITS fails here until the dialog names it, which is what stops the
   * product growing a feature its own paywall never mentions.
   *
   * TITLE AND BODY, BOTH. Asserting titles alone left the gate guarding half the
   * copy: deleting the body paragraph from the list item — five bare headings,
   * nothing explaining any of them — passed all seven of the tests this file
   * shipped with. The body sentence is the part that says what the feature
   * actually does, so it is the part a paywall cannot be allowed to drop.
   */
  test('names every benefit in the inventory, whatever the origin', () => {
    open('header')
    for (const benefit of PRO_BENEFITS) {
      expect(screen.getByText(benefit.title)).toBeTruthy()
      expect(screen.getByText(benefit.body)).toBeTruthy()
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
   *
   * ASSERTED STRUCTURALLY, NOT AS A CLASS LIST. This used to pin `text-xs` and
   * `text-muted-foreground` on the fine print, which is the same coupling the
   * CTA's own comment rejects for `.animate-spin`: a palette or type-scale
   * change breaks it without changing anything a reader can tell, and it says
   * nothing about which line is the pitch. What actually makes annual lead is
   * that it IS the dialog's description — the line Radix points
   * `aria-describedby` at, directly under the title — and that monthly comes
   * after it in the document and is not that line. Promote monthly to the
   * description, or move it above the benefits, and this fails.
   */
  test('leads with annual by placement, not only by wording', () => {
    open('header')
    const describedBy = screen.getByRole('dialog').getAttribute('aria-describedby')
    const description = screen.getByText(PRO_PRICE_LINE)
    const finePrint = screen.getByText(MONTHLY_FINE_PRINT)

    expect(description.id).toBe(describedBy)
    expect(finePrint.id).not.toBe(describedBy)
    expect(
      Boolean(description.compareDocumentPosition(finePrint) & Node.DOCUMENT_POSITION_FOLLOWING),
    ).toBe(true)
  })

  test('the CTA reaches the one checkout path', () => {
    open('insights')
    fireEvent.click(cta())
    expect(startUpgrade).toHaveBeenCalledTimes(1)
  })

  /**
   * THE ROUND TRIP IS ANNOUNCED, NOT JUST DRAWN. Header.hook.test.ts makes the
   * same assertion about the button this one replaces — "a button that stays
   * stuck pending is the same dead end as one that says nothing".
   *
   * `aria-busy` AND A RENDERED ICON, NOT `.animate-spin`:
   * settings/security-tab.hook.test.ts argues that pinning the Tailwind class
   * couples the suite to a styling choice and asserts on the half a screen
   * reader cannot perceive. The icon is still checked for presence, because the
   * CTA renders NO icon at rest — so `svg` here means "the spinner arrived"
   * whatever spinner it is, and the idle half of this test is what makes that
   * true rather than assumed.
   */
  test('a checkout already in flight disables the CTA and says it is busy', () => {
    open('header')
    expect(cta().disabled).toBe(false)
    expect(cta().getAttribute('aria-busy')).toBe('false')
    expect(cta().querySelector('svg')).toBeNull()

    cleanup()
    pending = true
    open('header')
    expect(cta().disabled).toBe(true)
    expect(cta().getAttribute('aria-busy')).toBe('true')
    expect(cta().querySelector('svg')).not.toBeNull()
  })

  /**
   * A CONSUMER WITH NO PROVIDER ABOVE IT, which is a wiring mistake nothing
   * else can catch. The throw is this file's most-argued line and has the worst
   * failure mode if it is ever softened to a no-op default: an upgrade button
   * that is mounted, styled, focusable, and opens nothing — indistinguishable
   * from a working one until someone tries to pay. Replacing the throw with
   * `return { openUpgrade: () => {} }` passed every other test here.
   */
  test('a consumer outside the provider fails loudly', () => {
    // React 19 logs a render error through console.error before it rethrows,
    // and the throw IS the expected outcome — so the log is noise from a
    // passing test. Spied and restored, as server.test.ts and
    // settings/notifications-tab.hook.test.ts do for their own expected warns.
    const error = vi.spyOn(console, 'error').mockImplementation(() => {})
    try {
      expect(() => render(createElement(Opener, { origin: 'header' }))).toThrow(
        /UpgradeDialogProvider/,
      )
    } finally {
      error.mockRestore()
    }
  })
})

/**
 * FOUR WAYS OUT, AND THREE OF THEM WERE UNPINNED. Deleting `onOpenChange` from
 * the Dialog kills Escape, the click on the overlay and DialogContent's own X
 * button in one line — leaving only the "Not now" button, which was the only
 * one this file used to exercise, so all eight tests passed. The X is the
 * affordance most players reach for, and Escape is the one a keyboard user has.
 *
 * NOT THE OVERLAY CLICK, and that is a limitation rather than a decision:
 * Radix closes on a pointerdown sequence outside the content, which
 * fireEvent's synthetic events do not reproduce faithfully in jsdom. It shares
 * the single `onOpenChange` with these two, so it is covered in the only sense
 * that matters to the mutant above — but a Radix upgrade that changed the
 * outside-click behaviour alone would not be caught here.
 */
describe('dismissing the dialog', () => {
  const dismissals: ReadonlyArray<readonly [string, () => void]> = [
    ['the Not now button', () => fireEvent.click(screen.getByRole('button', { name: 'Not now' }))],
    ['the X in the corner', () => fireEvent.click(screen.getByRole('button', { name: 'Close' }))],
    ['Escape', () => fireEvent.keyDown(screen.getByRole('dialog'), { key: 'Escape' })],
  ]

  for (const [name, dismiss] of dismissals) {
    test(`${name} closes it, and starts no checkout`, () => {
      open('teams')
      expect(screen.getByText(UPGRADE_HEADLINES.teams)).toBeTruthy()

      dismiss()

      expect(screen.queryByText(UPGRADE_HEADLINES.teams)).toBeNull()
      expect(startUpgrade).not.toHaveBeenCalled()
    })
  }
})
