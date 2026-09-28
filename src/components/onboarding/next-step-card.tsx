import { useEffect, useRef } from 'react'
import { Link } from '@tanstack/react-router'
import { X } from 'lucide-react'
import { Button } from '#/components/ui/button.tsx'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '#/components/ui/card.tsx'
import { trackFunnel } from '#/lib/funnel.ts'
import {
  GRADUATION_BODY,
  GRADUATION_CTA,
  GRADUATION_TITLE,
  MODEL_LINE,
  cardHeading,
  incompleteTasks,
  shouldShowCard,
  shouldShowGraduation,
  taskSetKey,
  type OnboardingFacts,
  type OnboardingTaskId,
} from '#/lib/onboarding-tasks.ts'

/**
 * What a player who has not finished onboarding sees at the top of /app.
 *
 * REPLACES TeamsEmptyState OUTRIGHT. That component handled exactly one state —
 * "you have no team" — which is now one of three tasks here, and it rendered
 * INSTEAD of the dashboard, which is why a team-less player had nothing to do
 * (wordle-teams-456 traced a signup whose entire lifetime was 39 seconds and
 * ended on that screen).
 *
 * PRESENTATIONAL. Every action is a callback, because the dialogs these open
 * are already mounted by routes/app.tsx and owning them here would mean a
 * second CreateTeamDialog on the same page.
 *
 * TWO STATES, NOT ONE (wordle-teams-wty4.1.14.6). While tasks remain this is
 * the checklist; once none do it is the GRADUATION nudge toward /insights,
 * where it used to render nothing at all. Same card, same dismissal, no new
 * server flag — see shouldShowGraduation. The graduation CTA is the one action
 * here that is NOT a callback, and for the same reason the others are: nothing
 * needs mounting for a navigation, so it is a real `Link`.
 */
export function NextStepCard({
  facts,
  onBoard,
  onTeam,
  onInvite,
  onDismiss,
  className,
}: {
  facts: OnboardingFacts
  onBoard: () => void
  onTeam: () => void
  onInvite: () => void
  onDismiss: () => void
  /**
   * THE CALLER'S LAYOUT, NOT THIS COMPONENT'S, exactly as CheckoutPending takes
   * it — which is why NO margin or width is baked in here. routes/app.tsx
   * renders this on two branches that want genuinely different boxes: a plain
   * <main>, where it is a centred card with its own bottom margin, and a grid
   * whose every child needs `md:col-span-3` or lands in one of three columns
   * AND whose vertical rhythm is the grid's own `gap` — a baked-in `mb-4` made
   * this the one child with 24px under it where every other pair has 8px.
   *
   * A wrapper element in the grid would have solved the column half at the cost
   * of an empty grid item, and so a stray gap, on every render where this
   * returns null. THAT USED TO BE EVERY RENDER FOR AN ACTIVATED PLAYER and is
   * now only a DISMISSED one, since the graduation state renders a card where
   * the finished checklist rendered nothing — the argument is unchanged, the
   * frequency is not, and the sentence is corrected rather than deleted
   * because a reader weighing the wrapper alternative needs the real number.
   */
  className?: string
}) {
  const tasks = incompleteTasks(facts)
  const visible = shouldShowCard(facts)
  const graduating = shouldShowGraduation(facts)
  const key = taskSetKey(tasks)

  /**
   * THE DEDUPE, and the reason this component has a test at all.
   *
   * This card renders from a reactive Convex subscription, and getMyTeams is
   * invalidated by every team in the system (teams.ts:61). Emitting on render
   * would put an onboarding_view in LogSnag every time any stranger renamed a
   * team. The ref holds the task sets already reported in THIS mount, so the
   * event fires on genuine state changes and nothing else.
   *
   * A ref rather than state: recording what we sent must not itself cause a
   * render, or the effect re-runs and we are back where we started.
   *
   * PER MOUNT IS THE DELIBERATE SCOPE, not an accident of using a ref. A fresh
   * mount means a genuine navigation back to /app, which is a genuine new view;
   * hoisting this to a module-level Set would dedupe across the whole session
   * and make the view/click ratio meaningless as a funnel denominator, since
   * the clicks would keep counting while the views stopped. What the ref is
   * for is the SAME mount re-entering a set it already reported — see the
   * re-entry test, and note the dep array alone does not cover that.
   *
   * Allocated lazily inside the effect: `useRef(new Set())` would build and
   * discard a Set on every render.
   */
  const reported = useRef<Set<string> | null>(null)
  useEffect(() => {
    /*
      `tasks.length === 0` IS THE GRADUATION GUARD AND IT IS LOAD-BEARING
      (wordle-teams-wty4.1.14.6). `visible` alone stopped being enough the
      moment shouldShowCard dropped its task-count test: the card now RENDERS
      for a finished player, and onboarding_view is keyed to activation task
      sets. taskSetKey([]) is '', so without this every activated player would
      emit `onboarding_view` with an empty `tasks` on EVERY /app mount — the
      exact swamping the per-mount Set below exists to prevent, except the Set
      cannot help, because each mount is a fresh Set and a genuine new view.
      That is the view/click ratio this epic is measured by, destroyed by a
      denominator that counts the whole activated population every page load.
      The graduation CTA has its own event instead (onboarding_insights_click).

      A `tasks.length > 0` TEST RATHER THAN `key !== ''`, on purpose:
      taskSetKey's own doc comment warns callers off treating its empty string
      as a sentinel, and the count says what is meant without borrowing it.
    */
    if (!visible || tasks.length === 0) return
    const seen = (reported.current ??= new Set<string>())
    if (seen.has(key)) return
    seen.add(key)
    trackFunnel({ name: 'onboarding_view', tasks: key })
  }, [visible, tasks.length, key])

  /**
   * Completion, emitted once, ON THE TRANSITION rather than on the state.
   *
   * `sawIncomplete` is the whole point and this is wrong without it. An
   * activated player mounts this component on EVERY /app load with zero
   * incomplete tasks, so firing whenever `tasks.length === 0` would emit an
   * onboarding_complete per page view for the entire activated population —
   * swamping the channel and destroying the one number this epic is measured
   * by. The event has to mean "they just finished", which requires having seen
   * them unfinished first.
   *
   * A dismissal is deliberately NOT a completion; it is its own event, or the
   * activation number would flatter itself.
   *
   * `completed` IS A SEPARATE GUARD FROM `sawIncomplete`, AND ALSO LOAD-BEARING.
   * The dep is [tasks.length], so React's own memoization delivers "once" for a
   * one-way trip and hides this latch entirely. It earns its place on a ROUND
   * TRIP: tasks.length goes 0 -> 1 -> 0 whenever a fact comes back — a team is
   * deleted and recreated, an invite is cancelled, a dismissal is undone — and
   * without the latch every such cycle emits another onboarding_complete and
   * inflates the activation count permanently.
   */
  const sawIncomplete = useRef(false)
  const completed = useRef(false)
  useEffect(() => {
    if (tasks.length > 0) {
      sawIncomplete.current = true
      return
    }
    if (!sawIncomplete.current || completed.current) return
    completed.current = true
    trackFunnel({ name: 'onboarding_complete' })
  }, [tasks.length])

  if (!visible) return null

  /*
    An icon-only control needs a real accessible name. v1's tooltip-only OAuth
    labels are the cautionary tale this app already paid for
    (wordle-teams-390): a Tooltip does not open on tap, and the login traffic
    here is heavily iPhone.

    40x40 (`size="icon"` is h-10 w-10), UNDER THE 44pt THE iOS HIG ASKS FOR,
    AND KNOWINGLY SO. This is the primary escape hatch on a card shown to a
    heavily-iPhone audience, so the question is a fair one — but every
    `size="icon"` Button in this app is 40x40, and the two icon-only controls
    in the dashboard toolbar are 34px wide with a recorded reason. Fixing it
    HERE would make this the one control in the app with a bespoke touch target
    and would not help the others; the fix belongs in ui/button.tsx's `icon`
    size, as a project-wide call. Recorded rather than inherited silently.

    ONE DISMISS CONTROL, SHARED BY BOTH STATES, and one label for both.
    "Dismiss getting started" on a card headed "You are all set up" is a
    slightly odd sentence, and it is still the right one: the flag it writes is
    `players.onboardingDismissedAt`, and the only way back is app-menu.tsx's
    "Show getting started" menu item. A screen-reader user who dismissed an
    "insights tip" would be looking for a way to restore an insights tip and
    would not find one — the dismiss and the undo have to name the same thing.
    Changing both is a copy decision about the menu, not about this card.
  */
  const dismissButton = (
    <Button
      variant="ghost"
      size="icon"
      aria-label="Dismiss getting started"
      className="absolute right-2 top-2"
      onClick={() => {
        trackFunnel({ name: 'onboarding_dismiss' })
        onDismiss()
      }}
    >
      <X size={16} />
    </Button>
  )

  /*
    THE GRADUATION STATE — what used to be `return null`.

    A REAL `Link`, NOT A CALLBACK, which is the one place this card departs
    from the "every action is a callback" rule above. That rule exists because
    the task actions open DIALOGS that routes/app.tsx already mounts; a
    navigation mounts nothing, and routing it through a prop would cost the
    caller a `useRouter` and cost the reader the destination, which is the only
    interesting thing about this control.

    `asChild` PUTS THE BUTTON'S CLASSES ON THE ANCHOR rather than nesting an
    <a> inside a <button> — the same pairing insights/no-team-card.tsx uses,
    and the reason the router mock in this component's test must spread its
    rest props: Slot merges className and the handler onto the child.

    THE CLICK EMITS onboarding_insights_click AND NOT onboarding_task_click.
    See lib/funnel.ts — this is a browse nudge at the END of activation, and
    counting it as a task click would put it inside the denominators
    wordle-teams-456 is measured by.

    ACTING ON THE NUDGE ALSO SPENDS IT, which is why the CTA calls onDismiss
    alongside the navigation. Without that, a player who follows it comes back
    to the dashboard and finds the same card still asking — an outstanding
    action they have already taken, which is the one thing a card like this
    must not become (owner's report, wordle-teams-wty4.1.14.15).

    IT DOES NOT EMIT onboarding_dismiss, AND THAT IS THE POINT OF SPLITTING
    THEM. The X means "I do not want this"; the CTA means "yes". They write
    the same flag because there is only one, but firing the dismissal event
    here would count every engaged player as a rejection, inflate the dismiss
    rate and hide real rejection inside it. One flag, two events, and the
    event is the half that carries the intent.

    THE SHARED FLAG HAS A CONSEQUENCE WORTH KNOWING, and it is the same one
    the X already has: a later-incomplete task — a team deleted, an invite
    cancelled — will not bring the checklist back for this player. Accepted,
    because app-menu's "Show getting started" restores either state and
    because someone who has finished activation once is not the population
    that card exists for.
  */
  if (graduating) {
    return (
      <Card className={className}>
        <CardHeader className="relative">
          <CardTitle asChild>
            <h2>{GRADUATION_TITLE}</h2>
          </CardTitle>
          {/* `pr-10` KEEPS THE BODY CLEAR OF THE 40x40 DISMISS BUTTON pinned at
              `right-2 top-2`. The checklist's description is MODEL_LINE, which
              wraps to two lines and clears it on its own; this one is shorter
              and at ~400px its first line runs under the X without this. */}
          <CardDescription className="pr-10">{GRADUATION_BODY}</CardDescription>
          {dismissButton}
        </CardHeader>
        <CardContent>
          <Button asChild className="w-full">
            <Link
              to="/insights"
              onClick={() => {
                trackFunnel({ name: 'onboarding_insights_click' })
                onDismiss()
              }}
            >
              {GRADUATION_CTA}
            </Link>
          </Button>
        </CardContent>
      </Card>
    )
  }

  const act = (id: OnboardingTaskId, run: () => void) => () => {
    trackFunnel({ name: 'onboarding_task_click', task: id })
    run()
  }

  const runners: Record<OnboardingTaskId, () => void> = {
    board: onBoard,
    team: onTeam,
    invite: onInvite,
  }

  return (
    <Card className={className}>
      <CardHeader className="relative">
        <CardTitle asChild>
          <h2>{cardHeading(facts)}</h2>
        </CardTitle>
        <CardDescription>{MODEL_LINE}</CardDescription>
        {dismissButton}
      </CardHeader>
      <CardContent className="flex flex-col gap-2">
        {tasks.map((task) => (
          <Button
            key={task.id}
            variant="outline"
            className="h-auto w-full justify-start whitespace-normal py-3 text-left"
            onClick={act(task.id, runners[task.id])}
          >
            {/*
              `whitespace-normal` on the Button above overrides the
              `whitespace-nowrap` in buttonVariants' base (ui/button.tsx), and
              `break-words` here is the same pairing chat/message-list.tsx:721
              and confirm-popover.tsx:46 already use. Without both, the longest
              hint — "A scoreboard needs someone to score against" — escapes the
              button border at 360px and forces the whole document to scroll
              horizontally at 320px. `h-auto` lets the button grow but nothing
              in it lets the text wrap.
            */}
            <span className="flex flex-col items-start">
              <span className="font-semibold">{task.title}</span>
              <span className="text-muted-foreground break-words text-sm font-normal">
                {task.hint}
              </span>
            </span>
          </Button>
        ))}
      </CardContent>
    </Card>
  )
}
