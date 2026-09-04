/**
 * The pure decision logic behind pull-to-refresh in the installed PWA
 * (wordle-teams-5jcn.26). In standalone mode there is no browser chrome, so
 * there is no way to reload the app at all without this.
 *
 * EVERYTHING HERE IS A PLAIN FUNCTION OF ITS ARGUMENTS, DELIBERATELY. Nothing
 * in this file touches `window`, a touch event, or a DOM node beyond the
 * single structural `closest()` call below — the actual gesture wiring
 * (attaching touch listeners, reading `window.scrollY`, calling
 * `window.location.reload()`) lives in components/pull-to-refresh.tsx and is
 * NOT covered by any test that renders it: no unit test in this suite can
 * render a component (wordle-teams-5jcn.14 — no harness stands up a DOM for
 * gesture code, and Playwright cannot install a PWA to exercise standalone
 * mode at all). What actually is pinned, exhaustively, is every decision
 * below: whether a touch may arm the gesture, and how far a raw finger
 * movement translates into a pull distance and a trigger. See
 * pull-to-refresh.test.ts's mutation table.
 */

/** How far (in CSS px) the indicator must travel before release triggers a reload. */
export const PULL_TRIGGER_PX = 64

/** The indicator's travel cap — pulling further than this does not move it any further. */
export const PULL_MAX_PX = 96

/**
 * How much of the raw finger movement reaches the indicator. Below 1 so the
 * gesture reads as resisted rather than 1:1 with the finger, the same
 * expectation iOS's and Android's own pull affordances set — a value of 1
 * would make a small twitch immediately hit whatever PULL_TRIGGER_PX is,
 * leaving no room to show "how far" before committing.
 */
const PULL_RESISTANCE = 0.5

/**
 * The single attribute this module's `startedInsideScrollContainer` looks
 * for. Three call sites mark themselves with it — the scores table's x-axis
 * wrapper (scores-table.tsx), TeamBoards' scroll-snap carousel track
 * (team-boards.tsx), and TeamSettingsDialog's `overflow-y-auto` panel
 * (team-settings-dialog.tsx) — because those are this app's other scroll
 * containers and none of them may have pull-to-refresh hijack a drag that
 * starts inside them. Exported so a future fourth scroll container can be
 * excluded the same way instead of by inventing its own selector.
 */
export const SCROLL_CONTAINER_SELECTOR = '[data-scroll-container]'

/**
 * The minimum this module needs from a touch's `event.target`. Structural,
 * like register-sw.ts's `NavigatorLike`, so a test can hand in a plain object
 * instead of standing up a real DOM node — this suite's default environment
 * is edge-runtime, which has no DOM at all.
 */
interface ClosestTarget {
  closest(selector: string): unknown
}

/**
 * Whether a touch that just landed on `target` started inside one of the
 * app's other scroll containers, and must therefore never arm
 * pull-to-refresh. `closest()` walks up through React portals' actual DOM
 * ancestry (a Radix `DialogContent` renders outside the React tree but is
 * still a real DOM descendant of whatever it portals into), so this catches
 * TeamSettingsDialog's panel the same way it catches the other two, with no
 * portal-specific case needed.
 */
export function startedInsideScrollContainer(target: ClosestTarget | null): boolean {
  if (!target) return false
  return target.closest(SCROLL_CONTAINER_SELECTOR) != null
}

/**
 * Whether a touch that just landed may begin a pull-to-refresh gesture.
 *
 * ALL THREE CONDITIONS, and dropping any one of them is exactly the class of
 * bug this feature is not allowed to ship with: `!isStandalone` is what keeps
 * this out of ordinary browser tabs (constraint 1 — they already have a
 * native pull-to-refresh, and a second one is a bug, not a feature);
 * `startedInExcludedContainer` is what keeps it out of the table's x-axis
 * scroller, the TeamBoards carousel and the settings dialog (constraint 2);
 * `scrollTop <= 0` is what keeps it from firing when the page itself is
 * scrolled down.
 *
 * `<= 0`, NOT `=== 0`. iOS Safari can report a momentarily negative
 * `scrollY` during its own elastic bounce at the top of the page — this is
 * the arming check, evaluated once at touchstart, and a bounce in progress at
 * that instant is still "at the top" from the gesture's point of view.
 */
export function canArmPull({
  isStandalone,
  scrollTop,
  startedInExcludedContainer,
}: {
  isStandalone: boolean
  scrollTop: number
  startedInExcludedContainer: boolean
}): boolean {
  if (!isStandalone) return false
  if (startedInExcludedContainer) return false
  return scrollTop <= 0
}

export type PullResult = {
  /** How far the indicator should sit, in CSS px. Never negative, never past PULL_MAX_PX. */
  distance: number
  /** Whether `distance` has reached the release threshold. */
  triggered: boolean
}

/**
 * Turns a raw vertical finger movement (px moved since the gesture armed)
 * into where the indicator sits and whether releasing now would refresh.
 *
 * `Math.max(0, rawDeltaY)` FIRST: an upward move (or no net move) clamps to
 * zero rather than going negative and pulling the indicator up past its rest
 * position — there is nothing above "not pulling" to show.
 *
 * `Math.min(PULL_MAX_PX, ...)` LAST: caps how far the indicator can travel
 * regardless of how far past the threshold the finger has gone, so a long,
 * fast pull cannot fling the indicator arbitrarily far down the screen.
 *
 * `triggered` uses `>=`, NOT `>`: a pull that lands EXACTLY on
 * PULL_TRIGGER_PX must count as a trigger, not fall one pixel short of one.
 */
export function computePull(rawDeltaY: number): PullResult {
  const distance = Math.min(PULL_MAX_PX, Math.max(0, rawDeltaY) * PULL_RESISTANCE)
  return { distance, triggered: distance >= PULL_TRIGGER_PX }
}
