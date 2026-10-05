import type { FunctionReturnType } from 'convex/server'
import type { api } from '../../../convex/_generated/api'

/**
 * The challenge views, DERIVED FROM THE QUERY rather than restated, so a field
 * the server adds or renames is a type error here instead of a silent drift.
 *
 * TYPE-ONLY IMPORTS, deliberately: convex/challenges.ts imports access.ts, which
 * imports auth.ts, and src/frontend-import-graph.test.ts forbids the browser
 * graph reaching that. `typeof api...` costs no runtime edge at all.
 */
export type ChallengesView = FunctionReturnType<typeof api.challenges.challengesForTeam>
export type EnabledChallengesView = Extract<ChallengesView, { enabled: true }>
export type ActiveChallenge = EnabledChallengesView['active'][number]
export type ChallengeSideView = ActiveChallenge['challenger']
export type PendingChallenge = EnabledChallengesView['pending'][number]
export type HeadToHeadView = EnabledChallengesView['records'][number]
export type ChallengeId = ActiveChallenge['challengeId']
