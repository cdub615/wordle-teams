// @vitest-environment node
//
// node rather than the suite's default edge-runtime, because three tests below
// read the filesystem: the `checkedAgainst` paths, the screenshot pairs, and the
// source of this file's own neighbour. pro-benefits.test.ts opens with the same
// line for the same reason — "a path that does not resolve is a claim nobody
// checked".
import { existsSync, readFileSync, statSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, test } from 'vitest'
import { objectLiteralAssignedTo, runtimeImportsOf } from '#/test-support/source-ast.ts'
import { MODEL_LINE } from '#/lib/onboarding-tasks.ts'
import { PLANS } from '#/lib/plans.ts'
import { PRO_BENEFITS } from '#/lib/pro-benefits.ts'
import { FREE_TEAM_LIMIT } from '../../../convex/lib/teamLimits.ts'
import {
  ALSO_FREE,
  CLOSING,
  HERO,
  HOW_IT_WORKS,
  PAYOFF,
  PAYOFF_INCLUDES,
  SECTION_TITLES,
  SHOTS,
} from './marketing-copy.ts'

/**
 * THE COPY IS THE DELIVERABLE, SO THE COPY IS WHAT IS PINNED.
 *
 * This file replaces feature-cards.test.ts, whose own banner recorded why it
 * had to exist: until it did, "a card could be deleted, reordered or reworded
 * and all four gates stayed green", and mutation testing of that task confirmed
 * that removing a feature killed nothing. Same property, new page.
 *
 * WHAT IS DIFFERENT FROM THAT FILE, AND IT IS THE WHOLE POINT. feature-cards.
 * test.ts pinned the strings as TRANSCRIPTIONS — v1's copy, to the character,
 * with no way to tell whether any of it was true. Six assertions of that kind
 * sat green over the sentence "unlimited months, unlimited teams, customizable
 * scoring systems, and more" for as long as month-picker.tsx offered everybody
 * three months. So the assertions here are about the RELATIONSHIP between the
 * copy and the code that backs it: which file makes each step's claim true, and
 * whether the words are lifted from a Pro benefit.
 *
 * AND THE FREE CAPABILITIES ARE NOT PINNED HERE AT ALL, which is the other way
 * to stop copy drifting. This page selects them from lib/free-includes.ts by id
 * and renders the inventory's own title and body, so what is asserted here is
 * WHICH entries it names; the sentences, the paths behind them and the greps over
 * those paths belong to free-includes.test.ts.
 */

const root = resolve(__dirname, '../../..')

/**
 * Every entry on the page that names a file, flattened with a label — which is
 * the three steps and nothing else. The free capabilities this page shows are
 * lib/free-includes.ts's, and their paths are resolved, and greped, there.
 */
const claims = HOW_IT_WORKS.map(
  (item) => [`how-it-works: ${item.title}`, item.checkedAgainst] as const,
)

/**
 * THE FREE-VOICE SENTENCES THIS FILE WROTE: the three steps, and the Insights
 * section's heading and its lead. These are the lines no other test can see,
 * because they exist nowhere else.
 *
 * WHAT IS LEFT OUT IS LEFT OUT ON PURPOSE, listed so the gaps do not read as
 * oversights. `HERO.model` is MODEL_LINE, imported and pinned by identity, so the
 * rules over that sentence belong with it in lib/onboarding-tasks.ts.
 * `HERO.title` and the two `SECTION_TITLES` are a headline and two headings rather
 * than statements about what a visitor gets. `PAYOFF.shotNote`, `CLOSING.line` and
 * `CLOSING.proLink` are the page's three lines ABOUT the paid tier, which name Pro
 * and quote a price deliberately. And the four inventory entries the page selects
 * are absent because free-includes.test.ts holds all six of them to both of the
 * rules this corpus feeds — over a corpus that does not shrink when the landing
 * changes which two it shows.
 */
const authoredFreeVoice = [
  ...HOW_IT_WORKS.flatMap((item) => [item.title, item.body]),
  PAYOFF.title,
  PAYOFF.lead,
]

/**
 * EVERY STRING THIS PAGE PUTS IN FRONT OF A VISITOR, with nothing left out: the
 * sentences above, the hero's two lines, both section headings, the four inventory
 * entries the selections render, the three alt texts, the screenshot caption and
 * both closing lines.
 *
 * WHICH CORPUS A NEW RULE TAKES IS THE DECISION THESE TWO NAMES RECORD. A rule
 * about what free is promised takes the one above — it is the prose this file is
 * answerable for, and the inventory answers for its own. A rule about what a
 * reader SEES takes this one, which is why the paid-tier lines and the alt text
 * belong in it and are excluded from the other.
 */
const renderedCopy = [
  ...authoredFreeVoice,
  HERO.title,
  HERO.model,
  SECTION_TITLES.howItWorks,
  SECTION_TITLES.alsoFree,
  ...[...ALSO_FREE, ...PAYOFF_INCLUDES].flatMap((inclusion) => [inclusion.title, inclusion.body]),
  ...Object.values(SHOTS).map((shot) => shot.alt),
  PAYOFF.shotNote,
  CLOSING.line,
  CLOSING.proLink,
]

/**
 * Words to word-lists, for the shared-run measure below. Lifted from
 * plans.test.ts, including the two decisions its comment records: typographic
 * apostrophes are normalised, and punctuation — hyphens included, so
 * "two-team" cannot hide an overlap with "two team" — becomes whitespace
 * rather than vanishing.
 */
const words = (text: string) =>
  text
    .toLowerCase()
    .replace(/’/g, "'")
    .replace(/[^a-z0-9']+/g, ' ')
    .split(' ')
    .filter(Boolean)

/** Classic longest-common-substring DP over words rather than characters. */
const longestSharedRun = (a: string[], b: string[]) => {
  let longest = 0
  const runs = Array.from({ length: b.length + 1 }, () => 0)
  for (const wordA of a) {
    let diagonal = 0
    for (let j = 0; j < b.length; j += 1) {
      const above = runs[j + 1]
      runs[j + 1] = wordA === b[j] ? diagonal + 1 : 0
      longest = Math.max(longest, runs[j + 1])
      diagonal = above
    }
  }
  return longest
}

describe('the landing page copy', () => {
  test('the hero explains the game with MODEL_LINE itself, not a copy of it', () => {
    // TWO ASSERTIONS, AND THE VALUE ONE IS THE WEAKER HALF. `toBe` against the
    // imported constant catches drift — retype the sentence and the next edit
    // to onboarding-tasks.ts fails here — but it CANNOT catch the retyping
    // itself, because a string is a primitive and `toBe` on two identical ones
    // is true. Measured: replacing `model: MODEL_LINE` with the sentence
    // spelled out left all twelve tests green.
    expect(HERO.model).toBe(MODEL_LINE)

    // SO THE SOURCE IS READ. `model` must be the IDENTIFIER, which is the
    // property the file's own banner claims and the only one that makes the
    // two surfaces impossible to separate. src/routes.test.ts and
    // src/crawler-metadata.test.ts read source the same way and for the same
    // reason: some claims are about the code rather than about its output.
    const source = readFileSync(resolve(__dirname, 'marketing-copy.ts'), 'utf8')
    const hero = objectLiteralAssignedTo('marketing-copy.ts', source, 'HERO')

    expect(hero.get('model')?.getText(), 'HERO.model is not the imported constant').toBe(
      'MODEL_LINE',
    )
    expect(runtimeImportsOf('marketing-copy.ts', source)).toContain('#/lib/onboarding-tasks.ts')
  })

  test('the gradient falls on a word the h1 actually ends with', () => {
    // title.tsx renders the h1 by slicing `highlight` off the tail of `title`
    // and wrapping it in the brand band. A `highlight` that is not that tail
    // would either drop text from the page's only h1 or paint the band over
    // nothing — and the e2e assertion on the h1's accessible name would still
    // pass, because a span inside it does not change the name.
    expect(HERO.title.endsWith(HERO.highlight)).toBe(true)
    expect(HERO.highlight.length).toBeGreaterThan(0)
    expect(HERO.highlight).not.toBe(HERO.title)
  })

  test('there are three steps, and the page names four inventory entries, in order', () => {
    // toEqual on the whole list, not toHaveLength: a reorder, a deletion and a
    // reworded title all have to fail, and only the full list does that. This
    // is feature-cards.test.ts's one property worth carrying forward.
    expect(HOW_IT_WORKS.map((item) => item.title)).toEqual([
      'Make a team',
      'Enter your board',
      'Scores settle',
    ])

    // THE SAME PROPERTY OVER IDS, BECAUSE THE SENTENCES ARE NO LONGER THIS PAGE'S
    // TO PIN. Both selections are lists of ids resolved against
    // lib/free-includes.ts in the order they are declared, so this is the
    // assertion about what the landing shows and where it shows it: a reorder, a
    // dropped id and a renamed one each fail here, and a renamed one fails
    // typecheck at the declaration as well, since the parameter takes the
    // inventory's own union.
    //
    // AND NOT A TRANSCRIPTION OF THE TITLES, DELIBERATELY. Spelling those two
    // sentences out here would put the same words in two files again, so
    // rewording an entry on /pricing would mean editing this file in lockstep —
    // one of the three disagreements wordle-teams-wty4.1.14.11 was raised about.
    //
    // AND THE WORDING IS PINNED, ONE FILE AWAY. free-includes.test.ts asserts the
    // six titles as a list beside the six ids, so a reworded entry fails there —
    // in the file the sentence lives in, one edit rather than two surfaces in
    // lockstep. The bodies are held to that file's rules, and the two fragments a
    // reader could be misled about are pinned on the rendered column by
    // tier-table.hook.test.ts. Nothing in this file asserts a word of it.
    expect(ALSO_FREE.map((inclusion) => inclusion.id)).toEqual(['chat', 'reminders'])
    expect(PAYOFF_INCLUDES.map((inclusion) => inclusion.id)).toEqual(['benchmark', 'team-fact'])
  })

  test('every claim names a file that exists, as a file', () => {
    // `.isFile()`, not just existsSync, for pro-benefits.test.ts's reason: a
    // directory resolves too, and `checkedAgainst: 'convex'` would pass
    // existsSync while saying nothing about which file carries the rule.
    for (const [label, path] of claims) {
      const resolved = resolve(root, path)
      expect(existsSync(resolved), `${label} -> ${path}`).toBe(true)
      expect(statSync(resolved).isFile(), `${label} -> ${path}`).toBe(true)
    }
  })

  test('no free-voice line this page wrote lifts a phrase from a Pro benefit', () => {
    // The second half of the same guard, and it catches the case a grep cannot:
    // copy about a gated feature, written from scratch, in a section that reads
    // as free. plans.test.ts measures the longest run of consecutive shared
    // words for the sibling problem and records why the threshold is four —
    // independent copy in this corpus tops out at two shared words, and three
    // fails on a feature's own noun phrase alone ("three months", "two teams").
    //
    // TITLE AND BODY MEASURED SEPARATELY, never concatenated, so a run that
    // straddles the join between one entry's title and its body — a phrase no
    // reader ever sees — cannot fail this.
    //
    // OVER WHAT THIS FILE WROTE, NOT OVER WHAT THE PAGE RENDERS, and that is one
    // mechanism per fact rather than a narrowing. free-includes.test.ts runs the
    // same measure over all six inventory entries against every PRO_BENEFITS
    // text; the four this page selects are a subset of that, so measuring them
    // again here would add nothing and would put the weaker of two guards on the
    // page a reader is likelier to open first.
    //
    // THE PAYOFF IS IN SCOPE, AND ITS FIRST DRAFT IS WHY THE INVENTORY READS AS
    // IT DOES. That section used to describe the free benchmark in a paragraph of
    // its own, and "your most recent board" collided at exactly 4 with the
    // `insights` benefit, whose body describes the FREE half before the paid one
    // ("Free shows your most recent board, and today's team snapshot"). That was
    // a legitimate overlap rather than a lifted phrase — but a reader meets the
    // two sentences on two pages a click apart, and the fix was to reword rather
    // than to exempt the section. lib/free-includes.ts's `benchmark` entry now
    // carries that opener for both surfaces. What is left here is the framing
    // lead, which claims nothing and is measured anyway, because a lead is still
    // a sentence this file wrote.
    //
    // The DP is checked against a known answer first: an implementation that
    // returned 0 for everything would satisfy every assertion below it.
    expect(
      longestSharedRun(words('let a screenshot fill the board in for you'), words(
        'Paste or upload a screenshot of your Wordle and we’ll fill the board in for you — check it and submit.',
      )),
    ).toBe(6)

    const benefitTexts = PRO_BENEFITS.flatMap((benefit) => [benefit.title, benefit.body]).map(words)
    for (const line of authoredFreeVoice) {
      for (const benefitText of benefitTexts) {
        const run = longestSharedRun(words(line), benefitText)
        expect(run, `"${line}" vs "${benefitText.join(' ')}"`).toBeLessThan(4)
      }
    }
  })

  test('the free-voice prose never reaches for Pro’s vocabulary', () => {
    // A BLOCKLIST, AND A DELIBERATELY SHORT ONE. These five words are not
    // banned from the page — PAYOFF.shotNote says "Pro" on purpose, and the
    // closing CTA quotes a price — they are banned from the sections that
    // describe what a visitor gets by signing up.
    //
    // EACH ENTRY IS A DEFECT THAT ACTUALLY REACHED A DRAFT. "unlimited" is the
    // word feature-cards.tsx shipped over a three-month window for months;
    // "paste" and "screenshot" are the plan's own draft of step 2, which
    // offered a free visitor an import that form.tsx renders only for
    // `isPro === true`; "customizable"/"custom" is the other half of the same
    // §6.1 sentence, gated by scoring-system-card.tsx's canEdit.
    //
    // THE SENTENCES THIS FILE WROTE, AND THE INVENTORY HOLDS ITS OWN TO THE SAME
    // FIVE WORDS. Running this over the selected entries as well would cover four
    // of six, and only while the landing went on selecting those four — so the
    // word list is repeated in free-includes.test.ts over all six instead, where
    // /pricing's column is covered too. Not two mechanisms over one fact: two
    // corpora with no overlap, each held where its sentences live.
    const prose = authoredFreeVoice.join(' ').toLowerCase()

    for (const word of ['unlimited', 'paste', 'screenshot', 'customizable', 'custom']) {
      expect(prose, `free-voice copy says "${word}"`).not.toContain(word)
    }
  })

  test('the closing line quotes the annual price and never the monthly one', () => {
    // Composed from plans.ts's derived PRO_PRICE_LINE rather than spelled out,
    // so the page cannot drift from /pricing or from the upgrade dialog. Both
    // halves are asserted against the PLANS entries themselves: hardcoding
    // "$49.99" here would keep passing after a price change, which is the
    // failure mode scripts/check-polar-prices.mjs exists to catch upstream.
    const [annual, monthly] = PLANS

    expect(CLOSING.line).toContain(annual.label)
    expect(CLOSING.line).not.toContain(monthly.price)
    expect(CLOSING.line).not.toContain(monthly.label)
  })

  test('pins the free-tier number the steps spell out as a word', () => {
    // HOW_IT_WORKS says "Two teams are free" in words, because prose cannot
    // embed a template literal — the same problem pro-benefits.ts, plans.ts and
    // free-includes.ts have, solved the same way. Move the constant without
    // touching the copy and this fails instead of shipping a stale number.
    expect(FREE_TEAM_LIMIT).toBe(2)
  })

  test('every shot has both a light and a dark file on disk', () => {
    // product-shot.tsx composes `-light.png` and `-dark.png` onto the stem and
    // renders both, one hidden by theme. A stem naming no file is a broken
    // image on the marketing page with typecheck, lint, build and the rest of
    // this suite green — nothing else in the repo looks at public/marketing/.
    for (const [key, shot] of Object.entries(SHOTS)) {
      for (const theme of ['light', 'dark']) {
        const path = `public/marketing/${shot.stem}-${theme}.png`
        const resolved = resolve(root, path)
        expect(existsSync(resolved), `${key} -> ${path}`).toBe(true)
        expect(statSync(resolved).isFile(), `${key} -> ${path}`).toBe(true)
      }
    }
  })

  test('every shot is described by alt text that describes something', () => {
    // An empty alt would be a decorative image, which none of these are — they
    // are the evidence for the section they sit in, and the one thing a
    // screen-reader user gets instead of the picture. A one-word alt, or the
    // filename, is the same defect with a coat on.
    for (const [key, shot] of Object.entries(SHOTS)) {
      expect(
        words(shot.alt).length,
        `${key} alt is too short to describe anything`,
      ).toBeGreaterThan(8)
    }
  })

  test('uses typographic apostrophes and no typewriter ones', () => {
    // Same rule, same test, as pro-benefits.test.ts, plans.test.ts and
    // free-includes.test.ts — the whole set of files that carry it; the legal copy,
    // which this line used to cite, has no such test. One page mixing ' and ’ is
    // visible to a reader and to nothing else.
    //
    // OVER `renderedCopy`, WHICH IS THE POINT OF HAVING IT. Mixed quote marks are
    // a fact about the page a visitor looks at, not about which sentence is
    // answerable for a tier — so the alt text, the Pro caption and both closing
    // lines are all in scope here, and the selected inventory text is measured on
    // the surface it reaches as well as in free-includes.test.ts, where the data
    // is.
    const prose = renderedCopy.join(' ')

    expect(prose).not.toContain("'")
    // AND AT LEAST ONE IS PRESENT, so deleting every apostrophe — which would
    // also satisfy the line above — fails instead of passing.
    expect(prose).toContain('’')
  })
})
