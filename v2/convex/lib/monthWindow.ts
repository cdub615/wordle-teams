import { addMonths, type PuzzleMonth } from './puzzleDay.ts'

/**
 * HOW FAR BACK A PLAYER MAY LOOK, and what a free player is told they are missing.
 *
 * NO IMPORTS BUT puzzleDay.ts, for the reason insightsAccess.ts has none at all:
 * the browser needs this rule to build the month dropdown, and reaching it
 * through ../access.ts would drag auth.ts — the whole Better Auth server surface
 * — into the client chunk. puzzleDay.ts is itself import-free, so it costs
 * nothing to carry — but it is NOT pure string arithmetic: `addMonths` builds a
 * `Date` internally, and `Date` maps a two-digit year (0-99) into 1900+year, so
 * `addMonths('0050-03', -1)` silently returns `'1950-02'`. Latent rather than
 * dangerous here, because every `addMonths` call in this file takes either
 * `currentMonth` (trusted) or a value this module already derived from it —
 * never the untrusted `earliestMonth` directly. Do not add a call that does
 * without re-checking this. If you are about to add any other import here,
 * read insightsAccess.ts's header first.
 *
 * THE DECISION LIVES HERE AS PURE FUNCTIONS and the Convex wrapper only supplies
 * the inputs, because nothing in this repo can drive an authed wrapper
 * (wordle-teams-obw) — a rule left inside one is a rule no test can execute.
 *
 * A DIFFERENT RULE FROM insights-months.ts's `teamMonthOptions`, and the two must
 * not be unified. That one runs from the team's CREATION month and caps at twelve
 * so its list renders without scroll math. This one runs from the team's earliest
 * BOARD and is effectively uncapped, because its job is parity with v1 — where a
 * Pro player reaches every month their team has ever played — and a cap is
 * precisely the regression a migrating subscriber would feel.
 */

/** What a free account sees: this month and the two before it. v1's window. */
export const FREE_MONTHS = 3

/**
 * THE CEILING, WHICH EXISTS FOR SAFETY RATHER THAN FOR PRODUCT.
 *
 * `earliestMonth` comes from `dailyScores.puzzleDay`, which `upsertBoard` accepts
 * as a bare `v.string()` and validates nowhere on the server (wordle-teams-qvqi).
 * A stored '1000-01-01' would otherwise build a twelve-thousand-row dropdown and
 * make the server materialise the same array on every below-floor request. v1
 * teams date to 2023, so ten years is generous for every real team and absurd for
 * every fabricated one. This is NOT insights-months.ts's CAP — that one shapes the
 * product; this one bounds an input nobody validates.
 */
const MAX_MONTHS = 120

/**
 * ONE MONTH OF SLACK BETWEEN WHAT THE CLIENT OFFERS AND WHAT THE SERVER ACCEPTS.
 *
 * Convex runs UTC. `toPuzzleDay` resolves in the runtime's local zone, so the
 * server's idea of "this month" and the viewer's disagree for a few hours at
 * every month boundary — in BOTH directions, depending on which side of UTC the
 * viewer is on. Without slack, a viewer in Tokyo just after local midnight on the
 * 1st would be offered a month the server then refuses, and the dashboard would
 * break for everyone east of UTC on the 1st of every month.
 *
 * Offsets span UTC−12..UTC+14, so the two sides differ by at most one month:
 * ONE IS EXACTLY SUFFICIENT AND HAS NO MARGIN. Do not reduce it. Two would be
 * gratuitous. The gate exists to stop someone reading years of history they have
 * not paid for, not to be exact to the month, and the cost of the slack is that a
 * hand-typed URL reaches at most a fourth month.
 */
const SERVER_SLACK_MONTHS = 1

export type MonthWindowInput = {
  /** The viewer's current month, 'YYYY-MM'. Local on the client, UTC on the server. */
  currentMonth: PuzzleMonth
  /** The earliest month anyone on the team's roster has a board in, or null for none. */
  earliestMonth: PuzzleMonth | null
  /** `membershipStatus === 'pro'`. The Insights trial does NOT open this window — see the spec. */
  pro: boolean
}

/**
 * Every month this viewer may look at, NEWEST FIRST.
 *
 * DESCENDING IS A DELIBERATE DIVERGENCE FROM v1 (wordle-teams-l23h), recorded in
 * V2-ADDENDUM.md row 48: v1's getMonthsFromScoreDate walks forward and pushes the
 * current month on last, which puts the month a reader almost always wants off the
 * bottom of a scroll once the list is long. It is long now.
 *
 * THE PRO WINDOW IS NEVER NARROWER THAN THE FREE ONE, and that `Math.max` is the
 * single most important line in this file. Without it a team younger than three
 * months gives its PRO owner a one- or two-row dropdown while the FREE members
 * beside them still get three — so upgrading would visibly REMOVE months, which is
 * the exact regression this whole feature exists to close. Every team created
 * during the launch window is in that range.
 *
 * `currentMonth` IS ALWAYS ELEMENT 0, AND THE WINDOW IS NEVER EMPTY, FOR EVERY
 * INPUT — free or pro, with or without boards, for an earliestMonth in the future,
 * and for a malformed one. The list is built by counting BACK from `currentMonth`
 * over a length that is floored at FREE_MONTHS, so neither can fail.
 *
 * DO NOT BREAK THAT INVARIANT. dashboard-months.ts does not exist yet — Task 6 of
 * this spec creates it — but it will depend on this by name: its planned
 * `correctedMonth` will fall back to element 0 whenever `?month=` is not a member
 * of this list, and that fallback will settle — rather than the effect behind it
 * navigating forever — only because the fallback value is itself always a member. A
 * change like "do not offer the current month until the team has a board in it"
 * would read as entirely reasonable here and would reintroduce an infinite
 * redirect in a file its author had no reason to open. insights-months.ts carries
 * this same warning for the same reason.
 */
export function monthWindowFor({ currentMonth, earliestMonth, pro }: MonthWindowInput): Array<PuzzleMonth> {
  return countBack(currentMonth, spanFor({ currentMonth, earliestMonth, pro }))
}

/**
 * The oldest month the SERVER will serve this viewer — one month below
 * `oldestOfferedFor`, per SERVER_SLACK_MONTHS. That is now literally what the
 * code below computes, not just what this sentence claims.
 *
 * ARITHMETIC, NOT `monthWindowFor(...).at(-1)`, and that is deliberate rather than
 * a micro-optimisation: the array form would materialise up to MAX_MONTHS entries
 * on every below-floor request purely to read one value, and — before the span was
 * floored — could read `[-1]` off an empty array and throw `undefined.split` inside
 * getTeamMonthFor (scores.ts:45), taking the dashboard down for every Pro member of
 * the team.
 *
 * A FLOOR RATHER THAN MEMBERSHIP OF THE WINDOW. There is no upper bound to
 * enforce: a future month simply contains no boards, and refusing one would be a
 * second way for the UTC/local disagreement above to break a page.
 */
export function serverFloorFor(input: MonthWindowInput): PuzzleMonth {
  return addMonths(oldestOfferedFor(input), -SERVER_SLACK_MONTHS)
}

/**
 * The month to advertise to a free player as what Pro reaches back to, or null
 * when there is nothing to advertise.
 *
 * NULL IS THE IMPORTANT ANSWER. A team whose earliest board is already inside the
 * free window has nothing behind the gate, and a row saying otherwise would sell a
 * week-old team history it does not have. Same for a team with no boards, for a
 * player who is already Pro, and for a malformed earliestMonth.
 *
 * NAMES THE OLDEST MONTH PRO ACTUALLY REACHES — `oldestOfferedFor` with `pro:
 * true` — NOT `earliestMonth` itself. The two VALUES differ whenever either of
 * `spanFor`'s bounds bites — an `earliestMonth` of `currentMonth - 1` already
 * differs from the floored window's oldest month — but the ANSWER this function
 * returns only differs when the MAX_MONTHS cap does, because below the floor
 * both comparisons land on null anyway. The cap is the case that mattered: an ancient, unvalidated `earliestMonth` (upsertBoard,
 * wordle-teams-qvqi) used to be handed back verbatim, so a team with a stored
 * '1000-01' could be teased a month decades before what Pro's own capped window
 * reaches — advertising history the upgrade cannot deliver. Comparing the two
 * `oldestOfferedFor` values, instead of `earliestMonth` against the free
 * window, makes that impossible by construction: this can only ever name a
 * month the Pro window itself contains.
 *
 * THE COMPARISON IS AGAINST THE CLIENT FREE WINDOW, not the server's floor,
 * which sits one month further back (SERVER_SLACK_MONTHS). So a team whose
 * earliest board falls in exactly that slack month still gets a row here, even
 * though a free viewer could already reach that month by hand-typing its URL —
 * this can name a month the slack already covers. That is over-inclusive by one
 * month at the boundary, not under-promising, and it is accepted rather than
 * fixed: comparing against the server floor here would make this pure function
 * re-derive SERVER_SLACK_MONTHS's reasoning for a one-month edge case.
 */
export function proTeaserMonth({ currentMonth, earliestMonth, pro }: MonthWindowInput): PuzzleMonth | null {
  if (pro || earliestMonth === null || !isMonth(earliestMonth)) return null

  const proOldest = oldestOfferedFor({ currentMonth, earliestMonth, pro: true })
  const freeOldest = oldestOfferedFor({ currentMonth, earliestMonth, pro: false })
  return proOldest < freeOldest ? proOldest : null
}

/**
 * How many months long this viewer's window is. The one place the length rule
 * lives, so `monthWindowFor` and `serverFloorFor` can never disagree about it.
 */
function spanFor({ currentMonth, earliestMonth, pro }: MonthWindowInput): number {
  if (!pro || earliestMonth === null || !isMonth(earliestMonth)) return FREE_MONTHS

  // PuzzleMonth is 'YYYY-MM', so lexical comparison IS chronological comparison
  // (see puzzleDay.ts's header). CLAMPED HERE FOR SANITY, NOT LOAD-BEARING: an
  // earliestMonth in the future would otherwise drive `span` negative, but the
  // `Math.max(span, FREE_MONTHS)` floor below already lifts any span under
  // FREE_MONTHS back up to it regardless — so a future earliestMonth lands on
  // the free window whether this clamp runs or not, and no test can kill this
  // line by itself. It stays because a negative intermediate `span` is a worse
  // thing to have sitting in this function than a clamped one, not because
  // removing it would change what any caller observes.
  const start = earliestMonth > currentMonth ? currentMonth : earliestMonth
  const span = monthIndex(currentMonth) - monthIndex(start) + 1

  // FLOORED AT FREE_MONTHS so Pro is never narrower than free; capped at
  // MAX_MONTHS so an unvalidated puzzleDay cannot build an absurd list. Both
  // bounds have their own comment above; neither is tidiness.
  return Math.min(Math.max(span, FREE_MONTHS), MAX_MONTHS)
}

/**
 * The oldest month this viewer's window actually reaches — the single seam
 * `serverFloorFor` and `proTeaserMonth` both compute through, so neither can
 * name a month that disagrees with what `spanFor`'s floor and cap actually
 * produce. `monthWindowFor`'s own last element is this exact value, by
 * construction: `countBack` walks `spanFor(input) - 1` months back from
 * `currentMonth`, and the last step is this one.
 */
function oldestOfferedFor(input: MonthWindowInput): PuzzleMonth {
  return addMonths(input.currentMonth, -(spanFor(input) - 1))
}

/**
 * Whether a string is a well-formed 'YYYY-MM'.
 *
 * EXPORTED, AND THE ONE PLACE THE SERVER'S SHAPE RULE LIVES. TWO GATES CALL IT
 * NOW — getTeamMonthFor's and lastMonthWinnerFor's — rather than either carrying
 * its own copy of the regex, so the shape rule and the window rules it guards
 * cannot drift apart. A second copy of the pattern would let one side be relaxed
 * without the other. insightsAccess.ts's hasFullTeamMonth was extracted for the
 * same reason and says so ("Three was already one too many").
 *
 * THE TWO CALLERS WANT IT FOR DIFFERENT REASONS, which is worth knowing before
 * relaxing this to satisfy one of them. getTeamMonthFor's argument is about
 * SORTING: a bare '2026' sorts above a floor THIS MODULE computes, so without the
 * check a Pro member pulls a year of every teammate's boards. lastMonthWinnerFor
 * has no pro floor at all, so for its Pro callers this is the ONLY refusal there
 * is — and what it buys them is not a payload but predictability, since
 * `yearAndMonth` would otherwise turn a malformed month into a NaN index lookup
 * that quietly misses. Relaxing the pattern would weaken a leak guard in one file
 * and a correctness guard in the other.
 *
 * routes/app.tsx's `validateSearch` keeps its own inline copy deliberately: that
 * one is route validation on `?month=`, runs before any query, and belongs to the
 * router rather than to this rule.
 *
 * NEEDED BECAUSE NOTHING UPSTREAM GUARANTEES IT. `upsertBoard` stores `puzzleDay`
 * as an unvalidated `v.string()` (wordle-teams-qvqi), so `monthOf('')` is `''` and
 * `monthIndex('')` is NaN — which would make the span NaN and the window empty.
 *
 * SHAPE ONLY, AND IT ADMITS MONTH 00 AND 99. '2026-00' and '2026-99' both pass
 * here: the first yields a nine-month window and the second clamps to three.
 * Neither is harmful — a cosmetically long dropdown is not a crash, and since
 * Fix 1 every month this module hands out is `addMonths`-derived rather than
 * echoed back, so a nonsense input can no longer reach a label ('2026-00' teases
 * '2025-12'). Left shape-only deliberately: the real fix belongs upstream in
 * wordle-teams-qvqi, and a stricter check here would imply a validation
 * guarantee this module cannot make.
 */
export function isMonth(value: string): boolean {
  return /^\d{4}-\d{2}$/.test(value)
}

/** `count` months ending at `from`, newest first. */
function countBack(from: PuzzleMonth, count: number): Array<PuzzleMonth> {
  return Array.from({ length: count }, (_, i) => addMonths(from, -i))
}

/** Months since year zero, purely so two PuzzleMonths can be subtracted. */
function monthIndex(month: PuzzleMonth): number {
  const [year, monthNum] = month.split('-').map(Number)
  return year * 12 + monthNum
}
