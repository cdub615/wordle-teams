import { get } from '@vercel/edge-config'
import { NextResponse, type NextRequest } from 'next/server'
import { updateSession } from './lib/supabase/middleware'

// NOTE ON LOCATION: this file must live in src/, not the repo root. This project
// uses a src directory, so Next resolves middleware at src/middleware.ts and
// silently ignores a root-level middleware.ts — no warning, no build error, the
// middleware simply never runs. It sat at the root, which is why maintenance
// mode and the redirects below had never once executed in production. Verified
// against prod on 2026-07-30: a signed-out GET /me returned 200 with no
// redirect, and the build emitted `"middleware": {}`. Do not move it back.
export async function middleware(request: NextRequest) {
  // Fail open on both halves. This guards the five most important routes in the
  // app, and every page behind it already does its own server-side auth check
  // (src/app/me/page.tsx:31 redirects when there is no session). A transient
  // Edge Config or Supabase outage must degrade to "let the request through",
  // never to a 500 on /me and /login. This middleware has never run in
  // production before, so it gets no benefit of the doubt.
  try {
    const maintenance = await get<boolean>(`maintenance_${process.env.ENVIRONMENT}`)
    if (maintenance) {
      request.nextUrl.pathname = '/maintenance'
      return NextResponse.rewrite(request.nextUrl)
    }
  } catch (error) {
    console.warn('middleware: maintenance flag unreadable, continuing', error)
  }

  try {
    return await updateSession(request)
  } catch (error) {
    console.warn('middleware: session refresh failed, continuing unauthenticated', error)
    return NextResponse.next({ request })
  }
}

// An allowlist, not a filter. Middleware forces a function invocation on every
// path it matches, so it covers only routes that genuinely need it:
//   - updateSession's redirects: welcomePaths '/' and '/login', protectedPaths
//     '/branding', '/me', '/complete-profile'
//   - auth cookie refresh on those same routes
//   - the maintenance-mode rewrite
//
// Deliberately NOT matched: /home, /about, /privacy, /terms and every static
// asset. They need no session and are served straight from the CDN. The
// trade-off is that maintenance mode no longer covers those four pages — which
// is the better behaviour, since they are static and render fine while the app
// is down. Anything user-facing that must honour maintenance goes here.
//
// Bare paths are listed alongside their :path* forms rather than relying on
// zero-segment matching, so a protected route can never fall through by accident.
export const config = {
  matcher: [
    '/',
    '/login',
    '/me',
    '/me/:path*',
    '/branding',
    '/branding/:path*',
    '/complete-profile',
    '/complete-profile/:path*',
  ],
}
