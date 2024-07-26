import { Novu } from '@novu/node'
import { createClient } from '@supabase/supabase-js'
import { Database } from './database.types'
import {AxiosError} from 'axios'

const supabase = createClient<Database>(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!)
const novu = new Novu(process.env.NOVU_API_KEY!)

async function migrateUsersToNovu() {
  const {data: players, error} = await supabase.from('players').select('*').order('id')
  console.log(`Migrating ${players?.length} users to Novu...`)

  if (error) {
    console.error('Error fetching users:', error)
    return
  }

  for (const player of players) {
    console.log(`Checking user ${player.id} (${player.first_name} ${player.last_name})...`)
    if (player.first_name && player.first_name.length > 0 && player.last_name && player.last_name.length > 0) {
      try {
        try {
          const result = await novu.subscribers.get(player.id)
          if (result) {
            console.log(JSON.stringify(result.data))
            console.log(`Skipping user ${player.id} (${player.first_name} ${player.last_name}) because they already have a Novu subscriber`)
            continue
          }
        } catch (error) {
          const result = error as AxiosError
          if (result.response?.status === 404) {
            // Create Novu subscriber
            await novu.subscribers.identify(player.id, {
              email: player.email,
              firstName: player.first_name,
              lastName: player.last_name,
            })
            console.log(`Created Novu subscriber for user ${player.id} (${player.first_name} ${player.last_name})`)
          }
        }
      } catch (error) {
        console.error(`Error creating Novu subscriber for user ${player.id} (${player.first_name} ${player.last_name}):`, error)
      }
    }
  }

  console.log('Migration completed')
}

migrateUsersToNovu().catch(console.error)
