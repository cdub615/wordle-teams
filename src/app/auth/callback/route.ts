import { createClient } from '@/lib/supabase/actions'
import { type EmailOtpType } from '@supabase/supabase-js'
import { cookies } from 'next/headers'
import type { NextRequest } from 'next/server'
import { NextResponse } from 'next/server'
import {logsnagClient} from '@/lib/utils'

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

    const { error } = await supabase.auth.verifyOtp({
      type,
      token_hash,
    })
    if (!error) {
      // TODO logsnap the otp type
  //     const logsnag = logsnagClient()
  // await logsnag.track({
  //   channel: 'users',
  //   event: 'User Signup',
  //   user_id: email,
  //   icon: '🧑‍💻',
  //   notify: true,
  //   tags: {
  //     firstname: firstName,
  //     lastname: lastName,
  //     env: process.env.ENVIRONMENT!,
  //   },
  // })
      cookieStore.set('awaitingVerification', 'false')
      redirectTo.searchParams.delete('next')
      return NextResponse.redirect(redirectTo)
    }
    console.error(error)
  }

  // return the user to an error page with some instructions
  redirectTo.pathname = '/error'
  return NextResponse.redirect(redirectTo)
}
