import { useRef, useState } from 'react'
import { ArrowLeft, ArrowRight, ChevronLeft, ChevronRight } from 'lucide-react'
import { convexQuery } from '@convex-dev/react-query'
import { useSuspenseQuery } from '@tanstack/react-query'
import { api } from '../../../convex/_generated/api'
import { Button } from '#/components/ui/button.tsx'
import { Card, CardContent, CardHeader, CardTitle } from '#/components/ui/card.tsx'
import { Skeleton } from '#/components/ui/skeleton.tsx'
import { DatePicker } from '#/components/date-picker.tsx'
import { WordleBoard } from '#/components/wordle-board.tsx'
import { useHydrated } from '#/lib/use-hydrated.ts'
import { cn } from '#/lib/utils.ts'
import { monthOf, toPuzzleDay, type PuzzleDay, type PuzzleMonth } from '../../../convex/lib/puzzleDay.ts'
import { navigableDays, resolveDay, teamBoardsView, wrapSlide } from './team-boards-model.ts'
import type { Id } from '../../../convex/_generated/dataModel'

/**
 * One teammate's board per slide, for a chosen day, with day navigation.
 * Ported from v1's src/components/app-grid-items/team-boards.tsx.
 *
 * NO CAROUSEL LIBRARY. v1 uses shadcn's `Carousel`, which is a wrapper around
 * embla-carousel-react; v2 has neither, and adding embla for one panel would
 * run against the direction Phase 7 has already taken twice — aceternity,
 * magicui and framer-motion all came out on the same reasoning, and
 * V2-ADDENDUM §7a row 25 is the /about carousel going the same way. The two
 * things v1's carousel actually does — snap one slide at a time, and wrap at
 * the ends — are `snap-x snap-mandatory` plus `wrapSlide`, below. Touch and
 * trackpad swiping and their momentum then come from the browser's own
 * overflow scrolling, with nothing here to implement or test.
 *
 * ALL DAY RESOLUTION HAPPENS AFTER HYDRATION, which is the whole trap in this
 * component and the reason v1 carries two comments about it. This renders on
 * the server, where "now" is UTC; `useHydrated()` is false on the server AND on
 * the client's first render, so `today` is undefined on both and the panel
 * renders an identical placeholder on each. v1 got to the same place by
 * starting four pieces of state undefined and reconciling them in three
 * effects. There are no effects here: `today` gates `navigableDays`, which
 * feeds `resolveDay`, and the placeholder falls out of there being no day.
 */
export function TeamBoards({
  teamId,
  month,
  months,
  onMonthChange,
  className,
}: {
  teamId: Id<'teams'>
  month: string
  /**
   * Every month the MONTH DROPDOWN offers, newest first — `monthOptions`' own
   * output, passed down rather than recomputed (wordle-teams-5vv3).
   *
   * IT BOUNDS THE DAY PICKER, which is the whole point: the picker reaches
   * exactly the months the dropdown does and no further. The owner's decision,
   * and the reason is that v2 has NO pro month gate yet — `monthOptions`
   * returns three months for everyone — so an unbounded picker would hand every
   * player unlimited history now and the pro expansion would later have to take
   * it away. Sharing one source means both widen together when it lands, and
   * the two controls cannot disagree about what exists.
   */
  months: Array<PuzzleMonth>
  /**
   * Called when a picked day falls OUTSIDE the month currently loaded.
   *
   * `getTeamMonth` loads one month, so reaching a day in another one is a
   * navigation rather than a local state change — the parent moves `?month=`
   * and this component re-renders against the new data. See the picker below.
   */
  onMonthChange: (month: PuzzleMonth) => void
  className?: string
}) {
  const hydrated = useHydrated()
  const { data } = useSuspenseQuery(convexQuery(api.scores.getTeamMonth, { teamId, month }))
  const { data: myPlayerId } = useSuspenseQuery(convexQuery(api.scores.getMyPlayerId, {}))
  const { team, players } = data

  // The viewer's own midnight, never the server's. See the model's header.
  const today = hydrated ? toPuzzleDay(new Date()) : undefined

  // What the viewer last chose, NOT what is being shown — resolveDay decides
  // that. Holding the choice rather than the result is what makes a month or
  // team switch re-default on the same render instead of one effect later.
  const [picked, setPicked] = useState<PuzzleDay | undefined>(undefined)
  const days = navigableDays({ month, playWeekends: team.playWeekends, today })
  const day = resolveDay(days, picked)
  const dayIndex = day ? days.indexOf(day) : -1

  const trackRef = useRef<HTMLDivElement>(null)
  // A REF, NOT STATE, and that is the point of the whole scroll handler below.
  // Nothing in the returned JSX reads this index; its only consumer is
  // goToSlide, at click time. As state it re-rendered the panel — and re-ran
  // teamBoardsView over the whole roster — on every scroll event, which a
  // smooth scrollTo fires once per animation frame.
  const slideRef = useRef(0)

  // `!today` is redundant at runtime — `day` cannot resolve without it — but it
  // is what narrows `today` to a PuzzleDay for teamBoardsView below, whose
  // signature deliberately refuses an unknown one.
  if (!day || !today) {
    return (
      <Card className={cn('h-fit w-full max-w-[96vw]', className)}>
        <CardHeader>
          <CardTitle>Team Boards</CardTitle>
        </CardHeader>
        <CardContent>
          {/* Two distinguishable states, deliberately. Before hydration there
              IS a day, it just isn't knowable yet, so a skeleton is honest.
              After hydration an empty `days` means the viewed month has no
              playable day that has happened — only reachable by hand-editing
              ?month= to the future, since the month picker offers this month
              and the two before it — and a spinner forever would be a lie. */}
          {hydrated ? (
            <p className="py-8 text-center text-muted-foreground">No days to show in this month yet</p>
          ) : (
            <Skeleton className="h-[450px] w-full" />
          )}
        </CardContent>
      </Card>
    )
  }

  const { boards } = teamBoardsView({ players, day, today, myPlayerId })

  const goToSlide = (delta: number) => {
    // Clamped rather than reset: switching to a team with fewer members must
    // not leave the arrows stepping from an index that no longer exists.
    const active = Math.min(slideRef.current, Math.max(boards.length - 1, 0))
    const next = wrapSlide(active, delta, boards.length)
    slideRef.current = next
    const track = trackRef.current
    const child = track?.children[next]
    if (!track || !(child instanceof HTMLElement)) return
    // prefers-reduced-motion is asked here rather than left to the browser.
    // Whether a UA damps an EXPLICIT `behavior: 'smooth'` is not uniformly
    // specified — the claim that scroll-snap got this for free was retracted on
    // wordle-teams-ry1 — so the panel decides for itself. Optional-called
    // because matchMedia is not guaranteed to exist on every host.
    const reduced = window.matchMedia?.('(prefers-reduced-motion: reduce)').matches ?? false
    // offsetLeft is relative to the offsetParent, which the track is not
    // guaranteed to be; subtracting its own offsetLeft makes the difference a
    // scroll offset either way.
    track.scrollTo({
      left: child.offsetLeft - track.offsetLeft,
      behavior: reduced ? 'auto' : 'smooth',
    })
  }

  return (
    <Card className={cn('h-fit w-full max-w-[96vw]', className)}>
      <CardHeader>
        <CardTitle>Team Boards</CardTitle>
        <div className="flex pt-2">
          <Button
            className="text-sm font-normal"
            variant="outline"
            onClick={() => setPicked(days[dayIndex - 1])}
            disabled={dayIndex <= 0}
          >
            <ArrowLeft className="h-4 w-4" />
            <span className="sr-only">Previous day</span>
          </Button>
          <div className="mx-auto">
            {/*
              THE PICKER REACHES EVERY MONTH THE DROPDOWN DOES, not just the one
              loaded (wordle-teams-5vv3). It used to be clamped to
              `days[0]`..`days[days.length - 1]` — the loaded month — so viewing
              an earlier day meant going up to the month dropdown first, while
              board entry's picker (the same component) had no such restriction.

              `minDay` IS THE FIRST DAY OF THE OLDEST MONTH ON OFFER. `months`
              is monthOptions' output and is newest-first, so the last entry is
              the oldest.

              NO `maxDay` AT ALL, WHICH IS A DELETION RATHER THAN AN OMISSION.
              date-picker.tsx already refuses every future day on its own; the
              old `maxDay` narrowed that further to the end of the loaded month,
              which is exactly what stopped a viewer in July returning to
              September without the dropdown. Its own doc comment says maxDay
              "can never widen" the future bound, so dropping it restores the
              default rather than loosening anything.
            */}
            <DatePicker
              day={day}
              onSelect={(chosen) => {
                setPicked(chosen)
                // A day outside the loaded month is a navigation, not a local
                // change. `picked` is set FIRST and deliberately: after the
                // parent moves `?month=`, `navigableDays` is the new month's
                // and `resolveDay` honours `picked` because it is now one of
                // them — so the day the viewer actually clicked is the one that
                // renders, rather than that month's default last day.
                const chosenMonth = monthOf(chosen)
                if (chosenMonth !== month) onMonthChange(chosenMonth)
              }}
              playWeekends={team.playWeekends}
              minDay={months.length > 0 ? `${months[months.length - 1]}-01` : days[0]}
              className="w-52 md:w-56"
            />
          </div>
          <Button
            className="text-sm font-normal"
            variant="outline"
            onClick={() => setPicked(days[dayIndex + 1])}
            disabled={dayIndex >= days.length - 1}
          >
            <ArrowRight className="h-4 w-4" />
            <span className="sr-only">Next day</span>
          </Button>
        </div>
      </CardHeader>
      <CardContent>
        <div className="relative" role="group" aria-roledescription="carousel" aria-label="Team boards">
          {/* overflow-x-auto + snap-x snap-mandatory IS the carousel. Each slide
              is basis-full so exactly one is in view, which is also what makes
              the scroll handler's `scrollLeft / clientWidth` an exact index
              rather than an approximation. */}
          <div
            ref={trackRef}
            tabIndex={0}
            aria-label="Team boards, scrollable by player"
            /*
              `overflow-y-hidden` IS NOT REDUNDANT WITH `overflow-x-auto`
              (wordle-teams-iv09). Per the CSS overflow spec, when one axis is
              not `visible` the other computes from `visible` to AUTO — so
              declaring only the x axis silently made this a VERTICAL scroll
              container too, and a touch drag downward scrolled the track
              instead of the page. On a phone that means a mistouch anywhere
              over the boards traps the page.

              NOT `touch-action: pan-x`, WHICH IS THE OBVIOUS FIX AND IS WRONG.
              touch-action is intersected from the hit-test element up through
              its ancestors, so `pan-x` here would disable vertical panning for
              the ancestors as well — the page would stop scrolling from inside
              this region, which is the same bug arrived at from the other side.
            */
            className="flex snap-x snap-mandatory overflow-x-auto overflow-y-hidden [scrollbar-width:none] [&::-webkit-scrollbar]:hidden"
            onScroll={(event) => {
              // Keeps the arrows stepping from where a TOUCH SWIPE left the
              // track, which the arrows never hear about otherwise. Writes a
              // ref, so it costs no render.
              const track = event.currentTarget
              if (track.clientWidth === 0) return
              slideRef.current = Math.round(track.scrollLeft / track.clientWidth)
            }}
          >
            {boards.map((board) => (
              /*
                A COLUMN, AND THE BOARD TAKES WHAT IS LEFT (wordle-teams-iv09).

                THE MATHS THAT WAS WRONG, AND IT WAS WRONG ON EVERY SCREEN SIZE
                RATHER THAN A NARROW ONE: the slide is 450px; the name row was
                `mb-2 h-[24px]`, so 32px including its margin; and the board
                wrapper was `h-full`, which resolves against the SLIDE — 450px,
                not the 418px actually left under the name. 482px of content in
                a 450px box, always. That overflow is what the track then had
                something to scroll vertically.

                `flex-1` with `min-h-0` is the pair that fixes it: flex-1 takes
                the remaining space instead of the whole box, and min-h-0 is
                what lets a flex child shrink below its content's intrinsic
                height at all — without it the default `min-height: auto` puts
                the overflow straight back.
              */
              <div
                key={board.playerId}
                className="flex h-[450px] min-w-0 shrink-0 basis-full snap-center flex-col"
              >
                <div className="mb-2 h-[24px] shrink-0 text-center font-semibold">
                  {board.playerName}
                </div>
                <div className="flex min-h-0 flex-1 justify-center">
                  {board.message ? (
                    <p className="w-auto pt-[180px] text-center text-muted-foreground">{board.message}</p>
                  ) : (
                    <WordleBoard
                      answer={board.answer}
                      guesses={board.guesses}
                      showLetters={team.showLetters}
                      boardEntry={false}
                    />
                  )}
                </div>
              </div>
            ))}
          </div>
          {/* Hidden below two members: there is nothing to move between, and
              v1's looping arrows on a one-player team scrolled to the slide
              already on screen. */}
          {boards.length > 1 && (
            <>
              <Button
                variant="outline"
                size="icon"
                className="absolute top-1/2 -left-3 h-8 w-8 -translate-y-1/2 rounded-md md:-left-4"
                onClick={() => goToSlide(-1)}
              >
                <ChevronLeft className="h-4 w-4" />
                <span className="sr-only">Previous player</span>
              </Button>
              <Button
                variant="outline"
                size="icon"
                className="absolute top-1/2 -right-3 h-8 w-8 -translate-y-1/2 rounded-md md:-right-4"
                onClick={() => goToSlide(1)}
              >
                <ChevronRight className="h-4 w-4" />
                <span className="sr-only">Next player</span>
              </Button>
            </>
          )}
        </div>
      </CardContent>
    </Card>
  )
}

export default TeamBoards
