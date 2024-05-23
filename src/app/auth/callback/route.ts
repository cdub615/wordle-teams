import { Database } from '@/lib/database.types'
import { createClient } from '@/lib/supabase/actions'
import { UserToken } from '@/lib/types'
import { Session, SupabaseClient, User, type EmailOtpType } from '@supabase/supabase-js'
import { jwtDecode } from 'jwt-decode'
import { log } from 'next-axiom'
import { cookies } from 'next/headers'
import type { NextRequest } from 'next/server'
import { NextResponse } from 'next/server'
import { handleLogsnagEvent, parseRequest, prepareRedirect, setNames } from './utils'

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
      redirectTo.pathname = '/login-error'
      return NextResponse.redirect(redirectTo)
    }
    if (!user || !session) {
      log.error('No user or session returned from sign in')
      redirectTo.pathname = '/login-error'
      return NextResponse.redirect(redirectTo)
    }

    const token = jwtDecode<UserToken>(session.access_token)
    const { user_first_name, user_last_name } = token
    const { full_name } = user.user_metadata
    let firstName = user_first_name
    let lastName = user_last_name
    if (
      (!user_first_name || !user_last_name || user_first_name.length === 0 || user_last_name.length === 0) &&
      full_name &&
      full_name.length > 0 &&
      full_name.includes(' ')
    ) {
      const { first, last } = await setNames(user.id, full_name, supabase)
      firstName = first
      lastName = last
    }

    await handleLogsnagEvent(user, firstName, lastName)

    const success = await handleInvite(user, supabase)

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

const handleInvite = async (user: User, supabase: SupabaseClient<Database>) => {
  const { invited } = user.user_metadata

  if (invited === true) {
    const { email, id } = user
    const { error } = await supabase.rpc('handle_invited_signup', {
      invited_email: email ?? '',
      invited_id: id ?? '',
    })
    if (error) {
      log.error('Failed to handle invited signup', error)
      return false
    }
  }
  return true
}

type SigninResult = {
  user: User | null
  session: Session | null
  error: boolean
}
