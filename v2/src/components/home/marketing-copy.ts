import { MODEL_LINE } from '#/lib/onboarding-tasks.ts'
import { PRO_PRICE_LINE } from '#/lib/plans.ts'

/**
 * EVERY SENTENCE THE LANDING PAGE SAYS, AS DATA.
 *
 * This is the replacement for components/home/feature-cards.tsx's `FEATURES`,
 * and it exists for that file's stated reason rather than as a style
 * preference: vitest.config.ts sets `environment: 'edge-runtime'`, so nothing
 * in this repo can render a component, and copy living inside JSX is copy no
 * gate can read. feature-cards.tsx's banner put it plainly — "deleting a card
 * used to be invisible to every gate" — and mutation testing of that task
 * proved it. The components below this file are markup and nothing else.
 *
 * WHAT WAS WRONG WITH WHAT THIS REPLACES. The six cards sold Pro as "unlimited
 * months, unlimited teams, customizable scoring systems, and more" — one clause
 * the product did not honour (month-picker.tsx offered everyone three months
 * until wordle-teams-kusd), and an "and more" standing in for the entire
 * Insights surface, team chat, screenshot import, push notifications and the
 * Pro month window, none of which the landing page mentioned at all.
 *
 * THE RULE THAT REPLACES IT: NO LINE HERE CLAIMS A CAPABILITY THE CODE DOES NOT
 * BACK, AND NO LINE DESCRIBES A GATED ONE AS THOUGH IT WERE FREE. Every entry
 * below carries a `checkedAgainst` path, which is lib/pro-benefits.ts's
 * `gatedAt` from the free side — the same field, and the same discipline, that
 * components/pricing/tier-table.tsx's FREE_INCLUDES uses. marketing-copy.test.ts
 * asserts each path resolves to a real file, and for the free extras it asserts
 * the named file contains no `isPro` at all.
 *
 * WHY A FREE CLAIM NEEDS THE HARDER TEST, in tier-table.tsx's words: a Pro claim
 * that goes stale is noticed the first time somebody pays and does not get it; a
 * free claim that goes stale has no such moment, because nobody complains that a
 * thing they were not charged for is missing.
 *
 * THE PAGE IS WRITTEN FOR SOMEONE WHO HAS NEVER HEARD OF THIS — the owner's
 * decision. The "what's new since v1" story belongs to the launch email
 * (wordle-teams-7e3c), which is a one-time send; a landing page written around
 * it would be stale the week after launch.
 *
 * IT IS NOT THE THIRD COPY OF THE TIER TABLE. pro-benefits.ts's header names its
 * two consumers — the upgrade dialog and /pricing — and says they "describe one
 * tier and must not describe it twice". This file describes neither tier: it
 * describes what the app DOES, in the free product's terms, and hands the tier
 * question to /pricing with one link at the bottom. Nothing here enumerates what
 * Pro includes, which is why it can be read without PRO_BENEFITS in hand.
 */

/**
 * THE HERO'S SECOND LINE IS `MODEL_LINE` ITSELF, IMPORTED.
 *
 * onboarding-tasks.ts's comment says that sentence is "stated NOWHERE ELSE
 * inside the app", and it is the one thing a stranger has to understand before
 * anything else on this page means something. Importing it rather than retyping
 * it means the landing and the onboarding card cannot drift into two
 * descriptions of one game. The test pins it by IDENTITY, not by text.
 *
 * v1's SUBTITLE IS GONE AND THAT IS THE POINT. It read "Keep score to establish
 * bragging rights in the ultimate app for Wordle enthusiasts" — a sentence that
 * tells a stranger nothing about what happens when they sign up. The gradient
 * band it carried moved onto the h1's last word; see title.tsx for the contrast
 * measurements, which are unchanged because the token pairing is unchanged.
 */
export const HERO = {
  title: 'Compete with friends',
  /** The word of `title` the brand gradient sits behind. Must be its tail. */
  highlight: 'friends',
  model: MODEL_LINE,
  cta: 'Get Started',
}

/**
 * The two section headings that are not part of a list below.
 *
 * HERE RATHER THAN IN THE JSX for this file's whole reason: a heading is copy,
 * and copy typed into a component is copy no gate can read. "Included, free"
 * is also the page's one load-bearing adjective — it is what tells a reader
 * that the section under it is not a teaser — so it is worth a test of its own.
 */
export const SECTION_TITLES = {
  howItWorks: 'How it works',
  alsoFree: 'Included, free',
}

export type MarketingItem = {
  /** A few words, headline case. */
  title: string
  /** One or two sentences, second person. */
  body: string
  /**
   * The file that makes this claim true, resolved against this package's root
   * (`v2/`, not the outer repo) by the disk test in marketing-copy.test.ts.
   */
  checkedAgainst: string
}

/**
 * The three steps, in the order onboarding-tasks.ts's TASK_COPY lists them.
 *
 * "TWO TEAMS ARE FREE" IS A NUMBER SPELLED AS A WORD, which no template literal
 * can keep honest — the problem pro-benefits.ts, plans.ts and tier-table.tsx all
 * have. Solved the same way: the test pins FREE_TEAM_LIMIT, so moving the
 * constant fails a gate instead of shipping stale copy behind four green ones.
 *
 * STEP 2 SAYS "TYPE", NEVER "PASTE", AND THAT IS THE WHOLE SPEC CORRECTION IN
 * ONE WORD. Screenshot import is Pro — board-entry/form.tsx renders
 * `ImportScreenshot` on `isPro === true` and `ImportUpsell` on false, and
 * pro-benefits.ts lists `import` as a gated benefit. A how-it-works step is the
 * ordinary path for a visitor who has not signed up, so offering them a paste
 * they will not have is the same defect as the "unlimited months" this page was
 * rebuilt to remove. The draft copy in the plan said "paste or type the result
 * here"; this is that clause, corrected.
 */
export const HOW_IT_WORKS: ReadonlyArray<MarketingItem> = [
  {
    title: 'Make a team',
    // JOIN, not create — FREE_TEAM_LIMIT is enforced on the join path
    // (teams.ts, players.ts, inviteLinks.ts) and not on createTeam, the same
    // distinction pro-benefits.ts's `teams` entry and tier-table.tsx's are
    // careful about. "Two teams are free" is true of what a free account can
    // be holding, which is what the cap actually governs.
    body: 'Invite the people you already send your score to every morning. Two teams are free.',
    checkedAgainst: 'convex/lib/teamLimits.ts',
  },
  {
    title: 'Enter your board',
    body: 'Play Wordle wherever you normally do, then type the result in. About ten seconds.',
    checkedAgainst: 'src/components/board-entry/form.tsx',
  },
  {
    title: 'Scores settle',
    // Deliberately does NOT restate MODEL_LINE's "fewer guesses scores more
    // points", which the reader met in the hero two sections above. The
    // scoring rule is stated once on this page; this step says what the
    // scoring produces — winnerOf in convex/lib/scoring.ts takes the biggest
    // monthly total.
    body: 'The table fills in as everyone plays, the month adds up, and somebody wins it.',
    checkedAgainst: 'convex/lib/scoring.ts',
  },
]

/**
 * The payoff section: what Insights gives a FREE account, and nothing else.
 *
 * BOTH HALVES ARE FREE-TIER TRUE AND EACH IS A DIFFERENT LAYER.
 * lib/insightsAccess.ts returns `layer1: 'free'` and `layer3: 'free'` for
 * everybody: Layer 1's free slice is the most recent board (boardsForLayer1),
 * and Layer 3's is one team fact for today (daily-team-fact.tsx — "You beat two
 * of three teammates who have played today"), which renders only once the
 * viewer has entered, hence "enter today and".
 *
 * "SET AGAINST EVERY PAST WORDLE", NEVER "AGAINST EVERYONE WHO PLAYED THAT DAY".
 * The plan's draft said the latter and it is false: the benchmark corpus is a
 * static artifact the CDN serves (convex/insights.ts's header, public/insights/),
 * so what a board is measured against is the historical difficulty of that day
 * and the opener's rank among past openers — not a live field of today's
 * players. tier-table.tsx's `benchmark` entry carries the same correction in its
 * own comment; this is the second surface to need it.
 *
 * NOT AN UPSELL, WITH ONE HONEST EXCEPTION. The prose sells nothing gated. But
 * the only Insights screenshot that exists (public/marketing/insights-*.png)
 * frames a Pro view — a whole month of head to head, and the personal trend
 * above it — so the section labels the picture rather than letting it imply the
 * prose. A caption that says which tier a screenshot belongs to is accuracy; it
 * is the closing CTA, not this section, that carries the link to /pricing.
 */
export const PAYOFF = {
  kicker: 'Insights',
  title: 'Find out whether that four was good',
  body: 'The last board you entered gets set against every past Wordle: how hard that day actually was, and where your opener ranks. Enter today and you also see how many of your teammates you beat.',
  /** Names the tier the screenshot beside this prose belongs to. */
  shotNote: 'Pictured: the Pro view — a whole month of head to head, and the trend behind it.',
  checkedAgainst: 'convex/lib/insightsAccess.ts',
}

/**
 * FREE THINGS ONLY, AND THE TEST IS THE REASON TO TRUST THAT.
 *
 * The spec's §6.1 asked this section to name "chat, notifications, custom
 * scoring, screenshot import". TWO OF THOSE FOUR ARE PRO: pro-benefits.ts gates
 * `scoring` (scoring-system-card.tsx's canEdit) and `import` (board-entry/
 * form.tsx's isPro), while chat and notifications are explicitly ungated —
 * pro-benefits.ts's header records their absence from the Pro list as a
 * decision, and its own test asserts the word "chat" appears nowhere in it.
 * Naming all four here as things the app does would have repeated, in the same
 * section, the defect this whole task exists to remove.
 *
 * `checkedAgainst` IS LOAD-BEARING HERE IN A WAY IT IS NOT ELSEWHERE. For the
 * steps above it names the file that implements the claim; for these two it
 * names the file whose LACK of an `isPro` is the claim, and the test greps for
 * exactly that. The day somebody gates team chat, this fails.
 */
export const ALSO_FREE: ReadonlyArray<MarketingItem> = [
  {
    title: 'Team chat',
    // "Hear about it", never "read it": chatNotify.ts sends the team's NAME and
    // no message text, which is a privacy decision recorded in routes/
    // privacy.tsx and stated the same way by tier-table.tsx's `chat` entry.
    body: 'Argue about the word in the app, with the people who actually played it, and get a push when the thread moves.',
    checkedAgainst: 'convex/chat.ts',
  },
  {
    title: 'Reminders',
    // Three claims, all in reminders.ts's `deliver`: the time is the player's
    // own (REMINDER_TIMES in convex/lib/reminders.ts, set in settings'
    // notifications tab), the methods are email and push
    // (reminderDeliveryMethods), and a player who already entered is skipped
    // ('already-entered'), which is what "on the days you have not played" is.
    body: 'A nudge at a time you pick, by email or push, on the days you have not played yet.',
    checkedAgainst: 'convex/reminders.ts',
  },
]

/**
 * The closing call to action.
 *
 * THE ANNUAL PRICE AND ONLY THE ANNUAL PRICE, taken from plans.ts's derived
 * `PRO_PRICE_LINE` rather than re-spelled, so this page cannot disagree with
 * /pricing or with the upgrade dialog. plans.ts's header explains why annual
 * leads (the fee arithmetic, not the headline number) and states that monthly
 * "is never disparaged and never promoted" — a landing page is exactly the
 * surface where quoting both turns into a comparison, so this quotes one and
 * sends the reader to the page whose job is the full answer.
 */
export const CLOSING = {
  line: `Free to play. ${PRO_PRICE_LINE}.`,
  cta: HERO.cta,
  proLink: 'See what Pro adds',
}

/**
 * The product shots, and the sentence each one is described by.
 *
 * ONE ENTRY PER PAIR OF FILES. Task 2's scripts/build-marketing-shots.mjs
 * captures `<stem>-light.png` and `<stem>-dark.png` into public/marketing/ at
 * 1440x900; components/home/product-shot.tsx composes the stem into both paths,
 * so a stem that names no file is a broken image on the landing page with every
 * gate green. The test resolves both files on disk for exactly that reason —
 * the same property pro-benefits.test.ts's `gatedAt` check buys.
 *
 * THE ALT TEXT IS A CLAIM LIKE ANY OTHER and is held to the same rule: it
 * describes what is in the frame after the crop, not what the product can do.
 */
export type Shot = {
  /** Basename without the `-light` / `-dark` suffix, under public/marketing/. */
  stem: string
  alt: string
}

export const SHOTS: Record<'dashboard' | 'insights' | 'chat', Shot> = {
  dashboard: {
    stem: 'dashboard',
    alt: 'A team’s month in Wordle Teams: every player’s daily scores in one table, with each player’s running total beside them.',
  },
  insights: {
    stem: 'insights',
    alt: 'An Insights panel showing one player leading a teammate nine to four over nineteen shared days, above their monthly averages and their best and worst days.',
  },
  chat: {
    stem: 'chat',
    alt: 'Team chat: two teammates trading messages about the day’s word and next month’s rematch.',
  },
}
