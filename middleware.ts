import { createServerClient, type CookieOptions } from '@supabase/ssr'
import { get } from '@vercel/edge-config'
import { log } from 'next-axiom'
import {NextResponse, type NextRequest} from 'next/server'
import * as Sentry from '@sentry/nextjs'

export async function middleware(request: NextRequest) {
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
  const {data, error} = await supabase.auth.getUser()
  if (error) {
    Sentry.captureException(error)
    log.error(error.message)
    return NextResponse.redirect('/login')
  }
  const pathname = request.nextUrl.pathname
  if (!data.user && (pathname.includes('/branding') || pathname.includes('/me'))) {
    return NextResponse.redirect('/login')
  }

  return response
}

export const config = {
  matcher: ['/((?!api|_next/static|favicon.ico).*)'],
}
