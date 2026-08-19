/**
 * The free-tier team cap.
 *
 * Single source of truth for the number: `team-picker.tsx` reads it to decide
 * whether to show "New Team" or "Upgrade for more" (UI-only — createTeam does
 * not enforce a cap, and neither does v1's server action). Phase 5 adds the
 * paid plan and, with it, an actual server-side check — that check MUST read
 * this constant rather than hardcoding its own `2`, or the client-side swap
 * and the server-side enforcement will drift apart.
 */
export const FREE_TEAM_LIMIT = 2
