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
import { cleanup, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, test, vi } from 'vitest'
import { Dialog } from '#/components/ui/dialog.tsx'
import { SettingsDialog } from './settings-dialog.tsx'

// Both tabs reach Convex for settings this file has no opinion about. Their
// contents are notifications-tab's business; what is under test is the dialog
// chrome around them.
vi.mock('./notifications-tab.tsx', () => ({ default: () => null }))
vi.mock('./install-guide-tab.tsx', () => ({ default: () => null }))

afterEach(cleanup)

/** DialogContent needs a Dialog root for Radix's context, and an open one. */
const mount = (email?: string | null, displayName?: string | null) =>
  render(
    createElement(
      Dialog,
      { open: true },
      createElement(SettingsDialog, { defaultTab: 'notifications', email, displayName }),
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

  test('both tabs are still reachable — the row did not displace them', () => {
    // It was inserted above the Tabs, so a bad edit could land inside TabsList.
    mount('ada@example.com')
    expect(screen.queryByRole('tab', { name: 'Notifications' })).not.toBeNull()
    expect(screen.queryByRole('tab', { name: 'Install Guide' })).not.toBeNull()
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
