import { createFileRoute } from '@tanstack/react-router'
import { pageTitle } from '#/lib/seo'

/**
 * Ported from v1's src/app/terms/page.tsx.
 *
 * THE PROSE IS COPIED VERBATIM AND MUST STAY THAT WAY, for the reason spelled
 * out at the top of src/routes/privacy.tsx: this is the contract live at
 * wordleteams.com/terms, last updated 2024-05-21, and editing it to match a new
 * architecture is amending an agreement rather than porting a page. Only the
 * MARKUP is new.
 *
 * ONE CLAUSE HERE IS ALREADY OUT OF STEP WITH THE PRODUCT, recorded rather than
 * fixed: "third-party service providers (e.g. Google, Apple, Facebook, etc)".
 * Neither Apple nor Facebook has ever been a sign-in provider — v1 offered
 * google, twitter, azure, github, slack and discord; v2 offers google,
 * microsoft, github and discord (convex/auth.ts). "e.g." and "etc" make the
 * list illustrative, but it names two companies this app sends nothing to.
 *
 * Nothing else in the text is contradicted by v2. No vendor, platform or
 * datastore is named anywhere in it, so the Supabase/Vercel -> Convex/
 * Cloudflare move leaves every clause intact, and the governing-law and
 * liability sections are architecture-independent by construction.
 *
 * v1 set `export const revalidate = 86400`. v2's equivalent is
 * src/lib/cache-policy.ts, which already lists '/terms' in STATIC_DOCUMENTS —
 * inert while this route 404'd, since src/server.ts shares only a 200, and live
 * from this file onward.
 */
export const Route = createFileRoute('/terms')({
  // v1: src/app/terms/layout.tsx metadata.title -> 'Terms of Service'
  head: () => ({ meta: [{ title: pageTitle('Terms of Service') }] }),
  component: Terms,
})

function Terms() {
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
          Terms of Service
        </h1>

        <div className="flex max-w-3xl flex-col gap-8 text-base leading-8 text-muted-foreground">
          <p className="m-0">
            Welcome to Wordle Teams! By accessing or using the Wordle Teams website, mobile
            application, or any other products or services provided by Wordle Teams (collectively,
            the &quot;Service&quot;), you agree to be bound by these Terms of Service
            (&quot;Terms&quot;). Please read them carefully.
          </p>

          <section className="flex flex-col gap-2">
            <h2 className="m-0 text-lg font-medium text-foreground">Account Registration</h2>
            <p className="m-0">
              To access certain features of the Service, you must register for an account
              (&quot;Account&quot;). When you register for an Account, you may be required to
              provide us with some information about yourself, such as your email address or other
              contact information. You agree that the information you provide to us is accurate and
              up-to-date.
            </p>
            <p className="m-0">
              You are responsible for all activity that occurs under your Account, so please keep
              your Account credentials secure.
            </p>
          </section>

          <section className="flex flex-col gap-2">
            <h2 className="m-0 text-lg font-medium text-foreground">User Content</h2>
            <p className="m-0">
              The Service allows you and other users to create, post, share and store content such
              as wordle scores, game boards, and team information (&quot;User Content&quot;). You
              retain ownership of any intellectual property rights that you hold in your User
              Content.
            </p>
            <p className="m-0">
              When you create, post or share User Content with Wordle Teams, you grant us a
              worldwide, royalty-free, sublicensable, and transferable license to host, store, use,
              display, reproduce, modify, adapt, edit, publish and distribute that User Content for
              the purposes of operating and providing the Service.
            </p>
            <p className="m-0">
              You are solely responsible for your User Content and the consequences of creating,
              posting or sharing it. Any User Content or behavior that violates these Terms may be
              removed or suspended by Wordle Teams.
            </p>
          </section>

          <section className="flex flex-col gap-2">
            <h2 className="m-0 text-lg font-medium text-foreground">
              Third-Party Services and Integrations
            </h2>
            <p className="m-0">
              The Service allows you to sign in via online accounts from third-party service
              providers (e.g. Google, Apple, Facebook, etc). If you choose to sign in or otherwise
              link your Wordle Teams Account with a third-party service, you are authorizing us to
              connect and access your approved information in that service, which may be governed
              by the privacy policy and terms of service of that service.
            </p>
          </section>

          <section className="flex flex-col gap-2">
            <h2 className="m-0 text-lg font-medium text-foreground">Prohibited Conduct</h2>
            <p className="m-0">
              You agree not to violate any laws, contracts, intellectual property or other
              third-party rights or commit any torts, and that you are solely responsible for your
              conduct while using the Service. Prohibited activities include:
            </p>
            <ul className="m-0 list-disc pl-5">
              <li>
                Use the Service in any manner that could interfere with, disrupt, negatively affect
                or inhibit other users from fully utilizing the Service
              </li>
              <li>Stalk, harass, bully, intimidate, threaten or defraud others</li>
              <li>
                Post, upload, share or distribute User Content that is defamatory, libelous,
                inaccurate, violent, abusive, profane, vulgar, obscene, pornographic, invasive of
                another&apos;s privacy, or otherwise objectionable
              </li>
              <li>
                Attempt to circumvent any content-filtering techniques we employ, or attempt to
                access restricted areas of the Service
              </li>
              <li>
                Probe, scan, or test the vulnerability of the Service or any related system or
                network, or breach the security or authentication measures used in connection with
                the Service
              </li>
              <li>
                Take any action that imposes an unreasonable load on the infrastructure used to
                provide the Service
              </li>
              <li>
                Use the Service for any illegal or unauthorized purpose or engage in, encourage or
                promote any activity that violates these Terms
              </li>
            </ul>
          </section>

          <section className="flex flex-col gap-2">
            <h2 className="m-0 text-lg font-medium text-foreground">
              Modifying and Terminating the Service
            </h2>
            <p className="m-0">
              We reserve the right to modify or discontinue the Service at any time (including by
              limiting or discontinuing certain features), temporarily or permanently, without
              notice to you. We will have no liability for any change to the Service or any
              suspension or termination of your access to or use of the Service.
            </p>
          </section>

          <section className="flex flex-col gap-2">
            <h2 className="m-0 text-lg font-medium text-foreground">Termination</h2>
            <p className="m-0">
              We may terminate or suspend your access to the Service immediately, without prior
              notice or liability, for any reason whatsoever, including without limitation if you
              breach the Terms. All provisions of the Terms which by their nature should survive
              termination shall survive termination, including, without limitation, ownership
              provisions, warranty disclaimers, indemnity and limitations of liability.
            </p>
          </section>

          <section className="flex flex-col gap-2">
            <h2 className="m-0 text-lg font-medium text-foreground">Disclaimers</h2>
            <p className="m-0">
              THE SERVICE IS PROVIDED &quot;AS IS&quot; WITHOUT WARRANTIES OF ANY KIND. WE DISCLAIM
              ALL WARRANTIES, EXPRESS OR IMPLIED, INCLUDING ANY WARRANTY OF MERCHANTABILITY,
              FITNESS FOR A PARTICULAR PURPOSE, TITLE, OR NON-INFRINGEMENT.
            </p>
          </section>

          <section className="flex flex-col gap-2">
            <h2 className="m-0 text-lg font-medium text-foreground">Limitation of Liability</h2>
            <p className="m-0">
              IN NO EVENT SHALL WORDLE TEAMS, NOR ITS AFFILIATES, BE LIABLE FOR ANY INDIRECT,
              PUNITIVE, INCIDENTAL, SPECIAL, CONSEQUENTIAL OR EXEMPLARY DAMAGES ARISING OUT OF OR
              IN ANY WAY CONNECTED WITH ACCESS TO OR USE OF THE SERVICE.
            </p>
          </section>

          <section className="flex flex-col gap-2">
            <h2 className="m-0 text-lg font-medium text-foreground">Changes to Terms</h2>
            <p className="m-0">
              We may revise these Terms from time to time. The most current version will always be
              available on our website. If a revision is material, as determined solely by us, we
              will notify you. By continuing to access or use the Service after revisions become
              effective, you agree to be bound by the revised Terms.
            </p>
          </section>

          <section className="flex flex-col gap-2">
            <h2 className="m-0 text-lg font-medium text-foreground">Contact Us</h2>
            <p className="m-0">
              If you have any questions or comments about these Terms, please contact us at{' '}
              <a href="mailto:support@wordleteams.com" className="underline">
                support@wordleteams.com
              </a>
              .
            </p>
          </section>

          <p className="m-0">
            These Terms shall be governed by and construed in accordance with the laws of the
            United States of America.
          </p>

          <p className="m-0 text-sm">Last Updated: May 21, 2024</p>
        </div>
      </article>
    </main>
  )
}
