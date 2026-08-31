import { convexQuery, useConvexMutation } from '@convex-dev/react-query'
import { useMutation, useQuery } from '@tanstack/react-query'
import { Loader2 } from 'lucide-react'
import { useState } from 'react'
import { toast } from 'sonner'
import { api } from '../../../convex/_generated/api'
import { REMINDER_TIMES } from '../../../convex/lib/reminders.ts'
import { Label } from '#/components/ui/label.tsx'
import {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectLabel,
  SelectTrigger,
  SelectValue,
} from '#/components/ui/select.tsx'
import { Separator } from '#/components/ui/separator.tsx'
import { Switch } from '#/components/ui/switch.tsx'
import { mutationErrorMessage } from '#/lib/convex-error.ts'
import { browserPush, subscribeToPush, unsubscribeFromPush } from '#/lib/push-subscribe.ts'
import { canonicalTimeZone, TIME_ZONE_GROUPS } from '#/lib/time-zones.ts'
import { useMediaQuery } from '#/lib/use-media-query.ts'
import type { SubscribeFailureReason } from '#/lib/push-subscribe.ts'

/**
 * '13:00:00' -> '1 PM'. Display only; never sent to the server.
 *
 * ONLY FOR A VALUE REMINDER_TIMES ACTUALLY OFFERS. A value outside that list
 * — reachable only from data older than updateReminderTimeFor's validation,
 * since nothing this UI writes can produce one — is returned RAW rather than
 * run through the on-the-hour arithmetic below: '23:30:00' sliced and rounded
 * would print '11 PM', a plausible-looking, on-the-hour string that is
 * neither what is stored nor a time the sweep (isDueThisHour) can ever match.
 * Showing the raw string is honest about that; a confident-looking wrong
 * answer is worse than an odd-looking right one.
 */
export function label(time: string): string {
  if (!REMINDER_TIMES.includes(time)) return time
  const hour = Number(time.slice(0, 2))
  const suffix = hour < 12 ? 'AM' : 'PM'
  const twelve = hour % 12 === 0 ? 12 : hour % 12
  return `${twelve} ${suffix}`
}

/**
 * The time zone trigger's own text: `shortLabel` below 640px, `label` above —
 * v1's behaviour (user-dialog.tsx's `displayValue`, `useMediaQuery('(max-width:
 * 640px)')`). Falls back to a placeholder while nothing is stored yet, which
 * is the ordinary state for a player who has never opened this tab.
 *
 * TAKES THE CANONICAL ZONE, ALREADY RUN THROUGH `canonicalTimeZone` — see that
 * function's doc comment. Passing the raw stored value here would silently
 * fall through to the placeholder for any copied row still carrying v1's
 * Postgres spelling, telling a player their time zone is unset when it is
 * not.
 */
function timeZoneDisplay(canonicalZone: string | null, isSmallScreen: boolean): string {
  for (const group of TIME_ZONE_GROUPS) {
    const found = group.items.find((item) => item.value === canonicalZone)
    if (found) return isSmallScreen ? found.shortLabel : found.label
  }
  return 'Select a time zone'
}

/**
 * What to say when a subscribe attempt did not produce something we can store.
 *
 * A SEPARATE STRING PER REASON, and none of them is `mutationErrorMessage`'s
 * generic fallback, because these three are the only failures on this tab the
 * player can actually do something about — and the actions differ: 'denied' is
 * fixed in site settings, 'unavailable' cannot be fixed at all and points at
 * the Email switch instead, and 'no-keys' is worth one retry.
 *
 * TOTAL OVER SubscribeFailureReason on purpose — the parameter is that union
 * rather than a bare `string`, and the `default` branch assigns to `never` — so
 * adding a reason in push-subscribe.ts stops compiling here instead of silently
 * falling through to a message written for a different failure.
 */
export function pushFailureMessage(reason: SubscribeFailureReason): string {
  switch (reason) {
    case 'denied':
      // Covers a dismissed prompt as well as a refusal — see subscribeToPush.
      // Deliberately does not say "you denied it": on a second attempt Chrome
      // never re-prompts and the player has to change it in site settings, so
      // naming that is the only useful thing this message can do.
      return 'Notifications are blocked for this site. Allow them in your browser settings to turn this on.'
    case 'unavailable':
      return "This browser can't deliver push notifications. Email reminders still work."
    case 'no-keys':
      // Should be unreachable from a real browser. Says what to do rather than
      // explaining a cause nobody outside this file could act on.
      return 'Your browser did not return a usable subscription. Try again, or use email reminders.'
    default: {
      const exhaustive: never = reason
      return exhaustive
    }
  }
}

/**
 * Timezone select, reminder-time select, Email switch. Notifications tab of
 * the settings dialog (Phase 6, Task 6) — the only one of the dialog's pieces
 * with real behaviour; install-guide-tab.tsx is static copy.
 *
 * EVERY CONTROL IS FIRE-AND-REPORT, matching current-team-card.tsx:
 * `toast.success` on success, `mutationErrorMessage` routed to `toast.error`
 * on failure — never a thrown error left for React to render as a crashed
 * tab. UNLIKE current-team-card.tsx's buttons, though, a pending control here
 * stays MOUNTED and merely `disabled`, with the spinner beside it rather than
 * replacing it — matching Header.tsx's Billing button, which keeps its own
 * label mounted and swaps only the icon. Swapping the whole control out (an
 * earlier version of this file did) breaks the `<Label htmlFor>` association
 * for exactly as long as the mutation is in flight, since the element the
 * `id` lives on stops existing.
 */
export default function NotificationsTab() {
  const { data: settings, error } = useQuery(convexQuery(api.settings.mySettings, {}))
  const isSmallScreen = useMediaQuery('(max-width: 640px)')

  const updateTimeZone = useMutation({ mutationFn: useConvexMutation(api.settings.updateTimeZone) })
  const updateReminderTime = useMutation({ mutationFn: useConvexMutation(api.settings.updateReminderTime) })
  const updateReminderMethods = useMutation({ mutationFn: useConvexMutation(api.settings.updateReminderMethods) })

  // THE WHOLE OF RULE 1: no key, no switch. `publicKey` is a query rather than
  // a `VITE_` variable precisely so this can be decided from the deployment
  // that would have to send the notification (convex/push.ts), and `undefined`
  // — still loading, or the query itself failed — hides the switch too. A
  // control that cannot work is worse than no control, and a control that
  // appears a beat late is better than one that appears and then vanishes.
  const { data: vapidPublicKey } = useQuery(convexQuery(api.push.publicKey, {}))
  const savePushSubscription = useMutation({ mutationFn: useConvexMutation(api.push.savePushSubscription) })
  const removePushSubscription = useMutation({ mutationFn: useConvexMutation(api.push.removePushSubscription) })

  // Local rather than any mutation's `isPending`: the slow part of turning
  // push on is the browser — the permission prompt and `pushManager.subscribe`
  // — and neither is a mutation, so nothing in react-query knows the toggle is
  // in flight. Without this the switch stays live while a prompt is open and a
  // second click starts the whole flow again.
  const [pushPending, setPushPending] = useState(false)

  // mySettings calls requirePlayer, which throws NO_PLAYER for a signed-in
  // session with no players row yet — and Header.tsx mounts globally,
  // including on /complete-profile, where that is the expected state (see
  // players.ts's `myName` doc comment, which chose `currentPlayer` over
  // `requirePlayer` for the exact same reason). Reading `error` here rather
  // than only `data` is what stops that from being a silent, permanent
  // "loading" spinner with no way out: NO_PLAYER's own copy — "Finish setting
  // up your profile to continue." — happens to be exactly right for this
  // screen too.
  if (error) {
    return (
      <div className="flex flex-col items-center justify-center gap-2 py-10 text-center text-sm text-muted-foreground">
        {mutationErrorMessage(error, 'Could not load your notification settings.')}
      </div>
    )
  }

  // Radix's Select is UNCONTROLLED once it mounts: `defaultValue` is read only
  // on the FIRST render. Mounting before mySettings resolves would not freeze
  // the VISIBLE text — SelectValue's children below are always this
  // component's own computed string, never Radix's internal value — but it
  // would freeze which item Radix marks selected internally (the checkmark,
  // and where keyboard navigation starts) on whatever `defaultValue` happened
  // to be at that first instant. v1 sidesteps the whole question by gating
  // its block on `timeZone &&` (user-dialog.tsx:128).
  //
  // THE HARDER FAILURE, and the one that actually forces this early return:
  // before `settings` resolves, `reminderDeliveryTime` is `undefined`, and
  // `label(undefined)` calls `.slice` on it — an outright TypeError, not a
  // display quirk. This is a loading state the tab cannot render without,
  // not a guessed default it would be nice to avoid.
  if (!settings) {
    return (
      <div className="flex items-center justify-center py-10">
        <Loader2 className="h-5 w-5 animate-spin" aria-hidden="true" />
        <span className="sr-only">Loading notification settings…</span>
      </div>
    )
  }

  const { timeZone, reminderDeliveryTime, reminderDeliveryMethods } = settings
  const canonicalZone = canonicalTimeZone(timeZone)

  const handleTimeZoneChange = async (value: string) => {
    try {
      await updateTimeZone.mutateAsync({ timeZone: value })
      toast.success('Time zone updated')
    } catch (error) {
      toast.error(mutationErrorMessage(error, 'Failed to update time zone'))
    }
  }

  const handleReminderTimeChange = async (value: string) => {
    try {
      await updateReminderTime.mutateAsync({ time: value })
      toast.success('Delivery time updated')
    } catch (error) {
      toast.error(mutationErrorMessage(error, 'Failed to update delivery time'))
    }
  }

  // Rebuilds the array from the CURRENT one rather than constructing ['email']
  // / [] from scratch, because 'push' now lives in the same field and the Push
  // switch below writes it. A from-scratch array here would silently drop a
  // player's push subscription from their delivery methods the first time they
  // touched the Email switch — leaving the subscription stored, the switch
  // showing off on the next load, and no notification ever sent. The push
  // handler is symmetric for the same reason.
  const handleEmailToggle = async (checked: boolean) => {
    const methods = checked
      ? Array.from(new Set([...reminderDeliveryMethods, 'email']))
      : reminderDeliveryMethods.filter((method) => method !== 'email')
    try {
      await updateReminderMethods.mutateAsync({ methods })
      toast.success('Delivery methods updated')
    } catch (error) {
      toast.error(mutationErrorMessage(error, 'Failed to update delivery methods'))
    }
  }

  /**
   * RULE 2 IS THE ORDER OF THE TWO WRITES, not a branch anywhere below.
   * `subscribeToPush` must succeed, and `savePushSubscription` must land,
   * BEFORE 'push' is written into reminderDeliveryMethods — every failure
   * before that point returns or throws, and the method is never written. The
   * switch's own `checked` comes from the server's array, so nothing here
   * flips it optimistically either: a refused permission leaves it visibly
   * off, which is the truth.
   *
   * The inverse for turning it off: the stored row goes first and the method
   * goes with it unconditionally, so an off is honoured even on a browser that
   * cannot subscribe at all.
   */
  const handlePushToggle = async (checked: boolean) => {
    setPushPending(true)
    try {
      const browser = browserPush()
      if (!browser) {
        toast.error(pushFailureMessage('unavailable'))
        return
      }

      if (checked) {
        // Not `vapidPublicKey!`: the switch only renders when this is a
        // string, but a narrowing that lives in JSX is not one TypeScript can
        // see here, and an assertion would turn a future regression into a
        // subscription bound to the string "undefined".
        if (!vapidPublicKey) {
          toast.error(pushFailureMessage('unavailable'))
          return
        }
        const result = await subscribeToPush(browser, vapidPublicKey)
        if (!result.ok) {
          toast.error(pushFailureMessage(result.reason))
          return
        }
        await savePushSubscription.mutateAsync(result.subscription)
        await updateReminderMethods.mutateAsync({
          methods: Array.from(new Set([...reminderDeliveryMethods, 'push'])),
        })
      } else {
        const { endpoint, unsubscribeError } = await unsubscribeFromPush(browser)
        // Deleting the row is what stops delivery, so it happens whether or
        // not the browser-side unsubscribe worked — see unsubscribeFromPush.
        if (endpoint) await removePushSubscription.mutateAsync({ endpoint })
        await updateReminderMethods.mutateAsync({
          methods: reminderDeliveryMethods.filter((method) => method !== 'push'),
        })
        if (unsubscribeError) {
          // Not a toast and not Sentry: the player asked for push off and push
          // is off. What survives is an inert browser-side subscription that
          // the next 'on' reuses. console.warn is what the eslint config
          // leaves open in src/ for exactly this (see register-sw.ts).
          console.warn('Push unsubscribe failed locally; the stored subscription was removed', {
            message: unsubscribeError instanceof Error ? unsubscribeError.message : String(unsubscribeError),
          })
        }
      }
      toast.success('Delivery methods updated')
    } catch (error) {
      toast.error(mutationErrorMessage(error, 'Failed to update delivery methods'))
    } finally {
      setPushPending(false)
    }
  }

  return (
    <div className="flex flex-col space-y-6 py-4">
      <div className="flex flex-col space-y-1.5">
        <h3 className="text-lg font-semibold leading-none tracking-tight">Notification Settings</h3>
        <p className="text-sm text-muted-foreground">Review and manage your notification settings</p>
      </div>

      <div className="flex items-center justify-between gap-4">
        <Label htmlFor="time-zone-select">Time Zone</Label>
        <div className="flex items-center gap-2">
          <Select
            onValueChange={handleTimeZoneChange}
            defaultValue={canonicalZone ?? undefined}
            disabled={updateTimeZone.isPending}
          >
            <SelectTrigger id="time-zone-select" className="w-[115px] md:w-[280px]">
              <SelectValue>{timeZoneDisplay(canonicalZone, isSmallScreen)}</SelectValue>
            </SelectTrigger>
            <SelectContent className="max-h-[300px] overflow-y-auto">
              {TIME_ZONE_GROUPS.map((group) => (
                <SelectGroup key={group.label}>
                  <SelectLabel>{group.label}</SelectLabel>
                  {group.items.map((item) => (
                    <SelectItem key={item.value} value={item.value}>
                      {item.label}
                    </SelectItem>
                  ))}
                </SelectGroup>
              ))}
            </SelectContent>
          </Select>
          {updateTimeZone.isPending && (
            <Loader2 className="h-4 w-4 shrink-0 animate-spin" aria-hidden="true" />
          )}
        </div>
      </div>

      <Separator />

      <div className="flex flex-col space-y-4">
        <div className="flex items-center justify-between gap-4">
          <div className="flex flex-col space-y-1">
            <Label htmlFor="reminder-time-select">Board Entry Reminder</Label>
            <p className="text-sm text-muted-foreground">Daily reminder for incomplete boards</p>
          </div>
          <div className="flex items-center gap-2">
            <Select
              onValueChange={handleReminderTimeChange}
              defaultValue={reminderDeliveryTime}
              disabled={updateReminderTime.isPending}
            >
              <SelectTrigger id="reminder-time-select" className="w-[100px]">
                <SelectValue>{label(reminderDeliveryTime)}</SelectValue>
              </SelectTrigger>
              <SelectContent className="max-h-[300px] overflow-y-auto">
                {REMINDER_TIMES.map((time) => (
                  <SelectItem key={time} value={time}>
                    {label(time)}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            {updateReminderTime.isPending && (
              <Loader2 className="h-4 w-4 shrink-0 animate-spin" aria-hidden="true" />
            )}
          </div>
        </div>

        <div className="flex items-center justify-between">
          <Label htmlFor="email-reminders">Email</Label>
          <div className="flex items-center gap-2">
            <Switch
              id="email-reminders"
              checked={reminderDeliveryMethods.includes('email')}
              onCheckedChange={handleEmailToggle}
              disabled={updateReminderMethods.isPending || pushPending}
            />
            {updateReminderMethods.isPending && !pushPending && (
              <Loader2 className="h-4 w-4 shrink-0 animate-spin" aria-hidden="true" />
            )}
          </div>
        </div>

        {/*
          RENDERED ONLY WHERE PUSH IS CONFIGURED. `vapidPublicKey` is null on a
          deployment with no VAPID_PUBLIC_KEY set — including the local
          anonymous backend the e2e suite runs against, which is what
          e2e/settings.spec.ts asserts on. Nothing else on this tab is
          conditional, and this one is: a switch that subscribes against a key
          nobody holds looks like it worked and never delivers anything.
        */}
        {vapidPublicKey && (
          <div className="flex items-center justify-between">
            <Label htmlFor="push-reminders">Push</Label>
            <div className="flex items-center gap-2">
              <Switch
                id="push-reminders"
                // FROM THE SERVER'S ARRAY, never from local state. This is what
                // makes a denied permission leave the switch visibly off: the
                // handler returns before writing 'push', so there is nothing
                // for this to read back.
                checked={reminderDeliveryMethods.includes('push')}
                onCheckedChange={handlePushToggle}
                disabled={pushPending || updateReminderMethods.isPending}
              />
              {pushPending && <Loader2 className="h-4 w-4 shrink-0 animate-spin" aria-hidden="true" />}
            </div>
          </div>
        )}
      </div>
    </div>
  )
}
