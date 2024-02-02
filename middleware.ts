import { createServerClient, type CookieOptions } from '@supabase/ssr'
import { get } from '@vercel/edge-config'
import { NextResponse, type NextRequest } from 'next/server'

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
  const { data } = await supabase.auth.getUser()
  const pathname = request.nextUrl.pathname
  if (!data.user && (pathname.includes('/branding') || pathname.includes('/[initials]'))) {
    return NextResponse.redirect('/login')
  }

  return response
}

export const config = {
  matcher: '/',
}
