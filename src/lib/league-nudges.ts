/**
 * Spec v2 §4.6: contextual Insights upsell on the league page. Pure and
 * client-side; imports nothing from the server.
 */
export type Nudge = { origin: 'leagues-behind' | 'league-result'; text: string }

/** 1 -> "1st", 11 -> "11th", 22 -> "22nd". */
export function ordinal(n: number): string {
  const mod100 = n % 100
  if (mod100 >= 11 && mod100 <= 13) return `${n}th`
  switch (n % 10) {
    case 1:
      return `${n}st`
    case 2:
      return `${n}nd`
    case 3:
      return `${n}rd`
    default:
      return `${n}th`
  }
}

/**
 * At most one nudge per surface, never for Pro/trial players (`unlocked` is the
 * contribution row's unlock). "Behind" beats "result".
 */
export function leaguePageNudge(f: {
  unlocked: boolean
  groupName: string | null
  rank: number | null
  average: number | null
  leaderAverage: number | null
  lastMonth: { monthName: string; viewerRank: number | null } | null
}): Nudge | null {
  if (f.unlocked || f.groupName === null) return null
  if (f.rank !== null && f.rank > 1 && f.average !== null && f.leaderAverage !== null) {
    // Averages are 1dp, so round away the float error (4.1 - 3.8).
    const gap = Math.round((f.average - f.leaderAverage) * 10) / 10
    // Rank 2 can share the leader's 1dp average on the boards tiebreak, and
    // "0.0 guesses off the lead" reads badly.
    const text =
      gap === 0
        ? `${f.groupName} is level with the lead on average — see where you lose guesses.`
        : `${f.groupName} is ${gap.toFixed(1)} guesses off the lead — see where you lose guesses.`
    return { origin: 'leagues-behind', text }
  }
  if (f.lastMonth?.viewerRank != null) {
    return {
      origin: 'league-result',
      text: `${f.groupName} finished ${ordinal(f.lastMonth.viewerRank)} in ${f.lastMonth.monthName} — see what separates the top openers.`,
    }
  }
  return null
}
