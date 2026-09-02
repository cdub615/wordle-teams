import { createFileRoute } from '@tanstack/react-router'
import { publicRouteHead } from '#/lib/seo'

/**
 * Ported from v1's src/app/privacy/page.tsx.
 *
 * THE PROSE IS A PUBLISHED LEGAL DOCUMENT AND IS NOT EDITED CASUALLY. Rewording
 * it to describe v2's architecture would be amending a policy users have
 * already been shown, which is the owner's decision and not a port's. The port
 * kept it verbatim for exactly that reason.
 *
 * IT WAS REISSUED ON 2026-09-02, ON THE OWNER'S APPROVAL, to correct two
 * statements that had never been true (wordle-teams-4yt):
 *
 *   1. "(e.g., Google, Apple, Facebook, etc.)" -> "(Google, Microsoft, GitHub,
 *      or Discord)". Neither Apple nor Facebook was ever a sign-in provider.
 *      v1 offered google, twitter, azure, github, slack and discord; v2 offers
 *      the four now named (convex/auth.ts). The old list was wrong in BOTH
 *      directions and named two companies as recipients of data they receive
 *      none of.
 *   2. "your name, username, email address" -> "your name, email address".
 *      There is no username field in either codebase.
 *
 * BOTH EDITS ONLY NARROW WHAT IS CLAIMED — nothing new is collected, no new
 * recipient is added, no user right is reduced — which is why they were judged
 * not to be a material revision under the Changes clause below. The same
 * correction was made to v1's src/app/privacy/page.tsx in the same commit, so
 * the two do not disagree while v1 is still serving traffic.
 *
 * THE PROVIDER LIST IS NOW PINNED BY A TEST. src/legal-copy.test.ts parses
 * convex/auth.ts's PROVIDER_ENV and fails if this document names a provider the
 * app does not offer, or omits one it does. The list going stale unnoticed for
 * two years is the actual defect here; correcting the sentence only fixed today.
 *
 * Everything else still holds on v2: the profile image from the OAuth provider
 * is stored and rendered (components/app-menu.tsx), and no vendor is
 * named anywhere in the text, so the Supabase/Vercel -> Convex/Cloudflare move
 * does not contradict a word of it.
 *
 * v1 set `export const revalidate = 86400` here to keep the page off a cold
 * function. v2's equivalent is src/lib/cache-policy.ts, which already lists
 * '/privacy' in STATIC_DOCUMENTS — that listing was inert while this route
 * 404'd, because src/server.ts shares only a 200. It takes effect with this
 * file.
 */
export const Route = createFileRoute('/privacy')({
  // v1: src/app/privacy/layout.tsx metadata.title -> 'Privacy Policy'
  head: () => publicRouteHead('/privacy', 'Privacy Policy'),
  component: Privacy,
})

function Privacy() {
  return (
    <main className="page-wrap px-4 py-12">
      <article className="island-shell rounded-2xl p-6 sm:p-8">
        {/*
          v2-ONLY CHROME — v1's legal pages carry no kicker, and this is the one
          visible string on the page that is not ported prose (§7a row 22).

          aria-hidden because it sits INSIDE the <article>, so a screen reader
          would otherwise announce "Legal" before the document's own title. It
          is decoration: the h1 immediately below says which legal document this
          is, and says it better. Hidden rather than hoisted above the <article>
          so the island's padding still holds it where it is drawn.
        */}
        <p className="island-kicker mb-2" aria-hidden="true">
          Legal
        </p>
        <h1 className="font-display mb-6 text-4xl font-bold text-foreground sm:text-5xl">
          Privacy Policy
        </h1>

        <div className="flex max-w-3xl flex-col gap-8 text-base leading-8 text-muted-foreground">
          <p className="m-0">
            Wordle Teams (&quot;us&quot;, &quot;we&quot;, or &quot;our&quot;) is committed to
            protecting your privacy. This Privacy Policy explains how we collect, use, disclose,
            and safeguard your information when you use our mobile application and website
            (collectively, the &quot;Service&quot;). Please read this Privacy Policy carefully.
          </p>

          <section className="flex flex-col gap-2">
            <h2 className="m-0 text-lg font-medium text-foreground">Information We Collect</h2>
            <p className="m-0">
              <strong>Account Information:</strong> When you create an account with us, we collect
              your name, email address, and your profile image if provided by the third-party
              sign-in provider you use (Google, Microsoft, GitHub, or Discord).
            </p>
            <p className="m-0">
              <strong>User Content:</strong> We collect the content you create, share, and store
              while using the Service, including your Wordle game scores, boards, and team
              information (&quot;User Content&quot;).
            </p>
            <p className="m-0">
              <strong>Usage Data:</strong> We automatically collect certain information when you
              use the Service, such as your IP address, device type, operating system, browser
              type, and other usage data.
            </p>
          </section>

          <section className="flex flex-col gap-2">
            <h2 className="m-0 text-lg font-medium text-foreground">How We Use Your Information</h2>
            <ul className="m-0 list-disc pl-5">
              <li>To provide, maintain, and improve the Service</li>
              <li>To communicate with you about your account and the Service</li>
              <li>To analyze usage trends and enhance the user experience</li>
              <li>To protect the rights, property, or safety of Wordle Teams, our users, or others</li>
            </ul>
          </section>

          <section className="flex flex-col gap-2">
            <h2 className="m-0 text-lg font-medium text-foreground">
              Information Sharing and Disclosure
            </h2>
            <p className="m-0">We may share your information in the following circumstances:</p>
            <ul className="m-0 list-disc pl-5">
              <li>With third-party service providers who assist us in operating the Service</li>
              <li>If required to do so by law or in response to a valid legal request</li>
              <li>To protect the rights, property, or safety of Wordle Teams, our users, or others</li>
            </ul>
          </section>

          <section className="flex flex-col gap-2">
            <h2 className="m-0 text-lg font-medium text-foreground">Data Security</h2>
            <p className="m-0">
              We take reasonable steps to protect your information from unauthorized access, use,
              or disclosure. However, no method of transmission over the Internet or method of
              electronic storage is 100% secure.
            </p>
          </section>

          <section className="flex flex-col gap-2">
            <h2 className="m-0 text-lg font-medium text-foreground">
              Third-Party Links and Services
            </h2>
            <p className="m-0">
              The Service may contain links to third-party websites or services that are not
              operated by us. We are not responsible for the privacy practices of these third
              parties.
            </p>
          </section>

          <section className="flex flex-col gap-2">
            <h2 className="m-0 text-lg font-medium text-foreground">
              Changes to this Privacy Policy
            </h2>
            <p className="m-0">
              We may update this Privacy Policy from time to time. The updated version will be
              effective as soon as it is accessible. We encourage you to review this Privacy Policy
              periodically for any changes.
            </p>
          </section>

          <section className="flex flex-col gap-2">
            <h2 className="m-0 text-lg font-medium text-foreground">Contact Us</h2>
            <p className="m-0">
              If you have any questions about this Privacy Policy or our privacy practices, please
              contact us at{' '}
              <a href="mailto:privacy@wordleteams.com" className="underline">
                privacy@wordleteams.com
              </a>
              .
            </p>
          </section>

          <p className="m-0 text-sm">Effective Date: September 2, 2026</p>
        </div>
      </article>
    </main>
  )
}
