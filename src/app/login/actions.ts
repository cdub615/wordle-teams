'use server'

import { createClient } from '@/lib/supabase/actions'
import { log } from 'next-axiom'
import { cookies } from 'next/headers'
import { finishSignIn } from '../../lib/utils'
import { loginSchema, signupSchema } from './email/schemas'

const emailRedirectTo = process.env.VERCEL_URL
  ? `${process.env.VERCEL_URL}/api/auth/callback`
  : 'http://localhost:3000/api/auth/callback'

export async function login(formData: FormData) {
  try {
    const cookieStore = cookies()
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
      log.error(error.message)
      if (error?.message === 'Signups not allowed for otp') {
        return { error: `Login failed. If you haven't yet signed up, please try the Sign Up form.` }
      }

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
    const cookieStore = cookies()
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
    const cookieStore = cookies()
    const supabase = createClient(cookieStore)
    const email = formData.get('email') as string
    const otp = formData.get('otp') as string

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
    const cookieStore = cookies()
    cookieStore.set('awaitingVerification', 'false')
  } catch (error) {
    log.error('Unexpected error occurred in retry', { error })
  }
}
