import { createServerClient, type CookieOptions } from '@supabase/ssr'
import { get } from '@vercel/edge-config'
import { log } from 'next-axiom'
import { cookies } from 'next/headers'
import { NextResponse, type NextRequest } from 'next/server'

export async function middleware(request: NextRequest) {
  log.info('executing middleware, trying to see if we can trigger a session refresh after processing a webhook')
  const maintenance = await get<boolean>(`maintenance_${process.env.ENVIRONMENT}`)
  if (maintenance) {
    request.nextUrl.pathname = '/maintenance'
    return NextResponse.rewrite(request.nextUrl)
  }

  let response = NextResponse.next({
    request: {
      headers: request.headers,
    },
  })

  const supabase = createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        get(name: string) {
          return request.cookies.get(name)?.value
        },
        set(name: string, value: string, options: CookieOptions) {
          request.cookies.set({
            name,
            value,
            ...options,
          })
          response = NextResponse.next({
            request: {
              headers: request.headers,
            },
          })
          response.cookies.set({
            name,
            value,
            ...options,
          })
        },
        remove(name: string, options: CookieOptions) {
          request.cookies.set({
            name,
            value: '',
            ...options,
          })
          response = NextResponse.next({
            request: {
              headers: request.headers,
            },
          })
          response.cookies.set({
            name,
            value: '',
            ...options,
          })
        },
      },
    }
  )
  // This will refresh session if expired - required for Server Components
  const { data } = await supabase.auth.getUser()
  const pathname = request.nextUrl.pathname
  if (!data.user && (pathname.includes('/branding') || pathname.includes('/me'))) {
    return NextResponse.redirect('/login')
  }

  const cookieStore = cookies()
  const refreshSession = cookieStore.get('refreshSession')
  log.info('refreshSession cookie', refreshSession)
  if (refreshSession && refreshSession.value === 'true') {
    cookieStore.set('refreshSession', 'false')
    const { error: refreshError } = await supabase.auth.refreshSession()
    if (refreshError) {
      log.error(`Failed to refresh session: ${refreshError.message}`)
    }
  }

  return response
}

export const config = {
  matcher: ['/((?!api|_next/static|favicon.ico).*)'],
}
