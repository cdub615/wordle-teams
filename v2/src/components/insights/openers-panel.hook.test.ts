// @vitest-environment jsdom
import { cleanup, render, screen } from '@testing-library/react'
import { createElement } from 'react'
import { afterEach, describe, expect, test } from 'vitest'
import type { DifficultyBenchmark, InsightsBenchmark, OpenerBenchmark } from '#/lib/insights-benchmark.ts'
import type { PersonalBoard } from '#/lib/insights-personal.ts'
import { OpenersPanel } from './openers-panel.tsx'

afterEach(cleanup)

// 'music' + 'crane' + 'sloth', 5 letters each, so offsets 0/5/10 are ranks
// 1/2/3. Anything else (e.g. 'ZZZZZ') is not in the corpus.
const openers: OpenerBenchmark = {
  attribution: 'FiveLetterWords.io, research release v2026-09-01',
  licence: 'CC BY 4.0',
  licenceUrl: 'https://creativecommons.org/licenses/by/4.0/',
  citation: 'x',
  release: 'v2026-09-01',
  count: 3,
  words: 'musiccranesloth',
}

const difficultyBenchmark = (firstDay: string, percentiles: number[]): DifficultyBenchmark => ({
  release: 'v2026-09-01',
  snapshotId: 'snap-1',
  attribution: 'FiveLetterWords.io, research release v2026-09-01',
  licence: 'CC BY 4.0',
  licenceUrl: 'https://creativecommons.org/licenses/by/4.0/',
  citation: 'x',
  firstDay,
  count: percentiles.length,
  percentiles,
})

// No difficulty coverage at all, for tests that are not about the difficulty
// line — every board's day falls outside `percentiles`, so `difficultySplit`
// reports `{ kind: 'thin', hardBoards: 0, restBoards: 0 }` and the unlock
// prompt renders without being the thing under test.
const noDifficultyCoverage = difficultyBenchmark('2099-01-01', [])

const benchmark = (difficulty: DifficultyBenchmark): InsightsBenchmark => ({ openers, difficulty })

/** The i-th day after 2026-01-01, as a puzzleDay string. */
const dateAt = (i: number): string =>
  new Date(Date.UTC(2026, 0, 1) + i * 86_400_000).toISOString().slice(0, 10)

/** A solved board opening with `opener`, taking `n` guesses (n < 6, so the answer never matters). */
const board = (day: string, opener: string, n: number): PersonalBoard => ({
  puzzleDay: day,
  answer: 'SPEED',
  guesses: [opener, ...Array.from({ length: Math.max(n - 2, 0) }, () => 'MOIST'), 'SPEED'].slice(0, n),
})

/** `count` distinct boards for one opener, on consecutive days starting at `startDay`. */
function openerBoards(opener: string, count: number, guessesPerBoard: number, startDay = 0): PersonalBoard[] {
  return Array.from({ length: count }, (_, i) => board(dateAt(startDay + i), opener, guessesPerBoard))
}

describe('the advice callout', () => {
  test('states both averages, and — when the alternative is used enough to trust — the conclusion', () => {
    // MUSIC: 10 boards of 5 guesses (mean 5), the most-used opener. CRANE: 6
    // boards of 4 guesses (mean 4), enough uses to clear the advice floor
    // (MIN_OPENER_USES_FOR_ADVICE is 5 in insights-personal.ts).
    const boards = [...openerBoards('MUSIC', 10, 5), ...openerBoards('CRANE', 6, 4, 100)]
    render(createElement(OpenersPanel, { benchmark: benchmark(noDifficultyCoverage), boards }))

    const headline = screen.getByTestId('insights-headline')
    expect(headline.textContent).toContain('You have opened with')
    expect(headline.textContent).toContain('MUSIC')
    expect(headline.textContent).toContain('10 times')
    expect(headline.textContent).toContain('It ranks')
    expect(headline.textContent).toContain('You average 5 guesses with it and 4 with CRANE')
    // The subtraction the spec says is the part worth paying for.
    expect(headline.textContent).toContain('Opening CRANE instead would save you about 1 guesses a day')

    // The saving figure carries the one accent colour in the card — via
    // text-accent-solid, not text-success, which is a background token (see
    // personal-summary.tsx's comment on this same fix).
    const figure = headline.querySelector('.text-accent-solid')
    expect(figure?.textContent).toBe('1')
  })

  test('withholds the conclusion when the alternative has not been used enough to trust', () => {
    // CRANE only has 3 uses, below the floor — advice would be drawn from too
    // little history to back it.
    const boards = [...openerBoards('MUSIC', 10, 5), ...openerBoards('CRANE', 3, 4, 100)]
    render(createElement(OpenersPanel, { benchmark: benchmark(noDifficultyCoverage), boards }))

    const headline = screen.getByTestId('insights-headline')
    expect(headline.textContent).toContain('You average 5 guesses with it and 4 with CRANE')
    expect(headline.textContent).not.toContain('Opening')
    expect(headline.querySelector('.text-accent-solid')).toBeNull()
  })

  test('is the only accent-coloured element the card renders', () => {
    const boards = [...openerBoards('MUSIC', 10, 5), ...openerBoards('CRANE', 6, 4, 100)]
    const { container } = render(
      createElement(OpenersPanel, { benchmark: benchmark(noDifficultyCoverage), boards }),
    )

    const headline = screen.getByTestId('insights-headline')
    expect(headline.className).toContain('border-accent-solid')
    expect(headline.className).toContain('bg-muted')

    // Nothing else in the card should reach for the accent-solid token —
    // the repertoire bars use the neutral bg-muted-foreground fill instead.
    const rest = container.innerHTML.replace(headline.outerHTML, '')
    expect(rest).not.toContain('accent-solid')
  })

  test('renders nothing when there are not two openers to compare', () => {
    const boards = openerBoards('MUSIC', 10, 5)
    render(createElement(OpenersPanel, { benchmark: benchmark(noDifficultyCoverage), boards }))
    expect(screen.queryByTestId('insights-headline')).toBeNull()
  })
})

describe('the difficulty split', () => {
  const restDays = 10
  const hardDays = 10
  const readyPercentiles = [
    ...Array.from({ length: restDays }, () => 40),
    ...Array.from({ length: hardDays }, () => 65),
  ]
  const readyDifficulty = difficultyBenchmark('2026-01-01', readyPercentiles)

  test('states both means once each band clears the floor', () => {
    const boards = [
      ...Array.from({ length: restDays }, (_, i) => board(dateAt(i), 'CRANE', 3)),
      ...Array.from({ length: hardDays }, (_, i) => board(dateAt(restDays + i), 'CRANE', 5)),
    ]
    render(createElement(OpenersPanel, { benchmark: benchmark(readyDifficulty), boards }))

    expect(screen.getByTestId('insights-difficulty-split').textContent).toBe(
      'You average 5 on days the world found hard, and 3 on the rest.',
    )
    expect(screen.queryByTestId('insights-unlock-difficulty')).toBeNull()
  })

  test('an unmet floor on the HARD band shows how many hard days are still needed', () => {
    const shortHardDays = 3
    const boards = [
      ...Array.from({ length: restDays }, (_, i) => board(dateAt(i), 'CRANE', 3)),
      ...Array.from({ length: shortHardDays }, (_, i) => board(dateAt(restDays + i), 'CRANE', 5)),
    ]
    render(createElement(OpenersPanel, { benchmark: benchmark(readyDifficulty), boards }))

    expect(screen.queryByTestId('insights-difficulty-split')).toBeNull()
    const prompt = screen.getByTestId('insights-unlock-difficulty')
    expect(prompt.textContent).toContain('Your difficulty breakdown unlocks at 10 hard days')
    expect(prompt.textContent).toContain(`${shortHardDays} / 10`)
  })

  test('an unmet floor on the REST band shows how many ordinary days are still needed, not hard days', () => {
    const shortRestDays = 2
    const boards = [
      ...Array.from({ length: shortRestDays }, (_, i) => board(dateAt(i), 'CRANE', 3)),
      ...Array.from({ length: hardDays }, (_, i) => board(dateAt(restDays + i), 'CRANE', 5)),
    ]
    render(createElement(OpenersPanel, { benchmark: benchmark(readyDifficulty), boards }))

    const prompt = screen.getByTestId('insights-unlock-difficulty')
    expect(prompt.textContent).toContain('Your difficulty breakdown unlocks at 10 ordinary days')
    expect(prompt.textContent).toContain(`${shortRestDays} / 10`)
  })
})

describe('the repertoire list', () => {
  test('shows at most 8 openers, most used first', () => {
    // Nine distinct openers, each used a different number of times so the
    // ordering (and therefore which one falls off the end) is unambiguous.
    const words = ['AAAAA', 'BBBBB', 'CCCCC', 'DDDDD', 'EEEEE', 'FFFFF', 'GGGGG', 'HHHHH', 'IIIII']
    const boards = words.flatMap((word, i) => openerBoards(word, 9 - i, 3, i * 20))
    render(createElement(OpenersPanel, { benchmark: benchmark(noDifficultyCoverage), boards }))

    const rows = screen.getByTestId('insights-repertoire').querySelectorAll('li')
    expect(rows).toHaveLength(8)
    // The 9th-most-used opener (IIIII, used once) must not appear.
    expect(screen.queryByText('IIIII')).toBeNull()
  })

  test('an opener the corpus does not hold stays in the list, marked unranked rather than dropped', () => {
    const boards = openerBoards('ZZZZZ', 6, 3)
    render(createElement(OpenersPanel, { benchmark: benchmark(noDifficultyCoverage), boards }))

    const repertoire = screen.getByTestId('insights-repertoire')
    expect(repertoire.textContent).toContain('unranked')
    expect(repertoire.textContent).not.toContain('#0')
    // The accessible text must say the same thing a sighted reader gets from
    // the badge, not silently drop the case in the conversion to badges.
    expect(repertoire.textContent).toContain('ZZZZZ is not in the benchmark set')
  })

  test('a ranked opener shows its rank as a badge and restates it in full for assistive tech', () => {
    const boards = openerBoards('CRANE', 6, 3)
    render(createElement(OpenersPanel, { benchmark: benchmark(noDifficultyCoverage), boards }))

    const repertoire = screen.getByTestId('insights-repertoire')
    expect(repertoire.textContent).toContain('#2')
    // openerRankSentence's own format: "2nd of 3".
    expect(repertoire.textContent).toContain('2nd of 3')
  })

  test('the bar is scaled against the worst mean shown, not a fixed ceiling', () => {
    // MUSIC: mean 4 (the worst of the two), and the more-used opener so it
    // sorts first regardless of the alphabetical tiebreak. CRANE: mean 2,
    // exactly half, and fewer uses so it sorts second.
    const boards = [...openerBoards('MUSIC', 7, 4), ...openerBoards('CRANE', 6, 2, 100)]
    const { container } = render(
      createElement(OpenersPanel, { benchmark: benchmark(noDifficultyCoverage), boards }),
    )

    const rows = [...container.querySelectorAll('[data-testid="insights-repertoire"] li')]
    const musicBar = rows[0]?.querySelector('.bg-muted-foreground') as HTMLElement
    const craneBar = rows[1]?.querySelector('.bg-muted-foreground') as HTMLElement
    expect(musicBar.style.width).toBe('100%')
    expect(craneBar.style.width).toBe('50%')
  })

  test('the word renders uncoloured — no result colouring anywhere in the list', () => {
    // Fixed, so a mean-attempts figure never coincidentally embeds a class
    // name like the ones being ruled out.
    const boards = openerBoards('CRANE', 6, 3)
    const { container } = render(
      createElement(OpenersPanel, { benchmark: benchmark(noDifficultyCoverage), boards }),
    )

    const repertoire = container.querySelector('[data-testid="insights-repertoire"]')!
    expect(repertoire.innerHTML).not.toContain('bg-wordle-correct')
    expect(repertoire.innerHTML).not.toContain('bg-wordle-present')
    expect(repertoire.innerHTML).not.toContain('bg-wordle-absent')
    // WordTiles' own accessible name — confirms the word still reaches the
    // page as text, just without a colouring.
    expect(repertoire.querySelector('[aria-label="CRANE"]')).not.toBeNull()
  })

  test('the mean is rendered with tabular-nums', () => {
    const boards = openerBoards('CRANE', 6, 3)
    render(createElement(OpenersPanel, { benchmark: benchmark(noDifficultyCoverage), boards }))
    const mean = screen.getByText('3', { selector: '.tabular-nums' })
    expect(mean).not.toBeNull()
  })
})
