// @vitest-environment jsdom
//
// jsdom, not the suite's default edge-runtime (vitest.config.ts), because this
// file renders the real component. `.hook.test.ts` matches the three existing
// precedents — settings/notifications-tab.hook.test.ts, lib/use-local-capture.
// hook.test.ts and teams/team-boards.hook.test.ts — and `.test.ts` rather than
// `.test.tsx` because vitest.config.ts's glob is `src/**/*.test.ts`, so the
// elements below go through `createElement` by hand.
//
// WHAT THIS FILE COVERS THAT lib/celebration.test.ts CANNOT. That suite pins
// the copy and the open/closed decision as a pure function, and every one of
// its tests would still pass if this component never called it, called it with
// the server's month, opened and immediately re-closed, or wrote the seen-list
// from the browser. All four are the things v1 actually gets wrong, and all
// four are wiring.
//
// NOTE ON GATES: `pnpm test:once` runs this file and CI runs test:once
// (.github/workflows/deploy-v2.yml). Playwright is NOT a gate — wt-ksh.8.49 —
// so nothing here may be left to e2e.
import { readFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import ts from 'typescript'
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { getFunctionName, type FunctionReference } from 'convex/server'
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'
import { api } from '../../convex/_generated/api'
import { MonthlyWinnerCelebration, CONFETTI_PIECES, REDUCED_MOTION_QUERY } from './monthly-winner-celebration.tsx'
import { codeOf, parseSource } from '#/test-support/source-ast.ts'
import type { Id } from '../../convex/_generated/dataModel'
import type { WinnerRow } from '#/lib/celebration.ts'

/** Set per test, read by the mocked `useQuery`. */
let winnerRow: WinnerRow | null
let myPlayerId: string | null
let markSeen: ReturnType<typeof vi.fn>

// Hoisted, because vi.mock's factory is lifted above every other statement in
// this file and would otherwise close over a binding that does not exist yet.
// `subscribed` is every queryKey the component has asked for since the last
// reset — the bounded record the hydration-gate test below reads.
const { captureError, subscribed } = vi.hoisted(() => ({
  captureError: vi.fn(),
  subscribed: [] as Array<string>,
}))

vi.mock('@convex-dev/react-query', () => ({
  convexQuery: (ref: FunctionReference<'query'>, args: unknown) => ({
    queryKey: [getFunctionName(ref), args],
  }),
  useConvexMutation: (ref: FunctionReference<'mutation'>) => {
    expect(getFunctionName(ref)).toBe(getFunctionName(api.winners.markCelebrationSeen))
    return markSeen
  },
}))

vi.mock('@tanstack/react-query', () => ({
  useQuery: ({ queryKey }: { queryKey: [string, unknown] }) => {
    subscribed.push(JSON.stringify(queryKey))
    return queryKey[0] === getFunctionName(api.scores.getMyPlayerId)
      ? { data: myPlayerId }
      : { data: winnerRow }
  },
}))

vi.mock('#/lib/sentry-capture.ts', () => ({ captureError }))

const TEAM_ID = 'team_1' as Id<'teams'>
const OTHER_TEAM = 'team_2' as Id<'teams'>
const ADA = 'p_ada'
const GRACE = 'p_grace'

// Mid-August 2026, local. "Last month" from here is July, and it is a plain
// case — the January rollover has its own test below.
const NOW = new Date(2026, 7, 20, 10, 0, 0)

const dialog = (teamId: Id<'teams'> = TEAM_ID) => createElement(MonthlyWinnerCelebration, { teamId })

/** Every confetti rectangle currently in the document — portal included. */
const confetti = () => Array.from(document.querySelectorAll('.confetti-piece'))

globalThis.IS_REACT_ACT_ENVIRONMENT = true

beforeEach(() => {
  // Only Date is faked. Faking timers wholesale takes the message channel with
  // it, which React's scheduler needs to flush anything.
  vi.useFakeTimers({ toFake: ['Date'] })
  vi.setSystemTime(NOW)
  markSeen = vi.fn(() => Promise.resolve(null))
  captureError.mockClear()
  subscribed.length = 0
  winnerRow = {
    teamName: 'Wordlers',
    winner: { id: ADA, firstName: 'Ada', lastName: 'Lovelace' },
    hasSeen: false,
  }
  myPlayerId = GRACE
})

afterEach(() => {
  cleanup()
  vi.useRealTimers()
  // The two matchMedia tests below unstub at the end of their own bodies; this
  // is the belt to that braces, since a failed assertion would otherwise leave
  // a stubbed matchMedia standing for every test after it and turn one red into
  // a file full of them.
  vi.unstubAllGlobals()
})

describe('the hydration gate — "last month" is the VIEWER\'s month, never the server\'s', () => {
  /** The distinct queryKeys asked for, in first-seen order. */
  const asked = () => [...new Set(subscribed)].map((key) => JSON.parse(key) as [string, unknown])

  test('the server SUBSCRIBES TO NOTHING, which is what the gate is for', () => {
    // NOT "the server renders no markup" — it renders none either way, because
    // the dialog is closed on any first render and a closed Radix Dialog is not
    // a DOM node. That assertion passes with the gate deleted, so it is not the
    // one that pins it (measured: the mutant survived it).
    //
    // What the gate actually prevents is the server ASKING A QUESTION IT
    // CANNOT ANSWER. Convex runs UTC; "last month" is a fact about the viewer's
    // calendar. A server render that resolved it would subscribe under one
    // month key and the client's first render under another — two cache
    // entries, and a dehydrated server cache holding the wrong month's answer.
    // That is V2-ADDENDUM §7a rows 14-15's defect class arriving through the
    // query key rather than through the markup.
    expect(renderToStaticMarkup(dialog())).toBe('')
    expect(asked()).toEqual([])
  })

  test('after hydration it asks for LAST month, resolved locally', () => {
    render(dialog())

    expect(asked()).toEqual([
      [getFunctionName(api.scores.getMyPlayerId), {}],
      [getFunctionName(api.winners.getLastMonthWinner), { teamId: TEAM_ID, month: '2026-07' }],
    ])
    expect(markSeen).toHaveBeenCalledWith({ teamId: TEAM_ID, month: '2026-07' })
  })

  test('and rolls the YEAR back in January', () => {
    // The off-by-one that a naive `month - 1` produces: January 2027's previous
    // month is 2026-12, not 2027-00 or 2027-12.
    vi.setSystemTime(new Date(2027, 0, 3, 9, 0, 0))
    render(dialog())
    expect(markSeen).toHaveBeenCalledWith({ teamId: TEAM_ID, month: '2026-12' })
  })
})

describe("THE v1 BUG: the dialog names the WINNER, not whoever is reading it", () => {
  test('a viewer who did not win is told who did — and never sees their own name', () => {
    // v1 interpolates `user.firstName`/`user.lastName` — the CURRENT viewer —
    // into both the title and the body of this branch, so Grace is told "Grace
    // Hopper won!" and, underneath, "Grace Hopper won last month for Wordlers.
    // Better luck next time!". §7a row 35.
    render(dialog())

    expect(screen.getByRole('heading').textContent).toBe('Ada Lovelace won!')
    expect(screen.getByText('Ada Lovelace won last month for Wordlers. Better luck next time!')).toBeTruthy()
    // The bounded negative: Grace's id is the only thing the component is given
    // about the viewer, and it must not reach the copy.
    expect(document.body.textContent).not.toContain(GRACE)
  })

  test('the winner gets the congratulation, by first name', () => {
    myPlayerId = ADA
    render(dialog())

    expect(screen.getByRole('heading').textContent).toBe('Congratulations Ada!')
    expect(screen.getByText('You won last month for Wordlers. Nice work! 🎉')).toBeTruthy()
  })
})

describe('opening, marking seen, and staying open', () => {
  test('an unseen celebration opens and is marked seen exactly once', () => {
    const view = render(dialog())
    expect(screen.getByRole('dialog')).toBeTruthy()
    expect(markSeen).toHaveBeenCalledTimes(1)

    // A re-render must not fire a second write. The dialog re-renders on every
    // Convex push to either query it subscribes to.
    view.rerender(dialog())
    expect(markSeen).toHaveBeenCalledTimes(1)

    // NOR DOES THE DISMISS. Marking seen is ON OPEN — v1's timing, kept — so
    // closing writes nothing; a handler that also marked on dismiss would be a
    // wasted round-trip rather than a wrong answer (the mutation's `includes`
    // guard makes the second write a no-op), but "exactly once" is the claim in
    // this test's name and a re-render alone does not carry it.
    fireEvent.click(screen.getByRole('button', { name: 'Close' }))
    expect(markSeen).toHaveBeenCalledTimes(1)
  })

  test('THE LATCH: it stays open when the subscription re-pushes with hasSeen true', () => {
    // The failure this prevents is not theoretical — it is the direct
    // consequence of the mutation succeeding. `getLastMonthWinner` is a
    // reactive subscription, so the write below lands as a new value with
    // `hasSeen: true`; an `open` driven off the query would shut the dialog in
    // the frame after it opened, and nobody would ever read it.
    const view = render(dialog())
    expect(screen.getByRole('dialog')).toBeTruthy()

    winnerRow = { ...winnerRow!, hasSeen: true }
    view.rerender(dialog())

    expect(screen.getByRole('dialog')).toBeTruthy()
  })

  test('a celebration already seen never opens, and writes nothing', () => {
    winnerRow = { ...winnerRow!, hasSeen: true }
    render(dialog())

    expect(screen.queryByRole('dialog')).toBeNull()
    expect(markSeen).not.toHaveBeenCalled()
  })

  test('no winner row: nothing renders and nothing is written', () => {
    winnerRow = null
    render(dialog())

    expect(screen.queryByRole('dialog')).toBeNull()
    expect(markSeen).not.toHaveBeenCalled()
  })

  test('an unknown viewer waits rather than guessing', () => {
    // getMyPlayerId is a plain query and is briefly null. Opening here would
    // render the third-person copy to the winner themselves.
    myPlayerId = null
    render(dialog())

    expect(screen.queryByRole('dialog')).toBeNull()
    expect(markSeen).not.toHaveBeenCalled()
  })

  test('dismissing closes it, and a later push does not reopen it', () => {
    const view = render(dialog())
    fireEvent.click(screen.getByRole('button', { name: 'Close' }))
    expect(screen.queryByRole('dialog')).toBeNull()
    // The open write, and no dismiss write on top of it.
    expect(markSeen).toHaveBeenCalledTimes(1)

    // Any write anywhere on the team re-pushes this query. Reopening on one
    // would make the dialog impossible to get rid of.
    winnerRow = { ...winnerRow!, hasSeen: true }
    view.rerender(dialog())
    expect(screen.queryByRole('dialog')).toBeNull()
  })

  test('SWITCHING TEAMS can open a second celebration', () => {
    // The remount key on <Celebration>. Both latches — `opened` and
    // `dismissed` — are per-instance and must not survive the question
    // changing: without the key the viewer dismisses one team's dialog and the
    // next team's is considered already shown and never marked seen either, so
    // it comes back on every load and is never dismissible.
    const view = render(dialog())
    fireEvent.click(screen.getByRole('button', { name: 'Close' }))
    expect(screen.queryByRole('dialog')).toBeNull()

    winnerRow = {
      teamName: 'The Others',
      winner: { id: 'p_bob', firstName: 'Bob', lastName: 'Kahn' },
      hasSeen: false,
    }
    view.rerender(dialog(OTHER_TEAM))

    expect(screen.getByRole('heading').textContent).toBe('Bob Kahn won!')
    expect(markSeen).toHaveBeenLastCalledWith({ teamId: OTHER_TEAM, month: '2026-07' })
  })

  test('and so can the MONTH rolling over under a tab left open', () => {
    // The other half of the same key, at a much rarer boundary: a dashboard
    // open across midnight on the 1st. `key={teamId}` alone passes the test
    // above and fails this one.
    const view = render(dialog())
    fireEvent.click(screen.getByRole('button', { name: 'Close' }))

    vi.setSystemTime(new Date(2026, 8, 1, 0, 30, 0))
    view.rerender(dialog())

    expect(screen.getByRole('dialog')).toBeTruthy()
    expect(markSeen).toHaveBeenLastCalledWith({ teamId: TEAM_ID, month: '2026-08' })
  })

  test('a failed write is reported, not toasted, and leaves the dialog up', async () => {
    const failure = new Error('offline')
    markSeen = vi.fn(() => Promise.reject(failure))
    render(dialog())

    await vi.waitFor(() =>
      expect(captureError).toHaveBeenCalledWith(failure, {
        where: 'markCelebrationSeen',
        teamId: TEAM_ID,
        month: '2026-07',
      }),
    )
    // The viewer can do nothing about it and the fallback is benign — the
    // dialog simply appears again next visit.
    expect(screen.getByRole('dialog')).toBeTruthy()
  })
})

describe('the confetti, without react-confetti-explosion', () => {
  test('the winner gets every piece; nobody else gets any', () => {
    // v1 fires ConfettiExplosion only for the winner too. Asserted as the exact
    // count rather than "some", so a burst that silently shrank to one piece is
    // a failure and not a pass.
    render(dialog())
    expect(confetti()).toHaveLength(0)

    cleanup()
    myPlayerId = ADA
    render(dialog())
    expect(confetti()).toHaveLength(CONFETTI_PIECES.length)
    expect(CONFETTI_PIECES).toHaveLength(24)
    // AND THE BURST IS HIDDEN FROM ASSISTIVE TECHNOLOGY. 24 empty spans are
    // pure decoration; without this a screen reader walks them. The attribute
    // is invisible on screen, so nothing but an assertion can notice it going.
    const burst = document.querySelector('[data-slot="confetti"]')
    expect(burst?.getAttribute('aria-hidden')).toBe('true')
  })

  test('THE STYLESHEET HALF: the class and the keyframe exist, and read exactly what is set', () => {
    // INSTANCE FIFTEEN OF THE PHASE'S LESSON, and the one Task 10 was caught by
    // (its scroll-snap classes were the whole argument for dropping embla and
    // were pinned nowhere). Everything else in this describe asserts the
    // ELEMENTS. Delete `.confetti-piece` or `@keyframes confetti-fall` from
    // styles.css and 24 rectangles still render, still carry their four custom
    // properties, and sit motionless in the corner of the dialog — with the
    // whole suite green, because there is no CSSOM under vitest to ask about an
    // animation. The stylesheet is text; this reads the text.
    const css = readFileSync(
      resolve(dirname(fileURLToPath(import.meta.url)), '../styles.css'),
      'utf8',
    )

    /** One brace-delimited block's body, by its exact heading. Throws if absent. */
    const bodyOf = (heading: string) => {
      const opened = css.indexOf(`\n${heading} {`)
      expect(opened, `no top-level \`${heading} {\` block in styles.css`).toBeGreaterThan(-1)
      const block = css.slice(opened, css.indexOf('\n}', opened))
      // Past the selector itself, so the first declaration is not glued to it.
      return block.slice(block.indexOf('{') + 1)
    }

    const rule = bodyOf('.confetti-piece')
    const keyframe = bodyOf('@keyframes confetti-fall')

    /** `prop: value` pairs of one block, as a map. */
    const declarationsOf = (body: string) =>
      new Map(
        body
          .split(';')
          .map((line) => line.trim().replace(/\s+/g, ' '))
          .filter((line) => /^[a-z-]+:/.test(line))
          .map((line) => [line.slice(0, line.indexOf(':')), line.slice(line.indexOf(':') + 1).trim()]),
      )

    const declared = declarationsOf(rule)
    expect(declared.get('position')).toBe('absolute')
    // The animation names the keyframe above, rather than merely existing.
    expect(declared.get('animation')?.split(' ')[0]).toBe('confetti-fall')

    // ONE DIRECTION OF THE SET: every --confetti-* the CSS reads is one the
    // component writes. The other direction — every one the component writes is
    // read by the CSS — is the next test's last assertion, on the inline style's
    // own list; the pair is what makes a renamed property, a dropped `var()`, or
    // a fifth one nothing supplies a change to one of these two lists.
    const readByCss = [
      ...new Set([...`${rule}${keyframe}`.matchAll(/var\((--confetti-[a-z]+)\)/g)].map((m) => m[1])),
    ].sort()
    expect(readByCss).toEqual([
      '--confetti-delay',
      '--confetti-drift',
      '--confetti-duration',
      '--confetti-spin',
    ])
  })

  test('every piece carries the four custom properties the keyframe reads', () => {
    // THE HALF A COUNT IS BLIND TO. `@keyframes confetti-fall` in styles.css
    // reads --confetti-drift and --confetti-spin, and `.confetti-piece` reads
    // --confetti-duration and --confetti-delay. Dropping any one of them from
    // the inline style leaves 24 elements in the DOM that do not move — and
    // nothing else in this repo could see it, since there is no CSSOM under
    // vitest to ask about the animation itself.
    myPlayerId = ADA
    render(dialog())

    const declared = confetti().map((piece) => {
      const style = (piece as HTMLElement).style
      return [
        style.getPropertyValue('--confetti-drift'),
        style.getPropertyValue('--confetti-spin'),
        style.getPropertyValue('--confetti-delay'),
        style.getPropertyValue('--confetti-duration'),
      ]
    })

    expect(declared).toEqual(
      CONFETTI_PIECES.map((piece) => [piece.drift, piece.spin, piece.delay, piece.duration]),
    )
    // Deterministic, so "24 identical pieces" is a distinguishable failure.
    expect(new Set(declared.map(String)).size).toBeGreaterThan(1)
    // And the inline style declares exactly these six and nothing else — the
    // other direction of the set the stylesheet test above pins.
    const inline = (confetti()[0] as HTMLElement).style
    expect(Array.from({ length: inline.length }, (_, i) => inline.item(i)).sort()).toEqual([
      '--confetti-delay',
      '--confetti-drift',
      '--confetti-duration',
      '--confetti-spin',
      'background-color',
      'left',
    ])
  })

  test('a viewer who asked for reduced motion gets NO pieces at all — v1 animates regardless', () => {
    // react-confetti-explosion has no reduced-motion behaviour, so v1 throws
    // paper at everyone. jsdom ships no matchMedia (found on wordle-teams-ry1),
    // which is why the component optional-calls it and why every other test in
    // this file is the other half of this pair.
    const matchMedia = vi.fn((query: string) => ({ matches: query.includes('reduce') }))
    vi.stubGlobal('matchMedia', matchMedia)
    myPlayerId = ADA

    render(dialog())

    expect(matchMedia).toHaveBeenCalledWith(REDUCED_MOTION_QUERY)
    expect(REDUCED_MOTION_QUERY).toBe('(prefers-reduced-motion: reduce)')
    expect(confetti()).toHaveLength(0)
    // The message itself is not motion and must survive.
    expect(screen.getByText('You won last month for Wordlers. Nice work! 🎉')).toBeTruthy()
    vi.unstubAllGlobals()
  })

  test('and a viewer who has NOT asked for reduced motion still gets every piece', () => {
    // THE POSITIVE CASE, ASSERTED IN PRODUCTION'S ENVIRONMENT AND NOT ONLY IN
    // jsdom'S. Every other test in this describe renders under jsdom, which
    // ships no matchMedia at all, so it is the `?? false` — not the `.matches`
    // — that lets the pieces through. Drop the `.matches` and the burst becomes
    // `matchMedia?.(query) ?? false`, a truthy MediaQueryList: the whole suite
    // stays green while the winner gets zero confetti in every real browser,
    // forever and silently (measured: the mutant survived all 1171 tests).
    // "matchMedia exists and answers false" is the configuration of every real
    // browser, and until this test it was the one configuration nothing here
    // ran under. The same trap applies to any matchMedia, navigator.* or
    // window.* capability check pinned only under jsdom — assert the positive
    // branch with the capability PRESENT, not merely absent.
    const matchMedia = vi.fn(() => ({ matches: false }))
    vi.stubGlobal('matchMedia', matchMedia)
    myPlayerId = ADA

    render(dialog())

    expect(matchMedia).toHaveBeenCalledWith(REDUCED_MOTION_QUERY)
    expect(confetti()).toHaveLength(CONFETTI_PIECES.length)
    vi.unstubAllGlobals()
  })
})

describe('the dialog is mounted on the dashboard', () => {
  // THE ONE THING EVERY TEST ABOVE IS BLIND TO: they all render the component
  // directly, so deleting the element from routes/app.tsx leaves this file
  // green, lint and tsc silent, the build happy — and the feature gone. The
  // route cannot be imported under vitest (createFileRoute registers against a
  // router that does not exist), so its SOURCE is the artefact, read with the
  // compiler rather than a regex for the reason src/test-support/source-ast.ts
  // sets out: a substring match is satisfied by the name sitting in a comment,
  // and this file's mount site has one directly above it.
  test('routes/app.tsx renders it, once, with the viewed team', () => {
    // node:path off this module's own directory, never `new URL(...,
    // import.meta.url)`: jsdom replaces the global URL with its own class and
    // node:fs will not take an instance of it.
    const path = resolve(dirname(fileURLToPath(import.meta.url)), '../routes/app.tsx')
    const source = codeOf(readFileSync(path, 'utf8'))
    const file = parseSource('app.tsx', source)

    const rendered: Array<Array<[string, string]>> = []
    const walk = (node: ts.Node) => {
      const tag = ts.isJsxSelfClosingElement(node)
        ? node.tagName
        : ts.isJsxOpeningElement(node)
          ? node.tagName
          : undefined
      if (tag?.getText(file) === 'MonthlyWinnerCelebration') {
        const element = node as ts.JsxSelfClosingElement | ts.JsxOpeningElement
        rendered.push(
          element.attributes.properties
            .filter(ts.isJsxAttribute)
            .map((attribute) => [
              attribute.name.getText(file),
              attribute.initializer?.getText(file) ?? '',
            ]),
        )
      }
      ts.forEachChild(node, walk)
    }
    walk(file)

    // The whole attribute set, not a lookup: a prop added beside the right one,
    // or the team silently dropped, is a change to this list.
    expect(rendered).toEqual([[['teamId', "{teamParam as Id<'teams'>}"]]])
  })
})
