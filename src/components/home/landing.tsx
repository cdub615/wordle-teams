import { AlsoFree } from './also-free.tsx'
import { ClosingCta } from './closing-cta.tsx'
import { DashboardPreview } from './dashboard-preview.tsx'
import { HowItWorks } from './how-it-works.tsx'
import { InsightsPayoff } from './insights-payoff.tsx'
import { Title } from './title.tsx'

/**
 * The marketing landing, rendered at both `/` and `/home`.
 *
 * THE ORDER IS AN ARGUMENT, NOT A LIST OF SECTIONS. A cold visitor — which is
 * who this page is written for, by the owner's decision — needs, in this order:
 * what this is (Title, carrying MODEL_LINE), what it looks like
 * (DashboardPreview), what they would have to do (HowItWorks), why they would
 * come back (InsightsPayoff), what else is in the box for nothing (AlsoFree),
 * and where to sign up (ClosingCta). The six cards this replaces stated six
 * disconnected facts in v1's order and answered none of those questions; the
 * one thing they did say about Pro — "unlimited months, unlimited teams,
 * customizable scoring systems, and more" — was false for as long as the free
 * tier's month window was three (wordle-teams-kusd shipped that) and silent
 * about every surface Phase 7 built.
 *
 * ALL THE COPY IS IN marketing-copy.ts AND NONE OF IT IS HERE — AND NOT BECAUSE
 * A COMPONENT CANNOT BE RENDERED UNDER TEST. This comment used to say vitest's
 * `environment: 'edge-runtime'` meant no test in this repo could render one.
 * That was false, and it was load-bearing: it is the reason the two free-copy
 * sections below went without render coverage (wordle-teams-1vbb). edge-runtime
 * is the DEFAULT, not the ceiling — 53 *.hook.test.ts files open with
 * `// @vitest-environment jsdom` and render, which is
 * `grep -rl "@vitest-environment jsdom" src/ | grep -c hook.test.ts`.
 *
 * WHAT SURVIVES THE CORRECTION IS THE REASON THAT WAS ALWAYS THE REAL ONE: a
 * sentence inside JSX is invisible to any rule that reads a MODULE's exports,
 * and those are the rules this page turns on. marketing-copy.test.ts measures
 * every line this page wrote against every Pro benefit and every inventory
 * entry — a question about the whole corpus of free-voice prose, which no render
 * of one section can answer. That property was feature-cards.tsx's, it is the
 * one thing worth keeping from it, and marketing-copy.test.ts is where it now
 * lives.
 *
 * Ported from v1's src/components/home/home.tsx, minus two things it composes
 * that v2's shell already provides: v1's `AppBar` and its own
 * src/components/home/footer.tsx. src/routes/__root.tsx renders `Header` and
 * `Footer` around every route in this app, so composing them again here would
 * put two app bars and two footers on the page.
 *
 * v1's `Suspense` + dashboard-skeleton.tsx are gone with the async work that
 * justified them — see the note in dashboard-preview.tsx.
 *
 * NO <h1> BUT THE HERO'S. Title renders "Compete with friends" as the page's
 * only h1 — every section below it opens at h2 — and Header.tsx deliberately
 * makes the wordmark a Link rather than v1's <h1> for the same reason.
 */
export function Landing() {
  return (
    <main className="flex w-full flex-col">
      <Title />
      <DashboardPreview />
      <HowItWorks />
      <InsightsPayoff />
      <AlsoFree />
      <ClosingCta />
    </main>
  )
}
