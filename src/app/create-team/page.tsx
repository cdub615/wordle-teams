import { AlertDialogDescription, AlertDialogHeader, AlertDialogTitle } from '@/components/ui/alert-dialog'
import { Database } from '@/lib/database.types'
import { createServerComponentClient } from '@supabase/auth-helpers-nextjs'
import { log } from 'next-axiom'
import { cookies } from 'next/headers'
import CreateTeamForm from './create-team-form'

const CreateTeam = async () => {
  const supabase = createServerComponentClient<Database>({ cookies })
  const { data: teams, error } = await supabase.from('teams').select('*')
  if (error) log.error(error.message, { error })
  return (
    <>
      <AlertDialogHeader>
        <AlertDialogTitle>
          {!!teams && teams.length > 0 ? 'Create Team' : 'Receive Team Invite or Create a Team to get started'}
        </AlertDialogTitle>
        <AlertDialogDescription>
          Enter your team&apos;s name and specify whether you want to include weekend scores
        </AlertDialogDescription>
      </AlertDialogHeader>
      <CreateTeamForm />
    </>
  )
}

export default CreateTeam
