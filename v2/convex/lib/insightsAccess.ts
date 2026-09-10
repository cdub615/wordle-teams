/**
 * WHICH INSIGHT LAYERS A PLAYER MAY SEE, and when their trial clock starts.
 *
 * THIS FILE HAS NO IMPORTS, for the reason chatLimits.ts exists: the insights
 * surface needs these rules in the browser, and reaching them through
 * ../access.ts would drag auth.ts's module-scope throw into the client chunk.
 * If you are about to add an import here, you are about to ship that bug again.
 *
 * The DECISION lives here as a pure function and the Convex wrapper only
 * supplies the inputs, because nothing in this repo can drive an authed wrapper
 * (wordle-teams-obw) — so a rule left inside one is a rule no test can execute.
 */

/**
 * WHEN v2 BECOMES THE REAL SITE. The trial clock is measured from a player's
 * first board AFTER this instant.
 *
 * ⚠️ THIS IS A PLACEHOLDER AND THE OWNER MUST SET IT. It is 2099, which is not a
 * date anyone could mistake for the real one — the task required a placeholder
 * that is OBVIOUSLY one rather than a plausible wrong date, because a plausible
 * wrong date would start trials early and silently.
 *
 * IT FAILS SAFE, WHICH IS WHY 2099 RATHER THAN 1970. No board can be entered
 * after it, so `shouldStartTrial` is false for everyone and NO trial is ever
 * stamped while this value stands. The feature is inert rather than wrong, and
 * `startsNoTrialWhileUnset` below is the test that says so out loud. Setting this
 * to the real cutover instant is the single edit that switches it on.
 *
 * ONE CONSTANT, NOT A DATE THREADED THROUGH CALL SITES, so correcting it is one
 * line rather than a search.
 */
export const LAUNCH_AT = Date.UTC(2099, 0, 1)

/** True while LAUNCH_AT is still the placeholder rather than a real cutover. */
export const LAUNCH_AT_IS_PLACEHOLDER = LAUNCH_AT === Date.UTC(2099, 0, 1)

/** One month of Layers 2 and 3, per the spec's tier section. */
export const INSIGHTS_TRIAL_DAYS = 30

const MS_PER_DAY = 86_400_000

/**
 * Whether entering a board now should start this player's trial.
 *
 * TWO CONDITIONS, AND BOTH ARE THE POINT:
 *
 * - `trialEndsAt === undefined` — the field is written ONCE. A second board must
 *   not extend the trial, so this is the only thing standing between a daily
 *   player and a permanent free tier.
 * - `enteredAt >= launchAt` — the clock starts at the first board AFTER launch,
 *   never at launch itself. A calendar window anchored to launch expires while a
 *   dormant player is still dormant, and dormant returners are exactly who the
 *   launch email is aimed at. This one comparison covers them and every future
 *   signup with a single rule.
 *
 * A player whose only boards predate launch gets no clock — correctly, because
 * they have not come back yet. The moment they do, they get a full month.
 */
export function shouldStartTrial({
  trialEndsAt,
  enteredAt,
  launchAt = LAUNCH_AT,
}: {
  trialEndsAt: number | undefined
  enteredAt: number
  launchAt?: number
}): boolean {
  if (trialEndsAt !== undefined) return false
  return enteredAt >= launchAt
}

/** When a trial started by a board entered at `enteredAt` runs out. */
export function trialEndsAtFor(enteredAt: number): number {
  return enteredAt + INSIGHTS_TRIAL_DAYS * MS_PER_DAY
}

/**
 * What a player can see of one layer.
 *
 * 'free' is NOT a lesser 'full' — it is a specific, deliberately chosen slice:
 * Layer 1's most recent board, Layer 3's one team fact for today. The spec picks
 * those rather than leaving free open, so the type names them apart.
 */
export type LayerAccess = 'none' | 'free' | 'full'

export type InsightsAccess = {
  /** Public benchmark. Free sees their most recent board; pro sees all history. */
  layer1: LayerAccess
  /** Personal history. Pro or trial only. */
  layer2: LayerAccess
  /** Team analytics. Free sees today's team fact; pro sees the full surface. */
  layer3: LayerAccess
  /** Global comparison. Pro only, and still per-slice gated on >=30 elsewhere. */
  layer4: LayerAccess
  /** Whether a trial is running right now. */
  trialActive: boolean
  /** When the running trial ends, or null if none is running. */
  trialEndsAt: number | null
  /**
   * A trial ran and is over, and the player did not upgrade.
   *
   * NOT simply `!trialActive`: someone who never started a trial has no trial to
   * be told about, and a Pro player who converted must not be nagged about the
   * trial they converted from. This field is the difference between a prompt
   * aimed at one person and a banner shown to everybody.
   */
  trialExpired: boolean
}

/**
 * The single resolver.
 *
 * THE TRIAL GRANTS LAYERS 2 AND 3 ONLY, which is the spec's wording taken
 * literally ("One month of Layers 2 and 3") rather than loosened to "everything".
 * The visible consequence, recorded so it is a decision rather than a surprise:
 * a player mid-trial gets the full personal history and the full team surface but
 * still sees Layer 1 as a free user — their most recent board rather than all of
 * it — and Layer 4 not at all. If that reads wrong to the owner, this function is
 * the one place to change it.
 *
 * NOTHING PREVIOUSLY FREE MOVES BEHIND THE PAYWALL. That is a hard constraint in
 * the spec, not a preference, because the launch email goes to people who already
 * gave up once. Insights is entirely new surface, so the constraint holds by
 * construction here — but the shape that protects it is that a free player is
 * never 'none' on Layers 1 and 3. They always have something to look at.
 */
export function insightsAccess({
  isPro,
  trialEndsAt,
  now,
}: {
  isPro: boolean
  trialEndsAt: number | undefined
  now: number
}): InsightsAccess {
  // Strictly after: a trial is over at the instant it ends, not a millisecond
  // later. Tested on both sides, because a threshold tested in one direction is
  // vacuous.
  const trialActive = trialEndsAt !== undefined && now < trialEndsAt
  const paid = isPro || trialActive

  return {
    layer1: isPro ? 'full' : 'free',
    layer2: paid ? 'full' : 'none',
    layer3: paid ? 'full' : 'free',
    layer4: isPro ? 'full' : 'none',
    trialActive,
    trialEndsAt: trialActive ? (trialEndsAt ?? null) : null,
    trialExpired: !isPro && trialEndsAt !== undefined && !trialActive,
  }
}
