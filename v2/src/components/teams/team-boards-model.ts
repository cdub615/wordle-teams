import { daysOfMonth, isWeekendDay } from '../../../convex/lib/puzzleDay.ts'
import type { PuzzleDay, PuzzleMonth } from '../../../convex/lib/puzzleDay.ts'

/**
 * Every decision the Team Boards panel makes, as pure functions.
 *
 * Ported from v1's src/components/app-grid-items/team-boards.tsx, which computed
 * all of this inline across three effects. The extraction is not cosmetic: the
 * part of v1 that was actually wrong was the day resolution, and it was wrong
 * because it was tangled up with render.
 *
 * NOTHING HERE READS A CLOCK. `today` arrives as a parameter, resolved in the
 * VIEWER'S zone by the component (`toPuzzleDay(new Date())`, and only after
 * hydration). v1 asked date-fns `isToday(new Date(...))` during render, in a
 * `'use client'` component that also renders on the server — where "now" is UTC
 * — so server and client disagreed about which day was today for every viewer
 * whose local date differed from UTC. That is the same defect class as
 * V2-ADDENDUM §7a rows 14 and 15, and the reason `today` is a parameter and
 * `PuzzleDay | undefined` rather than a `Date`.
 */

/** One score as `scores.getTeamMonth` returns it. */
export type PlayerScore = {
  puzzleDay: PuzzleDay
  answer: string
  guesses: Array<string>
}

/** One team member as `scores.getTeamMonth` returns them. */
export type TeamPlayer = {
  id: string
  firstName: string
  lastName: string
  scores: Array<PlayerScore>
}

/** v1's two strings, verbatim. Exported so the tests assert the real ones. */
export const CONCEALED_MESSAGE = "Visible after today's submission"
export const MISSING_MESSAGE = 'No board for player on this date'

/**
 * What one slide shows.
 *
 * `board` renders the tiles; `concealed` and `missing` render `message` in their
 * place. Three states rather than v1's `hide || !exists` boolean because the two
 * non-board cases say different things and only one of them is a rule.
 */
export type BoardState = 'board' | 'concealed' | 'missing'

export type TeamBoard = {
  playerId: string
  playerName: string
  state: BoardState
  answer: string
  guesses: Array<string>
  /** null exactly when `state` is 'board'. */
  message: string | null
}

export type TeamBoardsView = {
  boards: Array<TeamBoard>
  /**
   * True when the whole day is withheld because the viewer has not entered their
   * own board yet. Panel-wide in v1 and panel-wide here: it is one rule about
   * one day, not a per-player property.
   */
  concealed: boolean
}

/**
 * The days of `month` this panel can be pointed at: playable by the team's
 * weekend rule, and not in the future.
 *
 * REPLACES THREE SEPARATE PIECES OF v1: its `getDate()` initial pick, its
 * `setPrevDay`/`setNextDay` weekend-skipping loops, and its `isToday(date)`
 * next-day disable. All three are the same question — "which days are there" —
 * and answering it once as a list makes the arrows plain index arithmetic.
 *
 * BOUNDED TO THE MONTH, WHICH IS A DELIBERATE DIVERGENCE (V2-ADDENDUM §7a).
 * v1 held every team's every score in a client context, so stepping back off
 * the 1st into the previous month still had data to render. v2's
 * `scores.getTeamMonth` is scoped to one team and one month on purpose — see
 * its doc comment — so a day outside `month` would render a panel of "no board"
 * for everyone, which reads as data loss rather than as a boundary.
 *
 * Returns [] when `today` is undefined, which is the pre-hydration state: the
 * server cannot know the viewer's date, so before hydration there is no
 * defensible day to be pointed at and the panel renders a placeholder instead.
 */
export function navigableDays({
  month,
  playWeekends,
  today,
}: {
  month: PuzzleMonth
  playWeekends: boolean
  today: PuzzleDay | undefined
}): Array<PuzzleDay> {
  if (!today) return []
  return daysOfMonth(month).filter((day) => (playWeekends || !isWeekendDay(day)) && day <= today)
}

/**
 * Which day the panel is actually showing.
 *
 * Derived rather than stored in an effect. `picked` is what the viewer last
 * chose; it is honoured only while it is still one of `days`, so changing month
 * or team re-defaults on the very same render instead of leaving a stale day on
 * screen until an effect catches up. That staleness was a real hazard in v1,
 * whose three effects had to keep `date`, `boards`, `hide` and `message` in
 * agreement by hand.
 *
 * The default is the LAST navigable day, which unifies both of v1's cases: for
 * the current month that is today (or, when the team does not play weekends and
 * today is a Saturday, the Friday before it — v1 handed out the Saturday, a day
 * its own date picker renders disabled, exactly the bug pick-default-day.ts was
 * extracted to fix); for a past month it is the last playable day, which is what
 * v1's `lastDayOfMonth` walk-back computed.
 *
 * undefined only when `days` is empty — pre-hydration, or a month with nothing
 * playable in it yet.
 */
export function resolveDay(days: Array<PuzzleDay>, picked: PuzzleDay | undefined): PuzzleDay | undefined {
  if (picked && days.includes(picked)) return picked
  return days[days.length - 1]
}

/**
 * Whether the viewer has entered their own board for `day`.
 *
 * A MISSING VIEWER COUNTS AS NOT SUBMITTED, matching v1, whose optional chain
 * fell through to `?? false`. That is the conservative direction: an unknown
 * viewer conceals rather than reveals.
 */
function hasOwnBoard(players: Array<TeamPlayer>, myPlayerId: string | null, day: PuzzleDay): boolean {
  const me = players.find((player) => player.id === myPlayerId)
  return me?.scores.some((score) => score.puzzleDay === day) ?? false
}

/**
 * One slide per team member, plus whether the day is withheld.
 *
 * THE CONCEALMENT RULE IS v1'S: today's boards are hidden until you have entered
 * your own, so nobody can read the answer off a teammate before playing. It
 * applies to TODAY ONLY — a past day is never concealed, however little you
 * played — and when it applies it applies to every slide, including members who
 * have no board at all, because "no board" would otherwise leak that they have
 * not played today.
 */
export function teamBoardsView({
  players,
  day,
  today,
  myPlayerId,
}: {
  players: Array<TeamPlayer>
  day: PuzzleDay
  /**
   * REQUIRED, NOT `| undefined`, and that is the type doing real work. A day
   * only exists once `today` does (navigableDays returns [] without it), so
   * there is no reachable call with an unknown today — and forcing the caller
   * to prove that is what stops "today is unknown" ever silently meaning "the
   * selected day is not today", which would reveal boards the rule conceals.
   */
  today: PuzzleDay
  myPlayerId: string | null
}): TeamBoardsView {
  const concealed = day === today && !hasOwnBoard(players, myPlayerId, day)

  const boards = players.map((player) => {
    const score = concealed ? undefined : player.scores.find((entry) => entry.puzzleDay === day)
    const state: BoardState = concealed ? 'concealed' : score ? 'board' : 'missing'
    return {
      playerId: player.id,
      playerName: `${player.firstName} ${player.lastName}`,
      state,
      // A CONCEALED SLIDE CARRIES NO LETTERS, not even unrendered ones, so
      // "message is set" and "there is nothing to draw" cannot drift apart —
      // one careless edit to the JSX is otherwise all it takes to paint the
      // answer onto a slide the rule says is hidden.
      //
      // NOT A CONFIDENTIALITY BOUNDARY, and must not be described as one:
      // scores.getTeamMonth returns the whole month to every member, so the
      // day's answers are already in the browser either way. Withholding them
      // server-side would mean the server resolving the viewer's "today",
      // which is the very thing puzzleDay exists to avoid doing on the server,
      // and the same query feeds the scores table, which needs every day. This
      // is a render-path guardrail; v1 has neither.
      answer: score?.answer ?? '',
      guesses: score?.guesses ?? [],
      message: state === 'concealed' ? CONCEALED_MESSAGE : state === 'missing' ? MISSING_MESSAGE : null,
    }
  })

  return { boards, concealed }
}

/**
 * The slide index `delta` steps from `from`, wrapping at both ends.
 *
 * The loop is the one thing v1 got from embla that this panel actually used
 * (`opts={{ loop: true }}`), so it is preserved rather than dropped. Kept here,
 * pure, rather than inline in the click handler, because "wraps at both ends"
 * is the whole of the behaviour and a `%` on a negative left-hand side is a
 * classic silent off-by-one.
 */
export function wrapSlide(from: number, delta: number, count: number): number {
  if (count <= 0) return 0
  return ((from + delta) % count + count) % count
}
