import 'server-only'

// Single source of truth for this app's canonical origin.
//
// DELIBERATELY NOT DERIVED FROM VERCEL_URL. That is a Vercel *system* variable holding the bare
// deployment hostname with no scheme — 'wordle-teams-abc123-....vercel.app'. Only .env.local
// overrides it with a full URL, which is why code built on it works locally and nowhere else.
//
// Even with a scheme bolted on it would still be wrong: VERCEL_URL names the deployment-specific
// hostname, which sits behind Vercel deployment protection, so anyone redirected there lands on
// an SSO wall instead of the app.
//
// This has now broken production twice, from two separate copies of the same ternary:
//
//   * Polar checkout — success_url built from VERCEL_URL was rejected outright with
//     "Input should be a valid URL", so every checkout on dev failed. See wordle-teams-8sg.
//   * Email auth — Supabase validates redirectTo against its allowlist and silently substitutes
//     the Site URL when it does not match. A scheme-less URL never matches, so every emailed
//     login and invite link landed on the bare homepage, where nothing exchanges the code, and
//     no session was ever established. See wordle-teams-ev8.
//
// Hence one function rather than a copy per caller. A third copy would eventually drift the same
// way. Values are the canonical domains, mirroring the ternary the Lemon Squeezy module used.
export function canonicalOrigin(): string {
  return process.env.ENVIRONMENT === 'prod'
    ? 'https://wordleteams.com'
    : process.env.ENVIRONMENT === 'dev'
      ? 'https://dev.wordleteams.com'
      : 'http://localhost:3000'
}
