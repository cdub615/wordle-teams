import { convexBetterAuthReactStart } from '@convex-dev/better-auth/react-start'

// process.env works on Workers (nodejs_compat + compat date >= 2025-04-01 populates it)
// and import.meta.env covers local vite dev.
const convexUrl = process.env.VITE_CONVEX_URL ?? import.meta.env.VITE_CONVEX_URL
const convexSiteUrl = process.env.VITE_CONVEX_SITE_URL ?? import.meta.env.VITE_CONVEX_SITE_URL

if (!convexUrl) throw new Error('VITE_CONVEX_URL is not set')
if (!convexSiteUrl) throw new Error('VITE_CONVEX_SITE_URL is not set')

export const { handler, getToken, fetchAuthQuery, fetchAuthMutation, fetchAuthAction } =
  convexBetterAuthReactStart({ convexUrl, convexSiteUrl })
