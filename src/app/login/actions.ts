'use server'

import { createClient } from '@/lib/supabase/actions'
import { revalidatePath } from 'next/cache'
import { cookies } from 'next/headers'
import { redirect } from 'next/navigation'
import { z } from 'zod'

const emailRedirectTo = process.env.VERCEL_URL
  ? `${process.env.VERCEL_URL}/auth/callback`
  : 'http://localhost:3000/auth/callback'

const loginSchema = z.object({
  email: z.string().email('Please enter a valid email that includes @ and .'),
})

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

  cookieStore.set('verificationEmailSent', 'true')

  revalidatePath('/', 'layout')
  redirect('/')
}

const signupSchema = z.object({
  email: z.string().email('Please enter a valid email that includes @ and .'),
  firstName: z.string().min(1, 'Must be at least 1 character'),
  lastName: z.string().min(1, 'Must be at least 1 character'),
})

export async function signup(formData: FormData) {
  const cookieStore = cookies()
  const supabase = createClient(cookieStore)

  const { email, firstName, lastName } = signupSchema.parse(formData)
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

  cookieStore.set('verificationEmailSent', 'true')

  revalidatePath('/', 'layout')
  redirect('/')
}
