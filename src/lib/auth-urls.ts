// Single source of truth for the auth callback URL used by email links (login OTP and team invites).
//
// The invite flow previously omitted this, so invite links redirected to the project's default
// Site URL instead of /api/auth/callback and never established a session — invitees could never
// join the team that invited them. See docs/plans/2026-07-28-fix-team-invite-join-flow.md.
//
// Base URL mirrors the app's existing convention: VERCEL_URL is set to a full canonical URL in
// this project's environment (see .env.local), with a localhost fallback for local dev.
export function authCallbackUrl(next?: string): string {
  const base = process.env.VERCEL_URL
    ? `${process.env.VERCEL_URL}/api/auth/callback`
    : 'http://localhost:3000/api/auth/callback'
  return next ? `${base}?next=${encodeURIComponent(next)}` : base
}
