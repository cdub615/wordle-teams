import { get } from '@vercel/edge-config'
import { NextResponse, type NextRequest } from 'next/server'
import { updateSession } from './src/lib/supabase/middleware'

export async function middleware(request: NextRequest) {
  const maintenance = await get<boolean>(`maintenance_${process.env.ENVIRONMENT}`)
  if (maintenance) {
    request.nextUrl.pathname = '/maintenance'
    return NextResponse.rewrite(request.nextUrl)
  }

  return await updateSession(request)
}

export const config = {
  matcher: ['/((?!api|_next/static|favicon.ico).*)'],
}
