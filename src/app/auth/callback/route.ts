import { createRouteHandlerClient } from '@supabase/auth-helpers-nextjs'
import { cookies } from 'next/headers'
import { NextResponse } from 'next/server'

import type { Database } from '@/lib/database.types'
import type { NextRequest } from 'next/server'

export const dynamic = 'force-dynamic'

// TODO apparently code and something else are needed for this to work
/*
  error AuthApiError: invalid request: both auth code and code verifier should be non-empty

  happens at SupabaseAuthClient.exchangeCodeForSession
*/

export async function GET(request: NextRequest) {
  const requestUrl = new URL(request.url)
  const code = requestUrl.searchParams.get('code')

  if (code) {
    const supabase = createRouteHandlerClient<Database>({ cookies })
    await supabase.auth.exchangeCodeForSession(code)
  }

  // URL to redirect to after sign in process completes
  return NextResponse.redirect(process.env.VERCEL_URL!)
}
