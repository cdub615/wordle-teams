import { Link, createFileRoute } from '@tanstack/react-router'
import { ProductShot } from '#/components/home/product-shot.tsx'
import { PRO_BENEFITS } from '#/lib/pro-benefits.ts'
import { publicRouteHead } from '#/lib/seo'

/**
 * THE HOW-TO WALKTHROUGH. Same URL, same job, re-checked against the app
 * (wordle-teams-wty4.1.14.5).
 *
 * IT MATTERS BECAUSE wordle-teams-456 MEASURES 87% OF PRODUCTION SIGNUPS NEVER
 * ENTERING A BOARD. This is the page that explains how, so a stale instruction
 * here is not cosmetic: somebody follows it. That is the defect class this
 * rewrite removes, and every sentence below now names the file that makes it
 * true in a comment beside it.
 *
 * WHAT WAS FALSE WHEN THIS WAS OPENED, ALL OF IT SHIPPED AND ALL OF IT GREEN:
 *
 *   1. "the Install button in your user dropdown at the top right" — there has
 *      been no Install button in any menu since wordle-teams-mwu0 folded
 *      Profile, Install and Notifications into a single `Settings` item, and no
 *      "user dropdown" since wordle-teams-lyab replaced it with one "Main menu"
 *      whose trigger is a hamburger beside the avatar rather than the avatar.
 *      Install is a TAB inside the settings dialog (settings-dialog.tsx).
 *   2. public/install-button.png and public/upgrade-button.png were two crops
 *      of that same dead v1 menu — Theme / Upgrade / About / Install / Log out,
 *      a list with three wrong entries.
 *   3. "Upgrade to unlock unlimited teams, access to all of your previous
 *      months' scores, scoring system customization for your teams, and more."
 *      Three over-claims against lib/pro-benefits.ts: the month window is
 *      TEAM-scoped and roster-derived (reaching back to the team's first board,
 *      which is not "your previous months"); custom scoring is the CURRENT
 *      month on a team you OWN, not "your teams"; and the sentence omits the
 *      two benefits a reader would most want to know about. Nothing on this
 *      page writes a Pro claim by hand any more — see the Pro section below.
 *   4. public/create-team.png was missing the `Show Letters in Completed
 *      Boards` switch that teams/team-fields.tsx has shipped for months, and
 *      quoted a dialog description that had since been reworded.
 *   5. public/github-repo.png is a photograph of this repository's README
 *      saying the app is "built with Next.js, Supabase, and shadcn/ui" with
 *      "Lemon Squeezy" for payments. v2 is TanStack Start, Convex and Polar.
 *      public/feedback-page.png says "No feedback yet"; public/changelog-page.png
 *      shows June 2024 as the newest entry; public/twitter-acct.png is the v1
 *      tagline and a follower count. All four were hand-captured pictures of
 *      THIRD-PARTY pages, which no script here can re-shoot.
 *   6. Every one of the eight was a DARK-THEME PNG, on a page that is light for
 *      half its readers.
 *
 * SO THE SCREENSHOTS COME FROM scripts/build-marketing-shots.mjs NOW, light and
 * dark, and three of them are new element-clipped captures that task added for
 * this page — a dialog is the unit being explained here, and a 1440x900 frame
 * of the dashboard behind it is not. See that script's `clip`.
 *
 * AND ONE OF THE THREE IS CLIPPED TIGHTER THAN A DIALOG, WHICH IS A CORRECTION
 * RATHER THAN A REFINEMENT (wordle-teams-wty4.1.14.8). The board-entry shot
 * frames the FORM inside the dialog, not the dialog: the dialog's header
 * carries "Pick the day, then import a screenshot or type the board in", and
 * screenshot import is gated by lib/pro-benefits.ts's `import`. That sentence
 * was legible at 1:1 in the picture beside step one, two sections above this
 * page's "Everything above is free" — a Pro feature published as a free one
 * through the one medium none of the `checkedAgainst` tests can read. The
 * capture script's `clip` for that shot carries the full note, including why
 * seeding a free account would NOT have fixed it (the upsell's Pro badge lives
 * on the step before the one photographed).
 *
 * WHAT THAT COSTS, STATED RATHER THAN HIDDEN (wordle-teams-t40a). Every capture
 * is taken at a 1440x900 DESKTOP viewport, and this page is read on a phone.
 * For the three clipped shots the cost is small — ui/dialog.tsx caps a dialog at
 * `max-w-lg` (512px) on a laptop and `w-11/12` (~358px at 390px), so the files
 * are the same shape as the phone's own and between about 30% and 45% wider
 * (the board-entry one is 478px, being the dialog less its padding) — but it is
 * not zero: these are pictures of a dialog as a laptop draws it, and below `md`
 * board-entry/button.tsx renders a top SHEET rather than the dialog shown here.
 * Fixing that properly is t40a's phone-width pass, which is deliberately not
 * done here.
 *
 * THE FOUR COMMUNITY SCREENSHOTS ARE GONE AND THE SECTION IS NOT. Its two
 * paragraphs and all four links are unchanged; what went is four stale pictures
 * of other people's websites, for reason 5 above. They were there "so a reader
 * can see that Feedback, the Changelog, X and GitHub are real places" — which
 * four links already do, and which a picture of an empty feedback board
 * actively undoes. NOTE THIS MAKES §7a ROW 25 (the aceternity carousel that was
 * ruled out) DESCRIBE A GRID THAT NO LONGER EXISTS; the row is annotated rather
 * than deleted, because wt-ksh.12.5's decision about the DEPENDENCY still
 * stands and is still pinned below.
 *
 * THE CAROUSEL IS STILL RULED OUT, and the test that proves it is still an
 * assertion over this file's bounded, ordered import list — which is why adding
 * an import here is a deliberate act with a failing test attached.
 *
 * THE UTILITY NAMES IN THIS COMMENT ARE SPELLED AROUND ON PURPOSE. Tailwind v4
 * scans this file as source TEXT, comments included, so a dropped or banned
 * utility named here in full is compiled into the shipped stylesheet as a rule
 * no element in the app carries. Measured, not feared: before this was
 * reworded, three such rules — v1's two tilts and its raw green outline — were
 * in dist/client/assets/styles-*.css, emitted by the comment that explains why
 * v2 does not use them. The comment banning a class was the only thing shipping
 * it.
 *
 * TEXT FIRST IN THE DOM ON EVERY ROW, with the `md:` row-reverse utility
 * alternating the sides. v1 alternates with a column-reverse instead, which
 * puts the image ahead of its own annotation in the document for half the rows
 * — a WCAG 1.3.2 meaningful-sequence problem, since the sentence is what the
 * picture is captioned by. Reading order and DOM order agree here, and the
 * desktop zig-zag is unchanged. BOTH HALVES OF THAT SENTENCE ARE ASSERTED,
 * because the second is one class edit from being false.
 *
 * v1's TILTS STAY DROPPED — the `md:` rotate utilities it puts on all four
 * shots (src/components/about.tsx:40,48,65,73). A rotated element still
 * reserves its UNROTATED box, so a tilted screenshot and its outline overhang a
 * column the layout has not made room for.
 *
 * THE GREEN OUTLINE IS KEPT, RETOKENISED AND HALVED — the accent-solid outline
 * token in place of v1's raw palette utility, at half v1's width. §7a row 29.
 * It now sits OUTSIDE ProductShot's own 1px subtle border, which is the frame
 * the landing page's shots carry, so the two marketing surfaces agree about
 * what a product shot looks like and this one keeps its accent.
 *
 * THIS PATH IS IN src/lib/cache-policy.ts's STATIC_DOCUMENTS, so an anonymous
 * document is published to the edge for a day. The images are static assets
 * served by the Worker's asset handler and never touch that policy.
 */
export const Route = createFileRoute('/about')({
  head: () => publicRouteHead('/about', 'About'),
  component: About,
})

/**
 * The three things this page walks somebody through, and the picture of each.
 *
 * HERE AS DATA FOR components/home/marketing-copy.ts's REASON, which is the
 * strongest lesson of this plan: vitest.config.ts sets `environment:
 * 'edge-runtime'`, nothing in this repo can mount a component, and a sentence
 * typed into JSX is a product decision no gate can read. The difference from
 * that file is that these sentences are not shared with another page, so they
 * live beside the only component that renders them.
 *
 * `width` AND `height` ARE THE PNG's OWN, NOT THE DRAWN SIZE. CSS does the
 * scaling; these give the browser an aspect ratio to reserve space with before
 * the bytes arrive, and src/about-screenshots.test.ts reads each file's IHDR
 * chunk to prove the declared pair is that file's. A wrong pair is worse than
 * none — it reserves a box of the wrong shape, so the page reflows anyway, into
 * a layout somebody wrote down on purpose.
 */
const STEPS = [
  {
    heading: 'Enter the day’s board',
    stem: 'board-entry',
    // "FORM", NOT "DIALOG", BECAUSE THE FRAME CHANGED AND THE ALT FOLLOWED IT
    // (wordle-teams-wty4.1.14.8). The capture used to be clipped to
    // `[role="dialog"]`, which put board-entry/button.tsx's own
    // `DialogDescription` — "Pick the day, then import a screenshot or type the
    // board in" — legibly inside the picture, two sections above this page's
    // "Everything above is free", while import is Pro. The clip now starts at
    // the form below that header, so the dialog's title and close button are
    // out of frame along with the sentence. Read off the shipped PNG: the day,
    // the coach line, the answer, the grid, Submit. No prose at all.
    alt: 'The board entry form: the day at the top, the day’s answer spelled out above a Wordle grid with two guesses filled in and the cursor waiting on the next tile.',
    width: 478,
    height: 620,
    // Every clause is the product's own. "Pick the day, then ... type the board
    // in" is board-entry/button.tsx's description with its middle clause taken
    // out; "Keep typing. Backspace goes back a letter" is entry-coach.ts's line,
    // and it is the one sentence that IS in the picture; "about ten seconds" is
    // lib/onboarding-tasks.ts's hint on the same task.
    //
    // IT SAYS TYPE AND NEVER PASTE, which is the whole spec correction in one
    // word and the second surface to need it. Filling a board in from a
    // screenshot is PRO — board-entry/form.tsx renders the importer on
    // `isPro === true` and an upsell on false — so offering it to a visitor who
    // has not signed up is the same defect as the Pro claims removed above.
    // THE PICTURE HAD TO BE MADE TO AGREE WITH THIS SENTENCE, which is what
    // wordle-teams-wty4.1.14.8 was: the prose was elided and the screenshot was
    // not, so the frame said the word this line exists to avoid.
    body: 'Pick the day, then type in the answer and the guesses you made. The board fills as you type and backspace goes back a letter, so it is about ten seconds and you never leave the keyboard.',
  },
  {
    heading: 'Get a team around you',
    stem: 'create-team',
    alt: 'The Create Team dialog: a team name field, and switches for playing weekends and for showing letters in completed boards.',
    width: 512,
    height: 326,
    // Three claims, three files. BOTH invite routes are named because
    // teams/invite-player-dialog.tsx ships both and its own header says why:
    // typing an address "is a terrible [tool] when you do not [know it]", and
    // six of the eight most recently created production teams invited nobody.
    // The link half mints a token (convex/inviteLinks.ts) that lands on
    // routes/join.$token.tsx.
    //
    // "TWO TEAMS" IS A NUMBER SPELLED AS A WORD, which no template literal can
    // keep honest. Solved as components/home/marketing-copy.ts solves it: the
    // test pins FREE_TEAM_LIMIT, so moving the constant fails a gate instead of
    // shipping stale copy behind four green ones. It says JOIN rather than
    // create, because the cap is enforced on the join path and not on
    // createTeam — the same distinction lib/pro-benefits.ts is careful about.
    body: 'A scoreboard needs somebody to score against. Create a team and invite the people you already send your score to — by their email address, or by sharing a join link. If a friend invited you, they need the address you sign in with, or they can just send you the link. A free account can be on two teams.',
  },
  {
    heading: 'Put it on your home screen',
    stem: 'install-guide',
    alt: 'The settings dialog on its Install tab, listing three steps: tap the three-dot or share icon, choose Add to Home Screen or Install app, then confirm.',
    width: 462,
    height: 236,
    // The three steps are settings/install-guide-tab.tsx's, in its order and
    // its words. The route to them is app-menu.tsx ("Main menu", top right,
    // `Settings`) and settings-dialog.tsx (the `Install` tab) — the claim that
    // was false on this page for the whole of wordle-teams-lyab's life.
    //
    // PUSH IS NOT MENTIONED. install-guide-tab.tsx's own note says iOS grants
    // push only to an installed PWA and then adds that Push "will join, once
    // the spike behind it lands" — a feature in the future tense is not
    // something a how-to page gets to promise.
    body: 'For a more app-like experience, install Wordle Teams to your home screen or desktop. Tap your browser’s three-dot menu or its Share icon, choose “Add to Home Screen” or “Install app”, then confirm. The same three steps live in the app under Settings, on the Install tab — open the menu at the top right.',
  },
] as const

/** The green outline, retokenised and halved, outside ProductShot's own frame. */
const SHOT_FRAME = 'outline-2 outline-offset-2 outline-accent-solid'

function About() {
  return (
    <main className="page-wrap px-4 py-12">
      <section className="island-shell rounded-2xl p-6 sm:p-8">
        <p className="island-kicker mb-2">About</p>
        <h1 className="font-display mb-3 text-4xl font-bold text-foreground sm:text-5xl">
          Wordle Teams
        </h1>
        <div className="flex max-w-xl flex-col gap-4 text-base leading-8 text-muted-foreground">
          <p className="m-0">
            Wordle Teams is designed as a companion app to the New York Times Wordle game.*
          </p>
          <p className="m-0">
            Play Wordle as you normally would in the official app or website, then come here to
            enter the day&apos;s answer and your guesses and see how you stack up against your
            friends.
          </p>
        </div>
      </section>

      <div className="mt-16 flex flex-col gap-16 md:gap-24">
        {STEPS.map((step, index) => (
          <section
            key={step.stem}
            className={
              // The zig-zag. `index % 2` rather than a literal per row, so a
              // fourth step cannot land on the same side as the third by being
              // added without thinking about it.
              index % 2 === 0
                ? 'flex flex-col items-center gap-8 md:flex-row md:justify-center'
                : 'flex flex-col items-center gap-8 md:flex-row-reverse md:justify-center'
            }
          >
            <div className="max-w-xl">
              <h2 className="font-display mb-2 text-2xl font-semibold text-foreground">
                {step.heading}
              </h2>
              <p className="m-0 text-base leading-8 text-muted-foreground">{step.body}</p>
            </div>
            {/*
              THE COLUMN IS CAPPED AT THE FILE'S OWN WIDTH, never above it: these
              are 1x captures, so drawing a 512px PNG at 640px is an upscale of a
              screenshot, which reads as a blurry screenshot.
            */}
            <div className="w-full shrink-0" style={{ maxWidth: step.width }}>
              <ProductShot
                shot={{ stem: step.stem, alt: step.alt }}
                width={step.width}
                height={step.height}
                className={SHOT_FRAME}
                // h-auto REPLACES ProductShot's own h-full through
                // tailwind-merge. That default is for the landing's cropped
                // frames, which set an aspect ratio on the container; these
                // frames have no height of their own and want the image's.
                imgClassName="h-auto"
              />
            </div>
          </section>
        ))}

        <section className="flex flex-col gap-4">
          <h2 className="font-display text-2xl font-semibold text-foreground">What Pro adds</h2>
          <p className="m-0 max-w-xl text-base leading-8 text-muted-foreground">
            Everything above is free. Pro adds:
          </p>
          {/*
            RENDERED FROM lib/pro-benefits.ts, NOT RESTATED. That file is the
            one list of what Pro includes, checked entry by entry against the
            code that gates it, and its header says its consumers "describe one
            tier and must not describe it twice". The sentence this replaces
            wrote the list out by hand and got three of its four clauses wrong.

            TITLES ONLY, AND THE LINK CARRIES THE REST. Printing every `body`
            here would make /about a third copy of the tier table; /pricing is
            the page whose job that is, and components/home/marketing-copy.ts
            hands the tier question over the same way.
          */}
          <ul className="m-0 max-w-xl list-disc pl-5 text-base leading-8 text-muted-foreground">
            {PRO_BENEFITS.map((benefit) => (
              <li key={benefit.id}>{benefit.title}</li>
            ))}
          </ul>
          <p className="m-0 text-base leading-8 text-muted-foreground">
            <Link to="/pricing" className="font-semibold">
              See the full free and Pro comparison
            </Link>
          </p>
        </section>

        <section className="flex max-w-xl flex-col gap-4 text-base leading-8 text-muted-foreground">
          <p className="m-0">
            For any suggestions or issues, please see our{' '}
            <a href="https://feedback.wordleteams.com/feedback" className="font-semibold">
              Feedback
            </a>{' '}
            page. You can also follow us on{' '}
            <a href="https://x.com/wordleteams" className="font-semibold">
              X (Twitter)
            </a>{' '}
            and check out our{' '}
            <a href="https://feedback.wordleteams.com/changelog" className="font-semibold">
              Changelog
            </a>{' '}
            to learn about new features as they&apos;re released.
          </p>
          <p className="m-0">
            For those interested, this is an open source project on{' '}
            <a href="https://github.com/cdub615/wordle-teams" className="font-semibold">
              GitHub
            </a>
            . Contributions are welcome.
          </p>
        </section>
      </div>

      <p className="mt-16 text-center text-xs leading-4 text-muted-foreground">
        * Wordle Teams is not affiliated with New York Times or the official Wordle game
      </p>
    </main>
  )
}
