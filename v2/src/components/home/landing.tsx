import { DashboardPreview } from './dashboard-preview.tsx'
import { FeatureCards } from './feature-cards.tsx'
import { Title } from './title.tsx'

/**
 * The marketing landing, rendered at both `/` and `/home`.
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
 * only h1, and Header.tsx deliberately makes the wordmark a Link rather than
 * v1's <h1> for the same reason.
 */
export function Landing() {
  return (
    <main className="flex w-full flex-col">
      <Title />
      <DashboardPreview />
      <FeatureCards />
    </main>
  )
}
