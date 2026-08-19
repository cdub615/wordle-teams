import type { ScoringSystem } from './scoring.ts'
import type { PuzzleMonth } from './puzzleDay.ts'

/**
 * Resolving which scoring system governed a given month.
 *
 * wordle-teams-1j3: a team's scoring system used to be a single set of values
 * read at compute time, so editing it silently rewrote every past month's
 * totals and could flip who had won. A change now applies to the current month
 * forward, and past months keep the values they were played under.
 *
 * DEPENDENCY-FREE, like everything else in convex/lib/ — no Convex, React or
 * DOM imports. It is bundled into Convex functions AND imported by the browser.
 *
 * Note what is NOT here: pointsFor, monthTotal and winnerOf are untouched.
 * They already took the system as a parameter, so versioning only changes what
 * gets passed in.
 */

/** A stored version: the eight values, plus the month they take effect. */
export type ScoringSystemVersion = ScoringSystem & { effectiveFrom: PuzzleMonth }

/**
 * v1's `defaultSystem` (src/lib/types.ts), value for value. What createTeam
 * writes onto a new team.
 *
 * `as const satisfies ScoringSystem`: still checked against the type, but
 * frozen at the value level too, so `DEFAULT_SYSTEM.oneGuess = x` is a type
 * error rather than a mutation that corrupts every team createTeam writes for
 * the rest of the module's life. Callers spread it (`{...DEFAULT_SYSTEM}`)
 * into whatever they need to mutate.
 */
export const DEFAULT_SYSTEM = {
  oneGuess: 5,
  twoGuesses: 3,
  threeGuesses: 2,
  fourGuesses: 1,
  fiveGuesses: 0,
  sixGuesses: -1,
  failed: -3,
  nA: 0,
} as const satisfies ScoringSystem

/**
 * The eight field keys of ScoringSystem, in the canonical display/validate
 * order, DERIVED rather than hand-listed.
 *
 * A literal tuple of the eight names would compile perfectly after a ninth
 * field was added to ScoringSystem, and would simply never surface it — a gap
 * that ships silently in whatever reads this list. DEFAULT_SYSTEM is `as const
 * satisfies ScoringSystem` above, so `satisfies` already forces it to carry
 * every field of the type and no others (object literals get excess-property
 * checking under `satisfies` too). Reading the key list off it therefore makes
 * drift a COMPILE ERROR at the source: add a field to ScoringSystem and
 * DEFAULT_SYSTEM stops compiling until it is added there too, at which point
 * this list — and SYSTEM_FIELD_LABELS below — pick it up with no edit here.
 *
 * teams.ts's requireValues uses this for validation; scoring-system-card.tsx
 * and scoring-system-editor.tsx both use it (with SYSTEM_FIELD_LABELS) for row
 * order, replacing what used to be two independently hand-written arrays.
 */
export const SYSTEM_FIELDS = Object.keys(DEFAULT_SYSTEM) as Array<keyof ScoringSystem>

/**
 * Human labels for each field, keyed by field name rather than listed
 * positionally: a `Record<keyof ScoringSystem, string>` makes a missing label
 * a compile error the same way `satisfies` makes a missing default a compile
 * error on DEFAULT_SYSTEM above — TypeScript requires every key of
 * ScoringSystem to be present.
 *
 * NOT "0" for nA, and not "N/A", as v1 labels it. The schema field is nA,
 * which is a misnomer: it is what an unplayed day before today scores, and has
 * nothing to do with the N/A shown for weekends on a no-weekends team.
 */
export const SYSTEM_FIELD_LABELS: Record<keyof ScoringSystem, string> = {
  oneGuess: '1',
  twoGuesses: '2',
  threeGuesses: '3',
  fourGuesses: '4',
  fiveGuesses: '5',
  sixGuesses: '6',
  failed: 'X',
  nA: 'Missed day',
}

/**
 * The valid range for a single scoring value, shared the same way
 * FREE_TEAM_LIMIT is (lib/teamLimits.ts): one constant imported by the
 * client-side editor AND the server-side check, so the two cannot drift
 * apart. teams.ts's requireValues throws INVALID_SYSTEM outside this range;
 * scoring-system-editor.tsx disables Save outside it.
 */
export const SYSTEM_VALUE_MIN = -100
export const SYSTEM_VALUE_MAX = 100

/**
 * The version that governed `month`: the one with the greatest `effectiveFrom`
 * not after it.
 *
 * `base` — the team doc's own eight fields — is the fallback, and that is what
 * makes this need no backfill and no change to the copy script. A team with no
 * version rows has always scored the way it scores now, which is true.
 *
 * 'YYYY-MM' sorts lexicographically, so this is a string comparison. The input
 * is sorted defensively rather than trusting a caller's index order.
 *
 * TIES ARE DEFINED, NOT EXPECTED. On a duplicate `effectiveFrom` the later
 * element of the INPUT ARRAY wins — see the comparator below and the
 * "duplicate effectiveFrom" test.
 *
 * That is a correctness property first: `Array.prototype.sort` with a
 * comparator that is not a total order is implementation-defined behaviour
 * whether or not two rows ever actually tie, so the comparator has to be total
 * regardless, and pinning what it does on a tie is what stops a refactor
 * changing it silently.
 *
 * It is NOT justified by a reachable race, and an earlier version of this
 * comment wrongly said it was. setScoringSystemFor upserts by (teamId,
 * effectiveFrom) with a read-then-write, but that is the same shape as
 * upsertBoardFor's (playerId, puzzleDay) upsert in scores.ts, and Convex's OCC
 * covers both: an indexed read puts the RANGE IT SCANNED into the
 * transaction's read set, including when that range is empty, so a concurrent
 * insert into it invalidates the loser and Convex retries — at which point the
 * retry finds the row and patches instead of inserting. Two rows sharing an
 * effectiveFrom should therefore not be reachable through the mutation, which
 * is currently the only writer of this table. LIKE upsertBoardFor's CLAIM,
 * THESE TESTS DO NOT PROVE IT: convex-test runs a single transaction and does
 * not simulate OCC retries. Defence-in-depth against a future second writer,
 * then, not a race we can point at.
 */
export function systemFor(
  base: ScoringSystem,
  versions: Array<ScoringSystemVersion>,
  month: PuzzleMonth,
): ScoringSystem {
  return resolve(versions, month) ?? base
}

/**
 * The `effectiveFrom` of the version governing `month`, or null when it
 * resolved to the base. This is what the Scoring System card's badge renders,
 * and null is what tells it there is no badge to show.
 */
export function effectiveFromOf(
  versions: Array<ScoringSystemVersion>,
  month: PuzzleMonth,
): PuzzleMonth | null {
  return resolve(versions, month)?.effectiveFrom ?? null
}

function resolve(
  versions: Array<ScoringSystemVersion>,
  month: PuzzleMonth,
): ScoringSystemVersion | undefined {
  return versions
    .filter((version) => version.effectiveFrom <= month)
    .sort((a, b) => (a.effectiveFrom < b.effectiveFrom ? -1 : a.effectiveFrom > b.effectiveFrom ? 1 : 0))
    .at(-1)
}
