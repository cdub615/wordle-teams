'use server'
import { cookies } from 'next/headers'

export default async function setCookies(formData: FormData) {
  const cookieStore = cookies()
  const teamId = formData.get('teamId') as string
  const month = formData.get('month') as string
  cookieStore.set('teamId', teamId)
  cookieStore.set('month', month)
}
