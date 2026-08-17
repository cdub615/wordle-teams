'use server'

import { authCallbackUrl } from '@/lib/auth-urls'
import { createClient } from '@/lib/supabase/server'
import { log } from 'next-axiom'
import { cookies } from 'next/headers'
import { finishSignIn } from '../../lib/utils'
import { loginSchema, otpSchema, signupSchema } from './email/schemas'

const emailRedirectTo = authCallbackUrl()

// Spelled out rather than inferred so the caller can read `needsSignup` on every
// branch instead of narrowing a union of differently-shaped object literals.
type LoginResult = { error: string | null | undefined; needsSignup?: boolean }

export async function login(formData: FormData): Promise<LoginResult> {
  try {
    const cookieStore = await cookies()
    const supabase = createClient(cookieStore)

    const loginForm = {
      email: formData.get('email'),
    }

    const result = await loginSchema.safeParseAsync(loginForm)
    if (!result.success) return { error: result.error?.message }
    const { email } = result.data

    const { error } = await supabase.auth.signInWithOtp({
      email,
      options: {
        shouldCreateUser: false,
        emailRedirectTo,
      },
    })

    if (error) {
      // Not a failure: a first-time visitor lands on the Log In tab by default, so
      // this is the single most likely thing for a new user to do. Supabase reports
      // it as an error because shouldCreateUser is false, but for us it just means
      // 'send them to Sign Up'. Logged at info because it was filling the
      // production error feed with ordinary signups.
      //
      // Branch on the code rather than the message — 'Signups not allowed for otp'
      // is prose that Supabase can reword, otp_disabled is the contract. The
      // message check stays as a fallback for older gotrue versions.
      if (error.code === 'otp_disabled' || error.message === 'Signups not allowed for otp') {
        log.info('login: no account for that address, routing to signup')
        return { error: null, needsSignup: true }
      }

      log.error(error.message)
      return { error: 'Login failed. Please try again.' }
    }

    cookieStore.set('awaitingVerification', 'true')
    return { error: null }
  } catch (error) {
    log.error('Unexpected error occurred in login', { error })
    return { error: 'Login failed. Please try again.' }
  }
}

export async function signup(formData: FormData) {
  try {
    const cookieStore = await cookies()
    const supabase = createClient(cookieStore)

    const signupForm = {
      email: formData.get('email'),
      firstName: formData.get('firstName'),
      lastName: formData.get('lastName'),
    }

    const result = await signupSchema.safeParseAsync(signupForm)
    if (!result.success) return { error: result.error?.message }
    const { email, firstName, lastName } = result.data
    const data = { firstName, lastName }

    const { error: playerUpdateError } = await supabase.rpc('update_player_names', {
      email_to_update: email,
      new_first_name: firstName,
      new_last_name: lastName,
    })
    if (playerUpdateError) {
      log.error(playerUpdateError.message)
    }

    const { error } = await supabase.auth.signInWithOtp({
      email,
      options: {
        shouldCreateUser: true,
        emailRedirectTo,
        data,
      },
    })

    if (error) {
      log.error(error.message)
      return { error: 'Signup failed. Please try again.' }
    }

    cookieStore.set('awaitingVerification', 'true')
    return { error: null }
  } catch (error) {
    log.error('Unexpected error occurred in signup', { error })
    return { error: 'Signup failed. Please try again.' }
  }
}

export async function verifyOtp(formData: FormData) {
  try {
    const cookieStore = await cookies()
    const supabase = createClient(cookieStore)
    // A server action is a public endpoint, so the form's guard is not enough on
    // its own. Validating here also means a missing code is reported as such
    // instead of reaching Supabase and returning 'Verify requires either a token
    // or a token hash', which the caller then flattened into the generic
    // 'Verification failed' — accurate for a wrong code, useless for a blank one.
    const parsed = await otpSchema.safeParseAsync({
      email: formData.get('email'),
      otp: formData.get('otp'),
    })
    if (!parsed.success) return { error: parsed.error.issues[0].message }
    const { email, otp } = parsed.data

    const {
      data: { user, session },
      error,
    } = await supabase.auth.verifyOtp({
      email,
      token: otp,
      type: 'email',
    })
    if (error) {
      log.error(error.message)
      return { error: 'Verification failed. Please try again.' }
    }
    if (!user || !session) {
      log.error('No user or session returned from sign in')
      return { error: 'Verification failed. Please try again.' }
    }

    const success = await finishSignIn(user, session, supabase)

    return { error: success ? null : 'Verification failed. Please try again.' }
  } catch (error) {
    log.error('Unexpected error occurred in verifyOtp', { error })
    return { error: 'Verification failed. Please try again.' }
  }
}

export async function retry() {
  try {
    const cookieStore = await cookies()
    cookieStore.set('awaitingVerification', 'false')
  } catch (error) {
    log.error('Unexpected error occurred in retry', { error })
  }
}
