import { createClient } from '@/lib/supabase/actions'
import { logsnagClient } from '@/lib/utils'
import { type EmailOtpType } from '@supabase/supabase-js'
import { log } from 'next-axiom'
import { cookies } from 'next/headers'
import type { NextRequest } from 'next/server'
import { NextResponse } from 'next/server'

export async function GET(request: NextRequest) {
  const cookieStore = cookies()

  const { searchParams } = new URL(request.url)
  const token_hash = searchParams.get('token_hash')
  const type = searchParams.get('type') as EmailOtpType | null
  const next = searchParams.get('next') ?? '/'

  const redirectTo = request.nextUrl.clone()
  redirectTo.pathname = next
  redirectTo.searchParams.delete('token_hash')
  redirectTo.searchParams.delete('type')

  if (token_hash && type) {
    const supabase = createClient(cookieStore)

    const { data, error } = await supabase.auth.verifyOtp({
      type,
      token_hash,
    })
    if (!error) {
      const { email } = data.user ?? {}
      const { firstName, lastName } = data.user?.user_metadata ?? {}
      let event = null
      if (type === 'signup') event = 'User Signup'
      if (type === 'invite') event = 'Invited User Signup'

      if (event) {
        // TODO create customer, create checkout for Free variant, redirect to checkout
        // In the auth callback, we should fetch the Free product variant id, create a lemonsqueezy customer,
        //   and update players table setting customer_id

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
          },
        })
      }

      if (type === 'invite') {
        const id = data.user?.id ?? ''
        // TODO update handle_invited_signup to account for the unlikely scenario where
        // the user has not yet signed up but has more than 2 team invites
        const { error } = await supabase.rpc('handle_invited_signup', {
          invited_email: email ?? '',
          invited_id: id,
        })
        if (error) {
          log.error('Failed to handle invited signup', error)
          redirectTo.pathname = '/error'
          return NextResponse.redirect(redirectTo)
        }
      }
      cookieStore.set('awaitingVerification', 'false')
      redirectTo.searchParams.delete('next')
      if (type === 'invite') redirectTo.pathname = '/complete-profile'
      return NextResponse.redirect(redirectTo)
    } else {
      log.error('Failed to verify OTP', error)
      redirectTo.pathname = '/error'
      return NextResponse.redirect(redirectTo)
    }
  }

  log.error('Token Hash or Type were missing in the auth callback')

  // return the user to an error page with some instructions
  redirectTo.pathname = '/error'
  return NextResponse.redirect(redirectTo)
}
