// @vitest-environment jsdom
//
// A SECOND FILE FOR ONE COMPONENT, BECAUSE THE MOCK BOUNDARY IS THE SUBJECT.
//
// upgrade-dialog.hook.test.ts mocks `#/lib/use-start-upgrade.ts` wholesale —
// deliberately, and correctly for what it asserts: what the dialog SAYS, and
// that the CTA reaches the one checkout path. But `vi.mock` is file-scoped and
// hoisted above everything, so in that file `startUpgrade` is a `vi.fn()` that
// resolves nothing and navigates nowhere. The defect below is that a dismissed
// dialog still lands the player on Polar's checkout, and a file whose hook
// cannot navigate cannot observe a navigation it should not have made. No
// assertion added there could have failed.
//
// So this file mocks one layer lower — `useConvexAction` and `sonner`, the way
// Header.hook.test.ts and use-start-upgrade.hook.test.ts both do — and lets the
// REAL hook run inside the REAL provider. That is the whole point: what is
// under test here is not the dialog and not the hook but the seam between
// them, which is where the defect lived. Either half mocked out and the test is
// green against the bug.
//
// WHY NOT ADD IT TO Header.hook.test.ts, which already runs the real hook
// through the real dialog. Two reasons. Its scope is the bar — the Upgrade
// slot's three isPro states and the invite badge beside it — and dismissal
// belongs to the dialog, not to the button that opened it. And the re-open
// symptom below needs two DIFFERENT origins against one provider, which the
// header cannot produce: it has exactly one upgrade affordance.
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { getFunctionName, type FunctionReference } from 'convex/server'
import { createElement } from 'react'
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'
import { api } from '../../convex/_generated/api'
import { UPGRADE_HEADLINES } from '#/lib/plans.ts'
import type { UpgradeOrigin } from '#/lib/plans.ts'
import type { CheckoutResult } from '../../convex/polar.ts'

const { createCheckout, toastInfo, toastError } = vi.hoisted(() => ({
  createCheckout: vi.fn(),
  toastInfo: vi.fn(),
  toastError: vi.fn(),
}))

// Keyed by the action's own name, for the reason Header.hook.test.ts spells
// out: both polar actions are zero-argument and answer the same url-or-reason
// shape, so pointing this tree at the portal instead would type-check.
vi.mock('@convex-dev/react-query', () => ({
  useConvexAction: (ref: FunctionReference<'action'>) => {
    const name = getFunctionName(ref)
    if (name === getFunctionName(api.polar.createProCheckout)) return createCheckout
    throw new Error(`the upgrade dialog asked for an unexpected action: ${name}`)
  },
}))

vi.mock('sonner', () => ({ toast: { info: toastInfo, error: toastError } }))

const { UpgradeDialogProvider, useUpgrade } = await import('./upgrade-dialog.tsx')

/**
 * jsdom refuses a real navigation ("Not implemented: navigation to another
 * Document") and leaves `location.href` untouched, so the assignment has to
 * land somewhere observable — the same plain-object stub
 * use-start-upgrade.hook.test.ts uses.
 */
const HERE = 'http://localhost:3000/app'
let location: { href: string }

beforeEach(() => {
  location = { href: HERE }
  vi.stubGlobal('location', location)
  createCheckout.mockReset()
  toastInfo.mockClear()
  toastError.mockClear()
})

afterEach(() => {
  cleanup()
  vi.unstubAllGlobals()
})

/** Two origins, one provider — the shape routes/__root.tsx actually mounts. */
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

const mountProvider = (origins: ReadonlyArray<UpgradeOrigin>) =>
  render(createElement(UpgradeDialogProvider, null, createElement(Openers, { origins })))

const openFrom = (origin: UpgradeOrigin) =>
  fireEvent.click(screen.getByText(`open ${origin}`))

const cta = () => screen.getByRole('button', { name: 'Upgrade' }) as HTMLButtonElement

/**
 * Arms `createCheckout` with a promise this test settles by hand, and hands
 * back both settlers — the shape Header.hook.test.ts's "disabled for the round
 * trip" test uses. A checkout that never answers on its own is the only way to
 * hold the dialog in its pending state long enough to dismiss it.
 *
 * BOTH SETTLERS, because the hook has two places a late answer can arrive and
 * they are guarded separately: an answer that RESOLVES lands after the `await`
 * in the try, and a transport failure or a typed ConvexError lands in the
 * catch. A test that only ever resolves leaves the catch's guard unpinned —
 * measured, not assumed: deleting it kept every other test in this file green.
 */
const heldCheckout = () => {
  let settle: { answer: (result: CheckoutResult) => void; fail: (error: unknown) => void } = {
    answer: () => {},
    fail: () => {},
  }
  createCheckout.mockReturnValue(
    new Promise<CheckoutResult>((resolve, reject) => {
      settle = { answer: resolve, fail: reject }
    }),
  )
  // act-wrapped: settling flips `pending` back, and React warns about a state
  // update outside act.
  return {
    answer: async (result: CheckoutResult) => {
      await act(async () => {
        settle.answer(result)
      })
    },
    fail: async (error: unknown) => {
      await act(async () => {
        settle.fail(error)
      })
    },
  }
}

/**
 * THE FOUR WAYS OUT ARE ONE SEAM, AND THREE OF THEM GO THROUGH `onOpenChange`.
 * Parameterised for the mutant that wires cancellation into the "Not now"
 * handler only: the X is the affordance most players reach for and Escape is
 * the one a keyboard user has, and both would still navigate.
 *
 * The overlay click is absent here for the reason
 * upgrade-dialog.hook.test.ts's own dismissal block records: Radix closes on a
 * pointerdown sequence outside the content that fireEvent's synthetic events do
 * not reproduce faithfully in jsdom. It shares the single `onOpenChange` with
 * Escape and the X, so it is covered in the sense that matters to the mutant.
 */
const dismissals: ReadonlyArray<readonly [string, () => void]> = [
  ['the Not now button', () => fireEvent.click(screen.getByRole('button', { name: 'Not now' }))],
  ['the X in the corner', () => fireEvent.click(screen.getByRole('button', { name: 'Close' }))],
  ['Escape', () => fireEvent.keyDown(screen.getByRole('dialog'), { key: 'Escape' })],
]

describe('dismissing the dialog abandons the checkout it started', () => {
  /**
   * THE EPIC'S THESIS, INVERTED. wordle-teams-iht.1 exists so that nobody lands
   * on Polar's checkout uninformed. Before this, the surface built for that
   * landed them there after they had explicitly DECLINED: none of the four
   * exits was closed while a checkout was in flight, `onClose` flipped only
   * `open` so the hook stayed mounted with its promise alive, and when Polar
   * finally answered `window.location.href = outcome.url` ran regardless. The
   * player was on a payment page they had just said no to.
   */
  for (const [name, dismiss] of dismissals) {
    test(`${name} leaves the player where they are, whatever Polar answers`, async () => {
      const checkout = heldCheckout()
      mountProvider(['header'])
      openFrom('header')

      fireEvent.click(cta())
      await waitFor(() => expect(cta().getAttribute('aria-busy')).toBe('true'))

      dismiss()
      await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull())

      await checkout.answer({ url: 'https://polar.example/checkout/abc' })

      expect(location.href).toBe(HERE)
    })
  }

  /**
   * AND IT SAYS NOTHING EITHER. A failure toast for a checkout the player
   * walked away from is noise about a thing they abandoned — and in the
   * `not-configured` case it is a sentence telling them the app is
   * misconfigured, raised over whatever they went on to do instead.
   */
  const lateFailures: ReadonlyArray<
    readonly [string, (checkout: ReturnType<typeof heldCheckout>) => Promise<void>]
  > = [
    // A url-less answer: the action caught its own Polar error, or SITE_URL is
    // unset. Lands after the `await` in the hook's try.
    ['answers with a reason', (checkout) => checkout.answer({ url: null, reason: 'not-configured' })],
    // The action never answered at all — a dropped websocket, or the identity
    // query throwing. Lands in the hook's catch, which is a SEPARATE guard.
    ['never answers at all', (checkout) => checkout.fail(new Error('socket hang up'))],
  ]

  for (const [name, settle] of lateFailures) {
    test(`and a checkout that ${name} after the dismissal stays quiet`, async () => {
      const checkout = heldCheckout()
      mountProvider(['header'])
      openFrom('header')

      fireEvent.click(cta())
      await waitFor(() => expect(cta().getAttribute('aria-busy')).toBe('true'))

      fireEvent.click(screen.getByRole('button', { name: 'Not now' }))
      await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull())

      await settle(checkout)

      expect(toastError).not.toHaveBeenCalled()
      expect(toastInfo).not.toHaveBeenCalled()
    })
  }

  /**
   * THE SECOND SYMPTOM, SAME ROOT CAUSE. Dismissing does not unmount
   * UpgradeDialog — `state` stays non-null so the origin survives the exit
   * animation — so the hook instance, and its `pending`, outlive the close. Open
   * from the header, start a checkout that never settles, dismiss it, then tap
   * the import upsell: the new dialog's CTA renders disabled and
   * `aria-busy="true"` for a request the player believes they abandoned. There
   * is no way out of that except waiting on a promise nobody is waiting for.
   *
   * THIS IS WHY A FIX THAT ONLY RESETS `pending` WHEN THE ORIGIN CHANGES IS NOT
   * ENOUGH: re-opening from the SAME origin has the identical symptom, which is
   * why the second half below re-opens from 'header'.
   */
  test('re-opening after a dismissal never arrives already busy', async () => {
    heldCheckout()
    mountProvider(['header', 'import'])
    openFrom('header')

    fireEvent.click(cta())
    await waitFor(() => expect(cta().getAttribute('aria-busy')).toBe('true'))

    fireEvent.click(screen.getByRole('button', { name: 'Not now' }))
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull())

    openFrom('import')
    expect(screen.getByText(UPGRADE_HEADLINES.import)).toBeTruthy()
    expect(cta().disabled).toBe(false)
    expect(cta().getAttribute('aria-busy')).toBe('false')

    fireEvent.click(screen.getByRole('button', { name: 'Not now' }))
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull())

    openFrom('header')
    expect(cta().disabled).toBe(false)
    expect(cta().getAttribute('aria-busy')).toBe('false')
  })

  /**
   * AND THE ABANDONMENT IS PER-ATTEMPT, WHICH IS THE OTHER HALF OF THE FIX.
   * A dismissed flag that is never cleared is a worse bug than the one being
   * fixed: the upgrade button would stay mounted, enabled, focusable and
   * spinner-free while quietly declining to take anybody's money for the rest
   * of the session — the exact "dead button indistinguishable from a working
   * one" failure use-start-upgrade.ts's banner and useUpgrade's throw are both
   * written against. Nothing else in the suite renders a SECOND attempt.
   */
  test('a fresh attempt after an abandoned one still reaches Polar', async () => {
    heldCheckout()
    mountProvider(['header'])
    openFrom('header')

    fireEvent.click(cta())
    await waitFor(() => expect(cta().getAttribute('aria-busy')).toBe('true'))
    fireEvent.click(screen.getByRole('button', { name: 'Not now' }))
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull())

    const checkout = heldCheckout()
    openFrom('header')
    fireEvent.click(cta())
    await checkout.answer({ url: 'https://polar.example/checkout/second' })

    expect(location.href).toBe('https://polar.example/checkout/second')
  })
})
