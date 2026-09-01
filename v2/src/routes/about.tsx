import { createFileRoute } from '@tanstack/react-router'
import { pageTitle } from '#/lib/seo'

/**
 * Copy and screenshots ported from v1's src/components/about.tsx.
 *
 * THE CAROUSEL IS DELIBERATELY NOT CARRIED OVER. v1 lays its last four
 * screenshots out in an aceternity `InfiniteMovingCards`; wt-ksh.12.5 ruled
 * that dependency out and Phase 7 Task 4 dropped its siblings (`HeroHighlight`,
 * `BorderBeam`, `framer-motion`) for the same reason. They are a plain
 * responsive grid here — two columns from `sm` up — which is all the four
 * images were ever doing: sitting next to each other so a reader can see that
 * Feedback, the Changelog, X and GitHub are real places. An auto-scrolling
 * marquee also moves under a reader who is trying to look at it, which is a
 * `prefers-reduced-motion` problem the grid simply does not have.
 *
 * EVERY <img> CARRIES ITS FILE'S REAL width AND height, AND THAT IS NOT
 * COSMETIC. v1 got the pair for free from `next/image` and a statically
 * imported asset; v2 has no equivalent, and without them the browser has no
 * aspect ratio to reserve space with, so each of eight images shoves the rest
 * of the page down as it arrives. Seven of the eight are below the fold at any
 * viewport, so that reflow lands under a reader who is already reading. The
 * numbers are
 * the INTRINSIC dimensions of the PNG, not the drawn size — CSS does the
 * scaling — and src/about-screenshots.test.ts reads each file's IHDR chunk to
 * prove the declared pair is the file's own.
 *
 * TEXT FIRST IN THE DOM ON EVERY ROW, with `md:flex-row-reverse` alternating
 * the sides. v1 alternates with `flex-col-reverse` instead, which puts the
 * image ahead of its own annotation in the document for two of the four rows.
 * Reading order and DOM order agree here; the desktop zig-zag is unchanged.
 *
 * v1's `md:rotate-3` / `md:-rotate-6` tilts are dropped. A rotated element
 * still reserves its UNROTATED box, so a tilted screenshot and its outline
 * overhang a column the layout has not made room for — which is a thing to
 * tune by hand at every breakpoint, for an effect the rest of v2 does not use.
 * The green outline is kept, as
 * `outline-accent-solid` rather than v1's raw `outline-green-600` — a raw
 * palette colour outside src/styles.css is a missing token (rule 1 there).
 *
 * TWO DIVERGENCES FROM v1's TEXT, both because v1's sentence is not true of
 * this page:
 *
 *   1. "create a team (button below)" loses its parenthetical. v1's /about
 *      requires a session (src/app/about/page.tsx redirects an anonymous
 *      visitor to /login) and passes in an `actionButton` that reads "Go to
 *      Dashboard" — so the parenthetical does not describe v1's own button
 *      either. v2's /about is public and edge-cacheable and has no button at
 *      all; the header's Sign In is the action for the visitor this page is
 *      written for. Pointing at a control that is not there is worse than the
 *      shorter sentence.
 *   2. v1's `title` and `actionButton` props are not ported, for the same
 *      reason: both are supplied by a page that has already established a
 *      session.
 *
 * THE E2E SUITE NO LONGER DEPENDS ON THIS PAGE, as of Phase 7 Task 4.
 * playwright.config.ts pointed its webServer readiness probe at /about for as
 * long as `/` had no route — Playwright reads a 404 as "not ready yet" and
 * fails the whole run with `Timed out waiting for config.webServer`, naming the
 * dev server rather than the route. The marketing landing now renders at `/`
 * and the probe has moved back there (verified: `url: 'http://localhost:3000/'`).
 * Recorded here because the dependency ran both ways and someone reading only
 * this file would otherwise still believe it exists.
 *
 * THIS PATH IS IN src/lib/cache-policy.ts's STATIC_DOCUMENTS, so an anonymous
 * document is published to the edge for a day. The images are static assets
 * served by the Worker's asset handler and never touch that policy; adding
 * them changed the page's WEIGHT (+462 KiB across eight files, all lazy) and
 * nothing about its headers.
 */
export const Route = createFileRoute('/about')({
  head: () => ({ meta: [{ title: pageTitle('About') }] }),
  component: About,
})

/**
 * The shared frame for a product shot: v1's green outline, and the two rules
 * that make the declared width/height do their job — `w-full` so the image
 * scales down inside its column, `h-auto` so the browser derives the height
 * from the intrinsic aspect ratio instead of stretching to the attribute.
 */
const SHOT = 'h-auto w-full rounded-xl outline-2 outline-offset-2 outline-accent-solid'

/**
 * The four places this project lives outside the app.
 *
 * A list rather than four hand-written <img> tags because they render as a
 * uniform grid, unlike the four annotated shots above them, which each sit
 * beside their own sentence.
 */
const COMMUNITY = [
  { src: '/feedback-page.png', alt: 'feedback screenshot', width: 786, height: 748 },
  { src: '/changelog-page.png', alt: 'changelog screenshot', width: 747, height: 704 },
  { src: '/twitter-acct.png', alt: 'twitter account screenshot', width: 604, height: 604 },
  { src: '/github-repo.png', alt: 'github repo screenshot', width: 900, height: 900 },
]

function About() {
  return (
    <main className="page-wrap px-4 py-12">
      <section className="island-shell rounded-2xl p-6 sm:p-8">
        <p className="island-kicker mb-2">About</p>
        <h1 className="font-display mb-3 text-4xl font-bold text-foreground sm:text-5xl">
          Wordle Teams
        </h1>
        {/*
          v1's FIRST ROW: the intro article and the board-entry shot side by
          side. The two paragraphs are the annotation for that screenshot, which
          is why it sits in this section rather than opening the run below.
        */}
        <div className="flex flex-col items-center gap-8 md:flex-row md:justify-center">
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
          <div className="w-full max-w-[293px] shrink-0">
            <img
              src="/board-entry.png"
              alt="board entry screenshot"
              width={518}
              height={708}
              loading="lazy"
              decoding="async"
              className={SHOT}
            />
          </div>
        </div>
      </section>

      <div className="mt-16 flex flex-col gap-16 md:gap-24">
        <section className="flex flex-col items-center gap-8 md:flex-row-reverse md:justify-center">
          <p className="m-0 max-w-xl text-base leading-8 text-muted-foreground">
            For a more app-like experience, you can install Wordle Teams to your home screen or
            desktop using the instructions from the Install button in your user dropdown at the
            top right.
          </p>
          <div className="w-full max-w-[234px] shrink-0">
            <img
              src="/install-button.png"
              alt="install button screenshot"
              width={234}
              height={189}
              loading="lazy"
              decoding="async"
              className={SHOT}
            />
          </div>
        </section>

        <section className="flex flex-col items-center gap-8 md:flex-row md:justify-center">
          <p className="m-0 max-w-xl text-base leading-8 text-muted-foreground">
            To get started, you&apos;ll need to either create a team, or ask for an invite to an
            existing team if you heard about us from a friend. They&apos;ll just need the email
            you used to sign in.
          </p>
          <div className="w-full max-w-[521px] shrink-0">
            <img
              src="/create-team.png"
              alt="create team screenshot"
              width={521}
              height={312}
              loading="lazy"
              decoding="async"
              className={SHOT}
            />
          </div>
        </section>

        <section className="flex flex-col items-center gap-8 md:flex-row-reverse md:justify-center">
          <p className="m-0 max-w-xl text-base leading-8 text-muted-foreground">
            Upgrade to unlock unlimited teams, access to all of your previous months&apos; scores,
            scoring system customization for your teams, and more.
          </p>
          <div className="w-full max-w-[234px] shrink-0">
            <img
              src="/upgrade-button.png"
              alt="upgrade button screenshot"
              width={234}
              height={189}
              loading="lazy"
              decoding="async"
              className={SHOT}
            />
          </div>
        </section>

        <section className="flex flex-col items-center gap-8">
          <div className="flex max-w-xl flex-col gap-4 text-base leading-8 text-muted-foreground">
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
          </div>
          <div className="grid w-full max-w-3xl grid-cols-1 gap-6 sm:grid-cols-2">
            {COMMUNITY.map((shot) => (
              <img
                key={shot.src}
                src={shot.src}
                alt={shot.alt}
                width={shot.width}
                height={shot.height}
                loading="lazy"
                decoding="async"
                className="h-auto w-full rounded-xl border border-line-subtle"
              />
            ))}
          </div>
        </section>
      </div>

      <p className="mt-16 text-center text-xs leading-4 text-muted-foreground">
        * Wordle Teams is not affiliated with New York Times or the official Wordle game
      </p>
    </main>
  )
}
