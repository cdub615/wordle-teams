import { AlertDialog, AlertDialogContent } from '@/components/ui/alert-dialog'
import { Button } from '@/components/ui/button'
import { createClient } from '@/lib/supabase/server'
import { extractInitials, getSession } from '@/lib/utils'
import { format } from 'date-fns'
import { cookies } from 'next/headers'
import Link from 'next/link'
import { redirect } from 'next/navigation'

type TeamsResponse = {
  teamId: number | undefined
  month: string
  initialsFromDb: string
}

const checkForTeams = async (): Promise<TeamsResponse> => {
  const supabase = createClient(cookies())
  const { data: teams } = await supabase.from('teams').select('*')
  const session = await getSession(supabase)
  if (!session) redirect('/login')
  const initialsFromDb = extractInitials(session.user.user_metadata)

  let teamId: number | undefined = undefined

  teamId = teams?.shift()?.id
  let month = format(new Date(), 'yyyyMM')
  return { teamId, month, initialsFromDb }
}

export default async function Home({ params }: { params: { initials: string } }) {
  const { initials } = params
  const { teamId, month, initialsFromDb } = await checkForTeams()
  if (initials !== initialsFromDb) redirect(`/${initials}`)

  if (!teamId)
    return (
      <AlertDialog open={true}>
        <AlertDialogContent>
          <p className='text-lg max-w-xs text-center mx-auto'>
            Receive a Team Invite or Create a Team to get started
          </p>
          <div className='flex justify-center my-4'>
            <Link href={`/${initials}/create-team`}>
              <Button>Create Team</Button>
            </Link>
          </div>
        </AlertDialogContent>
      </AlertDialog>
    )
  else redirect(`/${initials}/${teamId}/${month}`)
}
