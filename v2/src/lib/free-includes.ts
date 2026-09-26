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
 * WHY IT IS IN lib/ AND NOT IN THE COMPONENT THAT RENDERS IT. The list began as
 * an export of components/pricing/tier-table.tsx, and a list exported from a
 * component is a list no other surface will import: the landing page needed three
 * of these sentences, had no reasonable way to reach into a pricing component for
 * them, and wrote its own. The free side then had two inventories that disagreed
 * — Reminders a headline card on the landing and absent from /pricing, team chat
 * written twice in different words, the benchmark written twice in near-identical
 * sentences that had to be edited in lockstep. pro-benefits.ts is single-sourced
 * against exactly that, and the three surfaces that describe Pro —
 * components/upgrade-dialog.tsx, routes/about.tsx and the tier table — all take
 * their words from it rather than writing their own.
 *
 * THE WORDING IS THE LANDING'S, NOT THE TIER TABLE'S, WHERE THE TWO DISAGREED:
 * `chat` verbatim, `reminders` with its one negated clause flipped (see that
 * entry), `benchmark` the tier table's sentence opened with the landing's clause
 * (see that entry too). The landing is where a stranger meets the product, and a
 * sentence written for somebody who has never heard of it survives being read by
 * somebody comparing tiers better than the reverse.
 *
 * ONE SOURCE, DECLARED PER-SURFACE SUBSETS — because "one inventory" cannot mean
 * "every surface renders all of it". components/pricing/tier-table.tsx renders the
 * six in this order, and the landing renders two selections of it by id:
 * components/home/marketing-copy.ts's `ALSO_FREE` (`chat`, `reminders`, under
 * "Included, free") and `PAYOFF_INCLUDES` (`benchmark`, `team-fact`, under the
 * Insights section), each with its own screenshot, because that page is a curated
 * highlight rather than a column. `freeInclusionsFor` below is how a surface takes
 * a subset. THE RULE THE SUBSETS EXIST TO KEEP: a surface may choose which entries
 * to show and may frame them in its own voice, and may not write its own sentence
 * for a free capability.
 *
 * `checkedAgainst` IS pro-benefits.ts's `gatedAt` WITH THE SIGN REVERSED, AND FOR
 * TWO ENTRIES IT IS LITERALLY THE SAME FILE. convex/lib/teamLimits.ts and
 * convex/lib/monthWindow.ts each appear in both lists — once as the file a Pro
 * claim is measured against, once as the file a free one is — which is what makes
 * "the other side" a loose way to put it: what differs is not the file but which
 * half of one rule the sentence sells. Those are also the two `gatedAt` entries
 * pro-benefits.ts's header sets apart as naming a constant rather than a throw
 * site, and the same pairing runs through `grantedHere` below. See both that
 * field's doc comment and `alsoGrantedIn`'s.
 *
 * A FREE CLAIM NEEDS THE HARDER TEST, and that is why the field is here at all. A
 * Pro claim that goes stale is noticed the first time somebody pays and does not
 * get it. A FREE claim that goes stale has no such moment: nobody complains that a
 * thing they were not charged for is missing, so the sentence just stays wrong.
 * free-includes.test.ts resolves every path to a real file, greps every file behind
 * a `grantedHere` entry for `isPro` — all of them, not just the first — measures
 * every line against every PRO_BENEFITS text, pins the six ids AND the six titles
 * as the shipped copy they are, refuses the same five Pro words the landing's own
 * sentences are refused, and holds all six to the rule below.
 *
 * EVERY ENTRY STATES WHAT ARRIVES, NEVER WHAT IS WITHHELD. This is the editorial
 * rule the file turns on and the one a seventh entry is likeliest to break, so it
 * is here rather than buried in the entry that last had to apply it. "Two teams
 * max", "no custom scoring" and "today only" are all accurate and all describe the
 * reader's loss; "Two teams", "Three months of scores" and a nudge "on the days
 * you have yet to play" are the same facts as arrivals. free-includes.test.ts
 * holds the whole inventory to a negative word list, and
 * components/pricing/tier-table.hook.test.ts holds the rendered column to the
 * same one.
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
 * convex/chatNotify.ts, so they are part of the free product. That sentence used
 * to be asserted in three comments and checked in none; chatNotify.ts is in
 * `alsoGrantedIn` now, so the grep is what keeps it true. Selling something
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
  /**
   * The rest of the files this one sentence rests on, resolved and greped exactly
   * as `checkedAgainst` is. `[]` when one file carries the whole sentence.
   *
   * IT EXISTS BECAUSE TWO OF THESE SENTENCES SELL TWO THINGS. `chat` promises the
   * thread AND the push, and the push is convex/chatNotify.ts's rather than
   * convex/chat.ts's. `reminders` promises a nudge AND that the time and the
   * method are the reader's own, which convex/settings.ts settles — it patches
   * `reminderDeliveryTime` and `reminderDeliveryMethods`, and the only other
   * writers are the signup default in players.ts, the migration and the fixtures.
   * One path per entry left the grep covering half of each sentence while three
   * comments — this file's header, pro-benefits.ts's and pro-benefits.test.ts's —
   * asserted the other half unchecked, which is the exact shape of claim this list
   * exists to stop.
   *
   * NON-OPTIONAL, AND `[]` RATHER THAN ABSENT, so a seventh entry has to decide
   * rather than inherit silence. free-includes.test.ts pins which entries carry
   * one, so emptying this array fails instead of quietly shrinking the grep.
   */
  alsoGrantedIn: ReadonlyArray<string>
  /**
   * Whether `checkedAgainst` and `alsoGrantedIn` are the files that actually hand
   * this capability over — so a gate on it would have to land in ONE OF THEM, and
   * the absence of `isPro` across them is itself the claim. True for `chat` and
   * `reminders`, and for them the grep in free-includes.test.ts is the whole
   * guarantee.
   *
   * FALSE IS THE COMMONER CASE HERE, and it is the distinction pro-benefits.ts's
   * header already draws about teamLimits.ts and monthWindow.ts: neither of those
   * turns anyone away itself. `teams` and `months` name a constant and a set of
   * pure functions that the real enforcement reads — in teams.ts, players.ts,
   * inviteLinks.ts and scores.ts — while `benchmark` and `team-fact` name a client
   * helper and a component that render a decision convex/lib/insightsAccess.ts has
   * already made. Gating any of those four leaves the file named here untouched,
   * so a grep over all six would read as a guard on four claims it cannot see.
   * Pointing those four at their real decision site instead would not rescue the
   * grep: insightsAccess.ts holds seven `isPro` mentions, because deciding the
   * tier is precisely its job.
   */
  grantedHere: boolean
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
    alsoGrantedIn: [],
    grantedHere: false,
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
    alsoGrantedIn: [],
    grantedHere: false,
  },
  {
    id: 'benchmark',
    // Layer 1 is 'free' for everyone (insightsAccess.ts), and boardsForLayer1
    // trims that to the most recent board — the code's behaviour, in the code's
    // words, which are three of the four the column may not write in a row. The
    // fourth is "your", which pro-benefits.ts's `insights` body puts in front of
    // them; see below. What the row then shows is board-row.tsx's two sentences:
    // the opener's rank in the corpus and the day's difficulty percentile. NOT
    // "against everyone who played that day" — the corpus is a static artifact of
    // past puzzles, not a live field.
    //
    // "THE LAST BOARD YOU ENTERED", NOT "YOUR MOST RECENT BOARD", AND THE
    // WORDING IS FORCED RATHER THAN PREFERRED. pro-benefits.ts's `insights` body
    // describes the free half before the paid one — "Free shows your most recent
    // board, and today's team snapshot" — so the older opener shared exactly four
    // consecutive words with a Pro benefit. free-includes.test.ts measures every
    // line here against every PRO_BENEFITS text and fails at four, the threshold
    // plans.test.ts argues for; marketing-copy.test.ts records the same collision
    // firing on the landing's first draft and being fixed by rewording rather
    // than by exempting the section. This entry takes that opening for the same
    // reason, and it is the only benchmark sentence the product has: /pricing's
    // free column and the landing's Insights section both render this one.
    title: 'How your last board measured up',
    body: 'The last board you entered, set against every past Wordle: how hard that day was, and where your opener ranks.',
    checkedAgainst: 'src/lib/insights-panel.ts',
    alsoGrantedIn: [],
    grantedHere: false,
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
    alsoGrantedIn: [],
    grantedHere: false,
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
    alsoGrantedIn: ['convex/chatNotify.ts'],
    grantedHere: true,
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
    // AND THAT IS THIS FILE'S RULE RATHER THAN TASTE — the header states it:
    // what arrives, never what is withheld. A day the reader has not played is
    // an absence; the day the nudge arrives on is what this entry is about. The
    // same 'already-entered' skip stands behind either wording, and only one of
    // them is a thing free GIVES.
    title: 'Reminders',
    body: 'A nudge at a time you pick, by email or push, on the days you have yet to play.',
    checkedAgainst: 'convex/reminders.ts',
    alsoGrantedIn: ['convex/settings.ts'],
    grantedHere: true,
  },
]

/**
 * The entries a surface names, in the order it names them.
 *
 * A SUBSET IS A LIST OF IDS, NEVER OF POSITIONS. That is what lets the landing
 * show two of these six without holding a second copy of their words, and it is
 * what took the positional lookup out of components/home/also-free.tsx, where an
 * icon was matched to an entry by array index.
 *
 * AND THE ORDER IS THE CALLER'S, WHICH IS THE WHOLE REASON THIS IS `ids.map` AND
 * NOT A FILTER OVER THE ARRAY. `FREE_INCLUDES.filter((entry) =>
 * ids.includes(entry.id))` returns THIS file's order instead, and the two are
 * indistinguishable for any subset that happens to be declared in inventory order
 * — which both of the landing's are. Measured: with that body, the one test in the
 * suite that fails is the one asking for ['reminders', 'chat'], which is why
 * free-includes.test.ts asks in an order this array does not have.
 *
 * THE THROW IS LOAD-BEARING AND MUST NOT BECOME A `!`. Two different edits reach
 * it and only one of them is a type error. A caller naming an id that is not in
 * the union above does not compile — re-measured by renaming `chat` in the union
 * and the entry together: `tsc --noEmit` reports three errors, two in the landing
 * (also-free.tsx's icon map and marketing-copy.ts's selection) and one in
 * free-includes.test.ts, whose order assertion names `'chat'` as well; three
 * assertions in that file fail, the exact-six list, the order selection and the
 * `grantedHere` partition; and marketing-copy.test.ts does not load at all,
 * because the throw below fires on import. But DELETING AN ENTRY while the union
 * keeps its name
 * typechecks clean: `ReadonlyArray<FreeInclusion>` obliges nobody to hold six of
 * them, so retiring a capability — the likeliest reason anyone edits this array —
 * reaches this line with no type error anywhere, measured at `tsc --noEmit` exit
 * 0. The throw is what makes that state say `free-includes: no entry is named
 * reminders` at import time instead of handing a component `undefined.title`, and
 * free-includes.test.ts's list assertions are what fail in CI.
 */
export const freeInclusionsFor = (
  ids: ReadonlyArray<FreeInclusion['id']>,
): ReadonlyArray<FreeInclusion> =>
  ids.map((id) => {
    const inclusion = FREE_INCLUDES.find((entry) => entry.id === id)
    if (!inclusion) throw new Error(`free-includes: no entry is named ${id}`)
    return inclusion
  })
