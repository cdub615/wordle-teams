import { KeyRound, Loader2 } from 'lucide-react'
import { useState } from 'react'
import { toast } from 'sonner'
import { Button } from '#/components/ui/button.tsx'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '#/components/ui/dialog.tsx'
import { rememberPasskeyDeclined } from '#/lib/passkey.ts'
import { ALREADY_REGISTERED_MESSAGE, registerPasskey } from '#/lib/register-passkey.ts'

/**
 * "Sign in faster next time" — the one-per-device passkey offer, shown after a
 * completed sign-in (wordle-teams-wty4.1.7.3).
 *
 * WHO DECIDES *WHETHER* TO ASK IS NOT THIS COMPONENT. routes/app.tsx's arrival
 * effect does, and that is deliberate rather than an omission. That effect is
 * already the app's single confirmed "they made it" moment — it is where
 * `login_callback_arrived` is emitted and where `promoteLoginAttempt()` runs —
 * and src/lib/last-login.ts's header sets out at length why a SECOND notion of
 * "just signed in" is the thing to avoid. So the trigger is a prop, the
 * suppression rules live in `shouldOfferPasskey()`, and this file owns only
 * what happens once the question has been asked.
 *
 * A MODAL, WHICH IS THE POINT AND THE RISK. The issue's own framing is that an
 * offer nobody sees produces no passkeys, and a strip on a dashboard that the
 * player has come to read something else on is an offer nobody sees. The cost
 * is that it lands in front of someone who did not ask for it, which is why
 * every way out of it is honoured exactly once — see below — and why the
 * Settings tab exists as the way back in.
 *
 * A CLOSED RADIX DIALOG EMITS NO DOM, which is what makes it safe for /app to
 * mount this on all three of its returns at a stable child index. It also means
 * nothing here runs on the server: the storage reads below are reached only
 * from a click.
 *
 * EVERY WAY OUT IS A DECLINE, AND THAT IS THE LOAD-BEARING DECISION. Radix
 * closes on Escape, on an overlay click and on the X in its own corner, none of
 * which pass through the "Not now" button. Writing the marker only in that
 * button's handler leaves anyone who pressed Escape — the ordinary reflex for
 * an unexpected modal — being asked again after every single sign-in, forever,
 * with no control anywhere that stops it. That is the nagging loop
 * lib/passkey.ts's header exists to rule out, so `onOpenChange` is where the
 * write goes and the button merely calls the same path.
 *
 * A CONTROLLED CLOSE IS NOT A DISMISSAL. Radix fires `onOpenChange` for
 * user-initiated changes only, so the `onClose()` this component calls after a
 * successful registration does NOT come back through the decline path. That is
 * what keeps `registered` and `declined` — which lib/passkey.ts is emphatic are
 * not interchangeable — from both being set for one sign-in.
 */
export function PasskeyOffer({ open, onClose }: { open: boolean; onClose: () => void }) {
  // A LOCAL FLAG, not a mutation's `isPending`: the slow part is outside every
  // cache. A WebAuthn prompt is a modal system sheet that can sit open for as
  // long as the player takes to present a finger, and without this both
  // controls stay live underneath it. security-tab.tsx disables its Add button
  // for the same reason; this additionally disables "Not now", because a
  // decline recorded mid-ceremony would be followed by the registration's own
  // marker write and leave BOTH flags set for one sign-in. The button's
  // `disabled` is the VISIBLE half of that; `decline` below is the half that
  // actually holds, because Escape does not go near a button.
  const [adding, setAdding] = useState(false)

  /**
   * `adding` IS CHECKED HERE AND NOT ONLY ON THE BUTTON, and that is the reason
   * this is a function rather than two lines inlined into `onOpenChange`.
   * Disabling "Not now" stops the BUTTON during a ceremony; it does nothing
   * about Escape, an overlay click or the X, all of which Radix routes through
   * `onOpenChange` whatever the buttons look like. Without this line a player
   * who presses Escape while the system sheet is up records a decline for a
   * registration that then succeeds and records itself — leaving BOTH markers
   * set for one sign-in, which lib/passkey.ts is explicit are not two names for
   * the same thing. Refusing to dismiss mid-ceremony is also simply the right
   * behaviour: there is a prompt open that the page cannot cancel.
   */
  const decline = () => {
    if (adding) return
    rememberPasskeyDeclined()
    onClose()
  }

  const accept = async () => {
    setAdding(true)
    try {
      const result = await registerPasskey()
      // THE CEREMONY WAS CANCELLED, WHICH IS NOT THIS OFFER BEING DISMISSED.
      // The dialog that asked is still on screen and the player may press it
      // again; a toast here would scold them for using the cancel button their
      // own operating system drew. Nothing is said and nothing is recorded.
      if (result.outcome === 'aborted') return
      if (result.outcome === 'failed') {
        // STAYS OPEN. Closing on a failure throws away the only control that
        // can retry, and the failure is not evidence about this device either
        // way — so no marker is written and the offer survives to next time.
        toast.error(result.message)
        return
      }
      if (result.outcome === 'already-registered') {
        // `toast.info`, WHERE THE SETTINGS TAB USES `toast.error` FOR THE SAME
        // OUTCOME, and the divergence is deliberate. There it answers a player
        // who went looking for a NEW passkey and did not get one. Here it
        // answers the app's own question, and the answer is that the question
        // should not have been asked: nothing is wrong and there is nothing to
        // do. `registerPasskey` has already written the registered marker off
        // the authenticator's own evidence, so this offer is over.
        toast.info(ALREADY_REGISTERED_MESSAGE)
      } else {
        toast.success('Passkey added')
      }
      onClose()
    } finally {
      setAdding(false)
    }
  }

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        // EVERY dismissal, not just the button. See the header.
        if (!next) decline()
      }}
    >
      <DialogContent data-testid="passkey-offer">
        <DialogHeader>
          {/*
            THE BENEFIT, NOT THE JARGON. "Passkey" is still an unfamiliar word
            to most of this app's players; the fingerprint and the face are not.
            The word appears on the button, where it labels the thing they are
            agreeing to, rather than in the heading where it would be the first
            and least useful thing they read.
          */}
          <DialogTitle className="flex items-center gap-2">
            <KeyRound className="h-5 w-5 shrink-0 text-muted-foreground" aria-hidden="true" />
            Sign in faster next time
          </DialogTitle>
          {/*
            NO SIGN-IN METHOD IS NAMED AS THE ONE BEING REPLACED, deliberately:
            this offer follows a social sign-in as often as an email code, and
            copy about "waiting for a code" is simply wrong for most of the
            people reading it. The second sentence is the reassurance the whole
            feature is constrained by — nothing was taken away — and it is what
            lets a player decline without feeling they have lost an option.
          */}
          <DialogDescription>
            Sign in with your fingerprint, face or screen lock instead. Your email code and social
            sign-ins keep working either way.
          </DialogDescription>
        </DialogHeader>
        {/*
          `gap-2 sm:space-x-0` RATHER THAN A BARE `gap-2`. DialogFooter is
          `flex-col-reverse` below `sm` with NO gap of its own — its spacing is
          `sm:space-x-2`, a horizontal margin that does nothing in a vertical
          stack — so two buttons sit flush against each other on a phone. Adding
          only the gap would then leave 8px of gap AND 8px of margin side by side
          at `sm`; dropping the margin there keeps one 8px rhythm at both widths.
          Every other DialogFooter in this app holds a single button, so this is
          the first caller the missing base gap could bite.
        */}
        <DialogFooter className="gap-2 sm:space-x-0">
          <Button type="button" variant="ghost" disabled={adding} onClick={decline}>
            Not now
          </Button>
          {/*
            NOT THE SETTINGS TAB'S "Add a passkey" LABEL, deliberately. The two
            controls can be on screen together — the settings dialog opens over
            this page — and two buttons with one accessible name is an ambiguous
            target for a screen reader and a strict-mode failure for any
            Playwright locator that names it.
          */}
          <Button type="button" disabled={adding} onClick={() => void accept()}>
            {adding ? <Loader2 className="mr-2 h-4 w-4 animate-spin" aria-hidden="true" /> : null}
            Set up a passkey
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
