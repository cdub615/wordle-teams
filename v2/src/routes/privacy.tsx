import { createFileRoute } from '@tanstack/react-router'
import { pageTitle } from '#/lib/seo'

/**
 * Ported from v1's src/app/privacy/page.tsx.
 *
 * THE PROSE IS COPIED VERBATIM AND MUST STAY THAT WAY. This is a published
 * legal document — the version live at wordleteams.com/privacy, effective
 * 2024-05-21 — not app copy. Rewording it to describe v2's architecture would
 * be amending a policy users have already been shown, which is the owner's
 * decision and not a port's. Only the MARKUP below is new.
 *
 * TWO THINGS IN THIS TEXT ARE ALREADY OUT OF STEP WITH THE PRODUCT, recorded
 * here rather than silently fixed:
 *
 *   1. "(e.g., Google, Apple, Facebook, etc.)" — neither Apple nor Facebook has
 *      ever been a sign-in provider. v1 offered google, twitter, azure, github,
 *      slack and discord (src/app/login/oauth/oauth-signin.tsx); v2 offers
 *      google, microsoft, github and discord (convex/auth.ts, which records why
 *      slack and X were dropped). The list is hedged with "e.g." and "etc.", so
 *      it reads as illustrative rather than exhaustive, but it names two
 *      companies that receive no data from this app.
 *   2. "we collect your name, username, email address" — there is no username.
 *      v1 never had one either; v2's players table is firstName/lastName
 *      (convex/schema.ts).
 *
 * Everything else still holds on v2: the profile image from the OAuth provider
 * is stored and rendered (components/settings/user-menu.tsx), and no vendor is
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
  head: () => ({ meta: [{ title: pageTitle('Privacy Policy') }] }),
  component: Privacy,
})

function Privacy() {
  return (
    <main className="page-wrap px-4 py-12">
      <article className="island-shell rounded-2xl p-6 sm:p-8">
        <p className="island-kicker mb-2">Legal</p>
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
              your name, username, email address, and your profile image if provided by the
              third-party sign-in provider you use (e.g., Google, Apple, Facebook, etc.).
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

          <p className="m-0 text-sm">Effective Date: May 21, 2024</p>
        </div>
      </article>
    </main>
  )
}
