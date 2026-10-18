/**
 * Every numeric counter convex/e2ePrune.pruneBatch reports, in the order
 * scripts/prune-e2e-data.mjs prints them.
 *
 * ITS OWN MODULE SO A TEST CAN READ IT. The script runs at import, so nothing
 * could import the list from there, and the drift guard it feeds was only ever
 * exercised by an operator running the script for real. leagueRowsDeleted was
 * missing for exactly that reason (wordle-teams-kxwa): every real run stopped at
 * the guard. convex/e2ePrune.test.ts now compares this list with a real
 * pruneBatch report, so the next missing counter fails the gates instead.
 */
export const TOTAL_KEYS = [
  'playersScanned',
  'e2ePlayersFound',
  'playersDeleted',
  'dailyScoresDeleted',
  'monthlyWinnersDeleted',
  'scoringSystemsDeleted',
  'playerMembershipsDeleted',
  'pushSubscriptionsDeleted',
  'chatReadsDeleted',
  'clueLadderPlaysDeleted',
  'teamsDeleted',
  'teamRostersPatched',
  'teamInvitesCleared',
  'celebrationRefsCleared',
  'teamsKeptWithUnresolvableMembers',
  'invitesDiscardedWithDeletedTeams',
  'challengesClosed',
  'challengesWithdrawn',
  'leagueRowsDeleted',
]
