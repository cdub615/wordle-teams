// @vitest-environment jsdom
import { createElement } from 'react'
import { afterEach, describe, expect, test, vi } from 'vitest'
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'

vi.mock('@tanstack/react-router', () => ({
  Link: ({ to, params, children, ...rest }: { to: string; params?: { slug: string }; children: unknown }) =>
    createElement('a', { href: params ? to.replace('$slug', params.slug) : to, ...rest }, children as never),
}))

import { LeaguesCard, leaguesCardInput, pickerCouldShow } from './leagues-card.tsx'

afterEach(cleanup)

const featured = {
  leagueId: 'L1',
  slug: 'fixed-five',
  name: 'Fixed Five',
  featured: true,
  groupSource: 'fixed' as const,
  groups: ['CRANE', 'SLATE'].map((name, i) => ({ _id: `g${i}`, slug: name.toLowerCase(), name, memberCount: 0 })),
}
/** A featured WORD league, as leaguesFor sends it: groups are the popular quick picks. */
const wordLeague = { ...featured, leagueId: 'SW', slug: 'starting-words', name: 'Starting Words', groupSource: 'answer-words' as const }
const card = (props: Partial<Parameters<typeof LeaguesCard>[0]> = {}) =>
  render(createElement(LeaguesCard, { mine: [], featured: wordLeague, onJoin: vi.fn(), onJoinWord: vi.fn(), onDismiss: vi.fn(), busy: false, ...props }))
const wordBox = () => screen.getByRole('textbox', { name: 'Any Wordle answer word' }) as HTMLInputElement
const joinButton = () => screen.getByRole('button', { name: 'Join' }) as HTMLButtonElement
const row = (slug: string, rank: number | null) => ({
  kind: 'picked' as const,
  league: { slug, name: slug },
  leagueId: slug,
  group: { _id: 'g0', name: 'CRANE' },
  since: '2026-10-01',
  pending: null,
  rank,
  average: rank ? 3.8 : null,
  boards: 12,
})
/** The automatic region row (v2b), as myLeagues sends it: always LAST, after the picked rows. */
const regionRow = {
  kind: 'region' as const,
  league: { slug: 'regions', name: 'Regions' },
  leagueId: 'R',
  group: { _id: 'rg0', name: 'US Central' },
  since: '2026-10-01',
  pending: null,
  rank: 4,
  average: 4.1,
  boards: 3,
}

describe('LeaguesCard', () => {
  test('not in a league: offers the featured league inline', () => {
    const onJoin = vi.fn()
    render(createElement(LeaguesCard, { mine: [], featured, onJoin, onJoinWord: vi.fn(), onDismiss: vi.fn(), busy: false }))
    expect(screen.getByRole('heading', { name: 'Join the opener wars' })).toBeTruthy()
    expect(screen.getByText('Pick a side — your boards count whatever word you start with.')).toBeTruthy()
    expect(screen.getByRole('group', { name: 'Choose a group' })).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: 'SLATE' }))
    expect(onJoin).toHaveBeenCalledWith('g1')
  })
  test('the offer is dismissible: "Not now" calls onDismiss and joins nothing', () => {
    // Owner decision 2026-10-08 (spec §8.4): joining was the only way to clear
    // the card, which suits nobody who doesn't open with one of the five words.
    const onJoin = vi.fn()
    const onDismiss = vi.fn()
    render(createElement(LeaguesCard, { mine: [], featured, onJoin, onJoinWord: vi.fn(), onDismiss, busy: false }))
    fireEvent.click(screen.getByRole('button', { name: 'Not now' }))
    expect(onDismiss).toHaveBeenCalledTimes(1)
    expect(onJoin).not.toHaveBeenCalled()
  })
  test('a member\'s rows have no "Not now": there is no offer to dismiss', () => {
    render(createElement(LeaguesCard, { mine: [row('starting-words', 1)], featured: null, onJoin: vi.fn(), onJoinWord: vi.fn(), onDismiss: vi.fn(), busy: false }))
    expect(screen.queryByRole('button', { name: 'Not now' })).toBeNull()
  })
  test('busy disables the picker and "Not now"', () => {
    render(createElement(LeaguesCard, { mine: [], featured, onJoin: vi.fn(), onJoinWord: vi.fn(), onDismiss: vi.fn(), busy: true }))
    expect((screen.getByRole('button', { name: 'SLATE' }) as HTMLButtonElement).disabled).toBe(true)
    expect((screen.getByRole('button', { name: 'Not now' }) as HTMLButtonElement).disabled).toBe(true)
  })
  test('"Not now" is described by the offer it dismisses', () => {
    render(createElement(LeaguesCard, { mine: [], featured, onJoin: vi.fn(), onJoinWord: vi.fn(), onDismiss: vi.fn(), busy: false }))
    const describedBy = screen.getByRole('button', { name: 'Not now' }).getAttribute('aria-describedby')
    expect(describedBy && document.getElementById(describedBy)?.textContent).toBe('Join the opener wars')
  })
  test('in a league: one row with rank and average, linking to the league', () => {
    render(createElement(LeaguesCard, { mine: [row('starting-words', 1)], featured, onJoin: vi.fn(), onJoinWord: vi.fn(), onDismiss: vi.fn(), busy: false }))
    const link = screen.getByRole('link', { name: /CRANE/ })
    expect(link.getAttribute('href')).toBe('/leagues/starting-words')
    expect(link.textContent).toContain('#1')
    expect(link.textContent).toContain('3.8')
    expect(screen.queryByRole('button', { name: 'SLATE' })).toBeNull()
  })
  test('an unranked group says so rather than showing a number', () => {
    render(createElement(LeaguesCard, { mine: [row('starting-words', null)], featured, onJoin: vi.fn(), onJoinWord: vi.fn(), onDismiss: vi.fn(), busy: false }))
    expect(screen.getByRole('link', { name: /CRANE/ }).textContent).toContain('not yet ranked')
  })
  test('caps at HOME_CARD_MAX_LEAGUES with See all', () => {
    render(createElement(LeaguesCard, { mine: ['a', 'b', 'c', 'd'].map((s) => row(s, null)), featured, onJoin: vi.fn(), onJoinWord: vi.fn(), onDismiss: vi.fn(), busy: false }))
    expect(screen.getAllByRole('link').map((l) => l.textContent)).toContain('See all')
    expect(screen.getAllByRole('link')).toHaveLength(4)
  })
  test('a member is shown their league even with no featured league', () => {
    render(createElement(LeaguesCard, { mine: [row('starting-words', 2)], featured: null, onJoin: vi.fn(), onJoinWord: vi.fn(), onDismiss: vi.fn(), busy: false }))
    expect(screen.getByRole('link', { name: /CRANE/ }).textContent).toContain('#2')
  })
  test('the offer-only markup is pinned: v2b regions must not change it', () => {
    // BYTE FOR BYTE (zic8.3.21.6): the combined card reuses the offer's body,
    // so this pins the no-rows card as it was before regions existed. The
    // useId values vary with render order, so they are normalised.
    const { container } = card({ featured })
    expect(container.innerHTML.replace(/_r_[0-9a-z]+_/g, 'ID')).toMatchInlineSnapshot(`"<div class="rounded-lg border bg-card text-card-foreground shadow-sm" role="region" aria-label="Leagues"><div class="flex flex-col space-y-1.5 p-6"><h2 id="ID" class="text-2xl font-semibold leading-none tracking-tight">Join the opener wars</h2></div><div class="p-6 pt-0 flex flex-col gap-2"><p class="text-sm text-muted-foreground">Pick a side — your boards count whatever word you start with.</p><div role="group" aria-label="Choose a group" class="grid grid-cols-3 gap-2 sm:flex sm:flex-wrap"><button class="inline-flex items-center justify-center gap-2 whitespace-nowrap rounded-md text-sm font-medium ring-offset-background transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 disabled:pointer-events-none disabled:opacity-50 [&amp;_svg]:pointer-events-none [&amp;_svg]:size-4 [&amp;_svg]:shrink-0 border border-input bg-background hover:bg-accent hover:text-accent-foreground h-10 px-4 py-2 font-mono tracking-widest" type="button" aria-pressed="false" aria-describedby="ID-g0-count">CRANE<span aria-hidden="true" class="ml-2 text-xs font-normal tracking-normal tabular-nums opacity-70">0</span><span id="ID-g0-count" aria-hidden="true" class="sr-only">0 members</span></button><button class="inline-flex items-center justify-center gap-2 whitespace-nowrap rounded-md text-sm font-medium ring-offset-background transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 disabled:pointer-events-none disabled:opacity-50 [&amp;_svg]:pointer-events-none [&amp;_svg]:size-4 [&amp;_svg]:shrink-0 border border-input bg-background hover:bg-accent hover:text-accent-foreground h-10 px-4 py-2 font-mono tracking-widest" type="button" aria-pressed="false" aria-describedby="ID-g1-count">SLATE<span aria-hidden="true" class="ml-2 text-xs font-normal tracking-normal tabular-nums opacity-70">0</span><span id="ID-g1-count" aria-hidden="true" class="sr-only">0 members</span></button></div><button class="inline-flex items-center justify-center gap-2 whitespace-nowrap text-sm font-medium ring-offset-background transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 disabled:pointer-events-none disabled:opacity-50 [&amp;_svg]:pointer-events-none [&amp;_svg]:size-4 [&amp;_svg]:shrink-0 hover:bg-accent hover:text-accent-foreground h-9 rounded-md px-3 self-start" type="button" aria-describedby="ID">Not now</button></div></div>"`)
  })
  test('nothing at all when there is no featured league and no membership', () => {
    const { container } = render(createElement(LeaguesCard, { mine: [], featured: null, onJoin: vi.fn(), onJoinWord: vi.fn(), onDismiss: vi.fn(), busy: false }))
    expect(container.innerHTML).toBe('')
  })
})

describe('LeaguesCard with rows AND the offer (v2b regions, owner decision 2026-10-09)', () => {
  test('one Leagues card: the region row, then the offer under its own h3', () => {
    card({ mine: [regionRow] })
    const region = screen.getByRole('region', { name: 'Leagues' })
    expect(screen.getAllByRole('region')).toHaveLength(1)
    expect(screen.getByRole('heading', { level: 2, name: 'Leagues' })).toBeTruthy()
    expect(screen.getByRole('heading', { level: 3, name: 'Join the opener wars' })).toBeTruthy()
    expect(screen.getByRole('link', { name: /US Central/ }).getAttribute('href')).toBe('/leagues/regions')
    expect(screen.getByText('Pick a side — your boards count whatever word you start with.')).toBeTruthy()
    // THE ROW COMES FIRST: the offer follows the player's own standing.
    const link = screen.getByRole('link', { name: /US Central/ })
    const h3 = screen.getByRole('heading', { level: 3 })
    expect(link.compareDocumentPosition(h3) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy()
    expect(region.contains(h3)).toBe(true)
  })
  test('"Not now" keeps its visible name and is described by the offer h3', () => {
    const onDismiss = vi.fn()
    card({ mine: [regionRow], onDismiss })
    const notNow = screen.getByRole('button', { name: 'Not now' })
    const describedBy = notNow.getAttribute('aria-describedby')
    const target = describedBy ? document.getElementById(describedBy) : null
    expect(target?.tagName).toBe('H3')
    expect(target?.textContent).toBe('Join the opener wars')
    fireEvent.click(notNow)
    expect(onDismiss).toHaveBeenCalledTimes(1)
  })
  test('pickerModeFor drives it: a WORD featured league gets the word picker and joins by word', () => {
    const onJoinWord = vi.fn()
    card({ mine: [regionRow], onJoinWord })
    expect(wordBox()).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: 'SLATE' }))
    expect(onJoinWord).toHaveBeenCalledWith('SW', 'slate')
  })
  test('pickerModeFor drives it: a FIXED featured league gets the group picker and joins by group id', () => {
    const onJoin = vi.fn()
    card({ mine: [regionRow], featured, onJoin })
    expect(screen.queryByRole('textbox', { name: 'Any Wordle answer word' })).toBeNull()
    fireEvent.click(screen.getByRole('button', { name: 'SLATE' }))
    expect(onJoin).toHaveBeenCalledWith('g1')
  })
  test('busy disables the picker and "Not now" here too', () => {
    card({ mine: [regionRow], featured, busy: true })
    expect((screen.getByRole('button', { name: 'SLATE' }) as HTMLButtonElement).disabled).toBe(true)
    expect((screen.getByRole('button', { name: 'Not now' }) as HTMLButtonElement).disabled).toBe(true)
  })
  test('the cap is still HOME_CARD_MAX_LEAGUES rows with See all, offer or not', () => {
    card({ mine: [...['a', 'b', 'c'].map((s) => row(s, null)), regionRow] })
    const links = screen.getAllByRole('link')
    expect(links).toHaveLength(4)
    expect(links.map((l) => l.textContent)).toContain('See all')
    expect(screen.queryByRole('link', { name: /US Central/ })).toBeNull()
  })
  test('rows only (no offer): no h3, no "Not now", as before regions', () => {
    card({ mine: [row('starting-words', 1), regionRow], featured: null })
    expect(screen.getAllByRole('link')).toHaveLength(2)
    expect(screen.queryByRole('heading', { level: 3 })).toBeNull()
    expect(screen.queryByRole('button', { name: 'Not now' })).toBeNull()
  })
})

describe('LeaguesCard for a featured WORD league (spec v2 §5)', () => {
  test('the offer is the word picker: quick picks plus a box for any answer word, same copy', () => {
    card()
    expect(screen.getByRole('heading', { name: 'Join the opener wars' })).toBeTruthy()
    expect(screen.getByText('Pick a side — your boards count whatever word you start with.')).toBeTruthy()
    expect(screen.getByRole('group', { name: 'Choose a group' })).toBeTruthy()
    expect(wordBox()).toBeTruthy()
    expect(screen.getByRole('button', { name: 'Not now' })).toBeTruthy()
  })
  test('a quick pick joins BY WORD with the league id, never by group id', () => {
    const onJoin = vi.fn()
    const onJoinWord = vi.fn()
    card({ onJoin, onJoinWord })
    fireEvent.click(screen.getByRole('button', { name: 'SLATE' }))
    expect(onJoinWord).toHaveBeenCalledWith('SW', 'slate')
    expect(onJoin).not.toHaveBeenCalled()
  })
  test('a typed answer word joins by word once the lazy list has loaded', async () => {
    const onJoin = vi.fn()
    const onJoinWord = vi.fn()
    card({ onJoin, onJoinWord })
    fireEvent.focus(wordBox())
    fireEvent.change(wordBox(), { target: { value: 'wryly' } })
    await waitFor(() => expect(joinButton().disabled).toBe(false))
    fireEvent.click(joinButton())
    expect(onJoinWord).toHaveBeenCalledWith('SW', 'wryly')
    expect(onJoin).not.toHaveBeenCalled()
  })
  test('busy disables the quick picks, the box and "Not now"', () => {
    card({ busy: true })
    expect((screen.getByRole('button', { name: 'SLATE' }) as HTMLButtonElement).disabled).toBe(true)
    expect(wordBox().disabled).toBe(true)
    expect((screen.getByRole('button', { name: 'Not now' }) as HTMLButtonElement).disabled).toBe(true)
  })
  test('"Not now" still dismisses and joins nothing', () => {
    const onJoinWord = vi.fn()
    const onDismiss = vi.fn()
    card({ onJoinWord, onDismiss })
    fireEvent.click(screen.getByRole('button', { name: 'Not now' }))
    expect(onDismiss).toHaveBeenCalledTimes(1)
    expect(onJoinWord).not.toHaveBeenCalled()
  })
  test('a featured FIXED league keeps the group picker: no word box, joins by group id', () => {
    const onJoin = vi.fn()
    const onJoinWord = vi.fn()
    card({ featured, onJoin, onJoinWord })
    expect(screen.queryByRole('textbox', { name: 'Any Wordle answer word' })).toBeNull()
    fireEvent.click(screen.getByRole('button', { name: 'SLATE' }))
    expect(onJoin).toHaveBeenCalledWith('g1')
    expect(onJoinWord).not.toHaveBeenCalled()
  })
})

describe('leaguesCardInput', () => {
  const enabled = { enabled: true as const, leagues: [{ ...featured, slug: 'other', featured: false }, featured] }
  const team = { everJoined: false, offerPicker: true, dismissed: false }
  const mine = [row('starting-words', 1)]
  test('dark or unanswered myLeagues: nothing', () => {
    expect(leaguesCardInput({ enabled: false }, enabled, team)).toBeNull()
    expect(leaguesCardInput(undefined, enabled, team)).toBeNull()
  })
  test('a member gets their rows and no picker, wherever the card is and whatever the list says', () => {
    for (const offerPicker of [true, false]) {
      expect(leaguesCardInput({ enabled: true, leagues: mine }, undefined, { everJoined: true, offerPicker, dismissed: false })).toEqual({ mine, featured: null })
      expect(leaguesCardInput({ enabled: true, leagues: mine }, enabled, { everJoined: true, offerPicker, dismissed: false })).toEqual({ mine, featured: null })
    }
  })
  test('a never-joined TEAM player is offered the featured league', () => {
    expect(leaguesCardInput({ enabled: true, leagues: [] }, enabled, team)).toEqual({ mine: [], featured })
  })
  test('a DISMISSED offer is never shown again, but a member still gets their rows', () => {
    expect(leaguesCardInput({ enabled: true, leagues: [] }, enabled, { ...team, dismissed: true })).toBeNull()
    for (const everJoined of [true, false]) {
      expect(leaguesCardInput({ enabled: true, leagues: mine }, enabled, { everJoined, offerPicker: true, dismissed: true })).toEqual({ mine, featured: null })
    }
  })
  test('a never-joined TEAMLESS player gets no card: onboarding makes the offer', () => {
    expect(leaguesCardInput({ enabled: true, leagues: [] }, enabled, { everJoined: false, offerPicker: false, dismissed: false })).toBeNull()
  })
  test('a leaver (ever joined, no current rows) is never re-offered the picker', () => {
    expect(leaguesCardInput({ enabled: true, leagues: [] }, enabled, { everJoined: true, offerPicker: true, dismissed: false })).toBeNull()
    expect(leaguesCardInput({ enabled: true, leagues: [] }, enabled, { everJoined: true, offerPicker: false, dismissed: false })).toBeNull()
  })
  test('a REGION-ONLY player who never joined gets the row AND the offer (owner decision 2026-10-09)', () => {
    expect(leaguesCardInput({ enabled: true, leagues: [regionRow] }, enabled, team)).toEqual({ mine: [regionRow], featured })
  })
  test('a Starting Words member with a region gets both rows and no offer', () => {
    const both = [row('starting-words', 1), regionRow]
    expect(leaguesCardInput({ enabled: true, leagues: both }, enabled, { ...team, everJoined: true })).toEqual({ mine: both, featured: null })
  })
  test('a DISMISSED region-only player gets the row only', () => {
    expect(leaguesCardInput({ enabled: true, leagues: [regionRow] }, enabled, { ...team, dismissed: true })).toEqual({ mine: [regionRow], featured: null })
  })
  test('a TEAMLESS call site (offerPicker: false) gets the region row only', () => {
    expect(leaguesCardInput({ enabled: true, leagues: [regionRow] }, enabled, { ...team, offerPicker: false })).toEqual({ mine: [regionRow], featured: null })
  })
  test('a region-only player whose list has not answered still gets the row', () => {
    expect(leaguesCardInput({ enabled: true, leagues: [regionRow] }, undefined, team)).toEqual({ mine: [regionRow], featured: null })
  })
  test('a never-joined team player with a dark, failed or featureless list: nothing', () => {
    expect(leaguesCardInput({ enabled: true, leagues: [] }, { enabled: false }, team)).toBeNull()
    expect(leaguesCardInput({ enabled: true, leagues: [] }, undefined, team)).toBeNull()
    expect(leaguesCardInput({ enabled: true, leagues: [] }, { enabled: true, leagues: [{ ...featured, featured: false }] }, team)).toBeNull()
  })
})

describe('pickerCouldShow', () => {
  const could = { myLeagues: { enabled: true as const, leagues: [] }, everJoined: false, dismissed: false, offerPicker: true }
  test('a never-joined, undismissed team player with no rows: true', () => {
    expect(pickerCouldShow(could)).toBe(true)
  })
  test('true with only REGION rows: the region is automatic, not a join (owner decision 2026-10-09)', () => {
    expect(pickerCouldShow({ ...could, myLeagues: { enabled: true, leagues: [regionRow] } })).toBe(true)
    expect(pickerCouldShow({ ...could, myLeagues: { enabled: true, leagues: [row('starting-words', 1), regionRow] } })).toBe(false)
  })
  test('each condition alone flips it', () => {
    expect(pickerCouldShow({ ...could, myLeagues: undefined })).toBe(false)
    expect(pickerCouldShow({ ...could, myLeagues: { enabled: false } })).toBe(false)
    expect(pickerCouldShow({ ...could, myLeagues: { enabled: true, leagues: [row('starting-words', 1)] } })).toBe(false)
    expect(pickerCouldShow({ ...could, everJoined: true })).toBe(false)
    expect(pickerCouldShow({ ...could, dismissed: true })).toBe(false)
    expect(pickerCouldShow({ ...could, offerPicker: false })).toBe(false)
  })
})
