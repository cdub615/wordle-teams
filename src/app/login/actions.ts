'use server'

import { createClient } from '@/lib/supabase/actions'
import { logsnagClient } from '@/lib/utils'
import { revalidatePath } from 'next/cache'
import { cookies } from 'next/headers'
import { redirect } from 'next/navigation'
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

  const { error } = await supabase.auth.signInWithOtp({
    email,
    options: {
      shouldCreateUser: false,
      emailRedirectTo,
    },
  })

  if (error) {
    redirect('/error')
  }

  cookieStore.set('awaitingVerification', 'true')
  revalidatePath('/', 'layout')
  redirect('/login')
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
    redirect('/error')
  }

  const logsnag = logsnagClient()
  await logsnag.track({
    channel: 'users',
    event: 'User Signup',
    user_id: email,
    icon: '🧑‍💻',
    notify: true,
    tags: {
      firstName,
      lastName,
      env: process.env.ENVIRONMENT!,
    },
  })

  cookieStore.set('awaitingVerification', 'true')
  revalidatePath('/', 'layout')
  redirect('/')
}
