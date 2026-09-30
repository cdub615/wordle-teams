import { useEffect, useState } from 'react'
import { checkoutReturnUrl } from '#/lib/checkout-return.ts'
import { cn } from '#/lib/utils.ts'

/**
 * True once this document turned out to be the return trip from Polar's hosted
 * checkout. Never flips back: the marker is stripped on the way through, so
 * what ends the pending state below is `amIPro` going true, not this.
 *
 * A HOOK RATHER THAN STATE INSIDE THE NOTICE, because routes/app.tsx returns
 * from three different places — the empty state, the pre-sync skeleton and the
 * dashboard grid — and a component mounted in all three would be a DIFFERENT
 * component in each, remounted with `returning` back to false the moment the
 * page moved between them. By then the marker is gone and it could never come
 * back. Holding the flag in the caller, which does not unmount, is what makes
 * the notice survive the skeleton→grid transition every load performs.
 *
 * NO REF GUARD, unlike v1's. React Strict Mode double-invokes this effect; the
 * second pass reads the URL the first one already stripped, gets null and does
 * nothing, while the flag it would have set is set. v1 needed its `handled` ref
 * because its effect performed a session refresh, which is exactly the part v2
 * does not have. See lib/checkout-return.ts.
 *
 * NO TIMER EITHER. `amIPro` is a reactive Convex subscription, so a webhook
 * that lands late updates the page by itself; there is nothing a retry could
 * ask that the subscription is not already watching.
 */
export function useCheckoutReturn(): boolean {
  const [returning, setReturning] = useState(false)

  useEffect(() => {
    const stripped = checkoutReturnUrl(window.location.href)
    if (stripped === null) return
    setReturning(true)
    // Drop the marker so a reload does not re-enter this state. Same
    // replaceState the login-funnel effect in routes/app.tsx uses on
    // SIGNIN_PARAM, and for the same reason.
    window.history.replaceState({}, '', stripped)
  }, [])

  return returning
}

/**
 * What the player sees between arriving back from checkout and the webhook
 * landing.
 *
 * THE HONEST VERSION OF v1'S RETRY. v1 re-fetched because it had to; v2 waits
 * because it does not, so this says what is actually happening and then gets
 * out of the way on its own when `amIPro` flips. The caller renders it only
 * while the upgrade has not landed — there is nothing to dismiss and no button
 * to press, which is why it carries neither.
 *
 * `role="status"` MAKES IT A LIVE REGION: it appears after the page has already
 * rendered and disappears without any interaction, so a screen reader that only
 * read the document once would otherwise never announce either event.
 */
export function CheckoutPending({ className }: { className?: string }) {
  return (
    <p role="status" className={cn('text-muted-foreground text-sm', className)}>
      Finishing your upgrade… this page will update on its own.
    </p>
  )
}
