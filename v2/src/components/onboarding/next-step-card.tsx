import { useEffect, useRef } from 'react'
import { X } from 'lucide-react'
import { Button } from '#/components/ui/button.tsx'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '#/components/ui/card.tsx'
import { cn } from '#/lib/utils.ts'
import { trackFunnel } from '#/lib/funnel.ts'
import {
  MODEL_LINE,
  cardHeading,
  incompleteTasks,
  shouldShowCard,
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
   * it. routes/app.tsx renders this on two branches: a plain <main>, and a grid
   * whose every child needs `md:col-span-3` or lands in one of three columns.
   * A wrapper element there would leave an empty grid item — and so a gap — on
   * every render where this returns null, which is every render for an
   * activated player.
   */
  className?: string
}) {
  const tasks = incompleteTasks(facts)
  const visible = shouldShowCard(facts)
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
    if (!visible) return
    const seen = (reported.current ??= new Set<string>())
    if (seen.has(key)) return
    seen.add(key)
    trackFunnel({ name: 'onboarding_view', tasks: key })
  }, [visible, key])

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
    <Card className={cn('mb-4', className)}>
      <CardHeader className="relative">
        <CardTitle asChild>
          <h2>{cardHeading(facts)}</h2>
        </CardTitle>
        <CardDescription>{MODEL_LINE}</CardDescription>
        {/*
          An icon-only control needs a real accessible name. v1's tooltip-only
          OAuth labels are the cautionary tale this app already paid for
          (wordle-teams-390): a Tooltip does not open on tap, and the login
          traffic here is heavily iPhone.
        */}
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
