import { Database } from '@/lib/database.types'
import { createClient } from '@/lib/supabase/server'
import { finishSignIn } from '@/lib/utils'
import { Session, SupabaseClient, User, type EmailOtpType } from '@supabase/supabase-js'
import { log } from 'next-axiom'
import { cookies } from 'next/headers'
import type { NextRequest } from 'next/server'
import { NextResponse } from 'next/server'
import { parseRequest, prepareRedirect } from './utils'

export const dynamic = 'force-dynamic'

export async function GET(request: NextRequest) {
  try {
    const { next, code, token_hash, type } = parseRequest(request)
    const redirectTo = prepareRedirect(request, next)
    const cookieStore = cookies()
    const supabase = createClient(cookieStore)

    const { user, session, error } = code
      ? await handleOAuthSignin(code, supabase)
      : await handleEmailSignin(token_hash, type, supabase)

    if (error) {
      log.error('Failed to sign in', { error })
      redirectTo.pathname = '/login-error'
      return NextResponse.redirect(redirectTo)
    }
    if (!user || !session) {
      log.error('No user or session returned from sign in')
      redirectTo.pathname = '/login-error'
      return NextResponse.redirect(redirectTo)
    }

    const success = await finishSignIn(user, session, supabase)

    redirectTo.pathname = success ? '/me' : '/login-error'
    return NextResponse.redirect(redirectTo)
  } catch (error) {
    log.error('Unexpected error occurred in auth callback', { error })
    const redirectTo = request.nextUrl.clone()
    redirectTo.pathname = '/login-error'
    return NextResponse.redirect(redirectTo)
  }
}

const handleOAuthSignin = async (code: string, supabase: SupabaseClient<Database>): Promise<SigninResult> => {
  const {
    data: { user, session },
    error,
  } = await supabase.auth.exchangeCodeForSession(code)

  if (error) {
    log.error('Failed to exchange code for session', error)
    return { user: null, session: null, error: true }
  }
  return { user, session, error: false }
}

const handleEmailSignin = async (
  token_hash: string | null,
  type: EmailOtpType | null,
  supabase: SupabaseClient<Database>
): Promise<SigninResult> => {
  if (!token_hash || !type) {
    log.error('Token Hash or Type were missing in the auth callback')
    return { user: null, session: null, error: true }
  }

  const {
    data: { user, session },
    error,
  } = await supabase.auth.verifyOtp({
    type,
    token_hash,
  })

  if (error) {
    log.error('Failed to verify OTP', error)
    return { user: null, session: null, error: true }
  }

  return { user, session, error: false }
}

type SigninResult = {
  user: User | null
  session: Session | null
  error: boolean
}
