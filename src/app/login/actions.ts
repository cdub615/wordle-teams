'use server'

import { createClient } from '@/lib/supabase/actions'
import * as Sentry from '@sentry/nextjs'
import { log } from 'next-axiom'
import { cookies } from 'next/headers'
import { loginSchema, signupSchema } from './schemas'

const emailRedirectTo = process.env.VERCEL_URL
  ? `${process.env.VERCEL_URL}/auth/callback`
  : 'http://localhost:3000/auth/callback'

export async function login(formData: FormData) {
  const cookieStore = cookies()
  const supabase = createClient(cookieStore)

  const loginForm = {
    email: formData.get('email'),
  }

  const { email } = loginSchema.parse(loginForm)

  const { data, error } = await supabase.auth.signInWithOtp({
    email,
    options: {
      shouldCreateUser: false,
      emailRedirectTo,
    },
  })

  if (error) {
    Sentry.captureException(error)
    log.error(error.message)
    if (error?.message === 'Signups not allowed for otp') {
      return { error: `Login failed. If you haven't yet signed up, please try the Sign Up form.` }
    }

    return { error: 'Login failed. Please try again.' }
  }

  cookieStore.set('awaitingVerification', 'true')
  return { error: null }
}

export async function signup(formData: FormData) {
  const cookieStore = cookies()
  const supabase = createClient(cookieStore)

  const signupForm = {
    email: formData.get('email'),
    firstName: formData.get('firstName'),
    lastName: formData.get('lastName'),
  }

  const { email, firstName, lastName } = signupSchema.parse(signupForm)
  const data = { firstName, lastName }

  const { error } = await supabase.auth.signInWithOtp({
    email,
    options: {
      shouldCreateUser: true,
      emailRedirectTo,
      data,
    },
  })

  if (error) {
    Sentry.captureException(error)
    log.error(error.message)
    return { error: 'Signup failed. Please try again.' }
  }

  cookieStore.set('awaitingVerification', 'true')
}

export async function retry() {
  const cookieStore = cookies()
  cookieStore.set('awaitingVerification', 'false')
  cookieStore.set('failedOTP', 'false')
}
