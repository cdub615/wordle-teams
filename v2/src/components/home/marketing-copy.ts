import { freeInclusionsFor } from '#/lib/free-includes.ts'
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
 * BACK, AND NO LINE DESCRIBES A GATED ONE AS THOUGH IT WERE FREE. The page keeps
 * that rule by taking its free-capability sentences from lib/free-includes.ts
 * rather than writing them: `ALSO_FREE` and `PAYOFF_INCLUDES` below are selections
 * by id, rendered in the inventory's own words, the way
 * components/pricing/tier-table.tsx renders PRO_BENEFITS.
 *
 * AND WRITING ONE ANYWAY IS A FAILING TEST, NOT A STYLE NOTE.
 * marketing-copy.test.ts measures every sentence this file WROTE against every
 * title and body in that inventory and fails at four consecutive shared words.
 * Measured against the entries that replaced them, the three hand-written BODIES
 * this page used to hold share 9, 16 and 22 consecutive words with their entry, so
 * each would now be red; their two titles — "Team chat" and "Reminders" — are a
 * word or two long and would not be, which no threshold that lets this page be
 * written could change. The two sentences named below as exceptions are measured by
 * it as well and clear it: the first step, which ends "Two teams are free", shares
 * two consecutive words with the `teams` entry — the noun phrase and nothing more —
 * and `PAYOFF.title` shares one with anything in the list.
 *
 * TWO SENTENCES ARE THE EXCEPTION AND EACH CARRIES ITS OWN GUARANTEES. The first
 * is `HOW_IT_WORKS`'s opening step, which ends "Two teams are free" — the
 * inventory's `teams` entry said in the page's voice, inside a step about making a
 * team, because a cold visitor meets the cap there rather than in a list. It keeps
 * a `checkedAgainst` of its own (convex/lib/teamLimits.ts), marketing-copy.test.ts
 * pins FREE_TEAM_LIMIT against it, and the block on HOW_IT_WORKS below spells out
 * why the number is a word.
 *
 * The second is `PAYOFF.title`, "Find out whether that four was good", which tells
 * a visitor they can find out — a claim by the test the block on PAYOFF states, and
 * that block carries the whole argument: why it stays, that it is true today, and
 * that what backs it is the `benchmark` entry rendered under it rather than a path
 * named here.
 *
 * Everything else this file writes is about something other than what the tier
 * includes: the hero's headline, its MODEL_LINE and its CTA label (`highlight` is
 * a slice of the headline rather than a line of its own), the two section
 * headings, the other two steps, PAYOFF's kicker and its lead — which that block
 * qualifies rather than declaring claim-free — the screenshot caption, the alt
 * text and all three of CLOSING's.
 *
 * SO `checkedAgainst` IS ON HOW_IT_WORKS AND NOWHERE ELSE. It is
 * lib/pro-benefits.ts's `gatedAt` from the free side — the same field, and the
 * same discipline, that lib/free-includes.ts uses — and marketing-copy.test.ts
 * asserts each of those three paths resolves to a real file. The files behind the
 * free claims belong to the inventory, and free-includes.test.ts is what resolves
 * them, greps the two whose capability is granted in the files they name, and
 * measures every line of all six against every PRO_BENEFITS text.
 *
 * WHY A FREE CLAIM NEEDS THE HARDER TEST, in lib/free-includes.ts's words: a Pro
 * claim that goes stale is noticed the first time somebody pays and does not get
 * it; a free claim that goes stale has no such moment, because nobody complains
 * that a thing they were not charged for is missing.
 *
 * THE PAGE IS WRITTEN FOR SOMEONE WHO HAS NEVER HEARD OF THIS — the owner's
 * decision. The "what's new since v1" story belongs to the launch email
 * (wordle-teams-7e3c), which is a one-time send; a landing page written around
 * it would be stale the week after launch.
 *
 * IT IS NOT THE THIRD COPY OF THE TIER TABLE. pro-benefits.ts's header names its
 * consumers — the upgrade dialog, /about and /pricing — and says they "describe
 * one tier and must not describe it twice". This file describes neither tier in
 * its own words: it says what the app DOES, in the free product's terms, and hands
 * the tier question to /pricing with one link at the bottom. Nothing here
 * enumerates what Pro includes, which is why it can be read without PRO_BENEFITS
 * in hand.
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
 * that the section under it is not a teaser.
 *
 * THIS BLOCK USED TO CALL THAT "WORTH A TEST OF ITS OWN" AND THERE WAS NONE — no
 * test imported SECTION_TITLES at all. The claim was dropped rather than made
 * true: both headings now sit in marketing-copy.test.ts's `renderedCopy`, which
 * carries one rule, typographic apostrophes, and neither heading contains an
 * apostrophe to get wrong. What actually pins these two strings is
 * e2e/routes.spec.ts, which reads the landing's h2 outline in a browser.
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
 * can keep honest — the problem pro-benefits.ts, plans.ts and free-includes.ts
 * all have. Solved the same way: the test pins FREE_TEAM_LIMIT, so moving the
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
    // distinction pro-benefits.ts's `teams` entry and free-includes.ts's are
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
 * The payoff section: the Insights story, FRAMED here and CLAIMED in the
 * inventory.
 *
 * THE LEAD FRAMES, IT DOES NOT PROMISE, and the line between those two is what
 * decides where a sentence goes: IF A CHANGE TO convex/lib/insightsAccess.ts
 * COULD MAKE IT FALSE, IT IS A CLAIM AND BELONGS IN lib/free-includes.ts. That
 * file is what hands each layer out, so anything about what a reader GETS is
 * written where it is checked. `lead` passes that test as squarely as a sentence
 * on this page can: it names the section's subject rather than promising anything,
 * and read at its most demanding — as an assurance that there ARE numbers behind a
 * board you just entered — it has the same backing the heading does, in the two
 * entries rendered under it. The two capabilities under it are
 * `PAYOFF_INCLUDES` — the inventory's `benchmark` and `team-fact`, rendered in
 * their own words — which is the owner's decision on wordle-teams-wty4.1.14.11,
 * taken over keeping a written paragraph behind a drift guard and over
 * concatenating the two bodies into one.
 *
 * `title` DOES NOT PASS THAT TEST, AND IT STAYS. "Find out whether that four was
 * good" tells a visitor they can find out, and gating Layer 1 would make that
 * false — so by the rule above it is a claim and not framing. It is true today:
 * insightsAccess.ts returns `layer1: 'free'` for everybody and boardsForLayer1
 * trims that to the last board entered. And the rule's own remedy is already
 * where it points — the sentence that backs this heading is the inventory's
 * `benchmark` entry, checked there and rendered in the same block, under the lead.
 * A claim whose evidence is on the screen under it is a different thing from an
 * unbacked one, which is why the owner kept the h2 and why nothing here pretends
 * the section claims nothing.
 *
 * NOT AN UPSELL, WITH ONE HONEST EXCEPTION. Nothing in this section sells
 * anything gated. But the only Insights screenshot that exists
 * (public/marketing/insights-*.png) frames a Pro view — a whole month of head to
 * head, and the personal trend above it — so the section labels the picture
 * rather than letting it imply the words around it. A caption that says which
 * tier a screenshot belongs to is accuracy; it is the closing CTA, not this
 * section, that carries the link to /pricing.
 */
export const PAYOFF = {
  kicker: 'Insights',
  title: 'Find out whether that four was good',
  /**
   * Names what the section is about, never what the tier includes. A noun phrase
   * rather than a promise, for the reason above it.
   */
  lead: 'The numbers behind the board you just entered.',
  /** Names the tier the screenshot beside this prose belongs to. */
  shotNote: 'Pictured: the Pro view — a whole month of head to head, and the trend behind it.',
}

/** The two free capabilities that section describes, in the order it shows them. */
export const PAYOFF_INCLUDES = freeInclusionsFor(['benchmark', 'team-fact'])

/**
 * FREE THINGS ONLY, AND TWO OF THEM RATHER THAN SIX.
 *
 * WHICH TWO IS A DECISION, NOT A DEFAULT. The spec's §6.1 asked this section to
 * name "chat, notifications, custom scoring, screenshot import". TWO OF THOSE
 * FOUR ARE PRO: pro-benefits.ts gates `scoring` (scoring-system-card.tsx's
 * canEdit) and `import` (board-entry/form.tsx's isPro), while chat and
 * notifications are explicitly ungated — pro-benefits.ts's header records their
 * absence from the Pro list as a decision, and its own test asserts the word
 * "chat" appears nowhere in it. Naming all four here as things the app does would
 * have repeated, in the same section, the defect this page was rebuilt to remove.
 *
 * IDS, AND THE INVENTORY'S OWN WORDS. Two entries chosen from
 * lib/free-includes.ts, rendered by components/home/also-free.tsx with the
 * section's chat screenshot beneath them. Selecting rather than restating is what
 * keeps this section from drifting away from /pricing's free column — that file's
 * header has the account of the three disagreements the landing's own copies
 * produced. The other four are on /pricing, and two of those, `benchmark` and
 * `team-fact`, are on this page as well, under Insights (`PAYOFF_INCLUDES`).
 */
export const ALSO_FREE = freeInclusionsFor(['chat', 'reminders'])

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
 *
 * AND FOR A SCREEN-READER USER IT IS NOT A LABEL, IT IS THE CONTENT
 * (wordle-teams-wty4.1.14.9). The insights alt quoted a head-to-head of "nine
 * to four over nineteen shared days" while the file on disk read 10 vs 3 over
 * 20 — the alt landed in one task (9d70d972) and the PNG was re-shot by the
 * next (204d8aa7), whose message says it re-shot "/about's images" and which
 * re-shoots ALL SIX shots whatever it says.
 * Nothing but a person opening the PNG can catch that, so:
 *
 *   ANY FIGURE WRITTEN BELOW MUST BE READ OFF THE FILE THAT SHIPS, AFTER THE
 *   LAST RUN OF scripts/build-marketing-shots.mjs, NOT CARRIED FORWARD.
 *
 * That script is deterministic only WITHIN ONE CALENDAR DAY — `attemptsOn`
 * hashes a date and the head-to-head is month-scoped, so a run tomorrow counts
 * a different window — and its own banner now says so. The figures here, and
 * the ones in insights-payoff.tsx's crop rationale, were read off the 2026-09-20
 * capture.
 *
 * THE NUMBERLESS SHOTS ARE DESCRIBED WITHOUT NUMBERS ON PURPOSE. The dashboard
 * and chat alts name what KIND of thing is in the frame, so a re-shoot on
 * another day cannot make either false; only the insights one is pinned to a
 * capture, because a head-to-head with no score in it is not a description of
 * that picture at all.
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
    // READ OFF public/marketing/insights-{light,dark}.png, WHICH AGREE: "You 10
    // vs Jordan Hale 3", "7 ties over 20 shared days", and beneath it "Averages
    // — team 3" with both players at "3 over 20 boards".
    //
    // THE BEST-AND-WORST-DAYS CLAUSE IS GONE AND THE NUMBERS ARE WHY IT WAS
    // NOTICED. Those rows are at y=707..755 of the file, and insights-payoff.tsx
    // crops to rows 296..676 at its tallest — so nothing on this page has ever
    // shown them, and a description of a crop may not include them.
    alt: 'An Insights panel showing one player leading a teammate ten to three, with seven ties over twenty shared days, above both players’ average guesses for the month.',
  },
  chat: {
    stem: 'chat',
    // NAMES OCTOBER RATHER THAN "NEXT MONTH", which is the more durable of the
    // two: the last line of build-marketing-shots.mjs's CONVERSATION is
    // literally "Rematch in October", so the picture says October whenever it
    // is taken, while "next month" is only true of a September capture.
    //
    // AND IT IS ABOUT OPENERS, NOT "THE DAY'S WORD". also-free.tsx crops to the
    // file's last 650 rows, which starts below the two lines about today's
    // board; what a reader actually sees is CRANE versus ORATE, the month's
    // scoreboard, and the rematch.
    alt: 'Team chat: two teammates trading messages about their opening word, the month’s scoreboard, and a rematch in October.',
  },
}
