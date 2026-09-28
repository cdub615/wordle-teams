// @vitest-environment jsdom
//
// jsdom rather than the suite's default edge-runtime, because this renders the
// real dialog. `.hook.test.ts` and `createElement` by hand for the reasons
// app-menu.hook.test.ts spells out at its top.
//
// WHY IT EXISTS: app-menu.hook.test.ts MOCKS THIS COMPONENT OUT ENTIRELY
// (`SettingsDialog: () => null`), so nothing in the suite renders it. The
// "Signed in as" row added for wordle-teams-7jpo would therefore have had no
// coverage at all — the half of that change nobody would notice breaking.
import { createElement } from 'react'
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, test, vi } from 'vitest'
import { Dialog } from '#/components/ui/dialog.tsx'
import { SettingsDialog } from './settings-dialog.tsx'

// Every tab reaches Convex or Better Auth for settings this file has no
// opinion about. Their contents are their own files' business; what is under
// test is the dialog chrome around them.
//
// PROFILE JOINED THE LIST WHEN `defaultTab` WENT AWAY (wordle-teams-mwu0).
// Radix mounts only the ACTIVE panel, and this file used to mount on
// 'notifications', so ProfileTab never rendered here and never needed a stub.
// Now that the dialog opens on Profile itself, the real one runs `useQuery` on
// mount and throws "No QueryClient set" before a single assertion executes.
vi.mock('./profile-tab.tsx', () => ({ default: () => null }))
vi.mock('./notifications-tab.tsx', () => ({ default: () => null }))
vi.mock('./install-guide-tab.tsx', () => ({ default: () => null }))
// Security reaches Better Auth for the passkey list. Its own behaviour is
// pinned in security-tab.hook.test.ts; what is under test here is only that the
// dialog gives it a trigger and a panel, in the right place.
vi.mock('./security-tab.tsx', () => ({ default: () => null }))

afterEach(cleanup)

/** DialogContent needs a Dialog root for Radix's context, and an open one. */
const mount = (email?: string | null, displayName?: string | null) =>
  render(
    createElement(
      Dialog,
      { open: true },
      createElement(SettingsDialog, { email, displayName }),
    ),
  )

describe('the dialog says which account this is (wordle-teams-7jpo)', () => {
  test('the address is shown, and is selectable so it can be compared', () => {
    mount('ada@example.com')
    const shown = screen.queryByText('ada@example.com')
    expect(shown).not.toBeNull()
    // `select-text` is the point rather than styling: the whole reason to show
    // an address is that someone can read it against another one.
    expect(shown?.className).toContain('select-text')
  })

  test('the row names what it is showing, not just the value', () => {
    // A bare address in a settings dialog is ambiguous — it could be a
    // reminder recipient, which is what the tab below it is about.
    mount('ada@example.com')
    expect(screen.queryByText(/Signed in as/)).not.toBeNull()
  })

  test('NOTHING is rendered when the address has not loaded', () => {
    /**
     * THE MUTATION THIS KILLS: dropping the `email &&` guard. app-menu.tsx
     * reads this from a query that is briefly undefined on a cold load, and an
     * unguarded render produces the row with nothing after "Signed in as" —
     * which reads as a broken account rather than a loading one.
     */
    mount(undefined)
    expect(screen.queryByText(/Signed in as/)).toBeNull()
  })

  test('the identity row sits ABOVE the strip, not inside it', () => {
    /**
     * It was inserted immediately above the Tabs, so a bad edit could land it
     * inside TabsList — where it would render as a stray line wedged between
     * the triggers and, worse, would be read out as part of the tab list.
     *
     * ASSERTED AGAINST THE TABLIST ELEMENT RATHER THAN AGAINST TWO TAB NAMES,
     * which is what this test used to do. Naming two tabs answered "are these
     * two still here", a question the four-tab order test below already answers
     * properly, and it answered nothing at all about WHERE the row went — the
     * row could have been dropped inside TabsList and both lookups would still
     * have found their triggers.
     */
    mount('ada@example.com')
    const tablist = screen.getByRole('tablist')
    const row = screen.getByText(/Signed in as/)
    expect(tablist.contains(row)).toBe(false)
    // DOCUMENT_POSITION_FOLLOWING === 4: the tablist comes after the row.
    expect(row.compareDocumentPosition(tablist) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy()
  })
})

describe('the four-tab strip (wordle-teams-wty4.1.7)', () => {
  test('all four triggers are present, in order', () => {
    /**
     * READ OFF THE REAL ELEMENTS AND COMPARED AS A WHOLE LIST, rather than by
     * looking up two anchors and comparing indices. An index comparison answers
     * -1 for a trigger that has been renamed or removed, and -1 sorts before
     * everything — so that shape of assertion passes hardest exactly when the
     * thing it guards has been deleted. This one gets shorter, or reorders, and
     * fails either way.
     *
     * THE ORDER IS THE POINT, not just the membership. Security sits between
     * Alerts and Install: the strip runs from what a visitor came for towards
     * what they will read once, and a tab that DOES something does not belong
     * after static copy.
     *
     * 'Alerts', NOT 'Notifications' (wordle-teams-wty4.1.7.7). The label is the
     * measured fix for a strip that overflowed the dialog at every phone width
     * — settings-dialog.tsx carries the table. This assertion is what stops it
     * drifting back to a longer word that silently re-breaks the layout, since
     * no gate measures rendered width.
     */
    mount('ada@example.com')
    const names = screen.getAllByRole('tab').map((tab) => tab.textContent)
    expect(names).toEqual(['Profile', 'Alerts', 'Security', 'Install'])
  })

  test('a fresh open lands on Profile, and the dialog decides that itself', () => {
    /**
     * THE PLUMBING THIS REPLACES (wordle-teams-mwu0). Which tab an open landed
     * on used to be a required `defaultTab` prop, and e2e proved it by opening
     * the dialog through two different menu items. Those items are gone — one
     * "Settings" item opens it now — so the choice moved in here, and nothing
     * outside this file would notice it changing: swap `defaultValue` to
     * "install" and every other test in the suite stays green while every
     * player lands on static copy instead of their own profile.
     *
     * ASSERTED ON `aria-selected` OF A NAMED TRIGGER rather than on whichever
     * tab happens to be first, so it fails if the DEFAULT moves as well as if
     * the ORDER does.
     */
    mount('ada@example.com')
    expect(screen.getByRole('tab', { name: 'Profile' }).getAttribute('aria-selected')).toBe('true')
    expect(screen.getByRole('tab', { name: 'Alerts' }).getAttribute('aria-selected')).toBe('false')
  })

  test('Security has a panel of its own, not just a trigger', () => {
    // A TabsTrigger with no matching TabsContent is a tab that visibly
    // highlights and shows nothing — and it type-checks, because the `value`
    // pairing is a runtime string on both sides.
    mount('ada@example.com')
    const trigger = screen.getByRole('tab', { name: 'Security' })
    // `mouseDown`, NOT `click` — measured, not guessed: Radix's TabsTrigger
    // switches tabs on mousedown (so the panel is already up by the time the
    // button comes back up), and a `click` alone leaves aria-selected="false".
    fireEvent.mouseDown(trigger, { button: 0 })
    expect(trigger.getAttribute('aria-selected')).toBe('true')
    const panelId = trigger.getAttribute('aria-controls')
    expect(panelId).not.toBeNull()
    expect(document.getElementById(panelId as string)).not.toBeNull()
  })
})

describe('the name sits above the address', () => {
  test('both are shown, name first', () => {
    // Order matters: an address alone at the top of a settings dialog reads as
    // a stray field. The pair reads as an identity.
    mount('ada@example.com', 'Ada Lovelace')
    const name = screen.getByText('Ada Lovelace')
    const address = screen.getByText('ada@example.com')
    expect(name).not.toBeNull()
    expect(address).not.toBeNull()
    // DOCUMENT_POSITION_FOLLOWING === 4: `address` comes after `name`.
    expect(name.compareDocumentPosition(address) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy()
  })

  test('the address still shows on its own when there is no name yet', () => {
    // A cold load resolves the two queries independently, and the address is
    // the half that matters — suppressing it while waiting for a name would
    // hide the thing this feature exists for.
    mount('ada@example.com', undefined)
    expect(screen.queryByText('ada@example.com')).not.toBeNull()
  })

  test('the name is NOT repeated when it has fallen back to the address', () => {
    /**
     * THE MUTATION THIS KILLS: dropping `displayName !== email`. app-menu.tsx's
     * displayName falls back to the email for an account with no name at all,
     * so without the guard that player sees the same string stacked twice —
     * once as a name, once as the address. The menu carries the identical
     * guard for the identical reason.
     */
    mount('ada@example.com', 'ada@example.com')
    expect(screen.queryAllByText('ada@example.com')).toHaveLength(1)
  })
})
