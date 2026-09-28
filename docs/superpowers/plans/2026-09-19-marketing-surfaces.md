# Marketing Surfaces Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** The pages the launch email sends people to describe the product we actually ship, and a player who finishes onboarding is pointed at the thing that makes them better at the game.

**Architecture:** `PRO_BENEFITS` (what Pro includes) and `plans.ts` (what it costs) already exist and are tested — every new surface renders them rather than writing its own copy. A committed Playwright script produces the product shots. `/pricing` becomes the public tier comparison; `/` and `/home` become a narrative scroll for a cold visitor; `/about` keeps its URL and its job as the walkthrough.

**Tech Stack:** TanStack Start + React 19, Tailwind v4, vitest (edge-runtime default, jsdom in `*.hook.test.ts`), Playwright, Convex, GitHub Actions.

**Spec:** `docs/superpowers/specs/2026-09-18-marketing-pages-and-upgrade-dialog-design.md`
**Issues:** `wordle-teams-wty4.1.14` (the pages). Task 6 also substantially serves `wordle-teams-wty4.1.15` without closing it — see that task.

**Working directory:** paths are relative to `v2/` unless they start with `.github/` or `docs/`. Run commands from `v2/`.

**Plan 1** (`docs/superpowers/plans/2026-09-18-upgrade-dialog.md`) shipped the upgrade dialog and is complete. This plan depends on what it built.

---

## Decisions taken 2026-09-19, before this plan was written

| Question | Decision |
| --- | --- |
| Where does the insights nod live in onboarding? | A **graduation card**: the next-step card's final state, where today it renders nothing. |
| Where does the price drift check run? | A **scheduled GitHub Actions job**, so drift is caught without anyone remembering. |
| Is `/pricing` linked from inside the app? | **No.** The upgrade dialog is the in-app surface; `/pricing` is for people deciding whether to sign up. |

---

## File Structure

| File | Responsibility |
| --- | --- |
| `scripts/check-polar-prices.mjs` (create) | Compares `PLANS` against Polar's products. Makes `plans.ts`'s banner true. |
| `.github/workflows/check-prices.yml` (create) | Runs that script weekly and on demand. |
| `scripts/build-marketing-shots.mjs` (create) | Seeds, signs in, captures every marketing screenshot in both themes. |
| `src/routes/pricing.tsx` (create) | The public tier comparison. |
| `src/components/pricing/tier-table.tsx` (create) | Free vs Pro, rendered from `PRO_BENEFITS` + `PLANS`. |
| `src/lib/sitemap.ts` (modify) | One new entry. |
| `src/crawler-metadata.test.ts` (modify) | The "v1's seven URLs and nothing else" assertions become eight. |
| `src/components/home/landing.tsx` (modify) | The narrative scroll's composition. |
| `src/components/home/*.tsx` (create/modify) | The sections that scroll. |
| `src/components/home/marketing-copy.ts` (create) | Landing copy as data, so a gate can read it. |
| `src/routes/about.tsx` (modify) | Refreshed prose, re-shot images. |
| `src/lib/onboarding-tasks.ts` (modify) | The graduation state. |
| `src/components/onboarding/next-step-card.tsx` (modify) | Renders it. |

`src/lib/pro-benefits.ts` and `src/lib/plans.ts` are **consumed, not modified**. No surface here writes its own benefit or price copy.

---

### Task 1: The price drift check

Do this first. `src/lib/plans.ts`'s banner already promises this script by name, in future tense — every day it does not exist is a day the departure from the "NO PRICE HERE" rule rests on nothing.

**Files:**
- Create: `scripts/check-polar-prices.mjs`
- Create: `.github/workflows/check-prices.yml`
- Modify: `src/lib/plans.ts` (banner only — future tense becomes present)

- [ ] **Step 1: Write the script**

```js
#!/usr/bin/env node
/**
 * DOES POLAR STILL CHARGE WHAT src/lib/plans.ts SAYS IT DOES?
 *
 * plans.ts holds the only price literals in this repo, and its banner argues
 * that departure from the "NO PRICE HERE" rule on the grounds that this script
 * backstops it. This is that script. If it does not run, that argument is
 * hollow and the prices are unguarded.
 *
 * IT READS POLAR, NOT A FIXTURE. The whole failure mode is someone editing a
 * price in Polar's dashboard — which is where prices are SUPPOSED to be
 * edited, and which changes nothing in this repo — so a test against a
 * committed snapshot would agree with itself forever.
 *
 * NOT A VITEST GATE, DELIBERATELY. CI holds no Polar credentials and the unit
 * suite must stay runnable offline; a gate that needs a secret is a gate that
 * fails for every contributor who does not have one. It runs on a schedule
 * instead — see .github/workflows/check-prices.yml.
 *
 * EXIT CODES ARE THE INTERFACE: 0 agreement, 1 drift, 2 could not tell
 * (missing credentials, Polar unreachable). The third is not the second — a
 * workflow that treats "could not check" as "prices are wrong" gets muted,
 * and a muted check is worse than none.
 */
import { readFileSync } from 'node:fs'

const TOKEN = process.env.POLAR_ACCESS_TOKEN
const ANNUAL = process.env.POLAR_PRO_ANNUAL_PRODUCT_ID
const MONTHLY = process.env.POLAR_PRO_MONTHLY_PRODUCT_ID
const SERVER = process.env.POLAR_SERVER === 'sandbox' ? 'sandbox-api' : 'api'

if (!TOKEN || !ANNUAL || !MONTHLY) {
  console.error('check-polar-prices: missing POLAR_ACCESS_TOKEN or a product id. Cannot check.')
  process.exit(2)
}

/**
 * The literals, read out of the SOURCE rather than imported.
 *
 * plans.ts is TypeScript and this is a plain node script run without a
 * bundler, exactly as scripts/build-splash-screens.mjs treats
 * src/lib/splash-screens.ts. A regex over two lines is the smaller dependency;
 * it fails loudly below if the shape changes.
 */
function pricesFromSource() {
  const source = readFileSync(new URL('../src/lib/plans.ts', import.meta.url), 'utf8')
  const found = {}
  for (const [, id, price] of source.matchAll(/id:\s*'(annual|monthly)'[^}]*price:\s*'\$([\d.]+)'/g)) {
    found[id] = Number(price)
  }
  if (found.annual === undefined || found.monthly === undefined) {
    console.error('check-polar-prices: could not read both prices out of src/lib/plans.ts.')
    process.exit(2)
  }
  return found
}

async function polarPrice(productId) {
  const res = await fetch(`https://${SERVER}.polar.sh/v1/products/${productId}`, {
    headers: { Authorization: `Bearer ${TOKEN}` },
  })
  if (!res.ok) {
    console.error(`check-polar-prices: Polar answered ${res.status} for ${productId}.`)
    process.exit(2)
  }
  const product = await res.json()
  // Polar quotes amounts in minor units. One recurring price per product here;
  // a product that grew a second one is a product decision this cannot resolve.
  const prices = (product.prices ?? []).filter((price) => !price.is_archived)
  if (prices.length !== 1) {
    console.error(
      `check-polar-prices: ${productId} has ${prices.length} active prices; expected exactly 1.`,
    )
    process.exit(2)
  }
  return prices[0].price_amount / 100
}

const source = pricesFromSource()
const live = { annual: await polarPrice(ANNUAL), monthly: await polarPrice(MONTHLY) }

const drifted = ['annual', 'monthly'].filter((id) => source[id] !== live[id])

if (drifted.length === 0) {
  console.log(`check-polar-prices: OK — annual $${live.annual}, monthly $${live.monthly}.`)
  process.exit(0)
}

for (const id of drifted) {
  console.error(
    `check-polar-prices: DRIFT on ${id} — src/lib/plans.ts says $${source[id]}, Polar charges $${live[id]}.`,
  )
}
console.error('The customer sees Polar. Fix src/lib/plans.ts, or fix Polar, but do not leave them disagreeing.')
process.exit(1)
```

- [ ] **Step 2: Verify the three exits by hand**

```bash
node scripts/check-polar-prices.mjs; echo "EXIT=$?"
```
With no credentials in the environment, expected: `EXIT=2` and the "Cannot check" line. That is the only arm runnable without secrets, and confirming it is what stops the workflow silently reporting success because the script did nothing.

Report the other two as untested-by-you; the workflow's first scheduled run is what exercises them.

- [ ] **Step 3: The workflow**

Create `.github/workflows/check-prices.yml`:

```yaml
name: Check Polar prices

# WEEKLY, NOT ON PUSH. The thing that drifts is Polar's dashboard, which this
# repo never sees a commit for — so push-triggered is exactly the wrong
# trigger. workflow_dispatch is here for the day someone changes a price
# deliberately and wants to confirm the repo agrees.
on:
  schedule:
    - cron: '17 9 * * 1'
  workflow_dispatch:

permissions:
  contents: read

jobs:
  check:
    runs-on: ubuntu-latest
    defaults:
      run:
        working-directory: v2

    steps:
      - uses: actions/checkout@v7

      - uses: pnpm/action-setup@v6
        with:
          package_json_file: v2/package.json

      - uses: actions/setup-node@v7
        with:
          node-version: 22
          cache: pnpm
          cache-dependency-path: v2/pnpm-lock.yaml

      # No install: the script uses only node builtins and fetch. Kept as a
      # separate job from deploy-v2.yml for that reason — this needs no
      # dependency tree and must not wait on one.

      - name: Compare src/lib/plans.ts against Polar
        env:
          POLAR_ACCESS_TOKEN: ${{ secrets.POLAR_ACCESS_TOKEN }}
          POLAR_PRO_ANNUAL_PRODUCT_ID: ${{ secrets.POLAR_PRO_ANNUAL_PRODUCT_ID }}
          POLAR_PRO_MONTHLY_PRODUCT_ID: ${{ secrets.POLAR_PRO_MONTHLY_PRODUCT_ID }}
        run: node scripts/check-polar-prices.mjs
```

- [ ] **Step 4: Correct `plans.ts`'s banner**

It currently says the departure "will be backstopped by scripts/check-polar-prices.mjs, which wordle-teams-wty4.1.14's plan owns and which is not written yet". It exists now. Rewrite in the tense of a finished system, naming the workflow and saying what each exit code means. **Do not** write a ninth instance of the present-tense-future pattern this work has produced eight of — if you describe the scheduled run, describe it as what it does, not what it will do.

- [ ] **Step 5: Gates and commit**

Run separately, reading each exit code: `TZ=UTC pnpm test:once`, `pnpm typecheck`, `pnpm lint`, `pnpm build`.

```bash
git add scripts/check-polar-prices.mjs src/lib/plans.ts ../.github/workflows/check-prices.yml
git commit -m "feat(pricing): check Polar's prices against the ones we publish"
```

**Hand off to the owner:** the workflow needs `POLAR_ACCESS_TOKEN`, `POLAR_PRO_ANNUAL_PRODUCT_ID` and `POLAR_PRO_MONTHLY_PRODUCT_ID` as repository secrets. Until they exist every run exits 2 and says so. Say this in your report.

---

### Task 2: The screenshot script

Every later task needs current images. There is no capture script in this repo and the one committed shot (`public/welcome-screenshot.png`) is a v1-era dashboard.

**Files:**
- Create: `scripts/build-marketing-shots.mjs`
- Create: `public/marketing/*.png` (output, committed)

- [ ] **Step 1: Read the harness you are reusing**

`convex/e2eSeed.ts`'s `seedInsightsFor({ email, boards, lastDay, pro, trialEndsAt })` and `ensureTeamFor`, plus `e2e/sign-in.ts`'s `signIn(page, email)`. `e2e/billing.spec.ts` and `e2e/team-insights.spec.ts` are worked examples. Note `isE2eTraffic` gates the seed mutations to `e2e+*` addresses with `E2E_TEST_MODE` set — the script must use such an address.

- [ ] **Step 2: Write the script**

Model it on `scripts/build-splash-screens.mjs` — same family: not part of `pnpm build`, output committed, fails loudly if it wrote nothing.

**This is the one task in the plan whose code is a skeleton rather than a finished body**, and deliberately so: the seeding and sign-in steps have to be developed against a running app, and a Playwright script written blind in a plan would be fiction dressed as instruction. The shape, the API calls and the failure behaviour are fixed; the middle is yours to make work.

```js
#!/usr/bin/env node
/**
 * THE PRODUCT SHOTS THE MARKETING PAGES USE, CAPTURED RATHER THAN COLLECTED.
 *
 * GENERATE-ON-DEMAND AND COMMITTED, exactly like build-splash-screens.mjs and
 * fetch-fonts.mjs, and NOT part of `pnpm build`: it needs a browser, a dev
 * server and a seeded backend, none of which belong in a build.
 *
 * IT EXISTS BECAUSE THE ALTERNATIVE ROTTED. public/welcome-screenshot.png was
 * hand-captured, and by the time wordle-teams-wty4.1.14 was filed it showed a
 * v1-era dashboard on the page the launch email points at. Re-shooting is now
 * one command, which is the same answer this work gave for the copy.
 */
import { chromium } from '@playwright/test'
import { ConvexHttpClient } from 'convex/browser'
import { mkdirSync } from 'node:fs'
import { api } from '../convex/_generated/api.js'
import { signIn } from '../e2e/sign-in.js'

const BASE = process.env.SHOTS_BASE_URL ?? 'http://localhost:3000'
const OUT = new URL('../public/marketing/', import.meta.url)
const EMAIL = `e2e+shots@wordleteams.com`

/** Every shot this script owns. A missing file here is a failed run. */
const SHOTS = [
  { name: 'dashboard', path: '/app' },
  { name: 'insights', path: '/insights' },
  { name: 'board-entry', path: '/app' },   // opens the entry form; see below
  { name: 'chat', path: '/chat' },
]

// 1. Seed. seedInsightsFor needs the player to exist, so ensureTeamFor first —
//    see convex/e2eSeed.ts, and note isE2eTraffic gates both to e2e+* with
//    E2E_TEST_MODE set. pro: true so the paid surfaces actually render.
const convex = new ConvexHttpClient(process.env.VITE_CONVEX_URL)
// await convex.mutation(api.e2eSeed.ensureTeamFor, { ... })
// await convex.mutation(api.e2eSeed.seedInsightsFor, { email: EMAIL, boards: 30, lastDay, pro: true })

// 2. Sign in once, reuse the context for every shot.
const browser = await chromium.launch()
const context = await browser.newContext({ viewport: { width: 1280, height: 900 } })
const page = await context.newPage()
// await signIn(page, EMAIL)

// 3. Capture each shot in both colour schemes.
mkdirSync(OUT, { recursive: true })
const written = []
for (const shot of SHOTS) {
  for (const colorScheme of ['light', 'dark']) {
    await page.emulateMedia({ colorScheme })
    await page.goto(`${BASE}${shot.path}`)
    // Wait on CONTENT, never on a timeout: a shot of a skeleton exits 0 and
    // looks like success. Pick a selector that only exists once the real data
    // has rendered.
    const file = new URL(`${shot.name}-${colorScheme}.png`, OUT)
    await page.screenshot({ path: file, fullPage: false })
    written.push(`${shot.name}-${colorScheme}.png`)
  }
}
await browser.close()

// 4. FAIL LOUDLY IF ANYTHING IS MISSING. The whole point of a script over a
//    hand-capture is that a silent partial run is impossible.
const expected = SHOTS.flatMap((s) => [`${s.name}-light.png`, `${s.name}-dark.png`])
const missing = expected.filter((name) => !written.includes(name))
if (missing.length > 0) {
  console.error(`build-marketing-shots: did not write ${missing.join(', ')}`)
  process.exit(1)
}
console.log(`build-marketing-shots: wrote ${written.length} shots to public/marketing/`)
```

**The dev server is your problem to get right.** `playwright.config.ts` starts one with `reuseExistingServer: false`, which is the behaviour you want — a stale vite on :3000 has served old code to a whole run before. Either drive this through Playwright's own harness or check and kill the port yourself. Do not wait on a process by name with `pgrep`; it matches itself and never exits.

- [ ] **Step 3: Run it and look at every output**

```bash
node scripts/build-marketing-shots.mjs; echo "EXIT=$?"
```

Then open each PNG. A screenshot script that runs green and captures a loading skeleton, an empty state or a login page is the failure mode here — the exit code cannot see it. Report what each image actually shows.

- [ ] **Step 4: Commit**

```bash
git add scripts/build-marketing-shots.mjs public/marketing package.json
git commit -F - <<'EOF'
feat(marketing): capture the product shots with a script, not by hand

Generate-on-demand and committed, the same family as build-splash-screens
and fetch-fonts. The one shot we had was three weeks old and showed a
v1-era dashboard; re-shooting is now one command rather than a chore.
EOF
```

Add a `//build:shots` doc entry and a `build:shots` script to `package.json` beside `build:splash`, matching that entry's style of explaining why it is not part of `build`.

---

### Task 3: `/pricing`

**Files:**
- Create: `src/routes/pricing.tsx`
- Create: `src/components/pricing/tier-table.tsx`
- Create: `src/components/pricing/tier-table.hook.test.ts`
- Modify: `src/lib/sitemap.ts`
- Modify: `src/crawler-metadata.test.ts`

- [ ] **Step 1: The sitemap entry, and the test that guards it**

`src/lib/sitemap.ts`'s `SITEMAP_ENTRIES` is seven entries carrying v1's priorities. Add `/pricing` after `/about`:

```ts
  { path: '/pricing', changefreq: 'monthly', priority: 0.8 },
```

`0.8` deliberately equals `/about`: it is a primary marketing page, below the two landing paths and above the legal ones.

`src/crawler-metadata.test.ts` asserts the sitemap "lists v1's seven URLs, in v1's order, and nothing else" and pins the priority table. Both become eight. **Update the describe's prose too** — it explains that the list is v1 parity, which is no longer the whole truth: this is the first entry v1 never had. Say why it was added rather than leaving a reader to infer parity broke by accident.

- [ ] **Step 2: The tier table, test first**

`src/components/pricing/tier-table.hook.test.ts` — jsdom, `createElement`, the pattern of `src/components/insights/daily-team-fact.hook.test.ts`. It must assert:

- every `PRO_BENEFITS` entry's title and body renders (the same drift gate the upgrade dialog carries — a sixth benefit fails until this names it)
- the annual price renders and is the plan presented first
- the monthly price renders and no copy on the page presents it as better value
- the free tier's own row is present for each benefit, so a visitor can see what free gives rather than only what it withholds

Then write `src/components/pricing/tier-table.tsx` rendering `PRO_BENEFITS` and `PLANS`. It writes no benefit copy and no price of its own.

- [ ] **Step 3: The route**

`src/routes/pricing.tsx`, modelled on `src/routes/privacy.tsx` for shape:

```tsx
export const Route = createFileRoute('/pricing')({
  head: () => publicRouteHead('/pricing', 'Pricing'),
  component: PricingPage,
})
```

**No `beforeLoad` redirect for signed-in visitors.** `/` bounces them because v1's `welcomePaths` did and because a relaunching PWA lands there; `/pricing` is neither. A signed-in player following a link here should read the page.

The page carries the tier table, the 30-day trial explanation (what starts it: the first board entered after launch, from `insightsAccess.ts`), and a CTA to `/login`.

- [ ] **Step 4: Gates and commit**

All four, separately. Then:

```bash
git add src/routes/pricing.tsx src/components/pricing src/lib/sitemap.ts src/crawler-metadata.test.ts
git commit -m "feat(pricing): a public tier comparison at /pricing"
```

---

### Task 4: The landing, rebuilt

**Files:**
- Create: `src/components/home/marketing-copy.ts`
- Create: `src/components/home/marketing-copy.test.ts`
- Create: `src/components/home/how-it-works.tsx`, `src/components/home/insights-payoff.tsx`
- Modify: `src/components/home/landing.tsx`, `title.tsx`, `dashboard-preview.tsx`
- Delete: `src/components/home/feature-cards.tsx` and its test

- [ ] **Step 1: The copy, as data**

`feature-cards.tsx` exports `FEATURES` for exactly one reason, stated in its banner: v2 has no DOM under vitest, so copy is only assertable as data, and "deleting a card used to be invisible to every gate". Keep that property. `src/components/home/marketing-copy.ts` holds the hero line, the three how-it-works steps, and the payoff section's prose.

**A correction to the spec's own wording before you write anything.** §6.1 describes this section as "chat, notifications, custom scoring, screenshot import — named, not sold". Two of those four are **Pro**: `pro-benefits.ts` lists `scoring` and `import` as gated, while chat and notifications are explicitly *not* gated and belong to the free product. Naming all four together as things the app does would repeat the exact defect this work exists to fix — the old landing sold "unlimited months" the app did not ship. So the free items are named as free, and Pro's extras are pointed at `/pricing` rather than listed here.

Draft copy, grounded in what the product actually does. The owner approves or replaces it; what is NOT negotiable is that no line claims a capability `pro-benefits.ts` does not back:

```ts
import { MODEL_LINE } from '#/lib/onboarding-tasks.ts'
import { PLANS } from '#/lib/plans.ts'

/**
 * THE HERO'S SECOND LINE IS `MODEL_LINE` ITSELF, IMPORTED.
 *
 * onboarding-tasks.ts's comment says that sentence is "stated NOWHERE ELSE
 * inside the app", and it is the one thing a stranger has to understand before
 * anything else on this page means something. Importing it rather than
 * retyping it means the landing and the onboarding card cannot drift into two
 * descriptions of one game.
 */
export const HERO = {
  title: 'Compete with friends',
  model: MODEL_LINE,
  cta: 'Get Started',
}

/** The three steps onboarding already models, in the same order it shows them. */
export const HOW_IT_WORKS = [
  {
    title: 'Make a team',
    body: 'Invite the people you already send your score to every morning.',
  },
  {
    title: 'Enter your board',
    body: 'Play Wordle wherever you normally do, then paste or type the result here. About ten seconds.',
  },
  {
    title: 'Scores settle',
    body: 'Fewer guesses earns more. The month adds up, and somebody wins it.',
  },
] as const

/**
 * The payoff section. Every claim here is free-tier true — Layer 1's benchmark
 * is on every board a free player enters (lib/insightsAccess.ts) — so this
 * section is not an upsell and must not become one. What Pro adds to it lives
 * on /pricing.
 */
export const PAYOFF = {
  title: 'Find out whether that four was good',
  body:
    'Every board you enter is measured against everyone else who played that day, so a score stops being a number and starts being a result. Your own history shows whether you are getting better, and your team’s month shows who is actually ahead.',
}

/**
 * FREE THINGS ONLY. scoring and import are Pro (pro-benefits.ts) and naming
 * them here as things "the app does" is how the old copy came to sell
 * unlimited months the product did not ship.
 */
export const ALSO_FREE = [
  { title: 'Team chat', body: 'Argue about the word, in the app, with the people who played it.' },
  { title: 'Reminders', body: 'A nudge when you have not played and the day is running out.' },
] as const

const annual = PLANS[0]

export const CLOSING = {
  line: `Free to play. Pro is ${annual.label}.`,
  cta: 'Get Started',
  proLink: 'See what Pro adds',
}
```

`marketing-copy.test.ts` pins:
- `HERO.model` is `MODEL_LINE` itself, by identity — not a copy of its text
- `CLOSING.line` names the annual price and does **not** contain the monthly one
- every `ALSO_FREE` entry names something absent from `PRO_BENEFITS`, so a gated feature can never be described here as free (this is the assertion that would have caught the original defect, in reverse)

- [ ] **Step 2: The sections**

`Landing` composes: `Title` → `DashboardPreview` (new shot, `<picture>` with `prefers-color-scheme`) → `HowItWorks` → `InsightsPayoff` (the insights shot beside the prose) → the rest → closing CTA. Keep `Landing`'s existing rule that `Title` renders the page's only `h1`.

- [ ] **Step 3: Delete `feature-cards.tsx`**

Its six cards are replaced. Delete the component and its test. `grep -rn "feature-cards\|FEATURES" src` must come back empty apart from this plan's own files — check, because its banner is cited by other comments.

- [ ] **Step 4: Gates, and look at the page**

All four gates separately. Then `pnpm dev` and open `/` at 390px and at desktop, in both themes. Report what you see. `e2e/routes.spec.ts` pins `/`'s 200 and the signed-in redirect — run `pnpm e2e routes --reporter=line`.

- [ ] **Step 5: Commit**

```bash
git add src/components/home src/lib
git commit -m "feat(marketing): rebuild the landing around what v2 actually ships"
```

---

### Task 5: `/about`, refreshed

**Files:**
- Modify: `src/routes/about.tsx`
- Replace: the four images it references

- [ ] **Step 1: Check every claim against the code**

The page is a walkthrough: board entry, installing to the home screen, creating or joining a team. For each paragraph, verify the behaviour it describes is still what the app does — the install instructions name a specific menu location, and the menu has been rebuilt since. Report any claim that is now false **before** rewriting, since a stale instruction is the same defect class as the stale landing copy.

- [ ] **Step 2: Refresh prose and images**

Keep the URL, the structure and the walkthrough's job. Replace `board-entry.png` and `install-button.png` with shots from Task 2's script (extend it if it does not already capture them — do not hand-capture).

- [ ] **Step 3: Gates and commit.** All four, separately.

---

### Task 6: The onboarding graduation card

Independent of Tasks 1-5; can run at any point. It substantially serves `wordle-teams-wty4.1.15` but does **not** close it — that issue is about a permanent link on the dashboard for every player, and this is a one-time nudge at the moment onboarding ends. Say so when you close anything.

**Files:**
- Modify: `src/lib/onboarding-tasks.ts`
- Modify: `src/lib/onboarding-tasks.test.ts`
- Modify: `src/components/onboarding/next-step-card.tsx`
- Modify: `src/components/onboarding/next-step-card.hook.test.ts`

- [ ] **Step 1: Read the constraints before designing anything**

`onboarding-tasks.ts` and `next-step-card.tsx` carry long comments about funnel denominators, and this change can break two of them:

- `shouldShowCard` is false at zero tasks today, so the card **vanishes** when onboarding completes. The graduation state means it renders at zero tasks instead.
- `onboarding_view` fires per task-set via a per-mount `Set`. `taskSetKey([])` is `''`. If the graduation state emits `onboarding_view`, **every activated player emits one on every `/app` mount** — which is precisely the swamping the dedupe exists to prevent, and it would wreck the view/click ratio the epic is measured by.
- `onboarding_complete` fires on the 0-task transition with a `sawIncomplete` latch. Do not disturb it.

- [ ] **Step 2: The model, test first**

In `onboarding-tasks.ts`:

```ts
/**
 * Whether the card should show the graduation state — the nudge toward
 * insights that replaces the nothing this card used to render once onboarding
 * finished.
 *
 * IT IS THE SAME CARD AND THE SAME DISMISSAL, deliberately. A second
 * dismissible thing on /app would need its own flag, its own server field and
 * its own migration; reusing `dismissed` means a player who dismisses the
 * checklist never sees the nudge either, which is the correct reading of that
 * gesture — they have told us they do not want this card.
 *
 * WHY INSIGHTS IS THE RIGHT DESTINATION and not, say, an invite nudge: a
 * player who has reached this state HAS a team, HAS invited someone and HAS
 * entered a board. The next thing that makes the app worth reopening is what
 * their boards say about how they play, which is the one surface they have no
 * route to from this screen (wordle-teams-wty4.1.15: `to="/insights"` appears
 * exactly once in the app, in the hamburger menu).
 *
 * FREE PLAYERS GET SOMETHING REAL HERE, which is what makes this honest rather
 * than an upsell: Layer 1's benchmark on their most recent board and one team
 * fact a day are free (lib/insightsAccess.ts). This card does not mention Pro.
 */
export function shouldShowGraduation(facts: OnboardingFacts): boolean {
  return !facts.dismissed && incompleteTasks(facts).length === 0
}

export const GRADUATION_TITLE = 'You are all set up'
export const GRADUATION_BODY =
  'See how your guesses compare with everyone else’s, and where you are gaining on your team.'
export const GRADUATION_CTA = 'See your insights'
```

and `shouldShowCard` becomes exactly this:

```ts
export function shouldShowCard(facts: OnboardingFacts): boolean {
  // TWO STATES NOW, NOT ONE. This used to also require an outstanding task,
  // which is why the card vanished the moment onboarding finished. It renders
  // the checklist while tasks remain and the graduation nudge afterwards, so
  // the only thing that silences it is the dismissal.
  return !facts.dismissed
}
```

Its existing test asserting "no card at zero tasks" now asserts the opposite and must be rewritten to say *graduation* at zero tasks — do not delete it.

Tests in `onboarding-tasks.test.ts`: graduation is false while any task remains, false when dismissed, true when all tasks are done and not dismissed. Pin the copy the way `MODEL_LINE` is pinned.

- [ ] **Step 3: The component**

`next-step-card.tsx` renders the graduation state when `shouldShowGraduation(facts)`, with a `Link to="/insights"` — a real link, not a callback, since nothing needs mounting.

**The funnel rules, which are the risky part:**

- Do **not** emit `onboarding_view` for the graduation state. Guard the existing effect on `incompleteTasks(facts).length > 0`. Write down why: that event's denominator is activation, and emitting it for every activated player on every mount destroys the ratio.
- Emit a **distinct** event on the click — `onboarding_insights_click` — not `onboarding_task_click`. Adding `'insights'` to `OnboardingTaskId` would put a browse-nudge inside the task denominators that `wordle-teams-456` is measured by.
- Leave `onboarding_complete` exactly as it is.

- [ ] **Step 4: Prove the funnel guard**

In `next-step-card.hook.test.ts`, assert that rendering the graduation state emits **no** `onboarding_view`, and that clicking the CTA emits `onboarding_insights_click`. Then mutate: remove the `length > 0` guard and confirm the first test fails. Restore from a scratchpad copy, never `git checkout --`.

- [ ] **Step 5: Gates and commit.** All four, separately, plus `pnpm e2e onboarding --reporter=line` — `e2e/onboarding.spec.ts` drives this card and is not a CI gate.

```bash
git add src/lib/onboarding-tasks.ts src/lib/onboarding-tasks.test.ts src/components/onboarding
git commit -F - <<'EOF'
feat(onboarding): point a graduating player at their insights

The next-step card rendered nothing once board, team and invite were done.
It now uses that moment for the one surface a player has no route to from
this screen, and which tells them something about how they actually play.

No new dismissal state: the existing flag covers both halves of the card.
The graduation state emits no onboarding_view, because that event's
denominator is activation and every activated player mounts this.
EOF
```

---

## What this plan does not do

- **Anything about what is gated.** `wordle-teams-iht.3` owns that.
- **The permanent dashboard link to insights** — `wordle-teams-wty4.1.15`, which Task 6 serves but does not close.
- **The launch email** — `wordle-teams-7e3c`, which also carries the terms-change notice.
- **Search Console, keyword research and the 301s** — `wordle-teams-0hx`, post-cutover by nature.
- **Adding the Polar secrets to CI.** Task 1 leaves the workflow exiting 2 until the owner adds them, and says so.
