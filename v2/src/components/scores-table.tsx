import { useLayoutEffect, useRef } from 'react'
import { convexQuery } from '@convex-dev/react-query'
import { useSuspenseQuery } from '@tanstack/react-query'
import { api } from '../../convex/_generated/api'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '#/components/ui/table.tsx'
import { ScoreCell } from '#/components/score-cell.tsx'
import { formatDayHeader } from '#/lib/format-day.ts'
import { cn } from '#/lib/utils.ts'
import { attemptsFor } from '../../convex/lib/board.ts'
import { monthTotal } from '../../convex/lib/scoring.ts'
import { daysOfMonth, isWeekendDay, monthContainsToday, toPuzzleDay } from '../../convex/lib/puzzleDay.ts'
import { useHydrated } from '#/lib/use-hydrated.ts'
import type { Id } from '../../convex/_generated/dataModel'

/**
 * The month grid. DESIGN_SYSTEM.md §8 "Leaderboard table".
 *
 * Hand-rolled rather than @tanstack/react-table, which is what v1 uses: this
 * table never sorts, filters or paginates, and its column pinning is plain
 * `sticky` CSS that react-table plays no part in. The rows arrive pre-ordered by
 * month total, exactly as v1's getData sorted them.
 *
 * Live-updating comes free from Convex reactivity through convexQuery — one of
 * the two sanctioned departures from strict parity in the parent design.
 */
export function ScoresTable({
  teamId,
  month,
  className,
}: {
  teamId: Id<'teams'>
  month: string
  className?: string
}) {
  const hydrated = useHydrated()
  const { data } = useSuspenseQuery(convexQuery(api.scores.getTeamMonth, { teamId, month }))
  const { team, players } = data

  // Local midnight, and only after hydration — the server has no idea what
  // "today" is for this viewer, and guessing it is a hydration mismatch. Before
  // hydration every day of the month reads as "not yet due", which renders
  // blanks rather than wrong values.
  const today = hydrated ? toPuzzleDay(new Date()) : `${month}-01`
  const days = daysOfMonth(month)

  // Centre today's column on landing (wt-ksh.3.18). The effect deps are
  // deliberately [hydrated, teamId, month] — NOT the score data, which
  // changes on every teammate's board submission via the live Convex
  // subscription. Excluding it means a live update simply doesn't re-run this
  // effect at all (React skips an effect whose deps are unchanged), so a
  // teammate submitting a board can never yank the view out from under
  // someone mid-read. Landing on a new team or month (including landing on a
  // month you've already visited earlier in the session) is a fresh
  // dependency change and centres again, which is the intended "once per
  // landing" behaviour.
  //
  // useLayoutEffect, not useEffect: it runs before the browser paints the
  // post-hydration commit, so the jump from the SSR-rendered natural position
  // to the centred one happens in one paint rather than flashing the natural
  // position first. This does mean React logs "useLayoutEffect does nothing
  // on the server" in dev when this component renders during SSR (only
  // reachable via a URL that already carries ?team=&month=, e.g. a bookmark
  // or shared link) — dev-console noise only, not a runtime issue, and worth
  // keeping over trading away the single-paint jump.
  const scrollWrapperRef = useRef<HTMLDivElement>(null)
  // The (team, month) key this effect last EVALUATED, updated on every run
  // regardless of whether it actually centred — not just the key it last
  // centred. This is what makes "leftover scrollLeft" distinguishable from
  // "the user scrolled here": scrollLeft lives on the wrapper DOM node, which
  // persists across re-renders, so it survives a month change untouched. Only
  // trust a nonzero scrollLeft as user intent when this effect is running for
  // the SAME key it evaluated last time — i.e. nothing else was rendered into
  // this wrapper in between. The moment the key changes (a real navigation:
  // team switch, or month switch, even to a month this effect returned early
  // on) any scrollLeft still sitting on the wrapper belongs to whatever was
  // last shown there, not to this landing, and must not block centring.
  const lastEvaluatedKeyRef = useRef<string | null>(null)
  useLayoutEffect(() => {
    const key = `${teamId}:${month}`
    const previousKey = lastEvaluatedKeyRef.current
    lastEvaluatedKeyRef.current = key

    const wrapper = scrollWrapperRef.current
    // `data-scroll-restoration-id`, set unconditionally (before any of the
    // early returns below) and keyed the same as the ref above: TanStack
    // Router's own `scrollRestoration: true` (router.tsx) is a SECOND,
    // independent thing that tries to manage this exact element's
    // scrollLeft, and it will undo everything above if left alone. Measured
    // directly (not assumed): on every client-side navigation — the
    // MonthPicker/TeamPicker case, not a full page load — the router's
    // `onRendered` handler fires ~100-200ms after this effect runs and
    // force-sets `wrapper.scrollLeft` from ITS OWN sessionStorage cache,
    // keyed by a structural DOM-path selector of this element (see
    // `@tanstack/router-core`'s scroll-restoration.ts:
    // `getScrollRestorationSelector`). Because this wrapper is the SAME DOM
    // node across a month/team switch (confirmed: an attribute stamped on it
    // survives the navigation), the router's selector resolves to the same
    // element on every landing, and it explicitly CARRIES FORWARD the
    // previous location's cached scroll entry for that selector into the
    // new location's cache when the new location doesn't have its own entry
    // yet (`toElementEntries[selector] ??= fromElementEntries[selector]`) —
    // so it reliably overwrites whatever this effect just computed with
    // whatever scrollLeft this element had on the PREVIOUS (team, month), a
    // few hundred ms later, regardless of this component's own logic.
    // `data-scroll-restoration-id` is the router's own documented escape
    // hatch: `getScrollRestorationSelector` uses it verbatim as the element's
    // identity instead of computing a structural path, so giving it a value
    // that changes with (teamId, month) makes the element look like a
    // DIFFERENT scroll target on every landing. The router's cache lookup
    // then misses (no entry under the new id) and its `document.querySelector`
    // for the stale id no longer matches this element, so it has nothing to
    // restore and leaves `scrollLeft` alone.
    if (wrapper) wrapper.dataset.scrollRestorationId = `scores-table-${key}`

    // "Today" comes from the browser clock — only meaningful after hydration
    // (see the `today` comment above; reading it during the SSR-matching
    // render is the hydration-mismatch class this phase has already hit).
    if (!hydrated) return

    const todayNow = toPuzzleDay(new Date())
    // Only when the viewed month actually contains today. A past (or future)
    // month has no current-day column — leave it at its natural position.
    // (The key above was still updated, so a later return TO this month sees
    // that something else was viewed in between.) Shared with today-panel.tsx,
    // which asks the same question to decide whether to render at all.
    if (!monthContainsToday(month, todayNow)) return

    if (!wrapper) return
    // Don't fight the user: a nonzero scrollLeft on a landing we've already
    // evaluated means the user (most likely — native overflow-x scrolling
    // needs no JS handlers and can happen before hydration finishes) moved
    // the view away from where we put it. Only respected when `key` matches
    // what this effect last evaluated; see the ref comment above.
    if (previousKey === key && wrapper.scrollLeft !== 0) return

    const cell = wrapper.querySelector<HTMLElement>(`[data-day="${todayNow}"]`)
    if (!cell) return

    const target = cell.offsetLeft + cell.offsetWidth / 2 - wrapper.clientWidth / 2
    // Clamp to the scroll bounds so early- and late-month days don't leave a
    // gap at either end.
    wrapper.scrollLeft = Math.max(0, Math.min(target, wrapper.scrollWidth - wrapper.clientWidth))
    // Deps deliberately exclude score data; see the comment above. (This once
    // carried an exhaustive-deps suppression. The rule reports nothing here, so
    // the directive was a lie about the code beneath it and went.)
  }, [hydrated, teamId, month])

  const rows = players
    .map((player) => {
      const byDay = new Map(player.scores.map((score) => [score.puzzleDay, score]))
      return {
        id: player.id,
        firstName: player.firstName,
        lastName: player.lastName,
        byDay,
        total: monthTotal({
          month,
          scores: player.scores,
          system: team.system,
          playWeekends: team.playWeekends,
          today,
        }),
      }
    })
    .sort((a, b) => b.total - a.total)

  // v1 shows a first name alone, and 'First L' only when two players on the team
  // share one. Initials replace both on mobile.
  const duplicateFirstNames = new Set(
    rows
      .map((row) => row.firstName)
      .filter((name, i, all) => all.indexOf(name) !== i),
  )

  // z-10: sticky cells have no z-index of their own, so nothing guarantees
  // they paint above the scrolling day columns beneath them (wt-ksh.3.16).
  // bg-background must stay opaque and paired with it — z-index alone
  // reorders painting, it doesn't stop the day columns showing through.
  const pinnedLeft = 'sticky left-0 z-10 bg-background'
  const pinnedRight = 'sticky right-0 z-10 bg-background'

  return (
    <div className={className}>
      {/* This div is a static bordered/rounded frame with no overflow of its
          own — it does NOT scroll. The Table primitive's own wrapper div is
          the single, x-axis-only scroll container (wt-ksh.3.13); the
          keyboard focus target below (tabIndex, aria-label) lives on that
          inner div via wrapperProps, since Table doesn't otherwise expose
          it. Do not add overflow back here — two nested overflow containers
          is exactly the bug this was fixed from. */}
      {/*
        `max-w-full`, NOT `max-w-[96vw]` (wordle-teams-rpql). 96vw is a fraction
        of the VIEWPORT while every sibling on the grid is bounded by its CELL,
        so the two disagreed once the page got wide enough for the difference to
        exceed the grid's own padding. Measured, right edges against the picker
        row above:

          1920   1872 vs 1872   aligned
          2560   2512 vs 2506   6px short
          3440   3392 vs 3350   42px short

        96vw was a belt against this table widening the page. The actual
        prevention is the grid's `grid-cols-1` at the base breakpoint — see
        routes/app.tsx's note, which calls it load-bearing — and `max-w-full`
        bounds to the same parent every neighbour already answers to.

        WHAT ACTUALLY FIXED THE REPORTED MISALIGNMENT WAS THE PAGE CAP, NOT THIS
        LINE, and it is worth being straight about which is which. `.page-max`
        holds the dashboard at 1440, so the content band is ~1344px and 96vw
        stops being the binding constraint at any viewport — the numbers above
        are unreachable now. This change removes a latent viewport-versus-parent
        mismatch that would come back the day the cap is raised past ~2400 or
        dropped, rather than being the repair itself. e2e cannot tell the two
        apart for the same reason: with the cap in place, restoring 96vw here
        leaves the alignment test green. Verified by mutation.
      */}
      <div className="max-w-full rounded-md border text-xs md:text-base">
        {/* w-max min-w-full overrides the primitive's own `w-full`: at 100%
            width, `table-layout: auto` treats that as a CAP and compresses
            every column to fit — with 28-31 day columns that means each
            header wraps one character per line, not the intended horizontal
            scroll. w-max lets the table grow to its natural content width
            (min-w-full keeps it at least full width when content is
            narrower), so the wrapper div above is what scrolls.
            Caught by the screenshot verification this task requires. */}
        <Table
          className="relative w-max min-w-full"
          wrapperProps={{ ref: scrollWrapperRef, tabIndex: 0, 'aria-label': 'Scores, scrollable by day' }}
        >
          <TableHeader>
            <TableRow>
              <TableHead scope="col" className={cn(pinnedLeft, 'rounded-tl-md px-2 md:px-4')}>
                <div className="text-xs md:text-sm">Player</div>
              </TableHead>
              {days.map((day) => (
                <TableHead scope="col" key={day}>
                  <div className="text-xs md:text-sm">{formatDayHeader(day)}</div>
                </TableHead>
              ))}
              <TableHead scope="col" className={cn(pinnedRight, 'rounded-tr-md px-2 md:px-4')}>
                <div className="text-right text-xs font-bold md:text-sm">Score</div>
              </TableHead>
            </TableRow>
          </TableHeader>
          <TableBody
            // Bottom corner radius belongs to the LAST row only — applying it
            // inside rows.map (as this used to) put it on every row's pinned
            // cells, since each one now paints its own border-b under
            // border-separate (wt-ksh.3.16). Targeted the same way TableBody
            // already cancels the last row's border in ui/table.tsx
            // ([&_tr:last-child>td]:border-b-0), rather than computed from the
            // row index in the map, so the two last-row rules stay adjacent
            // and consistent. Radius must match the frame's own rounded-md or
            // the corner reads as a double curve (wt-ksh.3.17).
            className="[&_tr:last-child>td:first-child]:rounded-bl-md [&_tr:last-child>td:last-child]:rounded-br-md"
          >
            {rows.map((row) => (
              <TableRow key={row.id}>
                <TableCell className={pinnedLeft}>
                  <div className="invisible h-0 w-0 md:visible md:h-fit md:w-max md:pr-px">
                    {duplicateFirstNames.has(row.firstName)
                      ? `${row.firstName} ${row.lastName[0]}`
                      : row.firstName}
                  </div>
                  <div className="text-xs md:invisible md:h-0 md:w-0 md:text-sm">
                    {row.firstName[0]}
                    {row.lastName[0]}
                  </div>
                </TableCell>
                {days.map((day) => {
                  const score = row.byDay.get(day)
                  return (
                    // data-day exists purely for e2e/board-entry.spec.ts: the
                    // day headers render as e.g. "Sun 2nd", so a plain
                    // toContainText('2') matches the 2nd of the month on
                    // every load whether or not a board was ever entered.
                    // This makes the specific (player, day) cell addressable
                    // without relying on column position.
                    <TableCell key={day} data-day={day}>
                      <ScoreCell
                        attempts={score ? attemptsFor(score.guesses, score.answer) : undefined}
                        hasScore={score !== undefined}
                        isBeforeToday={day < today}
                        isWeekend={isWeekendDay(day)}
                        playWeekends={team.playWeekends}
                      />
                    </TableCell>
                  )
                })}
                <TableCell className={pinnedRight}>
                  <div className="text-right font-bold">{row.total}</div>
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </div>
    </div>
  )
}

export default ScoresTable
