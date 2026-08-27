/**
 * The free-tier team cap.
 *
 * Single source of truth for the number, and there are now FOUR readers.
 *
 * `team-picker.tsx` reads it to decide whether to show "New Team" or "Upgrade
 * for more". That one is still UI-only — createTeam does not enforce a cap, and
 * neither does v1's server action; decision K settled that it stays that way.
 *
 * Phase 5 brought the paid plan and, with it, the server-side checks this
 * comment used to anticipate in the future tense. There are two, both of them
 * ports of a v1 RPC that caps: teams.ts's invitePlayerFor (from
 * handle_add_player_to_team) parks a non-pro invitee already on this many teams,
 * and players.ts's completeProfileFor (from handle_invited_signup) claims at
 * most this many invites at signup. billing.ts's downgradeTeamRemovalFor keeps
 * this many on a revoked subscription.
 *
 * EVERY ONE OF THEM MUST READ THIS CONSTANT rather than hardcoding its own `2`,
 * or the client-side swap and the server-side enforcement drift apart — and the
 * cap tests derive their team counts from it for the same reason, since a test
 * written against a literal keeps passing straight through the drift.
 */
export const FREE_TEAM_LIMIT = 2
