/**
 * WHAT PRO ACTUALLY INCLUDES — one list, checked against the code that gates it.
 *
 * Sibling of trial-copy.ts and billing-copy.ts, and here for the reason
 * trial-copy.ts gives: the copy is the deliverable and the component is not. A
 * sentence chosen in a spec and then typed straight into JSX is a product decision
 * no test can reach.
 *
 * IT EXISTS BECAUSE THE PRODUCT HAD NO SUCH LIST AND THE ONE DESCRIPTION IT DID
 * HAVE WAS WRONG. components/home/feature-cards.tsx's "Go Pro" card sold
 * "unlimited months" while month-picker.tsx offered everyone three — a claim v2
 * did not honour, on the only page that described the tier, in the week of a
 * launch email. wordle-teams-kusd shipped the month window so the claim became
 * true; this file is what stops the next one drifting.
 *
 * TWO CONSUMERS, BOTH DOWNSTREAM: wordle-teams-iht.1's upgrade interstitial and
 * wordle-teams-wty4.1.14's marketing pages. They describe one tier and must not
 * describe it twice.
 *
 * `gatedAt` IS NOT DECORATION, AND IT IS NOT `enforcedAt`. Every entry names the
 * file where a free player is turned away, and pro-benefits.test.ts asserts each
 * path exists on disk. But only three of the five are turned away by the SERVER —
 * access.ts's doc comment on `isProFor` states plainly that "createTeam PAST THE
 * CAP IS NOT ENFORCED" and "THE SCORING-SYSTEM EDITOR IS NOT ENFORCED", and
 * board-entry/form.tsx's comment on the `isPro` query calls the import gate
 * "UI-ONLY BY DESIGN". (Line numbers are deliberately absent from this paragraph:
 * an earlier draft cited access.ts by line and the file had already moved by the
 * time this was written — exactly the kind of stale claim this module exists to
 * prevent elsewhere.) Both UI-only gates are deliberate v1-parity decisions — v1
 * sells those features the same way — and neither is a reason to leave them off
 * the list. What would be wrong is a field named `enforcedAt` claiming a server
 * check that two of these do not have.
 *
 * "SERVER-ENFORCED" MEANS "A FREE CALLER CANNOT GET IT BY SKIPPING THE UI", NOT
 * "GATED BY THE SAME PREDICATE EVERYWHERE". The `insights` entry is true on that
 * definition, but the predicate behind it is `paid = isPro || trialActive`
 * (lib/insightsAccess.ts) — broader than the `isProFor` check the `teams` and
 * `months` entries use, because insights.ts's teamMonth query deliberately grants
 * full history to an active Insights trial too, not just to Pro. That is a
 * decision recorded in insights.ts's own header, not a hole in this table: the
 * server still refuses a free, non-trial caller, which is all `serverEnforced`
 * claims.
 *
 * NO PRICE HERE. The price lives in Polar and reaches the customer on Polar's
 * hosted checkout. A number in this file is a second source of truth that goes
 * stale the moment the dashboard changes, silently, with every gate green.
 *
 * TEAM CHAT AND PUSH NOTIFICATIONS ARE NOT ON THIS LIST, and their absence is a
 * decision rather than an omission: neither is gated — there is no isProFor
 * anywhere in convex/chat.ts or convex/chatNotify.ts. They are part of the free
 * product and belong in the story the landing page tells about what the app does,
 * not in the one it tells about what Pro buys.
 */
export type ProBenefit = {
  id: 'teams' | 'scoring' | 'import' | 'insights' | 'months'
  /** A few words, headline case. */
  title: string
  /** One sentence, second person, no price. */
  body: string
  /** Repo-relative path to where a free player is turned away. Checked on disk. */
  gatedAt: string
  /** Whether the server refuses it, or only the UI hides it. See this file's header. */
  serverEnforced: boolean
}

export const PRO_BENEFITS: ReadonlyArray<ProBenefit> = [
  {
    id: 'teams',
    title: 'As many teams as you like',
    body: 'Free accounts can join two teams. Pro lifts the cap, and any invites waiting on it come through the moment you upgrade.',
    gatedAt: 'convex/lib/teamLimits.ts',
    serverEnforced: true,
  },
  {
    id: 'scoring',
    title: 'Your own scoring system',
    body: 'Decide what a two-guess day is worth, and what a failed one costs, for every team you own.',
    gatedAt: 'src/components/scoring-system-card.tsx',
    serverEnforced: false,
  },
  {
    id: 'import',
    title: 'Import from a screenshot',
    body: 'Paste a screenshot of your Wordle and we’ll fill the board in for you — check it and submit.',
    gatedAt: 'src/components/board-entry/form.tsx',
    serverEnforced: false,
  },
  {
    id: 'insights',
    title: 'Your full history, and your team’s whole month',
    body: 'Free shows you today. Pro shows you everything you have done, and how the whole team’s month is going rather than just one day of it.',
    gatedAt: 'convex/insights.ts',
    serverEnforced: true,
  },
  {
    id: 'months',
    title: 'Every month you have ever played',
    body: 'Free reaches back three months. Pro reaches back to your team’s very first board.',
    gatedAt: 'convex/lib/monthWindow.ts',
    serverEnforced: true,
  },
]
