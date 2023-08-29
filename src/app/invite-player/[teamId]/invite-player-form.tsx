'use client'

import {
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog'
import { Button } from '@/components/ui/button'
import { Team, teams } from '@/lib/types'
import { useRouter } from 'next/navigation'
import * as z from 'zod'
import { Input } from '../../../components/ui/input'
import invitePlayer from './actions'

const FormSchema = z.object({
  email: z.string().email('Please enter a valid email that includes @ and .'),
})

type InviteDialogProps = {
  team: teams
  playerIds: string[]
}

// TODO something is up with this form... seems to be something in the formfield or form.control maybe

export default function InviteDialog({ team, playerIds }: InviteDialogProps) {
  const router = useRouter()
  const selectedTeam = Team.prototype.fromDbTeam(team)
  const { id: teamId, name: teamName, invited } = selectedTeam

  return (
    <AlertDialogContent className='sm:max-w-[425px]'>
      <AlertDialogHeader>
        <AlertDialogTitle>Invite Player to {team.name}</AlertDialogTitle>
        <AlertDialogDescription>Add player by email address</AlertDialogDescription>
      </AlertDialogHeader>
      <form action={invitePlayer} className='w-full space-y-6'>
        <Input type='email' name='email' required />
        <input hidden name='teamId' value={teamId} />
        <input hidden name='teamName' value={teamName} />
        <input hidden name='playerIds' value={playerIds} />
        <input hidden name='invited' value={invited} />
        <div className="flex justify-end space-x-4">
          <Button onClick={() => router.back()} variant={'secondary'}>Cancel</Button>
          <Button type='submit'>Submit</Button>
        </div>
      </form>
    </AlertDialogContent>
  )
}
