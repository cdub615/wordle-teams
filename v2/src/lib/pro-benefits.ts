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
 * true; this file is what stops the next one drifting. (Review found the same
 * defect living here on the first pass — see the `insights` entry's history —
 * which is the reason every claim below is checked against the file it names
 * rather than trusted because it sounds right.)
 *
 * THREE CONSUMERS, ALL DOWNSTREAM: wordle-teams-iht.1's upgrade interstitial
 * (components/upgrade-dialog.tsx) and wordle-teams-wty4.1.14's two marketing
 * pages — components/pricing/tier-table.tsx, which renders title and body, and
 * routes/about.tsx, which renders the titles alone. They describe one tier and
 * must not describe it twice.
 *
 * `gatedAt` IS NOT DECORATION, AND IT IS NOT `enforcedAt`. Every entry names the
 * file this rule's source of truth lives in, and pro-benefits.test.ts asserts
 * each path exists on disk. For `scoring` and `import` that file is literally
 * where a free caller is turned away — scoring-system-card.tsx's `canEdit` check
 * and board-entry/form.tsx's comment on the `isPro` query, which calls that gate
 * "UI-ONLY BY DESIGN" in so many words. Neither is enforced on the server, and
 * both are deliberate v1-parity decisions — v1 sells those features the same
 * way — so being UI-only is not a reason to leave them off the list. What would
 * be wrong is a field named `enforcedAt` claiming a server check neither has.
 * `teamLimits.ts` and `monthWindow.ts` are different in kind: neither one turns
 * anyone away itself (the first is one exported constant, the second is pure
 * functions with no `ctx` and no throw) — they are the single source of truth
 * the real enforcement, named below, reads. See that field's own doc comment.
 *
 * `TEAMS` HAS MIXED ENFORCEMENT, AND A BOOLEAN CANNOT SAY SO — this paragraph
 * has to. access.ts's doc comment on `isProFor` states plainly that "`createTeam`
 * PAST THE CAP IS NOT ENFORCED": nothing stops a free account calling
 * `createTeam` a sixth time. But the benefit this entry sells is JOINING, not
 * creating, and that path is enforced twice over — teams.ts's `invitePlayerFor`
 * parks a non-pro invitee already at `FREE_TEAM_LIMIT`, players.ts's
 * `completeProfileFor` claims at most that many invites at signup,
 * inviteLinks.ts throws `TEAM_LIMIT_REACHED` on the same check for a link join,
 * and billing.ts's `downgradeTeamRemovalFor` strips the surplus back down on a
 * revoked subscription. `serverEnforced: true` is defensible here for exactly
 * the reason the title says "join", not "create" or "own".
 *
 * "SERVER-ENFORCED" MEANS "A FREE, NON-TRIAL CALLER CANNOT GET IT BY SKIPPING
 * THE UI", NOT "GATED BY ONE PREDICATE EVERYWHERE". `insights` is true on that
 * definition, but the check behind it, `paid = isPro || trialActive`
 * (lib/insightsAccess.ts), is deliberately wider than the `isProFor` the `teams`
 * and `months` entries use: an active Insights trial gets Layers 2 and 3 in
 * full — personal history from `myBenchmarkBoards` and the team month from
 * `teamMonth` — while Layer 1 and Layer 4 stay keyed to `isPro` directly. That
 * split is recorded in insightsAccess.ts's own header, not a hole in this table:
 * every layer still refuses a free, non-trial caller. Layer 4
 * (`globalComparison`) is `isPro`-gated and server-enforced too, but has no UI
 * consumer anywhere in `src/` yet — deliberately left off this list, since
 * selling a surface nobody can reach is the same defect as selling one that
 * doesn't exist. Wire it up before adding a sixth entry for it.
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
  /**
   * Path to this rule's source of truth, resolved against this package's root
   * (`v2/`, not the outer repo) by the disk test below. For `scoring`, `import`
   * and `insights` that file is where a free caller is turned away. For `teams`
   * and `months` it names the constant or pure function the actual enforcement —
   * in teams.ts, players.ts, inviteLinks.ts, billing.ts, and scores.ts — reads,
   * because the rule itself has no throw site of its own to point at.
   */
  gatedAt: string
  /**
   * Whether at least one server path refuses a free, non-trial caller who skips
   * the UI, or whether only the UI hides the control. See this file's header —
   * `teams` is `true` because the JOIN path is enforced even though `createTeam`
   * is not, and `insights` is `true` under a check that also admits an active
   * trial, not `isProFor` alone.
   */
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
    // isCurrentMonth is the other half of scoring-system-card.tsx's `canEdit`
    // check, alongside isPro and isOwner — a settled past month cannot be
    // re-scored by anyone, Pro included, so the body says so rather than
    // implying a Pro owner can go back and change what already happened.
    title: 'Your own scoring system',
    body: 'Decide what a two-guess day is worth, and what a failed one costs, for the current month on any team you own — past months stay settled.',
    gatedAt: 'src/components/scoring-system-card.tsx',
    serverEnforced: false,
  },
  {
    id: 'import',
    // Matches import-upsell.tsx's own copy ("Paste or upload a screenshot…")
    // rather than narrowing it: import-screenshot.tsx offers a paste listener,
    // a Paste button gated on canReadClipboard(), AND a file picker with a drop
    // zone, because iOS has no paste event to listen for and needs the picker.
    // "Paste a screenshot" alone would silently drop the one route that works
    // on an iPhone.
    title: 'Import from a screenshot',
    body: 'Paste or upload a screenshot of your Wordle and we’ll fill the board in for you — check it and submit.',
    gatedAt: 'src/components/board-entry/form.tsx',
    serverEnforced: false,
  },
  {
    id: 'insights',
    // "Full" and "everything you have done" are both false above
    // PRO_BOARD_LIMIT (insights.ts) — 400 boards, "a bit over a year" by that
    // file's own comment, above which myBenchmarkBoards truncates even a Pro
    // caller. Free Layer 1 is the most recent board, not "today" — that half
    // of the old copy described Layer 3 (today's team fact) and was wrong for
    // Layer 1, so the two are named separately below.
    title: 'Your history, and your team’s whole month',
    body: 'Free shows your most recent board, and today’s team snapshot. Pro shows a long personal history of your own boards, and how the whole team’s month is going rather than just one day of it.',
    gatedAt: 'convex/insights.ts',
    serverEnforced: true,
  },
  {
    id: 'months',
    // The window is team-scoped and roster-derived (monthWindow.ts), not a
    // record of the reader's own tenure: join a team today and Pro reaches
    // back to ITS first board, from before you were on it. The body says so
    // rather than reading as a promise about days you personally played. The
    // reverse edge — the window walks the CURRENT roster, so a departing
    // founder narrows it for everyone who stays — is a real consequence of the
    // same rule but not a sentence a benefits list should lead with.
    title: 'Every month your team has ever played',
    body: 'Free reaches back three months. Pro reaches back to your team’s very first board — even years before you joined.',
    gatedAt: 'convex/lib/monthWindow.ts',
    serverEnforced: true,
  },
]
