import { Link } from '@tanstack/react-router'
import { Button } from '#/components/ui/button.tsx'
import { CLOSING } from './marketing-copy.ts'

/**
 * The last thing on the page: one price, one sign-up, one link for the rest.
 *
 * THE ANNUAL PRICE AND NOTHING ELSE. plans.ts's `PRO_PRICE_LINE` is composed
 * into CLOSING.line so this page cannot disagree with /pricing or the upgrade
 * dialog, and the monthly one is deliberately absent — plans.ts's header notes
 * that whether monthly READS as the better value "is a question of prominence
 * and layout on the surface that renders it", and a landing page that quotes
 * two numbers has made a comparison whether it meant to or not. The page that
 * owns that comparison is /pricing, and this links to it.
 *
 * THE PAGE'S THIRD CTA AND ITS SECOND "Get Started", AND THAT REPETITION IS THE
 * DESIGN. v1's landing already had two CTAs to one destination; a reader who
 * scrolled six sections should not have to scroll back to act on it. e2e/routes.spec.ts
 * asserts every one of them resolves to /login rather than asserting there is
 * one — which is the assertion that would catch a CTA quietly re-pointed at
 * /app, the mutation that got through when only the hero's was pinned.
 *
 * THE /pricing LINK IS A LINK, NOT A SECOND BUTTON. Two buttons of equal weight
 * is two answers to "what do I do now"; the sign-up is the answer and the price
 * page is for the reader who wants to know more first.
 */
export function ClosingCta() {
  return (
    <section className="px-4 py-14 md:py-20">
      <div className="mx-auto flex max-w-xl flex-col items-center gap-5 text-center">
        <p className="font-display m-0 text-2xl font-bold text-balance text-foreground md:text-3xl">
          {CLOSING.line}
        </p>
        <Button asChild size="lg">
          <Link to="/login" className="no-underline">
            {CLOSING.cta}
          </Link>
        </Button>
        {/* No colour utility: src/styles.css's base layer paints a prose
            anchor --accent-solid, and overriding that with text-muted-foreground
            left the page's one non-button link looking like a caption. */}
        <Link to="/pricing" className="text-sm">
          {CLOSING.proLink}
        </Link>
      </div>
    </section>
  )
}
