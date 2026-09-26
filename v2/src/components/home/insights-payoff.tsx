import { PAYOFF, PAYOFF_INCLUDES, SHOTS } from './marketing-copy.ts'
import { ProductShot } from './product-shot.tsx'

/**
 * The payoff: what a free account gets out of Insights, and the one screenshot
 * on this page that has to be labelled.
 *
 * THE WORDS ARE FREE-TIER TRUE AND THE PICTURE IS NOT, WHICH IS WHY THERE IS A
 * CAPTION. convex/lib/insightsAccess.ts hands every account `layer1: 'free'` and
 * `layer3: 'free'` — the most recent board benchmarked, and one team fact a day —
 * and the two entries under the lead are that pair, taken from
 * lib/free-includes.ts (`benchmark` and `team-fact`) rather than written here.
 * `PAYOFF.lead` above them frames the section and claims nothing; the rule that
 * keeps those two apart is on PAYOFF in marketing-copy.ts. The only Insights
 * capture scripts/build-marketing-shots.mjs takes is of a Pro account, so the
 * frame below contains a whole month of head to head. Saying which tier the
 * picture belongs to costs one muted line and is the difference between a
 * screenshot and an implication; the LINK to /pricing is the closing CTA's job,
 * not this section's, so nothing here is an upsell.
 *
 * THE CROP IS THE POINT OF THE FRAMING, AND IT IS A JUDGEMENT ABOUT THE IMAGE
 * RATHER THAN A LAYOUT CHOICE. The capture leads with the trend panel, whose
 * seven bars sit between 2.8 and 3.4 and read as a flat row — honest (a
 * consistent player's months cluster, which trend-panel.tsx's own comment
 * discusses) and the weakest thing on the page. The head-to-head beneath it is a
 * "10 vs 3" in 48px type. This frames the second one.
 *
 * EVERY NUMBER IN THIS COMMENT IS READ OFF public/marketing/insights-*.png AS
 * IT SHIPS, and it has to be re-read after every capture run that lands on a
 * different calendar day (wordle-teams-wty4.1.14.9). The head-to-head is
 * MONTH-scoped and scripts/build-marketing-shots.mjs counts its seeded days back
 * from the day it runs, so these figures are a fact about the 2026-09-20
 * capture and not about the product. The GEOMETRY below — the row and column
 * arithmetic — is a fact about the layout and survives a re-shoot; the FIGURES
 * do not.
 *
 * `object-none`, NOT `object-cover`, AND THAT IS WHAT MAKES IT LEGIBLE ON A
 * PHONE. The files are 1440x900 desktop captures; `cover` scales them to the
 * container's width, which at 390px is 0.27 — the type in this card would render
 * at three or four pixels. `object-none` renders at the file's INTRINSIC size and
 * the box clips, so every viewport sees the same pixels at 1:1 and a narrow one
 * simply sees fewer of them. At 390px the frame lands on "You 10 — Jordan Hale 3,
 * 7 ties over 20 shared days"; at the 1024px cap it holds the whole width of the
 * card, since the card spans x=336..1104 of the file and the centred window is
 * x=208..1232.
 *
 * WHAT IT NEVER HOLDS IS THE BOTTOM OF THAT CARD, and the alt text in
 * marketing-copy.ts is written to match. The tallest frame here is 380px at
 * 57%, i.e. rows 296..676; "Best and worst days" and "Consistency" begin at
 * y=707. They are in the FILE and have never been on this PAGE.
 *
 * `object-[50%_57%]` IS AN ANCHOR, NOT A MAGIC NUMBER. With `object-none` the
 * percentage aligns the same relative point of the file and the box, so the
 * visible centre is `p * (900 - H)` px down the file: 57% holds the head-to-head
 * numbers near the middle of the frame at every height below — 427..577 at
 * h-150, 296..676 at h-380 — which is why the height can grow with the viewport
 * without the anchor moving. The phone frame is 150px rather than the card's
 * full height on purpose: the card's own left-aligned labels ("Head to head",
 * "Averages") sit outside a 358px-wide centred window, so a taller frame there
 * buys white space rather than context.
 *
 * WHAT WOULD ACTUALLY FIX THIS IS A PHONE-WIDTH CAPTURE, and there is not one.
 * scripts/build-marketing-shots.mjs takes 1440x900 only. Cropping into a desktop
 * capture is the best CSS can do with the files that exist; it is not the same
 * thing as a screenshot of the app as a phone renders it.
 */
export function InsightsPayoff() {
  return (
    <section className="px-4 py-12 md:py-20">
      <div className="mx-auto flex max-w-5xl flex-col gap-8">
        <div className="mx-auto max-w-2xl text-center">
          <p className="island-kicker m-0 mb-2">{PAYOFF.kicker}</p>
          <h2 className="font-display m-0 mb-4 text-2xl font-bold text-balance text-foreground md:text-4xl">
            {PAYOFF.title}
          </h2>
          <p className="m-0 text-base leading-7 text-muted-foreground md:text-lg md:leading-8">
            {PAYOFF.lead}
          </p>
        </div>

        <ul className="mx-auto grid w-full max-w-3xl grid-cols-1 gap-8 md:grid-cols-2 md:gap-12">
          {PAYOFF_INCLUDES.map((inclusion) => (
            <li key={inclusion.id} className="flex flex-col items-center gap-3 text-center">
              <h3 className="font-display m-0 text-xl font-bold text-foreground">
                {inclusion.title}
              </h3>
              <p className="m-0 text-muted-foreground">{inclusion.body}</p>
            </li>
          ))}
        </ul>

        <figure className="m-0 flex flex-col gap-3">
          <ProductShot
            shot={SHOTS.insights}
            className="h-[150px] w-full md:h-[300px] lg:h-[380px]"
            imgClassName="object-none object-[50%_57%]"
          />
          <figcaption className="m-0 text-center text-sm text-muted-foreground">
            {PAYOFF.shotNote}
          </figcaption>
        </figure>
      </div>
    </section>
  )
}
