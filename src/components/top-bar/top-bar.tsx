import { Database } from '@/lib/database.types'
import { User } from '@/lib/types'
import { getSession } from '@/lib/utils'
import { createServerComponentClient } from '@supabase/auth-helpers-nextjs'
import { cookies } from 'next/headers'
import TopBarClientComponent from './top-bar-client'

const TopBar = async () => {
  const supabase = createServerComponentClient<Database>({ cookies })
  const session = await getSession(supabase)

  let user: User | undefined = undefined

  if (session) {
    const firstName = session?.user.user_metadata.firstName
    const lastName = session?.user.user_metadata.lastName
    const email = session?.user.email
    user = { firstName, lastName, email }
  }

  return <TopBarClientComponent user={user} />
}

export default TopBar
