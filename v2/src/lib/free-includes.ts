/**
 * WHAT A FREE ACCOUNT ACTUALLY GETS — the inventory the product has never had.
 *
 * WHY THIS EXISTS AT ALL. A tier table's default shape is a column of ticks
 * beside a column of crosses, and the cross column is written as the tick column
 * negated: "two teams max", "no custom scoring", "today only". That is a
 * perfectly accurate description of free and a disastrous pitch, because the
 * reader of /pricing has never heard of the product — the thing they are being
 * asked to sign up for IS the free tier, and a column of refusals tells them it
 * does nothing. Every free account gets two teams, three months of scores, a
 * benchmark on the last board it entered, a team fact every day, team chat with a
 * push behind it, and a reminder at a time of its own choosing. That is the
 * product; Pro is what it grows into.
 *
 * WHY IT IS IN lib/ RATHER THAN IN THE COMPONENT THAT RENDERS IT, which is the
 * defect this file was extracted to fix and not a tidying preference. The list
 * began as an export of components/pricing/tier-table.tsx, and an inventory
 * exported from a component is an inventory no other surface will import: the
 * landing page needed two of these sentences, had no reasonable way to reach into
 * a pricing component for them, and wrote its own. The free side then had two
 * inventories that disagreed — Reminders a headline card on the landing and
 * absent from /pricing, team chat written twice in different words, the benchmark
 * written twice in near-identical sentences that had to be edited in lockstep.
 * pro-benefits.ts is single-sourced against exactly that, and the three surfaces
 * that describe Pro — components/upgrade-dialog.tsx, routes/about.tsx and the tier
 * table — all take their words from it rather than writing their own.
 *
 * ONE CONSUMER TODAY, AND THE DUPLICATES ARE STILL STANDING. The tier table
 * renders this list whole. components/home/marketing-copy.ts still writes its own
 * copies of the `chat` and `reminders` sentences, and its own near-twin of the
 * `benchmark` one in `PAYOFF.body`; folding those into a selection from this list
 * is the follow-up, and the landing inherits whatever this file says once it
 * lands. The wording here is the landing's rather than the tier table's for that
 * reason: `chat` word for word, `reminders` with its one negated clause put in the
 * affirmative (see that entry), and `benchmark` opening on the landing's clause
 * without being its sentence.
 *
 * `checkedAgainst` IS pro-benefits.ts's `gatedAt` FROM THE OTHER SIDE, and it is
 * here for a sharper reason than symmetry. A Pro claim that goes stale is noticed
 * the first time somebody pays and does not get it. A FREE claim that goes stale
 * has no such moment: nobody complains that a thing they were not charged for is
 * missing, so the sentence just stays wrong. The field names the file that makes
 * each claim true, and free-includes.test.ts asserts both that the path resolves
 * to a real file and that the file it names contains no `isPro` anywhere —
 * describing a gated capability as free is the defect this family of lists exists
 * to prevent.
 *
 * THE NUMBERS ARE WORDS AND THE CONSTANTS ARE PINNED BY THE TEST. FREE_TEAM_LIMIT
 * and FREE_MONTHS are not imported here, because prose cannot embed a template
 * literal — the same problem pro-benefits.ts and plans.ts both have, solved the
 * same way, with a test that fails if either constant moves away from the word
 * above it.
 *
 * CHAT AND NOTIFICATIONS BELONG IN THIS LIST AND NOT IN PRO'S. pro-benefits.ts's
 * header records their absence from the Pro list as a decision rather than an
 * omission: there is no `isProFor` anywhere in convex/chat.ts or
 * convex/chatNotify.ts, so they are part of the free product. Selling something
 * already free is the same defect as selling something that does not exist.
 */
export type FreeInclusion = {
  id: 'teams' | 'months' | 'benchmark' | 'team-fact' | 'chat' | 'reminders'
  /** A few words, headline case. */
  title: string
  /** One sentence, second person, stated as what arrives. */
  body: string
  /**
   * Path to the file that makes this claim true, resolved against this package's
   * root (`v2/`, not the outer repo) by free-includes.test.ts.
   */
  checkedAgainst: string
}

export const FREE_INCLUDES: ReadonlyArray<FreeInclusion> = [
  {
    id: 'teams',
    // FREE_TEAM_LIMIT is 2. Says JOIN rather than create, which is the same
    // distinction pro-benefits.ts's `teams` entry is careful about: nothing
    // stops a free account calling createTeam a sixth time, and the enforced
    // path — invitePlayerFor, completeProfileFor, inviteLinks — is the join.
    title: 'Two teams',
    body: 'Join two teams and play with both — your own, and the one a friend invites you to.',
    checkedAgainst: 'convex/lib/teamLimits.ts',
  },
  {
    id: 'months',
    // FREE_MONTHS is 3, and that constant's own comment spells the window out:
    // "this month and the two before it". Deliberately silent about WHOSE rules
    // score it — a custom scoring system is Pro, and "your team's own rules"
    // would sell it from the free column by accident.
    title: 'Three months of scores',
    body: 'This month and the two before it, board by board, scored and settled.',
    checkedAgainst: 'convex/lib/monthWindow.ts',
  },
  {
    id: 'benchmark',
    // Layer 1 is 'free' for everyone (insightsAccess.ts), and boardsForLayer1
    // trims that to the most recent board. What the row then shows is
    // board-row.tsx's two sentences: the opener's rank in the corpus and the
    // day's difficulty percentile. NOT "against everyone who played that day" —
    // the corpus is a static artifact of past puzzles, not a live field.
    //
    // "THE LAST BOARD YOU ENTERED", NOT "YOUR MOST RECENT BOARD", AND THE
    // WORDING IS FORCED RATHER THAN PREFERRED. pro-benefits.ts's `insights` body
    // describes the free half before the paid one — "Free shows your most recent
    // board, and today's team snapshot" — so the older opener shared exactly
    // four consecutive words with a Pro benefit. marketing-copy.test.ts measures
    // the longest shared run of any free-voice line against every PRO_BENEFITS
    // text and fails at four, and its comment records this very collision firing
    // on the landing's first draft and being fixed by this reword rather than by
    // exempting the section. marketing-copy.ts's PAYOFF.body already opens "The
    // last board you entered" for that reason; this is the same sentence-opening
    // on the surface that sells the tier, so the two cannot disagree once one
    // list feeds both.
    title: 'How your last board measured up',
    body: 'The last board you entered, set against every past Wordle: how hard that day was, and where your opener ranks.',
    checkedAgainst: 'src/lib/insights-panel.ts',
  },
  {
    id: 'team-fact',
    // Layer 3 is 'free' for everyone, and daily-team-fact.tsx is the sentence it
    // buys: "You beat two of three teammates who have played today." It renders
    // only once the viewer has entered, which is why the body says to enter
    // first rather than promising a fact that is not there yet.
    title: 'A team fact every day',
    body: 'Enter today’s board and see how many of your teammates you beat.',
    checkedAgainst: 'src/components/insights/daily-team-fact.tsx',
  },
  {
    id: 'chat',
    // Ungated in both directions: convex/chat.ts has no isProFor, and
    // convex/chatNotify.ts sends to whoever subscribed. The push carries the
    // team's NAME and no message text — chatNotify.ts's push body is
    // `chatNotificationBody(teamName)`, a privacy decision recorded in
    // routes/privacy.tsx — so this entry promises only that the thread moved,
    // never that the notification tells you what was said.
    title: 'Team chat, and a push when it moves',
    body: 'Argue about the word in the app, with the people who actually played it, and get a push when the thread moves.',
    checkedAgainst: 'convex/chat.ts',
  },
  {
    id: 'reminders',
    // Three claims, all in reminders.ts's `deliver`: the time is the player's
    // own (REMINDER_TIMES in convex/lib/reminders.ts, set in settings'
    // notifications tab), the methods are email and push
    // (reminderDeliveryMethods), and a player who already entered is skipped
    // ('already-entered'), which is what "the days you have yet to play" is.
    //
    // "THE DAYS YOU HAVE YET TO PLAY", NOT "THE DAYS YOU HAVE NOT PLAYED YET",
    // AND THAT IS THIS COLUMN'S RULE RATHER THAN TASTE. tier-table.hook.test.ts
    // holds the free column to "described by what arrives, never by what is
    // withheld", and a day the reader has not played is an absence, while the day
    // the nudge arrives on is what this entry is about. The same 'already-entered'
    // skip stands behind either wording; only one of them is a thing free GIVES.
    title: 'Reminders',
    body: 'A nudge at a time you pick, by email or push, on the days you have yet to play.',
    checkedAgainst: 'convex/reminders.ts',
  },
]
