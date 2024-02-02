import { createClient } from '@/lib/supabase/server'
import { User } from '@/lib/types'
import { getSession } from '@/lib/utils'
import { cookies } from 'next/headers'
import BottomBarClientComponent from './bottom-bar-client'

const BottomBar = async () => {
  const supabase = createClient(cookies())
  const session = await getSession(supabase)

  let user: User | undefined = undefined

  if (session) {
    const firstName = session?.user.user_metadata.firstName
    const lastName = session?.user.user_metadata.lastName
    const email = session?.user.email
    user = { firstName, lastName, email }
  }

  return <BottomBarClientComponent user={user} />
}

export default BottomBar
