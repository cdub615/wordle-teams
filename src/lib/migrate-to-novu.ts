// scripts/migrateUsersToNovu.ts
import { createClient } from '@supabase/supabase-js';
import { Novu } from '@novu/node';
import {Database} from './database.types';


// TODO update to prod values before running
const supabase = createClient<Database>(process.env.SUPABASE_URL!, process.env.SUPABASE_ANON_KEY!);
const novu = new Novu(process.env.NOVU_API_KEY!);

async function migrateUsersToNovu() {
  const { data: players, error } = await supabase
    .from('players')
    .select('*')
    .order('id');

  if (error) {
    console.error('Error fetching users:', error);
    return;
  }

  for (const player of players) {
    if (player.first_name?.length === 0 && player.last_name?.length === 0) {
      try {
        // Create Novu subscriber
        await novu.subscribers.identify(player.id, {
          email: player.email,
          firstName: player.first_name,
          lastName: player.last_name,
        });
      } catch (error) {
        console.error(`Error creating Novu subscriber for user ${player.id}:`, error);
      }
    }
  }

  console.log('Migration completed');
}

migrateUsersToNovu().catch(console.error);