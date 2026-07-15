import { createServerClient } from '@supabase/ssr'
import { NextResponse, type NextRequest } from 'next/server'

// Routes that show the marketing / sign-in experience. A signed-in user should
// never land here (e.g. an iOS PWA relaunch that ignores manifest start_url and
// restores the welcome page) — bounce them into the app instead.
const welcomePaths = ['/', '/login']
const protectedPaths = ['/branding', '/me', '/complete-profile']

// Build a redirect response that carries over any auth cookies the Supabase
// client refreshed on `source`, so the browser and server stay in sync.
function redirectWithCookies(url: URL, source: NextResponse) {
  const response = NextResponse.redirect(url)
  for (const cookie of source.cookies.getAll()) {
    response.cookies.set(cookie)
  }
  return response
}

export async function updateSession(request: NextRequest) {
  let supabaseResponse = NextResponse.next({
    request,
  })

  const supabase = createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        getAll() {
          return request.cookies.getAll()
        },
        setAll(cookiesToSet) {
          supabaseResponse = NextResponse.next({
            request,
          })
          cookiesToSet.forEach(({ name, value, options }) => {
            request.cookies.set(name, value)
            supabaseResponse.cookies.set(name, value, options)
          })
        },
      },
    }
  )

  // IMPORTANT: Avoid writing any logic between createServerClient and
  // supabase.auth.getUser(). A simple mistake could make it very hard to debug
  // issues with users being randomly logged out.
  const {
    data: { user },
  } = await supabase.auth.getUser()

  const { pathname } = request.nextUrl

  // Signed-in user on a welcome/login page -> send them into the app. This is
  // what keeps the installed PWA from opening to the welcome screen.
  if (user && welcomePaths.includes(pathname)) {
    const url = request.nextUrl.clone()
    url.pathname = '/me'
    return redirectWithCookies(url, supabaseResponse)
  }

  // Signed-out user on a protected page -> send them to sign in.
  if (!user && protectedPaths.some((protectedPath) => pathname.startsWith(protectedPath))) {
    const url = request.nextUrl.clone()
    url.pathname = '/login'
    return redirectWithCookies(url, supabaseResponse)
  }

  // IMPORTANT: You *must* return the supabaseResponse object as it is. If you're
  // creating a new response object with NextResponse.next() make sure to:
  // 1. Pass the request in it, like so:
  //    const myNewResponse = NextResponse.next({ request })
  // 2. Copy over the cookies, like so:
  //    myNewResponse.cookies.setAll(supabaseResponse.cookies.getAll())
  // 3. Change the myNewResponse object to fit your needs, but avoid changing
  //    the cookies!
  // 4. Finally:
  //    return myNewResponse
  // If this is not done, you may be causing the browser and server to go out
  // of sync and terminate the user's session prematurely!

  return supabaseResponse
}
