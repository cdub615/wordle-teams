/**
 * "You used this one last" — the marker on a /login control, for the method
 * this device last COMPLETED a sign-in with (wordle-teams-ilej).
 *
 * VISIBLE TEXT, RENDERED INSIDE THE BUTTON, AND BOTH HALVES ARE THE
 * REQUIREMENT. Sitting in the control's children puts it in the control's
 * ACCESSIBLE NAME — "Google Last used" — so it is announced rather than being a
 * tint or a position. routes/login.tsx's SOCIAL_PROVIDERS comment carries the
 * incident this is deferring to: v1 shipped a 3x2 grid of icon-only provider
 * buttons whose labels existed only as sr-only text plus a hover Tooltip, and
 * tooltips do not appear on tap while the heaviest login traffic is iPhone.
 *
 * SO DO NOT REDUCE IT TO A DOT, a border colour or a `title`, and do not make
 * it `sr-only` either — the returning player it exists for is usually a sighted
 * one who is scanning five buttons. Both failure modes are executed in
 * last-used-badge.hook.test.ts rather than described here.
 *
 * IT LIVES IN components/ RATHER THAN IN routes/login.tsx, WHICH IS WHAT MAKES
 * THE ABOVE TESTABLE. Inside the route it could only be reached by a regex
 * slice over the file text — and that slice truncated at the first `\n}`, so
 * wrapping the span in a fragment silently shortened it and the "not
 * aria-hidden" assertion passed on the remains. A component file renders under
 * jsdom with no router, no mock and no vacuity.
 */
export function LastUsedBadge() {
  return (
    <span className="rounded-full bg-muted px-2 py-0.5 text-xs font-medium text-muted-foreground">
      Last used
    </span>
  )
}
