import 'server-only'

import { canonicalOrigin } from '@/lib/app-origin'

// Single source of truth for the auth callback URL used by email links (login OTP and team invites).
//
// The invite flow previously omitted this, so invite links redirected to the project's default
// Site URL instead of /api/auth/callback and never established a session — invitees could never
// join the team that invited them. See docs/plans/2026-07-28-fix-team-invite-join-flow.md.
//
// That fix was then undone by how the base URL was built. It came from VERCEL_URL, described here
// as "a full canonical URL in this project's environment" — true only in .env.local, and false on
// every deployment, where VERCEL_URL is the bare scheme-less deployment hostname. Supabase
// validates redirectTo against its allowlist and silently substitutes the Site URL when it does
// not match, so production reverted to exactly the failure this file was written to prevent — and
// for logins as well as invites, since login/actions.ts builds its OTP email link from here too.
// Confirmed against the production project rather than inferred; see wordle-teams-ev8 and
// scripts/verify-auth-redirect-allowlist.mjs.
//
// The origin now comes from canonicalOrigin(), shared with the Polar module because the identical
// mistake broke checkout there first.
export function authCallbackUrl(next?: string): string {
  const base = `${canonicalOrigin()}/api/auth/callback`
  return next ? `${base}?next=${encodeURIComponent(next)}` : base
}
