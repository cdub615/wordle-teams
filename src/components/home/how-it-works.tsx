import { HOW_IT_WORKS, SECTION_TITLES } from './marketing-copy.ts'

/**
 * The three steps, on the page's one band of a different shade.
 *
 * THIS SECTION INHERITS feature-cards.tsx's SURFACE AND ITS MEASUREMENTS. That
 * component is deleted; the band it introduced is not, because the reasoning
 * behind it was about the design system rather than about six cards.
 * --surface-sunken is "one step off --background" in both themes and pairs with
 * --text / --text-muted, which is the "background and foreground travel
 * together" rule. Against --surface-sunken, --text measures 18.00:1 light
 * (#0a0a0b on #f4f4f5) and 16.33:1 dark; --text-muted measures 4.80:1 light
 * (#6b6b74 on #f4f4f5) and 6.76:1 dark. src/styles.css's note on --text-muted
 * is written against THIS band — it is the only place normal-sized body copy
 * sits on the sunken surface, which is what made the token's old value
 * (#71717a, 4.40 here) a real AA failure rather than a theoretical one. That
 * note names this file.
 *
 * THE STEP NUMBERS ARE `text-accent-solid`, one accent on one surface, which is
 * the same decision the deleted feature-cards.tsx made for its icons: "one
 * accent per surface. Green earns attention" (DESIGN_SYSTEM.md section 3).
 *
 * THEY MEASURE 4.56:1 LIGHT (#15803d on #f4f4f5) AND 7.48:1 DARK, AND THE BAR
 * THEY HAVE TO CLEAR IS 3:1. A numeral is text, not a graphic, so the icons'
 * non-text exemption does not carry over — but `text-xl font-bold` is 20px
 * bold, which is LARGE text under WCAG's 18.66px-bold threshold, and large
 * text's bar is the same 3:1. The figures clear the normal-text 4.5 as well, so
 * this holds whichever reading applies; src/styles.test.ts asserts the 3:1 and
 * says why it does not assert more.
 *
 * AN <ol>, NOT THREE <div>s. The order is the claim: you cannot enter a board
 * for a team you have not made, and a screen reader announcing "list of 3
 * items" is the whole difference between a sequence and three facts. `grid`
 * suppresses the markers, which is why the numerals are drawn rather than
 * inherited — a marker cannot be given the accent colour or the circle.
 *
 * NO <h1>. Landing.tsx's rule: Title renders the page's only one, so every
 * section heading here is an h2 with h3s beneath it.
 */
export function HowItWorks() {
  return (
    <section className="w-full bg-surface-sunken py-12 md:py-20">
      <div className="page-wrap">
        <h2 className="font-display m-0 text-center text-2xl font-bold text-foreground md:text-4xl">
          {SECTION_TITLES.howItWorks}
        </h2>
        <ol className="mt-10 grid grid-cols-1 gap-10 md:mt-14 md:grid-cols-3 md:gap-12">
          {HOW_IT_WORKS.map((step, index) => (
            <li key={step.title} className="flex flex-col items-center gap-3 text-center">
              <span
                aria-hidden="true"
                className="font-display flex h-11 w-11 items-center justify-center rounded-full border-2 border-accent-solid text-xl font-bold text-accent-solid"
              >
                {index + 1}
              </span>
              <h3 className="font-display m-0 text-xl font-bold text-foreground md:text-2xl">
                {step.title}
              </h3>
              <p className="m-0 max-w-sm text-muted-foreground">{step.body}</p>
            </li>
          ))}
        </ol>
      </div>
    </section>
  )
}
