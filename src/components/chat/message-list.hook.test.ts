// @vitest-environment jsdom
//
// jsdom, not the suite's default edge-runtime (vitest.config.ts), because this
// file renders the real component through @testing-library/react. `.hook.
// test.ts` rather than `.test.tsx` matches every precedent in src/ and keeps
// vitest.config.ts's `src/**/*.test.ts` glob, so the elements below go through
// `createElement` by hand.
//
// THIS FILE'S REASON TO EXIST IS THE AVATAR-GATING RULE IN THE `showsName`
// BLOCK, which the edge-runtime suite (use-chat-sync.test.ts) cannot see:
// that suite asserts `showsAuthorName`/`messageRows` as data, never renders a
// pixel. A mutant that swapped `authorFor(...) !== null` for a truthy check
// on `.image`, or that hoisted the avatar out of the `showsName` gate, would
// type-check, lint, build and pass every edge-runtime test in this repo. The
// five cases below are the ones that catch exactly that.
//
// `authorFor` IS A PROP, NOT A CONVEX QUERY — routes/chat.tsx builds it from
// the same roster lookup `nameFor` uses (see the comment on `memberFor`
// there), so this test supplies a plain stub function rather than mocking
// `@convex-dev/react-query` the way profile-tab.hook.test.ts must for its own
// Convex-backed props. message-list.tsx makes no Convex call of its own.
//
// RADIX'S `AvatarImage` ONLY MOUNTS AN `<img>` AFTER A REAL `window.Image`
// REPORTS `load`, and jsdom's `Image` never fires that event — there is no
// network stack underneath it. Left alone, every avatar in this file would
// render its fallback forever and assertion 1 below would fail for a reason
// that has nothing to do with message-list.tsx. `FakeImage` stands in for
// jsdom's own and marks itself loaded (`complete`, `naturalWidth > 0`) the
// instant a `src` is assigned, which is the same synchronous shape
// `useImageLoadingStatus` (node_modules/@radix-ui/react-avatar) expects from a
// cached, already-loaded image.
import { cleanup, render, screen, within } from '@testing-library/react'
import { createElement } from 'react'
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'
import { MessageList } from './message-list.tsx'
import type { ChatMessage } from './use-chat-sync.ts'
import type { Id } from '../../../convex/_generated/dataModel'

class FakeImage {
  onload: (() => void) | null = null
  onerror: (() => void) | null = null
  complete = false
  naturalWidth = 0
  private listeners = new Map<string, Set<(event: { currentTarget: FakeImage }) => void>>()
  private _src = ''

  addEventListener(type: string, listener: (event: { currentTarget: FakeImage }) => void) {
    if (!this.listeners.has(type)) this.listeners.set(type, new Set())
    this.listeners.get(type)?.add(listener)
  }

  removeEventListener(type: string, listener: (event: { currentTarget: FakeImage }) => void) {
    this.listeners.get(type)?.delete(listener)
  }

  set src(value: string) {
    this._src = value
    // Synchronous "already loaded" rather than an async load — see the file
    // header. Empty `src` (there isn't one here; every image in this file has
    // a URL) would be the one case worth failing instead.
    this.complete = true
    this.naturalWidth = 1
    // Radix's own `handleLoad` reads `event.currentTarget` — a bare call with
    // no argument is exactly what jsdom's real dispatch never does, and it is
    // what left this failing with "Cannot read properties of undefined" the
    // first time this file ran.
    this.listeners.get('load')?.forEach((listener) => listener({ currentTarget: this }))
  }

  get src() {
    return this._src
  }
}

const AUTHOR_A = 'author-a' as Id<'players'>
const AUTHOR_B = 'author-b' as Id<'players'>
const ME = 'me' as Id<'players'>
const DEPARTED = 'departed' as Id<'players'>

type Author = { image: string | null; initials: string | null } | null

const AUTHORS: Record<string, Author> = {
  [AUTHOR_A]: { image: 'https://img.example/ada.png', initials: 'AL' },
  [AUTHOR_B]: { image: null, initials: 'BB' },
  [ME]: { image: 'https://img.example/me.png', initials: 'ME' },
  // DEPARTED is deliberately absent — that absence, not an explicit `null`
  // entry, is what "not on the roster" looks like.
}

const NAMES: Record<string, string> = {
  [AUTHOR_A]: 'Ada Lovelace',
  [AUTHOR_B]: 'Bea Byron',
  [ME]: 'Me',
  // DEPARTED has no entry either; nameFor below answers 'Former member' for
  // exactly that miss, mirroring routes/chat.tsx's own real `nameFor`.
}

const nameFor = (playerId: Id<'players'>): string => NAMES[playerId] ?? 'Former member'
const authorFor = (playerId: Id<'players'>): Author => AUTHORS[playerId] ?? null

const message = (playerId: Id<'players'>, createdAt: number, body: string): ChatMessage => ({
  _id: `${playerId}-${createdAt}` as Id<'chatMessages'>,
  playerId,
  body,
  createdAt,
})

beforeEach(() => {
  vi.stubGlobal('Image', FakeImage)
})

afterEach(() => {
  cleanup()
  vi.unstubAllGlobals()
})

describe('the avatar beside the author name', () => {
  test('an author with an image renders an <img> on the first message of their run', () => {
    const t = Date.now()
    render(
      createElement(MessageList, {
        messages: [message(AUTHOR_A, t, 'hello')],
        nameFor,
        authorFor,
        myPlayerId: ME,
        canDelete: () => false,
        windowLength: 1,
      }),
    )

    const row = screen.getByText('Ada Lovelace')
    // `querySelector`, NOT `getByRole('img')` — an `<img alt="">` maps to the
    // accessibility role "presentation" in some ARIA implementations, which
    // would make a role query about correctness of ARIA mapping rather than
    // about whether message-list.tsx put an `<img>` in the DOM at all.
    // `.getAttribute`, not a jest-dom matcher: @testing-library/jest-dom is
    // not a dependency here — same discipline as app-menu.hook.test.ts and
    // Header.hook.test.ts.
    const img = row.querySelector('img')
    expect(img).not.toBeNull()
    expect(img?.getAttribute('src')).toBe('https://img.example/ada.png')
    expect(img?.getAttribute('alt')).toBe('')
    expect(img?.getAttribute('aria-hidden')).toBe('true')
  })

  test('the second message of the same run renders no avatar', () => {
    const t = Date.now()
    render(
      createElement(MessageList, {
        messages: [message(AUTHOR_A, t, 'hello'), message(AUTHOR_A, t + 1000, 'again')],
        nameFor,
        authorFor,
        myPlayerId: ME,
        canDelete: () => false,
        windowLength: 2,
      }),
    )

    // Only the FIRST message of the run names its author at all — the second
    // carries no `showsName` span for an avatar to hang off of. Exactly ONE
    // `<img>` in the whole two-message conversation is the proof: one for the
    // run's opening message, none for its second.
    expect(screen.getAllByText('Ada Lovelace')).toHaveLength(1)
    expect(document.querySelectorAll('img')).toHaveLength(1)
  })

  test('your own messages render no avatar, ever', () => {
    const t = Date.now()
    render(
      createElement(MessageList, {
        messages: [message(ME, t, 'hello'), message(ME, t + 1000, 'again')],
        nameFor,
        authorFor,
        myPlayerId: ME,
        canDelete: () => false,
        windowLength: 2,
      }),
    )

    // `showsAuthorName` is `startsRun && !mine`, so `mine` messages never show
    // a name — and never reach the avatar branch that hangs off it. No second
    // condition was added for "mine" in message-list.tsx; this is the proof.
    expect(screen.queryByText('Me')).toBeNull()
    expect(document.querySelector('img')).toBeNull()
    expect(screen.queryByText('ME')).toBeNull()
  })

  test('a departed author ("Former member") renders no avatar element at all', () => {
    const t = Date.now()
    render(
      createElement(MessageList, {
        messages: [message(DEPARTED, t, 'ghost')],
        nameFor,
        authorFor,
        myPlayerId: ME,
        canDelete: () => false,
        windowLength: 1,
      }),
    )

    const row = screen.getByText('Former member')
    // No <img>, AND no initials, AND NO ELEMENT AT ALL — `authorFor`'s `null`
    // gates the whole avatar, not just its contents. Asserting only "no
    // <img>" would pass for a regression that fell back to rendering bare
    // initials for a departed author, which is exactly the identity leak this
    // design forbids. `row.children` is empty because the ternary in
    // message-list.tsx renders `null` for the avatar branch entirely — no
    // empty <Avatar> shell, nothing — leaving only the "Former member" text
    // node as this span's content.
    expect(row.querySelector('img')).toBeNull()
    expect(row.children).toHaveLength(0)
  })

  test('an author with no image renders their initials and no <img>', () => {
    const t = Date.now()
    render(
      createElement(MessageList, {
        messages: [message(AUTHOR_B, t, 'no picture here')],
        nameFor,
        authorFor,
        myPlayerId: ME,
        canDelete: () => false,
        windowLength: 1,
      }),
    )

    const row = screen.getByText('Bea Byron')
    expect(within(row).getByText('BB').textContent).toBe('BB')
    expect(row.querySelector('img')).toBeNull()
  })

  // A MEMBER WITH NO PICTURE STILL GETS AN AVATAR (initials); A NON-MEMBER
  // GETS NONE AT ALL. `authorFor` returning `{ image: null, ... }` versus
  // returning `null` is exactly that distinction, and it is cheap to pin now
  // that the test is driving `authorFor` directly rather than a live roster.
  test('"on the roster with no photo" and "not on the roster" are different, not the same absence', () => {
    const t = Date.now()
    render(
      createElement(MessageList, {
        messages: [message(AUTHOR_B, t, 'no picture'), message(DEPARTED, t + 120_000, 'ghost')],
        nameFor,
        authorFor,
        myPlayerId: ME,
        canDelete: () => false,
        windowLength: 2,
      }),
    )

    const memberRow = screen.getByText('Bea Byron')
    expect(within(memberRow).getByText('BB').textContent).toBe('BB')

    const departedRow = screen.getByText('Former member')
    expect(departedRow.children).toHaveLength(0)
  })
})
