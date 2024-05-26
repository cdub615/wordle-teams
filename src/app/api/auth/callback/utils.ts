import { Database } from '@/lib/database.types'
import { getOAuthProviderName, logsnagClient } from '@/lib/utils'
import * as Sentry from '@sentry/nextjs'
import { EmailOtpType, SupabaseClient, User } from '@supabase/supabase-js'
import { differenceInSeconds, parseISO } from 'date-fns'
import { log } from 'next-axiom'
import type { NextRequest } from 'next/server'

export const parseRequest = (request: NextRequest) => {
  const { searchParams } = new URL(request.url)
  const next = searchParams.get('next') ?? '/me'
  const code = searchParams.get('code')
  const token_hash = searchParams.get('token_hash')
  const type = searchParams.get('type') as EmailOtpType | null

  return { next, code, token_hash, type }
}

export const prepareRedirect = (request: NextRequest, next: string) => {
  const redirectTo = request.nextUrl.clone()
  redirectTo.pathname = next
  redirectTo.searchParams.delete('code')
  redirectTo.searchParams.delete('token_hash')
  redirectTo.searchParams.delete('type')
  return redirectTo
}

const isFirstSignIn = (created_at: string, last_sign_in_at: string) => {
  const created = parseISO(created_at)
  const last = parseISO(last_sign_in_at)
  const diff = Math.abs(differenceInSeconds(last, created))
  return diff <= 20
}

export const setNames = async (id: string, full_name: string, supabase: SupabaseClient<Database>) => {
  const nameParts = full_name.trim().split(' ')
  const first = nameParts[0]
  const last = nameParts.slice(1).join(' ')
  const { error } = await supabase
    .from('players')
    .update({ first_name: first, last_name: last })
    .eq('id', id)
    .select('*')
    .maybeSingle()

  if (error) {
    Sentry.captureException(error)
    log.error('Failed to update player name', { error })
  }

  const { error: refreshError } = await supabase.auth.refreshSession()
  if (refreshError) {
    Sentry.captureException(refreshError)
    log.error('Failed to refresh session after updating player name', { error })
  }

  return { first, last }
}

export const handleLogsnagEvent = async (user: User, firstName: string, lastName: string) => {
  const { email, last_sign_in_at, created_at } = user
  const { invited } = user.user_metadata

  const { provider } = user.app_metadata
  const providerName = getOAuthProviderName(provider ?? '')

  let event = null
  if (!last_sign_in_at || isFirstSignIn(created_at, last_sign_in_at)) event = 'User Signup'
  if (invited === true) event = 'Invited User Signup'

  if (event) {
    const logsnag = logsnagClient()
    await logsnag.track({
      channel: 'users',
      event,
      user_id: email,
      icon: '🧑‍💻',
      notify: true,
      tags: {
        email: email!,
        firstname: firstName,
        lastname: lastName,
        env: process.env.ENVIRONMENT!,
        provider: providerName.length > 0 ? providerName : 'Email',
      },
    })
  }
}
