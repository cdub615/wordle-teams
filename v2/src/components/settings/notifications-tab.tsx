import { convexQuery, useConvexMutation } from '@convex-dev/react-query'
import { useMutation, useQuery } from '@tanstack/react-query'
import { Loader2 } from 'lucide-react'
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
import { canonicalTimeZone, TIME_ZONE_GROUPS } from '#/lib/time-zones.ts'
import { useMediaQuery } from '#/lib/use-media-query.ts'

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
  // / [] from scratch. 'push' does not exist in this UI yet (the Push switch
  // is explicitly out of scope — it lands after a spike proves web push can
  // run at all), but a future player's row CAN already carry it, and a
  // from-scratch array here would silently erase it the first time this
  // player touched the Email switch.
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
              disabled={updateReminderMethods.isPending}
            />
            {updateReminderMethods.isPending && (
              <Loader2 className="h-4 w-4 shrink-0 animate-spin" aria-hidden="true" />
            )}
          </div>
        </div>
      </div>
    </div>
  )
}
