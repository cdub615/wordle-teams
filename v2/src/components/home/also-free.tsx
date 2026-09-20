import { MessageSquare, BellRing } from 'lucide-react'
import { ALSO_FREE, SECTION_TITLES, SHOTS } from './marketing-copy.ts'
import { ProductShot } from './product-shot.tsx'

/**
 * The two things the app does that nobody pays for.
 *
 * WHY THESE TWO AND NOT THE SPEC'S FOUR. §6.1 asked for "chat, notifications,
 * custom scoring, screenshot import" here. Custom scoring and screenshot import
 * are PRO (pro-benefits.ts's `scoring` and `import`), so naming them in a
 * section headed "Included, free" would be the same defect as the "unlimited
 * months" this page was rebuilt to delete — the long version is in
 * marketing-copy.ts, and marketing-copy.test.ts fails if either creeps back in.
 *
 * THE ICONS ARE DECORATION AND SAY SO. They carry `aria-hidden`, each entry's
 * heading is beside them, and they are matched to entries by INDEX rather than
 * stored on the copy — marketing-copy.ts holds strings only, the way
 * pro-benefits.ts does, so that nothing in it needs a component import to be
 * read by a test under edge-runtime.
 *
 * `text-accent-solid` AGAIN, ON --background THIS TIME: #15803d measures 5.05:1
 * light and 7.86:1 dark there, both above the 4.5 bar they do not even need as
 * graphics. One accent per surface (DESIGN_SYSTEM.md section 3).
 *
 * THE CHAT SHOT IS `object-cover`, UNLIKE THE INSIGHTS ONE. Chat's content sits
 * at both edges of the 1440px file — the incoming bubbles start at x=16 and the
 * outgoing ones end at x=1430 — so a centred native-resolution window would clip
 * every bubble on both sides and show the empty middle. Fitting the full width
 * is the only framing that reads as a conversation, and it costs legibility at
 * phone widths: `object-[50%_96%]` puts the frame on the last four exchanges and
 * the composer, where the shape of the thing survives the scale even when the
 * words do not.
 */
const ICONS = [MessageSquare, BellRing] as const

export function AlsoFree() {
  return (
    <section className="w-full bg-surface-sunken py-12 md:py-20">
      <div className="page-wrap">
        <h2 className="font-display m-0 text-center text-2xl font-bold text-foreground md:text-4xl">
          {SECTION_TITLES.alsoFree}
        </h2>

        <ul className="mx-auto mt-10 grid max-w-3xl grid-cols-1 gap-8 md:grid-cols-2 md:gap-12">
          {ALSO_FREE.map((item, index) => {
            const Icon = ICONS[index] ?? MessageSquare
            return (
              <li key={item.title} className="flex flex-col items-center gap-3 text-center">
                <Icon className="h-9 w-9 text-accent-solid" aria-hidden="true" />
                <h3 className="font-display m-0 text-xl font-bold text-foreground">{item.title}</h3>
                <p className="m-0 text-muted-foreground">{item.body}</p>
              </li>
            )
          })}
        </ul>

        <div className="mx-auto mt-10 max-w-5xl md:mt-14">
          <ProductShot
            shot={SHOTS.chat}
            className="aspect-[1440/650] w-full"
            imgClassName="object-cover object-[50%_96%]"
          />
        </div>
      </div>
    </section>
  )
}
