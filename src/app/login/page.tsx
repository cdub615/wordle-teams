import { Database } from '@/lib/database.types'
import { getSession } from '@/lib/utils'
import { createServerComponentClient } from '@supabase/auth-helpers-nextjs'
import { cookies } from 'next/headers'
import LoginForm from './login-form'

export default async function Page() {
  const supabase = createServerComponentClient<Database>({ cookies })
  const session = await getSession(supabase)
  return <LoginForm session={session} />
}
